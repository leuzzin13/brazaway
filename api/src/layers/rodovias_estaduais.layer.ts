import * as turf from '@turf/turf';
import { env } from '../config.js';
import { query } from '../db.js';
import * as valhalla from '../services/valhalla.js';
import type { Ring } from '../services/valhalla.js';
import { isVucSP, type Vehicle } from '../services/vehicle.js';
import { featuresInBbox, featuresNearRoute, type DataFeatureRow } from './data.js';
import { runsNear } from './rodovias_horario.layer.js';
import type { LayerCostLine, LayerExclusion, LayerItem, LayerWarning, RouteCtx, RouteLayer } from './types.js';

/**
 * Rodovias estaduais fora de SP: Sudeste (MG, ES, RJ), Sul (PR, RS) e Centro-Oeste (GO, MT, DF) (camada 'rodovias_estaduais'). Doc: docs/layers/rodovias_estaduais.md.
 *
 * 1) Pontos críticos vivos do DER-MG (source 'der-mg', kind 'ponto_critico'; importador rodovias_estaduais_der_mg).
 *    Bloqueio duro, só no ponto (círculo de props.bloqueio.raio_m sobre a pista), e só quando o ponto está ATIVO (o
 *    importador só grava status 1/2/3; valid_to vence em 72 h sem nova carga) E o veículo é afetado:
 *      - 'interrompida' (Pista Interrompida, sem variante): todo veículo;
 *      - 'interrompida_pesados' (Pista interrompida para veículos pesados): todo caminhão (PBT > 3,5 t, CTB Anexo I),
 *        VUC inclusive. O DER-MG não define "pesado"; só o veículo até 3,5 t passa, com aviso;
 *      - limite de carga com valor em t (qnt_carga_limite) e veículo mais pesado.
 *    Interrompida COM variante, meia-pista e limite de carga sem valor só avisam (a via segue passável).
 *    Origem ou destino DENTRO do círculo, ou numa aresta do grafo que o círculo corta (todas as arestas onde o /locate
 *    do Valhalla encaixa o endereço saem com o círculo): não bloqueia e avisa (mesma política da ZMRC). Nos outros casos,
 *    bloqueia — um endereço a poucos metros, mas numa aresta que segue no grafo (ex.: a outra cabeceira da ponte), é
 *    alcançado pelo desvio.
 *    "Na rota" = a rota passa dentro do círculo de bloqueio (como passaPor da camada oae); sem bloqueio, a até 30 m.
 * 2) Regras de trecho dos DERs (kind 'regra_trecho'; importadores rodovias_estaduais_der_es, _der_rj, _der_pr, _daer_rs,
 *    _goinfra, _sinfra_mt e _der_df; curadoria em data/raw/ders_estaduais/regras.json). Regra `ativa` e vigente cujo
 *    critério alcança o veículo (e cujas `janelas`, se houver, valem no instante de saída) vira trecho penalizado
 *    (linear_cost_factors, fator 1000 = proibido salvo sem alternativa) recortado da própria rota, como em
 *    rodovias_horario. Regra desativada (confiança baixa/sem confirmação) só informa; revogada nunca é aplicada.
 *    O critério combina peso, eixos e comprimento com OU (ou E com `cumulativo`; `ou` lista combinações alternativas).
 */

const LAYER = 'rodovias_estaduais';
const FACTOR = Number(process.env.RODOVIAS_ESTADUAIS_FATOR ?? 1000);
/** ponto SEM bloqueio (variante, meia-pista, livre): distância máxima ponto da fonte ↔ rota para dizer que a rota passa
 *  por ele (pontos do DER-MG: mediana 4 m e p90 10 m da via do OSM). Ponto COM bloqueio: a rota cruza o círculo. */
const PERTO_ROTA_M = 30;
/** busca de candidatos perto da rota: o importador leva o bloqueio até 80 m do ponto da fonte (BUSCA_RODOVIA_M) e o
 *  círculo tem até 20 m de raio */
const BUSCA_PC_M = 100;
const RAIO_PADRAO_M = 20;
/** origem/destino numa aresta do grafo que o círculo corta (o exclude_polygons tira a aresta inteira e isolaria o
 *  endereço): /locate do Valhalla, só para origem/destino a até isto do ponto (aresta mais longa que isso é rara) */
const OD_ARESTA_MAX_M = 5000;
const LOCATE_TIMEOUT_MS = 5000;
/** origem/destino a até isto de um trecho com regra: não penaliza e avisa (destino no próprio trecho) */
const TRECHO_OD_M = 300;
/** tolerância rota ↔ eixo do SRE (o SRE do DER-ES desenha uma linha só nas pistas duplas) e trecho mínimo */
const TRECHO_TOL_M = 40;
const TRECHO_MIN_M = 200;
const MAX_ITER = 3;
const MAX_WARNINGS = 12;
const TRECHOS_TTL_MS = 5 * 60_000;

