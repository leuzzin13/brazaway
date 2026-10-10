/** Geocodificador local (PostGIS) sobre o CNEFE 2022, os segmentos do GeoSampa e os centroides de CEP.
 *
 *  Cascata de precisão, do melhor para o pior:
 *    numero            → o número existe no CNEFE (ponto coletado em campo pelo IBGE)
 *    numero_aproximado → interpolado entre vizinhos do CNEFE ou pela faixa par/ímpar do segmento (GeoSampa, capital)
 *    logradouro        → só a rua (filtrada pelo bairro/CEP digitado, se houver): endereço real mais central
 *    cep               → centroide do CEP (IPEA/CNEFE); CEP de grande usuário via ViaCEP → logradouro+número
 *    bairro            → endereço mais central do bairro (DSC_LOCALIDADE do CNEFE)
 *    municipio         → ponto interno do polígono do município (IBGE)
 */
import { query } from '../../db.js';
import { distM, lerp, medoid, round6, type Pt } from './geo.js';
import { cargoRank, fmtCep, numberVariants, titleCase, trigramSim, type Canon } from './normalize.js';
import { fmtKm, parseStreet, type ParsedAddress, type ParsedStreet } from './parse.js';
import type { Municipio, MunicipioIndex } from './municipios.js';
import type { GeocodeResult, LatLon, Precisao } from './types.js';
import { viacepLookup } from './viacep.js';

const COD_SP = 3550308;

interface StreetRow {
  id: number; cod_mun: number; tipo: string; titulo: string | null; nome: string; nome_norm: string; core_norm: string;
  n: number; lat: number | null; lon: number | null; desvio_m: number | null; sim_nome: number; sim_core: number;
  score: number;
}
interface PointRow {
  street_id: number; numero: number | null; km: boolean; bairro_id: number | null; cep: number | null; nv_geo: number;
  n: number; estab: string | null; lat: number; lon: number; bairro: string | null; km_m?: number | null;
}
interface SegRow {
  id: number; codlog: string; tipo: string; core_norm: string; lo: number; hi: number; lat: number; lon: number; len_m: number;
  orientacao: string | null;
  /** correlação número × posição ao longo da linha medida com o CNEFE (addr_segment_orient); null = sem endereço para conferir */
  orient_r: number | null;
  orient_n: number | null;
}
interface CepRow { cep: number; cod_mun: number; municipio: string; uf: string; n: number; desvio_m: number | null; lat: number; lon: number; confiavel: boolean }

const PT_COLS = `p.street_id, p.numero, p.km, p.km_m, p.bairro_id, p.cep, p.nv_geo, p.n, p.estab, p.lat::float8 lat, p.lon::float8 lon, b.nome as bairro`;
interface BairroRow { id: number; cod_mun: number; nome: string; nome_norm: string; n: number; lat: number; lon: number; desvio_m: number | null; sim: number }

export interface CnefeCtx {
  near?: LatLon;
  limit: number;
  munis: MunicipioIndex;
  canon: Canon;
  /** UF de referência (digitada ou da posição do usuário) */
  uf?: string;
  viacep?: boolean;
}

function streetLabel(s: Pick<StreetRow, 'tipo' | 'titulo' | 'nome'>): string {
  // junto, para a preposição do meio sair minúscula ("Praca da Se", não "Praca Da Se")
  return titleCase([s.tipo, s.titulo, s.nome].filter(Boolean).join(' '));
}

/** Desvio (m) da interpolação pela faixa do segmento do GeoSampa, pela correlação com o CNEFE e o comprimento.
 *  Calibrado contra 16 mil endereços do CNEFE na capital (p80 do erro, 10/2026): r >= 0,7 → p50 11 m / p80 33 m;
 *  0,3–0,7 → 34/107 m; |r| < 0,3 → 46/124 m; sem endereço para conferir → 169/331 m (cresce com o comprimento). */
export function segDesvio(r: number | null | undefined, lenM: number): number {
  if (r === null || r === undefined) return 200 + lenM;
  if (r >= 0.7) return 12 + 0.2 * lenM;
  if (r >= 0.3) return 30 + 0.55 * lenM;
  return 30 + 0.75 * lenM;
}

function muniLabel(m: Municipio | undefined, cod: number, munis: MunicipioIndex): { nome?: string; uf?: string; text: string } {
  const mm = m ?? munis.byCod.get(cod);
  if (!mm) return { text: '' };
  return { nome: mm.nome, uf: mm.uf, text: `${mm.nome} - ${mm.uf}` };
}

const DESVIO_NV: Record<number, number> = { 1: 10, 2: 15, 3: 35, 4: 60 };

