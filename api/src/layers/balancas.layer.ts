import * as turf from '@turf/turf';
import { featuresInBbox, featuresNearRoute, type NearRouteRow } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Balanças (pesagem veicular): PPV das concessões federais (ANTT), PGF/PPM das concessões estaduais de SP (ARTESP, KMZ)
 * e pontos de pesagem do DER-SP. Só INFORMA as balanças no sentido da rota. Nunca sugere desvio: deixar de entrar na
 * área de pesagem é infração grave (CTB art. 209, redação da Lei 14.157/2021). Por isso a camada não tem
 * exclusions/costLines e não calcula rota alternativa.
 *
 * Sentido (directionVerdict):
 *  1. posição exata a ≥ SIDE_MIN_M da rota: decide o LADO da via (no Brasil o posto fica à direita de quem ele
 *     fiscaliza); se o rótulo da fonte discordar, o rótulo é ignorado;
 *  2. senão, o rótulo norte/sul/leste/oeste (sentido NOMINAL da rodovia) é comparado com o rumo geral da rota (corda
 *     de ±LABEL_BASE_KM em torno do ponto, não o rumo local). Rótulo a favor = "provável"; rótulo contra NÃO omite
 *     a balança: o sentido nominal pode não bater com o rumo geográfico (SP-332 km 44,5: a via corre a 229° no
 *     sentido norte), então ela é listada como "sentido não confirmado";
 *  3. "crescente/decrescente" (ANTT) só pelo lado. Sem lado nem rótulo, "não confirmado".
 * Só a regra 1 omite balança ("outro sentido").
 */
const ID = 'balancas';
const NEAR_M = 300;
/** distância mínima da rota para o lado da via valer (abaixo disso o ponto pode estar no próprio eixo) */
const SIDE_MIN_M = 12;
/** meia-base da corda usada para o rumo geral da rota ao comparar com o rótulo cardinal */
const LABEL_BASE_KM = 4;
const SRC_RANK: Record<string, number> = { antt: 0, artesp: 1, 'der-sp': 2 };
const CARD: Record<string, number> = { norte: 0, leste: 90, sul: 180, oeste: 270 };

type Props = Record<string, any>;
type Verdict = 'sim' | 'provavel' | 'incerto' | 'nao';

export interface WeighOnRoute {
  id: string;
  nome: string;
  tipo: 'fixa' | 'movel' | 'hs_wim' | 'outro';
  km_rota: number;
  lat: number;
  lon: number;
  rodovia: string | null;
  km: number | null;
  sentido: string | null;
  no_sentido: Verdict;
  como: string;
  /** distância do ponto à rota e lado (direita/esquerda de quem segue a rota) */
  distancia_m: number;
  lado: 'direita' | 'esquerda' | null;
  administrador: string | null;
  precisao: string | null;
  fontes: string[];
  disponibilidade_pct?: number | null;
  disponibilidade_ref?: string | null;
}

const KIND: Record<string, WeighOnRoute['tipo']> = { fixo: 'fixa', movel: 'movel', hs_wim: 'hs_wim', outro: 'outro' };
const KIND_TXT: Record<WeighOnRoute['tipo'], string> = {
  fixa: 'fixa', movel: 'pesagem móvel, operação eventual', hs_wim: 'pesagem em movimento (HS-WIM)', outro: 'tipo não informado',
};

function toXY(c: number[], lat0: number): [number, number] {
  return [c[0] * 111320 * Math.cos((lat0 * Math.PI) / 180), c[1] * 110540];
}

/** Rumo geral da rota em torno da fração f (corda de ±LABEL_BASE_KM) e lado do ponto (+1 esquerda, −1 direita). */
function geometryAt(line: GeoJSON.Feature<GeoJSON.LineString>, lenKm: number, f: number, pt: [number, number]) {
  const at = f * lenKm;
  const a = turf.along(line, Math.max(0, at - LABEL_BASE_KM), { units: 'kilometers' });
  const b = turf.along(line, Math.min(lenKm, at + LABEL_BASE_KM), { units: 'kilometers' });
  const brg = (turf.bearing(a, b) + 360) % 360;
  const np = turf.nearestPointOnLine(line, turf.point(pt));
  const coords = line.geometry.coordinates;
  const i = Math.min(Math.max(0, np.properties.index ?? 0), coords.length - 2);
  const lat0 = pt[1];
  const [ax, ay] = toXY(coords[i], lat0), [bx, by] = toXY(coords[i + 1], lat0), [px, py] = toXY(pt, lat0);
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  return { bearing: brg, side: cross > 0 ? 1 : -1 };
}

const SIDE_TXT = 'lado da via (posto à direita de quem ele fiscaliza)';

/**
 * Sentido da balança em relação à rota. `bearing` = rumo geral da rota no trecho (corda longa), `side` = +1 esquerda /
 * −1 direita, `exact` = posição exata na fonte, `distM` = distância do ponto à rota.
 */
