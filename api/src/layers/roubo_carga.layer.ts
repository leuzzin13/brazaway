import { DateTime } from 'luxon';
import { featuresInBbox, featuresNearRoute, type DataFeatureRow, type NearRouteRow } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Roubo e furto de carga (microdados de BO da SSP-SP, ano corrente e anterior), agregados pelo importador em células de
 * 1 km com pelo menos 3 ocorrências e contados por faixa do dia. Nenhum BO, endereço, data ou hora individual chega à API.
 * A camada é INFORMATIVA e depende do HORÁRIO: estima a hora de passagem em cada área (proporcional à distância desde a
 * saída) e só avisa quando a área tem histórico relevante NA FAIXA em que o veículo passa. Ver docs/layers/roubo_carga.md.
 */
const LAYER = 'roubo_carga';
/** células a até CLUSTER_KM umas das outras, ao longo da rota, formam um só trecho */
const CLUSTER_KM = 1.5;
/** um trecho não passa deste comprimento (travessias longas da cidade viram vários avisos localizados) */
const MAX_TRECHO_KM = 5;
/** ocorrências na faixa de passagem (somadas no trecho) para virar aviso */
export const WARN_MIN = 5;
/** quantos trechos viram aviso */
export const TOP_N = 5;

type Nivel = 'muito_alto' | 'alto' | 'moderado';
const NIVEL_ORDEM: Record<Nivel, number> = { muito_alto: 3, alto: 2, moderado: 1 };
const NIVEL_LABEL: Record<Nivel, string> = { muito_alto: 'muito alto', alto: 'alto', moderado: 'moderado' };
const FAIXAS = ['madrugada', 'manha', 'tarde', 'noite'] as const;
type Faixa = (typeof FAIXAS)[number];
const FAIXA_LABEL: Record<Faixa, string> = { madrugada: 'de madrugada', manha: 'de manhã', tarde: 'à tarde', noite: 'à noite' };
const FAIXA_HORAS: Record<Faixa, string> = { madrugada: '0h–6h', manha: '6h–12h', tarde: '12h–18h', noite: '18h–24h' };

interface CellProps {
  cell: string;
  municipio?: string | null;
  regiao?: string | null;
  via?: string | null;
  total: number;
  roubo: number;
  furto: number;
  periodo: Record<Faixa, number>;
  sem_hora?: number;
  pico: Faixa | null;
  local?: Record<'via_publica' | 'rodovia' | 'acostamento' | 'posto' | 'outro', number>;
  fim_de_semana?: number;
  nivel: Nivel;
  anos: number[];
  periodo_dados?: { de: string; ate: string };
}

const props = (r: DataFeatureRow) => r.props as unknown as CellProps;
const nivelOf = (r: DataFeatureRow): Nivel => (props(r).nivel ?? r.kind ?? 'moderado') as Nivel;
const faixaOf = (hour: number): Faixa => FAIXAS[Math.floor(hour / 6)];
const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace('.', ',');
const fmtRange = (a: number, b: number) => (b - a >= 1 ? `${fmtKm(a)}–${fmtKm(b)}` : fmtKm(a));
const fmtAnos = (anos?: number[]) => (anos?.length ? (anos.length > 1 ? `${Math.min(...anos)}–${Math.max(...anos)}` : `${anos[0]}`) : '');

function label(p: CellProps, fallback: string | null): string {
  const lugar = p.via ?? p.regiao;
  if (lugar && p.municipio) return `${lugar}, ${p.municipio}`;
  return lugar ?? p.municipio ?? fallback ?? 'área sem nome';
}

interface Trecho {
  id: string;
  name: string;
  nivel: Nivel;
  areas: number;
  total: number;
  roubo: number;
  furto: number;
  periodo: Record<Faixa, number>;
  pico: Faixa | null;
  /** ocorrências registradas na faixa do dia em que o veículo passa por cada área do trecho */
  na_passagem: number;
  /** na_passagem separado pela faixa de passagem, na ordem da rota (o trecho pode atravessar a virada de faixa) */
  na_passagem_por_faixa: Partial<Record<Faixa, number>>;
  /** faixa do dia na entrada do trecho */
  faixa_passagem: Faixa;
  /** horário local aproximado de entrada no trecho (HH:mm) */
  passagem: string;
  km_inicio: number;
  km_fim: number;
  lat: number;
  lon: number;
}

