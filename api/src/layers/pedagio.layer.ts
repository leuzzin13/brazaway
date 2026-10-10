import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { featuresInBbox, featuresNearRoute, type DataFeatureRow, type NearRouteRow } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';
import { brl, describeSource, fmtPassagem, noTollRoute, priceFor, round2, tollProfile, type Tariff, type TollPrice, type VehicleTollProfile } from '../services/tollCost.js';
import { query } from '../db.js';
import { env } from '../config.js';

/**
 * Pedágio: praças e pórticos (ANTT, ARTESP, OSM) e custo estimado da rota para o veículo.
 *
 * Como a praça entra na conta:
 *  1. A polilinha do Valhalla passa exatamente pelos nós do grafo, que vêm do mesmo extrato OSM importado em
 *     source='osm'. Um nó barrier=toll_booth/highway=toll_gantry a até HIT_M da rota = a rota passa pela cabine/pórtico
 *     NAQUELA pista. Isso resolve o sentido de cobrança (praça unidirecional só tem nó na pista cobrada; a pista oposta
 *     fica 10–60 m ao lado e não conta).
 *  2. Nós a menos de CLUSTER_KM entre si ao longo da rota = uma praça (cabines/faixas da mesma praça).
 *  3. Cada praça é associada à praça oficial (ANTT/ARTESP) mais próxima (≤ OFFICIAL_M, mesma rodovia e nome parecido
 *     pesam a favor). A tarifa oficial manda; a `charge` do OSM é reserva (marcada como estimada, com a data).
 *  4. Praças oficiais coladas na rota (≤ POSSIBLE_M) sem NENHUM nó de pedágio do OSM a até OSM_COVER_M (lacuna do mapa)
 *     são listadas como "possíveis", sem somar.
 *  5. Praça oficial com `cobranca_suspensa` (concessão encerrada ou caducada; o CKAN ainda a lista como ativa): listada
 *     como "cobrança suspensa", fora do total, sem usar o valor do OSM (que pode ser de antes da suspensão).
 *  6. Fontes estaduais/municipais (AGETRANSP, ARTEMIG, concessões municipais; ver docs/layers/pedagio_estaduais.md):
 *     registro com `ativo: false` (confiança baixa, cobrança não iniciada) fica fora da conta e do mapa de cobrança;
 *     cabine do OSM ao lado dele = "situação incerta": listada com o valor do OSM só como referência, fora do total;
 *     `casar_ate_m` limita a distância de associação (a posição já vem casada com o nó do OSM ou é oficial);
 *     pórtico oficial sem nó no OSM (`cobra_sem_no_osm`, ex.: free flow da MG-459) conta quando a rota passa a até
 *     `raio_m` dele no rumo da via (`rumo_via`, medido no grafo do Valhalla).
 *  7. Tabela com janela tarifária (`janela_fds`, ViaLagos): o valor depende do horário ESTIMADO de passagem pela praça
 *     (saída + fração da distância x duração da rota) e dos feriados nacionais (tabela holidays).
 * Não bloqueia nem penaliza nada: só anota.
 */
const ID = 'pedagio';
const HIT_M = 3;
const CLUSTER_KM = 0.5;
const OFFICIAL_M = 1500;
const POSSIBLE_M = 60;
const OSM_NEAR_M = 400;   // nós do OSM perto da rota (para saber se o OSM cobre a praça oficial)
const OSM_COVER_M = 300;  // praça oficial com nó do OSM a até 300 m = coberta pelo OSM
/** rumo da rota x rumo da via para o pórtico oficial sem nó no OSM (graus, nos dois sentidos da via) */
const PORTICO_RUMO_TOL = 35;
/** registro oficial desativado (ativo=false): não cobra nem é associado; só gera aviso se o OSM tem cabine ali */
const isActive = (r: DataFeatureRow) => (r.props as Props).ativo !== false;
const INACTIVE_NEAR_M = 400;

type Props = Record<string, any>;

function normTxt(s: unknown): string {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
const STOP = new Set(['pedagio', 'praca', 'sentido', 'capital', 'interior', 'norte', 'sul', 'leste', 'oeste', 'pista', 'ramo', 'rodovia', 'portico', 'cabine', 'cabines', 'avancadas', 'interna', 'externa', 'bloqueio', 'trecho', 'free', 'flow']);
function tokens(s: unknown): Set<string> {
  return new Set(normTxt(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t)));
}
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}
function rodKey(s: unknown): string { return normTxt(s).replace(/[^a-z0-9/]/g, ''); }
function rodovias(p: Props): string[] {
  const out = new Set<string>();
  for (const r of [p.rodovia, ...(Array.isArray(p.rodovias) ? p.rodovias : [])]) if (r) out.add(rodKey(r));
  return [...out];
}
function coord(r: DataFeatureRow): [number, number] {
  const g = r.geometry as GeoJSON.Point;
  return g.type === 'Point' ? (g.coordinates as [number, number]) : (turf.centroid(turf.feature(g)).geometry.coordinates as [number, number]);
}
function distM(a: [number, number], b: [number, number]): number {
  return turf.distance(turf.point(a), turf.point(b), { units: 'meters' });
}
function fmtBr(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d ?? '');
}
function kmTxt(km: unknown): string {
  const n = Number(km);
  return Number.isFinite(n) && km !== null && km !== '' ? `km ${String(Math.round(n * 10) / 10).replace('.', ',')}` : '';
}
function plazaLabel(official: DataFeatureRow | null, osm: DataFeatureRow): string {
  const r = official ?? osm;
  const p = r.props as Props;
  const rod = [p.rodovia, kmTxt(p.km)].filter(Boolean).join(' ');
  const name = r.name ?? (osm.name || (osm.kind === 'portico' ? 'Pórtico de pedágio' : 'Praça de pedágio'));
  return rod ? `${name} (${rod})` : name;
}

