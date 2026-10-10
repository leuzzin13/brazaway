import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { env } from '../config.js';
import { query } from '../db.js';
import { legalDayInfo, type LegalDayInfo } from '../services/calendar.js';
import { decodePolyline6 } from '../services/polyline.js';
import {
  LEGAL, SP_HAZMAT_WINDOWS, classesOutside, describeProduct, getProduct, hazmatInfo, inTimeWindows, trechoRuleDecision,
  type HazmatVehicleInfo, type TimeWindow, type TrechoDecision,
} from '../services/hazmat.js';
import type { LayerAnnotation, LayerCostLine, LayerExclusion, LayerItem, LayerWarning, RouteCtx, RouteGeom, RouteLayer } from './types.js';

/**
 * Produtos perigosos (PP). Só age com vehicle.hazmat = true, o mesmo sinal que o resto da pilha usa (costing do Valhalla
 * com hazmat=no do OSM, reportes hazmat_ban, zonas hazmat_only). Com nº ONU ou cargo_type 'hazmat' sem esse sinal, a
 * camada não aplica nada e só avisa (hazmat_flag_missing), para a rota não sair protegida pela metade.
 *
 *  costLines (linear_cost_factors, fator 1000 = "proibido salvo sem alternativa"; penaliza só a via, não quem a cruza):
 *   - trechos de rodovia proibidos por portaria do DER-SP, 24h (kind 'trecho_proibido': SP-008 km 25,28–31,5, Portaria
 *     PR/DER-164/2025 art. 2º; SP-324 km 86,62–90,7, Portaria SUP/DER-062/2024 art. 1º);
 *   - trechos fora de SP (kind 'trecho_proibido' com props.regra_id, importador hazmat_trechos_sudeste), decididos por
 *     veículo em `trechoRuleDecision` (hazmat.ts): Ponte Rio–Niterói e acessos e Av. Portuária (Portaria SPRF-RJ/PRF
 *     407/2024, arts. 1º e 4º-A: só as classes 1, 2.1, 2.3, 3, 4, 5, 6 e 8; isenção da Parte 3 da Res. ANTT 5.998/2022;
 *     exceção de Mocanguê do art. 2º, com janela), Linha Vermelha (Res. SMTR 2.204/2012, art. 1º IV: todas as classes,
 *     sem isenção). Regra com props.ativa = false (Terceira Ponte, IS DERTES 021-N/2004: vigência não confirmada) nunca
 *     vira costLine: só gera aviso quando a rota passa por ela;
 *   - vias do minianel (Anexo IV da Portaria SMT.GAB 051/2024), para TODOS os grupos, de 2ª a 6ª, exceto feriados,
 *     07h–10h e 17h–20h (art. 3º I) — kind 'via_minianel'. A ÁREA interna (centro expandido, grupos I e II) é a zona
 *     hazmat_only da frente core_legal (restriction_zones); esta camada não duplica o polígono.
 *  Quantidade limitada (Res. ANTT 5.998/2022, Parte 3, 3.4.3.4 c): dispensa só as limitações de itinerário e
 *  estacionamento do próprio regulamento. As costLines continuam: a Portaria SMT.GAB 051/2024 e as portarias do DER
 *  valem para os veículos que transportam PP, sem exceção por quantidade. A isenção só rebaixa os avisos do
 *  RTPP (APRM, art. 9º; estacionamento, art. 14) e gera o aviso hazmat_limited_qty_exempt.
 *
 *  annotate: produto/grupo SP, quantidade limitada, uso e horário estimado de passagem no minianel, trechos proibidos com
 *  origem/destino lindeiro, km em área de manancial (APRM, aviso sem bloqueio — Decreto 96.044/1988 art. 9º),
 *  emergências químicas da CETESB perto da rota, paradas de PP da ARTESP, LETPP em São Paulo e a regra da ZMRC (art. 35).
 *
 *  Os traçados das costLines vêm casados com a malha do Valhalla na importação (props.osm.tileset). Se o tileset mudou,
 *  a camada casa de novo em tempo de execução (trace_route) e valida no edge walk antes de usar (um traçado inválido
 *  derrubaria a rota inteira). Se ainda assim um trecho de rodovia não casar, ele vira exclusão estreita (12 m).
 *  Falha transitória do Valhalla (timeout, ocupado) nunca fica no cache: a próxima requisição tenta de novo.
 */
const LAYER = 'perigosos';
const FACTOR = 1000;
const LINDEIRO_M = 300;

