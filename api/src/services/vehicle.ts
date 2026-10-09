import { vehiclePresets, type VehiclePreset } from '../config.js';
import type { z } from 'zod';
import type { VehicleInput } from '../schemas.js';

export interface Vehicle extends VehiclePreset {
  plate_last_digit?: number;
  has_aetc?: boolean;
  requires_aet?: boolean;
  manufacture_year?: number;
  cargo_type?: 'general' | 'perishable' | 'hazmat' | 'concrete' | 'moving' | 'other';
  powertrain?: 'diesel' | 'electric' | 'hybrid' | 'gas' | 'hydrogen';
  hazmat_un?: string;
  suspended_axles?: number;
  dual_wheels?: boolean;
  has_toll_tag?: boolean;
  cargo_od_in_city?: boolean;
  employment?: 'employee' | 'autonomous';
}

const EXTRA_KEYS = ['plate_last_digit', 'has_aetc', 'requires_aet', 'manufacture_year', 'cargo_type', 'powertrain', 'hazmat_un',
  'suspended_axles', 'dual_wheels', 'has_toll_tag', 'cargo_od_in_city', 'employment'] as const;

/** Preset + campos editáveis. Sem preset, parte do "truck". */
export function resolveVehicle(input: z.infer<typeof VehicleInput>): Vehicle {
  const presetId = input.preset ?? 'truck';
  const preset = vehiclePresets.presets.find((p) => p.id === presetId);
  if (!preset) throw Object.assign(new Error(`Preset de veículo desconhecido: ${presetId}`), { statusCode: 422 });
  const v: Vehicle = { ...preset };
  for (const k of ['height_m', 'width_m', 'length_m', 'weight_t', 'axle_load_t', 'axle_count', 'hazmat', 'is_vuc', ...EXTRA_KEYS] as const) {
    if (input[k] !== undefined) (v as unknown as Record<string, unknown>)[k] = input[k];
  }
  return v;
}
