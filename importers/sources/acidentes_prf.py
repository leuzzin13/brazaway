"""Acidentes com caminhão: PRF, rodovias federais (BR) de todo o país, com coordenadas. Usa o CSV "agrupado por pessoa"
(tem tipo de veículo e tipo de envolvido; ids e óbitos batem 100% com o CSV por ocorrência). Agregado em pontos críticos na
mesma grade de 250 m da camada 'acidentes' (ver acidentes_infosiga). Nunca grava registro individual.
"""
from __future__ import annotations
import csv, datetime as dt, io, re, zipfile
from collections import Counter
from common import http_get
from sources.acidentes_infosiga import Hotspots, cell_of, dilate, download, in_bbox, intval, janela, norm_txt, num, parse_hour, rotulo_rodovia, titulo

LAYER_ID = 'acidentes'
SOURCE = 'prf'
SOURCE_URL = 'https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf'
# mesma redação de meta.sources em api/src/layers/acidentes.layer.ts e de docs/layers/acidentes.md
LICENSE = ('Dados abertos PRF — livre utilização (Decreto federal 8.777/2016, art. 4º, caput e § 1º, red. Decreto 9.903/2019); '
           'o rodapé do gov.br cita CC BY-ND 3.0 para o conteúdo do site, interpretado como não aplicável aos dados; confirmar via Fala.BR')
NOTES = 'Grade 250 m, janela de 3 anos, mínimo de 3 acidentes com caminhão por célula. Rodovias federais de todo o país.'
DRIVE = 'https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t'
# ids do Google Drive em 09/10/2026 (usados se a página mudar de formato; o do ano corrente muda todo mês)
FALLBACK_IDS = {2023: '1-Yk6TV00CH3PixTkKmkoUJQsNiUc5xLm', 2024: '14lVfqdoE2gxDliaKZu7K9Mx6847maPtl',
                2025: '1-Gp9S-ALO0D1nT8S_OKoC8xlW7BY8F82', 2026: '1B_rvx1kPHuFowP5rs84ZO-57gN8yUs85'}

CAMINHAO = {'CAMINHAO', 'CAMINHAO TRATOR', 'SEMIREBOQUE', 'REBOQUE'}
MOTO = {'MOTOCICLETA', 'MOTONETA', 'CICLOMOTOR'}
BR_BBOX = (-74.5, -34.5, -28.5, 5.5)


def _ids() -> dict[int, str]:
    """Links "Acidentes AAAA (Agrupados por pessoa)" da página de dados abertos (tabela label | link)."""
    try:
        html = http_get(SOURCE_URL, cache='prf/pagina.html', max_age_h=24).decode('utf-8', 'ignore')
    except Exception as e:
        print(f'  ! página da PRF indisponível ({e}); usando ids conhecidos')
        return dict(FALLBACK_IDS)
    out = {}
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)
        if len(tds) < 2:
            continue
        label = ' '.join(re.sub('<[^>]+>', ' ', tds[0]).split())
        m = re.search(r'Acidentes (\d{4}) \(Agrupados por pessoa\)$', label)
        link = re.search(r'drive\.google\.com/file/d/([\w-]+)', tds[1])
        if m and link:
            out[int(m.group(1))] = link.group(1)
    return out or dict(FALLBACK_IDS)


def _rows(path):
    if not zipfile.is_zipfile(path):
        path.unlink(missing_ok=True)
        raise RuntimeError(f'PRF: {path.name} não é zip (o Google Drive pode ter pedido confirmação); rode de novo ou baixe à mão')
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith('.csv'))
        with z.open(name) as fh:
            yield from csv.DictReader(io.TextIOWrapper(fh, encoding='latin1'), delimiter=';')


def events() -> list[dict]:
    """Acidentes (um dict por acidente, montado a partir das linhas por pessoa) dos últimos ~4 anos publicados."""
    ids = _ids()
    this_year = dt.date.today().year
    files = {y: download(DRIVE.format(id=ids[y]), f'prf/acidentes_pessoa_{y}.zip', max_age_h=24 * (7 if y >= this_year - 1 else 90))
             for y in sorted(ids) if y >= this_year - 3}
    acc: dict[str, dict] = {}
    for y, p in sorted(files.items()):
        for r in _rows(p):
            i = r.get('id')
            if not i:
                continue
            a = acc.get(i)
            if a is None:
                try:
                    d = dt.date.fromisoformat((r.get('data_inversa') or '')[:10])
                except ValueError:
                    continue
                lat, lon = num(r.get('latitude')), num(r.get('longitude'))
                ok = in_bbox(lon, lat, BR_BBOX)
                br, km, uf = intval(r.get('br')), num(r.get('km')), (r.get('uf') or '').strip()
                via = (rotulo_rodovia(f'BR-{br:03d}', uf, km) + (f' km {int(km)}' if km is not None else '') + (f'/{uf}' if uf else '')) if br else None
                a = acc[i] = {'d': d, 'lat': lat if ok else None, 'lon': lon if ok else None, 'hour': parse_hour(r.get('horario')),
                              'truck': False, 'moto': False, 'pedestre': norm_txt(r.get('tipo_acidente')).startswith('ATROPELAMENTO DE PEDESTRE'),
                              'obitos': 0, 'feridos': 0, 'fatal_cls': norm_txt(r.get('classificacao_acidente')) == 'COM VITIMAS FATAIS',
                              'via': via, 'municipio': titulo(r.get('municipio'), uf)}
            tv = norm_txt(r.get('tipo_veiculo'))
            a['truck'] |= tv in CAMINHAO
            a['moto'] |= tv in MOTO
            a['pedestre'] |= norm_txt(r.get('tipo_envolvido')) == 'PEDESTRE'
            a['obitos'] += intval(r.get('mortos'))
            a['feridos'] += intval(r.get('feridos_leves')) + intval(r.get('feridos_graves'))
    out = list(acc.values())
    for a in out:
        a['fatal'] = a['obitos'] > 0 or a.pop('fatal_cls')
        a['vitima'] = a['fatal'] or a.pop('feridos') > 0
    return out


_events: list[dict] | None = None


def _cached_events() -> list[dict]:
    global _events
    if _events is None:
        _events = events()
    return _events


def covered_cells() -> set[tuple[int, int]]:
    """Células de 250 m (com 1 célula de folga) das BRs em SP: usadas pelo Infosiga para não duplicar acidentes."""
    return dilate({cell_of(e['lon'], e['lat']) for e in _cached_events() if e['lon'] is not None and in_bbox(e['lon'], e['lat'])})


def fetch():
    evs = _cached_events()
    start, end = janela(min(max(e['d'] for e in evs), dt.date.today()))
    print(f'    janela {start}..{end}; {len(evs)} acidentes lidos')
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
    feats = hs.features(SOURCE, start, end, 'PRF (rodovias federais)')
    global NOTES
    NOTES = f'{NOTES} Janela {start}..{end}. {hs.summary(feats)}. Descartados: {dict(skipped)}.'
    print('   ', hs.summary(feats), dict(skipped))
    return feats
