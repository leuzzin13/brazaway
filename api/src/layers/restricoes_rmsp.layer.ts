import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { query } from '../db.js';
import { env } from '../config.js';
import { legalDayInfo } from '../services/calendar.js';
import type { Vehicle } from '../services/vehicle.js';
import type { Ring } from '../services/valhalla.js';
import type { LayerCostLine, LayerExclusion, LayerItem, LayerWarning, RouteCtx, RouteLayer } from './types.js';

/**
 * Restrições a caminhões dos municípios da Grande SP (exceto a capital): Osasco (ZMRC + VER), Barueri (VER),
 * Guarulhos (ZRCC-TB, Trevo de Bonsucesso), Cajamar (Anexos I–IV), Santana de Parnaíba (PBT > 15 t) e
 * Ribeirão Pires (ZRC). Regras e geometria em data_features (layer_id = restricoes_rmsp), geradas pelos importadores
 * importers/sources/rmsp_*.py a partir de data/raw/rmsp/regras.json (atos conferidos na fonte primária).
 *
 *  - zonas (kind=zona)  → exclusions (polígono recuado; origem/destino dentro = não exclui, avisa);
 *  - vias  (kind=via)   → costLines (linear_cost_factors, só a via; sentido único quando o ato fixa sentido);
 *  - kind=municipio     → localiza origem/destino (feriado municipal, exceção de destino local);
 *  - kind=revogada      → restrição do ABC (2012), cancelada: nunca aplicada (valid_to no passado).
 * Como na ZMRC de SP, a janela é avaliada no horário de SAÍDA; o annotate estima o horário de passagem e avisa
 * quando a rota cruza uma restrição que estará ativa nesse momento.
 */

const LAYER = 'restricoes_rmsp';
/** recuo (m) do polígono: vias-limite ficam livres e absorve o erro do georreferenciamento do mapa de Osasco */
const ZONE_INSET_M = 20;
/** "proibido salvo sem alternativa" (ver types.ts) */
const FACTOR = 1000;
/** PBT acima de 3,5 t = caminhão (CTB, Anexo I) */
const TRUCK_MIN_PBT_T = 3.5;

interface Janela { days: number[]; from: string; to: string }
interface Cond { campo: 'pbt_t' | 'eixos' | 'comprimento_m' | 'largura_m'; acima: number }
interface Vuc { largura_max_m: number; comprimento_max_m: number; exige_cadastro: boolean; orgao?: string; artigo?: string; nota?: string }
interface BaseLegal { ato: string; url: string; nota?: string }
export interface Regra {
  regra_id: string;
  municipio: string;
  ibge: string | null;
  tipo: 'zona' | 'via';
  regime: string;
  nome: string;
  janelas: Janela[];
  variantes?: { classe: string; quando: { qualquer: Cond[] }; janelas: Janela[] }[];
  feriados: 'suspende' | 'aplica';
  alvo: { caminhao?: boolean; qualquer?: Cond[] };
  vuc: Vuc | null;
  vuc_nota?: string;
  /** art. 2º do Dec. 4.288/2019 (Santana): carga com ENTREGA no município fica fora da proibição... */
  excecao_destino_local?: boolean;
  /** ...só nas vias de acesso listadas no ato (ex.: Santana art. 2º, I não lista II.3 nem II.12); ausente = todas */
  excecao_destino_local_incisos?: string[];
  /** via que compõe uma zona (ex.: vias do art. 3º da ZMRC de Osasco): dispensada quando origem/destino está na zona */
  zona_vinculada?: string;
  origem_destino_dentro?: 'avisa';
  autorizacao?: string;
  excecoes?: string[];
  base_legal: BaseLegal[];
  nota?: string;
  status: string;
  // por feição
  inciso?: string | null;
  via?: string | null;
  trecho?: string | null;
  sentido?: 'unico' | 'ambos';
  mao_unica?: boolean;
  aproximado?: boolean;
  nota_trecho?: string | null;
}

interface Row { id: string; name: string | null; kind: string; props: Regra; geometry: GeoJSON.Geometry; inset?: GeoJSON.Geometry | null }

// ---------------------------------------------------------------- regras (puras, exportadas para teste/reuso)

const DAY = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const hh = (s: string) => (s.endsWith(':00') ? `${Number(s.slice(0, 2))}h` : `${Number(s.slice(0, 2))}h${s.slice(3)}`);

