import * as turf from '@turf/turf';
import { query } from '../db.js';
import type { Vehicle } from '../services/vehicle.js';
import type { Ring } from '../services/valhalla.js';
import { featuresInBbox, featuresNearRoute, type DataFeatureRow } from './data.js';
import type { LayerExclusion, LayerItem, LayerWarning, RouteCtx, RouteLayer } from './types.js';

/**
 * Pontes, viadutos, passarelas e túneis (OAE). Fontes na mesma camada (data_features.layer_id = 'oae'):
 *  - geosampa  : bordas das OAEs da capital (sem nome/limites)                         → só contagem
 *  - der-sp    : OAEs da malha DER-SP (sem limites)                                   → contagem + ponte de madeira
 *  - artesp    : passarelas das rodovias concedidas COM altura (props.altura_livre_m)  → bloqueio por altura
 *  - siurb     : 105 OAEs municipais nomeadas com status de obra                      → nomes e status na rota
 *  - curadoria : restrições oficiais curadas (props.restricao, vigente|historica)       → bloqueio se vigente
 *  - der-mg    : 4.370 OAEs do DER-MG (Observatório da Infraestrutura), largura/estrutura e nota de inspeção crua
 *                (escala não documentada)                                                  → contagem, madeira, ponte estreita
 *  - der-es    : pontes estaduais do ES com PBT máximo em Instrução de Serviço do DER-ES (DIO-ES) → bloqueio por peso
 *
 * Regra geral (qualquer fonte): se a feição tem `altura_livre_m` e o veículo tem altura >= altura_livre_m - FOLGA,
 * ou tem `peso_max_t` e o veículo pesa mais, ou tem restrição curada VIGENTE cujo critério alcança o veículo, vira
 * exclusão pequena (círculo de `bloqueio.raio_m` em cada `bloqueio.pontos`) — bloqueio duro só no ponto da estrutura.
 * Sem `bloqueio.pontos` a feição nunca bloqueia (só avisa).
 */

/** Folga sobre a altura livre publicada. Decisão de produto (margem para erro de cadastro, carga e pavimento), não valor legal. */
export const FOLGA_ALTURA_M = 0.1;
/** Fontes cujas feições entram na contagem de estruturas (as demais duplicariam a mesma OAE). */
const COUNT_SOURCES = ['geosampa', 'der-sp', 'der-mg'];
/**
 * Ponte estreita (DER-MG): largura cadastrada abaixo disto não comporta dois caminhões de 2,60 m (largura máxima sem AET,
 * Res. CONTRAN 882/2021, art. 4º, I) lado a lado com folga. Decisão de produto, não valor legal; o DER-MG não documenta se
 * a largura é a total ou a da pista.
 */
export const LARGURA_ESTREITA_M = 5.5;
/** Folga lateral mínima sobre a largura do veículo antes de o aviso de ponte estreita subir para `warn` (decisão de produto). */
const FOLGA_LARGURA_M = 0.6;
const MAX_ESTREITAS = 5;
/** Raio para considerar que a rota passa por uma OAE pontual sem `bloqueio` (ex.: SIURB, ponto geocodificado). */
const POINT_ON_ROUTE_M = 20;
/** Fração mínima do eixo (linha) da estrutura a até LINE_TOL_M da rota para considerar que a rota usa a estrutura. */
const LINE_OVERLAP = 0.6;
const LINE_TOL_M = 15;
const MAX_WARNINGS = 12;
/** Feições por pedido do mapa: as com limite/restrição/nome vêm primeiro (até MAP_KNOWN_LIMIT), o resto completa. */
const MAP_LIMIT = 4000;
const MAP_KNOWN_LIMIT = 2000;
/** Abaixo desta altura informada a ARTESP é tratada como erro de cadastro (ver importers/sources/artesp_passarelas.py). */
const ALTURA_IMPLAUSIVEL_M = 4.4;

