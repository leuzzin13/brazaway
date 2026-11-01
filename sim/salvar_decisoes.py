#!/usr/bin/env python3
"""Grava as decisões da equipe (resultado do workflow sim/equipe_workflow.js) em sim/out/decisoes/semana_N_<grupo>.json.
Uso: python3 sim/salvar_decisoes.py <arquivo de saída do workflow>"""
import json, os, sys
from pathlib import Path

OUT = Path(os.environ.get('SIM_OUT', Path(__file__).resolve().parent / 'out')) / 'decisoes'
raw = json.loads(Path(sys.argv[1]).read_text())
res = raw['result'] if isinstance(raw, dict) and 'result' in raw else raw
OUT.mkdir(parents=True, exist_ok=True)
for d in res:
    p = OUT / f"semana_{d['semana']}_{d['g']}.json"
    p.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    tipos = {}
    for a in d.get('acoes', []): tipos[a.get('acao')] = tipos.get(a.get('acao'), 0) + 1
    print(f"{p.name}: {len(d.get('acoes', []))} ações {tipos}")
    print('  mensagem:', (d.get('mensagem_aos_motoristas') or '')[:300].replace('\n', ' '))
