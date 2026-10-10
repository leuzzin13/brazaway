import { beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { get, route, waitForStack } from '../helpers.js';
import { describeProduct, getProduct, hazmatInfo, limitedQuantity, parseUns, productCount, spGroup, spGroupForLoad } from '../../src/services/hazmat.js';

/**
 * Camada "perigosos" (produtos perigosos). Roda contra a API local (API_URL) com os dados importados
 * (importers: hazmat_trechos_der, hazmat_minianel_vias, cetesb_emergencias, hazmat_paradas_artesp, hazmat_aprm, hazmat_municipio_sp).
 * 2026-10-13 é terça-feira.
 */

type Line = { coords: [number, number][]; bbox: [number, number, number, number] };

async function layerLines(kind: string, bbox: [number, number, number, number]): Promise<Line[]> {
  const r = await get(`/api/layers/perigosos/features?bbox=${bbox.join(',')}&zoom=14`);
  expect(r.status).toBe(200);
  return (r.body.features as any[])
    .filter((f) => f.properties.kind === kind && f.geometry.type === 'LineString')
    .map((f) => ({ coords: f.geometry.coordinates, bbox: turf.bbox(f) as [number, number, number, number] }));
}

/** metros da rota que correm a até `tolM` de alguma das linhas (meio de cada segmento da rota) */
function overlapM(routeBody: any, lines: Line[], tolM = 8): number {
  const cs: [number, number][] = routeBody.geometry.coordinates;
  const pad = 0.0002;
  let m = 0;
  for (let i = 0; i < cs.length - 1; i++) {
    const a = cs[i], b = cs[i + 1];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const seg = turf.distance(a, b, { units: 'meters' });
    const hit = lines.some((l) => mid[0] >= l.bbox[0] - pad && mid[0] <= l.bbox[2] + pad && mid[1] >= l.bbox[1] - pad && mid[1] <= l.bbox[3] + pad
      && turf.pointToLineDistance(turf.point(mid), turf.lineString(l.coords), { units: 'meters' }) <= tolM);
    if (hit) m += seg;
  }
  return m;
}

const GASOLINA = { preset: 'truck', hazmat: true, hazmat_un: '1203' };
const TRUCK = { preset: 'truck' };
// Osasco (oeste do Cebolão) -> Penha (leste da Av. Salim Farah Maluf): o caminho natural é a Marginal Tietê (via do Minianel)
const OSASCO = { lat: -23.532, lon: -46.775 };
const PENHA = { lat: -23.522, lon: -46.552 };
// SP-008 (Rod. Arão Sahm): divisa SP/Mairiporã -> Mairiporã; o caminho natural passa pelo km 25,28–31,5
const SP008_A = { lat: -23.39, lon: -46.576 };
const SP008_B = { lat: -23.33, lon: -46.58 };
const MIAN_BBOX: [number, number, number, number] = [-46.80, -23.66, -46.53, -23.48];
const SP008_BBOX: [number, number, number, number] = [-46.62, -23.42, -46.54, -23.30];

describe('hazmat.ts — tabela ONU, grupos de SP e quantidade limitada', () => {
  it('Relação da ANTT carregada com os valores da coluna 8', () => {
    expect(productCount()).toBeGreaterThan(2300);
    expect(getProduct('1203')).toMatchObject({ cls: '3', lqVehicle: 333 });   // gasolina
    expect(getProduct('1202')).toMatchObject({ cls: '3', lqVehicle: 1000 });  // diesel
    expect(getProduct('1017')).toMatchObject({ cls: '2.3', lqVehicle: 20 });  // cloro
    expect(getProduct('1798')?.lqVehicle).toBe('PROIBIDO');
    expect(describeProduct('1203')).toMatch(/^ONU 1203 \(.*GASOLINA.*classe 3\)$/);
  });

  it('grupos da Portaria SMT.GAB 051/2024', () => {
    expect(spGroup('1203')).toMatchObject({ group: 'II', ambiguous: true, interiorAllowed: false });  // Anexos I e II
    expect(spGroup('1203', true).group).toBe('III');                                                   // entrega fracionada p/ consumo local
    expect(spGroup('1046').group).toBe('III');   // hélio (Anexo II)
    expect(spGroup('2908').group).toBe('IV');    // radioativo, volume exceptivo (Anexo III)
    expect(spGroup('1017').group).toBe('I');     // cloro: fora dos anexos = alta periculosidade (Decreto 50.446 art. 3º I)
    expect(spGroupForLoad(['2908', '1017'])?.group).toBe('I');
  });

  it('isenção por quantidade limitada: menor valor entre os produtos, peso bruto <= limite', () => {
    expect(limitedQuantity(['1203'], 300).exempt).toBe(true);
    expect(limitedQuantity(['1203'], 400).exempt).toBe(false);
    expect(limitedQuantity(['1203', '1017'], 25)).toMatchObject({ limitKg: 20, exempt: false });
    expect(limitedQuantity(['1203']).exempt).toBeNull();
    expect(parseUns('UN 1203 / 1202')).toEqual(['1203', '1202']);
    expect(hazmatInfo({ hazmat: false, hazmat_un: '1203' } as any).active).toBe(true);
  });
});

describe('Camada perigosos na rota', () => {
  let minianel: Line[];
  let sp008: Line[];
  beforeAll(async () => {
    await waitForStack();
    minianel = await layerLines('via_minianel', MIAN_BBOX);
    sp008 = await layerLines('trecho_proibido', SP008_BBOX);
    expect(minianel.length, 'vias do Minianel não importadas (importer hazmat_minianel_vias)').toBeGreaterThan(50);
    expect(sp008.length, 'trecho da SP-008 não importado (importer hazmat_trechos_der)').toBe(1);
  }, 120_000);

  it('camada aparece no catálogo com fontes e cargas registradas', async () => {
    const r = await get('/api/layers');
    const l = r.body.find((x: any) => x.id === 'perigosos');
    expect(l).toBeTruthy();
    expect(l.affects_route).toBe(true);
    expect(l.runs.map((x: any) => x.source)).toEqual(expect.arrayContaining(['der-sp', 'osm-minianel', 'cetesb', 'artesp']));
  });

  // 09h30: janela de perigosos (07–10h, Portaria SMT.GAB 051/2024) ativa, mas a VER § 4 da Marginal Tietê
  // (05–09h e 17–21h, Portaria SMT 137/2018) não — assim o efeito medido é só o da camada de perigosos.
  it('sem carga perigosa, às 09h30 de terça, o caminhão usa a Marginal Tietê (Minianel)', async () => {
    const r = await route({ origin: OSASCO, destination: PENHA, vehicle: TRUCK, departure_at: '2026-10-13T09:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, minianel), 'pré-condição: o caminho natural usa as vias do Minianel').toBeGreaterThan(5000);
    expect(r.body.avoided.some((a: any) => a.layer === 'perigosos')).toBe(false);
    expect(r.body.layers.perigosos).toBeUndefined();
  }, 120_000);

  it('ONU 1203 (gasolina) às 09h30 de terça desvia das vias do Minianel', async () => {
    const r = await route({ origin: OSASCO, destination: PENHA, vehicle: GASOLINA, departure_at: '2026-10-13T09:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, minianel)).toBeLessThan(300);
    expect(r.body.avoided.some((a: any) => a.layer === 'perigosos' && /Minianel/.test(a.name))).toBe(true);
    const p = r.body.layers.perigosos;
    expect(p.data.minianel.regra_ativa_na_saida).toBe(true);
    expect(p.data.grupo_sp.group).toBe('II');
    expect(r.body.warnings.some((w: any) => w.code === 'hazmat_letpp')).toBe(true);
    expect(r.body.warnings.some((w: any) => w.code === 'hazmat_minianel_used')).toBe(false);
  }, 120_000);

  it('ONU 1203 às 11h (fora da janela) pode usar o Minianel', async () => {
    const r = await route({ origin: OSASCO, destination: PENHA, vehicle: GASOLINA, departure_at: '2026-10-13T11:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, minianel)).toBeGreaterThan(5000);
    expect(r.body.layers.perigosos.data.minianel.regra_ativa_na_saida).toBe(false);
    expect(r.body.layers.perigosos.data.minianel.usado_m).toBeGreaterThan(5000);
  }, 120_000);

  // 16h50: nem perigosos (17–20h) nem a VER § 4 (17–21h) valem na saída; a passagem estimada cai depois das 17h.
  it('saindo 16h50, avisa que a passagem estimada pelo Minianel cai na janela', async () => {
    const r = await route({ origin: OSASCO, destination: PENHA, vehicle: GASOLINA, departure_at: '2026-10-13T16:50' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = r.body.warnings.find((x: any) => x.code === 'hazmat_minianel_eta');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('warn');
  }, 120_000);

  it('SP-008 km 25,28–31,5 (Portaria PR/DER-164/2025): sem PP passa, com PP desvia', async () => {
    const free = await route({ origin: SP008_A, destination: SP008_B, vehicle: TRUCK, departure_at: '2026-10-13T14:00' });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    expect(overlapM(free.body, sp008, 40), 'pré-condição: o caminho natural usa o trecho').toBeGreaterThan(3000);

    const hz = await route({ origin: SP008_A, destination: SP008_B, vehicle: GASOLINA, departure_at: '2026-10-13T14:00' });
    expect(hz.status, JSON.stringify(hz.body)).toBe(200);
    expect(overlapM(hz.body, sp008, 40)).toBeLessThan(300);
    const av = hz.body.avoided.filter((a: any) => a.layer === 'perigosos');
    expect(av.map((a: any) => a.name)).toEqual(['SP-008 km 25,28–31,5 (Mairiporã)']);
    expect(av[0].rule).toMatch(/PR\/DER-164\/2025/);
    // trecho 100% dentro da APRM Alto Juquery: aviso de manancial, sem bloqueio
    expect(hz.body.warnings.some((w: any) => w.code === 'hazmat_aprm' && /Alto Juquery/.test(w.message))).toBe(true);
  }, 120_000);

  it('mapa: trechos, vias do Minianel, paradas de PP e emergências químicas', async () => {
    const r = await get(`/api/layers/perigosos/features?bbox=-46.9,-23.9,-46.3,-23.3&zoom=12`);
    expect(r.status).toBe(200);
    const kinds = new Set((r.body.features as any[]).map((f) => f.properties.kind));
    for (const k of ['trecho_proibido', 'via_minianel', 'parada_pp', 'emergencia']) expect(kinds.has(k), k).toBe(true);
    const f = (r.body.features as any[]).find((x) => x.properties.kind === 'trecho_proibido');
    expect(f.properties.osm).toBeUndefined();
    expect(f.properties.norma).toMatch(/Portaria/);
    const low = await get(`/api/layers/perigosos/features?bbox=-46.9,-23.9,-46.3,-23.3&zoom=6`);
    expect(low.body.features.length).toBe(0);
  });
});
