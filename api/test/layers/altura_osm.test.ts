import * as turf from '@turf/turf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exceeded } from '../../src/layers/altura_osm.layer.js';
import { decodePolyline6 } from '../../src/services/polyline.js';
import { cleanupTestReports, DEVICE, get, minDistM, pool, post, route, waitForStack } from '../helpers.js';

const VALHALLA = process.env.VALHALLA_URL ?? 'http://localhost:8002';
const DEP = '2026-10-13T22:30'; // terça 22h30: fora da ZMRC, sem feriado

/**
 * Caso real do PBF Sudeste (Geofabrik 2026-10-08), conferido com pyosmium:
 *   nó 7867297145  barrier=height_restrictor, maxheight=4.3  (versão 3, 18/06/2023)
 *   way 767744222  highway=trunk, name=Avenida Humberto de Campos, oneway=yes (sentido oeste), SEM maxheight
 * São Bernardo do Campo, sob o viaduto do Rodoanel. A pista do sentido leste (way 411267943) tem outro limitador
 * (nó 8528811679, 4,3 m). Como o limite está só no NÓ, o Valhalla 3.9.1 o ignora (issue valhalla#3487).
 */
const NODE = { osm: 7867297145, way: 767744222, lat: -23.7056607, lon: -46.4302826 };
const OTHER_CARRIAGEWAY = 8528811679;
const EAST = { lat: -23.7058, lon: -46.4250 };   // na Av. Humberto de Campos, a leste do limitador
const WEST = { lat: -23.7050, lon: -46.4360 };   // a oeste
const CARRETA = { preset: 'carreta' };            // 4,40 m
const TRUCK = { preset: 'truck' };                // 4,20 m
const EXACT = { preset: 'truck', height_m: 4.3 }; // igual ao limite

// Lacunas: Av. Salim Farah Maluf (trunk) passa sob vários viadutos e pontes ferroviárias sem maxheight no OSM
const SALIM_S = { lat: -23.5790, lon: -46.5690 };
const SALIM_N = { lat: -23.5380, lon: -46.5830 };

/**
 * Nó em vias de MÃO DUPLA (achado da revisão: avisos repetidos). Nó 8681030908 (maxheight=2.35, portaria de garagem em
 * São Paulo) é a ponta de DUAS ways de serviço de mão dupla (679175662 e 936905177): costLines manda 4 linhas (2 ways x 2
 * sentidos) com o mesmo item. VUC (3,20 m) de leste para oeste não tem alternativa e passa por ele: o aviso
 * uses_restricted_way tem de aparecer UMA vez (antes, uma por linha usada).
 */
const TWO_WAY = { osm: 8681030908, east: { lat: -23.5504912, lon: -46.6644031 }, west: { lat: -23.5503999, lon: -46.6647593 } };
const VUC = { preset: 'vuc', is_vuc: true };

/**
 * Túnel curto (45 m) da Av. Santos Dumont (way 114358445, trunk, sem maxheight) em Santo André/São Caetano: a rota que
 * PERCORRE o túnel conta; a rua que cruza POR CIMA dele (deixa ~10 m do túnel no buffer de 5 m) não conta.
 */
const SHORT_TUNNEL = {
  via_id: 114358445,
  through: { origin: { lat: -23.66515, lon: -46.51668 }, destination: { lat: -23.66432, lon: -46.51388 } },
  over: { origin: { lat: -23.66577, lon: -46.51492 }, destination: { lat: -23.66370, lon: -46.51564 } },
};

/** Cada item/aviso de altura_osm aparece uma vez só (routing.ts deduplica por layer+id). */
function expectNoDuplicates(body: any) {
  const av = body.avoided.filter((a: any) => a.layer === 'altura_osm').map((a: any) => a.id);
  expect(new Set(av).size, `avoided repetido: ${av}`).toBe(av.length);
  const ws = body.warnings.filter((w: any) => w.layer === 'altura_osm' && w.id).map((w: any) => `${w.code}|${w.id}`);
  expect(new Set(ws).size, `aviso repetido: ${ws}`).toBe(ws.length);
}

