#!/usr/bin/env python3
"""legislacao.py — busca de atos normativos municipais nos sistemas de legislação do Sudeste.

Uso rápido:
  python3 legislacao.py buscar <ibge> <termo>[|<termo2>...] [--json] [--max N] [--texto] [--fonte camara|prefeitura] [--principal] [--sem-wp]
  python3 legislacao.py info <ibge>                 # portais conhecidos (leads/portais.json)
  python3 legislacao.py direto <sistema> <base> <termo>   # busca numa instância sem passar pelo IBGE
  python3 legislacao.py sistemas                    # clientes disponíveis e o que cada um cobre
  python3 legislacao.py testar <sistema> [n]        # roda o cliente em n municípios daquele sistema

Saída (texto): uma linha por ato:  TIPO NUM/ANO | data | ementa | url   (+ cabeçalho com sistema/base/total)
Saída (--json): {"ibge":..., "resultados":[{"sistema","base","total","atos":[{tipo,numero,ano,data,ementa,url,situacao}],"erro"}]}

Regras: só leitura (GET/POST de formulário de busca); um pedido por vez por host; timeout duro.
Os termos são buscados como substring na EMENTA (SAPL/SAGL/Siscam/SPL/Instar) — use radicais e variantes
com e sem acento separados por '|', ex.: "caminh|carga e descarga|veículos pesados|veiculos pesados|tráfego|trafego".
"""
import csv, html as H, json, os, re, subprocess, sys, tempfile, time, unicodedata
from urllib.parse import urlencode, quote, urljoin, urlparse

AQUI = os.path.dirname(os.path.abspath(__file__))
CID = os.path.dirname(AQUI)
PORTAIS = os.path.join(CID, 'leads', 'portais.json')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'


# ----------------------------------------------------------------------------- HTTP
class Resp:
    def __init__(self, status, url, body):
        self.status, self.url, self.body = status, url, body

    @property
    def text(self):
        b = self.body
        # UTF-8 estrito primeiro: vários portais declaram iso-8859-1 mas servem UTF-8 (e o inverso quase nunca decodifica)
        try:
            return b.decode('utf-8')
        except UnicodeDecodeError:
            return b.decode('cp1252', 'ignore')

    def json(self):
        return json.loads(self.body.decode('utf-8-sig'))


def http(url, data=None, headers=None, jar=None, timeout=45, metodo=None, tentativas=2):
    """curl -4 (IPv6 de vários .gov.br trava o TLS) com timeout duro no subprocess."""
    args = ['curl', '-4', '-s', '-g', '-L', '--max-redirs', '6', '--compressed', '--connect-timeout', '12',
            '-m', str(timeout), '-A', UA, '-H', 'Accept-Language: pt-BR,pt;q=0.9',
            '-w', '\n__META__%{http_code} %{url_effective}']
    for k, v in (headers or {}).items():
        args += ['-H', f'{k}: {v}']
    if jar:
        args += ['-b', jar, '-c', jar]
    if metodo:
        args += ['-X', metodo]
    if data is not None:
        args += ['--data-binary' if isinstance(data, (bytes, str)) and not isinstance(data, dict) else '--data',
                 data if isinstance(data, (bytes, str)) else urlencode(data)]
    args.append(url)
    ult = None
    for i in range(tentativas):
        try:
            r = subprocess.run(args, capture_output=True, timeout=timeout + 5)
            out = r.stdout
            j = out.rfind(b'\n__META__')
            meta = out[j + 9:].decode('utf-8', 'ignore').split(' ', 1) if j >= 0 else ['0', url]
            ult = Resp(int(meta[0] or 0), meta[1] if len(meta) > 1 else url, out[:j] if j >= 0 else out)
            # Sul/CO: várias câmaras (SoftCam etc.) servem uma página "Bot Verification" a navegadores e a página real ao
            # curl puro. Se isso acontecer, repete UMA vez identificando-se como curl (não é desafio de captcha).
            if ult.status == 200 and b'<title>Bot Verification' in ult.body[:3000] and '-A' in args:
                k = args.index('-A'); args[k + 1] = 'curl/8.5.0'
                continue
            if ult.status and ult.status < 500:
                return ult
        except subprocess.TimeoutExpired:
            ult = Resp(0, url, b'')
        time.sleep(1.5 * (i + 1))
    return ult


def limpa(s):
    s = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', s or '', flags=re.S | re.I)
    return ' '.join(H.unescape(re.sub(r'<[^>]+>', ' ', s)).split())


def sem_acento(s):
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()


def ato(tipo='', numero='', ano='', data='', ementa='', url='', situacao='', **extra):
    d = {'tipo': (tipo or '').strip(), 'numero': str(numero or '').strip(), 'ano': str(ano or '').strip(),
         'data': (data or '').strip(), 'ementa': ' '.join((ementa or '').split()), 'url': url or '',
         'situacao': (situacao or '').strip()}
    d.update({k: v for k, v in extra.items() if v})
    return d


def iso_br(d):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', d or '')
    return f'{m.group(3)}/{m.group(2)}/{m.group(1)}' if m else (d or '')


# ----------------------------------------------------------------------------- clientes
class Erro(Exception):
    pass


def c_sapl(base, termo, maxn=100, texto=False):
    """SAPL 3 (Interlegis, Django) — API REST /api/norma/normajuridica/ (ementa__icontains).
    Se a instância for SAGL/OpenLegis (Zope), delega para c_sagl."""
    base = base.rstrip('/')
    campos = ['ementa__icontains'] + (['indexacao__icontains'] if texto else [])
    atos, total, vistos = [], 0, set()
    for campo in campos:
        pag = 1
        while len(atos) < maxn:
            r = http(f'{base}/api/norma/normajuridica/?' + urlencode({campo: termo, 'page_size': 100, 'page': pag, 'o': '-data'}),
                     headers={'Accept': 'application/json'})
            try:
                d = r.json()
            except Exception:
                if campo == campos[0] and pag == 1:
                    return c_sagl(base, termo, maxn, texto)
                break
            total = max(total, d.get('pagination', {}).get('total_entries', 0))
            for n in d.get('results', []):
                if n['id'] in vistos:
                    continue
                vistos.add(n['id'])
                tit = n.get('__str__', '')
                atos.append(ato(tipo=re.split(r'\s+n[ºo°]', tit)[0], numero=n.get('numero'), ano=n.get('ano'),
                                data=iso_br(n.get('data')), ementa=n.get('ementa'), url=f'{base}/norma/{n["id"]}',
                                titulo=tit, pdf=n.get('texto_integral') or ''))
            if not d.get('pagination', {}).get('next_page'):
                break
            pag += 1
    return {'total': total, 'atos': atos[:maxn]}


