import { env } from '../config.js';
import { query } from '../db.js';
import * as valhalla from '../services/valhalla.js';
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
 *
 * Quais linhas vão para o Valhalla (comparando com a rota livre, calculada aqui antes):
 *  - NÃO vai a linha que corre paralela à rota livre a menos de 15 m sem ser usada por ela (pista do outro sentido,
 *    marginal/local): o routing.ts mede "rota usa o trecho" com 15 m de tolerância e daria falso "trecho restrito";
 *  - NÃO vai nó em via de serviço/estacionamento a mais de 2 km da rota livre (portaria de garagem 2,1 m longe da
 *    rota não muda nada), nem nó em outra via a mais de 10% do comprimento da rota livre (5 a 30 km): cada linha extra
 *    custa tempo na comparação do routing.ts (turf, ~10 ms por linha numa rota de 400 km);
 *  - o resto vai.
 * Rede de segurança: se a rota final passar por um nó que o veículo excede e cuja linha não foi enviada, annotate()
 * avisa com severidade 'danger'.
 */
const LAYER = 'altura_osm';
/**
 * fator do linear_cost_factors: "proibido salvo sem alternativa". NÃO usamos o 1000 sugerido em types.ts: o Valhalla
 * aplica a MÉDIA do fator na aresta inteira (custom_cost_t::avg_factor), então o trecho do nó (~120 m) numa aresta longa
 * de rodovia dilui 1000 para poucas vezes o custo; e em rota longa o Valhalla poda vias locais no meio do caminho, o
 * desvio vira dezenas de km e fica mais caro que o trecho "penalizado". Medido: nó 3908618328 (Dutra, 4,3 m), carreta
 * Rio->SP: com 1000 a rota é idêntica à sem fator; com 100000 desvia (+38 km). Em rota curta 1000 já bastava.
 * 100000 é o teto dos fatores na doc do Valhalla.
 */
export const BLOCK_FACTOR = 100000;
/** buffer (m) em volta da rota para dizer que ela percorre o trecho da via (a geometria da rota é a do próprio OSM) */
export const ALONG_BUFFER_M = 5;
/** fração mínima do trecho dentro do buffer para contar como "a rota passa por ali" (e não por cima/baixo) */
export const ALONG_MIN_RATIO = 0.6;
/** abaixo disto (a 5 m) a rota livre não está NA via do nó, mesmo que esteja a menos de 15 m dela (pista paralela) */
const PARALLEL_MAX_RATIO = 0.1;
/** tolerância e razão que o routing.ts usa para dizer que a rota "usa" um trecho penalizado (usesCostLine) */
const ROUTING_TOL_M = 15;
const ROUTING_MIN_RATIO = 0.5;
/** nós em via de serviço/estacionamento só entram se estiverem a até esta distância da rota livre */
const MINOR_NEAR_M = 2000;
/** nós nas demais vias: até 10% do comprimento da rota livre, entre 5 e 30 km (desvios de zona/reportes cabem nisso) */
const MAIN_NEAR = { frac: 0.1, minM: 5000, maxM: 30000 };
const MINOR_HIGHWAYS = new Set(['service', 'living_street', 'track', 'road']);
/** distância máxima nó↔rota para a rota poder percorrer a linha do nó (linhas têm até 60 m para cada lado) */
const NODE_NEAR_ROUTE_M = 65;

interface NodeLine { way_id: number; oneway: boolean; coords: [number, number][] }
interface NodeProps {
  osm_node: number; osm_url: string;
  max_height_m: number | null; max_weight_t: number | null; max_width_m: number | null;
  barrier?: string | null; access?: string | null;
  ways?: { way_id: number; highway: string; name: string | null }[];
  lines: NodeLine[];
}
interface NodeRow { id: string; name: string | null; kind: string | null; props: NodeProps; lon: number; lat: number }
/** uso de cada linha de nó por uma rota: fração a 5 m (percorre) e a 15 m (o routing.ts acharia que percorre) */
interface LineUseRow extends NodeRow { li: number; r_along: number; r_near: number; near_minor: boolean; near_main: boolean; fraction: number }

/** o que costLines() mandou para o Valhalla nesta rota (annotate usa para a rede de segurança) */
interface SentInfo { ids: Set<string>; lines: number; paralelas: number; longe: number; sem_casamento: number; rota_livre: boolean }
const sentByCtx = new WeakMap<RouteCtx, SentInfo>();

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
 * Para cada linha (trecho de via) dos nós escolhidos: fração dela a até 5 m da rota (percorre) e a até 15 m (medida do
 * routing.ts), e se o nó está a ~2 km da rota. Rápido em rota longa: a rota é picada (ST_Subdivide), só os pedaços perto
 * de cada linha entram na conta e as medidas são planas no fuso UTM SIRGAS 2000 do nó (31978..31985).
 * `ids` = nós a avaliar; sem ids, avalia os nós a até NODE_NEAR_ROUTE_M da rota (filtro em graus, folgado).
 */
