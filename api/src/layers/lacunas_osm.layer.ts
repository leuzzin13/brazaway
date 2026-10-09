import { query } from '../db.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Lacunas do OSM que importam para caminhão — camada INFORMATIVA (não bloqueia):
 *  - passagens inferiores (via principal sob viaduto/ponte/passarela/ferrovia) e túneis sem maxheight;
 *  - maxheight=below_default e barrier=height_restrictor sem valor;
 *  - valores suspeitos (maxheight > 7 m, maxweight < 1 t / sem unidade / com vírgula);
 *  - placas detectadas pelo Mapillary sem valor (importador opcional, fonte 'mapillary').
 * Na rota: para veículo com 4,0 m ou mais, conta as passagens sem altura conhecida que a rota PERCORRE (passar por cima
 * do viaduto não conta) e pede reporte. No mapa: fila de coleta.
 * Dados: importers/sources/osm_lacunas.py (ODbL) e mapillary_placas.py (CC BY-SA, opcional).
 */
const LAYER = 'lacunas_osm';
/** altura a partir da qual a rota avisa sobre passagens sem altura conhecida (regra de produto, não norma) */
export const TALL_VEHICLE_M = 4.0;
const ALONG_BUFFER_M = 5;        // a geometria da rota é a do próprio OSM: 5 m separa pistas de mão dupla
const SIGN_BUFFER_M = 25;        // placa fica ao lado da via; posição da detecção é triangulada
const PASSAGE_MIN_RATIO = 0.6;   // trecho de 60 m da via de baixo: >= 60% dentro do buffer = rota passa por baixo

const UNDER_KINDS = ['passagem_sem_altura', 'tunel_sem_altura', 'altura_abaixo_padrao', 'restritor_sem_valor'];
const DATA_KINDS = ['maxweight_suspeito', 'maxheight_suspeito'];
const SIGN_KINDS = ['placa_altura_detectada', 'placa_peso_detectada', 'placa_largura_detectada', 'placa_comprimento_detectada'];

const TIPO: Record<string, string> = {
  passagem_sem_altura: 'passagem sem altura no mapa', tunel_sem_altura: 'túnel sem altura no mapa',
  altura_abaixo_padrao: 'altura abaixo do padrão, valor desconhecido', restritor_sem_valor: 'limitador de altura sem valor',
  maxheight_suspeito: 'altura suspeita no mapa', maxweight_suspeito: 'peso máximo suspeito no mapa',
  placa_altura_detectada: 'placa de altura vista em imagem', placa_peso_detectada: 'placa de peso vista em imagem',
  placa_largura_detectada: 'placa de largura vista em imagem', placa_comprimento_detectada: 'placa de comprimento vista em imagem',
};
const PEDIDO: Record<string, string> = {
  passagem_sem_altura: 'Passou por aqui? Informe a altura da placa (R-15) ou "sem placa".',
  tunel_sem_altura: 'Informe a altura da placa do túnel ou "sem placa".',
  altura_abaixo_padrao: 'Há limite de altura aqui. Informe o valor da placa.',
  restritor_sem_valor: 'Há um limitador de altura aqui. Informe a altura da placa.',
  maxheight_suspeito: 'O valor parece ser a altura da estrutura, não o limite da placa. Confira.',
  maxweight_suspeito: 'Confira a placa de peso máximo (R-14) e informe o valor.',
  placa_altura_detectada: 'Placa de altura vista em imagem. Informe o valor.',
  placa_peso_detectada: 'Placa de peso vista em imagem. Informe o valor.',
  placa_largura_detectada: 'Placa de largura vista em imagem. Informe o valor.',
  placa_comprimento_detectada: 'Placa de comprimento vista em imagem. Informe o valor.',
};
const ESTRUTURA_PLURAL: Record<string, [string, string]> = {
  viaduto: ['viaduto', 'viadutos'], ponte: ['ponte', 'pontes'], ferrovia: ['ponte ferroviária', 'pontes ferroviárias'], passarela: ['passarela', 'passarelas'],
};

interface AlongRow {
  id: string; kind: string; name: string | null; source: string; props: Record<string, any>;
  inside_m: number; len_m: number; fraction: number; lat: number; lon: number; reportado: boolean;
}

