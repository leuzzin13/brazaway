/**
 * Candidatos a parada do plano de direção (Lei 13.103/2015) vindos de TODAS as fontes da camada "descanso", com
 * prioridade. Arquivo separado de restStops.ts de propósito: lá ficam as regras de jornada (drivingPlan,
 * DRIVING_RULES); aqui, só de ONDE parar. restStopsAlongRoute chama withLayerCandidates() numa linha.
 *
 * Fontes (data_features, layer_id = 'descanso', + tabela rest_stops do OSM na Grande SP):
 *  - ppd-mt  : PPD certificados (painel do Ministério dos Transportes) e PPD de concessão federal;
 *  - artesp  : áreas de descanso e SAU das concessões estaduais de SP;
 *  - antt    : SAU (bases operacionais) das concessões federais;
 *  - osm     : rest_area, services, truck_stop, estacionamento e posto com acesso de caminhão (Sudeste).
 *
 * Prioridade (tier): 1 PPD válido (certificação vigente na data de hoje, ou PPD de concessão entregue — Portaria MT
 * 387/2024 art. 14 dispensa a certificação) > 2 área de descanso de concessionária > 3 posto/pátio para caminhão
 * (OSM e PPD com certificação vencida) > 4 SAU (APOIO: só pausa curta, nunca o descanso de 11 h).
 *
 * Como a prioridade chega ao plano sem mexer em drivingPlan: o pick() de drivingPlan escolhe o ÚLTIMO elemento da
 * lista (na ordem da lista) entre os candidatos da janela preferida (última 1h30 antes do limite) e, se a janela
 * estiver vazia, entre todos os candidatos antes do limite. A lista sai ordenada por
 *     escore = eta_s + (4 − tier) × prefer_window_s
 * (crescente). Dentro da janela preferida vence sempre o tier melhor (a diferença de bônus entre tiers é a largura
 * da janela); fora dela, um tier melhor só vence se estiver até 1h30 por nível antes do outro. SAU nunca vira descanso
 * de 11 h: o plano é simulado nos três regimes (empregado, autônomo, não informado) e o SAU escolhido para descanso
 * diário sai da lista (repete até estabilizar). Por isso `rest_stops` não vem mais ordenado pela posição na rota:
 * use `distance_km`/`fraction` para ordenar.
 */
import type { DrivingPlan, Employment, RestStop } from './restStops.js';
import { query } from '../db.js';

export type RestTier = 1 | 2 | 3 | 4;

export interface RestStopCandidate extends RestStop {
  /** fonte: 'osm' (rest_stops ou PBF), 'ppd-mt', 'artesp', 'antt' */
  source: string;
  /** 1 PPD válido · 2 área de descanso de concessionária · 3 posto/pátio para caminhão · 4 SAU (apoio) */
  tier: RestTier;
  category: string;
  /** pode ser o local do descanso diário de 11 h (SAU não pode) */
  daily_rest_ok: boolean;
  vagas: number | null;
  /** validade da certificação do PPD (AAAA-MM-DD), quando houver */
  validade: string | null;
}

export const TIER_LABEL: Record<RestTier, string> = {
  1: 'PPD válido',
  2: 'área de descanso de concessionária',
  3: 'posto/pátio para caminhão',
  4: 'SAU (apoio)',
};

const OSM_KIND_LABEL: Record<string, string> = {
  rest_area: 'Área de descanso (OSM)',
  service_area: 'Posto/área de serviço (OSM)',
  truck_stop: 'Parada de caminhões (OSM)',
  truck_parking: 'Estacionamento de caminhões (OSM)',
  fuel_hgv: 'Posto com acesso de caminhão (OSM)',
};
const SOURCE_RANK: Record<string, number> = { 'ppd-mt': 0, artesp: 1, antt: 2, osm: 3 };
/** dois candidatos a menos disso são o mesmo lugar (fica o de melhor tier/fonte) */
const SAME_PLACE_M = 100;
const MAX_LAYER_ROWS = 300;

/** Data de hoje em Brasília (AAAA-MM-DD), para comparar com a validade da certificação. */
export function todayBR(now = new Date()): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

interface LayerRow {
  id: string; source: string; name: string | null; kind: string; lat: number; lon: number;
  props: Record<string, any>; fraction: number; off_route_m: number;
}