export class CnefeGeocoder {
  async geocode(p: ParsedAddress, ctx: CnefeCtx): Promise<GeocodeResult[]> {
    const out: GeocodeResult[] = [];
    const munFilter = this.munFilter(p, ctx);

    if (p.street && p.street.nome) {
      if (p.municipioFraco && p.municipio) {
        // "Rua Augusta Guarulhos" / "Vila Leopoldina": tenta o texto sem o município (só nele) e o texto inteiro (UF)
        out.push(...(await this.byStreet(p, p.street, [p.municipio.cod], ctx)));
        const full = p.textoCompleto ? parseStreet(p.textoCompleto, ctx.canon) : undefined;
        if (full?.nome) {
          out.push(...(await this.byStreet(p, full, munFilter, ctx)));
          if (!p.enderecoLike && !p.bairro) out.push(...(await this.byBairro(full.nome, munFilter, ctx, 0.9)));
        }
      } else {
        out.push(...(await this.byStreet(p, p.street, munFilter, ctx)));
      }
      // trecho sem tipo e sem número pode ser um bairro ("Vila Leopoldina, São Paulo")
      if (!p.enderecoLike && !p.bairro) {
        out.push(...(await this.byBairro(p.street.nome, p.municipioFraco && p.municipio ? [p.municipio.cod] : munFilter, ctx, 0.9)));
      }
    }
    // texto sem tipo nem número ("Aeroporto de Guarulhos", "Costa Aguiar"): rua achada por nome fica atrás de POI
    if (!p.enderecoLike) for (const r of out) if (r.precisao === 'logradouro') r.score = (r.score ?? 0) - 0.2;
    // município como pista fraca: preferência para resultados nele
    if (p.municipio && p.municipioFraco) for (const r of out) if (r.cod_ibge === p.municipio.cod) r.score = (r.score ?? 0) + 0.1;
    const best = bestRank(out);
    if (p.cep && (best > 2 || out.length === 0)) out.push(...(await this.byCep(p, ctx)));
    if (p.bairro && bestRank(out) > 3) out.push(...(await this.byBairro(p.bairro, munFilter, ctx, 1)));
    if (p.municipio && (out.length === 0 || (bestRank(out) > 4 && !p.municipioFraco))) {
      const m = this.byMunicipio(p.municipio);
      if (p.municipioFraco) m.score = 0.2;
      out.push(m);
    }
    return dedupe(out).slice(0, Math.max(ctx.limit, 1) * 2);
  }

  /** municípios onde procurar: o digitado; senão os carregados (da UF de referência, se houver) */
  private munFilter(p: ParsedAddress, ctx: CnefeCtx): number[] | null {
    if (p.municipio && !p.municipioFraco) return [p.municipio.cod];
    const cov = ctx.munis.covered();
    if (!cov.length) return null;
    const uf = p.uf ?? ctx.uf;
    const inUf = uf ? cov.filter((m) => m.uf === uf) : cov;
    return (inUf.length ? inUf : cov).map((m) => m.cod);
  }

  // -------------------------------------------------------------------------------------------
  // logradouro
  // -------------------------------------------------------------------------------------------
  private async findStreets(st: ParsedStreet, munFilter: number[] | null, limit = 30): Promise<StreetRow[]> {
    // variantes com número por extenso ("25 de Março" x "VINTE E CINCO DE MARCO"); a melhor pontuação vence
    const nomes = numberVariants(st.nome);
    const cores = numberVariants(st.core);
    const vars = nomes.map((n, i) => ({ nome: n, core: cores[i] ?? cores[0] }));
    const byId = new Map<number, StreetRow>();
    const rows = await Promise.all(vars.map((v) => query<StreetRow>(
      `select s.id, s.cod_mun, s.tipo, s.titulo, s.nome, s.nome_norm, s.core_norm, s.n,
              s.lat::float8 as lat, s.lon::float8 as lon, s.desvio_m::float8 as desvio_m,
              similarity(s.nome_norm, $1)::float8 as sim_nome, similarity(s.core_norm, $2)::float8 as sim_core
         from addr_street s
        where (s.nome_norm % $1 or s.core_norm % $2 or (length($1) >= 4 and (s.nome_norm like $1 || '%' or s.core_norm like $2 || '%')))
          and ($3::int[] is null or s.cod_mun = any($3::int[]))
          and s.n > 0 and s.lat is not null
        order by greatest(similarity(s.nome_norm, $1), similarity(s.core_norm, $2)) desc, s.n desc
        limit $4`,
      [v.nome, v.core, munFilter, limit]).then((r) => r.rows.map((x) => ({ x, v })))));
    for (const { x: s, v } of rows.flat()) {
      let score = 0.55 * s.sim_nome + 0.45 * s.sim_core;
      if (s.nome_norm === v.nome) score += 0.05;
      // autocompletar: "Rua Costa Ag" → COSTA AGUIAR (começa com o texto) na frente de COSTA
      else if (v.nome.length >= 4 && (s.nome_norm.startsWith(v.nome) || s.core_norm.startsWith(v.core))) score += 0.2;
      if (st.tipo && s.tipo) score += s.tipo === st.tipo ? 0.06 : -0.04;
      const prev = byId.get(s.id);
      if (!prev || prev.score < score) byId.set(s.id, { ...s, score });
    }
    return [...byId.values()].sort((a, b) => b.score - a.score || b.n - a.n).slice(0, limit);
  }

  private async bairroIds(bairro: string | undefined, munFilter: number[] | null): Promise<Map<number, BairroRow>> {
    const m = new Map<number, BairroRow>();
    if (!bairro) return m;
    const r = await query<BairroRow>(
      `select id, cod_mun, nome, nome_norm, n, lat::float8 lat, lon::float8 lon, desvio_m::float8 desvio_m,
              similarity(nome_norm, $1)::float8 as sim
         from addr_bairro where nome_norm % $1 and ($2::int[] is null or cod_mun = any($2::int[]))
        order by sim desc limit 30`, [bairro, munFilter]);
    for (const b of r.rows) if (b.sim >= 0.45) m.set(b.id, b);
    return m;
  }

