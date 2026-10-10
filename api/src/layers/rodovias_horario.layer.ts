import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { query } from '../db.js';
import { env } from '../config.js';
import * as valhalla from '../services/valhalla.js';
import type { Vehicle } from '../services/vehicle.js';
import { featuresInBbox } from './data.js';
import type { LayerCostLine, LayerItem, LayerWarning, RouteCtx, RouteGeom, RouteLayer } from './types.js';

/**
 * Restrições de horário em rodovias (camada 'rodovias_horario').
 *
 * 1) PRF nos feriados (Portaria DIOP/PRF nº 121/2026, lida do DOU pelo importador prf_feriados): veículo que excede
 *    largura 2,60 m / altura 4,40 m / comprimento 19,80 m / PBTC 58,5 t, ou CVC com AET (art. 1º, § 1º), não circula
 *    em PISTA SIMPLES de rodovia federal nas janelas do Anexo I (§ 2º); em SP, na Operação N. Sra. Aparecida, também
 *    nos trechos de pista dupla da tabela própria (§ 5º, só para quem tem AET/AE). Trechos: SNV/DNIT (importador snv_dnit).
 * 2) Serra da Anchieta (Portaria SUP/DER-084-01/11/2023, art. 3º): CVC com AET só passa no SP-150 km 40–55 nas janelas
 *    de madrugada (seg–sex) e nunca em feriado prolongado (§ 5º).
 * 3) Descida da Imigrantes: proibida a caminhões (Portaria ARTESP 11/2002) — já está no OSM (hgv=no); nada a fazer aqui.
 *
 * Como bloqueia: se a regra vale no horário de SAÍDA e o veículo é afetado, calcula a rota livre, recorta dela os
 * pedaços que passam pelos trechos restritos (o recorte usa os vértices da própria rota, então o Valhalla consegue
 * "andar" sobre eles em linear_cost_factors) e penaliza esses pedaços (fator 1000 = proibido salvo sem alternativa).
 * Repete (até 6 rotas) enquanto a nova rota cair em outro trecho restrito.
 */

const LAYER = 'rodovias_horario';
const FACTOR = Number(process.env.RODOVIAS_HORARIO_FATOR ?? 1000);
/** distância máxima rota↔trecho do SNV (SNV × OSM: mediana ~3 m, p99 ~25 m na BR-459) */
const TOL_M = 30;
const MIN_RUN_M = 300;
const MAX_ITER = 6;
/** sobreposição mínima (km) entre o trecho da portaria e o do SNV para o trecho do SNV entrar na regra */
const MIN_OVERLAP_KM = 0.05;
const RULES_TTL_MS = 5 * 60_000;
/** Mostrar no mapa os trechos do SNV (geometria do DNIT). RODOVIAS_HORARIO_MAPA_SNV=0 tira do mapa (ver a nota de licença
 *  em docs/layers/rodovias_horario.md); a rota continua usando o SNV internamente. */
const MAPA_SNV = process.env.RODOVIAS_HORARIO_MAPA_SNV !== '0';
const DIAS = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

// ------------------------------------------------------------------------------------------- tipos
interface Limites { largura_m: number; altura_m: number; comprimento_m: number; pbtc_t: number }
interface Trecho { br: string; uf: string | null; km_ini: number; km_fim: number }
interface PrfProps {
  ato: string; ato_url: string; dou: string; operacao: string; escopo: 'pista_simples_federal' | 'trechos';
  criterio: 'art1' | 'largura'; inicio: string; fim: string; limites: Limites; infracao: string | null;
  ufs_apenas: string[] | null; ufs_excluidas: string[] | null; trechos: Trecho[] | null; so_aet: boolean;
  largura_min_m: number | null; base_legal: string; horario_na_tabela: boolean;
}
interface PrfWindow { id: string; name: string; start: DateTime; end: DateTime; p: PrfProps }
interface JanelaSemanal { dia_ini: number; hora_ini: string; dia_fim: number; hora_fim: string }
interface WeeklyProps {
  ato: string; ato_url: string; doe: string; rodovia: string; nome_via: string; km_ini: number; km_fim: number;
  pbtc_max_t: number; comprimento_max_m: number; janelas_permitidas: JanelaSemanal[]; chegada_minima: string | null;
  bloqueio_feriado_prolongado: boolean; faixa_esquerda_cvc: { ini: string; fim: string } | null; status: string;
  base_legal: Record<string, string>;
}
interface WeeklyRule { id: string; name: string; p: WeeklyProps; geometry: GeoJSON.LineString | GeoJSON.MultiLineString }
interface Rules { windows: PrfWindow[]; weekly: WeeklyRule[]; holidays: { day: string; name: string }[] }
interface SegProps {
  br: string; uf: string; codigo: string; km_ini: number; km_fim: number; sup: string; administracao: string | null;
  coinc: { br: string; codigo: string; km_ini: number; km_fim: number }[] | null;
}
interface Seg { id: string; source_id: string; name: string; kind: 'pista_simples' | 'pista_dupla'; p: SegProps; geometry: GeoJSON.LineString | GeoJSON.MultiLineString }
type Coord = [number, number];
type Run = [number, number];

/** O que vale para este veículo neste instante. */
interface State {
  /** instante de saída no fuso local */
  t: DateTime;
  /** janelas PRF que valem na saída e afetam o veículo, com os motivos */
  prfActive: { w: PrfWindow; reasons: string[] }[];
  /** janelas PRF que afetam o veículo e começam nas próximas 24 h */
  prfSoon: { w: PrfWindow; reasons: string[] }[];
  /** todas as janelas PRF publicadas que afetam o veículo (para encadear o fim do bloqueio) */
  prfAffecting: PrfWindow[];
  /** regra semanal (Anchieta) que afeta o veículo: aberta agora? próxima janela */
  weekly: { r: WeeklyRule; open: { start: DateTime; end: DateTime } | null; next: { start: DateTime; end: DateTime } | null; reasons: string[] }[];
}

interface Hit {
  key: string; label: string; item: LayerItem; runs: Run[]; kind: 'prf' | 'weekly'; seg?: Seg; segs?: Seg[]; rule?: WeeklyRule; windows?: PrfWindow[];
  /** trechos penalizados, com o sentido ('prf:<snv>:+' / ':-'); o fator do Valhalla só vale no sentido da linha */
  dirKeys?: string[];
}

// ------------------------------------------------------------------------------------------- dados
let rulesCache: { at: number; p: Promise<Rules> } | null = null;

async function loadRules(): Promise<Rules> {
  if (rulesCache && Date.now() - rulesCache.at < RULES_TTL_MS) return rulesCache.p;
  const p = (async () => {
    const [r, h] = await Promise.all([
      query<{ id: string; name: string; kind: string; props: any; geometry: any }>(
        `select id::text, name, kind, props,
                case when kind = 'regra_semanal' then ST_AsGeoJSON(geom, 6)::json end as geometry
           from data_features where layer_id = $1 and kind in ('janela', 'regra_semanal')`, [LAYER]),
      // feriados (se o calendário estiver carregado): nacionais, estaduais de SP e municipais da Baixada/ABC/capital
      query<{ day: string; name: string }>(
        `select to_char(day, 'YYYY-MM-DD') as day, name from holidays
          where day between current_date - 400 and current_date + 400
            and (scope = 'national' or (scope = 'state' and uf = 'SP')
                 or (scope = 'municipal' and ibge_code in ('3548500','3513504','3548708','3550308','3541000','3551009')))`)
        .catch(() => ({ rows: [] as { day: string; name: string }[] })),
    ]);
    const windows: PrfWindow[] = [];
    const weekly: WeeklyRule[] = [];
    for (const row of r.rows) {
      if (row.kind === 'janela') {
        windows.push({ id: row.id, name: row.name, p: row.props, start: DateTime.fromISO(row.props.inicio, { setZone: true }), end: DateTime.fromISO(row.props.fim, { setZone: true }) });
      } else if (row.props?.status !== 'revogada') {
        weekly.push({ id: row.id, name: row.name, p: row.props, geometry: row.geometry });
      }
    }
    windows.sort((a, b) => a.start.toMillis() - b.start.toMillis());
    return { windows, weekly, holidays: h.rows };
  })();
  rulesCache = { at: Date.now(), p };
  p.catch(() => { rulesCache = null; });
  return p;
}

