#!/usr/bin/env python3
"""Fechamento Sul/CO: consolida res/ e verif/ em varredura_final.json, falhas_de_fonte.json,
osm_divergencias.json e RESUMO.md.

Uso: python3 consolidar_final.py   (de qualquer lugar)
Grava res/<ibge>.json "nao_achou" (falha_de_fonte=true) para município do CSV sem resultado.
"""
import collections
import glob
import json
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
HOJE = '2026-10-18'
RE_FALHA = re.compile(r'403|404|429|5\d\d\b|HTTP 000|bloque|inacess|indispon|n[ãa]o consultad|n[ãa]o lid|reCAPTCHA|'
                      r'Cloudflare|Akamai|timeout|sem cliente|sem busca|login|JS\b|javascript|stub|vazi', re.I)
RE_SEM_PORTAL = re.compile(r'sem (site|portal) de legisla|sem site de legisla|n[ãa]o (publica|h[áa] portal|tem portal)|'
                           r'sem portal|nenhum portal|portal de legisla[çc][ãa]o n[ãa]o (encontrado|localizado|achado)', re.I)
RE_IP = re.compile(r'403|Cloudflare|Akamai|IP da nuvem|rede do usu', re.I)


def carregar(pasta):
    out = {}
    for f in glob.glob(os.path.join(BASE, pasta, '*.json')):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception as e:
            print('ERRO lendo', f, e)
            continue
        out[str(d.get('ibge') or os.path.basename(f)[:-5])] = d
    return out


def ativas(d):
    return [r for r in d.get('regras_rascunho') or [] if r.get('status') == 'ativa']


def sistema(d):
    t = d.get('triagem')
    if isinstance(t, dict):
        return (t.get('portal_nao_consultado') or {}).get('sistema')
    return None


def motivo_falha(d):
    obs = d.get('observacoes') or ''
    m = re.search(r'R3 20\d\d-\d\d-\d\d:.*', obs)
    if m:
        txt = m.group(0)
    else:
        frases = [s for s in re.split(r'(?<=[.;|])\s+', obs) if RE_FALHA.search(s)]
        txt = ' '.join(frases[:2]) or obs
    return txt[:500]


def classifica_osm(x):
    s = json.dumps(x, ensure_ascii=False)
    neg = re.search(r'(nenhuma|sem|n[ãa]o h[áa]) diverg', s, re.I)
    if not neg and re.search(r'revogad|diverg[êe]ncia inversa|n[ãa]o aparecem? (no OSM|com restri)|n[ãa]o trazem hgv|'
                             r'OSM hgv=no divergen|Diverg[êe]ncia: o ato', s, re.I):
        return 'contra_ato'
    if neg and not re.search(r'hgv=no|maxweight=', s, re.I):
        return 'nao_conferida'
    if re.search(r'descartad|fora da compet|compet[êe]ncia (DER|DNIT|federal|estadual)|rodovia (estadual|federal)|'
                 r'ponte internacional|sem diverg|nenhuma diverg|nenhuma restri', s, re.I):
        return 'descartada'
    if re.search(r'hgv|maxweight|maxlength|way', s, re.I) and \
            re.search(r'sem ato|nenhum ato|n[ãa]o .*respald|sem ato municipal|n[ãa]o localizad|n[ãa]o encontrad|pista', s, re.I):
        return 'sem_ato'
    if re.search(r'n[ãa]o consultad|Overpass indispon', s, re.I) and not re.search(r'hgv=no|maxweight=', s, re.I):
        return 'nao_conferida'
    if re.search(r'hgv|maxweight|maxlength|way \d', s, re.I):
        return 'sem_ato'
    return 'nao_conferida'


