#!/usr/bin/env python3
"""Coleta das páginas /restricoes/<slug>/ do penaestrada.com.br (Trucão) para os 1.668 municípios do Sudeste.

Estratégia (a mais barata e completa):
  1. O índice das páginas de restrição vem de duas fontes independentes do próprio site:
     - restricoes-sitemap.xml (Yoast; traz lastmod)
     - o seletor "Selecione um município" renderizado em /restricoes/ (consulta de todas as páginas publicadas)
     As duas são unidas; se divergirem, isso é registrado.
  2. Só as páginas do índice são baixadas (cache em penaestrada_raw/pages/<slug>.html -> retomada gratuita).
  3. Amostra de controle: slugs prováveis de municípios grandes que NÃO estão no índice são sondados
     (sem seguir redirecionamento) para confirmar que o índice é completo (esperado: 404).
  4. Notícias do site (REST /wp-json/wp/v2/posts?search=...) cujo título cita um município do Sudeste
     e palavra de restrição viram pistas secundárias.
Respeito a limite: >= 1,5 s entre pedidos, User-Agent identificado. Somente leitura.
"""
import csv, difflib, html, json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
from datetime import date

BASE = os.path.dirname(os.path.abspath(__file__))
CID = os.path.dirname(BASE)
RAW = os.path.join(BASE, 'penaestrada_raw')
PAGES = os.path.join(RAW, 'pages')
PROBES = os.path.join(RAW, 'probes.json')
NEWS_DIR = os.path.join(RAW, 'news')
OUT = os.path.join(BASE, 'penaestrada.json')
OUT_RESUMO = os.path.join(BASE, 'penaestrada_resumo.md')
UA = 'truck-router-pesquisa/1.0 (levantamento de restricoes de caminhoes; contato arthureggerleuzzi@gmail.com)'
SITE = 'https://penaestrada.com.br'
DELAY = 1.5
HOJE = date.today().isoformat()
os.makedirs(PAGES, exist_ok=True); os.makedirs(NEWS_DIR, exist_ok=True)

_last = [0.0]
def fetch(url, follow=True):
    """GET educado. Retorna (status, body_bytes, location)."""
    wait = DELAY - (time.time() - _last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'pt-BR'})
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect())
    for tent in range(3):
        try:
            _last[0] = time.time()
            with opener.open(req, timeout=60) as r:
                return r.status, r.read(), r.headers.get('Location')
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503, 504) and tent < 2:
                time.sleep(10 * (tent + 1)); continue
            return e.code, e.read() if hasattr(e, 'read') else b'', e.headers.get('Location')
        except Exception as e:
            if tent < 2: time.sleep(5 * (tent + 1)); continue
            return -1, str(e).encode(), None

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[^a-z0-9]+", ' ', s).strip()
    return s

def slugify(s): return norm(s).replace(' ', '-')

def cached(path, url):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return open(path, 'rb').read()
    st, body, _ = fetch(url)
    if st != 200:
        print('ERRO', st, url, file=sys.stderr); return None
    tmp = path + '.tmp'; open(tmp, 'wb').write(body); os.replace(tmp, path)
    return body

def txt(fragment):
    f = re.sub(r'<br\s*/?>', '\n', fragment, flags=re.I)
    f = re.sub(r'</(p|li|div|tr|h\d)>', '\n', f, flags=re.I)
    f = re.sub(r'<li[^>]*>', '- ', f, flags=re.I)
    f = re.sub(r'<[^>]+>', '', f)
    f = html.unescape(f).replace('\xa0', ' ')
    lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in f.split('\n')]
    return '\n'.join(l for l in lines if l)

