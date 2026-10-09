import { useState } from 'react';
import { REPORT_TYPES, type LatLon } from '../lib/api';

interface Props { point: LatLon; onSubmit: (data: { type: string; value_num?: number; note?: string; time_window?: { days: number[]; from: string; to: string } | null }) => Promise<void>; onCancel: () => void }

export function ReportForm({ point, onSubmit, onCancel }: Props) {
  const [type, setType] = useState('low_clearance');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [useWindow, setUseWindow] = useState(false);
  const [from, setFrom] = useState('07:00');
  const [to, setTo] = useState('20:00');
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = REPORT_TYPES[type];
  const needsValue = !!t.unit;

  return (
    <form className="report-form" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      if (needsValue && !value) { setErr('Informe o valor.'); return; }
      setBusy(true);
      try {
        await onSubmit({
          type, value_num: needsValue ? Number(value.replace(',', '.')) : undefined, note: note || undefined,
          time_window: useWindow ? { days: weekdaysOnly ? [1,2,3,4,5] : [1,2,3,4,5,6,7], from, to } : null,
        });
      } catch (ex: any) { setErr(ex.message ?? 'Erro ao salvar'); } finally { setBusy(false); }
    }}>
      <h3>Reportar restrição</h3>
      <small className="muted">Ponto: {point.lat.toFixed(5)}, {point.lon.toFixed(5)}</small>
      <div className="field"><label>Tipo</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(REPORT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
      </div>
      {needsValue && (
        <div className="field"><label>{type === 'low_clearance' ? 'Altura máxima' : type === 'length_limit' ? 'Comprimento máximo' : 'Peso máximo'} ({t.unit})</label>
          <input inputMode="decimal" placeholder={t.unit === 'm' ? 'ex.: 3,80' : 'ex.: 20'} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
      )}
      <div className="field"><label>Observação</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="opcional" maxLength={200} /></div>
      <label className="check"><input type="checkbox" checked={useWindow} onChange={(e) => setUseWindow(e.target.checked)} /> Só em certo horário</label>
      {useWindow && (
        <div className="grid3">
          <div className="field"><label>De</label><input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>Até</label><input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <label className="check"><input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdaysOnly(e.target.checked)} /> Só seg–sex</label>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar reporte'}</button>
      </div>
    </form>
  );
}
