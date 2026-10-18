"""Assinaturas de sistemas de legislação / plataformas e extração de links de legislação."""
import re
from urllib.parse import urljoin, urlparse

# (sistema, regex em HTML+URL final)  — ordem importa (mais específico primeiro)
ASSIN = [
 ('leismunicipais', r'leismunicipais\.com\.br|leis\.org|leismunicipais'),
 ('cespro', r'cespro\.com\.br|pesquisaLegislacao\.php'),
 ('legislacaodigital', r'legislacaodigital\.com\.br|Legisla[çc][ãa]o Digital'),
 ('legislacaocompilada', r'legislacaocompilada\.com\.br'),
 ('nopapercloud', r'nopapercloud\.com\.br'),
 ('spl', r'camarasempapel\.com\.br|splonline\.com\.br|/legislacao/\?|txt_termo|Sistema de Processo Legislativo'),
 ('sapl', r'\bsapl\b|/api/norma/|sapl[-_ ]?(?:version|interlegis)|Interlegis'),
 ('siscam', r'siscam\.com\.br|Sino Siscam|\bsiscam\b'),
 ('instar', r'/portal/leis_decretos|instar\.com\.br|Instar Tecnologia'),
 ('atende', r'atende\.net|ipm\.com\.br|IPM Sistemas|Atende\.Net'),
 ('betha', r'betha\.cloud|betha\.com\.br|Betha Sistemas|e-gov\.betha|\bbetha\b'),
 ('elotech', r'elotech\.com\.br|Elotech|oxy\.elotech'),
 ('equiplano', r'equiplano'),
 ('fiorilli', r'fiorilli'),
 ('1doc', r'1doc\.com\.br|\b1doc\b'),
 ('webline', r'wls\.com\.br|Webline|idtipolei='),
 ('portalfacil', r'leg_lis|portalfacil|Portal F[áa]cil'),
 ('legislacoes_dt', r'/legislacoes/get/todas|legislacoes/get'),
 ('docman', r'com_docman|DOCman'),
 ('plenus', r'plenus'),
 ('govbr', r'govbr\.com\.br|GovBr Tecnologia|Govbr|gov\.br/transparencia'),
 ('dominio', r'dominiosistemas|dominio\.com\.br'),
 ('memory', r'memory\.com\.br|Memory Sistemas'),
 ('abase', r'abase\.com\.br|Abase Sistemas'),
 ('pmpr_pe', r'portaldotransparencia|transparencia\.pr\.gov\.br'),
]
PLAT = [('wordpress', r'wp-content|wp-includes|WordPress'), ('joomla', r'/media/jui/|Joomla'), ('drupal', r'Drupal'),
        ('wix', r'wix\.com|wixstatic'), ('govbr_ds', r'gov\.br/ds|govbr-ds')]
LEG_TXT = re.compile(r'legisla|\bleis?\b|decretos?|normas?\b|atos oficiais|atos normativos|lei org', re.I)
LEG_HREF = re.compile(r'legisla|leis|decreto|normas|atos|leismunicipais|sapl|siscam|cespro|compilada', re.I)
A_RE = re.compile(r'<a\b[^>]*?href\s*=\s*["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)</a>', re.I | re.S)

def vendors(html, url=''):
    t = (url or '') + ' ' + (html or '')
    out = []
    for n, rx in ASSIN:
        if re.search(rx, t, re.I):
            out.append(n)
    return out

def plataforma(html):
    for n, rx in PLAT:
        if re.search(rx, html or '', re.I):
            return n
    return ''

def links_leg(html, base):
    """links candidatos a legislação: lista de (url, texto, score)."""
    res = {}
    for m in A_RE.finditer(html or ''):
        href, txt = m.group(1).strip(), re.sub(r'<[^>]+>|\s+', ' ', m.group(2)).strip()[:80]
        if href.lower().startswith(('javascript', 'mailto', 'tel')):
            continue
        u = urljoin(base, href.replace('&amp;', '&'))
        sc = 0
        if re.search(r'legisla', txt, re.I): sc += 5
        if re.search(r'^(leis?( municipais)?|decretos?|leis e decretos|leis e atos|atos oficiais|normas)$', txt, re.I): sc += 4
        if re.search(r'legisla', href, re.I): sc += 4
        if re.search(r'leismunicipais|sapl|siscam|cespro|legislacaocompilada|legislacaodigital|/leis|leis_decretos', href, re.I): sc += 3
        if re.search(r'paulo gustavo|aldir|agenda|projetos?\b|processo|licita|concurs|vereador|not[ií]cia|lgpd|ouvidoria|conselho|cultur|or[cç]ament|plano|audi[eê]ncia|sess[aã]o|ordem do dia|pauta|diario|di[aá]rio|publica[cç][aã]o', txt + ' ' + href, re.I) and not re.search(r'^(legisla[cç][aã]o|leis?|decretos?|leis e decretos|legisla[cç][aã]o municipal|leis municipais)$', txt, re.I):
            sc -= 6
        if re.search(r'/(legisla[cç][aã]o(-municipal)?|leis?(-municipais)?|leis-e-decretos|atos-normativos)/?$', urlparse(u).path, re.I): sc += 3
        if re.search(r'^(legisla[cç][aã]o( municipal)?|leis( municipais)?|leis e decretos|leis e atos|atos normativos)$', txt, re.I): sc += 3
        if sc >= 4 and not re.search(r'\.(pdf|jpg|png|docx?)$', u, re.I):
            if u not in res or res[u][1] < sc:
                res[u] = (txt, sc)
    return sorted(((u, t, s) for u, (t, s) in res.items()), key=lambda x: -x[2])
