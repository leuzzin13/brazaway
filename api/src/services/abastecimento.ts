import type { z } from 'zod';
import { AbastecimentoInput, type Conveniado } from '../schemas.js';
import { featuresNearRoute } from '../layers/data.js';
import { NEAR_M, toPosto, type PostoOnRoute } from '../layers/postos_diesel.layer.js';

/**
 * Plano de abastecimento: onde parar e quantos litros pôr ao longo da rota para gastar menos, chegando sempre com a
 * reserva. Usa os postos com preço da ANP a até 2 km da rota (camada postos_diesel) e, quando a transportadora tem
 * convênio, o preço ou o desconto dela (PIX, cartão frota). Na simulação de 60 dias o diesel foi 78% do custo e, nas
 * rotas acima de 150 km, o posto mais barato do caminho custava em mediana 5,6% menos que a média dos postos da rota.
 *
 * Algoritmo (problema clássico do posto de gasolina numa linha, guloso e ótimo sem custo fixo por parada): em cada
 * posto, se há outro mais barato ao alcance de um tanque, põe só o necessário para chegar nele com a reserva; senão,
 * enche (ou põe o que falta para terminar a viagem com a reserva). Compras pequenas demais são puladas, e o desvio até o
 * posto entra no preço efetivo. Preço da ANP é amostral e pode ter semanas: o plano manda conferir na bomba.
 */
export { AbastecimentoInput, Conveniado } from '../schemas.js';

// estimativas por tipo de caminhão quando o cadastro não traz (tanque em litros, consumo em km/L de diesel carregado)
const PADRAO: Record<string, { tanque_l: number; consumo_km_l: number }> = {
  utilitario: { tanque_l: 70, consumo_km_l: 8 }, vuc: { tanque_l: 150, consumo_km_l: 6 }, toco: { tanque_l: 275, consumo_km_l: 4.5 },
  truck: { tanque_l: 300, consumo_km_l: 3.5 }, carreta_5e: { tanque_l: 600, consumo_km_l: 2.4 }, carreta_6e: { tanque_l: 600, consumo_km_l: 2.2 },
  romeu_julieta: { tanque_l: 700, consumo_km_l: 2.0 }, bitrem: { tanque_l: 900, consumo_km_l: 1.9 }, rodotrem: { tanque_l: 1000, consumo_km_l: 1.7 },
};

export interface ParadaAbastecimento {
  km_rota: number; posto: string; bandeira: string | null; cnpj: string; municipio: string | null; uf: string | null;
  lat: number; lon: number; desvio_km: number; litros: number; preco_rs_l: number;
  origem_preco: 'anp' | 'convenio'; pagamento: string | null; coleta_anp: string | null; custo_rs: number;
}
export interface PlanoAbastecimento {
  combustivel: 'S10' | 'S500';
  tanque_l: number; consumo_km_l: number; nivel_saida_l: number; reserva_l: number;
  estimado: string[];                       // o que veio de estimativa por tipo de caminhão
  paradas: ParadaAbastecimento[];
  litros: number; custo_rs: number;
  preco_medio_rota_rs_l: number | null;     // média dos postos com preço a até 2 km da rota
  economia_vs_media_rs: number | null;      // mesmos litros comprados pelo preço médio da rota
  chega_com_l: number;
  avisos: string[];
}

/** custo fixo de uma parada para abastecer: ~20 min de motorista (R$ 40/h) e a manobra de entrar e sair do posto */
const PARADA_RS = 35;
const r2 = (x: number) => Math.round(x * 100) / 100;

interface Candidato { p: PostoOnRoute; preco: number; origem: 'anp' | 'convenio'; pagamento: string | null; coleta: string | null }

