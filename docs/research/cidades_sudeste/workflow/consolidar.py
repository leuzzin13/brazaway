#!/usr/bin/env python3
"""Consolida res/ e verif/ em RESUMO.md (totais e tabela das cidades com regra).

Uso: python3 workflow/consolidar.py   (a partir de docs/research/cidades_sudeste/)
Só lê res/, verif/ e municipios_sudeste.csv; grava RESUMO.md e varredura_final.json.
"""
import collections
import glob
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(BASE, '..', '..', '..', 'data', 'raw', 'municipios')


def carregar(pasta):
    out = {}
    for f in glob.glob(os.path.join(BASE, pasta, '*.json')):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception as e:  # arquivo corrompido: registra e segue
            print('ERRO lendo', f, e)
            continue
        out[str(d.get('ibge') or os.path.basename(f)[:-5])] = d
    return out


def ativas(d):
    return sum(1 for r in d.get('regras_rascunho') or [] if r.get('status') == 'ativa')


def main():
    res, ver = carregar('res'), carregar('verif')
    linhas = [l.split(';') for l in open(os.path.join(BASE, 'municipios_sudeste.csv'), encoding='utf-8').read().splitlines()[1:] if l]
    app = {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(APP, '[0-9]*.json'))} | {'3550308'}
    faltam = [l for l in linhas if l[0] not in res and l[0] not in app]

    st = collections.Counter(d.get('status') for d in res.values())
    nivel = collections.Counter(d.get('nivel_busca') for d in res.values())
    por_uf = collections.defaultdict(collections.Counter)
    for d in res.values():
        por_uf[d.get('uf')][d.get('status')] += 1
    falha = [d for d in res.values() if d.get('falha_de_fonte')]
    com_regra = sorted((d for d in res.values() if ativas(d) or d.get('status') == 'regra_com_ato'),
                       key=lambda d: (d.get('uf', ''), d.get('nome', '')))
    sem_ver = [d for d in com_regra if ativas(d) and d['ibge'] not in ver]
    vered = collections.Counter(v.get('veredito') for v in ver.values())

    o = []
    o.append('# Resumo da pesquisa municipal — Sudeste\n')
    o.append(f'Gerado por `workflow/consolidar.py`. Municípios: {len(linhas)}; já no app: {len(app)}; '
             f'com resultado em `res/`: **{len(res)}**; sem resultado: **{len(faltam)}**.\n')
    o.append('## Por status\n\n| Status | Cidades |\n|---|---|')
    o += [f'| {k} | {v} |' for k, v in st.most_common()]
    o.append(f'\nPor nível de busca: ' + ', '.join(f'{k}: {v}' for k, v in nivel.most_common()))
    o.append(f'\nCom `falha_de_fonte` (resultado não conclusivo, refazer quando a fonte voltar): **{len(falha)}**.\n')
    ufs = sorted(por_uf)
    sts = [k for k, _ in st.most_common()]
    o.append('## Por UF\n\n| UF | ' + ' | '.join(sts) + ' | total |\n|' + '---|' * (len(sts) + 2))
    for uf in ufs:
        o.append(f'| {uf} | ' + ' | '.join(str(por_uf[uf][s]) for s in sts) + f' | {sum(por_uf[uf].values())} |')
    o.append(f'\n## Verificação\n\nArquivos em `verif/`: {len(ver)}. Vereditos: '
             + ', '.join(f'{k}: {v}' for k, v in vered.most_common())
             + f'. Cidades com regra ativa ainda sem verificação: {len(sem_ver)}.\n')
    o.append('## Cidades com regra (rascunho)\n\n| UF | Município | IBGE | Status | Regras ativas | Verificação |\n|---|---|---|---|---|---|')
    for d in com_regra:
        v = ver.get(d['ibge'], {}).get('veredito', 'não')
        o.append(f"| {d.get('uf')} | {d.get('nome')} | {d['ibge']} | {d.get('status')} | {ativas(d)} | {v} |")
    if faltam:
        o.append('\n## Sem resultado\n\n' + ', '.join(f'{l[1]} ({l[2]}, {l[0]})' for l in faltam))
    open(os.path.join(BASE, 'RESUMO.md'), 'w', encoding='utf-8').write('\n'.join(o) + '\n')

    varredura = [{'ibge': d['ibge'], 'nome': d.get('nome'), 'uf': d.get('uf'), 'status': d.get('status'),
                  'nivel_busca': d.get('nivel_busca'), 'falha_de_fonte': bool(d.get('falha_de_fonte')),
                  'fontes': [f.get('url') for f in d.get('fontes_consultadas') or []][:10], 'data': d.get('data')}
                 for d in sorted(res.values(), key=lambda x: x['ibge']) if not ativas(d)]
    json.dump(varredura, open(os.path.join(BASE, 'varredura_final.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'res={len(res)} verif={len(ver)} faltam={len(faltam)} falha={len(falha)} com_regra={len(com_regra)} sem_verif={len(sem_ver)}')


if __name__ == '__main__':
    main()
