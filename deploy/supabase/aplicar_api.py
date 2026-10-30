#!/usr/bin/env python3
"""Aplica o banco do BrasaWay num projeto Supabase pela API de gerenciamento (HTTPS), sem psql nem porta 5432.

Mesma ordem e mesmos arquivos do `aplicar.sh`: migrations (menos a 0300), seeds, blindagem (9000) e bucket (9100).
Serve para quem não alcança o Postgres direto (rede só HTTPS) ou não tem psql. Com psql e porta 5432, prefira o
`aplicar.sh`, que é transacional por arquivo.

Uso:
  SUPABASE_ACCESS_TOKEN=<token pessoal>  SUPABASE_PROJECT_REF=<ref do projeto>  deploy/supabase/aplicar_api.py
    --sem-seed       só schema
    --desde ARQUIVO  retoma a partir deste arquivo (ex.: db/seed/layers/oae__der-mg.sql)
    --simular        só mostra os lotes, sem rede

  O token é pessoal (supabase.com/dashboard/account/tokens) e dá acesso total à conta: guarde como variável de
  ambiente, nunca no git nem no chat. O ref é o <ref> de https://<ref>.supabase.co.

Arquivos grandes são enviados em lotes de até SUPABASE_LOTE_BYTES (padrão 900 kB), sempre cortados entre comandos
`insert into`/`delete from` (os seeds já vêm em inserts de 500 linhas). Os seeds são idempotentes (delete + insert ...
on conflict do nothing), então dá para rodar de novo depois de uma falha, com --desde.
"""
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
API = 'https://api.supabase.com/v1/projects/{ref}/database/query'
LOTE = int(os.environ.get('SUPABASE_LOTE_BYTES', '900000'))
INICIO_CMD = re.compile(r'^(insert into|delete from) ', re.I)


def arquivos(seed):
    fs = [f for f in sorted((RAIZ / 'db/migrations').glob('*.sql')) if f.name != '0300_frota_auth_shim.sql']
    if seed:
        fs += sorted((RAIZ / 'db/seed').glob('*.sql')) + sorted((RAIZ / 'db/seed/layers').glob('*.sql'))
    fs += [RAIZ / 'deploy/supabase/9000_supabase_hardening.sql', RAIZ / 'deploy/supabase/9100_storage_comprovantes.sql']
    return fs


def comandos(texto):
    """Corta o arquivo onde um comando termina (linha com ';') e o próximo começa com insert/delete."""
    partes, atual, anterior_fecha = [], [], True
    for linha in texto.splitlines(keepends=True):
        if anterior_fecha and atual and INICIO_CMD.match(linha):
            partes.append(''.join(atual))
            atual = []
        atual.append(linha)
        if linha.strip():
            anterior_fecha = linha.rstrip().endswith(';')
    if atual:
        partes.append(''.join(atual))
    return partes


def dividir_insert(cmd):
    """Um `insert ... values` maior que o lote vira vários, com o mesmo cabeçalho e o mesmo `on conflict`.
    Só divide o formato dos seeds (uma linha por registro); qualquer outro comando vai inteiro."""
    linhas = cmd.splitlines(keepends=True)
    cab, linhas_reg, fim = linhas[0], linhas[1:-1], linhas[-1]
    if not (cab.rstrip().endswith('values') and fim.startswith('on conflict')
            and linhas_reg and all(l.startswith('(') for l in linhas_reg)):
        return [cmd]
    regs = [l.rstrip().rstrip(',') for l in linhas_reg]
    partes, atual, tam = [], [], len(cab) + len(fim)
    for r in regs:
        n = len(r.encode()) + 2
        if atual and tam + n > LOTE:
            partes.append(cab + ',\n'.join(atual) + '\n' + fim)
            atual, tam = [], len(cab) + len(fim)
        atual.append(r)
        tam += n
    partes.append(cab + ',\n'.join(atual) + '\n' + fim)
    return partes


def lotes(texto):
    if len(texto.encode()) <= LOTE:
        return [texto]
    saida, atual, tam = [], [], 0
    cmds = [p for c in comandos(texto) for p in (dividir_insert(c) if len(c.encode()) > LOTE else [c])]
    for cmd in cmds:
        n = len(cmd.encode())
        if atual and tam + n > LOTE:
            saida.append(''.join(atual))
            atual, tam = [], 0
        atual.append(cmd)
        tam += n
    if atual:
        saida.append(''.join(atual))
    return saida


def contexto_ssl():
    ca = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE')
    return ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()


def enviar(ref, token, sql, ctx):
    req = urllib.request.Request(
        API.format(ref=ref), data=json.dumps({'query': sql}).encode(), method='POST',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    for tentativa in range(5):
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=600) as r:
                return json.loads(r.read() or b'null')
        except urllib.error.HTTPError as e:
            corpo = e.read().decode(errors='replace')[:800]
            if e.code in (429, 502, 503, 504) and tentativa < 4:
                time.sleep(2 ** (tentativa + 1))
                continue
            raise SystemExit(f'HTTP {e.code}: {corpo}')
        except urllib.error.URLError:
            if tentativa < 4:
                time.sleep(2 ** (tentativa + 1))
                continue
            raise


def main(argv):
    seed = '--sem-seed' not in argv
    simular = '--simular' in argv
    desde = argv[argv.index('--desde') + 1] if '--desde' in argv else None
    ref = os.environ.get('SUPABASE_PROJECT_REF', '')
    token = os.environ.get('SUPABASE_ACCESS_TOKEN', '')
    if not simular and not (ref and token):
        raise SystemExit('defina SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF')
    ctx = None if simular else contexto_ssl()
    fs = arquivos(seed)
    if desde:
        nomes = [str(f.relative_to(RAIZ)) for f in fs]
        if desde not in nomes:
            raise SystemExit(f'--desde: {desde} não está na lista')
        fs = fs[nomes.index(desde):]
    total = 0
    for f in fs:
        ls = lotes(f.read_text(encoding='utf-8'))
        total += len(ls)
        rel = f.relative_to(RAIZ)
        if simular:
            print(f'{rel}: {len(ls)} lote(s), maior {max(len(x.encode()) for x in ls) // 1000} kB')
            continue
        print(f'==> {rel} ({len(ls)} lote(s))', flush=True)
        for i, sql in enumerate(ls, 1):
            try:
                enviar(ref, token, sql, ctx)
            except SystemExit as e:
                raise SystemExit(f'{rel}, lote {i}/{len(ls)}: {e}\nPara retomar: --desde {rel}')
    if simular:
        print(f'{len(fs)} arquivos, {total} lotes')
        return
    r = enviar(ref, token, "select pg_size_pretty(pg_database_size(current_database())) as banco", ctx)
    print('banco:', r[0]['banco'] if r else '?')
    print('Supabase OK')


if __name__ == '__main__':
    main(sys.argv[1:])
