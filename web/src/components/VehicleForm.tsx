import { useState } from 'react';
import type { CargoType, Powertrain, Preset, Vehicle } from '../lib/api';

interface Props { presets: Preset[]; vehicle: Vehicle; setVehicle: (v: Vehicle) => void; note?: string }

/** campos de PP limpos quando o veículo deixa de levar carga perigosa */
const HAZMAT_OFF = { hazmat_un: undefined, hazmat_local_delivery: undefined, hazmat_biodiesel: undefined, hazmat_qty_kg: undefined, rear_axle_count: undefined };
const CARGO: [CargoType, string][] = [
  ['general', 'Carga geral'], ['perishable', 'Perecível (alimento)'], ['hazmat', 'Produto perigoso'],
  ['concrete', 'Concreto/bomba'], ['moving', 'Mudança'], ['other', 'Outra'],
];
const POWER: [Powertrain, string][] = [
  ['diesel', 'Diesel'], ['gas', 'GNV/biometano'], ['electric', 'Elétrico'], ['hybrid', 'Híbrido'], ['hydrogen', 'Hidrogênio'],
];
const two = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, alignItems: 'end' } as const;

/** Campos que descrevem o veículo físico (vêm do preset). O resto (carga, AETC, placa...) é do usuário e sobrevive à troca de perfil. */
const DIM_KEYS = ['height_m', 'width_m', 'length_m', 'weight_t', 'axle_load_t', 'axle_count', 'is_vuc'] as const;

