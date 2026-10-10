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
 *
 * Mesma balança em mais de uma fonte (ARTESP exata + DER-SP por rodovia/km, por exemplo): as entradas são juntadas
 * ANTES de filtrar o sentido, e o veredito do grupo é o da fonte de melhor posição. Assim a cópia aproximada de um posto
 * que o lado da via mostrou ser do outro sentido também sai da lista (antes ela sobrava como "não confirmado").
 * Nunca junta rótulos de sentido diferentes nem duas posições exatas que o lado da via põe em pistas opostas.
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
export function directionVerdict(sentido: string | null, bearing: number | null, side: number, exact: boolean, distM: number): { v: Verdict; como: string; porLado: boolean } {
  const s = (sentido ?? '').toLowerCase();
  if (s.includes('+') || s.includes('ambos')) return { v: 'sim', como: 'atende os dois sentidos', porLado: false };
  let label: 'a_favor' | 'contra' | null = null;
  if (s in CARD && bearing != null) {
    const c = Math.cos(((bearing - CARD[s]) * Math.PI) / 180);
    if (c >= 0.35) label = 'a_favor';
    else if (c <= -0.35) label = 'contra';
  }
  if (exact && distM >= SIDE_MIN_M) {
    const v: Verdict = side < 0 ? 'provavel' : 'nao';
    const disagree = (label === 'a_favor' && v === 'nao') || (label === 'contra' && v === 'provavel');
    return { v, como: SIDE_TXT + (disagree ? `; rótulo "${s}" ignorado (sentido nominal da rodovia)` : ''), porLado: true };
  }
  if (label === 'a_favor') return { v: 'provavel', como: `sentido "${s}" x rumo geral da rota`, porLado: false };
  if (label === 'contra') return { v: 'incerto', como: `rótulo "${s}" indica o outro sentido, mas é o sentido nominal da rodovia; posição sem lado definido`, porLado: false };
  return { v: 'incerto', como: sentido ? `sentido "${s}" sem referência de lado ou rumo` : 'sentido não informado pela fonte', porLado: false };
}

function sameDirectionLabel(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x.includes('+') || y.includes('+') || x.includes('ambos') || y.includes('ambos')) return true;
  return x === y;
}

type Cand = WeighOnRoute & { _rank: number; _porLado: boolean };
const rodNorm = (r: string | null) => (r ?? '').replace(/\W/g, '').toUpperCase();

/**
 * Duas entradas são o MESMO posto? Rótulos de sentido compatíveis; nunca duas decisões pelo lado da via que discordam
 * (um posto em cada pista); e perto: mesma rodovia com km da fonte a até 0,5 km (posição aproximada do DER-SP pode
 * cair 1–2 km ao lado) ou até 1 km ao longo da rota; rodovias diferentes/sem rodovia, até 400 m.
 */
