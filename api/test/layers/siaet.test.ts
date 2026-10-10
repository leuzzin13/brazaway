import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, minDistM, pool, route, waitForStack } from '../helpers.js';
import { aetDims, naoFederal, violations, type SiaetProps } from '../../src/layers/federal_restricoes.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';

/**
 * Frente "siaet": camadas federal_restricoes (SIAET/DNIT) e pontes_federais (DNITGeo + PROARTE + ANTT + alertas DNIT).
 * Precisa dos seeds federal_restricoes__siaet.sql e pontes_federais__*.sql (ref. 10/2026) e da migration 0112_siaet.sql.
 *
 * Caso principal (real, fora de SP): BR-365/MG km 138,3–158,0 (PNV 365BMG0063, Barra do Guaicuí → Pirapora),
 * restrição TEMPORÁRIA do SIAET out/2026 com PBT máx. 23 t e comprimento máx. 15 m. O segmento tem um único OAE,
 * a Ponte sobre o Rio das Velhas (nota técnica 1 no PROARTE); o DNIT publicou alerta de "novos limites de peso e
 * dimensão" para ela em 30/07/2026.
 */
const SEG = 'siaet:temporaria:365BMG0063:138.3';
const O = { lat: -17.36, lon: -44.95 }; // Pirapora, a oeste do fim do segmento (ENTR BR-365/496)
const D = { lat: -17.19, lon: -44.8 };  // a leste de Barra do Guaicuí (início do segmento)
const DEP = '2026-10-13T10:00';
const CARRETA = { preset: 'carreta' };  // carreta_5e: 41,5 t, 19,30 m
const VUC = { preset: 'vuc', is_vuc: true }; // 9 t, 7,2 m
const TEST_REVIEWER = 'teste-siaet';
const ALERTA_DIAS = 120; // pontes_federais.layer.ts: alerta pendente só aparece nos 120 dias após a publicação

const ids = (r: any) => (r.avoided ?? []).map((a: any) => a.id);

/**
 * Rota com as restrições do SIAET já casadas: o 1º cálculo de um trecho ainda não cacheado pode estourar o tempo de
 * casamento (aviso siaet_nao_aplicado "em preparação"); o contrato da camada é recalcular em instantes.
 */
async function routeSettled(body: Record<string, unknown>, tries = 5): Promise<{ status: number; body: any }> {
  let r = await route(body);
  for (let i = 1; i < tries && r.status === 200; i++) {
    const pend = (r.body.warnings ?? []).some((w: any) => w.code === 'siaet_nao_aplicado' && /prepara/.test(w.message));
    if (!pend) break;
    await new Promise((ok) => setTimeout(ok, 5000));
    r = await route(body);
  }
  return r;
}
const codes = (r: any, layer?: string) => (r.warnings ?? []).filter((w: any) => !layer || w.layer === layer).map((w: any) => w.code);
const veh = (input: Record<string, unknown>) => resolveVehicle(input as Parameters<typeof resolveVehicle>[0]);

async function siaet(sourceId: string): Promise<SiaetProps> {
  const r = await pool.query(`select props from data_features where layer_id = 'federal_restricoes' and source_id = $1`, [sourceId]);
  expect(r.rowCount, `${sourceId} ausente: rode o importador siaet_restricoes (seed ref. 10/2026)`).toBe(1);
  return r.rows[0].props as SiaetProps;
}

let ponte: { lat: number; lon: number };

