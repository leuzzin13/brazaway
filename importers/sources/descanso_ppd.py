"""Pontos de Parada e Descanso (PPD) — painel público do Ministério dos Transportes (Power BI "BI - PPDs").

A lista oficial em XLSX (gov.br/transportes, "Lista de PPDs certificados") NÃO traz coordenadas e está parada em
maio/2025. O painel Power BI linkado na mesma página e na da ANTT tem a tabela completa, com latitude/longitude:

  - TB_Dados_PPD: estabelecimentos CERTIFICADOS (Portaria MInfra 45/2021): portaria, VALIDADE da certificação
    (4 anos), vagas aprovadas/declaradas, chuveiros, serviços, funcionamento, jurisdição (DNIT/ANTT).
    kind = 'ppd'. A validade fica em props.validade (data) — a API decide na hora se está vigente
    (PPD vencido NÃO é escondido: vira "posto com pátio" na prioridade do plano de direção).
  - TB_Concessionarias: PPDs exigidos nos contratos de concessão federal (Portaria MT 387/2024, art. 14 dispensa a
    certificação). kind = 'ppd_concessao'; props.operando = (Status == 'Entregue'). Os que ainda não foram entregues
    entram só para o mapa ("em obras"/"a iniciar") com a coordenada do PPD ou, na falta, a do edital.

Consulta: endpoints públicos do Power BI (modelsAndExploration + querydata), os mesmos que o navegador usa ao abrir o
link público. Não documentados: podem mudar sem aviso. Se falharem, usa a última resposta salva em data/cache.
NÃO baixamos proprietário, telefone nem e-mail (dados pessoais); o CNPJ é do estabelecimento.
Licença: o painel não declara licença; é dado público governamental (Lei 14.440/2022 manda publicar a lista de PPD,
CTB art. 67-C §9º). Citamos a fonte.
"""
from __future__ import annotations
import datetime as dt
import json
import re

import requests

from common import CACHE_DIR, UA, stable_id

LAYER_ID = 'descanso'
SOURCE = 'ppd-mt'
RESOURCE_KEY = 'f5fae26d-bf88-4a62-a827-e63967fef624'
HOST = 'https://wabi-brazil-south-api.analysis.windows.net'
SOURCE_URL = ('https://app.powerbi.com/view?r=eyJrIjoiZjVmYWUyNmQtYmY4OC00YTYyLWE4MjctZTYzOTY3ZmVmNjI0IiwidCI6IjdiZjAxYzZhLWU2ZmItNDIxYS1iYmIyLWI5MGMzZWE4NjhmNyJ9'
              ' (painel "PPDs" do Ministério dos Transportes, linkado em gov.br/transportes/.../portal-trc/ppd)')
LICENSE = 'Dado público governamental, sem licença declarada (Lei 13.103/2015 art. 11; CTB art. 67-C §9º) — citar Ministério dos Transportes'
NOTES = ''

PPD_COLS = ['SEQ.', 'Jurisdição', 'Portaria', 'Validade da Certif.', 'Nome Fantasia do Estabelecimento', 'CNPJ', 'Cidade', 'UF',
            'Rodovia', 'km', 'Nº de Chuveiros', 'Vagas de Estacionamento Declaradas', 'Vagas de Estacionamento Aprovadas',
            'Tipo do Estalebecimento ( Lei 13.103, Art. 9º, Parag. 2)', 'Longitude', 'Latitude', 'Serviços Principais',
            'Funcionamento', 'Estabelecimento']
CONC_COLS = ['id', 'Projeto', 'Concessionaria', 'UF', 'Rodovia', 'KM', 'Prazo PPD', 'Status', 'Municipio', 'Vagas',
             'Latitude PPD', 'Longitude PPD', 'Latitude Edital', 'Longitude Edital']


def _post(url: str, body: dict | None = None) -> dict:
    h = {**UA, 'X-PowerBI-ResourceKey': RESOURCE_KEY, 'Content-Type': 'application/json'}
    for attempt in range(3):
        try:
            r = (requests.post(url, data=json.dumps(body), headers=h, timeout=120) if body is not None
                 else requests.get(url, headers=h, timeout=120))
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if attempt == 2:
                raise
    raise RuntimeError('inalcançável')


