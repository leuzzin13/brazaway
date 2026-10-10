"""Pedágio das rodovias ESTADUAIS concedidas do Rio de Janeiro (AGETRANSP): CCR Via Lagos (RJ-124) e Rota 116 (RJ-116).

Fonte da tarifa: página de cada operadora na AGETRANSP ("Tarifa máxima homologada", tabela HTML com veículo, eixos,
multiplicador e valor; a Via Lagos tem a coluna de sábado, domingo e feriados = TBA), com a data "Cobrança praticada a
partir de" e o link da deliberação que homologou a tarifa (Deliberações AGETRANSP/CD 1630 e 1631, de 29/07/2025, arts. 1º
e 2º). O importador relê a página a cada carga; se ela mudar (novo reajuste), usa os valores novos e registra o ato novo.
Se a leitura falhar, usa a transcrição de data/raw/pedagio/concessoes_estaduais.json (10/10/2026).

Estrutura NÃO linear da Rota 116 (Deliberação 1631/2025 e site da concessionária): rodas simples de 2 a 4 eixos = 1 TBP;
2 eixos rodas duplas = 2; 3 a 6 eixos rodas duplas = 4 (R$ 38,40 para 3, 4, 5 ou 6 eixos); 7 eixos = 7; 8 eixos = 8
(PDF "evolução das tarifas"); 7 ou mais eixos = TBP por eixo (eixo adicional).
Janela da TBA da Via Lagos (sexta 12h a segunda 12h; véspera de feriado nacional 12h ao dia seguinte 12h): ver o JSON.
Posição: nós de pedágio do OSM do mesmo operador (sem coordenada oficial; método registrado em props.posicao_metodo).
"""
from __future__ import annotations
import re
from datetime import date, timedelta
from bs4 import BeautifulSoup
from common import http_get
from sources import _toll_estaduais as base

LAYER_ID = 'pedagio'
SOURCE = 'agetransp'
SOURCE_URL = ('https://www.agetransp.rj.gov.br/operadoras/vialagos + https://www.agetransp.rj.gov.br/operadoras/rota116 '
              '(Deliberações AGETRANSP/CD 1630 e 1631/2025) + data/raw/pedagio/concessoes_estaduais.json (janela da TBA, praças)')
LICENSE = ('Valores de atos oficiais (Deliberações AGETRANSP/CD 1630 e 1631/2025): sem proteção autoral (Lei 9.610/1998, art. 8º, IV); '
           'página da AGETRANSP sem licença declarada. Posição das praças: OpenStreetMap (ODbL 1.0)')
NOTES = ''
FONTE = 'AGETRANSP'


def _num(s: str) -> float | None:
    m = re.search(r'(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d+)?)', s or '')
    return float(m.group(1).replace('.', '').replace(',', '.')) if m else None


def parse_page(html: str) -> dict:
    """Tabela 'Tarifa máxima homologada' da página da operadora: linhas (mult, valor, valor_fds), data e deliberação."""
    soup = BeautifulSoup(html, 'lxml')
    txt = soup.get_text(' ', strip=True)
    table = None
    for t in soup.find_all('table'):
        head = t.get_text(' ', strip=True).upper()
        if 'MULT' in head and 'EIXOS' in head:
            table = t
            break
    rows = []
    if table is not None:
        for tr in table.find_all('tr'):
            tds = [re.sub(r'\s+', ' ', td.get_text(' ')).strip() for td in tr.find_all('td')]
            if len(tds) < 4:
                continue
            mult = _num(tds[2])
            if mult is None:  # isentos
                continue
            rows.append({'veiculo': tds[0], 'eixos_txt': tds[1], 'mult': mult, 'valor': _num(tds[3]), 'valor_fds': _num(tds[4]) if len(tds) > 4 else None})
    m = re.search(r'Cobran[çc]a praticada a partir de (\d{2})/(\d{2})/(\d{4})', txt)
    desde = f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else None
    dm = re.search(r'Delibera[çc][ãa]o N\.?\s*(\d+)\s+de\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})', txt)
    link = None
    for a in soup.find_all('a', href=True):
        if '/deliberacoes/numero/' in a['href']:
            link = a['href']
            break
    return {'linhas': rows, 'desde': desde, 'deliberacao': (dm.group(1), dm.group(2)) if dm else None, 'deliberacao_url': link}