def c_sagl(base, termo, maxn=100, texto=False):
    """SAGL / OpenLegis / SAPL 2.5 (Zope): normas_table_json; fallback para o HTML norma_juridica_pesquisar_proc."""
    base = base.rstrip('/')
    p = {'txt_assunto': termo, 'pagina': 1, 'itens_por_pagina': min(maxn, 100)}
    if texto:
        p['chk_textual'] = 1
    r = http(f'{base}/consultas/norma_juridica/normas_table_json?' + urlencode(p), headers={'Accept': 'application/json'}, timeout=90)
    try:
        d = r.json()
        atos = [ato(tipo=n.get('des_tipo_norma'), numero=n.get('num_norma'), ano=n.get('ano_norma'), data=n.get('dat_norma'),
                    ementa=n.get('txt_ementa'), url=n.get('detail_url') or f'{base}/consultas/norma_juridica/norma_juridica_mostrar_proc?cod_norma={n.get("cod_norma")}',
                    situacao=n.get('situacao'), pdf=n.get('url_texto_integral') or '') for n in d.get('data', [])]
        return {'total': d.get('total', len(atos)), 'atos': atos[:maxn]}
    except Exception:
        pass
    # SAPL 2.5 antigo
    p = {'lst_tip_norma': '', 'txt_numero': '', 'txt_ano': '', 'dt_norma': '', 'dt_norma2': '', 'dt_public': '', 'dt_public2': '',
         'lst_assunto_norma': '', 'txt_assunto': termo, 'lst_tip_situacao_norma': '', 'rd_ordenacao': '1', 'incluir': ''}
    if texto:
        p['chk_textual'] = '1'
    for pref in ('', '/sapl'):
        r = http(f'{base}{pref}/consultas/norma_juridica/norma_juridica_pesquisar_proc?' + urlencode(p), timeout=90)
        t = r.text if r and r.status == 200 else ''
        itens = re.findall(r'href="([^"]*norma_juridica_mostrar_proc\?cod_norma=\d+)"[^>]*>(.*?)</a>(.{0,1500})', t, re.S)
        if itens:
            atos, vis = [], set()
            for u, tit, resto in itens:
                if u in vis:
                    continue
                vis.add(u)
                tt = limpa(tit)
                m = re.search(r'(.+?)\s+n[ºo°]?\s*([\d\.]+)[,/ ]+(?:de\s+)?(\d{2}/\d{2}/(\d{4}))?', tt, re.I)
                em = limpa(resto)[:600]
                atos.append(ato(tipo=m.group(1) if m else tt, numero=m.group(2) if m else '', ano=(m.group(4) if m and m.group(4) else ''),
                                data=m.group(3) if m and m.group(3) else '', ementa=em, url=urljoin(base + pref + '/', u), titulo=tt))
            return {'total': len(atos), 'atos': atos[:maxn]}
    raise Erro('SAPL/SAGL sem resposta reconhecível em ' + base)


_SISCAM_GRUPO = {}


def c_siscam(base, termo, maxn=100, texto=False):
    """Sino.Siscam (ASP.NET Core): acha o grupo 'Legislação' no menu e usa o export CSV da pesquisa textual.
    base pode ser https://x.siscam.com.br ou https://camara/Siscam."""
    base = base.rstrip('/')
    g = _SISCAM_GRUPO.get(base)
    if g is None:
        r = http(base + '/')
        t = r.text if r else ''
        if r and 'login.aspx' in (r.url or '').lower():
            raise Erro('Siscam: instância exige login (%s) — não é consulta pública' % r.url)
        grupos = [(gid, limpa(lab)) for gid, lab in re.findall(r'href="[^"]*/Documentos\?grupoId=(\d+)"[^>]*>(.*?)</a>', t, re.S | re.I)]
        def nota(lab):
            if re.fullmatch(r'legisla[çc][ãa]o( municipal)?|leis|normas( jur[ií]dicas)?|leis e decretos', lab.strip(), re.I):
                return 0
            if re.search(r'legisla[çc][ãa]o|\bleis\b|normas', lab, re.I) and not re.search(r'legislativ|departamento', lab, re.I):
                return 1
            return 9
        cand = sorted((nota(lab), gid) for gid, lab in grupos)
        g = cand[0][1] if cand and cand[0][0] < 9 else (grupos[0][0] if grupos else '')
        if not grupos:
            # Siscam antigo: menu /index/<id>/8 com rótulo "Legislação"
            menus = [(mid, limpa(lab)) for mid, lab in re.findall(r'href="/index/(\d+)/8"[^>]*>(.*?)</a>', t, re.S)]
            leg = [mid for mid, lab in menus if re.search(r'legisla[çc]|\bleis\b|normas', lab, re.I)]
            g = 'antigo:' + (leg[0] if leg else '79')
        _SISCAM_GRUPO[base] = g
    if g.startswith('antigo:'):
        return c_siscam_antigo(base, termo, maxn, texto, menu_id=g.split(':')[1])
    p = {'Pesquisa': 'Textual', 'ShowSearch': 'False', 'GrupoId': g, 'ItemsPerPage': 100, 'Ordenacao': 'DataHoraDecrescente',
         'Ementa': termo, 'NoTexto': 'true' if texto else 'false', 'Export': 'Csv'}
    r = http(base + '/Documentos?' + urlencode(p), timeout=90)
    corpo = r.body.decode('utf-8-sig', 'ignore') if r else ''
    if not corpo.startswith('Id,'):
        raise Erro('Siscam: export CSV não veio (status %s)' % (r.status if r else '?'))
    atos = []
    for row in csv.DictReader(corpo.splitlines()):
        atos.append(ato(tipo=row.get('Tipo'), numero=row.get('Numero'), ano=row.get('Ano'), data=(row.get('Data') or '')[:10],
                        ementa=row.get('Ementa'), url=f'{base}/Documentos/Details?id={row.get("Id")}', titulo=row.get('DescricaoCompleta')))
    return {'total': len(atos), 'atos': atos[:maxn], 'grupo': g}


def c_siscam_antigo(base, termo, maxn=100, texto=False, menu_id='79'):
    """Siscam antigo (menu /index/<id>/8 "Legislação"): /Documentos/Pesquisa?Pesquisa=Avancada&id=<id>&Assunto=<termo>.
    Assunto = ementa; texto=True liga 'pesquisa no texto'. Itens em blocos data-list-item (h4 título, Data, Situação, Assunto)."""
    base = base.rstrip('/')
    atos, total = [], None
    for pagina in range(1, 8):
        p = {'Pesquisa': 'Avancada', 'id': menu_id, 'pagina': str(pagina), 'Modulo': '8', 'Documento': '0', 'Numeracao': 'Documento',
             'NumeroInicial': '', 'AnoInicial': '', 'DataInicial': '', 'NumeroFinal': '', 'AnoFinal': '', 'DataFinal': '', 'Situacao': '0',
             'Classificacao': '0', 'TipoAutor': 'Todos', 'AutoriaId': '0', 'Iniciativa': 'Nenhum', 'NoTexto': 'true' if texto else 'false',
             'Assunto': termo, 'Observacoes': ''}
        r = http(base + '/Documentos/Pesquisa?' + urlencode(p), timeout=90)
        t = r.text if r else ''
        if pagina == 1:
            if 'Siscam' not in t and 'siscam' not in t and 'data-list' not in t:
                raise Erro('Siscam: página de pesquisa não reconhecida em ' + base)
            m = re.search(r'(\d+)\s*registro\(s\)', limpa(t))
            total = int(m.group(1)) if m else None
        novos = 0
        for bl in re.split(r'<div class="data-list-item', t)[1:]:
            mh = re.search(r'<h4>\s*<a href="([^"]+)"[^>]*title="([^"]*)"', bl)
            if not mh:
                continue
            tit = H.unescape(mh.group(2))
            u = urljoin(base + '/', mh.group(1))
            if any(a['url'] == u for a in atos):
                continue
            mn = re.search(r'(.+?)\s+N[ºo°]\s*([\d\.]+)(?:/(\d{4}))?', tit)
            dt = re.search(r'Data:</strong>\s*([\d/]+)', bl)
            st = re.search(r'Situa[^<]*</strong>\s*([^<]+)', bl)
            em = re.search(r'Assunto:</strong>\s*(.*?)</p>', bl, re.S)
            ano = (mn.group(3) if mn and mn.group(3) else (dt.group(1)[-4:] if dt else ''))
            atos.append(ato(tipo=mn.group(1) if mn else tit, numero=mn.group(2) if mn else '', ano=ano, data=dt.group(1) if dt else '',
                            ementa=limpa(em.group(1)) if em else '', url=u, situacao=limpa(st.group(1)) if st else '', titulo=tit))
            novos += 1
        if not novos or len(atos) >= maxn or (total is not None and len(atos) >= total):
            break
    return {'total': total if total is not None else len(atos), 'atos': atos[:maxn], 'menu': menu_id}


