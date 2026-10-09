import { DateTime } from 'luxon';
import { featuresInBbox, featuresNearRoute, type DataFeatureRow, type NearRouteRow } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Pontos críticos de acidentes com caminhão (Infosiga SP, ARTESP e PRF), agregados pelos importadores numa grade de 250 m
 * com janela de 3 anos e mínimo de 3 acidentes com caminhão por célula. Nenhum registro individual chega à API.
 * A camada é INFORMATIVA: não muda a rota; avisa dos trechos críticos que a rota atravessa (top N) e resume a contagem.
 * Ver docs/layers/acidentes.md.
 */
const LAYER = 'acidentes';
/** distância máxima (m) entre o ponto crítico (centro dos acidentes da célula) e a linha da rota */
export const NEAR_M = 80;
/** pontos críticos a até CLUSTER_KM uns dos outros, ao longo da rota, formam um só trecho */
const CLUSTER_KM = 1;
/** um trecho não passa deste comprimento (trechos longos de rodovia viram vários avisos localizados) */
const MAX_TRECHO_KM = 3;
/** quantos trechos críticos viram aviso */
export const TOP_N = 5;
/** score em que a célula já é "muito alto" (igual a NIVEL_MUITO_ALTO do importador); usado para normalizar o peso do heatmap */
const SCORE_MAX = 15;

type Nivel = 'muito_alto' | 'alto' | 'moderado';
const NIVEL_ORDEM: Record<Nivel, number> = { muito_alto: 3, alto: 2, moderado: 1 };
const NIVEL_LABEL: Record<Nivel, string> = { muito_alto: 'muito alto', alto: 'alto', moderado: 'moderado' };
const FAIXAS = ['madrugada', 'manha', 'tarde', 'noite'] as const;
type Faixa = (typeof FAIXAS)[number];
const FAIXA_LABEL: Record<Faixa, string> = { madrugada: 'de madrugada', manha: 'de manhã', tarde: 'à tarde', noite: 'à noite' };

interface HotspotProps {
  cell: string;
  fonte?: string;
  via?: string | null;
  municipio?: string | null;
  total: number;
  fatais: number;
  caminhao: number;
  caminhao_vitima: number;
  caminhao_fatais: number;
  obitos: number;
  caminhao_moto?: number;
  caminhao_pedestre?: number;
  periodo: Record<Faixa, number>;
  pico: Faixa | null;
  score: number;
  nivel: Nivel;
  janela: { de: string; ate: string };
}

const props = (r: DataFeatureRow) => r.props as unknown as HotspotProps;
const nivelOf = (r: DataFeatureRow): Nivel => (props(r).nivel ?? r.kind ?? 'moderado') as Nivel;
const faixaOf = (hour: number): Faixa => FAIXAS[Math.floor(hour / 6)];
const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace('.', ',');
const fmtDate = (iso?: string) => (iso ? DateTime.fromISO(iso).toFormat('MM/yyyy') : '?');
const fmtRange = (a: number, b: number) => (b - a >= 1 ? `${fmtKm(a)}–${fmtKm(b)}` : fmtKm(a));

function label(p: HotspotProps, fallback: string | null): string {
  if (p.via) {
    if (!p.municipio) return p.via;
    const uf = p.via.match(/\/([A-Z]{2})$/);      // PRF: "Dutra (BR-116) km 219/SP" -> "Dutra (BR-116) km 219, Guarulhos/SP"
    return uf ? `${p.via.slice(0, -3)}, ${p.municipio}/${uf[1]}` : `${p.via}, ${p.municipio}`;
  }
  if (p.municipio) return `trecho em ${p.municipio}`;
  return fallback ?? 'trecho sem nome';
}

interface Trecho {
  id: string;
  name: string;
  nivel: Nivel;
  score: number;
  pontos: number;
  caminhao: number;
  caminhao_vitima: number;
  caminhao_fatais: number;
  obitos: number;
  periodo: Record<Faixa, number>;
  pico: Faixa | null;
  km_inicio: number;
  km_fim: number;
  /** horário local aproximado de passagem (HH:mm), proporcional à distância */
  passagem: string;
  faixa_passagem: Faixa;
  fontes: string[];
  lat: number;
  lon: number;
}