function bearingAt(line: GeoJSON.Feature<GeoJSON.LineString>, lenKm: number, f: number): number | null {
  if (lenKm <= 0) return null;
  const a = turf.along(line, Math.max(0, f * lenKm - 0.2), { units: 'kilometers' });
  const b = turf.along(line, Math.min(lenKm, f * lenKm + 0.2), { units: 'kilometers' });
  return (turf.bearing(a, b) + 360) % 360;
}

interface Suspensao { desde: string; motivo: string; fonte?: string }

export interface PlazaOnRoute {
  nome: string;
  tipo: 'praca' | 'portico';
  km_rota: number;
  lat: number;
  lon: number;
  rodovia: string | null;
  operador: string | null;
  free_flow: boolean;
  ponto_a_ponto: boolean;
  cobranca: string | null;
  valor: number | null;
  regra: string | null;
  estimado: boolean;
  fonte: string | null;
  data: string | null;
  url?: string;
  observacao?: string;
  /** valor pelo OSM (e data de conferência), para comparação com a tabela oficial */
  valor_osm?: number | null;
  data_osm?: string | null;
  valor_oficial_sem_tag?: number | null;
  /** concessão encerrada/caducada: a praça não cobra (desde, motivo, fonte) */
  cobranca_suspensa?: Suspensao | null;
  /** horário estimado de passagem (só em praça com janela tarifária) */
  passagem_estimada?: string | null;
  /** a tarifa oficial não é proporcional aos eixos: o valor por eixo do OSM não é comparável */
  nao_linear?: boolean;
  /** como pagar (free flow), quando a fonte oficial informa */
  pagamento?: string | null;
  /** posição: 'osm' (nó do OSM sobre a rota) ou 'oficial_sem_osm' (pórtico oficial sem nó no OSM, conferido pelo rumo) */
  deteccao?: 'osm' | 'oficial_sem_osm';
  /** data da tabela em texto, quando a fonte não publica o início de vigência */
  data_desc?: string | null;
  /** a tarifa oficial tem janela de dia/hora (ViaLagos) e a passagem caiu nela (tarifa alternativa) */
  janela_alternativa?: boolean;
  com_janela?: boolean;
  /** registro oficial desativado (confiança baixa) junto da cabine do OSM: situação da cobrança incerta */
  registro_inativo?: { nome: string | null; fonte: string; motivo: string; ato: string | null; ato_url: string | null } | null;
  osm_id: string;
  oficial_id: string | null;
  oficial_fonte: string | null;
}

/** Rumo cobrado pelo `direction` do OSM (importador): se todos diferem > 120° do rumo da rota, a cabine é do outro sentido. */
function chargedHere(h: DataFeatureRow, bearing: number | null): boolean {
  const hs = (h.props as Props).charged_headings as number[] | undefined;
  if (bearing == null || !Array.isArray(hs) || !hs.length) return true;
  return hs.some((x) => { const d = Math.abs(((x - bearing) % 360 + 540) % 360 - 180); return d <= 120; });
}

/** Nó do OSM que é só cabine de estacionamento/condomínio: sem tarifa, sem rodovia e sem praça oficial perto. */
function looksPrivate(osm: DataFeatureRow, official: DataFeatureRow | null): boolean {
  const p = osm.props as Props;
  return !official && !p.tarifa && !p.rodovia && !/ped[aá]gio|toll|free ?flow/i.test(osm.name ?? '');
}

const CARD: Record<string, number> = { norte: 0, leste: 90, sul: 180, oeste: 270 };
/** +1 se o nome da praça indica o sentido da rota ("Arujá Norte" indo para o norte), −1 se o oposto, 0 se não diz. */
function cardinalAgreement(name: string | null, bearing: number | null): number {
  if (bearing == null) return 0;
  const m = /\b(norte|sul|leste|oeste)\b/.exec(normTxt(name));
  if (!m) return 0;
  const c = Math.cos(((bearing - CARD[m[1]]) * Math.PI) / 180);
  return c >= 0.2 ? 1 : c <= -0.2 ? -1 : 0;
}

function matchOfficial(rep: DataFeatureRow, officials: NearRouteRow[], used: Set<string>, bearing: number | null): DataFeatureRow | null {
  const pt = coord(rep);
  const rp = rep.props as Props;
  const rods = new Set(rodovias(rp));
  const tk = tokens(`${rep.name ?? ''} ${rp.via_nome ?? ''}`);
  let best: { row: NearRouteRow; score: number } | null = null;
  for (const o of officials) {
    if (used.has(o.id)) continue;
    const d = distM(pt, coord(o));
    const op = o.props as Props;
    if (d > Math.min(OFFICIAL_M, Number(op.casar_ate_m) || OFFICIAL_M)) continue;
    let score = d;
    if (rodovias(op).some((r) => rods.has(r))) score -= 300;
    score -= 400 * Math.min(2, overlap(tk, tokens(o.name)));
    if (op.tarifa) score -= 200;
    if ((o.kind === 'portico') === (rep.kind === 'portico')) score -= 300;
    if (op.ponto_a_ponto && rep.kind !== 'portico') score += 1000;
    score -= 150 * cardinalAgreement(o.name, bearing);
    if (!best || score < best.score) best = { row: o, score };
  }
  return best?.row ?? null;
}

interface LineCharge {
  plazas: PlazaOnRoute[];
  ignored: string[];
  otherWay: string[];
  osmNear: NearRouteRow[];
  officials: NearRouteRow[];
  used: Set<string>;
}

/** Saída e duração da linha, para estimar o horário de passagem em cada praça (tarifa com janela de dia e hora). */
interface LineTiming { at: Date; duration_s: number }

