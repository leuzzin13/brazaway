"""Rodovias federais do SNV (Sistema Nacional de Viação, DNIT): trechos com BR, UF, km inicial/final e tipo de pista.

Base geométrica da camada `rodovias_horario`: a restrição de feriados da PRF (Portaria DIOP/PRF nº 121/2026, art. 1º § 2º)
vale nos trechos de PISTA SIMPLES de rodovia federal, e as regras especiais (ex.: Operação N. Sra. Aparecida em SP,
§ 5º) citam BR + km. O SNV traz exatamente isso (campos vl_br, sg_uf, vl_km_inic, vl_km_fina, ds_sup_fed).

- Fonte: Nextcloud público do DNIT, pasta "SNV Bases Geométricas (2013-Atual) (SHP)"; pega o zip mais recente (ex.: 202607A.zip).
- Filtro: jurisdição Federal (ds_jurisdi) — onde a PRF é a autoridade de trânsito —, UFs de SNV_UFS (padrão: Sudeste,
  que é a área dos tiles do Valhalla; use SNV_UFS=ALL para o Brasil todo) e superfície:
    pista_simples = PAV (pavimentada, pista simples), IMP (implantada) e LEN (leito natural);
    pista_dupla   = DUP (duplicada).  PLA (planejada) e TRV (travessia/balsa) ficam de fora.
- Trechos coincidentes (mesma geometria com duas BRs, campo ds_coinc) viram UMA feição, com todas as BRs/km em props.coinc.
- Geometria em SIRGAS 2000 (EPSG:4674), tratada como WGS 84 (diferença < 1 m), simplificada a ~3 m.
Sem dependência nova: o shapefile e o DBF são lidos com struct (formato ESRI público).
"""
from __future__ import annotations
import io, os, re, struct, zipfile
import xml.etree.ElementTree as ET
import requests
from common import http_get, CACHE_DIR, UA

LAYER_ID = 'rodovias_horario'
SOURCE = 'snv-dnit'
SHARE = 'oTpPRmYs5AAdiNr'
WEBDAV = 'https://servicos.dnit.gov.br/dnitcloud/public.php/webdav/'
FOLDER = 'SNV Bases Geométricas (2013-Atual) (SHP)/'
SOURCE_URL = f'https://servicos.dnit.gov.br/dnitcloud/index.php/s/{SHARE} ({FOLDER})'
LICENSE = ('Dado público federal — DNIT/SNV (sem licença explícita no repositório; o portal gov.br do DNIT usa CC BY-ND 3.0). '
           'Uso interno como referência geométrica; ver docs/layers/rodovias_horario.md')
NOTES = 'Trechos de jurisdição federal (pista simples = PAV/IMP/LEN; pista dupla = DUP). SIRGAS 2000 tratado como WGS 84.'

UFS_DEFAULT = 'ES,MG,RJ,SP'
SIMPLES = {'PAV', 'IMP', 'LEN'}
DUPLA = {'DUP'}
SIMPLIFY_DEG = 0.00003   # ~3 m


def _ufs() -> set[str] | None:
    v = os.environ.get('SNV_UFS', UFS_DEFAULT).strip().upper()
    return None if v == 'ALL' else {u.strip() for u in v.split(',') if u.strip()}


def latest_zip_name() -> str:
    """Lista a pasta via WebDAV (PROPFIND) e devolve o zip mais recente (AAAAMM[A-Z].zip)."""
    forced = os.environ.get('SNV_VERSION')
    if forced:
        return forced if forced.endswith('.zip') else f'{forced}.zip'
    try:
        r = requests.request('PROPFIND', WEBDAV + requests.utils.quote(FOLDER), auth=(SHARE, ''),
                             headers={**UA, 'Depth': '1'}, timeout=60)
        r.raise_for_status()
        names = [requests.utils.unquote(h.text.rstrip('/').split('/')[-1])
                 for h in ET.fromstring(r.content).iter('{DAV:}href')]
        zips = sorted(n for n in names if re.fullmatch(r'\d{6}[A-Z]?\.zip', n))
        if zips:
            return zips[-1]
    except Exception as e:  # sem rede: usa o que houver em cache
        print(f'  ! PROPFIND falhou ({e}); procurando zip em cache')
    cached = sorted(p.name for p in (CACHE_DIR / 'snv').glob('*.zip')) if (CACHE_DIR / 'snv').exists() else []
    if not cached:
        raise RuntimeError('não foi possível descobrir a versão do SNV (sem rede e sem cache)')
    return cached[-1]


def load_zip(name: str | None = None) -> tuple[str, bytes]:
    name = name or latest_zip_name()
    url = WEBDAV + requests.utils.quote(FOLDER + name)
    data = http_get(url, cache=f'snv/{name}', max_age_h=24 * 365, timeout=600, auth=(SHARE, ''))
    return name, data


# ---------------------------------------------------------------- leitura de shapefile/DBF (formato ESRI)
def read_dbf(buf: bytes, encoding='utf-8') -> list[dict]:
    nrec, hlen, rlen = struct.unpack('<IHH', buf[4:12])
    fields, p = [], 32
    while buf[p] != 0x0D:
        name = buf[p:p + 11].split(b'\0')[0].decode('ascii')
        ftype, flen = chr(buf[p + 11]), buf[p + 16]
        fields.append((name, ftype, flen))
        p += 32
    out = []
    for i in range(nrec):
        rec = buf[hlen + i * rlen: hlen + (i + 1) * rlen]
        if not rec or rec[0:1] == b'*':
            out.append(None)
            continue
        row, o = {}, 1
        for name, ftype, flen in fields:
            raw = rec[o:o + flen].decode(encoding, errors='replace').strip()
            o += flen
            if ftype in 'NF':
                try:
                    row[name] = float(raw) if raw else None
                except ValueError:
                    row[name] = None
            else:
                row[name] = raw or None
        out.append(row)
    return out


