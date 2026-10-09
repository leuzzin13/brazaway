import { query } from '../db.js';
import { describeWins, etaAlong, etaFromOrigin, fmtKm, localParts, prettyStreet, valhallaTileset, windowActive, type Win } from './apoio_urbano.js';
import { featuresInBbox } from './data.js';
import type { LayerCostLine, LayerWarning, RouteLayer } from './types.js';

/**
 * Faixas exclusivas de ônibus (CET, via GeoSampa faixa_onibus) e corredores de ônibus (SPTrans/EMTU, GeoSampa
 * corredor_onibus) na cidade de São Paulo.
 *
 * Regra: a faixa é exclusiva de ônibus no horário de funcionamento (texto da CET por trecho, "2ª a 6ª das 06-09h"...);
 * o corredor (à esquerda, canteiro central) é exclusivo em tempo integral. Caminhão não trafega na faixa/corredor
 * (CTB art. 184: I direita — só para virar à direita ou acessar imóvel; II esquerda; III via/faixa exclusiva de
 * transporte coletivo). As DEMAIS faixas da via continuam liberadas: por isso a camada não bloqueia a via.
 *
 * costLines(): penalidade moderada (fator CORREDORES_ONIBUS_FATOR, ex.: 1.3) nas faixas em operação na hora
 * estimada de passagem, para o roteador preferir avenidas sem faixa nos horários de pico. DESLIGADA por padrão
 * (variável ausente ou <= 1): o routing.ts atual trata toda costLine usada pela rota como "trecho restrito sem
 * alternativa" com severidade 'danger', o que é falso para uma faixa (o caminhão pode usar as outras faixas).
 * Ver docs/layers/corredores_onibus.md. Os traçados vêm casados com a malha do Valhalla (props.osm) e só são
 * usados se o tileset atual for o mesmo da importação (senão o edge walk falharia e derrubaria a rota).
 *
 * annotate(): quanto da rota corre junto a faixa em operação (no horário estimado de passagem, por sentido),
 * corredores ao lado da rota e faixa em operação no destino (não parar para carga/descarga).
 */
const LAYER = 'corredores_onibus';
const NEAR_M = 15;          // faixa: eixo da via a até 15 m do traçado da rota
const NEAR_CORREDOR_M = 25; // corredor: eixo no canteiro central, pistas laterais um pouco mais longe
const DEST_M = 25;

function factor(): number {
  const f = Number(process.env.CORREDORES_ONIBUS_FATOR ?? '');
  return Number.isFinite(f) && f > 1 ? Math.min(f, 10) : 0;
}

interface OsmLine { dir: 'fwd' | 'rev'; coords: [number, number][] }
interface FaixaProps {
  logradouro?: string;
  denominacao?: string | null;
  tipo?: string;
  lado?: string | null;
  sentido_via?: string | null;
  sentido_faixa?: string | null;
  horario?: string | null;
  windows?: Win[] | null;
  dirs?: { fwd: Win[]; rev: Win[] };
  sentido_incerto?: boolean;
  corredor?: string;
  osm?: { tileset: number; lines: OsmLine[] };
}

const KIND_LABEL: Record<string, string> = {
  faixa_exclusiva: 'Faixa exclusiva de ônibus', faixa_reversivel: 'Faixa reversível de ônibus',
  faixa_preferencial: 'Faixa preferencial de ônibus', faixa_temporaria: 'Faixa temporária de ônibus', corredor: 'Corredor de ônibus',
};

function ladoTxt(l?: string | null): string {
  const s = (l ?? '').toUpperCase();
  if (s.startsWith('ESQU')) return 'à esquerda';
  if (s.includes('DIREITA') && s.includes('ESQUERDA')) return 'à direita e à esquerda';
  if (s.includes('DIREITA')) return 'à direita';
  if (s.startsWith('REVERS')) return 'reversível';
  return '';
}

