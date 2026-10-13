import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { angDiff } from '../../src/layers/radares.layer.js';
import { CARRETA, get, pool, route, waitForStack } from '../helpers.js';

/**
 * Camada "radares" (OpenStreetMap, ODbL): informativa, só `annotate` (aviso agrupado radar_na_rota); nunca muda a rota.
 * Casos reais do PBF Sudeste (2026-10-08), Rodovia Presidente Tancredo de Almeida Neves (Caieiras/Franco da Rocha):
 *   nó 13647058396  highway=speed_camera maxspeed=40 direction=325  (sentido NW)
 *   nó 13647058395  highway=speed_camera maxspeed=40 direction=145  (sentido SE), a ~25 m do outro
 * Uma rota que sobe a rodovia para NW passa pelo 325 e NÃO pelo 145; a rota inversa, o contrário.
 */
const NODE_NW = 13647058396;
const NODE_SE = 13647058395;
const SUL = { lat: -23.4150, lon: -46.7050 };
const NORTE = { lat: -23.3800, lon: -46.7350 };
const DEP = '2026-10-13T22:30';
// trecho urbano/rodoviário de SP com vários radares sem direção (Marginal Pinheiros)
const PINHEIROS_A = { lat: -23.5800, lon: -46.7250 };
const PINHEIROS_B = { lat: -23.6150, lon: -46.7000 };

const veh = CARRETA;
const radarWarnings = (b: any) => b.warnings.filter((w: any) => w.code === 'radar_na_rota');
const nodes = (b: any) => (b.layers?.radares?.data?.radares ?? []).map((x: any) => x.id as string);

async function idOfNode(osm: number): Promise<string> {
  const r = await pool.query(`select id::text from data_features where layer_id='radares' and (props->>'osm_node')::bigint = $1`, [osm]);
  expect(r.rowCount, `nó ${osm} não importado`).toBe(1);
  return r.rows[0].id;
}