function passageAt(timing: LineTiming | undefined, fraction: number): Date | undefined {
  if (!timing) return undefined;
  return new Date(timing.at.getTime() + Math.max(0, Math.min(1, fraction)) * timing.duration_s * 1000);
}

function angleDiff180(a: number, b: number): number {
  const d = Math.abs(((a - b) % 180 + 180) % 180);
  return Math.min(d, 180 - d);
}

/** Monta a praça cobrada a partir do ponto que a rota cruzou (nó do OSM ou pórtico oficial) e da praça oficial. */
function buildPlaza(rep: NearRouteRow, off: DataFeatureRow | null, totalKm: number, prof: VehicleTollProfile, timing: LineTiming | undefined, deteccao: 'osm' | 'oficial_sem_osm'): PlazaOnRoute {
  const op = (off?.props ?? {}) as Props;
  const rp = (deteccao === 'osm' ? rep.props : {}) as Props;
  const pap = !!op.ponto_a_ponto;
  const susp = (op.cobranca_suspensa ?? null) as Suspensao | null;
  const tOff = op.tarifa as Tariff | null;
  const quando = tOff?.janela_fds ? passageAt(timing, rep.fraction) : undefined;
  const osmPrice = priceFor(rp.tarifa as Tariff | null, prof);
  let price: TollPrice | null = pap || susp ? null : (priceFor(tOff, prof, quando) ?? osmPrice);
  // o OSM guarda o valor de cabine (sem desconto de TAG): compara com o oficial sem TAG
  const officialManual = prof.tag ? priceFor(tOff, { ...prof, tag: false }, quando) : null;
  if (price && price.valor === 0) price = { ...price, observacao: 'tarifa zero na fonte (ponto sem cobrança)' };
  const [lon, lat] = coord(rep);
  return {
    nome: plazaLabel(off, rep),
    tipo: rep.kind === 'portico' || off?.kind === 'portico' ? 'portico' : 'praca',
    km_rota: round2(rep.fraction * totalKm),
    lat, lon,
    rodovia: op.rodovia ?? rp.rodovia ?? null,
    operador: op.operador ?? rp.operador ?? null,
    free_flow: !!(rp.free_flow || op.free_flow || rep.kind === 'portico') && !pap,
    ponto_a_ponto: pap,
    cobranca: op.cobranca ?? null,
    valor: susp ? 0 : price?.valor ?? null,
    regra: susp ? `cobrança suspensa desde ${fmtBr(susp.desde)}: ${susp.motivo}`
      : price?.regra ?? (pap ? 'sistema ponto a ponto: cobra só quem aderiu com TAG, no lugar da praça' : null),
    estimado: price?.estimado ?? false,
    fonte: susp ? (off?.source ?? '').toUpperCase() || null : price?.fonte ?? null,
    data: susp ? susp.desde : price?.data ?? null,
    url: susp ? susp.fonte : price?.url,
    observacao: price?.observacao,
    valor_osm: osmPrice?.valor ?? null,
    data_osm: osmPrice?.data ?? null,
    valor_oficial_sem_tag: officialManual?.valor ?? price?.valor ?? null,
    cobranca_suspensa: susp,
    passagem_estimada: quando ? fmtPassagem(quando) : null,
    nao_linear: !!tOff?.nao_linear,
    pagamento: op.pagamento ?? null,
    deteccao,
    osm_id: deteccao === 'osm' ? rep.source_id : `oficial:${off?.source}:${off?.source_id}`,
    oficial_id: off?.id ?? null,
    oficial_fonte: off?.source ?? null,
    data_desc: price?.data_desc ?? null,
    janela_alternativa: !!price?.janela_alternativa,
    com_janela: !!tOff?.janela_fds,
  };
}

/**
 * Registro oficial desativado (ativo=false) ao lado da cabine do OSM: a regra de confiança baixa nunca é aplicada, nem
 * pelo valor do OSM. Como na cobrança suspensa, o ponto fica fora do total, das "praças sem tarifa" e dos anéis da
 * alternativa sem pedágio; o valor do OSM fica só como referência (`valor_osm`, com a data de conferência).
 */
function markUncertain(pl: PlazaOnRoute, dead: DataFeatureRow): PlazaOnRoute {
  const op = dead.props as Props;
  const motivo = String(op.motivo_inativo ?? 'registro desativado');
  return {
    ...pl,
    // nome e rodovia do registro oficial (o mesmo ponto que o mapa mostra; o nó do OSM perto dele fica escondido)
    nome: plazaLabel(dead, dead),
    rodovia: op.rodovia ?? pl.rodovia,
    operador: op.operador ?? pl.operador,
    valor: null,
    regra: `situação incerta, fora do total: ${motivo}`,
    estimado: false,
    fonte: null,
    data: null,
    data_desc: null,
    url: op.ato_url ?? undefined,
    observacao: pl.valor_osm != null ? `valor do OpenStreetMap só como referência: ${brl(pl.valor_osm)}${pl.data_osm ? ` (conferido em ${fmtBr(pl.data_osm)})` : ''}` : undefined,
    valor_oficial_sem_tag: null,
    janela_alternativa: false,
    registro_inativo: { nome: dead.name ?? null, fonte: dead.source, motivo, ato: op.ato ?? null, ato_url: op.ato_url ?? null },
  };
}

/**
 * Pontos de cobrança por onde uma linha (rota) passa, no sentido dela, com o valor para o perfil do veículo.
 * Usada na rota principal e na alternativa sem pedágio (que o Valhalla pode fazer passar por pórtico free flow que o
 * grafo não marca como pedágio).
 */