def main():
    linhas = [l.split(';') for l in open(os.path.join(BASE, 'municipios.csv'), encoding='utf-8').read().splitlines() if l]
    linhas = [l for l in linhas if l[0].isdigit()]
    res = carregar('res')
    gravados = []
    for ib, nome, uf in linhas:
        if ib in res:
            continue
        d = {'ibge': ib, 'nome': nome, 'uf': uf, 'status': 'nao_achou', 'nivel_busca': 'nenhum',
             'falha_de_fonte': True, 'fontes_consultadas': [], 'data': HOJE,
             'observacoes': 'Fechamento: nenhum resultado gravado por nenhuma rodada (agente não concluiu); '
                            'negativo não conclusivo.', 'osm_divergencias': [], 'regras_rascunho': []}
        json.dump(d, open(os.path.join(BASE, 'res', f'{ib}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        res[ib] = d
        gravados.append(ib)
    ver = carregar('verif')
    csv_ib = {l[0] for l in linhas}
    res = {k: v for k, v in res.items() if k in csv_ib}

    # (1) varredura_final
    varredura = [{'ibge': d['ibge'], 'nome': d.get('nome'), 'uf': d.get('uf'), 'status': d.get('status'),
                  'nivel_busca': d.get('nivel_busca'), 'falha_de_fonte': bool(d.get('falha_de_fonte')),
                  'fontes': [f.get('url') for f in d.get('fontes_consultadas') or []][:10], 'data': d.get('data')}
                 for d in sorted(res.values(), key=lambda x: x['ibge']) if not ativas(d)]
    json.dump(varredura, open(os.path.join(BASE, 'varredura_final.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # (2) falhas_de_fonte
    falhas = []
    for d in sorted(res.values(), key=lambda x: x['ibge']):
        if not d.get('falha_de_fonte'):
            continue
        ff = [f.get('url') for f in d.get('fontes_consultadas') or [] if RE_FALHA.search(f.get('resultado') or '')]
        falhas.append({'ibge': d['ibge'], 'nome': d.get('nome'), 'uf': d.get('uf'), 'status': d.get('status'),
                       'nivel_busca': d.get('nivel_busca'), 'sistema_legislacao': sistema(d),
                       'motivo': motivo_falha(d), 'fontes_que_falharam': ff[:8]})
    json.dump(falhas, open(os.path.join(BASE, 'falhas_de_fonte.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # (3) osm_divergencias
    div, descart = [], collections.Counter()
    for d in sorted(res.values(), key=lambda x: x['ibge']):
        for x in d.get('osm_divergencias') or []:
            tipo = classifica_osm(x)
            if tipo in ('descartada', 'nao_conferida'):
                descart[tipo] += 1
                continue
            e = {'ibge': d['ibge'], 'nome': d.get('nome'), 'uf': d.get('uf'), 'tipo': tipo,
                 'status_cidade': d.get('status')}
            if isinstance(x, dict):
                e['osm'] = {k: x[k] for k in ('way_id', 'nome', 'tags', 'via', 'osm', 'tag') if k in x}
                e['evidencia'] = x.get('nota') or x.get('ato')
            else:
                e['evidencia'] = x
            e['atos_vigentes'] = [{'regra': r.get('id'), 'ato': b.get('ato'), 'url': b.get('url')}
                                  for r in ativas(d) for b in (r.get('base_legal') or [])][:5]
            e['verificado'] = ver.get(d['ibge'], {}).get('veredito')
            e['fonte_osm'] = 'osm_hints_por_municipio.json / Overpass (ver res/%s.json)' % d['ibge']
            div.append(e)
    json.dump({'_meta': {'data': HOJE, 'criterio': 'Entradas osm_divergencias dos res/: tag OSM de restrição a caminhões '
                         '(hgv=no, hgv:conditional, maxweight, maxlength) sem ato municipal localizado (sem_ato) ou em '
                         'desacordo com ato vigente/revogado (contra_ato). Excluídas: rodovias estaduais/federais e pontes '
                         'internacionais (fora da competência municipal) e notas de OSM não consultado.',
                         'total': len(div), 'por_tipo': dict(collections.Counter(e['tipo'] for e in div)),
                         'excluidas': dict(descart)},
               'divergencias': div}, open(os.path.join(BASE, 'osm_divergencias.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    # (4) RESUMO.md
    st = collections.Counter(d.get('status') for d in res.values())
    nivel = collections.Counter(d.get('nivel_busca') for d in res.values())
    por_uf = collections.defaultdict(collections.Counter)
    for d in res.values():
        por_uf[d.get('uf')][d.get('status')] += 1
    com_regra = sorted((d for d in res.values() if ativas(d)), key=lambda d: (d.get('uf', ''), d.get('nome', '')))
    sem_ver = [d for d in com_regra if d['ibge'] not in ver]
    vered = collections.Counter(v.get('veredito') for v in ver.values())
    vered_r = collections.Counter(r.get('veredito') for v in ver.values() for r in v.get('regras') or [])
    n_ativas = sum(len(ativas(d)) for d in com_regra)
    sts = [k for k, _ in st.most_common()]

    o = ['# Resumo da pesquisa municipal — Sul e Centro-Oeste\n',
         f'Gerado por `consolidar_final.py` em {HOJE}. Municípios em `municipios.csv`: {len(linhas)}; '
         f'com resultado em `res/`: **{len(res)}**; gravados no fechamento por falta de resultado: **{len(gravados)}**.\n',
         'Status: `regra_com_ato` = ato primário achado (a regra só entra no app se `ativa`); `regra_sem_ato` = '
         'restrição conhecida sem ato lido; `pista`/`pontual` = indício ou restrição pontual sem regra ativa; '
         '`sem_restricao_declarada` = fonte oficial diz que não há/foi revogada; `nao_achou` = nada encontrado.\n',
         '## Por status\n\n| Status | Cidades |\n|---|---|']
    o += [f'| {k} | {v} |' for k, v in st.most_common()]
    o.append(f'| **total** | **{len(res)}** |')
    o.append('\nPor nível de busca: ' + ', '.join(f'{k}: {v}' for k, v in nivel.most_common()))
    o.append(f'\nCidades com pelo menos uma regra **ativa**: **{len(com_regra)}** ({n_ativas} regras ativas). '
             f'Cidades sem regra ativa (em `varredura_final.json`): **{len(varredura)}**. '
             f'Com `falha_de_fonte` (negativo não conclusivo): **{len(falhas)}**.\n')
    o.append('## Por UF\n\n| UF | ' + ' | '.join(sts) + ' | total | com regra ativa | falha de fonte |\n|'
             + '---|' * (len(sts) + 4))
    for uf in sorted(por_uf):
        cr = sum(1 for d in com_regra if d.get('uf') == uf)
        fl = sum(1 for f in falhas if f['uf'] == uf)
        o.append(f'| {uf} | ' + ' | '.join(str(por_uf[uf][s]) for s in sts) + f' | {sum(por_uf[uf].values())} | {cr} | {fl} |')

    o.append(f'\n## Verificação\n\nArquivos em `verif/`: {len(ver)}. Vereditos por cidade: '
             + ', '.join(f'{k}: {v}' for k, v in vered.most_common())
             + '. Vereditos por regra: ' + ', '.join(f'{k}: {v}' for k, v in vered_r.most_common())
             + f'. Cidades com regra ativa ainda sem verificação: **{len(sem_ver)}**. As correções do verificador '
               'já estão aplicadas nos `res/` (regras rebaixadas ficaram `desativada`).\n')
    o.append('## Cidades com regra ativa verificada\n\n| UF | Município | IBGE | Status | Regras ativas | Veredito (verif/) | Regras |\n|---|---|---|---|---|---|---|')
    for d in com_regra:
        v = ver.get(d['ibge'], {}).get('veredito', 'sem verificação')
        nomes = '; '.join((r.get('nome') or r.get('id') or '')[:70] for r in ativas(d))
        o.append(f"| {d.get('uf')} | {d.get('nome')} | {d['ibge']} | {d.get('status')} | {len(ativas(d))} | {v} | {nomes} |")

    # falhas
    cat = collections.Counter()
    for f, d in ((f, res[f['ibge']]) for f in falhas):
        s = json.dumps(d, ensure_ascii=False)
        if f['sistema_legislacao'] in ('nao_encontrado', 'desconhecido') or RE_SEM_PORTAL.search(s):
            cat['sem legislação municipal pesquisável online'] += 1
        elif RE_IP.search(s):
            cat['portal bloqueado ao IP da nuvem (403/Cloudflare/Akamai)'] += 1
        elif f['sistema_legislacao'] in ('cespro', 'nucleogov', '1doc', 'leismunicipais', 'atende', 'webline', 'elotech'):
            cat['portal sem cliente automático (JS, login, reCAPTCHA)'] += 1
        else:
            cat['outras (diário/API instável, portal próprio não varrido)'] += 1
    o.append(f'\n## Cidades onde a fonte falhou\n\n{len(falhas)} cidades com `falha_de_fonte=true` '
             '(lista completa com motivo em `falhas_de_fonte.json`).\n\n| Motivo (classificação aproximada) | Cidades |\n|---|---|')
    o += [f'| {k} | {v} |' for k, v in cat.most_common()]
    pf = collections.Counter(f['uf'] for f in falhas)
    o.append('\nPor UF: ' + ', '.join(f'{k} {v}' for k, v in sorted(pf.items())))
    o.append('\nPor sistema de legislação (triagem): ' + ', '.join(
        f'{k or "não mapeado"} {v}' for k, v in collections.Counter(f['sistema_legislacao'] for f in falhas).most_common()))
    imp = [f for f in falhas if f['status'] != 'nao_achou']
    if imp:
        o.append('\nCom achado parcial e fonte falha (prioridade para refazer):\n')
        o += [f"- {f['nome']} ({f['uf']}, {f['ibge']}): {f['status']}" for f in imp]

    # LAI
    lai_a = [d for d in res.values() if d.get('status') == 'regra_sem_ato']
    lai_b = [res[f['ibge']] for f in falhas if res[f['ibge']].get('status') == 'nao_achou' and
             (f['sistema_legislacao'] in ('nao_encontrado', 'desconhecido') or
              RE_SEM_PORTAL.search(json.dumps(res[f['ibge']], ensure_ascii=False)))]
    o.append('\n## O que só pedido de LAI resolveria\n\n'
             'Bloqueio de IP e portais com JS/reCAPTCHA se resolvem consultando da rede do usuário ou no navegador; '
             'não precisam de LAI. Precisam de pedido de acesso à informação (Lei 12.527/2011, e-SIC da prefeitura):\n')
    o.append(f'**A. Restrição conhecida sem ato primário lido ({len(lai_a)})**: pedir número, texto e mapa/anexo do '
             'ato (decreto/portaria/resolução) que fundamenta a restrição divulgada.\n')
    for d in sorted(lai_a, key=lambda d: (d['uf'], d['nome'])):
        o.append(f"- {d['nome']} ({d['uf']}, {d['ibge']}): {(d.get('observacoes') or '')[:180].replace(chr(10), ' ')}…")
    o.append(f'\n**B. Sem legislação municipal pesquisável online e sem diário varrido ({len(lai_b)})**: pedir a lista '
             'de leis/decretos vigentes sobre circulação, peso ou horário de veículos de carga.\n')
    o.append(', '.join(f"{d['nome']} ({d['uf']}, {d['ibge']})" for d in sorted(lai_b, key=lambda d: (d['uf'], d['nome']))))
    o.append(f'\n## Divergências com o OSM\n\n{len(div)} entradas em `osm_divergencias.json` '
             f"({', '.join(f'{k}: {v}' for k, v in collections.Counter(e['tipo'] for e in div).items())}); "
             f"excluídas {sum(descart.values())} (rodovias fora da competência municipal ou OSM não conferido).")
    if gravados:
        o.append('\n## Gravados no fechamento (sem resultado)\n\n' + ', '.join(gravados))
    open(os.path.join(BASE, 'RESUMO.md'), 'w', encoding='utf-8').write('\n'.join(o) + '\n')

    tot = {'municipios': len(linhas), 'res': len(res), 'gravados_fechamento': len(gravados), 'por_status': dict(st),
           'cidades_com_regra_ativa': len(com_regra), 'regras_ativas': n_ativas, 'sem_regra': len(varredura),
           'falhas_de_fonte': len(falhas), 'osm_divergencias': len(div), 'lai_a': len(lai_a), 'lai_b': len(lai_b),
           'sem_verif': len(sem_ver), 'falhas_cat': dict(cat)}
    print(json.dumps(tot, ensure_ascii=False))


if __name__ == '__main__':
    main()
