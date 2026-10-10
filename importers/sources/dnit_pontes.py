"""Pontes/viadutos das rodovias federais: cadastro DNITGeo (vgeo:oae_sgo) + nota técnica do PROARTE/DNIT (Power BI).

- DNITGeo WFS `vgeo:oae_sgo`: 8,8 mil OAEs com ponto, tipo, estrutura, extensão e largura (sem peso nem nota).
- Painel público Power BI "OBRAS DE ARTE ESPECIAIS" do PROARTE/DNIT (tabela PLANILHÃO): nota técnica 1–5 do SGO,
  data da vistoria e histórico de inspeções; tabela BASE BRÁULIOS: situação no PROARTE. Junção pelo código SGO
  (casa 100% com o oae_sgo). OAEs do painel sem ponto no WFS entram pelo lat/lon do próprio painel.
Nota (Norma DNIT 010/2024-PRO, quadro de classificação): 5 excelente, 4 boa, 3 regular, 2 ruim, 1 crítica.
A camada é INFORMATIVA: nota baixa não é limite de peso (Res. DNIT 11/2022, art. 29 §5º).
Se o Power BI falhar, a carga segue só com o WFS (nota = null) e registra isso em NOTES.
"""
from __future__ import annotations

import datetime
import gzip
import json
import re

import requests

from common import CACHE_DIR, UA
from sources.siaet_restricoes import oae_sgo

LAYER_ID = 'pontes_federais'
SOURCE = 'dnit'
SOURCE_URL = ('https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs (vgeo:oae_sgo) + painel Power BI PROARTE/DNIT '
              'https://app.powerbi.com/view?r=eyJrIjoiZWU3NWRjYjQtNGVmMS00ZmEwLTk2MmYtODM3NWIxYWRlZWZhIiwidCI6IjQ0MTBhNmY2LWM2MTMtNGNkNy05M2VjLTY1MzBhZjdhMzA1MyJ9')
LICENSE = ('Dado público do DNIT sem licença explícita (WFS DNITGeo com AccessConstraints=NONE; painel Power BI "publish to web" '
           'do PROARTE sem termo de uso). Uso informativo citando DNIT/PROARTE; formalizar reuso via LAI antes de uso comercial pesado.')
NOTES = None

PBI_KEY = 'ee75dcb4-4ef1-4fa0-962f-8375b1adeefa'
PBI_API = 'https://wabi-brazil-south-b-primary-api.analysis.windows.net/public/reports'
PBI_MODEL_FALLBACK = 5764495

NOTA_DESC = {1: 'crítica', 2: 'ruim', 3: 'regular', 4: 'boa', 5: 'excelente'}
KIND = {
    'Ponte': 'ponte', 'Ponte de Madeira': 'ponte_madeira', 'Pontilhão': 'pontilhao', 'Viaduto': 'viaduto',
    'Passarela': 'passarela', 'Passagem de Pedestres': 'passarela', 'Passagem Superior': 'passagem_superior',
    'Passagem Inferior': 'passagem_inferior', 'Túnel': 'tunel', 'Passagem de Animais': 'passagem_fauna',
    'Bueiro': 'bueiro', 'OAE Inservível': 'inservivel',
}
PLAN_COLS = ['CodPro', 'Código (SGO)', 'Identificação da OAE - SGO', 'Rodovia', 'UF', 'Município', 'km', 'SNV',
             'Extensão (m)', 'Largura (m)', 'Tipo de Estrutura', 'Tipo de Obra', 'Latitude', 'Longitude',
             'Data da Vistoria (SGO)', 'Nota Técnica Atual (SGO)', 'Condição da OAE',
             'Data da 1ª Inspeção', 'Nota Técnica da 1ª Inspeção', 'Data da 2ª Inspeção', 'Nota Técnica da 2ª Inspeção',
             'Data da 3ª Inspeção', 'Nota Técnica da 3ª Inspeção', 'Data da 4ª Inspeção', 'Nota Técnica da 4ª Inspeção',
             'Administração', 'Jurisdição']
BRAULIOS_COLS = ['Código (SGO)', 'Status Geral', 'Status Detalhado']


# --------------------------------------------------------------------------------------------- Power BI


