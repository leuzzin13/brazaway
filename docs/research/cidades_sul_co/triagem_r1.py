#!/usr/bin/env python3
"""Triagem R1 (orquestrador) da pesquisa municipal de caminhões — Sul e Centro-Oeste.

Sem rede. Lê os insumos da preparação e decide, por município fora da frente profunda e sem res/:
  * DIRETO   -> grava res/<ibge>.json (nao_achou, nivel_busca varredura_consolidada) — só com --gravar
  * DIRIGIDA -> fila/R1-<UF>-D{F,W,O}NN.json   (alguma pista; classe DF forte / DW fraca / DO só OSM)
  * MÉDIA    -> fila/R1-<UF>-MNN.json           (30–100 mil hab. sem pista)
Saída: triagem_r1.json (decisão por município) e fila_r1_resumo.json. Nunca sobrescreve res/ existente.

Uso: python3 triagem_r1.py [--gravar]
"""
import json, glob, os, re, sys, math, unicodedata, collections

C = os.path.dirname(os.path.abspath(__file__))
HOJE = '2026-10-18'
GRAVAR = '--gravar' in sys.argv


def J(p):
    return json.load(open(os.path.join(C, p), encoding='utf-8'))


def norm(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', s)


# ---------------------------------------------------------------- força de um trecho (re-pontuação do orquestrador)
VEIC = r'(caminh|veiculos? pesad|veiculos? de carga|veiculos? de grande porte|carretas?|bitre|treminh|cavalos? mecanic|tonelad|\d+ ?t\b|eixos|trafego pesado|transito pesado|vuc\b|veiculo urbano de carga)'
PROIB = (r'(proib|vedad|vedac|restric|restrit|nao (sera|e|sendo) permitid|fica(m)? (limitad|impedid|interditad)|impedid|'
         r'limita(r|cao|-se)? (o|a)? ?(circula|trafego|transito|acesso)|disciplina (o|a) (circula|trafego|transito)|'
         r'regulamenta (o|a) (circula|trafego|transito)|ordenamento d[oa] (circula|trafego|transito)|horario(s)? (permitid|de circula)|'
         r'rota|desvio|perimetro urbano|zona (de|central)|area central|centro da cidade|anel)')
CIRC = r'(circula|trafeg|transit|acesso|estacion|carga e descarga|transpor)'
NOISE = (r'(licita|pregao|contrata|aquisic|registro de precos|frota|motorista|cargo|servidor|diario de bordo|coleta|lixo|residuo|'
         r'food ?truck|ambulante|covid|pandemia|coronavirus|servidao|indeniz|desapropria|locacao|transporte escolar|aliquota|iss\b|'
         r'tributa|maquinas e caminhoes|patrulha|produtores? rura|abastecimento|combustiv|manutencao de veiculos|pecas|pneus|'
         r'plano diretor|plano de mobilidade|diretriz|lotacao|nomeia|exonera|ferias|diaria|leilao|alienacao|doacao|cessao de uso|'
         r'permissao de uso|bombeiro|evento|festa|carnaval|rodeio|desfile|interdicao temporaria|interdita temporariamente|'
         r'obras? de pavimenta|tampa traseira|bomba a vacuo|dispensa|inexigibilidade|edital|ata de reuniao|indicacao|requerimento|requer)')
NORMATIVO = r'^(lei|decreto|portaria|resolucao|instrucao normativa|lei complementar|deliberacao)'
FORTE = [VEIC + r'.{0,60}(fica(m)? proibid|proibid|vedad|nao (sera|e) permitid|restrit)',
         r'(proibid|vedad|restri\w+).{0,60}(circula|trafego|transito|estacion).{0,40}' + VEIC,
         r'(dispoe|regulamenta|disciplina|institui|proib|restring|estabelece).{0,80}(circula|trafego|transito|carga e descarga|estacionamento).{0,60}' + VEIC]


def forca(titulo, trecho):
    t = norm(titulo); a = t + ' | ' + norm(trecho)
    if not re.search(VEIC, a):
        return 0
    sc = 0
    if re.search(PROIB, a): sc += 2
    if re.search(CIRC, a): sc += 1
    if re.search(NORMATIVO, t): sc += 1
    if any(re.search(p, a) for p in FORTE): sc += 3
    sc -= 2 * len(re.findall(NOISE, a))
    return sc


def curto(o, f):
    return {k: v for k, v in {
        'fonte': o.get('fonte', 'qd'), 'data': o.get('data'), 'titulo': (o.get('titulo') or '')[:160],
        'trecho': (o.get('trecho') or '')[:420], 'url': o.get('url'), 'url_txt': o.get('url_txt'),
        'score_preparacao': o.get('score'), 'forca_orquestrador': f}.items() if v not in (None, '')}


# ---------------------------------------------------------------- insumos
pri = {x['ibge']: x for x in J('prioridade.json')}
frota = J('frota.json') if os.path.exists(os.path.join(C, 'frota.json')) else {}
deep = {c['ibge'] for l in J('lotes_profundos.json') for c in l['cidades']}
ja_res = {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(C, 'res', '*.json'))}
dc = J('leads/diarios_consolidados.json'); dcm = dc['_meta']
qd = J('leads/querido_diario.json')
pe = J('leads/penaestrada.json')
osm = J('osm_hints_por_municipio.json')
portais = J('leads/portais.json')
cob = dcm['cobertura']
qd_cov = set(qd) - {'_meta'}

