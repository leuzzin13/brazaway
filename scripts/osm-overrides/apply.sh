#!/usr/bin/env bash
# Aplica as correções 'ativas' de data/osm-overrides/overrides.json a um PBF e gera o PBF corrigido + relatório.
#   scripts/osm-overrides/apply.sh <entrada.pbf> <saida.pbf>
# Também lista (sem aplicar) quantas ways casam com as regras 'pendente_confirmacao', para acompanhamento.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT_DIR="$(cd "$(dirname "$2")" && pwd)"; OUT="$OUT_DIR/$(basename "$2")"
IMG=truck-router-osmtools
docker image inspect $IMG >/dev/null 2>&1 || docker build -q -t $IMG "$ROOT/scripts/osm-overrides" >/dev/null
WORK="$ROOT/data/cache/osm-overrides"; mkdir -p "$WORK"
REPORT="$ROOT/data/osm-overrides/ultimo_relatorio.json"
python3 - "$ROOT/data/osm-overrides/overrides.json" > "$WORK/rules.tsv" <<'PY'
import json,sys
for r in json.load(open(sys.argv[1]))['rules']:
    b=r['bbox']; print(f"{r['id']}\t{r['status']}\t{b[0]},{b[1]},{b[2]},{b[3]}")
PY
OSCS=()
while IFS=$'\t' read -r id status bbox; do
  docker run --rm -v "$IN:/in.pbf:ro" -v "$WORK:/work" -v "$ROOT/data/osm-overrides:/rules:ro" -v "$ROOT/scripts/osm-overrides:/s:ro" $IMG sh -c "
    osmium extract -b $bbox /in.pbf -o /work/$id.pbf --overwrite -s smart >/dev/null 2>&1 &&
    python3 /s/find_and_patch.py /rules/overrides.json /work/$id.pbf $id /work/$id.osc /work/$id.json"
  if [ "$status" = "ativa" ]; then OSCS+=("/work/$id.osc"); else echo "  ($id: pendente de confirmação, NÃO aplicada)"; fi
done < "$WORK/rules.tsv"
if [ ${#OSCS[@]} -eq 0 ]; then cp "$IN" "$OUT"; else
  docker run --rm -v "$IN:/in.pbf:ro" -v "$WORK:/work" -v "$OUT_DIR:/out" $IMG \
    osmium apply-changes /in.pbf "${OSCS[@]}" -o "/out/$(basename "$OUT")" --overwrite
fi
python3 - "$WORK" "$ROOT/data/osm-overrides/overrides.json" "$REPORT" <<'PY'
import json,sys,os
work,rules,out=sys.argv[1:4]
rep={'regras':[]}
for r in json.load(open(rules))['rules']:
    p=os.path.join(work,r['id']+'.json')
    d=json.load(open(p)) if os.path.exists(p) else {'ways':[]}
    rep['regras'].append({'id':r['id'],'status':r['status'],'ways_casadas':len(d['ways']),'ways':d['ways']})
json.dump(rep,open(out,'w'),ensure_ascii=False,indent=1)
print('relatório:',out)
PY
echo "PBF corrigido: $OUT"
