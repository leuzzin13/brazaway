/**
 * Custo de pedágio por veículo e rota alternativa sem pedágio.
 *
 * Tarifas vêm da camada `pedagio` (data_features.props.tarifa), em três modelos:
 *  - 'categorias' (ANTT, contratos novos da ARTESP e concessões estaduais/municipais de RJ e MG): tabela por categoria
 *    com nº de eixos (ou faixa de eixos, `eixos_ate`), rodagem e multiplicador. Serve também para tabela NÃO linear
 *    (Rota 116, Linha Amarela, Transolímpica), em que o valor não é proporcional ao nº de eixos;
 *  - 'por_eixo'   (ARTESP, contratos antigos): "COMERCIAL POR EIXO" x multiplicador;
 *  - 'osm_charge' (OpenStreetMap, reserva): charge=<v>BRL/hgv/axle (pode variar dia útil x fim de semana).
 *
 * Regras usadas (ver docs/layers/pedagio.md e docs/layers/pedagio_estaduais.md):
 *  - eixos cobrados = eixos do veículo − eixos suspensos. Caminhão VAZIO não paga eixo suspenso em todo o território
 *    nacional (Lei 13.103/2015, art. 17, redação da Lei 13.711/2018; §3º: considera-se vazio o veículo que passa na praça
 *    com eixo suspenso). O mínimo cobrado é 2 eixos.
 *  - multiplicador das tabelas ANTT/ARTESP: rodagem dupla = nº de eixos; rodagem simples 2/3/4 eixos = 1 / 1,5 / 2.
 *    Sem `dual_wheels` informado, assume rodagem dupla (caminhões e VUC em geral).
 *  - `eixo_adicional` (tabelas da ARTEMIG, MG-050, Rota 116): acima da maior categoria da tabela, soma o valor oficial
 *    por eixo excedente (não é estimativa).
 *  - `janela_fds` (ViaLagos, TBA): a tarifa alternativa (`valor_fds`) vale numa janela de dia e hora (ex.: sexta 12h a
 *    segunda 12h e da véspera de feriado nacional 12h ao dia seguinte 12h), conferida no horário ESTIMADO de passagem
 *    pela praça. Sem janela, `valor_fds` vale sábado e domingo (data de saída), como nas colunas FDS da ANTT.
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

export interface TariffCategory {
  cat?: number;
  eixos: number;
  /** faixa de eixos: a categoria vale de `eixos` até `eixos_ate` (ex.: "7 ou mais eixos" = 7..99) */
  eixos_ate?: number | null;
  rodagem: 'simples' | 'dupla' | null;
  mult: number;
  valor: number;
  valor_fds?: number;
  valor_tag?: number;
}

/**
 * Janela em que vale a tarifa alternativa (`valor_fds`). `semana`: de [dia, hora] até [dia, hora] (dia ISO: 1 = segunda …
 * 7 = domingo; a janela pode virar a semana, ex.: sexta 12h → segunda 12h). `feriados_nacionais`: da véspera às
 * `vespera_desde_h` até o dia seguinte às `dia_seguinte_ate_h`.
 */
export interface TariffWindow {
  rotulo: string;
  semana?: { de: [number, number]; ate: [number, number] } | null;
  feriados_nacionais?: { vespera_desde_h: number; dia_seguinte_ate_h: number } | null;
  fonte?: string;
  base_legal?: string;
}
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
  /** valor oficial por eixo acima da maior categoria da tabela (ARTEMIG, MG-050, Rota 116) */
  eixo_adicional?: number | null;
  /** janela da tarifa alternativa (`valor_fds`), no horário de passagem (ViaLagos) */
  janela_fds?: TariffWindow | null;
  /** tabela não proporcional aos eixos: o `charge` por eixo do OSM não é comparável (sem aviso de divergência) */
  nao_linear?: boolean;
  /** texto da data quando a fonte não publica o início de vigência (ex.: "válida até 21/10/2026; consultada em …") */
  data_desc?: string | null;
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
  /** texto da data da tabela, quando não há data de início de vigência */
  data_desc?: string | null;
  /** a tarifa veio da janela alternativa (fim de semana/feriado) */
  janela_alternativa?: boolean;
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
  /** instante de saída (ISO, UTC): base do horário de passagem pelas praças com janela tarifária */
  instante?: string;
  /** feriados nacionais (YYYY-MM-DD) perto da viagem, preenchidos pela camada (tabela holidays) */
  feriados_nacionais?: string[];
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
    tag: !!v.has_toll_tag, fim_de_semana: dow >= 6, data_viagem: local.toISODate() ?? '', instante: at.toISOString(),
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

