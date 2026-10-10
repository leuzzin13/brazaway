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
Estrutura da tabela: antes de usar os valores da página, o importador confere se as linhas dela (multiplicador + eixos e
rodagem do texto "eixos") são as mesmas categorias da transcrição. Se a estrutura mudou (ex.: a Rota 116 passar a
cobrar por eixo, como recomenda a Deliberação 1698/2026), NÃO casa valores pelo multiplicador: usa a transcrição, com a
vigência encerrada na véspera da nova data da página (o valor sai estimado), e o NOTES pede a retranscrição.
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


class EstruturaMudou(ValueError):
    """A tabela da página não tem as mesmas categorias da transcrição: não dá para casar os valores pelo multiplicador."""
    def __init__(self, problemas: list[str]):
        super().__init__('estrutura tarifária mudou na página; retranscrever: ' + '; '.join(problemas))
        self.problemas = problemas


def _eixos(txt: str) -> frozenset[int]:
    """'2,3 e 4 eixos rodas simples' -> {2, 3, 4}; '7 eixos 7D' -> {7} (só os números antes de 'eixo')."""
    head = re.split(r'eixo', txt or '', maxsplit=1, flags=re.I)[0]
    return frozenset(int(x) for x in re.findall(r'\d+', head))


def _rodagem(txt: str) -> str | None:
    t = (txt or '').lower()
    return 'dupla' if 'dupla' in t else 'simples' if 'simples' in t else None


def structure_problems(conc: dict, page: dict) -> list[str]:
    """Compara as linhas da página com as categorias da transcrição: mesmo multiplicador, mesmos eixos e (quando os dois
    dizem) mesma rodagem. Categoria marcada `fora_da_pagina` (8 eixos da Rota 116, só no PDF da concessionária) não é
    cobrada da página. Devolve a lista de diferenças (vazia = mesma estrutura)."""
    rows = list(page['linhas'])
    livres = list(range(len(rows)))
    probs = []
    for c in conc['tarifa']['categorias']:
        if c.get('fora_da_pagina'):
            continue
        ax = frozenset(range(int(c['eixos']), int(c.get('eixos_ate') or c['eixos']) + 1))
        hit = next((i for i in livres if abs(rows[i]['mult'] - float(c['mult'])) < 1e-9 and _eixos(rows[i]['eixos_txt']) == ax
                    and (c.get('rodagem') is None or _rodagem(rows[i]['eixos_txt']) in (None, c['rodagem']))), None)
        if hit is None:
            probs.append(f"categoria {c.get('cat')} (mult {c['mult']:g}, {'/'.join(map(str, sorted(ax)))} eixos, rodagem {c.get('rodagem')}) não está na página")
        else:
            livres.remove(hit)
    for i in livres:
        probs.append(f"linha nova na página: mult {rows[i]['mult']:g}, '{rows[i]['eixos_txt']}'")
    return probs


def merge_tariff(conc: dict, page: dict) -> tuple[list[dict], float, float | None, list[str]]:
    """Valores da página aplicados às categorias da transcrição (casadas pelo multiplicador, depois de conferir que a
    estrutura é a mesma; senão levanta EstruturaMudou). Categoria que a página não traz (8 eixos da Rota 116) = mult x
    TBP da página. Devolve (categorias, TBP, eixo_adicional, diferenças)."""
    probs = structure_problems(conc, page)
    if probs:
        raise EstruturaMudou(probs)
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


def vencer_na_data_da_pagina(conc: dict, page: dict) -> dict:
    """Transcrição com a vigência encerrada na véspera da data nova publicada na página (se for posterior ao início dela)."""
    conc = dict(conc)
    desde = page.get('desde')
    if desde and desde > (conc.get('vigencia_inicio') or ''):
        fim = (date.fromisoformat(desde) - timedelta(days=1)).isoformat()
        if not conc.get('vigencia_fim') or fim < conc['vigencia_fim']:
            conc['vigencia_fim'] = fim
    return conc


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
        except EstruturaMudou as e:
            # valores da página não casam com as categorias transcritas: fica a transcrição, vencida a partir da nova data
            conc = vencer_na_data_da_pagina(conc, page)
            print(f'  ! {conc["id"]}: {e}; usando a transcrição de 10/10/2026 (vigência até {conc.get("vigencia_fim")})')
            tarifa = base.build_tariff(conc, d, FONTE, url, extra={'estrutura_mudou': e.problemas})
            notes.append(f'{conc["id"]}: {e} (transcrição usada, vigência até {conc.get("vigencia_fim")}; valor estimado depois disso)')
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