/** Feições da camada (dos tipos pedidos) a até bufferM da rota, com quanto de cada uma fica dentro do buffer. */
async function alongRoute(line: GeoJSON.LineString, bufferM: number, kinds: string[]): Promise<AlongRow[]> {
  const r = await query<AlongRow>(
    `with r as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g),
          b as (select ST_Buffer(g::geography, $2)::geometry as buf from r),
          parts as (select ST_Subdivide(buf, 256) as p from b),
          hits as (
            select f.id, sum(case when GeometryType(f.geom) = 'POINT' then 0
                                  else ST_Length(ST_Intersection(f.geom, parts.p)::geography) end) as inside_m
              from data_features f join parts on f.geom && parts.p and ST_Intersects(f.geom, parts.p)
             where f.layer_id = $3 and f.kind = any($4) and (f.valid_to is null or f.valid_to > now())
             group by f.id)
     select f.id::text, f.kind, f.name, f.source, f.props, hits.inside_m::float as inside_m,
            (case when GeometryType(f.geom) = 'POINT' then 0 else ST_Length(f.geom::geography) end)::float as len_m,
            ST_LineLocatePoint(r.g, ST_PointOnSurface(f.geom))::float as fraction,
            coalesce((f.props->>'lat')::float, ST_Y(ST_PointOnSurface(f.geom))) as lat,
            coalesce((f.props->>'lon')::float, ST_X(ST_PointOnSurface(f.geom))) as lon,
            exists (select 1 from reports rp
                     where rp.status = 'active' and rp.score >= 0 and rp.type = 'low_clearance'
                       and ST_DWithin(rp.geom::geography, f.geom::geography, 30)) as reportado
       from hits join data_features f on f.id = hits.id, r
      order by fraction`,
    [JSON.stringify(line), bufferM, LAYER, kinds],
  );
  return r.rows;
}

/** A rota percorre a feição (e não só cruza por cima/ao lado)? */
function travels(r: AlongRow): boolean {
  if (r.len_m === 0) return true; // ponto dentro do buffer
  if (r.kind === 'passagem_sem_altura') return r.inside_m / r.len_m >= PASSAGE_MIN_RATIO;
  return r.inside_m >= Math.min(40, 0.5 * r.len_m);
}

