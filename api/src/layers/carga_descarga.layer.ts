import { query } from '../db.js';
import { legalDayInfo } from '../services/calendar.js';
import { describeWins, fmtKm, localParts, prettyStreet, windowActive, type Win } from './apoio_urbano.js';
import { featuresInBbox, type DataFeatureRow } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Onde parar para carga e descarga em São Paulo: vagas de Zona Azul Caminhão (GeoSampa/CET).
 * Duas fontes na mesma camada:
 *  - geosampa-zona-azul: faces de quadra com vagas de caminhão e o horário de operação por dia;
 *  - geosampa-vaga-especial: pontos (endereço) das vagas de caminhão, casados com a face (zona_azul_id).
 * Regra do CAD: CET, "Regras para estacionar em áreas de Zona Azul" (Bolsão Caminhão: 1 CAD = 30 min, no máximo 2 = 1 h,
 * para caminhão, caminhonete e veículo misto; exceção do Bolsão da R. Santa Rosa/R. Eurípedes Simões de Paula = regra
 * geral). A página da CET não cita o número da norma; a placa do local prevalece (ver docs/layers/carga_descarga.md).
 * annotate(): as 5 vagas (agrupadas por face de quadra) mais próximas do DESTINO, a até 1 km, com distância,
 * horário e se a Zona Azul estará em operação na hora estimada de chegada.
 */
const LAYER = 'carga_descarga';
const RADIUS_M = 1000;
const TOP = 5;

interface Props {
  zona_azul_id?: number | null;
  local?: string;
  endereco?: string;
  complemento?: string | null;
  lado?: string | null;
  vagas_caminhao?: number;
  windows?: Win[];
  horario_informado?: boolean;
  regra?: string;
  cad_min?: number;
  base_legal?: string;
  veiculos?: string;
  area?: string | null;
}

interface NearRow extends Omit<DataFeatureRow, 'props' | 'geometry'> { props: Props; dist_m: number; near: GeoJSON.Point }

export interface VagaOut {
  id: string;
  nome: string;
  endereco: string | null;
  lado: string | null;
  vagas: number | null;
  distancia_m: number;
  horario: string;
  regra: string | null;
  cad_min: number | null;
  base_legal: string | null;
  em_operacao_na_chegada: boolean | null;
  status: string;
  lat: number;
  lon: number;
}

function statusAt(p: Props, arrival: Date, holiday: boolean, prevHoliday: boolean): { active: boolean | null; text: string } {
  if (!p.horario_informado || !p.windows?.length) return { active: null, text: 'horário não informado: confira a placa' };
  const active = windowActive(p.windows, arrival, { holiday, prevHoliday, holidayMode: 'own' });
  return active
    ? { active, text: 'Zona Azul em operação na chegada (use CAD)' }
    : { active, text: 'fora do horário da Zona Azul na chegada (vale a placa)' };
}