async function lineUse(line: GeoJSON.LineString, ids?: string[], mainNearM = MAIN_NEAR.minM): Promise<LineUseRow[]> {
  const r = await query<LineUseRow>(
    `with r as materialized (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g),
          parts as materialized (select ST_Subdivide(r.g, 32) as p from r),
          c as materialized (
            select f.id, f.name, f.kind, f.props, f.geom, (x.ord - 1)::int as li,
                   ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', x.l->'coords')::text), 4326) as lg,
                   ST_DWithin(f.geom, r.g, $6 / 111000.0) as near_minor,
                   ST_DWithin(f.geom, r.g, $8 / 111000.0) as near_main,
                   31960 + floor((ST_X(f.geom) + 180) / 6)::int + 1 as utm
              from data_features f cross join r
             cross join lateral jsonb_array_elements(f.props->'lines') with ordinality as x(l, ord)
             where f.layer_id = $2 and (f.valid_to is null or f.valid_to > now())
               and (case when $3::bigint[] is null then ST_DWithin(f.geom, r.g, $4 / 55000.0) else f.id = any($3::bigint[]) end)
               and jsonb_array_length(x.l->'coords') >= 2),
          p as materialized (
            select c.*, ST_Transform(c.lg, c.utm) as lm,
                   (select ST_Transform(ST_Collect(parts.p), c.utm) from parts where parts.p && ST_Expand(c.lg, 0.0005)) as pm
              from c)
     select p.id::text, p.name, p.kind, p.props, ST_X(p.geom) as lon, ST_Y(p.geom) as lat, p.li, p.near_minor, p.near_main,
            ST_LineLocatePoint((select g from r), p.geom)::float as fraction,
            (case when p.pm is null or ST_Length(p.lm) = 0 then 0
                  else ST_Length(ST_Intersection(p.lm, ST_Buffer(p.pm, $7))) / ST_Length(p.lm) end)::float as r_along,
            (case when p.pm is null or ST_Length(p.lm) = 0 then 0
                  else ST_Length(ST_Intersection(p.lm, ST_Buffer(p.pm, $5))) / ST_Length(p.lm) end)::float as r_near
       from p`,
    [JSON.stringify(line), LAYER, ids ?? null, NODE_NEAR_ROUTE_M, ROUTING_TOL_M, MINOR_NEAR_M, ALONG_BUFFER_M, mainNearM],
  );
  return r.rows;
}

/** Nós cuja via a rota PERCORRE (alguma linha com >= ALONG_MIN_RATIO a 5 m da rota), em ordem ao longo da rota.
 *  Passar por cima ou por baixo do ponto (viaduto) não conta. */
async function nodesAlong(line: GeoJSON.LineString): Promise<NodeRow[]> {
  const best = new Map<string, LineUseRow>();
  for (const u of await lineUse(line)) {
    const b = best.get(u.id);
    if (!b || u.r_along > b.r_along) best.set(u.id, u);
  }
  return [...best.values()].filter((u) => u.r_along >= ALONG_MIN_RATIO).sort((a, b) => a.fraction - b.fraction);
}