async function featureByNode(layer: string, osmNode: number) {
  const r = await pool.query(`select id::text, kind, name, props, ST_X(geom) as lon, ST_Y(geom) as lat from data_features
                               where layer_id = $1 and (props->>'osm_node')::bigint = $2`, [layer, osmNode]);
  return r.rows;
}

describe('exceeded(): bloqueia só acima do limite', () => {
  const lim = { max_height_m: 4.3, max_width_m: 2.5, max_weight_t: 12 };
  it('altura igual ao limite passa; acima bloqueia', () => {
    expect(exceeded(lim, { height_m: 4.3, width_m: 2.5, weight_t: 12 })).toEqual([]);
    expect(exceeded(lim, { height_m: 4.31, width_m: 2.5, weight_t: 12 })[0]).toMatch(/altura máx\. 4,3 m/);
  });
  it('largura e peso em nó também valem', () => {
    expect(exceeded(lim, { height_m: 3, width_m: 2.6, weight_t: 12 })[0]).toMatch(/largura máx\. 2,5 m/);
    expect(exceeded(lim, { height_m: 3, width_m: 2.2, weight_t: 23 })[0]).toMatch(/peso máx\. 12 t/);
    expect(exceeded({ max_height_m: null, max_width_m: null, max_weight_t: null }, { height_m: 9, width_m: 9, weight_t: 99 })).toEqual([]);
  });
});

