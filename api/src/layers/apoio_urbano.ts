/**
 * Utilitários das camadas urbanas de São Paulo (frente "apoio_urbano": carga_descarga e corredores_onibus).
 * Não é uma camada (não termina em .layer.ts, o index.ts não o carrega); só funções compartilhadas pelas duas.
 *
 * Janela semanal: { days: [1..7] (ISO, 1 = seg) | 8 (= feriado), from: "HH:MM", to: "HH:MM" }.
 * `to` pode ser "24:00"; `from > to` cruza a meia-noite (ex.: Zona Azul noturna 07:00–02:00).
 */
import { DateTime } from 'luxon';
import { env } from '../config.js';
import type { LatLon, RouteCtx } from './types.js';

export interface Win { days: number[]; from: string; to: string; tag?: string }

export const DAY_ABBR = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom', 'feriados'];

export function localParts(at: Date, tz = env.tz) {
  const d = DateTime.fromJSDate(at).setZone(tz);
  return { dow: d.weekday, hhmm: d.toFormat('HH:mm'), date: d.toISODate() ?? '', label: `${DAY_ABBR[d.weekday]} ${d.toFormat('HH:mm')}`, dt: d };
}

/**
 * A janela vale no instante `at`? Com `holiday: 'own'` (Zona Azul), num feriado só valem janelas do dia 8;
 * sem janela de feriado, a regra não opera. Com `holiday: 'weekday'` (faixas de ônibus), o feriado conta como o dia da semana.
 */
export function windowActive(ws: Win[] | null | undefined, at: Date, opts: { holiday?: boolean; holidayMode?: 'own' | 'weekday' } = {}): boolean {
  if (!ws?.length) return false;
  const { dow, hhmm } = localParts(at);
  const day = opts.holiday && (opts.holidayMode ?? 'weekday') === 'own' ? 8 : dow;
  const prev = day === 8 ? dow - 1 || 7 : day - 1 || 7;
  return ws.some((w) => {
    const to = w.to === '00:00' ? '24:00' : w.to;
    if (w.from < to) return w.days.includes(day) && hhmm >= w.from && hhmm < to;
    return (w.days.includes(day) && hhmm >= w.from) || (w.days.includes(prev) && hhmm < to);
  });
}

function fmtHour(h: string): string {
  const [hh, mm] = h.split(':');
  return mm === '00' ? `${hh}h` : `${hh}h${mm}`;
}

function fmtDays(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return 'todo dia';
  const contiguous = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (contiguous && d.length > 2) return `${DAY_ABBR[d[0]]}–${DAY_ABBR[d[d.length - 1]]}`;
  return d.map((x) => DAY_ABBR[x]).join(', ');
}

/** "seg–sex 06h–09h e 17h–20h; sáb 06h–14h" */
export function describeWins(ws: Win[] | null | undefined): string {
  if (!ws?.length) return 'horário não informado';
  const groups = new Map<string, string[]>();
  for (const w of ws) {
    const key = fmtDays(w.days);
    const range = w.from === '00:00' && (w.to === '24:00' || w.to === '00:00') ? '24h' : `${fmtHour(w.from)}–${fmtHour(w.to)}`;
    const list = groups.get(key) ?? [];
    if (!list.includes(range)) list.push(range);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([d, rs]) => `${d} ${rs.join(' e ')}`).join('; ');
}

export function distM(a: LatLon, b: LatLon): number {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Hora estimada de passagem por um ponto ANTES de a rota existir (exclusions/costLines): distância em linha reta
 * desde a origem × 1,3 (sinuosidade) a 20 km/h (média urbana de caminhão). Limitada a 4 h. É uma estimativa;
 * depois da rota, annotate() usa a fração da rota × duração.
 */
export function etaFromOrigin(ctx: RouteCtx, p: LatLon): Date {
  const km = (distM(ctx.origin, p) / 1000) * 1.3;
  const min = Math.min(240, (km / 20) * 60);
  return new Date(ctx.at.getTime() + min * 60_000);
}

/** Instante estimado em que a rota passa pela fração `f` (0..1). */
export function etaAlong(ctx: RouteCtx, durationS: number, f: number): Date {
  return new Date(ctx.at.getTime() + Math.max(0, Math.min(1, f)) * durationS * 1000);
}

let tilesetCache: { at: number; value: number | null } | null = null;
/** tileset_last_modified do Valhalla (cache de 60 s). Traçados de linear_cost_factors só valem para o tileset em que foram casados. */
export async function valhallaTileset(): Promise<number | null> {
  if (tilesetCache && Date.now() - tilesetCache.at < 60_000) return tilesetCache.value;
  let value: number | null = null;
  try {
    const r = await fetch(`${env.valhallaUrl}/status`, { signal: AbortSignal.timeout(3000) });
    value = ((await r.json()) as { tileset_last_modified?: number }).tileset_last_modified ?? null;
  } catch { value = null; }
  tilesetCache = { at: Date.now(), value };
  return value;
}

export function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}

/** "AV REBOUCAS" → "Av. Reboucas" (a fonte vem sem acento): só capitaliza e abrevia o tipo de logradouro. */
export function prettyStreet(s: string | null | undefined): string {
  if (!s) return '';
  const types: Record<string, string> = { AV: 'Av.', R: 'R.', AL: 'Al.', PC: 'Pç.', 'PÇ': 'Pç.', ES: 'Estr.', EST: 'Estr.', VD: 'Vd.', TV: 'Tv.', LGO: 'Lgo.', PTE: 'Pte.', RUA: 'R.', AVENIDA: 'Av.' };
  const small = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'ATE', 'A']);
  return s.trim().split(/\s+/).map((t, i) => {
    if (i === 0 && types[t]) return types[t];
    if (small.has(t)) return t.toLowerCase() === 'ate' ? 'até' : t.toLowerCase();
    return t.charAt(0) + t.slice(1).toLowerCase();
  }).join(' ');
}
