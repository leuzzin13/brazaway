import { env } from '../config.js';

export interface GeocodeResult { label: string; lat: number; lon: number }

export interface Geocoder {
  search(q: string, opts?: { lat?: number; lon?: number; limit?: number }): Promise<GeocodeResult[]>;
}

/** Instância pública do Photon (komoot). Trocar pelo provedor definitivo via GEOCODER_PROVIDER. */
export class PhotonGeocoder implements Geocoder {
  constructor(private baseUrl = env.photonUrl) {}
  async search(q: string, opts: { lat?: number; lon?: number; limit?: number } = {}): Promise<GeocodeResult[]> {
    const u = new URL('/api', this.baseUrl);
    u.searchParams.set('q', q);
    u.searchParams.set('limit', String(opts.limit ?? 6));
    u.searchParams.set('lang', 'default');
    if (opts.lat !== undefined && opts.lon !== undefined) {
      u.searchParams.set('lat', String(opts.lat));
      u.searchParams.set('lon', String(opts.lon));
    }
    const res = await fetch(u, { headers: { 'user-agent': 'truck-router-mvp' } });
    if (!res.ok) throw Object.assign(new Error(`Photon ${res.status}`), { statusCode: 502 });
    const j = (await res.json()) as { features: any[] };
    return j.features.map((f) => {
      const p = f.properties ?? {};
      const label = [p.name, p.street && p.housenumber ? `${p.street}, ${p.housenumber}` : p.street, p.district, p.city, p.state]
        .filter(Boolean)
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' · ');
      return { label, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    });
  }
}

export function makeGeocoder(): Geocoder {
  switch (env.geocoderProvider) {
    case 'photon':
    default:
      return new PhotonGeocoder();
  }
}
