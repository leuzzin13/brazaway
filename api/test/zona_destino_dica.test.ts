import { describe, expect, it } from 'vitest';
import { route } from './helpers.js';

// Entrega dentro de zona restrita no horário proibido: além do aviso, o roteador diz o próximo horário liberado para
// este veículo e se um VUC com AETC entraria agora (achado da simulação de 60 dias: o app avisava sem dizer como resolver).
const BARUERI = { lat: -23.5010, lon: -46.8720 };
const SE = { lat: -23.5455, lon: -46.6360 };
const aviso = (b: any) => (b.warnings ?? []).find((w: any) => w.code === 'destination_in_zone' && /ZMRC/.test(w.message));

describe('dica na zona do destino (ZMRC)', () => {
  it('carreta na Sé às 8h de terça: liberado às 21h e VUC com AETC entra', async () => {
    const r = await route({ origin: BARUERI, destination: SE, vehicle: { preset: 'carreta_5e' }, departure_at: '2026-11-03T08:00' });
    expect(r.status).toBe(200);
    const w = aviso(r.body);
    expect(w, JSON.stringify(r.body.warnings?.map((x: any) => x.code))).toBeTruthy();
    expect(w.liberado_em).toBe('2026-11-03T21:00');
    expect(w.vuc_aetc_entra).toBe(true);
    expect(w.message).toMatch(/Horário liberado para este veículo: hoje às 21:00\. Um VUC com AETC pode entrar/);
  });

  it('sábado às 11h: a ZMRC libera às 14h do mesmo dia', async () => {
    const r = await route({ origin: BARUERI, destination: SE, vehicle: { preset: 'truck' }, departure_at: '2026-11-07T11:00' });
    const w = aviso(r.body);
    expect(w?.liberado_em).toBe('2026-11-07T14:00');
  });

  it('VUC com AETC não recebe o aviso', async () => {
    const r = await route({ origin: BARUERI, destination: SE, vehicle: { preset: 'vuc', has_aetc: true }, departure_at: '2026-11-03T08:00' });
    expect(aviso(r.body)).toBeUndefined();
  });
});
