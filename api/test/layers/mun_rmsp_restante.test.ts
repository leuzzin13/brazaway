import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { pool, route, waitForStack } from '../helpers.js';
import layer, { describeJanelas, enquadrar, janelaAtiva, regraAplicavel, usoDaLinha, type Regra } from '../../src/layers/restricoes_rmsp.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';

/**
 * Frente mun_rmsp_restante: municípios da Grande SP adicionados como arquivos de regras (data/raw/municipios/<ibge>.json),
 * camada restricoes_rmsp. Regras chamando o módulo da camada (mesmo banco) e poucas rotas reais contra a API (API_URL).
 * Pré-requisito: `run.py municipios:<ibge>` das 12 fontes abaixo (ou os seeds db/seed/layers/restricoes_rmsp__<fonte>.sql).
 * 2026-10-13 é terça; 2026-10-17 sábado; 2026-10-18 domingo. Não grava nada no banco.
 */
const TZ = 'America/Sao_Paulo';
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();
type P = { lat: number; lon: number };
const veic = (v: Record<string, unknown>) => resolveVehicle(v as any);
const ctxOf = (o: P, d: P, when: string, vehicle: Record<string, unknown>) =>
  ({ vehicle: veic(vehicle), at: at(when), departureLocal: when, origin: o, destination: d, tz: TZ });
const routeOf = (coords: [number, number][], min = 10) => ({ line: turf.lineString(coords), distance_km: turf.length(turf.lineString(coords)), duration_s: min * 60 });

const FONTES: Record<string, string[]> = {
  aruja: ['via'], 'itapecerica-da-serra': ['via'], caieiras: ['desativada', 'via'], mairipora: ['via'], diadema: ['via'],
  suzano: ['via'], 'mogi-das-cruzes': ['desativada'], 'taboao-da-serra': ['desativada'], 'santa-isabel': ['desativada'],
  'franco-da-rocha': ['desativada'], maua: ['desativada'], 'embu-das-artes': ['desativada'],
};

// Itapecerica da Serra: Av. XV de Novembro ao norte do Centro → sul da R. Treze de Maio (o caminho natural é a Av. XV)
const ITA_N = { lat: -23.6935, lon: -46.8545 }, ITA_S = { lat: -23.7240, lon: -46.8505 };
// Mairiporã: Av. Sen. José Ermírio de Moraes (pé da serra) → Centro de Mairiporã (subida pela Belarmino/Gianesella)
const MAI_SERRA = { lat: -23.4400, lon: -46.6162 }, MAI_CENTRO = { lat: -23.3185, lon: -46.5880 };
// Franco da Rocha → Perus (SP): o atalho pela Vila Rosina de Caieiras (Lei 5.486/2021) x a SP-332
const FRANCO = { lat: -23.3290, lon: -46.7270 }, PERUS = { lat: -23.4050, lon: -46.7500 }, CAIEIRAS_CENTRO = { lat: -23.3645, lon: -46.7398 };
// Diadema: oeste do Centro → leste do Centro
const DIA_A = { lat: -23.6830, lon: -46.6330 }, DIA_B = { lat: -23.6920, lon: -46.6230 };

const regra = async (id: string): Promise<Regra> => {
  const q = await pool.query(`select props from data_features where layer_id = 'restricoes_rmsp' and props->>'regra_id' = $1 limit 1`, [id]);
  expect(q.rows.length, `regra ${id} não importada`).toBe(1);
  return q.rows[0].props;
};
/** linhas (6 casas, como a API manda ao Valhalla) de uma regra, opcionalmente só as de uma via */
const linhas = async (id: string, via?: string): Promise<[number, number][][]> => {
  const q = await pool.query(`select ST_AsGeoJSON(geom, 6)::json g from data_features where layer_id = 'restricoes_rmsp' and props->>'regra_id' = $1
    and ($2::text is null or props->>'via' = $2)`, [id, via ?? null]);
  return q.rows.map((r: any) => r.g.coordinates);
};
/** metros da rota sobre as linhas (mesma régua do annotate: 10 m e, com sentido único, mesmo rumo) */
const usoM = (rota: [number, number][], ls: [number, number][][], directional = false) =>
  ls.reduce((a, c) => a + usoDaLinha(rota, c, directional).metros, 0);
