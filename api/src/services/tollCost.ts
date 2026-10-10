/**
 * Custo de pedágio por veículo e rota alternativa sem pedágio.
 *
 * Tarifas vêm da camada `pedagio` (data_features.props.tarifa), em três modelos:
 *  - 'categorias' (ANTT e contratos novos da ARTESP): tabela por categoria com nº de eixos, rodagem e multiplicador;
 *  - 'por_eixo'   (ARTESP, contratos antigos): "COMERCIAL POR EIXO" x multiplicador;
 *  - 'osm_charge' (OpenStreetMap, reserva): charge=<v>BRL/hgv/axle (pode variar dia útil x fim de semana).
 *
 * Regras usadas (ver docs/layers/pedagio.md):
 *  - eixos cobrados = eixos do veículo − eixos suspensos. Caminhão VAZIO não paga eixo suspenso em todo o território
 *    nacional (Lei 13.103/2015, art. 17, redação da Lei 13.711/2018; §3º: considera-se vazio o veículo que passa na praça
 *    com eixo suspenso). O mínimo cobrado é 2 eixos.
 *  - multiplicador das tabelas ANTT/ARTESP: rodagem dupla = nº de eixos; rodagem simples 2/3/4 eixos = 1 / 1,5 / 2.
 *    Sem `dual_wheels` informado, assume rodagem dupla (caminhões e VUC em geral).
 */
import { DateTime } from 'luxon';
import { env } from '../config.js';
import type { Vehicle } from './vehicle.js';
import { retime, type Ring } from './valhalla.js';
import { decodePolyline6 } from './polyline.js';
import { activeZones, pointInZone, zoneApplies, zoneRings } from './zones.js';
import { blockingReports, reportToRing } from './restrictions.js';
import { legalDayInfo } from './calendar.js';
import type { RouteCtx, RouteRestrictions } from '../layers/types.js';

export interface TariffCategory { cat?: number; eixos: number; rodagem: 'simples' | 'dupla' | null; mult: number; valor: number; valor_fds?: number; valor_tag?: number }
export interface Tariff {
  modelo: 'categorias' | 'por_eixo' | 'osm_charge';
  fonte: 'ANTT' | 'ARTESP' | 'OSM' | string;
  data?: string | null;
  url?: string;
  // categorias
  base?: number | null;
  categorias?: TariffCategory[];
  min_eixos_tabela?: number | null;
  max_eixos_tabela?: number | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  // por_eixo
  eixo?: number;
  // osm_charge: { hgv_axle: {all|weekday|weekend: v}, motorcar: {...}, hgv: {...} }
  charge?: Record<string, Record<string, number>>;
}

export interface TollPrice {
  valor: number | null;
  /** como o valor foi obtido (texto curto) */
  regra: string;
  estimado: boolean;
  fonte: string;
  data: string | null;
  url?: string;
  observacao?: string;
}

export interface VehicleTollProfile {
  eixos_cobrados: number;
  eixos_suspensos: number;
  rodagem: 'dupla' | 'simples';
  multiplicador: number;
  tag: boolean;
  fim_de_semana: boolean;
  /** data local da viagem (YYYY-MM-DD), para conferir a vigência da tabela */
  data_viagem: string;
}

export function round2(n: number): number { return Math.round(n * 100) / 100; }

