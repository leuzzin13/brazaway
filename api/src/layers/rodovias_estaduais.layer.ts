import * as turf from '@turf/turf';
import { query } from '../db.js';
import * as valhalla from '../services/valhalla.js';
import type { Ring } from '../services/valhalla.js';
import { isVucSP, type Vehicle } from '../services/vehicle.js';
import { featuresInBbox, featuresNearRoute, type DataFeatureRow } from './data.js';
import { runsNear } from './rodovias_horario.layer.js';
import type { LayerCostLine, LayerExclusion, LayerItem, LayerWarning, RouteCtx, RouteLayer } from './types.js';

/**
 * Rodovias estaduais do Sudeste fora de SP (camada 'rodovias_estaduais'). Doc: docs/layers/rodovias_estaduais.md.
 *
 * 1) Pontos críticos vivos do DER-MG (source 'der-mg', kind 'ponto_critico'; importador rodovias_estaduais_der_mg).
 *    Bloqueio duro, só no ponto (círculo de props.bloqueio.raio_m sobre a pista), e só quando o ponto está ATIVO (o
 *    importador só grava status 1/2/3; valid_to vence em 72 h sem nova carga) E o veículo é afetado:
 *      - 'interrompida' (Pista Interrompida, sem variante): todo veículo;
 *      - 'interrompida_pesados' (Pista interrompida para veículos pesados): caminhão (PBT > 3,5 t, CTB Anexo I) que não
 *        é VUC. O DER-MG não define "pesado"; VUC e veículo leve passam com aviso (decisão de produto, documentada);
 *      - limite de carga com valor em t (qnt_carga_limite) e veículo mais pesado.
 *    Interrompida COM variante, meia-pista e limite de carga sem valor só avisam (a via segue passável).
 *    Origem ou destino a até PROX_OD_M de um ponto que bloquearia: não bloqueia e avisa (mesma política da ZMRC).
 * 2) Regras de trecho dos DERs (kind 'regra_trecho'; importadores rodovias_estaduais_der_es e _der_rj; curadoria em
 *    data/raw/ders_estaduais/regras.json). Regra `ativa` e vigente cujo critério alcança o veículo vira trecho
 *    penalizado (linear_cost_factors, fator 1000 = proibido salvo sem alternativa) recortado da própria rota, como em
 *    rodovias_horario. Regra desativada (confiança baixa/sem confirmação) só informa; revogada nunca é aplicada.
 */

