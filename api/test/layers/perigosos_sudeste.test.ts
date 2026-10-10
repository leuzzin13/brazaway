import { beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { get, route, waitForStack } from '../helpers.js';
import { classMatches, classRuleApplies, classesOutside, hazmatInfo, inTimeWindows, trechoRuleDecision } from '../../src/services/hazmat.js';

/**
 * Camada "perigosos", trechos fora de SP (importador hazmat_trechos_sudeste). Roda contra a API local (API_URL).
 *  - Ponte Rio–Niterói e acessos / Av. Portuária: Portaria SPRF-RJ/PRF 407/2024 (DOU 22/11/2024), arts. 1º, 2º e 4º-A;
 *  - Linha Vermelha: Res. SMTR 2.204/2012, art. 1º IV;
 *  - Terceira Ponte: IS DERTES 021-N/2004, registrada DESATIVADA (vigência não confirmada).
 * 2026-10-13 é terça-feira.
 */

type Line = { coords: [number, number][]; bbox: [number, number, number, number] };

async function regraLines(regra: string, bbox: [number, number, number, number]): Promise<Line[]> {
  const r = await get(`/api/layers/perigosos/features?bbox=${bbox.join(',')}&zoom=14`);
  expect(r.status).toBe(200);
  return (r.body.features as any[])
    .filter((f) => f.properties.regra_id === regra && f.geometry.type === 'LineString')
    .map((f) => ({ coords: f.geometry.coordinates, bbox: turf.bbox(f) as [number, number, number, number] }));
}

/** metros da rota que correm a até `tolM` de alguma das linhas (meio de cada segmento da rota) */
function overlapM(routeBody: any, lines: Line[], tolM = 10): number {
  const cs: [number, number][] = routeBody.geometry.coordinates;
  const pad = 0.0002;
  let m = 0;
  for (let i = 0; i < cs.length - 1; i++) {
    const a = cs[i], b = cs[i + 1];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const hit = lines.some((l) => mid[0] >= l.bbox[0] - pad && mid[0] <= l.bbox[2] + pad && mid[1] >= l.bbox[1] - pad && mid[1] <= l.bbox[3] + pad
      && turf.pointToLineDistance(turf.point(mid), turf.lineString(l.coords), { units: 'meters' }) <= tolM);
    if (hit) m += turf.distance(a, b, { units: 'meters' });
  }
  return m;
}

const trecho = (body: any, regra: string) => (body.layers.perigosos.data.trechos as any[]).find((t) => t.regra_id === regra);

// Niterói (Centro) -> Caju (Rio): o caminho natural é a Ponte Rio–Niterói (~20 km); sem ela, ~106 km pela volta da baía
const NITEROI = { lat: -22.8935, lon: -43.1240 };
const CAJU = { lat: -22.8890, lon: -43.2300 };
const MOCANGUE = { lat: -22.8700, lon: -43.1350 };   // Ilha de Mocanguê (instalações militares; acesso só pela ponte)
// Vila Velha -> Vitória: o utilitário (3,5 t) passa pela Terceira Ponte (a hgv:conditional do OSM não o alcança)
const VILA_VELHA = { lat: -20.3395, lon: -40.2870 };
const VITORIA = { lat: -20.3100, lon: -40.2960 };
const PONTE_BBOX: [number, number, number, number] = [-43.235, -22.895, -43.10, -22.86];
const TERCEIRA_BBOX: [number, number, number, number] = [-40.30, -20.345, -40.275, -20.305];
const GASOLINA = { preset: 'truck', hazmat: true, hazmat_un: '1203' };            // classe 3
const CLASSE_9 = { preset: 'truck', hazmat: true, hazmat_un: '3082' };            // classe 9
const PORTARIA_407 = ['1', '2.1', '2.3', '3', '4', '5', '6', '8'];

describe('hazmat.ts — regra de trecho por classe (Portaria SPRF-RJ/PRF 407/2024)', () => {
  it('classe da Relação x classe/subclasse da regra', () => {
    expect(classMatches('1.1D', '1')).toBe(true);
    expect(classMatches('4.3', '4')).toBe(true);
    expect(classMatches('6.2', '6')).toBe(true);
    expect(classMatches('2.2', '2.1')).toBe(false);
    expect(classMatches('9', '8')).toBe(false);
    expect(classesOutside(PORTARIA_407)).toEqual(['2.2', '7', '9']);
  });

  it('classe principal decide; risco subsidiário só aparece no aviso; sem nº ONU vale a proibição', () => {
    expect(classRuleApplies(PORTARIA_407, ['1203'])).toMatchObject({ applies: true, basis: 'proibida', matched: ['3'] });
    expect(classRuleApplies(PORTARIA_407, ['3082'])).toMatchObject({ applies: false, basis: 'liberada', loadClasses: ['9'] });
    // oxigênio comprimido: classe 2.2 (fora da lista) com risco subsidiário 5.1 (na lista)
    expect(classRuleApplies(PORTARIA_407, ['1072'])).toMatchObject({ applies: false, basis: 'liberada', subsidiaryHits: ['5.1'] });
    expect(classRuleApplies(PORTARIA_407, ['3082', '1789'])).toMatchObject({ applies: true, matched: ['8'] });   // carga mista
    expect(classRuleApplies(PORTARIA_407, [])).toMatchObject({ applies: true, basis: 'sem_onu' });
    expect(classRuleApplies(PORTARIA_407, ['9999'])).toMatchObject({ applies: true, basis: 'desconhecido' });
    expect(classRuleApplies(null, ['3082'])).toMatchObject({ applies: true, basis: 'todas' });   // Linha Vermelha
  });

  it('janelas do art. 2º II (23h–4h atravessa a meia-noite; 11h–16h)', () => {
    const w = [{ from: '23:00', to: '04:00' }, { from: '11:00', to: '16:00' }];
    expect(inTimeWindows('23:30', 2, w)).toBe(true);
    expect(inTimeWindows('03:59', 3, w)).toBe(true);
    expect(inTimeWindows('04:00', 3, w)).toBe(false);
    expect(inTimeWindows('12:00', 2, w)).toBe(true);
    expect(inTimeWindows('08:00', 2, w)).toBe(false);
    // janela com dias: a madrugada pertence ao dia em que a janela começa
    expect(inTimeWindows('01:00', 6, [{ from: '22:00', to: '05:00', days: [5] }])).toBe(true);
    expect(inTimeWindows('01:00', 5, [{ from: '22:00', to: '05:00', days: [5] }])).toBe(false);
  });

  it('decisão: inativa nunca vale; isenção da Parte 3 só onde a norma prevê; DER-SP sem campos vale para todo PP', () => {
    const ponte = { regra_id: 'RJ-PONTE-RIO-NITEROI', classes_proibidas: PORTARIA_407, isencao_qtd_limitada: true, ativa: true, situacao: 'vigente' };
    const hz = (un: string, kg?: number) => hazmatInfo({ hazmat: true, hazmat_un: un, hazmat_qty_kg: kg } as any);
    expect(trechoRuleDecision(ponte, hz('1203')).code).toBe('aplicada');
    expect(trechoRuleDecision(ponte, hz('3082')).code).toBe('classe_liberada');
    expect(trechoRuleDecision(ponte, hz('1203', 300)).code).toBe('qtd_limitada');   // 333 kg na coluna 8
    expect(trechoRuleDecision(ponte, hz('1203', 400)).code).toBe('aplicada');
    expect(trechoRuleDecision(ponte, hz('1856')).code).toBe('nao_sujeito');         // "não sujeito" na Relação
    expect(trechoRuleDecision(ponte, hz('1203'), true).code).toBe('excecao');       // Mocanguê conferido por quem chama
    expect(trechoRuleDecision({ ...ponte, ativa: false }, hz('1203')).code).toBe('inativa');
    expect(trechoRuleDecision({ ...ponte, situacao: 'revogada' }, hz('1203')).code).toBe('inativa');
    const linhaVermelha = { regra_id: 'RJ-RIO-LINHA-VERMELHA', classes_proibidas: null, isencao_qtd_limitada: false, ativa: true };
    expect(trechoRuleDecision(linhaVermelha, hz('3082')).code).toBe('aplicada');
    expect(trechoRuleDecision(linhaVermelha, hz('1203', 300)).code).toBe('aplicada');   // sem isenção por quantidade
    expect(trechoRuleDecision({}, hz('1203', 300)).code).toBe('aplicada');              // portarias do DER-SP
  });
});

describe('Camada perigosos na rota — trechos fora de SP', () => {
  let ponte: Line[];
  let terceira: Line[];
  beforeAll(async () => {
    await waitForStack();
    ponte = await regraLines('RJ-PONTE-RIO-NITEROI', PONTE_BBOX);
    terceira = await regraLines('ES-TERCEIRA-PONTE', TERCEIRA_BBOX);
    expect(ponte.length, 'Ponte Rio–Niterói não importada (importer hazmat_trechos_sudeste)').toBeGreaterThan(10);
    expect(terceira.length, 'Terceira Ponte não importada (importer hazmat_trechos_sudeste)').toBeGreaterThan(1);
  }, 120_000);

  it('catálogo e mapa: fonte "sudeste" registrada; regra desativada aparece como tal', async () => {
    const r = await get('/api/layers');
    const l = r.body.find((x: any) => x.id === 'perigosos');
    expect(l.runs.map((x: any) => x.source)).toContain('sudeste');
    const f = await get(`/api/layers/perigosos/features?bbox=${TERCEIRA_BBOX.join(',')}&zoom=14`);
    const t = (f.body.features as any[]).find((x) => x.properties.regra_id === 'ES-TERCEIRA-PONTE');
    expect(t.properties.situacao).toMatch(/^desativada: Vigência não confirmada/);
    expect(t.properties.norma).toMatch(/Instrução de Serviço DERTES nº 021-N\/2004/);
    const p = await get(`/api/layers/perigosos/features?bbox=${PONTE_BBOX.join(',')}&zoom=14`);
    const pr = (p.body.features as any[]).find((x) => x.properties.regra_id === 'RJ-PONTE-RIO-NITEROI');
    expect(pr.properties.classes).toBe('1, 2.1, 2.3, 3, 4, 5, 6 e 8');
    expect(pr.properties.norma).toMatch(/Portaria SPRF-RJ\/PRF nº 407\/2024/);
    expect(pr.properties.osm).toBeUndefined();
  });

  it('ONU 1203 (classe 3) de Niterói ao Caju desvia da Ponte Rio–Niterói', async () => {
    const r = await route({ origin: NITEROI, destination: CAJU, vehicle: GASOLINA, departure_at: '2026-10-13T14:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, ponte)).toBeLessThan(300);
    expect(r.body.distance_km).toBeGreaterThan(60);
    const av = r.body.avoided.filter((a: any) => a.layer === 'perigosos');
    expect(av.map((a: any) => a.name)).toContain('Ponte Rio–Niterói (BR-101) e acessos');
    expect(av.find((a: any) => /Ponte/.test(a.name)).rule).toMatch(/Portaria SPRF-RJ\/PRF nº 407\/2024, art\. 1º/);
    expect(trecho(r.body, 'RJ-PONTE-RIO-NITEROI')).toMatchObject({ aplicada: true, decisao: 'aplicada' });
  }, 300_000);

  it('ONU 3082 (classe 9) passa pela Ponte Rio–Niterói', async () => {
    const r = await route({ origin: NITEROI, destination: CAJU, vehicle: CLASSE_9, departure_at: '2026-10-13T14:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, ponte)).toBeGreaterThan(10_000);
    expect(r.body.distance_km).toBeLessThan(30);
    expect(r.body.avoided.some((a: any) => a.layer === 'perigosos')).toBe(false);
    expect(trecho(r.body, 'RJ-PONTE-RIO-NITEROI')).toMatchObject({ aplicada: false, decisao: 'classe_liberada' });
    expect(r.body.layers.perigosos.summary.some((s: string) => /Ponte Rio–Niterói.*classe 9, fora das proibidas/.test(s))).toBe(true);
  }, 300_000);

  it('quantidade limitada (300 kg de gasolina): o parágrafo único isenta e a rota usa a ponte', async () => {
    const r = await route({ origin: NITEROI, destination: CAJU, vehicle: { ...GASOLINA, hazmat_qty_kg: 300 }, departure_at: '2026-10-13T14:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, ponte)).toBeGreaterThan(10_000);
    expect(trecho(r.body, 'RJ-PONTE-RIO-NITEROI').decisao).toBe('qtd_limitada');
    expect(r.body.warnings.some((w: any) => w.code === 'hazmat_trecho_isento' && /Ponte Rio–Niterói/.test(w.message))).toBe(true);
  }, 300_000);

  it('Mocanguê (art. 2º): Niterói→ilha às 12h usa a ponte pela exceção; às 08h a proibição fica e avisa', async () => {
    const ok = await route({ origin: NITEROI, destination: MOCANGUE, vehicle: GASOLINA, departure_at: '2026-10-13T12:00' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.layers.perigosos.data.mocangue).toMatchObject({ endpoint: 'destino', niteroi: true, inWindow: true, ok: true });
    expect(trecho(ok.body, 'RJ-PONTE-RIO-NITEROI').decisao).toBe('excecao');
    expect(ok.body.avoided.some((a: any) => a.layer === 'perigosos')).toBe(false);
    expect(ok.body.warnings.find((w: any) => w.code === 'hazmat_mocangue')?.message).toMatch(/exceção do art\. 2º.*das 23h às 4h e das 11h às 16h/);

    const fora = await route({ origin: NITEROI, destination: MOCANGUE, vehicle: GASOLINA, departure_at: '2026-10-13T08:00' });
    expect(fora.status, JSON.stringify(fora.body)).toBe(200);   // ponta dentro da regra: não exclui, avisa
    expect(fora.body.layers.perigosos.data.mocangue).toMatchObject({ inWindow: false, ok: false });
    expect(trecho(fora.body, 'RJ-PONTE-RIO-NITEROI').decisao).toBe('aplicada');
    expect(fora.body.warnings.find((w: any) => w.code === 'hazmat_mocangue')?.message).toMatch(/aqui não se aplica \(saída às 08h00, fora da janela\)/);
  }, 300_000);

  it('Terceira Ponte (IS DERTES 021-N/2004, desativada): a rota não desvia, mas avisa', async () => {
    const r = await route({ origin: VILA_VELHA, destination: VITORIA, vehicle: { preset: 'utilitario', hazmat: true, hazmat_un: '1203' }, departure_at: '2026-10-13T14:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, terceira)).toBeGreaterThan(2000);
    expect(r.body.avoided.some((a: any) => a.layer === 'perigosos')).toBe(false);
    expect(trecho(r.body, 'ES-TERCEIRA-PONTE')).toMatchObject({ aplicada: false, decisao: 'inativa', situacao: 'vigencia_nao_confirmada' });
    const w = r.body.warnings.find((x: any) => x.code === 'hazmat_regra_nao_confirmada');
    expect(w?.severity).toBe('warn');
    expect(w?.message).toMatch(/021-N\/2004.*NÃO aplicada.*Segunda Ponte/);
  }, 300_000);
});
