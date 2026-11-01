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
  // capacidade de carga (lotação, CTB Anexo I), em t: restrições municipais por capacidade (ex.: BH, Portaria BHTRANS
  // DPR 138/2009 art. 1º II, com o art. 2º da 077/2014 e o art. 1º da 004/2019: acima de 5,5 t). Sem o campo, o perfil
  // traz um valor típico (aproximado) que não decide regra: a restrição por capacidade vale (lado seguro).
  payload_t: z.number().nonnegative().max(150).optional(),
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
  hazmat_biodiesel: z.boolean().optional(),         // o ONU 3082 é biodiesel (ABNT NBR 15512): única condição do 3082 no Anexo II da Portaria 051/2024
  hazmat_qty_kg: z.number().nonnegative().max(100000).optional(), // peso bruto total da carga perigosa (quantidade limitada, Res. ANTT 5.998/2022 Parte 3, 3.4.3.2)
  rear_axle_count: z.number().int().min(1).max(10).optional(),    // eixos traseiros ("até dois eixos traseiros", Portaria SMT 137/2018 art. 35)
  suspended_axles: z.number().int().min(0).max(6).optional(),
  dual_wheels: z.boolean().optional(),              // rodagem dupla (categoria de pedágio)
  has_toll_tag: z.boolean().optional(),
  cargo_od_in_city: z.boolean().optional(),         // carga com origem/destino no município (Portaria SMT 49/2021)
  employment: z.enum(['employee', 'autonomous']).optional(), // CLT (empregado) x TAC (autônomo): limites de jornada
});

// plano de abastecimento (services/abastecimento.ts)
export const Conveniado = z.object({
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ com 14 dígitos'),
  preco_rs_l: z.number().positive().max(30).optional(),           // preço fechado no contrato
  desconto_rs_l: z.number().nonnegative().max(10).optional(),     // desconto sobre o preço da ANP (ex.: PIX)
  pagamento: z.string().max(60).optional(),                       // "PIX", "cartão frota"...
  nome: z.string().max(120).optional(),
});
export type Conveniado = z.infer<typeof Conveniado>;

export const AbastecimentoInput = z.object({
  tanque_l: z.number().positive().max(3000).optional(),
  nivel_l: z.number().nonnegative().max(3000).optional(),
  nivel_pct: z.number().min(0).max(100).optional(),
  consumo_km_l: z.number().positive().max(30).optional(),
  reserva_pct: z.number().min(5).max(50).default(15),
  combustivel: z.enum(['s10', 's500']).default('s10'),
  compra_minima_l: z.number().positive().max(1000).optional(),
  // completa o tanque em posto abaixo da média da rota, pensando nas próximas viagens (padrão: sim)
  encher_no_barato: z.boolean().default(true),
  // vários níveis de saída numa só rota (ex.: [10, 20, ..., 90]): devolve planos_abastecimento, um por nível
  niveis_pct: z.array(z.number().min(0).max(100)).max(20).optional(),
  conveniados: z.array(Conveniado).max(500).default([]),
});
export type AbastecimentoInput = z.input<typeof AbastecimentoInput>;

export const RouteRequest = z.object({
  origin: LatLon,
  destination: LatLon,
  departure_at: z.string().optional(), // ISO local "YYYY-MM-DDTHH:mm" no fuso TZ
  vehicle: VehicleInput.default({}),
  abastecimento: AbastecimentoInput.optional(),   // pede o plano de abastecimento (onde parar e quantos litros)
});
export type RouteRequest = z.infer<typeof RouteRequest>;

export const ReportTypes = ['low_clearance', 'weight_limit', 'length_limit', 'truck_ban', 'hazmat_ban', 'road_closed', 'steep_grade', 'radar_movel', 'blitz'] as const;
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
