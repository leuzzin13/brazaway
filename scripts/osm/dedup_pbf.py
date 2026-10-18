"""Junta PBFs regionais (objetos de divisa repetidos, às vezes em versões diferentes) num PBF ordenado e sem duplicatas.
Uso: python3 dedup_pbf.py <saida_do_osmium_merge.pbf> <saida.pbf>
Passagem 1: acha os (tipo, id) repetidos e a maior versão de cada. Passagem 2: grava tudo, e de cada repetido só uma
cópia da maior versão."""
import sys
import osmium

src, dst = sys.argv[1], sys.argv[2]

seen_last = None
dups: dict[tuple[str, int], int] = {}
cnt = 0
for o in osmium.FileProcessor(src):
    k = (o.type_str(), o.id)
    if k == seen_last:
        dups[k] = max(dups.get(k, 0), o.version, prev_version)
    seen_last, prev_version = k, o.version
print('repetidos:', len(dups), flush=True)

written: set[tuple[str, int]] = set()
with osmium.SimpleWriter(dst) as w:
    for o in osmium.FileProcessor(src):
        k = (o.type_str(), o.id)
        if k in dups:
            if o.version != dups[k] or k in written:
                continue
            written.add(k)
        w.add(o)
print('ok', flush=True)
