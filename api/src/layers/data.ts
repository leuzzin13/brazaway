/** Helpers de leitura da tabela genérica data_features. */
import { query } from '../db.js';

export interface DataFeatureRow {
  id: string;
  layer_id: string;
  source: string;
  source_id: string;
  name: string | null;
  kind: string | null;
  props: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
  valid_from: string | null;
  valid_to: string | null;
}

const COLS = `id::text, layer_id, source, source_id, name, kind, props, ST_AsGeoJSON(geom, 6)::json as geometry, valid_from, valid_to`;

/** Feições de uma camada num bbox. `where` é SQL extra opcional (use parâmetros a partir de $7). */
export async function featuresInBbox(
  layerId: string, bbox: [number, number, number, number], opts: { limit?: number; where?: string; params?: unknown[]; simplify?: number } = {},
): Promise<DataFeatureRow[]> {
  const geomExpr = opts.simplify ? `ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${Number(opts.simplify)}), 6)::json as geometry` : null;
  const cols = geomExpr ? COLS.replace(`ST_AsGeoJSON(geom, 6)::json as geometry`, geomExpr) : COLS;
  const r = await query<DataFeatureRow>(
    `select ${cols} from data_features
      where layer_id = $1 and geom && ST_MakeEnvelope($2,$3,$4,$5,4326)
        and (valid_to is null or valid_to > now())
        ${opts.where ? `and (${opts.where})` : ''}
      limit $6`,
    [layerId, ...bbox, opts.limit ?? 3000, ...(opts.params ?? [])],
  );
  return r.rows;
}

export function toFeatureCollection(rows: DataFeatureRow[], extra?: (r: DataFeatureRow) => Record<string, unknown>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: r.geometry,
      properties: { id: r.id, name: r.name, kind: r.kind, source: r.source, ...r.props, ...(extra ? extra(r) : {}) },
    })),
  };
}

export interface NearRouteRow extends DataFeatureRow {
  distance_m: number;
  /** posição ao longo da rota, 0..1 */
  fraction: number;
}

/** Feições de uma camada a até radiusM da linha da rota, ordenadas pela posição na rota. */
export async function featuresNearRoute(
  layerId: string, line: GeoJSON.LineString, radiusM: number, opts: { limit?: number; where?: string; params?: unknown[] } = {},
): Promise<NearRouteRow[]> {
  const r = await query<NearRouteRow>(
    `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) as g)
     select ${COLS},
            ST_Distance(f.geom::geography, l.g::geography)::float as distance_m,
            ST_LineLocatePoint(l.g, ST_PointOnSurface(f.geom))::float as fraction
       from data_features f, l
      where f.layer_id = $1
        and f.geom && ST_Expand(l.g, $3 / 90000.0)
        and ST_DWithin(f.geom::geography, l.g::geography, $3)
        and (f.valid_to is null or f.valid_to > now())
        ${opts.where ? `and (${opts.where})` : ''}
      order by fraction
      limit $4`,
    [layerId, JSON.stringify(line), radiusM, opts.limit ?? 500, ...(opts.params ?? [])],
  );
  return r.rows;
}

/** Última carga registrada da camada (proveniência). */
export async function lastRuns(layerId?: string) {
  const r = await query(
    `select distinct on (layer_id, source) layer_id, source, source_url, license, record_count, notes, imported_at
       from data_layer_runs ${layerId ? 'where layer_id = $1' : ''}
      order by layer_id, source, imported_at desc`,
    layerId ? [layerId] : [],
  );
  return r.rows;
}