async function segmentsNear(line: GeoJSON.LineString, radiusM: number): Promise<Seg[]> {
  const simple = line.coordinates.length > 400 ? turf.simplify(turf.lineString(line.coordinates), { tolerance: 0.0002 }).geometry : line;
  const r = await query<Seg & { props: SegProps }>(
    `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) as g)
     select f.id::text, f.source_id, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry
       from data_features f, l
      where f.layer_id = $1 and f.source = 'snv-dnit'
        and ST_DWithin(f.geom, l.g, $3 / 80000.0)`, // pré-filtro em graus (folgado); a checagem em metros é feita em runsNear
    [LAYER, JSON.stringify(simple), radiusM + 25],
  );
  return r.rows.map((x: any) => ({ id: x.id, source_id: x.source_id, name: x.name, kind: x.kind, p: x.props, geometry: x.geometry }));
}

// ------------------------------------------------------------------------------------------- regras
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const fmtDT = (d: DateTime) => `${DIAS[d.weekday]} ${d.toFormat('dd/LL HH:mm')}`;

/**
 * Combinação de veículos de carga (CVC no sentido da Res. CONTRAN 882/2021, art. 18, que exige AET da combinação acima
 * de 57 t ou de 19,80 m): cavalo com semirreboque, caminhão com reboque ou CVC. Veículo simples (truck, VUC) não é CVC,
 * mesmo com AET (ex.: carga larga). Sem classe informada, estima por comprimento > 14 m (maior veículo simples, art. 4º).
 */
export function isCombination(v: Pick<Vehicle, 'vehicle_class' | 'length_m'>): boolean {
  if (v.vehicle_class) return v.vehicle_class === 'semitrailer' || v.vehicle_class === 'truck_trailer' || v.vehicle_class === 'cvc';
  return v.length_m > 14;
}

/** Motivos pelos quais a janela PRF atinge o veículo (vazio = não atinge). Limites lidos da portaria (props.limites). */
export function prfReasons(w: PrfProps, v: Vehicle): string[] {
  if (w.criterio === 'largura') {
    return w.largura_min_m != null && v.width_m > w.largura_min_m ? [`largura ${fmt(v.width_m)} m > ${fmt(w.largura_min_m)} m`] : [];
  }
  const L = w.limites;
  const r: string[] = [];
  if (v.width_m > L.largura_m) r.push(`largura ${fmt(v.width_m)} m > ${fmt(L.largura_m)} m`);
  if (v.height_m > L.altura_m) r.push(`altura ${fmt(v.height_m)} m > ${fmt(L.altura_m)} m`);
  if (v.length_m > L.comprimento_m) r.push(`comprimento ${fmt(v.length_m)} m > ${fmt(L.comprimento_m)} m`);
  if (v.weight_t > L.pbtc_t) r.push(`PBTC ${fmt(v.weight_t)} t > ${fmt(L.pbtc_t)} t`);
  // § 1º: "abrange o trânsito de CVC, CTV e CTVP, ainda que autorizadas ... por meio de AET ou AE". Veículo simples com
  // AET e dentro dos limites do art. 1º não entra (o requires_aet hoje também sai das dimensões, em vehicle.ts).
  if (v.requires_aet && isCombination(v)) r.push('CVC com AET (art. 1º, § 1º)');
  // § 5º (tabela de SP): só quem tem AET/AE — excedente precisa de AET para rodar, então conta como portador
  return r;
}

/** CVC com AET para a Portaria SUP/DER-084/2023, art. 3º ("A CVC ... portadores de AET"): informada pelo usuário,
 *  ou exigida pela Res. CONTRAN 882/2021, art. 18. Veículo simples não entra. */
export function weeklyReasons(p: WeeklyProps, v: Vehicle): string[] {
  const r: string[] = [];
  if (!isCombination(v)) return r;
  if (v.requires_aet) r.push('CVC com AET');
  else if (v.length_m > 19.8) r.push(`comprimento ${fmt(v.length_m)} m > 19,8 m (exige AET, Res. CONTRAN 882/2021, art. 18)`);
  else if (v.weight_t > 57) r.push(`PBTC ${fmt(v.weight_t)} t > 57 t (exige AET, Res. CONTRAN 882/2021, art. 18)`);
  return r;
}

function segSubject(w: PrfProps, s: Seg): boolean {
  if (w.escopo === 'pista_simples_federal') {
    if (s.kind !== 'pista_simples') return false;
    if (w.ufs_apenas && !w.ufs_apenas.includes(s.p.uf)) return false;
    if (w.ufs_excluidas?.includes(s.p.uf)) return false;
    return true;
  }
  return !!w.trechos?.some((t) => trechoEntry(s, t));
}

/** entrada (BR/km) do trecho do SNV que cai no trecho da portaria, considerando coincidências (ex.: BR-116/459) */
function trechoEntry(s: Seg, t: Trecho): { km_ini: number; km_fim: number } | null {
  if (t.uf && s.p.uf !== t.uf) return null;
  const entries = s.p.coinc ?? [{ br: s.p.br, codigo: s.p.codigo, km_ini: s.p.km_ini, km_fim: s.p.km_fim }];
  const e = entries.find((x) => x.br === t.br && Math.min(x.km_fim, t.km_fim) - Math.max(x.km_ini, t.km_ini) >= MIN_OVERLAP_KM);
  return e ? { km_ini: e.km_ini, km_fim: e.km_fim } : null;
}

type LineGeom = GeoJSON.LineString | GeoJSON.MultiLineString;

/** Geometria do trecho sujeita à janela, ou null se a janela não pega o trecho. Para tabela por km, recorta o trecho do
 *  SNV por interpolação de km (o SNV é digitalizado no sentido do km). MultiLineString parcial fica inteira (há 1 no SNV). */
function subjectGeometry(w: PrfProps, s: Seg): LineGeom | null {
  if (w.escopo !== 'trechos') return segSubject(w, s) ? s.geometry : null;
  for (const t of w.trechos ?? []) {
    const e = trechoEntry(s, t);
    if (!e) continue;
    const span = e.km_fim - e.km_ini;
    if (span <= 0) continue;
    if (t.km_ini <= e.km_ini && t.km_fim >= e.km_fim) return s.geometry;
    if (s.geometry.type !== 'LineString') return s.geometry;
    const line = turf.lineString(s.geometry.coordinates);
    const len = turf.length(line, { units: 'kilometers' });
    const a = Math.max(0, (t.km_ini - e.km_ini) / span) * len;
    const b = Math.min(1, (t.km_fim - e.km_ini) / span) * len;
    if (b - a < MIN_OVERLAP_KM) continue;
    return turf.lineSliceAlong(line, a, b, { units: 'kilometers' }).geometry;
  }
  return null;
}

/** Parte do trecho sujeita a qualquer das janelas (junta os recortes), ou null. */
function subjectOfAny(ws: PrfProps[], s: Seg): LineGeom | null {
  const gs = ws.map((w) => subjectGeometry(w, s)).filter((g): g is LineGeom => !!g);
  if (!gs.length) return null;
  if (gs.includes(s.geometry)) return s.geometry;
  if (gs.length === 1) return gs[0];
  return { type: 'MultiLineString', coordinates: gs.flatMap((g) => (g.type === 'LineString' ? [g.coordinates] : g.coordinates)) };
}

function activeAt(w: PrfWindow, t: DateTime) { return w.start <= t && t < w.end; }

