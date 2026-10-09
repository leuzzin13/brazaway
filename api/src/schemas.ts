import { z } from 'zod';

export const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

export const VehicleInput = z.object({
  preset: z.string().optional(),                    // id de config/vehicle-presets.json (aceita ids antigos via "aliases")
  height_m: z.number().positive().max(10).optional(),
  width_m: z.number().positive().max(5).optional(),
  length_m: z.number().positive().max(40).optional(),
  weight_t: z.number().positive().max(200).optional(),
  axle_load_t: z.number().positive().max(30).optional(),
  axle_count: z.number().int().min(2).max(12).optional(),
  hazmat: z.boolean().optional(),
  is_vuc: z.boolean().optional(),
  plate_last_digit: z.number().int().min(0).max(9).optional(),
  // atributos legais/operacionais usados pelas camadas (todos opcionais)
  has_aetc: z.boolean().optional(),                 // SP: Autorização Especial de Trânsito de Caminhão (cadastro DSV); exigida p/ isenção do VUC
  requires_aet: z.boolean().optional(),             // CVC com AET (rodotrem etc.)
  manufacture_year: z.number().int().min(1950).max(2100).optional(), // VUC em SP: fabricado a partir de 2005 e até 15 anos
  cargo_type: z.enum(['general', 'perishable', 'hazmat', 'concrete', 'moving', 'other']).optional(),
  powertrain: z.enum(['diesel', 'electric', 'hybrid', 'gas', 'hydrogen']).optional(),
  hazmat_un: z.string().max(10).optional(),         // número ONU do produto perigoso (4 dígitos; "UN 1203" também é aceito)
  hazmat_local_delivery: z.boolean().optional(),    // perigoso fracionado p/ consumo local (Anexo II da Portaria SMT.GAB 051/2024)
  suspended_axles: z.number().int().min(0).max(6).optional(),
  dual_wheels: z.boolean().optional(),              // rodagem dupla (categoria de pedágio)
  has_toll_tag: z.boolean().optional(),
  cargo_od_in_city: z.boolean().optional(),         // carga com origem/destino no município (Portaria SMT 49/2021)
  employment: z.enum(['employee', 'autonomous']).optional(), // CLT (empregado) x TAC (autônomo): limites de jornada
});

export const RouteRequest = z.object({
  origin: LatLon,
  destination: LatLon,
  departure_at: z.string().optional(), // ISO local "YYYY-MM-DDTHH:mm" no fuso TZ
  vehicle: VehicleInput.default({}),
});
export type RouteRequest = z.infer<typeof RouteRequest>;

export const ReportTypes = ['low_clearance', 'weight_limit', 'length_limit', 'truck_ban', 'hazmat_ban', 'road_closed', 'steep_grade'] as const;
export type ReportType = (typeof ReportTypes)[number];

const Position = z.tuple([z.number(), z.number()]);
export const ReportGeometry = z.union([
  z.object({ type: z.literal('Point'), coordinates: Position }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(Position).min(2) }),
]);

export const TimeWindow = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1),
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
});

export const CreateReport = z.object({
  type: z.enum(ReportTypes),
  geometry: ReportGeometry,
  value_num: z.number().positive().optional().nullable(),
  time_window: TimeWindow.optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  device_id: z.string().min(8).max(100),
});

export const VoteInput = z.object({
  device_id: z.string().min(8).max(100),
  vote: z.union([z.literal(1), z.literal(-1)]),
});

export const BboxQuery = z.object({
  bbox: z
    .string()
    .transform((s) => s.split(',').map(Number))
    .pipe(z.tuple([z.number(), z.number(), z.number(), z.number()])),
});
