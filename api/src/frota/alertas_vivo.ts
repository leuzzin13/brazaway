import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { env } from '../config.js';
import { pool } from '../db.js';
import { evaluateLine } from '../services/routing.js';
import type { VehicleInput } from '../schemas.js';
import type { z } from 'zod';

/**
 * Alerta ao vivo: o motorista saiu da rota do app e vai entrar numa via ou zona proibida para o caminhão naquela hora.
 * Roda no POST /pings: pega a última posição, mede o quanto ela está fora da rota planejada e, se estiver (ou se a
 * viagem não tem rota), confere o 1,5 km à frente (no rumo do GPS, ou na direção do destino) contra as mesmas
 * restrições da rota legal (evaluateLine). Cada restrição avisa uma vez a cada 30 min por viagem; cada viagem é
 * conferida no máximo a cada 90 s (a conferência carrega as camadas). A gravação é da API (a tabela não aceita insert
 * do cliente); o motorista e a equipe leem pelo GET /alertas.
 */
const FORA_DA_ROTA_M = 250;
const A_FRENTE_M = 1500;
const INTERVALO_MS = 90_000;
const ultimaConferencia = new Map<string, number>();

export interface AlertaVivo { id: string; item_id: string | null; item_nome: string | null; mensagem: string; fora_rota_m: number | null; lat: number; lon: number }

type Ping = { lat: number; lon: number; heading_deg?: number | null; recorded_at: string };

export async function alertasAoVivo(tripId: string | null, pings: Ping[], vehicleToApi: (v: Record<string, any>) => z.infer<typeof VehicleInput>): Promise<AlertaVivo[]> {
  if (!tripId || !pings.length) return [];
  const agora = Date.now();
  if (agora - (ultimaConferencia.get(tripId) ?? 0) < INTERVALO_MS) return [];
  ultimaConferencia.set(tripId, agora);
  if (ultimaConferencia.size > 5000) for (const [k, t] of ultimaConferencia) if (agora - t > 10 * INTERVALO_MS) ultimaConferencia.delete(k);

  const p = [...pings].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).at(-1)!;
  const t = (await pool.query(
    `select t.id, t.company_id, t.driver_id, t.vehicle_id, t.status::text as status, ST_Y(t.destination) as dlat, ST_X(t.destination) as dlon,
            case when t.planned_route is null then null
                 else ST_Distance(t.planned_route::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)::int end as fora_m,
            v.plate, v.preset, v.height_m, v.width_m, v.length_m, v.weight_t, v.payload_t, v.axle_load_t, v.axle_count, v.hazmat, v.is_vuc, v.has_aetc
       from trips t left join vehicles v on v.id = t.vehicle_id where t.id = $1`, [tripId, p.lon, p.lat])).rows[0];
  if (!t || t.status !== 'em_andamento') return [];
  if (t.fora_m !== null && t.fora_m <= FORA_DA_ROTA_M) return [];

  const origem = turf.point([p.lon, p.lat]);
  const rumo = typeof p.heading_deg === 'number' ? p.heading_deg
    : t.dlat !== null ? turf.bearing(origem, turf.point([t.dlon, t.dlat])) : null;
  if (rumo === null) return [];
  const frente = turf.destination(origem, A_FRENTE_M / 1000, rumo, { units: 'kilometers' }).geometry.coordinates as [number, number];
  const veh = t.vehicle_id ? vehicleToApi(t) : {};
  const local = DateTime.fromMillis(agora).setZone(env.tz).toFormat("yyyy-LL-dd'T'HH:mm");
  const r = await evaluateLine({ origin: { lat: p.lat, lon: p.lon }, destination: { lat: frente[1], lon: frente[0] }, departure_at: local, vehicle: veh },
    [[p.lon, p.lat], frente]);
  if (!r.crossed.length) return [];

  const out: AlertaVivo[] = [];
  for (const it of r.crossed.slice(0, 3)) {
    const ja = await pool.query(`select 1 from alertas_viagem where trip_id = $1 and item_id = $2 and criado_em > now() - interval '30 minutes'`, [tripId, it.id]);
    if (ja.rowCount) continue;
    const nome = it.name ?? it.type ?? it.layer ?? 'restrição';
    const regra = 'rule' in it && it.rule ? ` (${it.rule})` : '';
    const mensagem = `Atenção: a menos de 1,5 km à frente há ${nome}${regra}, proibido para este caminhão agora. Volte para a rota do app.`;
    const ins = await pool.query(
      `insert into alertas_viagem (company_id, trip_id, driver_id, vehicle_id, item_id, item_nome, mensagem, geom, fora_rota_m)
       values ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326), $10) returning id`,
      [t.company_id, tripId, t.driver_id, t.vehicle_id, it.id, nome, mensagem, p.lon, p.lat, t.fora_m]);
    out.push({ id: ins.rows[0].id, item_id: it.id, item_nome: nome, mensagem, fora_rota_m: t.fora_m, lat: p.lat, lon: p.lon });
  }
  return out;
}