/** Fim do bloqueio: encadeia janelas que se sobrepõem/encostam a partir de t. */
function releaseTime(ws: PrfWindow[], t: DateTime): DateTime {
  let end = t;
  for (let changed = true; changed;) {
    changed = false;
    for (const w of ws) if (w.start <= end && w.end > end) { end = w.end; changed = true; }
  }
  return end;
}

/** "em pista simples de rodovia federal" / "na BR-116/SP km 0–195 (inclusive pista dupla; só para quem tem AET/AE)" */
function escopoText(ws: PrfWindow[]): string {
  const parts: string[] = [];
  if (ws.some((w) => w.p.escopo === 'pista_simples_federal')) parts.push('em pista simples de rodovia federal');
  const tr = ws.filter((w) => w.p.escopo === 'trechos');
  if (tr.length) {
    const ts = [...new Set(tr.flatMap((w) => (w.p.trechos ?? []).map((x) => `BR-${x.br}${x.uf ? `/${x.uf}` : ''} km ${fmt(x.km_ini)}–${fmt(x.km_fim)}`)))];
    parts.push(`na ${ts.join(', ')} (inclusive pista dupla${tr.some((w) => w.p.so_aet) ? '; só para quem tem AET/AE' : ''})`);
  }
  return parts.join(' e ');
}

/** A quem a janela se aplica (texto curto para o mapa). */
function quemText(p: PrfProps): string {
  if (p.criterio === 'largura') return `largura acima de ${fmt(p.largura_min_m ?? 0)} m (com AET/AE)`;
  const L = p.limites;
  const base = `excedentes (largura > ${fmt(L.largura_m)} m, altura > ${fmt(L.altura_m)} m, comprimento > ${fmt(L.comprimento_m)} m ou PBTC > ${fmt(L.pbtc_t)} t) e CVC com AET`;
  return p.so_aet ? `${base}, só para quem tem AET/AE` : base;
}

/** Domingo de Páscoa no calendário gregoriano (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return { month: Math.floor(n / 31), day: (n % 31) + 1 };
}

type Period = { start: DateTime; end: DateTime; name: string };
/** gap máximo entre janelas da mesma operação PRF para formar um só feriado (Carnaval e Corpus Christi: 3,17 d entre
 *  a ida e a volta; Natal → Réveillon: 3,75 d, ficam separados) */
const MAX_GAP_DAYS = 3.5;

/**
 * Períodos de feriado prolongado do art. 3º, § 5º da SUP/DER-084-01/11/2023: "feriados prolongados, municipal, estadual
 * ou federal, que envolvam os dias de quinta-feira até a terça-feira da semana subsequente, em especial o Carnaval,
 * Semana Santa, Natal e Ano Novo". União de três fontes:
 *  a) operações de feriado da PRF (mesmo ato federal, sem Eleições): do dia da primeira ao da última janela da operação.
 *     Quarta-feira na ponta (véspera à tarde, ou volta de manhã como na Quarta de Cinzas) sai, porque o § 5º vai de
 *     quinta a terça; fica se a quarta for o próprio feriado.
 *  b) Carnaval (sexta → terça de Carnaval) e Semana Santa (quinta → domingo de Páscoa), calculados pela Páscoa. Valem
 *     mesmo sem a portaria da PRF do ano no banco.
 *  c) feriados da tabela holidays e Natal/Ano Novo (25/12 e 01/01, por data): qui → dom, sex (com a quinta) → dom,
 *     sáb → seg, sáb → ter (com a ponte de segunda); Natal/Ano Novo em outro dia bloqueiam o próprio dia.
 */
export function longHolidayPeriods(rules: Pick<Rules, 'windows' | 'holidays'>, tz: string, t: DateTime): Period[] {
  const out: Period[] = [];
  const holidayDays = new Set(rules.holidays.map((h) => h.day));
  const isHoliday = (d: DateTime) => holidayDays.has(d.toISODate()!) || ['12-25', '01-01'].includes(d.toFormat('LL-dd'));

  // a) operações da PRF
  const byOp = new Map<string, PrfWindow[]>();
  for (const w of rules.windows) {
    if (w.p.escopo !== 'pista_simples_federal' || /elei/i.test(w.p.operacao) || w.p.ufs_apenas) continue;
    byOp.set(w.p.operacao, [...(byOp.get(w.p.operacao) ?? []), w]);
  }
  for (const [name, list] of byOp) {
    const ws = [...list].sort((x, y) => x.start.toMillis() - y.start.toMillis());
    let cur: PrfWindow[] = [];
    const flush = () => {
      if (!cur.length) return;
      let a = cur[0].start.setZone(tz).startOf('day');
      let b = cur[cur.length - 1].end.setZone(tz).startOf('day');
      if (b > a && b.weekday === 3 && !isHoliday(b)) b = b.minus({ days: 1 });
      if (b > a && a.weekday === 3 && !isHoliday(a)) a = a.plus({ days: 1 });
      out.push({ start: a, end: b.endOf('day'), name });
      cur = [];
    };
    for (const w of ws) {
      // a mesma operação pode se repetir (Fim de Ano = Natal + Réveillon): janelas a mais de 3,5 dias abrem outro período
      if (cur.length && w.start.diff(cur[cur.length - 1].end, 'days').days > MAX_GAP_DAYS) flush();
      cur.push(w);
    }
    flush();
  }

  // b) Carnaval e Semana Santa pela Páscoa
  const years = [t.year - 1, t.year, t.year + 1];
  for (const y of years) {
    const e = DateTime.fromObject({ year: y, ...easterSunday(y) }, { zone: tz });
    out.push({ start: e.minus({ days: 51 }).startOf('day'), end: e.minus({ days: 47 }).endOf('day'), name: 'Carnaval' });
    out.push({ start: e.minus({ days: 3 }).startOf('day'), end: e.endOf('day'), name: 'Semana Santa' });
  }

  // c) feriados com fim de semana ligado
  const days = [...rules.holidays, ...years.flatMap((y) => [{ day: `${y}-12-25`, name: 'Natal' }, { day: `${y}-01-01`, name: 'Ano Novo' }])];
  for (const h of days) {
    const d = DateTime.fromISO(h.day, { zone: tz });
    const wd = d.weekday; // 1=seg
    let a: DateTime | null = null; let b: DateTime | null = null;
    if (wd === 4) { a = d; b = d.plus({ days: 3 }); }                         // qui → dom
    else if (wd === 5) { a = d.minus({ days: 1 }); b = d.plus({ days: 2 }); } // qui (ponte) → dom
    else if (wd === 1) { a = d.minus({ days: 2 }); b = d; }                   // sáb → seg
    else if (wd === 2) { a = d.minus({ days: 3 }); b = d; }                   // sáb → ter (com a ponte de segunda)
    else if (/^(Natal|Ano Novo)$/.test(h.name)) { a = d; b = d; }             // "em especial ... Natal e Ano Novo"
    if (a && b) out.push({ start: a.startOf('day'), end: b.endOf('day'), name: h.name });
  }
  return out;
}

/** Janela semanal aberta em t, e a próxima permitida (pula as de feriado prolongado). */
function weeklyWindows(r: WeeklyRule, t: DateTime, blocked: { start: DateTime; end: DateTime; name: string }[]) {
  const inst: { start: DateTime; end: DateTime; blockedBy?: string }[] = [];
  const base = t.startOf('week'); // segunda 00:00 (luxon: semana ISO)
  for (let wk = -1; wk <= 3; wk++) {
    for (const j of r.p.janelas_permitidas) {
      const [h0, m0] = j.hora_ini.split(':').map(Number);
      const [h1, m1] = j.hora_fim.split(':').map(Number);
      const start = base.plus({ weeks: wk, days: j.dia_ini - 1 }).set({ hour: h0, minute: m0 });
      const end = base.plus({ weeks: wk, days: j.dia_fim - 1 }).set({ hour: h1, minute: m1 });
      const b = r.p.bloqueio_feriado_prolongado ? blocked.find((p) => start < p.end && end > p.start) : undefined;
      inst.push({ start, end, blockedBy: b?.name });
    }
  }
  inst.sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const open = inst.find((i) => !i.blockedBy && i.start <= t && t < i.end) ?? null;
  const next = inst.find((i) => !i.blockedBy && i.start > t) ?? null;
  const skipped = inst.filter((i) => i.blockedBy && i.end > t && (!next || i.start < next.start));
  return { open, next, skipped };
}

