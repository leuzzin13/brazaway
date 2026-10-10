/**
 * Tempo de viagem ajustado pelo horário (Grande SP).
 *
 * O Valhalla deste projeto não tem tráfego histórico (sem traffic.tar nem velocidades previstas), então o ETA é o
 * mesmo às 3h e às 18h30. Aqui aplicamos um FATOR HORÁRIO genérico só ao trecho da rota dentro da área urbana
 * (bbox em config/eta-horario.json): a forma da curva vem da lentidão média da CET em 2023 por meia hora e tipo de
 * dia; a amplitude foi calibrada para ~1,6 no pico de dia útil (27 km/h livre no Valhalla contra 16–20 km/h medidos
 * nos picos pela CET e pelo TomTom). É uma aproximação para o motorista, não velocidade por via, e NÃO altera o
 * duration_s que as camadas usam.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { env } from '../config.js';
import { legalDayInfo } from './calendar.js';

interface EtaConfig {
  fonte: string;
  fator_pico: number;
  faixa_relativa: number;
  area_bbox: [number, number, number, number];
  curva_km: Record<'util' | 'sab' | 'dom', Record<string, number>>;
}

const configDir = process.env.CONFIG_DIR ?? join(process.cwd(), '..', 'config');
let cfg: EtaConfig | null = null;
function config(): EtaConfig {
  if (!cfg) cfg = JSON.parse(readFileSync(join(configDir, 'eta-horario.json'), 'utf8')) as EtaConfig;
  return cfg;
}

export interface EtaHorario {
  /** tempo estimado no horário de saída informado */
  duration_s: number;
  /** faixa otimista / pessimista */
  faixa_s: [number, number];
  /** tempo do Valhalla (sem trânsito) */
  duration_sem_transito_s: number;
  /** fator médio aplicado ao trecho urbano */
  fator_medio: number;
  /** fração da distância dentro da área urbana considerada */
  fracao_urbana: number;
  chegada_estimada: string;
  fonte: string;
  nota: string;
}

/** Fator da meia hora (1 = madrugada de dia útil; fator_pico no pico de dia útil). Sábado/domingo/feriado usam a própria curva. */
export function fatorNaHora(local: DateTime, tipo: 'util' | 'sab' | 'dom'): number {
  const c = config();
  const util = Object.values(c.curva_km.util);
  const kmMin = Math.min(...util), kmMax = Math.max(...util);
  const hh = String(local.hour).padStart(2, '0');
  const mm = local.minute < 30 ? '00' : '30';
  const km = c.curva_km[tipo][`${hh}:${mm}`] ?? kmMin;
  return 1 + Math.max(0, (km - kmMin) / (kmMax - kmMin)) * (c.fator_pico - 1);
}

function inBbox([x, y]: number[], b: [number, number, number, number]) {
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}

/** Percorre a rota em fatias, avançando o relógio com o tempo já ajustado (a hora muda ao longo de viagens longas). */
export async function etaPorHorario(line: GeoJSON.LineString, durationS: number, at: Date): Promise<EtaHorario | null> {
  const c = config();
  const cs = line.coordinates;
  if (cs.length < 2 || durationS <= 0) return null;
  const N = Math.min(80, cs.length - 1);
  const step = (cs.length - 1) / N;
  const sliceS = durationS / N;
  let t = DateTime.fromJSDate(at).setZone(env.tz);
  let total = 0, totalLo = 0, totalHi = 0, urbanS = 0, urbanAdj = 0, urbanSlices = 0;
  const dayCache = new Map<string, 'util' | 'sab' | 'dom'>();
  for (let i = 0; i < N; i++) {
    const mid = cs[Math.min(cs.length - 1, Math.round((i + 0.5) * step))];
    if (!inBbox(mid, c.area_bbox)) { total += sliceS; totalLo += sliceS; totalHi += sliceS; t = t.plus({ seconds: sliceS }); continue; }
    const key = t.toISODate()!;
    let tipo = dayCache.get(key);
    if (!tipo) {
      const holiday = (await legalDayInfo(t.toJSDate()).catch(() => ({ holiday: null }))).holiday;
      tipo = holiday || t.weekday === 7 ? 'dom' : t.weekday === 6 ? 'sab' : 'util';
      dayCache.set(key, tipo);
    }
    const f = fatorNaHora(t, tipo);
    const adj = sliceS * f;
    total += adj;
    totalLo += sliceS * (1 + (f - 1) * (1 - c.faixa_relativa));
    totalHi += sliceS * (1 + (f - 1) * (1 + c.faixa_relativa));
    urbanS += sliceS; urbanAdj += adj; urbanSlices++;
    t = t.plus({ seconds: adj });
  }
  const chegada = DateTime.fromJSDate(at).setZone(env.tz).plus({ seconds: total });
  return {
    duration_s: Math.round(total),
    faixa_s: [Math.round(totalLo), Math.round(totalHi)],
    duration_sem_transito_s: Math.round(durationS),
    fator_medio: urbanS ? +(urbanAdj / urbanS).toFixed(2) : 1,
    fracao_urbana: +(urbanSlices / N).toFixed(2),
    chegada_estimada: chegada.toFormat("yyyy-LL-dd'T'HH:mm"),
    fonte: c.fonte,
    nota: 'Estimativa por horário (curva de lentidão da CET), só no trecho urbano da Grande SP; não é trânsito em tempo real.',
  };
}
