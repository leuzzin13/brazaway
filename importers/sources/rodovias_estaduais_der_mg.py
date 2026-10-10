"""Pontos críticos vivos das rodovias estaduais de MG — DER-MG/SEINFRA, Observatório da Infraestrutura (ArcGIS REST,
camada 00_PUBLICACOES/pontos_criticos_publico, a mesma do painel público "Pontos críticos" ligado à página
"Condições das estradas" do DER-MG).

Camada `rodovias_estaduais`, source `der-mg`, kind `ponto_critico`. Só entram os pontos ATIVOS: `status` 1 (A iniciar),
2 (Em andamento) ou 3 (Paralisada) e sem `data_conclusao`. Concluídos (4) e "A definir" (0) ficam de fora.

Situação de tráfego (props.situacao): vem de `trafeg_variante`, o campo que o painel público mostra como
"Trafegabilidade" (a pesquisa de 10/10/2026 mostrou que ele é o mais completo e que `trafegabilidade` diverge dele em
alguns pontos). Sem `trafeg_variante`, usa `trafegabilidade` + `solucao_trafego`:
  - 'interrompida'               Pista Interrompida (sem variante)        -> bloqueia todo veículo
  - 'interrompida_pesados'       Pista interrompida para veículos pesados -> bloqueia caminhão (PBT > 3,5 t, VUC inclusive)
  - 'interrompida_com_variante'  Pista Interrompida - Com Variante        -> só aviso (há desvio no local)
  - 'meia_pista'                 Meia-Pista                               -> só aviso (pare-e-siga)
  - 'livre' / 'a_definir'                                                 -> só contagem
`limite_carga` = Sim com `qnt_carga_limite` (t) preenchido bloqueia quem pesa mais; sem o valor (100% em 10/10/2026) é
só aviso. O bloqueio é feito pela API (camada rodovias_estaduais.layer.ts) só no ponto, com um círculo pequeno sobre a
pista (props.bloqueio), calculado aqui com o /locate do Valhalla.

Atualização frequente: o importador é idempotente (apaga e regrava a source), grava `valid_to` = hora da consulta +
VALIDADE_H (padrão 72 h) e a API ignora feições vencidas. A hora da consulta é a do download de fato (mtime do cache,
que vale CACHE_H): se o Observatório estiver fora do ar, a carga FALHA em vez de reaproveitar cache vencido (o
`http_get` comum faria isso), e os pontos já gravados vencem sozinhos em vez de bloquear uma via já liberada. Rodar de
hora em hora ou ao menos 1×/dia (ver docs/layers/rodovias_estaduais.md).
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from common import _sql_str
from sources._arcgis import query_geojson
from sources._ders import LICENCA_OBSERVATORIO_MG, OBSERVATORIO_MG, rodovia_mg, snap_bloqueio

LAYER_ID = 'rodovias_estaduais'
SOURCE = 'der-mg'
SOURCE_URL = f'{OBSERVATORIO_MG}/00_PUBLICACOES/pontos_criticos_publico/FeatureServer/0'
LICENSE = LICENCA_OBSERVATORIO_MG
NOTES = None
SEED_SQL = None   # seed próprio: fonte viva, sem feições (ver seed_sql)
VALIDADE_H = float(os.environ.get('DERMG_PC_VALIDADE_H', '72'))
CACHE_H = float(os.environ.get('DERMG_PC_CACHE_H', '0.5'))

STATUS = {'1': 'A iniciar', '2': 'Em andamento', '3': 'Paralisada'}
TRAFEG = {'0': 'A definir', '1': 'Pista Normal (livre)', '2': 'Meia-Pista', '3': 'Pista Interrompida',
          '4': 'Pista interrompida para veículos pesados'}
SOLUCAO = {'0': 'A definir', '1': 'Com Variante', '2': 'Sem Variante'}
ATIVO_AFETADO = {'0': 'A definir', '1': 'Pista', '2': 'OAE (túneis, pontes, viadutos, passarelas etc.)',
                 '3': 'OAC (bueiros, pontilhões, muros de arrimo etc.)'}
SIM_NAO = {'0': 'A definir', '1': 'Sim', '2': 'Não'}
FASE = {'0': 'A definir', '1': 'Projeto', '2': 'Obra'}
SITUACAO_DE_VARIANTE = {
    'pista interrompida': 'interrompida',
    'pista interrompida - com variante': 'interrompida_com_variante',
    'pista interrompida para veículos pesados': 'interrompida_pesados',
    'meia-pista': 'meia_pista',
    'pista normal (livre)': 'livre',
}
BLOQUEIAM = {'interrompida', 'interrompida_pesados'}


def situacao(p: dict) -> tuple[str, str]:
    """(situacao, origem) — origem: 'trafeg_variante' ou 'trafegabilidade'."""
    tv = (p.get('trafeg_variante') or '').strip().lower()
    if tv in SITUACAO_DE_VARIANTE:
        s = SITUACAO_DE_VARIANTE[tv]
        origem = 'trafeg_variante'
    else:
        t = str(p.get('trafegabilidade') or '0').strip()
        sol = str(p.get('solucao_trafego') or '').strip()
        s = {'1': 'livre', '2': 'meia_pista', '4': 'interrompida_pesados'}.get(t, 'a_definir')
        if t == '3':
            s = 'interrompida_com_variante' if sol == '1' else 'interrompida'
        origem = 'trafegabilidade'
    # 'veiculos_leves' = Sim numa interrupção total: leves passam, então é interrupção só para pesados
    if s == 'interrompida' and str(p.get('veiculos_leves') or '') == '1':
        s = 'interrompida_pesados'
    return s, origem


def _iso(ms) -> str | None:
    if ms in (None, ''):
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat(timespec='seconds')
    except (TypeError, ValueError, OSError):
        return None


def _txt(v) -> str | None:
    s = str(v).strip() if v is not None else ''
    return s or None


def _int(v) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def fetch():
    global NOTES
    info: dict = {}
    feats = query_geojson(SOURCE_URL, where="status IN ('1','2','3') AND data_conclusao IS NULL", order_by='objectid',
                          cache='dermg_pc', max_age_h=CACHE_H, sem_cache_vencido=True, info=info)
    # validade contada do download de fato (o cache pode ter até CACHE_H), nunca da hora desta execução
    agora = info.get('lido_em') or datetime.now(timezone.utc)
    valid_to = (agora + timedelta(hours=VALIDADE_H)).isoformat(timespec='seconds')
    linhas = []
    for f in feats:
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        p = f['properties']
        sit, origem = situacao(p)
        lim_t = _int(p.get('qnt_carga_limite'))
        lim = SIM_NAO.get(str(p.get('limite_carga') or ''), None)
        rod = rodovia_mg(p.get('rodovia'))
        props = {
            'orgao': 'DER-MG', 'uf': 'MG', 'ativo': True,
            'objectid': p.get('objectid'), 'id_ponto': _txt(p.get('id_pontocritico')),
            'rodovia': rod, 'sremg': _txt(p.get('sremg')), 'trecho': _txt(p.get('trecho')),
            'municipio': _txt(p.get('municipio')), 'regional': _txt(p.get('regional')),
            'situacao': sit, 'situacao_origem': origem,
            'trafeg_variante': _txt(p.get('trafeg_variante')),
            'trafegabilidade': TRAFEG.get(str(p.get('trafegabilidade') or ''), _txt(p.get('trafegabilidade'))),
            'solucao_trafego': SOLUCAO.get(str(p.get('solucao_trafego') or ''), None),
            'veiculos_leves': SIM_NAO.get(str(p.get('veiculos_leves') or ''), None),
            'limite_carga': lim, 'limite_carga_t': lim_t if lim_t and lim_t > 0 else None,
            'status': STATUS.get(str(p.get('status'))), 'fase': FASE.get(str(p.get('fase') or ''), None),
            'status_final': _txt(p.get('status_final')),
            'causa': _txt(p.get('causas')), 'ativo_afetado': ATIVO_AFETADO.get(str(p.get('ativo_afetado') or ''), None),
            'faixa_interrompida': _txt(p.get('faixa_interrompida')),
            'obs_alternativa': _txt(p.get('obs_alternativa')),
            'data_prevista': _iso(p.get('data_prevista')),
            'prazo_dias': _int(p.get('prazos')), 'novo_prazo_dias': _int(p.get('novo_prazo')),
            'criado_em': _iso(p.get('created_date')), 'editado_em': _iso(p.get('last_edited_date')),
            'consultado_em': agora.isoformat(timespec='seconds'), 'fonte_url': SOURCE_URL,
        }
        linhas.append((f, props))

    # ponto de bloqueio na pista (só para quem pode bloquear: interrupção ou limite de carga com valor)
    cand = [(i, f, props) for i, (f, props) in enumerate(linhas) if props['situacao'] in BLOQUEIAM or props['limite_carga_t']]
    if cand:
        snaps = snap_bloqueio([tuple(f['geometry']['coordinates'][:2]) for _, f, _ in cand], [props['rodovia'] for _, _, props in cand])
        for (_, _, props), b in zip(cand, snaps):
            props['bloqueio'] = b

    out = []
    for f, props in linhas:
        x, y = f['geometry']['coordinates'][:2]
        rod = props['rodovia'] or 'rodovia estadual'
        out.append({
            'source_id': str(props['objectid']),
            'geometry': {'type': 'Point', 'coordinates': [round(x, 6), round(y, 6)]},
            'name': f"Ponto crítico DER-MG — {rod}{', ' + props['municipio'] if props['municipio'] else ''}",
            'kind': 'ponto_critico',
            'props': {k: v for k, v in props.items() if v is not None},
            'valid_from': props.get('criado_em'),
            'valid_to': valid_to,
        })
    ultima_edicao = max((o['props'].get('editado_em') or '' for o in out), default='') or None
    for o in out:
        o['props']['fonte_ultima_edicao'] = ultima_edicao
    cont: dict[str, int] = {}
    for o in out:
        cont[o['props']['situacao']] = cont.get(o['props']['situacao'], 0) + 1
    NOTES = (f'{len(out)} pontos críticos ativos (status 1/2/3, sem data de conclusão) consultados em {agora.isoformat(timespec="minutes")}; '
             f'situação: {", ".join(f"{k} {v}" for k, v in sorted(cont.items()))}. Última edição na fonte: {ultima_edicao}. '
             f'valid_to = consulta + {VALIDADE_H:g} h (reimportar antes disso; fonte fora do ar = carga falha, sem cache vencido). '
             'Cadastro operacional, não ato normativo.')
    global SEED_SQL
    SEED_SQL = seed_sql()
    return out


def seed_sql() -> str:
    """Seed sem feições. O `migrate` reaplica os seeds a cada subida: um seed com os pontos de hoje sobrescreveria, numa
    máquina já atualizada, os pontos frescos pelos antigos (e numa máquina limpa eles já estariam vencidos em 72 h).
    Então o seed só apaga os pontos vencidos e registra a fonte uma vez; os pontos vêm do importador."""
    nota = ('seed sem feições: fonte viva (pontos críticos do DER-MG). Rode o importador rodovias_estaduais_der_mg '
            'de hora em hora ou ao menos 1×/dia; cada carga vale ' + f'{VALIDADE_H:g} h (valid_to).')
    return '\n'.join([
        f'-- GERADO por importers/run.py ({LAYER_ID}/{SOURCE}). Fonte: {SOURCE_URL}. Licença: {LICENSE}. Não edite à mão.',
        '-- Fonte viva: o seed não traz feições (elas venceriam em ' + f'{VALIDADE_H:g}' + ' h e sobrescreveriam dados frescos a cada migrate).',
        f"delete from data_features where layer_id = {_sql_str(LAYER_ID)} and source = {_sql_str(SOURCE)} and valid_to is not null and valid_to < now();",
        'insert into data_layer_runs (layer_id, source, source_url, license, record_count, notes)',
        f'select {_sql_str(LAYER_ID)}, {_sql_str(SOURCE)}, {_sql_str(SOURCE_URL)}, {_sql_str(LICENSE)}, 0, {_sql_str(nota)}',
        f' where not exists (select 1 from data_layer_runs where layer_id = {_sql_str(LAYER_ID)} and source = {_sql_str(SOURCE)});',
        '',
    ])