export function brl(n: number | null | undefined): string {
  if (n == null) return '—';
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Multiplicador das tabelas ANTT/ARTESP para veículo comercial. */
export function multiplier(eixos: number, dupla: boolean): number {
  if (dupla) return eixos;
  if (eixos <= 2) return 1;
  if (eixos === 3) return 1.5;
  if (eixos === 4) return 2;
  return eixos / 2; // fora das tabelas (rodagem simples com 5+ eixos): estimado
}

export function tollProfile(v: Vehicle, at: Date): VehicleTollProfile {
  const susp = Math.max(0, Math.min(v.suspended_axles ?? 0, v.axle_count - 2));
  const eixos = Math.max(2, v.axle_count - susp);
  const dupla = v.dual_wheels !== false;
  const local = DateTime.fromJSDate(at).setZone(env.tz);
  const dow = local.weekday; // 1=seg..7=dom
  return {
    eixos_cobrados: eixos, eixos_suspensos: susp, rodagem: dupla ? 'dupla' : 'simples', multiplicador: multiplier(eixos, dupla),
    tag: !!v.has_toll_tag, fim_de_semana: dow >= 6, data_viagem: local.toISODate() ?? '',
  };
}

function fmtDate(d?: string | null): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

/** Tabela oficial vencida na data da viagem: o valor sai como estimado, com a data de fim de vigência. */
function withValidity(pr: TollPrice | null, t: Tariff, p: VehicleTollProfile): TollPrice | null {
  if (!pr || !t.vigencia_fim || !p.data_viagem || t.vigencia_fim >= p.data_viagem) return pr;
  const obs = `tabela vencida em ${fmtDate(t.vigencia_fim)}; pode ter havido reajuste`;
  return { ...pr, estimado: true, observacao: pr.observacao ? `${obs}; ${pr.observacao}` : obs };
}

/** Valor a pagar numa praça, para o perfil do veículo. */
export function priceFor(t: Tariff | null | undefined, p: VehicleTollProfile): TollPrice | null {
  if (!t) return null;
  return withValidity(rawPriceFor(t, p), t, p);
}

function rawPriceFor(t: Tariff, p: VehicleTollProfile): TollPrice | null {
  const meta = { fonte: t.fonte, data: t.data ?? null, url: t.url };
  if (t.modelo === 'categorias' && t.categorias?.length) {
    const cats = t.categorias.filter((c) => c.mult >= 1 && c.valor != null);
    const exact = cats.find((c) => c.eixos === p.eixos_cobrados && (c.rodagem === p.rodagem || c.rodagem == null));
    if (exact) {
      let valor = exact.valor, regra = `categoria ${exact.cat ?? '?'} (${exact.eixos} eixos, rodagem ${exact.rodagem ?? p.rodagem})`;
      if (p.fim_de_semana && exact.valor_fds != null) { valor = exact.valor_fds; regra += ', tarifa de fim de semana'; }
      if (p.tag && exact.valor_tag != null) { valor = exact.valor_tag; regra += ', valor com TAG (AVI)'; }
      return { valor: round2(valor), regra, estimado: false, ...meta };
    }
    // Só estende a tabela ACIMA do maior nº de eixos dela (ex.: vai até 6 eixos e o veículo tem 9). Categoria que falta
    // DENTRO da faixa (ex.: praça que só publica 4 a 8 eixos) = tarifa não publicada para o veículo.
    const maxEixos = t.max_eixos_tabela ?? Math.max(...cats.map((c) => c.eixos));
    if (!cats.length || p.eixos_cobrados <= maxEixos) return null;
    const unit = t.base ?? cats[0].valor / cats[0].mult;
    if (unit == null) return null;
    const fds = p.fim_de_semana ? cats.find((c) => c.valor_fds != null) : undefined;
    let unitUsed = fds ? fds.valor_fds! / fds.mult : unit;
    let regra = `${brl(unitUsed)} x ${String(p.multiplicador).replace('.', ',')} (multiplicador)`;
    // desconto de TAG da própria tabela (razão AVI/manual da maior categoria que tem as duas colunas)
    const tagRef = p.tag ? [...cats].filter((c) => c.valor_tag != null && c.valor > 0).sort((a, b) => b.eixos - a.eixos)[0] : undefined;
    if (tagRef) {
      unitUsed *= tagRef.valor_tag! / tagRef.valor;
      regra += `, desconto de TAG da tabela (${String(Math.round((1 - tagRef.valor_tag! / tagRef.valor) * 1000) / 10).replace('.', ',')}%)`;
    }
    return {
      valor: round2(unitUsed * p.multiplicador), estimado: true, ...meta, regra,
      observacao: `tabela oficial vai até ${maxEixos} eixos; valor estendido pela regra do multiplicador`,
    };
  }
  if (t.modelo === 'por_eixo' && t.eixo != null) {
    return { valor: round2(t.eixo * p.multiplicador), regra: `${brl(t.eixo)} por eixo x ${String(p.multiplicador).replace('.', ',')}`, estimado: p.rodagem === 'simples' && p.eixos_cobrados > 4, ...meta };
  }
  if (t.modelo === 'osm_charge' && t.charge) {
    const pick = (o?: Record<string, number>) => {
      if (!o) return undefined;
      return (p.fim_de_semana ? o.weekend : o.weekday) ?? o.all ?? o.weekday ?? o.weekend;
    };
    const axle = pick(t.charge.hgv_axle);
    const car = pick(t.charge.motorcar);
    let valor: number | undefined, regra = '';
    if (axle != null && p.rodagem === 'dupla') { valor = axle * p.eixos_cobrados; regra = `${brl(axle)} por eixo (OSM) x ${p.eixos_cobrados}`; }
    else if (car != null) { valor = car * p.multiplicador; regra = `${brl(car)} (carro, OSM) x ${String(p.multiplicador).replace('.', ',')}`; }
    else if (axle != null) { valor = axle * p.multiplicador; regra = `${brl(axle)} por eixo (OSM) x ${String(p.multiplicador).replace('.', ',')}`; }
    if (valor == null) return null;
    return { valor: round2(valor), regra, estimado: true, ...meta, observacao: 'tarifa colaborativa do OpenStreetMap' + (t.data ? ` (conferida em ${fmtDate(t.data)})` : ' (sem data de conferência)') };
  }
  return null;
}

export function describeSource(pr: TollPrice): string {
  const d = fmtDate(pr.data);
  if (pr.fonte === 'OSM') return d ? `OSM, conferido em ${d}` : 'OSM, sem data';
  return d ? `${pr.fonte}, tabela de ${d}` : pr.fonte;
}

// ---------------------------------------------------------------------------------------------------------------
// Rota alternativa sem pedágio
// ---------------------------------------------------------------------------------------------------------------

export interface NoTollRoute {
  distance_km: number;
  duration_s: number;
  /** o Valhalla permite pedágio só no começo/fim da rota com exclude_tolls */
  has_toll: boolean;
  coordinates: [number, number][];
  /** restrições que não puderam ser consultadas (a alternativa pode passar por onde a rota principal não passa) */
  falhas: string[];
}

interface Restrictions { rings: Ring[]; costLines: { coordinates: [number, number][]; factor: number }[]; falhas: string[] }

/**
 * Restrições que a rota principal também respeita (zonas por horário, reportes que bloqueiam o veículo e as outras
 * camadas), para que a alternativa sem pedágio seja comparável. Mesma lógica de services/routing.ts.
 * Só é usada quando quem chama não tem as restrições da rota (`RouteGeom.restrictions`, preenchido por routing.ts):
 * aí elas são consultadas de novo, em paralelo. Falha numa consulta não derruba a alternativa, mas fica em `falhas`.
 */
async function restrictionsFor(ctx: RouteCtx, skipLayer: string): Promise<Restrictions> {
  const rings: Ring[] = [];
  const costLines: Restrictions['costLines'] = [];
  const falhas: string[] = [];
  const { loadLayers } = await import('../layers/index.js');
  const layers = (await loadLayers()).filter((l) => l.meta.id !== skipLayer && (l.exclusions || l.costLines));
  const [zones, dayInfo, reports, ...perLayer] = await Promise.allSettled([
    activeZones(),
    legalDayInfo(ctx.at),
    blockingReports(ctx.vehicle, ctx.at),
    ...layers.map(async (l) => ({
      ex: l.exclusions ? await l.exclusions(ctx) : [],
      cl: l.costLines ? await l.costLines(ctx) : [],
    })),
  ]);
  if (zones.status === 'fulfilled') {
    const di = dayInfo.status === 'fulfilled' ? dayInfo.value : {};
    if (dayInfo.status === 'rejected') falhas.push('calendário de feriados');
    for (const z of zones.value) {
      if (!zoneApplies(z.rules, ctx.vehicle, ctx.at, di)) continue;
      if (pointInZone(z, ctx.origin) || pointInZone(z, ctx.destination)) continue;
      rings.push(...zoneRings(z));
    }
  } else falhas.push('zonas de restrição');
  if (reports.status === 'fulfilled') for (const r of reports.value) rings.push(reportToRing(r));
  else falhas.push('reportes de bloqueio');
  perLayer.forEach((res, i) => {
    if (res.status === 'rejected') { falhas.push(layers[i].meta.label); return; }
    for (const ex of res.value.ex) rings.push(...ex.rings);
    for (const c of res.value.cl) costLines.push({ coordinates: c.coordinates, factor: c.factor });
  });
  return { rings, costLines, falhas };
}

/**
 * Rota sem pedágio: Valhalla `costing_options.truck.exclude_tolls = true`. Conferido no Valhalla 3.9.1 local
 * (Lapa→Jundiaí, 5 eixos): `use_tolls: 0` ainda passa no pedágio; `exclude_tolls` evita (doc api/route: "If exclude_tolls
 * is set to true it is allowed to start and end with tolls, but is not allowed to have them in the middle").
 * `given` = as restrições que a rota principal usou (routing.ts as passa em `RouteGeom.restrictions`): com elas, nada é
 * consultado de novo e a alternativa respeita exatamente o mesmo que a rota principal. Sem elas, consulta tudo de novo
 * (menos a camada `skipLayer`). Devolve null se não houver caminho.
 */
export async function noTollRoute(ctx: RouteCtx, skipLayer = 'pedagio', given?: RouteRestrictions): Promise<NoTollRoute | null> {
  const v = ctx.vehicle;
  const { rings, costLines, falhas } = given
    ? { rings: given.excludePolygons, costLines: given.costLines, falhas: [] as string[] }
    : await restrictionsFor(ctx, skipLayer);
  const body: Record<string, unknown> = {
    locations: [
      { lat: ctx.origin.lat, lon: ctx.origin.lon, type: 'break' },
      { lat: ctx.destination.lat, lon: ctx.destination.lon, type: 'break' },
    ],
    costing: 'truck',
    costing_options: {
      truck: {
        height: v.height_m, width: v.width_m, length: v.length_m, weight: v.weight_t,
        axle_load: v.axle_load_t, axle_count: v.axle_count, hazmat: v.hazmat,
        exclude_tolls: true,
      },
    },
    units: 'kilometers',
    language: 'pt-BR',
    date_time: { type: 1, value: ctx.departureLocal },
  };
  if (rings.length) body.exclude_polygons = rings;
  if (costLines.length) {
    body.linear_cost_factors = costLines.map((c) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c.coordinates }, properties: { factor: c.factor } }));
  }
  const res = await fetch(`${env.valhallaUrl}/route`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as any;
  if (!res.ok) {
    const code: number | undefined = json?.error_code;
    if (code === 442 || code === 171 || code === 172 || /no path|no suitable edges/i.test(json?.error ?? '')) return null;
    throw new Error(`Valhalla ${res.status}: ${json?.error ?? res.statusText}`);
  }
  const trip = json.trip;
  const coordinates: [number, number][] = [];
  for (const leg of trip.legs) coordinates.push(...decodePolyline6(leg.shape));
  const distance_km = Number(trip.summary.length);
  let duration_s = Number(trip.summary.time);
  // o factor dos linear_cost_factors infla também o tempo (Valhalla 3.9.1): re-cronometra como em valhalla.route()
  if (body.linear_cost_factors) duration_s = (await retime(trip.legs.map((l: { shape: string }) => l.shape), body, distance_km)) ?? duration_s;
  return { distance_km, duration_s, has_toll: !!trip.summary.has_toll, coordinates, falhas };
}