async function computeState(ctx: RouteCtx): Promise<State & { rules: Rules }> {
  const rules = await loadRules();
  const t = DateTime.fromJSDate(ctx.at).setZone(ctx.tz);
  const v = ctx.vehicle;
  const prfActive: State['prfActive'] = [];
  const prfSoon: State['prfSoon'] = [];
  const prfAffecting: PrfWindow[] = [];
  for (const w of rules.windows) {
    const reasons = prfReasons(w.p, v);
    if (!reasons.length) continue;
    if (w.end > t) prfAffecting.push(w);
    if (w.end <= t || w.start > t.plus({ hours: 24 })) continue;
    (activeAt(w, t) ? prfActive : prfSoon).push({ w, reasons });
  }
  const blocked = longHolidayPeriods(rules, ctx.tz, t);
  const weekly: State['weekly'] = [];
  for (const r of rules.weekly) {
    const reasons = weeklyReasons(r.p, v);
    if (!reasons.length) continue;
    const { open, next } = weeklyWindows(r, t, blocked);
    weekly.push({ r, open, next, reasons });
  }
  return { t, prfActive, prfSoon, prfAffecting, weekly, rules };
}

// ------------------------------------------------------------------------------------------- geometria rota × trecho
/** Índice em grade de uma (multi)linha, em metros (projeção equirretangular local): distância ponto→linha rápida. */
class LineIndex {
  private readonly lat0: number; private readonly kx: number; private readonly ky = 110_540;
  private readonly cell: number; private readonly grid = new Map<string, number[]>();
  private readonly segs: number[] = []; // x0,y0,x1,y1 em sequência
  readonly bbox: [number, number, number, number];
  constructor(g: GeoJSON.LineString | GeoJSON.MultiLineString, cellM = 150) {
    this.bbox = turf.bbox(g) as [number, number, number, number];
    this.lat0 = (this.bbox[1] + this.bbox[3]) / 2;
    this.kx = 111_320 * Math.cos((this.lat0 * Math.PI) / 180);
    this.cell = cellM;
    const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    for (const part of parts) {
      for (let i = 1; i < part.length; i++) {
        const [x0, y0] = this.xy(part[i - 1] as Coord); const [x1, y1] = this.xy(part[i] as Coord);
        const id = this.segs.length / 4;
        this.segs.push(x0, y0, x1, y1);
        const cx0 = Math.floor(Math.min(x0, x1) / cellM), cx1 = Math.floor(Math.max(x0, x1) / cellM);
        const cy0 = Math.floor(Math.min(y0, y1) / cellM), cy1 = Math.floor(Math.max(y0, y1) / cellM);
        for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
          const k = `${cx}:${cy}`; const a = this.grid.get(k); if (a) a.push(id); else this.grid.set(k, [id]);
        }
      }
    }
  }
  private xy(c: Coord): [number, number] { return [c[0] * this.kx, c[1] * this.ky]; }
  /** distância em metros até a linha, ou Infinity se passar de maxM */
  dist(c: Coord, maxM: number): number {
    const [px, py] = this.xy(c);
    const r = Math.ceil(maxM / this.cell);
    const cx = Math.floor(px / this.cell), cy = Math.floor(py / this.cell);
    let best = Infinity; const seen = new Set<number>();
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const ids = this.grid.get(`${cx + dx}:${cy + dy}`);
      if (!ids) continue;
      for (const id of ids) {
        if (seen.has(id)) continue; seen.add(id);
        const x0 = this.segs[4 * id], y0 = this.segs[4 * id + 1], x1 = this.segs[4 * id + 2], y1 = this.segs[4 * id + 3];
        const vx = x1 - x0, vy = y1 - y0; const l2 = vx * vx + vy * vy;
        const tt = l2 ? Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / l2)) : 0;
        const d = Math.hypot(px - (x0 + tt * vx), py - (y0 + tt * vy));
        if (d < best) best = d;
      }
    }
    return best <= maxM ? best : Infinity;
  }
}
const indexCache = new WeakMap<object, LineIndex>();
function indexOf(g: GeoJSON.LineString | GeoJSON.MultiLineString): LineIndex {
  let ix = indexCache.get(g);
  if (!ix) { ix = new LineIndex(g); indexCache.set(g, ix); }
  return ix;
}

/** Sequências de vértices da rota a até tolM da geometria (tolerando até 2 vértices a até 3×tol), com comprimento
 *  mínimo; sequências separadas por menos de 500 m de rota são unidas. */
export function runsNear(coords: Coord[], g: GeoJSON.LineString | GeoJSON.MultiLineString, tolM = TOL_M, minRunM = MIN_RUN_M): Run[] {
  const ix = indexOf(g);
  const [x0, y0, x1, y1] = ix.bbox;
  const pad = (3 * tolM) / 90000;
  const near: (0 | 1 | 2)[] = coords.map((c) => {
    if (c[0] < x0 - pad * 1.2 || c[0] > x1 + pad * 1.2 || c[1] < y0 - pad || c[1] > y1 + pad) return 0;
    const d = ix.dist(c, 3 * tolM);
    return d <= tolM ? 2 : d <= 3 * tolM ? 1 : 0;
  });
  let runs: Run[] = [];
  let i = 0;
  while (i < coords.length) {
    if (near[i] !== 2) { i++; continue; }
    let j = i;
    while (j + 1 < coords.length) {
      if (near[j + 1] === 2) { j++; continue; }
      let k = j + 1; let gap = 0;
      while (k < coords.length && near[k] === 1 && gap < 2) { k++; gap++; }
      if (k < coords.length && near[k] === 2 && gap > 0) { j = k; continue; }
      break;
    }
    runs.push([i, j]);
    i = j + 1;
  }
  const lenM = (a: number, b: number) => turf.length(turf.lineString(coords.slice(a, b + 1)), { units: 'kilometers' }) * 1000;
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && lenM(last[1], r[0]) < 500) last[1] = r[1]; else merged.push([r[0], r[1]]);
  }
  runs = merged;
  const segLenM = turf.length(turf.feature(g) as any, { units: 'kilometers' }) * 1000;
  const minLen = Math.min(minRunM, 0.5 * segLenM);
  return runs.filter(([a, b]) => b > a && lenM(a, b) >= minLen);
}

function segLabel(s: Seg): string {
  const tipo = s.kind === 'pista_simples' ? 'pista simples' : 'pista dupla';
  return `${s.name} (${tipo})`;
}

function midOf(coords: Coord[], run: Run): { lat: number; lon: number } {
  const c = coords[Math.floor((run[0] + run[1]) / 2)];
  return { lon: c[0], lat: c[1] };
}

