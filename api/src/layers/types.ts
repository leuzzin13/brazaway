/**
 * Contrato das camadas de dados. Cada arquivo `*.layer.ts` nesta pasta exporta `default` um RouteLayer
 * e é carregado automaticamente (ver index.ts). Uma camada pode:
 *  - exclusions(): polígonos que viram exclude_polygons no Valhalla (bloqueio duro, inclui travessias);
 *  - costLines(): trechos de via penalizados via linear_cost_factors (bloqueio "macio" que NÃO afeta ruas que cruzam);
 *  - annotate(): depois da rota, devolver avisos, linhas de resumo e dados próprios;
 *  - features(): feições para o mapa (bbox).
 * Dados de terceiros ficam na tabela data_features (layer_id = meta.id), separada do OSM e dos reportes.
 */
import type { Vehicle } from '../services/vehicle.js';
import type { Ring } from '../services/valhalla.js';

export interface LatLon { lat: number; lon: number }

export interface RouteCtx {
  vehicle: Vehicle;
  /** instante de saída (UTC) */
  at: Date;
  /** "YYYY-MM-DDTHH:mm" no fuso local (America/Sao_Paulo) */
  departureLocal: string;
  origin: LatLon;
  destination: LatLon;
  tz: string;
}

export interface LayerItem {
  kind: 'layer';
  layer: string;
  id: string;
  name?: string;
  type?: string;
  rule?: string;
  value_num?: number | null;
  lat?: number;
  lon?: number;
  note?: string | null;
}

export interface LayerExclusion { item: LayerItem; rings: Ring[] }
/** factor > 1 encarece o trecho (Valhalla linear_cost_factors). Use 1000 para "proibido salvo sem alternativa". */
export interface LayerCostLine { item: LayerItem; coordinates: [number, number][]; factor: number }

export interface RouteLine {
  line: GeoJSON.Feature<GeoJSON.LineString>;
  distance_km: number;
  duration_s: number;
}
export interface RouteRestrictions {
  /** anéis enviados em exclude_polygons (zonas, reportes que bloqueiam o veículo, exclusões das camadas) */
  excludePolygons: Ring[];
  /** trechos enviados em linear_cost_factors (costLines das camadas) */
  costLines: { coordinates: [number, number][]; factor: number }[];
}
export interface RouteGeom extends RouteLine {
  /** rota sem nenhuma restrição (se calculada) */
  free?: RouteLine;
  /** restrições usadas na rota: camadas que calculam uma variante comparável (ex.: rota sem pedágio) reaproveitam */
  restrictions?: RouteRestrictions;
}

export interface LayerWarning { code: string; message: string; layer?: string; severity?: 'info' | 'warn' | 'danger'; lat?: number; lon?: number; id?: string }
export interface LayerAnnotation {
  warnings?: LayerWarning[];
  /** linhas curtas exibidas no resumo da rota sob o nome da camada */
  summary?: string[];
  /** dados estruturados próprios da camada (ex.: custo de pedágio por praça) */
  data?: unknown;
}

export interface LayerSource { name: string; url: string; license: string }
export interface LayerStyle {
  kind: 'circle' | 'line' | 'fill' | 'heatmap' | 'symbol';
  color: string;
  icon?: string;       // emoji usado em popups/legenda
  minzoom?: number;
  radius?: number;
  width?: number;
  opacity?: number;
}
export type LayerGroup = 'restricoes' | 'infraestrutura' | 'seguranca' | 'servicos' | 'custos' | 'relevo' | 'calendario';

export interface LayerMeta {
  id: string;
  label: string;
  description: string;
  group: LayerGroup;
  sources: LayerSource[];
  style?: LayerStyle;       // ausente = camada sem desenho no mapa
  defaultVisible?: boolean;
}

export interface RouteLayer {
  meta: LayerMeta;
  exclusions?(ctx: RouteCtx): Promise<LayerExclusion[]>;
  costLines?(ctx: RouteCtx): Promise<LayerCostLine[]>;
  annotate?(ctx: RouteCtx, route: RouteGeom): Promise<LayerAnnotation>;
  features?(bbox: [number, number, number, number], opts: { zoom?: number }): Promise<GeoJSON.FeatureCollection>;
}