async function plazasOnLine(lineF: GeoJSON.Feature<GeoJSON.LineString>, totalKm: number, prof: VehicleTollProfile, timing?: LineTiming): Promise<LineCharge> {
  const line = lineF.geometry;
  const [osmNear, allOfficials] = await Promise.all([
    featuresNearRoute(ID, line, OSM_NEAR_M, { where: `source = 'osm'`, limit: 3000 }),
    featuresNearRoute(ID, line, OFFICIAL_M, { where: `source <> 'osm'`, limit: 2000 }),
  ]);
  const officials = allOfficials.filter(isActive);
  const inactive = allOfficials.filter((o) => !isActive(o));
  const hits = osmNear.filter((h) => h.distance_m <= HIT_M);
  const lenKm = turf.length(lineF, { units: 'kilometers' });

  // nós do OSM sobre a rota -> praças (agrupadas ao longo da rota)
  const clusters: NearRouteRow[][] = [];
  for (const h of hits) {
    const last = clusters[clusters.length - 1];
    if (last && (h.fraction - last[last.length - 1].fraction) * totalKm <= CLUSTER_KM) last.push(h);
    else clusters.push([h]);
  }
  const used = new Set<string>();
  const plazas: PlazaOnRoute[] = [];
  const ignored: string[] = [];
  const otherWay: string[] = [];
  for (const c0 of clusters) {
    // cabine em via de mão dupla com `direction` que só cobra o outro sentido: não conta
    const c = c0.filter((h) => chargedHere(h, bearingAt(lineF, lenKm, h.fraction)));
    if (!c.length) { otherWay.push(...c0.map((h) => h.source_id)); continue; }
    const rep = c.find((h) => (h.props as Props).tarifa && h.kind === 'praca') ?? c.find((h) => (h.props as Props).tarifa) ?? c[0];
    const off = matchOfficial(rep, officials, used, bearingAt(lineF, lenKm, rep.fraction));
    if (looksPrivate(rep, off)) { ignored.push(rep.source_id); continue; }
    if (off) used.add(off.id);
    const pl = buildPlaza(rep, off, totalKm, prof, timing, 'osm');
    // cabine do OSM sem praça oficial ativa, mas com registro oficial DESATIVADO ao lado (ex.: CRP Pirapetinga, cobrança
    // suspensa na Justiça, confiança baixa): situação incerta, fora do total
    const dead = off ? null : inactive.find((o) => distM(coord(rep), coord(o)) <= INACTIVE_NEAR_M);
    plazas.push(dead ? markUncertain(pl, dead) : pl);
  }
  // pórtico oficial sem nó no OSM (free flow da MG-459): a rota passa a até raio_m do ponto oficial, no rumo da via
  for (const o of officials) {
    const cfg = (o.props as Props).cobra_sem_no_osm as { raio_m?: number; rumo_via?: number } | undefined;
    if (!cfg || used.has(o.id) || o.distance_m > (cfg.raio_m ?? 30)) continue;
    const brg = bearingAt(lineF, lenKm, o.fraction);
    if (cfg.rumo_via != null && (brg == null || angleDiff180(brg, cfg.rumo_via) > PORTICO_RUMO_TOL)) continue;
    used.add(o.id);
    plazas.push(buildPlaza(o, o, totalKm, prof, timing, 'oficial_sem_osm'));
  }
  plazas.sort((a, b) => a.km_rota - b.km_rota);
  return { plazas, ignored, otherWay, osmNear, officials, used };
}

/**
 * Anel de AVOID_RING_M em volta de cada ponto de cobrança da rota principal (nó do OSM sobre a rota ou pórtico oficial),
 * para a alternativa sem pedágio não voltar a passar por praça em via sem `toll=yes` no grafo. Pula ponto a menos de
 * 300 m da origem ou do destino (o Valhalla não acharia a via de partida/chegada).
 */
const AVOID_RING_M = 25;
function avoidRings(points: PlazaOnRoute[], ctx: { origin: { lat: number; lon: number }; destination: { lat: number; lon: number } }): [number, number][][] {
  const out: [number, number][][] = [];
  for (const p of points) {
    const pt: [number, number] = [p.lon, p.lat];
    if (distM(pt, [ctx.origin.lon, ctx.origin.lat]) < 300 || distM(pt, [ctx.destination.lon, ctx.destination.lat]) < 300) continue;
    const c = turf.circle(pt, AVOID_RING_M, { units: 'meters', steps: 8 }).geometry.coordinates[0];
    out.push(c.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))] as [number, number]));
  }
  return out;
}

/**
 * Feriados nacionais (YYYY-MM-DD) de um dia antes da saída até alguns dias depois (janela tarifária da ViaLagos).
 * Só os ativos (`holidays.active`): feriado com status a_confirmar/suspensa/revogada nunca aciona a TBA. Banco sem a
 * coluna (sem a migration dos feriados do Sudeste; Postgres 42703) cai na consulta sem o filtro, onde não há linha
 * desativada; qualquer outro erro vira "sem feriado" (TBP).
 */
const HOLIDAYS_SQL = (onlyActive: boolean) =>
  `select to_char(day, 'YYYY-MM-DD') d from holidays where scope = 'national'${onlyActive ? ' and active' : ''} and day between $1 and $2`;
async function nationalHolidays(at: Date, durationS: number): Promise<string[]> {
  const d0 = DateTime.fromJSDate(at).setZone(env.tz).minus({ days: 1 }).toISODate();
  const d1 = DateTime.fromJSDate(at).setZone(env.tz).plus({ seconds: durationS }).plus({ days: 2 }).toISODate();
  try {
    const r = await query<{ d: string }>(HOLIDAYS_SQL(true), [d0, d1])
      .catch((e: unknown) => ((e as { code?: unknown } | null)?.code === '42703' ? query<{ d: string }>(HOLIDAYS_SQL(false), [d0, d1]) : Promise.reject(e)));
    return r.rows.map((x) => x.d);
  } catch {
    return [];
  }
}

/**
 * Como pagar o free flow sem TAG, por operador: pórtico federal (ANTT) tem 30 dias; o de outra concessão usa o texto
 * da fonte dele (`pagamento`), que NÃO vale para pórtico de outro operador na mesma rota.
 */
