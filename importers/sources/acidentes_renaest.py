"""Acidentes com caminhão: RENAEST (Senatran/MT), Goiás (GO) e Distrito Federal (DF), com coordenada e tipo de veículo.

O RENAEST é o cadastro nacional de acidentes alimentado pelos DETRANs, em domínio público (CKAN dados.transportes.gov.br:
"Outra (Domínio Público)"). Só GO (coordenada em ~98% dos acidentes desde 2021) e DF (coordenada em 2018, 2019, 2025 e 2026;
2020 a 2024 vêm com o placeholder '-0000000000') têm coordenada utilizável; PR, SC, RS, MT e MS não têm (ver
docs/layers/acidentes.md e docs/research/estados_sul_co/*.json). Só entram as UFs de `UFS`.

O arquivo é um ZIP ACUMULADO de ~530 MB (Acidentes 2,7 GB descompactado, TipoVeiculo 340 MB). É lido por HTTP Range direto da
fonte, em streaming, e só um extrato compacto das UFs usadas (gzip, sem identificação de pessoas) fica em data/cache/renaest.
Registro individual nunca é gravado na camada: a saída é o mesmo agregado em células de 250 m (mínimo de 3 acidentes com
caminhão, janela de 3 anos) das demais fontes de acidentes (ver acidentes_infosiga.Hotspots).

Divisão por jurisdição (para não contar duas vezes o que a PRF já cobre, como em acidentes_infosiga e acidentes_reds_mg):
  - tp_rodovia = FEDERAL ou endereço com código de BR -> PRF (acidentes_prf), descartado aqui;
  - acidente em rodovia (tp_rodovia ESTADUAL/FEDERAL ou endereço com código GO-/DF-/BR-) numa célula (±1) onde a PRF tem
    acidentes (`acidentes_prf.covered_cells(bbox da UF)`) -> descartado (a PRF cobre aquele trecho);
  - demais (rodovias estaduais/distritais e vias urbanas) -> RENAEST.
Limites da fonte (registrados em NOTES e docs/layers/acidentes.md): o tipo de veículo é "NAO INFORMADO" em ~35% dos veículos de
GO, então a contagem de caminhão é um piso; o RENAEST só traz óbitos por acidente (não separa ferido de ileso), então "com vítima"
= com óbito; o campo tp_rodovia tem erros (rodovia federal marcada como estadual, avenidas urbanas), por isso o endereço também
é lido; o km só existe no texto do endereço; o município do registro nem sempre é o do local do acidente em rodovia (ex.: acidente na GO-020
perto de Catalão registrado em Goiânia), então acidente de rodovia sai sem município. Coordenada repetida (>= MIN_REPETICAO acidentes com caminhão na mesma coordenada
exata, em geral centro de bairro/município quando falta o endereço) é descartada, como no REDS-MG.
"""
from __future__ import annotations
import csv, datetime as dt, gzip, io, json, re, time, zipfile
from collections import Counter
from common import CACHE_DIR, UA, http_get
from sources.acidentes_infosiga import Hotspots, cell_of, in_bbox, intval, janela, norm_txt, num, parse_hour, rotulo_rodovia, titulo

LAYER_ID = 'acidentes'
SOURCE = 'renaest'          # as cargas reais usam renaest-go e renaest-df (ver runs)
SOURCE_URL = 'https://dados.transportes.gov.br/dataset/renaest'
PACKAGE_URL = 'https://dados.transportes.gov.br/api/3/action/package_show?id=renaest'
FALLBACK_ZIP = ('https://dados.transportes.gov.br/dataset/42e2320b-ea67-4fdc-896f-71363e043fc6/resource/'
                '675d49a4-91bf-44a8-82da-faa19a62c53f/download/renaest_dabertos_20260912.zip')
# mesma redação de meta.sources em api/src/layers/acidentes.layer.ts e de docs/layers/acidentes.md
LICENSE = ('RENAEST (Senatran/Ministério dos Transportes) — "Outra (Domínio Público)" no CKAN dados.transportes.gov.br; '
           'dados dos DETRANs, atribuir Senatran/RENAEST')
NOTES = ('Grade 250 m (EPSG:5880), janela de 3 anos, mínimo de 3 acidentes com caminhão por célula. Rodovias federais (PRF) ficam fora. '
         'Tipo de veículo "não informado" em ~35% dos registros: contagem de caminhão é um piso.')

UFS = {
    'GO': {'source': 'renaest-go', 'bbox': (-53.3, -20.1, -45.0, -12.5), 'ano_min': 2021, 'rotulo': 'RENAEST (DETRAN-GO)'},
    # DF: 2020 a 2024 sem coordenada (placeholder); a janela de 3 anos terminando em 05/2026 só tem 2025 e 2026 com coordenada
    'DF': {'source': 'renaest-df', 'bbox': (-48.35, -16.1, -47.2, -15.45), 'ano_min': 2025, 'rotulo': 'RENAEST (DETRAN-DF)'},
}
CAMINHAO = {'CAMINHAO', 'CAMINHAO TRATOR', 'SEMIRREBOQUE', 'REBOQUE'}     # os mesmos tipos da PRF
MOTO = {'MOTOCICLETA', 'MOTONETA', 'CICLOMOTOR'}
MIN_REPETICAO = 5
PESO_SEM_OBITO = 0.5   # o RENAEST não separa ferido de ileso (qtde_feridosilesos): peso entre o 1 do Infosiga e o 0,2 da PRF/ARTESP