OSMK = ['hgv_no', 'hgv_cond', 'maxweight', 'maxlength', 'outros_cond']


def osm_info(i):
    o = osm.get(i) or {}
    tot = sum(o.get(k, 0) for k in OSMK)
    if not tot:
        return None
    ex = o.get('exemplos', [])
    def rodov(e):
        t = e.get('tags', {})
        return bool(t.get('ref')) or bool(t.get('aeroway')) or t.get('hgv') in ('destination', 'delivery', 'designated', 'yes')
    municipais = [e for e in ex if not rodov(e)]
    # contagem acima do nº de exemplos = há vias não listadas; trata como possivelmente municipal
    so_rodovia = bool(ex) and not municipais and tot <= len(ex)
    return {'contagens': {k: o.get(k, 0) for k in OSMK if o.get(k, 0)}, 'total': tot, 'so_rodovia_ou_fraco': so_rodovia,
            'exemplos': [{'way_id': e.get('way_id'), 'nome': e.get('nome'), 'classes': e.get('classes'),
                          'tags': {k: v for k, v in e.get('tags', {}).items() if k in ('highway', 'ref', 'hgv', 'hgv:conditional', 'maxweight', 'maxlength', 'bridge', 'aeroway', 'name')}}
                         for e in ex[:5]]}


def familia(sis):
    return sis or 'desconhecido'


