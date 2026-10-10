import { beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { get, pool, route, waitForStack } from '../helpers.js';
import { classMatches, classRuleApplies, classesOutside, hazmatInfo, inTimeWindows, trechoRuleDecision } from '../../src/services/hazmat.js';
import { rematchRows, restrictionsFrom, type RouteRow } from '../../src/layers/perigosos.layer.js';

/**
 * Camada "perigosos", trechos fora de SP (importador hazmat_trechos_sudeste). Roda contra a API local (API_URL); os
 * testes do recasamento chamam o Valhalla (VALHALLA_URL) e leem o banco (TEST_DATABASE_URL) direto.
 *  - Ponte Rio–Niterói e acessos / Av. Portuária: Portaria SPRF-RJ/PRF 407/2024 (DOU 22/11/2024), arts. 1º, 2º, 3º e 4º-A;
 *  - Linha Vermelha: Res. SMTR 2.204/2012, art. 1º IV;
 *  - Terceira Ponte: IS DERTES 021-N/2004, art. 1º g (todas as classes, 24h).
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
// Vila Velha -> Vitória: sem PP o utilitário (3,5 t) passa pela Terceira Ponte (a hgv:conditional do OSM não o alcança)
const VILA_VELHA = { lat: -20.3395, lon: -40.2870 };
const VITORIA = { lat: -20.3100, lon: -40.2960 };
// Av. Brasil (Caju) -> fim da Av. Portuária junto ao porto: com classe 9 a rota corre ~2,8 km pela Av. Portuária
const AV_BRASIL = { lat: -22.8700, lon: -43.2600 };
const PORTO_RIO = { lat: -22.8825, lon: -43.2160 };
// São José dos Campos (SP) -> Caju: ~337 km, ~4h; a rota entra no Município do Rio perto do fim
const SJC = { lat: -23.1890, lon: -45.8840 };
const PONTE_BBOX: [number, number, number, number] = [-43.235, -22.895, -43.10, -22.86];
const TERCEIRA_BBOX: [number, number, number, number] = [-40.30, -20.345, -40.275, -20.305];
const PORTUARIA_BBOX: [number, number, number, number] = [-43.245, -22.89, -43.205, -22.87];
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

  it('classe principal ou risco subsidiário na lista aplica (lado conservador); sem nº ONU vale a proibição', () => {
    expect(classRuleApplies(PORTARIA_407, ['1203'])).toMatchObject({ applies: true, basis: 'proibida', matched: ['3'] });
    expect(classRuleApplies(PORTARIA_407, ['3082'])).toMatchObject({ applies: false, basis: 'liberada', loadClasses: ['9'] });
    // oxigênio comprimido: classe 2.2 (fora da lista) com risco subsidiário 5.1 (na lista). A pesquisa (perigosos_fora_sp,
    // P1 a) manda aplicar "quando a carga tem classe ou risco subsidiário listado"
    expect(classRuleApplies(PORTARIA_407, ['1072'])).toMatchObject({ applies: true, basis: 'subsidiario', loadClasses: ['2.2'], subsidiaryHits: ['5.1'] });
    expect(classRuleApplies(PORTARIA_407, ['1066'])).toMatchObject({ applies: false, basis: 'liberada', subsidiaryHits: [] });   // nitrogênio: 2.2 sem risco subsidiário
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
    // 0 kg = veículo vazio não limpo nem descontaminado: segue a proibição (art. 3º da Portaria 407/2024)
    expect(hz('1203', 0).lqExempt).toBe(true);
    expect(trechoRuleDecision(ponte, hz('1203', 0)).code).toBe('aplicada');
    expect(trechoRuleDecision(ponte, hz('1072')).code).toBe('aplicada');            // pelo risco subsidiário 5.1
    expect(trechoRuleDecision(ponte, hz('1856')).code).toBe('nao_sujeito');         // "não sujeito" na Relação
    expect(trechoRuleDecision(ponte, hz('1203'), true).code).toBe('excecao');       // Mocanguê conferido por quem chama
    expect(trechoRuleDecision({ ...ponte, ativa: false }, hz('1203')).code).toBe('inativa');
    expect(trechoRuleDecision({ ...ponte, situacao: 'revogada' }, hz('1203')).code).toBe('inativa');
    expect(trechoRuleDecision({ ...ponte, situacao: 'sem_efeito' }, hz('1203')).code).toBe('inativa');
    const linhaVermelha = { regra_id: 'RJ-RIO-LINHA-VERMELHA', classes_proibidas: null, isencao_qtd_limitada: false, ativa: true };
    expect(trechoRuleDecision(linhaVermelha, hz('3082')).code).toBe('aplicada');
    expect(trechoRuleDecision(linhaVermelha, hz('1203', 300)).code).toBe('aplicada');   // sem isenção por quantidade
    expect(trechoRuleDecision({}, hz('1203', 300)).code).toBe('aplicada');              // portarias do DER-SP
    const terceira = { regra_id: 'ES-TERCEIRA-PONTE', classes_proibidas: null, isencao_qtd_limitada: false, ativa: true, situacao: 'vigente' };
    expect(trechoRuleDecision(terceira, hz('3082', 10)).code).toBe('aplicada');          // IS 021-N/2004: todas, sem isenção
  });
});

/** Pedaços da regra no banco, no formato do plano (props com osm), do maior para o menor. */
async function regraRows(regra: string, limit: number): Promise<RouteRow[]> {
  const r = await pool.query(
    `select id::text, name, kind, props, ST_AsGeoJSON(geom, 6)::json as geometry from data_features
      where layer_id = 'perigosos' and kind = 'trecho_proibido' and props->>'regra_id' = $1
        and (valid_to is null or valid_to > now())
      order by (props->>'comprimento_m')::int desc limit $2`,
    [regra, limit],
  );
  return r.rows;
}

describe('Recasamento quando o tileset muda (trechos fora de SP nunca viram exclusão)', () => {
  it('sem traçado válido: pedaço com regra_id fica de fora (semTracado), sem exclusão; trecho do DER-SP mantém o anel', () => {
    const g: GeoJSON.LineString = { type: 'LineString', coordinates: [[-43.24, -22.86], [-43.23, -22.85]] };
    const lv: RouteRow = { id: '1', name: 'LV', kind: 'trecho_proibido', geometry: g,
      props: { regra_id: 'RJ-RIO-LINHA-VERMELHA', via: 'Linha Vermelha', norma: 'Res. SMTR nº 2.204/2012', artigo: 'art. 1º, IV' } };
    const der: RouteRow = { id: '2', name: 'SP-008', kind: 'trecho_proibido', geometry: g, props: { norma: 'Portaria PR/DER-164/2025', artigo: 'art. 2º' } };
    const r = restrictionsFrom([lv, der], { lines: new Map([['1', null], ['2', null]]), transientIds: new Set() });
    expect(r.exclusions.map((e) => e.item.id)).toEqual(['2']);
    expect(r.costLines).toEqual([]);
    expect(r.semTracado.get('RJ-RIO-LINHA-VERMELHA')).toMatchObject({ via: 'Linha Vermelha', stale: 1, transient: 0 });
    expect(r.fallbackIds).toEqual(['1', '2']);
    // com traçado: costLine com o id da regra
    const ok = restrictionsFrom([lv], { lines: new Map([['1', [g.coordinates as [number, number][]]]]), transientIds: new Set() });
    expect(ok.costLines.map((c) => c.item.id)).toEqual(['trecho-RJ-RIO-LINHA-VERMELHA']);
    expect(ok.exclusions).toEqual([]);
  });

  it('Linha Vermelha (hgv=no): recasa com o costing gravado na importação e, sem ele, pelo traçado exato', async () => {
    const rows = await regraRows('RJ-RIO-LINHA-VERMELHA', 4);
    expect(rows.length).toBe(4);
    for (const r of rows) expect(r.props.osm).toMatchObject({ geom: true, costing: 'auto' });
    // tileset fictício: força o trace_route (costing 'auto' gravado) + edge walk, como depois de reconstruir os tiles
    const m1 = await rematchRows(rows, -1);
    for (const r of rows) expect(m1.get(r.id)?.lines?.length, `pedaço ${r.id} (${r.props.comprimento_m} m) não casou`).toBeGreaterThan(0);
    // malha mudou ali (traçado deslocado ~2 m: o traçado exato não passa mais no edge walk): só o trace_route recupera.
    // Com o costing gravado ('auto') casa; com 'truck' a via (hgv=no) não casa — era o bug da revisão
    const shifted = rows.map((r) => ({ ...r, geometry: { ...r.geometry, coordinates: r.geometry.coordinates.map(([x, y]) => [x + 0.00002, y + 0.00001]) } }));
    const mAuto = await rematchRows(shifted, -3);
    const mTruck = await rematchRows(shifted.map((r) => ({ ...r, props: { ...r.props, osm: { ...r.props.osm, costing: 'truck' } } })), -4);
    for (const r of shifted) {
      const ls = mAuto.get(r.id)?.lines;
      expect(ls?.length, `pedaço ${r.id} não casou com 'auto'`).toBeGreaterThan(0);
      expect(ls![0]).not.toEqual(r.geometry.coordinates);   // veio do trace_route, não da reserva
      expect(mTruck.get(r.id)?.lines ?? null).toBeNull();
    }
    // dado antigo sem costing (cai em 'truck', que não casa a via): a reserva é o traçado exato da importação
    const old = rows.map((r) => ({ ...r, props: { ...r.props, osm: { tileset: 0, geom: true } } }));
    const m2 = await rematchRows(old, -2);
    for (const r of old) expect(m2.get(r.id)?.lines?.[0], `pedaço ${r.id} sem reserva`).toEqual(r.geometry.coordinates);
    const plan = restrictionsFrom(rows, { lines: new Map([...m1].map(([k, v]) => [k, v.lines])), transientIds: new Set() });
    expect(plan.exclusions).toEqual([]);
    expect(plan.costLines.length).toBeGreaterThanOrEqual(4);
  }, 180_000);
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

  it('catálogo e mapa: fonte "sudeste" registrada; Terceira Ponte vigente, todas as classes', async () => {
    const r = await get('/api/layers');
    const l = r.body.find((x: any) => x.id === 'perigosos');
    expect(l.runs.map((x: any) => x.source)).toContain('sudeste');
    const f = await get(`/api/layers/perigosos/features?bbox=${TERCEIRA_BBOX.join(',')}&zoom=14`);
    const t = (f.body.features as any[]).find((x) => x.properties.regra_id === 'ES-TERCEIRA-PONTE');
    expect(t.properties.situacao).toBe('vigente');
    expect(t.properties.classes).toBe('todas');
    expect(t.properties.norma).toMatch(/Instrução de Serviço DERTES nº 021-N\/2004, art\. 1º, g/);
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
    // a Linha Vermelha (Res. SMTR 2.204/2012, art. 1º IV) proíbe todas as classes: continua aplicada para a classe 9
    expect(trecho(r.body, 'RJ-RIO-LINHA-VERMELHA')).toMatchObject({ aplicada: true, decisao: 'aplicada', classes_proibidas: null });
    expect(r.body.layers.perigosos.summary.some((s: string) => /Ponte Rio–Niterói.*classe 9, fora das proibidas/.test(s))).toBe(true);
  }, 300_000);

  it('quantidade limitada (300 kg de gasolina): o parágrafo único isenta e a rota usa a ponte', async () => {
    const r = await route({ origin: NITEROI, destination: CAJU, vehicle: { ...GASOLINA, hazmat_qty_kg: 300 }, departure_at: '2026-10-13T14:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, ponte)).toBeGreaterThan(10_000);
    expect(trecho(r.body, 'RJ-PONTE-RIO-NITEROI').decisao).toBe('qtd_limitada');
    expect(r.body.warnings.some((w: any) => w.code === 'hazmat_trecho_isento' && /Ponte Rio–Niterói/.test(w.message))).toBe(true);

    // 0 kg = veículo vazio não limpo nem descontaminado (Portaria 407/2024, art. 3º): a proibição fica
    const vazio = await route({ origin: NITEROI, destination: CAJU, vehicle: { ...GASOLINA, hazmat_qty_kg: 0 }, departure_at: '2026-10-13T14:00' });
    expect(vazio.status, JSON.stringify(vazio.body)).toBe(200);
    expect(overlapM(vazio.body, ponte)).toBeLessThan(300);
    expect(trecho(vazio.body, 'RJ-PONTE-RIO-NITEROI')).toMatchObject({ aplicada: true, decisao: 'aplicada' });
    expect(vazio.body.warnings.find((w: any) => w.code === 'hazmat_trecho_vazio')?.message).toMatch(/0 kg.*vazio não limpo.*art\. 3º/);
  }, 300_000);

  it('Lei Rio 1.632/1990 (registrada): o aviso segue a passagem estimada pela cidade, não a hora de saída', async () => {
    // saída às 03h00 (dentro da janela 21h–6h), mas a rota chega ao Rio por volta das 7h: avisa
    const cedo = await route({ origin: SJC, destination: CAJU, vehicle: GASOLINA, departure_at: '2026-10-13T03:00' });
    expect(cedo.status, JSON.stringify(cedo.body)).toBe(200);
    const w = cedo.body.warnings.find((x: any) => x.code === 'hazmat_lei_municipal');
    expect(w?.severity).toBe('info');
    expect(w?.message).toMatch(/passagem estimada (das 0[6-9]h\d\d às \d\dh\d\d|por volta das 0[6-9]h\d\d)/);
    expect(w?.message).toMatch(/combustíveis e derivados.*Lei municipal \(Rio\) nº 1\.632\/1990.*NÃO aplicada/);
    // saída às 18h00 (fora da janela), passagem pelo Rio por volta das 22h (dentro dela): sem aviso
    const tarde = await route({ origin: SJC, destination: CAJU, vehicle: GASOLINA, departure_at: '2026-10-13T18:00' });
    expect(tarde.status, JSON.stringify(tarde.body)).toBe(200);
    expect(tarde.body.warnings.some((x: any) => x.code === 'hazmat_lei_municipal')).toBe(false);
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

  it('Terceira Ponte (IS DERTES 021-N/2004, art. 1º g): utilitário com ONU 1203 de Vila Velha a Vitória evita a ponte', async () => {
    const r = await route({ origin: VILA_VELHA, destination: VITORIA, vehicle: { preset: 'utilitario', hazmat: true, hazmat_un: '1203' }, departure_at: '2026-10-13T14:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, terceira)).toBeLessThan(300);
    expect(r.body.avoided.map((a: any) => a.id)).toContain('trecho-ES-TERCEIRA-PONTE');
    expect(trecho(r.body, 'ES-TERCEIRA-PONTE')).toMatchObject({ aplicada: true, decisao: 'aplicada', situacao: 'vigente', base_classe: 'todas' });
    // a dúvida sobre a vigência depois de 2023 fica num aviso info, sem desativar a regra
    const w = r.body.warnings.find((x: any) => x.code === 'hazmat_trecho_vigencia');
    expect(w?.severity).toBe('info');
    expect(w?.message).toMatch(/021-N\/2004.*DER-ES.*Segunda Ponte/);
    // sem PP, o mesmo utilitário passa pela ponte
    const sem = await route({ origin: VILA_VELHA, destination: VITORIA, vehicle: { preset: 'utilitario' }, departure_at: '2026-10-13T14:00' });
    expect(sem.status).toBe(200);
    expect(overlapM(sem.body, terceira)).toBeGreaterThan(2000);
  }, 300_000);

  it('Av. Portuária (art. 4º-A): ONU 1203 evita a via; ONU 3082 (classe 9) segue por ela', async () => {
    const portuaria = await regraLines('RJ-AV-PORTUARIA', PORTUARIA_BBOX);
    expect(portuaria.length).toBeGreaterThan(3);
    const c9 = await route({ origin: AV_BRASIL, destination: PORTO_RIO, vehicle: CLASSE_9, departure_at: '2026-10-13T14:00' });
    expect(c9.status, JSON.stringify(c9.body)).toBe(200);
    const livre = overlapM(c9.body, portuaria);
    expect(livre).toBeGreaterThan(2000);
    expect(c9.body.avoided.map((a: any) => a.id)).not.toContain('trecho-RJ-AV-PORTUARIA');
    expect(trecho(c9.body, 'RJ-AV-PORTUARIA')).toMatchObject({ aplicada: false, decisao: 'classe_liberada' });

    const g = await route({ origin: AV_BRASIL, destination: PORTO_RIO, vehicle: GASOLINA, departure_at: '2026-10-13T14:00' });
    expect(g.status, JSON.stringify(g.body)).toBe(200);   // destino junto à via: não exclui, avisa
    expect(overlapM(g.body, portuaria)).toBeLessThan(livre / 2);
    const av = g.body.avoided.find((a: any) => a.id === 'trecho-RJ-AV-PORTUARIA');
    expect(av?.rule).toMatch(/Portaria SPRF-RJ\/PRF nº 407\/2024, art\. 4º-A/);
    expect(trecho(g.body, 'RJ-AV-PORTUARIA')).toMatchObject({ aplicada: true, decisao: 'aplicada', sem_tracado: false });
    expect(g.body.warnings.some((w: any) => w.code === 'hazmat_trecho_lindeiro' && w.id === 'trecho-RJ-AV-PORTUARIA:destino')).toBe(true);
  }, 300_000);

  it('ONU 1072 (oxigênio, 2.2 com risco subsidiário 5.1): a proibição da ponte vale, com aviso', async () => {
    const r = await route({ origin: NITEROI, destination: CAJU, vehicle: { preset: 'truck', hazmat: true, hazmat_un: '1072' }, departure_at: '2026-10-13T14:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, ponte)).toBeLessThan(300);
    expect(trecho(r.body, 'RJ-PONTE-RIO-NITEROI')).toMatchObject({ aplicada: true, decisao: 'aplicada', base_classe: 'subsidiario' });
    expect(r.body.warnings.find((w: any) => w.code === 'hazmat_trecho_subsidiario')?.message).toMatch(/classe 2\.2.*risco subsidiário 5\.1/);
  }, 300_000);
});