class HotspotsRenaest(Hotspots):
    peso_sem_vitima = PESO_SEM_OBITO
RE_RODOVIA = re.compile(r'\b(GO|DF|BR)\s*-?\s*0*(\d{1,3})\b')
CACHE = 'renaest'
EXTRATO_ANOS = 5      # anos guardados no extrato (a janela usa 3)


class HttpRangeFile(io.RawIOBase):
    """Arquivo somente leitura sobre HTTP Range (permite abrir o ZIP de 530 MB lendo só os membros necessários)."""

    def __init__(self, url: str, size: int | None = None, chunk: int = 16 << 20):
        import requests
        self.url, self.pos, self.chunk, self.s = url, 0, chunk, requests.Session()
        self.s.headers.update(UA)
        self.size = size or int(self._retry(lambda: self.s.head(url, allow_redirects=True, timeout=60)).headers['Content-Length'])
        self.buf, self.bstart = b'', 0

    @staticmethod
    def _retry(fn, n: int = 6):
        for i in range(n):
            try:
                return fn()
            except Exception:   # noqa: BLE001
                if i == n - 1:
                    raise
                time.sleep(4 * (i + 1))

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b''
        if not (self.bstart <= self.pos and self.pos + n <= self.bstart + len(self.buf)):
            end = min(self.size - 1, self.pos + max(n, self.chunk) - 1)

            def get():
                r = self.s.get(self.url, headers={'Range': f'bytes={self.pos}-{end}'}, timeout=240)
                if r.status_code != 206:
                    raise IOError(f'HTTP {r.status_code}')
                return r.content
            self.buf, self.bstart = self._retry(get), self.pos
        o = self.pos - self.bstart
        d = self.buf[o:o + n]
        self.pos += len(d)
        return d

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def zip_url() -> str:
    """Recurso mais recente do CKAN (ZIP acumulado); se a API falhar, o ZIP conhecido de 12/09/2026."""
    try:
        d = json.loads(http_get(PACKAGE_URL, cache=f'{CACHE}/package.json', max_age_h=12, timeout=60))['result']
        zips = [r for r in d['resources'] if (r.get('format') or '').upper() == 'ZIP' and r.get('url')]
        return max(zips, key=lambda r: r.get('last_modified') or '')['url']
    except Exception as e:   # noqa: BLE001
        print(f'  ! CKAN do RENAEST indisponível ({e}); usando o ZIP conhecido')
        return FALLBACK_ZIP


def _member(z: zipfile.ZipFile, prefix: str) -> str:
    return next(n for n in z.namelist() if n.startswith(prefix))


def _csv(z: zipfile.ZipFile, prefix: str):
    with z.open(_member(z, prefix)) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding='latin1', newline=''), delimiter=';')


def extract(url: str) -> list[dict]:
    """Extrato (um dict por acidente das UFS, com coordenada) do ZIP do RENAEST, em cache por nome de arquivo."""
    name = url.rsplit('/', 1)[-1].removesuffix('.zip')
    cache = CACHE_DIR / CACHE / f'extrato_{name}.jsonl.gz'
    if cache.exists() and cache.stat().st_size > 0:
        with gzip.open(cache, 'rt', encoding='utf-8') as fh:
            return [json.loads(l) for l in fh]
    year0 = dt.date.today().year - EXTRATO_ANOS
    z = zipfile.ZipFile(HttpRangeFile(url))
    mun = {r['codigo_ibge']: r['municipio'] for r in _csv(z, 'Localidade') if r['uf'] in UFS}
    acc: dict[str, dict] = {}
    n_lidos = 0
    for r in _csv(z, 'Acidentes'):
        uf = r['uf_acidente']
        if uf not in UFS or int(r['ano_acidente'] or 0) < max(year0, UFS[uf]['ano_min']):
            continue
        n_lidos += 1
        lat, lon = num(r['latitude_acidente']), num(r['longitude_acidente'])
        ok = in_bbox(lon, lat, UFS[uf]['bbox']) and not (abs(lat) < 1e-6 or abs(lon) < 1e-6)
        try:
            d = dt.date.fromisoformat(r['data_acidente'][:10])
        except ValueError:
            continue
        acc[r['num_acidente']] = {
            'uf': uf, 'd': d.isoformat(), 'lat': lat if ok else None, 'lon': lon if ok else None, 'h': parse_hour(r['hora_acidente']),
            'tp': norm_txt(r['tp_rodovia']), 'end': ' '.join(r['end_acidente'].split())[:60], 'mun': mun.get(r['codigo_ibge']),
            'ob': intval(r['qtde_obitos']), 'tk': False, 'mo': False,
        }
    print(f'    RENAEST: {n_lidos} acidentes de {sorted(UFS)} lidos, {sum(1 for a in acc.values() if a["lon"] is not None)} com coordenada')
    for r in _csv(z, 'TipoVeiculo'):
        a = acc.get(r['num_acidente'])
        if a is None or a['lon'] is None:
            continue
        t = norm_txt(r['tipo_veiculo'])
        a['tk'] |= t in CAMINHAO
        a['mo'] |= t in MOTO
    out = [a for a in acc.values() if a['lon'] is not None]
    cache.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache.with_suffix('.tmp')
    with gzip.open(tmp, 'wt', encoding='utf-8') as fh:
        for a in out:
            fh.write(json.dumps(a, ensure_ascii=False) + '\n')
    tmp.replace(cache)
    return out


