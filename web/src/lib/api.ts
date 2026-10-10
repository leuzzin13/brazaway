export interface LatLon { lat: number; lon: number }
export type CargoType = 'general' | 'perishable' | 'hazmat' | 'concrete' | 'moving' | 'other';
export type Powertrain = 'diesel' | 'electric' | 'hybrid' | 'gas' | 'hydrogen';
export interface Vehicle {
  preset?: string; height_m: number; width_m: number; length_m: number; weight_t: number;
  axle_load_t: number; axle_count: number; hazmat: boolean; is_vuc: boolean; plate_last_digit?: number;
  /** SP: Autorização Especial de Trânsito de Caminhão (exigida para a isenção do VUC, perecíveis etc.) */
  has_aetc?: boolean;
  manufacture_year?: number;
  cargo_type?: CargoType;
  powertrain?: Powertrain;
  /** nº ONU do produto perigoso (4 dígitos) */
  hazmat_un?: string;
  /** perigoso fracionado para consumo local (Anexo II da Portaria SMT.GAB 051/2024) */
  hazmat_local_delivery?: boolean;
  employment?: 'employee' | 'autonomous';
}
export interface Preset extends Vehicle {
  id: string; label: string;
  /** norma e artigo que justificam os valores */
  legal_basis?: string;
  vehicle_class?: 'light' | 'rigid' | 'semitrailer' | 'truck_trailer' | 'cvc';
  requires_aet?: boolean;
}
export interface PresetsResponse { _note: string; legal_basis?: string[]; aliases?: Record<string, string>; presets: Preset[] }
export interface AvoidedItem { kind: 'report' | 'zone' | 'layer'; layer?: string; id: string; type?: string; value_num?: number | null; name?: string; rule?: string; lat?: number; lon?: number; note?: string | null }
export interface Warning { code: string; message: string; report_id?: string; zone_id?: string; layer?: string; severity?: 'info' | 'warn' | 'danger'; lat?: number; lon?: number; id?: string }
export interface RestStop {
  id: string; name: string | null; kind: string; lat: number; lon: number; distance_km: number; eta_s: number; off_route_m: number; tags: Record<string, string>;
  /** camada descanso: fonte, prioridade (1 PPD válido … 4 SAU), se serve para o descanso de 11 h */
  source?: string; tier?: number; category?: string; daily_rest_ok?: boolean; vagas?: number | null; validade?: string | null;
}
export interface DrivingPlan {
  driving_s: number; total_with_breaks_s: number; required_breaks: number;
  suggested_stops: { after_s: number; stop: RestStop | null; message: string; kind?: 'break' | 'meal' | 'daily_rest'; duration_s?: number }[];
  notes: string[];
  /** descansos diários de 11 h seguidas (CTB art. 67-C §3º; STF, ADI 5322) */
  daily_rests?: number; regime?: 'employee' | 'autonomous' | 'unknown'; max_daily_driving_s?: number; legal_basis?: string[];
}
export interface RouteResult {
  geometry: GeoJSON.LineString; distance_km: number; duration_s: number; departure_at: string;
  avoided: AvoidedItem[]; warnings: Warning[]; rest_stops: RestStop[]; driving_plan: DrivingPlan;
  layers: Record<string, { label: string; group: string; summary?: string[]; data?: any }>;
}
export interface LayerStyle { kind: 'circle' | 'line' | 'fill' | 'heatmap' | 'symbol'; color: string; icon?: string; minzoom?: number; radius?: number; width?: number; opacity?: number }
export interface LayerMeta {
  id: string; label: string; description: string; group: string; defaultVisible?: boolean; style?: LayerStyle;
  sources: { name: string; url: string; license: string }[]; has_features: boolean; affects_route: boolean; annotates_route: boolean;
  runs: { source: string; license: string; record_count: number; imported_at: string; source_url: string }[];
}
export const LAYER_GROUPS: Record<string, string> = {
  restricoes: 'Restrições', infraestrutura: 'Infraestrutura', seguranca: 'Segurança', servicos: 'Serviços e apoio',
  custos: 'Custos', relevo: 'Relevo', calendario: 'Calendário',
};
export const REST_KINDS: Record<string, string> = { rest_area: 'Área de descanso', service_area: 'Área de serviço / posto', truck_stop: 'Ponto de parada de caminhões', truck_parking: 'Estacionamento de caminhões', fuel_hgv: 'Posto com acesso a caminhão', ppd: 'Ponto de Parada e Descanso (PPD)', ppd_concessao: 'PPD de concessão', area_descanso: 'Área de descanso de concessionária', sau: 'SAU (apoio — só pausa curta)' };
export const REST_SOURCES: Record<string, string> = { osm: 'OpenStreetMap', 'ppd-mt': 'Ministério dos Transportes (PPD)', artesp: 'ARTESP', antt: 'ANTT' };
export interface Report {
  id: string; type: string; geometry: GeoJSON.Point | GeoJSON.LineString; value_num: number | null;
  time_window: { days: number[]; from: string; to: string } | null; note: string | null; score: number; status: string; confirmed: boolean; created_at: string;
}
export class ApiError extends Error { constructor(public status: number, public body: any) { super(body?.message ?? `HTTP ${status}`); } }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  presets: () => req<PresetsResponse>('/api/vehicles/presets'),
  zones: () => req<GeoJSON.FeatureCollection>('/api/zones'),
  geocode: (q: string, near?: LatLon) =>
    req<{ label: string; lat: number; lon: number }[]>(`/api/geocode?q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lon=${near.lon}` : ''}`),
  route: (body: { origin: LatLon; destination: LatLon; departure_at?: string; vehicle: Partial<Vehicle> }) =>
    req<RouteResult>('/api/route', { method: 'POST', body: JSON.stringify(body) }),
  reports: (bbox: [number, number, number, number]) => req<Report[]>(`/api/reports?bbox=${bbox.join(',')}`),
  createReport: (body: Record<string, unknown>) => req<Report>('/api/reports', { method: 'POST', body: JSON.stringify(body) }),
  layers: () => req<LayerMeta[]>('/api/layers'),
  layerFeatures: (id: string, bbox: [number, number, number, number], zoom: number) =>
    req<GeoJSON.FeatureCollection>(`/api/layers/${id}/features?bbox=${bbox.join(',')}&zoom=${Math.round(zoom)}`),
  vote: (id: string, device_id: string, vote: 1 | -1) =>
    req<{ id: string; score: number; status: string }>(`/api/reports/${id}/votes`, { method: 'POST', body: JSON.stringify({ device_id, vote }) }),
};

export const REPORT_TYPES: Record<string, { label: string; icon: string; unit?: string; color: string }> = {
  low_clearance: { label: 'Viaduto baixo', icon: '⛔', unit: 'm', color: '#dc2626' },
  weight_limit: { label: 'Limite de peso', icon: '⚖️', unit: 't', color: '#ea580c' },
  length_limit: { label: 'Limite de comprimento', icon: '📏', unit: 'm', color: '#ca8a04' },
  truck_ban: { label: 'Proibido caminhão', icon: '🚫', color: '#7c3aed' },
  hazmat_ban: { label: 'Proibido carga perigosa', icon: '☣️', color: '#be185d' },
  road_closed: { label: 'Via interditada', icon: '🚧', color: '#0369a1' },
  steep_grade: { label: 'Subida que não vence (peso)', icon: '⛰️', unit: 't', color: '#15803d' },
};
