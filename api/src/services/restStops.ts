import { query } from '../db.js';

export interface RestStop {
  id: string; name: string | null; kind: string; lat: number; lon: number;
  tags: Record<string, string>;
  fraction: number;      // posição ao longo da rota (0..1)
  distance_km: number;   // distância desde a origem
  eta_s: number;         // tempo desde a saída (proporcional à distância — aproximação)
  off_route_m: number;   // distância do ponto até a rota
}

/** Pontos de descanso a até `radiusM` da rota, ordenados pela posição ao longo dela. */
export async function restStopsAlongRoute(line: GeoJSON.LineString, distanceKm: number, durationS: number, radiusM = 500): Promise<RestStop[]> {
  const r = await query<{ id: string; name: string | null; kind: string; lat: number; lon: number; tags: Record<string, string>; fraction: number; off_route_m: number }>(
    `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g)
     select s.id, s.name, s.kind, ST_Y(s.geom) as lat, ST_X(s.geom) as lon, s.tags,
            ST_LineLocatePoint(l.g, s.geom)::float as fraction,
            ST_Distance(s.geom::geography, l.g::geography)::float as off_route_m
       from rest_stops s, l
      where ST_DWithin(s.geom::geography, l.g::geography, $2)
      order by fraction
      limit 60`,
    [JSON.stringify(line), radiusM],
  );
  return r.rows.map((s) => ({ ...s, distance_km: +(s.fraction * distanceKm).toFixed(1), eta_s: Math.round(s.fraction * durationS) }));
}

// Lei 13.103/2015 (art. 235-C da CLT) — valores de referência, CONFIRMAR com o jurídico/transportadora.
export const DRIVING_RULES = {
  max_continuous_driving_s: 5.5 * 3600,  // 5h30 de direção contínua
  break_s: 30 * 60,                      // 30 min de descanso
  max_daily_driving_s: 8 * 3600,         // 8h de direção por dia
  max_daily_extended_s: 10 * 3600,       // +2h de prorrogação
};

export interface SuggestedStop { after_s: number; stop: RestStop | null; message: string }
export interface DrivingPlan {
  driving_s: number;
  total_with_breaks_s: number;
  required_breaks: number;
  suggested_stops: SuggestedStop[];
  notes: string[];
}

function fmt(s: number) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`; }

/** Sugere paradas de 30 min a cada 5h30 de direção, escolhendo o ponto de descanso mais próximo ANTES do limite. */
export function drivingPlan(durationS: number, stops: RestStop[]): DrivingPlan {
  const R = DRIVING_RULES;
  const required = Math.floor(durationS / R.max_continuous_driving_s);
  const suggested: SuggestedStop[] = [];
  let lastStopEta = 0;
  for (let k = 1; k <= required; k++) {
    const limit = lastStopEta + R.max_continuous_driving_s;
    if (limit >= durationS) break;
    const windowStart = limit - 1.5 * 3600; // prefere parar na última 1h30 antes do limite
    const candidates = stops.filter((s) => s.eta_s <= limit && s.eta_s > lastStopEta);
    const best = candidates.filter((s) => s.eta_s >= windowStart).pop() ?? candidates.pop() ?? null;
    if (best) {
      suggested.push({ after_s: best.eta_s, stop: best, message: `Parada de 30 min em ${best.name ?? best.kind} (~${fmt(best.eta_s)} de direção, km ${best.distance_km}).` });
      lastStopEta = best.eta_s;
    } else {
      suggested.push({ after_s: limit, stop: null, message: `Parada obrigatória de 30 min até ${fmt(limit)} de direção, mas não há ponto de descanso mapeado nesse trecho.` });
      lastStopEta = limit;
    }
  }
  const notes: string[] = [];
  if (durationS > R.max_daily_extended_s) notes.push(`Direção de ${fmt(durationS)} excede 8h + 2h de prorrogação (Lei 13.103): prever pernoite/revezamento.`);
  else if (durationS > R.max_daily_driving_s) notes.push(`Direção de ${fmt(durationS)} excede as 8h diárias; só com prorrogação de até 2h (Lei 13.103).`);
  return {
    driving_s: durationS,
    total_with_breaks_s: durationS + suggested.length * R.break_s,
    required_breaks: suggested.length,
    suggested_stops: suggested,
    notes,
  };
}