const PAG_ANTT = 'pague pelo site ou app da concessionária em até 30 dias (ANTT)';
const PAG_OUTROS = 'pague pelo site ou app da concessionária no prazo informado por ela';
function isFederal(p: PlazaOnRoute): boolean {
  return p.oficial_fonte ? p.oficial_fonte === 'antt' : /^BR/i.test(p.rodovia ?? '');
}
export function freeFlowPayment(ff: PlazaOnRoute[]): string {
  const groups = new Map<string, { fed: boolean; operador: string | null; rodovias: Set<string>; pag: string | null }>();
  for (const p of ff) {
    const fed = isFederal(p);
    const key = fed ? 'antt' : `${p.oficial_fonte ?? 'osm'}|${normTxt(p.operador)}`;
    const g = groups.get(key) ?? { fed, operador: p.operador, rodovias: new Set<string>(), pag: fed ? PAG_ANTT : null };
    if (p.rodovia) g.rodovias.add(p.rodovia);
    if (!g.pag && p.pagamento) g.pag = p.pagamento;
    groups.set(key, g);
  }
  const gs = [...groups.values()];
  if (gs.length === 1) return `sem TAG, ${gs[0].pag ?? PAG_OUTROS}`;
  const comPag = gs.filter((g) => g.pag);
  if (!comPag.length) return `sem TAG, ${PAG_OUTROS}`;
  const label = (g: (typeof gs)[number]) => g.fed ? 'pórticos federais'
    : [[...g.rodovias].join('/'), g.operador ? `(${g.operador})` : ''].filter(Boolean).join(' ') || 'pórtico';
  const parts = comPag.map((g) => `${label(g)}: ${g.pag}`);
  if (comPag.length < gs.length) parts.push(`demais: ${PAG_OUTROS}`);
  return `sem TAG: ${parts.join('; ')}`;
}

/** perfil de referência do mapa: carreta de 5 eixos, rodagem dupla, dia útil, sem TAG */
const CINCO_EIXOS: VehicleTollProfile = { eixos_cobrados: 5, eixos_suspensos: 0, rodagem: 'dupla', multiplicador: 5, tag: false, fim_de_semana: false, data_viagem: '' };
function brlOrNull(n: number | null | undefined): string | null { return n == null ? null : brl(n); }

