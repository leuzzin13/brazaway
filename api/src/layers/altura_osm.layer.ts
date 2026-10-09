import { env } from '../config.js';
import { query } from '../db.js';
import type { Vehicle } from '../services/vehicle.js';
import type { LayerCostLine, LayerItem, LayerWarning, RouteCtx, RouteLayer } from './types.js';

/**
 * Limites físicos gravados em NÓS do OSM (barrier=height_restrictor, portal/cancela com maxheight, ponto sob viaduto,
 * maxwidth/maxweight em nó). O Valhalla 3.9 só lê esses limites em vias (issue valhalla#3487), então a rota passava por
 * eles. Para o veículo ACIMA do limite (altura/largura/peso estritamente maior, como o Valhalla faz nas vias), cada trecho
 * da via que passa pelo nó (até 60 m para cada lado, parando no cruzamento) vira linear_cost_factors com fator alto:
 * penaliza só a via, não a rua que cruza por cima/baixo. Veículo igual ou abaixo do limite passa normalmente.
 * Dados: importers/sources/osm_altura_nos.py (PBF do próprio Valhalla, ODbL).
 *
 * Cuidado: se UMA linha de linear_cost_factors não casar com as arestas ("Failed to edge walk line feature", erro 233),
 * o Valhalla recusa o pedido inteiro. Isso acontece quando a via não é trafegável para ESTE veículo (ex.: a própria via
 * já tem maxheight menor, acesso privado) ou em casamentos frágeis. Por isso cada linha é validada uma vez por perfil de
 * veículo (cache em memória) e, se falhar, tentamos as duas metades (antes/depois do nó); o que não casar é descartado.
 */
const LAYER = 'altura_osm';
/** fator do linear_cost_factors: "proibido salvo sem alternativa" (ver types.ts) */
export const BLOCK_FACTOR = 1000;
/** buffer (m) em volta da rota para dizer que ela percorre o trecho da via (a geometria da rota é a do próprio OSM) */
export const ALONG_BUFFER_M = 5;
/** fração mínima do trecho dentro do buffer para contar como "a rota passa por ali" (e não por cima/baixo) */
export const ALONG_MIN_RATIO = 0.6;

interface NodeLine { way_id: number; oneway: boolean; coords: [number, number][] }
interface NodeProps {
  osm_node: number; osm_url: string;
  max_height_m: number | null; max_weight_t: number | null; max_width_m: number | null;
  barrier?: string | null; access?: string | null;
  ways?: { way_id: number; highway: string; name: string | null }[];
  lines: NodeLine[];
}
interface NodeRow { id: string; name: string | null; kind: string | null; props: NodeProps; lon: number; lat: number }

/** cache de validação do edge walk: chave = linha + sentido + perfil do veículo */
const walkCache = new Map<string, boolean>();
const WALK_CACHE_MAX = 50_000;
const VALIDATE_CONCURRENCY = 8;

function vehicleSig(v: Vehicle): string {
  return [v.height_m, v.width_m, v.length_m, v.weight_t, v.axle_load_t, v.axle_count, v.hazmat ? 1 : 0].join('|');
}