describe('SIAET/DNIT — regras (dados reais do seed, sem rota)', () => {
  it('limites sem AET por classe (Res. CONTRAN 882/2021 arts. 4º e 18)', () => {
    expect([...aetDims(veh({ preset: 'carreta' }))]).toEqual([]);           // 19,30 m é o limite do cavalo + SR
    expect([...aetDims(veh({ preset: 'bitrem' }))]).toEqual([]);            // 57 t, 19,80 m
    expect([...aetDims(veh({ preset: 'rodotrem' }))].sort()).toEqual(['comprimento', 'peso']);
    expect([...aetDims(veh({ preset: 'truck', length_m: 15 }))]).toEqual(['comprimento']); // não articulado: 14 m
    expect([...aetDims(veh({ preset: 'toco', width_m: 3 }))]).toEqual(['largura']);
  });

  it('jurisdição: convênio de administração continua federal (Res. DNIT 11/2022 art. 1º parágrafo único)', () => {
    expect(naoFederal('Estadual')).toBe(true);
    expect(naoFederal('Concessão Estadual')).toBe(true);
    expect(naoFederal('DER')).toBe(true);
    expect(naoFederal('Convênio Adm.Federal/Estadual')).toBe(false);
    expect(naoFederal('Convênio Adm.Federal/Municipal')).toBe(false);
    expect(naoFederal('Concessão Federal')).toBe(false);
    expect(naoFederal(null)).toBe(false);
  });

  it('PBT 0 na temporária de via federal = trecho impedido para qualquer veículo de carga', async () => {
    // Rio Tocantins (BR-235/TO, Pedro Afonso): interditada a todos desde 19/06/2026; Rio Piquiri (BR-272/PR): só balsa
    for (const sid of ['temporaria:235BTO0495:163.6', 'temporaria:272BPR0560:527.0', 'temporaria:259BES0015:15.3']) {
      const p = await siaet(sid);
      for (const v of [veh({ preset: 'utilitario' }), veh(VUC), veh(CARRETA)]) {
        const vs = violations(p, v);
        expect(vs.find((x) => x.dim === 'peso'), `${sid} / ${v.preset_id}`).toMatchObject({ interdicao: true, bloqueia: true, limite: 0 });
      }
    }
    // convênio federal/estadual (BR-210/RR) segue a mesma regra
    const conv = await siaet('temporaria:210BRR0400:56.3');
    expect(violations(conv, veh(CARRETA)).some((x) => x.interdicao)).toBe(true);
  });

  it('0 em altura/largura/comprimento = AET não autorizada naquela grandeza (só barra quem precisa de AET)', async () => {
    // BR-495/RJ (Teresópolis): largura 0 com PBT 60 t e altura 4,0 m publicados
    const p = await siaet('temporaria:495BRJ0010:0.0');
    expect(violations(p, veh({ preset: 'toco' }))).toEqual([]); // 4,0 m e 2,6 m: passa
    const largo = violations(p, veh({ preset: 'toco', width_m: 3 }));
    expect(largo).toEqual([expect.objectContaining({ dim: 'largura', aet: true, bloqueia: true })]);
    expect(violations(p, veh({ preset: 'truck' })).map((x) => x.dim)).toEqual(['altura']); // 4,2 m > 4,0 m
  });

  it('0 fora da jurisdição federal não vale como limite (Marginal Tietê, 116BSP2550)', async () => {
    const p = await siaet('temporaria:116BSP2550:230.6');
    expect(p.administracao).toBe('Estadual');
    expect(violations(p, veh(CARRETA))).toEqual([]);
    const rodo = violations(p, veh({ preset: 'rodotrem' }));
    expect(rodo.length).toBeGreaterThan(0);
    expect(rodo.every((x) => !x.bloqueia && x.motivo === 'aet_fora_jurisdicao')).toBe(true);
  });

  it('comprimento da definitiva só avisa quem não precisa de AET por comprimento', async () => {
    const p = await siaet('definitiva:459BSP0170:0.0'); // BR-459/SP, comprimento 15 m
    const c = violations(p, veh(CARRETA)).find((x) => x.dim === 'comprimento');
    expect(c).toMatchObject({ bloqueia: false, motivo: 'definitiva_comprimento' });
    const r = violations(p, veh({ preset: 'rodotrem' })).find((x) => x.dim === 'comprimento');
    expect(r?.bloqueia).toBe(true);
  });
});