def pbi_query(models: dict, entity: str, cols: list[str], count: int = 3000) -> list[dict]:
    """Consulta uma tabela do modelo e decodifica a resposta DSR (compressão por repetição R e nulos Ø)."""
    dsid = models['models'][0]['dbName']
    mid = models['models'][0]['id']
    rep = models['exploration']['report'].get('objectId')
    sel = [{'Column': {'Expression': {'SourceRef': {'Source': 't'}}, 'Property': c}, 'Name': f't.{c}'} for c in cols]
    body = {'version': '1.0.0', 'queries': [{'Query': {'Commands': [{'SemanticQueryDataShapeCommand': {
        'Query': {'Version': 2, 'From': [{'Name': 't', 'Entity': entity, 'Type': 0}], 'Select': sel},
        'Binding': {'Primary': {'Groupings': [{'Projections': list(range(len(cols)))}]},
                    'DataReduction': {'DataVolume': 3, 'Primary': {'Window': {'Count': count}}}, 'Version': 1}}}]},
        'QueryId': '', 'ApplicationContext': {'DatasetId': dsid, 'Sources': [{'ReportId': rep, 'VisualId': ''}]}}],
        'cancelQueries': [], 'modelId': mid}
    r = _post(HOST + '/public/reports/querydata?synchronous=true', body)
    ds = r['results'][0]['result']['data']['dsr']['DS'][0]
    vd = ds.get('ValueDicts', {})
    ph = ds['PH'][0]['DM0']
    schema = ph[0]['S']
    rows, prev = [], [None] * len(cols)
    for row in ph:
        if 'S' in row:
            schema = row['S']
        c = row.get('C', [])
        rep_mask = row.get('R', 0)
        null_mask = row.get('Ø', 0)
        vals, ci = [], 0
        for i in range(len(cols)):
            if rep_mask & (1 << i):
                v = prev[i]
            elif null_mask & (1 << i):
                v = None
            else:
                v = c[ci]
                ci += 1
                dn = schema[i].get('DN')
                if dn and isinstance(v, int):
                    v = vd[dn][v]
            vals.append(v)
        prev = vals
        rows.append(dict(zip(cols, vals)))
    return rows


def download() -> tuple[list[dict], list[dict], str | None]:
    """(ppds, concessionárias, data de atualização do modelo). Cai no cache se o Power BI falhar."""
    cache = CACHE_DIR / 'descanso_ppd_powerbi.json'
    try:
        models = _post(f'{HOST}/public/reports/{RESOURCE_KEY}/modelsAndExploration?preferReadOnlySession=true')
        refreshed = models['models'][0].get('LastRefreshTime')
        ppds = pbi_query(models, 'TB_Dados_PPD', PPD_COLS)
        conc = pbi_query(models, 'TB_Concessionarias', CONC_COLS)
        if len(ppds) < 50:
            raise RuntimeError(f'painel devolveu só {len(ppds)} PPDs')
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({'refreshed': refreshed, 'ppds': ppds, 'conc': conc}, ensure_ascii=False))
        return ppds, conc, refreshed
    except Exception as e:  # noqa: BLE001
        if cache.exists():
            print(f'  ! Power BI falhou ({e}); usando cache {cache}')
            d = json.loads(cache.read_text())
            return d['ppds'], d['conc'], d.get('refreshed')
        raise


def _num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(' ', '')
    if not s:
        return None
    if s.count(',') == 1 and '.' not in s:
        s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def _dms(s: str | None) -> float | None:
    """' 13°37'33.53"S' -> -13.6260."""
    if not s:
        return None
    m = re.search(r'(\d+)\s*°\s*(\d+)\s*\'\s*([\d.,]+)\s*"?\s*([NSLOEW])', s)
    if not m:
        return _num(s)
    v = int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3).replace(',', '.')) / 3600
    return -v if m.group(4) in 'SOW' else v


def _coord(lat, lon) -> tuple[float, float] | None:
    la, lo = _num(lat), _num(lon)
    if la is None or lo is None:
        return None
    if -75 <= la <= -28 and -35 <= lo <= 6:   # trocados
        la, lo = lo, la
    if not (-35 <= la <= 6 and -75 <= lo <= -28):
        return None
    return round(la, 6), round(lo, 6)


def _km(s) -> float | None:
    m = re.search(r'(\d+(?:[.,]\d+)?)', str(s or ''))
    return float(m.group(1).replace(',', '.')) if m else None


def _rod(s) -> str | None:
    m = re.search(r'(?i)\b(BR|SP|RJ|MG|PR|SC|RS|GO|MS|MT|BA|PE|CE|PI|MA|PA|TO|ES|AL|SE|PB|RN|RO|AC|AM|AP|RR|DF)\s*[-_ ]?\s*(\d{2,3})', str(s or ''))
    return f'{m.group(1).upper()}-{int(m.group(2)):03d}' if m else None


def _clean(s) -> str | None:
    if s is None:
        return None
    t = re.sub(r'\s+', ' ', str(s)).strip()
    return t or None


