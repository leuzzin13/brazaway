import { findPreset, type VehicleClass, type VehiclePreset } from '../config.js';
import type { z } from 'zod';
import type { VehicleInput } from '../schemas.js';
import { parseUns, spGroup, spGroupForLoad } from './hazmat.js';

export interface Vehicle extends VehiclePreset {
  plate_last_digit?: number;
  /** SP: Autorização Especial de Trânsito de Caminhão (cadastro no DSV) */
  has_aetc?: boolean;
  requires_aet?: boolean;
  manufacture_year?: number;
  cargo_type?: 'general' | 'perishable' | 'hazmat' | 'concrete' | 'moving' | 'other';
  powertrain?: 'diesel' | 'electric' | 'hybrid' | 'gas' | 'hydrogen';
  /** número ONU do produto perigoso (4 dígitos) */
  hazmat_un?: string;
  /** carga perigosa fracionada para consumo local (Anexo II da Portaria SMT.GAB 051/2024) quando o nº ONU também está no Anexo I */
  hazmat_local_delivery?: boolean;
  /** o ONU 3082 é biodiesel (ABNT NBR 15512): condição do 3082 no Anexo II da Portaria SMT.GAB 051/2024 */
  hazmat_biodiesel?: boolean;
  /** peso bruto total da carga perigosa, em kg (isenção por quantidade limitada, Res. ANTT 5.998/2022 Parte 3) */
  hazmat_qty_kg?: number;
  /** eixos traseiros (Portaria SMT 137/2018 art. 35); sem o campo, estimado como axle_count - 1 */
  rear_axle_count?: number;
  suspended_axles?: number;
  dual_wheels?: boolean;
  has_toll_tag?: boolean;
  cargo_od_in_city?: boolean;
  employment?: 'employee' | 'autonomous';
  /** id do preset efetivamente usado (resolve aliases como "carreta" -> "carreta_5e") */
  preset_id: string;
  /** PBT > 3,5 t (CTB Anexo I). Calculado. */
  is_truck: boolean;
  /** grupo do produto perigoso na Portaria SMT.GAB 051/2024 (calculado a partir de hazmat_un) */
  hazmat_group_sp?: HazmatGroupSP;
  /** avisos curtos sobre o enquadramento legal do veículo (calculados) */
  legal_notes: string[];
}

const EXTRA_KEYS = ['plate_last_digit', 'has_aetc', 'requires_aet', 'manufacture_year', 'cargo_type', 'powertrain', 'hazmat_un',
  'hazmat_local_delivery', 'hazmat_biodiesel', 'hazmat_qty_kg', 'rear_axle_count',
  'suspended_axles', 'dual_wheels', 'has_toll_tag', 'cargo_od_in_city', 'employment'] as const;

/** CTB Anexo I (red. Lei 14.440/2022): caminhão é o veículo de carga com PBT acima de 3.500 kg. */
export const TRUCK_MIN_PBT_T = 3.5;

/** Portaria SMT.GAB 137/2018 art. 18 (red. Portaria SMT 57/2021). */
export const VUC_SP = { max_width_m: 2.5, max_length_m: 7.2, min_manufacture_year: 2005, max_age_years: 15 } as const;

/**
 * Grupos de produtos perigosos da Portaria SMT.GAB 051/2024 (art. 2º): Anexo I = alta frequência de circulação,
 * Anexo II = consumo local, Anexo III = outros. Vários nº ONU aparecem nos Anexos I e II (ex.: 1202 diesel, 1075 GLP
 * engarrafado/fracionado): nesses casos o grupo depende da operação (hazmat_local_delivery; o 3082 só com
 * hazmat_biodiesel). A tabela dos anexos e os qualificadores do Anexo II ficam em services/hazmat.ts (fonte única,
 * a mesma da camada perigosos).
 */
export type HazmatGroupSP = 'alta_frequencia' | 'consumo_local' | 'outros' | 'ambiguo' | 'nao_listado';
/** do mais restritivo ao menos restritivo (carga com vários nº ONU fica com o pior) */
const GROUP_SP_RANK: HazmatGroupSP[] = ['nao_listado', 'alta_frequencia', 'ambiguo', 'consumo_local', 'outros'];
const GROUP_SP_OF = { I: 'nao_listado', II: 'alta_frequencia', III: 'consumo_local', IV: 'outros' } as const;

