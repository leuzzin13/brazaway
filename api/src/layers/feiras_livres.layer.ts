import { query } from '../db.js';
import { describeWins, distM, etaAlong, etaFromOrigin, fmtKm, localParts, prettyStreet, ringAround, windowActive, type Win } from './apoio_urbano.js';
import { featuresInBbox } from './data.js';
import type { LayerExclusion, LayerItem, LayerWarning, RouteCtx, RouteLayer } from './types.js';

/**
 * Feiras livres da cidade de São Paulo (GeoSampa equipamento_feira_livre, SMDU/Deinfo).
 *
 * Regra (Decreto 48.172/2007, conferido no Catálogo de Legislação Municipal em 09/10/2026):
 *  - art. 4º: funcionam de terça a domingo, exceto 25/12 e 1º/01;
 *  - art. 5º, I, a–c (redação do Decreto 61.775/2022): feira comum 7h–8h montagem, 8h–14h venda, 14h–14h45 desmontagem;
 *  - art. 5º, § 2º, III: nos dias e horários da feira, tráfego e estacionamento de veículos ficam PROIBIDOS no local de
 *    montagem das bancas.
 * O § 1º admite horário diferenciado por feira e o GeoSampa não publica o horário nem a extensão (só um ponto de
 * referência): a janela padrão só é aplicada às feiras de categoria T (comuns); as demais geram só aviso.
 *
 * exclusions(): na janela da feira (hora estimada de passagem), um polígono de 4 m no MEIO da quadra da rua de mesmo
 * nome casada na importação (props.osm.mid). O Valhalla exclui só a aresta que passa por ali; esquinas e ruas que cruzam
 * ficam livres, e o ponto sobrevive a uma recompilação do tileset. Não usamos costLines aqui: o traçado exato de uma
 * quadra tem 2–4 vértices e o routing.ts considera "usada" a linha com >= 50% dos vértices a 15 m da rota — o desvio
 * em volta do quarteirão passa pelas duas esquinas e geraria aviso 'danger' falso (ver docs/layers/feiras_livres.md).
 * annotate(): feiras na rota no horário que não foram bloqueadas (aviso), feira perto do destino na chegada, resumo.
 */
const LAYER = 'feiras_livres';
const MID_RADIUS_M = 4;
const ON_ROUTE_M = 12;       // meio da quadra casada a até 12 m da rota = a rota usa a quadra
const NEAR_POINT_M = 40;     // feira sem casamento: ponto de referência (endereço) a até 40 m da rota
const DEST_M = 150;
const BASE_LEGAL = 'Decreto 48.172/2007, art. 5º, § 2º, III (horário: art. 5º, I, red. Decreto 61.775/2022)';
const SEL = `f.id::text, f.name, f.props, ST_X(f.geom)::float as lon, ST_Y(f.geom)::float as lat`;
const MID_GEOG = `ST_SetSRID(ST_MakePoint((f.props->'osm'->'mid'->>0)::float, (f.props->'osm'->'mid'->>1)::float), 4326)::geography`;

interface FeiraProps {
  registro?: string | null;
  endereco?: string | null;
  rua?: string | null;
  numero?: string | null;
  dia?: number;
  dia_semana?: string;
  categoria?: string | null;
  categoria_desc?: string | null;
  qt_equipamentos?: number | null;
  windows?: Win[];
  horario?: string | null;
  base_legal?: string | null;
  osm?: { tileset: number; mid: [number, number]; aresta_m: number; way_id?: number; nome_osm?: string | null } | null;
}
interface Row { id: string; name: string | null; props: FeiraProps; lon: number; lat: number }

/** Art. 4º: não há feira em 25/12 nem em 1º/01. */
function noFeiraDay(at: Date): boolean {
  const d = localParts(at).date.slice(5);
  return d === '12-25' || d === '01-01';
}
export function feiraActive(p: FeiraProps, at: Date): boolean {
  return !!p.windows?.length && !noFeiraDay(at) && windowActive(p.windows, at);
}