describe('SIAET/DNIT — restrições federais e pontes na rota', () => {
  beforeAll(async () => {
    await waitForStack();
    const r = await pool.query(`select props->'oae_unica' as o from data_features where layer_id = 'federal_restricoes' and source_id = $1`, [SEG.slice(6)]);
    expect(r.rowCount, 'seed federal_restricoes__siaet.sql ausente: rode o importador siaet_restricoes').toBe(1);
    ponte = { lat: r.rows[0].o.lat, lon: r.rows[0].o.lon };
    await pool.query(`delete from dnit_alertas_curadoria where revisado_por = $1`, [TEST_REVIEWER]);
  });

  afterAll(async () => {
    await pool.query(`delete from dnit_alertas_curadoria where revisado_por = $1`, [TEST_REVIEWER]).catch(() => {});
    await pool.end();
  });

  it('catálogo: federal_restricoes afeta a rota; pontes_federais só anota', async () => {
    const r = await get('/api/layers');
    expect(r.status).toBe(200);
    const fr = r.body.find((l: any) => l.id === 'federal_restricoes');
    const pf = r.body.find((l: any) => l.id === 'pontes_federais');
    expect(fr?.affects_route).toBe(true);
    expect(pf?.affects_route).toBe(false);
    expect(pf?.annotates_route).toBe(true);
    expect(fr.runs.map((x: any) => x.source)).toContain('siaet');
    expect(pf.runs.map((x: any) => x.source)).toEqual(expect.arrayContaining(['dnit', 'antt']));
    expect(fr.sources.every((s: any) => s.license)).toBe(true);
  });

  it('carreta 41,5 t desvia do trecho de PBT 23 t da BR-365/MG', async () => {
    const r = await routeSettled({ origin: O, destination: D, vehicle: CARRETA, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
    expect(ids(r.body)).toContain(SEG);
    const item = r.body.avoided.find((a: any) => a.id === SEG);
    expect(item.layer).toBe('federal_restricoes');
    expect(item.rule).toMatch(/PBT máx\. 23 t/);
    const d = minDistM(r.body, ponte);
    expect(d, `carreta passou a ${d.toFixed(0)} m da ponte`).toBeGreaterThan(200);
    expect(codes(r.body)).not.toContain('uses_restricted_way');
    expect(r.body.layers.federal_restricoes.summary.join(' ')).toMatch(/Evitado/);
  });

  it('VUC passa pelo trecho (9 t ≤ 23 t, 7,2 m ≤ 15 m) e só recebe informação', async () => {
    const r = await routeSettled({ origin: O, destination: D, vehicle: VUC, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(ids(r.body)).not.toContain(SEG);
    const d = minDistM(r.body, ponte);
    expect(d, `VUC deveria cruzar a ponte (dist ${d.toFixed(0)} m)`).toBeLessThan(30);
    const t = r.body.layers.federal_restricoes.data.trechos.find((x: any) => x.id === SEG);
    expect(t?.peso_t).toBe(23);
    expect(t?.viola).toEqual([]);
    expect((r.body.warnings ?? []).filter((w: any) => w.layer === 'federal_restricoes' && w.severity === 'danger')).toEqual([]);
  });

  it('só o PBT excede e o segmento tem 1 OAE: desvia só da ponte OSM', async () => {
    const r = await routeSettled({ origin: O, destination: D, vehicle: { preset: 'truck', weight_t: 30 }, departure_at: DEP });
    expect(r.status).toBe(200);
    const item = r.body.avoided.find((a: any) => a.id === SEG);
    expect(item, JSON.stringify(r.body.avoided)).toBeTruthy();
    expect(item.name).toMatch(/Rio das Velhas/);
    expect(item.note).toMatch(/só na ponte/);
    expect(minDistM(r.body, ponte)).toBeGreaterThan(200);
  });

  it('nota técnica 1–2 vira aviso "warn" com pedido de reporte, nunca bloqueio', async () => {
    const r = await routeSettled({ origin: O, destination: D, vehicle: VUC, departure_at: DEP });
    expect(r.status).toBe(200);
    const w = r.body.warnings.find((x: any) => x.code === 'ponte_nota_baixa' && /Rio das Velhas/.test(x.message));
    expect(w?.severity).toBe('warn');
    expect(w.message).toMatch(/reporte/);
    expect(r.body.layers.pontes_federais.data.nota_baixa.some((x: any) => x.nota === 1 && /Rio das Velhas/.test(x.nome))).toBe(true);
    const rep = r.body.layers.pontes_federais.data.reportar;
    expect(rep.some((x: any) => x.type === 'weight_limit' && Math.abs(x.lat - ponte.lat) < 0.002 && Math.abs(x.lon - ponte.lon) < 0.002)).toBe(true);
    expect(r.body.avoided.filter((a: any) => a.layer === 'pontes_federais')).toEqual([]);
  });

  it('alerta do DNIT pendente de revisão é só informação (caminhão 23 t ainda cruza a ponte)', async () => {
    const r = await routeSettled({ origin: O, destination: D, vehicle: { preset: 'truck' }, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(ids(r.body).filter((x: string) => x.startsWith('alerta:'))).toEqual([]);
    expect(ids(r.body)).not.toContain(SEG); // 23 t não excede 23 t
    expect(minDistM(r.body, ponte)).toBeLessThan(30);
    expect(codes(r.body, 'federal_restricoes')).toContain('siaet_folga_minima'); // exatamente no limite
    const a = await pool.query(
      `select (valid_from > now() - make_interval(days => $1)) as recente from data_features
        where layer_id = 'pontes_federais' and source = 'dnit-alertas' and props->>'br' = '365' and props->>'oae_nome' ilike '%velhas%'
        order by valid_from desc limit 1`, [ALERTA_DIAS]);
    if (a.rows[0]?.recente) expect(codes(r.body, 'pontes_federais')).toContain('alerta_dnit_pendente');
  });

  it('alerta aprovado na curadoria (limite 10 t) passa a valer na rota', async () => {
    const a = await pool.query(
      `select source_id from data_features where layer_id = 'pontes_federais' and source = 'dnit-alertas'
         and props->>'br' = '365' and props->>'oae_nome' ilike '%velhas%' order by valid_from desc limit 1`);
    expect(a.rowCount, 'seed pontes_federais__dnit-alertas.sql sem o alerta da BR-365/MG').toBe(1);
    const sid = a.rows[0].source_id;
    await pool.query(
      `insert into dnit_alertas_curadoria (source_id, status, acao, peso_max_t, revisado_por, nota)
       values ($1, 'aprovado', 'limite_peso', 10, $2, 'teste automatizado') on conflict (source_id) do nothing`, [sid, TEST_REVIEWER]);
    try {
      const r = await routeSettled({ origin: O, destination: D, vehicle: { preset: 'truck' }, departure_at: DEP });
      expect(r.status).toBe(200);
      expect(ids(r.body)).toContain(`alerta:${sid}`);
      expect(minDistM(r.body, ponte)).toBeGreaterThan(200);
      expect(r.body.layers.federal_restricoes.summary.join(' ')).toMatch(/Evitado.*Rio das Velhas/);
      const vuc = await routeSettled({ origin: O, destination: D, vehicle: VUC, departure_at: DEP });
      expect(ids(vuc.body)).not.toContain(`alerta:${sid}`); // 9 t < 10 t
    } finally {
      await pool.query(`delete from dnit_alertas_curadoria where source_id = $1 and revisado_por = $2`, [sid, TEST_REVIEWER]);
    }
  });

  it('PBT 0 (interdição): BR-259/ES km 15,3 (ponte do Córrego Treviso Grande, interditada desde 18/08/2026)', async () => {
    const seg = 'siaet:temporaria:259BES0015:15.3';
    const A = { lat: -19.66, lon: -40.40 }, B = { lat: -19.53, lon: -40.63 }; // João Neiva -> Colatina
    for (const vehicle of [{ preset: 'truck' }, { preset: 'utilitario' }]) {
      const r = await routeSettled({ origin: A, destination: B, vehicle, departure_at: DEP });
      expect(r.status).toBe(200);
      expect(ids(r.body), JSON.stringify(vehicle)).toContain(seg);
      expect(r.body.avoided.find((x: any) => x.id === seg).rule).toMatch(/impedido/);
      expect(codes(r.body)).not.toContain('uses_restricted_way');
    }
  });

  it('0 fora da jurisdição federal (Marginal Tietê): carreta passa com informação; rodotrem recebe aviso de AET', async () => {
    const seg = 'siaet:temporaria:116BSP2550:230.6';
    const A = { lat: -23.515, lon: -46.6 }, B = { lat: -23.52, lon: -46.7 };
    const c = await routeSettled({ origin: A, destination: B, vehicle: CARRETA, departure_at: '2026-10-13T23:00' });
    expect(c.status).toBe(200);
    expect(ids(c.body)).not.toContain(seg);
    const info = c.body.warnings.find((w: any) => w.code === 'siaet_aet_bloqueada' && w.id === seg);
    expect(info?.severity).toBe('info');
    const r = await routeSettled({ origin: A, destination: B, vehicle: { preset: 'rodotrem' }, departure_at: '2026-10-13T23:00' });
    expect(r.status).toBe(200);
    expect(ids(r.body)).not.toContain(seg);
    expect(codes(r.body, 'federal_restricoes')).toContain('siaet_aet_outro_orgao');
  });

  it('limite por sentido: altura 4,0 m só na pista 1 (crescente) da BR-101/RJ (Av. Brasil)', async () => {
    const seg = 'siaet:definitiva:101BRJ3210:350.4';
    const A = { lat: -22.815, lon: -43.3 }, B = { lat: -22.835, lon: -43.365 };
    const ida = await routeSettled({ origin: A, destination: B, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T22:00' }); // 4,20 m
    expect(ida.status).toBe(200);
    expect(ids(ida.body)).toContain(seg);
    expect(ida.body.avoided.find((x: any) => x.id === seg).name).toMatch(/sentido crescente/);
    const volta = await routeSettled({ origin: B, destination: A, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T22:00' }); // pista 2: 4,9 m
    expect(volta.status).toBe(200);
    expect(ids(volta.body)).not.toContain(seg);
    const t = volta.body.layers.federal_restricoes.data.trechos.find((x: any) => x.id === seg);
    expect(t?.sentidos).toEqual(['decrescente']);
    expect(t?.altura_m).toBe(4.9);
    expect((volta.body.warnings ?? []).filter((w: any) => w.layer === 'federal_restricoes' && w.severity === 'danger')).toEqual([]);
  });

  it('features para o mapa: trecho SIAET e ponte com nota', async () => {
    const bbox = '-44.95,-17.40,-44.70,-17.10';
    const fr = await get(`/api/layers/federal_restricoes/features?bbox=${bbox}&zoom=11`);
    expect(fr.status).toBe(200);
    const f = fr.body.features.find((x: any) => x.properties.item_id === SEG);
    expect(f?.properties['PBT máx.']).toBe('23 t');
    expect(['LineString', 'MultiLineString']).toContain(f.geometry.type);
    const pf = await get(`/api/layers/pontes_federais/features?bbox=${bbox}&zoom=12`);
    expect(pf.status).toBe(200);
    const p = pf.body.features.find((x: any) => x.properties.name === 'Ponte sobre o Rio das Velhas' && x.properties.source === 'dnit');
    expect(p?.properties['Nota DNIT']).toBe('1 (crítica)');
    const alerta = pf.body.features.find((x: any) => x.properties.source === 'dnit-alertas');
    if (alerta) {
      expect(alerta.geometry.type).toBe('Point');
      expect(alerta.properties['Situação']).toMatch(/pendente de revisão/);
    }
  });
});