function daysLabel(d: number[]): string {
  const s = [...d].sort((a, b) => a - b);
  if (s.length === 7) return 'todos os dias';
  const contiguous = s.every((x, i) => i === 0 || x === s[i - 1] + 1);
  return contiguous && s.length > 1 ? `${DAY[s[0]]}–${DAY[s[s.length - 1]]}` : s.map((x) => DAY[x]).join(', ');
}

/** "seg–sex 7h–9h e 17h–19h; sáb 10h–14h" */
export function describeJanelas(js: Janela[]): string {
  const groups = new Map<string, Janela[]>();
  for (const j of js) {
    const k = [...j.days].sort().join(',');
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  return [...groups.values()].map((g) => {
    const horas = g.every((j) => j.from === '00:00' && j.to === '24:00') ? 'o dia todo' : g.map((j) => `${hh(j.from)}–${hh(j.to)}`).join(' e ');
    return `${daysLabel(g[0].days)} ${horas}`;
  }).join('; ');
}

function campo(v: Vehicle, c: Cond['campo']): number {
  return c === 'pbt_t' ? v.weight_t : c === 'eixos' ? v.axle_count : c === 'comprimento_m' ? v.length_m : v.width_m;
}
const condOk = (v: Vehicle, cs: Cond[]) => cs.some((c) => campo(v, c.campo) > c.acima);

export function fitsVuc(v: Vehicle, d: Vuc): boolean {
  return v.width_m <= d.largura_max_m + 1e-9 && v.length_m <= d.comprimento_max_m + 1e-9;
}

export interface Enquadramento {
  /** a regra atinge este veículo */
  aplica: boolean;
  classe: string;
  janelas: Janela[];
  /** VUC dentro da definição do município, mas a isenção exige cadastro (a regra continua valendo) */
  vucSoComCadastro?: boolean;
  vucIsento?: boolean;
}

export function enquadrar(r: Regra, v: Vehicle): Enquadramento {
  const base = { classe: 'caminhão', janelas: r.janelas };
  if (!(v.weight_t > TRUCK_MIN_PBT_T)) return { ...base, aplica: false };
  if (r.alvo?.qualquer?.length && !condOk(v, r.alvo.qualquer)) return { ...base, aplica: false };
  if (r.vuc && fitsVuc(v, r.vuc)) {
    if (!r.vuc.exige_cadastro) return { ...base, classe: 'VUC', aplica: false, vucIsento: true };
    return { ...base, classe: 'VUC', aplica: true, vucSoComCadastro: true };
  }
  const variante = r.variantes?.find((x) => condOk(v, x.quando.qualquer));
  if (variante) return { aplica: true, classe: variante.classe, janelas: variante.janelas };
  return { ...base, aplica: true };
}

export function janelaAtiva(js: Janela[], at: Date): boolean {
  const local = DateTime.fromJSDate(at).setZone(env.tz);
  const dow = local.weekday;
  const hhmm = local.toFormat('HH:mm');
  return js.some((w) => w.days.includes(dow) && hhmm >= w.from && hhmm < w.to);
}

// ---------------------------------------------------------------- acesso a dados

async function zones(): Promise<Row[]> {
  const r = await query<Row>(
    `select id::text, name, kind, props, ST_AsGeoJSON(geom, 7)::json as geometry,
            ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(ST_Buffer(geom::geography, -$2::float)::geometry, 0.00003)), 7)::json as inset
       from data_features
      where layer_id = $1 and kind = 'zona' and (valid_to is null or valid_to > now())`,
    [LAYER, ZONE_INSET_M],
  );
  return r.rows;
}

/** vias a até `raio` do segmento origem–destino (máx(2,5 km; 40% da distância O–D)): o resto não entra no request */
const CORREDOR_SQL = `with s as (select ST_MakeLine(ST_SetSRID(ST_Point($2, $3), 4326), ST_SetSRID(ST_Point($4, $5), 4326)) as g)
     select %COLS%
       from data_features f, s
      where f.layer_id = $1 and f.kind = 'via'
        and ST_DWithin(f.geom::geography, s.g::geography, greatest(2500, 0.4 * ST_Length(s.g::geography)))
        and (f.valid_to is null or f.valid_to > now())`;
async function viasNoCorredor(ctx: RouteCtx): Promise<Row[]> {
  const r = await query<Row>(CORREDOR_SQL.replace('%COLS%', 'f.id::text, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry'),
    [LAYER, ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat]);
  return r.rows;
}
/** só os ids das vias que costLines() manda ao Valhalla (para saber o que o routing.ts consegue checar) */
async function idsNoCorredor(ctx: RouteCtx): Promise<Set<string>> {
  const r = await query<{ id: string }>(CORREDOR_SQL.replace('%COLS%', 'f.id::text'),
    [LAYER, ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat]);
  return new Set(r.rows.map((x) => x.id));
}

/** municípios (IBGE) da origem e do destino */
async function municipiosOD(ctx: RouteCtx): Promise<{ origem: string | null; destino: string | null }> {
  const r = await query<{ which: string; ibge: string }>(
    `select p.which, f.props->>'ibge' as ibge
       from (values ('o', $2::float, $3::float), ('d', $4::float, $5::float)) as p(which, lon, lat)
       join data_features f on f.layer_id = $1 and f.kind = 'municipio' and ST_Intersects(f.geom, ST_SetSRID(ST_Point(p.lon, p.lat), 4326))`,
    [LAYER, ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat],
  );
  return { origem: r.rows.find((x) => x.which === 'o')?.ibge ?? null, destino: r.rows.find((x) => x.which === 'd')?.ibge ?? null };
}

/** feriado por município (nacional/estadual/municipal) com cache por chamada */
function holidayCache(at: Date) {
  const m = new Map<string, Promise<{ name: string } | null>>();
  return (ibge: string | null) => {
    const k = ibge ?? '-';
    if (!m.has(k)) m.set(k, legalDayInfo(at, ibge ?? '0000000').then((d) => d.holiday).catch(() => null));
    return m.get(k)!;
  };
}

async function regraAtiva(r: Regra, v: Vehicle, at: Date, holiday: (ibge: string | null) => Promise<{ name: string } | null>) {
  const e = enquadrar(r, v);
  if (!e.aplica) return { ativa: false, e };
  if (r.feriados === 'suspende' && (await holiday(r.ibge))) return { ativa: false, e, feriado: true };
  return { ativa: janelaAtiva(e.janelas, at), e };
}

/**
 * Exceção de entrega local (Santana de Parnaíba, Dec. 4.288/2019, art. 2º, I): vale só quando o DESTINO está no
 * município ("carga ... que deva ser entregue em obras, residências ou estabelecimentos comerciais situados no perímetro
 * do Município") e só nas vias de acesso listadas no inciso (II.3 e II.12 ficam de fora).
 */
export function destinoLocal(r: Regra, od: { origem: string | null; destino: string | null }): boolean {
  if (!r.excecao_destino_local || !r.ibge || od.destino !== r.ibge) return false;
  return !r.excecao_destino_local_incisos || (r.inciso != null && r.excecao_destino_local_incisos.includes(r.inciso));
}

/** regra_id das zonas (polígono recuado) que contêm a origem ou o destino */
function zonasComOD(zs: Row[], ctx: RouteCtx): Set<string> {
  return new Set(zs.filter((z) => pointIn(z.inset, ctx.origin) || pointIn(z.inset, ctx.destination)).map((z) => z.props.regra_id));
}

function ringsOf(g: GeoJSON.Geometry | null | undefined): Ring[] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates[0] as Ring];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0] as Ring);
  return [];
}