def via_do_endereco(end: str, uf: str) -> str | None:
    """'GO 070 KM 12' -> 'GO-070'; 'BR-153' -> 'BR-153'; endereço sem código de rodovia -> None (o nome não é publicado)."""
    m = RE_RODOVIA.search(norm_txt(end))
    return f'{m.group(1)}-{int(m.group(2)):03d}' if m else None


def eh_rodovia(a: dict, via: str | None) -> bool:
    return a['tp'] in ('ESTADUAL', 'FEDERAL') or via is not None


def hotspots_uf(evs: list[dict], uf: str, covered: set[tuple[int, int]]) -> tuple[Hotspots, dt.date, dt.date, Counter]:
    cfg = UFS[uf]
    mine = [e for e in evs if e['uf'] == uf]
    start, end = janela(min(max(dt.date.fromisoformat(e['d']) for e in mine), dt.date.today()))
    skipped: Counter = Counter()
    # coordenada exata repetida em muitos acidentes com caminhão = centroide de bairro/município (endereço sem número)
    rep = Counter((round(e['lon'], 5), round(e['lat'], 5)) for e in mine if e['tk'] and start <= dt.date.fromisoformat(e['d']) <= end)
    hs = HotspotsRenaest()
    datas = [dt.date.fromisoformat(e['d']) for e in mine if start <= dt.date.fromisoformat(e['d']) <= end]
    # período REAL dos dados com coordenada (no DF, só 2025 e 2026 têm; 2020-2024 vêm com placeholder), em mês e ano
    real_de = min(datas).replace(day=1)
    real_ate = (max(datas).replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    start, end = max(start, real_de), min(end, real_ate)
    for e in mine:
        d = dt.date.fromisoformat(e['d'])
        if not (start <= d <= end):
            continue
        via = via_do_endereco(e['end'], uf)
        if e['tp'] == 'FEDERAL' or (via or '').startswith('BR-'):
            skipped['federal_prf'] += 1
            continue
        if eh_rodovia(e, via) and cell_of(e['lon'], e['lat']) in covered:
            skipped['rodovia_coberta_prf'] += 1
            continue
        if e['tk'] and rep[(round(e['lon'], 5), round(e['lat'], 5))] >= MIN_REPETICAO:
            skipped['coordenada_repetida'] += 1
            continue
        fatal = e['ob'] > 0
        hs.add(e['lon'], e['lat'], truck=e['tk'], fatal=fatal, vitima=fatal, obitos=e['ob'], moto=e['mo'], pedestre=False, hour=e['h'],
               via=rotulo_rodovia(via, uf) if via else None,
               municipio=None if eh_rodovia(e, via) else titulo(e['mun'], uf))
    return hs, start, end, skipped


def runs(arg: str | None = None):
    """Uma carga por UF (`acidentes_renaest:GO`); sem argumento, todas."""
    ufs = [arg.upper()] if arg else list(UFS)
    if any(u not in UFS for u in ufs):
        raise SystemExit(f'UF sem coordenada utilizável no RENAEST: {ufs} (use {sorted(UFS)})')
    state: dict = {}

    def evs():
        if 'e' not in state:
            state['url'] = zip_url()
            state['e'] = extract(state['url'])
        return state['e']

    jobs = []
    for uf in ufs:
        job = {'source': UFS[uf]['source'], 'source_url': SOURCE_URL, 'license': LICENSE, 'notes': NOTES}

        def fetch(uf=uf, job=job):
            from sources import acidentes_prf
            e = evs()
            covered = acidentes_prf.covered_cells(UFS[uf]['bbox'])
            print(f'    {uf}: {len(covered)} células cobertas pela PRF')
            hs, start, end, skipped = hotspots_uf(e, uf, covered)
            feats = hs.features(UFS[uf]['source'], start, end, UFS[uf]['rotulo'])
            job['notes'] = f'{NOTES} Janela {start}..{end}. {hs.summary(feats)}. Descartados: {dict(skipped)}.'
            print('   ', hs.summary(feats), dict(skipped))
            return feats
        job['fetch'] = fetch
        jobs.append(job)
    return jobs