/** Ponto do OSM que é, na verdade, base/posto do SAU (marcado como rest_area/services no OSM). */
export const OSM_SAU_RE = /\bSAU\b|atendimento ao usu[aá]rio|base operacional/i;

/** Classifica uma feição da camada descanso. null = não serve de parada (PPD de concessão ainda não entregue). */
export function classify(kind: string, source: string, props: Record<string, any>, today = todayBR(), name?: string | null):
  { tier: RestTier; category: string; daily_rest_ok: boolean } | null {
  if (kind === 'ppd') {
    const v: string | null = props.validade ?? null;
    if (v && v >= today) return { tier: 1, category: `PPD certificado (válido até ${fmtDate(v)})`, daily_rest_ok: true };
    return { tier: 3, category: v ? `PPD com certificação vencida em ${fmtDate(v)}` : 'PPD sem data de validade', daily_rest_ok: true };
  }
  if (kind === 'ppd_concessao') {
    if (props.operando !== true) return null;
    return { tier: 1, category: 'PPD de concessão federal (entregue)', daily_rest_ok: true };
  }
  if (kind === 'area_descanso') return { tier: 2, category: 'Área de descanso de concessionária', daily_rest_ok: true };
  if (kind === 'sau' || ((OSM_KIND_LABEL[kind] || source === 'osm') && name && OSM_SAU_RE.test(name))) {
    return { tier: 4, category: 'SAU (apoio: só pausa curta)', daily_rest_ok: false };
  }
  if (OSM_KIND_LABEL[kind] || source === 'osm') return { tier: 3, category: OSM_KIND_LABEL[kind] ?? 'Ponto de parada (OSM)', daily_rest_ok: true };
  return null;
}

function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}

const str = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v));

/** Feições da camada descanso a até radiusM da rota (todas, inclusive SAU e PPD vencido). */
export async function layerCandidates(line: GeoJSON.LineString, distanceKm: number, durationS: number, radiusM: number, today = todayBR()): Promise<RestStopCandidate[]> {
  const r = await query<LayerRow>(
    `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g)
     select f.id::text, f.source, f.name, f.kind, ST_Y(f.geom) as lat, ST_X(f.geom) as lon, f.props,
            ST_LineLocatePoint(l.g, f.geom)::float as fraction,
            ST_Distance(f.geom::geography, l.g::geography)::float as off_route_m
       from data_features f, l
      where f.layer_id = 'descanso'
        and f.geom && ST_Expand(l.g, $2 / 90000.0)
        and ST_DWithin(f.geom::geography, l.g::geography, $2)
        and (f.valid_to is null or f.valid_to > now())
      order by fraction
      limit ${MAX_LAYER_ROWS}`,
    [JSON.stringify(line), radiusM],
  );
  const out: RestStopCandidate[] = [];
  for (const x of r.rows) {
    const c = classify(x.kind, x.source, x.props ?? {}, today, x.name);
    if (!c) continue;
    const p = x.props ?? {};
    const tags: Record<string, string> = x.source === 'osm'
      ? { ...(p.tags ?? {}) }
      : Object.fromEntries(Object.entries({ rodovia: str(p.rodovia), km: str(p.km), sentido: str(p.sentido), municipio: str(p.municipio), uf: str(p.uf),
        concessionaria: str(p.concessionaria), funcionamento: str(p.funcionamento) }).filter(([, v]) => v !== undefined)) as Record<string, string>;
    out.push({
      id: `descanso:${x.id}`, name: x.name ?? c.category, kind: x.kind, lat: x.lat, lon: x.lon, tags,
      fraction: x.fraction, distance_km: +(x.fraction * distanceKm).toFixed(1), eta_s: Math.round(x.fraction * durationS),
      off_route_m: x.off_route_m,
      source: x.source, ...c, vagas: typeof p.vagas === 'number' ? p.vagas : null, validade: p.validade ?? null,
    });
  }
  return out;
}

/** rest_stops (OSM/Overpass, Grande SP) no formato de candidato. */
export function fromOsmRows(rows: RestStop[]): RestStopCandidate[] {
  return rows.map((s) => {
    const c = classify(s.kind, 'osm', {}, todayBR(), s.name)!;
    return { ...s, name: s.name ?? c.category, source: 'osm', ...c, vagas: null, validade: null };
  });
}