  private async byStreet(p: ParsedAddress, st: ParsedStreet, munFilter: number[] | null, ctx: CnefeCtx): Promise<GeocodeResult[]> {
    const all = await this.findStreets(st, munFilter);
    if (!all.length) return [];
    const top = all[0].score;
    const minScore = p.enderecoLike ? 0.5 : 0.62;
    const cands = all.filter((s) => s.score >= minScore && s.score >= top - 0.18).slice(0, 8);
    if (!cands.length) return [];
    const bairros = await this.bairroIds(p.bairro, munFilter);
    const cep = p.cep ? Number(p.cep) : undefined;
    const ids = cands.map((s) => s.id);
    const results: GeocodeResult[] = [];

    const bonus = (pt: { bairro_id: number | null; cep: number | null }) =>
      (bairros.size && pt.bairro_id !== null && bairros.has(pt.bairro_id) ? 0.15 : 0) + (cep && pt.cep === cep ? 0.15 : 0);
    // posição do usuário só desempata (homônimos): peso maior quando a cidade não foi digitada
    const nearW = !p.municipio || p.municipioFraco ? 0.04 : 0.01;
    const nearPenalty = (pt: Pt) => (ctx.near ? -nearW * Math.min(1, distM(pt, ctx.near) / 80000) : 0);

    if (p.numero !== undefined) {
      const km = !!p.km;
      // km: o CNEFE mistura "km inteiro" e "km×1000+metros" no número; km_m (metros) é a unidade única
      const exact = km
        ? await query<PointRow>(
          `select ${PT_COLS} from addr_point p left join addr_bairro b on b.id = p.bairro_id
            where p.street_id = any($1::int[]) and p.km and p.km_m = $2`, [ids, p.kmM ?? p.numero * 1000])
        : await query<PointRow>(
          `select ${PT_COLS} from addr_point p left join addr_bairro b on b.id = p.bairro_id
            where p.street_id = any($1::int[]) and p.numero = $2 and p.km = false`, [ids, p.numero]);
      const done = new Set<number>();
      for (const s of cands) {
        const pts = exact.rows.filter((x) => x.street_id === s.id);
        if (!pts.length) continue;
        // homônimos no mesmo município (mesmo nome em bairros diferentes) → um resultado por grupo distante
        for (const g of clusters(pts, 400)) {
          const best = g.sort((a, b) => bonus(b) - bonus(a) || a.nv_geo - b.nv_geo || b.n - a.n)[0];
          results.push(this.pointResult(s, best, ctx, {
            precisao: 'numero', metodo: 'cnefe_exato', desvio: DESVIO_NV[best.nv_geo] ?? 30,
            score: s.score + 0.12 + bonus(best) + nearPenalty(best), numero: p.numeroTexto ?? String(p.numero), km,
          }));
        }
        done.add(s.id);
      }
      // sem o número exato: interpola (vizinhos do CNEFE; GeoSampa na capital)
      const missing = cands.filter((s) => !done.has(s.id));
      // se o número exato apareceu num logradouro bem pontuado, não gasta tempo interpolando os piores
      const bestExact = results.reduce((m, r) => Math.max(m, r.score ?? 0), 0);
      const toInterp = missing.filter((s) => s.score + 0.06 >= bestExact - 0.12).slice(0, 4);
      if (toInterp.length && !km) {
        results.push(...(await this.interpolate(p, toInterp, bairros, cep, ctx, bonus, nearPenalty)));
      } else if (toInterp.length && km) {
        results.push(...(await this.nearestKm(p, toInterp, ctx, nearPenalty)));
      }
      // nem exato nem aproximado: logradouro
      if (!results.length) results.push(...(await this.streetLevel(p, cands.slice(0, 3), bairros, cep, ctx, nearPenalty)));
      return results;
    }

    if (p.semNumero) {
      results.push(...(await this.semNumero(p, cands.slice(0, 3), bairros, ctx, nearPenalty)));
      if (results.length) return results;
    }
    return this.streetLevel(p, cands.slice(0, 5), bairros, cep, ctx, nearPenalty);
  }

  private pointResult(s: StreetRow, pt: { lat: number; lon: number; bairro?: string | null; cep?: number | null }, ctx: CnefeCtx,
    o: { precisao: Precisao; metodo: string; desvio: number; score: number; numero?: string; km?: boolean; fonte?: string; extra?: string; aviso?: string }): GeocodeResult {
    const mun = muniLabel(undefined, s.cod_mun, ctx.munis);
    const rua = streetLabel(s);
    const num = o.numero ? (o.km ? `km ${o.numero.replace(/^km\s*/i, '')}` : o.numero) : '';
    const numTxt = num ? `, ${num}${o.precisao === 'numero_aproximado' ? ' (aprox.)' : ''}` : '';
    const bairro = pt.bairro ? titleCase(pt.bairro) : undefined;
    const cep = fmtCep(pt.cep);
    const label = [o.extra, `${rua}${numTxt}`, bairro, mun.text].filter(Boolean).join(' · ');
    return {
      label, lat: round6(pt.lat), lon: round6(pt.lon), precisao: o.precisao, desvio_m: Math.round(o.desvio),
      fonte: o.fonte ?? 'cnefe', metodo: o.metodo, logradouro: rua, numero: num || undefined, bairro, municipio: mun.nome,
      uf: mun.uf, cod_ibge: s.cod_mun, cep, aviso: o.aviso ?? avisoFor(o.precisao, o.desvio), score: Math.round(o.score * 1000) / 1000,
    };
  }