export function VehicleForm({ presets, vehicle, setVehicle, note }: Props) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Vehicle>) => setVehicle({ ...vehicle, ...patch });
  const num = (k: keyof Vehicle, step = 0.1) => (
    <input type="number" step={step} inputMode="decimal" value={vehicle[k] as number}
      onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<Vehicle>)} />
  );
  const preset = presets.find((p) => p.id === vehicle.preset);
  const isTruck = vehicle.weight_t > 3.5;
  const year = new Date().getFullYear();

  // resumo do que está marcado em "Autorizações e carga" (aparece fechado)
  const tags = [
    vehicle.has_aetc && 'AETC',
    vehicle.cargo_type && vehicle.cargo_type !== 'general' && vehicle.cargo_type !== 'hazmat' && CARGO.find(([k]) => k === vehicle.cargo_type)?.[1].split(' ')[0],
    vehicle.hazmat && `perigoso${vehicle.hazmat_un ? ` ONU ${vehicle.hazmat_un}` : ''}`,
    vehicle.powertrain && vehicle.powertrain !== 'diesel' && POWER.find(([k]) => k === vehicle.powertrain)?.[1],
    vehicle.manufacture_year && String(vehicle.manufacture_year),
    vehicle.payload_t !== undefined && `carga ${String(vehicle.payload_t).replace('.', ',')} t`,
    vehicle.employment && (vehicle.employment === 'autonomous' ? 'autônomo' : 'CLT'),
  ].filter(Boolean) as string[];

  // avisos curtos e acionáveis (a API devolve os oficiais em vehicle.legal_notes)
  const hints: string[] = [];
  if (vehicle.is_vuc && !vehicle.has_aetc) hints.push('VUC sem AETC é tratado como caminhão na ZMRC e no rodízio.');
  if (vehicle.is_vuc && (vehicle.width_m > 2.5 || vehicle.length_m > 7.2)) hints.push('VUC em SP: até 2,50 m de largura e 7,20 m de comprimento.');
  if (vehicle.is_vuc && vehicle.manufacture_year && year - vehicle.manufacture_year > 15) hints.push('VUC com mais de 15 anos perde a isenção.');
  if (vehicle.hazmat && !/^\d{4}$/.test(vehicle.hazmat_un ?? '')) hints.push('Informe o nº ONU (4 dígitos) para conferir as exceções de perigosos.');
  if (vehicle.cargo_type === 'perishable' && !vehicle.has_aetc && isTruck) hints.push('Perecível só entra na ZMRC (05h–12h) com AETC.');

  const setHazmat = (on: boolean) => set({
    hazmat: on,
    cargo_type: on ? 'hazmat' : vehicle.cargo_type === 'hazmat' ? 'general' : vehicle.cargo_type,
    ...(on ? {} : HAZMAT_OFF),
  });

  return (
    <div className="vehicle">
      <div className="field">
        <label>Perfil do veículo</label>
        <select value={vehicle.preset ?? ''} onChange={(e) => {
          const p = presets.find((x) => x.id === e.target.value);
          if (!p) return;
          const dims = Object.fromEntries(DIM_KEYS.map((k) => [k, p[k]])) as Partial<Vehicle>;
          // capacidade de carga é do veículo informado pelo usuário: troca de perfil limpa (o típico do perfil vira dica)
          setVehicle({ ...vehicle, ...dims, payload_t: undefined, preset: p.id });
        }}>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {preset?.legal_basis && <small className="muted" title={preset.legal_basis}>{preset.legal_basis.length > 140 ? preset.legal_basis.slice(0, 140) + '…' : preset.legal_basis}</small>}
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
        <label className="check"><input type="checkbox" checked={vehicle.hazmat} onChange={(e) => setHazmat(e.target.checked)} /> Carga perigosa</label>
        <label className="check"><input type="checkbox" checked={vehicle.is_vuc} onChange={(e) => set({ is_vuc: e.target.checked })} /> VUC</label>
        <div className="field"><label>Final placa</label>
          <select value={vehicle.plate_last_digit ?? ''} onChange={(e) => set({ plate_last_digit: e.target.value === '' ? undefined : Number(e.target.value) })}>
            <option value="">—</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <button type="button" className="btn btn-block-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        📋 Autorizações e carga{tags.length ? `: ${tags.join(' · ')}` : ''} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div>
          <label className="check" title="Autorização Especial de Trânsito de Caminhão (cadastro no DSV/CET)">
            <input type="checkbox" checked={!!vehicle.has_aetc} onChange={(e) => set({ has_aetc: e.target.checked || undefined })} /> Possui AETC (São Paulo)
          </label>
          <div style={two}>
            <div className="field"><label>Tipo de carga</label>
              <select value={vehicle.cargo_type ?? 'general'} onChange={(e) => {
                const c = e.target.value as CargoType;
                set({ cargo_type: c, hazmat: c === 'hazmat', ...(c === 'hazmat' ? {} : HAZMAT_OFF) });
              }}>
                {CARGO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field"><label>Motorização</label>
              <select value={vehicle.powertrain ?? 'diesel'} onChange={(e) => set({ powertrain: e.target.value as Powertrain })}>
                {POWER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field" title="Capacidade de carga (lotação) do CRLV. Alguns municípios restringem por ela (ex.: Belo Horizonte, acima de 5,5 t). Sem o valor, a rota considera a restrição (lado seguro).">
              <label>Capacidade de carga (t)</label>
              <input type="number" inputMode="decimal" min={0} step={0.5}
                placeholder={preset?.payload_t !== undefined ? `aprox. ${String(preset.payload_t).replace('.', ',')}` : 'do CRLV'} value={vehicle.payload_t ?? ''}
                onChange={(e) => set({ payload_t: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} />
            </div>
            <div className="field"><label>Ano de fabricação</label>
              <input type="number" inputMode="numeric" min={1950} max={year + 1} placeholder="ex.: 2018" value={vehicle.manufacture_year ?? ''}
                onChange={(e) => set({ manufacture_year: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <div className="field" title="Limite de jornada: CLT art. 235-C só para empregado; CTB art. 67-C para todos">
              <label>Vínculo do motorista</label>
              <select value={vehicle.employment ?? ''} onChange={(e) => set({ employment: (e.target.value || undefined) as Vehicle['employment'] })}>
                <option value="">Não informado</option>
                <option value="employee">Empregado (CLT)</option>
                <option value="autonomous">Autônomo (TAC)</option>
              </select>
            </div>
            {vehicle.hazmat && (
              <div className="field"><label>Nº ONU</label>
                <input type="text" inputMode="numeric" maxLength={8} placeholder="ex.: 1203" value={vehicle.hazmat_un ?? ''}
                  onChange={(e) => set({ hazmat_un: e.target.value.replace(/[^\d]/g, '').slice(0, 4) || undefined })} />
              </div>
            )}
            {vehicle.hazmat && (
              <div className="field" title="Peso bruto total da carga perigosa: abaixo da quantidade limitada (Res. ANTT 5.998/2022) a carga é dispensada de parte das regras da ANTT; as do município e do DER continuam">
                <label>Peso da carga perigosa (kg)</label>
                <input type="number" inputMode="numeric" min={0} placeholder="ex.: 300" value={vehicle.hazmat_qty_kg ?? ''}
                  onChange={(e) => set({ hazmat_qty_kg: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} />
              </div>
            )}
            {vehicle.hazmat && (
              <div className="field" title="Portaria SMT 137/2018 art. 35: na ZMRC, perigoso de consumo local/outros só em caminhão de até 2 eixos traseiros">
                <label>Eixos traseiros</label>
                <input type="number" inputMode="numeric" min={1} max={10} placeholder={String(Math.max(1, vehicle.axle_count - 1))} value={vehicle.rear_axle_count ?? ''}
                  onChange={(e) => set({ rear_axle_count: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
            )}
          </div>
          {vehicle.hazmat && (
            <label className="check">
              <input type="checkbox" checked={!!vehicle.hazmat_local_delivery} onChange={(e) => set({ hazmat_local_delivery: e.target.checked || undefined })} />
              Fracionado p/ consumo local (ex.: GLP em botijão)
            </label>
          )}
          {vehicle.hazmat && vehicle.hazmat_un === '3082' && (
            <label className="check" title="Anexo II da Portaria SMT.GAB 051/2024: o 3082 só é de consumo local quando for biodiesel">
              <input type="checkbox" checked={!!vehicle.hazmat_biodiesel} onChange={(e) => set({ hazmat_biodiesel: e.target.checked || undefined })} />
              É biodiesel (ABNT NBR 15512)
            </label>
          )}
        </div>
      )}
      {hints.map((h) => <small key={h} className="muted" style={{ display: 'block', color: '#b45309' }}>⚠️ {h}</small>)}
    </div>
  );
}