const num = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Altura desconhecida (OSM)',
    description: 'Viadutos, passarelas, pontes ferroviárias e túneis em via principal sem altura no mapa, e dados duvidosos. Não bloqueia: pede reporte.',
    group: 'infraestrutura',
    sources: [
      { name: 'OpenStreetMap — vias sob estruturas, túneis e valores sem altura/peso', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0 — © colaboradores do OpenStreetMap' },
      { name: 'Mapillary — placas detectadas (opcional)', url: 'https://www.mapillary.com', license: 'CC BY-SA 4.0 — Termos de Uso Mapillary, seção 12; atribuição com logo e link' },
    ],
    style: { kind: 'circle', color: '#f59e0b', icon: '📏', minzoom: 12, radius: 5 },
    defaultVisible: false,
  },

  async annotate(ctx, route) {
    const v = ctx.vehicle;
    const tall = v.height_m >= TALL_VEHICLE_M;
    const line = route.line.geometry;
    const [rows, signs] = await Promise.all([
      alongRoute(line, ALONG_BUFFER_M, [...UNDER_KINDS, ...DATA_KINDS]),
      alongRoute(line, SIGN_BUFFER_M, SIGN_KINDS),
    ]);
    const used = rows.filter(travels);
    const under = used.filter((r) => UNDER_KINDS.includes(r.kind));
    const unknown = under.filter((r) => !r.reportado);
    const reportados = under.length - unknown.length;

    const est: Record<string, number> = {};
    for (const r of unknown.filter((x) => x.kind === 'passagem_sem_altura')) est[r.props.estrutura] = (est[r.props.estrutura] ?? 0) + 1;
    const tuneis = unknown.filter((r) => r.kind === 'tunel_sem_altura').length;
    const abaixo = unknown.filter((r) => r.kind === 'altura_abaixo_padrao');
    const restritores = unknown.filter((r) => r.kind === 'restritor_sem_valor');
    const partes = Object.entries(est).sort((a, b) => b[1] - a[1]).map(([k, n]) => plural(n, ...(ESTRUTURA_PLURAL[k] ?? [k, k])));
    if (tuneis) partes.push(plural(tuneis, 'túnel', 'túneis'));
    if (abaixo.length) partes.push(plural(abaixo.length, 'trecho com altura abaixo do padrão', 'trechos com altura abaixo do padrão'));
    if (restritores.length) partes.push(plural(restritores.length, 'limitador sem valor', 'limitadores sem valor'));

    // resumo só para veículo alto (para os demais a informação fica em data, sem ruído)
    const summary: string[] = [];
    if (tall && unknown.length) summary.push(`Altura livre desconhecida no mapa em ${plural(unknown.length, 'passagem', 'passagens')} da rota: ${partes.join(', ')}.`);
    if (tall && reportados) summary.push(`${plural(reportados, 'passagem já tem', 'passagens já têm')} altura reportada por motoristas.`);
    const heightSigns = signs.filter((s) => s.kind === 'placa_altura_detectada');
    const otherSigns = signs.filter((s) => s.kind !== 'placa_altura_detectada');
    if (tall && signs.length) summary.push(`${plural(signs.length, 'placa de restrição vista', 'placas de restrição vistas')} em imagens perto da rota (Mapillary), sem valor no mapa.`);

    const warnings: LayerWarning[] = [];
    if (tall && unknown.length) {
      warnings.push({
        code: 'height_unknown_crossings', severity: 'info',
        message: `Altura livre desconhecida em ${plural(unknown.length, 'passagem', 'passagens')} (${partes.join(', ')}). Com ${num(v.height_m)} m, confira as placas de altura e reporte pelo app.`,
      });
      for (const r of [...restritores, ...abaixo].slice(0, 5)) {
        warnings.push({
          code: r.kind === 'restritor_sem_valor' ? 'height_restrictor_unknown' : 'height_below_default', severity: 'warn', id: r.id, lat: r.lat, lon: r.lon,
          message: r.kind === 'restritor_sem_valor'
            ? `Limitador de altura sem valor no mapa${r.props.via ? ` em ${r.props.via}` : ''}. Confira a placa antes de passar.`
            : `Trecho com altura abaixo do padrão e valor desconhecido${r.props.via ? ` em ${r.props.via}` : ''}. Confira a placa antes de passar.`,
        });
      }
    }
    if (tall) {
      for (const s of heightSigns.slice(0, 3)) {
        warnings.push({ code: 'height_sign_detected', severity: 'warn', id: s.id, lat: s.lat, lon: s.lon,
          message: 'Placa de altura máxima vista em imagem perto da rota, sem valor no mapa. Confira o limite.' });
      }
    }
    if (otherSigns.length) {
      warnings.push({ code: 'restriction_signs_detected', severity: 'info',
        message: `${plural(otherSigns.length, 'placa de peso/largura/comprimento vista', 'placas de peso/largura/comprimento vistas')} em imagens perto da rota, sem valor no mapa. Confira as placas.` });
    }
    // peso duvidoso num trecho que a rota usa
    for (const r of used.filter((x) => x.kind === 'maxweight_suspeito').slice(0, 3)) {
      const provavel = r.props.provavel_t as number | undefined;
      const risco = provavel != null && v.weight_t > provavel;
      warnings.push({
        code: 'suspicious_maxweight', severity: risco ? 'warn' : 'info', id: r.id, lat: r.lat, lon: r.lon,
        message: risco
          ? `Limite de peso duvidoso no mapa${r.props.via ? ` em ${r.props.via}` : ''} ("${r.props.maxweight}", provável ${num(provavel!)} t) não foi aplicado na rota. Confira a placa R-14.`
          : `Limite de peso duvidoso no mapa${r.props.via ? ` em ${r.props.via}` : ''} ("${r.props.maxweight}"). Confira a placa R-14.`,
      });
    }

    return {
      summary,
      warnings,
      data: {
        veiculo_alto: tall,
        contagem: { desconhecidas: unknown.length, reportadas: reportados, por_estrutura: est, tuneis, abaixo_padrao: abaixo.length, restritores_sem_valor: restritores.length, placas_mapillary: signs.length },
        passagens: unknown.slice(0, 100).map((r) => ({ id: r.id, kind: r.kind, name: r.name, lat: r.lat, lon: r.lon, estrutura: r.props.estrutura ?? null, prioridade: r.props.prioridade ?? null })),
        placas: signs.slice(0, 50).map((s) => ({ id: s.id, kind: s.kind, lat: s.lat, lon: s.lon, url: s.props.url ?? null })),
      },
    };
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 12;
    if (z < 12) return { type: 'FeatureCollection', features: [] };
    const r = await query<{ id: string; kind: string; name: string | null; source: string; props: Record<string, any>; geometry: GeoJSON.Geometry }>(
      `select id::text, kind, name, source, props, ST_AsGeoJSON(geom, 6)::json as geometry from data_features
        where layer_id = $1 and geom && ST_MakeEnvelope($2,$3,$4,$5,4326) and (valid_to is null or valid_to > now())
          and ($6 >= 14 or kind <> 'maxheight_suspeito')
        order by (props->>'prioridade')::int nulls last
        limit 3000`,
      [LAYER, ...bbox, z],
    );
    const features: GeoJSON.Feature[] = r.rows.map((row) => {
      const p = row.props;
      // passagem: ponto do cruzamento; túnel e valores suspeitos: a via
      const geometry: GeoJSON.Geometry = row.kind === 'passagem_sem_altura' && p.lat != null
        ? { type: 'Point', coordinates: [p.lon, p.lat] } : row.geometry;
      const osm = p.osm_node ? `https://www.openstreetmap.org/node/${p.osm_node}` : p.via_id ? `https://www.openstreetmap.org/way/${p.via_id}` : null;
      return {
        type: 'Feature', id: row.id, geometry,
        properties: {
          id: row.id, name: row.name, tipo: TIPO[row.kind] ?? row.kind, prioridade: p.prioridade ?? null,
          via: p.via ?? null, estrutura: p.estrutura_nome ?? p.estrutura ?? null, valor: p.maxweight ?? p.maxheight ?? null,
          motivo: p.motivo ?? null, pedido: PEDIDO[row.kind] ?? null,
          fonte: row.source === 'mapillary' ? 'Mapillary (CC BY-SA)' : 'OpenStreetMap', link: p.url ?? osm,
        },
      };
    });
    return { type: 'FeatureCollection', features };
  },
};

export default layer;
