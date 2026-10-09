import { useEffect, useRef } from 'react';
import maplibregl, { Map as MLMap, Marker, Popup } from 'maplibre-gl';
import { REPORT_TYPES, type LatLon, type Report, type RouteResult } from '../lib/api';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const SP_CENTER: [number, number] = [-46.6333, -23.5505];

export interface MapViewProps {
  origin: LatLon | null;
  destination: LatLon | null;
  route: RouteResult | null;
  zones: GeoJSON.FeatureCollection | null;
  reports: Report[];
  reportMode: boolean;
  onMapClick: (p: LatLon) => void;
  onBboxChange: (bbox: [number, number, number, number]) => void;
  onVote: (report: Report, vote: 1 | -1) => Promise<void>;
  pendingReportPoint: LatLon | null;
}

function reportLabel(r: Report) {
  const t = REPORT_TYPES[r.type] ?? { label: r.type, icon: '•', unit: '' };
  const v = r.value_num != null ? ` ${String(r.value_num).replace('.', ',')} ${t.unit ?? ''}` : '';
  return `${t.icon} ${t.label}${v}`;
}

export function MapView(p: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const odMarkers = useRef<{ o?: Marker; d?: Marker; pending?: Marker }>({});
  const propsRef = useRef(p);
  propsRef.current = p;

  // init
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE_URL,
      center: SP_CENTER,
      zoom: 11,
      attributionControl: false,
    });
    m.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: '© OpenStreetMap contributors · Tiles OpenFreeMap' }), 'bottom-right');
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right');
    m.on('load', () => {
      m.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.14 } });
      m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': '#d97706', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b3d91', 'line-width': 9, 'line-opacity': 0.5 } });
      m.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 5 } });
      const emit = () => {
        const b = m.getBounds();
        propsRef.current.onBboxChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      };
      emit();
      m.on('moveend', emit);
      m.on('click', 'zones-fill', (e) => {
        const f = e.features?.[0];
        if (!f || propsRef.current.reportMode) return;
        new Popup({ closeButton: true }).setLngLat(e.lngLat).setHTML(`<strong>${f.properties?.name}</strong><br/><small>${f.properties?.description ?? ''}</small><br/><small style="color:#666">Fonte: ${f.properties?.source ?? ''}</small>`).addTo(m);
      });
    });
    m.on('click', (e) => {
      // ignora cliques em markers (o MapLibre usa esse mesmo evento para abrir o popup do marker)
      const target = e.originalEvent?.target as HTMLElement | null;
      if (target?.closest?.('.maplibregl-marker, .maplibregl-popup')) return;
      propsRef.current.onMapClick({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    map.current = m;
    // Garante o tamanho correto mesmo se o container só for medido depois do mount
    const resize = () => m.resize();
    requestAnimationFrame(resize);
    setTimeout(resize, 300);
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); m.remove(); map.current = null; };
  }, []);

  // cursor
  useEffect(() => {
    if (map.current) map.current.getCanvas().style.cursor = p.reportMode ? 'crosshair' : '';
  }, [p.reportMode]);

  // zones
  useEffect(() => {
    const m = map.current; if (!m || !p.zones) return;
    const apply = () => (m.getSource('zones') as maplibregl.GeoJSONSource | undefined)?.setData(p.zones!);
    if (m.isStyleLoaded() && m.getSource('zones')) apply(); else m.once('load', apply);
  }, [p.zones]);

  // route
  useEffect(() => {
    const m = map.current; if (!m) return;
    const data: GeoJSON.FeatureCollection = p.route
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: p.route.geometry, properties: {} }] }
      : { type: 'FeatureCollection', features: [] };
    const apply = () => {
      (m.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(data);
      if (p.route) {
        const cs = p.route.geometry.coordinates;
        const b = cs.reduce((bb, c) => bb.extend(c as [number, number]), new maplibregl.LngLatBounds(cs[0] as [number, number], cs[0] as [number, number]));
        m.fitBounds(b, { padding: { top: 60, bottom: window.innerWidth < 768 ? 280 : 60, left: window.innerWidth < 768 ? 30 : 420, right: 30 }, maxZoom: 15 });
      }
    };
    if (m.isStyleLoaded() && m.getSource('route')) apply(); else m.once('load', apply);
  }, [p.route]);

  // origin / destination / pending markers
  useEffect(() => {
    const m = map.current; if (!m) return;
    const set = (key: 'o' | 'd' | 'pending', pt: LatLon | null, color: string, label: string) => {
      odMarkers.current[key]?.remove(); odMarkers.current[key] = undefined;
      if (!pt) return;
      const d = document.createElement('div');
      d.className = 'od-marker'; d.style.background = color; d.textContent = label;
      odMarkers.current[key] = new Marker({ element: d, anchor: 'bottom' }).setLngLat([pt.lon, pt.lat]).addTo(m);
    };
    set('o', p.origin, '#16a34a', 'A');
    set('d', p.destination, '#dc2626', 'B');
    set('pending', p.pendingReportPoint, '#f59e0b', '!');
  }, [p.origin, p.destination, p.pendingReportPoint]);

  // reports as HTML markers (ícone por tipo; cinza quando não confirmado)
  useEffect(() => {
    const m = map.current; if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    for (const r of p.reports) {
      const t = REPORT_TYPES[r.type] ?? { label: r.type, icon: '•', color: '#64748b' };
      const coord = r.geometry.type === 'Point' ? r.geometry.coordinates : r.geometry.coordinates[Math.floor(r.geometry.coordinates.length / 2)];
      const d = document.createElement('div');
      d.className = 'report-marker' + (r.confirmed ? '' : ' unconfirmed');
      d.style.borderColor = r.confirmed ? t.color : '#9ca3af';
      d.textContent = t.icon;
      d.title = reportLabel(r);
      const pop = new Popup({ offset: 18, maxWidth: '280px' });
      const render = (score: number) => {
        const w = r.time_window ? `<div class="pp-row">Horário: ${r.time_window.from}–${r.time_window.to}</div>` : '';
        pop.setHTML(`
          <div class="pp">
            <div class="pp-title">${reportLabel(r)}</div>
            ${r.note ? `<div class="pp-row">${escapeHtml(r.note)}</div>` : ''}
            ${w}
            <div class="pp-row pp-meta">${r.confirmed || score > 0 ? 'Confirmado' : 'Não confirmado'} · score ${score} · ${new Date(r.created_at).toLocaleDateString('pt-BR')}</div>
            <div class="pp-actions">
              <button class="btn btn-ok" data-v="1">👍 Confirmar</button>
              <button class="btn btn-no" data-v="-1">👎 Negar</button>
            </div>
          </div>`);
      };
      const attach = () => {
        pop.getElement()?.querySelectorAll<HTMLButtonElement>('button[data-v]').forEach((b) => {
          b.onclick = async () => {
            b.disabled = true;
            await propsRef.current.onVote(r, Number(b.dataset.v) as 1 | -1);
            pop.remove();
          };
        });
      };
      pop.on('open', attach);
      render(r.score);
      const mk = new Marker({ element: d, anchor: 'center' }).setLngLat(coord as [number, number]).setPopup(pop).addTo(m);
      markers.current.push(mk);
    }
  }, [p.reports]);

  return <div ref={el} className="map" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