/** Pedaços da rota que passam por trechos restritos AGORA para este veículo. */
async function restrictedHits(coords: Coord[], st: State): Promise<Hit[]> {
  const hits: Hit[] = [];
  if (st.prfActive.length) {
    const segs = await segmentsNear({ type: 'LineString', coordinates: coords }, TOL_M);
    for (const s of segs) {
      const ws = st.prfActive.filter((a) => segSubject(a.w.p, s));
      if (!ws.length) continue;
      const g = subjectOfAny(ws.map((a) => a.w.p), s);
      if (!g) continue;
      const runs = runsNear(coords, g);
      if (!runs.length) continue;
      const until = releaseTime(st.prfAffecting.filter((w) => segSubject(w.p, s)), st.t);
      const label = segLabel(s);
      hits.push({
        key: `prf:${s.source_id}`, label, kind: 'prf', seg: s, runs, windows: ws.map((a) => a.w),
        item: { kind: 'layer', layer: LAYER, id: `prf:${s.source_id}`, name: label, type: 'restrição de horário',
          rule: `restrição PRF de feriado até ${fmtDT(until)}`, note: ws[0].w.p.ato, ...midOf(coords, runs[0]) },
      });
    }
  }
  return [...mergeAdjacent(hits.filter((h) => h.kind === 'prf'), coords, st), ...weeklyHits(coords, st)];
}

/** Une pedaços de trechos vizinhos do SNV (ex.: BR-459 km 0–16,5 e 16,5–32,2) numa só linha penalizada. */
function mergeAdjacent(hits: Hit[], coords: Coord[], st: State): Hit[] {
  type P = { h: Hit; run: Run };
  const pieces: P[] = hits.flatMap((h) => h.runs.map((run) => ({ h, run }))).sort((a, b) => a.run[0] - b.run[0]);
  const groups: P[][] = [];
  for (const p of pieces) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    const gapKm = last ? (p.run[0] <= last.run[1] ? 0 : turf.length(turf.lineString(coords.slice(last.run[1], p.run[0] + 1)), { units: 'kilometers' })) : Infinity;
    if (g && gapKm < 0.5) g.push(p); else groups.push([p]);
  }
  return groups.map((g) => {
    const segs = [...new Map(g.map((p) => [p.h.seg!.source_id, p.h.seg!])).values()];
    const run: Run = [Math.min(...g.map((p) => p.run[0])), Math.max(...g.map((p) => p.run[1]))];
    const ws = [...new Map(g.flatMap((p) => p.h.windows ?? []).map((w) => [w.id, w])).values()];
    const label = groupLabel(segs);
    const until = segs.map((s) => releaseTime(st.prfAffecting.filter((w) => segSubject(w.p, s)), st.t))
      .reduce((m, d) => (d > m ? d : m));
    const id = `prf:${segs.map((s) => s.source_id).join('+')}`;
    return {
      key: id, label, kind: 'prf' as const, seg: segs[0], segs, runs: [run], windows: ws,
      item: { kind: 'layer' as const, layer: LAYER, id, name: label, type: 'restrição de horário',
        rule: `restrição PRF de feriado até ${fmtDT(until)}`, note: ws[0]?.p.ato ?? null, ...midOf(coords, run) },
    };
  });
}

/** "BR-459/SP km 0,0–32,2 (pista simples)" quando os trechos são da mesma BR/UF; senão, junta os nomes. */
function groupLabel(segs: Seg[]): string {
  if (segs.length === 1) return segLabel(segs[0]);
  const same = segs.every((s) => s.p.br === segs[0].p.br && s.p.uf === segs[0].p.uf && s.kind === segs[0].kind);
  if (!same) return segs.map(segLabel).join(' + ');
  const k0 = Math.min(...segs.map((s) => s.p.km_ini)); const k1 = Math.max(...segs.map((s) => s.p.km_fim));
  const brs = segs[0].name.match(/^BR-[\d/]+\/[A-Z]{2}/)?.[0] ?? `BR-${segs[0].p.br}/${segs[0].p.uf}`;
  return `${brs} km ${k0.toFixed(1).replace('.', ',')}–${k1.toFixed(1).replace('.', ',')} (${segs[0].kind === 'pista_simples' ? 'pista simples' : 'pista dupla'})`;
}

/** "BR-488/SP km 0,0–1,4 e 2,3–4,3, BR-116/SP km 110,4–117,4": trechos do SNV agrupados por BR/UF, km contíguos unidos. */
function kmRanges(segs: Seg[]): string {
  const byRoad = new Map<string, [number, number][]>();
  for (const s of new Map(segs.map((x) => [x.source_id, x])).values()) {
    const road = s.name.match(/^BR-[\d/]+\/[A-Z]{2}/)?.[0] ?? `BR-${s.p.br}/${s.p.uf}`;
    byRoad.set(road, [...(byRoad.get(road) ?? []), [s.p.km_ini, s.p.km_fim]]);
  }
  const k = (n: number) => n.toFixed(1).replace('.', ',');
  const parts: string[] = [];
  for (const [road, rs] of byRoad) {
    rs.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of rs) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 0.05) last[1] = Math.max(last[1], r[1]); else merged.push([r[0], r[1]]);
    }
    parts.push(`${road} km ${merged.map(([a, b]) => `${k(a)}–${k(b)}`).join(' e ')}`);
  }
  return `${parts.slice(0, 4).join(', ')}${parts.length > 4 ? ` e mais ${parts.length - 4}` : ''}`;
}

/** Pedaços da rota no trecho da regra semanal: a serra não tem saídas no meio, então une sequências separadas por
 *  menos de 3 km e exige ao menos 1,5 km (evita falso positivo de quem só encosta no fim do trecho, ex.: Cubatão). */
function weeklyRuns(coords: Coord[], g: GeoJSON.LineString | GeoJSON.MultiLineString): Run[] {
  const runs = runsNear(coords, g, 40, 300);
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && turf.length(turf.lineString(coords.slice(last[1], r[0] + 1)), { units: 'kilometers' }) < 3) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter(([a, b]) => turf.length(turf.lineString(coords.slice(a, b + 1)), { units: 'kilometers' }) >= 1.5);
}

function weeklyHits(coords: Coord[], st: State): Hit[] {
  const hits: Hit[] = [];
  for (const wk of st.weekly) {
    if (wk.open) continue;
    const runs = weeklyRuns(coords, wk.r.geometry);
    if (!runs.length) continue;
    const label = `${wk.r.p.rodovia} ${wk.r.p.nome_via} km ${fmt(wk.r.p.km_ini)}–${fmt(wk.r.p.km_fim)}`;
    hits.push({
      key: `der:${wk.r.id}`, label, kind: 'weekly', rule: wk.r, runs,
      item: { kind: 'layer', layer: LAYER, id: `der:${wk.r.id}`, name: label, type: 'restrição de horário',
        rule: `CVC com AET só de madrugada${wk.next ? `; próxima janela ${fmtDT(wk.next.start)}` : ''}`, note: wk.r.p.ato, ...midOf(coords, runs[0]) },
    });
  }
  return hits;
}

/**
 * Sentido em que o pedaço `run` da rota percorre o trecho do SNV: '+' no sentido da digitalização (no SNV, o do km),
 * '-' no contrário. Compara a posição, ao longo do trecho, do primeiro e do último ponto do pedaço que estão no trecho.
 */
function dirOn(s: Seg, coords: Coord[], run: Run): '+' | '-' {
  const ix = indexOf(s.geometry);
  let i0 = -1, i1 = -1;
  for (let i = run[0]; i <= run[1]; i++) {
    if (ix.dist(coords[i], TOL_M) <= TOL_M) { if (i0 < 0) i0 = i; i1 = i; }
  }
  if (i0 < 0 || i1 <= i0) return '+';
  const f = turf.feature(s.geometry) as GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
  const a = turf.nearestPointOnLine(f, coords[i0]).properties.location ?? 0;
  const b = turf.nearestPointOnLine(f, coords[i1]).properties.location ?? 0;
  return b >= a ? '+' : '-';
}

/** Chaves trecho+sentido de um pedaço restrito da rota (um pedaço pode juntar trechos vizinhos do SNV). */
function dirKeysOf(h: Hit, coords: Coord[]): string[] {
  if (h.kind !== 'prf') return [h.key];
  return (h.segs ?? [h.seg!]).flatMap((s) => h.runs.map((run) => `prf:${s.source_id}:${dirOn(s, coords, run)}`));
}

