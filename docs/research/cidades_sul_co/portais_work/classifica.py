"""Classifica o sistema de legislação de prefeitura e câmara de cada município -> classif.json (lê só caches; sem rede)."""
import json, os, re, collections
from urllib.parse import urlparse
import common
from common import *
from fp import links_leg
import descobrir, descobrir2
common.carrega_cache()
S = json.load(open(os.path.join(AQUI, 'sites.json'))); M = {m['ibge']: m for m in municipios()}

URL_RULES = [
 ('leismunicipais', r'leismunicipais\.com\.br|//(www\.)?leis\.org|\.leis\.org'),
 ('cespro', r'cespro\.com\.br'),
 ('cittatec', r'cittatec\.com\.br'),
 ('nucleogov', r'nucleogov|//acessoainformacao\.[^/]+/(cidadao/)?(legislacao|atos)'),
 ('mpx', r'//transparencia\.[a-z0-9-]+\.[a-z]{2}\.gov\.br/Legislacao'),
 ('atende', r'\.atende\.net'),
 ('elotech', r'eloweb\.net|elotech\.com\.br'),
 ('megasoft', r'megasoft'),
 ('legislador', r'legislador\.com\.br'),
 ('legislacaomunicipal', r'legislacaomunicipal\.com'),
 ('legissuper', r'legissuper\.com\.br'),
 ('leisnaweb', r'leisnaweb\.com\.br'),
 ('sinsoft', r'sinsoft\.com\.br'),
 ('cr2', r'portalcr2\.com\.br|cr2\.site'),
 ('betha', r'betha\.cloud|betha\.com\.br|e-gov\.betha'),
 ('equiplano', r'equiplano\.(cloud|com)'),
 ('epublica', r'e-publica\.net'),
 ('sicam', r'sicam\.app'),
 ('cidade360', r'cidade360'),
 ('digifred', r'digifred'),
 ('1doc', r'\.1doc\.com\.br'),
 ('siscam', r'siscam\.com\.br'),
 ('legislacaodigital', r'legislacaodigital'),
 ('nopapercloud', r'nopapercloud'),
 ('legislacaocompilada', r'legislacaocompilada'),
 ('spl', r'camarasempapel|splonline'),
 ('sapl', r'//(www\.)?sapl\.|/norma/pesquisar|/materia/pesquisar-materia|/api/norma'),
 ('instar', r'/portal/leis_decretos'),
 ('webline', r'wls\.com\.br|idtipolei='),
]
ESPEC = ['sapl', 'siscam', 'instar', 'spl', 'nopapercloud', 'legislacaocompilada', 'legislacaodigital', 'elotech', 'webline', 'leismunicipais',
         'cespro', 'nucleogov', 'mpx', 'cittatec', 'leisnaweb', 'legislador', 'legislacaomunicipal', 'legissuper', 'megasoft', 'sinsoft', 'cr2']
SAAS = ['atende', 'betha', 'equiplano', 'epublica', 'sicam', 'cidade360', 'digifred', '1doc']
def ordem(s):
    if s in ESPEC: return (1, ESPEC.index(s))
    if s in SAAS: return (2, SAAS.index(s))
    return (3, 0)

IGNORAR = re.compile(r'planalto\.gov|presidencia\.gov|youtube|instagram|facebook|google\.|//ww\d\.al\.rs|alesc\.|assembleia|legislacao\.pr\.gov|ms\.gov\.br/appls|senado|camara\.leg\.br|stf\.|wikipedia|\.jus\.br|tce[a-z]*\.|\.mp[a-z]{2}\.|twitter|whatsapp|//x\.com|gov\.br/(pt-br|ccivil|lai)|lexml|conam', re.I)
BLOQ = re.compile(r'Bot Verification|Attention Required|Just a moment|Access Denied|Confirma..o de seguran', re.I)
PLAT = [('plone/interlegis', r'portal_css|\+\+resource\+\+|Plone|Interlegis'), ('wordpress', r'wp-content|wp-includes'), ('joomla', r'Joomla|com_content'),
        ('drupal', r'Drupal'), ('wix', r'wixstatic'), ('softcam', r'data-versao="softcam|softcam'), ('react/angular spa', r'<app-root|id="root"')]
def plat(h):
    for n, rx in PLAT:
        if re.search(rx, h or '', re.I): return n
    return ''

def sistema_url(u):
    for n, rx in URL_RULES:
        if re.search(rx, u, re.I): return n
    return None

def base_de(sis, url):
    p = urlparse(url); o = f'{p.scheme}://{p.netloc}'
    if sis in ('sapl', 'siscam', 'spl', 'nopapercloud', 'legislacaocompilada', 'legislacaodigital', 'instar', 'elotech', 'atende', 'webline'):
        return o
    return url

