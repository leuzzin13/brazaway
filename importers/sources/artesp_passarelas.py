"""Passarelas das rodovias estaduais concedidas de SP (ARTESP, Cadastro de Ativos) — com ALTURA.

Única base aberta de OAE em SP com um campo de altura. A ARTESP não publica dicionário de dados; tratamos ALTURA como
a altura livre sob a passarela (o menor valor observado, 5,38 m, é coerente com a instrução de projeto IP.DIN/010 da
ARTESP, que pede 5,5 m em obras novas).

Formatos do campo ALTURA na planilha (XLSX de 05/08/2026, 444 linhas):
  - número ('6.16', '2,40'): uma altura só;
  - texto por pista, nas 32 linhas sem RA e com TIPO_PISTA = 'Transversal' (SP-075, SP-250, SP-264, SP-270, SP-280),
    ex.: 'Pista Norte: 5,48m; Pista Sul: 5,43m.' ou '6,37m - Pista Leste; ...; 6,53m - Marginal Leste e 6,58m - Marginal
    Oeste.' → guardamos a lista em `altura_por_pista` e usamos a MENOR altura das vias rodoviárias (linha férrea fora);
  - '-' (2 linhas): sem altura.

Altura < ALTURA_SUSPEITA_M (5,0 m) é marcada `altura_suspeita` e NÃO bloqueia (vira aviso para conferir). Hoje isso
pega só 2 registros de 2,40 m na SP-330 km 62 (Jundiaí), iguais à LARGURA: erro de digitação evidente numa rodovia
onde caminhões de 4,40 m passam todo dia. O limiar fica acima de 4,40 m + folga para que um erro de digitação futuro
(ex.: 4,20 no lugar de 6,20) não vire bloqueio duro para toda carreta numa rodovia concedida.

RA repetido: o RA 010113000276 aparece em 3 linhas no mesmo ponto (3 passarelas da SP-330 km 62, OBS cita "PASSARELA 1
- EIXO 1400 NORTE E PASSARELA 3 - EIXO 1700 SUL"). Cada linha vira uma feição (source_id RA, RA-2, RA-3).
Passarelas DEMOLIDA são descartadas; DESATIVADA (2) são mantidas por segurança (a estrutura pode continuar lá).

Ponto de bloqueio: o ponto da ARTESP nem sempre está sobre a rodovia (nas linhas 'Transversal' chega a 54 m dela, na
ponta da passarela, às vezes sobre uma rua local). Por isso, com o /locate do Valhalla, o importador procura as
arestas que têm o código da rodovia no nome (SP-270 etc., sem alças) a até BUSCA_M do ponto e põe um círculo pequeno
(RAIO_PISTA_M) no ponto mais próximo de cada pista. Se nenhuma aresta da rodovia for achada (nome diferente no OSM,
trecho urbano), fica o ponto original com raio 35 m (DUPLA/Transversal) ou 20 m (SIMPLES). `bloqueio.ajuste` registra
o que foi feito ('pistas_rodovia' | 'ponto_original' | 'sem_valhalla').

A API (oae.layer.ts) bloqueia a passarela para veículos com altura >= altura_livre_m - 0,10 m (folga).
"""
import io
import re

from common import http_get
from sources._oae_locate import dist_m, locate, nome_tem_ref, norm, ref_key

LAYER_ID = 'oae'
SOURCE = 'artesp'
SOURCE_URL = ('https://dadosabertos.artesp.sp.gov.br/dataset/491d79c5-ee09-4fe8-a3ce-1b425fe60bbe/resource/'
              'd864ec43-a93b-4803-9b48-1fee98a98fe7/download/passarelas.xlsx')
LICENSE = 'CC-BY — ARTESP (dadosabertos.artesp.sp.gov.br, Cadastro de Ativos: passarelas)'
NOTES = ('Campo ALTURA sem dicionário oficial: tratado como altura livre; texto por pista usa a menor altura rodoviária. '
         'Altura < 5,0 m marcada como suspeita (não bloqueia). DEMOLIDA descartadas; DESATIVADA mantidas. '
         'Ponto de bloqueio levado às pistas da rodovia pelo /locate do Valhalla. '
         'Pontes e viadutos da malha concedida não são publicados pela ARTESP.')

ALTURA_SUSPEITA_M = 5.0      # abaixo disso, numa rodovia concedida aberta a carretas de 4,40 m, tratamos como erro de cadastro
RAIO_FALLBACK_M = {'DUPLA': 35, 'TRANSVERSAL': 35}   # sem ajuste: cobre as duas pistas perto do ponto
RAIO_FALLBACK_PADRAO_M = 20
BUSCA_M = {'TRANSVERSAL': 100}   # linhas 'Transversal': ponto na ponta de passarelas de 90-300 m
BUSCA_PADRAO_M = 60
FAIXA_M = 60                 # pistas a até (distância da pista mais próxima + FAIXA_M) do ponto
RAIO_PISTA_M = 8             # círculo em cada pista (o ponto está SOBRE a aresta; 8 m de tolerância para edição do OSM)
AGRUPAR_PISTA_M = 3          # mesmo ponto (os dois sentidos de uma via de mão dupla); pistas do canteiro ficam a 8+ m
SP_BBOX = (-53.2, -25.4, -44.1, -19.7)
_FERREA = re.compile(r'f[eé]rre', re.I)