export function normalizeUn(un?: string): string | undefined {
  const d = (un ?? '').replace(/\D/g, '');
  return d.length === 4 ? d : undefined;
}

export function hazmatGroupSP(un?: string): HazmatGroupSP | undefined {
  const uns = parseUns(un);
  if (!uns.length) return undefined;
  const groups = uns.map((u): HazmatGroupSP => { const g = spGroup(u); return g.ambiguous ? 'ambiguo' : GROUP_SP_OF[g.group]; });
  return groups.sort((a, b) => GROUP_SP_RANK.indexOf(a) - GROUP_SP_RANK.indexOf(b))[0];
}

/** Produto dos grupos "consumo local" ou "outros" (Portaria SMT.GAB 051/2024 art. 2º III e IV), com os qualificadores do Anexo II. */
export function isHazmatLocalOrOther(v: Pick<Vehicle, 'hazmat' | 'hazmat_un' | 'hazmat_local_delivery' | 'hazmat_biodiesel'>): boolean {
  if (!v.hazmat) return false;
  return !!spGroupForLoad(parseUns(v.hazmat_un), !!v.hazmat_local_delivery, !!v.hazmat_biodiesel)?.interiorAllowed;
}

export function isTruck(v: Pick<Vehicle, 'weight_t'>): boolean {
  return v.weight_t > TRUCK_MIN_PBT_T;
}

/** Atende a definição de VUC de São Paulo (dimensões, ano e idade). Não verifica AETC. */
export function isVucSP(v: Pick<Vehicle, 'is_vuc' | 'width_m' | 'length_m' | 'weight_t' | 'manufacture_year'>, year = new Date().getFullYear()): boolean {
  if (!v.is_vuc || !isTruck(v)) return false;
  if (v.width_m > VUC_SP.max_width_m || v.length_m > VUC_SP.max_length_m) return false;
  if (v.manufacture_year !== undefined) {
    // §3º: idade máxima de 15 anos "excluído o ano de fabricação"
    if (v.manufacture_year < VUC_SP.min_manufacture_year || year - v.manufacture_year > VUC_SP.max_age_years) return false;
  }
  return true;
}

/** Comprimento máximo sem AET por tipo (Res. CONTRAN 882/2021 art. 4º III, red. Res. 1.005/2024). */
export const MAX_LENGTH_BY_CLASS: Record<VehicleClass, number> = { light: 14, rigid: 14, semitrailer: 19.3, truck_trailer: 19.8, cvc: 19.8 };

/** Dimensões e ano mínimo do VUC de SP (sem a idade, que depende do ano da viagem). */
function vucDimsOk(v: Vehicle): boolean {
  if (!v.is_vuc || !isTruck(v)) return false;
  if (v.width_m > VUC_SP.max_width_m || v.length_m > VUC_SP.max_length_m) return false;
  return v.manufacture_year === undefined || v.manufacture_year >= VUC_SP.min_manufacture_year;
}

/**
 * Avisos de enquadramento legal. Não dependem da data da viagem: a idade do VUC é dita com a data-limite explícita, para o
 * aviso nunca contradizer a rota (a exceção da zona usa o ano da saída — zones.ts).
 */