function sameStation(k: Cand, c: Cand): boolean {
  if (!sameDirectionLabel(k.sentido, c.sentido)) return false;
  if (k._porLado && c._porLado && (k.no_sentido === 'nao') !== (c.no_sentido === 'nao')) return false;
  const dRota = Math.abs(k.km_rota - c.km_rota);
  const sameRod = !!k.rodovia && rodNorm(k.rodovia) === rodNorm(c.rodovia);
  if (!sameRod) return dRota <= 0.4;
  if (k.km != null && c.km != null && Math.abs(Number(k.km) - Number(c.km)) <= 0.5 && dRota <= 3) return true;
  return dRota <= 1.0;
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
    const cands: Cand[] = [];
    for (const r of rows) {
      const p = r.props as Props;
      const pt = (r.geometry as GeoJSON.Point).coordinates as [number, number];
      const g = geometryAt(line, lenKm, r.fraction, pt);
      const exact = p.precisao === 'exata';
      const { v, como, porLado } = directionVerdict(p.sentido ?? null, g.bearing, g.side, exact, r.distance_m);
      // posição aproximada (rodovia+km) longe da linha: provavelmente outra via paralela
      if (!exact && r.distance_m > 120) continue;
      cands.push({
        id: r.id, nome: r.name ?? 'Balança', tipo: KIND[r.kind ?? 'outro'] ?? 'outro',
        km_rota: Math.round(r.fraction * route.distance_km * 10) / 10,
        lat: pt[1], lon: pt[0], rodovia: p.rodovia ?? null, km: p.km != null && Number.isFinite(Number(p.km)) ? Number(p.km) : null, sentido: p.sentido ?? null,
        no_sentido: v, como, distancia_m: Math.round(r.distance_m * 10) / 10,
        lado: r.distance_m >= 1 ? (g.side < 0 ? 'direita' : 'esquerda') : null,
        administrador: p.administrador ?? null, precisao: p.precisao ?? null, fontes: [r.source],
        disponibilidade_pct: p.disponibilidade_pct ?? null, disponibilidade_ref: p.disponibilidade_ref ?? null,
        _rank: rank(r), _porLado: porLado,
      });
    }
    // mesma balança em mais de uma fonte: junta ANTES de filtrar o sentido (ver sameStation). Posição/nome vêm da fonte de
    // melhor posição; o sentido, se ela não decide, vem da outra fonte DO MESMO posto, com a fonte indicada.
    const groups: { best: Cand; members: Cand[] }[] = [];
    for (const c of [...cands].sort((a, b) => a.km_rota - b.km_rota)) {
      const g = groups.find((x) => x.members.every((m) => sameStation(m, c)));
      if (g) { g.members.push(c); if (c._rank < g.best._rank) g.best = c; } else groups.push({ best: c, members: [c] });
    }
    const merged: Cand[] = groups.map(({ best, members }) => {
      const others = members.filter((m) => m !== best).sort((a, b) => a._rank - b._rank);
      const out: Cand = { ...best, fontes: [...new Set(members.flatMap((m) => m.fontes))], sentido: best.sentido ?? others.find((o) => o.sentido)?.sentido ?? null };
      if (out.tipo !== 'fixa' && others.some((o) => o.tipo === 'fixa')) out.tipo = 'fixa';
      const decisive = others.find((o) => o.no_sentido !== 'incerto');
      if (best.no_sentido === 'incerto' && decisive) {
        out.no_sentido = decisive.no_sentido;
        out.como = `${decisive.como} (pela posição na fonte ${decisive.fontes.join('/')})`;
      }
      return out;
    });
    const opposite = merged.filter((c) => c.no_sentido === 'nao').length;
    const kept = merged.filter((c) => c.no_sentido !== 'nao');
    const list: WeighOnRoute[] = kept.map(({ _rank, _porLado, ...k }) => k);

    const summary: string[] = [];
    const warnings: LayerWarning[] = [];
    const confirmed = list.filter((b) => b.no_sentido !== 'incerto');
    const unsure = list.length - confirmed.length;
    const unsureTxt = unsure ? `${unsure} com sentido não confirmado (posição aproximada ou sentido não informado pela fonte)` : '';
    if (!list.length) {
      summary.push('Nenhuma balança conhecida no sentido da rota.');
    } else {
      if (confirmed.length) {
        const fixas = confirmed.filter((b) => b.tipo === 'fixa').length;
        const moveis = confirmed.filter((b) => b.tipo === 'movel').length;
        const wim = confirmed.filter((b) => b.tipo === 'hs_wim').length;
        const outros = confirmed.length - fixas - moveis - wim;
        const parts = [fixas && `${fixas} fixa(s)`, moveis && `${moveis} ponto(s) de pesagem móvel`, wim && `${wim} HS-WIM`, outros && `${outros} sem tipo`].filter(Boolean);
        summary.push(`${confirmed.length} balança(s) no sentido da rota: ${parts.join(', ')}${unsure ? `; e mais ${unsureTxt}` : ''}.`);
      } else {
        summary.push(`Nenhuma balança confirmada no sentido da rota; ${unsureTxt}:`);
      }
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
    const omitted = merged.filter((c) => c.no_sentido === 'nao').map((c) => ({ id: c.id, nome: c.nome, km_rota: c.km_rota, fontes: c.fontes, como: c.como }));
    return { summary, warnings, data: { balancas: list, sentido_oposto_omitidas: opposite, omitidas_outro_sentido: omitted } };
  },
};

export default layer;