export interface Bloqueio { modo: 'sob' | 'sobre'; pontos: [number, number][]; raio_m: number }
export interface Criterio {
  nenhum?: boolean; todos?: boolean; caminhoes?: boolean; exceto_vuc?: boolean;
  peso_acima_t?: number; eixos_acima?: number; altura_min_m?: number;
}
export interface Restricao {
  tipo: 'proibido_pesados' | 'interditada' | 'peso' | 'altura' | 'faixa_interditada';
  valor: number | null; unidade: string | null; aplica_a: string | null; criterio: Criterio;
  sentido: string | null; status: 'vigente' | 'historica'; inicio: string | null; fim: string | null;
  ato: string | null; fonte_url: string; fonte_data: string | null;
  liberacao: string | null; liberacao_url: string | null; liberacao_data: string | null; liberacao_fonte: string | null;
  verificado_em: string; orgao: string | null; obs: string | null;
}
export interface OaeProps {
  altura_livre_m?: number | null; altura_informada_m?: number | null; altura_suspeita?: boolean; altura_fonte?: string | null;
  altura_por_pista?: { pista: string | null; altura_m: number }[] | null; provavel_mesma_que?: string | null;
  peso_max_t?: number | null; bloqueio?: Bloqueio | null; restricao?: Restricao;
  rodovia?: string | null; km?: number | null; status_obra?: string | null; dt_termino?: string | null; atualizado_em?: string | null;
  admin?: string | null; municipio?: string | null;
  /** limite por eixo (t), quando o ato publica (ex.: DER-ES IS 011-N/2026) */
  eixo_max_t?: number | null;
  /** DER-MG: largura cadastrada (m), estrutura e inspeção crua (escala das notas não documentada pela fonte) */
  largura_m?: number | null; estrutura?: string | null; id_cadastro?: string | null; sremg?: string | null;
  condicao?: { nota_estrutural?: number | null; nota_durabilidade?: number | null; faixas?: number | null; largura_total_m?: number | null; altura_estrutura_m?: number | null; descricao?: string | null } | null;
  /** DER-ES: código da OAE no ato */
  oae_codigo?: string | null;
}

type Row = DataFeatureRow & { props: OaeProps };

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (x: number) => Math.round(x * 100) / 100;
export const fmtM = (x: number) => x.toFixed(2).replace('.', ',');
const fmtT = (x: number) => String(round2(x)).replace('.', ',');
const fmtData = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

/** O critério da restrição curada alcança este veículo? (o app só roteia caminhões; VUC conforme `exceto_vuc`) */
export function criterioAplica(c: Criterio | undefined, v: Vehicle): boolean {
  if (!c || c.nenhum) return false;
  if (c.exceto_vuc && v.is_vuc) return false;
  if (c.todos || c.caminhoes) return true;
  if (c.peso_acima_t != null) return v.weight_t > c.peso_acima_t;
  if (c.eixos_acima != null) return v.axle_count > c.eixos_acima;
  if (c.altura_min_m != null) return v.height_m >= c.altura_min_m;
  return false;
}

/** Restrição curada vigente na data local da viagem (AAAA-MM-DD). */
export function restricaoVigente(r: Restricao | undefined, dia: string): boolean {
  if (!r || r.status !== 'vigente') return false;
  if (r.inicio && dia < r.inicio) return false;
  if (r.fim && dia > r.fim) return false;
  return true;
}

export interface Motivo { code: 'oae_altura' | 'oae_peso' | 'oae_restricao'; regra: string; valor: number | null; mensagem: string }