  private async interpolate(p: ParsedAddress, streets: StreetRow[], bairros: Map<number, BairroRow>, cep: number | undefined, ctx: CnefeCtx,
    bonus: (pt: { bairro_id: number | null; cep: number | null }) => number, nearPenalty: (pt: Pt) => number): Promise<GeocodeResult[]> {
    const n = p.numero!;
    const ids = streets.map((s) => s.id);
    const nb = await query<PointRow>(
      `select ${PT_COLS} from addr_point p left join addr_bairro b on b.id = p.bairro_id
        where p.street_id = any($1::int[]) and p.km = false and p.numero between $2::int - 600 and $2::int + 600`, [ids, n]);
    const capital = streets.filter((s) => s.cod_mun === COD_SP);
    const segs = capital.length ? await this.segments(capital, n) : [];
    const out: GeocodeResult[] = [];
    for (const s of streets) {
      let pts = nb.rows.filter((x) => x.street_id === s.id);
      // com bairro/CEP digitado, usa só os vizinhos do bairro/CEP (homônimos!) se houver
      if (bairros.size || cep) {
        const f = pts.filter((x) => bonus(x) > 0);
        if (f.length) pts = f;
      }
      const groups = interpClusters(n, pts);
      const cn = groups[0];
      // homônimos (mesmo nome, outro bairro): os outros grupos viram resultados próprios, um pouco abaixo
      for (const g of groups.slice(1, 3)) {
        out.push(this.pointResult(s, { ...g.pt, bairro: g.ref.bairro ?? null, cep: (g.ref as PointRow).cep ?? null }, ctx, {
          precisao: 'numero_aproximado', metodo: 'cnefe_interpolado', desvio: g.desvio,
          score: s.score + 0.03 + bonus(g.ref as PointRow) + nearPenalty(g.pt), numero: p.numeroTexto ?? String(n),
        }));
      }
      let gs: { pt: Pt; desvio: number; seg: SegRow } | undefined;
      const mySegs = segs.filter((g) => g.core_norm === s.core_norm || g.core_norm === s.nome_norm);
      if (mySegs.length) {
        const ref: Pt | undefined = cn?.pt ?? nearestByNumber(n, pts) ?? (s.lat !== null && s.lon !== null ? { lat: s.lat, lon: s.lon! } : undefined);
        const maxRef = Math.max(2500, 3 * (s.desvio_m ?? 0));
        const ranked = mySegs
          .map((g) => ({ g, d: ref ? distM(ref, g) : 0, tipoOk: !g.tipo || !s.tipo || g.tipo === s.tipo }))
          .filter((x) => x.d <= maxRef)
          .sort((a, b) => Number(b.tipoOk) - Number(a.tipoOk) || a.d - b.d);
        if (ranked.length) {
          const g = ranked[0].g;
          // desvio pela correlação com o CNEFE (forte: mediana ~11 m; fraca ou sem endereço para conferir: bem pior)
          gs = { pt: { lat: g.lat, lon: g.lon }, desvio: segDesvio(g.orient_r, g.len_m), seg: g };
        }
      }
      let pick: { pt: Pt; desvio: number; metodo: string; fonte: string; ref?: PointRow } | undefined;
      if (cn && gs) {
        const dis = distM(cn.pt, gs.pt);
        // vizinhos do CNEFE perto em número ganham; senão vence o menor desvio estimado, exceto segmento não
        // conferido que discorda muito do CNEFE (numeração do cadastro municipal e do IBGE divergem ali)
        const gsUnverified = gs.seg.orientacao !== 'cnefe' || (gs.seg.orient_r ?? 0) < 0.3;
        if (cn.gap <= 40 || cn.desvio <= gs.desvio || (gsUnverified && dis > 300)) pick = { pt: cn.pt, desvio: cn.desvio, metodo: 'cnefe_interpolado', fonte: 'cnefe', ref: cn.ref };
        else pick = { pt: gs.pt, desvio: gs.desvio, metodo: 'geosampa_segmento', fonte: 'geosampa', ref: cn.ref };
      } else if (cn) pick = { pt: cn.pt, desvio: cn.desvio, metodo: 'cnefe_interpolado', fonte: 'cnefe', ref: cn.ref };
      else if (gs) pick = { pt: gs.pt, desvio: gs.desvio, metodo: 'geosampa_segmento', fonte: 'geosampa', ref: nearestRow(gs.pt, pts) };
      if (!pick) continue;
      const ref = pick.ref ?? nearestRow(pick.pt, pts);
      out.push(this.pointResult(s, { ...pick.pt, bairro: ref?.bairro ?? null, cep: ref?.cep ?? null }, ctx, {
        precisao: 'numero_aproximado', metodo: pick.metodo, desvio: pick.desvio, fonte: pick.fonte,
        score: s.score + 0.06 + (ref ? bonus(ref) : 0) + nearPenalty(pick.pt), numero: p.numeroTexto ?? String(n),
      }));
    }
    return out;
  }