const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/**
 * O instante `at` está na janela da tarifa alternativa? `feriados` = datas (YYYY-MM-DD) dos feriados nacionais.
 * Semana: minutos desde segunda 00h, com a janela podendo virar a semana (sexta 12h → segunda 12h). Feriado nacional:
 * da véspera às `vespera_desde_h` até o dia seguinte às `dia_seguinte_ate_h`.
 */
export function inTariffWindow(j: TariffWindow, at: Date, feriados: string[] = [], tz = env.tz): boolean {
  const local = DateTime.fromJSDate(at).setZone(tz);
  if (j.semana) {
    const m = (local.weekday - 1) * 1440 + local.hour * 60 + local.minute;
    const a = (j.semana.de[0] - 1) * 1440 + j.semana.de[1] * 60;
    const b = (j.semana.ate[0] - 1) * 1440 + j.semana.ate[1] * 60;
    if (a <= b ? m >= a && m < b : m >= a || m < b) return true;
  }
  if (j.feriados_nacionais) {
    for (const f of feriados) {
      const d = DateTime.fromISO(f, { zone: tz });
      if (!d.isValid) continue;
      const ini = d.minus({ days: 1 }).set({ hour: j.feriados_nacionais.vespera_desde_h, minute: 0, second: 0, millisecond: 0 });
      const fim = d.plus({ days: 1 }).set({ hour: j.feriados_nacionais.dia_seguinte_ate_h, minute: 0, second: 0, millisecond: 0 });
      if (local >= ini && local < fim) return true;
    }
  }
  return false;
}

/** Texto curto do dia e hora local (ex.: "sexta 16/10 15:20"). */
export function fmtPassagem(at: Date, tz = env.tz): string {
  const l = DateTime.fromJSDate(at).setZone(tz);
  return `${DIAS[l.weekday]} ${l.toFormat('dd/MM HH:mm')}`;
}

/**
 * Vale a tarifa alternativa (`valor_fds`)? Com janela na tabela (ViaLagos), confere o horário de passagem `quando`
 * (padrão: o instante de saída); sem janela, sábado e domingo pela data de saída (colunas FDS da ANTT).
 */
function useAlternative(t: Tariff, p: VehicleTollProfile, quando?: Date): { alt: boolean; rotulo: string } {
  if (t.janela_fds) {
    const at = quando ?? (p.instante ? new Date(p.instante) : null);
    if (!at) return { alt: p.fim_de_semana, rotulo: t.janela_fds.rotulo };
    return { alt: inTariffWindow(t.janela_fds, at, p.feriados_nacionais ?? []), rotulo: `${t.janela_fds.rotulo}; passagem estimada ${fmtPassagem(at)}` };
  }
  return { alt: p.fim_de_semana, rotulo: 'tarifa de fim de semana' };
}

/**
 * Valor a pagar numa praça, para o perfil do veículo. `quando` = horário estimado de passagem pela praça (só muda o
 * resultado em tabela com `janela_fds`).
 */
export function priceFor(t: Tariff | null | undefined, p: VehicleTollProfile, quando?: Date): TollPrice | null {
  if (!t) return null;
  return withValidity(rawPriceFor(t, p, quando), t, p);
}

