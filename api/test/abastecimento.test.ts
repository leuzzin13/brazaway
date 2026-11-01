import { describe, expect, it } from 'vitest';
import { planejar } from '../src/services/abastecimento.js';
import { AbastecimentoInput } from '../src/schemas.js';
import { route } from './helpers.js';

const posto = (km: number, s10: number | null, extra: Record<string, unknown> = {}) => ({
  id: `p${km}`, nome: `Posto ${km}`, bandeira: null, cnpj: String(10000000000000 + km), municipio: 'X', uf: 'SP', endereco: null,
  diesel_s10: s10 === null ? null : { valor: s10, data: '2026-10-20' }, diesel_s500: null, km_rota: km, distancia_m: 50, desvio_km: 0,
  posicao: 'pmqc', aceita_caminhao: null, fonte: 'Fonte: ANP', lat: -23, lon: -46, ...extra,
});
const entrada = (x: Record<string, unknown>) => AbastecimentoInput.parse(x);

describe('planejar (menor custo, contando o custo de cada parada)', () => {
  it('no posto caro põe só o necessário; no barato completa o que falta para chegar com a reserva', () => {
    // truck: tanque 300 L, 3,5 km/L, reserva 15% (45 L); sai com 150 L; 600 km
    const p = planejar([posto(100, 7.0), posto(300, 6.5)], 600, 'truck', entrada({ tanque_l: 300, consumo_km_l: 3.5, nivel_l: 150 }));
    expect(p.paradas.map((x) => x.km_rota)).toEqual([300]);
    // 600−300 km = 85,7 L + 45 L de reserva − 64,3 L no tanque ≈ 66 L (em passos de 5 L, arredondando o consumo para cima)
    expect(p.paradas[0].litros).toBeGreaterThanOrEqual(66);
    expect(p.paradas[0].litros).toBeLessThanOrEqual(80);
    expect(p.chega_com_l).toBeGreaterThanOrEqual(45);
    expect(p.preco_medio_rota_rs_l).toBe(6.75);
    expect(p.economia_vs_media_rs).toBeCloseTo(p.litros * 6.75 - p.custo_rs, 1);
  });

  it('convênio com desconto (PIX) muda a escolha; posto sem acesso de caminhão fica de fora', () => {
    const lista = [posto(100, 6.6), posto(200, 6.8), posto(250, 6.3, { aceita_caminhao: 'sem acesso de caminhão (OSM)' })];
    const conv = [{ cnpj: String(10000000000000 + 200), desconto_rs_l: 0.4, pagamento: 'PIX' }];
    const p = planejar(lista, 700, 'truck', entrada({ tanque_l: 300, consumo_km_l: 3.5, nivel_l: 150, conveniados: conv }));
    expect(p.paradas.every((x) => x.km_rota !== 250)).toBe(true);
    const conveniado = p.paradas.find((x) => x.km_rota === 200)!;
    expect(conveniado).toMatchObject({ preco_rs_l: 6.4, origem_preco: 'convenio', pagamento: 'PIX' });
  });

  it('não para para pôr pouco: diferença de centavos não paga a parada', () => {
    const lista = [posto(50, 6.90), posto(60, 6.89), posto(70, 6.88), posto(80, 6.87), posto(300, 6.86)];
    const p = planejar(lista, 500, 'truck', entrada({ tanque_l: 300, consumo_km_l: 3.5, nivel_l: 120 }));
    expect(p.paradas.length).toBe(1);
    expect(p.paradas[0].litros).toBeGreaterThan(30);
  });

  it('sem posto com preço na rota: plano vazio com aviso; estimativas do tipo de caminhão declaradas', () => {
    const p = planejar([], 900, 'carreta_5e', entrada({}));
    expect(p.paradas).toEqual([]);
    expect(p.estimado).toEqual(['tanque de 600 L', 'consumo de 2.4 km/L', 'saída com meio tanque']);
    expect(p.avisos.join(' ')).toMatch(/Nenhum posto com preço/);
  });
});

describe('rota com plano de abastecimento', () => {
  it('Uberlândia → Cumbica de carreta saindo com 30% do tanque: para em posto com preço e chega com a reserva', async () => {
    const r = await route({ origin: { lat: -18.89, lon: -48.305 }, destination: { lat: -23.442, lon: -46.478 }, vehicle: { preset: 'carreta_6e' },
      departure_at: '2026-11-03T06:00', abastecimento: { nivel_pct: 30 } });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const p = r.body.plano_abastecimento;
    expect(p.paradas.length).toBeGreaterThan(0);
    expect(p.chega_com_l).toBeGreaterThanOrEqual(p.reserva_l - 1);
    for (const x of p.paradas) expect(x.preco_rs_l).toBeGreaterThan(3);
    expect(p.economia_vs_media_rs).toBeGreaterThanOrEqual(0);
  });

  it('sem o pedido, a rota não traz o plano', async () => {
    const r = await route({ origin: { lat: -23.537, lon: -46.7395 }, destination: { lat: -23.4538, lon: -46.5333 }, vehicle: { preset: 'truck' } });
    expect(r.body.plano_abastecimento).toBeUndefined();
  });
});
