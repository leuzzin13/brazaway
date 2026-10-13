import * as turf from '@turf/turf';
import { featuresInBbox, featuresNearRoute, toFeatureCollection, type NearRouteRow } from './data.js';
import { isTruck } from '../services/vehicle.js';
import type { RouteLayer } from './types.js';

/**
 * Radares fixos de velocidade do OpenStreetMap (nós highway=speed_camera e relações enforcement=maxspeed; ODbL).
 * Radar NÃO é restrição: a camada não tem exclusions/costLines e nunca muda o traçado. Só `annotate`:
 * um único aviso agrupado (`radar_na_rota`, info) com os radares a até RADIUS_M da geometria da rota, e a lista em `data`.
 * Quando o radar tem direção (props.direction_deg), só vale se o rumo da rota naquele ponto difere até DIR_TOL graus
 * (o radar da pista contrária não avisa); sem direção, avisa. Ver docs/layers/radares.md.
 */
const LAYER = 'radares';
/** distância máxima entre o radar e a geometria da rota */
export const RADIUS_M = 30;
/** diferença máxima (graus) entre o rumo da rota e a direção do radar */
export const DIR_TOL = 60;
/** quantos radares citar na mensagem (o resto vai só em data) */
const MSG_MAX = 8;
/** metros à frente/atrás do ponto para medir o rumo local da rota */
const HEADING_SPAN_KM = 0.02;

interface RadarProps {
  osm_node?: number; osm_url?: string;
  maxspeed_kmh?: number | null; maxspeed_hgv_kmh?: number | null;
  direction_deg?: number | null; direction_raw?: string | null; direction_kind?: string;
  ref?: string | null; label?: string | null; via?: string | null;
}

export function angDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

const km1 = (x: number) => x.toFixed(1).replace('.', ',');

/** Rumo (0-360) da rota em `locKm` (km desde a origem), medido numa janela de ±20 m. */
function routeHeading(line: GeoJSON.Feature<GeoJSON.LineString>, totalKm: number, locKm: number): number {
  const a = turf.along(line, Math.max(0, locKm - HEADING_SPAN_KM), { units: 'kilometers' });
  const b = turf.along(line, Math.min(totalKm, locKm + HEADING_SPAN_KM), { units: 'kilometers' });
  return (turf.bearing(a, b) + 360) % 360;
}

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Radares de velocidade',
    description: 'Radares fixos mapeados no OpenStreetMap, com limite e direção quando existem. Só avisa na rota; não muda o traçado.',
    group: 'seguranca',
    sources: [{ name: 'OpenStreetMap — highway=speed_camera / enforcement', url: 'https://www.openstreetmap.org/', license: 'ODbL 1.0 — © colaboradores do OpenStreetMap' }],
    style: { kind: 'circle', color: '#ea580c', icon: '📷', minzoom: 9, radius: 5 },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = Number.isFinite(zoom) ? (zoom as number) : 12;
    if (z < 9) return { type: 'FeatureCollection', features: [] };
    const rows = await featuresInBbox(LAYER, bbox, { limit: 3000 });
    return toFeatureCollection(rows, (r) => {
      const p = r.props as RadarProps;
      return {
        limite_kmh: p.maxspeed_kmh ?? null,
        limite_caminhao_kmh: p.maxspeed_hgv_kmh ?? null,
        direcao_graus: p.direction_deg ?? null,
        sentido: p.direction_deg != null ? `${Math.round(p.direction_deg)}°` : p.direction_raw === 'both' ? 'os dois sentidos' : 'não informado',
        via: p.via ?? null, ref: p.ref ?? null, osm: p.osm_url,
        efeito: 'só avisa na rota (não muda o traçado)',
      };
    });
  },

  async annotate(ctx, route) {
    const line = route.line;
    const rows: NearRouteRow[] = await featuresNearRoute(LAYER, line.geometry, RADIUS_M, { limit: 2000 });
    const totalKm = turf.length(line, { units: 'kilometers' });
    const pesado = isTruck(ctx.vehicle);

    const na_rota: Record<string, unknown>[] = [];
    let descartadosPorDirecao = 0;
    for (const r of rows) {
      const p = r.props as RadarProps;
      const [lon, lat] = (r.geometry as GeoJSON.Point).coordinates;
      const snap = turf.nearestPointOnLine(line, [lon, lat], { units: 'kilometers' });
      const km = snap.properties.location ?? r.fraction * totalKm;
      let direcao: 'confere' | 'sem_direcao' = 'sem_direcao';
      let rumo: number | null = null;
      if (p.direction_deg != null) {
        rumo = Math.round(routeHeading(line, totalKm, km));
        if (angDiff(rumo, p.direction_deg) > DIR_TOL) { descartadosPorDirecao++; continue; }
        direcao = 'confere';
      }
      const limite = (pesado && p.maxspeed_hgv_kmh) || p.maxspeed_kmh || null;
      na_rota.push({
        id: r.id, nome: r.name, km_desde_origem: Math.round(km * 100) / 100, distancia_rota_m: Math.round(r.distance_m),
        limite_kmh: p.maxspeed_kmh ?? null, limite_caminhao_kmh: p.maxspeed_hgv_kmh ?? null, limite_aplicavel_kmh: limite,
        direcao_graus: p.direction_deg ?? null, rumo_rota_graus: rumo, direcao,
        via: p.via ?? null, ref: p.ref ?? null, lat, lon, osm: p.osm_url,
      });
    }
    na_rota.sort((a, b) => (a.km_desde_origem as number) - (b.km_desde_origem as number));

    if (!na_rota.length) {
      return {
        summary: ['Nenhum radar fixo mapeado no OpenStreetMap na rota (o mapa pode não ter todos).'],
        data: { total: 0, descartados_por_direcao: descartadosPorDirecao, raio_m: RADIUS_M, radares: [] },
      };
    }
    const lista = na_rota.slice(0, MSG_MAX).map((x) => `km ${km1(x.km_desde_origem as number)}${x.limite_aplicavel_kmh ? ` (${x.limite_aplicavel_kmh} km/h)` : ''}`);
    const resto = na_rota.length - lista.length;
    const first = na_rota[0];
    const n = na_rota.length;
    const message = `${n === 1 ? '1 radar' : `${n} radares`} de velocidade na rota (OpenStreetMap): ${lista.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}. ` +
      'Respeite o limite sinalizado; o mapa pode estar incompleto ou desatualizado.';
    return {
      summary: [`${n === 1 ? '1 radar' : `${n} radares`} fixo(s) na rota; o primeiro no km ${km1(first.km_desde_origem as number)}.`],
      warnings: [{ code: 'radar_na_rota', severity: 'info', id: 'radares', lat: first.lat as number, lon: first.lon as number, message }],
      data: { total: n, descartados_por_direcao: descartadosPorDirecao, raio_m: RADIUS_M, tolerancia_direcao_graus: DIR_TOL, radares: na_rota },
    };
  },
};

export default layer;
