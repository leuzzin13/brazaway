import type { Warning } from './routing.js';

/**
 * Prioriza os avisos da rota para quem está na cabine. A rota de teste média da simulação de 60 dias (660 rotas de
 * Sudeste, Sul e Centro-Oeste) trazia 12,5 avisos, e a equipe dos agentes relatou que "aviso demais vira barulho":
 * o motorista para de ler e passa a ignorar o app. `warnings` continua completo (painel, auditoria); estes campos são
 * para a tela do motorista:
 *  - alertas_motorista: no máximo 3, primeiro o que exige ação antes de sair (danger, zona no destino, janela,
 *    desvio grande), depois o que pede atenção na estrada;
 *  - resumo_avisos: contagem por grupo, com uma frase curta ("4 pontos de acidente, 1 área de roubo de carga e 2 radares").
 */
const AGIR = new Set(['destination_in_zone', 'origin_in_zone', 'origin_and_destination_in_zone', 'uses_restricted_way', 'large_detour',
  'height_below_default', 'janela_inviavel', 'rmsp_destino_na_zona', 'rmsp_via_restrita_na_rota', 'holiday', 'holiday_local']);
const GRUPOS: Record<string, string> = {
  accident_hotspot: 'acidentes', cargo_theft_area: 'roubo_carga', radar_na_rota: 'radares', radar_movel_reportado: 'radares',
  blitz_reportada: 'blitz', weigh_station: 'balancas', ponte_nota_baixa: 'pontes_nota_baixa', height_unknown_crossings: 'altura_desconhecida',
  near_report: 'reportes', near_unconfirmed_report: 'reportes', bus_lane_active: 'faixas_onibus', driving_time: 'jornada', no_rest_stop: 'jornada',
};
// técnicos: explicam o cálculo, não pedem nada ao motorista
const TECNICOS = new Set(['cost_line_ignored', 'oae_altura_ok', 'oae_limits_unknown', 'alerta_dnit_pendente', 'diesel_price_stale', 'toll_estimated',
  'siaet_folga_minima', 'rmsp_trecho_aproximado', 'municipal_regra_nao_aplicada', 'layer_error', 'loading_bay_near_destination']);
const ROTULO: Record<string, [string, string]> = {
  acidentes: ['ponto de acidente', 'pontos de acidente'], roubo_carga: ['área de roubo de carga', 'áreas de roubo de carga'],
  radares: ['radar', 'radares'], blitz: ['blitz reportada', 'blitz reportadas'], balancas: ['balança', 'balanças'],
  pontes_nota_baixa: ['ponte com nota baixa', 'pontes com nota baixa'], altura_desconhecida: ['passagem com altura desconhecida', 'passagens com altura desconhecida'],
  faixas_onibus: ['faixa de ônibus em horário', 'faixas de ônibus em horário'],
};

export interface ResumoAvisos { agir: number; atencao: number; grupos: Record<string, number>; tecnicos: number; frase: string }

const peso = (w: Warning) => (w.severity === 'danger' ? 0 : AGIR.has(w.code) ? 1 : 2);

export function priorizarAvisos(warnings: Warning[]): { alertas_motorista: Warning[]; resumo_avisos: ResumoAvisos } {
  const grupos: Record<string, number> = {};
  const candidatos: Warning[] = [];
  let tecnicos = 0, agir = 0, atencao = 0;
  for (const w of warnings) {
    if (TECNICOS.has(w.code)) { tecnicos++; continue; }
    const g = GRUPOS[w.code];
    if (w.severity === 'danger' || AGIR.has(w.code)) { agir++; candidatos.push(w); continue; }
    if (g) { grupos[g] = (grupos[g] ?? 0) + 1; continue; }
    if (w.severity === 'warn') { atencao++; candidatos.push(w); continue; }
    tecnicos++;
  }
  const alertas = candidatos.map((w, i) => ({ w, i })).sort((a, b) => peso(a.w) - peso(b.w) || a.i - b.i).slice(0, 3).map((x) => x.w);
  const partes = Object.entries(grupos).filter(([g]) => ROTULO[g]).sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${n} ${ROTULO[g][n === 1 ? 0 : 1]}`);
  const frase = partes.length ? (partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`) + ' na rota.' : '';
  return { alertas_motorista: alertas, resumo_avisos: { agir, atencao, grupos, tecnicos, frase } };
}