describe('altura_osm: limitador de altura gravado em nó do OSM (Av. Humberto de Campos, 4,3 m)', () => {
  let featureId: string;

  beforeAll(async () => {
    await waitForStack();
    const rows = await featureByNode('altura_osm', NODE.osm);
    expect(rows.length, 'rode o importador osm_altura_nos').toBe(1);
    featureId = rows[0].id;
  });

  it('o importador gravou o nó, o limite e o trecho da via no sentido de circulação', async () => {
    const [f] = await featureByNode('altura_osm', NODE.osm);
    expect(f.kind).toBe('limitador_altura');
    expect(f.props.max_height_m).toBe(4.3);
    expect(f.props.tags).toMatchObject({ barrier: 'height_restrictor', maxheight: '4.3' });
    expect(f.props.ways.map((w: any) => w.way_id)).toContain(NODE.way);
    const l = f.props.lines.find((x: any) => x.way_id === NODE.way);
    expect(l.oneway).toBe(true);
    // trecho começa a leste e termina a oeste (sentido da via) e passa pelo nó
    expect(l.coords[0][0]).toBeGreaterThan(l.coords[l.coords.length - 1][0]);
    const d = turf.pointToLineDistance(turf.point([NODE.lon, NODE.lat]), turf.lineString(l.coords), { units: 'meters' });
    expect(d).toBeLessThan(1);
  });

  it('sem a camada, o Valhalla manda a carreta de 4,40 m pelo limitador (issue #3487)', async () => {
    const body = {
      locations: [{ ...EAST, type: 'break' }, { ...WEST, type: 'break' }], costing: 'truck',
      costing_options: { truck: { height: 4.4, width: 2.6, length: 18.6, weight: 41.5 } }, units: 'kilometers',
    };
    const res = await fetch(`${VALHALLA}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    const line = turf.lineString(j.trip.legs.flatMap((l: any) => decodePolyline6(l.shape)));
    expect(turf.pointToLineDistance(turf.point([NODE.lon, NODE.lat]), line, { units: 'meters' })).toBeLessThan(5);
  });

  it('carreta de 4,40 m desvia do limitador', async () => {
    const r = await route({ origin: EAST, destination: WEST, vehicle: CARRETA, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = minDistM(r.body, NODE);
    expect(d, `rota passou a ${d.toFixed(0)} m do limitador`).toBeGreaterThan(50);
    const avoided = r.body.avoided.filter((a: any) => a.layer === 'altura_osm');
    expect(avoided.map((a: any) => a.id)).toContain(featureId);
    expect(avoided.find((a: any) => a.id === featureId).rule).toMatch(/altura máx\. 4,3 m; seu veículo: 4,4 m/);
    // a pista do outro sentido (paralela, não usada) não vai para o Valhalla: nada de falso "trecho restrito"
    const [other] = await featureByNode('altura_osm', OTHER_CARRIAGEWAY);
    expect(avoided.map((a: any) => a.id)).not.toContain(other.id);
    expect(r.body.warnings.filter((w: any) => w.layer === 'altura_osm' && w.severity === 'danger')).toEqual([]);
    const lay = r.body.layers.altura_osm;
    expect(lay.data.evitados.map((e: any) => e.id)).toContain(featureId);
    expect(lay.summary.join(' ')).toMatch(/Desvia de 1 ponto/);
    expect(r.body.valhalla.cost_lines_count).toBeGreaterThan(0);
    expectNoDuplicates(r.body);
  });

  it('truck de 4,20 m passa pelo limitador, com aviso de pouca folga', async () => {
    const r = await route({ origin: EAST, destination: WEST, vehicle: TRUCK, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(minDistM(r.body, NODE)).toBeLessThan(5);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(featureId);
    const w = r.body.warnings.find((x: any) => x.code === 'osm_node_tight_height');
    expect(w?.severity).toBe('warn');
    expect(w?.id).toBe(featureId);
    const na = r.body.layers.altura_osm.data.na_rota.find((n: any) => n.id === featureId);
    expect(na.excede).toEqual([]);
  });

  it('veículo com exatamente 4,30 m também passa (bloqueio só se altura > limite)', async () => {
    const r = await route({ origin: EAST, destination: WEST, vehicle: EXACT, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(minDistM(r.body, NODE)).toBeLessThan(5);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(featureId);
  });

  it('rota longa: nó em rodovia (aresta longa) também desvia — fator alto o bastante (Dutra, nó 3908618328, 4,3 m)', async () => {
    const [dutra] = await featureByNode('altura_osm', 3908618328);
    expect(dutra?.props.max_height_m).toBe(4.3);
    const rio = { lat: -22.9, lon: -43.2 }, sp = { lat: -23.52, lon: -46.58 };
    const carreta = await route({ origin: rio, destination: sp, vehicle: CARRETA, departure_at: DEP });
    expect(carreta.status, JSON.stringify(carreta.body)).toBe(200);
    expect(carreta.body.avoided.map((a: any) => a.id)).toContain(dutra.id);
    expect(carreta.body.warnings.filter((w: any) => w.code === 'uses_restricted_way' && w.id === dutra.id)).toEqual([]);
    const truck = await route({ origin: rio, destination: sp, vehicle: TRUCK, departure_at: DEP });
    expect(truck.status).toBe(200);
    expect(minDistM(truck.body, { lat: dutra.lat, lon: dutra.lon })).toBeLessThan(5);
    expect(truck.body.avoided.map((a: any) => a.id)).not.toContain(dutra.id);
    expectNoDuplicates(carreta.body);
  }, 600_000); // duas rotas de ~450 km com todas as camadas: minutos com o ambiente compartilhado carregado

  it('nó em vias de mão dupla (4 linhas, mesmo item): aviso e item aparecem uma vez só', async () => {
    const [f] = await featureByNode('altura_osm', TWO_WAY.osm);
    expect(f?.props.max_height_m, 'rode o importador osm_altura_nos').toBe(2.35);
    expect(f.props.lines.length).toBe(2);
    expect(f.props.lines.every((l: any) => l.oneway === false)).toBe(true);
    const r = await route({ origin: TWO_WAY.east, destination: TWO_WAY.west, vehicle: VUC, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // sem alternativa: passa pelo nó e o routing.ts avisa (danger) — uma vez
    const used = r.body.warnings.filter((w: any) => w.code === 'uses_restricted_way' && w.id === f.id);
    expect(used.length).toBe(1);
    expect(used[0].severity).toBe('danger');
    expect(r.body.layers.altura_osm.data.enviados.linhas).toBeGreaterThanOrEqual(4);
    expectNoDuplicates(r.body);
  });

  it('features() mostra o ponto no mapa e, de perto, o trecho bloqueado', async () => {
    const bbox = [NODE.lon - 0.01, NODE.lat - 0.01, NODE.lon + 0.01, NODE.lat + 0.01].join(',');
    const z14 = await get(`/api/layers/altura_osm/features?bbox=${bbox}&zoom=14`);
    expect(z14.status).toBe(200);
    const pt = z14.body.features.find((f: any) => f.id === featureId);
    expect(pt.geometry.type).toBe('Point');
    expect(pt.properties).toMatchObject({ altura_max_m: 4.3, tipo: 'limitador de altura', osm: `https://www.openstreetmap.org/node/${NODE.osm}` });
    const z16 = await get(`/api/layers/altura_osm/features?bbox=${bbox}&zoom=16`);
    expect(z16.body.features.some((f: any) => f.geometry.type === 'LineString' && String(f.properties.id).startsWith(`${featureId}-`))).toBe(true);
    // zoom fracionário (outros clientes da API não arredondam)
    const z165 = await get(`/api/layers/altura_osm/features?bbox=${bbox}&zoom=16.5`);
    expect(z165.status).toBe(200);
    expect(z165.body.features.some((f: any) => f.geometry.type === 'LineString')).toBe(true);
    const z95 = await get(`/api/layers/altura_osm/features?bbox=${bbox}&zoom=9.5`);
    expect(z95.body.features).toEqual([]);
  });
});

describe('lacunas_osm: passagens sem altura conhecida (informativa)', () => {
  let reportedPassage: { id: string; lat: number; lon: number } | null = null;

  beforeAll(async () => { await waitForStack(); await cleanupTestReports(); });
  afterAll(async () => { await cleanupTestReports(); await pool.end(); });

  it('o importador gerou os tipos de lacuna esperados', async () => {
    const r = await pool.query(`select kind, count(*)::int n from data_features where layer_id = 'lacunas_osm' and source = 'osm' group by kind`);
    const n = Object.fromEntries(r.rows.map((x: any) => [x.kind, x.n]));
    expect(n.passagem_sem_altura).toBeGreaterThan(1000);
    expect(n.tunel_sem_altura).toBeGreaterThan(100);
    expect(n.maxheight_suspeito).toBeGreaterThan(0);
    expect(n.maxweight_suspeito).toBeGreaterThan(0);
    const bad = await pool.query(`select count(*)::int n from data_features where layer_id = 'lacunas_osm' and kind = 'maxheight_suspeito'
                                   and (props->>'valor_m')::float <= 7`);
    expect(bad.rows[0].n).toBe(0);
  });

  it('carreta de 4,40 m: conta as passagens sem altura que a rota percorre e pede reporte', async () => {
    const r = await route({ origin: SALIM_S, destination: SALIM_N, vehicle: CARRETA, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lay = r.body.layers.lacunas_osm;
    expect(lay.data.veiculo_alto).toBe(true);
    expect(lay.data.contagem.desconhecidas).toBeGreaterThanOrEqual(3);
    // só a via de baixo conta: as ruas que passam POR CIMA da avenida (Montesina, Orfanato, Pires do Rio) não entram
    const names: string[] = lay.data.passagens.map((p: any) => p.name);
    expect(names.filter((n) => n.startsWith('Avenida Salim Farah Maluf sob')).length).toBeGreaterThanOrEqual(3);
    expect(names.filter((n) => /^(Rua Montesina|Rua Orfanato|Viaduto Pires do Rio)/.test(n))).toEqual([]);
    // a mesma estrutura não é contada duas vezes (via de baixo picada em dois ways, pistas paralelas): duas passagens que
    // compartilham estrutura por cima ficam a 30 m ou mais uma da outra (o raio do dedupe da camada)
    const ids = lay.data.passagens.filter((p: any) => p.kind === 'passagem_sem_altura').map((p: any) => p.id);
    const est = await pool.query(`select id::text, props->'estruturas' as e from data_features where id = any($1::bigint[])`, [ids]);
    const overs = new Map<string, Set<number>>(est.rows.map((x: any) => [x.id, new Set((x.e ?? []).map((o: any) => o.way_id))]));
    const ps = lay.data.passagens.filter((p: any) => p.kind === 'passagem_sem_altura');
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = overs.get(ps[i].id)!, b = overs.get(ps[j].id)!;
        if (![...a].some((w) => b.has(w))) continue;
        const d = turf.distance(turf.point([ps[i].lon, ps[i].lat]), turf.point([ps[j].lon, ps[j].lat]), { units: 'meters' });
        expect(d, `${ps[i].name} / ${ps[j].name}`).toBeGreaterThanOrEqual(30);
      }
    }
    expect(overs.size).toBe(ids.length);
    const w = r.body.warnings.find((x: any) => x.code === 'height_unknown_crossings');
    expect(w?.severity).toBe('info');
    expect(w?.message).toMatch(/reporte/);
    expect(lay.summary.length).toBeGreaterThan(0);
    // nada nesta camada bloqueia
    expect(r.body.avoided.filter((a: any) => a.layer === 'lacunas_osm')).toEqual([]);
    reportedPassage = lay.data.passagens[0];
  });

  it('VUC de 3,20 m: sem aviso (contagem só nos dados)', async () => {
    const r = await route({ origin: SALIM_S, destination: SALIM_N, vehicle: { preset: 'vuc', is_vuc: true }, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.warnings.find((x: any) => x.code === 'height_unknown_crossings')).toBeUndefined();
    expect(r.body.layers.lacunas_osm.summary ?? []).toEqual([]);
    expect(r.body.layers.lacunas_osm.data.veiculo_alto).toBe(false);
  });

  it('passagem com altura reportada por motorista sai da contagem de desconhecidas', async () => {
    expect(reportedPassage).not.toBeNull();
    const before = await route({ origin: SALIM_S, destination: SALIM_N, vehicle: CARRETA, departure_at: DEP });
    const created = await post('/api/reports', { type: 'low_clearance', geometry: { type: 'Point', coordinates: [reportedPassage!.lon, reportedPassage!.lat] },
      value_num: 5.5, note: 'teste lacunas_osm', device_id: DEVICE });
    expect(created.status).toBe(201);
    const after = await route({ origin: SALIM_S, destination: SALIM_N, vehicle: CARRETA, departure_at: DEP });
    expect(after.status).toBe(200);
    const c0 = before.body.layers.lacunas_osm.data.contagem, c1 = after.body.layers.lacunas_osm.data.contagem;
    expect(c1.reportadas).toBeGreaterThanOrEqual(1);
    expect(c1.desconhecidas).toBeLessThan(c0.desconhecidas);
  });

  it('passagem sob o Rodoanel com limitador de 4,3 m no nó NÃO é lacuna (altura conhecida)', async () => {
    const r = await route({ origin: EAST, destination: WEST, vehicle: TRUCK, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(minDistM(r.body, NODE)).toBeLessThan(5);
    const names = r.body.layers.lacunas_osm.data.passagens.map((p: any) => p.name);
    expect(names.filter((n: string) => /Humberto de Campos/.test(n))).toEqual([]);
  });

  it('túnel curto: a rota que o percorre conta; a rua que cruza por cima não conta (Av. Santos Dumont, 45 m)', async () => {
    const t = await pool.query(`select id::text, ST_AsGeoJSON(geom)::json as g from data_features
                                 where layer_id = 'lacunas_osm' and kind = 'tunel_sem_altura' and (props->>'via_id')::bigint = $1`, [SHORT_TUNNEL.via_id]);
    expect(t.rows.length, 'rode o importador osm_lacunas').toBe(1);
    const tunnel = t.rows[0];
    expect(turf.length(turf.lineString(tunnel.g.coordinates), { units: 'meters' })).toBeLessThan(60);
    const through = await route({ ...SHORT_TUNNEL.through, vehicle: TRUCK, departure_at: DEP });
    expect(through.status, JSON.stringify(through.body)).toBe(200);
    expect(through.body.layers.lacunas_osm.data.passagens.map((p: any) => p.id)).toContain(tunnel.id);
    const over = await route({ ...SHORT_TUNNEL.over, vehicle: TRUCK, departure_at: DEP });
    expect(over.status, JSON.stringify(over.body)).toBe(200);
    // a rota cruza a linha do túnel (por cima) ...
    expect(turf.lineIntersect(turf.lineString(over.body.geometry.coordinates), turf.lineString(tunnel.g.coordinates)).features.length).toBeGreaterThan(0);
    // ... e o túnel não entra na contagem
    expect(over.body.layers.lacunas_osm.data.passagens.map((p: any) => p.id)).not.toContain(tunnel.id);
  });

  it('features() devolve a fila de coleta com pedido de reporte', async () => {
    const bbox = [-46.585, -23.58, -46.565, -23.535].join(',');
    const fc = await get(`/api/layers/lacunas_osm/features?bbox=${bbox}&zoom=15`);
    expect(fc.status).toBe(200);
    const p = fc.body.features.find((f: any) => f.properties.tipo === 'passagem sem altura no mapa');
    expect(p.geometry.type).toBe('Point');
    expect(p.properties.pedido).toMatch(/Informe a altura/);
    expect(p.properties.link).toMatch(/^https:\/\/www\.openstreetmap\.org\/way\//);
    const z11 = await get(`/api/layers/lacunas_osm/features?bbox=${bbox}&zoom=11`);
    expect(z11.body.features).toEqual([]);
  });

  it('features() aceita zoom fracionário (antes: HTTP 500 "invalid input syntax for type integer")', async () => {
    const bbox = [-46.585, -23.58, -46.565, -23.535].join(',');
    const z145 = await get(`/api/layers/lacunas_osm/features?bbox=${bbox}&zoom=14.5`);
    expect(z145.status, JSON.stringify(z145.body).slice(0, 300)).toBe(200);
    expect(z145.body.features.length).toBeGreaterThan(0);
    // valores > 7 m (maxheight_suspeito) só a partir do zoom 14: Av. Vereador José Diniz (7,5 m)
    const jd = [-46.6816, -23.6239, -46.6756, -23.6179].join(',');
    const susp = (fc: any) => fc.features.filter((f: any) => f.properties.tipo === 'altura suspeita no mapa').length;
    const a = await get(`/api/layers/lacunas_osm/features?bbox=${jd}&zoom=13.5`);
    const b = await get(`/api/layers/lacunas_osm/features?bbox=${jd}&zoom=14.5`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(susp(a.body)).toBe(0);
    expect(susp(b.body)).toBeGreaterThan(0);
    expect((await get(`/api/layers/lacunas_osm/features?bbox=${bbox}&zoom=11.9`)).body.features).toEqual([]);
  });

  it('/api/layers e /api/sources registram as fontes e a licença ODbL', async () => {
    const l = await get('/api/layers');
    const ids = l.body.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['altura_osm', 'lacunas_osm']));
    const alt = l.body.find((x: any) => x.id === 'altura_osm');
    expect(alt.affects_route).toBe(true);
    expect(l.body.find((x: any) => x.id === 'lacunas_osm').affects_route).toBe(false);
    const s = await get('/api/sources');
    const runs = s.body.filter((x: any) => ['altura_osm', 'lacunas_osm'].includes(x.layer_id) && x.source === 'osm');
    expect(runs.length).toBe(2);
    for (const run of runs) expect(run.license).toMatch(/ODbL/);
  });
});