function pointIn(g: GeoJSON.Geometry | null | undefined, p: { lat: number; lon: number }): boolean {
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return false;
  return turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
}

function lines(g: GeoJSON.Geometry): [number, number][][] {
  if (g.type === 'LineString') return [g.coordinates as [number, number][]];
  if (g.type === 'MultiLineString') return g.coordinates as [number, number][][];
  return [];
}

function itemOf(row: Row, rule: string): LayerItem {
  const p = row.props;
  const ls = lines(row.geometry);
  const mid = ls.length ? ls[0][Math.floor(ls[0].length / 2)] : row.geometry.type === 'Polygon' ? turf.centroid(row.geometry as GeoJSON.Polygon).geometry.coordinates : undefined;
  return {
    kind: 'layer', layer: LAYER, id: row.id, name: row.name ?? p.nome, type: p.regime,
    rule, lon: mid?.[0], lat: mid?.[1], note: p.inciso ? `${p.municipio}, ${p.base_legal[0]?.ato.split(',')[0]} inc. ${p.inciso}` : p.municipio,
  };
}

const local = (d: Date) => DateTime.fromJSDate(d).setZone(env.tz);
const ruleLabel = (r: Regra, e: Enquadramento) => `${describeJanelas(e.janelas)}${r.feriados === 'suspende' ? ', exceto feriados' : ''}`;
const atoCurto = (r: Regra) => r.base_legal[0]?.ato.split('(')[0].replace(/,?\s*arts?\..*$/, '').trim() ?? '';