const nossos = (r: any) => (r.avoided ?? []).filter((a: any) => a.layer === 'restricoes_rmsp');

beforeAll(async () => {
  await waitForStack();
  const q = await pool.query(`select source from data_layer_runs where layer_id = 'restricoes_rmsp'`);
  const fontes = new Set(q.rows.map((r: any) => r.source));
  for (const f of Object.keys(FONTES)) {
    expect(fontes.has(f), `fonte ${f} não carregada: rode run.py municipios:<ibge> ou aplique db/seed/layers/restricoes_rmsp__${f}.sql`).toBe(true);
  }
}, 600_000);

afterAll(async () => { await pool.end(); });

describe('carga: 12 municípios, status e base legal', () => {
  it('cada fonte tem as feições do tipo esperado (ativas = via/zona; não aplicadas = desativada)', async () => {
    const q = await pool.query(`select source, array_agg(distinct kind order by kind) kinds from data_features
      where layer_id = 'restricoes_rmsp' and source = any($1) group by 1`, [Object.keys(FONTES)]);
    expect(Object.fromEntries(q.rows.map((r: any) => [r.source, r.kinds]))).toEqual(FONTES);
  });

  it('toda feição cita ato, artigo e URL; confiança baixa nunca ativa; desativada tem motivo; licença registrada', async () => {
    const q = await pool.query(`select source, kind, props from data_features where layer_id = 'restricoes_rmsp' and source = any($1)`, [Object.keys(FONTES)]);
    expect(q.rows.length).toBeGreaterThan(200);
    for (const { source, kind, props: p } of q.rows) {
      expect(p.base_legal.length, source).toBeGreaterThan(0);
      for (const b of p.base_legal) expect(b.ato && b.artigo && /^https?:\/\//.test(b.url), `${source} ${p.regra_id}`).toBeTruthy();
      if (['baixa', 'unverifiable'].includes(p.confianca)) expect(kind, p.regra_id).toBe('desativada');
      if (kind === 'desativada') expect(p.status_motivo?.length, p.regra_id).toBeGreaterThan(30);
      expect(p.uf).toBe('SP');
    }
    const runs = await pool.query(`select source, license from data_layer_runs where layer_id = 'restricoes_rmsp' and source = any($1)`, [Object.keys(FONTES)]);
    for (const r of runs.rows) expect(r.license, r.source).toMatch(/domínio público|oficial|notícia/i);
  });

  it('vias ativas validadas no Valhalla e sem vértice repetido nas 6 casas que a API manda (edge walk)', async () => {
    const q = await pool.query(`select source, count(*)::int n,
        sum(case when (props->>'valhalla_validado')::boolean then 0 else 1 end)::int sem_teste,
        sum(case when ST_NPoints(ST_RemoveRepeatedPoints(ST_SnapToGrid(geom, 0.000001))) < ST_NPoints(geom) then 1 else 0 end)::int repetidos,
        max(ST_Length(geom::geography))::float max_m
      from data_features where layer_id = 'restricoes_rmsp' and kind = 'via' and source = any($1) group by 1`, [Object.keys(FONTES)]);
    expect(q.rows.length).toBe(6);
    for (const r of q.rows) {
      expect(r.sem_teste, r.source).toBe(0);
      expect(r.repetidos, r.source).toBe(0);
      expect(r.max_m, r.source).toBeLessThan(450);
    }
  });

  it('Caieiras (Lei 3.560/2004): a zona deixa de fora as rodovias estaduais (SP-332, SP-348)', async () => {
    const q = await pool.query(`select ST_Area(geom::geography) / 1e6 km2,
        ST_DWithin(geom::geography, ST_SetSRID(ST_Point(-46.751838, -23.368265), 4326)::geography, 25) as sp332,
        ST_DWithin(geom::geography, ST_SetSRID(ST_Point(-46.811437, -23.348211), 4326)::geography, 25) as sp348,
        ST_Contains(geom, ST_SetSRID(ST_Point($1, $2), 4326)) as centro
      from data_features where layer_id = 'restricoes_rmsp' and props->>'regra_id' = 'caieiras_comprimento_12m'`, [CAIEIRAS_CENTRO.lon, CAIEIRAS_CENTRO.lat]);
    expect(q.rows[0]).toMatchObject({ sp332: false, sp348: false, centro: true });
    expect(q.rows[0].km2).toBeGreaterThan(90);   // município ~97 km²
  });

  it('geometria: Av. São Jorge do OSM (Diadema, CEP 09911-070) e ponta nordeste da Av. Amazonas (Arujá, bairro/centro)', async () => {
    // Diadema: way 125916038 ('Avenida São Jorge' no OSM, ~118 m, mão única para o sul) é a R. São Jorge do serviço 55
    const avSaoJorge: [number, number][] = [[-46.6271052, -23.6878629], [-46.627187, -23.6879645], [-46.6274163, -23.688281],
      [-46.6275027, -23.688383], [-46.6277603, -23.6886855], [-46.6277819, -23.6887208]];
    expect(usoM(avSaoJorge, await linhas('diadema_vias_restricao', 'Rua São Jorge'), true)).toBeGreaterThan(100);
    // Arujá: pista bairro→centro da ponta nordeste (way 200147067, 66 m) restrita; a pista ao lado, centro→bairro, livre
    const amazonasNE: [number, number][] = [[-46.3114306, -23.3895251], [-46.311484, -23.3896059], [-46.3116693, -23.3898799], [-46.3117705, -23.3900295]];
    const amazonasNEvolta: [number, number][] = [[-46.3117705, -23.3900295], [-46.3116793, -23.3899433], [-46.3115909, -23.3898996],
      [-46.3114573, -23.3897821], [-46.3114121, -23.3897267], [-46.3113204, -23.3896409]];
    const amazonas = await linhas('aruja_24h', 'Avenida Amazonas');
    expect(usoM(amazonasNE, amazonas, true)).toBeGreaterThan(50);
    expect(usoM(amazonasNEvolta, amazonas, true)).toBeLessThan(10);
  });
});

describe('regras (módulo da camada)', () => {
  it('Arujá (Dec. 8.183/2023, art. 8º): 24 h nos incisos I, IV–VII; 5h–23h59 nos demais; acima de 31,5 t (PBT) ou 33,075 t (PBTC) 24 h', async () => {
    const d24 = await regra('aruja_24h'), d5 = await regra('aruja_5h_24h');
    expect(describeJanelas(d24.janelas)).toBe('todos os dias o dia todo');
    expect(describeJanelas(d5.janelas)).toBe('todos os dias 5h–24h');
    const truck = enquadrar(d5, veic({ preset: 'truck' }));                       // 23 t, rígido
    expect(truck).toMatchObject({ aplica: true, classe: 'caminhão' });
    expect(janelaAtiva(truck.janelas, at('2026-10-13T04:59'))).toBe(false);
    expect(janelaAtiva(truck.janelas, at('2026-10-13T23:59'))).toBe(true);
    const carreta = enquadrar(d5, veic({ preset: 'carreta' }));                   // PBTC 41,5 t
    expect(carreta.classe).toBe('PBTC acima de 33,075 t (art. 8º, I)');
    expect(janelaAtiva(carreta.janelas, at('2026-10-13T03:00'))).toBe(true);
    // combinação de 33 t: abaixo do PBTC do inciso I, fica com o horário de caminhão; rígido nunca chega a 31,5 t no CTB, mas a regra existe
    expect(enquadrar(d5, veic({ preset: 'carreta', weight_t: 33 })).classe).toBe('caminhão');
    expect(enquadrar(d5, veic({ preset: 'truck', weight_t: 32 })).classe).toBe('PBT acima de 31,5 t (art. 8º, I)');
    // sem isenção de VUC (art. 7º, §2º)
    expect(enquadrar(d24, veic({ preset: 'vuc', is_vuc: true, width_m: 2.2, length_m: 6.3 }))).toMatchObject({ aplica: true, classe: 'caminhão' });
  });

  it('Itapecerica (Dec. 2.184/2010): seg–sex 5h–21h e sáb 5h–14h; domingo livre', async () => {
    const r = await regra('itapecerica_centro');
    expect(describeJanelas(r.janelas)).toBe('seg–sex 5h–21h; sáb 5h–14h');
    expect(janelaAtiva(r.janelas, at('2026-10-13T20:59'))).toBe(true);
    expect(janelaAtiva(r.janelas, at('2026-10-13T21:00'))).toBe(false);
    expect(janelaAtiva(r.janelas, at('2026-10-17T13:00'))).toBe(true);
    expect(janelaAtiva(r.janelas, at('2026-10-17T14:00'))).toBe(false);
    expect(janelaAtiva(r.janelas, at('2026-10-18T10:00'))).toBe(false);
  });

  it('Mairiporã (Lei 4.391/2025): só mais de 2 eixos, 24 h', async () => {
    const r = await regra('mairipora_cantareira');
    expect(enquadrar(r, veic({ preset: 'toco' })).aplica).toBe(false);          // 2 eixos
    expect(enquadrar(r, veic({ preset: 'truck' })).aplica).toBe(true);          // 3 eixos
    expect(enquadrar(r, veic({ preset: 'carreta' })).aplica).toBe(true);
  });

  it('Diadema (serviço 55): comprimento acima de 6,30 m ou largura acima de 2,20 m; seg–sex 6h–20h, sáb 6h–14h', async () => {
    const r = await regra('diadema_vias_restricao');
    expect(describeJanelas(r.janelas)).toBe('seg–sex 6h–20h; sáb 6h–14h');
    expect(enquadrar(r, veic({ preset: 'vuc', width_m: 2.2, length_m: 6.3 })).aplica).toBe(false);
    expect(enquadrar(r, veic({ preset: 'vuc', width_m: 2.2, length_m: 7.2 })).aplica).toBe(true);
    expect(enquadrar(r, veic({ preset: 'vuc', width_m: 2.5, length_m: 6.0 })).aplica).toBe(true);
  });

  it('Caieiras: Vila Rosina 24 h para todo caminhão (VUC sem definição = caminhão); 12 m e 13 t registradas e não aplicadas', async () => {
    const vr = await regra('caieiras_vila_rosina');
    expect(enquadrar(vr, veic({ preset: 'vuc', is_vuc: true })).aplica).toBe(true);
    const z12 = await regra('caieiras_comprimento_12m');
    expect(enquadrar(z12, veic({ preset: 'truck' })).aplica).toBe(false);       // 12,0 m: não passa de 12 m
    expect(enquadrar(z12, veic({ preset: 'carreta' })).aplica).toBe(true);      // alvo do aviso
    expect(regraAplicavel(z12)).toBe(false);
    expect(z12.status_motivo).toMatch(/decreto regulamentador.*art\. 5º.*mediante disponibilidade.*penalizar/s);
    const z13 = await regra('caieiras_carga_13t');
    expect(regraAplicavel(z13)).toBe(false);
    expect(z13.status_motivo).toMatch(/carga útil ou PBT/);
  });

  it('Suzano (GeoSuzano): seg–sáb 7h–21h', async () => {
    const r = await regra('suzano_centro');
    expect(describeJanelas(r.janelas)).toBe('seg–sáb 7h–21h');
    expect(janelaAtiva(r.janelas, at('2026-10-17T20:30'))).toBe(true);
    expect(janelaAtiva(r.janelas, at('2026-10-18T12:00'))).toBe(false);
  });
});

describe('exclusões, custos e avisos (contexto da rota)', () => {
  it('Caieiras: zona de 12 m (desativada) não exclui ninguém; a carreta que corta a cidade só recebe o aviso', async () => {
    const tem = (ex: any[]) => ex.some((e) => e.item.type === 'Comprimento máximo de 12 m (Lei 3.560/2004)');
    expect(tem(await layer.exclusions!(ctxOf(FRANCO, PERUS, '2026-10-13T10:00', { preset: 'carreta' }) as any))).toBe(false);
    expect(tem(await layer.exclusions!(ctxOf(CAIEIRAS_CENTRO, FRANCO, '2026-10-13T10:00', { preset: 'carreta' }) as any))).toBe(false);
    // rota (sintética) pelo Centro de Caieiras: carreta (18,6 m) avisa; caminhão de 12,0 m não é alvo
    const { lon: x, lat: y } = CAIEIRAS_CENTRO;
    const coords: [number, number][] = [[x - 0.006, y], [x, y], [x + 0.006, y]];
    const o = { lon: coords[0][0], lat: y }, d = { lon: coords[2][0], lat: y };
    const doze = (ws: any[] | undefined) => (ws ?? []).filter((w) => w.code === 'municipal_regra_nao_aplicada' && /12 m/.test(w.message));
    const carreta = await layer.annotate!(ctxOf(o, d, '2026-10-13T10:00', { preset: 'carreta' }) as any, routeOf(coords) as any);
    expect(doze(carreta.warnings).map((w) => w.severity)).toEqual(['info']);
    expect(doze(carreta.warnings)[0].message).toMatch(/NÃO aplica: Lei de 2004 sem o decreto regulamentador/);
    const truck = await layer.annotate!(ctxOf(o, d, '2026-10-13T10:00', { preset: 'truck' }) as any, routeOf(coords) as any);
    expect(doze(truck.warnings)).toEqual([]);
  });

  it('regras desativadas nunca entram em exclusões nem custos (Taboão, Mogi, Caieiras 13 t, Mauá...)', async () => {
    const q = await pool.query(`select id::text, props->>'regra_id' regra from data_features where layer_id = 'restricoes_rmsp' and kind = 'desativada' and source = any($1)`, [Object.keys(FONTES)]);
    const ids = new Set(q.rows.map((r: any) => r.id)), regras = new Set(q.rows.map((r: any) => r.regra));
    expect(regras.size).toBe(8);
    const taboao = { lat: -23.6100, lon: -46.7700 }, mogi = { lat: -23.5230, lon: -46.1900 }, maua = { lat: -23.6740, lon: -46.4570 };
    for (const [o, d] of [[taboao, { lat: -23.63, lon: -46.80 }], [mogi, { lat: -23.54, lon: -46.21 }], [maua, { lat: -23.68, lon: -46.47 }], [FRANCO, PERUS]] as [P, P][]) {
      const ctx = ctxOf(o, d, '2026-10-13T10:00', { preset: 'carreta' }) as any;
      for (const e of await layer.exclusions!(ctx)) expect(ids.has(e.item.id), e.item.name).toBe(false);
      for (const c of await layer.costLines!(ctx)) expect(regras.has(c.item.id.split(':')[0]), c.item.name).toBe(false);
    }
  });

  it('Arujá às 3h: o caminhão só tem as vias 24 h; a carreta (PBTC acima de 33,075 t) também as de 5h–23h59', async () => {
    const o = { lat: -23.3960, lon: -46.3300 }, d = { lat: -23.3990, lon: -46.3100 };
    const tipos = async (when: string, preset: string) =>
      new Set((await layer.costLines!(ctxOf(o, d, when, { preset }) as any)).filter((c) => /^Arujá/.test(c.item.name ?? '')).map((c) => c.item.type));
    const T24 = 'Restrição 24 h (art. 8º, II)', T5 = 'Restrição 5h–23h59 (art. 8º, III)';
    expect([...await tipos('2026-10-13T03:00', 'truck')]).toEqual([T24]);
    expect([...await tipos('2026-10-13T03:00', 'carreta')].sort()).toEqual([T24, T5].sort());
    expect([...await tipos('2026-10-13T10:00', 'truck')].sort()).toEqual([T24, T5].sort());
  });

  it('Mogi (desativada): rota pela área central não é desviada, mas avisa (municipal_regra_nao_aplicada) com o motivo', async () => {
    const q = await pool.query(`select ST_X(c) x, ST_Y(c) y from (select ST_PointOnSurface(geom) c from data_features
      where layer_id = 'restricoes_rmsp' and props->>'regra_id' = 'mogi_area_central') s`);
    const { x, y } = q.rows[0];
    const coords: [number, number][] = [[x - 0.012, y], [x, y], [x + 0.012, y]];
    const o = { lon: coords[0][0], lat: y }, d = { lon: coords[2][0], lat: y };
    const ann = await layer.annotate!(ctxOf(o, d, '2026-10-13T10:00', { preset: 'truck' }) as any, routeOf(coords) as any);
    const w = ann.warnings!.find((x) => x.code === 'municipal_regra_nao_aplicada' && /Mogi das Cruzes/.test(x.message));
    expect(w?.severity).toBe('info');
    expect(w?.message).toMatch(/NÃO aplica: Fontes divergentes/);
    expect((ann.data as any).nao_aplicadas.map((n: any) => n.regra_id)).toContain('mogi_area_central');
    // utilitário (PBT 3,5 t) não é caminhão: sem aviso
    const leve = await layer.annotate!(ctxOf(o, d, '2026-10-13T10:00', { preset: 'utilitario' }) as any, routeOf(coords) as any);
    expect((leve.warnings ?? []).some((x) => x.code === 'municipal_regra_nao_aplicada')).toBe(false);
  });
});

describe('rotas reais (API)', () => {
  it('Itapecerica: toco às 10h de terça desvia da Av. XV de Novembro; às 22h passa por ela', async () => {
    const xv = await linhas('itapecerica_centro', 'Avenida Quinze de Novembro');
    const noite = await route({ origin: ITA_N, destination: ITA_S, vehicle: { preset: 'toco' }, departure_at: '2026-10-13T22:00' });
    expect(noite.status, JSON.stringify(noite.body)).toBe(200);
    expect(usoM(noite.body.geometry.coordinates, xv), 'pré-condição: fora do horário a rota usa a Av. XV').toBeGreaterThan(1000);
    expect(nossos(noite.body)).toEqual([]);
    const dia = await route({ origin: ITA_N, destination: ITA_S, vehicle: { preset: 'toco' }, departure_at: '2026-10-13T10:00' });
    expect(dia.status, JSON.stringify(dia.body)).toBe(200);
    expect(usoM(dia.body.geometry.coordinates, xv)).toBeLessThan(100);
    expect(nossos(dia.body).some((a: any) => a.type === 'Restrição a caminhões (Dec. 2.184/2010)' && /Quinze de Novembro/.test(a.name))).toBe(true);
    expect(dia.body.warnings.some((w: any) => w.severity === 'danger' && /Itapecerica/.test(w.message))).toBe(false);
  }, 240_000);

  it('Mairiporã: carreta desvia da subida da Cantareira (Belarmino/Gianesella); toco de 2 eixos passa por ela', async () => {
    const ls = await linhas('mairipora_cantareira');
    const toco = await route({ origin: MAI_SERRA, destination: MAI_CENTRO, vehicle: { preset: 'toco' }, departure_at: '2026-10-13T10:00' });
    expect(toco.status, JSON.stringify(toco.body)).toBe(200);
    expect(usoM(toco.body.geometry.coordinates, ls), 'pré-condição: o caminho natural sobe pela Gianesella/Belarmino').toBeGreaterThan(5000);
    expect(nossos(toco.body)).toEqual([]);
    const carreta = await route({ origin: MAI_SERRA, destination: MAI_CENTRO, vehicle: { preset: 'carreta' }, departure_at: '2026-10-13T10:00' });
    expect(carreta.status, JSON.stringify(carreta.body)).toBe(200);
    expect(usoM(carreta.body.geometry.coordinates, ls)).toBeLessThan(200);
    expect(nossos(carreta.body).some((a: any) => a.type === 'Mais de 2 eixos (Lei 4.391/2025)')).toBe(true);
    expect(carreta.body.distance_km).toBeGreaterThan(toco.body.distance_km);
  }, 240_000);

  it('Caieiras: Franco da Rocha → Perus, o leve corta pela Vila Rosina; o caminhão desvia pela SP-332 sem aviso falso da rodovia', async () => {
    const vr = await linhas('caieiras_vila_rosina');
    const leve = await route({ origin: FRANCO, destination: PERUS, vehicle: { preset: 'utilitario' }, departure_at: '2026-10-13T10:00' });
    expect(leve.status, JSON.stringify(leve.body)).toBe(200);
    expect(usoM(leve.body.geometry.coordinates, vr), 'pré-condição: o atalho natural é a Vila Rosina').toBeGreaterThan(300);
    for (const preset of ['toco', 'carreta']) {
      const r = await route({ origin: FRANCO, destination: PERUS, vehicle: { preset }, departure_at: '2026-10-13T10:00' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(usoM(r.body.geometry.coordinates, vr), preset).toBeLessThan(60);
      expect(nossos(r.body).some((a: any) => a.type === 'Vila Rosina (Lei 5.486/2021)'), preset).toBe(true);
      // pela SP-332: nenhum aviso de via restrita nem da zona de 13 t (rodovia estadual fica fora das zonas de Caieiras)
      const avisos = r.body.warnings.filter((w: any) => /Caieiras/.test(w.message ?? ''));
      expect(avisos.filter((w: any) => w.severity === 'danger' || w.code === 'municipal_regra_nao_aplicada'), preset).toEqual([]);
    }
  }, 300_000);

  it('Caieiras: carreta saindo do Centro (dentro da zona de 12 m, desativada) não é bloqueada e recebe o aviso informativo', async () => {
    const r = await route({ origin: CAIEIRAS_CENTRO, destination: FRANCO, vehicle: { preset: 'carreta' }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.warnings.some((x: any) => x.code === 'rmsp_origem_na_zona' && /Caieiras/.test(x.message))).toBe(false);
    const w = r.body.warnings.find((x: any) => x.code === 'municipal_regra_nao_aplicada' && /Caieiras.*12 m/.test(x.message));
    expect(w?.severity).toBe('info');
  }, 120_000);

  it('Diadema: caminhão às 10h desvia das vias do Centro; VUC de 2,20 x 6,30 m passa', async () => {
    const centro = await linhas('diadema_vias_restricao');
    const vuc = await route({ origin: DIA_A, destination: DIA_B, vehicle: { preset: 'vuc', width_m: 2.2, length_m: 6.3 }, departure_at: '2026-10-13T10:00' });
    expect(vuc.status, JSON.stringify(vuc.body)).toBe(200);
    expect(usoM(vuc.body.geometry.coordinates, centro), 'pré-condição: o caminho natural passa pelo Centro').toBeGreaterThan(200);
    const truck = await route({ origin: DIA_A, destination: DIA_B, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T10:00' });
    expect(truck.status, JSON.stringify(truck.body)).toBe(200);   // antes da limpeza dos vértices: 502 (edge walk)
    expect(usoM(truck.body.geometry.coordinates, centro)).toBeLessThan(100);
    expect(nossos(truck.body).some((a: any) => a.type === 'Vias de restrição (Centro e Jd. Eldorado)')).toBe(true);
  }, 240_000);
});