const layer: RouteLayer = {
  meta: {
    id: ID,
    label: 'Pedágio',
    description: 'Praças e pórticos de pedágio (federais, estaduais de SP, RJ e MG e municipais do Rio); custo estimado da rota para o veículo (eixos, rodagem, dia e horário de passagem) e comparação com a alternativa sem pedágio.',
    group: 'custos',
    sources: [
      { name: 'ANTT: praças de pedágio (dados.antt.gov.br)', url: 'https://dados.antt.gov.br/dataset/praca-de-pedagio', license: 'CC-BY' },
      { name: 'ANTT: tarifas por concessão (gov.br/antt)', url: 'https://www.gov.br/antt/pt-br/assuntos/rodovias/concessionarias/lista-de-concessoes', license: 'CC BY-ND 3.0 (rodapé gov.br)' },
      { name: 'ARTESP: tabelas de tarifas 2026 (PDF)', url: 'https://www.artesp.sp.gov.br/artesp/setor-regulado/rodovia/pedagios', license: 'Não especificada (portal cms.sp.gov.br: todos os direitos reservados)' },
      { name: 'ARTESP: malha rodoviária por lote (KMZ)', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria', license: 'CC-BY' },
      { name: 'OpenStreetMap: barrier=toll_booth / highway=toll_gantry (charge)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0' },
      { name: 'AGETRANSP (RJ): tarifas da CCR Via Lagos (RJ-124) e da Rota 116 (RJ-116), Deliberações 1630 e 1631/2025', url: 'https://www.agetransp.rj.gov.br/operadoras/vialagos', license: 'Ato oficial (Lei 9.610/98, art. 8º, IV); página sem licença declarada' },
      { name: 'ARTEMIG (MG): tarifas e praças das concessões estaduais (tabelas em imagem transcritas em 10/10/2026)', url: 'https://artemig.mg.gov.br/artemig/', license: 'Valores de atos e tabelas oficiais (Lei 9.610/98, art. 8º, IV); portal: "todos os direitos reservados" (só os valores, sem as imagens)' },
      { name: 'Concessões municipais: Linha Amarela (LAMSA), Transolímpica (ViaRio) e MGC-393 Pirapetinga (CRP)', url: 'https://www.viario.com.br/tarifas-do-pedagio.php', license: 'Tabelas publicadas pelas concessionárias (Lei 8.987/95, art. 9º, §5º); sem licença aberta' },
    ],
    style: { kind: 'circle', color: '#d97706', radius: 6, minzoom: 7, icon: '💰' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 7) return { type: 'FeatureCollection', features: [] };
    // OSM só aparece onde não há praça oficial por perto (evita pontos duplicados no mapa)
    const rows = await featuresInBbox(ID, bbox, {
      limit: 3000,
      where: `source <> 'osm' or not exists (select 1 from data_features o where o.layer_id = 'pedagio' and o.source <> 'osm'
               and ST_DWithin(o.geom::geography, data_features.geom::geography, 800))`,
    });
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = r.props as Props;
        const t = p.tarifa as Tariff | null;
        let eixo: number | undefined;
        if (t?.modelo === 'por_eixo') eixo = t.eixo;
        else if (t?.modelo === 'categorias') eixo = t.base ?? undefined;
        else if (t?.modelo === 'osm_charge') {
          const a = t.charge?.hgv_axle ?? t.charge?.motorcar;
          eixo = a ? a.all ?? a.weekday ?? a.weekend : undefined;
        }
        return {
          type: 'Feature' as const,
          id: r.id,
          geometry: r.geometry,
          properties: {
            id: r.id,
            name: r.name ?? (r.kind === 'portico' ? 'Pórtico de pedágio' : 'Praça de pedágio'),
            tipo: r.kind === 'portico' ? 'pórtico (free flow)' : 'praça',
            rodovia: p.rodovia ?? null,
            km: p.km ?? null,
            operador: p.operador ?? null,
            tarifa_por_eixo: p.ativo === false ? `fora do total do app: ${p.motivo_inativo ?? 'registro desativado'}`
              : p.cobranca_suspensa ? `cobrança suspensa desde ${fmtBr(p.cobranca_suspensa.desde)}`
              : t?.nao_linear ? 'tabela não proporcional aos eixos (ver tarifa de 5 eixos)'
              : eixo != null ? brl(eixo) : 'não publicada',
            tarifa_5_eixos: t && p.ativo !== false && !p.cobranca_suspensa ? brlOrNull(priceFor(t, CINCO_EIXOS)?.valor) : null,
            tarifa_janela: t?.janela_fds?.rotulo ?? null,
            cobranca_suspensa: p.cobranca_suspensa?.motivo ?? null,
            tarifa_fonte: t ? `${t.fonte}${t.data ? ` (${t.data})` : t.data_desc ? ` (${t.data_desc})` : ''}` : null,
            ato: p.ato ?? null,
            cobranca: p.cobranca ?? null,
            sentido: p.sentido ?? null,
            posicao: p.precisao === 'aprox_km' ? 'aproximada (rodovia + km)' : p.posicao_metodo ?? null,
            fonte: r.source,
          },
        };
      }),
    };
  },

  async annotate(ctx, route) {
    const totalKm = route.distance_km;
    const prof = tollProfile(ctx.vehicle, ctx.at);
    prof.feriados_nacionais = await nationalHolidays(ctx.at, route.duration_s);
    const { plazas, ignored, otherWay, osmNear, officials, used } = await plazasOnLine(route.line, totalKm, prof, { at: ctx.at, duration_s: route.duration_s });

    // 2) praças oficiais coladas na rota SEM nenhum nó de pedágio do OSM por perto (lacuna do mapa): "possíveis",
    //    não somadas. Se o OSM tem cabine perto da praça e a rota não passou por ela, a rota não cruza a cabine
    //    (pista oposta, alça ou viaduto sobre a praça).
    const plazaPts = plazas.map((p) => [p.lon, p.lat] as [number, number]);
    const osmPts = osmNear.map((h) => coord(h));
    const possiveis = officials
      .filter((o) => !used.has(o.id) && o.distance_m <= POSSIBLE_M && !(o.props as Props).ponto_a_ponto && !(o.props as Props).cobranca_suspensa)
      .filter((o) => plazaPts.every((pp) => distM(pp, coord(o)) > 1000))
      .filter((o) => osmPts.every((op) => distM(op, coord(o)) > OSM_COVER_M))
      .map((o) => {
        const pr = priceFor((o.props as Props).tarifa as Tariff | null, prof, passageAt({ at: ctx.at, duration_s: route.duration_s }, o.fraction));
        const [lon, lat] = coord(o);
        return { nome: plazaLabel(o, o), km_rota: round2(o.fraction * totalKm), lat, lon, distancia_m: Math.round(o.distance_m), valor: pr?.valor ?? null, fonte: o.source, cobranca: (o.props as Props).cobranca ?? null, id: o.id };
      });

    // 3) total
    // fora do total: cobrança suspensa, ponto a ponto e situação incerta (registro oficial desativado ao lado da cabine)
    const suspended = plazas.filter((p) => p.cobranca_suspensa);
    const uncertain = plazas.filter((p) => p.registro_inativo);
    const charged = plazas.filter((p) => p.valor != null && !p.ponto_a_ponto && !p.cobranca_suspensa && !p.registro_inativo);
    const unknown = plazas.filter((p) => p.valor == null && !p.ponto_a_ponto && !p.cobranca_suspensa && !p.registro_inativo);
    const total = round2(charged.reduce((s, p) => s + (p.valor ?? 0), 0));
    const estimated = charged.filter((p) => p.estimado);

    // 4) alternativa sem pedágio (só se a rota tem cobrança)
    let alternativa: Record<string, unknown> | null = null;
    if (charged.some((p) => (p.valor ?? 0) > 0) || unknown.length) {
      try {
        // mesmas restrições da rota principal (routing.ts as passa prontas; sem elas, noTollRoute consulta de novo)
        const nt = await noTollRoute(ctx, ID, route.restrictions, avoidRings([...charged.filter((p) => (p.valor ?? 0) > 0), ...unknown], ctx));
        if (!nt) alternativa = { disponivel: false, motivo: 'sem_caminho' };
        else {
          // O `exclude_tolls` só evita o que o grafo marca como pedágio: pórtico free flow em via sem toll=yes (ex.:
          // RIOSP na BR-101, Itaguaí) fica no caminho. A alternativa é cobrada com a mesma regra da rota principal.
          const alt = await plazasOnLine(turf.lineString(nt.coordinates), nt.distance_km, prof, { at: ctx.at, duration_s: nt.duration_s });
          const altPts = alt.plazas.filter((p) => !p.ponto_a_ponto && !p.cobranca_suspensa && !p.registro_inativo && (p.valor == null || p.valor > 0));
          const altTotal = round2(altPts.reduce((sum, p) => sum + (p.valor ?? 0), 0));
          const mainPts = [...charged.filter((p) => (p.valor ?? 0) > 0), ...unknown];
          // mesma praça = mesma praça oficial (a alternativa pode cruzar outra cabine/faixa da mesma praça) ou mesmo nó
          const key = (p: PlazaOnRoute) => p.oficial_id ?? p.osm_id;
          const altIds = new Set(altPts.map(key));
          const evitados = mainPts.filter((p) => !altIds.has(key(p)));
          const economia = round2(total - altTotal);
          const base = {
            distance_km: round2(nt.distance_km),
            duration_s: Math.round(nt.duration_s),
            delta_km: round2(nt.distance_km - route.distance_km),
            delta_min: Math.round((nt.duration_s - route.duration_s) / 60),
            pedagio_na_ponta: nt.has_toll,
            restricoes_parciais: nt.falhas.length > 0,
            restricoes_com_falha: nt.falhas,
            pedagio_restante: altPts.length ? { valor: altTotal, pontos: altPts.map((p) => p.nome), sem_tarifa: altPts.filter((p) => p.valor == null).length } : null,
            metodo: `Valhalla costing_options.truck.exclude_tolls=true, mesmas restrições da rota e anel de ${AVOID_RING_M} m em volta de cada ponto de cobrança da rota (praça em via sem toll=yes no mapa); pontos de cobrança da alternativa conferidos pela geometria`,
          };
          const semGanho = altPts.length > 0 && (!evitados.length || (economia <= 0 && !evitados.some((p) => p.valor == null)));
          alternativa = semGanho
            ? { disponivel: false, motivo: evitados.length ? 'sem_economia' : 'mesmos_pontos', ...base }
            : { disponivel: true, ...base, economia: altPts.length ? economia : total, economia_parcial: unknown.length > 0 || altPts.some((p) => p.valor == null) };
        }
      } catch (e) {
        alternativa = { disponivel: false, motivo: `falha ao calcular: ${(e as Error).message}` };
      }
    }

    // 5) textos
    const summary: string[] = [];
    const warnings: LayerWarning[] = [];
    const eixosTxt = `${prof.eixos_cobrados} eixos cobrados${prof.eixos_suspensos ? ` (${prof.eixos_suspensos} suspenso${prof.eixos_suspensos > 1 ? 's' : ''})` : ''}, rodagem ${prof.rodagem}`;
    if (!plazas.length) {
      summary.push('Nenhuma praça de pedágio conhecida na rota.');
    } else {
      const n = charged.length;
      const fora = [suspended.length ? `${suspended.length} com cobrança suspensa` : '', uncertain.length ? `${uncertain.length} com situação incerta` : ''].filter(Boolean);
      summary.push(`Pedágio estimado: ${brl(total)}${unknown.length ? ' + praças sem tarifa' : ''} — ${n} ponto${n === 1 ? '' : 's'} de cobrança${fora.length ? ` (fora do total: ${fora.join(' e ')})` : ''}, ${eixosTxt}${prof.fim_de_semana ? ', fim de semana' : ''}${prof.tag ? ', com TAG' : ''}.`);
      for (const p of plazas.slice(0, 10)) {
        const val = p.cobranca_suspensa ? `cobrança suspensa desde ${fmtBr(p.cobranca_suspensa.desde)} (não somada)`
          : p.registro_inativo ? `situação incerta (não somado${p.valor_osm != null ? `; OSM: ${brl(p.valor_osm)}${p.data_osm ? ` em ${fmtBr(p.data_osm)}` : ''}` : ''})`
          : p.ponto_a_ponto ? 'ponto a ponto (não somado)' : p.valor == null ? 'tarifa não encontrada' : brl(p.valor);
        const src = p.valor != null && !p.cobranca_suspensa ? ` · ${describeSource({ fonte: p.fonte ?? '', data: p.data, data_desc: p.data_desc })}${p.estimado ? ' · estimado' : ''}` : '';
        summary.push(`• km ${Math.round(p.km_rota)}: ${p.nome}: ${val}${src}`);
      }
      if (plazas.length > 10) summary.push(`• … mais ${plazas.length - 10} ponto(s); ver dados da camada.`);
    }
    if (possiveis.length) summary.push(`${possiveis.length} praça(s) oficial(is) colada(s) na rota sem confirmação no mapa (não somadas): ${possiveis.slice(0, 3).map((p) => p.nome).join('; ')}.`);
    if (alternativa) {
      if (alternativa.disponivel) {
        const dk = alternativa.delta_km as number, dm = alternativa.delta_min as number;
        const sign = (x: number, u: string) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(u === 'km' ? 1 : 0).replace('.', ',')} ${u}`;
        const rest = alternativa.pedagio_restante as { valor: number; pontos: string[] } | null;
        const eco = alternativa.economia as number;
        summary.push(rest
          ? `Com menos pedágio: ${sign(dk, 'km')} e ${sign(dm, 'min')} para economizar ${brl(eco)}${alternativa.economia_parcial ? ' (estimado)' : ''}; a alternativa ainda passa por ${rest.pontos.length} ponto(s) de cobrança (${rest.pontos.slice(0, 2).join('; ')}).`
          : `Sem pedágio: ${sign(dk, 'km')} e ${sign(dm, 'min')} para economizar ${brl(total)}${unknown.length ? ' (ou mais)' : ''}${alternativa.pedagio_na_ponta ? '; ainda pode haver pedágio perto da origem/destino' : ''}.`);
        const falhas = (alternativa.restricoes_com_falha as string[] | undefined) ?? [];
        if (falhas.length) summary.push(`Atenção: a rota sem pedágio foi calculada sem as restrições de ${falhas.join(', ')} (falha na consulta). Confira antes de usar.`);
      } else {
        const rest = alternativa.pedagio_restante as { pontos: string[] } | null | undefined;
        summary.push(alternativa.motivo === 'sem_caminho'
          ? 'Não há rota sem pedágio para este veículo.'
          : alternativa.motivo === 'mesmos_pontos'
            ? `Rota sem pedágio não encontrada: a alternativa calculada passa pelos mesmos pontos de cobrança${rest?.pontos.length ? ` (${rest.pontos.slice(0, 2).join('; ')})` : ''}; o mapa nem sempre marca como pedágio a via da praça ou do pórtico.`
            : alternativa.motivo === 'sem_economia'
              ? `Rota sem pedágio não encontrada: a alternativa calculada passa por outros pontos de cobrança${rest?.pontos.length ? ` (${rest.pontos.slice(0, 2).join('; ')})` : ''} e não sai mais barata.`
              : `Alternativa sem pedágio indisponível agora (${alternativa.motivo}).`);
      }
    }
    if (plazas.length) {
      summary.push('Pedágio de veículo de carga é pago pelo embarcador via Vale-Pedágio (Lei 10.209/2001, art. 1º, §1º).');
      if (prof.eixos_suspensos) summary.push('Eixo suspenso só é isento com o caminhão vazio (Lei 13.103/2015, art. 17).');
    }

    if (unknown.length) {
      warnings.push({
        code: 'toll_price_unknown', severity: 'info', lat: unknown[0].lat, lon: unknown[0].lon,
        message: `Sem tarifa nas fontes importadas para ${unknown.length} ponto(s) de cobrança (${unknown.slice(0, 3).map((p) => p.nome).join('; ')}). O total não inclui esses valores; confira na concessionária.`,
      });
    }
    if (suspended.length) {
      const ex = suspended[0];
      warnings.push({
        code: 'toll_suspended', severity: 'info', lat: ex.lat, lon: ex.lon,
        message: `${suspended.length} praça(s) da rota com cobrança suspensa, fora do total (ex.: ${ex.nome}: ${ex.cobranca_suspensa!.motivo}). Confira na ANTT/DNIT se a cobrança voltou.`,
      });
    }
    if (uncertain.length) {
      const ex = uncertain[0];
      const ref = ex.valor_osm != null ? ` O OpenStreetMap indica ${brl(ex.valor_osm)}${ex.data_osm ? ` (conferido em ${fmtBr(ex.data_osm)})` : ''}, só como referência.` : '';
      warnings.push({
        code: 'toll_status_uncertain', severity: 'info', lat: ex.lat, lon: ex.lon,
        message: `Situação incerta em ${uncertain.length} ponto(s) de cobrança, fora do total (ex.: ${ex.nome}: ${ex.registro_inativo!.motivo}).${ref} Confira na concessionária se a cobrança está valendo.`,
      });
    }
    const ff = plazas.filter((p) => p.free_flow && !p.ponto_a_ponto && !p.cobranca_suspensa && !p.registro_inativo);
    if (ff.length) {
      warnings.push({
        code: 'toll_free_flow', severity: 'info', lat: ff[0].lat, lon: ff[0].lon,
        message: `A rota passa por ${ff.length} pórtico(s) free flow (sem cabine). Com TAG o débito é automático; ${freeFlowPayment(ff)}. Não pagar é evasão de pedágio, infração grave (CTB art. 209-A).`,
      });
    }
    // tabela oficial mais antiga que a conferência no OSM e com valor diferente: provável reajuste não publicado na fonte
    // OSM e tabela oficial só são comparáveis no mesmo período tarifário: tabela com janela de dia/hora (ViaLagos) cuja
    // passagem caiu em período diferente do dia de saída (o OSM só sabe "dia útil x fim de semana") fica de fora
    const diverg = charged.filter((p) => p.fonte !== 'OSM' && !p.nao_linear && !(p.com_janela && !!p.janela_alternativa !== prof.fim_de_semana)
      && p.valor_osm != null && p.data_osm && p.data
      // tolerância de R$ 0,06 por eixo: arredondamento (ex.: tabela por categoria x valor por eixo do OSM)
      && p.data_osm > p.data && Math.abs((p.valor_osm ?? 0) - (p.valor_oficial_sem_tag ?? p.valor ?? 0)) > 0.06 * prof.eixos_cobrados);
    if (diverg.length) {
      const ex = diverg[0];
      warnings.push({
        code: 'toll_tariff_divergence', severity: 'info', lat: ex.lat, lon: ex.lon,
        message: `Em ${diverg.length} praça(s) o valor conferido no OSM é mais recente que a tabela oficial e diferente dela (ex.: ${ex.nome}: ${brl(ex.valor_oficial_sem_tag ?? ex.valor)} pela ${ex.fonte} de ${fmtBr(ex.data)}, ${brl(ex.valor_osm)} no OSM em ${fmtBr(ex.data_osm)}). Pode ter havido reajuste; confirme na concessionária.`,
      });
    }
    if (estimated.length) {
      warnings.push({
        code: 'toll_estimated', severity: 'info',
        message: `Valor estimado em ${estimated.length} ponto(s) (${estimated.slice(0, 2).map((p) => `${p.nome}: ${p.observacao ?? 'regra do multiplicador'}`).join('; ')}). Confira na concessionária.`,
      });
    }

    return {
      summary,
      warnings,
      data: {
        total, moeda: 'BRL',
        veiculo: prof,
        pracas: plazas,
        possiveis,
        alternativa_sem_pedagio: alternativa,
        ignorados_osm: ignored,
        outro_sentido_osm: otherWay,
        divergencias_oficial_osm: diverg.map((p) => ({ nome: p.nome, oficial: p.valor_oficial_sem_tag ?? p.valor, fonte: p.fonte, data: p.data, osm: p.valor_osm, data_osm: p.data_osm })),
        metodo: 'nós de pedágio do OSM sobre a polilinha da rota (sentido certo) + tarifa oficial (ANTT, ARTESP, AGETRANSP, ARTEMIG, concessões municipais) da praça mais próxima; OSM charge como reserva; janela tarifária no horário estimado de passagem',
        feriados_nacionais: prof.feriados_nacionais ?? [],
      },
    };
  },
};

export default layer;
