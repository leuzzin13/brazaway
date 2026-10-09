import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const configDir = process.env.CONFIG_DIR ?? resolve(process.cwd(), '..', 'config');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(configDir, name), 'utf8')) as T;
}

export interface VehiclePreset {
  id: string;
  label: string;
  height_m: number;
  width_m: number;
  length_m: number;
  weight_t: number;
  axle_load_t: number;
  axle_count: number;
  hazmat: boolean;
  is_vuc: boolean;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://truck:truck@localhost:5432/truck_router',
  valhallaUrl: process.env.VALHALLA_URL ?? 'http://localhost:8002',
  reportBufferM: Number(process.env.REPORT_BUFFER_M ?? 25),
  warnRadiusM: Number(process.env.WARN_RADIUS_M ?? 100),
  tz: process.env.TZ ?? 'America/Sao_Paulo',
  geocoderProvider: process.env.GEOCODER_PROVIDER ?? 'photon',
  photonUrl: process.env.PHOTON_URL ?? 'https://photon.komoot.io',
};

export const vehiclePresets = readJson<{ _note: string; presets: VehiclePreset[] }>('vehicle-presets.json');