def read_shp_lines(buf: bytes) -> list[list[list[tuple[float, float]]] | None]:
    """PolyLine (3), PolyLineZ (13), PolyLineM (23) -> lista de partes [(x, y), ...] por registro."""
    out, p = [], 100
    while p + 8 <= len(buf):
        _, clen = struct.unpack('>ii', buf[p:p + 8])
        p += 8
        rec = buf[p:p + clen * 2]
        p += clen * 2
        st = struct.unpack('<i', rec[:4])[0]
        if st not in (3, 13, 23):
            out.append(None)
            continue
        nparts, npts = struct.unpack('<ii', rec[36:44])
        parts = list(struct.unpack(f'<{nparts}i', rec[44:44 + 4 * nparts])) + [npts]
        o = 44 + 4 * nparts
        xy = struct.unpack(f'<{2 * npts}d', rec[o:o + 16 * npts])
        pts = list(zip(xy[0::2], xy[1::2]))
        out.append([pts[parts[i]:parts[i + 1]] for i in range(nparts) if parts[i + 1] - parts[i] >= 2])
    return out


def read_snv(zbytes: bytes) -> list[tuple[dict, list]]:
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    shp = next(n for n in z.namelist() if n.lower().endswith('.shp'))
    dbf = shp[:-4] + '.dbf'
    cpg = shp[:-4] + '.cpg'
    enc = z.read(cpg).decode().strip() if cpg in z.namelist() else 'utf-8'
    rows = read_dbf(z.read(dbf), 'utf-8' if enc.upper().replace('-', '') == 'UTF8' else 'latin-1')
    geoms = read_shp_lines(z.read(shp))
    if len(rows) != len(geoms):
        raise RuntimeError(f'SNV: DBF tem {len(rows)} registros e SHP {len(geoms)}')
    return [(r, g) for r, g in zip(rows, geoms) if r and g]


def _br(v) -> str:
    s = str(v or '').strip()
    try:
        return f'{int(float(s)):03d}'
    except ValueError:
        return s


def segments(zbytes: bytes, ufs: set[str] | None, sups: set[str]) -> list[dict]:
    """Trechos federais filtrados, com coincidentes agrupados (uma geometria, várias BRs)."""
    from shapely.geometry import MultiLineString, LineString, mapping
    groups: dict[str, list[tuple[dict, list]]] = {}
    for r, parts in read_snv(zbytes):
        if (r.get('ds_jurisdi') or '').strip() != 'Federal':
            continue
        if ufs is not None and r.get('sg_uf') not in ufs:
            continue
        if (r.get('ds_sup_fed') or '') not in sups:
            continue
        key = (r.get('ds_coinc') or r.get('vl_codigo') or '').strip() or r['vl_codigo']
        groups.setdefault(key, []).append((r, parts))
    feats = []
    for key, members in groups.items():
        members.sort(key=lambda m: m[0]['vl_codigo'])
        r, parts = members[0]
        lines = [LineString(p) for p in parts]
        g = lines[0] if len(lines) == 1 else MultiLineString(lines)
        g = g.simplify(SIMPLIFY_DEG, preserve_topology=False)
        if g.is_empty:
            continue
        coinc = [{'br': _br(m[0]['vl_br']), 'codigo': m[0]['vl_codigo'], 'km_ini': m[0]['vl_km_inic'], 'km_fim': m[0]['vl_km_fina']}
                 for m in members]
        sup = r['ds_sup_fed']
        brs = '/'.join(sorted({c['br'] for c in coinc}))
        feats.append({
            'source_id': r['vl_codigo'],
            'geometry': _round(mapping(g)),
            'name': f"BR-{brs}/{r['sg_uf']} km {_km(r['vl_km_inic'])}–{_km(r['vl_km_fina'])}",
            'kind': 'pista_simples' if sup in SIMPLES else 'pista_dupla',
            'props': {
                'br': _br(r['vl_br']), 'uf': r['sg_uf'], 'codigo': r['vl_codigo'],
                'km_ini': r['vl_km_inic'], 'km_fim': r['vl_km_fina'], 'extensao_km': r.get('vl_extensa'),
                'sup': sup, 'local_ini': r.get('ds_local_i'), 'local_fim': r.get('ds_local_f'),
                'administracao': r.get('ds_tipo_ad'), 'jurisdicao': r.get('ds_jurisdi'),
                'coinc': coinc if len(coinc) > 1 else None, 'versao_snv': r.get('versao_snv'),
            },
        })
    return feats


def _km(v) -> str:
    return f'{v:.1f}'.replace('.', ',') if isinstance(v, float) else str(v)


def _round(geom: dict, nd=6) -> dict:
    def rr(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], float) else [rr(x) for x in c]
    return {'type': geom['type'], 'coordinates': rr(geom['coordinates'])}


def fetch():
    global NOTES
    name, zbytes = load_zip()
    print(f'    SNV {name} ({len(zbytes) / 1e6:.1f} MB)')
    ufs = _ufs()
    feats = segments(zbytes, ufs, SIMPLES | DUPLA)
    NOTES = (f"SNV {name[:-4]}; UFs: {','.join(sorted(ufs)) if ufs else 'todas'}; jurisdição Federal; "
             f"{sum(f['kind'] == 'pista_simples' for f in feats)} trechos de pista simples (PAV/IMP/LEN) e "
             f"{sum(f['kind'] == 'pista_dupla' for f in feats)} de pista dupla (DUP). SIRGAS 2000 tratado como WGS 84.")
    return feats