def _pbi_headers():
    return {**UA, 'X-PowerBI-ResourceKey': PBI_KEY, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip', 'User-Agent': 'Mozilla/5.0'}


def pbi_model() -> tuple[int, str | None]:
    try:
        r = requests.get(f'{PBI_API}/{PBI_KEY}/modelsAndExploration?preferReadOnlySession=true', headers=_pbi_headers(), timeout=60)
        r.raise_for_status()
        m = r.json()['models'][0]
        return int(m['id']), m.get('LastRefreshTime')
    except Exception as e:  # noqa: BLE001
        print(f'    ! Power BI modelsAndExploration falhou ({e}); usando modelo {PBI_MODEL_FALLBACK}')
        return PBI_MODEL_FALLBACK, None


def pbi_query(model: int, entity: str, cols: list[str], cache: str) -> list[dict]:
    """Consulta a API pública do relatório (publish-to-web) e decodifica o DSR (formato compacto do Power BI)."""
    p = CACHE_DIR / cache
    if p.exists() and (datetime.datetime.now().timestamp() - p.stat().st_mtime) < 7 * 86400:
        d = json.loads(p.read_bytes())
    else:
        sel = [{'Column': {'Expression': {'SourceRef': {'Source': 'b'}}, 'Property': c}, 'Name': f'b.{c}'} for c in cols]
        q = {'version': '1.0.0', 'queries': [{'Query': {'Commands': [{'SemanticQueryDataShapeCommand': {
            'Query': {'Version': 2, 'From': [{'Name': 'b', 'Entity': entity, 'Type': 0}], 'Select': sel},
            'Binding': {'Primary': {'Groupings': [{'Projections': list(range(len(cols)))}]},
                        'DataReduction': {'DataVolume': 3, 'Primary': {'Window': {'Count': 30000}}}, 'Version': 1},
            'ExecutionMetricsKind': 1}}]}, 'QueryId': '', 'ApplicationContext': {'DatasetId': '', 'Sources': [{'ReportId': '', 'VisualId': ''}]}}],
            'cancelQueries': [], 'modelId': model}
        r = requests.post(f'{PBI_API}/querydata?synchronous=true', data=json.dumps(q).encode(), headers=_pbi_headers(), timeout=180)
        r.raise_for_status()
        raw = r.content
        try:
            raw = gzip.decompress(raw)
        except OSError:
            pass
        d = json.loads(raw)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(json.dumps(d).encode())
    ds = d['results'][0]['result']['data']['dsr']['DS'][0]
    vd = ds.get('ValueDicts', {})
    rows = list(ds['PH'][0].values())[0]
    sch, prev, out = None, None, []
    for r in rows:
        if 'S' in r:
            sch = r['S']
        c, rep, nul = r.get('C', []), r.get('R', 0), r.get('Ø', 0)
        vals, ci = [], 0
        for i, s in enumerate(sch):
            if nul & (1 << i):
                vals.append(None)
                continue
            if rep & (1 << i):
                vals.append(prev[i])
                continue
            v = c[ci]
            ci += 1
            if 'DN' in s and isinstance(v, int):
                v = vd[s['DN']][v]
            vals.append(v)
        prev = vals
        out.append(dict(zip(cols, vals)))
    if not ds.get('IC', True):
        print(f'    ! Power BI devolveu resultado incompleto para {entity} ({len(out)} linhas)')
    return out


# --------------------------------------------------------------------------------------------- parsers


def fnum(x):
    if x is None or x == '':
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip()
    if ',' in s:
        s = s.replace('.', '').replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def fdate(x):
    if x in (None, ''):
        return None
    if isinstance(x, (int, float)) or (isinstance(x, str) and x.isdigit() and len(x) > 9):
        return datetime.datetime.fromtimestamp(int(x) / 1000, datetime.timezone.utc).date().isoformat()
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})', str(x))
    if m:
        return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    m = re.match(r'(\d{4}-\d{2}-\d{2})', str(x))
    return m.group(1) if m else None


def fnota(x):
    v = fnum(x)
    return int(v) if v is not None and 1 <= v <= 5 else None


def sgo_key(x):
    s = str(x or '').strip()
    if s.endswith('.0'):
        s = s[:-2]
    return s.lstrip('0') or None


def kind_of(tipo: str | None, estrutura: str | None) -> str:
    t = (tipo or '').strip()
    if 'madeira' in (estrutura or '').lower() and t in ('Ponte', 'Pontilhão', ''):
        return 'ponte_madeira'
    return KIND.get(t, 'outra')


# --------------------------------------------------------------------------------------------- fetch


