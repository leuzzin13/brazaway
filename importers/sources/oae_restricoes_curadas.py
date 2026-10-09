"""Restrições oficiais em pontes/viadutos curadas à mão (data/raw/oae_restricoes_curadas.csv).

Cada linha é uma restrição publicada por órgão oficial (portaria, notícia oficial da Prefeitura/DER/Defesa Civil),
com fonte, datas, data de verificação e status:
  - `vigente`  : confirmada por fonte oficial recente → a API bloqueia (exclusão pequena sobre o tabuleiro) para os
                 veículos que o `criterio` alcança;
  - `historica`: restrição que existiu mas não tem confirmação recente (ou já foi liberada) → só informa.

Colunas do CSV (todas texto; vazias = desconhecido):
  id, nome, municipio, orgao, tipo (proibido_pesados|interditada|peso|altura|faixa_interditada), valor, unidade,
  aplica_a (texto do ato), criterio (todos|caminhoes|nenhum|pbt>X|eixos>N|altura>=X), exceto_vuc (sim|nao), sentido,
  status (vigente|historica), inicio, fim (AAAA-MM-DD), ato, fonte_url, fonte_data, liberacao, liberacao_url,
  liberacao_data, liberacao_fonte, verificado_em, eixo ("lon lat;lon lat;..."), bloqueio_pontos ("lon lat;..."),
  bloqueio_raio_m, obs

Geometria: `eixo` é o eixo aproximado da obra (poucos pontos; traçado sobre o OSM e conferido com a descrição oficial).
`bloqueio_pontos` são pontos SOBRE o tabuleiro onde nenhuma outra via passa por baixo (ex.: sobre o rio), para a
exclusão não bloquear a Marginal sob a ponte. Sem ponto de bloqueio a linha nunca bloqueia (só informa).
"""
import csv
import os
import re

from common import DATA_DIR

LAYER_ID = 'oae'
SOURCE = 'curadoria'
CSV_PATH = os.environ.get('CURADORIA_CSV') or str(DATA_DIR / 'raw' / 'oae_restricoes_curadas.csv')
SOURCE_URL = 'data/raw/oae_restricoes_curadas.csv (curadoria manual de atos e notícias oficiais; URL de cada fonte em props.restricao)'
LICENSE = ('Fatos extraídos de atos e notícias oficiais (PMSP, Prefeituras, CET, SIURB, Defesa Civil) com citação da fonte; '
           'geometria aproximada derivada do OSM (ODbL, extração não substancial). Mantida fora do OSM.')
NOTES = 'Revisar a cada 3 meses. Só status=vigente bloqueia rota; historica apenas informa.'

TIPOS = {'proibido_pesados', 'interditada', 'peso', 'altura', 'faixa_interditada'}
STATUS = {'vigente', 'historica'}
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _pts(s: str) -> list[list[float]]:
    out = []
    for part in (s or '').split(';'):
        part = part.strip()
        if not part:
            continue
        lon, lat = (float(x) for x in part.split())
        if not (-75 <= lon <= -28 and -35 <= lat <= 6):
            raise ValueError(f'coordenada fora do Brasil: {part}')
        out.append([lon, lat])
    return out


def _criterio(s: str, exceto_vuc: bool) -> dict:
    """Converte o critério textual em regra que a API avalia contra o veículo."""
    s = (s or '').strip().lower().replace(' ', '')
    if s in ('', 'nenhum'):
        return {'nenhum': True}
    if s == 'todos':
        return {'todos': True}
    if s == 'caminhoes':
        return {'caminhoes': True, 'exceto_vuc': exceto_vuc}
    m = re.match(r'^(pbt|eixos|altura)(>=|>)(\d+(?:\.\d+)?)$', s)
    if not m:
        raise ValueError(f'critério inválido: {s}')
    campo, op, val = m.group(1), m.group(2), float(m.group(3))
    key = {'pbt': 'peso_acima_t', 'eixos': 'eixos_acima', 'altura': 'altura_min_m'}[campo]
    if campo == 'altura' and op != '>=':
        raise ValueError('altura usa >=')
    return {key: val, 'exceto_vuc': exceto_vuc}