// ---------------------------------------------------------------- camada

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Restrições municipais (Grande SP)',
    description: 'Zonas e vias com horário para caminhão em Osasco, Barueri, Guarulhos, Cajamar, Santana de Parnaíba e Ribeirão Pires.',
    group: 'restricoes',
    sources: [
      { name: 'Osasco: Dec. 10.676/2012 (red. Dec. 13.704/2023), mapa DEMUTRAN (IOMO 2434) e Portaria SETRAN (IOMO 2487)', url: 'https://osasco.sp.gov.br/wp-content/uploads/2023/03/iomo-2408.pdf', license: 'Ato oficial (domínio público, Lei 9.610/98 art. 8º IV)' },
      { name: 'Barueri: Dec. 9.025/2019 (Jornal Oficial ed. 1.169)', url: 'http://portal.barueri.sp.gov.br/Upload/Diario/pdf/JOB-1169-14Set2019-web_637039980038937304.pdf', license: 'Ato oficial (domínio público)' },
      { name: 'Guarulhos: Decs. 37.887/2021 e 38.400/2021 (ZRCC-TB)', url: 'https://www.guarulhos.sp.gov.br/06_prefeitura/leis/decretos_2021/38400decr.pdf', license: 'Ato oficial (domínio público)' },
      { name: 'Cajamar: Dec. 7.397/2025 (DOM ed. 1358)', url: 'https://cajamar.sp.gov.br/diariooficial/wp-content/uploads/sites/3/edicao-no1358.pdf', license: 'Ato oficial (domínio público)' },
      { name: 'Santana de Parnaíba: Dec. 4.288/2019 (Imprensa Oficial ed. 298, p. 7)', url: 'https://prefeitura.santanadeparnaiba.sp.gov.br/PortalComunicacao/arquivo/download/AMMJ0Fm5w6LYtdaONCo92UC4DZQCQ3ugj-qy7wONa8-oMYIdWrgdyeVWYw_JrvDLZvcB6g2#page=7', license: 'Ato oficial (domínio público)' },
      { name: 'Ribeirão Pires: Dec. 7.608/2025 (DO ed. 44/2026)', url: 'https://www.ribeiraopires.sp.gov.br/uploads/diario_oficial_26_01_2026_26033144.pdf', license: 'Ato oficial (domínio público)' },
      { name: 'Geometria das vias e do contorno de Ribeirão Pires: OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0 (© colaboradores do OpenStreetMap)' },
      { name: 'Polígono da ZMRC de Osasco: mapa oficial georreferenciado sobre os eixos do OpenStreetMap (ICP + thin-plate spline)', url: 'https://www.openstreetmap.org/copyright', license: 'Derivado do OSM: ODbL 1.0 (© colaboradores do OpenStreetMap)' },
      { name: 'Limites municipais: IBGE Malha Municipal', url: 'https://servicodados.ibge.gov.br/api/docs/malhas', license: 'Dados públicos IBGE (citar a fonte)' },
    ],
    style: { kind: 'line', color: '#dc2626', width: 3, minzoom: 10, icon: '⛔', opacity: 0.8 },
    defaultVisible: true,
  },

  async exclusions(ctx) {
    const [zs, od] = await Promise.all([zones(), municipiosOD(ctx).catch(() => ({ origem: null, destino: null }))]);
    const holiday = holidayCache(ctx.at);
    const out: LayerExclusion[] = [];
    for (const z of zs) {
      const r = z.props;
      const { ativa, e } = await regraAtiva(r, ctx.vehicle, ctx.at, holiday);
      if (!ativa) continue;
      if (destinoLocal(r, od)) continue;
      // origem/destino dentro da zona: não exclui (o annotate avisa) — mesma política da ZMRC de SP
      if (pointIn(z.inset, ctx.origin) || pointIn(z.inset, ctx.destination)) continue;
      const rings = ringsOf(z.inset);
      if (rings.length) out.push({ item: itemOf(z, `${ruleLabel(r, e)} (${e.classe})`), rings });
    }
    return out;
  },

  async costLines(ctx) {
    const [vs, od, zs] = await Promise.all([viasNoCorredor(ctx), municipiosOD(ctx).catch(() => ({ origem: null, destino: null })), zones()]);
    const holiday = holidayCache(ctx.at);
    const naZona = zonasComOD(zs, ctx);
    // as linhas já vêm cortadas (<= 400 m), encadeadas e validadas contra o grafo do Valhalla pelo importador
    const out: LayerCostLine[] = [];
    for (const v of vs) {
      const r = v.props;
      const { ativa, e } = await regraAtiva(r, ctx.vehicle, ctx.at, holiday);
      if (!ativa) continue;
      if (destinoLocal(r, od)) continue;
      // via que compõe a zona: com origem/destino dentro da zona, segue a política da zona (não restringe, avisa)
      if (r.zona_vinculada && naZona.has(r.zona_vinculada)) continue;
      const item = itemOf(v, `${ruleLabel(r, e)} (${e.classe})`);
      for (const c of lines(v.geometry)) {
        if (c.length < 2) continue;
        // linear_cost_factors do Valhalla vale no sentido do desenho: via de mão dupla sem sentido fixo vai nos dois
        out.push({ item, coordinates: c, factor: FACTOR });
        if (r.sentido !== 'unico' && !r.mao_unica) out.push({ item, coordinates: [...c].reverse(), factor: FACTOR });
      }
    }
    return out;
  },

  async annotate(ctx, route) {
    const geom = route.line.geometry;
    const holiday = holidayCache(ctx.at);
    const [zs, od, corredor, near] = await Promise.all([
      zones(),
      municipiosOD(ctx).catch(() => ({ origem: null, destino: null })),
      idsNoCorredor(ctx),
      query<Row & { fraction: number; dist_m: number }>(
        `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) as g)
         select f.id::text, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry,
                ST_LineLocatePoint(l.g, ST_ClosestPoint(f.geom, l.g))::float as fraction,
                ST_Distance(f.geom::geography, l.g::geography)::float as dist_m
           from data_features f, l
          where f.layer_id = $1 and f.kind = 'via' and f.geom && ST_Expand(l.g, 0.0002)
            and ST_DWithin(f.geom::geography, l.g::geography, 8)
            and (f.valid_to is null or f.valid_to > now())`,
        [LAYER, JSON.stringify(geom)],
      ).then((r) => r.rows),
    ]);
    const warnings: LayerWarning[] = [];
    const summary: string[] = [];
    const hits: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const v = ctx.vehicle;
    const passAt = (fraction: number) => new Date(ctx.at.getTime() + route.duration_s * 1000 * Math.max(0, Math.min(1, fraction)));
    const line = turf.lineString(geom.coordinates);

    // 1) zonas: origem/destino dentro e passagem estimada
    for (const z of zs) {
      const r = z.props;
      const e = enquadrar(r, v);
      const oIn = pointIn(z.inset, ctx.origin), dIn = pointIn(z.inset, ctx.destination);
      const inter = z.inset && turf.booleanIntersects(line, z.inset as GeoJSON.Polygon);
      const evitada = !inter && !!route.free && !!z.inset && turf.booleanIntersects(route.free.line, z.inset as GeoJSON.Polygon);
      if (!inter && !oIn && !dIn && !evitada) continue;
      const { ativa } = await regraAtiva(r, v, ctx.at, holiday);
      let frac = 0;
      if (inter && !oIn) {
        const pts = turf.lineIntersect(line, turf.polygonToLine(z.inset as GeoJSON.Polygon) as any).features;
        if (pts.length) frac = Math.min(...pts.map((p) => turf.nearestPointOnLine(line, p).properties.location ?? 0)) / Math.max(1e-9, turf.length(line));
      }
      const tPass = passAt(frac);
      const ativaPass = (await regraAtiva(r, v, tPass, holiday)).ativa;
      hits.push({ regra_id: r.regra_id, municipio: r.municipio, regime: r.regime, nome: r.nome, ativa_na_saida: ativa, ativa_na_passagem: ativaPass, passagem: local(tPass).toFormat("HH:mm"), enquadramento: e.classe });
      summary.push(`${r.nome}: ${ruleLabel(r, e)} — ${!e.aplica ? 'não se aplica a este veículo' : evitada ? 'ativa na saída: a rota contorna a zona' : ativa ? 'ativa na saída' : 'inativa na saída'}.`);
      if (e.aplica && (oIn || dIn) && (ativa || ativaPass)) {
        warnings.push({
          code: oIn && dIn ? 'rmsp_origem_destino_na_zona' : oIn ? 'rmsp_origem_na_zona' : 'rmsp_destino_na_zona', severity: 'warn', id: z.id,
          message: `${oIn && dIn ? 'Origem e destino estão' : oIn ? 'Origem está' : 'Destino está'} dentro da ${r.nome} (${ruleLabel(r, e)}); a zona não foi excluída da rota.${r.autorizacao ? ` Exige ${r.autorizacao.split('(')[0].trim()}.` : ' Verifique autorização/exceção.'}`,
        });
      } else if (e.aplica && inter && !ativa && ativaPass) {
        warnings.push({ code: 'rmsp_zona_ativa_na_passagem', severity: 'warn', id: z.id,
          message: `A rota entra na ${r.nome} por volta das ${local(tPass).toFormat("HH'h'mm")}, dentro do horário de restrição (${ruleLabel(r, e)}). Saia mais cedo ou mais tarde.` });
      }
      noteVuc(r, e, v, warnings, seen);
    }

    // 2) vias da rota: passagem estimada, VUC com cadastro, destino local, via restrita usada sem checagem do routing.ts
    const naZona = zonasComOD(zs, ctx);
    const routeCoords = geom.coordinates as [number, number][];
    type Usada = Row & { fraction: number; uso: Uso; local: boolean; dispensada: boolean; coberta: boolean };
    const porRegra = new Map<string, { r: Regra; rows: Usada[] }>();
    for (const n of near) {
      const directional = n.props.sentido === 'unico' || !!n.props.mao_unica;
      const usos = lines(n.geometry).map((c) => usoDaLinha(routeCoords, c, directional));
      const uso = usos.reduce((a, b) => (b.metros > a.metros ? b : a), { ratio: 0, metros: 0 });
      if (!usaLinha(uso)) continue;
      const g = porRegra.get(n.props.regra_id) ?? { r: n.props, rows: [] };
      g.rows.push({
        ...n, uso,
        local: destinoLocal(n.props, od),
        dispensada: !!n.props.zona_vinculada && naZona.has(n.props.zona_vinculada),
        // o routing.ts só checa as linhas que recebeu (corredor) e só vê o uso quando >= 50% da linha está na rota;
        // com folga (70%) para não deixar buraco entre os dois critérios
        coberta: corredor.has(n.id) && uso.ratio >= 0.7,
      });
      porRegra.set(n.props.regra_id, g);
    }
    const nomesDe = (rows: Usada[]) => [...new Set(rows.map((x) => x.props.via ?? x.name).filter(Boolean))].slice(0, 3).join(', ');
    for (const { r, rows } of porRegra.values()) {
      const e = enquadrar(r, v);
      const { ativa } = await regraAtiva(r, v, ctx.at, holiday);
      const first = rows.reduce((a, b) => (a.fraction <= b.fraction ? a : b));
      const tPass = passAt(first.fraction);
      const ativaPass = (await regraAtiva(r, v, tPass, holiday)).ativa;
      const locais = rows.filter((x) => x.local);
      const restritas = rows.filter((x) => !x.local && !x.dispensada);
      const nomes = nomesDe(rows);
      hits.push({ regra_id: r.regra_id, municipio: r.municipio, regime: r.regime, vias: nomes, ativa_na_saida: ativa, ativa_na_passagem: ativaPass,
        passagem: local(tPass).toFormat('HH:mm'), enquadramento: e.classe, destino_local: locais.length > 0, dispensada_pela_zona: rows.some((x) => x.dispensada),
        uso_m: Math.round(rows.reduce((a, x) => a + x.uso.metros, 0)) });
      summary.push(`${r.municipio} — ${r.regime} (${nomes}): ${ruleLabel(r, e)}${!e.aplica ? ' — não se aplica a este veículo' : locais.length && !restritas.length ? ' — exceção de entrega no município' : ''}.`);
      if (e.aplica && locais.length) {
        warnings.push({ code: 'rmsp_destino_local', severity: 'info', id: locais[0].id,
          message: `${r.municipio}: a rota usa vias proibidas a PBT acima de 15 t (${nomesDe(locais)}) pela exceção de carga com entrega no município (${atoCurto(r)}, art. 2º, I). Leve a nota fiscal da entrega.` });
      }
      if (e.aplica && restritas.length) {
        const rf = restritas.reduce((a, b) => (a.fraction <= b.fraction ? a : b));
        const tR = passAt(rf.fraction);
        const ativaR = (await regraAtiva(r, v, tR, holiday)).ativa;
        const descobertas = restritas.filter((x) => !x.coberta);
        if (ativa && descobertas.length) {
          // ativa na saída e usada pela rota, mas o routing.ts não vai avisar (fora do corredor ou uso parcial da linha)
          const p0 = lines(descobertas[0].geometry)[0]?.[0];
          warnings.push({ code: 'rmsp_via_restrita_na_rota', severity: 'danger', id: descobertas[0].id, lon: p0?.[0], lat: p0?.[1],
            message: `A rota passa por ${r.regime} de ${r.municipio} (${nomesDe(descobertas)}) no horário de restrição (${ruleLabel(r, e)}). Confira a regra e a autorização antes de seguir.` });
        } else if (!ativa && ativaR) {
          warnings.push({ code: 'rmsp_via_ativa_na_passagem', severity: 'warn', id: rf.id,
            message: `A rota passa por ${r.regime} de ${r.municipio} (${nomesDe(restritas)}) por volta das ${local(tR).toFormat("HH'h'mm")}, dentro do horário de restrição (${ruleLabel(r, e)}).` });
        }
      }
      if (rows.some((x) => x.props.aproximado)) {
        const key = `aprox:${r.regra_id}`;
        if (!seen.has(key)) { seen.add(key); warnings.push({ code: 'rmsp_trecho_aproximado', severity: 'info', message: `${r.municipio}: o trecho restrito de ${nomes} foi delimitado de forma aproximada (ponta do trecho não existe no mapa). Confira a placa no local.` }); }
      }
      noteVuc(r, e, v, warnings, seen);
    }
    if (!hits.length) return {};
    return { summary: [...new Set(summary)].slice(0, 8), warnings, data: { hits, municipio_origem: od.origem, municipio_destino: od.destino } };
  },

  async features(bbox, { zoom }) {
    const r = await query<Row>(
      `select id::text, name, kind, props,
              ST_AsGeoJSON(case when $6::boolean then ST_SimplifyPreserveTopology(geom, 0.00005) else geom end, 6)::json as geometry
         from data_features
        where layer_id = $1 and kind in ('zona', 'via') and geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
          and (valid_to is null or valid_to > now())
        limit 4000`,
      // zoom vem da query string (pode ser 12.5, NaN...): decide no JS e manda boolean
      [LAYER, ...bbox, !(Number.isFinite(zoom) && (zoom as number) >= 13)],
    );
    return {
      type: 'FeatureCollection',
      features: r.rows.map((x) => {
        const p = x.props;
        return {
          type: 'Feature', id: x.id, geometry: x.geometry,
          properties: {
            id: x.id, name: x.name, kind: x.kind, municipio: p.municipio, regime: p.regime, inciso: p.inciso ?? null,
            sentido: p.sentido ?? null, aproximado: !!p.aproximado,
            description: `${describeJanelas(p.janelas)}${p.feriados === 'suspende' ? ', exceto feriados' : ''}. ${alvoTexto(p)}${p.trecho ? ` Trecho: ${p.trecho}.` : ''}`,
            source: atoCurto(p), source_url: p.base_legal[0]?.url,
          },
        };
      }),
    };
  },
};