def _date_ms(v) -> str | None:
    if v is None:
        return None
    try:
        # o Power BI grava a data à meia-noite de Brasília em UTC (1748736000000 = 31/05/2025 21:00 -03)
        return dt.datetime.fromtimestamp(int(v) / 1000, dt.timezone(dt.timedelta(hours=-3))).date().isoformat()
    except (TypeError, ValueError, OverflowError):
        return None


def fetch():
    global NOTES
    ppds, conc, refreshed = download()
    out = []
    hoje = dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date().isoformat()
    sem_coord = 0
    for p in ppds:
        c = _coord(p.get('Latitude'), p.get('Longitude'))
        if not c:
            sem_coord += 1
            continue
        nome = _clean(p.get('Nome Fantasia do Estabelecimento')) or 'PPD'
        validade = _date_ms(p.get('Validade da Certif.'))
        cnpj = re.sub(r'\D', '', str(p.get('CNPJ') or '')) or None
        servicos = [s.strip() for s in re.split(r'[;,]', p.get('Serviços Principais') or '') if s.strip()]
        out.append({
            'source_id': f'ppd:{cnpj}' if cnpj else stable_id('ppd', nome, c),
            'geometry': {'type': 'Point', 'coordinates': [c[1], c[0]]},
            'name': nome,
            'kind': 'ppd',
            'props': {
                'categoria': 'PPD certificado',
                'validade': validade,
                'portaria': _clean(p.get('Portaria')),
                'jurisdicao': _clean(p.get('Jurisdição')),
                'cnpj': cnpj,
                'municipio': _clean(p.get('Cidade')), 'uf': _clean(p.get('UF')),
                'rodovia': _rod(p.get('Rodovia')), 'km': _km(p.get('km')),
                'vagas': int(_num(p.get('Vagas de Estacionamento Aprovadas')) or 0) or None,
                'vagas_declaradas': int(_num(p.get('Vagas de Estacionamento Declaradas')) or 0) or None,
                'chuveiros': int(_num(p.get('Nº de Chuveiros')) or 0) or None,
                'estabelecimento': _clean(p.get('Estabelecimento') or p.get('Tipo do Estalebecimento ( Lei 13.103, Art. 9º, Parag. 2)')),
                'servicos': servicos,
                'funcionamento': _clean(p.get('Funcionamento')),
                'h24': bool(re.search(r'24', p.get('Funcionamento') or '')),
                'painel_atualizado': refreshed,
            },
        })
    n_conc = 0
    for p in conc:
        status = _clean(p.get('Status')) or 'não informado'
        c = _coord(p.get('Latitude PPD'), p.get('Longitude PPD'))
        precisao = 'ppd'
        if not c:
            c = _coord(_dms(p.get('Latitude Edital')), _dms(p.get('Longitude Edital')))
            precisao = 'edital'
        if not c:
            continue
        operando = status.lower().startswith('entregue')
        conc_nome = _clean(p.get('Concessionaria')) or _clean(p.get('Projeto')) or 'concessionária'
        rod = _rod(p.get('Rodovia'))
        km = _km(p.get('KM'))
        n_conc += 1
        out.append({
            'source_id': stable_id('ppd_conc', p.get('Projeto'), rod, km),
            'geometry': {'type': 'Point', 'coordinates': [c[1], c[0]]},
            'name': f'PPD {conc_nome}' + (f' {rod} km {km:g}'.replace('.', ',') if rod and km is not None else ''),
            'kind': 'ppd_concessao',
            'props': {
                'categoria': 'PPD de concessão federal',
                'operando': operando,
                'status': status,
                'prazo': _clean(p.get('Prazo PPD')),
                'concessionaria': conc_nome, 'projeto': _clean(p.get('Projeto')),
                'municipio': _clean(p.get('Municipio')), 'uf': _clean(p.get('UF')),
                'rodovia': rod, 'km': km,
                'vagas': int(_num(p.get('Vagas')) or 0) or None,
                'posicao': 'coordenada do PPD' if precisao == 'ppd' else 'coordenada do edital (aproximada)',
                'painel_atualizado': refreshed,
            },
        })
    validos = sum(1 for f in out if f['kind'] == 'ppd' and (f['props']['validade'] or '') >= hoje)
    sp = [f for f in out if f['props'].get('uf') == 'SP']
    NOTES = (f'Painel atualizado em {refreshed or "?"}; {len(out) - n_conc} PPD certificados ({validos} com validade >= {hoje}, '
             f'{sem_coord} sem coordenada) e {n_conc} PPD de concessão ({sum(1 for f in out if f["kind"] == "ppd_concessao" and f["props"]["operando"])} entregues). '
             f'SP: {len(sp)}. Proprietário/telefone/e-mail não baixados.')
    return out
