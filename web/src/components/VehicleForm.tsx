import type { Preset, Vehicle } from '../lib/api';

interface Props { presets: Preset[]; vehicle: Vehicle; setVehicle: (v: Vehicle) => void; note?: string }

export function VehicleForm({ presets, vehicle, setVehicle, note }: Props) {
  const num = (k: keyof Vehicle, step = 0.1) => (
    <input type="number" step={step} inputMode="decimal" value={vehicle[k] as number}
      onChange={(e) => setVehicle({ ...vehicle, [k]: Number(e.target.value) })} />
  );
  return (
    <div className="vehicle">
      <div className="field">
        <label>Perfil do veículo</label>
        <select value={vehicle.preset ?? ''} onChange={(e) => {
          const p = presets.find((x) => x.id === e.target.value);
          if (p) setVehicle({ ...p, preset: p.id, plate_last_digit: vehicle.plate_last_digit });
        }}>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {note && <small className="muted">{note}</small>}
      </div>
      <div className="grid3">
        <div className="field"><label>Altura (m)</label>{num('height_m')}</div>
        <div className="field"><label>Largura (m)</label>{num('width_m')}</div>
        <div className="field"><label>Compr. (m)</label>{num('length_m')}</div>
        <div className="field"><label>Peso total (t)</label>{num('weight_t', 0.5)}</div>
        <div className="field"><label>Peso/eixo (t)</label>{num('axle_load_t', 0.5)}</div>
        <div className="field"><label>Nº eixos</label>{num('axle_count', 1)}</div>
      </div>
      <div className="grid3">
        <label className="check"><input type="checkbox" checked={vehicle.hazmat} onChange={(e) => setVehicle({ ...vehicle, hazmat: e.target.checked })} /> Carga perigosa</label>
        <label className="check"><input type="checkbox" checked={vehicle.is_vuc} onChange={(e) => setVehicle({ ...vehicle, is_vuc: e.target.checked })} /> VUC</label>
        <div className="field"><label>Final placa</label>
          <select value={vehicle.plate_last_digit ?? ''} onChange={(e) => setVehicle({ ...vehicle, plate_last_digit: e.target.value === '' ? undefined : Number(e.target.value) })}>
            <option value="">—</option>
            {[0,1,2,3,4,5,6,7,8,9].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