function alvoTexto(r: Regra): string {
  const c = r.alvo?.qualquer?.map((x) => (x.campo === 'pbt_t' ? `PBT acima de ${x.acima} t` : x.campo === 'eixos' ? `mais de ${x.acima} eixos` : `${x.campo} acima de ${x.acima}`)).join(' ou ');
  const vuc = r.vuc ? ` VUC (até ${String(r.vuc.largura_max_m).replace('.', ',')} x ${String(r.vuc.comprimento_max_m).replace('.', ',')} m) ${r.vuc.exige_cadastro ? 'isento só com cadastro' : 'isento'}.` : '';
  return `${c ? `Caminhões com ${c}.` : 'Caminhões.'}${vuc}`;
}

function noteVuc(r: Regra, e: Enquadramento, v: Vehicle, warnings: LayerWarning[], seen: Set<string>) {
  const key = `vuc:${r.municipio}`;
  if (seen.has(key)) return;
  if (e.vucSoComCadastro && r.vuc) {
    seen.add(key);
    warnings.push({ code: 'rmsp_vuc_cadastro', severity: 'info', message: `${r.municipio}: VUC só fica isento se cadastrado${r.vuc.orgao ? ` na ${r.vuc.orgao}` : ''} (${r.vuc.artigo ?? atoCurto(r)}). A rota considerou a restrição.` });
  } else if (v.is_vuc && e.aplica && !r.vuc && !r.alvo?.qualquer?.length && r.vuc_nota) {
    seen.add(key);
    warnings.push({ code: 'rmsp_vuc_nao_confirmado', severity: 'info', message: `${r.municipio}: ${r.vuc_nota}` });
  }
}