def merge_tariff(conc: dict, page: dict) -> tuple[list[dict], float, float | None, list[str]]:
    """Valores da página aplicados às categorias da transcrição (casadas pelo multiplicador). Categoria que a página não
    traz (8 eixos da Rota 116) = mult x TBP da página. Devolve (categorias, TBP, eixo_adicional, diferenças)."""
    t = conc['tarifa']
    by_mult: dict[float, dict] = {}
    for r in page['linhas']:
        by_mult.setdefault(r['mult'], r)
    tbp = by_mult.get(1.0, {}).get('valor')
    if tbp is None:
        raise ValueError('página sem a linha de multiplicador 1 (TBP)')
    tba = by_mult.get(1.0, {}).get('valor_fds')
    diffs, cats = [], []
    for c in t['categorias']:
        nc = dict(c)
        r = by_mult.get(float(c['mult']))
        if r and r['valor'] is not None:
            nc['valor'] = r['valor']
            if c.get('valor_fds') is not None and r.get('valor_fds') is not None:
                nc['valor_fds'] = r['valor_fds']
        else:
            nc['valor'] = round(c['mult'] * tbp, 2)
            if c.get('valor_fds') is not None and tba is not None:
                nc['valor_fds'] = round(c['mult'] * tba, 2)
        if abs(nc['valor'] - c['valor']) > 0.005 or abs((nc.get('valor_fds') or 0) - (c.get('valor_fds') or 0)) > 0.005:
            diffs.append(f"cat {c.get('cat')}: {c['valor']}/{c.get('valor_fds')} -> {nc['valor']}/{nc.get('valor_fds')}")
        cats.append(nc)
    eixo_ad = tbp if t.get('eixo_adicional') is not None else None
    return cats, tbp, eixo_ad, diffs


def fetch():
    global NOTES
    d, concs = base.concessoes('agetransp')
    nodes = base.osm_toll_nodes()
    out, notes, log = [], [], []
    for conc in concs:
        url = conc['pagina_tarifa']
        conc = dict(conc)
        try:
            html = http_get(url, cache=f'agetransp_{conc["id"]}.html', max_age_h=24 * 3).decode('utf-8', 'replace')
            page = parse_page(html)
            cats, tbp, eixo_ad, diffs = merge_tariff(conc, page)
            if page['desde'] and page['desde'] != conc.get('vigencia_inicio'):
                # novo reajuste publicado: período anual a partir da nova data; ato = deliberação da página
                antes = conc.get('vigencia_inicio')
                ini = date.fromisoformat(page['desde'])
                conc['vigencia_inicio'] = page['desde']
                conc['vigencia_fim'] = (ini.replace(year=ini.year + 1) - timedelta(days=1)).isoformat()
                conc['vigencia_obs'] = f'período anual a partir da data publicada pela AGETRANSP ({page["desde"]})'
                if page['deliberacao']:
                    conc['ato'] = f"Deliberação AGETRANSP/CD nº {page['deliberacao'][0]}, de {page['deliberacao'][1]} (tarifa praticada a partir de {page['desde']})"
                    conc['ato_url'] = page['deliberacao_url'] or conc['ato_url']
                notes.append(f'{conc["id"]}: a página traz nova data de cobrança {page["desde"]} (transcrição: {antes}); confira o ato e a janela')
            tarifa = base.build_tariff(conc, d, FONTE, url, categorias=cats, base=tbp, eixo_adicional=eixo_ad,
                                       extra={'lido_da_pagina': True, 'deliberacao_pagina': page['deliberacao'] and f'Deliberação N. {page["deliberacao"][0]} de {page["deliberacao"][1]}'})
            notes.append(f'{conc["id"]}: tabela lida da AGETRANSP ({len(page["linhas"])} linhas, TBP R$ {f"{tbp:.2f}".replace(".", ",")}, desde {page["desde"]})'
                         + (f'; difere da transcrição: {"; ".join(diffs)}' if diffs else '; igual à transcrição'))
        except Exception as e:  # noqa: BLE001
            print(f'  ! {conc["id"]}: página da AGETRANSP ilegível ({e}); usando a transcrição de 10/10/2026')
            tarifa = base.build_tariff(conc, d, FONTE, url)
            notes.append(f'{conc["id"]}: transcrição (página ilegível: {e})')
        feats = base.features(conc, d, tarifa, nodes, log=log)
        out += feats
        print(f'  {conc["id"]}: {len(feats)} praça(s)')
    for line in log:
        print('  !', line)
    NOTES = ' '.join(notes) + (' Avisos: ' + ' '.join(log) if log else '')
    return out
