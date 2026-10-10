import * as turf from '@turf/turf';
import { featuresInBbox, featuresNearRoute, type DataFeatureRow, type NearRouteRow } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';
import { brl, describeSource, noTollRoute, priceFor, round2, tollProfile, type Tariff, type TollPrice, type VehicleTollProfile } from '../services/tollCost.js';

/**
 * Pedágio: praças e pórticos (ANTT, ARTESP, OSM) e custo estimado da rota para o veículo.
 *
 * Como a praça entra na conta:
 *  1. A polilinha do Valhalla passa exatamente pelos nós do grafo, que vêm do mesmo extrato OSM importado em
 *     source='osm'. Um nó barrier=toll_booth/highway=toll_gantry a até HIT_M da rota = a rota passa pela cabine/pórtico
 *     NAQUELA pista. Isso resolve o sentido de cobrança (praça unidirecional só tem nó na pista cobrada; a pista oposta
 *     fica 10–60 m ao lado e não conta).
 *  2. Nós a menos de CLUSTER_KM entre si ao longo da rota = uma praça (cabines/faixas da mesma praça).
 *  3. Cada praça é associada à praça oficial (ANTT/ARTESP) mais próxima (≤ OFFICIAL_M, mesma rodovia e nome parecido
 *     pesam a favor). A tarifa oficial manda; a `charge` do OSM é reserva (marcada como estimada, com a data).
 *  4. Praças oficiais coladas na rota (≤ POSSIBLE_M) sem NENHUM nó de pedágio do OSM a até OSM_COVER_M (lacuna do mapa)
 *     são listadas como "possíveis", sem somar.
 *  5. Praça oficial com `cobranca_suspensa` (concessão encerrada ou caducada; o CKAN ainda a lista como ativa): listada
 *     como "cobrança suspensa", fora do total, sem usar o valor do OSM (que pode ser de antes da suspensão).
 * Não bloqueia nem penaliza nada: só anota.
 */
const ID = 'pedagio';
const HIT_M = 3;
const CLUSTER_KM = 0.5;
const OFFICIAL_M = 1500;
const POSSIBLE_M = 60;
const OSM_NEAR_M = 400;   // nós do OSM perto da rota (para saber se o OSM cobre a praça oficial)
const OSM_COVER_M = 300;  // praça oficial com nó do OSM a até 300 m = coberta pelo OSM

type Props = Record<string, any>;

function normTxt(s: unknown): string {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
const STOP = new Set(['pedagio', 'praca', 'sentido', 'capital', 'interior', 'norte', 'sul', 'leste', 'oeste', 'pista', 'ramo', 'rodovia', 'portico', 'cabine', 'cabines', 'avancadas', 'interna', 'externa', 'bloqueio', 'trecho', 'free', 'flow']);
function tokens(s: unknown): Set<string> {
  return new Set(normTxt(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t)));
}
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}
function rodKey(s: unknown): string { return normTxt(s).replace(/[^a-z0-9/]/g, ''); }
function rodovias(p: Props): string[] {
  const out = new Set<string>();
  for (const r of [p.rodovia, ...(Array.isArray(p.rodovias) ? p.rodovias : [])]) if (r) out.add(rodKey(r));
  return [...out];
}
function coord(r: DataFeatureRow): [number, number] {
  const g = r.geometry as GeoJSON.Point;
  return g.type === 'Point' ? (g.coordinates as [number, number]) : (turf.centroid(turf.feature(g)).geometry.coordinates as [number, number]);
}
function distM(a: [number, number], b: [number, number]): number {
  return turf.distance(turf.point(a), turf.point(b), { units: 'meters' });
}
function fmtBr(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d ?? '');
}
function kmTxt(km: unknown): string {
  const n = Number(km);
  return Number.isFinite(n) && km !== null && km !== '' ? `km ${String(Math.round(n * 10) / 10).replace('.', ',')}` : '';
}
function plazaLabel(official: DataFeatureRow | null, osm: DataFeatureRow): string {
  const r = official ?? osm;
  const p = r.props as Props;
  const rod = [p.rodovia, kmTxt(p.km)].filter(Boolean).join(' ');
  const name = r.name ?? (osm.name || (osm.kind === 'portico' ? 'Pórtico de pedágio' : 'Praça de pedágio'));
  return rod ? `${name} (${rod})` : name;
}

