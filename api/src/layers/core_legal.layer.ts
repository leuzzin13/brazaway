import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { legalDayInfo, type Suspension } from '../services/calendar.js';
import { activeZones, pointInZone, type ZoneRow } from '../services/zones.js';
import type { LayerAnnotation, LayerWarning, RouteCtx, RouteGeom, RouteLayer } from './types.js';

/**
 * core_legal — calendário legal (feriados do Sudeste: db/seed/0004_holidays.sql e importador feriados_sudeste; suspensões da
 * CET em São Paulo). As regras em si (ZMRC, rodízio, perigosos, feriados e suspensões) são
 * aplicadas pelo núcleo (zones.ts + restriction_zones + calendar.ts); esta camada só AVISA as suspensões publicadas pela
 * CET (rule_suspensions, importador cet_suspensoes) que valem no horário de saída e tocam a rota. Os avisos de feriado já
 * saem do routing.ts: 'holiday' (calendário de São Paulo capital quando a rota toca a capital; fora dela, só o nacional) e
 * 'holiday_local' (feriado do município da origem, na saída, e do destino, na chegada prevista).
 *
 * Base legal da suspensão: Decreto 58.584/2018 art. 8º (portaria da SMT; §2º permite suspender só um período do dia).
 * "MANTIDO para veículos pesados": a restrição continua para veículos de carga (leitura conservadora, ver zones.ts).
 */
const LAYER = 'core_legal';