# ---------------------------------------------------------------- decisão por município
decisoes = {}
for i, p in pri.items():
    if i in deep or i in ja_res:
        continue
    pop = p['populacao']; uf = p['uf']
    d = dc.get(i) or {}; q = qd.get(i) if i in qd_cov else None
    po = portais.get(i) or {}
    pistas = {}; flags = []
    best = 0
    # diário consolidado
    if d:
        oc = d.get('ocorrencias') or []
        scored = sorted(((forca(o.get('titulo', ''), o.get('trecho', '')), o) for o in oc), key=lambda z: -z[0])
        ind = d.get('indicios') or []
        scored_i = sorted(((forca(o.get('titulo', ''), o.get('trecho', '')), o) for o in ind), key=lambda z: -z[0])
        bd = scored[0][0] if scored else None
        bi = scored_i[0][0] if scored_i else None
        pistas['diarios_consolidados'] = {
            'fontes_que_cobrem': d.get('fontes_que_cobrem', []), 'diario': d.get('diario'),
            'acertos_preparacao': d.get('acertos', 0), 'n_indicios': d.get('n_indicios', 0),
            'maior_forca_acertos': bd, 'maior_forca_indicios': bi,
            'top': [curto(o, f) for f, o in scored[:4]] + [dict(curto(o, f), indicio=True) for f, o in scored_i[:2] if f >= 4]}
        if d.get('acertos', 0) > 0:
            flags.append('dc_acerto')
        if bd is not None: best = max(best, bd)
        if bi is not None and bi >= 5: best = max(best, 4); flags.append('dc_indicio_forte')
    # Querido Diário
    if q is not None:
        m10 = q.get('melhores_10') or []
        sq = sorted(((forca('', o.get('trecho', '')), o) for o in m10), key=lambda z: -z[0])
        pistas['querido_diario'] = {'nivel_qd': q.get('nivel_qd'), 'disponivel_desde': q.get('disponivel_desde'),
                                    'acertos_relevantes': q.get('acertos_relevantes', 0),
                                    'diarios_distintos_recuperados': q.get('diarios_distintos_recuperados', 0),
                                    'top': [curto(o, f) for f, o in sq[:3] if f > 0]}
        if q.get('acertos_relevantes', 0) > 0:
            flags.append('qd_acerto')
            if sq: best = max(best, sq[0][0])
    # Pé na Estrada
    pei = pe.get(i) or {}
    if pei.get('tem_pagina'):
        pistas['penaestrada'] = {k: pei.get(k) for k in ('url', 'diz', 'vias', 'horarios', 'tipo_caminhao')}
        flags.append('penaestrada')
        if pei.get('diz'): best = max(best, 6)
    # OSM
    oi = osm_info(i)
    if oi:
        pistas['osm'] = oi
        flags.append('osm_so_rodovia' if oi['so_rodovia_ou_fraco'] else 'osm')

    # classe
    doc_acerto = bool(d.get('acertos', 0) > 0 or (q and q.get('acertos_relevantes', 0) > 0) or 'dc_indicio_forte' in flags or 'penaestrada' in flags)
    if best >= 5:
        classe = 'DF'
    elif best == 4:
        classe = 'DW'
    elif 'osm' in flags:
        classe = 'DO'
    elif doc_acerto:
        classe = 'RUIDO'   # acerto da preparação re-pontuado como ruído pelo orquestrador
    else:
        classe = 'NADA'
    if classe in ('DF', 'DW', 'DO'):
        decisao = 'dirigida'
    elif pop >= 30000:
        decisao = 'media'; classe = 'M'
    elif classe == 'RUIDO':
        # pequeno com "acerto" que é só ruído (ISS, frota, lei orgânica genérica, licitação...). Regra (1) pede 0 acerto:
        # para não resolver direto o que a preparação contou como acerto, vai para lote barato de conferência (DR).
        decisao = 'dirigida'; classe = 'DR'
    else:
        decisao = 'direto'
    cobertura_minima = not d and q is None
    decisoes[i] = {'ibge': i, 'nome': p['nome'], 'uf': uf, 'populacao': pop, 'caminhoes': frota.get(i),
                   'decisao': decisao, 'classe': classe, 'forca_max': best, 'flags': flags,
                   'cobertura_minima': cobertura_minima, 'pistas': pistas,
                   'portal': {'sistema': po.get('sistema'), 'orgao': po.get('orgao'), 'url_busca': po.get('url_busca'),
                              'cliente': po.get('cliente'), 'testado': po.get('testado'),
                              'sistema_prefeitura': po.get('sistema_prefeitura'), 'sistema_camara': po.get('sistema_camara'),
                              'alternativas': [{'orgao': f.get('orgao'), 'sistema': f.get('sistema'), 'url_busca': f.get('url_busca'), 'testado': f.get('testado')}
                                               for f in (po.get('fontes') or [])[1:4]]}}