function bearingAt(line: GeoJSON.Feature<GeoJSON.LineString>, lenKm: number, f: number): number | null {
  if (lenKm <= 0) return null;
  const a = turf.along(line, Math.max(0, f * lenKm - 0.2), { units: 'kilometers' });
  const b = turf.along(line, Math.min(lenKm, f * lenKm + 0.2), { units: 'kilometers' });
  return (turf.bearing(a, b) + 360) % 360;
}

interface Suspensao { desde: string; motivo: string; fonte?: string }

export interface PlazaOnRoute {
  nome: string;
  tipo: 'praca' | 'portico';
  km_rota: number;
  lat: number;
  lon: number;
  rodovia: string | null;
  operador: string | null;
  free_flow: boolean;
  ponto_a_ponto: boolean;
  cobranca: string | null;
  valor: number | null;
  regra: string | null;
  estimado: boolean;
  fonte: string | null;
  data: string | null;
  url?: string;
  observacao?: string;
  /** valor pelo OSM (e data de conferência), para comparação com a tabela oficial */
  valor_osm?: number | null;
  data_osm?: string | null;
  valor_oficial_sem_tag?: number | null;
  /** concessão encerrada/caducada: a praça não cobra (desde, motivo, fonte) */
  cobranca_suspensa?: Suspensao | null;
  osm_id: string;
  oficial_id: string | null;
  oficial_fonte: string | null;
}

/** Rumo cobrado pelo `direction` do OSM (importador): se todos diferem > 120° do rumo da rota, a cabine é do outro sentido. */
function chargedHere(h: DataFeatureRow, bearing: number | null): boolean {
  const hs = (h.props as Props).charged_headings as number[] | undefined;
  if (bearing == null || !Array.isArray(hs) || !hs.length) return true;
  return hs.some((x) => { const d = Math.abs(((x - bearing) % 360 + 540) % 360 - 180); return d <= 120; });
}

/** Nó do OSM que é só cabine de estacionamento/condomínio: sem tarifa, sem rodovia e sem praça oficial perto. */
function looksPrivate(osm: DataFeatureRow, official: DataFeatureRow | null): boolean {
  const p = osm.props as Props;
  return !official && !p.tarifa && !p.rodovia && !/ped[aá]gio|toll|free ?flow/i.test(osm.name ?? '');
}

const CARD: Record<string, number> = { norte: 0, leste: 90, sul: 180, oeste: 270 };
/** +1 se o nome da praça indica o sentido da rota ("Arujá Norte" indo para o norte), −1 se o oposto, 0 se não diz. */
function cardinalAgreement(name: string | null, bearing: number | null): number {
  if (bearing == null) return 0;
  const m = /\b(norte|sul|leste|oeste)\b/.exec(normTxt(name));
  if (!m) return 0;
  const c = Math.cos(((bearing - CARD[m[1]]) * Math.PI) / 180);
  return c >= 0.2 ? 1 : c <= -0.2 ? -1 : 0;
}

function matchOfficial(rep: DataFeatureRow, officials: NearRouteRow[], used: Set<string>, bearing: number | null): DataFeatureRow | null {
  const pt = coord(rep);
  const rp = rep.props as Props;
  const rods = new Set(rodovias(rp));
  const tk = tokens(`${rep.name ?? ''} ${rp.via_nome ?? ''}`);
  let best: { row: NearRouteRow; score: number } | null = null;
  for (const o of officials) {
    if (used.has(o.id)) continue;
    const d = distM(pt, coord(o));
    if (d > OFFICIAL_M) continue;
    const op = o.props as Props;
    let score = d;
    if (rodovias(op).some((r) => rods.has(r))) score -= 300;
    score -= 400 * Math.min(2, overlap(tk, tokens(o.name)));
    if (op.tarifa) score -= 200;
    if ((o.kind === 'portico') === (rep.kind === 'portico')) score -= 300;
    if (op.ponto_a_ponto && rep.kind !== 'portico') score += 1000;
    score -= 150 * cardinalAgreement(o.name, bearing);
    if (!best || score < best.score) best = { row: o, score };
  }
  return best?.row ?? null;
}

interface LineCharge {
  plazas: PlazaOnRoute[];
  ignored: string[];
  otherWay: string[];
  osmNear: NearRouteRow[];
  officials: NearRouteRow[];
  used: Set<string>;
}

