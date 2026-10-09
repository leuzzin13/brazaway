import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { env } from '../config.js';
import { query } from '../db.js';
import { legalDayInfo, type LegalDayInfo } from '../services/calendar.js';
import { decodePolyline6 } from '../services/polyline.js';
import * as valhalla from '../services/valhalla.js';
import { LEGAL, SP_HAZMAT_WINDOWS, describeProduct, getProduct, hazmatInfo, type HazmatVehicleInfo } from '../services/hazmat.js';
import type { LayerAnnotation, LayerCostLine, LayerExclusion, LayerItem, LayerWarning, RouteCtx, RouteGeom, RouteLayer } from './types.js';

/**
 * Produtos perigosos (PP). Só age quando o veículo transporta PP (vehicle.hazmat, vehicle.hazmat_un ou cargo_type 'hazmat').
 *
 *  costLines (linear_cost_factors, fator 1000 = "proibido salvo sem alternativa"; penaliza só a via, não quem a cruza):
 *   - trechos de rodovia proibidos por portaria do DER-SP, 24h (kind 'trecho_proibido': SP-008 km 25,28–31,5, Portaria
 *     PR/DER-164/2025 art. 2º; SP-324 km 86,62–90,7, Portaria SUP/DER-062/2024 art. 1º);
 *   - vias do minianel (Anexo IV da Portaria SMT.GAB 051/2024), para TODOS os grupos, de 2ª a 6ª, exceto feriados,
 *     07h–10h e 17h–20h (art. 3º I) — kind 'via_minianel'. A ÁREA interna (centro expandido, grupos I e II) é a zona
 *     hazmat_only da frente core_legal (restriction_zones); esta camada não duplica o polígono.
 *  Isenção: carga dentro da quantidade limitada por veículo (Res. ANTT 5.998/2022, Parte 3, 3.4.3.4 c) não recebe
 *  restrição de itinerário — só quando o peso bruto é informado (vehicle.hazmat_qty_kg, se o schema tiver o campo).
 *
 *  annotate: produto/grupo SP, quantidade limitada, uso e horário estimado de passagem no minianel, trechos proibidos com
 *  origem/destino lindeiro, km em área de manancial (APRM, aviso sem bloqueio — Decreto 96.044/1988 art. 9º),
 *  emergências químicas da CETESB perto da rota, paradas de PP da ARTESP, LETPP em São Paulo e a regra da ZMRC (art. 35).
 *
 *  Os traçados das costLines vêm casados com a malha do Valhalla na importação (props.osm.tileset). Se o tileset mudou,
 *  a camada casa de novo em tempo de execução (trace_route) e valida no edge walk antes de usar (um traçado inválido
 *  derrubaria a rota inteira). Se ainda assim um trecho de rodovia não casar, ele vira exclusão estreita (12 m).
 */
const LAYER = 'perigosos';
const FACTOR = 1000;
const LINDEIRO_M = 300;