/** Por que esta OAE bloqueia este veículo na data local `dia` (AAAA-MM-DD). Vazio = não bloqueia. */
export function motivosBloqueio(p: OaeProps, v: Vehicle, dia: string): Motivo[] {
  const out: Motivo[] = [];
  const r = p.restricao;
  // limites numéricos vindos de restrição curada só valem dentro da vigência dela (início futuro ainda não bloqueia)
  const limitesValem = !r || restricaoVigente(r, dia);
  const h = limitesValem ? num(p.altura_livre_m) : null;
  if (h != null && h > 0 && v.height_m >= round2(h - FOLGA_ALTURA_M) - 1e-9) {
    out.push({
      code: 'oae_altura', valor: h, regra: `altura livre ${fmtM(h)} m`,
      mensagem: `altura livre ${fmtM(h)} m${p.altura_fonte ? ` (${p.altura_fonte.split(' (')[0]})` : ''}; seu veículo tem ${fmtM(v.height_m)} m e precisa de folga de ${fmtM(FOLGA_ALTURA_M)} m`,
    });
  }
  const pm = limitesValem ? num(p.peso_max_t) : null;
  if (pm != null && pm > 0 && v.weight_t > pm) {
    out.push({ code: 'oae_peso', valor: pm, regra: `peso máx. ${fmtT(pm)} t`, mensagem: `limite de ${fmtT(pm)} t; seu veículo pesa ${fmtT(v.weight_t)} t` });
  }
  const em = limitesValem ? num(p.eixo_max_t) : null;
  if (em != null && em > 0 && v.axle_load_t > em && !out.some((m) => m.code === 'oae_peso')) {
    out.push({ code: 'oae_peso', valor: em, regra: `${fmtT(em)} t por eixo`, mensagem: `limite de ${fmtT(em)} t por eixo; seu veículo tem ${fmtT(v.axle_load_t)} t por eixo` });
  }
  // tipo altura/peso vigente já vira altura_livre_m/peso_max_t no importador; aqui só proibições/interdições
  if (r && (r.tipo === 'proibido_pesados' || r.tipo === 'interditada') && restricaoVigente(r, dia) && criterioAplica(r.criterio, v)) {
    const desde = fmtData(r.inicio);
    out.push({
      code: 'oae_restricao', valor: null, regra: r.tipo === 'interditada' ? 'interditada' : 'proibida para pesados',
      mensagem: `${r.tipo === 'interditada' ? 'interditada' : 'proibida para caminhões'}${desde ? ` desde ${desde}` : ''} (${r.orgao ?? 'órgão oficial'})`,
    });
  }
  return out;
}

function circleRing([lon, lat]: [number, number], radiusM: number): Ring {
  const c = turf.circle([lon, lat], radiusM / 1000, { steps: 10, units: 'kilometers' });
  return (c.geometry.coordinates[0] as [number, number][]).map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
}

function rowPoint(r: Row): [number, number] {
  const g = r.geometry;
  if (g.type === 'Point') return g.coordinates as [number, number];
  if (g.type === 'LineString') {
    const l = turf.lineString(g.coordinates);
    return turf.along(l, turf.length(l) / 2).geometry.coordinates as [number, number];
  }
  return turf.pointOnFeature(turf.feature(g)).geometry.coordinates as [number, number];
}

function item(r: Row, m: Motivo | null): LayerItem {
  const [lon, lat] = r.props.bloqueio?.pontos?.[0] ?? rowPoint(r);
  return {
    kind: 'layer', layer: 'oae', id: r.id, name: r.name ?? 'OAE', type: r.kind ?? undefined,
    rule: m?.regra, value_num: m?.valor ?? null, lat, lon,
    note: r.props.restricao?.fonte_url ?? r.props.altura_fonte ?? r.source,
  };
}

/** A linha passa pela estrutura? Pontos de bloqueio: a até raio_m; eixo (linha): >= LINE_OVERLAP do eixo a até LINE_TOL_M; ponto: POINT_ON_ROUTE_M. */
function passaPor(line: GeoJSON.Feature<GeoJSON.LineString> | null, r: Row): { ok: boolean; dist: number } {
  if (!line) return { ok: false, dist: Infinity };
  const d = (c: number[]) => turf.pointToLineDistance(turf.point(c), line, { units: 'meters' });
  const b = r.props.bloqueio;
  if (b?.pontos?.length) {
    const dist = Math.min(...b.pontos.map(d));
    return { ok: dist <= b.raio_m, dist };
  }
  const g = r.geometry;
  if (g.type === 'LineString') {
    const l = turf.lineString(g.coordinates);
    const len = turf.length(l, { units: 'meters' });
    const n = Math.max(2, Math.min(40, Math.ceil(len / 10)));
    const pts = Array.from({ length: n + 1 }, (_, i) => turf.along(l, (len * i) / n, { units: 'meters' }).geometry.coordinates);
    const ds = pts.map(d);
    return { ok: ds.filter((x) => x <= LINE_TOL_M).length / ds.length >= LINE_OVERLAP, dist: Math.min(...ds) };
  }
  const dist = d(rowPoint(r));
  return { ok: dist <= POINT_ON_ROUTE_M, dist };
}

/** Feições com limite, nome ou restrição (tudo menos as fontes só de contagem, a não ser que tenham limite). */
const KNOWN_WHERE = `(source not in (${COUNT_SOURCES.map((s) => `'${s}'`).join(',')}) or (props->>'altura_livre_m') is not null or (props->>'peso_max_t') is not null)`;