/**
 * Pontos de cobrança por onde uma linha (rota) passa, no sentido dela, com o valor para o perfil do veículo.
 * Usada na rota principal e na alternativa sem pedágio (que o Valhalla pode fazer passar por pórtico free flow que o
 * grafo não marca como pedágio).
 */
async function plazasOnLine(lineF: GeoJSON.Feature<GeoJSON.LineString>, totalKm: number, prof: VehicleTollProfile): Promise<LineCharge> {
  const line = lineF.geometry;
  const [osmNear, officials] = await Promise.all([
    featuresNearRoute(ID, line, OSM_NEAR_M, { where: `source = 'osm'`, limit: 3000 }),
    featuresNearRoute(ID, line, OFFICIAL_M, { where: `source <> 'osm'`, limit: 2000 }),
  ]);
  const hits = osmNear.filter((h) => h.distance_m <= HIT_M);
  const lenKm = turf.length(lineF, { units: 'kilometers' });

  // nós do OSM sobre a rota -> praças (agrupadas ao longo da rota)
  const clusters: NearRouteRow[][] = [];
  for (const h of hits) {
    const last = clusters[clusters.length - 1];
    if (last && (h.fraction - last[last.length - 1].fraction) * totalKm <= CLUSTER_KM) last.push(h);
    else clusters.push([h]);
  }
  const used = new Set<string>();
  const plazas: PlazaOnRoute[] = [];
  const ignored: string[] = [];
  const otherWay: string[] = [];
  for (const c0 of clusters) {
    // cabine em via de mão dupla com `direction` que só cobra o outro sentido: não conta
    const c = c0.filter((h) => chargedHere(h, bearingAt(lineF, lenKm, h.fraction)));
    if (!c.length) { otherWay.push(...c0.map((h) => h.source_id)); continue; }
    const rep = c.find((h) => (h.props as Props).tarifa && h.kind === 'praca') ?? c.find((h) => (h.props as Props).tarifa) ?? c[0];
    const off = matchOfficial(rep, officials, used, bearingAt(lineF, lenKm, rep.fraction));
    if (looksPrivate(rep, off)) { ignored.push(rep.source_id); continue; }
    if (off) used.add(off.id);
    const op = (off?.props ?? {}) as Props;
    const rp = rep.props as Props;
    const pap = !!op.ponto_a_ponto;
    const susp = (op.cobranca_suspensa ?? null) as Suspensao | null;
    const osmPrice = priceFor(rp.tarifa as Tariff | null, prof);
    let price: TollPrice | null = pap || susp ? null : (priceFor(op.tarifa as Tariff | null, prof) ?? osmPrice);
    // o OSM guarda o valor de cabine (sem desconto de TAG): compara com o oficial sem TAG
    const officialManual = prof.tag ? priceFor(op.tarifa as Tariff | null, { ...prof, tag: false }) : null;
    if (price && price.valor === 0) price = { ...price, observacao: 'tarifa zero na fonte (ponto sem cobrança)' };
    const [lon, lat] = coord(rep);
    plazas.push({
      nome: plazaLabel(off, rep),
      tipo: rep.kind === 'portico' || off?.kind === 'portico' ? 'portico' : 'praca',
      km_rota: round2(rep.fraction * totalKm),
      lat, lon,
      rodovia: op.rodovia ?? rp.rodovia ?? null,
      operador: op.operador ?? rp.operador ?? null,
      free_flow: !!(rp.free_flow || op.free_flow || rep.kind === 'portico') && !pap,
      ponto_a_ponto: pap,
      cobranca: op.cobranca ?? null,
      valor: susp ? 0 : price?.valor ?? null,
      regra: susp ? `cobrança suspensa desde ${fmtBr(susp.desde)}: ${susp.motivo}`
        : price?.regra ?? (pap ? 'sistema ponto a ponto: cobra só quem aderiu com TAG, no lugar da praça' : null),
      estimado: price?.estimado ?? false,
      fonte: susp ? (off?.source ?? '').toUpperCase() || null : price?.fonte ?? null,
      data: susp ? susp.desde : price?.data ?? null,
      url: susp ? susp.fonte : price?.url,
      observacao: price?.observacao,
      valor_osm: osmPrice?.valor ?? null,
      data_osm: osmPrice?.data ?? null,
      valor_oficial_sem_tag: officialManual?.valor ?? price?.valor ?? null,
      cobranca_suspensa: susp,
      osm_id: rep.source_id,
      oficial_id: off?.id ?? null,
      oficial_fonte: off?.source ?? null,
    });
  }
  return { plazas, ignored, otherWay, osmNear, officials, used };
}