// ------------------------------------------------------------------------------------------- estado por rota
interface Stash { lines: LayerCostLine[]; hits: Hit[]; state: State & { rules: Rules } }
const stash = new WeakMap<RouteCtx, Stash>();

async function prepare(ctx: RouteCtx): Promise<Stash> {
  const cached = stash.get(ctx);
  if (cached) return cached;
  const state = await computeState(ctx);
  const out: Stash = { lines: [], hits: [], state };
  stash.set(ctx, out);
  if (!state.prfActive.length && !state.weekly.some((w) => !w.open)) return out;
  const base = { origin: ctx.origin, destination: ctx.destination, vehicle: ctx.vehicle, departureLocal: ctx.departureLocal };
  let r: valhalla.ValhallaRouteResult;
  try { r = await valhalla.route(base); } catch { return out; }
  const seen = new Set<string>();
  const ids = new Set<string>();
  // cada rodada procura trechos restritos na rota atual, penaliza os novos e refaz a rota; para quando a rota não cai em
  // trecho novo. A última rodada (MAX_ITER) penaliza sem refazer: quem sobrar na rota final sai como "desvio não testado".
  // "Novo" é trecho + SENTIDO: o fator do linear_cost_factors só vale no sentido da linha, e um desvio que entra no mesmo
  // trecho pela outra ponta (ou pela outra pista) não paga nada (ex.: destino na BR-488, rota chegando pelo outro lado).
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const found = (await restrictedHits(r.coordinates, state)).map((h) => ({ ...h, dirKeys: dirKeysOf(h, r.coordinates) }));
    const fresh = found.filter((h) => h.dirKeys.some((k) => !seen.has(k)));
    if (!fresh.length) break;
    for (const h of fresh) {
      h.dirKeys.forEach((k) => seen.add(k));
      if (ids.has(h.item.id)) {
        // mesmo trecho em outro sentido ou noutro pedaço da rota: id próprio, para o routing.ts e o annotate não
        // confundirem as linhas
        let n = 2;
        while (ids.has(`${h.item.id}~${n}`)) n++;
        h.key += `~${n}`; h.item = { ...h.item, id: `${h.item.id}~${n}` };
      }
      ids.add(h.item.id);
      out.hits.push(h);
      h.runs.forEach((run, k) => out.lines.push({
        item: { ...h.item, id: k ? `${h.item.id}#${k + 1}` : h.item.id, ...midOf(r.coordinates, run) },
        coordinates: r.coordinates.slice(run[0], run[1] + 1),
        factor: FACTOR,
      }));
    }
    if (iter === MAX_ITER - 1) break;
    try {
      r = await valhalla.route({ ...base, costLines: out.lines.map((c) => ({ coordinates: c.coordinates, factor: c.factor })) });
    } catch { break; }
  }
  return out;
}

/**
 * O routing.ts já emite 'uses_restricted_way' (danger) para cada costLine que a rota final usa. Serve para não repetir
 * o mesmo danger: a camada então só complementa com o horário e a norma. O critério é cópia do usesCostLine do
 * routing.ts (que não é exportado), sensível ao sentido: ≥ 50% das amostras da linha a até 15 m da rota e, delas,
 * ≥ 50% com rumo a menos de 90° do rumo da rota; só quando a rota livre foi calculada. Se o routing.ts mudar o
 * critério, mude aqui também.
 */