const meta: RouteLayer['meta'] = {
  id: LAYER,
  label: 'Produtos perigosos',
  description: 'Trechos proibidos para carga perigosa (DER-SP), vias do Minianel nos horários da Portaria SMT.GAB 051/2024, mananciais, emergências químicas (CETESB) e paradas de PP (ARTESP).',
  group: 'restricoes',
  sources: [
    { name: 'Portaria SMT.GAB 051/2024 (PMSP/CET)', url: 'https://cetsp.com.br/media/1592296/portaria-051-24.pdf', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'Portarias PR/DER-164/2025 e SUP/DER-062/2024 (DOE-SP)', url: 'https://doe.sp.gov.br', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'Relação de Produtos Perigosos (Res. ANTT 5.998/2022)', url: 'https://anexosportal.datalegis.net/arquivos/1774888.pdf', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'CETESB Malha Rodoviária Estadual (km)', url: 'https://arcgis.cetesb.sp.gov.br/server/rest/services/Hosted/Malha_Rodovi%C3%A1ria_Estadual_SP/FeatureServer/0', license: 'Não declarada (atribuição)' },
    { name: 'CETESB Emergências Químicas (DataGEO)', url: 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs', license: 'Não declarada (atribuição)' },
    { name: 'APRM — limites de bacia (DataGEO/SIMA)', url: 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs', license: 'Não declarada (atribuição)' },
    { name: 'ARTESP — paradas de produtos perigosos', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria', license: 'CC-BY' },
    { name: 'IBGE — malha municipal (LETPP)', url: 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/3550308', license: 'Dados públicos (citar a fonte)' },
    { name: 'OpenStreetMap (traçado das vias, via Valhalla)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL' },
  ],
  style: { kind: 'circle', color: '#c2410c', icon: '☣️', radius: 4, width: 4, minzoom: 8, opacity: 0.85 },
  defaultVisible: false,
};

// ---------------------------------------------------------------------------------------------------------------
// horário / calendário
// ---------------------------------------------------------------------------------------------------------------

function localParts(at: Date) {
  const d = DateTime.fromJSDate(at).setZone(env.tz);
  return { dow: d.weekday, hhmm: d.toFormat('HH:mm'), dt: d };
}

function inSpWindows(at: Date): boolean {
  const { dow, hhmm } = localParts(at);
  return SP_HAZMAT_WINDOWS.some((w) => (w.days as readonly number[]).includes(dow) && hhmm >= w.from && hhmm < w.to);
}

/** Restrição da Portaria 051/2024 vale neste instante? (janela, exceto feriados e suspensão publicada para PP) */
function spRuleActive(at: Date, day: LegalDayInfo): boolean {
  if (!inSpWindows(at)) return false;
  if (day.holiday) return false;
  if (day.suspensions.some((s) => (s.scope === 'hazmat' || s.scope === 'all') && !s.applies_to_heavy)) return false;
  return true;
}

const WINDOW_TXT = 'seg–sex 07h–10h e 17h–20h, exceto feriados';
const fmtH = (d: Date) => DateTime.fromJSDate(d).setZone(env.tz).toFormat("HH'h'mm");
const fmtKm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

// ---------------------------------------------------------------------------------------------------------------
// Valhalla: tileset, casamento em tempo de execução e validação do edge walk
// ---------------------------------------------------------------------------------------------------------------

type Coords = [number, number][];
let tilesetCache: { at: number; value: number | null } | null = null;
async function valhallaTileset(): Promise<number | null> {
  if (tilesetCache && Date.now() - tilesetCache.at < 60_000) return tilesetCache.value;
  let value: number | null = null;
  try {
    const r = await fetch(`${env.valhallaUrl}/status`, { signal: AbortSignal.timeout(3000) });
    value = ((await r.json()) as { tileset_last_modified?: number }).tileset_last_modified ?? null;
  } catch { value = null; }
  tilesetCache = { at: Date.now(), value };
  return value;
}

function lineLenM(c: Coords): number {
  return c.length < 2 ? 0 : turf.length(turf.lineString(c), { units: 'meters' });
}

function densify(c: Coords, stepM = 40): Coords {
  const out: Coords = [c[0]];
  for (let i = 0; i < c.length - 1; i++) {
    const [a, b] = [c[i], c[i + 1]];
    const n = Math.max(1, Math.floor(turf.distance(a, b, { units: 'meters' }) / stepM));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

async function traceMatch(coords: Coords): Promise<Coords[] | null> {
  try {
    const res = await fetch(`${env.valhallaUrl}/trace_route`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ shape: densify(coords).map(([lon, lat]) => ({ lon, lat })), costing: 'truck', shape_match: 'map_snap',
        trace_options: { search_radius: 50, gps_accuracy: 15 } }),
    });
    const j = (await res.json()) as any;
    if (!res.ok || !j.trip) return null;
    const legs: Coords[] = (j.trip.legs as any[]).map((l) => decodePolyline6(l.shape)).filter((l) => l.length >= 2 && lineLenM(l) >= 5);
    const L = lineLenM(coords), M = legs.reduce((s, l) => s + lineLenM(l), 0);
    if (!legs.length || M > L * 1.3 + 50 || M < L * 0.7 - 30) return null;
    return legs;
  } catch { return null; }
}

const PROBE = [{ lon: -46.656, lat: -23.5614 }, { lon: -46.645, lat: -23.57 }];
/** Valida traçados no edge walk de linear_cost_factors com uma rota curta real (bisseção em lote). null = não deu para validar. */
async function edgeWalkOk(lines: Coords[]): Promise<boolean[] | null> {
  const ok = async (batch: Coords[]): Promise<boolean> => {
    const res = await fetch(`${env.valhallaUrl}/route`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ locations: PROBE, costing: 'truck', directions_type: 'none',
        linear_cost_factors: batch.map((c) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: { factor: 1.01 } })) }),
    });
    if (res.ok) return true;
    const j = (await res.json().catch(() => ({}))) as any;
    if (j?.error_code === 233 || /edge walk/i.test(String(j?.error ?? ''))) return false;
    throw new Error(`Valhalla /route ${res.status}: ${j?.error ?? ''}`);
  };
  const out = lines.map(() => false);
  const rec = async (idx: number[]): Promise<void> => {
    if (!idx.length) return;
    if (await ok(idx.map((i) => lines[i]))) { for (const i of idx) out[i] = true; return; }
    if (idx.length === 1) return;
    const mid = idx.length >> 1;
    await rec(idx.slice(0, mid));
    await rec(idx.slice(mid));
  };
  try {
    for (let s = 0; s < lines.length; s += 200) await rec(lines.map((_, i) => i).slice(s, s + 200));
  } catch { return null; }
  return out;
}

interface RouteRow { id: string; name: string | null; kind: string; props: Record<string, any>; geometry: GeoJSON.LineString }

/** traçados casados por (tileset, id da feição); preenchido sob demanda quando o tileset da importação não é o atual */
const rematchCache = new Map<string, Promise<Coords[] | null>>();