/** Preço efetivo do posto (convênio sobre a ANP) — null se não há preço do produto. */
function precoDo(p: PostoOnRoute, prod: 'diesel_s10' | 'diesel_s500', conv: Map<string, Conveniado>): Omit<Candidato, 'p'> | null {
  const anp = p[prod];
  const c = conv.get(p.cnpj);
  if (c?.preco_rs_l) return { preco: c.preco_rs_l, origem: 'convenio', pagamento: c.pagamento ?? null, coleta: anp?.data ?? null };
  if (!anp) return null;
  if (c?.desconto_rs_l) return { preco: r2(anp.valor - c.desconto_rs_l), origem: 'convenio', pagamento: c.pagamento ?? null, coleta: anp.data };
  return { preco: anp.valor, origem: 'anp', pagamento: null, coleta: anp.data };
}

export function planejar(postos: PostoOnRoute[], distanciaKm: number, preset: string | undefined, input: z.output<typeof AbastecimentoInput>): PlanoAbastecimento {
  const padrao = PADRAO[preset ?? ''] ?? PADRAO.truck;
  const estimado: string[] = [];
  const tanque = input.tanque_l ?? (estimado.push(`tanque de ${padrao.tanque_l} L`), padrao.tanque_l);
  const cons = input.consumo_km_l ?? (estimado.push(`consumo de ${padrao.consumo_km_l} km/L`), padrao.consumo_km_l);
  const nivel0 = input.nivel_l ?? (input.nivel_pct !== undefined ? (tanque * input.nivel_pct) / 100 : (estimado.push('saída com meio tanque'), tanque / 2));
  const reserva = (tanque * input.reserva_pct) / 100;
  const prod = input.combustivel === 's500' ? 'diesel_s500' : 'diesel_s10';
  const conv = new Map(input.conveniados.map((c) => [c.cnpj, c]));
  const avisos: string[] = [];

  // candidatos: com preço, com acesso de caminhão (o que o OSM diz "sem acesso" sai) e antes do destino
  const cand: Candidato[] = postos
    .filter((p) => p.km_rota < distanciaKm && p.aceita_caminhao !== 'sem acesso de caminhão (OSM)')
    .map((p) => { const x = precoDo(p, prod, conv); return x ? { p, ...x } : null; })
    .filter((x): x is Candidato => !!x)
    .sort((a, b) => a.p.km_rota - b.p.km_rota || a.preco - b.preco);
  const precosAnp = postos.map((p) => p[prod]?.valor).filter((v): v is number => typeof v === 'number');
  const media = precosAnp.length ? r2(precosAnp.reduce((s, v) => s + v, 0) / precosAnp.length) : null;

  // Programação dinâmica sobre (posto, litros no tanque em passos): cada parada custa PARADA_RS (≈20 min de motorista e
  // a manobra) mais o diesel do desvio; o tanque nunca fica abaixo da reserva entre postos e chega ao destino com ela.
  // Assim o plano não manda parar para pôr 2 litros: só para quando a diferença de preço paga a parada.
  const passo = Math.max(2, Math.round(tanque / 150));
  const N = Math.floor(tanque / passo);
  const minPassos = Math.ceil(reserva / passo);
  // consumo acumulado desde a origem, arredondado para cima uma vez só (o erro total fica abaixo de um passo)
  const acum = (km: number) => Math.ceil(km / cons / passo - 1e-9);
  const gasto = (kmA: number, kmB: number) => acum(kmB) - acum(kmA);
  const nos = [{ km: 0 }, ...cand.map((c) => ({ km: c.p.km_rota, c })), { km: distanciaKm }] as { km: number; c?: Candidato }[];
  const INF = Number.POSITIVE_INFINITY;
  const tab: number[][] = nos.map(() => new Array(N + 1).fill(INF));
  const de: ({ f0: number; compra: number } | null)[][] = nos.map(() => new Array(N + 1).fill(null));
  const f0 = Math.min(N, Math.floor(nivel0 / passo));
  tab[0][f0] = 0;
  if (f0 < minPassos) avisos.push(`Saída com ${Math.round(nivel0)} L, abaixo da reserva de ${Math.round(reserva)} L: abasteça antes de sair.`);
  for (let i = 0; i < nos.length - 1; i++) {
    const c = nos[i].c;
    const d = gasto(nos[i].km, nos[i + 1].km);
    for (let f = 0; f <= N; f++) {
      if (tab[i][f] === INF) continue;
      const opcoes = c ? N - f : 0;
      for (let k = 0; k <= opcoes; k++) {
        const h = f + k - d;
        if (h < (i === 0 ? 0 : minPassos)) continue;            // da origem só precisa chegar; depois, nunca abaixo da reserva
        const valor = k > 0 && c ? k * passo * c.preco + PARADA_RS + (c.p.desvio_km / cons) * c.preco : 0;
        const tot = tab[i][f] + valor;
        if (tot < tab[i + 1][h] - 1e-9) { tab[i + 1][h] = tot; de[i + 1][h] = { f0: f, compra: k }; }
      }
    }
  }
  const fim = nos.length - 1;
  let melhor = -1;
  for (let f = 0; f <= N; f++) if (tab[fim][f] < INF && (melhor < 0 || tab[fim][f] < tab[fim][melhor] - 1e-9)) melhor = f;
  const paradas: ParadaAbastecimento[] = [];
  let comb = melhor >= 0 ? melhor * passo : 0;
  for (let i = fim, f = melhor; i > 0 && f >= 0; i--) {
    const x = de[i][f];
    if (!x) break;
    const c = nos[i - 1].c;
    if (x.compra > 0 && c) {
      const desvioL = c.p.desvio_km / cons;
      const litrosP = x.compra * passo + desvioL;
      paradas.unshift({
        km_rota: c.p.km_rota, posto: c.p.nome, bandeira: c.p.bandeira, cnpj: c.p.cnpj, municipio: c.p.municipio, uf: c.p.uf,
        lat: c.p.lat, lon: c.p.lon, desvio_km: c.p.desvio_km, litros: Math.round(litrosP), preco_rs_l: c.preco,
        origem_preco: c.origem, pagamento: c.pagamento, coleta_anp: c.coleta, custo_rs: r2(litrosP * c.preco),
      });
    }
    f = x.f0;
  }
  if (melhor < 0 || melhor < minPassos) avisos.push(cand.length
    ? 'Não há postos com preço suficientes no caminho para chegar com a reserva: abasteça na saída ou num posto conhecido.'
    : 'Nenhum posto com preço de diesel da ANP a até 2 km da rota: o plano não tem onde parar. Abasteça na saída.');
  const litros = paradas.reduce((s, p) => s + p.litros, 0);
  const custo = r2(paradas.reduce((s, p) => s + p.custo_rs, 0));
  if (paradas.some((p) => p.origem_preco === 'anp')) avisos.push('Preço da ANP é de pesquisa amostral (veja a data da coleta): confira na bomba antes de abastecer.');
  return {
    combustivel: prod === 'diesel_s10' ? 'S10' : 'S500', tanque_l: tanque, consumo_km_l: cons, nivel_saida_l: Math.round(nivel0), reserva_l: Math.round(reserva),
    estimado, paradas, litros, custo_rs: custo, preco_medio_rota_rs_l: media,
    economia_vs_media_rs: media !== null && litros ? r2(litros * media - custo) : null,
    chega_com_l: Math.max(0, Math.round(comb)), avisos,
  };
}

/** Busca os postos com preço a até 2 km da rota e monta o plano. */
export async function planoAbastecimento(line: GeoJSON.LineString, distanciaKm: number, preset: string | undefined, input: AbastecimentoInput): Promise<PlanoAbastecimento> {
  const rows = await featuresNearRoute('postos_diesel', line, NEAR_M, { limit: 3000, where: `f.kind = 'com_preco'` });
  return planejar(rows.map((r) => toPosto(r, distanciaKm)), distanciaKm, preset, AbastecimentoInput.parse(input));
}
