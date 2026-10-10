/**
 * Reanota com o código atual da camada relevo as rotas de um JSON da validação ([{area, k, coords, ...}]) e grava no
 * formato que lidar_eval.py lê (trechos de data.segments e, com hidden: true, de data.bumps). Rodar de dentro de api/:
 *
 *   cd api && CONFIG_DIR=$PWD/../config VALHALLA_URL=http://localhost:8002 \
 *     npx tsx ../docs/research/elevacao_rampas/validacao_lidar/reanotar.mts ../data/cache/relevo_val/carreta.json \
 *     ../data/cache/relevo_val/carreta_atual.json [preset]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import layer from '../../../../api/src/layers/relevo.layer.js';
import { resolveVehicle } from '../../../../api/src/services/vehicle.js';

const [inp, out, preset = 'carreta'] = process.argv.slice(2);
const data = JSON.parse(readFileSync(inp, 'utf8')) as { area: string; k: number; coords: [number, number][] }[];
const vehicle = resolveVehicle({ preset } as never);
const res: unknown[] = [];
for (const rt of data) {
  const ctx = { vehicle, at: new Date(), departureLocal: '2026-10-13T22:30', origin: null, destination: null, tz: 'America/Sao_Paulo' };
  const line = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: rt.coords } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o: any = await layer.annotate!(ctx as never, { line, distance_km: 0, duration_s: 0 } as never);
  const d = o.data ?? { segments: [], bumps: [], limits: null };
  res.push({
    area: rt.area, k: rt.k, coords: rt.coords, limits: d.limits,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    segs: [...d.segments.map((s: any) => ({ ...s, hidden: false })), ...d.bumps.map((s: any) => ({ ...s, hidden: true }))],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warnings: (o.warnings ?? []).map((w: any) => w.code),
  });
}
writeFileSync(out, JSON.stringify(res));
console.log(`${res.length} rotas reanotadas em ${out}`);
process.exit(0);