describe('Camada radares (OSM)', () => {
  let idNW: string, idSE: string;
  beforeAll(async () => { await waitForStack(); idNW = await idOfNode(NODE_NW); idSE = await idOfNode(NODE_SE); });
  afterAll(async () => { await pool.end(); });

  it('importação registrada: ODbL, fonte OSM, milhares de radares em data_features', async () => {
    const runs = await pool.query(`select license, source_url, record_count from data_layer_runs where layer_id='radares' and source='osm' order by imported_at desc limit 1`);
    expect(runs.rowCount).toBe(1);
    expect(runs.rows[0].license).toMatch(/ODbL/);
    expect(runs.rows[0].source_url).toMatch(/geofabrik|OSM|openstreetmap/i);
    expect(runs.rows[0].record_count).toBeGreaterThan(4000);
    const n = await pool.query(`select count(*)::int c, count(*) filter (where props->>'maxspeed_kmh' is not null)::int ms,
                                       count(*) filter (where props->>'direction_deg' is not null and props->>'direction_deg' <> 'null')::int dir
                                  from data_features where layer_id='radares' and source='osm'`);
    expect(n.rows[0].c).toBe(runs.rows[0].record_count);
    expect(n.rows[0].ms).toBeGreaterThan(4000);
    expect(n.rows[0].dir).toBeGreaterThan(500);
  });

  it('catálogo: camada de segurança que só anota (não altera a rota), com licença ODbL', async () => {
    const r = await get('/api/layers');
    const l = r.body.find((x: any) => x.id === 'radares');
    expect(l, 'camada não carregada').toBeTruthy();
    expect(l.group).toBe('seguranca');
    expect(l.annotates_route).toBe(true);
    expect(l.affects_route).toBe(false);
    expect(l.has_features).toBe(true);
    expect(l.sources[0].license).toMatch(/ODbL/);
    expect(l.runs.map((x: any) => x.source)).toContain('osm');
    const mod = (await import('../../src/layers/radares.layer.js')).default as any;
    expect(mod.exclusions).toBeUndefined();
    expect(mod.costLines).toBeUndefined();
  });

  it('features por bbox: pontos com limite, direção e aviso de que não muda o traçado', async () => {
    const r = await get('/api/layers/radares/features?bbox=-46.74,-23.42,-46.70,-23.38&zoom=13');
    expect(r.status).toBe(200);
    const f = r.body.features.find((x: any) => String(x.properties.osm_node) === String(NODE_NW));
    expect(f, 'radar conhecido ausente do bbox').toBeTruthy();
    expect(f.geometry.type).toBe('Point');
    expect(f.properties.limite_kmh).toBe(40);
    expect(f.properties.direcao_graus).toBe(325);
    expect(f.properties.name).toMatch(/Radar 40 km\/h/);
    const far = await get('/api/layers/radares/features?bbox=-53,-25,-44,-19&zoom=5');
    expect(far.body.features).toEqual([]);   // zoom baixo: não despeja 5 mil pontos
  });

  it('rota em SP/Rodovia: um aviso agrupado radar_na_rota (info) com a lista em data', async () => {
    const r = await route({ origin: SUL, destination: NORTE, vehicle: veh, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ws = radarWarnings(r.body);
    expect(ws.length).toBe(1);                                   // agrupado: não um aviso por radar
    expect(ws[0].severity).toBe('info');
    expect(ws[0].layer).toBe('radares');
    expect(ws[0].message).toMatch(/radares? de velocidade na rota/);
    const d = r.body.layers.radares.data;
    expect(d.total).toBeGreaterThanOrEqual(3);
    expect(d.radares.length).toBe(d.total);
    const kms = d.radares.map((x: any) => x.km_desde_origem);
    expect(kms).toEqual([...kms].sort((a: number, b: number) => a - b));
    for (const x of d.radares) {
      expect(x.distancia_rota_m).toBeLessThanOrEqual(30);
      expect(x.km_desde_origem).toBeGreaterThanOrEqual(0);
      expect(x.km_desde_origem).toBeLessThanOrEqual(r.body.distance_km + 0.1);
      expect(x).toHaveProperty('limite_kmh');
    }
    expect(d.radares.some((x: any) => x.limite_kmh === 40)).toBe(true);
  });

  it('respeita direction: sentido NW pega o radar de 325 graus, não o de 145', async () => {
    const r = await route({ origin: SUL, destination: NORTE, vehicle: veh, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(nodes(r.body)).toContain(idNW);
    expect(nodes(r.body)).not.toContain(idSE);
    const x = r.body.layers.radares.data.radares.find((y: any) => y.id === idNW);
    expect(x.direcao).toBe('confere');
    expect(angDiff(x.rumo_rota_graus, x.direcao_graus)).toBeLessThanOrEqual(60);
    expect(r.body.layers.radares.data.descartados_por_direcao).toBeGreaterThanOrEqual(1);
  });

  it('sentido inverso (SE): pega o de 145 graus, não o de 325', async () => {
    const r = await route({ origin: NORTE, destination: SUL, vehicle: veh, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(nodes(r.body)).toContain(idSE);
    expect(nodes(r.body)).not.toContain(idNW);
  });

  it('radar sem direção avisa nos dois sentidos', async () => {
    const ida = await route({ origin: PINHEIROS_A, destination: PINHEIROS_B, vehicle: veh, departure_at: DEP });
    const volta = await route({ origin: PINHEIROS_B, destination: PINHEIROS_A, vehicle: veh, departure_at: DEP });
    expect(ida.status).toBe(200); expect(volta.status).toBe(200);
    const semDir = (b: any) => b.layers.radares.data.radares.filter((x: any) => x.direcao === 'sem_direcao').map((x: any) => x.id);
    const a = semDir(ida.body), b = semDir(volta.body);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    // vias da Marginal Pinheiros com radar mapeado sem direção aparecem nos dois sentidos
    expect(a.filter((id: string) => b.includes(id)).length).toBeGreaterThan(0);
  });

  it('não muda a rota: sem itens evitados da camada e geometria idêntica entre chamadas', async () => {
    const a = await route({ origin: SUL, destination: NORTE, vehicle: veh, departure_at: DEP });
    const b = await route({ origin: SUL, destination: NORTE, vehicle: veh, departure_at: DEP });
    expect(a.status).toBe(200);
    expect(a.body.avoided.filter((x: any) => x.layer === 'radares')).toEqual([]);
    expect(a.body.warnings.filter((w: any) => w.layer === 'radares').every((w: any) => w.code === 'radar_na_rota')).toBe(true);
    expect(a.body.geometry.coordinates).toEqual(b.body.geometry.coordinates);
    expect(a.body.distance_km).toBe(b.body.distance_km);
  });

  it('angDiff: menor diferença angular', () => {
    expect(angDiff(350, 10)).toBe(20);
    expect(angDiff(10, 350)).toBe(20);
    expect(angDiff(0, 180)).toBe(180);
    expect(angDiff(90, 90)).toBe(0);
  });
});