/** Junta pontos repetidos (mesmo lugar em duas fontes): fica o de melhor tier, depois a melhor fonte. */
export function dedupe(cands: RestStopCandidate[]): RestStopCandidate[] {
  const sorted = [...cands].sort((a, b) => a.tier - b.tier || (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9) || a.off_route_m - b.off_route_m);
  const kept: RestStopCandidate[] = [];
  for (const c of sorted) {
    if (kept.some((k) => distM(k, c) < SAME_PLACE_M)) continue;
    kept.push(c);
  }
  return kept;
}

/** Ordem que faz o pick() de drivingPlan respeitar a prioridade (ver cabeçalho). */
export function orderForPlan<T extends { eta_s: number; tier: RestTier }>(cands: T[], preferWindowS: number): T[] {
  const score = (c: T) => c.eta_s + (4 - c.tier) * preferWindowS;
  return [...cands].sort((a, b) => score(a) - score(b) || a.eta_s - b.eta_s);
}

type PlanFn = (durationS: number, stops: RestStop[], opts?: { employment?: Employment }) => DrivingPlan;

/** Tira da lista os pontos que o plano escolheria para o descanso de 11 h sem poder (SAU), em qualquer regime. */
export function withoutForbiddenDailyRest(cands: RestStopCandidate[], durationS: number, plan: PlanFn): RestStopCandidate[] {
  let list = cands;
  const regimes: ({ employment?: Employment })[] = [{}, { employment: 'employee' }, { employment: 'autonomous' }];
  for (let guard = 0; guard < 100; guard++) {
    const bad = new Set<string>();
    for (const opts of regimes) {
      for (const s of plan(durationS, list, opts).suggested_stops) {
        const st = s.stop as RestStopCandidate | null;
        if (s.kind === 'daily_rest' && st && st.daily_rest_ok === false) bad.add(st.id);
      }
    }
    if (!bad.size) break;
    list = list.filter((c) => !bad.has(c.id));
  }
  return list;
}

/**
 * Chamado por restStopsAlongRoute: recebe os pontos do OSM (rest_stops) já calculados lá, junta as fontes da camada
 * descanso, deduplica, ordena pela prioridade e remove SAU que viraria descanso de 11 h. Se a camada falhar
 * (tabela vazia, erro), devolve só o OSM, como antes.
 */
export async function withLayerCandidates(
  osmRows: RestStop[],
  route: { line: GeoJSON.LineString; distanceKm: number; durationS: number; radiusM: number },
  rules: { drivingPlan: PlanFn; DRIVING_RULES: { prefer_window_s: number } },
): Promise<RestStopCandidate[]> {
  let layer: RestStopCandidate[] = [];
  try {
    layer = await layerCandidates(route.line, route.distanceKm, route.durationS, route.radiusM);
  } catch (e) {
    console.error('[descanso] candidatos da camada indisponíveis:', (e as Error).message);
  }
  const all = dedupe([...layer, ...fromOsmRows(osmRows)]);
  const ordered = orderForPlan(all, rules.DRIVING_RULES.prefer_window_s);
  return withoutForbiddenDailyRest(ordered, route.durationS, rules.drivingPlan);
}

/** Todos os candidatos (camada + rest_stops), deduplicados e em ordem de posição na rota — para a anotação da camada. */
export async function allCandidatesAlongRoute(line: GeoJSON.LineString, distanceKm: number, durationS: number, radiusM: number): Promise<RestStopCandidate[]> {
  const [layer, osm] = await Promise.all([
    layerCandidates(line, distanceKm, durationS, radiusM),
    query<Omit<RestStop, 'distance_km' | 'eta_s'>>(
      `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g)
       select s.id, s.name, s.kind, ST_Y(s.geom) as lat, ST_X(s.geom) as lon, s.tags,
              ST_LineLocatePoint(l.g, s.geom)::float as fraction,
              ST_Distance(s.geom::geography, l.g::geography)::float as off_route_m
         from rest_stops s, l
        where ST_DWithin(s.geom::geography, l.g::geography, $2)
        order by fraction
        limit 200`,
      [JSON.stringify(line), radiusM],
    ).then((r) => r.rows.map((s) => ({ ...s, distance_km: +(s.fraction * distanceKm).toFixed(1), eta_s: Math.round(s.fraction * durationS) }))),
  ]);
  return dedupe([...layer, ...fromOsmRows(osm)]).sort((a, b) => a.fraction - b.fraction);
}
