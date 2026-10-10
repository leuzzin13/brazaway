import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const configDir = process.env.CONFIG_DIR ?? resolve(process.cwd(), '..', 'config');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(configDir, name), 'utf8')) as T;
}

/** light = até 3,5 t (não é caminhão); rigid = caminhão simples; semitrailer = cavalo + semirreboque;
 *  truck_trailer = caminhão + reboque (Romeu e Julieta); cvc = mais de 2 unidades (bitrem, rodotrem). */
export type VehicleClass = 'light' | 'rigid' | 'semitrailer' | 'truck_trailer' | 'cvc';

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
  vehicle_class?: VehicleClass;
  /** informativo; a API recalcula como PBT > 3,5 t (CTB Anexo I) */
  is_truck?: boolean;
  /** CVC acima de 57 t ou 19,80 m (Res. CONTRAN 882/2021 art. 18) */
  requires_aet?: boolean;
  /** Res. CONTRAN 882/2021 art. 20: CVC com AET só de dia, salvo pista dupla com separador e 2+ faixas */
  daylight_only_on_single_carriageway?: boolean;
  max_speed_kmh?: number;
  /** norma e artigo que justificam os valores do preset */
  legal_basis?: string;
}

export interface VehiclePresetsFile {
  _note: string;
  legal_basis?: string[];
  /** ids antigos aceitos pela API (ex.: "carreta" -> "carreta_5e") */
  aliases?: Record<string, string>;
  presets: VehiclePreset[];
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

export const vehiclePresets = readJson<VehiclePresetsFile>('vehicle-presets.json');

/** Resolve id de preset, aceitando os aliases dos ids antigos. */
export function findPreset(id: string): VehiclePreset | undefined {
  const real = vehiclePresets.aliases?.[id] ?? id;
  return vehiclePresets.presets.find((p) => p.id === real);
}
