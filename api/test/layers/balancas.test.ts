import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, route, waitForStack } from '../helpers.js';
import { directionVerdict } from '../../src/layers/balancas.layer.js';

/**
 * Camada "balancas" contra a API local (API_URL).
 * Lapa → Jundiaí passa pela Bandeirantes (PGF SP-348 km 40, sentido norte/interior) ou pela Anhanguera (PGF SP-330 km 37,
 * sentido norte). Na volta, o posto do sentido interior não pode aparecer.
 */
const LAPA = { lat: -23.5205, lon: -46.7045 };
const JUNDIAI = { lat: -23.1857, lon: -46.8978 };
const WEEKDAY = '2026-10-14T10:00';

describe('balanças: Lapa ⇄ Jundiaí', () => {
  let ida: any, volta: any;
  beforeAll(async () => {
    await waitForStack();
    const [a, b] = await Promise.all([
      route({ origin: LAPA, destination: JUNDIAI, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY }),
      route({ origin: JUNDIAI, destination: LAPA, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY }),
    ]);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    ida = a.body; volta = b.body;
  });

  it('lista a balança fixa do sentido interior na ida', () => {
    const list = ida.layers.balancas.data.balancas;
    const fixas = list.filter((b: any) => b.tipo === 'fixa' && (b.rodovia === 'SP-348' || b.rodovia === 'SP-330'));
    expect(fixas.length, JSON.stringify(list)).toBeGreaterThanOrEqual(1);
    for (const b of fixas) expect(['sim', 'provavel']).toContain(b.no_sentido);
    expect(ida.warnings.some((w: any) => w.layer === 'balancas' && w.code === 'weigh_station')).toBe(true);
    expect(ida.layers.balancas.summary.join('\n')).toMatch(/CTB art\. 209/);
  });

  it('não lista na volta a balança que só fiscaliza o sentido interior', async () => {
    const idaIds = new Set(ida.layers.balancas.data.balancas.filter((b: any) => b.sentido === 'norte').map((b: any) => b.id));
    const voltaIds = volta.layers.balancas.data.balancas.map((b: any) => b.id);
    for (const id of voltaIds) expect(idaIds.has(id)).toBe(false);
    expect(volta.layers.balancas.data.sentido_oposto_omitidas).toBeGreaterThanOrEqual(1);
  });

  it('nunca sugere desvio de balança (sem bloqueio, sem alternativa)', () => {
    for (const b of [ida, volta]) {
      expect(b.avoided.filter((a: any) => a.layer === 'balancas')).toEqual([]);
      const textos = [...b.layers.balancas.summary, ...b.warnings.filter((w: any) => w.layer === 'balancas').map((w: any) => w.message)].join('\n');
      expect(textos).not.toMatch(/desvi|evit|contorn|rota alternativa/i);
      expect(b.layers.balancas.data.alternativa).toBeUndefined();
    }
  });
});

describe('balanças: PPV federal (Régis Bittencourt, sentido crescente)', () => {
  it('PPV de Itapecerica da Serra aparece indo para o Paraná e não na volta', async () => {
    await waitForStack();
    const ppv = await pool.query(`select id::text from data_features where layer_id = 'balancas' and source = 'antt' and props->>'rodovia' = 'BR-116' and (props->>'km')::float between 296 and 297`);
    expect(ppv.rows.length).toBe(1);
    const id = ppv.rows[0].id;
    const SP = { lat: -23.62, lon: -46.78 }, JUQUITIBA = { lat: -23.93, lon: -47.07 };
    const [sul, norte] = await Promise.all([
      route({ origin: SP, destination: JUQUITIBA, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY }),
      route({ origin: JUQUITIBA, destination: SP, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY }),
    ]);
    expect(sul.status).toBe(200);
    expect(norte.status).toBe(200);
    expect(sul.body.layers.balancas.data.balancas.map((b: any) => b.id)).toContain(id);
    expect(norte.body.layers.balancas.data.balancas.map((b: any) => b.id)).not.toContain(id);
  });
});

describe('balanças: par norte/sul no mesmo km (SP-332 km 44,5, DER-SP)', () => {
  // Os dois postos ficam a ~34 m um do outro; ali a via corre a ~229° no sentido NORTE (nominal) da rodovia.
  const A = { lat: -23.3217, lon: -46.7266 }, B = { lat: -23.24, lon: -46.82 }; // A -> B = rumo a Jundiaí (sentido norte)
  let ids: Record<string, string>;
  beforeAll(async () => {
    await waitForStack();
    const r = await pool.query(`select id::text, props->>'sentido' s from data_features where layer_id = 'balancas' and source = 'der-sp'
      and props->>'rodovia' = 'SP-332' and (props->>'km')::float = 44.5`);
    ids = Object.fromEntries(r.rows.map((x: any) => [x.s, x.id]));
    expect(Object.keys(ids).sort()).toEqual(['norte', 'sul']);
  });

  it('sentido norte: lista a balança "norte" (não a omite pelo rumo local)', async () => {
    const r = await route({ origin: A, destination: B, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY });
    expect(r.status).toBe(200);
    const list = r.body.layers.balancas.data.balancas;
    const norte = list.find((b: any) => b.id === ids.norte);
    expect(norte, JSON.stringify(list)).toBeTruthy();
    expect(['sim', 'provavel']).toContain(norte.no_sentido);
    expect(norte.sentido).toBe('norte');
    const sul = list.find((b: any) => b.id === ids.sul);
    if (sul) expect(sul.no_sentido).toBe('incerto');
  });

  it('sentido sul: não junta as duas balanças e não copia o sentido de uma para a outra', async () => {
    const r = await route({ origin: B, destination: A, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY });
    expect(r.status).toBe(200);
    const list = r.body.layers.balancas.data.balancas;
    const sul = list.find((b: any) => b.id === ids.sul);
    expect(sul, JSON.stringify(list)).toBeTruthy();
    expect(['sim', 'provavel']).toContain(sul.no_sentido);
    for (const b of list) {
      if (b.id === ids.sul || b.id === ids.norte) {
        expect(b.fontes).toEqual(['der-sp']);
        expect(b.nome).toContain(`(${b.sentido})`);
        expect(b.como).not.toMatch(b.sentido === 'sul' ? /"norte"/ : /"sul"/);
      }
    }
    const norte = list.find((b: any) => b.id === ids.norte);
    if (norte) expect(norte.no_sentido).toBe('incerto');
  });
});