type Coord = [number, number];
export type Situacao = 'interrompida' | 'interrompida_pesados' | 'interrompida_com_variante' | 'meia_pista' | 'livre' | 'a_definir';
interface Bloqueio { pontos: Coord[]; raio_m: number; ajuste?: string; distancia_m?: number[] | null }
export interface PontoCriticoProps {
  orgao?: string; uf?: string; ativo?: boolean; objectid?: number; rodovia?: string | null; municipio?: string | null; trecho?: string | null;
  situacao: Situacao; trafeg_variante?: string | null; trafegabilidade?: string | null; solucao_trafego?: string | null;
  limite_carga?: string | null; limite_carga_t?: number | null; status?: string | null; status_final?: string | null; causa?: string | null;
  ativo_afetado?: string | null; faixa_interrompida?: string | null; obs_alternativa?: string | null; data_prevista?: string | null;
  criado_em?: string | null; editado_em?: string | null; consultado_em?: string | null; fonte_ultima_edicao?: string | null; fonte_url?: string;
  bloqueio?: Bloqueio | null;
}
/** Quem o ato alcança. Sem `cumulativo`, peso, eixos e comprimento combinam com OU (o ato lista limites que o veículo não
 *  pode exceder: passar de qualquer um já proíbe). Com `cumulativo`, todos os campos numéricos têm que valer (ex.: MT-040,
 *  Portaria SINFRA 010/2023: PBT > 45 t, mais de 6 eixos E mais de 16 m). `ou` lista combinações alternativas (cada uma
 *  avaliada como cumulativa), ex.: DAER-RS DN 148/2022 (CR6 ou CTS11). `isenta_carga`: cargo_type isento (GOINFRA: perecíveis). */
export interface CriterioTrecho {
  todos?: boolean; caminhoes?: boolean; exceto_vuc?: boolean;
  peso_acima_t?: number; peso_igual_ou_acima_t?: number; peso_ate_t?: number;
  eixos_acima?: number; eixos_ate?: number;
  comprimento_acima_m?: number; comprimento_ate_m?: number;
  cumulativo?: boolean; ou?: CriterioTrecho[]; isenta_carga?: string[];
}
/** Janela de vigência da regra no horário LOCAL de saída: `datas` (YYYY-MM-DD) e/ou `dias_semana` (1=seg … 7=dom), das
 *  `inicio` às `fim` (HH:MM; padrão o dia todo). Sem janelas, a regra vale sempre. */
export interface Janela { datas?: string[]; dias_semana?: number[]; inicio?: string; fim?: string }
export interface RegraTrechoProps {
  regra_id: string; orgao: string; uf: string; rodovia?: string | null; nome: string; trecho?: string | null;
  criterio: CriterioTrecho; horario?: string | null; ato: string; ato_url: string; publicacao?: string | null;
  status: 'vigente' | 'revogada' | 'desativada'; ativa: boolean; motivo_inativa?: string | null; confianca?: string | null;
  verificacao?: string | null; excecoes?: string | null; resumo: string; fonte_geometria?: string | null; janelas?: Janela[];
}
type PcRow = DataFeatureRow & { props: PontoCriticoProps };
interface Trecho { id: string; name: string; p: RegraTrechoProps; geometry: GeoJSON.LineString | GeoJSON.MultiLineString; bbox: [number, number, number, number] }

// ------------------------------------------------------------------------------------------------ regras

export const SITUACAO_LABEL: Record<Situacao, string> = {
  interrompida: 'pista interrompida',
  interrompida_pesados: 'pista interrompida para veículos pesados',
  interrompida_com_variante: 'pista interrompida, com variante (desvio) no local',
  meia_pista: 'meia-pista (pare e siga)',
  livre: 'pista livre (obra ou projeto em andamento)',
  a_definir: 'trafegabilidade a definir',
};

/** Veículo "pesado" para o DER-MG: caminhão (PBT > 3,5 t, CTB Anexo I), VUC inclusive. O DER-MG não define o termo; a
 *  definição de VUC do app (Portaria SMT 137/2018 de São Paulo) só limita largura, comprimento e idade, não o PBT, e o
 *  único caso ativo (MG-220, Santo Hipólito) é dano em OAE: só o veículo até 3,5 t passa. */
export function ehPesado(v: Vehicle): boolean {
  return v.is_truck;
}

export interface MotivoPC { code: 'pc_interrompida' | 'pc_interrompida_pesados' | 'pc_limite_carga'; regra: string; valor: number | null }

/** Por que este ponto crítico bloqueia este veículo (null = não bloqueia). Só ponto ativo. */
export function motivoBloqueioPC(p: PontoCriticoProps, v: Vehicle): MotivoPC | null {
  if (p.ativo === false) return null;
  if (p.situacao === 'interrompida') return { code: 'pc_interrompida', regra: SITUACAO_LABEL.interrompida, valor: null };
  if (p.situacao === 'interrompida_pesados' && ehPesado(v)) return { code: 'pc_interrompida_pesados', regra: SITUACAO_LABEL.interrompida_pesados, valor: null };
  const t = p.limite_carga_t;
  if (t != null && t > 0 && v.weight_t > t) return { code: 'pc_limite_carga', regra: `limite de carga ${fmtT(t)} t`, valor: t };
  return null;
}