def fetch():
    global NOTES
    oaes = oae_sgo()
    model, refresh = pbi_model()
    plan, braulios, pbi_err = [], [], None
    try:
        plan = pbi_query(model, 'PLANILHÃO', PLAN_COLS, cache='proarte/planilhao.json')
        braulios = pbi_query(model, 'BASE BRÁULIOS', BRAULIOS_COLS, cache='proarte/base_braulios.json')
    except Exception as e:  # noqa: BLE001
        pbi_err = str(e)[:200]
        print(f'    ! Power BI PROARTE indisponível: {pbi_err} (segue só com o WFS)')
    print(f'    oae_sgo {len(oaes)} | PLANILHÃO {len(plan)} | BASE BRÁULIOS {len(braulios)} | refresh {refresh}')

    by_sgo = {}
    for r in plan:
        k = sgo_key(r.get('Código (SGO)'))
        if k:
            by_sgo[k] = r
    status = {sgo_key(r.get('Código (SGO)')): r for r in braulios if sgo_key(r.get('Código (SGO)'))}

    def pbi_props(r: dict | None) -> dict:
        if not r:
            return {'nota': None, 'nota_desc': None, 'data_vistoria': None}
        nota = fnota(r.get('Nota Técnica Atual (SGO)'))
        hist = []
        for i in range(1, 5):
            dt, nt = fdate(r.get(f'Data da {i}ª Inspeção')), fnota(r.get(f'Nota Técnica da {i}ª Inspeção'))
            if dt or nt:
                hist.append({'data': dt, 'nota': nt})
        st = status.get(sgo_key(r.get('Código (SGO)'))) or {}
        return {
            'nota': nota, 'nota_desc': NOTA_DESC.get(nota), 'data_vistoria': fdate(r.get('Data da Vistoria (SGO)')),
            'condicao': r.get('Condição da OAE'), 'administracao': r.get('Administração'), 'jurisdicao': r.get('Jurisdição'),
            'municipio': r.get('Município'), 'historico': hist,
            'proarte_status': st.get('Status Geral'), 'proarte_detalhe': st.get('Status Detalhado'),
        }

    feats, seen_sgo = [], set()
    for o in oaes:
        k = sgo_key(o.get('cod_sgo'))
        r = by_sgo.get(k) if k else None
        if k:
            seen_sgo.add(k)
        kind = kind_of(o.get('tipo_obra'), o.get('tipo_estr'))
        feats.append({
            'source_id': o['cod_obra'],
            'geometry': {'type': 'Point', 'coordinates': [round(o['lon'], 6), round(o['lat'], 6)]},
            'name': o.get('descr_obra'),
            'kind': kind,
            'props': {
                'fonte': 'DNITGeo oae_sgo' + (' + PROARTE' if r else ''), 'br': (o.get('br') or '').zfill(3), 'uf': o.get('uf'),
                'km': o.get('km_inicial'), 'cod_snv': o.get('cod_snv'), 'cod_sgo': o.get('cod_sgo'), 'tipo_obra': o.get('tipo_obra'),
                'estrutura': o.get('tipo_estr'), 'extensao_m': o.get('extens_m'), 'largura_m': o.get('largura_m'),
                'rotacao': o.get('rotation'), **pbi_props(r),
            },
        })
    extra = 0
    for k, r in by_sgo.items():
        if k in seen_sgo:
            continue
        lat, lon = fnum(r.get('Latitude')), fnum(r.get('Longitude'))
        if lat is None or lon is None or not (-35 <= lat <= 6 and -75 <= lon <= -28):
            continue
        extra += 1
        rod = (r.get('Rodovia') or '').replace('BR-', '')
        feats.append({
            'source_id': f'sgo:{k}',
            'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]},
            'name': r.get('Identificação da OAE - SGO'),
            'kind': kind_of(r.get('Tipo de Obra'), r.get('Tipo de Estrutura')),
            'props': {
                'fonte': 'PROARTE', 'br': rod.zfill(3) if rod.isdigit() else rod, 'uf': r.get('UF'), 'km': fnum(r.get('km')),
                'cod_snv': r.get('SNV'), 'cod_sgo': r.get('Código (SGO)'), 'tipo_obra': r.get('Tipo de Obra'),
                'estrutura': r.get('Tipo de Estrutura'), 'extensao_m': fnum(r.get('Extensão (m)')), 'largura_m': fnum(r.get('Largura (m)')),
                'rotacao': None, **pbi_props(r),
            },
        })
    com_nota = sum(1 for f in feats if f['props'].get('nota'))
    NOTES = (f'oae_sgo {len(oaes)} + {extra} só no PROARTE; {com_nota} com nota técnica (Power BI, refresh {refresh or "?"}; '
             f'vistorias majoritariamente 2020–2021).' + (f' Power BI falhou: {pbi_err}' if pbi_err else ''))
    print('    ' + NOTES)
    return feats