export function directionVerdict(sentido: string | null, bearing: number | null, side: number, exact: boolean, distM: number): { v: Verdict; como: string } {
  const s = (sentido ?? '').toLowerCase();
  if (s.includes('+') || s.includes('ambos')) return { v: 'sim', como: 'atende os dois sentidos' };
  let label: 'a_favor' | 'contra' | null = null;
  if (s in CARD && bearing != null) {
    const c = Math.cos(((bearing - CARD[s]) * Math.PI) / 180);
    if (c >= 0.35) label = 'a_favor';
    else if (c <= -0.35) label = 'contra';
  }
  if (exact && distM >= SIDE_MIN_M) {
    const v: Verdict = side < 0 ? 'provavel' : 'nao';
    const disagree = (label === 'a_favor' && v === 'nao') || (label === 'contra' && v === 'provavel');
    return { v, como: SIDE_TXT + (disagree ? `; rótulo "${s}" ignorado (sentido nominal da rodovia)` : '') };
  }
  if (label === 'a_favor') return { v: 'provavel', como: `sentido "${s}" x rumo geral da rota` };
  if (label === 'contra') return { v: 'incerto', como: `rótulo "${s}" indica o outro sentido, mas é o sentido nominal da rodovia; posição sem lado definido` };
  return { v: 'incerto', como: sentido ? `sentido "${s}" sem referência de lado ou rumo` : 'sentido não informado pela fonte' };
}

function sameDirectionLabel(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x.includes('+') || y.includes('+') || x.includes('ambos') || y.includes('ambos')) return true;
  return x === y;
}

function rank(r: NearRouteRow): number {
  const p = r.props as Props;
  return (p.precisao === 'exata' ? 0 : 10) + (SRC_RANK[r.source] ?? 5) + (r.kind === 'fixo' ? 0 : 0.5);
}