// ---------------------------------------------------------------- uso de uma linha pela rota

const TOL_M = 15;
export interface Uso { ratio: number; metros: number }
const bearingDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** trechos contíguos da rota cujos segmentos tocam o bbox (evita percorrer a rota inteira a cada amostra) */
function routePiecesNear(route: [number, number][], bb: [number, number, number, number]): GeoJSON.Feature<GeoJSON.LineString>[] {
  const out: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const touches = Math.max(a[0], b[0]) >= bb[0] && Math.min(a[0], b[0]) <= bb[2] && Math.max(a[1], b[1]) >= bb[1] && Math.min(a[1], b[1]) <= bb[3];
    if (touches) { if (!cur.length) cur.push(a); cur.push(b); }
    else if (cur.length) { out.push(turf.lineString(cur)); cur = []; }
  }
  if (cur.length >= 2) out.push(turf.lineString(cur));
  return out;
}

/**
 * Quanto da linha restrita a rota percorre: amostras a cada ~15 m da linha; conta a amostra a até 15 m da rota e,
 * se `directional` (mão única ou sentido fixado pelo ato), só quando o rumo da rota ali difere menos de 90° do rumo da
 * linha — a rota pela pista do sentido livre não "usa" o trecho (falso positivo do Barueri XV/XVI).
 */