/** Agrupa pontos críticos consecutivos (ordenados pela posição na rota) em trechos. */
function cluster(rows: NearRouteRow[], distanceKm: number, eta: (fraction: number) => DateTime): Trecho[] {
  const out: Trecho[] = [];
  let cur: { rows: NearRouteRow[]; first: number; last: number } | null = null;
  const close = () => {
    if (!cur) return;
    const rs = cur.rows;
    const best = rs.reduce((a, b) => (props(b).score > props(a).score ? b : a));
    const bp = props(best);
    const periodo = Object.fromEntries(FAIXAS.map((f) => [f, rs.reduce((s, r) => s + (props(r).periodo?.[f] ?? 0), 0)])) as Record<Faixa, number>;
    const pico = FAIXAS.some((f) => periodo[f] > 0) ? FAIXAS.reduce((a, b) => (periodo[b] > periodo[a] ? b : a)) : null;
    const sum = (k: keyof HotspotProps) => rs.reduce((s, r) => s + Number(props(r)[k] ?? 0), 0);
    const t0 = eta(rs[0].fraction);
    const coords = (best.geometry as GeoJSON.Point).coordinates;
    out.push({
      id: best.id,
      name: label(bp, best.name),
      nivel: rs.map(nivelOf).reduce((a, b) => (NIVEL_ORDEM[b] > NIVEL_ORDEM[a] ? b : a)),
      score: Math.round(sum('score') * 10) / 10,
      pontos: rs.length,
      caminhao: sum('caminhao'),
      caminhao_vitima: sum('caminhao_vitima'),
      caminhao_fatais: sum('caminhao_fatais'),
      obitos: sum('obitos'),
      periodo,
      pico,
      km_inicio: Math.round(rs[0].fraction * distanceKm * 10) / 10,
      km_fim: Math.round(rs[rs.length - 1].fraction * distanceKm * 10) / 10,
      passagem: t0.toFormat('HH:mm'),
      faixa_passagem: faixaOf(t0.hour),
      fontes: [...new Set(rs.map((r) => r.source))],
      lon: coords[0],
      lat: coords[1],
    });
    cur = null;
  };
  for (const r of rows) {
    const km = r.fraction * distanceKm;
    if (cur && (km - cur.last > CLUSTER_KM || km - cur.first > MAX_TRECHO_KM)) close();
    if (!cur) cur = { rows: [], first: km, last: km };
    cur.rows.push(r);
    cur.last = km;
  }
  close();
  return out;
}

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Acidentes com caminhão',
    description: 'Pontos críticos de acidentes com caminhão nos últimos 3 anos (grade de 250 m; SP e rodovias federais).',
    group: 'seguranca',
    sources: [
      { name: 'Infosiga SP (Detran-SP)', url: 'https://infosiga.detran.sp.gov.br/', license: 'Dados abertos Detran-SP (uso e redistribuição livres com atribuição e mesmos termos de abertura)' },
      { name: 'ARTESP — acidentes nas rodovias concedidas', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/acidentes', license: 'CC-BY' },
      { name: 'PRF — acidentes nas rodovias federais', url: 'https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf', license: 'Dados abertos PRF (sem restrição de licença; atribuição por boa prática)' },
    ],
    style: { kind: 'heatmap', color: '#dc2626', radius: 16, opacity: 0.65, icon: '⚠️' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 12;
    // longe: só os piores; perto: todos os pontos críticos publicados
    const niveis = z < 7 ? ['muito_alto'] : z < 9 ? ['muito_alto', 'alto'] : ['muito_alto', 'alto', 'moderado'];
    const rows = await featuresInBbox(LAYER, bbox, { limit: 6000, where: 'kind = any($7)', params: [niveis] });
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = props(r);
        return {
          type: 'Feature',
          id: r.id,
          geometry: r.geometry,
          properties: {
            id: r.id,
            name: label(p, r.name),
            nivel: NIVEL_LABEL[nivelOf(r)],
            acidentes_caminhao: p.caminhao,
            com_vitima: p.caminhao_vitima,
            com_morte: p.caminhao_fatais,
            obitos: p.obitos,
            madrugada: p.periodo?.madrugada ?? 0,
            manha: p.periodo?.manha ?? 0,
            tarde: p.periodo?.tarde ?? 0,
            noite: p.periodo?.noite ?? 0,
            acidentes_todos_veiculos: p.total,
            periodo_dados: `${fmtDate(p.janela?.de)} a ${fmtDate(p.janela?.ate)}`,
            fonte: p.fonte ?? r.source,
            score: p.score,
            weight: Math.round(Math.min(1, Math.max(0.15, (p.score ?? 0) / SCORE_MAX)) * 100) / 100,
          },
        } as GeoJSON.Feature;
      }),
    };
  },

  async annotate(ctx, route) {
    const rows = await featuresNearRoute(LAYER, route.line.geometry, NEAR_M, { limit: 3000 });
    if (!rows.length) {
      return {
        summary: ['Nenhum ponto crítico de acidente com caminhão na rota (3 anos; cobre o estado de SP e as rodovias federais).'],
        data: { pontos: 0, trechos: [] },
      };
    }
    const start = DateTime.fromJSDate(ctx.at).setZone(ctx.tz);
    const eta = (fraction: number) => start.plus({ seconds: Math.round(fraction * route.duration_s) });
    const trechos = cluster(rows, route.distance_km, eta);

    const porNivel: Record<Nivel, number> = { muito_alto: 0, alto: 0, moderado: 0 };
    for (const r of rows) porNivel[nivelOf(r)]++;
    const caminhao = rows.reduce((s, r) => s + (props(r).caminhao ?? 0), 0);
    const fatais = rows.reduce((s, r) => s + (props(r).caminhao_fatais ?? 0), 0);
    const obitos = rows.reduce((s, r) => s + (props(r).obitos ?? 0), 0);
    const janelas = rows.map((r) => props(r).janela).filter(Boolean);
    const de = janelas.map((j) => j.de).sort()[0];
    const ate = janelas.map((j) => j.ate).sort().at(-1);

    // avisos: os TOP_N trechos com pelo menos um ponto "alto" ou "muito alto", pelo score somado; exibidos na ordem da rota
    const criticos = trechos
      .filter((t) => t.nivel !== 'moderado')
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N)
      .sort((a, b) => a.km_inicio - b.km_inicio);
    const warnings: LayerWarning[] = criticos.map((t) => ({
      code: 'accident_hotspot',
      severity: 'warn',
      id: t.id,
      lat: t.lat,
      lon: t.lon,
      message:
        `Trecho crítico de acidentes com caminhão: ${t.name} (km ${fmtRange(t.km_inicio, t.km_fim)} da rota, ~${t.passagem}). ` +
        `${t.caminhao} acidentes com caminhão em 3 anos${t.caminhao_fatais ? `, ${t.caminhao_fatais} com morte` : ''}` +
        `${t.pico ? `; mais ${FAIXA_LABEL[t.pico]}` : ''}. Reduza a velocidade e mantenha distância.`,
    }));

    const summary = [
      `${rows.length} ponto(s) crítico(s) de acidente com caminhão na rota, em ${trechos.length} trecho(s) ` +
        `(${porNivel.muito_alto} muito alto, ${porNivel.alto} alto, ${porNivel.moderado} moderado).`,
      `Nesses pontos: ${caminhao} acidentes com caminhão de ${fmtDate(de)} a ${fmtDate(ate)}, ${fatais} com morte (${obitos} óbito(s)).`,
    ];
    if (criticos.length < trechos.filter((t) => t.nivel !== 'moderado').length) {
      summary.push(`Avisos mostram os ${criticos.length} trechos mais graves; os demais estão em "dados" e no mapa.`);
    }

    return {
      summary,
      warnings,
      data: {
        pontos: rows.length,
        por_nivel: porNivel,
        caminhao,
        caminhao_fatais: fatais,
        obitos,
        janela: { de, ate },
        trechos: trechos.slice(0, 50),
      },
    };
  },
};

export default layer;