/** Corredor (bbox origem–destino com folga) onde as exclusões são calculadas. Fora dele o aviso da rota ainda pega. */
function corridor(ctx: RouteCtx): [number, number, number, number] {
  const minX = Math.min(ctx.origin.lon, ctx.destination.lon), maxX = Math.max(ctx.origin.lon, ctx.destination.lon);
  const minY = Math.min(ctx.origin.lat, ctx.destination.lat), maxY = Math.max(ctx.origin.lat, ctx.destination.lat);
  const pad = Math.max(0.3, 0.25 * Math.max(maxX - minX, maxY - minY));
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

function displayProps(r: Row): Record<string, unknown> {
  const p = r.props;
  const h = num(p.altura_livre_m), pm = num(p.peso_max_t), rest = p.restricao;
  const limite = [h != null ? `altura livre ${fmtM(h)} m` : null, pm != null ? `peso máx. ${fmtT(pm)} t` : null].filter(Boolean).join(' · ') || null;
  return {
    id: r.id, name: r.name, kind: r.kind, source: r.source,
    limite,
    alturas_por_pista: p.altura_por_pista?.length ? p.altura_por_pista.map((a) => `${a.pista ?? 'pista'} ${fmtM(a.altura_m)} m`).join(' · ') : null,
    altura_informada: p.altura_suspeita && p.altura_informada_m != null ? `${fmtM(p.altura_informada_m)} m (suspeita, não usada)` : null,
    restricao: rest ? `${rest.status === 'vigente' ? 'VIGENTE' : 'histórica'}: ${rest.aplica_a ?? rest.tipo}` : null,
    ato: rest?.ato ?? null,
    liberacao: rest?.liberacao ?? null,
    verificado_em: rest?.verificado_em ? fmtData(rest.verificado_em) : null,
    rodovia: p.rodovia ?? null, km: p.km ?? null,
    status_obra: p.status_obra ?? null, termino_obra: fmtData(p.dt_termino),
    admin: p.admin ?? null, fonte_url: rest?.fonte_url ?? null,
    largura: p.largura_m != null ? `${fmtM(p.largura_m)} m (cadastro ${r.source === 'der-mg' ? 'DER-MG' : r.source})` : null,
    estrutura: p.estrutura ?? null,
    inspecao: p.condicao ? [
      p.condicao.nota_estrutural != null ? `nota estrutural ${p.condicao.nota_estrutural}` : null,
      p.condicao.nota_durabilidade != null ? `durabilidade ${p.condicao.nota_durabilidade}` : null,
      p.condicao.faixas != null ? `${p.condicao.faixas} faixa(s)` : null,
      'escala não documentada pelo DER-MG',
    ].filter(Boolean).join(' · ') : null,
    codigo: p.oae_codigo ?? p.id_cadastro ?? null,
    bloqueia: !!(p.bloqueio?.pontos?.length && (h != null || pm != null || rest?.status === 'vigente')),
  };
}

const layer: RouteLayer = {
  meta: {
    id: 'oae',
    label: 'Pontes e viadutos',
    description: 'Pontes, viadutos, passarelas e túneis. Bloqueia passarelas com altura livre publicada (ARTESP) abaixo da altura do veículo + 0,10 m, pontes estaduais do ES com PBT máximo em ato do DER-ES e restrições oficiais vigentes; nas demais o limite não é publicado. Em MG avisa ponte de madeira e ponte estreita (cadastro do DER-MG).',
    group: 'infraestrutura',
    sources: [
      { name: 'GeoSampa obra_arte (PMSP)', url: 'https://geosampa.prefeitura.sp.gov.br', license: 'CC-BY-SA 4.0' },
      { name: 'DER-SP OAE', url: 'https://dadosabertos.sp.gov.br/dataset/obras-de-arte-especiais-oae', license: 'CC-BY-4.0' },
      { name: 'ARTESP passarelas (Cadastro de Ativos)', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/491d79c5-ee09-4fe8-a3ce-1b425fe60bbe', license: 'CC-BY' },
      { name: 'SIURB controle de obras (PMSP)', url: 'https://dados.prefeitura.sp.gov.br/dataset/49a40a52-68c0-45c1-92d8-ccc35a525467', license: 'ODC-By 1.0' },
      { name: 'Curadoria de atos e notícias oficiais (PMSP, Prefeituras, Defesa Civil)', url: 'https://prefeitura.sp.gov.br/noticias', license: 'fatos de atos oficiais, com citação da fonte' },
      { name: 'DER-MG — cadastro de OAEs e inspeção (Observatório da Infraestrutura, SEINFRA-MG)', url: 'https://observatorio.infraestrutura.mg.gov.br/server/rest/services/Hosted/pontes_20_05_2025/FeatureServer/0', license: 'Não declarada (licenseInfo vazio); site do DER-MG: reutilização com fonte e crédito. Risco de uso comercial: ver docs/layers/rodovias_estaduais.md' },
      { name: 'DER-ES — Instruções de Serviço de restrição de PBT em pontes estaduais (DIO-ES)', url: 'https://ioes.dio.es.gov.br/busca', license: 'Ato oficial — domínio público (Lei 9.610/98, art. 8º, IV)' },
    ],
    style: { kind: 'circle', color: '#7c3aed', width: 3, radius: 4, minzoom: 10, icon: '🌉' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 12;
    if (z < 9) return { type: 'FeatureCollection', features: [] };
    // primeiro o que tem limite/restrição/nome; as bordas do GeoSampa/DER-SP (só contagem) completam até o limite e
    // só a partir do zoom 12 (no zoom baixo poluem o mapa). Assim o corte por limite nunca derruba uma restrição.
    const known = (await featuresInBbox('oae', bbox, { limit: MAP_KNOWN_LIMIT, where: KNOWN_WHERE })) as Row[];
    const rest = z < 12 || known.length >= MAP_LIMIT ? []
      : ((await featuresInBbox('oae', bbox, { limit: MAP_LIMIT - known.length, where: `not ${KNOWN_WHERE}` })) as Row[]);
    const rows = [...known, ...rest];
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => ({ type: 'Feature', id: r.id, geometry: r.geometry, properties: displayProps(r) })),
    };
  },

  async exclusions(ctx) {
    const [x0, y0, x1, y1] = corridor(ctx);
    const r = await query<Row>(
      `select id::text, layer_id, source, source_id, name, kind, props, ST_AsGeoJSON(geom, 6)::json as geometry, valid_from, valid_to
         from data_features
        where layer_id = 'oae' and jsonb_typeof(props->'bloqueio') = 'object'
          and ((props->>'altura_livre_m') is not null or (props->>'peso_max_t') is not null or props->'restricao'->>'status' = 'vigente')
          and (valid_to is null or valid_to > $5)
          and geom && ST_MakeEnvelope($1,$2,$3,$4,4326)
        limit 5000`,
      [x0, y0, x1, y1, ctx.at],
    );
    const dia = ctx.departureLocal.slice(0, 10);
    const out: LayerExclusion[] = [];
    for (const row of r.rows) {
      const b = row.props.bloqueio;
      if (!b?.pontos?.length) continue;
      const motivos = motivosBloqueio(row.props, ctx.vehicle, dia);
      if (!motivos.length) continue;
      out.push({ item: item(row, motivos[0]), rings: b.pontos.map((pt) => circleRing(pt, b.raio_m || 20)) });
    }
    return out;
  },

  async annotate(ctx, route) {
    const v = ctx.vehicle;
    const dia = ctx.departureLocal.slice(0, 10);
    const line = route.line;
    const free = route.free?.line ?? null;

    // 1) contagem de estruturas (GeoSampa + DER-SP; as outras fontes duplicariam)
    const rows = await featuresNearRoute('oae', line.geometry, 12, { limit: 2000, where: `source = any($5::text[])`, params: [COUNT_SOURCES] });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind ?? 'outra'] = (counts[r.kind ?? 'outra'] ?? 0) + 1;
    const pontes = (counts.ponte ?? 0) + (counts.ponte_madeira ?? 0);
    const viadutos = counts.viaduto ?? 0;
    const passarelas = counts.passarela ?? 0;
    const tuneis = counts.tunel ?? 0;
    const summary = [`${pontes} ponte(s), ${viadutos} viaduto(s), ${passarelas} passarela(s), ${tuneis} túnel(is) a até 12 m da rota (trechos de borda; uma estrutura pode ter mais de um trecho).`];
    const warnings: (LayerWarning & { _f?: number })[] = [];

    // 2) feições com limite/nome/restrição perto da rota restrita e da rota livre
    // (fraction = posição na rota restrita; o que só está perto da rota livre vai para o fim)
    const near = new Map<string, Row & { fraction: number }>();
    for (const r of await featuresNearRoute('oae', line.geometry, 40, { limit: 1500, where: KNOWN_WHERE })) near.set(r.id, r as Row & { fraction: number });
    if (free) {
      for (const r of await featuresNearRoute('oae', free.geometry, 40, { limit: 1500, where: KNOWN_WHERE })) {
        if (!near.has(r.id)) near.set(r.id, { ...(r as Row), fraction: 1 });
      }
    }

    const bloqueadas: unknown[] = [];
    const alturaOk: { row: Row; h: number; dist: number; fraction: number }[] = [];
    const siurb: { name: string; status: string | null; termino: string | null }[] = [];
    const restricoes: unknown[] = [];
    const suspeitas: unknown[] = [];

    for (const r of near.values()) {
      const p = r.props;
      const onRoute = passaPor(line, r);
      const onFree = passaPor(free, r);
      const f = r.fraction ?? 1;
      const motivos = motivosBloqueio(p, v, dia);
      const podeBloquear = !!p.bloqueio?.pontos?.length;
      const [lon, lat] = p.bloqueio?.pontos?.[0] ?? rowPoint(r);
      const base = { layer: 'oae', id: r.id, lat, lon };

      if (motivos.length && (onRoute.ok || onFree.ok)) {
        const m = motivos[0];
        const nome = r.name ?? 'OAE';
        bloqueadas.push({ id: r.id, name: nome, source: r.source, motivo: m.regra, na_rota: onRoute.ok, desviada: !onRoute.ok && onFree.ok });
        if (onRoute.ok) {
          warnings.push({
            ...base, _f: f, severity: 'danger', code: m.code === 'oae_altura' ? 'oae_altura_insuficiente' : m.code === 'oae_peso' ? 'oae_peso_excedido' : 'oae_restricao_vigente',
            message: podeBloquear
              ? `A rota passa a ${Math.round(onRoute.dist)} m de ${nome}: ${m.mensagem}. Confira no local antes de passar; se a rota usar a estrutura, não siga.`
              : `A rota passa por ${nome}: ${m.mensagem}. O app não conseguiu bloquear (geometria não confirmada): procure outro caminho.`,
          });
        } else {
          warnings.push({
            ...base, _f: f, severity: 'danger', code: m.code === 'oae_altura' ? 'oae_altura_desvio' : m.code === 'oae_peso' ? 'oae_peso_desvio' : 'oae_restricao_desvio',
            message: `${nome}: ${m.mensagem}. Rota desviada.`,
          });
        }
        continue;
      }
      if (!onRoute.ok) continue;

      const h = num(p.altura_livre_m);
      if (h != null) alturaOk.push({ row: r, h, dist: onRoute.dist, fraction: f });
      if (p.altura_suspeita && p.altura_informada_m != null) {
        const hi = p.altura_informada_m;
        suspeitas.push({ id: r.id, name: r.name, altura_informada_m: hi });
        // valor suspeito nunca bloqueia; avisa se o veículo não passaria caso o valor fosse verdadeiro
        if (v.height_m >= round2(hi - FOLGA_ALTURA_M) - 1e-9) {
          const implausivel = hi < ALTURA_IMPLAUSIVEL_M;
          warnings.push({
            ...base, _f: f, severity: implausivel ? 'info' : 'warn', code: 'oae_altura_suspeita',
            message: implausivel
              ? `${r.name ?? 'Passarela'}: a ARTESP informa altura de ${fmtM(hi)} m, valor incompatível com a rodovia (provável erro de cadastro). O app não bloqueou; atenção à sinalização.`
              : `${r.name ?? 'Passarela'}: a ARTESP informa altura de ${fmtM(hi)} m (valor suspeito, não usado para bloquear). Seu veículo tem ${fmtM(v.height_m)} m: confira a placa de altura antes de passar.`,
          });
        }
      }

      if (r.source === 'siurb') {
        siurb.push({ name: r.name ?? 'OAE', status: p.status_obra ?? null, termino: p.dt_termino ?? null });
        const st = (p.status_obra ?? '').toUpperCase();
        if (st && !st.startsWith('CONCLU')) {
          warnings.push({ ...base, _f: f, severity: 'info', code: 'oae_obra', message: `${r.name}: obra/serviço da SIURB com status "${p.status_obra}" (dado de ${p.atualizado_em?.slice(0, 4) ?? '?'}). Pode haver faixa interditada.` });
        }
      }

      const rest = p.restricao;
      if (rest) {
        restricoes.push({ id: r.id, name: r.name, status: rest.status, tipo: rest.tipo, aplica_a: rest.aplica_a, fonte_url: rest.fonte_url, liberacao: rest.liberacao, verificado_em: rest.verificado_em });
        const aplica = criterioAplica(rest.criterio, v);
        if (rest.status === 'vigente' && restricaoVigente(rest, dia)) {
          // vigente mas não alcança este veículo (ex.: faixa interditada, VUC liberado)
          warnings.push({ ...base, _f: f, severity: 'info', code: 'oae_restricao_nao_aplica', message: `${r.name}: restrição vigente (${rest.aplica_a ?? rest.tipo}); não se aplica ao seu veículo. Atenção à sinalização.` });
        } else if (rest.status === 'vigente' && rest.inicio && dia < rest.inicio) {
          warnings.push({ ...base, _f: f, severity: aplica ? 'warn' : 'info', code: 'oae_restricao_futura', message: `${r.name}: restrição (${rest.aplica_a ?? rest.tipo}) a partir de ${fmtData(rest.inicio)}${aplica ? '; alcança o seu veículo' : ''}. Não vale na data desta viagem.` });
        } else if (rest.status === 'historica') {
          // `fim` só existe quando a fonte libera explicitamente os veículos da restrição (ver oae_restricoes_curadas.py)
          const lib = fmtData(rest.liberacao_data);
          const fonte = /^oficial/i.test(rest.liberacao_fonte ?? '') ? 'fonte oficial' : 'notícia';
          const liberada = !!rest.fim;
          const quando = rest.inicio?.slice(0, 4) ?? '';
          const oque = rest.aplica_a ?? rest.tipo;
          warnings.push({
            ...base, _f: f,
            severity: !liberada && aplica ? 'warn' : 'info',
            code: 'oae_restricao_historica',
            message: liberada
              ? `${r.name}: teve restrição em ${quando} (${oque}), já liberada${lib ? ` (${fonte} de ${lib})` : ''}. Confira a sinalização.`
              : lib
                ? `${r.name}: teve restrição em ${quando} (${oque}). Há registro de obra concluída (${fonte} de ${lib}), mas sem liberação explícita para caminhões. Confira a placa no local.`
                : `${r.name}: teve restrição em ${quando} (${oque}) e não achamos ato oficial de liberação. Confira a placa no local.`,
          });
        }
      }
    }

    // 3) passarelas/estruturas com altura conhecida que o veículo passa: um aviso só, com a menor altura
    if (alturaOk.length) {
      alturaOk.sort((a, b) => a.h - b.h);
      const min = alturaOk[0];
      const where = min.row.name ?? 'OAE';
      // a ARTESP cadastra algumas passarelas duas vezes (linha com RA e linha "Transversal"): conta uma vez só
      const presentes = new Set(alturaOk.map((a) => `${a.row.source}:${a.row.source_id}`));
      const n = alturaOk.filter((a) => !(a.row.props.provavel_mesma_que && presentes.has(`${a.row.source}:${a.row.props.provavel_mesma_que}`))).length;
      summary.push(`${n} estrutura(s) com altura livre publicada na rota; menor: ${fmtM(min.h)} m (${where}).`);
      const [lon, lat] = rowPoint(min.row);
      warnings.push({
        layer: 'oae', id: min.row.id, lat, lon, _f: min.fraction, severity: 'info', code: 'oae_altura_ok',
        message: `A rota passa sob ${n} ${alturaOk.every((a) => a.row.kind === 'passarela') ? 'passarela(s)' : 'estrutura(s)'} com altura publicada (menor ${fmtM(min.h)} m, ${where}). Seu veículo (${fmtM(v.height_m)} m) passa com folga.`,
      });
    }
    if (siurb.length) {
      const nomes = [...new Map(siurb.map((s) => [s.name, s])).values()].map((s) => {
        const fim = s.termino && /^\d{4}-\d{2}/.test(s.termino) ? ` em ${s.termino.slice(5, 7)}/${s.termino.slice(0, 4)}` : '';
        return s.status ? `${s.name} (obra ${s.status.toLowerCase()}${fim})` : s.name;
      });
      summary.push(`OAEs municipais nomeadas (SIURB): ${nomes.slice(0, 6).join(', ')}${nomes.length > 6 ? ` e mais ${nomes.length - 6}` : ''}.`);
    }
    if (bloqueadas.length) summary.push(`${bloqueadas.length} estrutura(s) com limite abaixo do seu veículo perto da rota (ver avisos).`);

    const heavy = v.weight_t > 23 || v.height_m > 4.2;
    if (heavy && pontes + viadutos + tuneis > 0) {
      warnings.push({
        code: 'oae_limits_unknown', severity: 'info',
        message: `A rota passa por pontes/viadutos/túneis cujo limite de peso e altura não é publicado pelos órgãos. Fique atento às placas R-14/R-15 e reporte o que encontrar.`,
      });
    }
    const madeira = rows.filter((r) => r.kind === 'ponte_madeira');
    for (const m of madeira.slice(0, 5)) {
      warnings.push({ code: 'wooden_bridge', severity: 'warn', id: m.id, _f: m.fraction, message: `Ponte de madeira na rota (${m.name ?? (m.source === 'der-mg' ? 'DER-MG' : 'DER-SP')}): capacidade de carga desconhecida.` });
    }

    // 4) pontes estreitas ou de uma faixa do cadastro do DER-MG (a ponte é o ponto da OAE a até 12 m da rota)
    const estreitas = (rows as (Row & { fraction: number })[])
      .filter((r) => r.source === 'der-mg' && (r.kind === 'ponte' || r.kind === 'ponte_madeira'))
      .map((r) => ({ r, larg: num(r.props.largura_m), faixas: num(r.props.condicao?.faixas) }))
      .filter((x) => (x.larg != null && x.larg > 0 && x.larg < LARGURA_ESTREITA_M) || x.faixas === 1);
    if (estreitas.length) {
      summary.push(`${estreitas.length} ponte(s) estreita(s) ou de uma faixa do DER-MG na rota (largura cadastrada < ${fmtM(LARGURA_ESTREITA_M)} m ou 1 faixa).`);
      estreitas.sort((a, b) => (a.larg ?? 99) - (b.larg ?? 99));
      for (const x of estreitas.slice(0, MAX_ESTREITAS)) {
        const apertada = x.larg != null && x.larg < v.width_m + FOLGA_LARGURA_M;
        const larg = x.larg != null ? `largura cadastrada de ${fmtM(x.larg)} m` : 'uma faixa só';
        const [lon, lat] = rowPoint(x.r);
        warnings.push({
          layer: 'oae', id: x.r.id, lat, lon, _f: x.r.fraction, code: 'oae_ponte_estreita', severity: apertada ? 'warn' : 'info',
          message: apertada
            ? `${x.r.name ?? 'Ponte'} (DER-MG): ${larg}, pouco acima ou abaixo da largura do seu veículo (${fmtM(v.width_m)} m). O cadastro não diz se é a largura total ou a da pista: confira no local antes de passar.`
            : `${x.r.name ?? 'Ponte'} (DER-MG): ponte estreita (${larg}${x.faixas === 1 && x.larg != null ? ', 1 faixa' : ''}). Não cabem dois caminhões: espere o sentido oposto liberar.`,
        });
      }
    }

    // ordem: gravidade, depois posição na rota; corta excesso (exceto 'danger')
    const sev = { danger: 0, warn: 1, info: 2 } as const;
    warnings.sort((a, b) => sev[a.severity ?? 'info'] - sev[b.severity ?? 'info'] || (a._f ?? 1) - (b._f ?? 1));
    const kept = warnings.filter((w, i) => w.severity === 'danger' || i < MAX_WARNINGS).map(({ _f, ...w }) => w);

    return {
      summary,
      warnings: kept,
      data: {
        counts,
        folga_altura_m: FOLGA_ALTURA_M,
        bloqueadas,
        altura_conhecida: alturaOk.map((a) => ({ id: a.row.id, name: a.row.name, altura_livre_m: a.h, distance_m: Math.round(a.dist) })),
        siurb,
        restricoes,
        altura_suspeita: suspeitas,
      },
    };
  },
};

export default layer;