def analisa(m, org):
    ents = S[m['ibge']][org]
    r = {'sistema': None, 'url_busca': None, 'base': None, 'home': None, 'plataforma': '', 'evidencia': [], 'alternativas': [], 'status': 'sem_site', 'verificar': False}
    if not ents: return r
    r['verificar'] = any(e.get('verificar') for e in ents[:1])
    cand = []   # (ordem, sistema, url, evidencia)
    r['status'] = 'bloqueado'
    for e in ents[:3]:
        rec = common._cache.get(e['req'])
        if not rec: continue
        hu = rec['final']
        s0 = sistema_url(hu)
        if s0: cand.append((ordem(s0), s0, hu, 'home'))
        h = common.html_de(rec) if rec['h'] else ''
        if rec['status'] == 200 and h and not BLOQ.search(rec['title']):
            r['status'] = 'ok'
            r['home'] = r['home'] or hu
            r['plataforma'] = r['plataforma'] or plat(h[:250000])
            for u, t, sc in links_leg(h, hu)[:6]:
                if IGNORAR.search(u): continue
                rr = common._cache.get(u)
                fin = rr['final'] if rr and rr['status'] else u
                s1 = sistema_url(fin) or sistema_url(u)
                if s1:
                    cand.append((ordem(s1), s1, fin, 'link:' + t[:30]))
                elif rr and rr['status'] == 200 and urlparse(fin).hostname == urlparse(hu).hostname:
                    cand.append(((3, 0), '_interno', fin, 'link:' + t[:30]))
            # hosts SAPL linkados em qualquer parte da home
            for mm in set(re.findall(r'https?://(sapl\.[a-z0-9.-]+\.(?:leg|gov)\.br)', h)):
                cand.append((ordem('sapl'), 'sapl', 'https://' + mm, 'link:sapl'))
        elif rec['status'] in (200, 403):
            r['home'] = r['home'] or hu
            r['evidencia'].append('desafio/bloqueio:%s' % rec['status'])
        elif rec['status']:
            pass
    # SAPL por padrão de host (câmara): sapl.<slug>.<uf>.leg.br vivo
    if org == 'camara':
        for k, u in descobrir.cands(m)[1]:
            if re.match(r'https://(www\.)?sapl\.', u):
                rec = common._cache.get(u)
                if rec and rec['status'] == 200 and rec['h'] and re.search(r'sapl|SAPL', common.html_de(rec)[:200000]) and not BLOQ.search(rec['title']):
                    cand.append((ordem('sapl'), 'sapl', rec['final'], 'dns:sapl'))
    # SaaS detectado só por host candidato (atende/1doc/siscam/cittatec...) para órgão
    for k, u in (descobrir.cands(m)[0] if org == 'prefeitura' else descobrir.cands(m)[1]):
        rec = common._cache.get(u)
        if rec and rec['status'] == 200 and not BLOQ.search(rec['title']):
            s2 = sistema_url(rec['final'])
            if s2 in SAAS + ESPEC:
                cand.append((ordem(s2), s2, rec['final'], 'dns'))
    if cand:
        cand.sort(key=lambda c: (c[0], 0 if c[3].startswith(('link', 'dns:sapl')) else 1))
        best = cand[0]
        r['sistema'], r['url_busca'] = best[1], best[2]
        if best[1] == '_interno':
            r['sistema'] = 'portal_proprio'
        r['evidencia'].append(best[3])
        seen = {(best[1], urlparse(best[2]).netloc)}
        for c in cand[1:]:
            k = (c[1], urlparse(c[2]).netloc)
            if k not in seen and len(r['alternativas']) < 5:
                seen.add(k); r['alternativas'].append({'sistema': 'portal_proprio' if c[1] == '_interno' else c[1], 'url': c[2], 'ev': c[3]})
    else:
        if r['status'] == 'ok':
            r['sistema'] = 'portal_proprio'; r['url_busca'] = r['home']; r['evidencia'].append('sem link de legislação achado na home')
        elif r['home']:
            r['sistema'] = 'desconhecido'; r['url_busca'] = r['home']
    if r['sistema']:
        r['base'] = base_de(r['sistema'], r['url_busca'])
    return r

def main():
    out = {}
    for ib, m in M.items():
        out[ib] = {'prefeitura': analisa(m, 'prefeitura'), 'camara': analisa(m, 'camara')}
    json.dump(out, open(os.path.join(AQUI, 'classif.json'), 'w'), ensure_ascii=False)
    c = collections.Counter()
    for v in out.values():
        for org in ('prefeitura', 'camara'):
            c[(org, v[org]['sistema'] or v[org]['status'])] += 1
    for k, n in sorted(c.items(), key=lambda x: (x[0][0], -x[1])): print(k, n)
if __name__ == '__main__':
    descobrir.WD = json.load(open(os.path.join(AQUI, 'wikidata_sites.json')))
    main()
