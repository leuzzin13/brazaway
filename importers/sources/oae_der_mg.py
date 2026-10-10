"""Obras de Arte Especiais (OAE) do DER-MG — Observatório da Infraestrutura (SEINFRA-MG/DER-MG, ArcGIS REST).

Camada `oae`, source `der-mg`. Duas camadas da fonte:
  1. Hosted/pontes_20_05_2025 (cadastro, 4.370 OAEs): tipo (`tipooae`), extensão, largura, estrutura (`tipoestrut`),
     curso d'água, código SRE (`sremg`), regional (`codurg`). Uma feição por OAE.
  2. Hosted/Pontes (inspeção, 1.456 OAEs): `condestrut` e `conddurabi` (valores 0, 2, 3, 4), `qtdfaixas`,
     `larguratot`, `alturatota` (altura da ESTRUTURA, não gabarito). A escala das notas NÃO é documentada pela fonte:
     o importador grava os valores crus em props.condicao e nunca os usa para bloquear.
     Cada registro de inspeção é ligado à OAE do cadastro mais próxima a até CASAR_M metros (1.134 a menos de 10 m);
     os que não casam ficam de fora (contagem em NOTES), para não duplicar a mesma ponte.

Nenhum limite de peso ou gabarito é publicado: as feições não bloqueiam rota. A camada `oae` usa a fonte para contar
estruturas na rota, avisar ponte de madeira (`tipoestrut = Madeira`) e ponte estreita/de uma faixa (largura cadastrada
ou `qtdfaixas = 1`). Detalhes e licença em docs/layers/oae.md e docs/layers/rodovias_estaduais.md.
"""
from __future__ import annotations

import math
from collections import defaultdict

from sources._arcgis import query_geojson
from sources._ders import LICENCA_OBSERVATORIO_MG, OBSERVATORIO_MG, rodovia_de_sre_mg
from sources._oae_locate import dist_m

LAYER_ID = 'oae'
SOURCE = 'der-mg'
SOURCE_URL = f'{OBSERVATORIO_MG}/Hosted/pontes_20_05_2025/FeatureServer/0'
COND_URL = f'{OBSERVATORIO_MG}/Hosted/Pontes/FeatureServer/0'
LICENSE = LICENCA_OBSERVATORIO_MG
NOTES = None  # preenchido em fetch()

CASAR_M = 30            # inspeção -> cadastro: mesma OAE se a até 30 m
ESCALA_CONDICAO = 'não documentada pela fonte (valores 0, 2, 3 e 4); registrada crua, sem interpretação'


def _num(v) -> float | None:
    try:
        x = float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _txt(v) -> str | None:
    s = (str(v).strip() if v is not None else '')
    return s or None


def _kind(tipo: str | None, estrutura: str | None, curso: str | None) -> tuple[str, bool]:
    """(kind, inferido). Tipo em branco com curso d'água vira ponte (inferido)."""
    t = (tipo or '').lower()
    madeira = (estrutura or '').lower() == 'madeira'
    if 'passarela' in t:
        return 'passarela', False
    if 'túnel' in t or 'tunel' in t:
        return 'tunel', False
    if 'viaduto' in t:
        return 'viaduto', False
    if 'ponte' in t:
        return ('ponte_madeira' if madeira else 'ponte'), False
    if not t:
        if madeira:
            return 'ponte_madeira', True
        if curso:
            return 'ponte', True
    return 'outra', False


def _rotulo(kind: str, tipo: str | None) -> str:
    return {'ponte': 'Ponte', 'ponte_madeira': 'Ponte de madeira', 'viaduto': tipo or 'Viaduto', 'passarela': 'Passarela',
            'tunel': 'Túnel'}.get(kind, tipo or 'OAE')