interface RouteHit {
  id: string;
  kind: string;
  name: string | null;
  props: FaixaProps;
  len_m: number;
  overlap_m: number;
  f0: number;
  f1: number;
  lon: number;
  lat: number;
}

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Faixas e corredores de ônibus',
    description: 'Faixas exclusivas (horário por trecho, CET) e corredores de ônibus em São Paulo: caminhão não trafega na faixa nem para nela no horário.',
    group: 'restricoes',
    sources: [
      { name: 'GeoSampa faixa_onibus (levantamento CET/PMSP)', url: 'https://geosampa.prefeitura.sp.gov.br', license: 'CC-BY-SA 4.0' },
      { name: 'GeoSampa corredor_onibus (SPTrans/EMTU)', url: 'https://geosampa.prefeitura.sp.gov.br', license: 'CC-BY-SA 4.0' },
    ],
    style: { kind: 'line', color: '#dc2626', width: 3, minzoom: 12, icon: '🚌' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 12) return { type: 'FeatureCollection', features: [] };
    const rows = await featuresInBbox(LAYER, bbox, { limit: 4000 });
    const at = new Date();
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = r.props as FaixaProps;
        const corredor = r.kind === 'corredor';
        return {
          type: 'Feature', id: r.id, geometry: r.geometry,
          properties: {
            id: r.id,
            name: corredor ? (p.corredor ?? r.name) : `${KIND_LABEL[r.kind ?? ''] ?? 'Faixa de ônibus'} — ${prettyStreet(p.logradouro ?? r.name)}`,
            tipo: KIND_LABEL[r.kind ?? ''] ?? r.kind,
            lado: corredor ? 'à esquerda (canteiro central)' : ladoTxt(p.lado),
            sentido: corredor ? null : (p.sentido_faixa || (p.sentido_via === 'DUPLO' ? 'os dois sentidos' : null)),
            horario: corredor ? 'exclusivo em tempo integral' : (p.horario ?? 'não informado'),
            agora: corredor ? 'exclusivo' : (windowActive(p.windows, at) ? 'em operação' : 'fora do horário'),
            regra: corredor ? 'Só ônibus (táxi em horários definidos). Caminhão: use as pistas laterais.' :
              'Caminhão não trafega nem para na faixa no horário; à direita, só entra para virar ou acessar imóvel (CTB art. 184).',
            fonte: corredor ? 'GeoSampa/SPTrans (CC-BY-SA 4.0)' : 'GeoSampa/CET (CC-BY-SA 4.0)',
          },
        };
      }),
    };
  },

  async costLines(ctx) {
    const f = factor();
    if (!f) return [];
    const tileset = await valhallaTileset();
    if (tileset == null) return [];
    const odKm = Math.hypot((ctx.destination.lon - ctx.origin.lon) * 102, (ctx.destination.lat - ctx.origin.lat) * 111);
    const radiusM = Math.max(3000, odKm * 1000 * 0.3);
    const r = await query<{ id: string; kind: string; name: string | null; props: FaixaProps }>(
      `with od as (select ST_SetSRID(ST_MakeLine(ST_MakePoint($1, $2), ST_MakePoint($3, $4)), 4326) as g)
       select f.id::text, f.kind, f.name, f.props
         from data_features f, od
        where f.layer_id = $5 and f.kind in ('faixa_exclusiva', 'faixa_reversivel')
          and (f.props->'osm'->>'tileset')::bigint = $6
          and f.geom && ST_Expand(od.g, $7 / 90000.0)
          and ST_DWithin(f.geom::geography, od.g::geography, $7)
        order by (f.props->>'comprimento_m')::int desc nulls last
        limit 400`,
      [ctx.origin.lon, ctx.origin.lat, ctx.destination.lon, ctx.destination.lat, LAYER, tileset, radiusM],
    );
    const out: LayerCostLine[] = [];
    for (const row of r.rows) {
      for (const l of row.props.osm?.lines ?? []) {
        const ws = row.props.dirs?.[l.dir] ?? [];
        if (!ws.length || l.coords.length < 2) continue;
        const [lon, lat] = l.coords[Math.floor(l.coords.length / 2)];
        if (!windowActive(ws, etaFromOrigin(ctx, { lat, lon }))) continue;
        out.push({
          item: { kind: 'layer', layer: LAYER, id: `${row.id}:${l.dir}`, name: `${KIND_LABEL[row.kind] ?? 'Faixa de ônibus'} ${ladoTxt(row.props.lado)} — ${prettyStreet(row.props.logradouro ?? row.name)}`.replace(/\s+/g, ' '), type: row.kind, rule: describeWins(ws), lat, lon },
          coordinates: l.coords,
          factor: f,
        });
      }
    }
    return out;
  },

  async annotate(ctx, route) {
    const r = await query<RouteHit>(
      `with r as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g4),
            rm as (select g4, ST_Transform(g4, 31983) as g from r)
       select f.id::text, f.kind, f.name, f.props - 'osm' - 'segmentos' as props,
              ST_Length(t.fg)::float as len_m, ST_Length(s.seg)::float as overlap_m,
              ST_LineLocatePoint(rm.g, ST_StartPoint(s.seg))::float as f0,
              ST_LineLocatePoint(rm.g, ST_EndPoint(s.seg))::float as f1,
              ST_X(ST_Transform(ST_LineInterpolatePoint(s.seg, 0.5), 4326))::float as lon,
              ST_Y(ST_Transform(ST_LineInterpolatePoint(s.seg, 0.5), 4326))::float as lat
         from data_features f
         cross join rm
         cross join lateral (select ST_Transform(f.geom, 31983) as fg) t
         cross join lateral (
           select d.geom as seg from ST_Dump(ST_Intersection(t.fg, ST_Buffer(rm.g, case when f.kind = 'corredor' then $3::float else $2::float end))) d
            where GeometryType(d.geom) = 'LINESTRING' order by ST_Length(d.geom) desc limit 1) s
        where f.layer_id = $4 and f.geom && ST_Expand(rm.g4, 0.001)
          and ST_DWithin(t.fg, rm.g, case when f.kind = 'corredor' then $3::float else $2::float end)
          and (f.valid_to is null or f.valid_to > now())`,
      [JSON.stringify(route.line.geometry), NEAR_M, NEAR_CORREDOR_M, LAYER],
    );

    const activeByStreet = new Map<string, { m: number; rule: string; lado: string; lat: number; lon: number; incerto: boolean }>();
    const corredores = new Map<string, { m: number; lat: number; lon: number }>();
    let activeM = 0, offM = 0, prefM = 0;
    const segs: unknown[] = [];
    for (const h of r.rows) {
      // trecho "usado": a sobreposição cobre boa parte da faixa (ou >= 150 m); cruzamentos não contam
      if (h.overlap_m < 30 || h.overlap_m < Math.min(h.len_m * 0.5, 150)) continue;
      const fmid = (h.f0 + h.f1) / 2;
      const eta = etaAlong(ctx, route.duration_s, fmid);
      if (h.kind === 'corredor') {
        const k = h.props.corredor ?? h.name ?? 'Corredor';
        const c = corredores.get(k) ?? { m: 0, lat: h.lat, lon: h.lon };
        c.m += h.overlap_m;
        corredores.set(k, c);
        continue;
      }
      if (h.kind === 'faixa_preferencial' || h.kind === 'faixa_temporaria') { prefM += h.overlap_m; continue; }
      const dir: 'fwd' | 'rev' = h.f1 >= h.f0 ? 'fwd' : 'rev';
      const ws = h.props.dirs?.[dir] ?? h.props.windows ?? [];
      const active = windowActive(ws, eta);
      segs.push({ id: h.id, logradouro: h.props.logradouro, tipo: h.kind, lado: h.props.lado, sentido: dir, horario: describeWins(ws), em_operacao: active, sobreposicao_m: Math.round(h.overlap_m), passagem: localParts(eta).label });
      if (!active) { offM += h.overlap_m; continue; }
      activeM += h.overlap_m;
      const key = prettyStreet(h.props.logradouro ?? h.name);
      const a = activeByStreet.get(key) ?? { m: 0, rule: describeWins(ws), lado: ladoTxt(h.props.lado), lat: h.lat, lon: h.lon, incerto: false };
      a.m += h.overlap_m;
      a.incerto ||= !!h.props.sentido_incerto;
      activeByStreet.set(key, a);
    }

    const warnings: LayerWarning[] = [];
    const summary: string[] = [];
    const streets = [...activeByStreet.entries()].sort((a, b) => b[1].m - a[1].m);
    if (activeM > 0) {
      const top = streets.slice(0, 3).map(([s, a]) => `${s} ${a.lado ? `(${a.lado}) ` : ''}${a.rule}`).join('; ');
      const left = streets.some(([, a]) => a.lado.includes('esquerda'));
      warnings.push({
        code: 'bus_lane_active', severity: 'warn', lat: streets[0][1].lat, lon: streets[0][1].lon,
        message: `A rota passa por ${fmtKm(activeM)} de via com faixa exclusiva de ônibus em operação no horário previsto (${top}${streets.length > 3 ? '; …' : ''}). Não trafegue nem pare na faixa: ${left ? 'a da esquerda é proibida; ' : ''}na da direita, só entre para virar ou acessar imóvel (CTB art. 184).`,
      });
      summary.push(`Faixa exclusiva de ônibus em operação: ${fmtKm(activeM)} da rota (${streets.slice(0, 4).map(([s]) => s).join(', ')}${streets.length > 4 ? '…' : ''}).`);
    }
    if (offM > 0) summary.push(`Faixas de ônibus fora do horário na passagem: ${fmtKm(offM)} (livres para circular).`);
    if (prefM > 0) summary.push(`Faixa preferencial/temporária de ônibus: ${fmtKm(prefM)} da rota.`);
    const cors = [...corredores.entries()].filter(([, c]) => c.m >= 200).sort((a, b) => b[1].m - a[1].m);
    if (cors.length) {
      const total = cors.reduce((s, [, c]) => s + c.m, 0);
      const names = cors.slice(0, 3).map(([n]) => prettyStreet(n.replace(/^CORREDOR\s+/i, 'Corredor '))).join(', ');
      summary.push(`Corredor de ônibus junto à rota: ${fmtKm(total)} (${names}).`);
      warnings.push({
        code: 'bus_corridor_on_route', severity: 'info', lat: cors[0][1].lat, lon: cors[0][1].lon,
        message: `A rota segue ${fmtKm(total)} ao lado de corredor de ônibus (${names}): a faixa da esquerda (canteiro central) é só de ônibus em tempo integral; use as faixas comuns.`,
      });
    }

    // destino sobre faixa em operação na chegada: não parar para carga/descarga na faixa
    const arrival = new Date(ctx.at.getTime() + route.duration_s * 1000);
    const dest = await query<{ id: string; kind: string; name: string | null; props: FaixaProps }>(
      `select f.id::text, f.kind, f.name, f.props - 'osm' - 'segmentos' as props from data_features f
        where f.layer_id = $1 and f.kind in ('faixa_exclusiva', 'faixa_reversivel')
          and ST_DWithin(f.geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
          and (f.valid_to is null or f.valid_to > now())`,
      [LAYER, ctx.destination.lon, ctx.destination.lat, DEST_M],
    );
    const destActive = dest.rows.filter((d) => windowActive([...(d.props.dirs?.fwd ?? []), ...(d.props.dirs?.rev ?? [])], arrival));
    if (destActive.length) {
      const d0 = destActive[0];
      const ws = [...(d0.props.dirs?.fwd ?? []), ...(d0.props.dirs?.rev ?? [])];
      warnings.push({
        code: 'destination_on_bus_lane', severity: 'warn', lat: ctx.destination.lat, lon: ctx.destination.lon, id: d0.id,
        message: `O destino fica em via com faixa exclusiva de ônibus em operação na chegada (${prettyStreet(d0.props.logradouro ?? d0.name)}: ${describeWins(ws)}). Não pare na faixa para carga e descarga; procure vaga de carga e descarga próxima.`,
      });
    }

    const f = factor();
    const tileset = f ? await valhallaTileset() : null;
    if (!summary.length && !warnings.length) return { data: { penalidade: { ativa: !!f, fator: f || null } } };
    return {
      summary, warnings,
      data: {
        faixa_em_operacao_m: Math.round(activeM), faixa_fora_do_horario_m: Math.round(offM),
        corredores: cors.map(([n, c]) => ({ nome: n, metros: Math.round(c.m) })),
        trechos: segs.slice(0, 50),
        penalidade: { ativa: !!f, fator: f || null, tileset },
      },
    };
  },
};

export default layer;