async function rematchRows(rows: RouteRow[], tileset: number): Promise<Map<string, Coords[] | null>> {
  const out = new Map<string, Coords[] | null>();
  const todo = rows.filter((r) => !rematchCache.has(`${tileset}:${r.id}`));
  if (todo.length) {
    const job = (async () => {
      const matched = new Map<string, Coords[]>();
      let i = 0;
      const worker = async () => {
        while (i < todo.length) {
          const r = todo[i++];
          const g = r.geometry.coordinates as Coords;
          const dirs: Coords[] = r.kind === 'trecho_proibido' ? [g, [...g].reverse()] : [g];
          const legs: Coords[] = [];
          for (const d of dirs) legs.push(...((await traceMatch(d)) ?? []));
          matched.set(r.id, legs);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      const flat: { id: string; c: Coords }[] = [];
      for (const [id, legs] of matched) for (const c of legs) flat.push({ id, c });
      const ok = await edgeWalkOk(flat.map((f) => f.c));
      const res = new Map<string, Coords[] | null>();
      for (const r of todo) res.set(r.id, ok ? [] : null);
      if (ok) flat.forEach((f, k) => { if (ok[k]) res.get(f.id)!.push(f.c); });
      return res;
    })();
    for (const r of todo) rematchCache.set(`${tileset}:${r.id}`, job.then((m) => { const v = m.get(r.id); return v && v.length ? v : null; }));
  }
  for (const r of rows) out.set(r.id, await rematchCache.get(`${tileset}:${r.id}`)!);
  return out;
}

/** Traçados (sentido do tráfego) que podem ir para linear_cost_factors, ou null se não houver traçado válido. */
async function routableLines(rows: RouteRow[]): Promise<Map<string, Coords[] | null>> {
  const tileset = await valhallaTileset();
  const out = new Map<string, Coords[] | null>();
  const stale: RouteRow[] = [];
  for (const r of rows) {
    const osm = r.props.osm as { tileset?: number; geom?: boolean; lines?: { coords: Coords }[] } | undefined;
    if (tileset && osm?.tileset === tileset) {
      out.set(r.id, osm.geom ? [r.geometry.coordinates as Coords] : (osm.lines ?? []).map((l) => l.coords));
    } else stale.push(r);
  }
  if (stale.length) {
    if (!tileset) for (const r of stale) out.set(r.id, null);
    else for (const [id, v] of await rematchRows(stale, tileset)) out.set(id, v);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// plano de restrições (exclusions + costLines compartilham o mesmo cálculo por requisição)
// ---------------------------------------------------------------------------------------------------------------

interface Plan { costLines: LayerCostLine[]; exclusions: LayerExclusion[]; minianelActive: boolean; day: LegalDayInfo; hz: HazmatVehicleInfo; fallbackIds: string[] }
const plans = new WeakMap<RouteCtx, Promise<Plan>>();

/**
 * Corredor plausível da rota: elipse com focos na origem e no destino (d(O,p) + d(D,p) <= L + folga). Limita as
 * costLines às vias que a rota pode usar: o routing.ts mede a sobreposição de cada costLine com as rotas livre e
 * restrita (custo proporcional ao nº de vértices), então mandar o Minianel inteiro numa rota em Mairiporã só custa tempo.
 */
function corridor(ctx: RouteCtx): { L: number; slack: number } {
  const L = turf.distance([ctx.origin.lon, ctx.origin.lat], [ctx.destination.lon, ctx.destination.lat], { units: 'meters' });
  return { L, slack: Math.max(5000, L * 0.3) };
}

function itemOf(r: RouteRow): LayerItem {
  const p = r.props;
  const c = r.geometry.coordinates;
  const mid = (p.ponto_medio as [number, number] | undefined) ?? c[Math.floor(c.length / 2)];
  if (r.kind === 'trecho_proibido') {
    return { kind: 'layer', layer: LAYER, id: r.id, name: r.name ?? 'Trecho proibido para PP', type: 'hazmat_ban',
      rule: `PP proibido 24h — ${p.norma}, ${String(p.artigo).split(' (')[0]}`, lon: mid[0], lat: mid[1],
      note: `${r.name} — ${p.norma}` };
  }
  return { kind: 'layer', layer: LAYER, id: r.id, name: `Minianel: ${p.via}`, type: 'hazmat_ban',
    rule: `PP ${WINDOW_TXT} — ${LEGAL.minianel}`, lon: mid[0], lat: mid[1],
    note: `Minianel (${p.via}), ${WINDOW_TXT} — Portaria SMT.GAB 051/2024` };
}

const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
/**
 * Pista simples: o traçado de volta é o de ida invertido. Junta os dois num só (ida + volta, com retorno no fim), que
 * passa no edge walk e penaliza os dois sentidos; assim a rota livre não lista o mesmo trecho duas vezes em "evitado".
 */
function mergeUTurn(lines: Coords[]): Coords[] {
  if (lines.length !== 2) return lines;
  const [a, b] = lines;
  if (a.length === b.length && same(a[a.length - 1], b[0]) && same(a[0], b[b.length - 1]) && a.every((p, i) => same(p, b[b.length - 1 - i]))) {
    return [[...a, ...b.slice(1)]];
  }
  return lines;
}

function ringAround(c: Coords, m: number): [number, number][] {
  const poly = turf.buffer(turf.lineString(c), m / 1000, { units: 'kilometers', steps: 4 });
  const g = poly?.geometry;
  const ring = g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0][0] : [];
  return turf.truncate(turf.lineString(turf.cleanCoords(turf.lineString(ring as Coords)).geometry.coordinates), { precision: 6 })
    .geometry.coordinates as [number, number][];
}

/**
 * Pedaços contíguos (fim de um = início do outro) da mesma via do Anexo IV viram uma linha só. O routing.ts amostra até
 * 40 pontos por costLine para medir a sobreposição com as rotas; menos linhas = menos custo e menos repetição em "evitado".
 * A concatenação reconstitui exatamente a cadeia de arestas da importação (corte só em fronteira de aresta).
 */
function chainMinianel(parts: { row: RouteRow; coords: Coords }[]): { row: RouteRow; coords: Coords }[] {
  const out: { row: RouteRow; coords: Coords }[] = [];
  const byItem = new Map<string, { row: RouteRow; coords: Coords }[]>();
  for (const p of parts) {
    const k = String(p.row.props.anexo_iv_item);
    byItem.set(k, [...(byItem.get(k) ?? []), p]);
  }
  for (const list of byItem.values()) {
    const key = (c: [number, number]) => `${c[0]},${c[1]}`;
    const byStart = new Map<string, number[]>();
    list.forEach((p, i) => byStart.set(key(p.coords[0]), [...(byStart.get(key(p.coords[0])) ?? []), i]));
    const hasPred = new Set<number>();
    list.forEach((p) => (byStart.get(key(p.coords[p.coords.length - 1])) ?? []).forEach((j) => hasPred.add(j)));
    const used = new Set<number>();
    const order = [...list.keys()].filter((i) => !hasPred.has(i)).concat([...list.keys()]);
    for (const i0 of order) {
      if (used.has(i0)) continue;
      used.add(i0);
      let coords = [...list[i0].coords];
      for (;;) {
        const nxt = (byStart.get(key(coords[coords.length - 1])) ?? []).find((j) => !used.has(j));
        if (nxt === undefined) break;
        used.add(nxt);
        coords = coords.concat(list[nxt].coords.slice(1));
      }
      out.push({ row: list[i0].row, coords });
    }
  }
  return out;
}

/** Rota sem restrições (só o veículo), para escolher quais vias do Minianel podem interessar. */
async function freeRouteLine(ctx: RouteCtx): Promise<GeoJSON.LineString | null> {
  try {
    const r = await valhalla.route({ origin: ctx.origin, destination: ctx.destination, vehicle: ctx.vehicle, departureLocal: ctx.departureLocal });
    return { type: 'LineString', coordinates: r.coordinates };
  } catch { return null; }
}

const NEAR_FREE_M = 2500;

function plan(ctx: RouteCtx): Promise<Plan> {
  let p = plans.get(ctx);
  if (!p) {
    p = (async () => {
      const hz = hazmatInfo(ctx.vehicle);
      const day = await legalDayInfo(ctx.at);
      const minianelActive = spRuleActive(ctx.at, day);
      const empty: Plan = { costLines: [], exclusions: [], minianelActive, day, hz, fallbackIds: [] };
      if (!hz.active || hz.itineraryExempt) return empty;
      const kinds = ['trecho_proibido', ...(minianelActive ? ['via_minianel'] : [])];
      const { L, slack } = corridor(ctx);
      // Minianel: só as vias a até 2,5 km da rota livre, a não ser que ela atravesse a ZMRC ou o miolo do centro expandido
      // (aí as outras restrições podem empurrar a rota para qualquer lado do anel e entram todas as vias do corredor).
      const free = minianelActive ? await freeRouteLine(ctx) : null;
      let nearFree: string | null = free ? JSON.stringify(free) : null;
      if (nearFree) {
        const hit = await query<{ hit: boolean }>(
          `with fr as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g)
           select coalesce(bool_or(ST_Intersects(case when z.name ilike '%ZMRC%' then z.geom else ST_Buffer(z.geom, -0.005) end, fr.g)), false) as hit
             from restriction_zones z, fr
            where z.active and (z.name ilike '%ZMRC%' or z.name ilike '%mini%anel%' or z.name ilike '%minianel%') and z.geom && fr.g`,
          [nearFree],
        );
        if (hit.rows[0]?.hit) nearFree = null;
      }
      const r = await query<RouteRow>(
        `with o as (select ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography as g),
              d as (select ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography as g)
         select f.id::text, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry from data_features f, o, d
          where f.layer_id = $1 and f.kind = any($2)
            and f.geom && ST_Expand(ST_MakeEnvelope(least($3, $5), least($4, $6), greatest($3, $5), greatest($4, $6), 4326), $7 / 100000.0)
            and ST_Distance(f.geom::geography, o.g) + ST_Distance(f.geom::geography, d.g) <= $8
            and (f.valid_to is null or f.valid_to > now()) and (f.valid_from is null or f.valid_from <= now())`,
        [LAYER, kinds, ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat, slack, L + slack],
      );
      if (nearFree && r.rows.some((x) => x.kind === 'via_minianel')) {
        const near = await query<{ id: string }>(
          `select f.id::text from data_features f where f.id = any($1::bigint[]) and ST_DWithin(f.geom, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), $3 / 100000.0)`,
          [r.rows.filter((x) => x.kind === 'via_minianel').map((x) => x.id), nearFree, NEAR_FREE_M],
        );
        const keep = new Set(near.rows.map((x) => x.id));
        r.rows = r.rows.filter((x) => x.kind !== 'via_minianel' || keep.has(x.id));
      }
      if (!r.rows.length) return empty;
      const lines = await routableLines(r.rows);
      const costLines: LayerCostLine[] = [];
      const exclusions: LayerExclusion[] = [];
      const fallbackIds: string[] = [];
      const minianelParts: { row: RouteRow; coords: Coords }[] = [];
      for (const row of r.rows) {
        const item = itemOf(row);
        const ls = lines.get(row.id);
        if (ls && ls.length) {
          if (row.kind === 'via_minianel') { for (const c of ls) minianelParts.push({ row, coords: c }); continue; }
          mergeUTurn(ls).forEach((c, k) => costLines.push({ item: k ? { ...item, id: `${item.id}#${k}` } : item, coordinates: c, factor: FACTOR }));
        } else if (row.kind === 'trecho_proibido') {
          // sem traçado válido na malha atual: exclusão estreita em volta da geometria da fonte (corta também quem cruza)
          exclusions.push({ item, rings: [ringAround(row.geometry.coordinates as Coords, 12)] });
          fallbackIds.push(row.id);
        } else fallbackIds.push(row.id);
      }
      for (const ch of chainMinianel(minianelParts)) costLines.push({ item: itemOf(ch.row), coordinates: ch.coords, factor: FACTOR });
      return { costLines, exclusions, minianelActive, day, hz, fallbackIds };
    })();
    plans.set(ctx, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// anotação
// ---------------------------------------------------------------------------------------------------------------

interface UseSeg { len_m: number; f0: number; f1: number; vias: string | null }

async function minianelUse(line: GeoJSON.LineString): Promise<UseSeg[]> {
  // A rota é quebrada em pedaços de até 24 vértices (ST_Subdivide) para o índice espacial filtrar as vias candidatas;
  // depois, em metros (SIRGAS 2000 / UTM 23S): buffer de 6 m das vias, interseção com a rota e junção dos trechos.
  const r = await query<UseSeg>(
    `with r as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g4),
          rm as (select ST_Transform(r.g4, 31983) as g from r),
          pc as (select ST_Subdivide(r.g4, 24) as g from r),
          m as (select distinct on (f.id) f.id, f.props->>'via' as via, ST_Transform(f.geom, 31983) as g
                  from data_features f join pc on f.geom && ST_Expand(pc.g, 0.0001)
                 where f.layer_id = $2 and f.kind = 'via_minianel' and ST_DWithin(f.geom, pc.g, 0.0001)),
          u as (select ST_Union(ST_Buffer(m.g, 6, 'quad_segs=2')) as g from m),
          x as (select ST_CollectionExtract(ST_Intersection(ST_Transform(pc.g, 31983), u.g), 2) as g
                  from pc, u where u.g is not null and ST_Intersects(ST_Transform(pc.g, 31983), u.g)),
          s as (select (ST_Dump(ST_LineMerge(ST_Collect(x.g)))).geom as g from x)
     select ST_Length(s.g)::float as len_m,
            ST_LineLocatePoint(rm.g, ST_StartPoint(s.g))::float as f0,
            ST_LineLocatePoint(rm.g, ST_EndPoint(s.g))::float as f1,
            (select string_agg(distinct m.via, ', ') from m where ST_DWithin(m.g, s.g, 7)) as vias
       from s, rm
      where ST_Length(s.g) > 60
      order by 2`,
    [JSON.stringify(line), LAYER],
  );
  return r.rows;
}

async function aprmKm(line: GeoJSON.LineString): Promise<{ name: string; len_m: number; f0: number }[]> {
  const r = await query<{ name: string; len_m: number; f0: number }>(
    `with r as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g)
     select f.name, ST_Length(ST_Intersection(r.g, f.geom)::geography)::float as len_m,
            ST_LineLocatePoint(r.g, ST_StartPoint(ST_GeometryN(ST_Multi(ST_Intersection(r.g, f.geom)), 1)))::float as f0
       from data_features f, r
      where f.layer_id = $2 and f.kind = 'aprm' and f.geom && r.g and ST_Intersects(f.geom, r.g)
      order by 3`,
    [JSON.stringify(line), LAYER],
  );
  return r.rows.filter((x) => x.len_m >= 100);
}

async function routeTouches(line: GeoJSON.LineString, ctx: RouteCtx) {
  const r = await query<{ letpp: boolean; mian: boolean; zmrc: boolean; zmrc_od: boolean; hz_zone: string | null; hz_zone_exc: unknown }>(
    `with r as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g),
          od as (select ST_Collect(ST_SetSRID(ST_MakePoint($3, $4), 4326), ST_SetSRID(ST_MakePoint($5, $6), 4326)) as g)
     select exists(select 1 from data_features f, r where f.layer_id = $2 and f.kind = 'municipio_letpp' and ST_Intersects(f.geom, r.g)) as letpp,
            exists(select 1 from restriction_zones z, r where z.active and (z.name ilike '%mini%anel%' or z.name ilike '%minianel%')
                     and ST_Intersects(z.geom, r.g)) as mian,
            exists(select 1 from restriction_zones z, r where z.active and z.name ilike '%ZMRC%' and ST_Intersects(z.geom, r.g)) as zmrc,
            exists(select 1 from restriction_zones z, od where z.active and z.name ilike '%ZMRC%' and ST_Intersects(z.geom, od.g)) as zmrc_od,
            (select z.name from restriction_zones z where z.active and coalesce((z.rules->>'hazmat_only')::boolean, false) limit 1) as hz_zone,
            (select z.rules->'exceptions' from restriction_zones z where z.active and coalesce((z.rules->>'hazmat_only')::boolean, false) limit 1) as hz_zone_exc`,
    [JSON.stringify(line), LAYER, ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat],
  );
  return r.rows[0];
}

interface NearRow { id: string; name: string | null; props: Record<string, any>; geometry: GeoJSON.Point; distance_m: number; fraction: number }
/** Pontos da camada a até radiusM da rota (pré-filtro planar em graus, que usa o índice; distância exata em geography). */
async function pointsNearRoute(line: GeoJSON.LineString, kind: string, radiusM: number, limit: number): Promise<NearRow[]> {
  const r = await query<NearRow>(
    `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g),
          pc as (select ST_Subdivide(l.g, 24) as g from l),
          c as (select distinct on (f.id) f.id, f.name, f.props, f.geom
                  from data_features f join pc on f.geom && ST_Expand(pc.g, $4 / 95000.0)
                 where f.layer_id = $2 and f.kind = $3 and ST_DWithin(f.geom::geography, pc.g::geography, $4))
     select c.id::text, c.name, c.props, ST_AsGeoJSON(c.geom, 6)::json as geometry,
            ST_Distance(c.geom::geography, l.g::geography)::float as distance_m, ST_LineLocatePoint(l.g, c.geom)::float as fraction
       from c, l
      order by fraction limit $5`,
    [JSON.stringify(line), LAYER, kind, radiusM, limit],
  );
  return r.rows;
}

async function trechosNearOD(ctx: RouteCtx) {
  const r = await query<{ id: string; name: string; props: Record<string, any>; which: string }>(
    `select f.id::text, f.name, f.props,
            case when ST_DWithin(f.geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $6) then 'origem' else 'destino' end as which
       from data_features f
      where f.layer_id = $1 and f.kind = 'trecho_proibido'
        and (ST_DWithin(f.geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $6)
          or ST_DWithin(f.geom::geography, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6))`,
    [LAYER, ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat, LINDEIRO_M],
  );
  return r.rows;
}

function rearAxlesLe2(ctx: RouteCtx): boolean {
  const v = ctx.vehicle as RouteCtx['vehicle'] & { vehicle_class?: string };
  // Portaria 137/2018 art. 35: "caminhões de até dois eixos traseiros" (caminhão simples, não cavalo mecânico)
  if (v.vehicle_class && v.vehicle_class !== 'rigid') return false;
  return v.axle_count - 1 <= 2;
}

async function annotate(ctx: RouteCtx, route: RouteGeom): Promise<LayerAnnotation> {
  const pl = await plan(ctx);
  const { hz } = pl;
  if (!hz.active) return {};
  const line = route.line.geometry;
  const warnings: LayerWarning[] = [];
  const summary: string[] = [];
  const W = (code: string, severity: LayerWarning['severity'], message: string, extra: Partial<LayerWarning> = {}) =>
    warnings.push({ code, severity, message, layer: LAYER, ...extra });

  // --- produto, grupo e quantidade limitada
  const group = hz.group;
  if (!hz.uns.length) {
    W('hazmat_un_missing', 'info', 'Informe o nº ONU do produto: o grupo da Portaria SMT.GAB 051/2024 e a isenção por quantidade limitada dependem dele. Restrições aplicadas como grupo I.');
  } else {
    summary.push(`${hz.uns.map(describeProduct).join('; ')} — ${group?.label ?? ''} em São Paulo (${group?.basis ?? LEGAL.gruposSP}).`);
    if (group?.ambiguous && !hz.localDelivery) {
      summary.push('Nº ONU nos Anexos I e II da Portaria 051/2024: tratado como grupo II. Se for entrega fracionada para consumo local (ex.: GLP engarrafado), é grupo III.');
    }
  }
  for (const u of hz.unknownUns) W('hazmat_un_unknown', 'warn', `ONU ${u} não consta na Relação de Produtos Perigosos da ANTT. Confira o número; restrições aplicadas como grupo I.`);
  for (const u of hz.prohibited) W('hazmat_transport_prohibited', 'danger', `ONU ${u} (${getProduct(u)?.name ?? ''}): transporte rodoviário proibido pela Relação da Res. ANTT 5.998/2022.`);
  if (hz.notSubject) summary.push('Produto marcado como "não sujeito" ao regulamento de transporte de PP na Relação da ANTT; restrições aplicadas mesmo assim porque a carga foi declarada perigosa.');
  summary.push(hz.lq.text);
  if (hz.itineraryExempt) {
    W('hazmat_limited_qty_exempt', 'info', `${hz.lq.text} A LETPP continua obrigatória em São Paulo (${LEGAL.letpp}).`);
  }

  const [use, aprm, touch, nearOD, emerg, paradas] = await Promise.all([
    minianelUse(line).catch(() => [] as UseSeg[]),
    aprmKm(line).catch(() => []),
    routeTouches(line, ctx).catch(() => undefined),
    trechosNearOD(ctx).catch(() => []),
    pointsNearRoute(line, 'emergencia', 250, 3000).catch(() => [] as NearRow[]),
    pointsNearRoute(line, 'parada_pp', 300, 50).catch(() => [] as NearRow[]),
  ]);

  // --- minianel: uso e horário estimado de passagem
  const usedM = use.reduce((s, u) => s + u.len_m, 0);
  const etaOf = (f: number) => new Date(ctx.at.getTime() + Math.max(0, Math.min(1, f)) * route.duration_s * 1000);
  const firstEta = use.length ? etaOf(use[0].f0) : null;
  const vias = [...new Set(use.flatMap((u) => (u.vias ?? '').split(', ').filter(Boolean)))];
  const etaInWindow = use.some((u) => spRuleActive(etaOf(u.f0), pl.day) || spRuleActive(etaOf(u.f1), pl.day));
  if (!hz.itineraryExempt) {
    if (usedM > 0 && pl.minianelActive) {
      W('hazmat_minianel_used', 'danger', `A rota usa ${fmtKm(usedM)} de vias do Minianel (${vias.join(', ')}) no horário proibido para PP (${WINDOW_TXT}; ${LEGAL.minianel}). Saia fora da janela ou use outro acesso.`);
    } else if (usedM > 0 && etaInWindow) {
      W('hazmat_minianel_eta', 'warn', `Saindo às ${fmtH(ctx.at)}, a rota chega ao Minianel (${vias.join(', ')}) por volta das ${fmtH(firstEta!)}, dentro da janela proibida para PP (${WINDOW_TXT}). Ajuste o horário de saída.`);
    } else if (usedM > 0) {
      summary.push(`Usa ${fmtKm(usedM)} de vias do Minianel fora da janela de restrição (passagem estimada ${fmtH(firstEta!)}).`);
    } else if (pl.minianelActive) {
      summary.push(`Vias do Minianel evitadas: proibidas para PP agora (${WINDOW_TXT}; ${LEGAL.minianel}).`);
    } else if (pl.day.holiday && inSpWindows(ctx.at)) {
      summary.push(`Feriado (${pl.day.holiday.name}): a restrição de PP no Minianel não se aplica.`);
    }
  }
  if (pl.fallbackIds.length) {
    W('hazmat_layer_stale', 'info', 'Parte dos traçados de PP não casou com a malha viária atual (tiles do Valhalla mudaram): rode de novo os importadores hazmat_trechos_der e hazmat_minianel_vias.');
  }

  // --- centro expandido (zona da frente core_legal) e grupos III/IV
  if (touch) {
    if (!touch.hz_zone) {
      if (pl.minianelActive && touch.mian && (!group || !group.interiorAllowed)) {
        W('hazmat_interior_zone_missing', 'info', `A zona do centro expandido para PP não está cadastrada: a proibição da área interna para grupos I e II (${LEGAL.centroExpandido}) não foi aplicada nesta rota.`);
      }
    } else if (group?.interiorAllowed && pl.minianelActive && touch.mian) {
      const exc = Array.isArray(touch.hz_zone_exc) ? (touch.hz_zone_exc as unknown[]).map(String) : [];
      if (!exc.some((e) => /hazmat_local_or_other/.test(e))) {
        W('hazmat_interior_group_iii_iv', 'info', `Pela Portaria 051/2024 (art. 3º parágrafo único), ${group.label} pode circular na área interna do Minianel nas janelas; a zona "${touch.hz_zone}" foi aplicada a todos os PP. Só as vias do Minianel são proibidas.`);
      }
    }
    // --- LETPP
    if (touch.letpp) {
      W('hazmat_letpp', 'info', `Rota passa pela cidade de São Paulo: o veículo precisa da LETPP e o transportador do CTPP (${LEGAL.letpp}), inclusive em quantidade limitada.`);
    }
    // --- ZMRC (art. 35 da Portaria 137/2018; a exceção é aplicada pela zona ZMRC, não aqui)
    if (touch.zmrc || touch.zmrc_od) {
      const okGroup = !!group?.interiorAllowed;
      const ok = okGroup && !!ctx.vehicle.has_aetc && rearAxlesLe2(ctx);
      W('hazmat_zmrc', 'info', ok
        ? `ZMRC: PP de consumo local/outros, com AETC e até 2 eixos traseiros, pode circular das 10h às 16h (${LEGAL.zmrc}).`
        : `ZMRC: para PP só há liberação das 10h às 16h com AETC, caminhão de até 2 eixos traseiros e produto dos grupos consumo local/outros (${LEGAL.zmrc}). ${!okGroup ? 'Este produto não se enquadra.' : !ctx.vehicle.has_aetc ? 'Sem AETC informada.' : 'Veículo com mais de 2 eixos traseiros.'} Vale a restrição geral de caminhões.`);
    }
  }

  // --- trechos proibidos com origem/destino lindeiro
  for (const t of nearOD) {
    const exc = String(t.props.excecoes ?? '');
    const msg = /^nenhuma/i.test(exc)
      ? `${t.which === 'origem' ? 'Origem' : 'Destino'} junto ao trecho proibido para PP ${t.name} (${t.props.norma}). A portaria não prevê exceção: comprove a necessidade à autoridade da via (${LEGAL.viaRestrita}).`
      : `${t.which === 'origem' ? 'Origem' : 'Destino'} junto ao trecho proibido para PP ${t.name} (${t.props.norma}). Exceção: ${exc}.`;
    W('hazmat_trecho_lindeiro', 'warn', msg, { id: t.id });
  }

  // --- mananciais (aviso)
  if (aprm.length) {
    const tot = aprm.reduce((s, a) => s + a.len_m, 0);
    const txt = aprm.map((a) => `${a.name} ${fmtKm(a.len_m)}`).join(', ');
    W('hazmat_aprm', 'warn', `${fmtKm(tot)} da rota em área de proteção de mananciais (${txt}). Evite parar nesses trechos e redobre a atenção (${LEGAL.mananciais}). Em vazamento, ligue 193.`);
    summary.push(`Mananciais (APRM): ${txt}, a partir do km ${Math.round(aprm[0].f0 * route.distance_km)} da rota.`);
  }

  // --- emergências químicas (CETESB)
  let hotspot: { km0: number; km1: number; n: number } | null = null;
  if (emerg.length) {
    const binKm = 2;
    const bins = new Map<number, number>();
    for (const e of emerg) {
      const b = Math.floor((e.fraction * route.distance_km) / binKm);
      bins.set(b, (bins.get(b) ?? 0) + 1);
    }
    const [b, n] = [...bins.entries()].sort((a, c) => c[1] - a[1])[0];
    if (n >= 3) hotspot = { km0: b * binKm, km1: (b + 1) * binKm, n };
    const anos = emerg.map((e) => Number(e.props.ano)).filter(Number.isFinite);
    summary.push(`${emerg.length} emergência(s) química(s) no transporte rodoviário registradas pela CETESB a até 250 m da rota (${Math.min(...anos)}–${Math.max(...anos)}).`);
    if (hotspot) {
      W('hazmat_emergencias_hotspot', 'info', `Trecho com mais emergências químicas registradas pela CETESB: km ${hotspot.km0}–${hotspot.km1} da rota (${hotspot.n} registros). Atenção redobrada.`);
    }
  }

  // --- paradas de PP (ARTESP)
  const paradasOut = paradas.map((p) => ({ id: p.id, name: p.name, km_rota: Math.round(p.fraction * route.distance_km), concessionaria: p.props.concessionaria, lon: p.geometry.coordinates[0], lat: p.geometry.coordinates[1] }));
  if (paradasOut.length) {
    summary.push(`Paradas para PP na rota (ARTESP; descanso só em áreas indicadas, ${LEGAL.estacionamento}): ${paradasOut.slice(0, 5).map((p) => `km ${p.km_rota} (${p.concessionaria})`).join(', ')}${paradasOut.length > 5 ? '…' : ''}.`);
  }

  return {
    warnings, summary,
    data: {
      produtos: hz.uns.map((u) => {
        const p = getProduct(u);
        return p ? { onu: u, nome: p.name, classe: p.cls, numero_risco: p.riskNumber, qtd_limitada_veiculo: p.lqVehicle } : { onu: u, desconhecido: true };
      }),
      grupo_sp: group ?? null,
      quantidade_limitada: hz.lq,
      isento_itinerario: hz.itineraryExempt,
      minianel: { regra_ativa_na_saida: pl.minianelActive, usado_m: Math.round(usedM), vias, passagem_estimada: firstEta?.toISOString() ?? null, janela_na_passagem: etaInWindow },
      cost_lines: pl.costLines.length,
      exclusoes_fallback: pl.exclusions.length,
      aprm: aprm.map((a) => ({ nome: a.name, km: Math.round(a.len_m / 100) / 10 })),
      emergencias: { total: emerg.length, hotspot },
      paradas: paradasOut,
      letpp: !!touch?.letpp,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// mapa
// ---------------------------------------------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  trecho_proibido: 'Trecho proibido para PP (24h)',
  via_minianel: 'Via do Minianel (PP restrito)',
  parada_pp: 'Parada para PP (ARTESP)',
  emergencia: 'Emergência química (CETESB)',
};

function popupProps(kind: string, name: string | null, p: Record<string, any>): Record<string, unknown> {
  switch (kind) {
    case 'trecho_proibido':
      return { name, tipo: KIND_LABEL[kind], regra: `${p.regra}, ${p.janela}, ${p.sentidos} os sentidos`, norma: `${p.norma}, ${p.artigo}`, publicacao: p.publicacao, excecoes: p.excecoes, geometria: p.geometria_fonte };
    case 'via_minianel':
      return { name, tipo: KIND_LABEL[kind], regra: `PP proibido ${WINDOW_TXT} (todos os grupos)`, norma: `${p.norma}, ${p.artigo}`, trecho: p.trecho_norma };
    case 'parada_pp':
      return { name, tipo: KIND_LABEL[kind], concessionaria: p.concessionaria, via: p.via_osm, uso: p.uso };
    case 'emergencia':
      return { name, tipo: KIND_LABEL[kind], data: p.data, municipio: p.municipio, rodovia: p.rodovia, causa: p.causa, produtos: p.produtos, weight: 1 };
    default:
      return { name, tipo: kind };
  }
}

async function features(bbox: [number, number, number, number], { zoom }: { zoom?: number }): Promise<GeoJSON.FeatureCollection> {
  const z = zoom ?? 12;
  if (z < 8) return { type: 'FeatureCollection', features: [] };
  const kinds = ['trecho_proibido', 'via_minianel', 'parada_pp', ...(z >= 9 ? ['emergencia'] : [])];
  const tol = z < 11 ? 0.0002 : 0;
  const r = await query<{ id: string; name: string | null; kind: string; props: Record<string, any>; geometry: GeoJSON.Geometry }>(
    `select id::text, name, kind, props - 'osm' - 'segmentos_cetesb' as props,
            ST_AsGeoJSON(case when $7 > 0 and GeometryType(geom) like '%LINE%' then ST_SimplifyPreserveTopology(geom, $7) else geom end, 6)::json as geometry
       from data_features
      where layer_id = $1 and kind = any($6) and geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
        and (valid_to is null or valid_to > now())
      order by case kind when 'emergencia' then 0 when 'via_minianel' then 1 else 2 end
      limit 5000`,
    [LAYER, ...bbox, kinds, tol],
  );
  return {
    type: 'FeatureCollection',
    features: r.rows.map((row) => ({ type: 'Feature', id: row.id, geometry: row.geometry, properties: { id: row.id, kind: row.kind, ...popupProps(row.kind, row.name, row.props) } })),
  };
}

const layer: RouteLayer = {
  meta,
  async exclusions(ctx) { return (await plan(ctx)).exclusions; },
  async costLines(ctx) { return (await plan(ctx)).costLines; },
  annotate,
  features,
};

export default layer;