/** Os limites numéricos de um critério, um booleano por limite informado (`>` estrito nos "acima de", como no texto dos atos). */
function condicoesNumericas(c: CriterioTrecho, v: Vehicle): boolean[] {
  const out: boolean[] = [];
  if (c.peso_acima_t != null) out.push(v.weight_t > c.peso_acima_t);
  if (c.peso_igual_ou_acima_t != null) out.push(v.weight_t >= c.peso_igual_ou_acima_t);
  if (c.peso_ate_t != null) out.push(v.weight_t <= c.peso_ate_t);
  if (c.eixos_acima != null) out.push(v.axle_count > c.eixos_acima);
  if (c.eixos_ate != null) out.push(v.axle_count <= c.eixos_ate);
  if (c.comprimento_acima_m != null) out.push(v.length_m > c.comprimento_acima_m);
  if (c.comprimento_ate_m != null) out.push(v.length_m <= c.comprimento_ate_m);
  return out;
}

/** O critério de uma regra de trecho alcança este veículo? */
export function criterioTrechoAplica(c: CriterioTrecho | undefined, v: Vehicle, ano: number): boolean {
  if (!c) return false;
  if (c.exceto_vuc && isVucSP(v, ano)) return false;
  if (c.isenta_carga?.length && v.cargo_type && c.isenta_carga.includes(v.cargo_type)) return false;
  if (c.todos) return true;
  if (c.caminhoes && !v.is_truck) return false;
  if (c.ou?.length) {
    return c.ou.some((s) => {
      const cs = condicoesNumericas(s, v);
      return cs.length > 0 && cs.every(Boolean);
    });
  }
  const cs = condicoesNumericas(c, v);
  // peso e eixos combinam com OU (ex.: Lei ES 4.463/1990: "mais de 2 eixos ou PBT acima de 15 t"), salvo `cumulativo`
  if (!cs.length) return !!c.caminhoes;
  return c.cumulativo ? cs.every(Boolean) : cs.some(Boolean);
}

