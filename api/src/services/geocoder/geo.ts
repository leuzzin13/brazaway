/** Utilidades geométricas simples (distâncias curtas, em metros). */
export interface Pt { lat: number; lon: number }

export function distM(a: Pt, b: Pt): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** Ponto real mais perto do centroide (medoide aproximado) e mediana das distâncias a ele. */
export function medoid<T extends Pt>(pts: T[]): { p: T; spread: number } | undefined {
  if (!pts.length) return undefined;
  const c = { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
  let best = pts[0];
  let bd = Infinity;
  for (const p of pts) {
    const d = distM(p, c);
    if (d < bd) { bd = d; best = p; }
  }
  const ds = pts.map((p) => distM(p, best)).sort((a, b) => a - b);
  return { p: best, spread: ds[Math.floor(ds.length / 2)] };
}

export const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
