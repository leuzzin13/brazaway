import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MLMap, Marker, Popup } from 'maplibre-gl';
import { api, REPORT_TYPES, REST_KINDS, REST_SOURCES, type LatLon, type LayerMeta, type Report, type RouteResult } from '../lib/api';

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
  dataLayers: LayerMeta[];
  visibleLayers: Set<string>;
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
  const restMarkers = useRef<Marker[]>([]);
  const loadedLayers = useRef<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
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
      setReady(true);
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
      // clique numa feição de camada de dados abre popup, não define origem/destino
      if (!propsRef.current.reportMode) {
        const ids = [...loadedLayers.current].flatMap((id) => [`lyr-${id}`, `lyr-${id}-line`]).filter((id) => m.getLayer(id));
        if (ids.length && m.queryRenderedFeatures(e.point, { layers: ids }).length) return;
      }
      propsRef.current.onMapClick({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    map.current = m;
    (window as unknown as { __truckMap?: MLMap }).__truckMap = m; // depuração
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

  // pontos de descanso da rota (destaque nos sugeridos pelo plano de direção)
  useEffect(() => {
    const m = map.current; if (!m) return;
    restMarkers.current.forEach((mk) => mk.remove()); restMarkers.current = [];
    if (!p.route) return;
    const suggested = new Set(p.route.driving_plan?.suggested_stops.map((s) => s.stop?.id).filter(Boolean));
    for (const s of p.route.rest_stops ?? []) {
      const d = document.createElement('div');
      d.className = 'rest-marker' + (suggested.has(s.id) ? ' suggested' : '');
      d.textContent = '🅿️';
      const h = Math.floor(s.eta_s / 3600), mi = Math.round((s.eta_s % 3600) / 60);
      const pop = new Popup({ offset: 14, maxWidth: '260px' }).setHTML(`<div class="pp"><div class="pp-title">${escapeHtml(s.name ?? REST_KINDS[s.kind] ?? s.kind)}</div><div class="pp-row">${escapeHtml(s.category ?? REST_KINDS[s.kind] ?? s.kind)}${s.vagas ? ` · ${s.vagas} vagas` : ''}</div><div class="pp-row pp-meta">km ${s.distance_km} · ~${h ? `${h}h${String(mi).padStart(2, '0')}` : `${mi} min`} de direção · ${Math.round(s.off_route_m)} m da rota${suggested.has(s.id) ? ' · <strong>parada sugerida</strong>' : ''}</div><div class="pp-row pp-meta">Fonte: ${escapeHtml(REST_SOURCES[s.source ?? 'osm'] ?? s.source ?? 'OpenStreetMap')}</div></div>`);
      restMarkers.current.push(new Marker({ element: d, anchor: 'center' }).setLngLat([s.lon, s.lat]).setPopup(pop).addTo(m));
    }
  }, [p.route]);

  // camadas de dados genéricas (/api/layers/:id/features)
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    let timer: number | undefined;
    const metaById = new Map(p.dataLayers.map((l) => [l.id, l]));
    const removeLayer = (id: string) => {
      for (const suffix of ['', '-line', '-outline']) if (m.getLayer(`lyr-${id}${suffix}`)) m.removeLayer(`lyr-${id}${suffix}`);
      if (m.getSource(`lyr-${id}`)) m.removeSource(`lyr-${id}`);
      loadedLayers.current.delete(id);
    };
    const ensureLayer = (meta: LayerMeta) => {
      const id = meta.id, st = meta.style!, src = `lyr-${id}`;
      if (m.getSource(src)) return;
      m.addSource(src, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const before = m.getLayer('route-casing') ? 'route-casing' : undefined;
      const mz = st.minzoom ?? 0;
      if (st.kind === 'line') m.addLayer({ id: src, type: 'line', source: src, minzoom: mz, paint: { 'line-color': st.color, 'line-width': st.width ?? 2, 'line-opacity': st.opacity ?? 0.85 } }, before);
      else if (st.kind === 'fill') {
        m.addLayer({ id: src, type: 'fill', source: src, minzoom: mz, paint: { 'fill-color': st.color, 'fill-opacity': st.opacity ?? 0.2 } }, before);
        m.addLayer({ id: `${src}-outline`, type: 'line', source: src, minzoom: mz, paint: { 'line-color': st.color, 'line-width': 1 } }, before);
      } else if (st.kind === 'heatmap') m.addLayer({ id: src, type: 'heatmap', source: src, minzoom: mz, paint: { 'heatmap-weight': ['coalesce', ['get', 'weight'], 1], 'heatmap-radius': st.radius ?? 18, 'heatmap-opacity': st.opacity ?? 0.6, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.3, st.color, 1, '#7f1d1d'] } }, before);
      else {
        m.addLayer({ id: src, type: 'circle', source: src, minzoom: mz, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': ['coalesce', ['get', 'color'], st.color], 'circle-radius': st.radius ?? 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-opacity': st.opacity ?? 0.9 } }, before);
        m.addLayer({ id: `${src}-line`, type: 'line', source: src, minzoom: mz, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': st.color, 'line-width': st.width ?? 3, 'line-opacity': st.opacity ?? 0.85 } }, before);
      }
      const onClick = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0]; if (!f || propsRef.current.reportMode) return;
        const props = f.properties ?? {};
        const rows = Object.entries(props).filter(([k, v]) => v !== null && v !== '' && v !== 'null' && !['id', 'weight', 'icon', 'color'].includes(k)).slice(0, 12)
          .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v)).slice(0, 160)}</td></tr>`).join('');
        new Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(`<div class="pp"><div class="pp-title">${escapeHtml(String(props.icon ?? st.icon ?? ''))} ${escapeHtml(String(props.name ?? meta.label))}</div><table class="pp-table">${rows}</table><div class="pp-meta">${escapeHtml(meta.sources.map((s) => s.name).join(' · '))}</div></div>`).addTo(m);
      };
      for (const lid of [src, `${src}-line`]) if (m.getLayer(lid)) {
        m.on('click', lid, onClick);
        m.on('mouseenter', lid, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', lid, () => { m.getCanvas().style.cursor = propsRef.current.reportMode ? 'crosshair' : ''; });
      }
      loadedLayers.current.add(id);
    };
    const refresh = () => {
      const b = m.getBounds();
      const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      for (const id of p.visibleLayers) {
        const meta = metaById.get(id); if (!meta?.style || !meta.has_features) continue;
        ensureLayer(meta);
        api.layerFeatures(id, bbox, m.getZoom()).then((fc) => (m.getSource(`lyr-${id}`) as maplibregl.GeoJSONSource | undefined)?.setData(fc)).catch(() => {});
      }
    };
    const apply = () => {
      for (const id of [...loadedLayers.current]) if (!p.visibleLayers.has(id)) removeLayer(id);
      refresh();
    };
    const onMove = () => { window.clearTimeout(timer); timer = window.setTimeout(refresh, 350); };
    apply();
    m.on('moveend', onMove);
    return () => { m.off('moveend', onMove); window.clearTimeout(timer); };
  }, [p.visibleLayers, p.dataLayers, ready]);

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