function fmtMult(n: number): string { return String(n).replace('.', ','); }

function rawPriceFor(t: Tariff, p: VehicleTollProfile, quando?: Date): TollPrice | null {
  const meta = { fonte: t.fonte, data: t.data ?? null, url: t.url, ...(t.data_desc ? { data_desc: t.data_desc } : {}) };
  if (t.modelo === 'categorias' && t.categorias?.length) {
    const cats = t.categorias.filter((c) => c.mult >= 1 && c.valor != null);
    const rodOk = (c: TariffCategory) => c.rodagem === p.rodagem || c.rodagem == null;
    const exact = cats.find((c) => rodOk(c) && (c.eixos === p.eixos_cobrados
      || (c.eixos_ate != null && p.eixos_cobrados >= c.eixos && p.eixos_cobrados <= c.eixos_ate)));
    const w = useAlternative(t, p, quando);
    if (exact) {
      const faixa = exact.eixos_ate != null && exact.eixos_ate !== exact.eixos
        ? (exact.eixos_ate >= 99 ? `${exact.eixos} ou mais eixos` : `${exact.eixos} a ${exact.eixos_ate} eixos`) : `${exact.eixos} eixos`;
      let valor = exact.valor, regra = `categoria ${exact.cat ?? '?'} (${faixa}, rodagem ${exact.rodagem ?? p.rodagem})`;
      let janela = false;
      if (w.alt && exact.valor_fds != null) { valor = exact.valor_fds; regra += `, ${w.rotulo}`; janela = true; }
      if (p.tag && exact.valor_tag != null) { valor = exact.valor_tag; regra += ', valor com TAG (AVI)'; }
      return { valor: round2(valor), regra, estimado: false, ...meta, ...(janela ? { janela_alternativa: true } : {}) };
    }
    // Só estende a tabela ACIMA do maior nº de eixos dela (ex.: vai até 6 eixos e o veículo tem 9). Categoria que falta
    // DENTRO da faixa (ex.: praça que só publica 4 a 8 eixos) = tarifa não publicada para o veículo.
    const maxEixos = t.max_eixos_tabela ?? Math.max(...cats.map((c) => c.eixos_ate ?? c.eixos));
    if (!cats.length || p.eixos_cobrados <= maxEixos) return null;
    // valor oficial por eixo excedente (ARTEMIG, MG-050, Rota 116): maior categoria da mesma rodagem + n x eixo adicional
    const topo = t.eixo_adicional != null && p.rodagem === 'dupla'
      ? [...cats].filter((c) => c.rodagem === 'dupla' || c.rodagem == null).sort((a, b) => b.eixos - a.eixos)[0] : undefined;
    if (topo && t.eixo_adicional != null) {
      const extra = p.eixos_cobrados - topo.eixos;
      let base = topo.valor, regra = `categoria ${topo.cat ?? '?'} (${topo.eixos} eixos) + ${extra} eixo(s) adicional(is) x ${brl(t.eixo_adicional)}`;
      let janela = false;
      if (w.alt && topo.valor_fds != null) { base = topo.valor_fds; regra += `, ${w.rotulo}`; janela = true; }
      return { valor: round2(base + extra * t.eixo_adicional), regra, estimado: false, ...meta, ...(janela ? { janela_alternativa: true } : {}) };
    }
    // tabela não proporcional aos eixos (Transolímpica até 7 eixos): o multiplicador não serve para estender
    if (t.nao_linear) return null;
    const unit = t.base ?? cats[0].valor / cats[0].mult;
    if (unit == null) return null;
    const fds = w.alt ? cats.find((c) => c.valor_fds != null) : undefined;
    let unitUsed = fds ? fds.valor_fds! / fds.mult : unit;
    let regra = `${brl(unitUsed)} x ${fmtMult(p.multiplicador)} (multiplicador)${fds ? `, ${w.rotulo}` : ''}`;
    // desconto de TAG da própria tabela (razão AVI/manual da maior categoria que tem as duas colunas)
    const tagRef = p.tag ? [...cats].filter((c) => c.valor_tag != null && c.valor > 0).sort((a, b) => b.eixos - a.eixos)[0] : undefined;
    if (tagRef) {
      unitUsed *= tagRef.valor_tag! / tagRef.valor;
      regra += `, desconto de TAG da tabela (${String(Math.round((1 - tagRef.valor_tag! / tagRef.valor) * 1000) / 10).replace('.', ',')}%)`;
    }
    return {
      valor: round2(unitUsed * p.multiplicador), estimado: true, ...meta, regra, ...(fds ? { janela_alternativa: true } : {}),
      observacao: `tabela oficial vai até ${maxEixos} eixos; valor estendido pela regra do multiplicador`,
    };
  }
  if (t.modelo === 'por_eixo' && t.eixo != null) {
    return { valor: round2(t.eixo * p.multiplicador), regra: `${brl(t.eixo)} por eixo x ${fmtMult(p.multiplicador)}`, estimado: p.rodagem === 'simples' && p.eixos_cobrados > 4, ...meta };
  }
  if (t.modelo === 'osm_charge' && t.charge) {
    // Valor condicionado ao dia (Mo-Fr / Sa-Su) só vale no próprio período: o de fim de semana NÃO serve de reserva para
    // dia útil (ViaLagos no OSM: "Mo-Fr 18.40BRL/hgv;Sa-Su 30.60BRL/hgv/axle" cobrava a TBA numa quarta-feira).
    const pick = (o?: Record<string, number>) => {
      if (!o) return undefined;
      return (p.fim_de_semana ? o.weekend : o.weekday) ?? o.all;
    };
    const axle = pick(t.charge.hgv_axle);
    const car = pick(t.charge.motorcar);
    let valor: number | undefined, regra = '';
    if (axle != null && p.rodagem === 'dupla') { valor = axle * p.eixos_cobrados; regra = `${brl(axle)} por eixo (OSM) x ${p.eixos_cobrados}`; }
    else if (car != null) { valor = car * p.multiplicador; regra = `${brl(car)} (carro, OSM) x ${fmtMult(p.multiplicador)}`; }
    else if (axle != null) { valor = axle * p.multiplicador; regra = `${brl(axle)} por eixo (OSM) x ${fmtMult(p.multiplicador)}`; }
    if (valor == null) return null;
    return { valor: round2(valor), regra, estimado: true, ...meta, observacao: 'tarifa colaborativa do OpenStreetMap' + (t.data ? ` (conferida em ${fmtDate(t.data)})` : ' (sem data de conferência)') };
  }
  return null;
}

export function describeSource(pr: Pick<TollPrice, 'fonte' | 'data'> & { data_desc?: string | null }): string {
  const d = fmtDate(pr.data);
  if (pr.fonte === 'OSM') return d ? `OSM, conferido em ${d}` : 'OSM, sem data';
  if (d) return `${pr.fonte}, tabela de ${d}`;
  return pr.data_desc ? `${pr.fonte}, ${pr.data_desc}` : pr.fonte;
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
 * `evitar` = anéis pequenos em volta dos pontos de cobrança da rota principal: o `exclude_tolls` só evita a via marcada
 * `toll=yes` no grafo, e muitas praças estaduais (EPR em MG, Via Lagos, Linha Amarela) ficam em via sem essa marca.
 */
export async function noTollRoute(ctx: RouteCtx, skipLayer = 'pedagio', given?: RouteRestrictions, evitar: Ring[] = []): Promise<NoTollRoute | null> {
  const v = ctx.vehicle;
  const base = given
    ? { rings: given.excludePolygons, costLines: given.costLines, falhas: [] as string[] }
    : await restrictionsFor(ctx, skipLayer);
  const { costLines, falhas } = base;
  const rings = evitar.length ? [...base.rings, ...evitar] : base.rings;
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
