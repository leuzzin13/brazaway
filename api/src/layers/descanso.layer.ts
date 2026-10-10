import { query } from '../db.js';
import { DRIVING_RULES } from '../services/restStops.js';
import { allCandidatesAlongRoute, classify, OSM_SAU_RE, todayBR, TIER_LABEL, type RestStopCandidate, type RestTier } from '../services/restStopsData.js';
import { featuresInBbox } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Descanso do caminhoneiro (Lei 13.103/2015): PPD certificados e de concessão (painel do Ministério dos Transportes),
 * áreas de descanso das concessionárias de SP (ARTESP), SAU das concessões (ANTT/ARTESP — só APOIO) e pontos do OSM
 * (rest_area, services, estacionamento e posto com acesso de caminhão).
 *
 * A camada não muda a rota. Os mesmos pontos alimentam o plano de direção (rest_stops/driving_plan) com prioridade
 * PPD válido > área de descanso de concessionária > posto/pátio > SAU (ver services/restStopsData.ts). Aqui:
 *  - features(): mapa com ícone e cor por tipo;
 *  - annotate(): o que existe ao longo da rota, por prioridade, e trechos de mais de 5h30 de direção sem ponto de
 *    descanso (onde só há SAU, que serve para pausa curta e nunca para o descanso de 11 h).
 * Ver docs/layers/descanso.md.
 */
const ID = 'descanso';
const NEAR_M = 500;

interface Look { icon: string; color: string; tipo: string }
function look(kind: string, props: Record<string, any>, today: string, name?: string | null): Look {
  if (kind !== 'sau' && name && OSM_SAU_RE.test(name) && !kind.startsWith('ppd') && kind !== 'area_descanso') return look('sau', props, today);
  if (kind === 'ppd') {
    const ok = props.validade && props.validade >= today;
    return ok ? { icon: '🛌', color: '#16a34a', tipo: 'PPD certificado' } : { icon: '⏳', color: '#d97706', tipo: 'PPD com certificação vencida' };
  }
  if (kind === 'ppd_concessao') {
    return props.operando ? { icon: '🛌', color: '#15803d', tipo: 'PPD de concessão (entregue)' } : { icon: '🚧', color: '#a3a3a3', tipo: `PPD de concessão (${String(props.status ?? 'não entregue').toLowerCase()})` };
  }
  if (kind === 'area_descanso') return { icon: '🅿️', color: '#2563eb', tipo: 'Área de descanso de concessionária' };
  if (kind === 'sau') return { icon: 'ℹ️', color: '#64748b', tipo: 'SAU — apoio (não é local de descanso de 11 h)' };
  if (kind === 'truck_parking') return { icon: '🚛', color: '#7c3aed', tipo: 'Estacionamento de caminhões (OSM)' };
  if (kind === 'fuel_hgv') return { icon: '⛽', color: '#7c3aed', tipo: 'Posto com acesso de caminhão (OSM)' };
  if (kind === 'truck_stop') return { icon: '🚚', color: '#7c3aed', tipo: 'Parada de caminhões (OSM)' };
  if (kind === 'service_area') return { icon: '🍽️', color: '#7c3aed', tipo: 'Posto/área de serviço (OSM)' };
  return { icon: '🅿️', color: '#7c3aed', tipo: 'Área de descanso (OSM)' };
}