export function usoDaLinha(route: [number, number][], c: [number, number][], directional: boolean): Uso {
  if (c.length < 2 || route.length < 2) return { ratio: 0, metros: 0 };
  const pad = 0.0004;   // ~40 m
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  const pieces = routePiecesNear(route, [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]);
  let total = 0, hit = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1];
    const len = turf.distance(a, b, { units: 'meters' });
    if (!(len > 0)) continue;
    total += len;
    if (!pieces.length) continue;
    const brg = turf.bearing(a, b);
    const k = Math.max(1, Math.ceil(len / TOL_M));
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k;
      const p = turf.point([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      let best = Infinity, sameWay = false;
      for (const pc of pieces) {
        const np = turf.nearestPointOnLine(pc, p, { units: 'meters' });
        const d = np.properties.dist ?? Infinity;
        if (d >= best) continue;
        best = d;
        if (!directional) { sameWay = true; continue; }
        const rc = pc.geometry.coordinates;
        const idx = Math.min(np.properties.index ?? 0, rc.length - 2);
        sameWay = bearingDiff(brg, turf.bearing(rc[idx], rc[idx + 1])) < 90;
      }
      if (best <= TOL_M && sameWay) hit += len / k;
    }
  }
  return { ratio: total > 0 ? hit / total : 0, metros: hit };
}

/** a rota usa a linha? metade dela (critério do routing.ts) OU ao menos 100 m dela (linha longa usada em parte) */
export const usaLinha = (u: Uso) => u.ratio >= 0.5 || u.metros >= 100;

export default layer;
