import { vehiclePresets, type VehiclePreset } from '../config.js';
import type { z } from 'zod';
import type { VehicleInput } from '../schemas.js';

export interface Vehicle extends VehiclePreset {
  plate_last_digit?: number;
}

/** Preset + campos editáveis. Sem preset, parte do "truck". */
export function resolveVehicle(input: z.infer<typeof VehicleInput>): Vehicle {
  const presetId = input.preset ?? 'truck';
  const preset = vehiclePresets.presets.find((p) => p.id === presetId);
  if (!preset) throw Object.assign(new Error(`Preset de veículo desconhecido: ${presetId}`), { statusCode: 422 });
  const v: Vehicle = { ...preset };
  for (const k of ['height_m', 'width_m', 'length_m', 'weight_t', 'axle_load_t', 'axle_count', 'hazmat', 'is_vuc', 'plate_last_digit'] as const) {
    if (input[k] !== undefined) (v as unknown as Record<string, unknown>)[k] = input[k];
  }
  return v;
}