const SOURCE_LABEL: Record<string, string> = {
  'ppd-mt': 'Ministério dos Transportes (painel de PPD)',
  artesp: 'ARTESP — Cadastro de Ativos (CC-BY)',
  antt: 'ANTT — Edificações operacionais (CC-BY)',
  osm: '© colaboradores do OpenStreetMap (ODbL)',
};
const fmtDate = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : null);
const fmtH = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`; };
const fmtKm = (km: number) => String(Math.round(km));

export interface RestOnRoute {
  id: string;
  nome: string;
  categoria: string;
  tier: RestTier;
  prioridade: string;
  km_rota: number;
  direcao_ate_s: number;
  distancia_m: number;
  vagas: number | null;
  validade: string | null;
  descanso_11h: boolean;
  fonte: string;
  lat: number;
  lon: number;
}

function toItem(c: RestStopCandidate): RestOnRoute {
  return {
    id: c.id, nome: c.name ?? c.category, categoria: c.category, tier: c.tier, prioridade: TIER_LABEL[c.tier],
    km_rota: c.distance_km, direcao_ate_s: c.eta_s, distancia_m: Math.round(c.off_route_m), vagas: c.vagas,
    validade: c.validade, descanso_11h: c.daily_rest_ok, fonte: c.source, lat: c.lat, lon: c.lon,
  };
}

/** Trechos de mais de 5h30 de direção sem nenhum ponto de descanso (tiers 1–3), com os SAU que existem neles. */
export function restGaps(cands: { eta_s: number; tier: RestTier; distance_km: number }[], durationS: number, distanceKm: number, maxS = DRIVING_RULES.max_continuous_driving_s) {
  const marks = [0, ...cands.filter((c) => c.tier <= 3).map((c) => c.eta_s).sort((a, b) => a - b), durationS];
  const gaps: { de_s: number; ate_s: number; de_km: number; ate_km: number }[] = [];
  for (let i = 1; i < marks.length; i++) {
    if (marks[i] - marks[i - 1] > maxS) {
      gaps.push({ de_s: marks[i - 1], ate_s: marks[i], de_km: +(marks[i - 1] / durationS * distanceKm).toFixed(1), ate_km: +(marks[i] / durationS * distanceKm).toFixed(1) });
    }
  }
  return gaps;
}

const layer: RouteLayer = {
  meta: {
    id: ID,
    label: 'Descanso (PPD, áreas e apoio)',
    description: 'Pontos de Parada e Descanso certificados (com validade e vagas), áreas de descanso das concessionárias, '
      + 'postos e pátios para caminhão e SAU (só apoio). Alimentam o plano de paradas da Lei 13.103.',
    group: 'servicos',
    sources: [
      { name: 'Ministério dos Transportes — painel de PPDs (certificados e de concessão)', url: 'https://www.gov.br/transportes/pt-br/assuntos/transporte-terrestre_/portal-trc/ppd', license: 'Dado público governamental, sem licença declarada (citar a fonte)' },
      { name: 'ARTESP — Cadastro de Ativos (áreas de descanso e SAU)', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/cadastro-de-ativos', license: 'CC-BY' },
      { name: 'ANTT — Edificações operacionais (bases do SAU)', url: 'https://dados.antt.gov.br/dataset/edificacao-operacional', license: 'CC-BY' },
      { name: 'OpenStreetMap — rest_area, services, estacionamento e posto com acesso de caminhão', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0 (© colaboradores do OpenStreetMap)' },
    ],
    style: { kind: 'circle', color: '#16a34a', radius: 6, minzoom: 5, icon: '🛌' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 12;
    const today = todayBR();
    // zoom baixo: só PPD; médio: + áreas de descanso e SAU; alto: tudo (inclusive OSM)
    const where = z < 7 ? `kind in ('ppd', 'ppd_concessao')` : z < 9 ? `kind in ('ppd', 'ppd_concessao', 'area_descanso', 'sau')` : undefined;
    const rows = await featuresInBbox(ID, bbox, { limit: 3000, where });
    const feats: GeoJSON.Feature[] = rows.map((r) => {
      const p = r.props as Record<string, any>;
      const lk = look(r.kind ?? '', p, today, r.name);
      const c = classify(r.kind ?? '', r.source, p, today, r.name);
      return {
        type: 'Feature', id: r.id, geometry: r.geometry,
        properties: {
          id: r.id, name: r.name, tipo: lk.tipo, icon: lk.icon, color: lk.color,
          prioridade: c ? `${c.tier} — ${TIER_LABEL[c.tier]}` : 'fora do plano (não entregue)',
          descanso_11h: c ? (c.daily_rest_ok ? 'sim' : 'não (só pausa curta)') : 'não',
          validade: r.kind === 'ppd' ? (fmtDate(p.validade) ?? 'sem data') : null,
          vagas: p.vagas ?? null, chuveiros: p.chuveiros ?? null,
          servicos: Array.isArray(p.servicos) ? p.servicos.join(', ') : null,
          funcionamento: p.funcionamento ?? p.tags?.opening_hours ?? null,
          rodovia: p.rodovia ?? null, km: p.km ?? null, sentido: p.sentido ?? null,
          municipio: p.municipio ?? null, concessionaria: p.concessionaria ?? null,
          situacao: r.kind === 'ppd_concessao' ? p.status ?? null : null,
          fonte: SOURCE_LABEL[r.source] ?? r.source,
        },
      };
    });
    if (z >= 9) {
      // rest_stops (Overpass, Grande SP): só o que o PBF importado não trouxe
      const osm = await query<{ id: string; osm_id: string; name: string | null; kind: string; lon: number; lat: number; tags: Record<string, string> }>(
        `select id::text, osm_id, name, kind, ST_X(geom) as lon, ST_Y(geom) as lat, tags from rest_stops s
          where geom && ST_MakeEnvelope($1,$2,$3,$4,4326)
            and not exists (select 1 from data_features f where f.layer_id = 'descanso' and f.source = 'osm' and f.source_id = s.osm_id)
          limit 1000`, bbox);
      for (const s of osm.rows) {
        const lk = look(s.kind, {}, today, s.name);
        const c = classify(s.kind, 'osm', {}, today, s.name)!;
        feats.push({
          type: 'Feature', id: `rs:${s.id}`, geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          properties: { id: `rs:${s.id}`, name: s.name ?? lk.tipo, tipo: lk.tipo, icon: lk.icon, color: lk.color, prioridade: `${c.tier} — ${TIER_LABEL[c.tier]}`,
            descanso_11h: c.daily_rest_ok ? 'sim' : 'não (só pausa curta)', funcionamento: s.tags?.opening_hours ?? null, fonte: SOURCE_LABEL.osm },
        });
      }
    }
    return { type: 'FeatureCollection', features: feats };
  },

  async annotate(ctx, route) {
    // validade do PPD conferida no dia em que o caminhão passa pelo ponto (saída + tempo de direção até ele)
    const cands = await allCandidatesAlongRoute(route.line.geometry, route.distance_km, route.duration_s, NEAR_M, ctx.at);
    const by = (t: RestTier) => cands.filter((c) => c.tier === t);
    const [t1, t2, t3, t4] = [by(1), by(2), by(3), by(4)];
    const summary: string[] = [];
    const warnings: LayerWarning[] = [];
    if (!cands.length) {
      summary.push('Nenhum ponto de descanso mapeado a até 500 m da rota.');
    } else {
      summary.push(`A até 500 m da rota: ${t1.length} PPD válido(s), ${t2.length} área(s) de descanso de concessionária, ${t3.length} posto(s)/pátio(s) para caminhão e ${t4.length} SAU (só apoio).`);
      for (const c of [...t1, ...t2].slice(0, 6)) {
        summary.push(`• km ${fmtKm(c.distance_km)} (~${fmtH(c.eta_s)} de direção): ${c.name} — ${c.category}${c.vagas ? `, ${c.vagas} vagas` : ''}`);
      }
      const vencidos = t3.filter((c) => c.kind === 'ppd');
      for (const c of vencidos.slice(0, 3)) summary.push(`• km ${fmtKm(c.distance_km)}: ${c.name} — ${c.category}; conta como posto com pátio, não como PPD.`);
    }
    if (route.duration_s > DRIVING_RULES.max_continuous_driving_s) {
      summary.push('O plano de paradas prioriza PPD válido > área de descanso de concessionária > posto/pátio > SAU (SAU só para a pausa de 30 min).');
    }
    const gaps = restGaps(cands, route.duration_s, route.distance_km);
    for (const g of gaps) {
      const saus = t4.filter((s) => s.eta_s > g.de_s && s.eta_s < g.ate_s);
      const sauTxt = saus.length
        ? ` Há SAU no km ${saus.slice(0, 3).map((s) => fmtKm(s.distance_km)).join(', ')}: serve para a pausa curta (banheiro, água, socorro), não para o descanso de 11 h.`
        : '';
      warnings.push({
        code: 'rest_gap', severity: 'info', id: `gap:${Math.round(g.de_km)}`,
        message: `Do km ${fmtKm(g.de_km)} ao km ${fmtKm(g.ate_km)} da rota (${fmtH(g.ate_s - g.de_s)} de direção) não há PPD, área de descanso nem posto com pátio mapeado.${sauTxt}`,
      });
    }
    return {
      summary,
      warnings,
      data: {
        ppd_validos: t1.map(toItem),
        areas_descanso: t2.map(toItem),
        postos_patio: t3.map(toItem),
        apoio_sau: t4.map(toItem),
        trechos_sem_descanso: gaps,
        prioridade: ([1, 2, 3, 4] as RestTier[]).map((t) => `${t} — ${TIER_LABEL[t]}`),
      },
    };
  },
};

export default layer;