function label(r: { name: string | null; props: FeiraProps }): string {
  const rua = prettyStreet(r.props.rua ?? '');
  const nome = r.name ? prettyStreet(r.name).replace(/^Feira Livre /i, '') : '';
  const what = nome && rua && !rua.toUpperCase().includes(nome.toUpperCase()) ? `${nome} (${rua})` : rua || nome;
  return `Feira livre ${what}`.trim();
}
function rule(p: FeiraProps): string {
  return p.windows?.length ? describeWins(p.windows) : `${p.dia_semana ?? ''}, horário não publicado`.trim();
}
function anchor(r: Row): [number, number] {
  return r.props.osm?.mid ?? [r.lon, r.lat];
}
function item(r: Row): LayerItem {
  const [lon, lat] = anchor(r);
  return { kind: 'layer', layer: LAYER, id: r.id, name: label(r), type: 'feira_livre', rule: rule(r.props), lat, lon };
}

/** Feiras com janela legal no corredor origem–destino (mesma ideia do raio usado pelas outras camadas urbanas). */
async function corridor(ctx: RouteCtx): Promise<Row[]> {
  const odKm = Math.hypot((ctx.destination.lon - ctx.origin.lon) * 102, (ctx.destination.lat - ctx.origin.lat) * 111);
  const radiusM = Math.max(3000, odKm * 1000 * 0.3);
  const r = await query<Row>(
    `with od as (select ST_SetSRID(ST_MakeLine(ST_MakePoint($1, $2), ST_MakePoint($3, $4)), 4326) as g)
     select f.id::text, f.name, f.props, ST_X(f.geom)::float as lon, ST_Y(f.geom)::float as lat
       from data_features f, od
      where f.layer_id = $5 and jsonb_array_length(coalesce(f.props->'windows', '[]'::jsonb)) > 0
        and jsonb_typeof(f.props->'osm') = 'object'
        and f.geom && ST_Expand(od.g, $6 / 90000.0)
        and ST_DWithin(f.geom::geography, od.g::geography, $6)
        and (f.valid_to is null or f.valid_to > now())
      limit 2000`,
    [ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat, LAYER, radiusM],
  );
  return r.rows;
}