  /** segmentos do GeoSampa (capital) cuja faixa da mesma paridade contém o número, já com o ponto interpolado */
  private async segments(streets: StreetRow[], n: number): Promise<SegRow[]> {
    const names = [...new Set(streets.flatMap((s) => [s.core_norm, s.nome_norm]))];
    try {
      const r = await query<SegRow>(
        `select id, codlog, tipo, core_norm, orientacao, orient_r::float8 orient_r, orient_n, lo, hi,
                ST_Y(pt)::float8 lat, ST_X(pt)::float8 lon, len_m
           from (select s.id, s.codlog, s.tipo, s.core_norm, s.orientacao, s.orient_r, s.orient_n, s.geom,
                        case when $2::int % 2 = 0 then s.par_ini else s.impar_ini end lo,
                        case when $2::int % 2 = 0 then s.par_fim else s.impar_fim end hi
                   from addr_segment s where s.cod_mun = ${COD_SP} and s.core_norm = any($1::text[])) x,
                lateral (select ST_LineInterpolatePoint(x.geom,
                           case when x.hi = x.lo then 0.5 else greatest(0, least(1, ($2::int - x.lo)::float8 / (x.hi - x.lo))) end) as pt,
                         ST_Length(x.geom::geography)::float8 as len_m) i
          where x.lo is not null and x.hi is not null and $2::int between least(x.lo, x.hi) and greatest(x.lo, x.hi)`,
        [names, n]);
      return r.rows;
    } catch { return []; }
  }

  /** rodovia "km N" sem registro exato: ponto do CNEFE com KM na faixa digitada ("km 30" = 30,000–30,999) e,
   *  sem ele, o mais próximo até 3 km. Usa km_m (metros), porque o CNEFE grava "km 26" e "25345" (= km 25,345). */
  private async nearestKm(p: ParsedAddress, streets: StreetRow[], ctx: CnefeCtx, nearPenalty: (pt: Pt) => number): Promise<GeocodeResult[]> {
    const alvo = p.kmM ?? p.numero! * 1000;
    const [lo, hi] = p.kmFracao ? [alvo, alvo] : [alvo, alvo + 999];
    const r = await query<PointRow & { km_m: number }>(
      `select distinct on (p.street_id) ${PT_COLS}
         from addr_point p left join addr_bairro b on b.id = p.bairro_id
        where p.street_id = any($1::int[]) and p.km and p.km_m between $3::int - 3000 and $4::int + 3000
        order by p.street_id, (p.km_m between $3::int and $4::int) desc, abs(p.km_m - $2::int), p.nv_geo, p.n desc`,
      [streets.map((s) => s.id), alvo, lo, hi]);
    return r.rows.map((x) => {
      const s = streets.find((y) => y.id === x.street_id)!;
      const gap = Math.abs(x.km_m - alvo);
      const naFaixa = x.km_m >= lo && x.km_m <= hi;
      return this.pointResult(s, x, ctx, {
        precisao: 'numero_aproximado', metodo: naFaixa ? 'cnefe_km_faixa' : 'cnefe_km_proximo', desvio: 150 + gap, km: true,
        score: s.score + 0.06 - (gap / 1000) * 0.02 + nearPenalty(x), numero: fmtKm(alvo),
        aviso: gap >= 100 ? `Ponto no km ${fmtKm(x.km_m)} (registro mais próximo no CNEFE): confira no mapa` : undefined,
      });
    });
  }

  private async semNumero(p: ParsedAddress, streets: StreetRow[], bairros: Map<number, BairroRow>, ctx: CnefeCtx, nearPenalty: (pt: Pt) => number): Promise<GeocodeResult[]> {
    const r = await query<PointRow>(
      `select ${PT_COLS} from addr_point p left join addr_bairro b on b.id = p.bairro_id
        where p.street_id = any($1::int[]) and p.numero is null`, [streets.map((s) => s.id)]);
    const out: GeocodeResult[] = [];
    for (const s of streets) {
      let pts = r.rows.filter((x) => x.street_id === s.id);
      if (bairros.size) {
        const f = pts.filter((x) => x.bairro_id !== null && bairros.has(x.bairro_id));
        if (f.length) pts = f;
      }
      const md = medoid(pts);
      if (!md) continue;
      out.push(this.pointResult(s, md.p, ctx, {
        precisao: 'logradouro', metodo: 'cnefe_sem_numero', desvio: Math.max(50, md.spread), numero: 's/n',
        score: s.score + nearPenalty(md.p),
        aviso: 'Endereço sem número: escolha o estabelecimento na lista ou marque o portão no mapa',
      }));
      // estabelecimentos "s/n" com nome (terminais, CDs, centrais de abastecimento) como sugestões próprias.
      // Com nome digitado ("Santos Brasil, Av. Santos Dumont, s/n") o mais parecido vem primeiro (e na frente da rua).
      const want = p.extras.length ? ctx.canon.canon(p.extras.join(' ')) : '';
      const named = pts
        .filter((x) => x.estab && x.estab.length >= 3)
        .map((x) => ({ x, sim: want ? trigramSim(want, ctx.canon.canon(x.estab!)) : 0, rank: cargoRank(x.estab!) }))
        .filter((o) => (want ? o.sim >= 0.3 : o.rank >= 0))
        .sort((a, b) => b.sim - a.sim || b.rank - a.rank || b.x.n - a.x.n)
        .slice(0, want ? 3 : 4);
      for (const { x, sim } of named) {
        out.push(this.pointResult(s, x, ctx, {
          precisao: want && sim >= 0.5 ? 'numero' : 'logradouro', metodo: 'cnefe_sem_numero_estabelecimento',
          desvio: DESVIO_NV[x.nv_geo] ?? 30, numero: 's/n', extra: titleCase(x.estab),
          score: s.score - 0.01 + (want ? 0.2 * sim : 0) + nearPenalty(x),
          aviso: 'Ponto do estabelecimento no CNEFE (sem número): confira se é o portão de caminhões',
        }));
      }
    }
    return out;
  }

