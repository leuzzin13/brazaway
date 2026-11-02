import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { env } from '../config.js';
import { pool } from '../db.js';
import { evaluateLine, idDoTrecho, usesCostLine } from '../services/routing.js';
import { bloqueiosDaEmpresa } from './bloqueios.js';
import type { VehicleInput } from '../schemas.js';
import type { z } from 'zod';

/**
 * Alerta ao vivo: o motorista saiu da rota do app e vai entrar numa via ou zona proibida para o caminhão naquela hora.
 * Roda no POST /pings: pega a última posição, mede o quanto ela está fora da rota planejada e, se estiver (ou se a
 * viagem não tem rota), confere o 1,5 km à frente (no rumo do GPS, ou na direção do destino) contra as mesmas
 * restrições da rota legal (evaluateLine). Cada restrição avisa uma vez a cada 30 min por viagem; cada viagem é
 * conferida no máximo a cada 90 s (a conferência carrega as camadas). A gravação é da API (a tabela não aceita insert
 * do cliente); o motorista e a equipe leem pelo GET /alertas.
 *
 * Trechos bloqueados pela empresa (frota/bloqueios.ts) entram na conferência: o item à frente que a empresa bloqueou
 * vira alerta 'trecho_bloqueado' (a linha desenhada vale a qualquer hora; o item de camada, quando a camada restringe).
 * Também na rota do app: a viagem planejada antes do bloqueio pode passar pelo trecho, então, com a empresa tendo
 * bloqueios, o 1,5 km seguinte da rota planejada é conferido só contra eles (a conferência inteira, que carrega as
 * camadas, só roda se uma linha bloqueada estiver à frente ou se a rota planejada usa um item bloqueado).
 * Para a equipe, a viagem com rota planejada e o motorista a mais de 250 m dela gera um 'fora_da_rota' (no máximo um a
 * cada 2 h por viagem); esse não volta na resposta do POST /pings (o app mostra os alertas em tela cheia) e o motorista
 * não o lê nem o marca como visto (policy da migration 0405).
 */
const FORA_DA_ROTA_M = 250;
const A_FRENTE_M = 1500;
const INTERVALO_MS = 90_000;
const ultimaConferencia = new Map<string, number>();

export interface AlertaVivo { id: string; tipo: string; item_id: string | null; item_nome: string | null; mensagem: string; fora_rota_m: number | null; lat: number; lon: number }

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
  const naRota = t.fora_m !== null && t.fora_m <= FORA_DA_ROTA_M;
  if (t.fora_m !== null && !naRota) await avisarForaDaRota(t, tripId, p).catch(() => undefined);
  const bloqueios = await bloqueiosDaEmpresa(pool, t.preset, t.company_id).catch(() => undefined);

  let linha: [number, number][];
  if (naRota) {
    // na rota do app: só o que a empresa bloqueou (a rota pode ter sido planejada antes do bloqueio)
    if (!bloqueios || (!bloqueios.item_ids.length && !bloqueios.linhas.length)) return [];
    const a = await rotaAFrente(tripId, p);
    if (!a) return [];
    const frente = turf.lineString(a.coords);
    const bloqueados = new Set(bloqueios.item_ids.map(idDoTrecho));
    if (!bloqueios.linhas.some((l) => usesCostLine(frente, l)) && !a.ids.some((x) => bloqueados.has(idDoTrecho(x)))) return [];
    linha = a.coords;
  } else {
    const origem = turf.point([p.lon, p.lat]);
    const rumo = typeof p.heading_deg === 'number' ? p.heading_deg
      : t.dlat !== null ? turf.bearing(origem, turf.point([t.dlon, t.dlat])) : null;
    if (rumo === null) return [];
    linha = [[p.lon, p.lat], turf.destination(origem, A_FRENTE_M / 1000, rumo, { units: 'kilometers' }).geometry.coordinates as [number, number]];
  }
  const fim = linha[linha.length - 1];
  const veh = t.vehicle_id ? vehicleToApi(t) : {};
  const local = DateTime.fromMillis(agora).setZone(env.tz).toFormat("yyyy-LL-dd'T'HH:mm");
  const r = await evaluateLine({ origin: { lat: p.lat, lon: p.lon }, destination: { lat: fim[1], lon: fim[0] }, departure_at: local, vehicle: veh, bloqueios },
    linha);
  const cruzados = naRota ? r.crossed.filter((c) => c.bloqueado_empresa) : r.crossed;
  if (!cruzados.length) return [];

  const out: AlertaVivo[] = [];
  // o que a empresa bloqueou primeiro
  const itens = [...cruzados].sort((a, b) => Number(!!b.bloqueado_empresa) - Number(!!a.bloqueado_empresa)).slice(0, 3);
  for (const it of itens) {
    const ja = await pool.query(`select 1 from alertas_viagem where trip_id = $1 and item_id = $2 and criado_em > now() - interval '30 minutes'`, [tripId, it.id]);
    if (ja.rowCount) continue;
    const nome = it.name ?? it.type ?? it.layer ?? 'restrição';
    const regra = 'rule' in it && it.rule ? ` (${it.rule})` : '';
    const tipo = it.bloqueado_empresa ? 'trecho_bloqueado' : 'restricao_a_frente';
    const mensagem = naRota
      ? `Atenção: a menos de 1,5 km à frente a rota do app passa por ${nome}, trecho bloqueado pela empresa depois que a viagem foi planejada. Fale com a central antes de seguir.`
      : it.bloqueado_empresa
        ? `Atenção: a menos de 1,5 km à frente há ${nome}, trecho bloqueado pela empresa. Volte para a rota do app.`
        : `Atenção: a menos de 1,5 km à frente há ${nome}${regra}, proibido para este caminhão agora. Volte para a rota do app.`;
    const ins = await pool.query(
      `insert into alertas_viagem (company_id, trip_id, driver_id, vehicle_id, tipo, item_id, item_nome, mensagem, geom, fora_rota_m)
       values ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($9, $10), 4326), $11) returning id`,
      [t.company_id, tripId, t.driver_id, t.vehicle_id, tipo, it.id, nome, mensagem, p.lon, p.lat, t.fora_m]);
    out.push({ id: ins.rows[0].id, tipo, item_id: it.id, item_nome: nome, mensagem, fora_rota_m: t.fora_m, lat: p.lat, lon: p.lon });
  }
  return out;
}