const meta: RouteLayer['meta'] = {
  id: LAYER,
  label: 'Calendário legal (feriados do Sudeste e suspensões da CET)',
  description: 'Feriados nacionais, estaduais (SP, RJ, ES; MG só tem o 21/04) e municipais das capitais e polos do Sudeste, que suspendem as regras "exceto feriados" (ZMRC, rodízio e perigosos em São Paulo; regras municipais pelo município da regra), e suspensões publicadas pela CET. As zonas são aplicadas pelo núcleo; esta camada avisa as suspensões do dia que tocam a rota e o routing.ts avisa o feriado do município da origem e do destino.',
  group: 'calendario',
  sources: [
    { name: 'CET — suspensões do rodízio e da ZMRC (Relatório anual)', url: 'https://webforms.cetsp.com.br/suspensaorodizio/Relatorio', license: 'Ato oficial (Decreto 58.584/2018 art. 8º; Lei 9.610/98 art. 8º IV). Página sem licença explícita: citar a fonte' },
    { name: 'Feriados: Leis 662/1949, 6.802/1980 e 14.759/2023; Lei estadual SP 9.497/1997; Lei municipal SP 14.485/2007 art. 10', url: 'https://www.planalto.gov.br/ccivil_03/leis/l0662.htm', license: 'Ato oficial (Lei 9.610/98 art. 8º IV)' },
    { name: 'Feriados do Sudeste (importador feriados_sudeste): Leis estaduais RJ 5.243/2008, 5.198/2008 e 11.002/2025, Lei ES 11.010/2019, leis e decretos municipais (Querido Diário) e atos de feriados locais do TJMG, TJSP, TJRJ, TJES, TRF2, TRT3 e TRT17', url: 'http://alerjln1.alerj.rj.gov.br/contlei.nsf/f25edae7e64db53b032564fe005262ef?SearchView&Query=feriado&SearchMax=200', license: 'Ato oficial (Lei 9.610/98 art. 8º IV); cópias do Querido Diário (OKBR) e republicação do CNB-SP: citar a fonte' },
    { name: 'GeoSampa — restricao_circulacao_veiculo (ZMRC, Minianel) e segmento_logradouro (corredor do Minianel)', url: 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs', license: 'CC-BY-SA 4.0' },
  ],
  defaultVisible: false,
};

const SCOPE_LABEL: Record<string, string> = {
  rodizio: 'rodízio',
  zmrc: 'ZMRC',
  hazmat: 'restrição de produtos perigosos',
  all: 'rodízio, ZMRC e restrição de perigosos',
};
const PERIOD_LABEL: Record<string, string> = { manha: ' (manhã)', tarde: ' (tarde)' };

/**
 * A rota toca a zona? Conta a rota calculada, a rota livre (a zona pode ter sido evitada justamente por causa da regra),
 * a origem/destino e, se a rota livre não veio (o routing.ts a descarta quando o Valhalla falha), a reta origem-destino.
 */
function touches(z: ZoneRow, ctx: RouteCtx, route: RouteGeom): boolean {
  if (pointInZone(z, ctx.origin) || pointInZone(z, ctx.destination)) return true;
  const poly = turf.multiPolygon((z.geometry_endpoint ?? z.geometry_full).coordinates);
  const od = turf.lineString([[ctx.origin.lon, ctx.origin.lat], [ctx.destination.lon, ctx.destination.lat]]);
  return [route.line, route.free?.line ?? od].some((l) => turf.booleanIntersects(l, poly));
}

/** Zonas a que a suspensão se refere ('local' e 'all' valem para qualquer zona; 'zmrf' é de fretamento, sem zona no app). */
function zonesOf(s: Suspension, zones: ZoneRow[], hazmat: boolean): ZoneRow[] {
  const forVehicle = zones.filter((z) => !z.rules.hazmat_only || hazmat);
  if (s.scope === 'local' || s.scope === 'all') return forVehicle;
  return forVehicle.filter((z) => z.rules.suspension_scope === s.scope);
}

export function suspensionWarning(s: Suspension, day: string): LayerWarning | null {
  const desc = s.description ? ` (${s.description})` : '';
  const per = PERIOD_LABEL[s.period ?? ''] ?? '';
  const id = `${s.scope}:${s.period ?? 'dia'}:${s.applies_to_heavy ? 'pesados' : 'geral'}`;
  if (s.scope === 'local') {
    return { code: 'cet_suspension', severity: 'info', id,
      message: `A CET publicou para ${day} suspensão de restrição só em trecho específico${desc}${per}${s.raw_text ? `: ${s.raw_text}` : ''}. O app não aplica suspensão por trecho: confira a portaria antes de contar com ela.` };
  }
  const label = SCOPE_LABEL[s.scope];
  if (!label) return null;
  if (s.applies_to_heavy) {
    return { code: 'cet_suspension', severity: 'info', id,
      message: `A CET suspendeu ${label} em ${day}${per}${desc} só para veículos de passeio: MANTIDO para veículos pesados. Para veículo de carga a restrição continua valendo (o app a aplica normalmente).` };
  }
  return { code: 'cet_suspension', severity: 'info', id,
    message: `A CET suspendeu ${label} em ${day}${per}${desc} (Decreto 58.584/2018 art. 8º): a rota foi calculada sem essa restrição.` };
}

async function annotate(ctx: RouteCtx, route: RouteGeom): Promise<LayerAnnotation> {
  const day = await legalDayInfo(ctx.at);
  if (!day.suspensions.length) return {};
  const zones = await activeZones();
  const warnings: LayerWarning[] = [];
  for (const s of day.suspensions) {
    // num feriado a suspensão geral repete o aviso 'holiday' do routing.ts; só a "mantida para pesados" acrescenta algo
    if (day.holiday && !s.applies_to_heavy && s.scope !== 'local') continue;
    const zs = zonesOf(s, zones, !!ctx.vehicle.hazmat);
    if (!zs.some((z) => touches(z, ctx, route))) continue;
    const w = suspensionWarning(s, DateTime.fromJSDate(ctx.at).setZone(ctx.tz).toFormat('dd/LL/yyyy'));
    if (w && !warnings.some((x) => x.id === w.id)) warnings.push(w);
  }
  return warnings.length ? { warnings, summary: warnings.map((w) => w.message) } : {};
}

const layer: RouteLayer = { meta, annotate };
export default layer;
