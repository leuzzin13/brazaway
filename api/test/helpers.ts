import * as turf from '@turf/turf';
import pg from 'pg';

export const API = process.env.API_URL ?? 'http://localhost:3000';
export const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://truck:truck@localhost:5432/truck_router';
export const DEVICE = 'test-device-00000000';

export const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });

export async function post<T = any>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}
export async function get<T = any>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

export async function waitForStack(timeoutMs = 600_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await get('/api/health');
      if (h.body?.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('API/Valhalla não ficaram prontos a tempo (veja docker compose logs valhalla)');
}

export async function cleanupTestReports() {
  await pool.query(`delete from reports where device_id = $1`, [DEVICE]);
}

/**
 * POST /api/route com tempo limite e novas tentativas. Calcular rota é idempotente. Motivo: sob carga, o
 * encaminhamento de portas do Colima já segurou respostas prontas por vários minutos (a API registrou ~1 s; o teste
 * esperou até o limite de 300 s do fetch). Com 90 s por tentativa, uma conexão travada não derruba o teste.
 */
export async function route(body: Record<string, unknown>, attempts = 3): Promise<{ status: number; body: any }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${API}/api/route`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      return { status: res.status, body: (await res.json().catch(() => ({}))) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export function lineOf(r: any) { return turf.lineString(r.geometry.coordinates); }

/** Ponto no meio da geometria da rota (sobre uma via usada pela rota). */
export function midpointOf(r: any): { lat: number; lon: number } {
  const line = lineOf(r);
  const len = turf.length(line, { units: 'kilometers' });
  const p = turf.along(line, len / 2, { units: 'kilometers' }).geometry.coordinates;
  return { lon: p[0], lat: p[1] };
}

export function minDistM(r: any, p: { lat: number; lon: number }) {
  return turf.pointToLineDistance(turf.point([p.lon, p.lat]), lineOf(r), { units: 'meters' });
}

/** A rota entra na zona? Usa o polígono recuado 30 m: as vias que formam o contorno da zona
 *  (marginais, avenidas-limite) são liberadas por projeto (ZONE_INSET_M na API). */
export function crossesZone(r: any, zone: GeoJSON.Feature) {
  const inset = turf.buffer(zone as any, -0.03, { units: 'kilometers' }) ?? zone;
  return turf.booleanIntersects(lineOf(r), inset as any);
}

// Pontos na Grande SP para os testes. Corredor Vila Leopoldina → Pinheiros (fora da ZMRC) para o teste de viaduto.
export const PTS = {
  // viaduto: origem/destino fora da ZMRC, na zona oeste (Marginal Pinheiros / Jaguaré)
  clearanceA: { lat: -23.5316, lon: -46.7400 },   // Vila Leopoldina / CEAGESP
  clearanceB: { lat: -23.5770, lon: -46.7430 },   // Jaguaré / Butantã (USP)
  // ZMRC: Santana (norte do Tietê) → Jabaquara (sul da Bandeirantes): o caminho natural atravessa o centro expandido
  zmrcA: { lat: -23.5085, lon: -46.6350 },        // Santana
  zmrcB: { lat: -23.6420, lon: -46.6480 },        // Jabaquara
};

export const TRUCK_410 = { preset: 'truck', height_m: 4.1 };
/** VUC de São Paulo com AETC: a isenção na ZMRC e no rodízio exige a autorização (Portaria SMT 137/2018 art. 18). */
export const VUC_320 = { preset: 'vuc', height_m: 3.2, is_vuc: true, has_aetc: true };
export const CARRETA = { preset: 'carreta' };