/**
 * O 1,5 km da rota planejada a partir do ponto dela mais perto do motorista ([lon, lat]; null no fim da rota) e os ids
 * dos itens de camada que a rota planejada usa (os avisos gravados em route_response quando a viagem foi planejada).
 */
async function rotaAFrente(tripId: string, p: Ping): Promise<{ coords: [number, number][]; ids: string[] } | null> {
  const r = (await pool.query(
    `select ST_AsGeoJSON(ST_LineSubstring(x.g, x.f, least(1, x.f + $4 / greatest(x.len, 1))))::json as frente,
            coalesce((select array_agg(distinct w->>'id') from jsonb_array_elements(x.avisos) w where w->>'id' is not null), '{}') as ids
       from (select planned_route as g, ST_LineLocatePoint(planned_route, ST_SetSRID(ST_MakePoint($2, $3), 4326)) as f,
                    ST_Length(planned_route::geography) as len,
                    case when jsonb_typeof(route_response->'warnings') = 'array' then route_response->'warnings' else '[]'::jsonb end as avisos
               from trips where id = $1 and planned_route is not null) x`, [tripId, p.lon, p.lat, A_FRENTE_M])).rows[0];
  const coords = r?.frente?.type === 'LineString' ? (r.frente.coordinates as [number, number][]) : null;
  return coords && coords.length >= 2 ? { coords, ids: r.ids as string[] } : null;
}

/** Aviso ao gestor: o motorista saiu da rota planejada (uma linha por viagem a cada 2 h; não vai para a tela do motorista). */
async function avisarForaDaRota(t: { company_id: string; driver_id: string | null; vehicle_id: string | null; fora_m: number }, tripId: string, p: Ping) {
  const ja = await pool.query(`select 1 from alertas_viagem where trip_id = $1 and tipo = 'fora_da_rota' and criado_em > now() - interval '2 hours'`, [tripId]);
  if (ja.rowCount) return;
  await pool.query(
    `insert into alertas_viagem (company_id, trip_id, driver_id, vehicle_id, tipo, mensagem, geom, fora_rota_m)
     values ($1, $2, $3, $4, 'fora_da_rota', $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8)`,
    [t.company_id, tripId, t.driver_id, t.vehicle_id, `O motorista saiu da rota do app (${t.fora_m.toLocaleString('pt-BR')} m).`, p.lon, p.lat, t.fora_m]);
}