/** Feiras (com quadra casada) ativas na hora estimada de passagem, exceto a quadra da origem/destino. */
async function plan(ctx: RouteCtx): Promise<Row[]> {
  const out: Row[] = [];
  for (const r of await corridor(ctx)) {
    const o = r.props.osm;
    if (!o?.mid) continue;
    const [lon, lat] = o.mid;
    if (!feiraActive(r.props, etaFromOrigin(ctx, { lat, lon }))) continue;
    // origem/destino na própria quadra: não bloqueia (o Valhalla não acharia a via); annotate() avisa
    const reach = o.aresta_m / 2 + 30;
    if (distM(ctx.origin, { lat, lon }) < reach || distM(ctx.destination, { lat, lon }) < reach) continue;
    out.push(r);
  }
  return out;
}
const planCache = new WeakMap<RouteCtx, Promise<Row[]>>();
function planFor(ctx: RouteCtx) {
  let p = planCache.get(ctx);
  if (!p) { p = plan(ctx); planCache.set(ctx, p); }
  return p;
}

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Feiras livres',
    description: 'Feiras livres de São Paulo por dia da semana: a rua fica fechada das 7h às 14h45 (Decreto 48.172/2007).',
    group: 'restricoes',
    sources: [
      { name: 'GeoSampa equipamento_feira_livre (SMDU/Deinfo/PMSP)', url: 'https://geosampa.prefeitura.sp.gov.br', license: 'CC-BY-SA 4.0' },
    ],
    style: { kind: 'circle', color: '#16a34a', radius: 5, minzoom: 12, icon: '🧺' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 12) return { type: 'FeatureCollection', features: [] };
    const rows = await featuresInBbox(LAYER, bbox, { limit: 3000 });
    const now = new Date();
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = r.props as FeiraProps;
        return {
          type: 'Feature', id: r.id, geometry: r.geometry,
          properties: {
            id: r.id,
            name: label({ name: r.name, props: p }),
            endereco: p.endereco ?? null,
            dia: p.dia_semana ?? null,
            horario: p.windows?.length ? `${p.dia_semana}, 7h–14h45 (montagem 7h, desmontagem até 14h45)` : `${p.dia_semana ?? ''}, horário não publicado`,
            agora: feiraActive(p, now) ? 'rua fechada agora' : 'sem feira agora',
            categoria: p.categoria_desc ?? p.categoria ?? null,
            bancas: p.qt_equipamentos ?? null,
            regra: 'Proibido trafegar e estacionar no local das bancas no dia e horário da feira.',
            base_legal: p.windows?.length ? BASE_LEGAL : 'Decreto 48.172/2007, art. 5º, § 2º, III',
            aviso: 'Ponto de referência: a extensão da feira não é publicada.',
            fonte: 'GeoSampa/SMDU (CC-BY-SA 4.0)',
          },
        };
      }),
    };
  },

  async exclusions(ctx) {
    const out: LayerExclusion[] = [];
    for (const r of await planFor(ctx)) out.push({ item: item(r), rings: [ringAround(r.props.osm!.mid, MID_RADIUS_M)] });
    return out;
  },

  async annotate(ctx, route) {
    const handled = new Map((await planFor(ctx)).map((x) => [x.id, x]));
    const near = (g: GeoJSON.LineString, radiusM: number, ids?: string[]) => query<Row & { d_mid: number | null; d_pt: number; f: number }>(
      `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g)
       select ${SEL},
              case when f.props ? 'osm' then ST_Distance(${MID_GEOG}, l.g::geography)::float end as d_mid,
              ST_Distance(f.geom::geography, l.g::geography)::float as d_pt,
              ST_LineLocatePoint(l.g, f.geom)::float as f
         from data_features f, l
        where f.layer_id = $2 and f.geom && ST_Expand(l.g, 0.002)
          and ST_DWithin(f.geom::geography, l.g::geography, $3::float)
          and (f.valid_to is null or f.valid_to > now())
          and ($4::bigint[] is null or f.id = any($4::bigint[]))`,
      [JSON.stringify(g), LAYER, radiusM, ids ?? null],
    );
    const [onR, onFree] = await Promise.all([
      near(route.line.geometry, 120),
      route.free && handled.size ? near(route.free.line.geometry, 120, [...handled.keys()]) : Promise.resolve({ rows: [] as (Row & { d_mid: number | null })[] }),
    ]);
    const uses = (x: { props: FeiraProps; d_mid: number | null; d_pt: number }) =>
      x.props.osm && x.d_mid != null ? x.d_mid <= ON_ROUTE_M : x.d_pt <= NEAR_POINT_M;

    const warnings: LayerWarning[] = [];
    const onRoute: { row: Row; eta: Date; active: boolean; matched: boolean }[] = [];
    for (const row of onR.rows) {
      if (!uses(row)) continue;
      const eta = etaAlong(ctx, route.duration_s, row.f);
      if (row.props.dia !== localParts(eta).dow || noFeiraDay(eta)) continue;
      onRoute.push({ row, eta, active: feiraActive(row.props, eta), matched: !!row.props.osm });
    }
    for (const { row, eta, active, matched } of onRoute) {
      const [lon, lat] = anchor(row);
      const when = localParts(eta).label;
      if (active && matched && !handled.has(row.id)) {
        // não bloqueada antes da rota (hora estimada diferente, ou origem/destino na própria quadra)
        warnings.push({
          code: 'street_market_on_route', severity: 'warn', id: row.id, lat, lon,
          message: `${label(row)} na rota no horário (passagem ~${when}; ${rule(row.props)}): rua fechada no trecho das bancas (${BASE_LEGAL}). Planeje o desvio.`,
        });
      } else if (active && !matched) {
        warnings.push({
          code: 'street_market_near_route', severity: 'info', id: row.id, lat, lon,
          message: `Pode haver feira livre (${label(row).replace(/^Feira livre /, '')}) junto à rota na passagem (~${when}; ${rule(row.props)}). Local exato não confirmado: se a rua estiver fechada, desvie.`,
        });
      } else if (!row.props.windows?.length) {
        warnings.push({
          code: 'street_market_unknown_hours', severity: 'info', id: row.id, lat, lon,
          message: `${label(row)} hoje (${row.props.dia_semana}) junto à rota, horário não publicado: a rua pode estar fechada no trecho das bancas.`,
        });
      }
    }
    // feiras que a rota livre atravessaria e a rota calculada evitou
    const usedNow = new Set(onR.rows.filter(uses).map((x) => x.id));
    const desviadas = onFree.rows.filter((x) => x.d_mid != null && x.d_mid <= ON_ROUTE_M && !usedNow.has(x.id)).map((x) => handled.get(x.id)!).filter(Boolean);

    // destino perto de feira ativa na chegada: rua fechada para parar/descarregar
    const arrival = new Date(ctx.at.getTime() + route.duration_s * 1000);
    const dest = await query<Row & { d: number }>(
      `with d as (select ST_SetSRID(ST_MakePoint($1, $2), 4326) as g)
       select ${SEL},
              least(ST_Distance(f.geom::geography, d.g::geography),
                    coalesce(ST_Distance(${MID_GEOG}, d.g::geography), 1e9))::float as d
         from data_features f, d
        where f.layer_id = $3 and f.geom && ST_Expand(d.g, 0.005)
          and ST_DWithin(f.geom::geography, d.g::geography, $4::float + 60)
          and (f.valid_to is null or f.valid_to > now())
        order by d`,
      [ctx.destination.lon, ctx.destination.lat, LAYER, DEST_M],
    );
    const destFeira = dest.rows.find((x) => x.d <= DEST_M && feiraActive(x.props, arrival));
    if (destFeira) {
      // o aviso do destino substitui o de "feira na rota" da mesma feira
      const i = warnings.findIndex((w) => w.id === destFeira.id && w.code === 'street_market_on_route');
      if (i >= 0) warnings.splice(i, 1);
      const onde = destFeira.d < 30 ? 'na quadra do destino' : `a ${fmtKm(destFeira.d)} do destino`;
      warnings.push({
        code: 'street_market_at_destination', severity: 'warn', id: destFeira.id, lat: destFeira.lat, lon: destFeira.lon,
        message: `${label(destFeira)} ${onde} na chegada (${localParts(arrival).label}; feira até 14h45). Não trafegue nem pare no trecho das bancas (${BASE_LEGAL}): combine outro ponto de descarga.`,
      });
    }

    const summary: string[] = [];
    const names = (xs: Row[]) => `${xs.slice(0, 4).map((x) => prettyStreet(x.props.rua ?? x.name)).join(', ')}${xs.length > 4 ? '…' : ''}`;
    const act = onRoute.filter((x) => x.active && x.matched).map((x) => x.row);
    const maybe = onRoute.filter((x) => x.active && !x.matched).map((x) => x.row);
    if (act.length) summary.push(`Feira livre na rota no horário: ${act.length} (${names(act)}).`);
    if (maybe.length) summary.push(`Possível feira junto à rota (local não confirmado): ${maybe.length} (${maybe.slice(0, 4).map((x) => label(x).replace(/^Feira livre /, '')).join(', ')}).`);
    if (desviadas.length) summary.push(`Desvio de ${desviadas.length} rua(s) de feira no horário: ${names(desviadas)}.`);
    const inactive = onRoute.filter((x) => !x.active && x.row.props.windows?.length);
    if (inactive.length) summary.push(`${inactive.length} rua(s) de feira na rota fora do horário da feira na passagem (livres).`);
    if (!summary.length && !warnings.length) return {};
    if (act.length || desviadas.length) summary.push('Extensão das feiras não publicada: consideramos só a quadra do endereço de referência.');
    return {
      summary, warnings,
      data: {
        na_rota: onRoute.map((x) => ({ id: x.row.id, nome: label(x.row), dia: x.row.props.dia_semana, horario: rule(x.row.props), passagem: localParts(x.eta).label, em_horario: x.active, quadra_casada: x.matched })),
        desviadas: desviadas.map((x) => ({ id: x.id, nome: label(x) })),
        bloqueadas_no_calculo: handled.size,
        destino: destFeira ? { id: destFeira.id, nome: label(destFeira), distancia_m: Math.round(destFeira.d) } : null,
      },
    };
  },
};

export default layer;