const meta: RouteLayer['meta'] = {
  id: LAYER,
  label: 'Produtos perigosos',
  description: 'Trechos proibidos para carga perigosa (DER-SP, Ponte Rio–Niterói, Av. Portuária e Linha Vermelha), vias do Minianel nos horários da Portaria SMT.GAB 051/2024, mananciais, emergências químicas (CETESB) e paradas de PP (ARTESP).',
  group: 'restricoes',
  sources: [
    { name: 'Portaria SMT.GAB 051/2024 (PMSP/CET)', url: 'https://cetsp.com.br/media/1592296/portaria-051-24.pdf', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'Portarias PR/DER-164/2025 e SUP/DER-062/2024 (DOE-SP)', url: 'https://doe.sp.gov.br', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'Portaria SPRF-RJ/PRF 407/2024 (DOU 22/11/2024) — Ponte Rio–Niterói e Av. Portuária', url: 'https://www.in.gov.br/web/dou/-/portaria-sprf-rj/prf-n-407-de-14-de-novembro-de-2024-597101479', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'Res. SMTR 2.204/2012 (DO Rio 19/03/2012) — Linha Vermelha', url: 'https://doweb.rio.rj.gov.br/portal/edicoes/download/1681', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'IS DERTES 021-N/2004 — Terceira Ponte (registrada, desativada)', url: 'https://der.es.gov.br/legislacao-2', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'Relação de Produtos Perigosos (Res. ANTT 5.998/2022)', url: 'https://anexosportal.datalegis.net/arquivos/1774888.pdf', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'CETESB Malha Rodoviária Estadual (km)', url: 'https://arcgis.cetesb.sp.gov.br/server/rest/services/Hosted/Malha_Rodovi%C3%A1ria_Estadual_SP/FeatureServer/0', license: 'Não declarada (atribuição)' },
    { name: 'CETESB Emergências Químicas (DataGEO)', url: 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs', license: 'Não declarada (atribuição)' },
    { name: 'APRM — limites de bacia (DataGEO/SIMA)', url: 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs', license: 'Não declarada (atribuição)' },
    { name: 'ARTESP — paradas de produtos perigosos', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria', license: 'CC-BY' },
    { name: 'IBGE — malha municipal (LETPP)', url: 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/3550308', license: 'Dados públicos (citar a fonte)' },
    { name: 'IBGE — malhas municipais (Niterói, Rio de Janeiro, Duque de Caxias)', url: 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/3303302', license: 'Dados públicos (citar a fonte)' },
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
/** Último tileset confirmado pelo /status (renovado a cada 60 s). Falha de rede não entra no cache. */
let tilesetCache: { at: number; value: number } | null = null;
async function fetchTileset(): Promise<number | null> {
  try {
    const r = await fetch(`${env.valhallaUrl}/status`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const v = ((await r.json()) as { tileset_last_modified?: number }).tileset_last_modified;
    return typeof v === 'number' ? v : null;
  } catch { return null; }
}
/**
 * Tileset atual do Valhalla. Sem resposta em duas tentativas (Valhalla ocupado): `confirmed: false`, com o último valor
 * conhecido (se houver) — quem chama usa os traçados da importação e avisa que o tileset não foi confirmado.
 */
async function valhallaTileset(): Promise<{ value: number | null; confirmed: boolean }> {
  if (tilesetCache && Date.now() - tilesetCache.at < 60_000) return { value: tilesetCache.value, confirmed: true };
  const v = (await fetchTileset()) ?? (await fetchTileset());
  if (v !== null) {
    tilesetCache = { at: Date.now(), value: v };
    return { value: v, confirmed: true };
  }
  return { value: tilesetCache?.value ?? null, confirmed: false };
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

/** Casamento de um traçado; `transient` = falha do Valhalla (rede, timeout, 5xx), que não deve ficar no cache. */
type MatchResult = { legs: Coords[]; transient: false } | { legs: null; transient: boolean };

async function traceMatch(coords: Coords): Promise<MatchResult> {
  let res: Response;
  let j: any;
  try {
    res = await fetch(`${env.valhallaUrl}/trace_route`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ shape: densify(coords).map(([lon, lat]) => ({ lon, lat })), costing: 'truck', shape_match: 'map_snap',
        trace_options: { search_radius: 50, gps_accuracy: 15 } }),
    });
    j = await res.json();
  } catch { return { legs: null, transient: true }; }
  if (res.status >= 500) return { legs: null, transient: true };
  if (!res.ok || !j?.trip) return { legs: null, transient: false };
  const legs: Coords[] = (j.trip.legs as any[]).map((l) => decodePolyline6(l.shape)).filter((l) => l.length >= 2 && lineLenM(l) >= 5);
  const L = lineLenM(coords), M = legs.reduce((s, l) => s + lineLenM(l), 0);
  if (!legs.length || M > L * 1.3 + 50 || M < L * 0.7 - 30) return { legs: null, transient: false };
  return { legs, transient: false };
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

interface Rematch { lines: Coords[] | null; transient: boolean }
/**
 * Traçados casados por (tileset, id da feição); preenchido sob demanda quando o tileset da importação não é o atual.
 * Falha transitória (trace_route ou edge walk sem resposta) sai do cache assim que resolve; resultado vazio definitivo
 * (não casou) expira em 10 min, para não ficar preso até reiniciar a API.
 */
const rematchCache = new Map<string, { at: number; p: Promise<Rematch> }>();
const REMATCH_NULL_TTL_MS = 10 * 60_000;

async function rematchRows(rows: RouteRow[], tileset: number): Promise<Map<string, Rematch>> {
  const key = (r: RouteRow) => `${tileset}:${r.id}`;
  const now = Date.now();
  for (const r of rows) {
    const c = rematchCache.get(key(r));
    if (c && now - c.at > REMATCH_NULL_TTL_MS && (await c.p).lines === null) rematchCache.delete(key(r));
  }
  const todo = rows.filter((r) => !rematchCache.has(key(r)));
  if (todo.length) {
    const job = (async () => {
      const matched = new Map<string, { legs: Coords[]; transient: boolean }>();
      let i = 0;
      const worker = async () => {
        while (i < todo.length) {
          const r = todo[i++];
          const g = r.geometry.coordinates as Coords;
          // trecho do DER: geometria da fonte sem sentido (casa os dois); traçado exato (osm.geom): só o sentido do tráfego
          const dirs: Coords[] = r.kind === 'trecho_proibido' && !r.props.osm?.geom ? [g, [...g].reverse()] : [g];
          const m = { legs: [] as Coords[], transient: false };
          for (const d of dirs) {
            const t = await traceMatch(d);
            if (t.legs) m.legs.push(...t.legs);
            else if (t.transient) m.transient = true;
          }
          matched.set(r.id, m);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      const flat: { id: string; c: Coords }[] = [];
      for (const [id, m] of matched) for (const c of m.legs) flat.push({ id, c });
      const ok = await edgeWalkOk(flat.map((f) => f.c));
      const res = new Map<string, Rematch>();
      for (const r of todo) {
        const lines = ok ? flat.filter((f, k) => f.id === r.id && ok[k]).map((f) => f.c) : [];
        res.set(r.id, { lines: lines.length ? lines : null, transient: !!matched.get(r.id)?.transient || ok === null });
      }
      return res;
    })();
    for (const r of todo) {
      const k = key(r);
      const p = job.then((m) => m.get(r.id) ?? { lines: null, transient: true }, (): Rematch => ({ lines: null, transient: true }));
      const entry = { at: now, p };
      rematchCache.set(k, entry);
      void p.then((v) => { if (v.transient && rematchCache.get(k) === entry) rematchCache.delete(k); });
    }
  }
  const out = new Map<string, Rematch>();
  for (const r of rows) out.set(r.id, await (rematchCache.get(key(r))?.p ?? Promise.resolve<Rematch>({ lines: null, transient: true })));
  return out;
}

interface Routable {
  /** traçados (sentido do tráfego) que podem ir para linear_cost_factors, ou null se não houver traçado válido */
  lines: Map<string, Coords[] | null>;
  /** ids sem traçado por falha transitória do Valhalla (não é dado desatualizado) */
  transientIds: Set<string>;
  /** usou os traçados da importação sem confirmar o tileset (Valhalla não respondeu ao /status) */
  tilesetUnconfirmed: boolean;
}

async function routableLines(rows: RouteRow[]): Promise<Routable> {
  const ts = await valhallaTileset();
  const lines = new Map<string, Coords[] | null>();
  const transientIds = new Set<string>();
  let tilesetUnconfirmed = false;
  const stale: RouteRow[] = [];
  for (const r of rows) {
    const osm = r.props.osm as { tileset?: number; geom?: boolean; lines?: { coords: Coords }[] } | undefined;
    const imported: Coords[] | null = osm ? (osm.geom ? [r.geometry.coordinates as Coords] : (osm.lines ?? []).map((l) => l.coords)) : null;
    if (ts.value !== null && osm?.tileset === ts.value) {
      lines.set(r.id, imported);
      if (!ts.confirmed) tilesetUnconfirmed = true;
    } else if (ts.value === null) {
      // Valhalla não respondeu e não há tileset conhecido: usa os traçados da importação, com aviso
      lines.set(r.id, imported?.length ? imported : null);
      if (imported?.length) tilesetUnconfirmed = true; else transientIds.add(r.id);
    } else stale.push(r);
  }
  if (stale.length) {
    for (const [id, v] of await rematchRows(stale, ts.value!)) {
      lines.set(id, v.lines);
      if (!v.lines && v.transient) transientIds.add(id);
    }
  }
  return { lines, transientIds, tilesetUnconfirmed };
}

// ---------------------------------------------------------------------------------------------------------------
// plano de restrições (exclusions + costLines compartilham o mesmo cálculo por requisição)
// ---------------------------------------------------------------------------------------------------------------

interface Plan {
  costLines: LayerCostLine[]; exclusions: LayerExclusion[]; minianelActive: boolean; day: LegalDayInfo; hz: HazmatVehicleInfo;
  /** feições sem traçado válido na malha atual (dado desatualizado: rodar os importadores) */
  fallbackIds: string[];
  /** feições sem traçado por falha transitória do Valhalla */
  transientIds: string[];
  tilesetUnconfirmed: boolean;
  /** vias do Minianel consideradas no plano */
  minianelRows: number;
  /** regras de trecho no corredor (chave: regra_id, ou o id da feição nos trechos do DER) e a decisão para este veículo */
  trechos: Map<string, TrechoEval>;
  /** feições de trecho que viraram restrição (a regra alcança o veículo) */
  appliedIds: Set<string>;
  /** origem ou destino na Ilha de Mocanguê (Portaria SPRF-RJ/PRF 407/2024, art. 2º) */
  mocangue: MocangueInfo | null;
}
interface TrechoEval { key: string; props: Record<string, any>; decision: TrechoDecision }
interface MocangueInfo {
  endpoint: 'origem' | 'destino';
  /** a outra ponta está em Niterói (art. 2º I: "entre Niterói - Ilha de Mocanguê e Ilha de Mocanguê - Niterói") */
  niteroi: boolean;
  /** saída dentro das janelas do art. 2º II */
  inWindow: boolean;
  ok: boolean;
  hhmm: string;
  janelas: TimeWindow[];
  aviso_previo_h: number;
  artigo: string;
  norma: string;
}
const plans = new WeakMap<RouteCtx, Promise<Plan>>();

const VALID_SQL = `(f.valid_to is null or f.valid_to > now()) and (f.valid_from is null or f.valid_from <= now())`;

const lcFirst = (t: string) => (t ? t[0].toLowerCase() + t.slice(1) : t);

/** "1, 2.1, 2.3, 3, 4, 5, 6 e 8" */
function fmtList(xs: readonly string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}
/** "das 23h às 4h e das 11h às 16h" */
function fmtWindows(ws: readonly TimeWindow[]): string {
  const h = (t: string) => { const [hh, mm] = t.split(':'); return `${Number(hh)}h${mm === '00' ? '' : mm}`; };
  return fmtList(ws.map((w) => `das ${h(w.from)} às ${h(w.to)}`));
}

/**
 * Exceção do art. 2º da Portaria SPRF-RJ/PRF 407/2024: produtos destinados às instalações militares da Ilha de Mocanguê,
 * "entre Niterói - Ilha de Mocanguê e Ilha de Mocanguê - Niterói", das 23h às 4h e das 11h às 16h, com aviso de 24 h à
 * concessionária. Vale quando UMA das pontas está na ilha (área com folga de 150 m) e a outra em Niterói, com saída
 * dentro da janela. O destino militar da carga e o aviso prévio não dá para conferir: entram no aviso.
 */
async function mocangueInfo(ctx: RouteCtx, row: RouteRow): Promise<MocangueInfo | null> {
  const mc = row.props.excecao_mocangue as Record<string, any> | undefined;
  if (!mc) return null;
  const r = await query<{ papel: string; o_in: boolean; d_in: boolean }>(
    `select f.props->>'papel' as papel,
            ST_Intersects(f.geom, ST_SetSRID(ST_MakePoint($3, $4), 4326)) as o_in,
            ST_Intersects(f.geom, ST_SetSRID(ST_MakePoint($5, $6), 4326)) as d_in
       from data_features f
      where f.layer_id = $1 and f.kind = 'area_excecao' and f.props->>'regra_id' = $2 and ${VALID_SQL}`,
    [LAYER, row.props.regra_id, ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat],
  );
  const ilha = r.rows.find((x) => x.papel === 'destino_militar');
  const mun = r.rows.find((x) => x.papel === 'municipio_origem');
  if (!ilha || ilha.o_in === ilha.d_in) return null;   // nenhuma ponta (ou as duas) na ilha
  const endpoint = ilha.o_in ? 'origem' : 'destino';
  const niteroi = !!mun && (endpoint === 'origem' ? mun.d_in : mun.o_in);
  const { dow, hhmm } = localParts(ctx.at);
  const janelas = (mc.janelas ?? []) as TimeWindow[];
  const inWindow = inTimeWindows(hhmm, dow, janelas);
  return { endpoint, niteroi, inWindow, ok: niteroi && inWindow, hhmm, janelas, aviso_previo_h: Number(mc.aviso_previo_h ?? 24),
    artigo: String(mc.artigo ?? 'art. 2º'), norma: String(row.props.norma) };
}

/**
 * Corredor plausível da rota para os trechos de rodovia: elipse com focos na origem e no destino
 * (d(O,p) + d(D,p) <= L + folga). O routing.ts mede a sobreposição de cada costLine com as rotas livre e restrita
 * (custo proporcional ao nº de vértices), então não vale mandar a SP-324 numa rota em Mairiporã.
 * As vias do Minianel NÃO passam por esse filtro (ver MINIANEL_REACH_M).
 */
function corridor(ctx: RouteCtx): { L: number; slack: number } {
  const L = turf.distance([ctx.origin.lon, ctx.origin.lat], [ctx.destination.lon, ctx.destination.lat], { units: 'meters' });
  return { L, slack: Math.max(5000, L * 0.3) };
}

function itemOf(r: RouteRow): LayerItem {
  const p = r.props;
  const c = r.geometry.coordinates;
  const mid = (p.ponto_medio as [number, number] | undefined) ?? c[Math.floor(c.length / 2)];
  if (r.kind === 'trecho_proibido' && p.regra_id) {
    // trechos fora de SP: todos os pedaços (sentidos, alças) da mesma regra têm o mesmo id e o mesmo ponto de referência
    const ref = (p.ponto_ref as [number, number] | undefined) ?? mid;
    const cls = Array.isArray(p.classes_proibidas) && p.classes_proibidas.length ? ` das classes ${fmtList(p.classes_proibidas)}` : '';
    return { kind: 'layer', layer: LAYER, id: `trecho-${p.regra_id}`, name: p.via ?? r.name ?? 'Trecho proibido para PP', type: 'hazmat_ban',
      rule: `PP${cls} proibido 24h — ${p.norma}, ${p.artigo}`, lon: ref[0], lat: ref[1], note: `${p.via} — ${p.norma}` };
  }
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

/**
 * Vias do Minianel: entram TODAS as que estão a até 30 km do retângulo origem–destino, sem a elipse e sem filtro pela
 * rota livre. A ZMRC e a área interna empurram a rota restrita para o anel por caminhos longe da rota livre e da elipse
 * (ex.: Butantã→Mooca às 08h saía pela Marginal Tietê); com o conjunto inteiro (~200 pedaços, ~84 linhas depois do
 * encadeamento) o Valhalla só usa uma via do anel quando não há alternativa.
 */
const MINIANEL_REACH_M = 30_000;

function plan(ctx: RouteCtx): Promise<Plan> {
  let p = plans.get(ctx);
  if (!p) {
    p = (async () => {
      const hz = hazmatInfo(ctx.vehicle);
      const day = await legalDayInfo(ctx.at);
      const minianelActive = spRuleActive(ctx.at, day);
      const empty: Plan = { costLines: [], exclusions: [], minianelActive, day, hz, fallbackIds: [], transientIds: [], tilesetUnconfirmed: false,
        minianelRows: 0, trechos: new Map(), appliedIds: new Set(), mocangue: null };
      // Quantidade limitada NÃO zera o plano: as portarias do município e do DER não têm exceção por quantidade.
      if (!hz.active) return empty;
      const { L, slack } = corridor(ctx);
      const od = [ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat];
      const sel = `select f.id::text, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry from data_features f`;
      const valid = VALID_SQL;
      const bbox = `ST_MakeEnvelope(least($2::float8, $4::float8), least($3::float8, $5::float8), greatest($2::float8, $4::float8), greatest($3::float8, $5::float8), 4326)`;
      const [trechos, minianel] = await Promise.all([
        query<RouteRow>(
          `with o as (select ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography as g),
                d as (select ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography as g)
           ${sel}, o, d
            where f.layer_id = $1 and f.kind = 'trecho_proibido' and ${valid}
              and f.geom && ST_Expand(${bbox}, $6 / 100000.0)
              and ST_Distance(f.geom::geography, o.g) + ST_Distance(f.geom::geography, d.g) <= $7`,
          [LAYER, ...od, slack, L + slack],
        ),
        minianelActive
          ? query<RouteRow>(
            `${sel} where f.layer_id = $1 and f.kind = 'via_minianel' and ${valid} and ST_DWithin(f.geom, ${bbox}, $6 / 100000.0)`,
            [LAYER, ...od, MINIANEL_REACH_M],
          )
          : Promise.resolve({ rows: [] as RouteRow[] }),
      ]);
      // decisão por regra (classe ONU, isenção da Parte 3, exceção de Mocanguê, regra inativa): só vira restrição o trecho
      // cuja regra alcança este veículo. As portarias do DER-SP não têm classe nem isenção: valem para todo PP.
      const mocRow = trechos.rows.find((r) => r.props.excecao_mocangue);
      const mocangue = mocRow ? await mocangueInfo(ctx, mocRow).catch(() => null) : null;
      const evals = new Map<string, TrechoEval>();
      const appliedIds = new Set<string>();
      const trechoRows: RouteRow[] = [];
      for (const r of trechos.rows) {
        const key = String(r.props.regra_id ?? r.id);
        let ev = evals.get(key);
        if (!ev) {
          ev = { key, props: r.props, decision: trechoRuleDecision(r.props, hz, !!r.props.excecao_mocangue && !!mocangue?.ok) };
          evals.set(key, ev);
        }
        if (ev.decision.applies) { appliedIds.add(r.id); trechoRows.push(r); }
      }
      const rows = [...trechoRows, ...minianel.rows];
      if (!rows.length) return { ...empty, trechos: evals, mocangue };
      const rt = await routableLines(rows);
      const costLines: LayerCostLine[] = [];
      const exclusions: LayerExclusion[] = [];
      const fallbackIds: string[] = [];
      const transientIds: string[] = [];
      const minianelParts: { row: RouteRow; coords: Coords }[] = [];
      for (const row of rows) {
        const item = itemOf(row);
        const ls = rt.lines.get(row.id);
        if (ls && ls.length) {
          if (row.kind === 'via_minianel') { for (const c of ls) minianelParts.push({ row, coords: c }); continue; }
          // pista dupla (SP-324): uma linha por sentido, com o mesmo item (o routing.ts deduplica "evitado" por id)
          for (const c of mergeUTurn(ls)) costLines.push({ item, coordinates: c, factor: FACTOR });
          continue;
        }
        if (row.kind === 'trecho_proibido') {
          // sem traçado válido na malha atual: exclusão estreita em volta da geometria da fonte (corta também quem cruza)
          exclusions.push({ item, rings: [ringAround(row.geometry.coordinates as Coords, 12)] });
        }
        (rt.transientIds.has(row.id) ? transientIds : fallbackIds).push(row.id);
      }
      // todas as cadeias da mesma via do Anexo IV (sentidos, trechos) têm o mesmo id: a via aparece uma vez só em "evitado"
      for (const ch of chainMinianel(minianelParts)) {
        costLines.push({ item: { ...itemOf(ch.row), id: `minianel-anexo-iv-${ch.row.props.anexo_iv_item}` }, coordinates: ch.coords, factor: FACTOR });
      }
      return { costLines, exclusions, minianelActive, day, hz, fallbackIds, transientIds, tilesetUnconfirmed: rt.tilesetUnconfirmed,
        minianelRows: minianel.rows.length, trechos: evals, appliedIds, mocangue };
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

interface TrechoUse { regra: string; len_m: number; props: Record<string, any> }
/**
 * Metros da rota sobre as vias de cada regra de trecho fora de SP (props.regra_id), ativa ou não: buffer de 8 m das
 * pistas da regra (unidas, para a pista dupla não contar duas vezes), em SIRGAS 2000 / UTM 23S. Serve para avisar regra
 * desativada, classe liberada, isenção e regra fora do corredor do plano que a rota acabou usando.
 */
async function trechoUse(line: GeoJSON.LineString): Promise<TrechoUse[]> {
  const r = await query<TrechoUse>(
    `with r as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g4),
          pc as (select ST_Subdivide(r.g4, 24) as g from r),
          m as (select distinct on (f.id) f.id, f.props->>'regra_id' as regra, f.geom
                  from data_features f join pc on f.geom && ST_Expand(pc.g, 0.0002)
                 where f.layer_id = $2 and f.kind = 'trecho_proibido' and f.props ? 'regra_id' and ${VALID_SQL}
                   and ST_DWithin(f.geom, pc.g, 0.0002)),
          u as (select m.regra, ST_Union(ST_Buffer(ST_Transform(m.geom, 31983), 8, 'quad_segs=2')) as g from m group by m.regra)
     select u.regra, ST_Length(ST_Intersection(ST_Transform(r.g4, 31983), u.g))::float as len_m,
            (select f.props - 'osm' from data_features f
              where f.layer_id = $2 and f.kind = 'trecho_proibido' and f.props->>'regra_id' = u.regra limit 1) as props
       from u, r`,
    [JSON.stringify(line), LAYER],
  );
  return r.rows;
}

/** Áreas de regras registradas e não aplicadas (ex.: Lei Rio 1.632/1990) que a rota atravessa: só aviso. */
async function zonasRegistradas(line: GeoJSON.LineString): Promise<Record<string, any>[]> {
  const r = await query<{ props: Record<string, any> }>(
    `with r as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g)
     select f.props from data_features f, r
      where f.layer_id = $2 and f.kind = 'zona_registrada' and f.geom && r.g and ST_Intersects(f.geom, r.g)
        and (f.valid_to is null or f.valid_to > now())`,
    [JSON.stringify(line), LAYER],
  );
  return r.rows.map((x) => x.props);
}

/**
 * Portaria 137/2018 art. 35: "caminhões de até dois eixos traseiros"; §2º: "O trânsito de 'caminhão-trator' não será
 * autorizado". Cavalo mecânico (semirreboque, CVC) nunca se enquadra. Nos demais, usa rear_axle_count quando o veículo
 * tiver o campo; sem ele, só dá para afirmar com até 3 eixos no total (no máximo 2 traseiros). Um "bitruck" de 4 eixos
 * pode ter 2 dianteiros e 2 traseiros, e no caminhão com reboque a conta depende do conjunto: aí a resposta é null
 * ("confira os eixos traseiros").
 */
type AxleCheck = { ok: boolean | null; tractor: boolean };
function rearAxlesLe2(ctx: RouteCtx): AxleCheck {
  const v = ctx.vehicle as RouteCtx['vehicle'] & { rear_axle_count?: number };
  if (v.vehicle_class === 'semitrailer' || v.vehicle_class === 'cvc') return { ok: false, tractor: true };
  if (typeof v.rear_axle_count === 'number' && Number.isFinite(v.rear_axle_count)) return { ok: v.rear_axle_count <= 2, tractor: false };
  if (v.vehicle_class !== 'truck_trailer' && typeof v.axle_count === 'number' && v.axle_count <= 3) return { ok: true, tractor: false };
  return { ok: null, tractor: false };
}

type WarnFn = (code: string, severity: LayerWarning['severity'], message: string, extra?: Partial<LayerWarning>) => void;

interface TrechoOut {
  regra_id: string; via: string; uf: string | null; norma: string; artigo: string; situacao: string;
  classes_proibidas: string[] | null;
  /** a proibição alcança este veículo (virou restrição se a regra estava no corredor) */
  aplicada: boolean;
  /** aplicada | inativa | classe_liberada | qtd_limitada | nao_sujeito | excecao */
  decisao: string;
  /** a regra estava no corredor do plano (elipse origem–destino) */
  no_plano: boolean;
  usado_m: number;
}

/**
 * Avisos e resumo das regras de trecho fora de SP (props.regra_id). As que viraram costLine e a rota evitou aparecem em
 * "evitado" (routing.ts); se a rota passou mesmo assim, o routing.ts avisa (uses_restricted_way). Aqui ficam: regra
 * desativada no caminho, classe liberada, isenção da Parte 3, exceção de Mocanguê, carga sem nº ONU numa regra por
 * classe e regra fora do corredor do plano que a rota acabou usando.
 */
function sudesteTrechos(pl: Plan, tUse: TrechoUse[], W: WarnFn, summary: string[]): TrechoOut[] {
  const { hz } = pl;
  const usedBy = new Map(tUse.filter((u) => u.len_m >= 100 && u.props).map((u) => [u.regra, u]));
  const keys = new Set<string>([...[...pl.trechos.values()].filter((e) => e.props.regra_id).map((e) => e.key), ...usedBy.keys()]);
  const out: TrechoOut[] = [];
  for (const key of keys) {
    const ev = pl.trechos.get(key);
    const u = usedBy.get(key);
    const p = ev?.props ?? u!.props;
    // regra fora do corredor do plano: decide aqui (sem a exceção de Mocanguê, que exige uma ponta na ilha, no corredor)
    const d = ev?.decision ?? trechoRuleDecision(p, hz, false);
    const usedM = Math.round(u?.len_m ?? 0);
    const via = String(p.via);
    const cite = `${p.norma}, ${p.artigo}`;
    const id = `trecho-${key}`;
    const lista = Array.isArray(p.classes_proibidas) ? (p.classes_proibidas as string[]) : null;
    if (d.code === 'aplicada') {
      if (!ev && usedM) {
        W('hazmat_trecho_usado', 'danger', `A rota passa ${fmtKm(usedM)} pela ${via}, proibida para este produto (${cite}). O trecho ficou fora do corredor considerado no cálculo: confira a rota antes de seguir.`, { id });
      }
      if (ev && lista && (d.classCheck.basis === 'sem_onu' || d.classCheck.basis === 'desconhecido')) {
        W('hazmat_trecho_classe', 'info', `${via}: ${d.classCheck.basis === 'sem_onu' ? 'sem nº ONU' : 'nº ONU fora da Relação da ANTT'}, a proibição por classe (${cite}) foi aplicada. As classes ${fmtList(classesOutside(lista))} não são proibidas ali: informe o nº ONU.`, { id });
      }
    } else if (d.code === 'inativa' && usedM) {
      W('hazmat_regra_nao_confirmada', 'warn', `A rota passa ${fmtKm(usedM)} pela ${via}: ${lcFirst(p.regra)} (${cite}; ${p.janela}). Regra registrada e NÃO aplicada — ${p.aviso_inativa ?? p.motivo_inativa ?? p.situacao}`, { id });
    } else if (d.code === 'classe_liberada' && usedM && lista) {
      const lc = d.classCheck.loadClasses;
      let txt = `${via}: carga da${lc.length > 1 ? 's classes' : ' classe'} ${fmtList(lc)}, fora das proibidas (${cite}: classes ${fmtList(lista)}); passagem permitida.`;
      if (d.classCheck.subsidiaryHits.length) {
        txt += ` O risco subsidiário ${fmtList(d.classCheck.subsidiaryHits)} está na lista, mas a portaria fala da classe do produto: na dúvida, confirme com a PRF.`;
      }
      summary.push(txt);
    } else if ((d.code === 'qtd_limitada' || d.code === 'nao_sujeito') && usedM) {
      const motivo = d.code === 'qtd_limitada' ? 'carga dentro da quantidade limitada' : 'produto "não sujeito" na Relação da ANTT';
      W('hazmat_trecho_isento', 'info', `${via}: ${motivo}, a proibição não se aplica (${p.isencao_texto ?? cite}). Leve a documentação que comprova a isenção.`, { id });
    }
    out.push({
      regra_id: key, via, uf: p.uf ?? null, norma: p.norma, artigo: p.artigo, situacao: p.situacao ?? 'vigente', classes_proibidas: lista,
      aplicada: d.applies, decisao: d.code, no_plano: !!ev, usado_m: usedM,
    });
  }

  // --- exceção de Mocanguê (Portaria SPRF-RJ/PRF 407/2024, art. 2º): só quando a proibição da ponte alcança a carga
  const m = pl.mocangue;
  const ponte = [...pl.trechos.values()].find((e) => e.props.excecao_mocangue);
  if (m && ponte && (ponte.decision.code === 'aplicada' || ponte.decision.code === 'excecao')) {
    const ponta = m.endpoint === 'origem' ? 'Origem' : 'Destino';
    const regra = `só para produtos destinados às instalações militares, no trajeto Niterói–Mocanguê, ${fmtWindows(m.janelas)}, com aviso à concessionária da ponte ${m.aviso_previo_h} h antes`;
    if (m.ok) {
      W('hazmat_mocangue', 'warn', `${ponta} na Ilha de Mocanguê: a rota usa a ponte pela exceção do ${m.artigo} da ${m.norma} (${regra}). Confirme o destino militar e o aviso prévio.`, { id: 'mocangue' });
    } else {
      const why = [!m.niteroi && 'a outra ponta não está em Niterói', !m.inWindow && `saída às ${m.hhmm.replace(':', 'h')}, fora da janela`].filter(Boolean).join(' e ');
      W('hazmat_mocangue', 'warn', `${ponta} na Ilha de Mocanguê: a exceção do ${m.artigo} da ${m.norma} vale ${regra}; aqui não se aplica (${why}). A proibição da ponte foi mantida, e a ilha só tem acesso por ela.`, { id: 'mocangue' });
    }
  }
  return out;
}

async function annotate(ctx: RouteCtx, route: RouteGeom): Promise<LayerAnnotation> {
  const pl = await plan(ctx);
  const { hz } = pl;
  if (!hz.active) {
    if (!hz.declaredWithoutFlag) return {};
    const what = hz.uns.length ? `Nº ONU ${hz.uns.join(', ')} informado` : 'Carga do tipo "produto perigoso" informada';
    return {
      warnings: [{
        code: 'hazmat_flag_missing', severity: 'warn', layer: LAYER,
        message: `${what}, mas o veículo não está marcado como "carga perigosa": a rota saiu sem as regras de PP (vias com hazmat=no no OSM, reportes de proibição de PP, zonas e vias do Minianel). Marque "carga perigosa" e calcule de novo.`,
      }],
    };
  }
  const line = route.line.geometry;
  const warnings: LayerWarning[] = [];
  const summary: string[] = [];
  const W = (code: string, severity: LayerWarning['severity'], message: string, extra: Partial<LayerWarning> = {}) =>
    warnings.push({ code, severity, message, layer: LAYER, ...extra });

  // --- produto, grupo e quantidade limitada
  const group = hz.group;
  if (!hz.uns.length) {
    W('hazmat_un_missing', 'info', 'Informe o nº ONU do produto: o grupo da Portaria SMT.GAB 051/2024, a classe de risco (regras por classe, como a da Ponte Rio–Niterói) e a isenção por quantidade limitada dependem dele. Restrições aplicadas como grupo I e a todas as classes.');
  } else {
    summary.push(`${hz.uns.map(describeProduct).join('; ')} — ${group?.label ?? ''} em São Paulo (${group?.basis ?? LEGAL.gruposSP}).`);
    if (group?.ambiguous && !hz.localDelivery) {
      summary.push('Nº ONU nos Anexos I e II da Portaria 051/2024: tratado como grupo II. Se for entrega fracionada para consumo local (ex.: GLP engarrafado), é grupo III.');
    }
    if (group?.qualifierMissing) {
      summary.push(`ONU 3082 só é grupo III (consumo local) quando for ${group.annexIIQualifier} (Anexo II da Portaria 051/2024): sem essa indicação, tratado como grupo II.`);
    }
  }
  for (const u of hz.unknownUns) W('hazmat_un_unknown', 'warn', `ONU ${u} não consta na Relação de Produtos Perigosos da ANTT. Confira o número; restrições aplicadas como grupo I.`);
  for (const u of hz.prohibited) W('hazmat_transport_prohibited', 'danger', `ONU ${u} (${getProduct(u)?.name ?? ''}): transporte rodoviário proibido pela Relação da Res. ANTT 5.998/2022.`);
  if (hz.notSubject) summary.push('Produto marcado como "não sujeito" ao regulamento de transporte de PP na Relação da ANTT; restrições aplicadas mesmo assim porque a carga foi declarada perigosa.');
  summary.push(hz.lq.text);
  if (hz.lqExempt) {
    W('hazmat_limited_qty_exempt', 'info', `${hz.lq.text} Rota calculada com elas; a LETPP continua obrigatória em São Paulo (${LEGAL.letpp}).`);
  }

  const free = pl.minianelActive ? route.free?.line.geometry : undefined;
  const [use, freeUse, aprm, touch, nearOD, emerg, paradas, tUse, zonasReg] = await Promise.all([
    minianelUse(line).catch(() => [] as UseSeg[]),
    free ? minianelUse(free).catch(() => [] as UseSeg[]) : Promise.resolve([] as UseSeg[]),
    aprmKm(line).catch(() => []),
    routeTouches(line, ctx).catch(() => undefined),
    trechosNearOD(ctx).catch(() => []),
    pointsNearRoute(line, 'emergencia', 250, 3000).catch(() => [] as NearRow[]),
    pointsNearRoute(line, 'parada_pp', 300, 50).catch(() => [] as NearRow[]),
    trechoUse(line).catch(() => [] as TrechoUse[]),
    zonasRegistradas(line).catch(() => [] as Record<string, any>[]),
  ]);

  // --- minianel: uso e horário estimado de passagem
  const usedM = use.reduce((s, u) => s + u.len_m, 0);
  const etaOf = (f: number) => new Date(ctx.at.getTime() + Math.max(0, Math.min(1, f)) * route.duration_s * 1000);
  const firstEta = use.length ? etaOf(use[0].f0) : null;
  const vias = [...new Set(use.flatMap((u) => (u.vias ?? '').split(', ').filter(Boolean)))];
  const etaInWindow = use.some((u) => spRuleActive(etaOf(u.f0), pl.day) || spRuleActive(etaOf(u.f1), pl.day));
  const freeUsedM = freeUse.reduce((s, u) => s + u.len_m, 0);
  // vale com ou sem quantidade limitada: a Portaria 051/2024 não prevê exceção por quantidade
  if (usedM > 0 && pl.minianelActive) {
    W('hazmat_minianel_used', 'danger', `A rota usa ${fmtKm(usedM)} de vias do Minianel (${vias.join(', ')}) no horário proibido para PP (${WINDOW_TXT}; ${LEGAL.minianel}). Saia fora da janela ou use outro acesso.`);
  } else if (usedM > 0 && etaInWindow) {
    W('hazmat_minianel_eta', 'warn', `Saindo às ${fmtH(ctx.at)}, a rota chega ao Minianel (${vias.join(', ')}) por volta das ${fmtH(firstEta!)}, dentro da janela proibida para PP (${WINDOW_TXT}). Ajuste o horário de saída.`);
  } else if (usedM > 0) {
    summary.push(`Usa ${fmtKm(usedM)} de vias do Minianel fora da janela de restrição (passagem estimada ${fmtH(firstEta!)}).`);
  } else if (pl.minianelActive && freeUsedM > 0) {
    summary.push(`Vias do Minianel proibidas para PP neste horário (${WINDOW_TXT}; ${LEGAL.minianel}): a rota evita ${fmtKm(freeUsedM)} delas que o caminho livre usaria.`);
  } else if (pl.day.holiday && inSpWindows(ctx.at)) {
    summary.push(`Feriado (${pl.day.holiday.name}): a restrição de PP no Minianel não se aplica.`);
  }
  if (pl.fallbackIds.length) {
    W('hazmat_layer_stale', 'info', 'Parte dos traçados de PP não casou com a malha viária atual (tiles do Valhalla mudaram): rode de novo os importadores hazmat_trechos_der, hazmat_trechos_sudeste e hazmat_minianel_vias.');
  }
  if (pl.transientIds.length) {
    W('hazmat_layer_unverified', 'warn', `O Valhalla não respondeu a tempo ao validar ${pl.transientIds.length} traçado(s) de PP: parte das vias restritas pode ter ficado fora desta rota. Calcule de novo em instantes.`);
  }
  if (pl.tilesetUnconfirmed) {
    W('hazmat_tileset_unconfirmed', 'info', 'O Valhalla não confirmou a versão da malha (sem resposta do /status): as vias restritas para PP usaram os traçados da última importação.');
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
      const rule = `ZMRC: para PP só há liberação das 10h às 16h com AETC, caminhão de até 2 eixos traseiros e produto dos grupos consumo local/outros (${LEGAL.zmrc}).`;
      const axles = rearAxlesLe2(ctx);
      let msg: string;
      if (!group) msg = `${rule} Informe o nº ONU para saber se o produto é de consumo local/outros.`;
      else if (!group.interiorAllowed) msg = `${rule} Este produto (${group.label}) não se enquadra; vale a restrição geral de caminhões.`;
      else if (!ctx.vehicle.has_aetc) msg = `${rule} Sem AETC informada; vale a restrição geral de caminhões.`;
      else if (axles.tractor) msg = `${rule} Caminhão-trator (cavalo mecânico) não é autorizado (art. 35 §2º); vale a restrição geral de caminhões.`;
      else if (axles.ok === false) msg = `${rule} Veículo com mais de 2 eixos traseiros; vale a restrição geral de caminhões.`;
      else if (axles.ok === null) msg = `${rule} Produto e AETC se enquadram; confira se o caminhão tem até 2 eixos traseiros.`;
      else msg = `ZMRC: PP de consumo local/outros, com AETC e até 2 eixos traseiros, pode circular das 10h às 16h (${LEGAL.zmrc}).`;
      W('hazmat_zmrc', 'info', msg);
    }
  }

  // --- trechos proibidos com origem/destino lindeiro (só as regras que alcançam este veículo; uma vez por regra e ponta)
  const seenOD = new Set<string>();
  for (const t of nearOD) {
    if (!pl.appliedIds.has(t.id)) continue;
    const key = `${t.props.regra_id ?? t.id}:${t.which}`;
    if (seenOD.has(key)) continue;
    seenOD.add(key);
    const exc = String(t.props.excecoes ?? '').replace(/\.$/, '');
    const nome = t.props.via ?? t.name;
    const msg = /^nenhuma/i.test(exc)
      ? `${t.which === 'origem' ? 'Origem' : 'Destino'} junto ao trecho proibido para PP ${nome} (${t.props.norma}). A portaria não prevê exceção: comprove a necessidade à autoridade da via (${LEGAL.viaRestrita}).`
      : `${t.which === 'origem' ? 'Origem' : 'Destino'} junto ao trecho proibido para PP ${nome} (${t.props.norma}). Exceção: ${exc}.`;
    W('hazmat_trecho_lindeiro', 'warn', msg, { id: `${t.props.regra_id ? `trecho-${t.props.regra_id}` : t.id}:${t.which}` });
  }

  // --- trechos fora de SP: decisão por classe, isenção, exceção de Mocanguê e regras desativadas
  const trechosOut = sudesteTrechos(pl, tUse, W, summary);
  // --- regras registradas e não aplicadas, com aviso (Lei Rio 1.632/1990)
  const { dow: dowSaida, hhmm: hhmmSaida } = localParts(ctx.at);
  for (const z of zonasReg) {
    if (!z.aviso) continue;
    const perm = (z.janelas_permitidas ?? []) as TimeWindow[];
    if (perm.length && inTimeWindows(hhmmSaida, dowSaida, perm)) continue;
    W('hazmat_lei_municipal', 'info', `A rota passa pelo ${lcFirst(String(z.via))}, saindo às ${fmtH(ctx.at)}: ${lcFirst(String(z.regra))} (${z.norma}, ${z.artigo}). Regra registrada e NÃO aplicada — ${z.aviso_inativa ?? z.motivo_inativa}`,
      { id: `registrada-${z.regra_id}` });
  }

  // --- mananciais (aviso)
  if (aprm.length) {
    const tot = aprm.reduce((s, a) => s + a.len_m, 0);
    const txt = aprm.map((a) => `${a.name} ${fmtKm(a.len_m)}`).join(', ');
    if (hz.lqExempt) {
      W('hazmat_aprm', 'info', `${fmtKm(tot)} da rota em área de proteção de mananciais (${txt}). Em quantidade limitada, a carga está dispensada dessa limitação de itinerário (${LEGAL.mananciais}; ${LEGAL.qtdLimitada}). Em vazamento, ligue 193.`);
    } else {
      W('hazmat_aprm', 'warn', `${fmtKm(tot)} da rota em área de proteção de mananciais (${txt}). Evite parar nesses trechos e redobre a atenção (${LEGAL.mananciais}). Em vazamento, ligue 193.`);
    }
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
    const regra = hz.lqExempt
      ? `em quantidade limitada a carga está dispensada da regra de estacionamento (${LEGAL.estacionamento}; ${LEGAL.qtdLimitada})`
      : `descanso só em áreas indicadas, ${LEGAL.estacionamento}`;
    summary.push(`Paradas para PP na rota (ARTESP; ${regra}): ${paradasOut.slice(0, 5).map((p) => `km ${p.km_rota} (${p.concessionaria})`).join(', ')}${paradasOut.length > 5 ? '…' : ''}.`);
  }

  return {
    warnings, summary,
    data: {
      trechos: trechosOut,
      mocangue: pl.mocangue,
      produtos: hz.uns.map((u) => {
        const p = getProduct(u);
        return p ? { onu: u, nome: p.name, classe: p.cls, numero_risco: p.riskNumber, qtd_limitada_veiculo: p.lqVehicle } : { onu: u, desconhecido: true };
      }),
      grupo_sp: group ?? null,
      quantidade_limitada: hz.lq,
      /** dentro da quantidade limitada: dispensa só as limitações do RTPP; costLines do município e do DER continuam */
      isento_quantidade_limitada: hz.lqExempt,
      minianel: {
        regra_ativa_na_saida: pl.minianelActive, usado_m: Math.round(usedM), evitado_m: Math.round(freeUsedM), vias,
        vias_no_plano: pl.minianelRows, passagem_estimada: firstEta?.toISOString() ?? null, janela_na_passagem: etaInWindow,
      },
      cost_lines: pl.costLines.length,
      exclusoes_fallback: pl.exclusions.length,
      tracados: { desatualizados: pl.fallbackIds.length, sem_resposta: pl.transientIds.length, tileset_nao_confirmado: pl.tilesetUnconfirmed },
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
      return {
        name, tipo: p.ativa === false ? 'Trecho com regra de PP registrada (não aplicada)' : KIND_LABEL[kind],
        regra: `${p.regra}, ${p.janela}, ${p.sentidos} os sentidos`, norma: `${p.norma}, ${p.artigo}`, publicacao: p.publicacao,
        ...(p.regra_id ? {
          regra_id: p.regra_id,
          classes: Array.isArray(p.classes_proibidas) ? fmtList(p.classes_proibidas) : 'todas',
          isencao: p.isencao_texto, situacao: p.ativa === false ? `desativada: ${p.motivo_inativa}` : (p.situacao ?? 'vigente'),
        } : {}),
        excecoes: p.excecoes, ...(p.nota ? { nota: p.nota } : {}), geometria: p.geometria_fonte,
      };
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