function legalNotes(v: Vehicle, now = new Date()): string[] {
  const notes: string[] = [];
  const year = now.getFullYear();
  if (!v.is_truck) notes.push('PBT até 3,5 t: não é caminhão (CTB, Anexo I). ZMRC não se aplica; rodízio sim, inclusive nas vias do Minianel.');
  if (v.is_vuc && !vucDimsOk(v)) {
    notes.push(`Fora da definição de VUC em SP (até ${String(VUC_SP.max_width_m).replace('.', ',')} m de largura e ${String(VUC_SP.max_length_m).replace('.', ',')} m de comprimento, fabricado a partir de ${VUC_SP.min_manufacture_year}): tratado como caminhão.`);
  } else if (v.is_vuc) {
    if (v.manufacture_year !== undefined) {
      const last = v.manufacture_year + VUC_SP.max_age_years;   // §3º: 15 anos, "excluído o ano de fabricação"
      if (last < year) notes.push(`VUC fabricado em ${v.manufacture_year}: passou do limite de 15 anos em 1º/1/${last + 1} (Portaria SMT 137/2018 art. 18 §3º) e é tratado como caminhão.`);
      else if (last <= year + 1) notes.push(`VUC fabricado em ${v.manufacture_year}: vale como VUC em São Paulo só até 31/12/${last} (15 anos, excluído o ano de fabricação — Portaria SMT 137/2018 art. 18 §3º).`);
    }
    if (!v.has_aetc) notes.push('VUC sem AETC: em São Paulo é tratado como caminhão comum na ZMRC e no rodízio (Portaria SMT 137/2018 art. 18).');
  }
  if (v.requires_aet && v.vehicle_class === 'cvc') {
    notes.push('CVC com AET (Res. CONTRAN 882/2021 art. 18): em pista simples só circula do amanhecer ao pôr do sol, a até 80 km/h (art. 20).');
  } else if (v.requires_aet) {
    notes.push('Acima dos limites de largura, altura ou comprimento da Res. CONTRAN 882/2021 (art. 4º): só circula com AET do órgão da via.');
  }
  if (v.hazmat && !parseUns(v.hazmat_un).length) notes.push('Carga perigosa: informe o nº ONU para conferir as exceções de São Paulo (Portaria SMT.GAB 051/2024).');
  if (v.hazmat && v.is_vuc) {
    const base = 'VUC com carga perigosa segue a regra de perigosos, não a do VUC (Portaria SMT 137/2018 art. 18 §4º)';
    if (isHazmatLocalOrOther(v)) notes.push(`${base}: na ZMRC, só das 10h às 16h e com AETC (art. 35).`);
    else if (!parseUns(v.hazmat_un).length) notes.push(`${base}: na ZMRC, só produto de consumo local ou "outros" tem exceção (10h às 16h, com AETC — art. 35).`);
    else notes.push(`${base}: este produto não tem exceção na ZMRC no horário da restrição (art. 35 vale só para consumo local e "outros").`);
  }
  if (isHazmatLocalOrOther(v)) {
    notes.push('Perigoso de consumo local/outros: pode circular o dia todo dentro do centro expandido, mas não nas vias do Minianel de 2ª a 6ª das 7h às 10h e das 17h às 20h, exceto feriados (Portaria SMT.GAB 051/2024 art. 3º parágrafo único). Nesses horários o app evita só as vias do Minianel (camada perigosos).');
  }
  if (v.hazmat) notes.push('Em São Paulo o transporte de perigoso exige a LETPP, expedida pelo DSV, e o transportador inscrito no CTPP (Decreto municipal 50.446/2009 art. 5º; Portaria SMT 137/2018 art. 35 §1º).');
  return notes;
}

/** Preset + campos editáveis. Sem preset, parte do "truck". Aceita ids antigos (aliases). */
export function resolveVehicle(input: z.infer<typeof VehicleInput>): Vehicle {
  const presetId = input.preset ?? 'truck';
  const preset = findPreset(presetId);
  if (!preset) throw Object.assign(new Error(`Preset de veículo desconhecido: ${presetId}`), { statusCode: 422 });
  const v = { ...preset, preset_id: preset.id } as Vehicle;
  for (const k of ['height_m', 'width_m', 'length_m', 'weight_t', 'axle_load_t', 'axle_count', 'hazmat', 'is_vuc', ...EXTRA_KEYS] as const) {
    if (input[k] !== undefined) (v as unknown as Record<string, unknown>)[k] = input[k];
  }
  // carga perigosa declarada por qualquer um dos campos
  if (v.cargo_type === 'hazmat' || parseUns(v.hazmat_un).length) v.hazmat = true;
  if (v.hazmat && v.cargo_type === undefined) v.cargo_type = 'hazmat';
  if (v.hazmat_un !== undefined) v.hazmat_un = normalizeUn(v.hazmat_un) ?? v.hazmat_un;
  v.hazmat_group_sp = v.hazmat ? hazmatGroupSP(v.hazmat_un) : undefined;
  v.is_truck = isTruck(v);
  const cls = v.vehicle_class ?? 'rigid';
  // AET é consequência das dimensões (Res. CONTRAN 882/2021 arts. 4º e 18): o usuário pode declarar que tem, nunca "dispensar".
  const overDims = v.width_m > 2.6 || v.height_m > 4.4 || v.length_m > MAX_LENGTH_BY_CLASS[cls];
  const overCvc = cls === 'cvc' && v.weight_t > 57;
  v.requires_aet = input.requires_aet === true || overDims || overCvc;
  v.legal_notes = legalNotes(v);
  return v;
}
