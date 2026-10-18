#!/bin/bash
ibge=$1
q="[out:json][timeout:90];area[\"IBGE:GEOCODIGO\"=\"$ibge\"]->.a;(way(area.a)[hgv][highway];way(area.a)[maxweight][highway];way(area.a)[maxlength][highway];way(area.a)[\"hgv:conditional\"];way(area.a)[\"maxweight:conditional\"];);out tags center;"
curl -sS -m 120 --data-urlencode "data=$q" https://overpass.private.coffee/api/interpreter -o $ibge.json
head -c 300 $ibge.json | tr '\n' ' '; echo
