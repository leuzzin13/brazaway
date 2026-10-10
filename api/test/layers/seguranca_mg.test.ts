import { beforeAll, describe, expect, it } from 'vitest';
import { CARRETA, get, pool, route, waitForStack } from '../helpers.js';

// Frente "seguranca_mg": SEJUSP-MG/REDS como fonte da camada acidentes (docs/layers/seguranca_mg.md).
// 2026-10-13 é terça-feira.
const ANEL_AMAZONAS = { lat: -19.9445, lon: -44.0077 };     // Anel Rodoviário x Av. Amazonas (Gameleira)
const ANEL_CRISTIANO = { lat: -19.8577, lon: -43.9213 };    // Anel Rodoviário x Av. Cristiano Machado (São Paulo/Ipiranga)
const BH_BBOX = '-44.10,-20.05,-43.85,-19.80';
const BH_LARGO = '-47.4,-21.8,-40.4,-18.1';                   // tela larga em torno de BH (zoom ~9)
const MAX_FEATURES = 6000;
const FONTE = 'SEJUSP-MG (REDS)';

const layerWarnings = (r: any, layer: string) => r.warnings.filter((w: any) => w.layer === layer);

describe('Acidentes em MG: SEJUSP-MG (REDS)', () => {
  beforeAll(async () => { await waitForStack(); });

  it('catálogo: a camada acidentes traz a SEJUSP-MG com licença e a carga registrada', async () => {
    const r = await get('/api/layers');
    expect(r.status).toBe(200);
    const ac = r.body.find((l: any) => l.id === 'acidentes');
    expect(ac, 'camada não carregada').toBeTruthy();
    expect(ac.affects_route).toBe(false);                                // informativa: não muda a rota
    const src = ac.sources.find((s: any) => /SEJUSP-MG/.test(s.name));
    expect(src, 'fonte SEJUSP-MG em meta.sources').toBeTruthy();
    expect(src.license).toMatch(/Decreto MG 48\.383\/2022, art\. 22/);
    expect(src.url).toMatch(/drive\.google\.com/);
    const run = ac.runs.find((x: any) => x.source === 'sejusp-mg');
    expect(run, 'carga da sejusp-mg em data_layer_runs').toBeTruthy();
    expect(run.record_count).toBeGreaterThan(500);
    expect(run.license).toBe(src.license);                               // mesma redação no importador e na API
    // a PM grava parte do Anel como "BR 381"/"BR 040": no corredor do Anel, fora das células da PRF, ficam com o REDS;
    // idem nas BRs que a PRF não registra em MG (BR-494, BR-259...)
    const m = run.notes.match(/logradouro de BR mantidos: (\d+) como Anel Rodoviário e (\d+) em BR sem registro regular da PRF/);
    expect(m, run.notes).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(0);
    expect(Number(m[2])).toBeGreaterThan(0);
  });

  it('BR no REDS só onde a PRF não registra: nenhuma BR com pontos da PRF em MG tem ponto da SEJUSP-MG', async () => {
    const q = (source: string, extra: string) => pool.query<{ br: string; n: number }>(
      `select substring(props->>'via' from 'BR-[0-9]{3}') as br, count(*)::int as n from data_features
        where layer_id = 'acidentes' and source = $1 and props->>'via' ~ 'BR-[0-9]{3}' ${extra} group by 1`, [source]);
    const prf = new Set((await q('prf', `and props->>'via' like '%/MG'`)).rows.filter((r) => r.n >= 5).map((r) => r.br));
    expect(prf.has('BR-381')).toBe(true);
    const mg = (await q('sejusp-mg', '')).rows.map((r) => r.br);
    expect(mg.length).toBeGreaterThan(0);                                 // BR-494, BR-259... ficam com o REDS
    expect(mg.filter((br) => prf.has(br))).toEqual([]);
  });

  it('features numa tela larga em torno de BH: moderado só a partir do zoom 10, e o limite nunca corta alto/muito alto', async () => {
    const z9 = await get(`/api/layers/acidentes/features?bbox=${BH_LARGO}&zoom=9`);
    expect(z9.status).toBe(200);
    expect(z9.body.features.length).toBeGreaterThan(50);
    expect(z9.body.features.every((f: any) => f.properties.nivel !== 'moderado')).toBe(true);
    const z10 = await get(`/api/layers/acidentes/features?bbox=${BH_LARGO}&zoom=10`);
    expect(z10.status).toBe(200);
    const fs: any[] = z10.body.features;
    expect(fs.length).toBeLessThanOrEqual(MAX_FEATURES);
    expect(fs.some((f) => f.properties.nivel === 'moderado')).toBe(true);
    // o corte do limite só tira moderados: todos os alto/muito alto do zoom 9 continuam no zoom 10
    const graves = (xs: any[]) => xs.filter((f) => f.properties.nivel !== 'moderado').map((f) => f.id).sort();
    expect(graves(fs)).toEqual(graves(z9.body.features));
  });

  it('nomes de via legíveis: sem o código interno do REDS, sem tipo repetido, algarismos romanos e siglas em maiúsculas', async () => {
    const r = await pool.query<{ via: string }>(
      `select distinct props->>'via' as via from data_features
        where layer_id = 'acidentes' and source = 'sejusp-mg' and props->>'via' is not null`,
    );
    const vias = r.rows.map((x) => x.via);
    expect(vias.length).toBeGreaterThan(100);
    const ruins = vias.filter((v) =>
      /\b[A-Z][a-z]{2}\d{3,4}\b/.test(v)                          // código do REDS ('Crz0072', 'Udi3014')
      || /^(\S+) \1\b/.test(v)                                     // tipo repetido ('Rodovia Rodovia ...')
      || /\b(Ii|Iii|Iv|Xii|Xiii|Xv|Xxiii)\b/.test(v)                 // romano em caixa baixa ('Dom Pedro Ii')
      || /\b(Mgc|Mgt|Amg|Lmg|Mg)[- ]?\d/.test(v));                  // sigla estadual em caixa baixa ('Lmg-749')
    expect(ruins).toEqual([]);
  });

  it('features em BH: pontos agregados da SEJUSP-MG, sem registro individual e sem BR', async () => {
    const r = await get(`/api/layers/acidentes/features?bbox=${BH_BBOX}&zoom=12`);
    expect(r.status).toBe(200);
    const mg = r.body.features.filter((f: any) => f.properties.fonte === FONTE);
    expect(mg.length).toBeGreaterThan(50);
    for (const f of mg) {
      expect(f.geometry.type).toBe('Point');
      expect(f.properties.acidentes_caminhao).toBeGreaterThanOrEqual(3);   // mínimo por célula
      expect(f.properties.name ?? '').not.toMatch(/^BR-\d{3}/);            // em BH as BRs ficam com a PRF (BR no Anel vira o Anel)
      const keys = Object.keys(f.properties).join(' ').toLowerCase();
      expect(keys).not.toMatch(/ocorrencia|reds|data_fato|horario|latitude|placa/);
    }
    // o Anel Rodoviário (sem registro da PRF no trecho central) fica com o REDS
    expect(mg.some((f: any) => /Anel Rodoviário/.test(f.properties.name))).toBe(true);
  });

  it('rota pelo Anel Rodoviário de BH: resumo de acidentes com pontos da fonte REDS', async () => {
    const r = await route({ origin: ANEL_AMAZONAS, destination: ANEL_CRISTIANO, vehicle: CARRETA, departure_at: '2026-10-13T09:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.warnings.filter((w: any) => w.code === 'layer_error')).toEqual([]);

    const ac = r.body.layers.acidentes;
    expect(ac?.summary?.[0]).toMatch(/ponto\(s\) crítico\(s\) de acidente com caminhão/);
    expect(ac.summary.join('\n')).toMatch(/Fontes?: .*SEJUSP-MG \(REDS\)/);   // atribuição da fonte no resumo
    expect(ac.data.pontos).toBeGreaterThan(0);
    const trechos: any[] = ac.data.trechos;
    expect(trechos.some((t) => t.fontes.includes('sejusp-mg'))).toBe(true);
    expect(trechos.some((t) => t.fontes.includes('sejusp-mg') && /Anel Rodoviário/.test(t.name))).toBe(true);

    const wa = layerWarnings(r.body, 'acidentes');
    expect(wa.length).toBeGreaterThanOrEqual(1);
    expect(wa.length).toBeLessThanOrEqual(5);
    expect(wa.every((w: any) => w.code === 'accident_hotspot' && w.severity === 'warn')).toBe(true);
    expect(wa.map((w: any) => w.message).join('\n')).toMatch(/Anel Rodoviário, Belo Horizonte/);
  });
});
