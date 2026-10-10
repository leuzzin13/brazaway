import { query } from '../db.js';
import { withLayerCandidates } from './restStopsData.js';

export interface RestStop {
  id: string; name: string | null; kind: string; lat: number; lon: number;
  tags: Record<string, string>;
  fraction: number;      // posição ao longo da rota (0..1)
  distance_km: number;   // distância desde a origem
  eta_s: number;         // tempo desde a saída (proporcional à distância — aproximação)
  off_route_m: number;   // distância do ponto até a rota
}

/** Pontos de descanso a até `radiusM` da rota (OSM + camada descanso), na ordem de prioridade do plano (ver restStopsData.ts). */
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
  return withLayerCandidates(r.rows.map((s) => ({ ...s, distance_km: +(s.fraction * distanceKm).toFixed(1), eta_s: Math.round(s.fraction * durationS) })), { line, distanceKm, durationS, radiusM }, { drivingPlan, DRIVING_RULES });
}

/**
 * Tempo de direção e descanso do motorista profissional de carga (Lei 13.103/2015), conferido no texto compilado do
 * Planalto (CTB e CLT) e na decisão do STF na ADI 5322 (sessão virtual concluída em 30/06/2023; efeitos ex nunc
 * a partir da publicação da ata, modulados nos embargos julgados em out/2024).
 *  - CTB art. 67-C caput: no máximo 5h30 de direção ininterrupta (vale para empregado E autônomo/TAC — art. 67-A).
 *  - CTB art. 67-C §1º: 30 min de descanso dentro de cada 6 h de condução (pode fracionar, sem passar de 5h30 contínuas).
 *  - CTB art. 67-C §3º: 11 h de descanso a cada 24 h. O STF (ADI 5322) derrubou o trecho que permitia fracionar,
 *    usufruir no veículo e coincidir com as pausas ("observadas no primeiro período 8 horas ininterruptas"):
 *    o descanso diário passa a ser de 11 h ININTERRUPTAS. §6º: só inicia viagem após o descanso integral.
 *  - CLT art. 235-C (só para o motorista EMPREGADO, art. 235-A): jornada de 8 h + até 2 h extras (até 4 h com
 *    convenção/acordo coletivo); §2º refeição de no mínimo 1 h (pode coincidir com a parada do CTB).
 *    ADI 5322 derrubou a exclusão do tempo de espera (§§1º, 8º, 9º e 12): espera de carga/descarga e fiscalização
 *    conta como jornada. Também caiu o descanso com o veículo em movimento (235-D §5º, 235-E III).
 *  - Autônomo (TAC): sem limite de jornada da CLT; valem os limites do CTB (5h30, 30 min/6 h, 11 h/24 h).
 * O plano só conhece o tempo de DIREÇÃO estimado pelo Valhalla (sem espera, carga/descarga e trânsito real).
 */
export const DRIVING_RULES = {
  max_continuous_driving_s: 5.5 * 3600,   // CTB art. 67-C caput
  break_s: 30 * 60,                       // CTB art. 67-C §1º
  daily_rest_s: 11 * 3600,                // CTB art. 67-C §3º (11 h ininterruptas após a ADI 5322)
  max_span_between_rests_s: 13 * 3600,    // 24 h − 11 h de descanso (consequência do art. 67-C §3º)
  employee_workday_s: 8 * 3600,           // CLT art. 235-C caput
  employee_overtime_s: 2 * 3600,          // CLT art. 235-C caput
  employee_overtime_cct_s: 4 * 3600,      // CLT art. 235-C caput (com convenção ou acordo coletivo)
  employee_meal_s: 3600,                  // CLT art. 235-C §2º
  /** prefere parar na última 1h30 antes do limite */
  prefer_window_s: 1.5 * 3600,
  legal_basis: [
    'CTB art. 67-C caput, §1º, §3º e §6º (red. Lei 13.103/2015)',
    'CLT arts. 235-A e 235-C caput e §2º (red. Lei 13.103/2015) — só motorista empregado',
    'STF ADI 5322 (j. 30/06/2023): descanso diário de 11 h ininterruptas; tempo de espera conta como jornada',
  ],
};

export type Employment = 'employee' | 'autonomous';
export type DrivingRegime = Employment | 'unknown';
export interface SuggestedStop {
  after_s: number;            // tempo de direção acumulado até a parada
  stop: RestStop | null;
  message: string;
  kind: 'break' | 'meal' | 'daily_rest';
  duration_s: number;
}
export interface DrivingPlan {
  driving_s: number;
  total_with_breaks_s: number;
  /** pausas de 30 min (ou 1 h de refeição) */
  required_breaks: number;
  /** descansos diários de 11 h seguidas */
  daily_rests: number;
  regime: DrivingRegime;
  /** direção máxima por "dia" (entre dois descansos de 11 h) usada no plano */
  max_daily_driving_s: number;
  suggested_stops: SuggestedStop[];
  notes: string[];
  legal_basis: string[];
}