/** true = o Valhalla casa a linha com as arestas para este veículo; false = não casa; null = indeterminado (erro/timeout). */
async function edgeWalkOk(coords: [number, number][], v: Vehicle): Promise<boolean | null> {
  const a = coords[0], b = coords[coords.length - 1];
  const body = {
    locations: [{ lat: a[1], lon: a[0], type: 'break' }, { lat: b[1], lon: b[0], type: 'break' }],
    costing: 'truck',
    costing_options: { truck: { height: v.height_m, width: v.width_m, length: v.length_m, weight: v.weight_t, axle_load: v.axle_load_t, axle_count: v.axle_count, hazmat: v.hazmat } },
    linear_cost_factors: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { factor: BLOCK_FACTOR } }],
    units: 'kilometers',
  };
  try {
    const res = await fetch(`${env.valhallaUrl}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (res.ok) { await res.arrayBuffer(); return true; }
    const j = (await res.json().catch(() => ({}))) as { error_code?: number; error?: string };
    if (j.error_code === 442 || /no path/i.test(j.error ?? '')) return true;            // casou; só não há rota entre as pontas
    if (j.error_code === 233 || /edge walk/i.test(j.error ?? '')) return false;
    if (j.error_code === 171 || j.error_code === 172) return false;                     // pontas fora de via deste veículo
    return null;
  } catch {
    return null;
  }
}

async function validated(key: string, coords: [number, number][], v: Vehicle): Promise<boolean> {
  const k = `${key}|${vehicleSig(v)}`;
  const hit = walkCache.get(k);
  if (hit !== undefined) return hit;
  const ok = await edgeWalkOk(coords, v);
  if (ok === null) return false; // na dúvida não manda (uma linha ruim derrubaria a rota inteira); não cacheia
  if (walkCache.size >= WALK_CACHE_MAX) walkCache.clear();
  walkCache.set(k, ok);
  return ok;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

function sqDist(a: [number, number], b: [number, number]) { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }

const num = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');

/** Quais limites do nó o veículo excede (vazio = passa). */
export function exceeded(p: Pick<NodeProps, 'max_height_m' | 'max_weight_t' | 'max_width_m'>, v: Pick<Vehicle, 'height_m' | 'weight_t' | 'width_m'>): string[] {
  const out: string[] = [];
  if (p.max_height_m != null && v.height_m > p.max_height_m) out.push(`altura máx. ${num(p.max_height_m)} m; seu veículo: ${num(v.height_m)} m`);
  if (p.max_width_m != null && v.width_m > p.max_width_m) out.push(`largura máx. ${num(p.max_width_m)} m; seu veículo: ${num(v.width_m)} m`);
  if (p.max_weight_t != null && v.weight_t > p.max_weight_t) out.push(`peso máx. ${num(p.max_weight_t)} t; seu veículo: ${num(v.weight_t)} t`);
  return out;
}

function itemOf(r: NodeRow, rule: string): LayerItem {
  const p = r.props;
  return {
    kind: 'layer', layer: LAYER, id: r.id, name: r.name ?? 'Limite em ponto do OSM', type: r.kind ?? undefined, rule,
    value_num: p.max_height_m ?? p.max_width_m ?? p.max_weight_t ?? null, lat: r.lat, lon: r.lon,
    note: `OSM nó ${p.osm_node} (${p.osm_url})`,
  };
}

/** Caixa que contém origem e destino com folga (desvios), em graus. */
function corridor(ctx: RouteCtx): [number, number, number, number] {
  const { origin: o, destination: d } = ctx;
  const span = Math.max(Math.abs(o.lon - d.lon), Math.abs(o.lat - d.lat));
  const pad = Math.max(0.1, span * 0.35);
  return [Math.min(o.lon, d.lon) - pad, Math.min(o.lat, d.lat) - pad, Math.max(o.lon, d.lon) + pad, Math.max(o.lat, d.lat) + pad];
}

async function blockingNodes(ctx: RouteCtx): Promise<NodeRow[]> {
  const v = ctx.vehicle;
  const r = await query<NodeRow>(
    `select id::text, name, kind, props, ST_X(geom) as lon, ST_Y(geom) as lat
       from data_features
      where layer_id = $1 and geom && ST_MakeEnvelope($2,$3,$4,$5,4326)
        and (valid_to is null or valid_to > now())
        and ((props->>'max_height_m')::float < $6 or (props->>'max_width_m')::float < $7 or (props->>'max_weight_t')::float < $8)`,
    [LAYER, ...corridor(ctx), v.height_m, v.width_m, v.weight_t],
  );
  return r.rows;
}

/**
 * Nós da camada cuja via a rota PERCORRE (trecho do nó com >= ALONG_MIN_RATIO dentro de ALONG_BUFFER_M da rota).
 * Passar por cima ou por baixo do ponto (viaduto) não conta.
 */
async function nodesAlong(line: GeoJSON.LineString): Promise<(NodeRow & { fraction: number; ratio: number })[]> {
  const r = await query<NodeRow & { fraction: number; ratio: number }>(
    `with r as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g),
          b as (select ST_Buffer(g::geography, $2)::geometry as buf from r),
          c as (select f.id, f.name, f.kind, f.props, f.geom from data_features f, b
                 where f.layer_id = $3 and f.geom && b.buf and ST_Intersects(f.geom, b.buf)
                   and (f.valid_to is null or f.valid_to > now())),
          l as (select c.id, ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type','LineString','coordinates', x->'coords')::text), 4326) as lg
                  from c, jsonb_array_elements(c.props->'lines') x)
     select c.id::text, c.name, c.kind, c.props, ST_X(c.geom) as lon, ST_Y(c.geom) as lat,
            ST_LineLocatePoint(r.g, c.geom)::float as fraction,
            coalesce((select max(ST_Length(ST_Intersection(l.lg, b.buf)::geography) / nullif(ST_Length(l.lg::geography), 0))
                        from l where l.id = c.id), 0)::float as ratio
       from c, r, b
      order by fraction`,
    [JSON.stringify(line), ALONG_BUFFER_M, LAYER],
  );
  return r.rows.filter((x) => x.ratio >= ALONG_MIN_RATIO);
}

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Limitadores de altura (OSM)',
    description: 'Limitadores de altura e limites de altura/largura/peso gravados em pontos do OSM, que o roteador ignorava. Bloqueia o trecho só para veículo acima do limite.',
    group: 'restricoes',
    sources: [
      { name: 'OpenStreetMap — nós com maxheight/maxwidth/maxweight e barrier=height_restrictor', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0 — © colaboradores do OpenStreetMap' },
    ],
    style: { kind: 'circle', color: '#dc2626', icon: '🚧', minzoom: 10, radius: 6 },
    defaultVisible: false,
  },

  async costLines(ctx) {
    const v = ctx.vehicle;
    // candidatos: (linha inteira, sentido) de cada nó que o veículo excede
    interface Cand { key: string; item: LayerItem; coords: [number, number][]; node: [number, number] }
    const cands: Cand[] = [];
    for (const r of await blockingNodes(ctx)) {
      const why = exceeded(r.props, v);
      if (!why.length) continue;
      const item = itemOf(r, why.join('; '));
      for (const l of r.props.lines ?? []) {
        if (!l.coords || l.coords.length < 2) continue;
        cands.push({ key: `${r.id}|${l.way_id}|f`, item, coords: l.coords, node: [r.lon, r.lat] });
        // o Valhalla casa a linha com a aresta NO SENTIDO dela: em via de mão dupla mandamos também o sentido contrário
        if (!l.oneway) cands.push({ key: `${r.id}|${l.way_id}|r`, item, coords: [...l.coords].reverse(), node: [r.lon, r.lat] });
      }
    }
    const parts = await mapLimit(cands, VALIDATE_CONCURRENCY, async (c) => {
      if (await validated(c.key, c.coords, v)) return [c.coords];
      // casamento frágil: tenta as duas metades (antes e depois do nó); qualquer uma já impede passar pelo nó
      let k = 0;
      c.coords.forEach((p, i) => { if (sqDist(p, c.node) < sqDist(c.coords[k], c.node)) k = i; });
      const halves = [c.coords.slice(0, k + 1), c.coords.slice(k)].filter((h) => h.length >= 2);
      const ok: [number, number][][] = [];
      for (const [i, h] of halves.entries()) if (await validated(`${c.key}|h${i}`, h, v)) ok.push(h);
      return ok;
    });
    const out: LayerCostLine[] = [];
    cands.forEach((c, i) => { for (const coords of parts[i]) out.push({ item: c.item, coordinates: coords, factor: BLOCK_FACTOR }); });
    return out;
  },

  async annotate(ctx, route) {
    const v = ctx.vehicle;
    const along = await nodesAlong(route.line.geometry);
    const warnings: LayerWarning[] = [];
    const naRota = along.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, lat: r.lat, lon: r.lon, osm_url: r.props.osm_url,
      max_height_m: r.props.max_height_m, max_width_m: r.props.max_width_m, max_weight_t: r.props.max_weight_t,
      excede: exceeded(r.props, v),
    }));
    // pouca folga (não bloqueia, mas vale atenção): altura até 10 cm acima do veículo, largura até 10 cm
    for (const r of along) {
      const p = r.props;
      if (exceeded(p, v).length) continue; // bloqueado e mesmo assim usado: routing.ts já avisa (uses_restricted_way)
      const folgaH = p.max_height_m != null ? p.max_height_m - v.height_m : null;
      const folgaW = p.max_width_m != null ? p.max_width_m - v.width_m : null;
      if (folgaH != null && folgaH <= 0.1) {
        warnings.push({ code: 'osm_node_tight_height', severity: 'warn', id: r.id, lat: r.lat, lon: r.lon,
          message: `Pouca folga: ${r.name ?? 'limite de altura'} e seu veículo tem ${num(v.height_m)} m. Confira a altura real da carga.` });
      } else if (folgaW != null && folgaW <= 0.1) {
        warnings.push({ code: 'osm_node_tight_width', severity: 'warn', id: r.id, lat: r.lat, lon: r.lon,
          message: `Pouca folga: ${r.name ?? 'limite de largura'} e seu veículo tem ${num(v.width_m)} m de largura.` });
      }
    }
    // quantos pontos bloqueantes a rota sem restrições usaria (= evitados pela rota calculada)
    let evitados = 0;
    if (route.free) {
      const freeAlong = await nodesAlong(route.free.line.geometry);
      const used = new Set(along.map((r) => r.id));
      evitados = freeAlong.filter((r) => exceeded(r.props, v).length && !used.has(r.id)).length;
    }
    const summary: string[] = [];
    if (evitados) summary.push(`${evitados} ponto(s) com limite de altura/largura/peso abaixo do seu veículo evitado(s).`);
    if (naRota.length) summary.push(`${naRota.length} ponto(s) com limite gravado no mapa na rota; ${naRota.filter((n) => !n.excede.length).length} compatível(is) com o veículo.`);
    return { summary, warnings, data: { na_rota: naRota, evitados } };
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 10) return { type: 'FeatureCollection', features: [] };
    const r = await query<NodeRow>(
      `select id::text, name, kind, props, ST_X(geom) as lon, ST_Y(geom) as lat from data_features
        where layer_id = $1 and geom && ST_MakeEnvelope($2,$3,$4,$5,4326) and (valid_to is null or valid_to > now())
        limit 2000`,
      [LAYER, ...bbox],
    );
    const features: GeoJSON.Feature[] = [];
    const tipo: Record<string, string> = { limitador_altura: 'limitador de altura', altura: 'altura máxima (ponto)', largura: 'largura máxima (ponto)', peso: 'peso máximo (ponto)' };
    for (const row of r.rows) {
      const p = row.props;
      const props = {
        id: row.id, name: row.name, tipo: tipo[row.kind ?? ''] ?? row.kind,
        altura_max_m: p.max_height_m, largura_max_m: p.max_width_m, peso_max_t: p.max_weight_t,
        acesso: p.access ?? null, via: p.ways?.map((w) => w.name).filter(Boolean).join(' / ') || null,
        osm: p.osm_url, efeito: 'bloqueia o trecho só para veículo acima do limite',
      };
      features.push({ type: 'Feature', id: row.id, geometry: { type: 'Point', coordinates: [row.lon, row.lat] }, properties: props });
      // trecho penalizado (zoom alto)
      if ((zoom ?? 12) >= 16) {
        for (const l of p.lines ?? []) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: { ...props, id: `${row.id}-${l.way_id}` } });
      }
    }
    return { type: 'FeatureCollection', features };
  },
};

export default layer;
