#!/usr/bin/env python3
"""Cliente Elotech Oxy / eloweb (Portal da Transparência) - somente leitura.
Uso:
  python3 elotech.py sonda <slug>                      # acha host (<slug>.eloweb.net | <slug>.oxy.elotech.com.br) e entidades
  python3 elotech.py buscar <host> "caminh,pesad,tonel" [--ano 2025] [--ent 1,2]   # ementas (sumula/descricao) por substring
  python3 elotech.py pdf <host> <entidade> <id> <saida.pdf>   # baixa o PDF do ato (detalhes &sistema=C -> arquivos[].idArquivo)
Notas: API /portaltransparencia-api/api/leisatos?entidade=&exercicio=&subAbaLeiAtos=geral&descricaoSumula=&natureza=&page=&size=
 - 'exercicio' é OBRIGATÓRIO (sem ele: HTTP 400). Ver README para a semântica.
 - 'descricaoSumula' = substring (sensível a acento). O servidor às vezes demora > 60 s: use timeout alto e repita.
"""
import json, subprocess, sys, time, unicodedata, re
from urllib.parse import urlencode

def slug(n):
    s = unicodedata.normalize('NFKD', n).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)

def get(url, timeout=120, tent=3, binario=False):
    for i in range(tent):
        r = subprocess.run(['curl', '-sS', '-m', str(timeout), '-H', 'Accept: application/json', '-w', '\n%{http_code}', url], capture_output=True)
        corpo, _, cod = r.stdout.rpartition(b'\n')
        if cod == b'200':
            return corpo if binario else corpo.decode('utf-8', 'replace')
        if cod.startswith(b'4'):
            return None
        time.sleep(2)
    return None

def sonda(s):
    for host in ('%s.eloweb.net' % s, '%s.oxy.elotech.com.br' % s):
        for pref in ('/portaltransparencia-api/api', '/portaltransparencia/api'):
            b = get('https://%s%s/entidades' % (host, pref), timeout=20, tent=1)
            if b and b.lstrip().startswith('['):
                return host, pref, json.loads(b)
    return None

def leis(host, ent, ano, termo='', natureza=None, pref='/portaltransparencia-api/api', size=100, maxpag=50):
    out = []
    for pag in range(maxpag):
        q = {'entidade': ent, 'exercicio': ano, 'subAbaLeiAtos': 'geral', 'page': pag, 'size': size}
        if termo: q['descricaoSumula'] = termo
        if natureza: q['natureza'] = natureza
        b = get('https://%s%s/leisatos?%s' % (host, pref, urlencode(q)))
        if not b: break
        d = json.loads(b)
        out += d.get('content', [])
        if d.get('last', True) or not d.get('content'): break
    return out

def detalhes(host, ent, id_, ano, pref='/portaltransparencia-api/api'):
    q = urlencode({'entidade': ent, 'id': id_, 'exercicio': ano, 'sistema': 'C'})
    b = get('https://%s%s/leisatos/detalhes?%s' % (host, pref, q))
    return json.loads(b) if b else None

def baixa_pdf(host, idarq, saida, pref='/portaltransparencia-api/api'):
    b = get('https://%s%s/files/arquivo/%s' % (host, pref, idarq), binario=True, timeout=180)
    if b:
        open(saida, 'wb').write(b)
    return bool(b)

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'sonda':
        print(sonda(a[1]))
    elif a[0] == 'buscar':      # buscar <host> "t1,t2" [ent,ent]
        host = a[1]; ents = (a[3] if len(a) > 3 else '1').split(',')
        for e in ents:
            vistos = {}
            for t in a[2].split(','):
                for c in leis(host, e, 2025, t):
                    vistos[c['id']] = c
            for c in sorted(vistos.values(), key=lambda c: (c.get('exercicio') or 0)):
                print(e, c['id'], c.get('natureza'), c.get('numero'), c.get('exercicio'), (c.get('sumula') or c.get('descricao') or '').replace('\n', ' ')[:160], sep=' | ')
    elif a[0] == 'pdf':         # pdf <host> <ent> <id> <ano> <saida-prefixo>
        d = detalhes(a[1], a[2], a[3], a[4])
        for i, arq in enumerate((d or {}).get('arquivos') or []):
            print(arq.get('nomeArquivo'), baixa_pdf(a[1], arq['idArquivo'], '%s_%d.pdf' % (a[5], i)))
