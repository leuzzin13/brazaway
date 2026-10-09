import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, REPORT_TYPES, type LatLon, type Preset, type Report, type RouteResult, type Vehicle } from './lib/api';
import { getDeviceId } from './lib/deviceId';
import { MapView } from './components/MapView';
import { PlaceInput } from './components/PlaceInput';
import { VehicleForm } from './components/VehicleForm';
import { ReportForm } from './components/ReportForm';

type Pick = 'origin' | 'destination' | null;

function localNowIso() {
  const d = new Date(); d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDuration(s: number) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h${pad(m)}` : `${m} min`; }
function pad(n: number) { return String(n).padStart(2, '0'); }

export function App() {
  const deviceId = useMemo(getDeviceId, []);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetNote, setPresetNote] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [destination, setDestination] = useState<LatLon | null>(null);
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [departure, setDeparture] = useState(localNowIso());
  const [picking, setPicking] = useState<Pick>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; blocked_by?: any[] } | null>(null);
  const [zones, setZones] = useState<GeoJSON.FeatureCollection | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportMode, setReportMode] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<LatLon | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const bboxRef = useRef<[number, number, number, number] | null>(null);

  useEffect(() => {
    api.presets().then((p) => { setPresets(p.presets); setPresetNote(p._note); const t = p.presets.find((x) => x.id === 'truck') ?? p.presets[0]; setVehicle({ ...t, preset: t.id }); }).catch(() => setError({ message: 'API indisponível. Confira docker compose up.' }));
    api.zones().then(setZones).catch(() => {});
  }, []);

  const refreshReports = useCallback(async () => {
    const b = bboxRef.current; if (!b) return;
    try { setReports(await api.reports(b)); } catch { /* ignore */ }
  }, []);

  const onBboxChange = useCallback((b: [number, number, number, number]) => { bboxRef.current = b; void refreshReports(); }, [refreshReports]);

  useEffect(() => { const id = setInterval(refreshReports, 30000); return () => clearInterval(id); }, [refreshReports]);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const onMapClick = useCallback((p: LatLon) => {
    if (reportMode) { setPendingPoint(p); setSheetOpen(true); return; }
    if (picking === 'origin') { setOrigin(p); setOriginText(`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`); setPicking(null); }
    else if (picking === 'destination') { setDestination(p); setDestText(`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`); setPicking(null); }
    else if (!origin) { setOrigin(p); setOriginText(`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`); }
    else if (!destination) { setDestination(p); setDestText(`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`); }
  }, [reportMode, picking, origin, destination]);

  async function calc() {
    if (!origin || !destination || !vehicle) return;
    setLoading(true); setError(null); setRoute(null);
    try {
      const { preset, ...fields } = vehicle;
      const r = await api.route({ origin, destination, departure_at: departure, vehicle: { preset, ...fields } });
      setRoute(r);
      if (window.innerWidth < 768) setSheetOpen(true);
    } catch (e: any) {
      if (e instanceof ApiError) setError({ message: e.body?.message ?? e.message, blocked_by: e.body?.blocked_by });
      else setError({ message: e.message ?? 'Erro' });
    } finally { setLoading(false); }
  }

  async function submitReport(data: { type: string; value_num?: number; note?: string; time_window?: any }) {
    if (!pendingPoint) return;
    await api.createReport({ ...data, geometry: { type: 'Point', coordinates: [pendingPoint.lon, pendingPoint.lat] }, device_id: deviceId });
    setPendingPoint(null); setReportMode(false);
    showToast('Reporte salvo. Obrigado!');
    await refreshReports();
  }

  async function vote(r: Report, v: 1 | -1) {
    try { const res = await api.vote(r.id, deviceId, v); showToast(`Voto registrado (score ${res.score}${res.status !== 'active' ? ', desativado' : ''})`); await refreshReports(); }
    catch (e: any) { showToast(e.message ?? 'Erro ao votar'); }
  }

  return (
    <div className={'app' + (sheetOpen ? ' open' : '')}>
      <MapView origin={origin} destination={destination} route={route} zones={zones} reports={reports}
        reportMode={reportMode} onMapClick={onMapClick} onBboxChange={onBboxChange} onVote={vote} pendingReportPoint={pendingPoint} />

      <div className="topbar">
        <strong>🚛 Rota Caminhão</strong>
        <button className={'btn btn-report' + (reportMode ? ' active' : '')} onClick={() => { setReportMode(!reportMode); setPendingPoint(null); if (!reportMode) showToast('Toque no mapa no ponto da restrição'); }}>
          {reportMode ? '✕ Sair do modo reportar' : '⚠️ Reportar'}
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      <aside className="panel">
        <button className="handle" onClick={() => setSheetOpen(!sheetOpen)} aria-label="abrir/fechar painel"><span /></button>
        <div className="panel-body">
          {reportMode && pendingPoint ? (
            <ReportForm point={pendingPoint} onSubmit={submitReport} onCancel={() => setPendingPoint(null)} />
          ) : reportMode ? (
            <div className="hint"><strong>Modo reportar.</strong> Toque no mapa exatamente onde está a restrição (viaduto, ponte, placa).</div>
          ) : (
            <>
              {vehicle && <VehicleForm presets={presets} vehicle={vehicle} setVehicle={setVehicle} note={presetNote} />}
              <PlaceInput label="Origem" value={origin} onChange={(p, l) => { setOrigin(p); if (l) setOriginText(l); }} near={origin} text={originText} setText={setOriginText}
                picking={picking === 'origin'} onPickOnMap={() => { setPicking(picking === 'origin' ? null : 'origin'); if (window.innerWidth < 768) setSheetOpen(false); }} />
              <PlaceInput label="Destino" value={destination} onChange={(p, l) => { setDestination(p); if (l) setDestText(l); }} near={origin} text={destText} setText={setDestText}
                picking={picking === 'destination'} onPickOnMap={() => { setPicking(picking === 'destination' ? null : 'destination'); if (window.innerWidth < 768) setSheetOpen(false); }} />
              <div className="field"><label>Horário de saída</label><input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} /></div>
              <button className="btn btn-primary btn-block" disabled={!origin || !destination || loading} onClick={calc}>{loading ? 'Calculando…' : 'Calcular rota'}</button>

              {error && (
                <div className="error">
                  <strong>{error.message}</strong>
                  {error.blocked_by?.length ? <ul>{error.blocked_by.map((b: any) => <li key={b.id}>{b.kind === 'zone' ? `${b.name} (${b.rule})` : `${REPORT_TYPES[b.type]?.label ?? b.type}${b.value_num ? ` ${b.value_num}` : ''}`}</li>)}</ul> : null}
                </div>
              )}

              {route && (
                <div className="summary">
                  <div className="kpis"><div><span>Distância</span><strong>{route.distance_km.toFixed(1)} km</strong></div><div><span>Tempo</span><strong>{fmtDuration(route.duration_s)}</strong></div><div><span>Saída</span><strong>{route.departure_at.slice(11)}</strong></div></div>
                  <h4>Evitado nesta rota ({route.avoided.length})</h4>
                  {route.avoided.length === 0 ? <small className="muted">Nenhuma restrição no caminho natural.</small> : (
                    <ul className="list">{route.avoided.map((a) => <li key={a.id}>{a.kind === 'zone' ? `🟠 ${a.name} · ${a.rule}` : `${REPORT_TYPES[a.type!]?.icon ?? '•'} ${REPORT_TYPES[a.type!]?.label ?? a.type}${a.value_num != null ? ` ${String(a.value_num).replace('.', ',')} ${REPORT_TYPES[a.type!]?.unit ?? ''}` : ''}${a.note ? ` — ${a.note}` : ''}`}</li>)}</ul>
                  )}
                  <h4>Avisos ({route.warnings.length})</h4>
                  {route.warnings.length === 0 ? <small className="muted">Sem avisos.</small> : <ul className="list warn">{route.warnings.map((w, i) => <li key={i}>⚠️ {w.message}</li>)}</ul>}
                  {route.driving_plan && (
                    <>
                      <h4>Plano de direção · Lei 13.103</h4>
                      <small className="muted">{fmtDuration(route.driving_plan.driving_s)} de direção · {route.driving_plan.required_breaks} parada(s) de 30 min · total ~{fmtDuration(route.driving_plan.total_with_breaks_s)}. {route.rest_stops?.length ?? 0} ponto(s) de descanso a até 500 m da rota.</small>
                      {route.driving_plan.suggested_stops.length > 0 && (
                        <ul className="list">{route.driving_plan.suggested_stops.map((s, i) => <li key={i}>{s.stop ? '🅿️' : '⚠️'} {s.message}</li>)}</ul>
                      )}
                    </>
                  )}
                  <small className="muted">Limitação do MVP: zonas por horário consideram só o horário de saída, não a hora de entrada na zona.</small>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