/** "9 ocorrências de manhã" ou, se o trecho atravessa a virada de faixa, "9 ocorrências de manhã e 3 à tarde (horário de passagem)" */
function textoPassagem(porFaixa: Partial<Record<Faixa, number>>): string {
  const partes = (Object.entries(porFaixa) as [Faixa, number][]).filter(([, n]) => n > 0);
  if (!partes.length) return '0 ocorrências no horário de passagem';
  const [f0, n0] = partes[0];
  const primeira = `${n0} ${n0 === 1 ? 'ocorrência' : 'ocorrências'} ${FAIXA_LABEL[f0]}`;
  if (partes.length === 1) return primeira;
  const lista = [primeira, ...partes.slice(1).map(([f, n]) => `${n} ${FAIXA_LABEL[f]}`)];
  return `${lista.slice(0, -1).join(', ')} e ${lista.at(-1)} (horário de passagem)`;
}

function cluster(rows: NearRouteRow[], distanceKm: number, eta: (fraction: number) => DateTime): Trecho[] {
  const out: Trecho[] = [];
  let cur: NearRouteRow[] = [];
  let first = -Infinity;
  let last = -Infinity;
  const close = () => {
    if (!cur.length) return;
    const rs = cur;
    const best = rs.reduce((a, b) => (props(b).total > props(a).total ? b : a));
    const periodo = Object.fromEntries(FAIXAS.map((f) => [f, rs.reduce((s, r) => s + (props(r).periodo?.[f] ?? 0), 0)])) as Record<Faixa, number>;
    const pico = FAIXAS.some((f) => periodo[f] > 0) ? FAIXAS.reduce((a, b) => (periodo[b] > periodo[a] ? b : a)) : null;
    // cada área conta as ocorrências da faixa em que o veículo passa POR ELA (o trecho pode atravessar a virada de faixa)
    const porFaixaPassagem: Partial<Record<Faixa, number>> = {};
    for (const r of rs) {
      const f = faixaOf(eta(r.fraction).hour);
      porFaixaPassagem[f] = (porFaixaPassagem[f] ?? 0) + (props(r).periodo?.[f] ?? 0);
    }
    const naPassagem = Object.values(porFaixaPassagem).reduce((s, n) => s + (n ?? 0), 0);
    const t0 = eta(rs[0].fraction);
    const sum = (k: 'total' | 'roubo' | 'furto') => rs.reduce((s, r) => s + (props(r)[k] ?? 0), 0);
    const c = (best.geometry as GeoJSON.Polygon).coordinates[0];
    const lon = c.slice(0, 4).reduce((s, p) => s + p[0], 0) / 4;
    const lat = c.slice(0, 4).reduce((s, p) => s + p[1], 0) / 4;
    out.push({
      id: best.id,
      name: label(props(best), best.name),
      nivel: rs.map(nivelOf).reduce((a, b) => (NIVEL_ORDEM[b] > NIVEL_ORDEM[a] ? b : a)),
      areas: rs.length,
      total: sum('total'),
      roubo: sum('roubo'),
      furto: sum('furto'),
      periodo,
      pico,
      na_passagem: naPassagem,
      na_passagem_por_faixa: porFaixaPassagem,
      faixa_passagem: faixaOf(t0.hour),
      passagem: t0.toFormat('HH:mm'),
      km_inicio: Math.round(rs[0].fraction * distanceKm * 10) / 10,
      km_fim: Math.round(rs[rs.length - 1].fraction * distanceKm * 10) / 10,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
    });
    cur = [];
  };
  for (const r of rows) {
    const km = r.fraction * distanceKm;
    if (cur.length && (km - last > CLUSTER_KM || km - first > MAX_TRECHO_KM)) close();
    if (!cur.length) first = km;
    cur.push(r);
    last = km;
  }
  close();
  return out;
}

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Roubo de carga',
    description: 'Áreas de 1 km com roubo ou furto de carga registrado pela SSP-SP (ano corrente e anterior), por faixa do dia. Só o estado de SP: nenhum outro estado pesquisado (MG, RJ, Sul e Centro-Oeste) publica roubo de carga com coordenada em dado aberto.',
    group: 'seguranca',
    sources: [
      {
        name: 'SSP-SP — microdados de BO (SPDadosCriminais)',
        url: 'https://www.ssp.sp.gov.br/estatistica/spdados',
        license: 'Dados abertos SSP-SP (sem licença explícita; Decreto SP 68.769/2024 — livre utilização)',
      },
    ],
    style: { kind: 'fill', color: '#c026d3', opacity: 0.22, icon: '🚨' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 12;
    const niveis = z < 8 ? ['muito_alto'] : z < 10 ? ['muito_alto', 'alto'] : ['muito_alto', 'alto', 'moderado'];
    const rows = await featuresInBbox(LAYER, bbox, { limit: 4000, where: 'kind = any($7)', params: [niveis] });
    return {
      type: 'FeatureCollection',
      // até 12 propriedades exibíveis (o popup genérico do mapa mostra 12; id fica de fora e a fonte vai no rodapé)
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
            ocorrencias: p.total,
            anos: fmtAnos(p.anos),
            roubos: p.roubo,
            furtos: p.furto,
            [`madrugada (${FAIXA_HORAS.madrugada})`]: p.periodo?.madrugada ?? 0,
            [`manhã (${FAIXA_HORAS.manha})`]: p.periodo?.manha ?? 0,
            [`tarde (${FAIXA_HORAS.tarde})`]: p.periodo?.tarde ?? 0,
            [`noite (${FAIXA_HORAS.noite})`]: p.periodo?.noite ?? 0,
            local: p.local
              ? `via pública ${p.local.via_publica ?? 0} · rodovia/acostamento ${(p.local.rodovia ?? 0) + (p.local.acostamento ?? 0)} · posto ${p.local.posto ?? 0}`
              : null,
          },
        } as GeoJSON.Feature;
      }),
    };
  },

  async annotate(ctx, route) {
    // células (polígonos de 1 km) que a rota atravessa
    const rows = await featuresNearRoute(LAYER, route.line.geometry, 0, { limit: 3000 });
    const anosAll = [...new Set(rows.flatMap((r) => props(r).anos ?? []))];
    if (!rows.length) {
      return {
        summary: ['Nenhuma área com roubo de carga registrado na rota (SSP-SP; a camada cobre só o estado de SP: não há dado aberto com coordenada de roubo de carga nos demais estados, e ausência de área fora de SP não significa ausência de risco).'],
        data: { areas: 0, trechos: [] },
      };
    }
    const start = DateTime.fromJSDate(ctx.at).setZone(ctx.tz);
    const eta = (fraction: number) => start.plus({ seconds: Math.round(fraction * route.duration_s) });
    const trechos = cluster(rows, route.distance_km, eta);
    const anos = fmtAnos(anosAll);

    const total = trechos.reduce((s, t) => s + t.total, 0);
    const naPassagem = trechos.reduce((s, t) => s + t.na_passagem, 0);
    const porFaixa = Object.fromEntries(FAIXAS.map((f) => [f, trechos.reduce((s, t) => s + t.periodo[f], 0)])) as Record<Faixa, number>;
    const pico = FAIXAS.reduce((a, b) => (porFaixa[b] > porFaixa[a] ? b : a));
    const faixasPassagem = [...new Set(rows.map((r) => faixaOf(eta(r.fraction).hour)))];

    const avisos = trechos
      .filter((t) => t.na_passagem >= WARN_MIN)
      .sort((a, b) => b.na_passagem - a.na_passagem)
      .slice(0, TOP_N)
      .sort((a, b) => a.km_inicio - b.km_inicio);
    const warnings: LayerWarning[] = avisos.map((t) => ({
      code: 'cargo_theft_area',
      severity: 'warn',
      id: t.id,
      lat: t.lat,
      lon: t.lon,
      message:
        `Roubo de carga na região de ${t.name} (km ${fmtRange(t.km_inicio, t.km_fim)} da rota, ~${t.passagem}): ` +
        `${textoPassagem(t.na_passagem_por_faixa)} em ${anos} (${t.total} no total). ` +
        `Evite parar na região; se precisar, use local vigiado.`,
    }));

    const summary = [
      `Rota cruza ${rows.length} área(s) de 1 km com roubo/furto de carga registrado (SSP-SP, ${anos}): ` +
        `${total} ocorrências, ${naPassagem} na faixa do dia em que você passa por elas.`,
    ];
    if (porFaixa[pico] > 0) {
      const passaNoPico = faixasPassagem.includes(pico);
      summary.push(
        `Faixa mais crítica nessas áreas: ${FAIXA_LABEL[pico]} (${FAIXA_HORAS[pico]}, ${porFaixa[pico]} ocorrências).` +
          (passaNoPico ? ' Você passa por parte delas nesse horário; se puder, ajuste a saída.' : ' Pelo horário de saída, você passa fora dela.'),
      );
    }
    if (!avisos.length) summary.push(`Nenhum trecho com ${WARN_MIN} ou mais ocorrências no horário estimado de passagem.`);

    return {
      summary,
      warnings,
      data: {
        anos: anosAll.sort(),
        areas: rows.length,
        total,
        na_passagem: naPassagem,
        por_faixa: porFaixa,
        pico,
        trechos: trechos.slice(0, 50),
      },
    };
  },
};

export default layer;
