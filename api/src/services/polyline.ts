/** Decodifica polyline codificada do Valhalla (precisão 1e6) para [lon, lat][] */
export function decodePolyline6(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lon / 1e6, lat / 1e6]);
  }
  return coords;
}
