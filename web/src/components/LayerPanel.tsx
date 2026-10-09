import { useState } from 'react';
import { LAYER_GROUPS, type LayerMeta } from '../lib/api';

interface Props { layers: LayerMeta[]; visible: Set<string>; toggle: (id: string) => void }

export function LayerPanel({ layers, visible, toggle }: Props) {
  const [open, setOpen] = useState(false);
  const groups = Object.entries(LAYER_GROUPS)
    .map(([g, label]) => ({ g, label, items: layers.filter((l) => l.group === g) }))
    .filter((x) => x.items.length);
  return (
    <div className="layer-panel">
      <button type="button" className="btn btn-block-sm" onClick={() => setOpen(!open)}>🗺️ Camadas de dados ({layers.length}) {open ? '▲' : '▼'}</button>
      {open && groups.map(({ g, label, items }) => (
        <div key={g} className="layer-group">
          <div className="layer-group-title">{label}</div>
          {items.map((l) => {
            const n = l.runs.reduce((a, r) => a + r.record_count, 0);
            return (
              <label key={l.id} className="layer-item" title={l.description}>
                <input type="checkbox" disabled={!l.has_features} checked={visible.has(l.id)} onChange={() => toggle(l.id)} />
                <span className="layer-swatch" style={{ background: l.style?.color ?? '#94a3b8' }}>{l.style?.icon ?? ''}</span>
                <span className="layer-name">
                  {l.label}
                  <small className="muted">
                    {l.affects_route ? ' · altera a rota' : l.annotates_route ? ' · avisa na rota' : ''}
                    {n ? ` · ${n.toLocaleString('pt-BR')} registros` : ''}
                  </small>
                  <small className="muted layer-src">{l.sources.map((s) => `${s.name} (${s.license})`).join(' · ')}</small>
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
