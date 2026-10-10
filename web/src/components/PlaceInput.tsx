import { useEffect, useRef, useState } from 'react';
import { api, type LatLon } from '../lib/api';

/** Resultado do /api/geocode. Os campos além de label/lat/lon vêm do geocodificador próprio (ver docs/layers/geocoding.md). */
interface GeoResult {
  label: string; lat: number; lon: number;
  precisao?: 'numero' | 'numero_aproximado' | 'logradouro' | 'cep' | 'bairro' | 'municipio' | 'poi';
  desvio_m?: number; fonte?: string; aviso?: string;
}

interface Props { label: string; value: LatLon | null; onChange: (p: LatLon | null, label?: string) => void; near?: LatLon | null; onPickOnMap: () => void; picking: boolean; text: string; setText: (s: string) => void }

const PREC: Record<NonNullable<GeoResult['precisao']>, { txt: string; tag: string; color: string; bg: string; ok: boolean }> = {
  numero: { txt: 'Número exato', tag: 'nº exato', color: '#166534', bg: '#dcfce7', ok: true },
  numero_aproximado: { txt: 'Número aproximado', tag: 'nº aprox.', color: '#854d0e', bg: '#fef9c3', ok: true },
  poi: { txt: 'Local com nome (OpenStreetMap)', tag: 'local', color: '#1e40af', bg: '#dbeafe', ok: true },
  logradouro: { txt: 'Só a rua', tag: 'rua', color: '#9a3412', bg: '#ffedd5', ok: false },
  cep: { txt: 'Centro do CEP', tag: 'CEP', color: '#9a3412', bg: '#ffedd5', ok: false },
  bairro: { txt: 'Só o bairro', tag: 'bairro', color: '#991b1b', bg: '#fee2e2', ok: false },
  municipio: { txt: 'Só a cidade', tag: 'cidade', color: '#991b1b', bg: '#fee2e2', ok: false },
};

const FONTE: Record<string, string> = {
  cnefe: 'IBGE – CNEFE 2022', geosampa: 'GeoSampa (CC BY-SA)', cep: 'CEP: IPEA/IBGE', osm: '© OpenStreetMap', ibge: 'IBGE',
};

function fmtM(m?: number) {
  if (m === undefined || !Number.isFinite(m)) return '';
  return m < 1000 ? `±${Math.round(m)} m` : `±${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
}
function fonteTxt(f?: string) {
  if (!f) return '';
  return f.split('+').map((x) => FONTE[x] ?? (x === 'viacep' ? 'ViaCEP' : x)).join(' + ');
}

export function PlaceInput({ label, value, onChange, near, onPickOnMap, picking, text, setText }: Props) {
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<GeoResult | null>(null);
  const t = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(t.current);
    if (text.trim().length < 3 || !open) { setResults([]); return; }
    t.current = window.setTimeout(async () => {
      try { setResults((await api.geocode(text, near ?? { lat: -23.55, lon: -46.63 })) as GeoResult[]); } catch { setResults([]); }
    }, 350);
    return () => window.clearTimeout(t.current);
  }, [text, open, near]);

  // a precisão só vale enquanto o ponto for o da sugestão escolhida (tocar no mapa troca o ponto)
  const shown = picked && value && Math.abs(picked.lat - value.lat) < 1e-7 && Math.abs(picked.lon - value.lon) < 1e-7 ? picked : null;
  const prec = shown?.precisao ? PREC[shown.precisao] : null;

  return (
    <div className="field">
      <label>{label}</label>
      <div className="place-row">
        <input
          value={text}
          placeholder="Endereço com número, CEP ou local"
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        <button type="button" className={'btn btn-icon' + (picking ? ' active' : '')} onClick={onPickOnMap} title="Escolher no mapa">📍</button>
        {value && <button type="button" className="btn btn-icon" onClick={() => { onChange(null); setText(''); setPicked(null); }} title="Limpar">✕</button>}
      </div>
      {open && results.length > 0 && (
        <ul className="suggest">
          {results.map((r, i) => {
            const p = r.precisao ? PREC[r.precisao] : null;
            return (
              <li key={i} onMouseDown={() => { onChange({ lat: r.lat, lon: r.lon }, r.label); setText(r.label); setPicked(r); setOpen(false); }}
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span>{r.label}</span>
                {p && (
                  <span title={`${p.txt} ${fmtM(r.desvio_m)}`}
                    style={{ flex: 'none', fontSize: 11, fontWeight: 600, color: p.color, background: p.bg, borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                    {p.tag}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {value && prec && shown && (
        <div role="status" style={{ fontSize: 12, lineHeight: 1.35, color: prec.color, background: prec.bg, borderRadius: 8, padding: '6px 8px' }}>
          <strong>{prec.ok ? '✓' : '⚠️'} {prec.txt}</strong> {fmtM(shown.desvio_m)}
          {(shown.aviso || !prec.ok) && <div>{shown.aviso ?? 'Ponto aproximado: toque em 📍 e marque o portão no mapa.'}</div>}
          {shown.fonte && <div style={{ opacity: 0.75 }}>Fonte: {fonteTxt(shown.fonte)}</div>}
        </div>
      )}
      {value && <small className="muted">{value.lat.toFixed(5)}, {value.lon.toFixed(5)}{!shown ? ' · ponto marcado no mapa' : ''}</small>}
    </div>
  );
}