# ---------------------------------------------------------------- res/ dos diretos
def fontes_consultadas(x):
    i = x['ibge']; f = []
    pei = pe.get(i) or {}
    f.append({'url': 'https://penaestrada.com.br/restricoes-sitemap.xml + seletor de /restricoes/ e sondagem do slug https://penaestrada.com.br/restricoes/%s/ (leads/penaestrada.json)' % (pei.get('slug_sondado') or '?'),
              'resultado': 'penaestrada: sem página do município (índice de 53 páginas, só Florianópolis no Sul/CO; slug sondado: status %s, %s)' % (pei.get('status_sondagem'), pei.get('consultado_em') or HOJE)})
    if i in qd_cov:
        q = qd[i]
        f.append({'url': 'https://api.queridodiario.org.br/gazettes?territory_ids=%s (leads/querido_diario.json)' % i,
                  'resultado': 'Querido Diário (nível %s): 8 termos (caminhões + circulação; "veículos pesados"; "carga e descarga"; VUC; "zona de restrição"; "trânsito pesado"; toneladas + caminhões + trânsito; "veículos de carga"), 10 diários mais relevantes por termo, em %s: %d acerto relevante (%d diários distintos recuperados).'
                            % (q.get('nivel_qd'), HOJE, q.get('acertos_relevantes', 0), q.get('diarios_distintos_recuperados', 0))})
    else:
        f.append({'url': 'https://api.queridodiario.org.br/cities (leads/querido_diario.json, _meta.cobertos_total=187)',
                  'resultado': 'Município sem diário raspado no Querido Diário (fora dos 187 com spider no Sul/CO).'})
    d = dc.get(i)
    if d and d.get('fontes_que_cobrem'):
        for fo in d['fontes_que_cobrem']:
            cv = cob.get(fo, {})
            if fo == 'domsc':
                met = '3 consultas (OR de frases: circulação/tráfego/trânsito de caminhões, veículos pesados, veículos de carga, VUC | carga e descarga, zona de restrição, trânsito/tráfego pesado, veículo urbano de carga | caminhões/caminhão/carretas/bitrem) x categorias Leis, Decretos, Portarias, Instrução Normativa, Resoluções da Prefeitura, desde 01/01/2000 (até 200 por consulta), + varredura global de 16 termos'
            elif fo == 'qd':
                met = 'varredura por cidade com 4 frases, 1 página de 10 diários (via diarios_consolidados.py)'
            else:
                met = 'SIGPub, busca E-lógica por palavras: 8 termos (caminhões circulação, veículos pesados, veículos carga, carga descarga, zona restrição, trânsito pesado, VUC, toneladas caminhões) x Prefeitura/Câmara, 25 mais relevantes por termo, + varredura global de 16 termos (até 1.000 por consulta)'
            f.append({'url': '%s (toolkit/diarios_consolidados.py; leads/diarios_consolidados.json)' % (cv.get('url') or fo),
                      'resultado': '%s — %s, em %s.' % ((cv.get('descricao') or fo)[:140], met, HOJE)})
        f[-1]['resultado'] += ' Resultado consolidado: %d acerto(s), %d indício(s).' % (d.get('acertos', 0), d.get('n_indicios', 0))
    else:
        f.append({'url': 'leads/diarios_consolidados.json (_meta.sem_diario_consolidado)',
                  'resultado': 'Município sem cobertura em nenhum diário consolidado varrido (DOM/SC, FAMURS, AMP, AGM, FGM, AMM-MT, Diário MS).'})
    oi = osm_info(i)
    if oi:
        f.append({'url': 'osm_hints_por_municipio.json (contagem de vias com hgv=no, hgv:conditional, maxweight, maxlength e outras condicionais)',
                  'resultado': 'Contagens %s, todas em rodovia estadual/federal (ref) ou etiqueta não restritiva: fora da competência municipal; descartado como pista.' % json.dumps(oi['contagens'])})
    else:
        f.append({'url': 'osm_hints_por_municipio.json (contagem de vias com hgv=no, hgv:conditional, maxweight, maxlength e outras condicionais)',
                  'resultado': 'Nenhuma etiqueta contada no município.'})
    return f