const layer: RouteLayer = {
  meta: {
    id: LAYER,
    label: 'Carga e descarga (Zona Azul Caminhão)',
    description: 'Vagas de Zona Azul para caminhão em São Paulo, com horário e regra do CAD; sugere as mais próximas do destino.',
    group: 'servicos',
    sources: [
      { name: 'GeoSampa zona_azul (CET/PMSP)', url: 'https://geosampa.prefeitura.sp.gov.br', license: 'CC-BY-SA 4.0' },
      { name: 'GeoSampa vaga_especial, tipo CA (CET/PMSP)', url: 'https://geosampa.prefeitura.sp.gov.br', license: 'CC-BY-SA 4.0' },
    ],
    style: { kind: 'circle', color: '#2563eb', radius: 5, width: 4, minzoom: 13, icon: '🅿️' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 13) return { type: 'FeatureCollection', features: [] };
    const rows = await featuresInBbox(LAYER, bbox, { limit: 3000 });
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = r.props as Props;
        const ponto = r.kind === 'vaga_caminhao';
        return {
          type: 'Feature', id: r.id, geometry: r.geometry,
          properties: {
            id: r.id,
            name: prettyStreet(ponto ? p.endereco : p.local),
            tipo: ponto ? 'Vaga de caminhão (Zona Azul)' : 'Trecho de Zona Azul com vagas de caminhão',
            vagas: p.vagas_caminhao ?? null,
            lado: ponto ? (p.complemento ?? null) : (p.lado ?? null),
            horario: p.horario_informado ? describeWins(p.windows) : 'não informado (confira a placa)',
            regra: p.regra ?? null,
            veiculos: p.veiculos ?? null,
            base_legal: p.base_legal ?? null,
            fonte: 'GeoSampa/CET (CC-BY-SA 4.0)',
          },
        };
      }),
    };
  },

  async annotate(ctx, route) {
    const d = ctx.destination;
    const r = await query<NearRow>(
      `with d as (select ST_SetSRID(ST_MakePoint($1, $2), 4326) as g)
       select f.id::text, f.layer_id, f.source, f.source_id, f.name, f.kind, f.props, f.valid_from, f.valid_to,
              ST_Distance(f.geom::geography, d.g::geography)::float as dist_m,
              ST_AsGeoJSON(ST_ClosestPoint(f.geom, d.g), 6)::json as near
         from data_features f, d
        where f.layer_id = $3 and f.geom && ST_Expand(d.g, 0.06)
          and ST_DWithin(f.geom::geography, d.g::geography, $4)
          and (f.valid_to is null or f.valid_to > now())
        order by dist_m
        limit 80`,
      [d.lon, d.lat, LAYER, 5000],
    );
    if (!r.rows.length) return {};   // fora da cobertura (município de SP)

    const arrival = new Date(ctx.at.getTime() + route.duration_s * 1000);
    // feriado na chegada e no dia anterior (janela que cruza a meia-noite, ex.: 07:00–02:00, vem do dia anterior)
    const noHoliday = { holiday: null };
    const [day, prevDay] = await Promise.all([
      legalDayInfo(arrival).catch(() => noHoliday),
      legalDayInfo(new Date(arrival.getTime() - 86_400_000)).catch(() => noHoliday),
    ]);
    const holiday = !!day.holiday;
    const prevHoliday = !!prevDay.holiday;
    const arrLabel = localParts(arrival).label;

    // agrupa por face de quadra (o ponto da vaga e o trecho de Zona Azul são a mesma vaga)
    const groups = new Map<string, NearRow[]>();
    for (const row of r.rows) {
      const key = row.props.zona_azul_id != null ? `za:${row.props.zona_azul_id}` : `id:${row.id}`;
      const g = groups.get(key) ?? [];
      g.push(row);
      groups.set(key, g);
    }
    const ranked = [...groups.values()].sort((a, b) => a[0].dist_m - b[0].dist_m);
    const within = ranked.filter((g) => g[0].dist_m <= RADIUS_M).slice(0, TOP);

    const vagas: VagaOut[] = within.map((g) => {
      const nearest = g[0];
      const trecho = g.find((x) => x.kind === 'zona_azul_caminhao');
      const ponto = g.find((x) => x.kind === 'vaga_caminhao');
      const ref = trecho ?? nearest;
      const st = statusAt(ref.props, arrival, holiday, prevHoliday);
      return {
        id: nearest.id,
        nome: prettyStreet(ref.props.local ?? ref.props.endereco ?? nearest.name ?? 'Vaga de caminhão'),
        endereco: ponto ? prettyStreet(ponto.props.endereco) : null,
        lado: trecho?.props.lado ?? null,
        vagas: (trecho ?? ponto)?.props.vagas_caminhao ?? null,
        distancia_m: Math.round(nearest.dist_m),
        horario: ref.props.horario_informado ? describeWins(ref.props.windows) : 'não informado',
        regra: ref.props.regra ?? null,
        cad_min: ref.props.cad_min ?? null,
        base_legal: ref.props.base_legal ?? null,
        em_operacao_na_chegada: st.active,
        status: st.text,
        lon: nearest.near.coordinates[0],
        lat: nearest.near.coordinates[1],
      };
    });

    const warnings: LayerWarning[] = [];
    const summary: string[] = [];
    if (vagas.length) {
      const v = vagas[0];
      warnings.push({
        code: 'loading_bay_near_destination', severity: 'info', id: v.id, lat: v.lat, lon: v.lon,
        message: `Vaga de Zona Azul Caminhão mais próxima do destino: ${v.endereco ?? v.nome}, a ${fmtKm(v.distancia_m)} (${v.vagas ?? '?'} vaga(s); ${v.horario}; ${v.status}). ${v.regra ?? ''}.`.replace(/\.\.$/, '.'),
      });
      vagas.forEach((x, i) => summary.push(
        `${i + 1}. ${x.endereco ?? x.nome}${x.lado ? ` (lado ${x.lado})` : ''} — ${fmtKm(x.distancia_m)}, ${x.vagas ?? '?'} vaga(s); ${x.horario}; ${x.status}${x.cad_min === 60 && x.regra ? `; ${x.regra}` : ''}.`,
      ));
      summary.push(`Chegada estimada: ${arrLabel}${holiday ? ' (feriado)' : ''}. Bolsão Caminhão: 1 CAD = 30 min, máx. 2 CADs (1 h) na mesma vaga (regra da CET; a placa do local prevalece).`);
    } else {
      const g = ranked[0];
      warnings.push({
        code: 'no_loading_bay_near_destination', severity: 'info', lat: g[0].near.coordinates[1], lon: g[0].near.coordinates[0],
        message: `Nenhuma vaga de Zona Azul Caminhão a até 1 km do destino (a mais próxima fica a ${fmtKm(g[0].dist_m)}). Combine o local de descarga com o destinatário.`,
      });
      summary.push(`Sem vaga de Zona Azul Caminhão a até 1 km do destino; a mais próxima fica a ${fmtKm(g[0].dist_m)}.`);
    }
    return { summary, warnings, data: { chegada: arrLabel, feriado: holiday, dia_anterior_feriado: prevHoliday, raio_m: RADIUS_M, vagas } };
  },
};

export default layer;
