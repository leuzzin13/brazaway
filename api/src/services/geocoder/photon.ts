/** Photon (komoot, dados OSM) — usado para POI e autocomplete de nomes de lugar.
 *  Sempre com bbox (município digitado ou UF) e com validação do município do resultado na cascata:
 *  o Photon público já mandou "Rua Santos Dumont, Santos" para Mallet-PR e, com só viés lat/lon,
 *  "Rua Joaquim Távora, 500, Santos" para a Vila Mariana (SP). */
import { env } from '../../config.js';
import { round6 } from './geo.js';
import type { GeocodeResult, Precisao } from './types.js';
import type { Bbox } from './municipios.js';

export interface PhotonOpts { lat?: number; lon?: number; limit?: number; bbox?: Bbox; timeoutMs?: number }

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string; street?: string; housenumber?: string; postcode?: string; district?: string; locality?: string;
    city?: string; county?: string; state?: string; country?: string; countrycode?: string;
    osm_key?: string; osm_value?: string; type?: string; extent?: [number, number, number, number];
  };
}

/** Raw: chama o Photon e mapeia para GeocodeResult (sem validação de município). */
export async function photonSearch(q: string, opts: PhotonOpts = {}, baseUrl = env.photonUrl): Promise<GeocodeResult[]> {
  const u = new URL('/api', baseUrl);
  u.searchParams.set('q', q);
  u.searchParams.set('limit', String(opts.limit ?? 6));
  u.searchParams.set('lang', 'default');
  if (opts.bbox) u.searchParams.set('bbox', opts.bbox.map((x) => x.toFixed(5)).join(','));
  if (opts.lat !== undefined && opts.lon !== undefined) {
    u.searchParams.set('lat', String(opts.lat));
    u.searchParams.set('lon', String(opts.lon));
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetch(u, { headers: { 'user-agent': 'truck-router-mvp' }, signal: ctl.signal });
    if (!res.ok) throw Object.assign(new Error(`Photon ${res.status}`), { statusCode: 502 });
    const j = (await res.json()) as { features: PhotonFeature[] };
    return (j.features ?? []).filter((f) => !f.properties.countrycode || f.properties.countrycode === 'BR').map(mapFeature);
  } finally {
    clearTimeout(t);
  }
}

export function mapFeature(f: PhotonFeature): GeocodeResult {
  const p = f.properties ?? {};
  const label = [p.name, p.street && p.housenumber ? `${p.street}, ${p.housenumber}` : p.street, p.district, p.city, p.state]
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(' · ');
  const precisao = photonPrecisao(p);
  return {
    label,
    lon: round6(f.geometry.coordinates[0]),
    lat: round6(f.geometry.coordinates[1]),
    precisao,
    desvio_m: photonDesvio(p, precisao),
    fonte: 'osm',
    metodo: `photon_${p.type ?? p.osm_key ?? 'lugar'}`,
    logradouro: p.street,
    numero: p.housenumber,
    bairro: p.district ?? p.locality,
    municipio: p.city ?? p.county,
    cep: p.postcode,
    aviso: precisao === 'logradouro' || precisao === 'bairro' || precisao === 'municipio' ? 'Ponto aproximado (OSM): confira no mapa' : undefined,
  };
}

function photonPrecisao(p: PhotonFeature['properties']): Precisao {
  switch (p.type) {
    case 'house': return p.osm_key === 'place' || p.osm_key === 'building' || !p.name ? 'numero' : 'poi';
    case 'street': return 'logradouro';
    case 'locality': case 'district': return 'bairro';
    case 'city': case 'county': case 'state': case 'country': return 'municipio';
    default: return p.osm_key === 'highway' ? 'logradouro' : p.osm_key === 'place' ? 'bairro' : 'poi';
  }
}

function photonDesvio(p: PhotonFeature['properties'], precisao: Precisao): number {
  if (p.extent) {
    const [x0, y0, x1, y1] = p.extent;
    const dx = Math.abs(x1 - x0) * 102000;
    const dy = Math.abs(y1 - y0) * 111000;
    const half = Math.sqrt(dx * dx + dy * dy) / 2;
    if (half > 0) return Math.round(Math.max(precisao === 'numero' ? 30 : 50, half));
  }
  return { numero: 30, numero_aproximado: 60, poi: 75, logradouro: 400, cep: 500, bairro: 1500, municipio: 6000 }[precisao];
}