def grava_res(x):
    path = os.path.join(C, 'res', x['ibge'] + '.json')
    if os.path.exists(path):
        return False
    po = x['portal']
    obs = ('Resolvido na triagem R1 (orquestrador), sem pesquisa dirigida: município pequeno (%s hab.) sem nenhuma pista nas fontes da preparação '
           '(índice do Pé na Estrada, Querido Diário, diários consolidados e OSM). O portal de legislação mapeado (%s, %s) NÃO foi consultado com termos de caminhão. '
           '"Não achou" não prova que não exista regra.') % (x['populacao'], po.get('sistema'), po.get('url_busca'))
    if x['cobertura_minima']:
        obs += ' Cobertura mínima: nenhum diário oficial do município foi varrido (fora dos diários consolidados e do Querido Diário).'
    r = {'ibge': x['ibge'], 'nome': x['nome'], 'uf': x['uf'], 'status': 'nao_achou', 'nivel_busca': 'varredura_consolidada',
         'falha_de_fonte': False, 'data': HOJE, 'fontes_consultadas': fontes_consultadas(x), 'observacoes': obs,
         'osm_divergencias': [], 'regras_rascunho': [],
         'triagem': {'rodada': 'R1', 'decisao': 'direto', 'populacao': x['populacao'], 'caminhoes': x['caminhoes'],
                     'diarios_que_cobrem': (dc.get(x['ibge']) or {}).get('fontes_que_cobrem', []),
                     'no_querido_diario': x['ibge'] in qd_cov, 'cobertura_minima': x['cobertura_minima'],
                     'n_indicios_diario': (dc.get(x['ibge']) or {}).get('n_indicios', 0),
                     'osm_so_rodovia': 'osm_so_rodovia' in x['flags'],
                     'portal_nao_consultado': {k: po.get(k) for k in ('sistema', 'orgao', 'url_busca', 'cliente', 'testado')}}}
    if (dc.get(x['ibge']) or {}).get('n_indicios'):
        r['triagem']['indicios_diario'] = x['pistas'].get('diarios_consolidados', {}).get('top', [])[:2]
    json.dump(r, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return True


# ---------------------------------------------------------------- lotes
FOCO = {
    'DF': 'DIRIGIDA, pista documental FORTE (trecho de lei/decreto com proibição/restrição de caminhões ou veículos pesados): abrir o ato citado, achar o texto integral, conferir número, artigo, alvo, horários, vias e vigência (até ~25 min/cidade)',
    'DW': 'DIRIGIDA, pista documental FRACA (trecho com caminhão + circulação, mas com cara de plano diretor/código de posturas/lei de trânsito genérica): conferir o trecho em 1-2 min; se for ruído, busca padrão no portal e concluir (até ~10 min/cidade)',
    'DO': 'DIRIGIDA, só OSM (hgv=no/maxweight/maxlength em via sem ref de rodovia): Overpass na área do município, descartar heliponto/rodovia/ponte DER-DNIT, buscar ato pelo nome da via no portal e diário (até ~10 min/cidade)',
    'DR': 'CONFERÊNCIA BARATA: a preparação contou "acerto" mas o orquestrador re-pontuou como RUÍDO (ISS, frota, motorista, lei orgânica/código genérico, licitação, plano diretor). Ler os trechos anotados (1 min), rodar 1 busca de portal + 1 de diário; nada concreto -> nao_achou (até ~5 min/cidade)',
    'M': 'MÉDIA, 30-100 mil hab. sem pista: legislacao.py buscar (todas as fontes) + diarios_consolidados.py buscar "circulação de caminhões"/"trânsito de caminhões"/"veículos pesados"; abrir só ementas promissoras (até ~8 min/cidade)',
}
ORD = ['DF', 'DW', 'DO', 'DR', 'M']


def chunks(lst, mn=12, mx=20):
    n = len(lst)
    if n <= mx:
        return [lst]
    k = math.ceil(n / mx)
    if n // k < mn:          # ex.: 21 -> um lote de 21 em vez de 11+10
        k -= 1
    base, extra = divmod(n, k)
    out = []; pos = 0
    for j in range(k):
        sz = base + (1 if j < extra else 0)
        out.append(lst[pos:pos + sz]); pos += sz
    return out


fila_dir = os.path.join(C, 'fila'); os.makedirs(fila_dir, exist_ok=True)
lotes = []
por_uf_classe = collections.defaultdict(list)
for x in decisoes.values():
    if x['decisao'] != 'direto':
        por_uf_classe[(x['uf'], x['classe'])].append(x)
for uf in sorted({k[0] for k in por_uf_classe}):
    # grupos pequenos (<12) da mesma UF juntam-se num lote misto DX; se o DX ainda ficar < 12, entra no menor grupo restante
    grupos = {c: por_uf_classe.get((uf, c), []) for c in ORD}
    mistos = []
    for c in ORD:
        if 0 < len(grupos[c]) < 12:
            mistos += grupos[c]; grupos[c] = []
    if mistos:
        if len(mistos) < 12 and any(grupos.values()):
            alvo = min((c for c in ORD if grupos[c]), key=lambda c: len(grupos[c]))
            grupos['DX'] = grupos.pop(alvo) + mistos
        else:
            grupos['DX'] = mistos
    for c in ['DF', 'DW', 'DO', 'DX', 'DR', 'M']:
        cs = grupos.get(c) or []
        if not cs:
            continue
        cs.sort(key=lambda x: (ORD.index(x['classe']) if c == 'DX' else 0, familia(x['portal']['sistema']), -x['populacao']))
        for n, ch in enumerate(chunks(cs), 1):
            lid = 'R1-%s-%s%02d' % (uf, c, n)
            sist = collections.Counter(familia(x['portal']['sistema']) for x in ch)
            classes = collections.Counter(x['classe'] for x in ch)
            foco = '%s — %s; %d cidades (%d hab.; maior: %s %d); sistemas: %s' % (
                lid, FOCO.get(c, 'DIRIGIDA, lote misto (classes %s): seguir o foco de cada classe — ' % dict(classes) + ' | '.join('%s: %s' % (k, FOCO[k]) for k in classes)),
                len(ch), sum(x['populacao'] for x in ch), max(ch, key=lambda x: x['populacao'])['nome'],
                max(x['populacao'] for x in ch), ', '.join('%s %d' % kv for kv in sist.most_common()))
            cidades = []
            for x in ch:
                nota = {'DF': 'pista forte', 'DW': 'pista fraca', 'DO': 'só OSM', 'DR': 'acerto re-pontuado como ruído', 'M': 'média sem pista'}[x['classe']]
                top = (x['pistas'].get('diarios_consolidados') or {}).get('top') or (x['pistas'].get('querido_diario') or {}).get('top') or []
                if top and x['classe'] in ('DF', 'DW', 'DR'):
                    t = top[0]
                    nota += ': %s %s "%s" %s' % (t.get('fonte'), t.get('data'), (t.get('titulo') or t.get('trecho', ''))[:110], t.get('url'))
                elif x['classe'] == 'DO':
                    oi = x['pistas']['osm']; nota += ': %s; ex.: %s' % (json.dumps(oi['contagens']), '; '.join('%s %s' % (e['nome'], e['tags']) for e in oi['exemplos'][:2]))
                if 'osm' in x['flags'] and x['classe'] != 'DO':
                    nota += ' | também OSM %s' % json.dumps(x['pistas']['osm']['contagens'])
                if x['cobertura_minima']:
                    nota += ' | sem diário consolidado nem QD: só portal/site'
                cidades.append({'ibge': x['ibge'], 'nome': x['nome'], 'uf': x['uf'], 'populacao': x['populacao'], 'caminhoes': x['caminhoes'],
                                'classe': x['classe'], 'flags': x['flags'], 'pistas': x['pistas'], 'portal': x['portal'], 'nota': nota})
            lote = {'id': lid, 'rodada': 'R1', 'tipo': 'media' if c == 'M' else 'dirigida', 'classe': c, 'uf': uf, 'foco': foco,
                    'sistemas': dict(sist), 'guia': os.path.join(C, 'GUIA.md'), 'cidades': cidades}
            json.dump(lote, open(os.path.join(fila_dir, lid + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            lotes.append({'id': lid, 'foco': foco, 'ibges': [x['ibge'] for x in ch], 'classe': c, 'uf': uf})

gravados = 0
if GRAVAR:
    for x in decisoes.values():
        if x['decisao'] == 'direto' and grava_res(x):
            gravados += 1

json.dump({i: {k: v for k, v in x.items() if k != 'pistas'} for i, x in decisoes.items()},
          open(os.path.join(C, 'triagem_r1.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
cont = collections.Counter((x['decisao'], x['classe']) for x in decisoes.values())
resumo = {'gerado_em': HOJE, 'triados': len(decisoes), 'fora_profunda': len(deep), 'res_pre_existentes': len(ja_res),
          'contagem': {'%s/%s' % k: v for k, v in sorted(cont.items())},
          'por_uf': {uf: dict(collections.Counter('%s/%s' % (x['decisao'], x['classe']) for x in decisoes.values() if x['uf'] == uf)) for uf in sorted({x['uf'] for x in decisoes.values()})},
          'res_gravados_agora': gravados, 'lotes': lotes}
json.dump(resumo, open(os.path.join(C, 'fila_r1_resumo.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in resumo.items() if k != 'lotes'}, ensure_ascii=False, indent=1))
for l in lotes:
    print(l['id'], len(l['ibges']))
