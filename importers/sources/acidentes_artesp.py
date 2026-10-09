"""Acidentes com caminhão: ARTESP, rodovias estaduais CONCEDIDAS de SP (inclui acidentes sem vítima), 100% georreferenciados.
Agregados em pontos críticos na mesma grade de 250 m da camada 'acidentes' (ver acidentes_infosiga para a divisão por
jurisdição entre as fontes e os utilitários comuns). Nunca grava registro individual.
"""
from __future__ import annotations
import csv, datetime as dt, io, json
from collections import Counter
from common import http_get
from sources.acidentes_infosiga import Hotspots, cell_of, dilate, download, in_bbox, intval, janela, nome_via, norm_txt, num, parse_hour, titulo

LAYER_ID = 'acidentes'
SOURCE = 'artesp'
SOURCE_URL = 'https://dadosabertos.artesp.sp.gov.br/dataset/acidentes'
LICENSE = 'CC-BY (Creative Commons Attribution) — ARTESP, dadosabertos.artesp.sp.gov.br'
NOTES = 'Grade 250 m, janela de 3 anos, mínimo de 3 acidentes com caminhão por célula. Inclui acidentes sem vítima.'
CKAN = 'https://dadosabertos.artesp.sp.gov.br/api/3/action/package_show?id=acidentes'

CAMINHAO = {'CAMINHAO', 'CARRETA', 'BITREM/CVC', 'SEMI REBOQUE', 'SEMIREBOQUE', 'REBOQUE'}
MOTO = {'MOTO', 'CICLOMOTOR', 'MOTOCICLETA', 'MOTONETA'}


def _veiculos(s: str) -> Counter:
    c = Counter()
    for part in (s or '').split('|'):
        if '=' in part:
            k, v = part.split('=', 1)
            c[norm_txt(k)] += max(1, intval(v))
    return c


def _via(rodovia: str, km) -> str | None:
    label = nome_via(rodovia)          # 'SP021' -> 'Rodoanel (SP-021)'
    if not label:
        return None
    k = num(km)
    return f'{label} km {int(k)}' if k is not None else label


def _resources() -> dict[int, str]:
    d = json.loads(http_get(CKAN, cache='artesp/package_acidentes.json', max_age_h=24))
    out = {}
    for r in d['result']['resources']:
        name = (r.get('name') or '').strip()
        if name.lower().startswith('acidentes em ') and name[-4:].isdigit():
            out[int(name[-4:])] = r['url']
    return out


def _files() -> dict[int, 'pathlib.Path']:
    res = _resources()
    this_year = dt.date.today().year
    return {y: download(res[y], f'artesp/acidentes_{y}.csv', max_age_h=24 * (7 if y >= this_year - 1 else 90))
            for y in sorted(res) if y >= this_year - 4}


def events():
    """Acidentes (um dict por acidente, só em memória durante a importação) dos últimos ~4 anos publicados."""
    for y, p in sorted(_files().items()):
        with open(p, encoding='utf-8-sig', errors='replace') as fh:
            for row in csv.DictReader(fh):
                try:
                    d = dt.date.fromisoformat((row.get('DATA') or '')[:10])
                except ValueError:
                    continue
                lat, lon = num(row.get('LATITUDE')), num(row.get('LONGITUDE'))
                if not in_bbox(lon, lat):
                    yield {'d': d, 'lon': None, 'lat': None}
                    continue
                v = _veiculos(row.get('VEICULOS_ENVOLVIDOS'))
                obitos = intval(row.get('VITIMA_FATAL'))
                feridos = sum(intval(row.get(c)) for c in ('VITIMA_LEVE', 'VITIMA_MODERADA', 'VITIMA_GRAVE'))
                yield {'d': d, 'lon': lon, 'lat': lat, 'truck': any(k in CAMINHAO for k in v), 'fatal': obitos > 0, 'obitos': obitos,
                       'vitima': obitos + feridos > 0,
                       'moto': any(k in MOTO for k in v), 'pedestre': norm_txt(row.get('CLASSE')) == 'ATROPELAMENTO DE PEDESTRE',
                       'hour': parse_hour(row.get('HORA')), 'via': _via(row.get('RODOVIA'), row.get('KM')),
                       'municipio': titulo(row.get('MUNICIPIO'))}


_covered: set | None = None


def covered_cells() -> set[tuple[int, int]]:
    """Células de 250 m (com 1 célula de folga) da malha concedida: usadas pelo Infosiga para não duplicar acidentes."""
    global _covered
    if _covered is None:
        _covered = dilate({cell_of(e['lon'], e['lat']) for e in events() if e['lon'] is not None})
    return _covered


def fetch():
    evs = list(events())
    start, end = janela(min(max(e['d'] for e in evs), dt.date.today()))
    print(f'    janela {start}..{end}')
    hs = Hotspots()
    skipped = Counter()
    for e in evs:
        if not (start <= e['d'] <= end):
            continue
        if e['lon'] is None:
            skipped['sem_coord'] += 1
            continue
        hs.add(e['lon'], e['lat'], truck=e['truck'], fatal=e['fatal'], vitima=e['vitima'], obitos=e['obitos'], moto=e['moto'],
               pedestre=e['pedestre'], hour=e['hour'], via=e['via'], municipio=e['municipio'])
    feats = hs.features(SOURCE, start, end, 'ARTESP (rodovias concedidas)')
    global NOTES
    NOTES = f'{NOTES} Janela {start}..{end}. {hs.summary(feats)}. Descartados: {dict(skipped)}.'
    print('   ', hs.summary(feats), dict(skipped))
    return feats
