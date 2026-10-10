/** Índice de municípios em memória (nomes normalizados, bbox, ponto e raio), a partir de data_features
 *  (layer 'geocoding', kind 'municipio', importador cnefe_municipios) + cobertura do CNEFE (addr_municipio). */
import { query } from '../../db.js';
import { getCanon, type Canon } from './normalize.js';

export type Bbox = [number, number, number, number];

export interface Municipio {
  cod: number;
  nome: string;
  uf: string;
  canon: string;
  bbox: Bbox;
  lat: number;
  lon: number;
  /** raio equivalente (m) = sqrt(área/π) */
  raio_m: number;
  /** tem endereços do CNEFE carregados (nível "número") */
  cnefe: boolean;
}

export class MunicipioIndex {
  readonly byCod = new Map<number, Municipio>();
  private readonly byCanon = new Map<string, Municipio[]>();
  readonly ufBbox = new Map<string, Bbox>();
  readonly hasPolygons: boolean;

  constructor(list: Municipio[], hasPolygons: boolean) {
    this.hasPolygons = hasPolygons;
    for (const m of list) {
      this.byCod.set(m.cod, m);
      const arr = this.byCanon.get(m.canon) ?? [];
      arr.push(m);
      this.byCanon.set(m.canon, arr);
      const b = this.ufBbox.get(m.uf);
      this.ufBbox.set(m.uf, b ? [Math.min(b[0], m.bbox[0]), Math.min(b[1], m.bbox[1]), Math.max(b[2], m.bbox[2]), Math.max(b[3], m.bbox[3])] : [...m.bbox]);
    }
  }

  get size() { return this.byCod.size; }

  covered(): Municipio[] { return [...this.byCod.values()].filter((m) => m.cnefe); }

  /** Município pelo nome já canônico. Com UF, desempata homônimos (ex.: "Bom Jesus"). */
  find(canon: string, uf?: string): Municipio | undefined {
    const exact = this.byCanon.get(canon);
    if (exact?.length) return pick(exact, uf);
    if (canon.length < 5) return undefined;
    // tolerância a 1 erro de digitação em nomes longos
    let best: Municipio[] = [];
    for (const [k, arr] of this.byCanon) {
      if (Math.abs(k.length - canon.length) > 1) continue;
      if (lev1(k, canon)) best = best.concat(arr);
    }
    return best.length ? pick(best, uf) : undefined;
  }

  /** UF cujo bbox contém o ponto (o menor, se mais de um). */
  ufAt(lat: number, lon: number): string | undefined {
    let best: { uf: string; area: number } | undefined;
    for (const [uf, b] of this.ufBbox) {
      if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) {
        const area = (b[2] - b[0]) * (b[3] - b[1]);
        if (!best || area < best.area) best = { uf, area };
      }
    }
    return best?.uf;
  }
}

function pick(arr: Municipio[], uf?: string): Municipio {
  if (uf) {
    const m = arr.find((x) => x.uf === uf);
    if (m) return m;
  }
  // sem UF: prefere município com CNEFE carregado e depois SP (região-piloto)
  return [...arr].sort((a, b) => Number(b.cnefe) - Number(a.cnefe) || Number(b.uf === 'SP') - Number(a.uf === 'SP'))[0];
}

/** distância de edição <= 1 */
function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

let cache: { at: number; value: Promise<MunicipioIndex> } | null = null;

export function getMunicipios(): Promise<MunicipioIndex> {
  if (cache && Date.now() - cache.at < 600_000) return cache.value;
  const value = load();
  cache = { at: Date.now(), value };
  value.catch(() => { cache = null; });
  return value;
}