  /** só o logradouro: endereço real mais central (no bairro/CEP digitado, se houver) */
  private async streetLevel(p: ParsedAddress, streets: StreetRow[], bairros: Map<number, BairroRow>, cep: number | undefined, ctx: CnefeCtx,
    nearPenalty: (pt: Pt) => number): Promise<GeocodeResult[]> {
    const out: GeocodeResult[] = [];
    const filtered = bairros.size || cep;
    let rows: PointRow[] = [];
    if (filtered) {
      const r = await query<PointRow>(
        `select ${PT_COLS} from addr_point p left join addr_bairro b on b.id = p.bairro_id
          where p.street_id = any($1::int[]) and (p.bairro_id = any($2::int[]) or p.cep = $3::int)`,
        [streets.map((s) => s.id), [...bairros.keys()], cep ?? -1]);
      rows = r.rows;
    }
    for (const s of streets) {
      const pts = rows.filter((x) => x.street_id === s.id);
      const md = medoid(pts);
      if (md) {
        out.push(this.pointResult(s, md.p, ctx, {
          precisao: 'logradouro', metodo: cep && pts.some((x) => x.cep === cep) ? 'medoide_logradouro_cep' : 'medoide_logradouro_bairro',
          desvio: Math.max(40, md.spread), score: s.score + 0.1 + nearPenalty(md.p),
        }));
      } else if (s.lat !== null && s.lon !== null) {
        const pt = { lat: s.lat, lon: s.lon };
        out.push(this.pointResult(s, { ...pt, bairro: null, cep: null }, ctx, {
          precisao: 'logradouro', metodo: 'medoide_logradouro', desvio: Math.max(40, s.desvio_m ?? 500),
          score: s.score + nearPenalty(pt) - (filtered ? 0.08 : 0),
        }));
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // CEP, bairro, município
  // -------------------------------------------------------------------------------------------
  async byCep(p: ParsedAddress, ctx: CnefeCtx): Promise<GeocodeResult[]> {
    const cep = Number(p.cep);
    let rows: CepRow[] = [];
    try {
      const r = await query<CepRow>(
        `select cep, cod_mun, municipio, uf, n, desvio_m::float8 desvio_m, lat::float8 lat, lon::float8 lon, confiavel
           from cep_centroid where cep = $1 order by n desc`, [cep]);
      rows = r.rows;
    } catch { /* tabela ausente */ }
    if (p.municipio) {
      const f = rows.filter((x) => x.cod_mun === p.municipio!.cod);
      if (f.length) rows = f;
    }
    const x = rows[0];
    if (x && x.confiavel !== false) {
      const mun = muniLabel(undefined, x.cod_mun, ctx.munis);
      const desvio = Math.max(30, x.desvio_m ?? 300);
      return [{
        label: [`CEP ${fmtCep(x.cep)}`, mun.text || `${titleCase(x.municipio)} - ${x.uf}`].filter(Boolean).join(' · '),
        lat: round6(x.lat), lon: round6(x.lon), precisao: 'cep', desvio_m: Math.round(desvio), fonte: 'cep', metodo: 'centroide_cep_ipea',
        municipio: mun.nome ?? titleCase(x.municipio), uf: mun.uf ?? x.uf, cod_ibge: x.cod_mun, cep: fmtCep(x.cep),
        aviso: avisoFor('cep', desvio), score: 0.7,
      }];
    }
    // CEP fora do CNEFE (grande usuário, caixa postal, CEP novo) ou centroide sem sentido (CEP "coringa" do CNEFE,
    // ex.: 01001-000 com endereços em 103 bairros): ViaCEP → logradouro + número → cascata local
    const via = ctx.viacep === false ? [] : await this.byViaCep(p, ctx);
    if (!x) return via;
    const good = via.filter((r) => r.precisao && RANK[r.precisao] <= RANK.bairro);
    if (good.length) return good;
    // sem ViaCEP (ou sem logradouro resolvido): o centroide fica, mas com a precisão de município e o desvio real
    const mun = muniLabel(undefined, x.cod_mun, ctx.munis);
    const desvio = Math.max(1500, x.desvio_m ?? 0);
    return [{
      label: [`CEP ${fmtCep(x.cep)}`, mun.text || `${titleCase(x.municipio)} - ${x.uf}`].filter(Boolean).join(' · '),
      lat: round6(x.lat), lon: round6(x.lon), precisao: 'municipio', desvio_m: Math.round(desvio), fonte: 'cep', metodo: 'centroide_cep_disperso',
      municipio: mun.nome ?? titleCase(x.municipio), uf: mun.uf ?? x.uf, cod_ibge: x.cod_mun, cep: fmtCep(x.cep),
      aviso: 'CEP genérico (endereços espalhados pela cidade na base do IBGE): marque o ponto no mapa', score: 0.4,
    }];
  }

  /** ViaCEP (com cache) → logradouro/complemento/bairro → cascata local. Sem coordenada própria. */
  private async byViaCep(p: ParsedAddress, ctx: CnefeCtx): Promise<GeocodeResult[]> {
    const v = await viacepLookup(p.cep!);
    if (!v) return [];
    const street = v.logradouro ? parseStreet(v.logradouro, ctx.canon) : undefined;
    const mun = v.ibge ? ctx.munis.byCod.get(Number(v.ibge)) : undefined;
    const compl = (v.complemento ?? '').trim();
    const numM = compl.match(/^(\d{1,6})\b/);
    const sub: ParsedAddress = {
      raw: `${v.logradouro}, ${compl}`, extras: [], enderecoLike: true, street,
      numero: numM ? Number(numM[1]) : undefined, numeroTexto: numM ? numM[1] : undefined,
      semNumero: /(^|\s)s\s*\/\s*n\b/i.test(compl) && !numM ? true : undefined,
      bairro: v.bairro ? ctx.canon.canon(v.bairro) : undefined, bairroTexto: v.bairro, municipio: mun, uf: v.uf,
    };
    let res: GeocodeResult[] = [];
    if (street?.nome && mun) res = await this.byStreet(sub, street, [mun.cod], ctx);
    if (!res.length && sub.bairro && mun) res = await this.byBairro(sub.bairro, [mun.cod], ctx, 1);
    if (!res.length && mun) res = [this.byMunicipio(mun)];
    const unidade = v.unidade ? v.unidade.trim() : '';
    return res.slice(0, 2).map((r) => ({
      ...r,
      label: [unidade, r.label, `CEP ${fmtCep(p.cep)}`].filter(Boolean).join(' · '),
      fonte: `viacep+${r.fonte}`, cep: fmtCep(p.cep),
      aviso: r.aviso ?? (unidade ? 'CEP de grande usuário: ponto pelo endereço do cadastro dos Correios' : undefined),
    }));
  }

  async byBairro(bairro: string, munFilter: number[] | null, ctx: CnefeCtx, weight: number): Promise<GeocodeResult[]> {
    let rows: BairroRow[] = [];
    try {
      rows = [...(await this.bairroIds(bairro, munFilter)).values()].filter((b) => b.lat !== null);
    } catch { return []; }
    return rows.slice(0, 3).map((b) => {
      const mun = muniLabel(undefined, b.cod_mun, ctx.munis);
      const desvio = Math.max(150, b.desvio_m ?? 1000);
      return {
        label: [titleCase(b.nome), mun.text].filter(Boolean).join(' · '), lat: round6(b.lat), lon: round6(b.lon),
        precisao: 'bairro' as const, desvio_m: Math.round(desvio), fonte: 'cnefe', metodo: 'medoide_bairro', bairro: titleCase(b.nome),
        municipio: mun.nome, uf: mun.uf, cod_ibge: b.cod_mun, aviso: avisoFor('bairro', desvio),
        score: Math.round((0.4 + 0.4 * b.sim) * weight * 1000) / 1000,
      };
    });
  }

  byMunicipio(m: Municipio): GeocodeResult {
    const desvio = Math.max(1000, Math.round(m.raio_m * 0.7));
    return {
      label: `${m.nome} - ${m.uf}`, lat: round6(m.lat), lon: round6(m.lon), precisao: 'municipio', desvio_m: desvio, fonte: 'ibge',
      metodo: 'ponto_interno_municipio', municipio: m.nome, uf: m.uf, cod_ibge: m.cod, aviso: avisoFor('municipio', desvio), score: 0.3,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// interpolação entre vizinhos do CNEFE
// ---------------------------------------------------------------------------------------------
/** Interpola o número n entre o vizinho menor e o maior (mesma paridade de preferência).
 *  gap = maior distância em números até um vizinho usado. */
export function interpCnefe<T extends { numero: number | null; lat: number; lon: number }>(n: number, pts: T[]): { pt: Pt; desvio: number; gap: number; ref: T } | undefined {
  const withNum = pts.filter((x) => x.numero !== null && x.numero !== n) as (T & { numero: number })[];
  if (!withNum.length) return undefined;
  const par = n % 2;
  const pickSide = (cmp: (x: number) => boolean, better: (a: number, b: number) => boolean) => {
    let same: (T & { numero: number }) | undefined;
    let any: (T & { numero: number }) | undefined;
    for (const x of withNum) {
      if (!cmp(x.numero)) continue;
      if (!any || better(x.numero, any.numero)) any = x;
      if (x.numero % 2 === par && (!same || better(x.numero, same.numero))) same = x;
    }
    // mesma paridade se não estiver muito mais longe que a outra
    if (same && any && Math.abs(same.numero - n) <= Math.abs(any.numero - n) + 60) return same;
    return any;
  };
  const lo = pickSide((x) => x < n, (a, b) => a > b);
  const hi = pickSide((x) => x > n, (a, b) => a < b);
  if (lo && hi) {
    const d = distM(lo, hi);
    const dn = hi.numero - lo.numero;
    // vizinhos coerentes? (numeração ~ metros; folga para quadras longas e numeração irregular)
    if (d <= 3 * dn + 250) {
      const t = (n - lo.numero) / dn;
      const pt = lerp(lo, hi, t);
      const gap = Math.max(n - lo.numero, hi.numero - n);
      const dmin = Math.min(distM(pt, lo), distM(pt, hi));
      return { pt, desvio: 15 + 0.35 * dmin, gap, ref: t < 0.5 ? lo : hi };
    }
  }
  // um lado só (ou vizinhos incoerentes): o mais próximo em número, se perto
  const near = [lo, hi].filter(Boolean).sort((a, b) => Math.abs(a!.numero - n) - Math.abs(b!.numero - n))[0];
  if (!near) return undefined;
  const gap = Math.abs(near.numero - n);
  if (gap > 120) return undefined;
  return { pt: { lat: near.lat, lon: near.lon }, desvio: 20 + gap, gap, ref: near };
}

/** Separa homônimos: agrupa os vizinhos por proximidade (ligação simples, raio em m) e interpola em cada grupo.
 *  Devolve um resultado por grupo, o grupo com mais endereços primeiro. */
export function interpClusters<T extends { numero: number | null; lat: number; lon: number }>(n: number, pts: T[], radius = 350):
  { pt: Pt; desvio: number; gap: number; ref: T; size: number }[] {
  const sorted = [...pts].sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
  const groups = clusters(sorted, radius);
  const out: { pt: Pt; desvio: number; gap: number; ref: T; size: number }[] = [];
  for (const g of groups) {
    const r = interpCnefe(n, g);
    if (r) out.push({ ...r, size: g.length });
  }
  return out.sort((a, b) => b.size - a.size);
}

function nearestByNumber<T extends { numero: number | null; lat: number; lon: number }>(n: number, pts: T[]): Pt | undefined {
  let best: T | undefined;
  for (const x of pts) if (x.numero !== null && (!best || Math.abs(x.numero - n) < Math.abs(best.numero! - n))) best = x;
  return best ? { lat: best.lat, lon: best.lon } : undefined;
}

function nearestRow<T extends Pt>(pt: Pt, rows: T[]): T | undefined {
  let best: T | undefined;
  let bd = Infinity;
  for (const r of rows) {
    const d = distM(pt, r);
    if (d < bd) { bd = d; best = r; }
  }
  return bd < 300 ? best : undefined;
}

/** agrupa pontos a menos de `radius` m (ligação simples com união dos grupos; listas de até ~1.000 pontos) */
function clusters<T extends Pt>(pts: T[], radius: number): T[][] {
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // filtro barato por grau antes da distância exata
  const dLat = radius / 111000;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.abs(pts[i].lat - pts[j].lat) > dLat || Math.abs(pts[i].lon - pts[j].lon) > dLat * 1.2) continue;
      if (distM(pts[i], pts[j]) <= radius) parent[find(i)] = find(j);
    }
  }
  const m = new Map<number, T[]>();
  pts.forEach((p, i) => { const r = find(i); m.set(r, [...(m.get(r) ?? []), p]); });
  return [...m.values()];
}

export function avisoFor(precisao: Precisao, desvio: number): string | undefined {
  switch (precisao) {
    case 'numero': return undefined;
    case 'numero_aproximado': return desvio > 60 ? 'Número aproximado: confira o portão no mapa' : undefined;
    case 'logradouro': return 'Só a rua foi encontrada: marque o ponto exato no mapa';
    case 'cep': return 'Centro do CEP: ajuste o ponto no mapa';
    case 'bairro': return 'Só o bairro foi encontrado: marque o ponto no mapa';
    case 'municipio': return 'Só a cidade foi encontrada: marque o ponto no mapa';
    case 'poi': return undefined;
  }
}

const RANK: Record<Precisao, number> = { numero: 0, numero_aproximado: 1, poi: 1, logradouro: 2, cep: 3, bairro: 4, municipio: 5 };
function bestRank(rs: GeocodeResult[]): number {
  return rs.reduce((m, r) => Math.min(m, r.precisao ? RANK[r.precisao] : 9), 9);
}

/** remove duplicatas (mesmo ponto a < 25 m e mesma precisão, ou mesmo rótulo) mantendo a de maior score */
export function dedupe(rs: GeocodeResult[]): GeocodeResult[] {
  const sorted = [...rs].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const out: GeocodeResult[] = [];
  for (const r of sorted) {
    if (out.some((o) => o.label === r.label || (o.precisao === r.precisao && distM(o, r) < 25))) continue;
    out.push(r);
  }
  return out;
}