function isMinor(p: NodeProps): boolean {
  const hws = (p.ways ?? []).map((w) => w.highway);
  return hws.length > 0 && hws.every((h) => MINOR_HIGHWAYS.has(h));
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
    const nodes = (await blockingNodes(ctx)).filter((r) => exceeded(r.props, v).length);
    const info: SentInfo = { ids: new Set(), lines: 0, paralelas: 0, longe: 0, sem_casamento: 0, rota_livre: false };
    sentByCtx.set(ctx, info);
    if (!nodes.length) return [];

    // uso de cada linha pela rota livre (sem restrições); sem rota livre, manda tudo
    let use: Map<string, LineUseRow> | null = null;
    try {
      const free = await valhalla.route({ origin: ctx.origin, destination: ctx.destination, vehicle: v, departureLocal: ctx.departureLocal });
      const mainNearM = Math.min(MAIN_NEAR.maxM, Math.max(MAIN_NEAR.minM, free.distance_km * 1000 * MAIN_NEAR.frac));
      const rows = await lineUse({ type: 'LineString', coordinates: free.coordinates }, nodes.map((n) => n.id), mainNearM);
      use = new Map(rows.map((u) => [`${u.id}|${u.li}`, u]));
      info.rota_livre = true;
    } catch { use = null; }

    // candidatos: (linha, sentido) de cada nó que o veículo excede
    interface Cand { key: string; item: LayerItem; coords: [number, number][]; node: [number, number]; nodeId: string }
    const cands: Cand[] = [];
    for (const r of nodes) {
      const item = itemOf(r, exceeded(r.props, v).join('; '));
      const minor = isMinor(r.props);
      (r.props.lines ?? []).forEach((l, li) => {
        if (!l.coords || l.coords.length < 2) return;
        const u = use?.get(`${r.id}|${li}`);
        if (u && u.r_along < PARALLEL_MAX_RATIO) {
          if (u.r_near >= ROUTING_MIN_RATIO) { info.paralelas++; return; }   // pista paralela não usada pela rota livre
          if (minor ? !u.near_minor : !u.near_main) { info.longe++; return; } // longe da rota livre
        }
        cands.push({ key: `${r.id}|${l.way_id}|${li}|f`, item, coords: l.coords, node: [r.lon, r.lat], nodeId: r.id });
        // o Valhalla casa a linha com a aresta NO SENTIDO dela: em via de mão dupla mandamos também o sentido contrário
        if (!l.oneway) cands.push({ key: `${r.id}|${l.way_id}|${li}|r`, item, coords: [...l.coords].reverse(), node: [r.lon, r.lat], nodeId: r.id });
      });
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
    cands.forEach((c, i) => {
      if (!parts[i].length) { info.sem_casamento++; return; }
      info.ids.add(c.nodeId);
      for (const coords of parts[i]) out.push({ item: c.item, coordinates: coords, factor: BLOCK_FACTOR });
    });
    info.lines = out.length;
    return out;
  },

  async annotate(ctx, route) {
    const v = ctx.vehicle;
    const sent = sentByCtx.get(ctx);
    const along = await nodesAlong(route.line.geometry);
    const warnings: LayerWarning[] = [];
    const naRota = along.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, lat: r.lat, lon: r.lon, osm_url: r.props.osm_url,
      max_height_m: r.props.max_height_m, max_width_m: r.props.max_width_m, max_weight_t: r.props.max_weight_t,
      excede: exceeded(r.props, v),
    }));
    for (const r of along) {
      const p = r.props;
      const why = exceeded(p, v);
      if (why.length) {
        // nó enviado ao Valhalla e mesmo assim usado: o routing.ts já avisa (uses_restricted_way). Não enviado: avisamos aqui.
        if (!sent?.ids.has(r.id)) {
          warnings.push({ code: 'osm_node_limit_on_route', severity: 'danger', id: r.id, lat: r.lat, lon: r.lon,
            message: `A rota passa por ${r.name ?? 'limite em ponto do mapa'} (${why.join('; ')}). Procure outro caminho ou confirme a placa.` });
        }
        continue;
      }
      // pouca folga (não bloqueia, mas vale atenção): até 10 cm de sobra na altura ou na largura
      const folgaH = p.max_height_m != null ? p.max_height_m - v.height_m : null;
      const folgaW = p.max_width_m != null ? p.max_width_m - v.width_m : null;
      if (folgaH != null && folgaH <= 0.1 + 1e-9) {
        warnings.push({ code: 'osm_node_tight_height', severity: 'warn', id: r.id, lat: r.lat, lon: r.lon,
          message: `Pouca folga em ${r.name ?? 'limite de altura'}: seu veículo tem ${num(v.height_m)} m. Confira a altura real da carga.` });
      } else if (folgaW != null && folgaW <= 0.1 + 1e-9) {
        warnings.push({ code: 'osm_node_tight_width', severity: 'warn', id: r.id, lat: r.lat, lon: r.lon,
          message: `Pouca folga em ${r.name ?? 'limite de largura'}: seu veículo tem ${num(v.width_m)} m de largura.` });
      }
    }
    // quantos pontos bloqueantes a rota sem restrições usaria e a rota calculada não usa (= evitados)
    let evitados: { id: string; name: string | null; lat: number; lon: number }[] = [];
    if (route.free) {
      const used = new Set(along.map((r) => r.id));
      evitados = (await nodesAlong(route.free.line.geometry))
        .filter((r) => exceeded(r.props, v).length && !used.has(r.id))
        .map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon }));
    }
    const summary: string[] = [];
    if (evitados.length) summary.push(`Desvia de ${evitados.length === 1 ? '1 ponto' : `${evitados.length} pontos`} com limite abaixo do seu veículo (marcado em nó do OSM, que o roteador ignorava).`);
    if (naRota.length) {
      const ok = naRota.filter((n) => !n.excede.length).length;
      summary.push(`${naRota.length === 1 ? '1 ponto' : `${naRota.length} pontos`} com limite de altura/largura/peso na rota; ${ok} compatível(is) com o veículo.`);
    }
    return {
      summary, warnings,
      data: {
        na_rota: naRota, evitados,
        enviados: sent ? { nos: sent.ids.size, linhas: sent.lines, descartadas_paralelas: sent.paralelas, descartadas_longe: sent.longe, sem_casamento: sent.sem_casamento, rota_livre: sent.rota_livre } : null,
      },
    };
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