def _kind(nome: str) -> str:
    n = nome.lower()
    if n.startswith('viaduto') or 'elevado' in n:
        return 'viaduto'
    if 'passarela' in n:
        return 'passarela'
    if 'túnel' in n or 'tunel' in n:
        return 'tunel'
    return 'ponte'


def _num(s):
    s = (s or '').strip().replace(',', '.')
    return float(s) if s else None


def fetch():
    path = CSV_PATH
    with open(path, newline='', encoding='utf-8') as fh:
        rows = list(csv.DictReader(fh))
    out = []
    for i, r in enumerate(rows, start=2):
        r = {k: (v or '').strip() for k, v in r.items() if k}
        rid = r['id']
        try:
            if r['tipo'] not in TIPOS:
                raise ValueError(f"tipo inválido: {r['tipo']}")
            if r['status'] not in STATUS:
                raise ValueError(f"status inválido: {r['status']}")
            for k in ('inicio', 'fim', 'fonte_data', 'liberacao_data', 'verificado_em'):
                if r.get(k) and not DATE.match(r[k]):
                    raise ValueError(f'{k} fora do formato AAAA-MM-DD: {r[k]}')
            if not r.get('fonte_url') or not r.get('verificado_em'):
                raise ValueError('fonte_url e verificado_em são obrigatórios')
            eixo = _pts(r['eixo'])
            if not eixo:
                raise ValueError('eixo vazio')
            pontos = _pts(r.get('bloqueio_pontos', ''))
            valor = _num(r.get('valor'))
            crit = _criterio(r.get('criterio', ''), r.get('exceto_vuc', '').lower() == 'sim')
        except Exception as e:
            raise ValueError(f'{os.path.basename(path)} linha {i} ({rid}): {e}') from e
        vigente = r['status'] == 'vigente'
        geom = {'type': 'LineString', 'coordinates': eixo} if len(eixo) > 1 else {'type': 'Point', 'coordinates': eixo[0]}
        restricao = {
            'tipo': r['tipo'], 'valor': valor, 'unidade': r.get('unidade') or None, 'aplica_a': r.get('aplica_a') or None,
            'criterio': crit, 'sentido': r.get('sentido') or None, 'status': r['status'],
            'inicio': r.get('inicio') or None, 'fim': r.get('fim') or None,
            'ato': r.get('ato') or None, 'fonte_url': r['fonte_url'], 'fonte_data': r.get('fonte_data') or None,
            'liberacao': r.get('liberacao') or None, 'liberacao_url': r.get('liberacao_url') or None,
            'liberacao_data': r.get('liberacao_data') or None, 'liberacao_fonte': r.get('liberacao_fonte') or None,
            'verificado_em': r['verificado_em'], 'orgao': r.get('orgao') or None, 'obs': r.get('obs') or None,
        }
        raio = _num(r.get('bloqueio_raio_m')) or 12
        out.append({
            'source_id': rid,
            'geometry': geom,
            'name': r['nome'],
            'kind': _kind(r['nome']),
            'props': {
                'admin': r.get('orgao') or None, 'municipio': r.get('municipio') or None,
                'restricao': restricao,
                # limites numéricos genéricos (lidos pela regra geral da camada) só quando vigentes
                'altura_livre_m': valor if (vigente and r['tipo'] == 'altura') else None,
                'peso_max_t': valor if (vigente and r['tipo'] == 'peso') else None,
                'altura_fonte': 'curadoria (ato oficial)' if (vigente and r['tipo'] == 'altura') else None,
                'bloqueio': {'modo': 'sob' if r['tipo'] == 'altura' else 'sobre', 'pontos': pontos, 'raio_m': raio} if pontos else None,
            },
            # vigência com fim conhecido expira sozinha; histórica fica visível (sem valid_to) para informar
            'valid_from': None,
            'valid_to': (r['fim'] + 'T23:59:59-03:00') if (vigente and r.get('fim')) else None,
        })
    return out
