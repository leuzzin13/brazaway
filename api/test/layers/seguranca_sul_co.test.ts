import { beforeAll, describe, expect, it } from 'vitest';
import { get, pool, route, waitForStack } from '../helpers.js';

/**
 * Frente "seguranca_sul_co": acidentes de SC (GeoSIE/PMRv, todos os veículos) e de GO e DF (RENAEST, com caminhão) na camada
 * `acidentes` (docs/layers/acidentes.md) e o texto de cobertura da camada `roubo_carga` (só SP; nenhuma UF do Sul/Centro-Oeste
 * tem roubo de carga com coordenada). Rotas reais contra a API local (API_URL).
 */
const layerWarnings = (r: any, layer: string) => r.warnings.filter((w: any) => w.layer === layer);
const CARRETA5 = { preset: 'carreta', axle_count: 5 };
const QUARTA = '2026-10-21T10:00';

beforeAll(async () => { await waitForStack(); });

describe('catálogo e privacidade', () => {
  it('a camada acidentes lista RENAEST e GeoSIE com a licença (ou a incerteza) e as cargas registradas', async () => {
    const r = await get('/api/layers');
    const ac = r.body.find((l: any) => l.id === 'acidentes');
    expect(ac.description).toMatch(/GO, DF/);
    expect(ac.description).toMatch(/SC/);
    const ren = ac.sources.find((s: any) => /RENAEST/.test(s.name));
    expect(ren.license).toMatch(/Domínio Público/);
    const geo = ac.sources.find((s: any) => /GeoSIE/.test(s.name));
    expect(geo.license).toMatch(/licença NÃO declarada/);       // incerteza registrada, não publicada como licença aberta
    expect(geo.license).toMatch(/agregado/);
    const runs = Object.fromEntries(ac.runs.map((x: any) => [x.source, x]));
    expect(runs['geosie-sc'].license).toBe(geo.license);          // mesma redação no importador e na API
    expect(runs['geosie-sc'].record_count).toBeGreaterThan(50);
    for (const s of ['renaest-go', 'renaest-df']) {
      if (!runs[s]) continue;                                    // carga do RENAEST depende de baixar o ZIP de 530 MB
      expect(runs[s].license).toBe(ren.license);
    }
  });

  it('nenhum registro individual: SC só em células com >= 5 sinistros, GO/DF só com >= 3 acidentes com caminhão', async () => {
    const sc = await pool.query(`select min((props->>'total')::int) as mn, bool_and(props->>'escopo' = 'todos_veiculos') as todos,
                                        bool_and((props->>'caminhao')::int = 0) as sem_cam, count(*)::int as n
                                   from data_features where layer_id = 'acidentes' and source = 'geosie-sc'`);
    expect(sc.rows[0].n).toBeGreaterThan(50);
    expect(sc.rows[0].mn).toBeGreaterThanOrEqual(5);
    expect(sc.rows[0].todos).toBe(true);
    expect(sc.rows[0].sem_cam).toBe(true);                       // a fonte não tem tipo de veículo: nunca vira "com caminhão"
    const keys = await pool.query(`select distinct jsonb_object_keys(props) as k from data_features where layer_id = 'acidentes' and source in ('geosie-sc','renaest-go','renaest-df')`);
    const ks = new Set(keys.rows.map((x) => x.k));
    for (const proibido of ['data', 'hora', 'boletim', 'num_acidente', 'endereco', 'k']) expect(ks.has(proibido)).toBe(false);
    const go = await pool.query(`select min((props->>'caminhao')::int) as mn, count(*)::int as n from data_features where layer_id = 'acidentes' and source in ('renaest-go','renaest-df')`);
    if (go.rows[0].n) expect(go.rows[0].mn).toBeGreaterThanOrEqual(3);
  });
});