def _num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(',', '.')
    if not s or s.upper() in ('NÃO INFORMADO', 'NAO INFORMADO', '-', 'NULL'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def alturas(v):
    """Campo ALTURA -> (menor altura das vias rodoviárias em m | None, [{'pista', 'altura_m'}] | None).

    >>> alturas('Pista Norte: 5,48m; Pista Sul: 5,43m.')[0]
    5.43
    >>> alturas('Pista Leste: 6,39m; Pista Oeste: 6,17m; Linha Férrea 1: 7,09m; Linha Férrea 2: 7,25m.')[0]
    6.17
    """
    n = _num(v)
    if n is not None or v is None or isinstance(v, (int, float)):
        return n, None
    s = str(v).strip()
    lista = []
    for parte in re.split(r';|\s+e\s+', s):
        m = re.search(r'\d+[.,]\d+', parte) or re.search(r'\b\d+\b', parte)
        if not m:
            continue
        val = float(m.group(0).replace(',', '.'))
        if not (0 < val < 30):
            continue
        pista = re.sub(r'\s+', ' ', re.sub(r'[:\-–.]|\bm\b', ' ', parte[:m.start()] + ' ' + re.sub(r'^\s*m\b', '', parte[m.end():]))).strip()
        lista.append({'pista': pista or None, 'altura_m': val})
    rod = [x['altura_m'] for x in lista if not _FERREA.search(x['pista'] or '')]
    return (min(rod) if rod else None), (lista or None)


def _km(v):
    """'063+000' -> 63.0 ; '012+164' -> 12.164"""
    if v is None:
        return None
    s = str(v).strip()
    m = re.match(r'^(\d+)\+(\d+)$', s)
    if m:
        return int(m.group(1)) + int(m.group(2)) / 1000
    return _num(s)


def _rodovia(v):
    s = (v or '').strip().upper().replace(' ', '').replace('-', '')
    m = re.match(r'^(SPI|SPA|SPM|SP)(\d+)(.*)$', s)
    return f'{m.group(1)}-{m.group(2)}{m.group(3)}' if m else (v or '').strip()


def _txt(v):
    s = ('' if v is None else str(v)).strip()
    return s or None


def pistas_sob(edges: list[dict], rodovia: str, busca_m: float) -> list[dict]:
    """Pontos (um por pista) da rodovia sob a passarela, a partir das arestas do /locate perto do ponto da ARTESP.

    Só arestas que não são alça nem túnel e têm o código da rodovia no nome, ou um nome que as arestas com o código
    também têm (no OSM às vezes só uma das pistas leva o `ref`: 'SP-330; Rodovia X' de um lado e 'Rodovia X' do outro).
    O ponto mais próximo de cada aresta é o pé da perpendicular (sob a passarela) quando cai no meio da aresta; quando cai
    na ponta (pct 0/1) a pista continua em outra aresta e o ponto é descartado, a não ser que seja o mais próximo de todos.
    """
    base = [e for e in edges if e['dist'] <= busca_m and not e['link'] and not e['tunnel'] and e['use'] in (None, 'road')]
    com_ref = [e for e in base if any(nome_tem_ref(n, rodovia) for n in e['names'])]
    if not com_ref:
        return []
    apelidos = {norm(n) for e in com_ref for n in e['names'] if len(n) >= 8 and not nome_tem_ref(n, rodovia)}
    cand = [e for e in base if e in com_ref or any(norm(n) in apelidos for n in e['names'])]
    dmin = cand[0]['dist']
    out: list[dict] = []
    for e in cand:
        if e['dist'] > dmin + FAIXA_M:
            break
        ponta = e['pct'] is not None and (e['pct'] <= 0.005 or e['pct'] >= 0.995)
        if ponta and e['dist'] > dmin + 2:
            continue
        p = (round(e['lon'], 6), round(e['lat'], 6))
        if any(dist_m(p, (q['lon'], q['lat'])) < AGRUPAR_PISTA_M for q in out):
            continue
        out.append({'lon': p[0], 'lat': p[1], 'dist': round(e['dist'], 1), 'via': e['names'][0] if e['names'] else None})
    return out


def fetch():
    import openpyxl
    raw = http_get(SOURCE_URL, cache='artesp_passarelas.xlsx', max_age_h=24 * 30)
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = [str(h).strip().upper() if h is not None else '' for h in next(rows)]
    out = []
    vistos: dict[str, int] = {}
    for r in rows:
        p = dict(zip(header, r))
        status = (_txt(p.get('STATUS')) or '').upper()
        if status == 'DEMOLIDA':
            continue
        lat, lon = _num(p.get('LAT')), _num(p.get('LONG'))
        if lat is None or lon is None:
            continue
        if not (SP_BBOX[0] <= lon <= SP_BBOX[2] and SP_BBOX[1] <= lat <= SP_BBOX[3]):
            continue
        altura, por_pista = alturas(p.get('ALTURA'))
        if altura is not None and altura <= 0:
            altura = None
        suspeita = altura is not None and altura < ALTURA_SUSPEITA_M
        rod, km = _rodovia(p.get('RODOVIA')), _km(p.get('KM'))
        nome = _txt(p.get('NOME_PASSARELA'))
        if nome and nome.upper() in ('SEM DENOMINAÇÃO', 'SEM DENOMINACAO', 'NÃO INFORMADO', 'PASSARELA'):
            nome = None
        km_txt = f'{km:.3f}'.rstrip('0').rstrip('.').replace('.', ',') if km is not None else '?'
        label = f'Passarela {rod} km {km_txt}' + (f' ({nome.title()})' if nome else '')
        base_id = _txt(p.get('RA')) or f'{rod}-{km}'
        vistos[base_id] = vistos.get(base_id, 0) + 1
        sid = base_id if vistos[base_id] == 1 else f'{base_id}-{vistos[base_id]}'
        tipo_pista = _txt(p.get('TIPO_PISTA'))
        tp = (tipo_pista or '').upper()
        ponto = [round(lon, 6), round(lat, 6)]
        out.append({
            'source_id': sid,
            'geometry': {'type': 'Point', 'coordinates': ponto},
            'name': label,
            'kind': 'passarela',
            'props': {
                'admin': 'estadual concedida (ARTESP)',
                'concessionaria': _txt(p.get('CONCESSIONARIA')), 'ra': _txt(p.get('RA')),
                'rodovia': rod, 'km': km, 'tipo_pista': tipo_pista,
                'municipio': _txt(p.get('MUNICIPIO')), 'status': status or None,
                'estrutura': _txt(p.get('ESTRUTURA')),
                'largura_m': _num(p.get('LARGURA')), 'comprimento_m': _num(p.get('COMPRIMENTO')),
                'obs': _txt(p.get('OBS')),
                # altura livre sob a passarela (m): a API usa para bloquear veículos altos
                'altura_livre_m': None if suspeita else altura,
                'altura_informada_m': altura,
                'altura_por_pista': por_pista,
                'altura_suspeita': suspeita,
                'altura_fonte': 'ARTESP (campo ALTURA, sem dicionário oficial)',
                'peso_max_t': None,
                # como bloquear: círculos pequenos nas pistas SOB a passarela (preenchido abaixo)
                'bloqueio': {'modo': 'sob', 'pontos': [ponto], 'raio_m': RAIO_FALLBACK_M.get(tp, RAIO_FALLBACK_PADRAO_M),
                             'ajuste': 'sem_valhalla'},
                '_busca_m': BUSCA_M.get(tp, BUSCA_PADRAO_M),
            },
        })

    # ajuste do ponto de bloqueio para as pistas da rodovia (Valhalla /locate)
    res = locate([tuple(f['geometry']['coordinates']) for f in out], max(BUSCA_M.values()))
    n_aj = n_orig = 0
    for i, f in enumerate(out):
        pr = f['props']
        busca = pr.pop('_busca_m')
        if res is None:
            continue
        pistas = pistas_sob(res[i], pr['rodovia'], busca)
        if pistas:
            pr['bloqueio'] = {'modo': 'sob', 'pontos': [[q['lon'], q['lat']] for q in pistas], 'raio_m': RAIO_PISTA_M,
                              'ajuste': 'pistas_rodovia', 'distancias_m': [q['dist'] for q in pistas]}
            n_aj += 1
        else:
            pr['bloqueio']['ajuste'] = 'ponto_original'
            n_orig += 1
    # mesma passarela cadastrada duas vezes (linhas 'Transversal' x linha com RA): marca, não junta
    for f in out:
        if (f['props']['tipo_pista'] or '').upper() != 'TRANSVERSAL':
            continue
        c = f['geometry']['coordinates']
        for g in out:
            if g is f or (g['props']['tipo_pista'] or '').upper() == 'TRANSVERSAL':
                continue
            if ref_key(g['props']['rodovia']) == ref_key(f['props']['rodovia']) and dist_m(tuple(c), tuple(g['geometry']['coordinates'])) <= 100:
                f['props']['provavel_mesma_que'] = g['source_id']
                break
    n_alt = sum(1 for f in out if f['props']['altura_informada_m'] is not None)
    n_susp = sum(1 for f in out if f['props']['altura_suspeita'])
    print(f'    {len(out)} passarelas ({sum(1 for f in out if f["props"]["status"] == "ATIVA")} ativas), {n_alt} com altura '
          f'({n_susp} suspeitas); bloqueio nas pistas: {n_aj}, ponto original: {n_orig}'
          + ('' if res is not None else ' — SEM Valhalla: pontos originais'))
    return out
