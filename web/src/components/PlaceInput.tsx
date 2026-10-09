import { useEffect, useRef, useState } from 'react';
import { api, type LatLon } from '../lib/api';

interface Props { label: string; value: LatLon | null; onChange: (p: LatLon | null, label?: string) => void; near?: LatLon | null; onPickOnMap: () => void; picking: boolean; text: string; setText: (s: string) => void }

export function PlaceInput({ label, value, onChange, near, onPickOnMap, picking, text, setText }: Props) {
  const [results, setResults] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [open, setOpen] = useState(false);
  const t = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(t.current);
    if (text.trim().length < 3 || !open) { setResults([]); return; }
    t.current = window.setTimeout(async () => {
      try { setResults(await api.geocode(text, near ?? { lat: -23.55, lon: -46.63 })); } catch { setResults([]); }
    }, 350);
    return () => window.clearTimeout(t.current);
  }, [text, open, near]);

  return (
    <div className="field">
      <label>{label}</label>
      <div className="place-row">
        <input
          value={text}
          placeholder="Endereço ou toque no mapa"
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        <button type="button" className={'btn btn-icon' + (picking ? ' active' : '')} onClick={onPickOnMap} title="Escolher no mapa">📍</button>
        {value && <button type="button" className="btn btn-icon" onClick={() => { onChange(null); setText(''); }} title="Limpar">✕</button>}
      </div>
      {open && results.length > 0 && (
        <ul className="suggest">
          {results.map((r, i) => (
            <li key={i} onMouseDown={() => { onChange({ lat: r.lat, lon: r.lon }, r.label); setText(r.label); setOpen(false); }}>{r.label}</li>
          ))}
        </ul>
      )}
      {value && <small className="muted">{value.lat.toFixed(5)}, {value.lon.toFixed(5)}</small>}
    </div>
  );
}
