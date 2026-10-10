/** Tipos do geocodificador. A interface `Geocoder` é a mesma de antes (search → lista de resultados);
 *  os campos novos de `GeocodeResult` são opcionais, então quem só lê label/lat/lon continua funcionando. */

/** Cascata de precisão (do melhor para o pior). 'poi' = lugar com nome vindo do OSM/Photon. */
export type Precisao = 'numero' | 'numero_aproximado' | 'logradouro' | 'cep' | 'bairro' | 'municipio' | 'poi';

export const PRECISAO_RANK: Record<Precisao, number> = {
  numero: 0, numero_aproximado: 1, poi: 1, logradouro: 2, cep: 3, bairro: 4, municipio: 5,
};

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  /** nível da cascata em que o ponto foi resolvido */
  precisao?: Precisao;
  /** raio estimado (m) dentro do qual o endereço real deve estar */
  desvio_m?: number;
  /** de onde veio o ponto: 'cnefe' | 'geosampa' | 'cep' | 'viacep+cnefe' | 'osm' */
  fonte?: string;
  /** como foi calculado (ex.: 'cnefe_exato', 'cnefe_interpolado', 'geosampa_segmento', 'medoide_logradouro') */
  metodo?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cod_ibge?: number;
  cep?: string;
  /** aviso curto para o motorista (ex.: "Ponto aproximado: confira o portão no mapa") */
  aviso?: string;
  /** pontuação interna de ordenação (0..1+) */
  score?: number;
}

export interface SearchOpts { lat?: number; lon?: number; limit?: number }

export interface Geocoder {
  search(q: string, opts?: SearchOpts): Promise<GeocodeResult[]>;
}

export interface LatLon { lat: number; lon: number }
