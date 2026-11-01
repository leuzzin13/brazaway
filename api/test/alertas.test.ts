import { describe, expect, it } from 'vitest';
import { priorizarAvisos } from '../src/services/alertas.js';
import { route } from './helpers.js';

// Achado da simulação de 60 dias: 12,5 avisos por rota em média; a equipe relatou que o motorista para de ler.
describe('priorizarAvisos (tela do motorista)', () => {
  const w = (code: string, severity?: 'info' | 'warn' | 'danger') => ({ code, severity, message: code });

  it('até 3 alertas, o que exige ação primeiro; risco agrupado; técnico escondido', () => {
    const r = priorizarAvisos([
      w('accident_hotspot', 'warn'), w('accident_hotspot', 'warn'), w('cargo_theft_area', 'warn'), w('radar_na_rota', 'info'),
      w('bus_lane_active', 'warn'), w('oae_altura_ok', 'info'), w('cost_line_ignored', 'info'),
      w('destination_in_zone'), w('rmsp_via_restrita_na_rota', 'danger'), w('ponte_nota_baixa', 'warn'), w('oae_restricao_historica', 'warn'),
    ]);
    expect(r.alertas_motorista.map((x) => x.code)).toEqual(['rmsp_via_restrita_na_rota', 'destination_in_zone', 'oae_restricao_historica']);
    expect(r.resumo_avisos.grupos).toEqual({ acidentes: 2, roubo_carga: 1, radares: 1, faixas_onibus: 1, pontes_nota_baixa: 1 });
    expect(r.resumo_avisos.tecnicos).toBe(2);
    expect(r.resumo_avisos.frase).toBe('2 pontos de acidente, 1 área de roubo de carga, 1 radar, 1 faixa de ônibus em horário e 1 ponte com nota baixa na rota.');
  });

  it('sem avisos: listas vazias e frase vazia', () => {
    expect(priorizarAvisos([])).toEqual({ alertas_motorista: [], resumo_avisos: { agir: 0, atencao: 0, grupos: {}, tecnicos: 0, frase: '' } });
  });
});

describe('rota com a lista priorizada', () => {
  it('CEAGESP → Porto de Santos de carreta: no máximo 3 alertas e o resto resumido', async () => {
    const r = await route({ origin: { lat: -23.537, lon: -46.7395 }, destination: { lat: -23.944, lon: -46.317 }, vehicle: { preset: 'carreta_5e' }, departure_at: '2026-11-03T08:00' });
    expect(r.status).toBe(200);
    expect(r.body.alertas_motorista.length).toBeLessThanOrEqual(3);
    expect(r.body.warnings.length).toBeGreaterThan(r.body.alertas_motorista.length);
    const acidentes = r.body.warnings.filter((x: any) => x.code === 'accident_hotspot').length;
    expect(r.body.resumo_avisos.grupos.acidentes ?? 0).toBe(acidentes);
  });
});