const LAYER = 'rodovias_estaduais';
const FACTOR = Number(process.env.RODOVIAS_ESTADUAIS_FATOR ?? 1000);
/** distância máxima ponto crítico ↔ rota para dizer que a rota passa pelo ponto (pontos do DER-MG: mediana 4 m e p90 10 m da via do OSM) */
const PERTO_ROTA_M = 30;
/** origem/destino a até isto de um ponto de bloqueio: não bloqueia e avisa (o círculo tiraria do grafo a aresta onde o endereço está) */
export const PROX_OD_M = 1000;
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
export interface CriterioTrecho { todos?: boolean; caminhoes?: boolean; exceto_vuc?: boolean; peso_acima_t?: number; eixos_acima?: number }
export interface RegraTrechoProps {
  regra_id: string; orgao: string; uf: string; rodovia?: string | null; nome: string; trecho?: string | null;
  criterio: CriterioTrecho; horario?: string | null; ato: string; ato_url: string; publicacao?: string | null;
  status: 'vigente' | 'revogada' | 'desativada'; ativa: boolean; motivo_inativa?: string | null; confianca?: string | null;
  verificacao?: string | null; excecoes?: string | null; resumo: string; fonte_geometria?: string | null;
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

/** Veículo "pesado" para o DER-MG: caminhão (PBT > 3,5 t, CTB Anexo I) que não é VUC. O DER-MG não define o termo. */
export function ehPesado(v: Vehicle, ano: number): boolean {
  return v.is_truck && !isVucSP(v, ano);
}

export interface MotivoPC { code: 'pc_interrompida' | 'pc_interrompida_pesados' | 'pc_limite_carga'; regra: string; valor: number | null }

/** Por que este ponto crítico bloqueia este veículo (null = não bloqueia). Só ponto ativo. */
export function motivoBloqueioPC(p: PontoCriticoProps, v: Vehicle, ano: number): MotivoPC | null {
  if (p.ativo === false) return null;
  if (p.situacao === 'interrompida') return { code: 'pc_interrompida', regra: SITUACAO_LABEL.interrompida, valor: null };
  if (p.situacao === 'interrompida_pesados' && ehPesado(v, ano)) return { code: 'pc_interrompida_pesados', regra: SITUACAO_LABEL.interrompida_pesados, valor: null };
  const t = p.limite_carga_t;
  if (t != null && t > 0 && v.weight_t > t) return { code: 'pc_limite_carga', regra: `limite de carga ${fmtT(t)} t`, valor: t };
  return null;
}

/** O critério de uma regra de trecho alcança este veículo? (`>` estrito no peso e nos eixos, como no texto dos atos) */
export function criterioTrechoAplica(c: CriterioTrecho | undefined, v: Vehicle, ano: number): boolean {
  if (!c) return false;
  if (c.exceto_vuc && isVucSP(v, ano)) return false;
  if (c.todos) return true;
  if (c.caminhoes && !v.is_truck) return false;
  let ok = !!c.caminhoes;
  if (c.peso_acima_t != null) ok = v.weight_t > c.peso_acima_t;
  if (c.eixos_acima != null) ok = ok || v.axle_count > c.eixos_acima;
  return ok;
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

/** Origem ou destino perto do ponto de bloqueio? */
function odPerto(ctx: RouteCtx, pontos: Coord[], m: number): 'origem' | 'destino' | null {
  const o: Coord = [ctx.origin.lon, ctx.origin.lat], d: Coord = [ctx.destination.lon, ctx.destination.lat];
  if (pontos.some((p) => distM(p, o) <= m)) return 'origem';
  if (pontos.some((p) => distM(p, d) <= m)) return 'destino';
  return null;
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
    if (!t.p.ativa || t.p.status !== 'vigente' || !boxesTouch(t.bbox, box) || !criterioTrechoAplica(t.p.criterio, ctx.vehicle, ano)) continue;
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
      bloqueia: p.situacao === 'interrompida' ? 'todos os veículos' : p.situacao === 'interrompida_pesados' ? 'caminhões (exceto VUC)' : p.limite_carga_t ? `acima de ${fmtT(p.limite_carga_t)} t` : 'não (só aviso)',
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
    label: 'Rodovias estaduais (DER-MG, DER-ES, DER-RJ)',
    description: 'Pontos críticos vivos do DER-MG (pista interrompida bloqueia; interrompida para pesados bloqueia caminhão que não é VUC; variante e meia-pista avisam) e restrições de trecho dos DERs do ES e do RJ com ato confirmado.',
    group: 'restricoes',
    sources: [
      { name: 'DER-MG/SEINFRA — Pontos críticos (Observatório da Infraestrutura, painel público)', url: 'https://observatorio.infraestrutura.mg.gov.br/server/rest/services/00_PUBLICACOES/pontos_criticos_publico/FeatureServer/0', license: 'Não declarada (licenseInfo vazio); site do DER-MG: reutilização com fonte e crédito. Risco de uso comercial: ver docs/layers/rodovias_estaduais.md' },
      { name: 'DER-ES — Instruções de Serviço de restrição de tráfego (DIO-ES)', url: 'https://ioes.dio.es.gov.br/busca', license: 'Ato oficial — domínio público (Lei 9.610/98, art. 8º, IV)' },
      { name: 'DER-ES — SRE (malha com km), WFS do GEOBASES', url: 'https://ide.geobases.es.gov.br/geoserver/ows', license: 'Não declarada ("Not Specified" no GEOBASES); só localiza os trechos dos atos' },
      { name: 'DER-RJ — notícias oficiais (RJ-127, Serra de Paracambi)', url: 'https://www.der.rj.gov.br/detalhe_noticia.asp?ident=1035', license: 'Fatos de notícia oficial, com citação (rodapé PRODERJ: todos os direitos reservados)' },
      { name: 'OpenStreetMap (traçado da RJ-127 via Valhalla e pistas para o ponto de bloqueio)', url: 'https://www.openstreetmap.org/copyright', license: '© OpenStreetMap contributors (ODbL 1.0)' },
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
    const ano = Number(ctx.departureLocal.slice(0, 4));
    const out: LayerExclusion[] = [];
    for (const row of r.rows) {
      const b = row.props.bloqueio;
      if (!b?.pontos?.length) continue;
      const m = motivoBloqueioPC(row.props, ctx.vehicle, ano);
      if (!m) continue;
      if (odPerto(ctx, b.pontos, PROX_OD_M)) continue;   // annotate avisa
      out.push({ item: itemPC(row, m), rings: b.pontos.map((pt) => circleRing(pt, b.raio_m || 20)) });
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

    // ---- 1) pontos críticos do DER-MG perto da rota restrita e da rota livre
    const near = new Map<string, PcRow & { fraction: number; naRota: boolean; naLivre: boolean }>();
    for (const r of await featuresNearRoute(LAYER, line.geometry, PERTO_ROTA_M, { where: `kind = 'ponto_critico'` })) {
      near.set(r.id, { ...(r as unknown as PcRow & { fraction: number }), naRota: true, naLivre: false });
    }
    if (free) {
      for (const r of await featuresNearRoute(LAYER, free.geometry, PERTO_ROTA_M, { where: `kind = 'ponto_critico'` })) {
        const e = near.get(r.id);
        if (e) e.naLivre = true; else near.set(r.id, { ...(r as unknown as PcRow & { fraction: number }), fraction: 1, naRota: false, naLivre: true });
      }
    }
    const cont: Record<string, number> = {};
    const pcData: unknown[] = [];
    let ultimaEdicao: string | null = null;
    for (const r of near.values()) {
      const p = r.props;
      if (p.fonte_ultima_edicao && (!ultimaEdicao || p.fonte_ultima_edicao > ultimaEdicao)) ultimaEdicao = p.fonte_ultima_edicao;
      const m = motivoBloqueioPC(p, v, ano);
      const [lon, lat] = pontoDe(r);
      const base = { layer: LAYER, id: r.id, lat, lon, _f: r.fraction };
      const desc = descrevePC(p);
      const det = detalhesPC(p, hoje);
      if (r.naRota) cont[p.situacao] = (cont[p.situacao] ?? 0) + 1;
      pcData.push({ id: r.id, objectid: p.objectid, rodovia: p.rodovia, municipio: p.municipio, situacao: p.situacao, bloqueia_veiculo: !!m, na_rota: r.naRota, desviado: !r.naRota && r.naLivre && !!m });
      if (m) {
        const onde = p.bloqueio?.pontos?.length ? odPerto(ctx, p.bloqueio.pontos, PROX_OD_M) : null;
        if (r.naRota) {
          warnings.push({
            ...base, severity: 'danger', code: onde ? 'pc_origem_destino' : 'pc_bloqueio_na_rota',
            message: onde
              ? `${onde === 'origem' ? 'A origem' : 'O destino'} fica junto a um ponto crítico do DER-MG (${desc}). O app não bloqueou o ponto para não isolar o endereço: confira o acesso antes de sair (${det}).`
              : p.bloqueio?.pontos?.length
                ? `A rota passa por ponto crítico do DER-MG sem alternativa razoável (${desc}). Não siga sem confirmar a passagem (${det}).`
                : `A rota passa por ponto crítico do DER-MG (${desc}) que o app não conseguiu localizar na pista para bloquear. Procure outro caminho (${det}).`,
          });
        } else if (r.naLivre) {
          warnings.push({ ...base, severity: 'warn', code: 'pc_desvio', message: `Rota desviada de ponto crítico do DER-MG (${desc}; ${det}).` });
        }
        continue;
      }
      if (!r.naRota) continue;
      if (p.situacao === 'interrompida_pesados') {
        warnings.push({ ...base, severity: 'warn', code: 'pc_pesados_liberado', message: `Ponto crítico do DER-MG (${desc}). O DER-MG não define "veículo pesado"; o app liberou o seu veículo (VUC ou até 3,5 t). Confira a sinalização no local (${det}).` });
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
      summary.push(`${nNaRota} ponto(s) crítico(s) do DER-MG a até ${PERTO_ROTA_M} m da rota: ${partes.join('; ')}.${ultimaEdicao ? ` Última edição na fonte: ${fmtData(ultimaEdicao)}.` : ''}`);
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