const layer: RouteLayer = {
  meta: {
    id: ID,
    label: 'Pedágio',
    description: 'Praças e pórticos de pedágio; custo estimado da rota para o veículo (eixos, rodagem) e comparação com a alternativa sem pedágio.',
    group: 'custos',
    sources: [
      { name: 'ANTT: praças de pedágio (dados.antt.gov.br)', url: 'https://dados.antt.gov.br/dataset/praca-de-pedagio', license: 'CC-BY' },
      { name: 'ANTT: tarifas por concessão (gov.br/antt)', url: 'https://www.gov.br/antt/pt-br/assuntos/rodovias/concessionarias/lista-de-concessoes', license: 'CC BY-ND 3.0 (rodapé gov.br)' },
      { name: 'ARTESP: tabelas de tarifas 2026 (PDF)', url: 'https://www.artesp.sp.gov.br/artesp/setor-regulado/rodovia/pedagios', license: 'Não especificada (portal cms.sp.gov.br: todos os direitos reservados)' },
      { name: 'ARTESP: malha rodoviária por lote (KMZ)', url: 'https://dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria', license: 'CC-BY' },
      { name: 'OpenStreetMap: barrier=toll_booth / highway=toll_gantry (charge)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0' },
    ],
    style: { kind: 'circle', color: '#d97706', radius: 6, minzoom: 7, icon: '💰' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 7) return { type: 'FeatureCollection', features: [] };
    // OSM só aparece onde não há praça oficial por perto (evita pontos duplicados no mapa)
    const rows = await featuresInBbox(ID, bbox, {
      limit: 3000,
      where: `source <> 'osm' or not exists (select 1 from data_features o where o.layer_id = 'pedagio' and o.source <> 'osm'
               and ST_DWithin(o.geom::geography, data_features.geom::geography, 800))`,
    });
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = r.props as Props;
        const t = p.tarifa as Tariff | null;
        let eixo: number | undefined;
        if (t?.modelo === 'por_eixo') eixo = t.eixo;
        else if (t?.modelo === 'categorias') eixo = t.base ?? undefined;
        else if (t?.modelo === 'osm_charge') {
          const a = t.charge?.hgv_axle ?? t.charge?.motorcar;
          eixo = a ? a.all ?? a.weekday ?? a.weekend : undefined;
        }
        return {
          type: 'Feature' as const,
          id: r.id,
          geometry: r.geometry,
          properties: {
            id: r.id,
            name: r.name ?? (r.kind === 'portico' ? 'Pórtico de pedágio' : 'Praça de pedágio'),
            tipo: r.kind === 'portico' ? 'pórtico (free flow)' : 'praça',
            rodovia: p.rodovia ?? null,
            km: p.km ?? null,
            operador: p.operador ?? null,
            tarifa_por_eixo: p.cobranca_suspensa ? `cobrança suspensa desde ${fmtBr(p.cobranca_suspensa.desde)}` : eixo != null ? brl(eixo) : 'não publicada',
            cobranca_suspensa: p.cobranca_suspensa?.motivo ?? null,
            tarifa_fonte: t ? `${t.fonte}${t.data ? ` (${t.data})` : ''}` : null,
            cobranca: p.cobranca ?? null,
            sentido: p.sentido ?? null,
            posicao: p.precisao === 'aprox_km' ? 'aproximada (rodovia + km)' : null,
            fonte: r.source,
          },
        };
      }),
    };
  },

  async annotate(ctx, route) {
    const totalKm = route.distance_km;
    const prof = tollProfile(ctx.vehicle, ctx.at);
    const { plazas, ignored, otherWay, osmNear, officials, used } = await plazasOnLine(route.line, totalKm, prof);

    // 2) praças oficiais coladas na rota SEM nenhum nó de pedágio do OSM por perto (lacuna do mapa): "possíveis",
    //    não somadas. Se o OSM tem cabine perto da praça e a rota não passou por ela, a rota não cruza a cabine
    //    (pista oposta, alça ou viaduto sobre a praça).
    const plazaPts = plazas.map((p) => [p.lon, p.lat] as [number, number]);
    const osmPts = osmNear.map((h) => coord(h));
    const possiveis = officials
      .filter((o) => !used.has(o.id) && o.distance_m <= POSSIBLE_M && !(o.props as Props).ponto_a_ponto && !(o.props as Props).cobranca_suspensa)
      .filter((o) => plazaPts.every((pp) => distM(pp, coord(o)) > 1000))
      .filter((o) => osmPts.every((op) => distM(op, coord(o)) > OSM_COVER_M))
      .map((o) => {
        const pr = priceFor((o.props as Props).tarifa as Tariff | null, prof);
        const [lon, lat] = coord(o);
        return { nome: plazaLabel(o, o), km_rota: round2(o.fraction * totalKm), lat, lon, distancia_m: Math.round(o.distance_m), valor: pr?.valor ?? null, fonte: o.source, cobranca: (o.props as Props).cobranca ?? null, id: o.id };
      });

    // 3) total
    const suspended = plazas.filter((p) => p.cobranca_suspensa);
    const charged = plazas.filter((p) => p.valor != null && !p.ponto_a_ponto && !p.cobranca_suspensa);
    const unknown = plazas.filter((p) => p.valor == null && !p.ponto_a_ponto && !p.cobranca_suspensa);
    const total = round2(charged.reduce((s, p) => s + (p.valor ?? 0), 0));
    const estimated = charged.filter((p) => p.estimado);

    // 4) alternativa sem pedágio (só se a rota tem cobrança)
    let alternativa: Record<string, unknown> | null = null;
    if (charged.some((p) => (p.valor ?? 0) > 0) || unknown.length) {
      try {
        // mesmas restrições da rota principal (routing.ts as passa prontas; sem elas, noTollRoute consulta de novo)
        const nt = await noTollRoute(ctx, ID, route.restrictions);
        if (!nt) alternativa = { disponivel: false, motivo: 'sem_caminho' };
        else {
          // O `exclude_tolls` só evita o que o grafo marca como pedágio: pórtico free flow em via sem toll=yes (ex.:
          // RIOSP na BR-101, Itaguaí) fica no caminho. A alternativa é cobrada com a mesma regra da rota principal.
          const alt = await plazasOnLine(turf.lineString(nt.coordinates), nt.distance_km, prof);
          const altPts = alt.plazas.filter((p) => !p.ponto_a_ponto && !p.cobranca_suspensa && (p.valor == null || p.valor > 0));
          const altTotal = round2(altPts.reduce((sum, p) => sum + (p.valor ?? 0), 0));
          const mainPts = [...charged.filter((p) => (p.valor ?? 0) > 0), ...unknown];
          const altIds = new Set(altPts.map((p) => p.osm_id));
          const evitados = mainPts.filter((p) => !altIds.has(p.osm_id));
          const economia = round2(total - altTotal);
          const base = {
            distance_km: round2(nt.distance_km),
            duration_s: Math.round(nt.duration_s),
            delta_km: round2(nt.distance_km - route.distance_km),
            delta_min: Math.round((nt.duration_s - route.duration_s) / 60),
            pedagio_na_ponta: nt.has_toll,
            restricoes_parciais: nt.falhas.length > 0,
            restricoes_com_falha: nt.falhas,
            pedagio_restante: altPts.length ? { valor: altTotal, pontos: altPts.map((p) => p.nome), sem_tarifa: altPts.filter((p) => p.valor == null).length } : null,
            metodo: 'Valhalla costing_options.truck.exclude_tolls=true, mesmas restrições da rota; pontos de cobrança da alternativa conferidos pela geometria',
          };
          const semGanho = altPts.length > 0 && (!evitados.length || (economia <= 0 && !evitados.some((p) => p.valor == null)));
          alternativa = semGanho
            ? { disponivel: false, motivo: evitados.length ? 'sem_economia' : 'mesmos_pontos', ...base }
            : { disponivel: true, ...base, economia: altPts.length ? economia : total, economia_parcial: unknown.length > 0 || altPts.some((p) => p.valor == null) };
        }
      } catch (e) {
        alternativa = { disponivel: false, motivo: `falha ao calcular: ${(e as Error).message}` };
      }
    }

    // 5) textos
    const summary: string[] = [];
    const warnings: LayerWarning[] = [];
    const eixosTxt = `${prof.eixos_cobrados} eixos cobrados${prof.eixos_suspensos ? ` (${prof.eixos_suspensos} suspenso${prof.eixos_suspensos > 1 ? 's' : ''})` : ''}, rodagem ${prof.rodagem}`;
    if (!plazas.length) {
      summary.push('Nenhuma praça de pedágio conhecida na rota.');
    } else {
      const n = charged.length;
      summary.push(`Pedágio estimado: ${brl(total)}${unknown.length ? ' + praças sem tarifa' : ''} — ${n} ponto${n === 1 ? '' : 's'} de cobrança${suspended.length ? ` (e ${suspended.length} com cobrança suspensa)` : ''}, ${eixosTxt}${prof.fim_de_semana ? ', fim de semana' : ''}${prof.tag ? ', com TAG' : ''}.`);
      for (const p of plazas.slice(0, 10)) {
        const val = p.cobranca_suspensa ? `cobrança suspensa desde ${fmtBr(p.cobranca_suspensa.desde)} (não somada)`
          : p.ponto_a_ponto ? 'ponto a ponto (não somado)' : p.valor == null ? 'tarifa não encontrada' : brl(p.valor);
        const src = p.valor != null && !p.cobranca_suspensa ? ` · ${describeSource({ fonte: p.fonte ?? '', data: p.data } as TollPrice)}${p.estimado ? ' · estimado' : ''}` : '';
        summary.push(`• km ${Math.round(p.km_rota)}: ${p.nome}: ${val}${src}`);
      }
      if (plazas.length > 10) summary.push(`• … mais ${plazas.length - 10} ponto(s); ver dados da camada.`);
    }
    if (possiveis.length) summary.push(`${possiveis.length} praça(s) oficial(is) colada(s) na rota sem confirmação no mapa (não somadas): ${possiveis.slice(0, 3).map((p) => p.nome).join('; ')}.`);
    if (alternativa) {
      if (alternativa.disponivel) {
        const dk = alternativa.delta_km as number, dm = alternativa.delta_min as number;
        const sign = (x: number, u: string) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(u === 'km' ? 1 : 0).replace('.', ',')} ${u}`;
        const rest = alternativa.pedagio_restante as { valor: number; pontos: string[] } | null;
        const eco = alternativa.economia as number;
        summary.push(rest
          ? `Com menos pedágio: ${sign(dk, 'km')} e ${sign(dm, 'min')} para economizar ${brl(eco)}${alternativa.economia_parcial ? ' (estimado)' : ''}; a alternativa ainda passa por ${rest.pontos.length} ponto(s) de cobrança (${rest.pontos.slice(0, 2).join('; ')}).`
          : `Sem pedágio: ${sign(dk, 'km')} e ${sign(dm, 'min')} para economizar ${brl(total)}${unknown.length ? ' (ou mais)' : ''}${alternativa.pedagio_na_ponta ? '; ainda pode haver pedágio perto da origem/destino' : ''}.`);
        const falhas = (alternativa.restricoes_com_falha as string[] | undefined) ?? [];
        if (falhas.length) summary.push(`Atenção: a rota sem pedágio foi calculada sem as restrições de ${falhas.join(', ')} (falha na consulta). Confira antes de usar.`);
      } else {
        const rest = alternativa.pedagio_restante as { pontos: string[] } | null | undefined;
        summary.push(alternativa.motivo === 'sem_caminho'
          ? 'Não há rota sem pedágio para este veículo.'
          : alternativa.motivo === 'mesmos_pontos'
            ? `Rota sem pedágio não encontrada: a alternativa calculada passa pelos mesmos pontos de cobrança${rest?.pontos.length ? ` (${rest.pontos.slice(0, 2).join('; ')})` : ''}; pórtico free flow nem sempre está marcado como pedágio no mapa.`
            : alternativa.motivo === 'sem_economia'
              ? `Rota sem pedágio não encontrada: a alternativa calculada passa por outros pontos de cobrança${rest?.pontos.length ? ` (${rest.pontos.slice(0, 2).join('; ')})` : ''} e não sai mais barata.`
              : `Alternativa sem pedágio indisponível agora (${alternativa.motivo}).`);
      }
    }
    if (plazas.length) {
      summary.push('Pedágio de veículo de carga é pago pelo embarcador via Vale-Pedágio (Lei 10.209/2001, art. 1º, §1º).');
      if (prof.eixos_suspensos) summary.push('Eixo suspenso só é isento com o caminhão vazio (Lei 13.103/2015, art. 17).');
    }

    if (unknown.length) {
      warnings.push({
        code: 'toll_price_unknown', severity: 'info', lat: unknown[0].lat, lon: unknown[0].lon,
        message: `Sem tarifa nas fontes importadas para ${unknown.length} ponto(s) de cobrança (${unknown.slice(0, 3).map((p) => p.nome).join('; ')}). O total não inclui esses valores; confira na concessionária.`,
      });
    }
    if (suspended.length) {
      const ex = suspended[0];
      warnings.push({
        code: 'toll_suspended', severity: 'info', lat: ex.lat, lon: ex.lon,
        message: `${suspended.length} praça(s) da rota com cobrança suspensa, fora do total (ex.: ${ex.nome}: ${ex.cobranca_suspensa!.motivo}). Confira na ANTT/DNIT se a cobrança voltou.`,
      });
    }
    const ff = plazas.filter((p) => p.free_flow && !p.ponto_a_ponto && !p.cobranca_suspensa);
    if (ff.length) {
      const federal = ff.some((p) => p.oficial_fonte === 'antt' || /^BR/i.test(p.rodovia ?? ''));
      warnings.push({
        code: 'toll_free_flow', severity: 'info', lat: ff[0].lat, lon: ff[0].lon,
        message: `A rota passa por ${ff.length} pórtico(s) free flow (sem cabine). Com TAG o débito é automático; sem TAG, pague pelo site ou app da concessionária${federal ? ' em até 30 dias (ANTT)' : ' no prazo informado por ela'}. Não pagar é evasão de pedágio, infração grave (CTB art. 209-A).`,
      });
    }
    // tabela oficial mais antiga que a conferência no OSM e com valor diferente: provável reajuste não publicado na fonte
    const diverg = charged.filter((p) => p.fonte !== 'OSM' && p.valor_osm != null && p.data_osm && p.data
      // tolerância de R$ 0,06 por eixo: arredondamento (ex.: tabela por categoria x valor por eixo do OSM)
      && p.data_osm > p.data && Math.abs((p.valor_osm ?? 0) - (p.valor_oficial_sem_tag ?? p.valor ?? 0)) > 0.06 * prof.eixos_cobrados);
    if (diverg.length) {
      const ex = diverg[0];
      warnings.push({
        code: 'toll_tariff_divergence', severity: 'info', lat: ex.lat, lon: ex.lon,
        message: `Em ${diverg.length} praça(s) o valor conferido no OSM é mais recente que a tabela oficial e diferente dela (ex.: ${ex.nome}: ${brl(ex.valor_oficial_sem_tag ?? ex.valor)} pela ${ex.fonte} de ${fmtBr(ex.data)}, ${brl(ex.valor_osm)} no OSM em ${fmtBr(ex.data_osm)}). Pode ter havido reajuste; confirme na concessionária.`,
      });
    }
    if (estimated.length) {
      warnings.push({
        code: 'toll_estimated', severity: 'info',
        message: `Valor estimado em ${estimated.length} ponto(s) (${estimated.slice(0, 2).map((p) => `${p.nome}: ${p.observacao ?? 'regra do multiplicador'}`).join('; ')}). Confira na concessionária.`,
      });
    }

    return {
      summary,
      warnings,
      data: {
        total, moeda: 'BRL',
        veiculo: prof,
        pracas: plazas,
        possiveis,
        alternativa_sem_pedagio: alternativa,
        ignorados_osm: ignored,
        outro_sentido_osm: otherWay,
        divergencias_oficial_osm: diverg.map((p) => ({ nome: p.nome, oficial: p.valor_oficial_sem_tag ?? p.valor, fonte: p.fonte, data: p.data, osm: p.valor_osm, data_osm: p.data_osm })),
        metodo: 'nós de pedágio do OSM sobre a polilinha da rota (sentido certo) + tarifa oficial ANTT/ARTESP da praça mais próxima; OSM charge como reserva',
      },
    };
  },
};

export default layer;