const layer: RouteLayer = {
  meta: {
    id: ID,
    label: 'Balanças',
    description: 'Postos de pesagem (fixos, móveis e HS-WIM) no sentido da rota. Entrada obrigatória quando sinalizada aberta (CTB art. 209).',
    group: 'infraestrutura',
    sources: [
      { name: 'ANTT: PPV e operação dos postos (dados.antt.gov.br)', url: 'https://dados.antt.gov.br/dataset/ppv', license: 'CC-BY' },
      { name: 'ARTESP: malha rodoviária por lote, Sistema de Pesagem (KMZ)', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria', license: 'CC-BY' },
      { name: 'DER-SP: pontos para pesagem de veículos + camada Balancas_DER', url: 'https://www.der.sp.gov.br/der/rodovias/balanca/pontos_de_pesagem', license: 'Não declarada (portal cms.sp.gov.br: todos os direitos reservados)' },
    ],
    style: { kind: 'circle', color: '#0891b2', radius: 6, minzoom: 7, icon: '⚖️' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 7) return { type: 'FeatureCollection', features: [] };
    // DER-SP repete postos que a ANTT/ARTESP já publicam com posição exata: esconde o repetido
    const rows = await featuresInBbox(ID, bbox, {
      limit: 3000,
      where: `source <> 'der-sp' or not exists (select 1 from data_features o where o.layer_id = 'balancas' and o.source <> 'der-sp'
               and ST_DWithin(o.geom::geography, data_features.geom::geography, 500))`,
    });
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = r.props as Props;
        const tipo = KIND[r.kind ?? 'outro'] ?? 'outro';
        return {
          type: 'Feature' as const, id: r.id, geometry: r.geometry,
          properties: {
            id: r.id, name: r.name, tipo: KIND_TXT[tipo], rodovia: p.rodovia ?? null, km: p.km ?? null, sentido: p.sentido ?? null,
            administrador: p.administrador ?? null,
            posicao: p.precisao === 'aprox_km' ? `aproximada (rodovia + km, ±${p.erro_km_estimado ?? '?'} km)` : 'exata',
            disponibilidade: p.disponibilidade_pct != null ? `${p.disponibilidade_pct}% do tempo operando (${p.disponibilidade_ref})` : null,
            fonte: r.source,
          },
        };
      }),
    };
  },

  async annotate(_ctx, route) {
    const line = route.line;
    const lenKm = turf.length(line, { units: 'kilometers' });
    const rows = await featuresNearRoute(ID, line.geometry, NEAR_M, { limit: 1000 });
    const cands: (WeighOnRoute & { _rank: number })[] = [];
    for (const r of rows) {
      const p = r.props as Props;
      const pt = (r.geometry as GeoJSON.Point).coordinates as [number, number];
      const g = geometryAt(line, lenKm, r.fraction, pt);
      const exact = p.precisao === 'exata';
      const { v, como } = directionVerdict(p.sentido ?? null, g.bearing, g.side, exact, r.distance_m);
      // posição aproximada (rodovia+km) longe da linha: provavelmente outra via paralela
      if (!exact && r.distance_m > 120) continue;
      cands.push({
        id: r.id, nome: r.name ?? 'Balança', tipo: KIND[r.kind ?? 'outro'] ?? 'outro',
        km_rota: Math.round(r.fraction * route.distance_km * 10) / 10,
        lat: pt[1], lon: pt[0], rodovia: p.rodovia ?? null, km: p.km ?? null, sentido: p.sentido ?? null,
        no_sentido: v, como, distancia_m: Math.round(r.distance_m * 10) / 10,
        lado: r.distance_m >= 1 ? (g.side < 0 ? 'direita' : 'esquerda') : null,
        administrador: p.administrador ?? null, precisao: p.precisao ?? null, fontes: [r.source],
        disponibilidade_pct: p.disponibilidade_pct ?? null, disponibilidade_ref: p.disponibilidade_ref ?? null,
        _rank: rank(r),
      });
    }
    const opposite = cands.filter((c) => c.no_sentido === 'nao').length;
    // mesma balança em mais de uma fonte: junta (mesma rodovia até 1 km, senão 400 m ao longo da rota). Nunca junta
    // balanças com rótulos de sentido diferentes (par "norte"/"sul" no mesmo km = dois postos, um em cada pista).
    const kept: (WeighOnRoute & { _rank: number })[] = [];
    for (const c of cands.filter((x) => x.no_sentido !== 'nao').sort((a, b) => a.km_rota - b.km_rota)) {
      const prev = kept.find((k) => {
        if (!sameDirectionLabel(k.sentido, c.sentido)) return false;
        const sameRod = k.rodovia && c.rodovia && k.rodovia.replace(/\W/g, '') === c.rodovia.replace(/\W/g, '');
        return Math.abs(k.km_rota - c.km_rota) <= (sameRod ? 1.0 : 0.4);
      });
      if (!prev) { kept.push(c); continue; }
      // posição/nome da fonte de melhor posição; o sentido, se ela não decide, vem da outra fonte DO MESMO posto
      // (rótulos compatíveis, ver acima), com a fonte indicada
      const [best, other] = c._rank < prev._rank ? [c, prev] : [prev, c];
      const merged = { ...best, fontes: [...new Set([...best.fontes, ...other.fontes])], sentido: best.sentido ?? other.sentido };
      if (best.tipo !== 'fixa' && other.tipo === 'fixa') merged.tipo = 'fixa';
      if (best.no_sentido === 'incerto' && other.no_sentido !== 'incerto') {
        merged.no_sentido = other.no_sentido;
        merged.como = `${other.como} (pela posição na fonte ${other.fontes.join('/')})`;
      }
      kept[kept.indexOf(prev)] = merged;
    }
    const list: WeighOnRoute[] = kept.map(({ _rank, ...k }) => k);

    const summary: string[] = [];
    const warnings: LayerWarning[] = [];
    if (!list.length) {
      summary.push('Nenhuma balança conhecida no sentido da rota.');
    } else {
      const fixas = list.filter((b) => b.tipo === 'fixa').length;
      const moveis = list.filter((b) => b.tipo === 'movel').length;
      const wim = list.filter((b) => b.tipo === 'hs_wim').length;
      const outros = list.length - fixas - moveis - wim;
      const parts = [fixas && `${fixas} fixa(s)`, moveis && `${moveis} ponto(s) de pesagem móvel`, wim && `${wim} HS-WIM`, outros && `${outros} sem tipo`].filter(Boolean);
      summary.push(`${list.length} balança(s) no sentido da rota: ${parts.join(', ')}.`);
      for (const b of list.slice(0, 10)) {
        const tipo = b.tipo === 'movel' && /m[oó]vel/i.test(b.nome) ? 'operação eventual' : KIND_TXT[b.tipo];
        summary.push(`• km ${Math.round(b.km_rota)}: ${b.nome} — ${tipo}${b.no_sentido === 'incerto' ? ' · sentido não confirmado' : ''}`);
      }
      if (list.length > 10) summary.push(`• … mais ${list.length - 10}; ver dados da camada.`);
      summary.push('Balança sinalizada como aberta: entre na área de pesagem. Deixar de entrar é infração grave (CTB art. 209).');
    }
    for (const b of list.filter((x) => (x.tipo === 'fixa' || x.tipo === 'hs_wim') && x.no_sentido !== 'incerto').slice(0, 5)) {
      warnings.push({
        code: 'weigh_station', severity: 'info', id: b.id, lat: b.lat, lon: b.lon,
        message: `Balança ${b.tipo === 'hs_wim' ? 'com pesagem em movimento' : 'fixa'} no km ${Math.round(b.km_rota)} da rota: ${b.nome}. Entre se estiver sinalizada aberta (CTB art. 209).`,
      });
    }
    return { summary, warnings, data: { balancas: list, sentido_oposto_omitidas: opposite } };
  },
};

export default layer;