async function load(): Promise<MunicipioIndex> {
  const canon: Canon = await getCanon();
  const covered = new Map<number, { nome: string; uf: string }>();
  try {
    const r = await query<{ cod_mun: number; nome: string; uf: string }>('select cod_mun, nome, uf from addr_municipio where n_enderecos > 0');
    for (const x of r.rows) covered.set(x.cod_mun, { nome: x.nome, uf: x.uf });
  } catch { /* migration 0116 ausente */ }

  const list: Municipio[] = [];
  let hasPolygons = false;
  try {
    const r = await query<{ cod: number; nome: string; uf: string; x0: number; y0: number; x1: number; y1: number; lat: number; lon: number; raio_m: number }>(
      `select source_id::int as cod, name as nome, props->>'uf' as uf,
              ST_XMin(geom) x0, ST_YMin(geom) y0, ST_XMax(geom) x1, ST_YMax(geom) y1,
              ST_Y(ST_PointOnSurface(geom)) lat, ST_X(ST_PointOnSurface(geom)) lon,
              sqrt(ST_Area(geom::geography) / pi()) raio_m
         from data_features where layer_id = 'geocoding' and kind = 'municipio'`);
    hasPolygons = r.rows.length > 0;
    for (const x of r.rows) {
      list.push({ cod: x.cod, nome: x.nome, uf: x.uf, canon: canon.canon(x.nome), bbox: [x.x0, x.y0, x.x1, x.y1],
        lat: x.lat, lon: x.lon, raio_m: Math.round(x.raio_m), cnefe: covered.has(x.cod) });
    }
  } catch { /* sem polígonos */ }

  // municípios com CNEFE mas sem polígono (UF fora de GEO_UFS): bbox pelos logradouros
  const missing = [...covered.keys()].filter((c) => !list.some((m) => m.cod === c));
  if (missing.length) {
    const r = await query<{ cod_mun: number; x0: number; y0: number; x1: number; y1: number; lat: number; lon: number }>(
      `select cod_mun, min(lon) x0, min(lat) y0, max(lon) x1, max(lat) y1,
              percentile_cont(0.5) within group (order by lat) lat, percentile_cont(0.5) within group (order by lon) lon
         from addr_street where cod_mun = any($1) and lat is not null group by cod_mun`, [missing]);
    for (const x of r.rows) {
      const c = covered.get(x.cod_mun)!;
      const raio = Math.sqrt(((x.x1 - x.x0) * 102000) * ((x.y1 - x.y0) * 111000) / Math.PI);
      list.push({ cod: x.cod_mun, nome: c.nome, uf: c.uf, canon: canon.canon(c.nome), bbox: [x.x0, x.y0, x.x1, x.y1],
        lat: x.lat, lon: x.lon, raio_m: Math.round(raio), cnefe: true });
    }
  }
  return new MunicipioIndex(list, hasPolygons);
}

/** Município (código IBGE) que contém cada ponto, pelos polígonos do IBGE. `null` = fora dos municípios carregados. */
export async function municipioOfPoints(points: { lat: number; lon: number }[], toleranceM = 0): Promise<(number | null)[]> {
  if (!points.length) return [];
  const r = await query<{ i: number; cod: number | null }>(
    `select t.i::int as i,
            (select f.source_id::int from data_features f
              where f.layer_id = 'geocoding' and f.kind = 'municipio'
                and f.geom && ST_Expand(p.pt, $3::float8 / 100000.0)
                and ($3::float8 = 0 and ST_Intersects(f.geom, p.pt) or $3::float8 > 0 and ST_DWithin(f.geom::geography, p.pt::geography, $3::float8))
              order by ST_Distance(f.geom, p.pt) limit 1) as cod
       from unnest($1::float8[], $2::float8[]) with ordinality as t(lat, lon, i),
            lateral (select ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326) as pt) p`,
    [points.map((p) => p.lat), points.map((p) => p.lon), toleranceM]);
  const out: (number | null)[] = points.map(() => null);
  for (const row of r.rows) out[row.i - 1] = row.cod;
  return out;
}

/** O ponto está no município (com tolerância em metros na borda)? */
export async function pointsInMunicipio(points: { lat: number; lon: number }[], cod: number, toleranceM = 300): Promise<boolean[]> {
  if (!points.length) return [];
  const r = await query<{ i: number; ok: boolean }>(
    `select t.i::int as i,
            exists (select 1 from data_features f
                     where f.layer_id = 'geocoding' and f.kind = 'municipio' and f.source_id = $3::text
                       and ST_DWithin(f.geom::geography, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)::geography, $4)) as ok
       from unnest($1::float8[], $2::float8[]) with ordinality as t(lat, lon, i)`,
    [points.map((p) => p.lat), points.map((p) => p.lon), cod, toleranceM]);
  const out = points.map(() => false);
  for (const row of r.rows) out[row.i - 1] = row.ok;
  return out;
}