function fmt(s: number) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`; }

/** Direção máxima entre descansos diários. Empregado: 8 h + 2 h extras (direção é trabalho efetivo; a refeição de 1 h
 *  e as pausas não contam como jornada). Autônomo: 13 h entre descansos de 11 h, menos as 2 pausas de 30 min. */
export function maxDailyDriving(regime: DrivingRegime): number {
  const R = DRIVING_RULES;
  if (regime === 'autonomous') return R.max_span_between_rests_s - 2 * R.break_s;
  return R.employee_workday_s + R.employee_overtime_s;
}

/**
 * Plano de paradas ao longo da rota: pausa de 30 min antes de completar 5h30 de direção contínua e descanso de 11 h
 * seguidas ao atingir o limite diário. Escolhe o ponto de descanso mais próximo ANTES do limite (de preferência na
 * última 1h30). `employment` ausente = regime desconhecido: aplica o limite do empregado (mais restritivo) e avisa.
 */
export function drivingPlan(durationS: number, stops: RestStop[], opts: { employment?: Employment } = {}): DrivingPlan {
  const R = DRIVING_RULES;
  const regime: DrivingRegime = opts.employment ?? 'unknown';
  const dailyCap = maxDailyDriving(regime);
  const suggested: SuggestedStop[] = [];
  let lastStop = 0;      // posição (s de direção) da última parada de qualquer tipo
  let dayStart = 0;      // posição do último descanso diário
  let mealTaken = false; // empregado: 1 h de refeição por jornada (CLT 235-C §2º), na 1ª pausa do dia
  const pick = (from: number, limit: number) => {
    const candidates = stops.filter((s) => s.eta_s > from && s.eta_s <= limit);
    return candidates.filter((s) => s.eta_s >= limit - R.prefer_window_s).pop() ?? candidates.pop() ?? null;
  };
  for (let guard = 0; guard < 200; guard++) {
    const breakLimit = lastStop + R.max_continuous_driving_s;
    const dayLimit = dayStart + dailyCap;
    if (Math.min(breakLimit, dayLimit) >= durationS) break;
    if (dayLimit <= breakLimit) {
      const best = pick(lastStop, dayLimit);
      const at = best ? best.eta_s : dayLimit;
      suggested.push({
        kind: 'daily_rest', duration_s: R.daily_rest_s, after_s: at, stop: best,
        message: best
          ? `Descanso de 11 h seguidas em ${best.name ?? best.kind} (km ${best.distance_km}, após ${fmt(at - dayStart)} de direção no dia). CTB art. 67-C §3º.`
          : `Descanso de 11 h seguidas obrigatório até ${fmt(dayLimit - dayStart)} de direção no dia, mas não há ponto de parada mapeado nesse trecho: planeje o pernoite.`,
      });
      lastStop = dayStart = at;
      mealTaken = false;
    } else {
      const best = pick(lastStop, breakLimit);
      const at = best ? best.eta_s : breakLimit;
      const meal: boolean = regime === 'employee' && !mealTaken;
      mealTaken ||= meal;
      const dur = meal ? R.employee_meal_s : R.break_s;
      const what = meal ? 'Pausa de 1 h (refeição, CLT art. 235-C §2º)' : 'Pausa de 30 min';
      suggested.push({
        kind: meal ? 'meal' : 'break', duration_s: dur, after_s: at, stop: best,
        message: best
          ? `${what} em ${best.name ?? best.kind} (~${fmt(at)} de direção, km ${best.distance_km}).`
          : `${what} obrigatória até ${fmt(breakLimit)} de direção, mas não há ponto de descanso mapeado nesse trecho.`,
      });
      lastStop = at;
    }
  }
  const breaks = suggested.filter((s) => s.kind !== 'daily_rest');
  const rests = suggested.filter((s) => s.kind === 'daily_rest');
  const notes: string[] = [];
  if (rests.length) {
    notes.push(`Viagem de ${fmt(durationS)} de direção: exige ${rests.length} descanso(s) de 11 h seguidas, sem fracionar (CTB art. 67-C §3º; STF, ADI 5322).`);
  } else if (regime !== 'autonomous' && durationS > R.employee_workday_s) {
    notes.push(`Mais de 8 h de direção: para motorista empregado só com hora extra (até 2 h, ou 4 h com acordo coletivo — CLT art. 235-C).`);
  }
  if (regime === 'unknown' && durationS > R.employee_workday_s) {
    notes.push('Vínculo do motorista não informado: plano feito com o limite do empregado CLT (10 h). Autônomo (TAC) segue só o CTB: 11 h de descanso a cada 24 h.');
  }
  if (regime === 'employee' && durationS > 4 * 3600) {
    notes.push('Espera para carga/descarga e fiscalização conta como jornada (STF, ADI 5322): o tempo real disponível para dirigir pode ser menor.');
  }
  return {
    driving_s: durationS,
    total_with_breaks_s: durationS + suggested.reduce((a, s) => a + s.duration_s, 0),
    required_breaks: breaks.length,
    daily_rests: rests.length,
    regime,
    max_daily_driving_s: dailyCap,
    suggested_stops: suggested,
    notes,
    legal_basis: R.legal_basis,
  };
}
