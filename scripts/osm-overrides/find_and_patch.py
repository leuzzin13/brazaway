#!/usr/bin/env python3
"""Gera um osmChange (.osc) com as correções 'ativas' de data/osm-overrides/overrides.json.

Uso (dentro da imagem truck-router-osmtools):
  python3 find_and_patch.py <overrides.json> <extrato_bbox.pbf> <regra_id> <saida.osc> <relatorio.json>
O extrato por bbox é feito antes com `osmium extract`; aqui só lemos as ways da bbox (rápido) e, para cada way que
casa com a regra, escrevemos a way inteira com as tags corrigidas e version+1 (o `osmium apply-changes` aplica).
"""
import json, sys
from xml.sax.saxutils import quoteattr
import osmium

rules_path, extract_pbf, rule_id, out_osc, out_report = sys.argv[1:6]
rule = next(r for r in json.load(open(rules_path))['rules'] if r['id'] == rule_id)
m, act = rule['match'], rule['action']

def matches(tags) -> bool:
    v = tags.get(m['tag'])
    if v is None:
        return False
    if 'value_contains' in m and m['value_contains'] not in v:
        return False
    if 'value_equals' in m and v != m['value_equals']:
        return False
    if 'value_in' in m and v not in m['value_in']:
        return False
    if 'ref_contains' in m and m['ref_contains'] not in (tags.get('ref') or ''):
        return False
    if 'name_in' in m and (tags.get('name') or '') not in m['name_in']:
        return False
    return True

found = []

class Finder(osmium.SimpleHandler):  # API clássica: funciona no pyosmium 3.x do Debian e no 4.x
    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        if not matches(tags):
            return
        new_tags = {k: v for k, v in tags.items() if k not in set(act.get('remove_tags', []))}
        new_tags.update(act.get('set_tags', {}))
        found.append({'id': w.id, 'version': w.version, 'nodes': [n.ref for n in w.nodes], 'old': tags, 'new': new_tags})

Finder().apply_file(extract_pbf)

with open(out_osc, 'w') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="truck-router osm-overrides">\n<modify>\n')
    for w in found:
        f.write(f'<way id="{w["id"]}" version="{(w["version"] or 0) + 1}" timestamp="2026-10-10T00:00:00Z">\n')
        for n in w['nodes']:
            f.write(f'  <nd ref="{n}"/>\n')
        for k, v in w['new'].items():
            f.write(f'  <tag k={quoteattr(k)} v={quoteattr(v)}/>\n')
        f.write('</way>\n')
    f.write('</modify>\n</osmChange>\n')

json.dump({'rule': rule_id, 'ways': [{'id': w['id'], 'name': w['old'].get('name'), 'removed': {k: w['old'][k] for k in w['old'] if k not in w['new']}} for w in found]},
          open(out_report, 'w'), ensure_ascii=False, indent=1)
print(f'{rule_id}: {len(found)} ways')