UF_EST = {'sao-paulo': 'SP', 'rio-de-janeiro': 'RJ', 'minas-gerais': 'MG', 'espirito-santo': 'ES',
          'alagoas': 'AL', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE', 'santa-catarina': 'SC'}

# Grafia errada no site (sem município homônimo). Casamento marcado como incerto.
ALIAS = {'janiru': ('SP', 'Jarinu', 'site grafa "Janiru" (não existe município com esse nome); Jarinu-SP é o mais próximo '
                    '(transposição r/n), mesmo DDD 11 e mesma região dos vizinhos da lista (Atibaia, Jundiaí, Campo Limpo Paulista) — conferir')}

# Notícias do site lidas (título; e corpo via REST quando ambíguo) e ligadas a município. post_id -> ([ibge], nota)
SP_, RIO_ = '3550308', '3304557'
NOTICIAS_CURADAS = {
    104769: ([SP_], 'corpo cita Prefeitura de SP/CET: rodízio municipal (inclui caminhões) suspenso no feriado de 1º/05/2026'),
    103287: ([SP_], 'título: rodízio de carros suspenso, mas segue para caminhões (dez/2025)'),
    100972: ([SP_], 'título: circulação de caminhões no feriado em São Paulo (jul/2025)'),
    100240: ([SP_], 'corpo: nota da CET — ZMRC ampliada desde dez/2024 na Marginal Tietê e mini-anel (seg-sex 4h-10h e 16h-22h; sáb 10h-14h) e produtos perigosos 7h-10h/17h-20h; cita cetsp.com.br'),
    96096:  ([SP_], 'corpo: rodízio municipal de SP para cavalo mecânico/implemento, resposta da CET; cita cetsp.com.br'),
    95301:  ([SP_], 'título: caminhões não liberados do rodízio de placas (mai/2024)'),
    74555:  ([SP_], 'título: rodízio segue para veículos pesados (dez/2021)'),
    65896:  ([SP_], 'título: caminhões fora do novo rodízio (mar/2021)'),
    58713:  ([SP_], 'título: SP libera circulação de caminhões por tempo indeterminado (mar/2020) — corpo não lido; verificar se foi medida temporária'),
    58206:  ([SP_], 'título: restrições para caminhão em dia de enchente (fev/2020)'),
    53966:  ([SP_], 'título: restrições de veículos em SP durante feriado (jul/2019)'),
    51088:  ([SP_], 'corpo: VUCs isentos de rodízio desde dez/2018 por decreto (número não citado)'),
    49870:  ([SP_], 'título: rodízio e restrições suspensos no aniversário de SP (jan/2019)'),
    49609:  ([SP_], 'título: VUC liberado do rodízio (dez/2018)'),
    93776:  ([RIO_], 'corpo: CET-Rio/COR — restrição na Av. Brasil (pista central 4h-22h Irajá-Caju; laterais) ADIADA em mar/2024'),
    93892:  ([RIO_], 'corpo: Av. Brasil LIBERADA para caminhões (restrição revertida, mar/2024)'),
    54116:  (['3500402'], 'corpo: decreto de jul/2019 de Águas da Prata (>5 t, 6h-20h sáb/dom/feriados; Av. Washington Luiz e SP-342); liminar da Justiça (São João da Boa Vista) liberou o trecho da SP-342; cita g1'),
    96757:  (['3548500'], 'título: acesso ao Porto de Santos com agendamento (ago/2024) — não é regra de circulação municipal'),
}
NOTICIAS_EXCLUIDAS = {
    'rodizio_extraordinario_2020_SP': [59790, 59681, 59660, 59656, 59619],  # medida temporária da pandemia; 59656 diz que foi suspensa em 17/05/2020
    'falsos_positivos_por_nome': {92008: 'Rodovia Anchieta', 99913: 'feriado de Tiradentes', 106426: 'rodas de alumínio',
                                  106923: 'feriado de Aparecida', 105964: 'empresa Suzano', 59017: 'Ponte Rio-Niterói (BR-101, federal)'},
}

def parse_page(raw, url):
    s = raw.decode('utf-8', 'replace')
    b = re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', '', s, flags=re.S | re.I)
    d = {'url': url}
    m = re.search(r'<h1 class="entry-title[^"]*">\s*<span>(.*?)</span>', b, re.S)
    d['titulo'] = html.unescape(m.group(1)).strip() if m else None
    m = re.search(r'<article id="(\d+)" class="([^"]*)"', b)
    d['post_id'] = m.group(1) if m else None
    ests = re.findall(r'estados-([a-z-]+)', m.group(2)) if m else []
    d['estado_site'] = ests
    d['uf_site'] = [UF_EST.get(e, e) for e in ests]
    i = b.find('<div id="center">'); j = b.find('</table>', i)
    tabela = b[i:j] if i >= 0 else ''
    campos = {}
    for lab, val in re.findall(r'<td><strong>(.*?)</strong>.*?</td>\s*<td>(.*?)</td>', tabela, re.S):
        campos[html.unescape(lab).strip()] = val
    k = b.find('<div class="td-page-content', j)
    extra = ''
    if k >= 0:
        k2 = b.find('>', k) + 1; k3 = b.find('</div>', k2)
        extra = b[k2:k3]
    textos = {lab: txt(v) for lab, v in campos.items()}
    d['campos'] = textos
    d['texto_extra'] = txt(extra) or None
    allhtml = ''.join(campos.values()) + extra
    links = []
    for href, lt in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', allhtml, re.S):
        links.append({'href': html.unescape(href), 'texto': txt(lt)})
    d['links_citados'] = links
    corpo = '\n'.join(f'{k}: {v}' for k, v in textos.items() if v) + ('\n' + d['texto_extra'] if d['texto_extra'] else '')
    d['texto_completo'] = corpo.strip()
    # Heurísticas (pista; conferir na fonte primária)
    trechos = textos.get('Trechos', '')
    horas_campos = [textos.get(c, '') for c in ('Segunda a Sexta', 'Sábado', 'Domingo e Feriados')]
    nao = bool(re.search(r'n[aã]o (possui|h[aá]|tem|existe)[^.\n]{0,30}restri', trechos + ' ' + (d['texto_extra'] or ''), re.I))
    tem_info = any(h.strip() for h in horas_campos) or (trechos.strip() and not nao)
    d['diz_possui_restricao'] = (False if nao and not any(h.strip() for h in horas_campos) else (True if tem_info else None))
    hs = set()
    for hh, mm_ in re.findall(r'\b(\d{1,2})\s?(?:h|:)\s?(\d{2})?(?![\d])', corpo):
        if int(hh) <= 24: hs.add(f'{int(hh):02d}h{mm_ or ""}')
    d['horarios_citados'] = sorted(hs)
    d['menciona_vuc'] = bool(re.search(r'\bVUC\b|ve[ií]culo urbano de carga', corpo, re.I))
    d['menciona_ato'] = re.findall(r'(?:Lei|Decreto|Portaria|Resolu[cç][aã]o)[^\n.;]{0,60}?n?[º°o.]*\s*[\d.]+(?:/\d{2,4})?', corpo, re.I)
    d['vazia'] = not any(v.strip() for kk, v in textos.items() if kk not in ('Contato', 'Telefone')) and not d['texto_extra']
    return d

def main():
    # 1. municípios
    mun = []
    with open(os.path.join(CID, 'municipios_sudeste.csv'), encoding='utf-8') as f:
        for row in csv.reader(f, delimiter=';'):
            if len(row) >= 3 and row[0].isdigit(): mun.append({'ibge': row[0], 'nome': row[1], 'uf': row[2]})
    print('municipios', len(mun))
    cobertos = set(open(os.path.join(CID, 'ja_cobertos.txt')).read().split()) if os.path.exists(os.path.join(CID, 'ja_cobertos.txt')) else set()
    REPO_MUN = '/Users/arthurleuzzi/Projetos/truck-router/data/raw/municipios'  # leitura apenas
    if os.path.isdir(REPO_MUN):
        cobertos |= {f[:-5] for f in os.listdir(REPO_MUN) if re.fullmatch(r'\d{7}\.json', f)}
    cobertos.add('3550308')  # capital: ZMRC/rodízio/perigosos já no núcleo (GeoSampa/CET; ver api/src/layers/core_legal.layer.ts)

    # 2. índice: sitemap + seletor
    sm = cached(os.path.join(RAW, 'restricoes-sitemap.xml'), SITE + '/restricoes-sitemap.xml').decode()
    idx = {}
    for u in re.findall(r'<url>(.*?)</url>', sm, re.S):
        loc = re.search(r'<loc>(.*?)</loc>', u).group(1)
        lm = re.search(r'<lastmod>(.*?)</lastmod>', u)
        slug = loc.rstrip('/').split('/')[-1]
        idx[slug] = {'url': loc, 'lastmod_sitemap': lm.group(1) if lm else None, 'no_sitemap': True, 'no_seletor': False, 'rotulo_seletor': None}
    arch = cached(os.path.join(RAW, 'restricoes_index.html'), SITE + '/restricoes/').decode('utf-8', 'replace')
    for href, lab in re.findall(r'<option value="(https://penaestrada\.com\.br/restricoes/[^"]+)">(.*?)</option>', arch):
        slug = href.rstrip('/').split('/')[-1]
        e = idx.setdefault(slug, {'url': href, 'lastmod_sitemap': None, 'no_sitemap': False, 'no_seletor': False, 'rotulo_seletor': None})
        e['no_seletor'] = True; e['rotulo_seletor'] = html.unescape(lab).strip()
    print('indice', len(idx), 'so_sitemap', sum(1 for e in idx.values() if not e['no_seletor']), 'so_seletor', sum(1 for e in idx.values() if not e['no_sitemap']))

    # 3. baixar páginas do índice (todas; são poucas) e parsear
    paginas = {}
    for slug, e in sorted(idx.items()):
        raw = cached(os.path.join(PAGES, slug + '.html'), e['url'])
        if raw is None:
            paginas[slug] = {**e, 'erro_download': True}; continue
        p = parse_page(raw, e['url']); p.update(e); p['slug'] = slug
        paginas[slug] = p
    json.dump(paginas, open(os.path.join(RAW, 'paginas_parseadas.json'), 'w'), ensure_ascii=False, indent=1)

    # 4. casar página -> município (UF do site + nome)
    by_uf_norm = {}
    for m in mun: by_uf_norm.setdefault(m['uf'], {})[norm(m['nome'])] = m
    match = {}  # ibge -> (slug, metodo)
    fora = []
    for slug, p in paginas.items():
        ufs = [u for u in p.get('uf_site', []) if u in by_uf_norm] or (['SP', 'RJ', 'MG', 'ES'] if not p.get('uf_site') else [])
        if not ufs: fora.append(slug); continue
        cand = None; met = None
        for nm, how in ((p.get('rotulo_seletor'), 'nome_seletor'), (p.get('titulo'), 'titulo_h1'), (slug.replace('-', ' '), 'slug')):
            if not nm: continue
            for uf in ufs:
                mm = by_uf_norm[uf].get(norm(nm))
                if mm: cand, met = mm, how; break
            if cand: break
        incerto = None
        if not cand and slug in ALIAS:
            uf, nome_ok, nota = ALIAS[slug]
            cand, met, incerto = by_uf_norm[uf][norm(nome_ok)], f'alias_manual({nome_ok})', nota
        if not cand:
            for uf in ufs:
                close = difflib.get_close_matches(norm(p.get('titulo') or slug), list(by_uf_norm[uf]), n=1, cutoff=0.8)
                if close:
                    cand, met = by_uf_norm[uf][close[0]], f'aproximado({close[0]})'
                    if close[0] not in norm(p.get('texto_completo') or ''):
                        incerto = 'nome aproximado e o texto da página não cita o nome oficial'
                    break
        if cand:
            if cand['ibge'] in match: print('AVISO: duas paginas p/ mesmo municipio', cand, slug, match[cand['ibge']])
            match[cand['ibge']] = (slug, met, incerto)
        else:
            fora.append(slug)
    print('casadas', len(match), 'fora_do_sudeste_ou_sem_par', fora)

    # 5. amostra de controle (slugs prováveis fora do índice) — confirma que o índice é completo
    probes = json.load(open(PROBES)) if os.path.exists(PROBES) else {}
    controle = ['3509502', '3548500', '3552205', '3543402', '3547809', '3549904', '3518800', '3534401',
                '3106200', '3118601', '3170206', '3136702', '3143302', '3170107',
                '3205309', '3205002', '3205200', '3201209',
                '3303302', '3304904', '3301702', '3303500', '3302403', '3306305',
                '3550308', '3304557']  # os dois últimos existem -> controle positivo
    mm_by = {m['ibge']: m for m in mun}
    for ib in controle:
        if ib not in mm_by or ib in probes: continue
        slug = slugify(mm_by[ib]['nome'])
        st, _, loc = fetch(f'{SITE}/restricoes/{slug}/', follow=False)
        probes[ib] = {'slug': slug, 'status': st, 'location': loc, 'data': HOJE}
        json.dump(probes, open(PROBES, 'w'), ensure_ascii=False, indent=1)
    print('probes', {k: (v['slug'], v['status']) for k, v in probes.items()})

    # 6. notícias (pistas secundárias)
    termos = ['restrição caminhões', 'proibição caminhões', 'circulação de caminhões', 'rodízio caminhões',
              'zona de restrição', 'VUC', 'horário de carga e descarga', 'caminhões proibidos']
    posts = {}
    for t in termos:
        fn = os.path.join(NEWS_DIR, slugify(t) + '.json')
        if not os.path.exists(fn):
            url = f'{SITE}/wp-json/wp/v2/posts?' + urllib.parse.urlencode({'search': t, 'per_page': 100, '_fields': 'id,date,modified,link,title'})
            st, body, _ = fetch(url)
            if st == 200: open(fn, 'wb').write(body)
            else: print('ERRO noticias', st, t); continue
        for x in json.load(open(fn)):
            posts[x['id']] = {'data': x['date'][:10], 'link': x['link'], 'titulo': html.unescape(re.sub('<[^>]+>', '', x['title']['rendered'])).strip()}
    # Casamento automático por nome no título deu falsos positivos (feriado de Tiradentes/Aparecida,
    # Rodovia Anchieta, empresa Suzano, "rodas de alumínio", Ponte Rio-Niterói federal). Por isso o
    # vínculo notícia->município é CURADO à mão (títulos lidos; posts ambíguos lidos pelo REST).
    noticias = {}
    faltando = []
    for pid, (ibs, nota) in NOTICIAS_CURADAS.items():
        x = posts.get(pid)
        if x is None:
            fn = os.path.join(NEWS_DIR, f'post_{pid}.json')
            if os.path.exists(fn):
                y = json.load(open(fn))
                x = {'data': y['date'][:10], 'link': y['link'], 'titulo': html.unescape(re.sub('<[^>]+>', '', y['title']['rendered'])).strip()}
        if x is None: faltando.append(pid); continue
        for ib in ibs: noticias.setdefault(ib, []).append({**x, 'post_id': pid, 'nota': nota})
    if faltando: print('AVISO noticias curadas ausentes do cache', faltando)
    for v in noticias.values(): v.sort(key=lambda z: z['data'], reverse=True)
    ambiguos = set()

    # 7. saída por município
    out = {}
    for m in mun:
        ib = m['ibge']
        rec = {'nome': m['nome'], 'uf': m['uf'], 'fonte': 'penaestrada.com.br (Trucão) — compilação de terceiros, só PISTA',
               'consultado_em': HOJE, 'ja_coberto_no_repo': ib in cobertos}
        if ib in match:
            slug, met, incerto = match[ib]; p = paginas[slug]
            rec.update({'existe_pagina': True, 'url': p['url'], 'slug': slug, 'metodo_casamento': met,
                        'casamento_incerto': incerto,
                        'titulo_pagina': p.get('titulo'), 'uf_site': p.get('uf_site'),
                        'data_modificacao_sitemap': p.get('lastmod_sitemap'),
                        'diz_possui_restricao': p.get('diz_possui_restricao'),
                        'pagina_vazia': p.get('vazia'),
                        'campos': p.get('campos'), 'texto_extra': p.get('texto_extra'),
                        'texto_completo': p.get('texto_completo'),
                        'horarios_citados': p.get('horarios_citados'), 'menciona_vuc': p.get('menciona_vuc'),
                        'atos_citados_texto': p.get('menciona_ato'), 'links_citados': p.get('links_citados')})
        else:
            slug = slugify(m['nome'])
            rec.update({'existe_pagina': False, 'slug_provavel': slug,
                        'motivo': 'ausente do restricoes-sitemap.xml e do seletor de municípios de /restricoes/ (índice completo do site, %d páginas, consultado em %s)' % (len(idx), HOJE)})
            if ib in probes: rec['sondagem_controle'] = probes[ib]
        if ib in noticias:
            rec['noticias_relacionadas'] = noticias[ib]
            if norm(m['nome']) in ambiguos: rec['noticias_aviso'] = 'nome coincide com o estado; a notícia pode tratar do estado/rodovias, não do município'
        out[ib] = rec
    meta = {'_meta': {'gerado_em': HOJE, 'site': SITE, 'indice_total_paginas': len(idx),
                      'indice_fontes': ['restricoes-sitemap.xml', 'seletor de municípios em /restricoes/'],
                      'paginas_fora_do_sudeste': fora, 'sondagens_controle': probes, 'noticias_excluidas': NOTICIAS_EXCLUIDAS,
                      'aviso': 'Compilação de terceiros (Trucão/Pé na Estrada), páginas de 2018-2019. Serve só como PISTA; regra ativa exige ato primário vigente.'}}
    tmp = OUT + '.tmp'
    json.dump({**meta, **out}, open(tmp, 'w'), ensure_ascii=False, indent=1); os.replace(tmp, OUT)
    print('gravado', OUT, len(out))

if __name__ == '__main__':
    main()


def escrever_resumo():
    d = json.load(open(OUT)); meta = d.pop('_meta')
    com = {k: v for k, v in d.items() if v.get('existe_pagina')}
    por_uf = {}
    for v in com.values(): por_uf[v['uf']] = por_uf.get(v['uf'], 0) + 1
    sim = [k for k, v in com.items() if v['diz_possui_restricao'] is True]
    nao = [k for k, v in com.items() if v['diz_possui_restricao'] is False]
    datas = sorted(v['data_modificacao_sitemap'][:10] for v in com.values() if v.get('data_modificacao_sitemap'))
    generico = [k for k in nao if com[k]['campos'].get('Contato', '') in ('Detran', 'Ciretran', 'Não informado')]
    L = []
    A = L.append
    A('# penaestrada.com.br — páginas de restrição de caminhões (Sudeste)')
    A('')
    A(f'Gerado em {meta["gerado_em"]} por `penaestrada_coleta.py` (mesma pasta). Dados: `penaestrada.json` ({{ibge: {{...}}}}, 1.668 municípios + `_meta`).')
    A('Compilação de terceiros (Trucão / Pé na Estrada). Serve **só como pista**; regra ativa exige ato primário vigente.')
    A('')
    A('## Como foi feito')
    A(f'- Índice completo do site: `restricoes-sitemap.xml` e o seletor "Selecione um município" de /restricoes/ trazem as mesmas {meta["indice_total_paginas"]} páginas (nenhuma divergência). Não há API REST para esse tipo de página.')
    A('- Baixadas só as páginas do índice (1,5 s entre pedidos, User-Agent identificado); HTML guardado em `penaestrada_raw/pages/` (rodar o script de novo reaproveita o cache).')
    A('- Controle: 24 slugs prováveis de cidades grandes fora do índice (Campinas, Santos, BH, Vitória, Niterói...) deram 404; os controles positivos (São Paulo, Rio, Guarulhos) deram 200. Não vale sondar os 1.668 slugs.')
    A('- Notícias do site (REST `wp/v2/posts?search=`, 8 buscas) ligadas a município **à mão** (o casamento automático por nome no título dava falso positivo).')
    A('')
    A('## Números')
    A(f'- Municípios do Sudeste com página: **{len(com)}** ({", ".join(f"{u} {n}" for u, n in sorted(por_uf.items()))}); MG e ES: nenhuma. Os outros {len(d) - len(com)} têm `existe_pagina: false`.')
    A(f'- Fora do Sudeste no índice: {", ".join(meta["paginas_fora_do_sudeste"])}.')
    A(f'- A página diz que **há restrição**: {len(sim)}; diz **"Não possui restrições"**: {len(nao)}.')
    A(f'- Datas (lastmod do sitemap): de {datas[0]} a {datas[-1]}. São dados de 2018-2019, sem atualização desde então.')
    A('- Nenhuma página cita lei, decreto, portaria nem link de fonte: os campos são Contato, Telefone, Tipo de Caminhão, horários (seg-sex, sáb, dom/feriados), "Tem Cartão Caminhão?" e Trechos.')
    A(f'- {len(generico)} das páginas "não possui" têm contato genérico (Detran/Ciretran/não informado; várias com o telefone geral do Detran-SP (11) 3322-3333): ausência fraca, não prova que não há regra.')
    A('- Casamento incerto: `janiru` (site) ligado a Jarinu (3525201). `agua-da-prata` ligado a Águas da Prata (3500402); o contato da página cita "Prefeitura de Águas da Prata".')
    A('')
    A('## Páginas que dizem haver restrição')
    A('| IBGE | Município | Seg-Sex | Sáb | Dom/Fer | Tipo | Trechos (início) | Data | Já no repo |')
    A('|---|---|---|---|---|---|---|---|---|')
    def cel(s, n=60):
        s = (s or '').replace('\n', '; ').replace('|', '/')
        return s if len(s) <= n else s[:n - 1] + '…'
    for k in sorted(sim, key=lambda k: com[k]['nome']):
        v = com[k]; c = v['campos']
        A(f"| {k} | {v['nome']} | {cel(c.get('Segunda a Sexta'), 25)} | {cel(c.get('Sábado'), 18)} | {cel(c.get('Domingo e Feriados'), 18)} | {cel(c.get('Tipo de Caminhão'), 35)} | {cel(c.get('Trechos'), 70)} | {v['data_modificacao_sitemap'][:10]} | {'sim' if v['ja_coberto_no_repo'] else 'não'} |")
    A('')
    A('## Páginas que dizem "Não possui restrições"')
    A(', '.join(f"{com[k]['nome']} ({k}{', contato genérico' if k in generico else ''})" for k in sorted(nao, key=lambda k: com[k]['nome'])) + '.')
    A('')
    A('## Notícias do site ligadas a município (pistas secundárias)')
    for k, v in sorted(d.items(), key=lambda kv: kv[1]['nome']):
        for n in v.get('noticias_relacionadas', []):
            A(f"- {v['nome']} ({k}), {n['data']}: [{n['titulo']}]({n['link']}). {n['nota']}")
    A('')
    A('## Limitações')
    A('- Dados de terceiros e de 2018-2019; horários e vias podem ter mudado (ex.: SP ampliou a ZMRC da Marginal Tietê em dez/2024, segundo nota da CET reproduzida no site).')
    A('- `diz_possui_restricao`, `horarios_citados`, `menciona_vuc` e `atos_citados_texto` saem de heurística sobre o texto; o texto literal está em `campos` e `texto_completo`.')
    A('- `ja_coberto_no_repo` = `cidades/ja_cobertos.txt` + arquivos `data/raw/municipios/<ibge>.json` do repo no momento da coleta + São Paulo (ZMRC no núcleo).')
    open(OUT_RESUMO, 'w').write('\n'.join(L) + '\n')
    print('resumo', OUT_RESUMO)

if __name__ == '__main__' and os.environ.get('SO_RESUMO') != '0':
    escrever_resumo()
