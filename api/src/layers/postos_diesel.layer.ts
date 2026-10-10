import { DateTime } from 'luxon';
import { featuresInBbox, featuresNearRoute, type NearRouteRow } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Postos que vendem diesel, com o preço do Levantamento de Preços de Combustíveis da ANP (LPC, últimas 4 semanas).
 * Chave CNPJ (cadastro de revendedores da ANP); posição pelo PMQC da ANP ou, na falta, casada com o OSM (≤ 100 m).
 * Informativa: não muda a rota. annotate() lista os 5 postos com diesel S10 mais barato a até 2 km da rota, com preço,
 * data da coleta e desvio aproximado, e a média do trecho. Atribuição obrigatória (CC-BY): "Fonte: ANP".
 * Ver docs/layers/postos_diesel.md (alcance: SP, RJ, MG e ES).
 */
const ID = 'postos_diesel';
export const NEAR_M = 2000;
export const TOP_N = 5;
/** desvio ≈ ida e volta até o posto × fator de sinuosidade da malha (linha reta → caminho real) */
const DETOUR_FACTOR = 1.4;
/** preço mais velho que isso (dias antes da saída) ganha aviso de "pode estar desatualizado" */
const STALE_DAYS = 28;

interface Preco { valor: number; data: string }
type Props = Record<string, any> & { diesel_s10?: Preco | null; diesel_s500?: Preco | null };

export interface PostoOnRoute {
  id: string;
  nome: string;
  bandeira: string | null;
  cnpj: string;
  municipio: string | null;
  uf: string | null;
  endereco: string | null;
  diesel_s10: Preco | null;
  diesel_s500: Preco | null;
  km_rota: number;
  distancia_m: number;
  /** desvio aproximado ida e volta (km) — estimativa por linha reta × 1,4 */
  desvio_km: number;
  posicao: string;
  aceita_caminhao: string | null;
  lat: number;
  lon: number;
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const dmy = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '?');
const POS_TXT: Record<string, string> = {
  pmqc: 'coordenada do PMQC (ANP)',
  'cnefe+osm': 'endereço (CNEFE/IBGE) casado com posto do OSM a ≤ 100 m',
  osm_endereco: 'posto do OSM com o mesmo endereço',
};

function hgvTxt(p: Props): string | null {
  const o = p.osm;
  if (!o) return null;
  if (o.hgv_diesel === 'yes') return 'bomba de diesel para caminhão (OSM)';
  if (o.hgv === 'yes' || o.hgv === 'designated') return 'acesso de caminhão (OSM)';
  if (o.hgv === 'no') return 'sem acesso de caminhão (OSM)';
  return null;
}

export function toPosto(r: NearRouteRow, distanceKm: number): PostoOnRoute {
  const p = r.props as Props;
  const pt = (r.geometry as GeoJSON.Point).coordinates;
  const d = r.distance_m;
  return {
    id: r.id, nome: r.name ?? 'Posto', bandeira: p.bandeira ?? null, cnpj: p.cnpj, municipio: p.municipio ?? null, uf: p.uf ?? null,
    endereco: p.endereco ?? null, diesel_s10: p.diesel_s10 ?? null, diesel_s500: p.diesel_s500 ?? null,
    km_rota: Math.round(r.fraction * distanceKm * 10) / 10, distancia_m: Math.round(d),
    desvio_km: d < 150 ? 0 : Math.round((2 * d * DETOUR_FACTOR) / 100) / 10,
    posicao: POS_TXT[p.coord_fonte] ?? p.coord_fonte ?? '?', aceita_caminhao: hgvTxt(p), lat: pt[1], lon: pt[0],
  };
}

/** Os N mais baratos de um produto (empate: menor desvio, depois o primeiro na rota). */
export function cheapest(list: PostoOnRoute[], prod: 'diesel_s10' | 'diesel_s500', n = TOP_N): PostoOnRoute[] {
  return list.filter((x) => x[prod]).sort((a, b) => a[prod]!.valor - b[prod]!.valor || a.desvio_km - b.desvio_km || a.km_rota - b.km_rota).slice(0, n);
}

function stats(list: PostoOnRoute[], prod: 'diesel_s10' | 'diesel_s500') {
  const v = list.map((x) => x[prod]).filter((x): x is Preco => !!x);
  if (!v.length) return null;
  const vals = v.map((x) => x.valor).sort((a, b) => a - b);
  const datas = v.map((x) => x.data).sort();
  return {
    postos: v.length,
    media: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000,
    minimo: vals[0], maximo: vals[vals.length - 1],
    coleta_de: datas[0], coleta_ate: datas[datas.length - 1],
  };
}