function usesCostLineLikeRouting(route: GeoJSON.Feature<GeoJSON.LineString>, coords: Coord[]): boolean {
  if (coords.length < 2) {
    if (!coords.length) return false;
    return turf.pointToLineDistance(turf.point(coords[0]), route, { units: 'meters' }) <= 15;
  }
  const rc = route.geometry.coordinates;
  const step = Math.max(1, Math.ceil((coords.length - 1) / 30));
  let near = 0, same = 0, total = 0;
  for (let i = 0; i < coords.length - 1; i += step) {
    total++;
    const a = coords[i], b = coords[i + 1];
    const np = turf.nearestPointOnLine(route, turf.point([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), { units: 'meters' });
    if ((np.properties.dist ?? Infinity) > 15) continue;
    near++;
    const idx = Math.min(np.properties.index ?? 0, rc.length - 2);
    const bl = turf.bearing(turf.point(a), turf.point(b));
    const br = turf.bearing(turf.point(rc[idx] as Coord), turf.point(rc[idx + 1] as Coord));
    if (Math.abs(((bl - br + 540) % 360) - 180) < 90) same++;
  }
  if (!total || near / total < 0.5) return false;
  return same / near >= 0.5;
}

function routingWarns(route: RouteGeom, lines: LayerCostLine[], h: Hit): boolean {
  if (!route.free) return false;
  return lines.some((cl) => (cl.item.id === h.item.id || cl.item.id.startsWith(`${h.item.id}#`))
    && usesCostLineLikeRouting(route.line, cl.coordinates as Coord[]));
}

// ------------------------------------------------------------------------------------------- ETA ao longo da rota
function cumulativeKm(coords: Coord[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + turf.distance(coords[i - 1], coords[i], { units: 'kilometers' }));
  return out;
}

// ------------------------------------------------------------------------------------------- camada
const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Restrições de horário em rodovias',
    description: 'Feriados da PRF (excedentes e CVC com AET em pista simples federal) e janelas de CVC com AET na serra da Anchieta.',
    group: 'restricoes',
    sources: [
      { name: 'PRF — Portaria DIOP/PRF nº 121/2026 (DOU)', url: 'https://www.in.gov.br/web/dou/-/portaria-diop/prf-n-121-de-8-de-setembro-de-2026-730790480', license: 'Ato oficial — domínio público (Lei 9.610/98, art. 8º, IV)' },
      { name: 'DNIT — SNV 202607A (bases geométricas), trechos federais simplificados', url: 'https://servicos.dnit.gov.br/dnitcloud/index.php/s/oTpPRmYs5AAdiNr', license: 'Dados abertos do Poder Executivo federal, livre utilização (Decreto 8.777/2016, art. 4º, red. Decreto 9.903/2019); sem licença nomeada no arquivo; ver docs/layers/rodovias_horario.md' },
      { name: 'DER-SP — Portaria SUP/DER-084-01/11/2023 (DOE-SP)', url: 'https://doe.sp.gov.br/executivo/secretaria-de-meio-ambiente-infraestrutura-e-logistica/portaria-sup-084-arp-katia-8344367', license: 'Ato oficial — domínio público (Lei 9.610/98, art. 8º, IV)' },
      { name: 'ARTESP — marcos quilométricos (Camadas Geoespaciais Auxiliares do dataset Programação de Obras)', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/programacao-de-obras', license: 'CC BY (ARTESP)' },
      { name: 'OpenStreetMap (geometria da serra da Anchieta, casada pelo Valhalla)', url: 'https://www.openstreetmap.org/copyright', license: '© OpenStreetMap contributors (ODbL 1.0)' },
    ],
    style: { kind: 'line', color: '#ea580c', width: 3, minzoom: 6, icon: '⏰', opacity: 0.8 },
    defaultVisible: false,
  },

  async costLines(ctx) {
    return (await prepare(ctx)).lines;
  },

  async annotate(ctx, route) {
    const { state, hits, lines } = await prepare(ctx);
    const t = DateTime.fromJSDate(ctx.at).setZone(ctx.tz);
    const coords = route.line.geometry.coordinates as Coord[];
    const warnings: LayerWarning[] = [];
    const summary: string[] = [];
    const cum = cumulativeKm(coords);
    const total = cum[cum.length - 1] || 1;
    const etaAt = (i: number) => t.plus({ seconds: (cum[i] / total) * route.duration_s });

    // trechos do SNV na rota final (para avisos de janela futura e para listar)
    const relevantPrf = [...state.prfActive, ...state.prfSoon];
    const segsOnRoute = relevantPrf.length ? await segmentsNear(route.line.geometry, TOL_M) : [];
    const onRoute = segsOnRoute
      .map((s) => ({ s, runs: runsNear(coords, s.geometry) }))
      .filter((x) => x.runs.length);

    // ---- 1) PRF em vigor na saída
    if (state.prfActive.length) {
      const activeP = state.prfActive.map((a) => a.w.p);
      const stillOn = onRoute
        .map((x) => { const g = subjectOfAny(activeP, x.s); return { s: x.s, runs: g ? runsNear(coords, g) : [] }; })
        .filter((x) => x.runs.length);
      const prfHits = hits.filter((h) => h.kind === 'prf');
      // um trecho pode estar em mais de um pedaço penalizado (rodadas diferentes juntam vizinhos diferentes); conta só o
      // pedaço penalizado NO SENTIDO em que a rota final passa (o fator do Valhalla não vale no sentido contrário)
      const hitsOf = (x: { s: Seg; runs: Run[] }) => {
        const keys = new Set(x.runs.map((run) => `prf:${x.s.source_id}:${dirOn(x.s, coords, run)}`));
        return prfHits.filter((h) => h.dirKeys?.some((k) => keys.has(k)));
      };
      // na rota final: (a) penalizado e já avisado pelo routing.ts; (b) penalizado sem aviso do routing.ts; (c) nunca
      // penalizado nesse sentido (a rota final mudou por outras camadas/zonas, ou passou do limite de rodadas): desvio
      // não testado
      const pen = new Map(stillOn.map((x) => [x, hitsOf(x)] as const));
      const viaRouting = stillOn.filter((x) => pen.get(x)!.some((h) => routingWarns(route, lines, h)));
      const semAlternativa = stillOn.filter((x) => !viaRouting.includes(x) && pen.get(x)!.length);
      const naoTestado = stillOn.filter((x) => !pen.get(x)!.length);
      const touchedSegs = [...stillOn.map((x) => x.s), ...prfHits.flatMap((h) => h.segs ?? [h.seg!])];
      // janelas que importam para esta rota (as que pegam os trechos tocados); sem trecho tocado, todas as ativas
      const rel = touchedSegs.length ? state.prfActive.filter((a) => touchedSegs.some((sg) => segSubject(a.w.p, sg))) : state.prfActive;
      const reasons = [...new Set(rel.flatMap((a) => a.reasons))];
      const ops = [...new Set(rel.map((a) => a.w.p.operacao))].join(', ');
      const ato = rel[0].w.p.ato;
      const untilFor = (sg: Seg) => releaseTime(state.prfAffecting.filter((w) => segSubject(w.p, sg)), t);
      const release = touchedSegs.map(untilFor).reduce<DateTime | null>((m, d) => (!m || d > m ? d : m), null)
        ?? rel.map((a) => releaseTime(state.prfAffecting.filter((w) => w.p.escopo === a.w.p.escopo), t)).reduce((m, d) => (d > m ? d : m));
      const escopo = escopoText(rel.map((a) => a.w));
      const lista = (names: string[]) => `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` e mais ${names.length - 4}` : ''}`;
      const nomes = (xs: { s: Seg }[]) => kmRanges(xs.map((x) => x.s));
      const regra = `${reasons.join('; ')} — proibido ${escopo} até ${fmtDT(release)}`;
      const saida = `espere até ${fmtDT(release)} ou escolha outro caminho (${ato}; infração do CTB, art. 187, I).`;
      if (semAlternativa.length || naoTestado.length) {
        const partes: string[] = [];
        if (semAlternativa.length) partes.push(`${nomes(semAlternativa)}, sem alternativa razoável`);
        if (naoTestado.length) partes.push(`${nomes(naoTestado)}, trecho restrito cujo desvio não foi testado`);
        warnings.push({
          code: 'prf_feriado_na_rota', severity: 'danger', ...midOf(coords, (semAlternativa[0] ?? naoTestado[0]).runs[0]),
          message: `Restrição da PRF em vigor (${ops}): ${regra}. A rota passa por ${partes.join(', e por ')}: ${saida}`,
        });
      }
      if (viaRouting.length) {
        // o danger já saiu do routing.ts ('uses_restricted_way'); aqui só o detalhe da regra
        warnings.push({
          code: 'prf_feriado_sem_alternativa', severity: 'info', ...midOf(coords, viaRouting[0].runs[0]),
          message: `Sobre o trecho restrito na rota (${nomes(viaRouting)}): restrição da PRF em vigor (${ops}), ${regra}. Sem alternativa razoável: ${saida}`,
        });
      }
      if (!stillOn.length && prfHits.length) {
        warnings.push({
          code: 'prf_feriado_desvio', severity: 'danger',
          message: `Restrição da PRF em vigor (${ops}): ${reasons.join('; ')} — proibido ${escopo} até ${fmtDT(release)}. `
            + `A rota evita ${kmRanges(prfHits.flatMap((h) => h.segs ?? [h.seg!]))}. Liberado a partir de ${fmtDT(release)} (${ato}).`,
        });
      } else if (!stillOn.length) {
        warnings.push({
          code: 'prf_feriado_vigente', severity: 'info',
          message: `Restrição da PRF de feriado em vigor (${ops}) até ${fmtDT(release)} para este veículo (${reasons.join('; ')}), ${escopo}. Esta rota não usa esses trechos.`,
        });
      }
      summary.push(`Feriado PRF em vigor (${ops}) até ${fmtDT(release)}: ${reasons.join('; ')}.`);
    }

    // ---- 2) PRF nas próximas 24 h (não vale na saída): agrupa por operação
    if (state.prfSoon.length) {
      const ops = new Map<string, { w: PrfWindow; reasons: string[] }[]>();
      for (const x of state.prfSoon) ops.set(x.w.p.operacao, [...(ops.get(x.w.p.operacao) ?? []), x]);
      for (const [op, list] of ops) {
        const reasons = [...new Set(list.flatMap((x) => x.reasons))];
        const quando = (w: PrfWindow) => `${fmtDT(w.start)}–${w.end.hasSame(w.start, 'day') ? w.end.toFormat('HH:mm') : fmtDT(w.end)}`;
        let inside: { name: string; eta: DateTime; w: PrfWindow; at: { lat: number; lon: number } } | null = null;
        const names = new Set<string>();
        for (const { w } of list) {
          for (const x of onRoute) {
            if (!segSubject(w.p, x.s) || state.prfActive.some((a) => segSubject(a.w.p, x.s))) continue;
            const g = subjectGeometry(w.p, x.s);
            const runs = g ? runsNear(coords, g) : [];
            if (!runs.length) continue;
            names.add(x.s.name);
            const eta = etaAt(runs[0][0]); const etaEnd = etaAt(runs[runs.length - 1][1]);
            if (eta < w.end && etaEnd >= w.start && (!inside || eta < inside.eta)) inside = { name: x.s.name, eta, w, at: midOf(coords, runs[0]) };
          }
        }
        if (!names.size) continue;
        const ato = list[0].w.p.ato;
        const horarios = list.map((x) => quando(x.w)).join(' e ');
        if (inside) {
          warnings.push({
            code: 'prf_feriado_eta', severity: 'warn', ...inside.at,
            message: `Pela estimativa você passa por ${inside.name} por volta de ${inside.eta.toFormat('HH:mm')}, dentro da restrição da PRF (${op}, ${quando(inside.w)}) para veículo excedente (${reasons.join('; ')}). Planeje passar fora desse horário (${ato}).`,
          });
        } else {
          warnings.push({
            code: 'prf_feriado_proximo', severity: 'info',
            message: `Restrição da PRF de feriado (${op}) em ${horarios} para veículo excedente (${reasons.join('; ')}). Esta rota usa ${[...names].slice(0, 3).join(', ')}: não passe por lá nesse horário (${ato}).`,
          });
        }
      }
    }

    // ---- 3) Regras semanais (serra da Anchieta)
    for (const wk of state.weekly) {
      const runs = weeklyRuns(coords, wk.r.geometry);
      const hit = hits.find((h) => h.kind === 'weekly' && h.rule?.id === wk.r.id);
      if (!runs.length && !hit) continue;
      const via = `${wk.r.p.nome_via.replace(' (serra)', '')} (${wk.r.p.rodovia} km ${fmt(wk.r.p.km_ini)}–${fmt(wk.r.p.km_fim)})`;
      const prox = wk.next ? `${fmtDT(wk.next.start)} às ${fmtDT(wk.next.end)}` : 'sem janela nas próximas semanas';
      const cheg = wk.r.p.chegada_minima ? `; chegada ao sistema Anchieta-Imigrantes a partir das ${wk.r.p.chegada_minima}` : '';
      if (!wk.open) {
        const regra = `CVC com AET só passa na serra da ${via} nas janelas de madrugada de seg a sex, fora de feriado prolongado (${wk.r.p.ato}, art. 3º, §§ 1º e 5º)`;
        if (runs.length && hit && routingWarns(route, lines, hit)) {
          // danger já emitido pelo routing.ts ('uses_restricted_way'); aqui só o detalhe e a próxima janela
          warnings.push({
            code: 'anchieta_cvc_aet_sem_alternativa', severity: 'info', ...midOf(coords, runs[0]),
            message: `Sobre o trecho restrito na rota: ${regra}. Sem alternativa razoável: aguarde a próxima janela, ${prox}${cheg}.`,
          });
        } else {
          warnings.push({
            code: runs.length ? 'anchieta_cvc_aet_na_rota' : 'anchieta_cvc_aet_desvio', severity: 'danger',
            ...(runs.length ? midOf(coords, runs[0]) : {}),
            message: `${regra}. `
              + (!runs.length ? 'A rota desvia da serra; confira se a sua AET cobre o caminho alternativo. '
                : hit ? 'A rota passa pela serra fora da janela, sem alternativa razoável: aguarde. '
                  : 'A rota passa pela serra fora da janela (desvio não testado): aguarde ou escolha outro caminho. ')
              + `Próxima janela: ${prox}${cheg}.`,
          });
        }
        summary.push(`Serra da Anchieta fechada para CVC com AET agora; próxima janela: ${prox}.`);
      } else if (runs.length) {
        const eta = etaAt(runs[0][0]);
        const late = eta >= wk.open.end;
        warnings.push({
          code: late ? 'anchieta_cvc_aet_eta' : 'anchieta_cvc_aet_janela', severity: late ? 'warn' : 'info', ...midOf(coords, runs[0]),
          message: late
            ? `Pela estimativa você chega à serra da ${via} por volta de ${eta.toFormat('HH:mm')}, depois do fim da janela (${wk.open.end.toFormat('HH:mm')}). CVC com AET fora da janela não passa (${wk.r.p.ato}). Próxima janela: ${prox}.`
            : `Janela da serra da ${via} aberta para CVC com AET até ${fmtDT(wk.open.end)} (${wk.r.p.ato}, art. 3º)${cheg}.`,
        });
      }
    }

    // art. 4º da SUP/DER-084/2023: faixa da esquerda proibida a QUALQUER CVC das 18h às 20h (informativo).
    if (isCombination(ctx.vehicle)) {
      for (const r of state.rules.weekly) {
        const fx = r.p.faixa_esquerda_cvc;
        if (!fx) continue;
        const runs = weeklyRuns(coords, r.geometry);
        if (!runs.length) continue;
        const eta = etaAt(runs[0][0]).toFormat('HH:mm');
        if (eta >= fx.ini && eta < fx.fim) {
          warnings.push({ code: 'anchieta_faixa_esquerda', severity: 'info', ...midOf(coords, runs[0]),
            message: `Serra da Anchieta: CVC não usa a faixa da esquerda das ${fx.ini} às ${fx.fim} quando a pista opera sentido Baixada (${r.p.ato}, art. 4º).` });
        }
      }
    }

    const data = {
      prf_ativas: state.prfActive.map((a) => ({ janela: a.w.name, inicio: a.w.start.toISO(), fim: a.w.end.toISO(), motivos: a.reasons, ato: a.w.p.ato, ato_url: a.w.p.ato_url })),
      prf_proximas_24h: state.prfSoon.map((a) => ({ janela: a.w.name, inicio: a.w.start.toISO(), fim: a.w.end.toISO(), motivos: a.reasons })),
      trechos_restritos_evitados_ou_usados: hits.map((h) => ({ id: h.item.id, trecho: h.label, regra: h.item.rule })),
      trechos_federais_na_rota: onRoute.map((x) => ({ trecho: x.s.name, tipo: x.s.kind, codigo_snv: x.s.p.codigo })),
      anchieta: state.weekly.map((w) => ({ ato: w.r.p.ato, aberta_agora: !!w.open, ate: w.open?.end.toISO() ?? null, proxima: w.next ? { inicio: w.next.start.toISO(), fim: w.next.end.toISO() } : null })),
      cost_lines: lines.length,
    };
    if (!summary.length && !warnings.length) return {};
    return { warnings, summary, data };
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 10;
    if (z < 6) return { type: 'FeatureCollection', features: [] };
    const rules = await loadRules();
    const now = DateTime.now().setZone(env.tz);
    const upcoming = rules.windows.filter((w) => w.end > now);
    const rows = await featuresInBbox(LAYER, bbox, {
      limit: 3000, where: MAPA_SNV ? `kind in ('pista_simples', 'pista_dupla', 'regra_semanal')` : `kind = 'regra_semanal'`,
      simplify: z < 9 ? 0.001 : z < 12 ? 0.0002 : undefined,
    });
    const features: GeoJSON.Feature[] = [];
    for (const r of rows) {
      if (r.kind === 'regra_semanal') {
        const p = r.props as unknown as WeeklyProps;
        features.push({ type: 'Feature', id: r.id, geometry: r.geometry, properties: {
          id: r.id, name: r.name, kind: r.kind, regra: `CVC com AET: só nas janelas de madrugada (seg–sex), fora de feriado prolongado`,
          ato: p.ato, ato_url: p.ato_url } });
        continue;
      }
      const s: Seg = { id: r.id, source_id: r.source_id, name: r.name ?? '', kind: r.kind as Seg['kind'], p: r.props as unknown as SegProps, geometry: r.geometry as any };
      const ws = upcoming.filter((w) => segSubject(w.p, s));
      if (s.kind === 'pista_dupla' && !ws.length) continue; // pista dupla só aparece se houver regra especial (ex.: Aparecida)
      const ativas = ws.filter((w) => activeAt(w, now));
      const prox = ws.find((w) => w.start > now);
      const quando = (w: PrfWindow) => `${fmtDT(w.start)}–${w.end.hasSame(w.start, 'day') ? w.end.toFormat('HH:mm') : fmtDT(w.end)}`;
      features.push({ type: 'Feature', id: r.id, geometry: r.geometry, properties: {
        id: r.id, name: r.name, kind: r.kind, codigo_snv: s.p.codigo, administracao: s.p.administracao,
        status: ativas.length ? 'restrição de feriado em vigor' : prox ? 'sem restrição agora' : 'sem janela futura publicada',
        restricao_agora: ativas.length ? ativas.map((w) => `${w.p.operacao} até ${fmtDT(w.end)} — ${quemText(w.p)}`).join('; ') : null,
        proxima_restricao: prox ? `${prox.p.operacao}: ${quando(prox)} — ${quemText(prox.p)}` : null,
        ato: (ativas[0] ?? prox)?.p.ato ?? null,
      } });
    }
    return { type: 'FeatureCollection', features };
  },
};

export default layer;