def fetch():
    global NOTES
    cad = query_geojson(SOURCE_URL, order_by='fid', cache='dermg_oae_cadastro', max_age_h=24 * 30)
    cond = query_geojson(COND_URL, order_by='fid', cache='dermg_oae_condicao', max_age_h=24 * 30)

    # índice em grade do cadastro (célula de ~1 km) para casar a inspeção
    grade: dict[tuple[int, int], list[int]] = defaultdict(list)
    pts: list[tuple[float, float] | None] = []
    for i, f in enumerate(cad):
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            pts.append(None)
            continue
        x, y = g['coordinates'][:2]
        pts.append((x, y))
        grade[(int(x // 0.01), int(y // 0.01))].append(i)

    casados: dict[int, dict] = {}
    sem_par = 0
    for c in cond:
        g = c.get('geometry') or {}
        if g.get('type') != 'Point':
            sem_par += 1
            continue
        x, y = g['coordinates'][:2]
        melhor = (math.inf, -1)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in grade.get((int(x // 0.01) + dx, int(y // 0.01) + dy), []):
                    d = dist_m((x, y), pts[i])
                    if d < melhor[0]:
                        melhor = (d, i)
        d, i = melhor
        if i < 0 or d > CASAR_M:
            sem_par += 1
            continue
        p = c['properties']
        reg = {
            'id_inspecao': p.get('val__codig'),
            'nota_estrutural': p.get('condestrut'), 'nota_durabilidade': p.get('conddurabi'),
            'faixas': p.get('qtdfaixas'), 'largura_total_m': _num(p.get('larguratot')),
            'altura_estrutura_m': _num(p.get('alturatota')), 'descricao': _txt(p.get('descroae')),
            'distancia_m': round(d, 1),
        }
        # duas inspeções no mesmo ponto: fica a mais próxima
        if i not in casados or casados[i]['distancia_m'] > reg['distancia_m']:
            casados[i] = reg

    out = []
    for i, f in enumerate(cad):
        if pts[i] is None:
            continue
        p = f['properties']
        tipo = _txt(p.get('tipooae'))
        estrutura = _txt(p.get('tipoestrut'))
        curso = _txt(p.get('nomecursoa'))
        kind, inferido = _kind(tipo, estrutura, curso)
        if kind == 'outra' and not tipo and i in casados:
            # tipo em branco no cadastro: usa a descrição da inspeção ("Ponte sobre o Rio ...", "Viaduto ...")
            k2, _ = _kind((casados[i].get('descricao') or '').split(' ')[0], estrutura, curso)
            if k2 != 'outra':
                kind, inferido = k2, True
        rod = rodovia_de_sre_mg(p.get('sremg'))
        largura = _num(p.get('largura'))
        cod = _txt(p.get('idcadastro'))
        nome = _rotulo(kind, tipo) + (f' sobre {curso}' if curso and kind in ('ponte', 'ponte_madeira') else '')
        nome += f' — {rod}' if rod else ''
        props = {
            'admin': 'estadual (DER-MG)', 'rodovia': rod, 'sremg': _txt(p.get('sremg')), 'id_cadastro': cod,
            'urg': p.get('codurg'), 'tipo_original': tipo, 'tipo_inferido': inferido or None, 'estrutura': estrutura,
            'comprimento_m': _num(p.get('extensao')), 'largura_m': largura if largura and largura > 0 else None,
            'curso_dagua': curso,
        }
        if i in casados:
            props['condicao'] = casados[i]
        out.append({
            'source_id': (_txt(p.get('globalid')) or f'fid-{p.get("fid")}').strip('{}').lower(),
            'geometry': {'type': 'Point', 'coordinates': [round(pts[i][0], 6), round(pts[i][1], 6)]},
            'name': nome,
            'kind': kind,
            'props': {k: v for k, v in props.items() if v is not None},
        })
    NOTES = (f'{len(out)} OAEs do cadastro (pontes_20_05_2025); {len(casados)} com nota de inspeção casada a até {CASAR_M} m '
             f'(Hosted/Pontes, {len(cond)} registros; {sem_par} sem par ficaram de fora). Escala de condição {ESCALA_CONDICAO}. '
             'Cadastro com data de referência 01/03/2024 (dataresp). Sem limite de peso nem gabarito: não bloqueia rota.')
    return out