const layer: RouteLayer = {
  meta: {
    id: ID,
    label: 'Postos com diesel (preço ANP)',
    description: 'Postos que vendem diesel S10/S500 com o preço do Levantamento de Preços da ANP (últimas 4 semanas, com a data da coleta). '
      + 'Na rota: os 5 mais baratos a até 2 km e a média do trecho. Fonte: ANP.',
    group: 'custos',
    sources: [
      { name: 'Fonte: ANP — Levantamento de Preços de Combustíveis (LPC), últimas 4 semanas (diesel S10 e S500)', url: 'https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas', license: 'CC-BY (dados.gov.br)' },
      { name: 'Fonte: ANP — Cadastro de revendedores varejistas de combustíveis (CNPJ, endereço, bandeira)', url: 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/dados-cadastrais-dos-revendedores-varejistas-de-combustiveis-automotivos', license: 'CC-BY (dados.gov.br)' },
      { name: 'Fonte: ANP — PMQC (coordenadas dos postos amostrados)', url: 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/pmqc-programa-de-monitoramento-da-qualidade-dos-combustiveis', license: 'CC-BY (dados.gov.br)' },
      { name: 'OpenStreetMap — amenity=fuel (posição de parte dos postos e acesso de caminhão)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0 (© colaboradores do OpenStreetMap)' },
      { name: 'IBGE — CNEFE 2022 (endereço → ponto, só para casar o posto com o OSM)', url: 'https://www.ibge.gov.br/estatisticas/sociais/populacao/38734-cadastro-nacional-de-enderecos-para-fins-estatisticos.html', license: 'Dados públicos IBGE (citar a fonte)' },
    ],
    style: { kind: 'circle', color: '#ea580c', radius: 5, minzoom: 9, icon: '⛽' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 12;
    if (z < 9) return { type: 'FeatureCollection', features: [] };
    const rows = await featuresInBbox(ID, bbox, { limit: 3000, where: z < 11 ? `kind = 'com_preco'` : undefined });
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = r.props as Props;
        return {
          type: 'Feature' as const, id: r.id, geometry: r.geometry,
          properties: {
            id: r.id, name: r.name, icon: '⛽', color: r.kind === 'com_preco' ? '#ea580c' : '#fdba74',
            bandeira: p.bandeira ?? null,
            diesel_s10: p.diesel_s10 ? `${brl(p.diesel_s10.valor)} (coleta ${dmy(p.diesel_s10.data)})` : null,
            diesel_s500: p.diesel_s500 ? `${brl(p.diesel_s500.valor)} (coleta ${dmy(p.diesel_s500.data)})` : null,
            endereco: p.endereco ?? null, municipio: p.municipio ? `${p.municipio}/${p.uf}` : null,
            caminhao: hgvTxt(p), cnpj: p.cnpj, posicao: POS_TXT[p.coord_fonte] ?? p.coord_fonte ?? null,
            fonte: 'Fonte: ANP (LPC, cadastro e PMQC)' + (p.coord_fonte && p.coord_fonte !== 'pmqc' ? ' · posição © OpenStreetMap' : ''),
          },
        };
      }),
    };
  },

  async annotate(ctx, route) {
    const rows = await featuresNearRoute(ID, route.line.geometry, NEAR_M, { limit: 3000, where: `f.kind = 'com_preco'` });
    const list = rows.map((r) => toPosto(r, route.distance_km));
    const s10 = stats(list, 'diesel_s10');
    const s500 = stats(list, 'diesel_s500');
    const top10 = cheapest(list, 'diesel_s10');
    const top500 = cheapest(list, 'diesel_s500');
    const summary: string[] = [];
    const warnings: LayerWarning[] = [];
    if (!list.length) {
      summary.push('Nenhum posto com preço de diesel do levantamento da ANP a até 2 km da rota (o levantamento é amostral; ver alcance na documentação).');
      return { summary, warnings, data: { postos_com_preco: 0, mais_baratos_s10: [], mais_baratos_s500: [], media_s10: null, media_s500: null } };
    }
    if (s10) summary.push(`Diesel S10 a até 2 km da rota: média ${brl(s10.media)} (${s10.postos} posto(s), de ${brl(s10.minimo)} a ${brl(s10.maximo)}).`);
    if (s500) summary.push(`Diesel S500: média ${brl(s500.media)} (${s500.postos} posto(s)).`);
    const top = top10.length ? top10 : top500;
    const prod: 'diesel_s10' | 'diesel_s500' = top10.length ? 'diesel_s10' : 'diesel_s500';
    summary.push(`Mais baratos (${prod === 'diesel_s10' ? 'S10' : 'S500'}):`);
    for (const x of top) {
      const pr = x[prod]!;
      summary.push(`• km ${Math.round(x.km_rota)}: ${brl(pr.valor)} — ${x.nome}${x.bandeira ? ` (${x.bandeira})` : ''}, ${x.municipio ?? ''} · coleta ${dmy(pr.data)} · ${x.desvio_km ? `desvio ~${String(x.desvio_km).replace('.', ',')} km` : 'na rota'}`);
    }
    const ultima = [s10?.coleta_ate, s500?.coleta_ate].filter(Boolean).sort().pop() as string | undefined;
    const primeira = [s10?.coleta_de, s500?.coleta_de].filter(Boolean).sort()[0] as string | undefined;
    summary.push(`Fonte: ANP — Levantamento de Preços de Combustíveis, coletas de ${dmy(primeira)} a ${dmy(ultima)}. Preço de bomba na data da coleta; confira no posto.`);
    const dep = DateTime.fromJSDate(ctx.at).setZone(ctx.tz);
    if (ultima && dep.diff(DateTime.fromISO(ultima, { zone: ctx.tz }), 'days').days > STALE_DAYS) {
      warnings.push({ code: 'diesel_price_stale', severity: 'info', message: `Os preços de diesel da ANP mais recentes nesta rota são de ${dmy(ultima)} (mais de ${STALE_DAYS} dias antes da saída): podem estar desatualizados.` });
    }
    return {
      summary, warnings,
      data: {
        postos_com_preco: list.length,
        media_s10: s10, media_s500: s500,
        mais_baratos_s10: top10, mais_baratos_s500: top500,
        raio_m: NEAR_M,
        desvio: 'aproximado: 2 × distância em linha reta até a rota × 1,4',
        fonte: 'Fonte: ANP',
      },
    };
  },
};

export default layer;