/** A regra vale no instante de saída (hora local "YYYY-MM-DDTHH:mm")? Sem janelas, sempre. */
export function janelaVale(js: Janela[] | undefined, departureLocal: string): boolean {
  if (!js?.length) return true;
  const data = departureLocal.slice(0, 10), hora = departureLocal.slice(11, 16);
  const dow = ((new Date(`${data}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return js.some((j) => {
    const diaOk = (j.datas?.includes(data) ?? false) || (j.dias_semana?.includes(dow) ?? false) || (!j.datas?.length && !j.dias_semana?.length);
    return diaOk && hora >= (j.inicio ?? '00:00') && hora < (j.fim ?? '24:00');
  });
}

// ------------------------------------------------------------------------------------------------ utilidades

const fmtT = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
const fmtData = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);
const distM = (a: Coord, b: Coord) => turf.distance(a, b, { units: 'kilometers' }) * 1000;

function circleRing([lon, lat]: Coord, radiusM: number): Ring {
  const c = turf.circle([lon, lat], radiusM / 1000, { steps: 10, units: 'kilometers' });
  return (c.geometry.coordinates[0] as Coord[]).map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
}

/** Corredor (bbox origem–destino com folga) onde bloqueios e regras são calculados (igual à camada oae). */
function corridor(ctx: RouteCtx): [number, number, number, number] {
  const minX = Math.min(ctx.origin.lon, ctx.destination.lon), maxX = Math.max(ctx.origin.lon, ctx.destination.lon);
  const minY = Math.min(ctx.origin.lat, ctx.destination.lat), maxY = Math.max(ctx.origin.lat, ctx.destination.lat);
  const pad = Math.max(0.3, 0.25 * Math.max(maxX - minX, maxY - minY));
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}
const boxesTouch = (a: number[], b: number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

function pontoDe(r: PcRow): Coord {
  return (r.props.bloqueio?.pontos?.[0] ?? (r.geometry as GeoJSON.Point).coordinates) as Coord;
}

type OndeOD = 'origem' | 'destino' | null;

/**
 * Arestas do grafo (edge_id do /locate do Valhalla) por ponto. `maxM` = null: as arestas onde o ponto se encaixaria
 * numa rota (raio 0, como a origem/destino); número: todas a até essa distância (as que o círculo de bloqueio corta).
 * null se o Valhalla não responder.
 */
async function locateArestas(pts: { at: Coord; maxM: number | null }[]): Promise<Set<string>[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), LOCATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.valhallaUrl}/locate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({
        costing: 'truck', verbose: true,
        locations: pts.map((p) => ({ lon: p.at[0], lat: p.at[1], ...(p.maxM != null ? { radius: Math.ceil(p.maxM) } : {}) })),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { edges?: { distance?: number; edge_id?: { value?: number; tile_id?: number; level?: number; id?: number } }[] | null }[];
    if (!Array.isArray(json) || json.length !== pts.length) return null;
    return json.map((loc, i) => {
      const max = pts[i].maxM;
      // o /locate sempre devolve a aresta mais próxima, mesmo fora do raio
      const edges = (loc?.edges ?? []).filter((e) => max == null || (e.distance ?? Infinity) <= max);
      return new Set(edges.map((e) => String(e.edge_id?.value ?? `${e.edge_id?.level}/${e.edge_id?.tile_id}/${e.edge_id?.id}`)));
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const isencoes = new WeakMap<RouteCtx, Map<string, Promise<OndeOD>>>();

/**
 * A origem ou o destino está dentro do círculo de bloqueio (a até raio_m do ponto) ou numa aresta que o círculo corta
 * (todas as arestas onde o endereço se encaixa saem do grafo com o círculo)? Então o app não bloqueia (isolaria o
 * endereço) e avisa — a política da ZMRC. Fora disso, bloqueia: um endereço em outra aresta, mesmo a poucos metros (a
 * outra cabeceira de uma ponte de 40 m), segue alcançável pelo desvio. Mesmo resultado em exclusions() e annotate()
 * (cache por rota).
 */
function odNoBloqueio(ctx: RouteCtx, id: string, b: Bloqueio): Promise<OndeOD> {
  let m = isencoes.get(ctx);
  if (!m) { m = new Map(); isencoes.set(ctx, m); }
  let p = m.get(id);
  if (!p) { p = calcOdNoBloqueio(ctx, b); m.set(id, p); }
  return p;
}

async function calcOdNoBloqueio(ctx: RouteCtx, b: Bloqueio): Promise<OndeOD> {
  const raio = b.raio_m || RAIO_PADRAO_M;
  const od: [Exclude<OndeOD, null>, Coord][] = [['origem', [ctx.origin.lon, ctx.origin.lat]], ['destino', [ctx.destination.lon, ctx.destination.lat]]];
  const dist = od.map(([, c]) => Math.min(...b.pontos.map((p) => distM(p, c))));
  for (let i = 0; i < 2; i++) if (dist[i] <= raio) return od[i][0];
  const perto = [0, 1].filter((i) => dist[i] <= OD_ARESTA_MAX_M);
  if (!perto.length) return null;
  const r = await locateArestas([...perto.map((i) => ({ at: od[i][1], maxM: null })), ...b.pontos.map((p) => ({ at: p, maxM: raio }))]);
  if (!r) return null;   // sem Valhalla: mantém o bloqueio (a rota também não sai)
  const cortadas = new Set(r.slice(perto.length).flatMap((s) => [...s]));
  // isolado = TODAS as arestas candidatas do endereço saem com o círculo (no meio da aresta: ela e a de sentido oposto);
  // num nó com outras arestas livres o endereço segue alcançável e o bloqueio fica
  for (let k = 0; k < perto.length; k++) {
    if (r[k].size && [...r[k]].every((e) => cortadas.has(e))) return od[perto[k]][0];
  }
  return null;
}

/** A linha passa pelo ponto crítico? Com bloqueio: cruza o círculo (raio_m); sem bloqueio: a até PERTO_ROTA_M do ponto da fonte. */
function passaPeloPC(line: GeoJSON.Feature<GeoJSON.LineString>, r: PcRow & { distance_m: number }): boolean {
  const b = r.props.bloqueio;
  if (b?.pontos?.length) {
    const raio = b.raio_m || RAIO_PADRAO_M;
    return b.pontos.some((pt) => turf.pointToLineDistance(turf.point(pt), line, { units: 'meters' }) <= raio);
  }
  return r.distance_m <= PERTO_ROTA_M;
}

function odPertoDoTrecho(ctx: RouteCtx, g: Trecho['geometry']): 'origem' | 'destino' | null {
  const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  const dist = (p: Coord) => Math.min(...lines.map((c) => turf.pointToLineDistance(turf.point(p), turf.lineString(c), { units: 'meters' })));
  if (dist([ctx.origin.lon, ctx.origin.lat]) <= TRECHO_OD_M) return 'origem';
  if (dist([ctx.destination.lon, ctx.destination.lat]) <= TRECHO_OD_M) return 'destino';
  return null;
}

function descrevePC(p: PontoCriticoProps): string {
  const onde = `${p.rodovia ?? 'rodovia estadual'}${p.municipio ? ` (${p.municipio})` : ''}`;
  const causa = p.causa && p.causa !== 'A definir' ? ` — ${p.causa}` : '';
  return `${onde}: ${SITUACAO_LABEL[p.situacao] ?? p.situacao}${causa}`;
}

function detalhesPC(p: PontoCriticoProps, hoje: string): string {
  const out: string[] = [];
  const prev = fmtData(p.data_prevista);
  if (prev) out.push(p.data_prevista!.slice(0, 10) < hoje ? `previsão do DER-MG vencida em ${prev}` : `previsão do DER-MG: ${prev}`);
  const alt = (p.obs_alternativa ?? '').replace(/\s+/g, ' ').trim();
  if (alt && !/^nenhuma\.?$/i.test(alt)) out.push(`alternativa indicada: "${alt.length > 160 ? `${alt.slice(0, 157)}...` : alt}"`);
  const ed = fmtData(p.editado_em);
  out.push(`fonte: DER-MG, pontos críticos${ed ? ` (registro editado em ${ed})` : ''}`);
  return out.join('; ');
}

function itemPC(r: PcRow, m: MotivoPC | null): LayerItem {
  const [lon, lat] = pontoDe(r);
  return { kind: 'layer', layer: LAYER, id: r.id, name: `Ponto crítico DER-MG ${r.props.rodovia ?? ''}${r.props.municipio ? ` (${r.props.municipio})` : ''}`.replace(/\s+/g, ' ').trim(), type: 'ponto_critico', rule: m?.regra ?? SITUACAO_LABEL[r.props.situacao], value_num: m?.valor ?? null, lat, lon, note: r.props.fonte_url ?? 'DER-MG' };
}

// ------------------------------------------------------------------------------------------------ regras de trecho (cache)

let trechosCache: { at: number; p: Promise<Trecho[]> } | null = null;
async function loadTrechos(): Promise<Trecho[]> {
  if (trechosCache && Date.now() - trechosCache.at < TRECHOS_TTL_MS) return trechosCache.p;
  const p = (async () => {
    const r = await query<{ id: string; name: string; props: RegraTrechoProps; geometry: Trecho['geometry'] }>(
      `select id::text, name, props, ST_AsGeoJSON(geom, 6)::json as geometry from data_features
        where layer_id = $1 and kind = 'regra_trecho' and (valid_to is null or valid_to > now())`, [LAYER]);
    return r.rows
      .filter((x) => x.geometry && (x.geometry.type === 'LineString' || x.geometry.type === 'MultiLineString'))
      .map((x) => ({ id: x.id, name: x.name, p: x.props, geometry: x.geometry, bbox: turf.bbox(x.geometry) as Trecho['bbox'] }));
  })();
  trechosCache = { at: Date.now(), p };
  p.catch(() => { trechosCache = null; });
  return p;
}

function itemTrecho(t: Trecho, at: Coord): LayerItem {
  return { kind: 'layer', layer: LAYER, id: t.id, name: t.p.nome, type: 'regra_trecho', rule: t.p.resumo, value_num: t.p.criterio.peso_acima_t ?? null, lon: at[0], lat: at[1], note: t.p.ato };
}

interface Stash { lines: LayerCostLine[]; isentos: { t: Trecho; onde: 'origem' | 'destino' }[] }
const stash = new WeakMap<RouteCtx, Promise<Stash>>();

function prepare(ctx: RouteCtx): Promise<Stash> {
  let s = stash.get(ctx);
  if (!s) { s = doPrepare(ctx); stash.set(ctx, s); }
  return s;
}

async function doPrepare(ctx: RouteCtx): Promise<Stash> {
  const out: Stash = { lines: [], isentos: [] };
  const ano = Number(ctx.departureLocal.slice(0, 4));
  const box = corridor(ctx);
  const alvo: Trecho[] = [];
  for (const t of await loadTrechos()) {
    if (!t.p.ativa || t.p.status !== 'vigente' || !boxesTouch(t.bbox, box) || !criterioTrechoAplica(t.p.criterio, ctx.vehicle, ano)
      || !janelaVale(t.p.janelas, ctx.departureLocal)) continue;
    const onde = odPertoDoTrecho(ctx, t.geometry);
    if (onde) out.isentos.push({ t, onde }); else alvo.push(t);
  }
  if (!alvo.length) return out;
  const base = { origin: ctx.origin, destination: ctx.destination, vehicle: ctx.vehicle, departureLocal: ctx.departureLocal };
  let r: valhalla.ValhallaRouteResult;
  try { r = await valhalla.route(base); } catch { return out; }
  const seen = new Set<string>();
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let novos = 0;
    for (const t of alvo) {
      for (const run of runsNear(r.coordinates, t.geometry, TRECHO_TOL_M, TRECHO_MIN_M)) {
        const a = r.coordinates[run[0]], b = r.coordinates[run[1]];
        const key = `${t.id}:${a[0].toFixed(4)},${a[1].toFixed(4)}:${b[0].toFixed(4)},${b[1].toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        novos++;
        const mid = r.coordinates[Math.floor((run[0] + run[1]) / 2)] as Coord;
        out.lines.push({ item: itemTrecho(t, mid), coordinates: r.coordinates.slice(run[0], run[1] + 1), factor: FACTOR });
      }
    }
    if (!novos || iter === MAX_ITER - 1) break;
    try {
      r = await valhalla.route({ ...base, costLines: out.lines.map((c) => ({ coordinates: c.coordinates, factor: c.factor })) });
    } catch { break; }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ mapa

const COR: Record<string, string> = {
  interrompida: '#dc2626', interrompida_pesados: '#ea580c', interrompida_com_variante: '#f59e0b', meia_pista: '#eab308',
  livre: '#64748b', a_definir: '#94a3b8',
};

function displayProps(r: DataFeatureRow): Record<string, unknown> {
  if (r.kind === 'ponto_critico') {
    const p = r.props as unknown as PontoCriticoProps;
    return {
      id: r.id, name: r.name, kind: r.kind, source: r.source, color: COR[p.situacao] ?? '#64748b',
      situacao: SITUACAO_LABEL[p.situacao] ?? p.situacao, rodovia: p.rodovia, municipio: p.municipio, causa: p.causa,
      ativo_afetado: p.ativo_afetado, status_obra: p.status, previsao: fmtData(p.data_prevista),
      limite_carga: p.limite_carga_t != null ? `${fmtT(p.limite_carga_t)} t` : p.limite_carga === 'Sim' ? 'sim (valor não publicado)' : null,
      alternativa: p.obs_alternativa, editado_em: fmtData(p.editado_em), consultado_em: fmtData(p.consultado_em),
      bloqueia: p.situacao === 'interrompida' ? 'todos os veículos' : p.situacao === 'interrompida_pesados' ? 'caminhões (PBT acima de 3,5 t, VUC inclusive)' : p.limite_carga_t ? `acima de ${fmtT(p.limite_carga_t)} t` : 'não (só aviso)',
    };
  }
  const p = r.props as unknown as RegraTrechoProps;
  return {
    id: r.id, name: r.name, kind: r.kind, source: r.source, color: p.ativa && p.status === 'vigente' ? '#b91c1c' : '#9ca3af',
    regra: p.resumo, situacao: p.ativa && p.status === 'vigente' ? 'aplicada na rota' : p.status === 'revogada' ? 'revogada (não aplicada)' : 'desativada (não aplicada)',
    motivo: p.motivo_inativa ?? null, ato: p.ato, publicacao: p.publicacao, confianca: p.confianca, fonte_url: p.ato_url,
  };
}

// ------------------------------------------------------------------------------------------------ camada

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Rodovias estaduais (DERs de MG, ES, RJ, PR, RS, GO, MT, DF)',
    description: 'Pontos críticos vivos do DER-MG (pista interrompida bloqueia; interrompida para pesados bloqueia caminhão acima de 3,5 t, VUC inclusive; variante e meia-pista avisam) e restrições de trecho (peso, eixos, comprimento, feriados) dos DERs do ES, RJ, PR, RS, GO, MT e DF com ato confirmado.',
    group: 'restricoes',
    sources: [
      { name: 'DER-MG/SEINFRA — Pontos críticos (Observatório da Infraestrutura, painel público)', url: 'https://observatorio.infraestrutura.mg.gov.br/server/rest/services/00_PUBLICACOES/pontos_criticos_publico/FeatureServer/0', license: 'Não declarada (licenseInfo vazio); site do DER-MG: reutilização com fonte e crédito. Risco de uso comercial: ver docs/layers/rodovias_estaduais.md' },
      { name: 'DER-ES — Instruções de Serviço de restrição de tráfego (DIO-ES)', url: 'https://ioes.dio.es.gov.br/busca', license: 'Ato oficial — domínio público (Lei 9.610/98, art. 8º, IV)' },
      { name: 'DER-ES — SRE (malha com km), WFS do GEOBASES', url: 'https://ide.geobases.es.gov.br/geoserver/ows', license: 'Não declarada ("Not Specified" no GEOBASES); só localiza os trechos dos atos' },
      { name: 'DER-RJ — notícias oficiais (RJ-127, Serra de Paracambi)', url: 'https://www.der.rj.gov.br/detalhe_noticia.asp?ident=1035', license: 'Fatos de notícia oficial, com citação (rodapé PRODERJ: todos os direitos reservados)' },
      { name: 'DER-PR, DAER-RS, GOINFRA, SINFRA-MT e DER-DF — portarias, decisões normativas e instruções de restrição de trecho', url: 'https://www.der.pr.gov.br/Pagina/Restricao-de-Trafego', license: 'Ato oficial — domínio público (Lei 9.610/98, art. 8º, IV); pontas dos trechos pelo SRE do órgão (licença não declarada)' },
      { name: 'OpenStreetMap (traçado da RJ-127 via Valhalla, trechos dos atos do Sul e Centro-Oeste e pistas para o ponto de bloqueio)', url: 'https://www.openstreetmap.org/copyright', license: '© OpenStreetMap contributors (ODbL 1.0)' },
    ],
    style: { kind: 'circle', color: '#dc2626', radius: 5, width: 3, minzoom: 6, icon: '🚧', opacity: 0.9 },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 10;
    // no zoom baixo, só o que restringe (as centenas de pontos "livres" poluem o mapa)
    const where = z < 9 ? `kind = 'regra_trecho' or props->>'situacao' <> 'livre'` : undefined;
    const rows = await featuresInBbox(LAYER, bbox, { limit: 3000, where: where ? `(${where}) and coalesce(props->>'status', '') <> 'revogada'` : `coalesce(props->>'status', '') <> 'revogada'` });
    return { type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', id: r.id, geometry: r.geometry, properties: displayProps(r) })) };
  },

  async exclusions(ctx) {
    const [x0, y0, x1, y1] = corridor(ctx);
    // valid_to dos pontos vivos é a validade da CARGA (consulta + 72 h), não o fim da interdição: compara com agora, não
    // com a saída (uma viagem marcada para daqui a 5 dias usa a situação conhecida hoje)
    const r = await query<PcRow>(
      `select id::text, layer_id, source, source_id, name, kind, props, ST_AsGeoJSON(geom, 6)::json as geometry, valid_from, valid_to
         from data_features
        where layer_id = $1 and kind = 'ponto_critico' and jsonb_typeof(props->'bloqueio') = 'object'
          and (valid_to is null or valid_to > now())
          and geom && ST_MakeEnvelope($2,$3,$4,$5,4326)
        limit 2000`,
      [LAYER, x0, y0, x1, y1],
    );
    const out: LayerExclusion[] = [];
    for (const row of r.rows) {
      const b = row.props.bloqueio;
      if (!b?.pontos?.length) continue;
      const m = motivoBloqueioPC(row.props, ctx.vehicle);
      if (!m) continue;
      if (await odNoBloqueio(ctx, row.id, b)) continue;   // endereço na aresta do bloqueio: annotate avisa
      out.push({ item: itemPC(row, m), rings: b.pontos.map((pt) => circleRing(pt, b.raio_m || RAIO_PADRAO_M)) });
    }
    return out;
  },

  async costLines(ctx) {
    return (await prepare(ctx)).lines;
  },

  async annotate(ctx, route) {
    const v = ctx.vehicle;
    const ano = Number(ctx.departureLocal.slice(0, 4));
    const hoje = ctx.departureLocal.slice(0, 10);
    const line = route.line;
    const free = route.free?.line ?? null;
    const warnings: (LayerWarning & { _f?: number })[] = [];
    const summary: string[] = [];

    // ---- 1) pontos críticos do DER-MG na rota restrita e na rota livre (círculo de bloqueio; sem bloqueio, 30 m)
    type Near = PcRow & { fraction: number; distance_m: number; naRota: boolean; naLivre: boolean };
    const near = new Map<string, Near>();
    for (const r of await featuresNearRoute(LAYER, line.geometry, BUSCA_PC_M, { where: `kind = 'ponto_critico'` })) {
      const row = r as unknown as Near;
      if (passaPeloPC(line, row)) near.set(r.id, { ...row, naRota: true, naLivre: false });
    }
    if (free) {
      for (const r of await featuresNearRoute(LAYER, free.geometry, BUSCA_PC_M, { where: `kind = 'ponto_critico'` })) {
        const row = r as unknown as Near;
        if (!passaPeloPC(free, row)) continue;
        const e = near.get(r.id);
        if (e) e.naLivre = true; else near.set(r.id, { ...row, fraction: 1, naRota: false, naLivre: true });
      }
    }
    const cont: Record<string, number> = {};
    const pcData: unknown[] = [];
    let ultimaEdicao: string | null = null;
    for (const r of near.values()) {
      const p = r.props;
      if (p.fonte_ultima_edicao && (!ultimaEdicao || p.fonte_ultima_edicao > ultimaEdicao)) ultimaEdicao = p.fonte_ultima_edicao;
      const m = motivoBloqueioPC(p, v);
      const [lon, lat] = pontoDe(r);
      const base = { layer: LAYER, id: r.id, lat, lon, _f: r.fraction };
      const desc = descrevePC(p);
      const det = detalhesPC(p, hoje);
      if (r.naRota) cont[p.situacao] = (cont[p.situacao] ?? 0) + 1;
      // origem/destino no ponto: isento do bloqueio (mesma decisão de exclusions(), em cache por rota)
      const onde = m && p.bloqueio?.pontos?.length ? await odNoBloqueio(ctx, r.id, p.bloqueio) : null;
      pcData.push({ id: r.id, objectid: p.objectid, rodovia: p.rodovia, municipio: p.municipio, situacao: p.situacao, bloqueia_veiculo: !!m && !onde, isento_origem_destino: onde, na_rota: r.naRota, desviado: !r.naRota && r.naLivre && !!m && !onde });
      if (m) {
        if (r.naRota) {
          warnings.push({
            ...base, severity: 'danger', code: onde ? 'pc_origem_destino' : 'pc_bloqueio_na_rota',
            message: onde
              ? `${onde === 'origem' ? 'A origem' : 'O destino'} fica no trecho de um ponto crítico do DER-MG (${desc}). O app não bloqueou o ponto para não isolar o endereço: confira o acesso antes de sair (${det}).`
              : p.bloqueio?.pontos?.length
                ? `A rota passa por ponto crítico do DER-MG sem alternativa razoável (${desc}). Não siga sem confirmar a passagem (${det}).`
                : `A rota passa por ponto crítico do DER-MG (${desc}) que o app não conseguiu localizar na pista para bloquear. Procure outro caminho (${det}).`,
          });
        } else if (r.naLivre && !onde) {   // isento (endereço no ponto): a camada não o excluiu, não houve desvio por ele
          warnings.push({ ...base, severity: 'warn', code: 'pc_desvio', message: `Rota desviada de ponto crítico do DER-MG (${desc}; ${det}).` });
        }
        continue;
      }
      if (!r.naRota) continue;
      if (p.situacao === 'interrompida_pesados') {
        warnings.push({ ...base, severity: 'warn', code: 'pc_pesados_liberado', message: `Ponto crítico do DER-MG (${desc}). O DER-MG não define "veículo pesado"; o app só libera veículo de até 3,5 t de PBT (não é caminhão pelo CTB, Anexo I), como o seu. Confira a sinalização no local (${det}).` });
      } else if (p.situacao === 'interrompida_com_variante') {
        warnings.push({ ...base, severity: 'warn', code: 'pc_variante', message: `Ponto crítico do DER-MG (${desc}). A passagem é pela variante, que pode ser estreita ou de terra para veículo grande: confira antes (${det}).` });
      } else if (p.situacao === 'meia_pista') {
        const faixa = p.faixa_interrompida ? ` (${p.faixa_interrompida.replace(/\s+/g, ' ').trim()})` : '';
        warnings.push({ ...base, severity: 'warn', code: 'pc_meia_pista', message: `Ponto crítico do DER-MG (${desc})${faixa}: trânsito em meia-pista, com pare e siga. Atenção a veículo largo ou longo (${det}).` });
      } else if (p.limite_carga === 'Sim' && p.limite_carga_t == null) {
        warnings.push({ ...base, severity: 'warn', code: 'pc_limite_carga_sem_valor', message: `Ponto crítico do DER-MG (${desc}) marcado com limite de carga, sem o valor publicado. Confira a placa antes de passar (${det}).` });
      } else if (p.limite_carga_t != null) {
        warnings.push({ ...base, severity: 'info', code: 'pc_limite_carga_ok', message: `Ponto crítico do DER-MG (${desc}) com limite de ${fmtT(p.limite_carga_t)} t; seu veículo (${fmtT(v.weight_t)} t) está dentro (${det}).` });
      }
    }
    const nNaRota = Object.values(cont).reduce((a, b) => a + b, 0);
    if (nNaRota) {
      const partes = (['interrompida', 'interrompida_pesados', 'interrompida_com_variante', 'meia_pista', 'livre', 'a_definir'] as Situacao[])
        .filter((s) => cont[s]).map((s) => `${cont[s]} ${SITUACAO_LABEL[s]}`);
      summary.push(`${nNaRota} ponto(s) crítico(s) do DER-MG na rota: ${partes.join('; ')}.${ultimaEdicao ? ` Última edição na fonte: ${fmtData(ultimaEdicao)}.` : ''}`);
    }

    // ---- 2) regras de trecho (DER-ES, DER-RJ)
    const { isentos } = await prepare(ctx);
    const coords = line.geometry.coordinates as Coord[];
    const freeCoords = (free?.geometry.coordinates ?? null) as Coord[] | null;
    const rbox = turf.bbox(line);
    const fbox = free ? turf.bbox(free) : null;
    const trechoData: unknown[] = [];
    for (const t of await loadTrechos()) {
      if (t.p.status === 'revogada') continue;
      const runs = boxesTouch(t.bbox, rbox) ? runsNear(coords, t.geometry, TRECHO_TOL_M, TRECHO_MIN_M) : [];
      const runsLivre = freeCoords && fbox && boxesTouch(t.bbox, fbox) ? runsNear(freeCoords, t.geometry, TRECHO_TOL_M, TRECHO_MIN_M) : [];
      if (!runs.length && !runsLivre.length) continue;
      const ativa = t.p.ativa && t.p.status === 'vigente';
      const aplica = criterioTrechoAplica(t.p.criterio, v, ano);
      const at = (runs.length ? coords[Math.floor((runs[0][0] + runs[0][1]) / 2)] : freeCoords![Math.floor((runsLivre[0][0] + runsLivre[0][1]) / 2)]) as Coord;
      const base = { layer: LAYER, id: t.id, lon: at[0], lat: at[1], _f: runs.length ? runs[0][0] / Math.max(1, coords.length - 1) : 1 };
      trechoData.push({ id: t.id, regra_id: t.p.regra_id, nome: t.p.nome, ativa, aplica_ao_veiculo: aplica, na_rota: runs.length > 0, desviada: !runs.length && runsLivre.length > 0, ato: t.p.ato });
      if (!ativa) {
        if (runs.length) {
          warnings.push({ ...base, severity: 'info', code: 'regra_estadual_nao_aplicada', message: `${t.p.nome}: ${t.p.resumo} (${t.p.ato}). Regra registrada mas NÃO aplicada pelo app: ${t.p.motivo_inativa ?? 'sem confirmação de vigência'}. Confira a sinalização.` });
        }
        continue;
      }
      if (!aplica) {
        if (runs.length) summary.push(`${t.p.nome}: ${t.p.resumo}; não alcança o seu veículo (${t.p.ato}).`);
        continue;
      }
      if (!janelaVale(t.p.janelas, ctx.departureLocal)) {
        // restrição de horário/data que não vale na saída: o app só vê o instante de saída, a viagem pode chegar ao trecho depois
        if (runs.length) {
          warnings.push({ ...base, severity: 'info', code: 'regra_estadual_fora_da_janela', message: `${t.p.nome}: ${t.p.resumo} (${t.p.ato}). Não vale na data e hora de saída informadas; o app confere só o instante de saída, então confira o horário em que você chega ao trecho.` });
        }
        continue;
      }
      const isento = isentos.find((x) => x.t.id === t.id);
      if (runs.length) {
        warnings.push({
          ...base, severity: 'danger', code: isento ? 'regra_estadual_origem_destino' : 'regra_estadual_na_rota',
          message: isento
            ? `${isento.onde === 'origem' ? 'A origem' : 'O destino'} fica no trecho com restrição (${t.p.nome}: ${t.p.resumo}; ${t.p.ato}). O app não evitou o trecho: confira se há exceção ou autorização para o seu caso.`
            : `A rota usa trecho proibido para o seu veículo sem alternativa razoável: ${t.p.nome} (${t.p.resumo}; ${t.p.ato}).`,
        });
      } else {
        warnings.push({ ...base, severity: 'warn', code: 'regra_estadual_desvio', message: `Rota desviada de ${t.p.nome}: ${t.p.resumo} (${t.p.ato}).` });
      }
    }

    const sev = { danger: 0, warn: 1, info: 2 } as const;
    warnings.sort((a, b) => sev[a.severity ?? 'info'] - sev[b.severity ?? 'info'] || (a._f ?? 1) - (b._f ?? 1));
    const kept = warnings.filter((w, i) => w.severity === 'danger' || i < MAX_WARNINGS).map(({ _f, ...w }) => w);
    return { summary, warnings: kept, data: { pontos_criticos: pcData, trechos: trechoData, fonte_ultima_edicao: ultimaEdicao } };
  },
};

export default layer;
