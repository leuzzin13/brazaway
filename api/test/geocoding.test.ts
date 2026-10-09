/** Geocodificador próprio (CNEFE/GeoSampa/CEP + Photon validado). Precisa do CNEFE carregado
 *  (importers: cnefe_municipios, cnefe_enderecos, cep_ipea, geosampa_logradouro) — ver docs/layers/geocoding.md. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, pool } from './helpers';
import { parseAddress } from '../src/services/geocoder/parse.js';
import { getCanon } from '../src/services/geocoder/normalize.js';
import { getMunicipios } from '../src/services/geocoder/municipios.js';
import { CascadeGeocoder, PhotonGeocoder } from '../src/services/geocoder.js';
import { interpClusters, interpCnefe } from '../src/services/geocoder/cnefe.js';
import { distM } from '../src/services/geocoder/geo.js';
import { pool as apiPool } from '../src/db.js';

// 10 endereços logísticos da pesquisa (docs/research/enderecos_geocoding, teste_geocoders/casos.json).
// Verdade = ponto do CNEFE do estabelecimento (portaria coletada em campo pelo IBGE).
const CASOS: { nome: string; q: string; truth: [number, number] }[] = [
  { nome: 'CEAGESP', q: 'Avenida Doutor Gastão Vidigal, 1946, Vila Leopoldina, São Paulo', truth: [-23.534068, -46.73475] },
  { nome: 'GLP Cajamar 2', q: 'Avenida Doutor Antônio João Abdalla, 3333, Cajamar', truth: [-23.34779, -46.865647] },
  { nome: 'Correios Cajamar', q: 'Avenida Doutor Antônio João Abdalla, 2727, Cajamar', truth: [-23.345962, -46.86329] },
  { nome: 'Santos Brasil Tecon (s/n)', q: 'Avenida Santos Dumont, s/n, Guarujá', truth: [-23.963092, -46.288834] },
  { nome: 'Terminal Fassina Redex', q: 'Rodovia Cônego Domênico Rangoni, 3151, Guarujá', truth: [-23.949205, -46.27729] },
  { nome: 'Transbrasa', q: 'Rua Joaquim Távora, 500, Santos', truth: [-23.947828, -46.341723] },
  { nome: 'Correios CDD Cumbica', q: 'Avenida Santos Dumont, 1315, Guarulhos', truth: [-23.458817, -46.471361] },
  { nome: 'DHL Tamboré', q: 'Avenida Ceci, 7, Tamboré, Barueri', truth: [-23.493063, -46.809968] },
  { nome: 'CD Ipiranga', q: 'Rua Costa Aguiar, 1686, Ipiranga, São Paulo', truth: [-23.589029, -46.606135] },
  { nome: 'FedEx Macuco', q: 'Rua Doutor Manoel Tourinho, 261, Macuco, Santos', truth: [-23.953931, -46.318405] },
];
const SP = { lat: -23.55, lon: -46.63 };

async function geocode(q: string, near = SP, extra = '') {
  const r = await get(`/api/geocode?q=${encodeURIComponent(q)}&lat=${near.lat}&lon=${near.lon}${extra}`);
  expect(r.status).toBe(200);
  return r.body as any[];
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

let hasCnefe = false;
beforeAll(async () => {
  const r = await pool.query(`select count(*)::int n from addr_municipio where cod_mun = any($1) and n_enderecos > 0`,
    [[3550308, 3509205, 3518701, 3548500, 3518800, 3505708]]);
  hasCnefe = r.rows[0].n === 6;
  if (!hasCnefe) console.warn('CNEFE não carregado para os 6 municípios do teste: rode o importador cnefe_enderecos');
});
afterAll(async () => { await apiPool.end().catch(() => undefined); });

describe('parser de endereço', () => {
  it('separa logradouro, número, bairro, município, UF e CEP', async () => {
    const [canon, munis] = await Promise.all([getCanon(), getMunicipios()]);
    const p = parseAddress('R. Costa Aguiar, nº 1686 - Ipiranga, São Paulo - SP, 04204-002', canon, munis);
    expect(p.street?.tipo).toBe('RUA');
    expect(p.street?.core).toBe('COSTA AGUIAR');
    expect(p.numero).toBe(1686);
    expect(p.bairro).toBe('IPIRANGA');
    expect(p.municipio?.cod).toBe(3550308);
    expect(p.uf).toBe('SP');
    expect(p.cep).toBe('04204002');
  });

  it('entende texto sem vírgulas, abreviações, s/n, km e "25 de Março"', async () => {
    const [canon, munis] = await Promise.all([getCanon(), getMunicipios()]);
    const a = parseAddress('av dr gastao vidigal 1946 sp', canon, munis);
    expect(a.street?.nome).toBe('DOUTOR GASTAO VIDIGAL');
    expect(a.street?.core).toBe('GASTAO VIDIGAL');
    expect(a.numero).toBe(1946);
    expect(a.uf).toBe('SP');
    const b = parseAddress('Rua Costa Aguiar 1686 Ipiranga São Paulo', canon, munis);
    expect([b.numero, b.bairro, b.municipio?.cod]).toEqual([1686, 'IPIRANGA', 3550308]);
    const c = parseAddress('Santos Brasil, Avenida Santos Dumont, s/n, Guarujá', canon, munis);
    expect(c.semNumero).toBe(true);
    expect(c.street?.core).toBe('SANTOS DUMONT');
    expect(c.extras).toEqual(['Santos Brasil']);
    expect(c.municipio?.cod).toBe(3518701);
    const d = parseAddress('Rod. Anhanguera km 30, Cajamar', canon, munis);
    expect([d.km, d.numero, d.street?.tipo, d.municipio?.cod]).toEqual([true, 30, 'RODOVIA', 3509205]);
    const e = parseAddress('Rua 25 de Março 100', canon, munis);
    expect([e.street?.nome, e.numero]).toEqual(['25 MARCO', 100]);
    const f = parseAddress('Rua Itu, 100', canon, munis);
    expect([f.street?.nome, f.municipio]).toEqual(['ITU', undefined]);   // "Itu" aqui é a rua, não a cidade
    const g = parseAddress('Cajamar', canon, munis);
    expect([g.street, g.municipio?.cod]).toEqual([undefined, 3509205]);
    const h = parseAddress('05316-900', canon, munis);
    expect([h.cep, h.street]).toEqual(['05316900', undefined]);
  });
});

describe('interpolação entre vizinhos do CNEFE', () => {
  it('interpola na mesma paridade e recusa vizinhos incoerentes', () => {
    const a = { numero: 100, lat: -23.5, lon: -46.6 };
    const b = { numero: 200, lat: -23.5009, lon: -46.6 };   // ~100 m ao sul
    const r = interpCnefe(150, [a, b, { numero: 151, lat: -23.6, lon: -46.7 }]);
    expect(r).toBeDefined();
    expect(distM(r!.pt, { lat: -23.50045, lon: -46.6 })).toBeLessThan(2);
    // vizinhos a 12 km um do outro com 100 números de diferença: não interpola, usa o mais próximo em número
    const far = interpCnefe(110, [a, { numero: 200, lat: -23.6, lon: -46.6 }]);
    expect(distM(far!.pt, a)).toBeLessThan(1);
  });
});

describe('precisão medida na própria base (deixa-um-de-fora)', () => {
  it('interpolação entre vizinhos do CNEFE: mediana < 20 m e p80 < 60 m (Guarulhos, 150 endereços)', async () => {
    if (!hasCnefe) return;
    const r = await pool.query(`select p.street_id, p.numero, p.lat::float8 lat, p.lon::float8 lon
        from addr_point p join addr_street s on s.id = p.street_id
       where s.cod_mun = 3518800 and p.numero is not null and p.km = false and p.nv_geo = 1
       order by md5(p.street_id::text || p.numero::text) limit 150`);
    const errs: number[] = [];
    for (const t of r.rows) {
      const nb = await pool.query(`select numero, lat::float8 lat, lon::float8 lon from addr_point
          where street_id = $1 and km = false and numero between $2 - 600 and $2 + 600 and numero <> $2`, [t.street_id, t.numero]);
      const res = interpClusters(t.numero, nb.rows);
      if (res.length) errs.push(distM(res[0].pt, t));
    }
    const s = [...errs].sort((a, b) => a - b);
    console.log(`CNEFE deixa-um-de-fora: n=${s.length} p50=${Math.round(median(s))} m p80=${Math.round(s[Math.floor(s.length * 0.8)])} m`);
    expect(s.length).toBeGreaterThan(120);
    expect(median(s)).toBeLessThan(20);
    expect(s[Math.floor(s.length * 0.8)]).toBeLessThan(60);
  });

  it('segmentos do GeoSampa conferidos pelo CNEFE: mediana < 40 m', async () => {
    if (!hasCnefe) return;
    const r = await pool.query(`
      with amostra as (
        select p.numero, p.lat, p.lon, s.core_norm
          from addr_point p join addr_street s on s.id = p.street_id
         where s.cod_mun = 3550308 and p.numero is not null and p.km = false and p.nv_geo = 1
         order by md5(p.street_id::text || p.numero::text) limit 400),
      c as (
        select a.*, ST_Distance(ST_LineInterpolatePoint(g.geom, case when x.hi = x.lo then 0.5
                 else greatest(0, least(1, (a.numero - x.lo)::float8 / (x.hi - x.lo))) end)::geography,
                 ST_SetSRID(ST_MakePoint(a.lon, a.lat), 4326)::geography) err
          from amostra a
          join addr_segment g on g.cod_mun = 3550308 and g.core_norm = a.core_norm and g.orientacao = 'cnefe'
          cross join lateral (select case when a.numero % 2 = 0 then g.par_ini else g.impar_ini end lo,
                                     case when a.numero % 2 = 0 then g.par_fim else g.impar_fim end hi) x
         where x.lo is not null and x.hi is not null and a.numero between least(x.lo, x.hi) and greatest(x.lo, x.hi)),
      best as (select distinct on (numero, lat, lon) err from c order by numero, lat, lon, err)
      select count(*)::int n, percentile_cont(0.5) within group (order by err) p50 from best`);
    console.log(`GeoSampa (segmentos conferidos): n=${r.rows[0].n} p50=${Math.round(r.rows[0].p50)} m`);
    expect(r.rows[0].n).toBeGreaterThan(100);
    expect(r.rows[0].p50).toBeLessThan(40);
  });
});

describe('validação de município do Photon', () => {
  it('rejeita resultado de outra cidade (Mallet-PR, Vila Mariana) quando a cidade foi digitada', async () => {
    const fake = new (class extends PhotonGeocoder {
      async search() {
        return [
          { label: 'Rua Santos Dumont · Mallet · Paraná', lat: -25.881, lon: -50.826, precisao: 'logradouro' as const, fonte: 'osm' },
          { label: 'Rua Joaquim Távora · Vila Mariana · São Paulo', lat: -23.5891, lon: -46.6354, precisao: 'logradouro' as const, fonte: 'osm' },
          { label: 'Rua Joaquim Távora · Santos', lat: -23.9480, lon: -46.3420, precisao: 'logradouro' as const, fonte: 'osm' },
        ];
      }
    })();
    const g = new CascadeGeocoder(fake, false);
    const ex = await g.explain('Porto Qualquer Coisa Inexistente, Santos');
    expect(ex.parsed.municipio?.cod).toBe(3548500);
    const osm = ex.results.filter((r) => r.fonte === 'osm');
    expect(osm.length).toBe(1);
    expect(osm[0].label).toContain('Santos');
    expect(osm[0].municipio).toBe('Santos');
  });

  it('sem cidade digitada, só aceita pontos da UF de referência', async () => {
    const fake = new (class extends PhotonGeocoder {
      async search() {
        return [
          { label: 'Fora (PR)', lat: -25.881, lon: -50.826, precisao: 'poi' as const, fonte: 'osm' },
          { label: 'Dentro (SP)', lat: -23.534, lon: -46.734, precisao: 'poi' as const, fonte: 'osm' },
        ];
      }
    })();
    const g = new CascadeGeocoder(fake, false);
    const ex = await g.explain('Lugar Inventado Xyzw', { lat: -23.55, lon: -46.63 });
    expect(ex.uf).toBe('SP');
    expect(ex.results.map((r) => r.label)).toEqual(['Dentro (SP)']);
  });
});

describe('/api/geocode — cascata própria', () => {
  it('10 endereços logísticos: erro mediano < 100 m e nenhum em outra cidade', async () => {
    if (!hasCnefe) return;
    const errs: number[] = [];
    for (const c of CASOS) {
      const rs = await geocode(c.q);
      expect(rs.length, c.q).toBeGreaterThan(0);
      const top = rs[0];
      expect(top.precisao, c.q).toBeTruthy();
      expect(typeof top.desvio_m, c.q).toBe('number');
      const d = distM(top, { lat: c.truth[0], lon: c.truth[1] });
      errs.push(d);
      console.log(`${c.nome.padEnd(28)} ${String(Math.round(d)).padStart(5)} m  ${top.precisao}/${top.metodo} ±${top.desvio_m} m  ${top.label}`);
      expect(d, `${c.q} → ${top.label}`).toBeLessThan(5000);   // nada de outra cidade
    }
    const med = median(errs);
    console.log(`erro mediano: ${Math.round(med)} m; <=100 m: ${errs.filter((e) => e <= 100).length}/10`);
    expect(med).toBeLessThan(100);
  });

  it('número exato vem com precisão "numero" e desvio pequeno', async () => {
    if (!hasCnefe) return;
    const [top] = await geocode('Rua Joaquim Távora, 500, Santos');
    expect(top.precisao).toBe('numero');
    expect(top.desvio_m).toBeLessThanOrEqual(30);
    expect(top.municipio).toBe('Santos');
    expect(distM(top, { lat: -23.947828, lon: -46.341723 })).toBeLessThan(30);
  });

  it('cidade digitada vence o viés de posição (Santos com usuário na capital)', async () => {
    if (!hasCnefe) return;
    const rs = await geocode('Rua Joaquim Távora, 500, Santos', { lat: -23.5891, lon: -46.6354 });
    expect(rs.every((r) => r.lat < -23.85)).toBe(true);
  });

  it('número ausente do CNEFE → numero_aproximado entre os vizinhos', async () => {
    if (!hasCnefe) return;
    // acha, na base, um número que falta entre dois vizinhos próximos da mesma paridade (Guarulhos)
    const r = await pool.query(`
      with s as (select id from addr_street where cod_mun = 3518800 and n > 200 order by id limit 300),
      p as (select p.street_id, p.numero, p.lat, p.lon,
                   lead(p.numero) over w as n2, lead(p.lat) over w as lat2, lead(p.lon) over w as lon2
              from addr_point p join s on s.id = p.street_id
             where p.numero is not null and p.km = false and p.numero % 2 = 0
            window w as (partition by p.street_id order by p.numero))
      select st.tipo, st.titulo, st.nome, p.numero, p.n2, p.lat, p.lon, p.lat2, p.lon2
        from p join addr_street st on st.id = p.street_id
       where p.n2 - p.numero = 8
         and sqrt(((p.lat - p.lat2) * 111320) ^ 2 + ((p.lon - p.lon2) * 102000) ^ 2) between 8 and 40
         and not exists (select 1 from addr_point x where x.street_id = p.street_id and x.numero = p.numero + 4)
         and (select count(*) from addr_street y where y.cod_mun = 3518800 and y.core_norm = st.core_norm) = 1
       limit 1`);
    expect(r.rows.length).toBe(1);
    const x = r.rows[0];
    const q = `${[x.tipo, x.titulo, x.nome].filter(Boolean).join(' ')}, ${x.numero + 4}, Guarulhos`;
    const [top] = await geocode(q);
    expect(top.precisao, q).toBe('numero_aproximado');
    const mid = { lat: (x.lat + x.lat2) / 2, lon: (x.lon + x.lon2) / 2 };
    expect(distM(top, mid), q).toBeLessThan(30);
  });

  it('capital: número fora do CNEFE usa a faixa do segmento do GeoSampa quando não há vizinho perto', async () => {
    if (!hasCnefe) return;
    const ex = (await get(`/api/geocode?q=${encodeURIComponent('Avenida Doutor Gastão Vidigal, 1946, São Paulo')}&debug=1`)).body;
    const top = ex.results[0];
    expect(['numero', 'numero_aproximado']).toContain(top.precisao);
    expect(distM(top, { lat: -23.534068, lon: -46.73475 })).toBeLessThan(400);
  });

  it('s/n: lista os estabelecimentos do logradouro; com o nome digitado, o certo vem primeiro', async () => {
    if (!hasCnefe) return;
    const rs = await geocode('Santos Brasil, Avenida Santos Dumont, s/n, Guarujá');
    expect(rs[0].label.toUpperCase()).toContain('SANTOS BRASIL');
    expect(distM(rs[0], { lat: -23.96, lon: -46.289 })).toBeLessThan(800);
    const generic = await geocode('Avenida Santos Dumont, s/n, Guarujá');
    expect(generic.length).toBeGreaterThan(1);
    expect(generic.every((r) => r.municipio === 'Guarujá')).toBe(true);
  });

  it('CEP: centroide com precisão "cep" e desvio informado', async () => {
    if (!hasCnefe) return;
    const [top] = await geocode('04204-002');
    expect(top.precisao).toBe('cep');
    expect(top.desvio_m).toBeGreaterThan(0);
    expect(distM(top, { lat: -23.589029, lon: -46.606135 })).toBeLessThan(1500);
  });

  it('CEP de grande usuário (fora do CNEFE) cai no endereço do ViaCEP geocodificado no CNEFE', async () => {
    if (!hasCnefe) return;
    const rs = await geocode('05316-900');
    expect(rs.length).toBeGreaterThan(0);
    // sem rede para o ViaCEP o resultado pode faltar; com rede, tem de cair perto da CEAGESP
    if (rs[0].fonte?.startsWith('viacep')) expect(distM(rs[0], { lat: -23.534068, lon: -46.73475 })).toBeLessThan(800);
  });

  it('só a cidade → precisão "municipio"; bairro → precisão "bairro"', async () => {
    const [m] = await geocode('Cajamar');
    expect(m.precisao).toBe('municipio');
    expect(m.cod_ibge).toBe(3509205);
    if (!hasCnefe) return;
    const ex = (await get(`/api/geocode?q=${encodeURIComponent('Vila Leopoldina, São Paulo')}&debug=1`)).body;
    expect(ex.results.some((r: any) => r.precisao === 'bairro' && /Leopoldina/i.test(r.label))).toBe(true);
  });

  it('valida q (422) e mantém o formato antigo (label/lat/lon) na resposta', async () => {
    expect((await get('/api/geocode?q=ab')).status).toBe(422);
    const rs = await geocode('Rua Costa Aguiar, 1686, São Paulo');
    for (const r of rs) {
      expect(typeof r.label).toBe('string');
      expect(typeof r.lat).toBe('number');
      expect(typeof r.lon).toBe('number');
      expect(r.precisao).toBeTruthy();
    }
  });
});