def c_spl(base, termo, maxn=100, texto=False):
    """SPL (nopapercloud.com.br/.app e legislacaocompilada.com.br — mesmo motor ASP.NET): POST em /legislacao/."""
    base = base.rstrip('/')
    jar = tempfile.mktemp(prefix='spl_')
    try:
        r = http(base + '/legislacao/', jar=jar, timeout=60)
        t = r.text if r else ''
        if r and r.url and r.url.startswith('http'):
            base = _origem(r.url)  # http->https: o POST precisa ir direto à URL final (redirect vira GET)
        f = {m.group(1): H.unescape(m.group(2)) for m in re.finditer(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', t)}
        if 'ctl00$ContentPlaceHolder1$txt_termo' not in t:
            raise Erro('SPL: formulário /legislacao/ não encontrado em ' + base)
        pagina_form = t
        f['ctl00$ContentPlaceHolder1$txt_termo'] = termo
        f['ctl00$ContentPlaceHolder1$btn_buscar'] = 'BUSCAR'
        r = http(base + '/legislacao/', data=f, jar=jar, timeout=90)
        t = r.text if r else ''
        if r and r.status == 403 and 'Just a moment' in t:
            # A busca textual (POST) está atrás de desafio Cloudflare nesta instância: não contornar.
            # Alternativa pública sem desafio: listagem GET por tema, filtrada localmente pelo termo.
            return _spl_por_tema(base, pagina_form, termo, maxn)
    finally:
        try:
            os.remove(jar)
        except OSError:
            pass
    tx = limpa(t)
    m = re.search(r'Localizada\(s\)\s*(\d+)', tx)
    atos = _spl_itens(t, base)
    if not m and not atos:
        raise Erro('SPL: resposta sem contagem nem itens')
    return {'total': int(m.group(1)) if m else len(atos), 'atos': atos[:maxn], 'obs': 'só a 1ª página de resultados'}


RX_TEMA_TRANSITO = re.compile(r'tr[aâ]nsit|transport|mobilidade|tr[aá]fego|vi[aá]ri|ve[ií]culo|carga|estacionamento|sistema vi', re.I)


def _spl_itens(t, base):
    atos = []
    for bl in re.split(r'<div class="kt-widget5__section', t)[1:]:
        mt = re.search(r'href="([^"]*norma\.aspx\?id=\d+)[^"]*"[^>]*kt-widget5__title[^>]*>(.*?)</a>', bl, re.S)
        if not mt:
            continue
        tit = limpa(mt.group(2))
        md = re.search(r'kt-widget5__desc[^>]*>(.*?)</a>', bl, re.S)
        dt = re.search(r'Data:</span>\s*<span[^>]*>([^<]+)', bl)
        st = re.search(r'Situa[^<]*</span>\s*<span[^>]*>([^<]+)', bl)
        mn = re.search(r'(.+?)\s+n[°º]\s*([\d\.]+)/(\d{4})', tit)
        atos.append(ato(tipo=mn.group(1) if mn else tit, numero=mn.group(2) if mn else '', ano=mn.group(3) if mn else '',
                        data=dt.group(1) if dt else '', ementa=limpa(md.group(1)) if md else '',
                        url=urljoin(base + '/legislacao/', mt.group(1).split('&')[0]), situacao=st.group(1) if st else '', titulo=tit))
    return atos


def _spl_por_tema(base, pagina_form, termo, maxn):
    m = re.search(r'name="ctl00\$ContentPlaceHolder1\$lst_temas"[^>]*>(.*?)</select>', pagina_form, re.S)
    temas = [(v, H.unescape(n)) for v, n in re.findall(r'<option[^>]*value="(\d+)"[^>]*>([^<]*)', m.group(1))] if m else []
    alvo = [(v, n) for v, n in temas if RX_TEMA_TRANSITO.search(n) or sem_acento(termo.lower()) in sem_acento(n.lower())][:8]
    if not alvo:
        raise Erro('SPL: busca textual bloqueada (Cloudflare) e nenhum tema de trânsito/transporte na lista de temas de ' + base)
    chave = sem_acento(termo.lower())
    atos, vistos, varridos = [], set(), []
    for v, n in alvo:
        r = http(f'{base}/legislacao/consulta-legislacao.aspx?temas={v}', timeout=60)
        t = r.text if r else ''
        tot = re.search(r'Localizada\(s\)\s*(\d+)', limpa(t))
        itens = _spl_itens(t, base)
        varridos.append(f'{n}({tot.group(1) if tot else len(itens)})')
        for a in itens:
            if a['url'] in vistos:
                continue
            vistos.add(a['url'])
            a['tema'] = n
            if chave in sem_acento((a['ementa'] + ' ' + a.get('titulo', '')).lower()) or chave in sem_acento(n.lower()):
                atos.append(a)
    return {'total': len(atos), 'atos': atos[:maxn],
            'obs': 'busca textual atrás de Cloudflare; varridos por tema (1ª página de cada, até 30 itens): ' + '; '.join(varridos)}


def c_instar(base, termo, maxn=100, texto=False):
    """Instar (/portal/leis_decretos/...). URL montada como o JS do portal:
    /1/{dataIni}/{dataFim}/{assunto}/{categoria}/{numero}/{ano}/{ementa}/{situacao}/{autor}/{vereador}/{mesa}/{comissao}/{nome}/
    {numIni}/{numFim}/{anoIni}/{anoFim}/{E=ementa|T=texto|A=ambos}/{ordenacao}/{simples}/{secretaria}"""
    base = base.rstrip('/')
    atos, total = [], None
    opc = 'A' if texto else 'E'
    for pag in range(1, 6):
        partes = [str(pag), '0', '0', '0', '0', '0', '0', quote(termo, safe=''), '0', '0', '0', '0', '0', '0', '0', '0', '0', '0',
                  opc, 'data-decrescente', 'simples', '0']
        url = base + '/portal/leis_decretos/' + '/'.join(partes)
        r = http(url, timeout=90)
        t = r.text if r else ''
        if pag == 1:
            if 'leis_decretos' not in t:
                raise Erro('Instar: módulo leis_decretos não respondeu em %s (status %s)' % (base, r.status if r else '?'))
            m = re.search(r'sw_qtde_resultados[^>]*>\s*([\d\.]+)', t)
            total = int(m.group(1).replace('.', '')) if m else (0 if 'Nenhum ato foi encontrado' in t else None)
        novos = 0
        for bl in re.split(r'<div class="leg_norma_listagem', t)[1:]:
            bl = bl[:12000]
            mid = re.search(r'href="(/portal/leis_decretos/(\d+)/)"', bl)
            if mid:
                u = base + mid.group(1)
            else:  # layout sem link de detalhe: id em leg_id_norma/data-id; a página /portal/leis_decretos/<id>/ existe
                mi = re.search(r'leg_id_norma"\s+value="(\d+)"|data-id="(\d+)"', bl)
                if not mi:
                    continue
                u = base + '/portal/leis_decretos/%s/' % (mi.group(1) or mi.group(2))
            if any(a['url'] == u for a in atos):
                continue
            num = re.search(r'leg_numero_norma[^>]*>\s*<span>\s*N[ºo°]?\s*([\d\.]+)\s*(?:/\s*(\d{4}))?', bl)
            cat = re.search(r'leg_categoria_norma[^>]*>(.*?)</div>', bl, re.S)
            info = re.search(r'leg_area_info_norma[^>]*>(.*)', bl, re.S)
            itx = limpa(info.group(1)) if info else limpa(bl)
            dt = re.search(r'Data:\s*(\d{2}/\d{2}/\d{4})', itx)
            st = re.search(r'Situa[çc][ãa]o:\s*(.+?)(?=\s{1}[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]|$)', itx)
            em = re.sub(r'^.*?Situa[çc][ãa]o:\s*\S+(?:\s+(?:em vigor|vigor|revogad[ao]|totalmente|parcialmente|alterad[ao]))*\s*', '', itx, flags=re.I)
            mem = re.search(r'leg_ementa_listagem[^>]*>(.*?)</div>', bl, re.S)
            if mem:
                em = limpa(mem.group(1))
            ano_n = (num.group(2) if num and num.group(2) else (dt.group(1)[-4:] if dt else ''))
            atos.append(ato(tipo=limpa(cat.group(1)) if cat else '', numero=num.group(1) if num else '', ano=ano_n,
                            data=dt.group(1) if dt else '', ementa=em[:700], url=u, situacao=st.group(1) if st else ''))
            novos += 1
        if not novos or len(atos) >= maxn or (total is not None and len(atos) >= total):
            break
    return {'total': total if total is not None else len(atos), 'atos': atos[:maxn]}


def c_portalfacil(base, termo, maxn=100, texto=False):
    """Portal Fácil (AjaxPro leg_lis GetLegLis) em <site>/legislacao."""
    base = base.rstrip('/')
    jar = tempfile.mktemp(prefix='pf_')
    try:
        r = http(base + '/legislacao', jar=jar, timeout=60)
        t = r.text if r else ''
        m = re.search(r'/ajaxpro/(leg_lis,[^"\']+\.ashx)', t)
        if not m:
            raise Erro('Portal Fácil: endpoint ajaxpro leg_lis não achado em %s/legislacao' % base)
        ep = base + '/ajaxpro/' + m.group(1)
        atos, tot = [], None
        for pg in range(0, 8):
            body = {"page": pg, "Size": 25, "strPalavraChave": termo, "nuLegislacao": -1, "dtLegislacao_ano": -1, "cdLegislacaoTipo": -1,
                    "dtLegislacao_menor": "", "dtLegislacao_maior": "", "strLegislacaoAssunto": "", "isBuscaResumo": True, "isBuscaEmenta": True,
                    "isBuscaHtml": bool(texto), "isBuscaPdf": bool(texto), "stLegislacao": -1, "dmOrdenacao": "1"}
            r = http(ep, data=json.dumps(body), jar=jar, timeout=90,
                     headers={'X-AjaxPro-Method': 'GetLegLis', 'Content-Type': 'text/plain; charset=utf-8'})
            raw = r.text if r else ''
            i = raw.find('DataTable(')
            if i < 0:
                break
            raw = raw[i + len('DataTable('):]
            raw = raw[:raw.rfind(')')]
            raw = re.sub(r'new Date\(([^)]*)\)', lambda mm: '"%s"' % mm.group(1), raw)
            cols, rows = json.loads('[' + raw + ']')
            cn = [c[0] for c in cols]
            if not rows:
                break
            for row in rows:
                d = dict(zip(cn, row))
                tot = d.get('TOTALROWS', tot)
                dt = str(d.get('DTLEGISLACAO') or '')
                md = re.match(r'(\d{4}),(\d{1,2}),(\d{1,2})', dt.replace(' ', ''))
                if md:
                    dt = '%02d/%02d/%s' % (int(md.group(3)), int(md.group(2)) + 1, md.group(1))
                link = d.get('LINKLEGISLACAO') or ''
                atos.append(ato(tipo=d.get('NMLEGISLACAOTIPO'), numero=d.get('NULEGISLACAO'), ano=d.get('NUANO'), data=dt,
                                ementa=limpa(str(d.get('DSRESUMO') or d.get('DSASSUNTO') or '')), url=urljoin(base + '/', link) if link else base + '/legislacao',
                                situacao=str(d.get('STLEGISLACAO') or '')))
            if tot is not None and (pg + 1) * 25 >= tot or len(atos) >= maxn:
                break
        return {'total': tot if tot is not None else len(atos), 'atos': atos[:maxn]}
    finally:
        try:
            os.remove(jar)
        except OSError:
            pass


def c_wordpress(base, termo, maxn=100, texto=False):
    """WordPress: /wp-json/wp/v2/search (páginas/posts). Não traz número/data do ato — só título e URL."""
    base = base.rstrip('/')
    r = http(base + '/wp-json/wp/v2/search?' + urlencode({'search': termo, 'per_page': min(maxn, 100)}), headers={'Accept': 'application/json'})
    try:
        d = r.json()
        assert isinstance(d, list)
    except Exception:
        raise Erro('WordPress: API /wp-json indisponível em ' + base)
    atos = []
    for x in d:
        tit = limpa(x.get('title', ''))
        mn = re.search(r'((?:Lei|Decreto|Portaria|Resolu\w+)[^\d]{0,30}?)\s*n?[ºo°.]*\s*([\d\.]+)\s*/\s*(\d{4})', tit, re.I)
        atos.append(ato(tipo=mn.group(1) if mn else x.get('subtype', ''), numero=mn.group(2) if mn else '', ano=mn.group(3) if mn else '',
                        ementa=tit, url=x.get('url', '')))
    return {'total': len(atos), 'atos': atos, 'obs': 'busca geral do site (posts/páginas), não é base de normas'}


def _origem(u):
    p = urlparse(u if '//' in u else 'https://' + u)
    return f'{p.scheme or "https"}://{p.netloc}'


def c_legislacoes_dt(base, termo, maxn=100, texto=False):
    """Portal com DataTables em /legislacoes/get/<tipo|todas> (comum em prefeituras/câmaras de MG).
    Filtro 'ementa' é feito no servidor (substring, sensível a acento)."""
    base = _origem(base)
    atos, total, start = [], None, 0
    while len(atos) < maxn:
        q = urlencode({'draw': 1, 'start': start, 'length': 100, 'ementa': termo})
        r = http(f'{base}/legislacoes/get/todas?{q}', headers={'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json'})
        try:
            d = r.json()
        except Exception:
            raise Erro('legislacoes_dt: /legislacoes/get/todas não devolveu JSON em %s (status %s)' % (base, r.status if r else '?'))
        total = d.get('recordsFiltered', total)
        dados = d.get('data') or []
        for x in dados:
            arq = (x.get('arquivo') or {}) if isinstance(x.get('arquivo'), dict) else {}
            atos.append(ato(tipo=x.get('titulo'), numero=x.get('numero'), ano=x.get('ano'),
                            data=iso_br(str(x.get('data') or x.get('data_publicacao') or '')), ementa=limpa(x.get('ementa') or ''),
                            url=f'{base}/legislacoes/{x.get("id")}', arquivo=arq.get('path', '')))
        if len(dados) < 100:
            break
        start += 100
    return {'total': total if total is not None else len(atos), 'atos': atos[:maxn]}


WEBLINE_PAG = 'T0dRPU9EZz1PR009T1RnPQ=='
RX_WEBLINE_TIPO_UTIL = re.compile(r'\blei|decreto|resolu|portaria|c[oó]digo', re.I)
RX_WEBLINE_TIPO_FORA = re.compile(r'projeto|mo[cç][aãõ]|requeriment|indica|veto|parecer|of[ií]cio|emenda', re.I)


def c_webline(base, termo, maxn=100, texto=False):
    """Webline Sistemas (MG/SP): módulo ?pag=T0dRPU9EZz1PR009T1RnPQ==&idtipolei=N com filtro 'descricao' (ementa).
    Para cada tipo de ato (leis/decretos/resoluções/portarias), lista os anos com resultado e lê cada ano."""
    base = _origem(base)
    r = http(f'{base}/?pag={WEBLINE_PAG}&idtipolei=1')
    t = r.text if r else ''
    if 'idtipolei' not in t:
        raise Erro('Webline: módulo de legislação (?pag=%s) não respondeu em %s' % (WEBLINE_PAG, base))
    tipos = {}
    for tid, lab in re.findall(r'href=["\'][^"\']*idtipolei=(\d+)["\'][^>]*>(.*?)</a>', t, re.S):
        lab = limpa(lab)
        if tid not in tipos and lab and RX_WEBLINE_TIPO_UTIL.search(lab) and not RX_WEBLINE_TIPO_FORA.search(lab):
            tipos[tid] = lab
    if not tipos:
        tipos = {'1': 'Lei', '2': 'Lei Complementar', '3': 'Decreto'}
    atos, obs = [], []
    fixo = 'objeto[]=&numero=&data=&tc=&tcNot=&sit=&notid=&notIn='
    for tid, lab in list(tipos.items())[:8]:
        u0 = f'{base}/?pag={WEBLINE_PAG}&idtipolei={tid}&descricao={quote(termo)}&ano=&{fixo}'
        r = http(u0)
        t = r.text if r else ''
        anos = sorted({a for a in re.findall(r'[?&]ano=(\d{4})', t)}, reverse=True)
        obs.append(f'{lab}:{len(anos)} anos')
        for ano in anos[:15]:
            for pg in range(0, 5):
                r = http(f'{base}/?pag={WEBLINE_PAG}&idtipolei={tid}&descricao={quote(termo)}&ano={ano}&pg={pg if pg else ""}&{fixo}')
                t = r.text if r else ''
                novos = 0
                for bl in re.split(r"<div class='row'>\s*<div class=\"col-md-12 \">", t)[1:]:
                    bl = bl[:9000]
                    mt = re.search(r'<h4>(.*?)</h4>', bl, re.S)
                    if not mt:
                        continue
                    tit = limpa(mt.group(1))
                    mn = re.search(r'(.+?)\s+N\s*[º°o]?\s*([\d\.\-/]+)', tit)
                    dt = re.search(r'Data[^<]*:</h4>\s*([\d/]+)', bl)
                    st = re.search(r'Situa[^<]*:</h4>\s*([^<]+)', bl)
                    em = re.search(r'Ementa:</h4>(.*?)</div>', bl, re.S)
                    det = re.search(r'href="(\?pag=[^"]*&id=\d+[^"]*)"', bl)
                    u = urljoin(base + '/', det.group(1)) if det else f'{base}/?pag={WEBLINE_PAG}&idtipolei={tid}&ano={ano}'
                    if any(a['url'] == u and a['titulo'] == tit for a in atos):
                        continue
                    atos.append(ato(tipo=mn.group(1) if mn else lab, numero=mn.group(2) if mn else '', ano=ano,
                                    data=dt.group(1) if dt else '', ementa=limpa(em.group(1)) if em else '', url=u,
                                    situacao=limpa(st.group(1)) if st else '', titulo=tit))
                    novos += 1
                if not novos or f'pg={pg + 1}' not in t:
                    break
            if len(atos) >= maxn:
                break
        if len(atos) >= maxn:
            break
    return {'total': len(atos), 'atos': atos[:maxn], 'obs': '; '.join(obs)}


def c_legver(base, termo, maxn=100, texto=False):
    """Portal com /legislacao?especie_normativa=&busca= e itens em /legislacao/ver/<id>/detalhes (ES/MG)."""
    base = _origem(base)
    atos = []
    q = urlencode({'especie_normativa': '', 'numero': '', 'ano': '', 'situacao': '', 'busca': termo})
    for off in range(0, 200, 10):
        u = f'{base}/legislacao' + (f'/index/{off}' if off else '') + '?' + q
        r = http(u)
        t = r.text if r else ''
        if off == 0 and 'especie_normativa' not in t and '/legislacao/ver/' not in t:
            raise Erro('legver: formulário /legislacao não reconhecido em ' + base)
        novos = 0
        for bl in re.split(r'<table class="table table-bordered', t)[1:]:
            mt = re.search(r'tabela-titulo[^>]*>\s*(.*?)\s*</td>', bl, re.S)
            mu = re.search(r'href="([^"]*/legislacao/ver/\d+/detalhes)"', bl)
            if not mt or not mu:
                continue
            tit = limpa(mt.group(1))
            mn = re.search(r'(.+?)\s+([\d\.]+)/(\d{4})', tit)
            dt = re.search(r'Data:</td>\s*<td[^>]*>([^<]+)', bl)
            st = re.search(r'Situa[^<]*</td>\s*<td[^>]*>([^<]+)', bl)
            em = re.search(r'Ementa:</td>\s*<td[^>]*>(.*?)</td>', bl, re.S)
            atos.append(ato(tipo=mn.group(1) if mn else tit, numero=mn.group(2) if mn else '', ano=mn.group(3) if mn else '',
                            data=dt.group(1) if dt else '', ementa=limpa(em.group(1)) if em else '', url=mu.group(1),
                            situacao=st.group(1) if st else '', titulo=tit))
            novos += 1
        if novos < 10 or len(atos) >= maxn:
            break
    return {'total': len(atos), 'atos': atos[:maxn]}


def c_docman(base, termo, maxn=100, texto=False):
    """Joomla DOCman (listas de documentos por categoria: ...?category[0]=N&category_children=1).
    base = URL da listagem (com a categoria). Busca 'search' em título/descrição; só título, data de publicação e link."""
    sep = '&' if '?' in base else '?'
    atos = []
    for off in range(0, 300, 20):
        u = base + sep + urlencode({'search': termo, 'limit': 20, 'limitstart': off})
        r = http(u)
        t = r.text if r else ''
        if off == 0 and 'docman' not in t:
            raise Erro('DOCman: listagem não reconhecida em ' + base)
        novos = 0
        for ma in re.finditer(r'<a\b([^>]*data-title="([^"]*)"[^>]*)>', t):
            mh = re.search(r'href="([^"]+)"', ma.group(1))
            if not mh:
                continue
            u = urljoin(base, H.unescape(mh.group(1)))
            if any(a['url'] == u for a in atos):
                continue
            tit = H.unescape(ma.group(2))
            jan = t[ma.end(): ma.end() + 3000]
            dt = re.search(r'datetime="(\d{4}-\d{2}-\d{2})', jan)
            cat = re.search(r'itemprop="genre">([^<]+)', jan)
            mn = re.search(r'((?:Lei|Decreto|Resolu|Portaria|Emenda)[^\d]{0,40}?)\s*n?[º°o.]*\s*([\d\.]+)\s*[/-]\s*(\d{4})', tit, re.I)
            atos.append(ato(tipo=mn.group(1) if mn else (limpa(cat.group(1)) if cat else ''), numero=mn.group(2) if mn else '',
                            ano=mn.group(3) if mn else '', data=iso_br(dt.group(1)) if dt else '', ementa=tit, url=u,
                            categoria=limpa(cat.group(1)) if cat else ''))
            novos += 1
        if novos < 10 or len(atos) >= maxn:
            break
    return {'total': len(atos), 'atos': atos[:maxn], 'obs': 'DOCman: data = publicação no site; ementa = título do arquivo'}


RX_ATO_GEN = re.compile(r'((?:Lei(?:\s+Complementar|\s+Ordin[aá]ria|\s+Municipal)?|Decreto(?:\s+Legislativo|\s+Municipal)?|Resolu[cç][aã]o|Portaria|Emenda\s+[àa]\s+Lei\s+Org[aâ]nica))'
                        r'\s*(?:Municipal\s*)?(?:n[º°o.]*|N[º°O.]*)\s*([\d][\d\.]*)\s*(?:[/-]\s*(\d{4})|,?\s+de\s+(\d{1,2}[º°]?\s+de\s+[a-zç]+\s+de\s+(\d{4})))?', re.I)
RX_CAMPO_BUSCA = re.compile(r'^(q|s|busca|buscar|pesquisa|pesquisar|termo|termos|palavra|palavrachave|palavra_chave|keyword|keywords|search|'
                            r'searchabletext|ementa|assunto|descricao|texto|txt_?\w*|filtro)$', re.I)


def c_generico(base, termo, maxn=100, texto=False):
    """Heurístico para portal próprio sem cliente dedicado: abre a página de legislação (base = url_busca),
    preenche o 1º formulário com campo de texto de busca (GET/POST) com o termo e extrai menções
    'Lei/Decreto/... nº X/AAAA' com o texto ao redor. Sem formulário, filtra a própria página pelo termo.
    Resultados são PISTAS (conferir no ato), não lista completa."""
    r = http(base)
    t = r.text if r else ''
    if not t:
        raise Erro('genérico: página não respondeu: %s' % base)
    usado = 'página filtrada localmente'
    for fm in re.finditer(r'<form\b([^>]*)>(.*?)</form>', t, re.S | re.I):
        attrs, corpo = fm.group(1), fm.group(2)
        campos = re.findall(r'<input\b[^>]*>', corpo, re.I)
        alvo, dados = None, {}
        for c in campos:
            nm = re.search(r'name=["\']([^"\']+)', c)
            tp = (re.search(r'type=["\']([^"\']+)', c) or [None, 'text'])[1].lower()
            if not nm:
                continue
            if tp == 'hidden':
                vl = re.search(r'value=["\']([^"\']*)', c)
                dados[nm.group(1)] = H.unescape(vl.group(1)) if vl else ''
            elif tp in ('text', 'search') and alvo is None and RX_CAMPO_BUSCA.match(nm.group(1).split('[')[0]):
                alvo = nm.group(1)
        if not alvo:
            continue
        # evita a busca geral do site se a página tiver outro formulário específico de legislação
        if re.search(r'action=["\'][^"\']*(?:resultados-busca|/busca/?["\'])', attrs) and 'legisla' not in corpo.lower():
            continue
        dados[alvo] = termo
        act = re.search(r'action=["\']([^"\']*)', attrs)
        dest = urljoin(r.url or base, H.unescape(act.group(1))) if act and act.group(1).strip() else (r.url or base)
        met = (re.search(r'method=["\']([^"\']+)', attrs) or [None, 'get'])[1].lower()
        if met == 'post':
            r2 = http(dest, data=dados)
        else:
            r2 = http(dest + ('&' if '?' in dest else '?') + urlencode(dados))
        if r2 and r2.status == 200 and r2.body:
            t, usado = r2.text, f'formulário {met.upper()} {dest} campo={alvo}'
            break
    corpo = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', t, flags=re.S | re.I)
    chave = sem_acento(termo.lower())
    atos, vistos = [], set()
    for m in RX_ATO_GEN.finditer(corpo):
        ini = max(0, m.start() - 300)
        jan = corpo[ini: m.end() + 900]
        txt = limpa(corpo[m.start(): m.end() + 900])[:600]
        if usado == 'página filtrada localmente' and chave not in sem_acento(txt.lower()):
            continue
        hrefs = re.findall(r'href=["\']([^"\'#]+)["\']', jan)
        u = urljoin(base, H.unescape(hrefs[0])) if hrefs else base
        num = m.group(2).rstrip('.')
        ano = m.group(3) or m.group(5) or ''
        k = (sem_acento(m.group(1).lower()).split()[0], num, ano)
        if k in vistos:
            continue
        vistos.add(k)
        atos.append(ato(tipo=' '.join(m.group(1).split()), numero=num, ano=ano, data=m.group(4) or '', ementa=txt, url=u, heuristico='sim'))
        if len(atos) >= maxn:
            break
    return {'total': len(atos), 'atos': atos, 'obs': 'heurístico (' + usado + '); conferir cada ato na fonte'}


def c_legislacaodigital(base, termo, maxn=100, texto=False):
    """Legislação Digital (motor da Sino; URLs /<Cidade-UF>/LeisOrdinarias/<num>-<ano>). base = https://host/<Cidade-UF>.
    Em www.legislacaodigital.com.br há desafio Cloudflare (403) — não contornar; domínios próprios (ex.: legislacao.limeira.sp.leg.br) respondem."""
    base = base.rstrip('/')
    atos, total = [], None
    for pag in range(1, 8):
        q = urlencode({'Pagina': pag, 'Pesquisa': 'Textual', 'TipoId': 0, 'EmentaAssunto': termo, 'NoTexto': 'true' if texto else 'false'})
        r = http(f'{base}?{q}', timeout=60)
        t = r.text if r else ''
        if r and r.status == 403 and ('Just a moment' in t or 'cloudflare' in t.lower()):
            raise Erro('Legislação Digital atrás de desafio Cloudflare (403) em %s — não contornar; usar a Câmara/Siscam/diário' % base)
        if pag == 1:
            m = re.search(r'(\d+)\s*registro\(s\)', limpa(t))
            total = int(m.group(1)) if m else (0 if 'normas-lista' not in t and 'Nenhum' in t else None)
            if total is None and 'normas-lista' not in t:
                raise Erro('Legislação Digital: página de pesquisa não reconhecida em ' + base)
        novos = 0
        for bl in re.split(r'<div class="normas-lista"', t)[1:]:
            mh = re.search(r'<h4>\s*<a href="([^"]+)"[^>]*>(.*?)</a>', bl, re.S)
            if not mh:
                continue
            tit = limpa(mh.group(2))
            u = urljoin(base + '/', mh.group(1))
            mn = re.search(r'(.+?)\s+n[ºo°]\s*([\d\.]+)/(\d{4})', tit, re.I)
            dt = re.search(r'Data:\s*</strong>\s*([\d/]+)', bl)
            st = re.search(r'Situa[^<]*</strong>\s*([^<]+)', bl)
            em = re.search(r'Ementa/Assunto:\s*</strong>(.*?)</p>', bl, re.S)
            atos.append(ato(tipo=mn.group(1) if mn else tit, numero=mn.group(2) if mn else '', ano=mn.group(3) if mn else '',
                            data=dt.group(1) if dt else '', ementa=limpa(em.group(1)) if em else '', url=u,
                            situacao=limpa(st.group(1)) if st else '', titulo=tit))
            novos += 1
        if not novos or len(atos) >= maxn or (total is not None and len(atos) >= total):
            break
    return {'total': total if total is not None else len(atos), 'atos': atos[:maxn]}


def c_sp_catalogo(base, termo, maxn=100, texto=False):
    """Catálogo de Legislação Municipal da Prefeitura de São Paulo (legislacao.prefeitura.sp.gov.br): GET /busca?assunto=."""
    base = _origem(base)
    atos, total = [], None
    for pag in range(1, 6):
        q = {'assunto': termo}
        if pag > 1:
            q['pagina'] = pag
        r = http(f'{base}/busca?' + urlencode(q), timeout=90)
        t = r.text if r else ''
        if pag == 1:
            m = re.search(r'de\s+([\d\.]+)\s*Resultado', limpa(t), re.I) or re.search(r'resultados:\s*[\d\s\-]+de\s+([\d\.]+)', limpa(t), re.I)
            total = int(m.group(1).replace('.', '')) if m else None
            if 'bx-resultado' not in t and total is None:
                raise Erro('Catálogo SP: resposta não reconhecida (%s)' % (r.status if r else '?'))
        novos = 0
        for bl in re.split(r'<div class="bx-resultado">', t)[1:]:
            mh = re.search(r'<a href="([^"]+)">\s*<h4>(.*?)</h4>\s*<p>(.*?)</p>', bl, re.S)
            if not mh:
                continue
            u = urljoin(base + '/', mh.group(1))
            if any(a['url'] == u for a in atos):
                continue
            tit = limpa(mh.group(2))
            mn = re.search(r'^(.*?)\s*N?[ºo°]?\s*([\d\.]+)\s+de\s+(\d{1,2}\s+de\s+\w+\s+de\s+(\d{4}))', tit, re.I)
            st = re.search(r'Situa[çc][ãa]o</td>\s*<td>(.*?)</td>', bl, re.S)
            atos.append(ato(tipo=mn.group(1).strip() if mn else tit, numero=mn.group(2) if mn else '', ano=mn.group(4) if mn else '',
                            data=mn.group(3) if mn else '', ementa=limpa(mh.group(3)), url=u, situacao=limpa(st.group(1)) if st else '', titulo=tit))
            novos += 1
        if not novos or len(atos) >= maxn or f'pagina={pag + 1}' not in t:
            break
    return {'total': total if total is not None else len(atos), 'atos': atos[:maxn]}


def c_domino(base, termo, maxn=100, texto=False):
    """Lotus Domino (ex.: Câmara do Rio, contlei.nsf): base = URL da visão (…/contlei.nsf/<UNID da visão>); usa ?SearchView&Query=."""
    base = base.rstrip('/')
    r = http(base + '?SearchView&' + urlencode({'Query': termo, 'SearchMax': max(maxn, 50)}), timeout=90)
    t = r.text if r else ''
    if not r or r.status not in (200, 404):
        raise Erro('Domino: busca não respondeu em %s (status %s)' % (base, r.status if r else '?'))
    atos = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        mu = re.search(r'href="([^"]*OpenDocument[^"]*)"', row)
        if not mu:
            continue
        cels = [c for c in (limpa(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)) if c]
        if not cels:
            continue
        num = cels[0]
        ano = cels[1] if len(cels) > 1 and re.fullmatch(r'\d{4}', cels[1]) else ''
        resto = cels[2:] if ano else cels[1:]
        situ = resto[0] if resto else ''
        ementa = resto[1] if len(resto) > 1 else ''
        atos.append(ato(tipo='Lei', numero=num, ano=ano, ementa=ementa, url=urljoin(base + '/', H.unescape(mu.group(1))), situacao=situ,
                        autoria=resto[2] if len(resto) > 2 else ''))
    return {'total': len(atos), 'atos': atos[:maxn], 'obs': 'visão Domino; tipo inferido da visão'}


def c_elotech(base, termo, maxn=100, texto=False):
    """Elotech Oxy / eloweb — Portal da Transparência (React) com API pública sem login:
    {origem}/portaltransparencia-api/api/leisatos?entidade=<id>&exercicio=<ano>&subAbaLeiAtos=geral&descricaoSumula=<termo>&page=&size=
    (descricaoSumula = substring da ementa, sem diferença de maiúscula/minúscula, SENSÍVEL a acento). Cobre todas as entidades do host."""
    o = _origem(base)
    api = o + '/portaltransparencia-api/api'
    r = http(api + '/entidades', headers={'Accept': 'application/json'})
    try:
        ents = r.json()
    except Exception:
        raise Erro('Elotech: /portaltransparencia-api/api/entidades não respondeu JSON em %s (status %s)' % (o, r.status if r else '?'))
    ano = time.localtime().tm_year
    atos, total, vistos = [], 0, set()
    for e in ents[:6]:
        eid = e.get('id')
        pag = 0
        while len(atos) < maxn:
            q = urlencode({'entidade': eid, 'exercicio': ano, 'subAbaLeiAtos': 'geral', 'descricaoSumula': termo, 'page': pag, 'size': 100})
            rr = http(api + '/leisatos?' + q, headers={'Accept': 'application/json'})
            try:
                d = rr.json()
            except Exception:
                break
            if not isinstance(d, dict) or 'content' not in d:
                break
            total += d.get('totalElements', 0) if pag == 0 else 0
            for n in d['content']:
                chave = (eid, n.get('id'))
                if chave in vistos:
                    continue
                vistos.add(chave)
                det = f"{api}/leisatos/detalhes/?" + urlencode({'entidade': eid, 'id': n.get('id'), 'exercicio': n.get('exercicio') or ano})
                atos.append(ato(tipo=n.get('natureza') or n.get('tipoDocumentoLegal') or '', numero=n.get('numero'), ano=n.get('exercicio'),
                                data=iso_br(n.get('data') or n.get('dataPublicacao')), ementa=n.get('sumula') or n.get('descricao'), url=det,
                                entidade=e.get('nome'), arquivos=[a.get('nomeArquivo') for a in n.get('arquivos') or []][:3]))
            if d.get('last', True) or not d['content']:
                break
            pag += 1
    return {'total': total, 'atos': atos[:maxn]}


def c_cespro(cd, termo, maxn=100, texto=False):
    raise Erro('CESPRO: a pesquisa do portal (cespro.com.br/pesquisaLegislacao.php?cdMunicipio=%s) passa por reCAPTCHA e devolve 0 '
               'via API; não automatizar. Use a lista por ano no navegador/WebFetch ou outra fonte (Câmara, Querido Diário).' % cd)


def c_bloqueado(base, termo, maxn=100, texto=False):
    raise Erro('Portal atrás de desafio Cloudflare (403 "Just a moment" para curl e WebFetch): %s. Não contornar; '
               'usar a outra fonte do município (Câmara/SAPL, diário oficial, Querido Diário).' % base)


def c_sem_cliente(base, termo, maxn=100, texto=False):
    raise Erro('Sem cliente automático para este sistema; abrir %s manualmente (WebFetch).' % base)


CLIENTES = {
    'sapl': (c_sapl, 'SAPL 3 Interlegis (API REST, ementa) — detecta e delega para SAGL/OpenLegis quando for o caso'),
    'sagl': (c_sagl, 'SAGL/OpenLegis/SAPL 2.5 (normas_table_json; fallback HTML)'),
    'siscam': (c_siscam, 'Sino.Siscam (grupo Legislação, export CSV); Siscam antigo como fallback'),
    'nopapercloud': (c_spl, 'SPL nopapercloud (POST /legislacao/; 1ª página)'),
    'legislacaocompilada': (c_spl, 'SPL Legislação Compilada (mesmo motor do nopapercloud)'),
    'spl': (c_spl, 'SPL auto-hospedado (spl.<camara>.gov.br/legislacao/, mesmo motor do nopapercloud)'),
    'instar': (c_instar, 'Instar /portal/leis_decretos (ementa/palavra; até 5 páginas)'),
    'portalfacil': (c_portalfacil, 'Portal Fácil (AjaxPro GetLegLis em /legislacao)'),
    'wordpress': (c_wordpress, 'WordPress (wp-json search; só título/URL)'),
    'legislacoes_dt': (c_legislacoes_dt, 'Portal MG com DataTables /legislacoes/get/todas (filtro ementa no servidor)'),
    'webline': (c_webline, 'Webline Sistemas (?pag=...&idtipolei=N&descricao=; anos com resultado)'),
    'legver': (c_legver, 'Portal ES/MG /legislacao?busca= (itens /legislacao/ver/<id>/detalhes)'),
    'docman': (c_docman, 'Joomla DOCman (listagem por categoria, search em título)'),
    'portal_proprio': (c_generico, 'Portal próprio: heurístico (formulário de busca da página + regex de Lei/Decreto nº)'),
    'generico': (c_generico, 'Heurístico genérico (igual a portal_proprio)'),
    'elotech': (c_elotech, 'Elotech Oxy/eloweb — API pública do Portal da Transparência (/portaltransparencia-api/api/leisatos, ementa)'),
    'cespro': (c_cespro, 'CESPRO — sem cliente (reCAPTCHA)'),
    'leismunicipais': (c_bloqueado, 'Leis Municipais / leis.org — Cloudflare, sem cliente'),
    'legislacaodigital': (c_legislacaodigital, 'Legislação Digital (Sino): domínio próprio funciona; www.legislacaodigital.com.br dá Cloudflare (erro explícito)'),
    'sp_catalogo': (c_sp_catalogo, 'Catálogo de Legislação Municipal da Prefeitura de São Paulo (GET /busca?assunto=)'),
    'domino': (c_domino, 'Lotus Domino ?SearchView (Câmara do Rio, contlei.nsf)'),
}


# ----------------------------------------------------------------------------- orquestração
def carrega_portais():
    try:
        return json.load(open(PORTAIS))
    except Exception:
        return {}


def fontes_de(ibge, filtro=None):
    p = carrega_portais().get(str(ibge))
    if not p:
        raise SystemExit(f'IBGE {ibge} não está em {PORTAIS}')
    fontes = p.get('fontes') or [{'sistema': p.get('sistema'), 'base': p.get('base') or p.get('url_busca'), 'orgao': ''}]
    if filtro:
        fontes = [f for f in fontes if f.get('orgao') == filtro]
    return p, fontes


def buscar_em(sistema, base, termos, maxn=100, texto=False):
    fn = CLIENTES.get(sistema, (c_sem_cliente, ''))[0]
    res = {'sistema': sistema, 'base': base, 'total': 0, 'atos': [], 'termos': {}}
    vistos = set()
    for termo in termos:
        try:
            r = fn(base, termo, maxn, texto)
        except Erro as e:
            res['erro'] = str(e)
            break
        except Exception as e:
            res['erro'] = f'{type(e).__name__}: {e}'
            break
        res['termos'][termo] = r.get('total', len(r.get('atos', [])))
        for k in ('obs', 'grupo'):
            if r.get(k):
                res[k] = r[k]
        for a in r.get('atos', []):
            if a['url'] in vistos:
                continue
            vistos.add(a['url'])
            a['termo'] = termo
            res['atos'].append(a)
    res['total'] = len(res['atos'])
    return res


def imprime(saida):
    for r in saida['resultados']:
        cab = f"## {r['sistema']} @ {r['base']}  ({r.get('orgao', '')})  termos={r.get('termos')}  atos={r['total']}"
        print(cab)
        if r.get('erro'):
            print('   ERRO:', r['erro'])
        if r.get('obs'):
            print('   obs:', r['obs'])
        for a in r['atos']:
            num = f"{a['numero']}/{a['ano']}" if a['numero'] else (a['ano'] or '')
            print(f"- {a['tipo']} {num} | {a['data']} | {a['ementa'][:300]} | {a['url']}")


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help'):
        print(__doc__)
        return 0
    cmd = argv[1]
    opts = {'json': '--json' in argv, 'texto': '--texto' in argv}
    maxn = 100
    fonte = None
    resto = []
    i = 2
    while i < len(argv):
        a = argv[i]
        if a == '--max':
            maxn = int(argv[i + 1]); i += 2; continue
        if a == '--fonte':
            fonte = argv[i + 1]; i += 2; continue
        if a.startswith('--'):
            i += 1; continue
        resto.append(a); i += 1
    if cmd == 'sistemas':
        for k, (_, d) in CLIENTES.items():
            print(f'{k:20s} {d}')
        return 0
    if cmd == 'info':
        p = carrega_portais().get(resto[0])
        print(json.dumps(p, ensure_ascii=False, indent=1) if p else 'sem registro')
        return 0
    if cmd == 'direto':
        sistema, base, termo = resto[0], resto[1], resto[2]
        r = buscar_em(sistema, base, termo.split('|'), maxn, opts['texto'])
        saida = {'resultados': [r]}
        print(json.dumps(saida, ensure_ascii=False, indent=1)) if opts['json'] else imprime(saida)
        return 0 if not r.get('erro') else 2
    if cmd == 'buscar':
        ibge, termo = resto[0], resto[1]
        p, fontes = fontes_de(ibge, fonte)
        if '--principal' in argv:  # só a 1ª fonte com cliente (portais.json já vem ordenado por qualidade)
            fontes = [f for f in fontes if f.get('sistema') in CLIENTES and CLIENTES[f['sistema']][0] not in (c_bloqueado, c_cespro)][:1] or fontes[:1]
        if '--sem-wp' in argv:
            fontes = [f for f in fontes if f.get('sistema') != 'wordpress']
        saida = {'ibge': ibge, 'nome': p.get('nome'), 'uf': p.get('uf'), 'resultados': []}
        for f in fontes:
            if f.get('sistema') not in CLIENTES:
                saida['resultados'].append({'sistema': f.get('sistema'), 'base': f.get('base'), 'orgao': f.get('orgao'), 'total': 0, 'atos': [],
                                            'erro': 'sem cliente automático; consultar manualmente: ' + (f.get('url_busca') or f.get('base') or '')})
                continue
            r = buscar_em(f['sistema'], f['base'], termo.split('|'), maxn, opts['texto'])
            r['orgao'] = f.get('orgao', '')
            saida['resultados'].append(r)
        print(json.dumps(saida, ensure_ascii=False, indent=1)) if opts['json'] else imprime(saida)
        return 0
    if cmd == 'testar':
        sistema = resto[0]
        n = int(resto[1]) if len(resto) > 1 else 3
        termo = resto[2] if len(resto) > 2 else 'trânsito'
        port = carrega_portais()
        feitos = 0
        for ibge, p in port.items():
            for f in p.get('fontes', []):
                if f.get('sistema') == sistema and feitos < n:
                    r = buscar_em(sistema, f['base'], [termo], 5)
                    print(ibge, p.get('nome'), f['base'], 'ERRO ' + r['erro'] if r.get('erro') else f"ok total={r['termos']}")
                    feitos += 1
        return 0
    print(__doc__)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