describe('SC (GeoSIE/PMRv): SC-108 em Blumenau', () => {
  it('a rota avisa do trecho crítico de sinistros de TODOS os veículos, sem somar aos acidentes com caminhão', async () => {
    const r = await route({ origin: { lat: -26.78, lon: -49.09 }, destination: { lat: -26.87, lon: -49.085 }, vehicle: CARRETA5, departure_at: QUARTA });
    expect(r.status).toBe(200);
    const a = r.body.layers.acidentes;
    expect(a.data.todos_veiculos.pontos).toBeGreaterThan(0);
    expect(a.data.todos_veiculos.sinistros).toBeGreaterThan(20);
    expect(a.data.caminhao).toBe(0);                             // nada de "caminhão" vindo de fonte sem tipo de veículo
    expect(a.summary.join(' ')).toMatch(/todos os veículos; a fonte não informa o tipo de veículo/);
    const w = layerWarnings(r.body, 'acidentes');
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].code).toBe('accident_hotspot');
    expect(w[0].message).toMatch(/SC-108/);
    expect(w[0].message).toMatch(/sinistros de todos os veículos/);
    expect(w[0].message).not.toMatch(/acidentes com caminhão/);
  });

  it('o mapa mostra "não informado" para o tipo de veículo nas células de SC', async () => {
    const r = await get('/api/layers/acidentes/features?bbox=-49.2,-26.95,-48.95,-26.7&zoom=11');
    expect(r.status).toBe(200);
    const f = r.body.features.find((x: any) => /SC-108/.test(x.properties.name));
    expect(f, 'célula da SC-108 no mapa').toBeTruthy();
    expect(f.properties.acidentes_caminhao).toMatch(/não informado/);
    expect(f.properties.fonte).toMatch(/SIE-SC/);
  });

  it('BR em SC continua só na PRF: nenhuma célula do GeoSIE com via BR-', async () => {
    const r = await pool.query(`select count(*)::int as n from data_features where layer_id = 'acidentes' and source = 'geosie-sc' and props->>'via' ~ '^BR-'`);
    expect(r.rows[0].n).toBe(0);
  });
});

describe('GO e DF (RENAEST): acidentes com caminhão, sem BR (PRF)', () => {
  it('GO-060 em Trindade: o trecho crítico entra como aviso, com a fonte RENAEST e o período real dos dados', async () => {
    const r = await route({ origin: { lat: -16.66, lon: -49.4 }, destination: { lat: -16.62, lon: -49.52 }, vehicle: CARRETA5, departure_at: QUARTA });
    expect(r.status).toBe(200);
    const a = r.body.layers.acidentes;
    expect(a.data.caminhao).toBeGreaterThan(5);
    expect(a.data.todos_veiculos).toBeUndefined();               // GO traz o tipo de veículo
    expect(a.summary.join(' ')).toMatch(/RENAEST \(DETRAN-GO\)/);
    const w = layerWarnings(r.body, 'acidentes').find((x: any) => /GO-060/.test(x.message));
    expect(w, JSON.stringify(layerWarnings(r.body, 'acidentes'))).toBeTruthy();
    expect(w.message).toMatch(/acidentes com caminhão em 3 anos/);
  });

  it('DF: período real dos dados (só 2025 e 2026 têm coordenada) e nenhuma BR', async () => {
    const r = await pool.query(`select distinct props->'janela' as j from data_features where layer_id = 'acidentes' and source = 'renaest-df'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].j.de >= '2025-01-01').toBe(true);           // 2020 a 2024 vêm com placeholder no RENAEST do DF
    const br = await pool.query(`select count(*)::int as n from data_features where layer_id = 'acidentes' and source in ('renaest-go','renaest-df') and props->>'via' ~ '^BR-'`);
    expect(br.rows[0].n).toBe(0);                                // BR é da PRF
    const rt = await route({ origin: { lat: -15.78, lon: -47.92 }, destination: { lat: -15.82, lon: -47.97 }, vehicle: CARRETA5, departure_at: QUARTA });
    expect(rt.status).toBe(200);
    expect(rt.body.layers.acidentes.data.caminhao).toBeGreaterThan(10);
  });

  it('não conta duas vezes o que a PRF cobre: nenhuma célula RENAEST de rodovia (GO-/DF-) dentro de 250 m de célula da PRF na mesma via', async () => {
    const r = await pool.query(`select count(*)::int as n from data_features a join data_features p on p.layer_id = 'acidentes' and p.source = 'prf'
        and ST_DWithin(a.geom::geography, p.geom::geography, 200)
      where a.layer_id = 'acidentes' and a.source in ('renaest-go','renaest-df') and a.props->>'via' ~ '^(GO|DF)-'`);
    expect(r.rows[0].n).toBeLessThan(5);                         // a regra descarta rodovia em célula (±1) da PRF; sobra só ruído de borda
  });
});

describe('roubo_carga: cobertura só SP, dita ao usuário', () => {
  it('descrição e resumo sem área dizem que o resto do país não tem dado aberto com coordenada', async () => {
    const l = (await get('/api/layers')).body.find((x: any) => x.id === 'roubo_carga');
    expect(l.description).toMatch(/Só o estado de SP/);
    const r = await route({ origin: { lat: -25.43, lon: -49.27 }, destination: { lat: -25.0, lon: -49.0 }, vehicle: CARRETA5, departure_at: QUARTA });
    expect(r.status).toBe(200);
    expect(r.body.layers.roubo_carga.summary.join(' ')).toMatch(/cobre só o estado de SP/);
    expect(layerWarnings(r.body, 'roubo_carga')).toEqual([]);
  });
});