describe('balanças: mesma balança em duas fontes (Castello Branco, SP-280)', () => {
  // ARTESP (posição exata) e DER-SP (rodovia + km, posição aproximada) publicam os mesmos PGF: km 74 e km 95 (leste).
  const CAPITAL = { lat: -23.52, lon: -46.78 }, INTERIOR = { lat: -23.30, lon: -47.60 };
  let der74: string, der95: string, art95: string;
  beforeAll(async () => {
    await waitForStack();
    const q = async (src: string, km: number) => (await pool.query(`select id::text from data_features where layer_id = 'balancas'
      and source = $1 and props->>'rodovia' = 'SP-280' and abs((props->>'km')::float - $2) < 0.01`, [src, km])).rows.map((r: any) => r.id);
    [der74] = await q('der-sp', 74); [der95] = await q('der-sp', 95.2); [art95] = await q('artesp', 95);
    expect(der74 && der95 && art95).toBeTruthy();
  });

  it('sentido interior: a cópia DER-SP do posto do outro sentido sai junto com ele (não vira "não confirmado")', async () => {
    const r = await route({ origin: CAPITAL, destination: INTERIOR, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY });
    expect(r.status).toBe(200);
    const d = r.body.layers.balancas.data;
    const ids = d.balancas.map((b: any) => b.id);
    expect(ids).not.toContain(der74);
    expect(ids).not.toContain(der95);
    const omit = d.omitidas_outro_sentido.find((o: any) => /km 74/.test(o.nome));
    expect(omit, JSON.stringify(d.omitidas_outro_sentido)).toBeTruthy();
    expect(omit.fontes).toEqual(expect.arrayContaining(['artesp', 'der-sp']));
    expect(d.sentido_oposto_omitidas).toBe(d.omitidas_outro_sentido.length);
  });

  it('sentido capital: ARTESP km 95 e DER-SP km 95,2 viram uma balança só, com a posição exata', async () => {
    const r = await route({ origin: INTERIOR, destination: CAPITAL, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY });
    expect(r.status).toBe(200);
    const list = r.body.layers.balancas.data.balancas;
    const km95 = list.filter((b: any) => b.id === art95 || b.id === der95);
    expect(km95.length, JSON.stringify(list)).toBe(1);
    expect(km95[0].id).toBe(art95);
    expect(km95[0].fontes).toEqual(expect.arrayContaining(['artesp', 'der-sp']));
    expect(km95[0].no_sentido).toBe('provavel');
    // o resumo separa as confirmadas das não confirmadas
    const s0 = r.body.layers.balancas.summary[0];
    const unsure = list.filter((b: any) => b.no_sentido === 'incerto').length;
    expect(s0).toMatch(new RegExp(`^${list.length - unsure} balança\\(s\\) no sentido da rota`));
  });
});

describe('regra de sentido (unitário)', () => {
  it('lado da via decide com posição exata; rótulo sozinho nunca omite', () => {
    expect(directionVerdict('norte', 330, -1, true, 40).v).toBe('provavel');    // à direita, rótulo concorda
    expect(directionVerdict('norte', 180, -1, true, 40).v).toBe('provavel');    // à direita; rótulo contra é ignorado
    expect(directionVerdict('norte', 180, -1, true, 40).como).toMatch(/ignorado/);
    expect(directionVerdict('norte', 0, 1, true, 40).v).toBe('nao');            // à esquerda: outro sentido, mesmo com rótulo a favor
    expect(directionVerdict('sul', 330, 1, false, 5).v).toBe('incerto');        // só o rótulo contra: lista como não confirmado
    expect(directionVerdict('norte', 315, 1, true, 7.7).v).toBe('provavel');    // colado na linha (< 12 m): vale o rótulo a favor
    expect(directionVerdict('crescente', 200, -1, true, 40).v).toBe('provavel');
    expect(directionVerdict('crescente', 200, 1, true, 40).v).toBe('nao');
    expect(directionVerdict('crescente', 200, 1, false, 40).v).toBe('incerto'); // posição aproximada
    expect(directionVerdict('crescente+decrescente', 0, 1, true, 40).v).toBe('sim');
    expect(directionVerdict(null, 0, 1, true, 5).v).toBe('incerto');
  });
});

afterAll(async () => { await pool.end(); });
