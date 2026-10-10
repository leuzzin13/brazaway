#!/usr/bin/env python3
"""Gera a tabela de camadas do README a partir de GET /api/layers (API rodando).
Uso: python3 scripts/gen-layers-doc.py [http://localhost:3000]"""
import json, pathlib, sys, urllib.request
api = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
layers = json.load(urllib.request.urlopen(f'{api}/api/layers'))
groups = {'restricoes': 'Restrições', 'infraestrutura': 'Infraestrutura', 'seguranca': 'Segurança', 'servicos': 'Serviços',
          'custos': 'Custos', 'relevo': 'Relevo', 'calendario': 'Calendário'}
rows = ['| Camada | Grupo | Efeito na rota | Registros | Fontes (licença) | Doc |', '|---|---|---|---|---|---|']
for l in sorted(layers, key=lambda x: (list(groups).index(x['group']) if x['group'] in groups else 99, x['label'])):
    n = sum(r['record_count'] for r in l['runs'])
    eff = 'desvia' if l['affects_route'] else ('avisa' if l['annotates_route'] else 'mapa')
    src = '; '.join(f"{s['name']} ({s['license']})" for s in l['sources'])
    doc = f"[{l['id']}](docs/layers/{l['id']}.md)" if pathlib.Path(f"docs/layers/{l['id']}.md").exists() else ''
    rows.append(f"| {l['label']} | {groups.get(l['group'], l['group'])} | {eff} | {n:,}".replace(',', '.') + f" | {src} | {doc} |")
table = '\n'.join(rows)
p = pathlib.Path('README.md'); s = p.read_text()
a, b = '<!-- camadas:inicio -->', '<!-- camadas:fim -->'
block = f"{a}\n{table}\n{b}"
s = s[:s.index(a)] + block + s[s.index(b) + len(b):] if a in s else s + '\n' + block + '\n'
p.write_text(s)
print(f'{len(layers)} camadas no README')
