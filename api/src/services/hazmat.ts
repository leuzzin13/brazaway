/**
 * Produtos perigosos (PP): tabela ONU, grupos de São Paulo e isenção por quantidade limitada.
 *
 *  - Tabela ONU: Relação de Produtos Perigosos da Res. ANTT 5.998/2022 (Parte 3, cap. 3.2), extraída do PDF oficial
 *    (data/raw/hazmat/*.py). Colunas usadas: nº ONU (1), nome (2), classe (3), risco subsidiário (4), nº de risco (5),
 *    grupo de embalagem (6) e quantidade limitada por veículo (8).
 *  - Grupos de São Paulo: Portaria SMT.GAB 051/2024, art. 2º e Anexos I a III; o grupo I ("alta periculosidade
 *    intrínseca") são os demais produtos da classificação ONU (Decreto 50.446/2009, art. 3º I). O Anexo II tem dois
 *    qualificadores: 1075 só "ENGARRAFADOS/FRACIONADO" e 3082 só "BIODIESEL, conforme estabelecido pela ABNT NBR 15512".
 *  - Isenção por quantidade limitada por veículo: Res. ANTT 5.998/2022, Parte 3, itens 3.4.3.1 (até o valor da coluna 8;
 *    "zero" = sem isenção), 3.4.3.2 (vale o menor valor entre os produtos, sobre o peso bruto total do carregamento) e
 *    3.4.3.4 c (dispensa das "limitações quanto a itinerário, estacionamento e locais de carga e descarga" do próprio
 *    regulamento). A isenção NÃO alcança as restrições criadas pelo órgão da via: a Portaria SMT.GAB 051/2024, art. 3º
 *    ("veículos que transportam produtos perigosos") e as portarias do DER-SP (PR/DER-164/2025 art. 2º; SUP/DER-062/2024
 *    art. 1º: "veículos transportando produtos perigosos") não têm exceção por quantidade. Também não dispensa a LETPP
 *    em São Paulo (Decreto 50.446/2009, art. 5º; FAQ PMSP 2019, itens 32 e 33).
 */
import type { Vehicle } from './vehicle.js';

/** Citações usadas nos avisos (todas conferidas no texto da norma; ver docs/layers/perigosos.md). */
export const LEGAL = {
  relacao: 'Res. ANTT 5.998/2022, Parte 3, Relação de Produtos Perigosos',
  qtdLimitada: 'Res. ANTT 5.998/2022, Parte 3, itens 3.4.3.2 e 3.4.3.4 c',
  gruposSP: 'Portaria SMT.GAB 051/2024, art. 2º e Anexos I a III',
  grupoI: 'Decreto 50.446/2009, art. 3º I',
  minianel: 'Portaria SMT.GAB 051/2024, art. 3º I e Anexo IV',
  centroExpandido: 'Portaria SMT.GAB 051/2024, art. 3º II e parágrafo único',
  zmrc: 'Portaria SMT.GAB 137/2018, art. 35',
  letpp: 'Decreto 50.446/2009, art. 5º',
  mananciais: 'Decreto 96.044/1988, art. 9º',
  viaRestrita: 'Decreto 96.044/1988, art. 12',
  estacionamento: 'Decreto 96.044/1988, art. 14',
} as const;

/** Portaria SMT.GAB 051/2024, art. 3º: "de segundas às sextas-feiras, exceto feriados, no período das 07 às 10 horas e das 17 às 20 horas". */
export const SP_HAZMAT_WINDOWS = [
  { days: [1, 2, 3, 4, 5], from: '07:00', to: '10:00' },
  { days: [1, 2, 3, 4, 5], from: '17:00', to: '20:00' },
] as const;

/** Coluna 8 normalizada: kg (peso bruto total) ou um dos casos especiais. */
export type LqVehicle = number | 'ZERO' | 'ILIMITADA' | 'NAO_SUJEITO' | 'PROIBIDO' | 'VER_PE';

export interface HazmatProduct {
  un: string;
  name: string;
  /** classe ou subclasse de risco principal (coluna 3) */
  cls: string;
  /** todas as classes da linha (há nº ONU com mais de uma entrada) */
  classes: string[];
  subsidiaryRisk: string;
  riskNumber: string;
  packingGroups: string;
  /** quantidade limitada por veículo (coluna 8), menor valor da linha */
  lqVehicle: LqVehicle;
}

const LQ_CODES: Record<string, LqVehicle> = { Z: 'ZERO', I: 'ILIMITADA', N: 'NAO_SUJEITO', P: 'PROIBIDO', V: 'VER_PE' };

let INDEX: Map<string, HazmatProduct> | null = null;
function table(): Map<string, HazmatProduct> {
  if (INDEX) return INDEX;
  INDEX = new Map();
  for (const line of RELACAO_ANTT_RAW.split('\n')) {
    if (!line) continue;
    const [un, cls, classes, sub, risk, pg, q, name] = line.split('|');
    INDEX.set(un, {
      un, name, cls, classes: classes ? classes.split(' ') : [], subsidiaryRisk: sub, riskNumber: risk, packingGroups: pg,
      lqVehicle: LQ_CODES[q] ?? Number(q),
    });
  }
  return INDEX;
}

/** Todos os nº ONU (4 dígitos) de um texto livre: "1203", "UN 1203", "ONU1203/1202". */
export function parseUns(s?: string | null): string[] {
  const out: string[] = [];
  for (const m of String(s ?? '').matchAll(/(?<!\d)\d{4}(?!\d)/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

export function getProduct(un: string): HazmatProduct | undefined {
  return table().get(un);
}

export function productCount(): number {
  return table().size;
}

/** "ONU 1203 (COMBUSTÍVEL PARA MOTORES ou GASOLINA…, classe 3)" */
export function describeProduct(un: string): string {
  const p = getProduct(un);
  if (!p) return `ONU ${un} (não consta na Relação da ANTT)`;
  const name = p.name.length > 48 ? `${p.name.slice(0, 48).replace(/[\s,;(]+\S*$/, '')}…` : p.name;
  return `ONU ${un} (${name}, classe ${p.cls || '?'})`;
}

// ---------------------------------------------------------------------------------------------------------------
// Grupos da Portaria SMT.GAB 051/2024 (São Paulo capital)
// ---------------------------------------------------------------------------------------------------------------

/** Anexo I = grupo II (alta frequência de circulação). */
const ANEXO_I = new Set(['1001', '1005', '1072', '1073', '1075', '1170', '1202', '1203', '1223', '1263', '1791', '1823', '1824', '1830', '1863', '1977', '3077', '3082', '3475']);
/** Anexo II = grupo III (consumo local). */
const ANEXO_II = new Set(['1002', '1003', '1006', '1046', '1066', '1070', '1072', '1073', '1075', '1170', '1202', '1203', '1951', '1963', '1966', '1977', '2187', '2201', '3082', '3475']);
/** Anexo III = grupo IV (outros). */
const ANEXO_III = new Set(['1660', '2908', '2910', '2911', '2915', '2916', '3291', '3332', '3373']);
/**
 * Qualificadores do Anexo II (texto da portaria). `hazmat_local_delivery` cobre só a condição de entrega fracionada para
 * consumo local, que é o que o qualificador do 1075 descreve. O 3082 do Anexo II é só o biodiesel: sem a indicação
 * explícita (`hazmat_biodiesel`), um 3082 continua no grupo II mesmo com entrega local.
 */
export const ANEXO_II_QUALIFIER: Record<string, string> = {
  '1075': 'ENGARRAFADOS/FRACIONADO',
  '3082': 'BIODIESEL, conforme estabelecido pela ABNT NBR 15512',
};

export type SpGroup = 'I' | 'II' | 'III' | 'IV';
export interface SpGroupInfo {
  group: SpGroup;
  label: string;
  /** anexos da Portaria 051/2024 em que o nº ONU aparece */
  annexes: string[];
  /** o nº ONU está nos Anexos I e II: o grupo depende de ser entrega fracionada para consumo local */
  ambiguous: boolean;
  /** qualificador do Anexo II para este nº ONU, se houver */
  annexIIQualifier?: string;
  /** entrega local informada, mas falta a condição do qualificador (3082 sem indicação de biodiesel) */
  qualifierMissing: boolean;
  /** pode circular no centro expandido nas janelas (art. 3º parágrafo único: só grupos III e IV) */
  interiorAllowed: boolean;
  basis: string;
}

const GROUP_LABEL: Record<SpGroup, string> = {
  I: 'grupo I (alta periculosidade intrínseca)',
  II: 'grupo II (alta frequência de circulação)',
  III: 'grupo III (consumo local)',
  IV: 'grupo IV (outros)',
};

/**
 * Grupo de um nº ONU na Portaria SMT.GAB 051/2024. `localDelivery` = carga fracionada para consumo local (ex.: GLP
 * engarrafado), que decide os nº ONU listados nos Anexos I e II; `biodiesel` = o 3082 é biodiesel (ABNT NBR 15512),
 * condição do Anexo II para esse número. Sem a informação, fica o grupo II (mais restritivo).
 */
export function spGroup(un: string, localDelivery = false, biodiesel = false): SpGroupInfo {
  const annexes = [ANEXO_I.has(un) && 'I', ANEXO_II.has(un) && 'II', ANEXO_III.has(un) && 'III'].filter(Boolean) as string[];
  const ambiguous = ANEXO_I.has(un) && ANEXO_II.has(un);
  const annexIIQualifier = ANEXO_II.has(un) ? ANEXO_II_QUALIFIER[un] : undefined;
  const qualifierMet = un !== '3082' || biodiesel;
  let group: SpGroup;
  let basis: string = LEGAL.gruposSP;
  if (ANEXO_III.has(un)) group = 'IV';
  else if (ambiguous) group = localDelivery && qualifierMet ? 'III' : 'II';
  else if (ANEXO_II.has(un)) group = 'III';
  else if (ANEXO_I.has(un)) group = 'II';
  else { group = 'I'; basis = `${LEGAL.grupoI}; ${LEGAL.gruposSP}`; }
  return {
    group, label: GROUP_LABEL[group], annexes, ambiguous, annexIIQualifier,
    qualifierMissing: ambiguous && localDelivery && !qualifierMet,
    interiorAllowed: group === 'III' || group === 'IV', basis,
  };
}

/** Carregamento com vários produtos: vale o grupo mais restritivo (qualquer produto fora dos grupos III/IV). */
export function spGroupForLoad(uns: string[], localDelivery = false, biodiesel = false): SpGroupInfo | undefined {
  if (!uns.length) return undefined;
  const infos = uns.map((u) => spGroup(u, localDelivery, biodiesel));
  return infos.find((i) => !i.interiorAllowed) ?? infos[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Isenção por quantidade limitada por veículo
// ---------------------------------------------------------------------------------------------------------------

export interface LimitedQtyInfo {
  /** limite em kg de peso bruto total (menor entre os produtos); 0 = sem isenção; Infinity = ilimitada; null = indefinido */
  limitKg: number | null;
  /** true/false quando o peso bruto informado permite decidir; null sem peso ou sem limite definido */
  exempt: boolean | null;
  /** texto curto para o resumo */
  text: string;
}

/** O que a isenção alcança e o que não alcança (3.4.3.4 c x restrições do órgão da via). */
const LQ_SCOPE = 'dispensa só as limitações de itinerário e estacionamento do regulamento da ANTT; as restrições municipais e do DER continuam valendo';

export function limitedQuantity(uns: string[], grossKg?: number | null): LimitedQtyInfo {
  if (!uns.length) return { limitKg: null, exempt: null, text: 'Sem nº ONU: não dá para conferir a isenção por quantidade limitada.' };
  let limit = Infinity;
  let undefinedLimit = false;
  for (const u of uns) {
    const p = getProduct(u);
    const q = p?.lqVehicle;
    if (q === undefined || q === 'VER_PE') { undefinedLimit = true; continue; }
    if (q === 'NAO_SUJEITO' || q === 'ILIMITADA') continue;
    if (q === 'ZERO' || q === 'PROIBIDO') { limit = 0; continue; }
    limit = Math.min(limit, q);
  }
  if (limit === 0) return { limitKg: 0, exempt: false, text: `Sem isenção por quantidade limitada (coluna 8 = "zero"; ${LEGAL.qtdLimitada}).` };
  if (undefinedLimit) return { limitKg: null, exempt: null, text: 'Quantidade limitada por veículo não definida na Relação (provisão especial ou nº ONU desconhecido): sem isenção automática.' };
  const fmt = limit === Infinity ? 'ilimitada' : `${limit.toLocaleString('pt-BR')} kg de peso bruto`;
  if (grossKg === undefined || grossKg === null || !Number.isFinite(grossKg)) {
    return { limitKg: limit, exempt: null, text: `Quantidade limitada por veículo: ${fmt} (${LEGAL.qtdLimitada}). Abaixo disso a isenção ${LQ_SCOPE}; informe o peso bruto da carga.` };
  }
  const exempt = grossKg <= limit;
  return {
    limitKg: limit, exempt,
    text: exempt
      ? `Carga de ${grossKg.toLocaleString('pt-BR')} kg dentro da quantidade limitada (${fmt}; ${LEGAL.qtdLimitada}): a isenção ${LQ_SCOPE}.`
      : `Carga de ${grossKg.toLocaleString('pt-BR')} kg acima da quantidade limitada (${fmt}): sem isenção.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Perfil de PP do veículo
// ---------------------------------------------------------------------------------------------------------------

export interface HazmatVehicleInfo {
  /**
   * o veículo transporta PP: só `vehicle.hazmat`, que é o que o resto da pilha usa (costing do Valhalla com OSM
   * hazmat=no, reportes hazmat_ban e zonas hazmat_only). Assim a rota não sai protegida pela metade.
   */
  active: boolean;
  /** nº ONU ou cargo_type 'hazmat' informados sem `vehicle.hazmat`: nenhuma regra de PP foi aplicada (aviso) */
  declaredWithoutFlag: boolean;
  uns: string[];
  /** nº ONU que não estão na Relação da ANTT */
  unknownUns: string[];
  group?: SpGroupInfo;
  lq: LimitedQtyInfo;
  grossKg?: number;
  localDelivery: boolean;
  biodiesel: boolean;
  /** algum produto tem "TRANSPORTE PROIBIDO" na Relação */
  prohibited: string[];
  /** todos os produtos informados estão como "não sujeito" ao regulamento */
  notSubject: boolean;
  /**
   * dentro da quantidade limitada (peso bruto informado e <= limite): dispensa só as limitações de itinerário e
   * estacionamento do regulamento da ANTT (3.4.3.4 c). Não tira as restrições do município nem do DER.
   */
  lqExempt: boolean;
}

/** Campos opcionais que outras frentes podem acrescentar ao schema do veículo (lidos de forma defensiva). */
type VehicleExtras = { hazmat_local_delivery?: boolean; hazmat_biodiesel?: boolean; hazmat_qty_kg?: number; hazmat_gross_kg?: number };

export function hazmatInfo(v: Vehicle): HazmatVehicleInfo {
  const x = v as Vehicle & VehicleExtras;
  const uns = parseUns(v.hazmat_un);
  const active = !!v.hazmat;
  const grossRaw = x.hazmat_qty_kg ?? x.hazmat_gross_kg;
  const grossKg = typeof grossRaw === 'number' && Number.isFinite(grossRaw) && grossRaw >= 0 ? grossRaw : undefined;
  const localDelivery = !!x.hazmat_local_delivery;
  const biodiesel = !!x.hazmat_biodiesel;
  const lq = limitedQuantity(uns, grossKg);
  const products = uns.map(getProduct);
  return {
    active,
    declaredWithoutFlag: !active && (uns.length > 0 || v.cargo_type === 'hazmat'),
    uns,
    unknownUns: uns.filter((_, i) => !products[i]),
    group: spGroupForLoad(uns, localDelivery, biodiesel),
    lq, grossKg, localDelivery, biodiesel,
    prohibited: products.filter((p) => p?.lqVehicle === 'PROIBIDO').map((p) => p!.un),
    notSubject: products.length > 0 && products.every((p) => p?.lqVehicle === 'NAO_SUJEITO'),
    lqExempt: active && lq.exempt === true,
  };
}

// <<RELACAO_ANTT (gerado por data/raw/hazmat/build_relacao.py a partir de relacao_antt_5998_2022.csv; não edite à mão)
const RELACAO_ANTT_RAW = `
0004|1.1D|1.1D||||20|PICRATO DE AMÔNIO seco ou umedecido com menos de 10% de água, em massa
0005|1.1F|1.1F||||20|CARTUCHOS PARA ARMAS com carga de ruptura
0006|1.1E|1.1E||||20|CARTUCHOS PARA ARMAS com carga de ruptura
0007|1.2F|1.2F||||20|CARTUCHOS PARA ARMAS com carga de ruptura
0009|1.2G|1.2G||||20|MUNIÇÃO, INCENDIÁRIA com ou sem ruptor, carga ejetora ou carga propelente
0010|1.3G|1.3G||||20|MUNIÇÃO, INCENDIÁRIA com ou sem ruptor, carga ejetora ou carga propelente
0012|1.4S|1.4S||||I|CARTUCHOS PARA ARMAS, PROJÉTEIS INERTES ou CARTUCHOS, ARMAS PORTÁTEIS
0014|1.4S|1.4S||||I|CARTUCHOS PARA ARMAS, FESTIM ou CARTUCHOS PARA ARMAS PORTÁTEIS, FESTIM ou CARTUCHOS
0015|1.2G|1.2G||||20|MUNIÇÃO, FUMÍGENA com ou sem ruptor, carga ejetora ou carga propelente
0016|1.3G|1.3G||||20|MUNIÇÃO, FUMÍGENA com ou sem ruptor, carga ejetora ou carga propelente
0018|1.2G|1.2G|6.1 8|||20|MUNIÇÃO, LACRIMOGÊNEA com ruptor, carga ejetora ou carga propelente
0019|1.3G|1.3G|6.1 8|||20|MUNIÇÃO, LACRIMOGÊNEA com ruptor, carga ejetora ou carga propelente
0020|1.2K|1.2K|6.1|||Z|MUNIÇÃO, TÓXICA com ruptor, carga ejetora ou carga propelente
0021|1.3K|1.3K|6.1|||Z|MUNIÇÃO, TÓXICA com ruptor, carga ejetora ou carga propelente
0027|1.1D|1.1D||||20|PÓLVORA NEGRA, granulada ou em pó
0028|1.1D|1.1D||||20|PÓLVORA NEGRA, COMPRIMIDA ou PÓLVORA NEGRA, EM PASTILHAS
0029|1.1B|1.1B||||20|DETONADORES, NÃO ELÉTRICOS para demolição
0030|1.1B|1.1B||||20|DETONADORES, ELÉTRICOS para demolição
0033|1.1F|1.1F||||20|BOMBAS com carga de ruptura
0034|1.1D|1.1D||||20|BOMBAS com carga de ruptura
0035|1.2D|1.2D||||20|BOMBAS com carga de ruptura
0037|1.1F|1.1F||||20|BOMBAS, FOTO-ILUMINANTE
0038|1.1D|1.1D||||20|BOMBAS, FOTO-ILUMINANTES
0039|1.2G|1.2G||||20|BOMBAS, FOTO-ILUMINANTES
0042|1.1D|1.1D||||20|REFORÇADORES sem detonador
0043|1.1D|1.1D||||20|RUPTORES, explosivos
0044|1.4S|1.4S||||I|INICIADORES, TIPO CÁPSULA
0048|1.1D|1.1D||||20|CARGAS DE DEMOLIÇÃO
0049|1.1G|1.1G||||20|CARTUCHOS, ILUMINANTES
0050|1.3G|1.3G||||20|CARTUCHOS, ILUMINANTES
0054|1.3G|1.3G||1||20|CARTUCHOS PARA SINALIZAÇÃO
0055|1.4S|1.4S||||I|ESTOJOS DE CARTUCHOS, VAZIOS, COM INICIADOR
0056|1.1D|1.1D||||20|CARGAS DE PROFUNDIDADE
0059|1.1D|1.1D||||20|CARGAS, MOLDADAS sem detonador
0060|1.1D|1.1D||||20|CARGAS, SUPLEMENTARES, EXPLOSIVAS
0065|1.1D|1.1D||||20|CORDEL, DETONANTE, flexível
0066|1.4G|1.4G||||333|CORDEL, ACENDEDOR
0070|1.4S|1.4S||||I|CORTA-CABOS, EXPLOSIVOS
0072|1.1D|1.1D||||20|CICLOTRIMETILENO TRINITRAMINA (CICLONITA; HEXOGÊNIO; RDX), UMEDECIDA com no mínimo, 15%
0073|1.1B|1.1B||||20|DETONADORES PARA MUNIÇÃO
0074|1.1A|1.1A||||Z|DIAZODINITROFENOL, UMEDECIDO com no mínimo 40% de água, ou mistura de álcool e água, em massa
0075|1.1D|1.1D||||20|DINITRATO DE DIETILENOGLICOL, INSENSIBILIZADO com no mínimo 25% de insensibilizante não volátil e
0076|1.1D|1.1D|6.1|||20|DINITROFENOL, seco ou umedecido com menos de 15% de água, em massa
0077|1.3C|1.3C|6.1|||20|DINITROFENOLATOS, metais alcalinos, secos ou umedecidos com menos de 15% de água, em massa
0078|1.1D|1.1D||||20|DINITRORESORCINOL, seco ou umedecido com menos de 15% de água, em massa
0079|1.1D|1.1D||||20|HEXANITRODIFENILAMINA (DIPICRILAMINA; HEXIL)
0081|1.1D|1.1D||||20|EXPLOSIVOS DE DEMOLIÇÃO, TIPO A
0082|1.1D|1.1D||||20|EXPLOSIVOS DE DEMOLIÇÃO, TIPO B
0083|1.1D|1.1D||||20|EXPLOSIVOS DE DEMOLIÇÃO, TIPO C
0084|1.1D|1.1D||||20|EXPLOSIVOS DE DEMOLIÇÃO, TIPO D
0092|1.3G|1.3G||||20|FACHOS DE SINALIZAÇÃO, SUPERFÍCIE
0093|1.3G|1.3G||||20|FACHOS DE SINALIZAÇÃO, AÉREOS
0094|1.1G|1.1G||||20|COMPOSIÇÃO ILUMINANTE EM PÓ
0099|1.1D|1.1D||||20|DISPOSITIVOS DE FRATURAMENTO, EXPLOSIVOS para poços de petróleo, sem detonador
0101|1.3G|1.3G||||20|ESTOPIM, NÃO DETONANTE
0102|1.2D|1.2D||||20|CORDEL (ESTOPIM), DETONANTE, com revestimento metálico
0103|1.4G|1.4G||||333|ESTOPIM, ACENDEDOR, tubular, com revestimento metálico
0104|1.4D|1.4D||||333|CORDEL (ESTOPIM), DETONANTE, DE EFEITO SUAVE, com revestimento metálico
0105|1.4S|1.4S||||I|ESTOPIM, DE SEGURANÇA
0106|1.1B|1.1B||||20|ESTOPILHA, DE DETONAÇÃO
0107|1.2B|1.2B||2||20|ESTOPILHA, DE DETONAÇÃO
0110|1.4S|1.4S||||I|GRANADAS, PARA EXERCÍCIO, manuais ou para fuzil
0113|1.1A|1.1A||||Z|GUANIL NITROSAMINO-GUANILIDENO HIDRAZINA, UMEDECIDA com no mínimo 30% de água, em massa
0114|1.1A|1.1A||||Z|GUANIL NITROSAMINO-GUANILTETRAZENO (TETRAZENO), UMEDECIDO com no mínimo 30% de água, ou…
0118|1.1D|1.1D||||20|HEXOLITA (HEXOTOL) seca ou umedecida com menos de 15% de água, em massa
0121|1.1G|1.1G||||20|ACENDEDORES
0124|1.1D|1.1D||||20|CANHÕES PARA JATO-PERFURAÇÃO em poços de petróleo, CARREGADOS, sem detonador
0129|1.1A|1.1A||||Z|AZIDA DE CHUMBO, UMEDECIDA com no mínimo 20% de água, ou mistura de álcool e água, em massa
0130|1.1A|1.1A||||Z|ESTIFINATO DE CHUMBO (TRINITRORESORCINATO DE CHUMBO), UMEDECIDO com no mínimo 20% de…
0131|1.4S|1.4S||||I|ACENDEDORES, ESTOPIM
0132|1.3C|1.3C||||20|SAIS METÁLICOS DEFLAGRANTES DE NITRODERIVADOS AROMÁTICOS, N.E.
0133|1.1D|1.1D||||20|HEXANITRATO DE MANITOL (NITROMANITA), UMEDECIDO com no mínimo 40% de água, ou mistura de álcool
0135|1.1A|1.1A||||Z|FULMINATO DE MERCÚRIO, UMEDECIDO com no mínimo 20% de água, ou mistura de álcool e água, em massa
0136|1.1F|1.1F||||20|MINAS com carga de ruptura
0137|1.1D|1.1D||||20|MINAS com carga de ruptura
0138|1.2D|1.2D||||20|MINAS com carga de ruptura
0143|1.1D|1.1D|6.1|||20|NITROGLICERINA, INSENSIBILIZADA com no mínimo 40% de insensibilizante não-volátil e insolúvel em água, em
0144|1.1D|1.1D||||20|NITROGLICERINA, EM SOLUÇÃO ALCOÓLICA com mais de 1% e até 10% de nitroglicerina
0146|1.1D|1.1D||||20|NITROAMIDO, seco ou umedecido com menos de 20% de água, em massa
0147|1.1D|1.1D||||20|NITROURÉIA
0150|1.1D|1.1D||||20|TETRANITRATO DE PENTAERITRITA (TETRANITRATO DE PENTAERITRITOL; PETN), UMEDECIDO com no
0151|1.1D|1.1D||||20|PENTOLITA, seca ou umedecida com menos de 15% de água, em massa
0153|1.1D|1.1D||||20|TRINITROANILINA (PICRAMIDA)
0154|1.1D|1.1D||||20|TRINITROFENOL (ÁCIDO PÍCRICO), seco ou umedecido com menos de 30% de água, em massa
0155|1.1D|1.1D||||20|TRINITROCLOROBENZENO (CLORETO DE PICRILA)
0159|1.3C|1.3C||||20|PÓLVORA EM PASTA, UMEDECIDA com no mínimo 25% de água, em massa
0160|1.1C|1.1C||3||20|PÓLVORA, SEM FUMAÇA
0161|1.3C|1.3C||||20|PÓLVORA, SEM FUMAÇA
0167|1.1F|1.1F||||20|PROJÉTEIS com carga de ruptura
0168|1.1D|1.1D||||20|PROJÉTIES com carga de ruptura
0169|1.2D|1.2D||||20|PROJÉTEIS com carga de ruptura
0171|1.2G|1.2G||||20|MUNIÇÃO, ILUMINANTE com ou sem ruptor, carga ejetora ou carga propelente
0173|1.4S|1.4S||||I|DISPOSITIVOS DE ALÍVIO, EXPLOSIVOS
0174|1.4S|1.4S||||I|REBITES, EXPLOSIVOS
0180|1.1F|1.1F||||20|FOGUETES com carga de ruptura
0181|1.1E|1.1E||||20|FOGUETES com carga de ruptura
0182|1.2E|1.2E||||20|FOGUETES com carga de ruptura
0183|1.3C|1.3C||||20|FOGUETES com ogiva inerte
0186|1.3C|1.3C||||20|MOTORES DE FOGUETES
0190||||||Z|EXPLOSIVOS, AMOSTRAS, não-iniciantes
0191|1.4G|1.4G||||333|SINALIZADORES, MANUAIS
0192|1.1G|1.1G||||20|SINALIZADORES, PARA VIAS FÉRREAS, EXPLOSIVOS
0193|1.4S|1.4S||||I|SINALIZADORES, PARA VIAS FÉRREAS, EXPLOSIVOS
0194|1.1G|1.1G||||20|SINALIZADORES, DE EMERGÊNCIA, para navios
0195|1.3G|1.3G||||20|SINALIZADORES, DE EMERGÊNCIA, para navios
0196|1.1G|1.1G||||20|SINALIZADORES, DE FUMAÇA
0197|1.4G|1.4G||||333|SINALIZADORES, DE FUMAÇA
0204|1.2F|1.2F||||20|DISPOSITIVOS DE SONDAGEM, EXPLOSIVOS
0207|1.1D|1.1D||||20|TETRANITROANILINA
0208|1.1D|1.1D||||20|TRINITROFENIL-METILNITRAMINA (TETRIL)
0209|1.1D|1.1D||||20|TRINITROTOLUENO (TNT), seco ou umedecido com menos de 30% de água, em massa
0212|1.3G|1.3G||||20|TRAÇANTES PARA MUNIÇÃO
0213|1.1D|1.1D||||20|TRINITROANISOL
0214|1.1D|1.1D||||20|TRINITROBENZENO, seco ou umedecido com menos de 30% de água, em massa
0215|1.1D|1.1D||||20|ÁCIDO TRINITROBENZÓICO, seco ou umedecido com menos de 30% de água, em massa
0216|1.1D|1.1D||4||20|TRINITRO-m-CRESOL
0217|1.1D|1.1D||||20|TRINITRONAFTALENO
0218|1.1D|1.1D||||20|TRINITROFENETOL
0219|1.1D|1.1D||||20|TRINITRO-RESORCINOL (ÁCIDO ESTIFÍNICO), seco ou umedecido com menos de 20% de água, ou mistura de…
0220|1.1D|1.1D||||20|NITRATO DE URÉIA, seco ou umedecido com menos de 20% de água, em massa
0221|1.1D|1.1D||||20|OGIVAS, TORPEDOS com carga de ruptura
0222|1.1D|1.1D||||20|NITRATO DE AMÔNIO
0224|1.1A|1.1A|6.1|||Z|AZIDA DE BÁRIO, seca ou umedecida com menos de 50% de água, em massa
0225|1.1B|1.1B||||20|REFORÇADORES COM DETONADOR
0226|1.1D|1.1D||||20|CICLOTETRAMETILENOTETRANITRAMINA (HMX; OCTOGÊNIO) UMEDECIDA com no mínimo 15% de água,…
0234|1.3C|1.3C||||20|DINITRO-o-CRESOLATO DE SÓDIO, seco ou umedecido com menos de 15% de água, em massa
0235|1.3C|1.3C||||20|PICRAMATO DE SÓDIO, seco ou umedecido com menos de 20% de água, em massa
0236|1.3C|1.3C||||20|PICRAMATO DE ZIRCÔNIO, seco ou umedecido com menos de 20% de água, em massa
0237|1.4D|1.4D||||333|CARGAS, MOLDADAS, FLEXÍVEIS, LINEARES
0238|1.2G|1.2G||||20|FOGUETES, PARA LANÇAMENTO DE LINHA
0240|1.3G|1.3G||||20|FOGUETES, PARA LANÇAMENTO DE LINHA
0241|1.1D|1.1D||||20|EXPLOSIVOS, DE DEMOLIÇÃO, TIPO E
0242|1.3C|1.3C||||20|CARGAS, PROPELENTES, PARA CANHÃO
0243|1.2H|1.2H||||20|MUNIÇÃO INCENDIÁRIA, À BASE DE FÓSFORO BRANCO com ruptor, carga ejetora ou carga propelente
0244|1.3H|1.3H||||20|MUNIÇÃO INCENDIÁRIA, À BASE DE FÓSFORO BRANCO com ruptor, carga ejetora ou carga propelente
0245|1.2H|1.2H||||20|MUNIÇÃO, FUMÍGENA, À BASE DE FÓSFORO BRANCO com ruptor, carga ejetora ou carga propelente
0246|1.3H|1.3H||||20|MUNIÇÃO, FUMÍGENA, À BASE DE FÓSFORO BRANCO com ruptor, carga ejetora ou carga propelente
0247|1.3J|1.3J||||20|MUNIÇÃO, INCENDIÁRIA, líquida ou gel, com ruptor, carga ejetora ou carga propelente
0248|1.2L|1.2L||||Z|DISPOSITIVOS, ACIONÁVEIS POR ÁGUA com ruptor, carga ejetora ou carga propelente
0249|1.3L|1.3L||||Z|DISPOSITIVOS, ACIONÁVEIS POR ÁGUA com ruptor, carga ejetora ou carga propelente
0250|1.3L|1.3L||||Z|MOTORES DE FOGUETES, COM LÍQUIDOS HIPERGÓLICOS com ou sem carga ejetora
0254|1.3G|1.3G||||20|MUNIÇÃO, ILUMINANTE com ou sem ruptor, carga ejetora ou carga propelente
0255|1.4B|1.4B||5||333|DETONADORES, ELÉTRICOS para demolição
0257|1.4B|1.4B||||333|ESTOPILHA, DE DETONAÇÃO
0266|1.1D|1.1D||||20|OCTOLITA (OCTOL), seca ou umedecida com menos de 15% de água, em massa
0267|1.4B|1.4B||||333|DETONADORES, NÃO ELÉTRICOS para demolição
0268|1.2B|1.2B||||20|REFORÇADORES COM DETONADOR
0271|1.1C|1.1C||||20|CARGAS, PROPELENTES
0272|1.3C|1.3C||||20|CARGAS, PROPELENTES
0275|1.3C|1.3C||||20|CARTUCHOS, PARA DISPOSITIVO MECÂNICO
0276|1.4C|1.4C||||333|CARTUCHOS, PARA DISPOSITIVO MECÂNICO
0277|1.3C|1.3C||||20|CARTUCHOS, PARA POÇOS DE PETRÓLEO
0278|1.4C|1.4C||||333|CARTUCHOS, PARA POÇOS DE PETRÓLEO
0279|1.1C|1.1C||||20|CARGAS, PROPELENTES, PARA CANHÃO
0280|1.1C|1.1C||||20|MOTORES DE FOGUETES
0281|1.2C|1.2C||||20|MOTORES DE FOGUETES
0282|1.1D|1.1D||||20|NITROGUANIDINA (PICRITA), seca ou umedecida com menos de 20% de água, em massa
0283|1.2D|1.2D||||20|REFORÇADORES sem detonador
0284|1.1D|1.1D||||20|GRANADAS, manuais ou para fuzil, com carga de ruptura
0285|1.2D|1.2D||||20|GRANADAS, manuais ou para fuzil, com carga de ruptura
0286|1.1D|1.1D||||20|OGIVAS, DE FOGUETES com carga de ruptura
0287|1.2D|1.2D||||20|OGIVAS, DE FOGUETES com carga de ruptura
0288|1.1D|1.1D||||20|CARGAS, MOLDADAS, FLEXÍVEIS, LINEARES
0289|1.4D|1.4D||||333|CORDEL, DETONANTE, flexível
0290|1.1D|1.1D||||20|CORDEL (ESTOPIM), DETONANTE, com revestimento metálico
0291|1.2F|1.2F||||20|BOMBAS com carga de ruptura
0292|1.1F|1.1F||||20|GRANADAS, manuais ou para fuzil, com carga de ruptura
0293|1.2F|1.2F||||20|GRANADAS, manuais ou para fuzil, com carga de ruptura
0294|1.2F|1.2F||||20|MINAS com carga de ruptura
0295|1.2F|1.2F||||20|FOGUETES com carga de ruptura
0296|1.1F|1.1F||||20|DISPOSITIVOS DE SONDAGEM, EXPLOSIVOS
0297|1.4G|1.4G||6||333|MUNIÇÃO, ILUMINANTE com ou sem ruptor, carga ejetora ou carga propelente
0299|1.3G|1.3G||||20|BOMBAS, FOTO-ILUMINANTES
0300|1.4G|1.4G||||333|MUNIÇÃO, INCENDIÁRIA com ou sem ruptor, carga ejetora ou carga propelente
0301|1.4G|1.4G|6.1 8|||333|MUNIÇÃO, LACRIMOGÊNEA com ruptor, carga ejetora ou carga propelente
0303|1.4G|1.4G||||333|MUNIÇÃO, FUMÍGENA com ou sem ruptor, carga ejetora ou carga propelente
0305|1.3G|1.3G||||20|COMPOSIÇÃO ILUMINANTE EM PÓ
0306|1.4G|1.4G||||333|TRAÇANTES PARA MUNIÇÃO
0312|1.4G|1.4G||||333|CARTUCHOS, PARA SINALIZAÇÃO
0313|1.2G|1.2G||||20|SINALIZADORES, DE FUMAÇA
0314|1.2G|1.2G||||20|ACENDEDORES
0315|1.3G|1.3G||||20|ACENDEDORES
0316|1.3G|1.3G||||20|ESTOPILHA, DE IGNIÇÃO
0317|1.4G|1.4G||||333|ESTOPILHA, DE IGNIÇÃO
0318|1.3G|1.3G||||20|GRANADAS, PARA EXERCÍCIO, manuais ou para fuzil
0319|1.3G|1.3G||||20|INICIADORES, TUBULARES
0320|1.4G|1.4G||||333|INICIADORES, TUBULARES
0321|1.2E|1.2E||||20|CARTUCHOS PARA ARMAS com carga de ruptura
0322|1.2L|1.2L||||Z|MOTORES DE FOGUETES, COM LÍQUIDOS HIPERGÓLICOS com ou sem carga ejetora
0323|1.4S|1.4S||||I|CARTUCHOS, PARA DISPOSITIVO MECÂNICO
0324|1.2F|1.2F||||20|PROJÉTEIS com carga de ruptura
0325|1.4G|1.4G||||333|ACENDEDORES
0326|1.1C|1.1C||||20|CARTUCHOS PARA ARMAS, FESTIM
0327|1.3C|1.3C||||20|CARTUCHOS PARA ARMAS, FESTIM ou CARTUCHOS, ARMAS PORTÁTEIS, FESTIM
0328|1.2C|1.2C||||20|CARTUCHOS PARA ARMAS, PROJÉTEIS INERTES
0329|1.1E|1.1E||||20|TORPEDOS com carga de ruptura
0330|1.1F|1.1F||||20|TORPEDOS com carga de ruptura
0331|1.5D|1.5D||||20|EXPLOSIVOS, DE DEMOLIÇÃO, TIPO B (AGENTE, DE DEMOLIÇÃO, TIPO B)
0332|1.5D|1.5D||||20|EXPLOSIVOS, DE DEMOLIÇÃO, TIPO E (AGENTE, DE DEMOLIÇÃO, TIPO E)
0333|1.1G|1.1G||||20|FOGOS DE ARTIFÍCIO
0334|1.2G|1.2G||||20|FOGOS DE ARTIFÍCIO
0335|1.3G|1.3G||||20|FOGOS DE ARTIFÍCIO
0336|1.4G|1.4G||||333|FOGOS DE ARTIFÍCIO
0337|1.4S|1.4S||7||I|FOGOS DE ARTIFÍCIO
0338|1.4C|1.4C||||333|CARTUCHOS PARA ARMAS, FESTIM ou CARTUCHOS, PARA ARMAS PORTÁTEIS, FESTIM
0339|1.4C|1.4C||||333|CARTUCHOS PARA ARMAS, PROJÉTEIS INERTES ou CARTUCHOS, PARA ARMAS PORTÁTEIS
0340|1.1D|1.1D||||20|NITROCELULOSE, seca ou umedecida com menos de 25% de água (ou álcool), em massa
0341|1.1D|1.1D||||20|NITROCELULOSE, não-modificada, ou plastificada com menos de 18% de substância plastificante, em massa
0342|1.3C|1.3C||||20|NITROCELULOSE, UMEDECIDA com no mínimo 25% de álcool, em massa
0343|1.3C|1.3C||||20|NITROCELULOSE, PLASTIFICADA com no mínimo 18% de substância plastificante, em massa
0344|1.4D|1.4D||||333|PROJÉTEIS com carga de ruptura
0345|1.4S|1.4S||||I|PROJÉTEIS inertes, com traçante
0346|1.2D|1.2D||||20|PROJÉTEIS com ruptor ou carga ejetora
0347|1.4D|1.4D||||333|PROJÉTEIS com ruptor ou carga ejetora
0348|1.4F|1.4F||||333|CARTUCHOS PARA ARMAS com carga de ruptura
0349|1.4S|1.4S||||I|ARTIGOS, EXPLOSIVOS, N.E.
0350|1.4B|1.4B||||333|ARTIGOS, EXPLOSIVOS, N.E.
0351|1.4C|1.4C||||333|ARTIGOS, EXPLOSIVOS, N.E.
0352|1.4D|1.4D||||333|ARTIGOS, EXPLOSIVOS, N.E.
0353|1.4G|1.4G||||333|ARTIGOS, EXPLOSIVOS, N.E.
0354|1.1L|1.1L||||Z|ARTIGOS, EXPLOSIVOS, N.E.
0355|1.2L|1.2L||||Z|ARTIGOS, EXPLOSIVOS, N.E.
0356|1.3L|1.3L||||Z|ARTIGOS, EXPLOSIVOS, N.E.
0357|1.1L|1.1L||||Z|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0358|1.2L|1.2L||||Z|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0359|1.3L|1.3L||||Z|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0360|1.1B|1.1B||||20|DETONADORES CONJUNTOS MONTADOS, NÃO ELÉTRICOS para demolição
0361|1.4B|1.4B||||333|DETONADORES CONJUNTOS MONTADOS, NÃO ELÉTRICOS para demolição
0362|1.4G|1.4G||||333|MUNIÇÃO, PARA EXERCÍCIO
0363|1.4G|1.4G||8||333|MUNIÇÃO, PARA PROVA
0364|1.2B|1.2B||||20|DETONADORES PARA MUNIÇÃO
0365|1.4B|1.4B||||333|DETONADORES PARA MUNIÇÃO
0366|1.4S|1.4S||||I|DETONADORES PARA MUNIÇÃO
0367|1.4S|1.4S||||I|ESTOPILHA, DE DETONAÇÃO
0368|1.4S|1.4S||||I|ESTOPILHA, DE IGNIÇÃO
0369|1.1F|1.1F||||20|OGIVAS, DE FOGUETES com carga de ruptura
0370|1.4D|1.4D||||333|OGIVAS, DE FOGUETES com ruptor ou carga ejetora
0371|1.4F|1.4F||||333|OGIVAS, DE FOGUETES com ruptor ou carga ejetora
0372|1.2G|1.2G||||20|GRANADAS, PARA EXERCÍCIO, manuais ou para fuzil
0373|1.4S|1.4S||||I|SINALIZADORES, MANUAIS
0374|1.1D|1.1D||||20|DISPOSITIVOS DE SONDAGEM, EXPLOSIVOS
0375|1.2D|1.2D||||20|DISPOSITIVOS DE SONDAGEM, EXPLOSIVOS
0376|1.4S|1.4S||||I|INICIADORES, TUBULARES
0377|1.1B|1.1B||||20|INICIADORES, TIPO CÁPSULA
0378|1.4B|1.4B||||333|INICIADORES, TIPO CÁPSULA
0379|1.4C|1.4C||||333|ESTOJOS, DE CARTUCHOS, VAZIOS, COM INICIADOR
0380|1.2L|1.2L||||Z|ARTIGOS, PIROFÓRICOS
0381|1.2C|1.2C||||20|CARTUCHOS, PARA DISPOSITIVO MECÂNICO
0382|1.2B|1.2B||||20|EXPLOSIVOS, COMPONENTES DE CADEIA, N.E.
0383|1.4B|1.4B||||333|EXPLOSIVOS, COMPONENTES DE CADEIA, N.E.
0384|1.4S|1.4S||||I|EXPLOSIVOS, COMPONENTES DE CADEIA, N.E.
0385|1.1D|1.1D||||20|5-NITROBENZOTRIAZOL
0386|1.1D|1.1D||||20|ÁCIDO TRINITROBENZENOSSULFÔNICO
0387|1.1D|1.1D||||20|TRINITROFLUORENONA
0388|1.1D|1.1D||||20|MISTURA DE TRINITROTOLUENO (TNT) E TRINITRO-BENZENO, ou MISTURA DE TRINITROTOLUENO
0389|1.1D|1.1D||||20|MISTURA DE TRINITROTOLUENO (TNT) CONTENDO TRINITROBENZENO E HEXANITROESTILBENO
0390|1.1D|1.1D||||20|TRITONAL
0391|1.1D|1.1D||9||20|CICLOTRIMETILENOTRINITRAMINA
0392|1.1D|1.1D||||20|HEXANITROESTILBENO
0393|1.1D|1.1D||||20|HEXOTONAL
0394|1.1D|1.1D||||20|TRINITRO-RESORCINOL (ÁCIDO ESTIFÍNICO), UMEDECIDO com no mínimo 20% de água, ou mistura de álcool
0395|1.2J|1.2J||||20|MOTORES DE FOGUETES, COM COMBUSTÍVEL LÍQUIDO
0396|1.3J|1.3J||||20|MOTORES DE FOGUETES, COM COMBUSTÍVEL LÍQUIDO
0397|1.1J|1.1J||||20|FOGUETES, COM COMBUSTÍVEL LÍQUIDO com carga de ruptura
0398|1.2J|1.2J||||20|FOGUETES, COM COMBUSTÍVEL LÍQUIDO com carga de ruptura
0399|1.1J|1.1J||||20|BOMBAS COM LÍQUIDO INFLAMÁVEL com carga de ruptura
0400|1.2J|1.2J||||20|BOMBAS COM LÍQUIDO INFLAMÁVEL com carga de ruptura
0401|1.1D|1.1D||||20|SULFETO DE DIPICRILA, seco ou umedecido com menos de 10% de água, em massa
0402|1.1D|1.1D||||20|PERCLORATO DE AMÔNIO
0403|1.4G|1.4G||||333|FACHOS DE SINALIZAÇÃO, AÉREOS
0404|1.4S|1.4S||||I|FACHOS DE SINALIZAÇÃO, AÉREOS
0405|1.4S|1.4S||||I|CARTUCHOS, PARA SINALIZAÇÃO
0406|1.3C|1.3C||||20|DINITROSOBENZENO
0407|1.4C|1.4C||||333|ÁCIDO TETRAZOL-1-ACÉTICO
0408|1.1D|1.1D||||20|ESTOPILHAS, DE DETONAÇÃO, com dispositivo de proteção
0409|1.2D|1.2D||||20|ESTOPILHAS, DE DETONAÇÃO, com dispositivo de proteção
0410|1.4D|1.4D||||333|ESTOPILHAS, DE DETONAÇÃO, com dispositivo de proteção
0411|1.1D|1.1D||||20|TETRANITRATO DE PENTAERITRITA (TETRANITRATO DE PENTAERITRITOL; PETN) com no mínimo 7% de…
0412|1.4E|1.4E||||333|CARTUCHOS PARA ARMAS com carga de ruptura
0413|1.2C|1.2C||||20|CARTUCHOS PARA ARMAS, FESTIM
0414|1.2C|1.2C||||20|CARGAS, PROPELENTES, PARA CANHÃO
0415|1.2C|1.2C||||20|CARGAS, PROPELENTES
0417|1.3C|1.3C||||20|CARTUCHOS PARA ARMAS, PROJÉTEIS INERTES ou CARTUCHOS, PARA ARMAS PORTÁTEIS
0418|1.1G|1.1G||||20|FACHOS DE SINALIZAÇÃO, SUPERFÍCIE
0419|1.2G|1.2G||||20|FACHOS DE SINALIZAÇÃO, SUPERFÍCIE
0420|1.1G|1.1G||||20|FACHOS DE SINALIZAÇÃO, AÉREOS
0421|1.2G|1.2G||||20|FACHOS DE SINALIZAÇÃO, AÉREOS
0424|1.3G|1.3G||||20|PROJÉTEIS, inertes com traçante
0425|1.4G|1.4G||||333|PROJÉTEIS, inertes com traçante
0426|1.2F|1.2F||||20|PROJÉTEIS com ruptor ou carga ejetora
0427|1.4F|1.4F||||333|PROJÉTEIS com ruptor ou carga ejetora
0428|1.1G|1.1G||||20|ARTIGOS, PIROTÉCNICOS para fins técnicos
0429|1.2G|1.2G||||20|ARTIGOS, PIROTÉCNICOS para fins técnicos
0430|1.3G|1.3G||||20|ARTIGOS, PIROTÉCNICOS para fins técnicos
0431|1.4G|1.4G||||333|ARTIGOS, PIROTÉCNICOS para fins técnicos
0432|1.4S|1.4S||10||I|ARTIGOS, PIROTÉCNICOS para fins técnicos
0433|1.1C|1.1C||||20|PÓLVORA EM PASTA, UMEDECIDA com no mínimo 17% de álcool, em massa
0434|1.2G|1.2G||||20|PROJÉTEIS com ruptor ou carga ejetora
0435|1.4G|1.4G||||333|PROJÉTEIS com ruptor ou carga ejetora
0436|1.2C|1.2C||||20|FOGUETES com carga ejetora
0437|1.3C|1.3C||||20|FOGUETES com carga ejetora
0438|1.4C|1.4C||||333|FOGUETES com carga ejetora
0439|1.2D|1.2D||||20|CARGAS, MOLDADAS sem detonador
0440|1.4D|1.4D||||333|CARGAS, MOLDADAS sem detonador
0441|1.4S|1.4S||||I|CARGAS, MOLDADAS sem detonador
0442|1.1D|1.1D||||20|CARGAS, EXPLOSIVAS, COMERCIAIS sem detonador
0443|1.2D|1.2D||||20|CARGAS, EXPLOSIVAS, COMERCIAIS sem detonador
0444|1.4D|1.4D||||333|CARGAS, EXPLOSIVAS, COMERCIAIS sem detonador
0445|1.4S|1.4S||||I|CARGAS, EXPLOSIVAS, COMERCIAIS sem detonador
0446|1.4C|1.4C||||333|ESTOJOS, COMBUSTÍVEIS, VAZIOS, SEM INICIADOR
0447|1.3C|1.3C||||20|ESTOJOS, COMBUSTÍVEIS, VAZIOS, SEM INICIADOR
0448|1.4C|1.4C||||333|ÁCIDO 5-MERCAPTOTETRAZOL-1-ACÉTICO
0449|1.1J|1.1J||||20|TORPEDOS, COM COMBUSTÍVEL LÍQUIDO com ou sem carga de ruptura
0450|1.3J|1.3J||||20|TORPEDOS, COM COMBUSTÍVEL LÍQUIDO com ogiva inerte
0451|1.1D|1.1D||||20|TORPEDOS com carga de ruptura
0452|1.4G|1.4G||||333|GRANADAS, PARA EXERCÍCIO, manuais ou para fuzil
0453|1.4G|1.4G||||333|FOGUETES, PARA LANÇAMENTO DE LINHA
0454|1.4S|1.4S||||I|ACENDEDORES
0455|1.4S|1.4S||||I|DETONADORES, NÃO ELÉTRICOS para demolição
0456|1.4S|1.4S||||I|DETONADORES, ELÉTRICOS para demolição
0457|1.1D|1.1D||||20|CARGAS, DE RUPTURA, COM AGLUTINANTE PLÁSTICO
0458|1.2D|1.2D||||20|CARGAS, DE RUPTURA, COM AGLUTINANTE PLÁSTICO
0459|1.4D|1.4D||||333|CARGAS, DE RUPTURA, COM AGLUTINANTE PLÁSTICO
0460|1.4S|1.4S||||I|CARGAS, DE RUPTURA, COM AGLUTINANTE PLÁSTICO
0461|1.1B|1.1B||||20|EXPLOSIVOS, COMPONENTES DE CADEIA, N.E.
0462|1.1C|1.1C||||20|ARTIGOS, EXPLOSIVOS, N.E.
0463|1.1D|1.1D||||20|ARTIGOS, EXPLOSIVOS, N.E.
0464|1.1E|1.1E||11||20|ARTIGOS, EXPLOSIVOS, N.E.
0465|1.1F|1.1F||||20|ARTIGOS, EXPLOSIVOS, N.E.
0466|1.2C|1.2C||||20|ARTIGOS, EXPLOSIVOS, N.E.
0467|1.2D|1.2D||||20|ARTIGOS, EXPLOSIVOS, N.E.
0468|1.2E|1.2E||||20|ARTIGOS, EXPLOSIVOS, N.E.
0469|1.2F|1.2F||||20|ARTIGOS, EXPLOSIVOS, N.E.
0470|1.3C|1.3C||||20|ARTIGOS, EXPLOSIVOS, N.E.
0471|1.4E|1.4E||||333|ARTIGOS, EXPLOSIVOS, N.E.
0472|1.4F|1.4F||||333|ARTIGOS, EXPLOSIVOS, N.E.
0473|1.1A|1.1A||||Z|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0474|1.1C|1.1C||||20|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0475|1.1D|1.1D||||20|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0476|1.1G|1.1G||||20|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0477|1.3C|1.3C||||20|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0478|1.3G|1.3G||||20|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0479|1.4C|1.4C||||333|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0480|1.4D|1.4D||||333|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0481|1.4S|1.4S||||I|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0482|1.5D|1.5D||||20|SUBSTÂNCIAS, EXPLOSIVAS, MUITO INSENSÍVEIS (SUBSTÂNCIAS, EMI), N.E.
0483|1.1D|1.1D||||20|CICLOTRIMETILENO TRINITRAMINA (CICLONITA; HEXOGÊNIO; RDX), INSENSIBILIZADA
0484|1.1D|1.1D||||20|CICLOTETRAMETILENO TETRANITRAMINA (HMX; OCTOGÊNIO), INSENSIBILIZADA
0485|1.4G|1.4G||||333|SUBSTÂNCIAS, EXPLOSIVAS, N.E.
0486|1.6N|1.6N||||333|ARTIGOS, EXPLOSIVOS, EXTREMAMENTE INSENSÍVEIS (ARTIGOS, EEI)
0487|1.3G|1.3G||||20|SINALIZADORES, DE FUMAÇA
0488|1.3G|1.3G||||20|MUNIÇÃO, PARA EXERCÍCIO
0489|1.1D|1.1D||||20|DINITROGLICOLURILA (DINGU)
0490|1.1D|1.1D||12||20|NITROTRIAZOLONA (NTO)
0491|1.4C|1.4C||||333|CARGAS, PROPELENTES
0492|1.3G|1.3G||||20|SINALIZADORES, PARA VIAS FÉRREAS, EXPLOSIVOS
0493|1.4G|1.4G||||333|SINALIZADORES, PARA VIAS FÉRREAS, EXPLOSIVOS
0494|1.4D|1.4D||||333|CANHÕES PARA JATO-PERFURAÇÃO em poços de petróleo, CARREGADOS, sem detonador
0495|1.3C|1.3C||||20|PROPELENTE, LÍQUIDO
0496|1.1D|1.1D||||20|OCTONAL
0497|1.1C|1.1C||||20|PROPELENTE, LÍQUIDO
0498|1.1C|1.1C||||20|PROPELENTE, SÓLIDO
0499|1.3C|1.3C||||20|PROPELENTE, SÓLIDO
0500|1.4S|1.4S||||I|DETONADORES CONJUNTOS MONTADOS, NÃO ELÉTRICOS para demolição
0501|1.4C|1.4C||||333|PROPELENTE, SÓLIDO
0502|1.2C|1.2C||||20|FOGUETES com ogiva inerte
0503|1.4G|1.4G||||333|DISPOSITIVOS DE SEGURANÇA, PIROTÉCNICOS
0504|1.1D|1.1D||||20|IH-TETRAZOL
0505|1.4G|1.4G||||333|SINAIS DE SOCORRO, para barcos
0506|1.4S|1.4S||||I|SINAIS DE SOCORRO, para barcos
0507|1.4S|1.4S||||I|SINAIS, FUMÍGENOS
0508|1.3C|1.3C||||20|1- HODROXIBENZOTRIAZOL, ANIDRO, seco ou umidificado com menos de 20% de água, em massa
0509|1.4C|1.4C||||333|PÓLVORA, SEM FUMAÇA
0510|1.4C|1.4C||||333|MOTORES DE FOGUETES
0511|1.1B|1.1B||||20|DETONADORES, ELETRÔNICOS programáveis para demolição
0512|1.4B|1.4B||||20|DETONADORES, ELETRÔNICOS programáveis para demolição
0513|1.4S|1.4S||||20|DETONADORES, ELETRÔNICOS programáveis para demolição
1001|2.1|2.1||239||333|ACETILENO, DISSOLVIDO
1002|2.2|2.2||20||1000|AR, COMPRIMIDO
1003|2.2|2.2|5.1|225||1000|AR, LÍQUIDO REFRIGERADO
1005|2.3|2.3|8|268||20|AMÔNIA, ANIDRA
1006|2.2|2.2||20||1000|ARGÔNIO, COMPRIMIDO
1008|2.3|2.3|8|268||20|TRIFLUORETO DE BORO
1009|2.2|2.2||20||1000|BROMOTRIFLUORMETANO (GÁS REFRIGERANTE R 13 B1)
1010|2.1|2.1||239||333|BUTADIENOS, ESTABILIZADOS ou BUTADIENOS E MISTURA DE HIDROCARBONETO, ESTABILIZADO,…
1011|2.1|2.1||23||333|BUTANO
1012|2.1|2.1||23 13||333|BUTILENO
1013|2.2|2.2||20||1000|DIÓXIDO DE CARBONO
1016|2.3|2.3|2.1|263||20|MONÓXIDO DE CARBONO, COMPRIMIDO
1017|2.3|2.3|5.1 8|265||20|CLORO
1018|2.2|2.2||20||1000|CLORODIFLUORMETANO (GÁS REFRIGERANTE R 22)
1020|2.2|2.2||20||1000|CLOROPENTAFLUORETANO (GÁS REFRIGERANTE R 115)
1021|2.2|2.2||20||1000|1-CLORO-1,2,2,2-TETRAFLUORETANO (GÁS REFRIGERANTE R 124)
1022|2.2|2.2||20||1000|CLOROTRIFLUOMETANO (GÁS REFRIGERANTE R 13)
1023|2.3|2.3|2.1|263||20|GÁS DE CARVÃO, COMPRIMIDO
1026|2.3|2.3|2.1|263||20|CIANOGÊNIO
1027|2.1|2.1||23||333|CICLOPROPANO
1028|2.2|2.2||20||1000|DICLORODIFLUORMETANO (GÁS REFRIGERANTE R 12)
1029|2.2|2.2||20||1000|DICLOROFLUORMETANO (GÁS REFRIGERANTE R 21)
1030|2.1|2.1||23||333|1,1-DIFLUORETANO (GÁS REFRIGERANTE R 152 a)
1032|2.1|2.1||23||333|DIMETILAMINA, ANIDRA
1033|2.1|2.1||23||333|ÉTER DIMETÍLICO
1035|2.1|2.1||23||333|ETANO
1036|2.1|2.1||23||333|ETILAMINA
1037|2.1|2.1||23||333|CLORETO DE ETILA
1038|2.1|2.1||223||333|ETILENO, LÍQUIDO REFRIGERADO
1039|2.1|2.1||23||333|ÉTER ETILMETÍLICO
1040|2.3|2.3|2.1|263||20|ÓXIDO DE ETILENO ou ÓXIDO DE ETILENO COM NITROGÊNIO até pressão total de 1Mpa (10bar), a 50ºC
1041|2.1|2.1||239||333|MISTURA DE ÓXIDO DE ETILENO E DIÓXIDO DE CARBONO com mais de 9% e até 87% de óxido de etileno
1043|2.2|2.2||20||1000|FERTILIZANTE, EM SOLUÇÃO AMONIACAL, contendo amônia livre
1044|2.2|2.2||20||1000|EXTINTOR DE INCÊNDIO contendo gás comprimido ou liquefeito
1045|2.3|2.3|5.1 8|265||20|FLÚOR, COMPRIMIDO
1046|2.2|2.2||20||1000|HÉLIO, COMPRIMIDO
1048|2.3|2.3|8|268||20|BROMETO DE HIDROGÊNIO, ANIDRO
1049|2.1|2.1||23||333|HIDROGÊNIO, COMPRIMIDO
1050|2.3|2.3|8|268||20|CLORETO DE HIDROGÊNIO, ANIDRO
1051|6.1|6.1|3|663|I|Z|CIANETO DE HIDROGÊNIO, ESTABILIZADO contendo menos de 3% de água
1052|8|8|6.1|886|I|20|FLUORETO DE HIDROGÊNIO, ANIDRO
1053|2.3|2.3|2.1|263||20|SULFETO DE HIDROGÊNIO
1055|2.1|2.1||23||333|ISOBUTILENO
1056|2.2|2.2||20||1000|CRIPTÔNIO, COMPRIMIDO
1057|2.1|2.1||23||333|ISQUEIROS ou CARGAS PARA ISQUEIROS contendo gás inflamável
1058|2.2|2.2||20||1000|GÁS(ES) LIQUEFEITO(S), não-inflamável(is), contendo nitrogênio, dióxido de carbono ou ar
1060|2.1|2.1||239||333|MISTURA DE METILACETILENO E PROPADIENO, ESTABILIZADA
1061|2.1|2.1||23||333|METILAMINA, ANIDRA
1062|2.3|2.3||26||20|BROMETO DE METILA, com até 2% de cloropicrina
1063|2.1|2.1||23||333|CLORETO DE METILA (GÁS REFRIGERANTE R 40)
1064|2.3|2.3|2.1|263 14||20|METILMERCAPTANA
1065|2.2|2.2||20||1000|NEÔNIO, COMPRIMIDO
1066|2.2|2.2||20||1000|NITROGÊNIO, COMPRIMIDO
1067|2.3|2.3|5.1 8|265||20|TETRÓXIDO DE DINITROGÊNIO (DIÓXIDO DE NITROGÊNIO)
1069|2.3|2.3|8|268||20|CLORETO DE NITROSILA
1070|2.2|2.2|5.1|25||1000|ÓXIDO NITROSO
1071|2.3|2.3|2.1|263||20|GÁS DE ÓLEO, COMPRIMIDO
1072|2.2|2.2|5.1|25||1000|OXIGÊNIO, COMPRIMIDO
1073|2.2|2.2|5.1|225||1000|OXIGÊNIO, LÍQUIDO REFRIGERADO
1075|2.1|2.1||23||333|GÁS(ES) DE PETRÓLEO, LIQUEFEITO(S) ou GAS(ES) LIQUEFEITO(S) DE PETRÓLEO ou GLP
1076|2.3|2.3|8|268||20|FOSGÊNIO
1077|2.1|2.1||23||333|PROPILENO
1078|2.2|2.2||20||1000|GÁS REFRIGERANTE, N.E.
1079|2.3|2.3|8|268||20|DIÓXIDO DE ENXOFRE
1080|2.2|2.2||20||1000|HEXAFLUORETO DE ENXOFRE
1081|2.1|2.1||239||333|TETRAFLUORETILENO, ESTABILIZADO
1082|2.3|2.3|2.1|263||20|TRIFLUORCLOROETILENO, ESTABILIZADO (GAS REFRIGERANTE R 1113)
1083|2.1|2.1||23||333|TRIMETILAMINA, ANIDRA
1085|2.1|2.1||239||333|BROMETO DE VINILA, ESTABILIZADO
1086|2.1|2.1||239||333|CLORETO DE VINILA, ESTABILIZADO
1087|2.1|2.1||239||333|ÉTER METILVINÍLICO, ESTABILIZADO
1088|3|3||33|II|333|ACETAL
1089|3|3||33|I|20|ACETALDEÍDO
1090|3|3||33|II|333|ACETONA
1091|3|3||33|II|333|ÓLEO(S) DE ACETONA
1092|6.1|6.1|3|663|I|20|ACROLEÍNA, ESTABILIZADA
1093|3|3|6.1|336|I|20|ACRILONITRILA, ESTABILIZADA
1098|6.1|6.1|3|663|I|20|ÁLCOOL ALÍLICO
1099|3|3|6.1|336|I|20|BROMETO DE ALILA
1100|3|3|6.1|336|I|20|CLORETO DE ALILA
1104|3|3||30|III|1000|ACETATO(S) DE AMILA
1105|3|3||33 15|II|333|PENTANÓIS
1106|3|3|8|338 38|II III|333|AMILAMINA
1107|3|3||33|II|333|CLORETO DE AMILA
1108|3|3||33|I|20|I-PENTENO (n-AMILENO)
1109|3|3||30|III|1000|FORMIATO(S) DE AMILA
1110|3|3||30|III|1000|n-AMILMETILCETONA
1111|3|3||33|II|333|AMILMERCAPTANA
1112|3|3||30|III|1000|NITRATO DE AMILA
1113|3|3||33|II|333|NITRITO DE AMILA
1114|3|3||33|II|333|BENZENO
1120|3|3||33 30|II III|333|BUTANÓIS
1123|3|3||33 30|II III|333|ACETATO(S) DE BUTILA
1125|3|3|8|338|II|333|n-BUTILAMINA
1126|3|3||33|II|333|1-BROMOBUTANO
1127|3|3||33|II|333|CLOROBUTANOS
1128|3|3||33|II|333|FORMIATO DE n-BUTILA
1129|3|3||33|II|333|BUTIRALDEÍDO
1130|3|3||30|III|1000|ÓLEO DE CÂNFORA
1131|3|3|6.1|336 16|I|20|DISSULFETO DE CARBONO
1133|3|3||33 30|I II III|20|ADESIVOS contendo líquido inflamável
1134|3|3||30|III|1000|CLOROBENZENO
1135|6.1|6.1|3|663|I|20|ETILENOCLORIDRINA
1136|3|3||33 30|II III|333|DESTILADOS DE ALCATRÃO DE HULHA, INFLAMÁVEIS
1139|3|3||33 30|I II III|20|REVESTIMENTO, SOLUÇÃO PARA (inclui revestimentos ou tratamentos de superfície, utilizados para fins…
1143|6.1|6.1|3|663|I|20|CROTONALDÉIDO ou CROTONALDEÍDO ESTABILIZADO
1144|3|3||339|I|20|CROTONILENO
1145|3|3||33|II|333|CICLO HEXANO
1146|3|3||33|II|333|CICLOPENTANO
1147|3|3||30|III|1000|DECA-HIDRO-NAFTALENO
1148|3|3||33 30|II III|333|DIACETONA ÁLCOOL
1149|3|3||30|III|1000|ÉTER(ES) DIBUTÍLICO(S)
1150|3|3||33|II|333|1,2-DICLOROETILENO
1152|3|3||30|III|1000|DICLOROPENTANOS
1153|3|3||33 17|II|333|ÉTER DIETÍLICO DE ETILENOGLICOL
1154|3|3|8|338|II|333|DIETILAMINA
1155|3|3||33|I|20|ÉTER DIETÍLICO (ÉTER ETÍLICO)
1156|3|3||33|II|333|DIETILCETONA
1157|3|3||30|III|1000|DIISOBUTILCETONA
1158|3|3|8|338|II|333|DIISOPROPILAMINA
1159|3|3||33|II|333|ÉTER DIISOPROPÍLICO
1160|3|3|8|338|II|333|DIMETILAMINA SOLUÇÃO AQUOSA
1161|3|3||33|II|333|CARBONATO DE DIMETILA
1162|3|3|8|X338|II|333|DIMETILDICLOROSSILANO
1163|6.1|6.1|3 8|663|I|20|DIMETIL HIDRAZINA, ASSIMÉTRICA
1164|3|3||33|II|333|SULFETO DE DIMETILA
1165|3|3||33|II|333|DIOXANO
1166|3|3||33|II|333|DIOXOLANO
1167|3|3||339|I|20|ÉTER DIVINÍLICO, ESTABILIZADO
1170|3|3||33 30|II III|333|ETANOL (ÁLCOOL ETÍLICO) ou SOLUÇÃO DE ETANOL (SOLUÇÃO DE ÁLCOOL ETÍLICO)
1171|3|3||30|III|1000|ÉTER MONOETÍLICO DE ETILENOGLICOL
1172|3|3||30|III|1000|ACETATO DE ÉTER MONOETÍLICO DE ETILENOGLICOL
1173|3|3||33|II|333|ACETATO DE ETILA
1175|3|3||33|II|333|ETILBENZENO
1176|3|3||33|II|333|BORATO DE ETILA
1177|3|3||30 18|III|1000|ACETATO DE 2-ETILBUTILA
1178|3|3||33|II|333|2-ETILBUTIRALDEÍDO
1179|3|3||33|II|333|ÉTER ETILBUTÍLICO
1180|3|3||30|III|1000|BUTIRATO DE ETILA
1181|6.1|6.1|3|63|II|333|CLOROACETATO DE ETILA
1182|6.1|6.1|3 8|663|I|20|CLOROFORMIATO DE ETILA
1183|4.3|4.3|3 8|X338|I|Z|ETILDICLOROSSILANO
1184|3|3|6.1|336|II|333|DICLORETO DE ETILENO
1185|6.1|6.1|3|663|I|20|ETILENOIMINA, ESTABILIZADA
1188|3|3||30|III|1000|ÉTER MONOMETÍLICO DE ETILENOGLICOL
1189|3|3||30|III|1000|ACETATO DE ÉTER MONOMETÍLICO DE ETILENOGLICOL
1190|3|3||33|II|333|FORMIATO DE ETILA
1191|3|3||30|III|1000|ALDEÍDOS OCTÍLICOS
1192|3|3||30|III|1000|LACTATO DE ETILA
1193|3|3||33|II|333|ETILMETILCETONA (METILETILCETONA)
1194|3|3|6.1|336|I|20|NITRITO DE ETILA SOLUÇÃO
1195|3|3||33|II|333|PROPIONATO DE ETILA
1196|3|3|8|X338|II|333|ETILTRICLOROSSILANO
1197|3|3||33 30|II III|333|EXTRATOS, AROMATIZANTES, LÍQUIDOS
1198|3|3|8|38|III|1000|FORMALDEÍDO SOLUÇÃO, INFLAMÁVEL
1199|6.1|6.1|3|63 19|II|333|FURALDEÍDOS
1201|3|3||33 30|II III|333|ÓLEO FUSEL
1202|3|3||30|III|1000|GASÓLEO ou ÓLEO DIESEL ou ÓLEO PARA AQUECIMENTO, LEVE
1203|3|3||33|II|333|COMBUSTÍVEL PARA MOTORES ou GASOLINA ou GASOLINA DE AVIAÇÃO (GAV-100LL ou AVGAS-…
1204|3|3||33|II|333|NITROGLICERINA EM SOLUÇÃO ALCÓOLICA com até 1% de nitroglicerina
1206|3|3||33|II|333|HEPTANOS
1207|3|3||30|III|1000|HEXALDEÍDO
1208|3|3||33|II|333|HEXANOS
1210|3|3||33 30|I II III|20|TINTA PARA IMPRESSÃO, inflamável ou MATERIAL RELACIONADO COM TINTA PARA IMPRESSÃO (incluindo compostos…
1212|3|3||30|III|1000|ISOBUTANOL (ÁLCOOL ISOBUTÍLICO)
1213|3|3||33|II|333|ACETATO DE ISOBUTILA
1214|3|3|8|338|II|333|ISOBUTILAMINA
1216|3|3||33|II|333|ISOOCTENO
1218|3|3||339|I|20|ISOPRENO, ESTABILIZADO
1219|3|3||33|II|333|ISOPROPANOL (ÁLCOOL ISOPROPÍLICO)
1220|3|3||33|II|333|ACETATO DE ISOPROPILA
1221|3|3|8|338|I|20|ISOPROPILAMINA
1222|3|3|||II|333|NITRATO DE ISOPROPILA
1223|3|3||30|III|1000|QUEROSENE
1224|3|3||33 20|II|333|CETONAS, LÍQUIDAS, N.E.
1228|3|3|6.1|336 36|II III|333|MERCAPTANAS, INFLAMÁVEIS, TÓXICAS, LÍQUIDAS, N.E., ou MISTURA DE MERCAPTANA, INFLAMÁVEL, TÓXICA, LÍQUIDA, N.E.
1229|3|3||30|III|1000|ÓXIDO DE MESITILA
1230|3|3|6.1|336|II|333|METANOL
1231|3|3||33|II|333|ACETATO DE METILA
1233|3|3||30|III|1000|ACETATO DE METILAMILA
1234|3|3||33|II|333|METILAL
1235|3|3|8|338|II|333|METILAMINA, SOLUÇÃO AQUOSA
1237|3|3||33|II|333|BUTIRATO DE METILA
1238|6.1|6.1|3 8|663|I|20|CLOROFORMIATO DE METILA
1239|6.1|6.1|3|663|I|20|ÉTER METILCLOROMETÍLICO
1242|4.3|4.3|3 8|X338|I|Z|METILDICLOROSSILANO
1243|3|3||33|I|20|FORMIATO DE METILA
1244|6.1|6.1|3 8|663|I|20|METILHIDRAZINA
1245|3|3||33|II|333|METILISOBUTILCETONA
1246|3|3||339|II|333|METILISOPROPENILCETONA, ESTABILIZADA
1247|3|3||339|II|333|METACRILATO DE METILA MONÔMERO, ESTABILIZADO
1248|3|3||33|II|333|PROPIONATO DE METILA
1249|3|3||33|II|333|METILPROPILCETONA
1250|3|3|8|X338 21|II|20|METILTRICLOROSSILANO
1251|6.1|6.1|3 8|639|I|20|METILVINILCETONA, ESTABILIZADA
1259|6.1|6.1|3|663|I|20|NIQUELCARBONILA
1261|3|3|||II|333|NITROMETANO
1262|3|3||33|II|333|OCTANOS
1263|3|3||33 30|I II III|20|TINTA (incluindo tintas, lacas, esmaltes, tinturas, goma-lacas, vernizes, polidores, enenchimentos líquidos e…
1264|3|3||30|III|1000|PARALDEÍDO
1265|3|3||33|I II|20|PENTANOS, líquidos
1266|3|3||33 30|II III|333|PERFUMARIA PRODUTOS contendo solventes inflamáveis
1267|3|3||33 30|I II III|20|PETRÓLEO CRU
1268|3|3||33 30|I II III|20|DESTILADOS DE PETRÓLEO, N.E. ou DERIVADOS DE PETRÓLEO, N.E.
1272|3|3||30|III|1000|ÓLEO DE PINHO
1274|3|3||33 30 22|II III|333|n-PROPANOL (ÁLCOOL PROPÍLICO, NORMAL)
1275|3|3||33|II|333|PROPIONALDEÍDO
1276|3|3||33|II|333|ACETATO DE n-PROPILA
1277|3|3|8|338|II|333|PROPILAMINA
1278|3|3||33|II|333|1-CLOROPROPANO
1279|3|3||33|II|333|1,2-DICLOROPROPANO
1280|3|3||33|I|20|ÓXIDO DE PROPILENO
1281|3|3||33|II|333|FORMIATO(S) DE PROPILA
1282|3|3||33|II|333|PIRIDINA
1286|3|3||33 30|II III|333|ÓLEO DE RESINA
1287|3|3||33 30|II III|333|BORRACHA EM SOLUÇÃO
1288|3|3||33 30|II III|333|ÓLEO DE XISTO
1289|3|3|8|338 38|II III|333|METILATO DE SÓDIO SOLUÇÃO alcóolica
1292|3|3||30|III|1000|SILICATO DE TETRAETILA
1293|3|3||33 30|II III|333|TINTURAS, MEDICINAIS
1294|3|3||33|II|333|TOLUENO
1295|4.3|4.3|3 8|X338|I|Z|TRICLOROSSILANO
1296|3|3|8|338 23|II|333|TRIETILAMINA
1297|3|3|8|338 38|I II III|20|TRIMETILAMINA, SOLUÇÃO AQUOSA, com até 50% de trimetilamina, em massa.
1298|3|3|8|X338|II|333|TRIMETILCLOROSSILANO
1299|3|3||30|III|1000|TEREBENTINA
1300|3|3||33 30|II III|333|TEREBENTINA, SUBSTITUTOS
1301|3|3||339|II|333|ACETATO DE VINILA, ESTABILIZADO
1302|3|3||339|I|20|ÉTER ETILVINÍLICO, ESTABILIZADO
1303|3|3||339|I|20|CLORETO DE VINILIDENO, ESTABILIZADO
1304|3|3||339|II|333|ÉTER ISOBUTILVINÍLICO, ESTABILIZADO
1305|3|3|8|X338|II|20|VINILTRICLOROSSILANO
1306|3|3||33 30|II III|333|PRESERVATIVOS PARA MADEIRA, LÍQUIDOS
1307|3|3||33 30|II III|333|XILENOS
1308|3|3||33 30|I II III|20|ZIRCÔNIO, SUSPENSÃO EM LÍQUIDO INFLAMÁVEL
1309|4.1|4.1||40|II III|333|ALUMÍNIO EM PÓ, REVESTIDO.
1310|4.1|4.1||40|I|20|PICRATO DE AMÔNIO, UMEDECIDO com, no mínimo, 10% de água, em massa
1312|4.1|4.1||40|III|1000|BORNEOL
1313|4.1|4.1||40|III|1000|RESINATO DE CÁLCIO
1314|4.1|4.1||40 24|III|1000|RESINATO DE CÁLCIO, FUNDIDO
1318|4.1|4.1||40|III|1000|RESINATO DE COBALTO, PRECIPITADO
1320|4.1|4.1|6.1|46|I|20|DINITROFENOL, UMEDECIDO com no mínimo, 15% de água, em massa
1321|4.1|4.1|6.1|46|I|20|DINITROFENOLATOS, UMEDECIDOS com no mínimo 15% de água, em massa
1322|4.1|4.1||40|I|20|DINITRORESORCINOL, UMEDECIDO com no mínimo 15% de água, em massa
1323|4.1|4.1||40|II|333|FERROCÉRIO
1324|4.1|4.1||40|III|1000|FILMES, À BASE DE NITROCELULOSE, revestidos de gelatina, exceto refugos
1325|4.1|4.1||40|II III|333|SÓLIDO INFLAMÁVEL, ORGÂNICO, N.E.
1326|4.1|4.1||40|II|333|HÁFNIO EM PÓ, UMEDECIDO, com no mínimo 25% de água (deve ser visível um excesso de água):
1327|4.1|4.1||40||I|FENO ou PALHA
1328|4.1|4.1||40|III|1000|HEXAMETILENOTETRAMINA
1330|4.1|4.1||40|III|1000|RESINATO DE MANGANÊS
1331|4.1|4.1||40|III|I|FÓSFOROS, "RISQUE EM QUALQUER LUGAR"
1332|4.1|4.1||40|III|1000|METALDEÍDO
1333|4.1|4.1||40|II|333|CÉRIO, chapas, lingotes ou barras.
1334|4.1|4.1||40|III|1000|NAFTALENO, BRUTO, ou NAFTALENO, REFINADO.
1336|4.1|4.1||40|I|20|NITROGUANIDINA (PICRITA), UMEDECIDA com no mínimo 20% de água, em massa
1337|4.1|4.1||40|I|20|NITROAMIDO, UMEDECIDO com no mínimo 20% de água, em massa
1338|4.1|4.1||40|III|1000|FÓSFORO, AMORFO
1339|4.1|4.1||40|II|333|HEPTASSULFETO DE FÓSFORO, isento de fósforo amarelo e branco
1340|4.3|4.3|4.1|423|II|Z|PENTASSULFETO DE FÓSFORO, isento de fósforo amarelo e branco
1341|4.1|4.1||40|II|333|SESQUISSULFETO DE FÓSFORO, isento de fósforo amarelo e branco
1343|4.1|4.1||40|II|333|TRISSULFETO DE FÓSFORO, isento de fósforo amarelo e branco
1344|4.1|4.1||40|I|20|TRINITROFENOL, UMEDECIDO com no mínimo 30% de água, em massa
1345|4.1|4.1||40|II|I|BORRACHA, SOBRAS ou BORRACHA RESÍDUO, em pó ou em grãos de até 840 micra, contendo mais de 45% de…
1346|4.1|4.1||40 25|III|1000|SILÍCIO EM PÓ, AMORFO
1347|4.1|4.1||40|I|20|PICRATO DE PRATA, UMEDECIDO com no mínimo 30% de água, em massa
1348|4.1|4.1|6.1|46|I|20|DINITRO-o-CRESOLATO DE SÓDIO, UMEDECIDO com no mínimo 15% de água, em massa
1349|4.1|4.1||40|I|20|PICRAMATO DE SÓDIO, UMEDECIDO com no mínimo 20% de água, em massa
1350|4.1|4.1||40|III|1000|ENXOFRE
1352|4.1|4.1||40|II|333|TITÂNIO EM PÓ, UMEDECIDO com no mínimo 25% de água (deve apresentar visível excesso de água):
1353|4.1|4.1||40|III|1000|FIBRAS ou TECIDOS IMPREGNADOS COM NITROCELULOSE FRACAMENTE NITRADA, N.E.
1354|4.1|4.1||40|I|20|TRINITROBENZENO, UMEDECIDO com no mínimo 30 % de água, em massa
1355|4.1|4.1||40|I|20|ÁCIDO TRINITROBENZÓICO, UMEDECIDO com no mínimo 30% de água, em massa
1356|4.1|4.1||40|I|20|TRINITROTOLUENO (TNT), UMEDECIDO com no mínimo 30% de água, em massa
1357|4.1|4.1||40|I|20|NITRATO DE URÉIA, UMEDECIDO com no mínimo 20% de água, em massa
1358|4.1|4.1||40|II|333|ZIRCÔNIO EM PÓ, UMEDECIDO com no mínimo 25% de água (deve ser visível um excesso de água):
1360|4.3|4.3|6.1|X462|I|20|FOSFETO DE CÁLCIO
1361|4.2|4.2||40|II III|333|CARVÃO, de origem animal ou vegetal
1362|4.2|4.2||40|III|I|CARVÃO ATIVADO
1363|4.2|4.2||40|III|1000|COPRA
1364|4.2|4.2||40|III|1000|ALGODÃO RESÍDUOS, OLEOSOS ou RESÍDUOS OLEOSOS DE ALGODÃO ou RESÍDUOS DE ALGODÃO,…
1365|4.2|4.2||40|III|1000|ALGODÃO, ÚMIDO, com percentual de umidade superior a 10%
1369|4.2|4.2||40|II|333|p-NITROSODIMETILANILINA
1372||||||N|FIBRAS, ANIMAL ou FIBRAS, VEGETAL queimadas, úmidas ou molhadas
1373|4.2|4.2||40|III|1000|FIBRAS ou TECIDOS, ANIMAL ou VEGETAL ou SINTÉTICOS, N.E., com óleo
1374|4.2|4.2||40|II|333|FARINHA DE PEIXE (RESTOS DE PEIXE), NÃO-ESTABILIZADA
1376|4.2|4.2||40 26|III|1000|ÓXIDO DE FERRO, RESIDUAL, ou FERRO-ESPONJA, RESIDUAL, obtido da purificação de gás de carvão
1378|4.2|4.2||40|II|333|CATALISADOR METÁLICO, UMEDECIDO com visível excesso de líquido
1379|4.2|4.2||40|III|1000|PAPEL, TRATADO COM ÓLEO NÃO-SATURADO, úmido (inclusive papel carbono)
1380|4.2|4.2|6.1|333|I|Z|PENTABORANA
1381|4.2|4.2|6.1|46|I|Z|FÓSFORO, BRANCO ou AMARELO, SECO ou SOB ÁGUA ou EM SOLUÇÃO
1382|4.2|4.2||40|II|333|SULFETO DE POTÁSSIO, ANIDRO, ou SULFETO DE POTÁSSIO com menos de 30% de água de cristalização
1383|4.2|4.2||43|I|Z|METAL PIROFÓRICO, N.E. ou LIGA PIROFÓRICA, N.E.
1384|4.2|4.2||40|II|333|DITIONITO DE SÓDIO (HIDROSSULFITO DE SÓDIO)
1385|4.2|4.2||40|II|333|SULFETO DE SÓDIO ANIDRO, ou SULFETO DE SÓDIO com menos de 30% de água de cristalização
1386|4.2|4.2||40|III|1000|TORTA OLEAGINOSA com mais de 1,5% de óleo e até 11% de umidade
1387||||||N|RESÍDUO DE LÃ, ÚMIDO ou MOLHADO
1389|4.3|4.3||X323|I|20|AMÁLGAMA DE METAL ALCALINO, LÍQUIDA
1390|4.3|4.3||423|II|Z|AMIDAS DE METAL ALCALINO
1391|4.3|4.3||X323|I|20|METAL ALCALINO, DISPERSÃO, ou METAL ALCALINO-TERROSO, DISPERSÃO
1392|4.3|4.3||X323|I|20|AMÁLGAMA DE METAL ALCALINO-TERROSO, LÍQUIDA
1393|4.3|4.3||423|II|333|LIGA DE METAL ALCALINO-TERROSO, N.E.
1394|4.3|4.3||423|II|333|CARBURETO DE ALUMÍNIO
1395|4.3|4.3|6.1|462|II|333|ALUMÍNIO-FERRO-SILÍCIO EM PÓ
1396|4.3|4.3||423|II III|333|ALUMÍNIO EM PÓ, NÃO-RESVESTIDO
1397|4.3|4.3|6.1|X462|I|20|FOSFETO DE ALUMÍNIO
1398|4.3|4.3||423|III|1000|ALUMÍNIO-SILÍCIO EM PÓ, NÃO-REVESTIDO
1400|4.3|4.3||423|II|333|BÁRIO
1401|4.3|4.3||423|II|333|CÁLCIO
1402|4.3|4.3||X423 423|I II|20|CARBURETO DE CÁLCIO
1403|4.3|4.3||423 27|III|Z|CIANAMIDA CÁLCICA contendo mais de 0,1% de carbureto de cálcio
1404|4.3|4.3||X423|I|20|HIDRETO DE CÁLCIO
1405|4.3|4.3||423|II III|333|SILICIETO DE CÁLCIO
1407|4.3|4.3||X423|I|20|CÉSIO
1408|4.3|4.3|6.1|462|III|1000|FERRO-SILÍCIO com 30% ou mais, porém menos de 90% de silício
1409|4.3|4.3||X423 423|I II|20|HIDRETOS METÁLICOS, QUE REAGEM COM ÁGUA, N.E.
1410|4.3|4.3||X423|I|20|HIDRETO DE LÍTIO E ALUMÍNIO
1411|4.3|4.3|3|X323|I|20|HIDRETO DE LÍTIO E ALUMÍNIO, EM ÉTER
1413|4.3|4.3||X423|I|20|BORO-HIDRETO DE LÍTIO
1414|4.3|4.3||X423|I|20|HIDRETO DE LÍTIO
1415|4.3|4.3||X423|I|20|LÍTIO
1417|4.3|4.3||423|II|333|LÍTIO-SILÍCIO
1418|4.3|4.3|4.2|X423 423|I II III|20|MAGNÉSIO EM PÓ ou LIGAS DE MAGNÉSIO EM PÓ
1419|4.3|4.3|6.1|X462|I|20|FOSFETO DE MAGNÉSIO E ALUMÍNIO
1420|4.3|4.3||X323|I|20|LIGA(S) METÁLICA(S) DE POTÁSSIO LÍQUIDA(S)
1421|4.3|4.3||X323|I|20|LIGA DE METAL ALCALINO, LÍQUIDA, N.E.
1422|4.3|4.3||X323|I|20|LIGAS DE POTÁSSIO E SÓDIO, LÍQUIDAS
1423|4.3|4.3||X423|I|20|RUBÍDIO
1426|4.3|4.3||X423|I|20|BORO-HIDRETO DE SÓDIO
1427|4.3|4.3||X423|I|20|HIDRETO DE SÓDIO
1428|4.3|4.3||X423|I|20|SÓDIO
1431|4.2|4.2|8|48|II|333|METILATO DE SÓDIO
1432|4.3|4.3|6.1|X462|I|20|FOSFETO DE SÓDIO
1433|4.3|4.3|6.1|X462|I|20|FOSFETOS ESTÂNICOS
1435|4.3|4.3||423|III|1000|ZINCO, CINZAS
1436|4.3|4.3|4.2|X423 423|I II III|20|ZINCO EM PÓ
1437|4.1|4.1||40 28|II|333|HIDRETO DE ZIRCÔNIO
1438|5.1|5.1||50|III|1000|NITRATO DE ALUMÍNIO
1439|5.1|5.1||50|II|333|DICROMATO DE AMÔNIO
1442|5.1|5.1||50|II|333|PERCLORATO DE AMÔNIO
1444|5.1|5.1||50|III|1000|PERSULFATO DE AMÔNIO
1445|5.1|5.1|6.1|56|II|333|CLORATO DE BÁRIO, SÓLIDO
1446|5.1|5.1|6.1|56|II|333|NITRATO DE BÁRIO
1447|5.1|5.1|6.1|56|II|333|PERCLORATO DE BÁRIO, SÓLIDO
1448|5.1|5.1|6.1|56|II|333|PERMANGANATO DE BÁRIO
1449|5.1|5.1|6.1|56|II|333|PERÓXIDO DE BÁRIO
1450|5.1|5.1||50|II|333|BROMATOS, INORGÂNICOS, N.E.
1451|5.1|5.1||50|III|1000|NITRATO DE CÉSIO
1452|5.1|5.1||50|II|333|CLORATO DE CÁLCIO
1453|5.1|5.1||50|II|333|CLORITO DE CÁLCIO
1454|5.1|5.1||50|III|1000|NITRATO DE CÁLCIO
1455|5.1|5.1||50|II|333|PERCLORATO DE CÁLCIO
1456|5.1|5.1||50|II|333|PERMANGANATO DE CÁLCIO
1457|5.1|5.1||50|II|333|PERÓXIDO DE CÁLCIO
1458|5.1|5.1||50|II III|333|MISTURA DE CLORATO E BORATO
1459|5.1|5.1||50|II III|333|MISTURA DE CLORETO E CLORATO DE MAGNÉSIO, SÓLIDA
1461|5.1|5.1||50 29|II|333|CLORATOS, INORGÂNICOS, N.E.
1462|5.1|5.1||50|II|333|CLORITOS, INORGÂNICOS, N.E.
1463|5.1|5.1|6.1 8|568|II|333|TRIÓXIDO DE CROMO, ANIDRO
1465|5.1|5.1||50|III|1000|NITRATO DE DIDÍMIO
1466|5.1|5.1||50|III|1000|NITRATO FÉRRICO
1467|5.1|5.1||50|III|1000|NITRATO DE GUANIDINA
1469|5.1|5.1|6.1|56|II|333|NITRATO DE CHUMBO
1470|5.1|5.1|6.1|56|II|333|PERCLORATO DE CHUMBO, SÓLIDO
1471|5.1|5.1||50|II III|333|HIPOCLORITO DE LÍTIO, SECO, ou MISTURA DE HIPOCLORITO DE LÍTIO
1472|5.1|5.1||50|II|333|PERÓXIDO DE LÍTIO
1473|5.1|5.1||50|II|333|BROMATO DE MAGNÉSIO
1474|5.1|5.1||50|III|1000|NITRATO DE MAGNÉSIO
1475|5.1|5.1||50|II|333|PERCLORATO DE MAGNÉSIO
1476|5.1|5.1||50|II|333|PERÓXIDO DE MAGNÉSIO
1477|5.1|5.1||50|II III|333|NITRATOS, INORGÂNICOS, N.E.
1479|5.1|5.1||55 50|I II III|20|SÓLIDO OXIDANTE, N.E.
1481|5.1|5.1||50 30|II III|333|PERCLORATOS, INORGÂNICOS, N.E.
1482|5.1|5.1||50|II III|333|PERMANGANATOS, INORGÂNICOS, N.E
1483|5.1|5.1||50|II III|333|PERÓXIDOS, INORGÂNICOS, N.E.
1484|5.1|5.1||50|II|333|BROMATO DE POTÁSSIO
1485|5.1|5.1||50|II|333|CLORATO DE POTÁSSIO
1486|5.1|5.1||50|III|1000|NITRATO DE POTÁSSIO
1487|5.1|5.1||50|II|333|MISTURA DE NITRATO DE POTÁSSIO E NITRITO DE SÓDIO
1488|5.1|5.1||50|II|333|NITRITO DE POTÁSSIO
1489|5.1|5.1||50|II|333|PERCLORATO DE POTÁSSIO
1490|5.1|5.1||50|II|333|PERMANGANATO DE POTÁSSIO
1491|5.1|5.1||55|I|20|PERÓXIDO DE POTÁSSIO
1492|5.1|5.1||50|III|1000|PERSULFATO DE POTÁSSIO
1493|5.1|5.1||50|II|333|NITRATO DE PRATA
1494|5.1|5.1||50|II|333|BROMATO DE SÓDIO
1495|5.1|5.1||50|II|333|CLORATO DE SÓDIO
1496|5.1|5.1||50|II|333|CLORITO DE SÓDIO
1498|5.1|5.1||50|III|1000|NITRATO DE SÓDIO
1499|5.1|5.1||50|III|1000|MISTURA DE NITRATO DE SÓDIO E NITRATO DE POTÁSSIO
1500|5.1|5.1|6.1|56 31|III|1000|NITRITO DE SÓDIO
1502|5.1|5.1||50|II|333|PERCLORATO DE SÓDIO
1503|5.1|5.1||50|II|333|PERMANGANATO DE SÓDIO
1504|5.1|5.1||55|I|20|PERÓXIDO DE SÓDIO
1505|5.1|5.1||50|III|1000|PERSULFATO DE SÓDIO
1506|5.1|5.1||50|II|333|CLORATO DE ESTRÔNCIO
1507|5.1|5.1||50|III|1000|NITRATO DE ESTRÔNCIO
1508|5.1|5.1||50|II|333|PERCLORATO DE ESTRÔNCIO
1509|5.1|5.1||50|II|333|PERÓXIDO DE ESTRÔNCIO
1510|6.1|6.1|5.1|665|I|20|TETRANITROMETANO
1511|5.1|5.1|8|58|III|1000|URÉIA-PEROXIDO DE HIDROGÊNIO ou HIDROPERÓXIDO DE URÉIA
1512|5.1|5.1||50|II|333|NITRITO DE ZINCO E AMÔNIO
1513|5.1|5.1||50|II|333|CLORATO DE ZINCO
1514|5.1|5.1||50|II|333|NITRATO DE ZINCO
1515|5.1|5.1||50|II|333|PERMANGANATO DE ZINCO
1516|5.1|5.1||50|II|333|PERÓXIDO DE ZINCO
1517|4.1|4.1||40|I|20|PICRAMATO DE ZIRCÔNIO UMEDECIDO com no mínimo 20 % de água, em massa
1541|6.1|6.1||669|I|20|ACETONA-CIANIDRINA ESTABILIZADA
1544|6.1|6.1||66 60|I II III|20|ALCALÓIDES, SÓLIDOS, N.E ou SAIS DE ALCALÓIDES, SÓLIDOS N.E.
1545|6.1|6.1|3|639|II|333|ISOTIOCIANATO DE ALILA, ESTABILIZADO
1546|6.1|6.1||60|II|333|ARSENIATO DE AMÔNIO
1547|6.1|6.1||60|II|333|ANILINA
1548|6.1|6.1||60 32|III|333|CLORIDRATO DE ANILINA
1549|6.1|6.1||60|III|333|ANTIMÔNIO COMPOSTO, INORGÂNICO, SÓLIDO, N.E.
1550|6.1|6.1||60|III|333|LACTATO DE ANTIMÔNIO
1551|6.1|6.1||60|III|333|TARTARATO DE ANTIMÔNIO E POTÁSSIO
1553|6.1|6.1||66|I|20|ÁCIDO ARSÊNICO, LÍQUIDO
1554|6.1|6.1||60|II|333|ÁCIDO ARSÊNICO, SÓLIDO
1555|6.1|6.1||60|II|333|BROMETO DE ARSÊNIO
1556|6.1|6.1||66 60|I II III|20|ARSÊNIO COMPOSTO, LÍQUIDO, N.E., inorgânico, incluindo: Arseniatos, n.e., Arsenitos, n.e., e Sulfetos de…
1557|6.1|6.1||66 60|I II III|20|ARSÊNIO COMPOSTO, SÓLIDO, N.E., inorgânico, incluindo: Arseniatos, n.e., Arsenitos, n.e., e Sulfetos de…
1558|6.1|6.1||60|II|333|ARSÊNIO
1559|6.1|6.1||60|II|333|PENTÓXIDO DE ARSÊNIO
1560|6.1|6.1||66|I|20|TRICLORETO DE ARSÊNIO
1561|6.1|6.1||60|II|333|TRIÓXIDO DE ARSÊNIO
1562|6.1|6.1||60|II|333|PÓ DE COMPOSTOS DE ARSÊNIO
1564|6.1|6.1||60|II III|333|BÁRIO COMPOSTO, N.E.
1565|6.1|6.1||66 33|I|20|CIANETO DE BÁRIO
1566|6.1|6.1||60|II III|333|BERÍLIO COMPOSTO, N.E.
1567|6.1|6.1|4.1|64|II|333|BERÍLIO EM PÓ
1569|6.1|6.1|3|63|II|333|BROMOACETONA
1570|6.1|6.1||66|I|20|BRUCINA
1571|4.1|4.1|6.1|46|I|20|AZIDA DE BÁRIO, UMEDECIDA com no mínimo 50% de água, em massa
1572|6.1|6.1||60|II|333|ÁCIDO CACODÍLICO
1573|6.1|6.1||60|II|333|ARSENIATO DE CÁLCIO
1574|6.1|6.1||60|II|333|MISTURA DE ARSENIATO DE CÁLCIO E ARSENITO DE CÁLCIO, SÓLIDA
1575|6.1|6.1||66|I|20|CIANETO DE CÁLCIO
1577|6.1|6.1||60|II|333|CLORODINITROBENZENOS, LÍQUIDOS
1578|6.1|6.1||60|II|333|CLORONITROBENZENOS, SÓLIDOS
1579|6.1|6.1||60|III|333|CLORIDRATO DE 4-CLORO-o- TOLUIDINA, SÓLIDO
1580|6.1|6.1||66|I|20|CLOROPICRINA
1581|2.3|2.3||26||20|MISTURA DE CLOROPICRINA E BROMETO DE METILA com mais de 2% cloropicrina
1582|2.3|2.3||26||20|MISTURA DE CLOROPICRINA E CLORETO DE METILA
1583|6.1|6.1||66 60|I II III|20|MISTURA DE CLOROPICRINA, N.E.
1585|6.1|6.1||60|II|333|ACETOARSENITO DE COBRE
1586|6.1|6.1||60|II|333|ARSENITO DE COBRE
1587|6.1|6.1||60|II|333|CIANETO DE COBRE
1588|6.1|6.1||66 60 34|I II III|20|CIANETOS, INORGÂNICOS, SÓLIDOS, N.E.
1589|2.3|2.3|8|268||20|CLORETO DE CIANOGÊNIO, ESTABILIZADO
1590|6.1|6.1||60|II|333|DICLOROANILINAS, LÍQUIDAS
1591|6.1|6.1||60|III|333|o-DICLOROBENZENO
1593|6.1|6.1||60|III|333|DICLOROMETANO
1594|6.1|6.1||60|II|333|SULFATO DE DIETILA
1595|6.1|6.1|8|668|I|20|SULFATO DE DIMETILA
1596|6.1|6.1||60|II|333|DINITROANILINAS
1597|6.1|6.1||60|II III|333|DINITROBENZENOS, LÍQUIDOS
1598|6.1|6.1||60|II|333|DINITRO-o-CRESOL
1599|6.1|6.1||60|II III|333|DINITROFENOL SOLUÇÃO
1600|6.1|6.1||60|II|Z|DINITROTOLUENOS, FUNDIDOS
1601|6.1|6.1||66 60|I II III|20|DESINFETANTE, TÓXICO, SÓLIDO, N.E.
1602|6.1|6.1||66 60|I II III|20|CORANTE, TÓXICO, LÍQUIDO, N.E. ou INTERMEDIÁRIO PARA CORANTES, TÓXICO, LÍQUIDO, N.E.
1603|6.1|6.1|3|63|II|333|ACETATO DE BROMOETILA
1604|8|8|3|83|II|333|ETILENODIAMINA
1605|6.1|6.1||66 35|I|20|DIBROMETO DE ETILENO
1606|6.1|6.1||60|II|333|ARSENIATO FÉRRICO
1607|6.1|6.1||60|II|333|ARSENITO FÉRRICO
1608|6.1|6.1||60|II|333|ARSENIATO FERROSO
1611|6.1|6.1||60|II|333|TETRAFOSFATO DE HEXAETILA
1612|2.3|2.3||26||20|MISTURA DE TETRAFOSFATO DE HEXAETILA E GÁS COMPRIMIDO
1613|6.1|6.1||663|I|Z|ÁCIDO CIANÍDRICO, SOLUÇÃO AQUOSA, (CIANETO DE HIDROGÊNIO, SOLUÇÃO AQUOSA) com até 20%
1614|6.1|6.1|3|663|I|Z|CIANETO DE HIDROGÊNIO, ESTABILIZADO, contendo menos de 3% de água e absorvido em material inerte e
1616|6.1|6.1||60|III|333|ACETATO DE CHUMBO
1617|6.1|6.1||60|II|333|ARSENIATO(S) DE CHUMBO
1618|6.1|6.1||60|II|333|ARSENITO(S) DE CHUMBO
1620|6.1|6.1||60|II|333|CIANETO DE CHUMBO
1621|6.1|6.1||60|II|333|PÚRPURA DE LONDRES
1622|6.1|6.1||60|II|333|ARSENIATO DE MAGNÉSIO
1623|6.1|6.1||60|II|333|ARSENIATO MERCÚRICO
1624|6.1|6.1||60|II|333|CLORETO MERCÚRICO
1625|6.1|6.1||60|II|333|NITRATO MERCÚRICO
1626|6.1|6.1||66|I|20|CIANETO DUPLO DE MERCÚRIO E POTÁSIO
1627|6.1|6.1||60|II|333|NITRATO MERCUROSO
1629|6.1|6.1||60|II|333|ACETATO DE MERCÚRIO
1630|6.1|6.1||60|II|333|CLORETO DUPLO DE MERCÚRIO E AMÔNIO
1631|6.1|6.1||60|II|333|BENZOATO DE MERCÚRIO
1634|6.1|6.1||60|II|333|BROMETO(S) DE MERCÚRIO
1636|6.1|6.1||60|II|333|CIANETO DE MERCÚRIO
1637|6.1|6.1||60|II|333|GLUCONATO DE MERCÚRIO
1638|6.1|6.1||60|II|333|IODETO DE MERCÚRIO
1639|6.1|6.1||60 36|II|333|NUCLEATO DE MERCÚRIO
1640|6.1|6.1||60|II|333|OLEATO DE MERCÚRIO
1641|6.1|6.1||60|II|333|ÓXIDO DE MERCÚRIO
1642|6.1|6.1||60|II|333|OXICIANETO DE MERCÚRIO, INSENSIBILIZADO
1643|6.1|6.1||60|II|333|IODETO DE MERCÚRIO E POTÁSSIO
1644|6.1|6.1||60|II|333|SALICILATO DE MERCÚRIO
1645|6.1|6.1||60|II|333|SULFATO DE MERCÚRIO
1646|6.1|6.1||60|II|333|TIOCIANATO DE MERCÚRIO
1647|6.1|6.1||66|I|20|MISTURA DE BROMETO DE METILA E DIBROMETO DE ETILENO, LÍQUIDA
1648|3|3||33|II|333|ACETONITRILA
1649|6.1|6.1||66|I|20|MISTURA ANTIDETONANTE PARA COMBUSTÍVEL PARA MOTOR
1650|6.1|6.1||60|II|333|beta-NAFTILAMINA, SÓLIDA
1651|6.1|6.1||60|II|333|NAFTILTIOURÉIA
1652|6.1|6.1||60|II|333|NAFTILURÉIA
1653|6.1|6.1||60|II|333|CIANETO DE NÍQUEL
1654|6.1|6.1||60|II|333|NICOTINA
1655|6.1|6.1||66 60|I II III|20|NICOTINA COMPOSTO, SÓLIDO, N.E. ou NICOTINA PREPARAÇÃO, SÓLIDA, N.E.
1656|6.1|6.1||60|II III|333|CLORIDRATO DE NICOTINA, LÍQUIDO OU SOLUÇÃO
1657|6.1|6.1||60|II|333|SALICILATO DE NICOTINA
1658|6.1|6.1||60|II III|333|SULFATO DE NICOTINA, SOLUÇÃO
1659|6.1|6.1||60 37|II|333|TARTARATO DE NICOTINA
1660|2.3|2.3|5.1 8|265||20|ÓXIDO NÍTRICO, COMPRIMIDO
1661|6.1|6.1||60|II|333|NITROANILINAS (o-,m-,p-)
1662|6.1|6.1||60|II|333|NITROBENZENO
1663|6.1|6.1||60|III|333|NITROFENÓIS (o-,m-,p-)
1664|6.1|6.1||60|II|333|NITROTOLUENOS, LÍQUIDOS
1665|6.1|6.1||60|II|333|NITROXILENOS, LÍQUIDOS
1669|6.1|6.1||60|II|333|PENTACLOROETANO
1670|6.1|6.1||66|I|20|PERCLOROMETILMERCAPTANA
1671|6.1|6.1||60|II|333|FENOL, SÓLIDO
1672|6.1|6.1||66|I|20|CLORETO DE FENILCARBILAMINA
1673|6.1|6.1||60|III|333|FENILENODIAMINAS (o-,m-,p-)
1674|6.1|6.1||60|II|333|ACETATO DE FENILMERCÚRICO
1677|6.1|6.1||60|II|333|ARSENIATO DE POTÁSSIO
1678|6.1|6.1||60|II|333|ARSENITO DE POTÁSSIO
1679|6.1|6.1||60|II|333|CUPROCIANETO DE POTÁSSIO
1680|6.1|6.1||66|I|20|CIANETO DE POTÁSSIO, SÓLIDO
1683|6.1|6.1||60|II|333|ARSENITO DE PRATA
1684|6.1|6.1||60|II|333|CIANETO DE PRATA
1685|6.1|6.1||60|II|333|ARSENIATO DE SÓDIO
1686|6.1|6.1||60|II III|333|ARSENITO DE SÓDIO, SOLUÇÃO AQUOSA
1687|6.1|6.1||60|II|333|AZIDA DE SÓDIO
1688|6.1|6.1||60 38|II|333|CACODILATO DE SÓDIO
1689|6.1|6.1||66|I|20|CIANETO DE SÓDIO, SÓLIDO
1690|6.1|6.1||60|III|333|FLUORETO DE SÓDIO, SÓLIDO
1691|6.1|6.1||60|II|333|ARSENITO DE ESTRÔNCIO
1692|6.1|6.1||66|I|20|ESTRICNINA ou SAIS DE ESTRICNINA
1693|6.1|6.1||66 60|I II|20|SUBSTÂNCIA PARA PRODUÇÃO DE GÁS LACRIMOGÊNEO, LÍQUIDA, N.E.
1694|6.1|6.1||66|I|20|CIANETO(S) DE BROMOBENZILA, LÍQUIDOS
1695|6.1|6.1|3 8|663|I|20|CLOROACETONA, ESTABILIZADA
1697|6.1|6.1||60|II|333|CLOROACETOFENONA, SÓLIDA
1698|6.1|6.1||66|I|20|DIFENILAMINACLOROARSINA
1699|6.1|6.1||66|I|20|DIFENILCLOROARSINA, LÍQUIDA
1700|6.1|6.1|4.1|64||333|VELAS LACRIMOGÊNEAS
1701|6.1|6.1||60|II|333|BROMETO DE XILILA, LÍQUIDO
1702|6.1|6.1||60|II|333|1,1,2,2-TETRACLOROETANO
1704|6.1|6.1||60|II|333|DITIOPIROFOSFATO DE TETRAETILA
1707|6.1|6.1||60|II|333|TÁLIO COMPOSTO, N.E.
1708|6.1|6.1||60|II|333|TOLUIDINAS, LÍQUIDAS
1709|6.1|6.1||60|III|333|2,4-TOLUILENODIAMINA, SÓLIDA
1710|6.1|6.1||60|III|333|TRICLOROETILENO
1711|6.1|6.1||60|II|333|XILIDINAS, LÍQUIDAS
1712|6.1|6.1||60|II|333|ARSENIATO DE ZINCO, ARSENITO DE ZINCO, ou MISTURA DE ARSENIATO DE ZINCO E ARSENITO DE
1713|6.1|6.1||66|I|20|CIANETO DE ZINCO
1714|4.3|4.3|6.1|X462|I|20|FOSFETO DE ZINCO
1715|8|8|3|83|II|333|ANIDRIDO ACÉTICO
1716|8|8||80|II|333|BROMETO DE ACETILA
1717|3|3|8|X338 39|II|333|CLORETO DE ACETILA
1718|8|8||80|III|1000|FOSFATO ÁCIDO DE BUTILA
1719|8|8||80|II III|333|LÍQUIDO ALCALINO CÁUSTICO, N.E.
1722|6.1|6.1|3 8|668|I|20|CLOROFORMIATO DE ALILA
1723|3|3|8|338|II|333|IODETO DE ALILA
1724|8|8|3|X839|II|333|ALILTRICLOROSSILANO, ESTABILIZADO
1725|8|8||80|II|333|BROMETO DE ALUMÍNIO, ANIDRO
1726|8|8||80|II|333|CLORETO DE ALUMÍNIO, ANIDRO
1727|8|8||80|II|333|HIDROGENODIFLUORETO DE AMÔNIO, SÓLIDO
1728|8|8||X80|II|333|AMILTRICLOROSSILANO
1729|8|8||80|II|333|CLORETO DE ANISOÍLA
1730|8|8||X80|II|333|PENTACLORETO DE ANTIMÔNIO, LÍQUIDO
1731|8|8||80|II III|333|PENTACLORETO DE ANTIMÔNIO, SOLUÇÃO
1732|8|8|6.1|86|II|333|PENTAFLUORETO DE ANTIMÔNIO
1733|8|8||80|II|333|TRICLORETO DE ANTIMÔNIO
1736|8|8||80|II|333|CLORETO DE BENZOÍLA
1737|6.1|6.1|8|68|II|333|BROMETO DE BENZILA
1738|6.1|6.1|8|68|II|333|CLORETO DE BENZILA
1739|8|8||88|I|20|CLOROFORMIATO DE BENZILA
1740|8|8||80|II III|333|HIDROGENODIFLUORETOS, SÓLIDOS, N.E.
1741|2.3|2.3|8|268||20|TRICLORETO DE BORO
1742|8|8||80 40|II|333|TRIFLUORETO DE BORO E ÁCIDO ACÉTICO, COMPLEXO DE, LÍQUIDO
1743|8|8||80|II|333|TRIFLUORETO DE BORO E ÁCIDO PROPIÔNICO, COMPLEXO DE, LÍQUIDO
1744|8|8|6.1|886|I|20|BROMO ou SOLUÇÃO DE BROMO
1745|5.1|5.1|6.1 8|568|I|20|PENTAFLUORETO DE BROMO
1746|5.1|5.1|6.1 8|568|I|20|TRIFLUORETO DE BROMO
1747|8|8|3|X83|II|333|BUTILTRICLOROSSILANO
1748|5.1|5.1||50|II III|333|HIPOCLORITO DE CÁLCIO, SECO ou MISTURA DE HIPOCLORITO DE CÁLCIO, SECA com mais de 39% de…
1749|2.3|2.3|5.1 8|265||20|TRIFLUORETO DE CLORO
1750|6.1|6.1|8|68|II|333|ÁCIDO CLORACÉTICO, SOLUÇÃO
1751|6.1|6.1|8|68|II|333|ÁCIDO CLORACÉTICO, SÓLIDO
1752|6.1|6.1|8|668|I|20|CLORETO DE CLOROACETILA
1753|8|8||X80|II|333|CLOROFENILTRICLOROSSILANO
1754|8|8||X88|I|20|ÁCIDO CLOROSSULFONICO (com ou sem trióxido de enxofre)
1755|8|8||80|II III|333|ÁCIDO CRÔMICO, SOLUÇÃO
1756|8|8||80|II|333|FLUORETO CRÔMICO, SÓLIDO
1757|8|8||80|II III|333|FLUORETO CRÔMICO, SOLUÇÃO
1758|8|8||X88|I|20|OXICLORETO DE CROMO
1759|8|8||88 80|I II III|20|SÓLIDO CORROSIVO, N.E.
1760|8|8||88 41|I|20|LÍQUIDO CORROSIVO, N.E.
1761|8|8|6.1|86|II III|333|CUPRIETILENODIAMINA, SOLUÇÃO
1762|8|8||X80|II|333|CICLO-HEXENILTRICLOROSSILANO
1763|8|8||X80|II|333|CICLO-HEXILTRICLOROSSILANO
1764|8|8||80|II|333|ÁCIDO DICLORACÉTICO
1765|8|8||X80|II|333|CLORETO DE DICLOROACETILA
1766|8|8||X80|II|333|DICLOROFENILTRICLOROSSILANO
1767|8|8|3|X83|II|333|DIETILDICLOROSSILANO
1768|8|8||80|II|333|ÁCIDO DIFLUORFOSFÓRICO, ANIDRO
1769|8|8||X80|II|333|DIFENILDICLOROSSILANO
1770|8|8||80|II|333|BROMETO DE DIFENILMETILA
1771|8|8||X80|II|333|DODECILTRICLOROSSILANO
1773|8|8||80|III|1000|CLORETO FÉRRICO, ANIDRO
1774|8|8||80|II|333|CARGAS PARA EXTINTOR DE INCÊNDIO, líquidas, corrosivas
1775|8|8||80|II|333|ÁCIDO FLUORBÓRICO
1776|8|8||80|II|333|ÁCIDO FLUORFOSFÓRICO, ANIDRO
1777|8|8||88|I|20|ÁCIDO FLUORSULFÔNICO
1778|8|8||80|II|333|ÁCIDO FLUORSILÍCICO
1779|8|8|3|83|II|333|ÁCIDO FÓRMICO com mais de 85% de ácido em massa
1780|8|8||80 42|II|333|CLORETO DE FUMARILA
1781|8|8||X80|II|333|HEXADECILTRICLOROSSILANO
1782|8|8||80|II|333|ÁCIDO HEXAFLUORFOSFÓRICO
1783|8|8||80|II III|333|HEXAMETILENODIAMINA SOLUÇÃO
1784|8|8||X80|II|333|HEXILTRICLOROSSILANO
1786|8|8|6.1|886|I|20|MISTURA DE ÁCIDO FLUORÍDRICO E ÁCIDO SULFÚRICO
1787|8|8||80|II III|333|ÁCIDO IODÍDRICO
1788|8|8||80|II III|333|ÁCIDO BROMÍDRICO
1789|8|8||80|II III|333|ÁCIDO CLORÍDRICO
1790|8|8|6.1|886 86|I II|20|ÁCIDO FLUORÍDRICO, com mais de 60% de ácido fluorídrico ÁCIDO FLUORÍDRICO, com até 60% de ácido fluorídrico
1791|8|8||80|II III|333|HIPOCLORITO SOLUÇÃO
1792|8|8||80|II|333|MONOCLORETO DE IODO, SÓLIDO
1793|8|8||80|III|1000|FOSFATO ÁCIDO DE ISOPROPILA
1794|8|8||80|II|333|SULFATO DE CHUMBO com mais de 3% de ácido livre
1796|8|8|5.1|885 80|I II|20|MISTURA NITRANTE ÁCIDA, com mais de 50% de ácido nítrico MISTURA NITRANTE ÁCIDA, com até 50% de ácido nítrico
1798|8|8||43||P|ÁCIDO NITROCLORÍDRICO
1799|8|8||X80|II|333|NONILTRICLOROSSILANO
1800|8|8||X80|II|333|OCTADECILTRICLOROSSILANO
1801|8|8||X80|II|333|OCTILTRICLOROSSILANO
1802|8|8|5.1|85|II|333|ÁCIDO PERCLÓRICO com até 50% de ácido, em massa
1803|8|8||80|II|333|ÁCIDO FENOLSULFÔNICO, LÍQUIDO
1804|8|8||X80|II|333|FENILTRICLOROSSILANO
1805|8|8||80|III|1000|ÁCIDO FOSFÓRICO, SOLUÇÃO
1806|8|8||80|II|333|PENTACLORETO DE FÓSFORO
1807|8|8||80|II|333|PENTÓXIDO DE FÓSFORO
1808|8|8||X80|II|333|TRIBROMETO DE FÓSFORO
1809|6.1|6.1|8|668|I|20|TRICLORETO DE FÓSFORO
1810|6.1|6.1|8|X668|I|333|OXICLORETO DE FÓSFORO
1811|8|8|6.1|86|II|333|HIDROGENODIFLUORETO DE POTÁSSIO SÓLIDO
1812|6.1|6.1||60|III|333|FLUORETO DE POTÁSSIO SÓLIDO
1813|8|8||80|II|333|HIDRÓXIDO DE POTÁSSIO, SÓLIDO
1814|8|8||80|II III|333|HIDRÓXIDO DE POTÁSSIO SOLUÇÃO
1815|3|3|8|338|II|333|CLORETO DE PROPIONILA
1816|8|8|3|X83|II|333|PROPILTRICLOROSSILANO
1817|8|8||X80 44|II|333|CLORETO DE PIROSSULFURILA
1818|8|8||X80|II|333|TETRACLORETO DE SILÍCIO
1819|8|8||80|II III|333|ALUMINATO DE SÓDIO SOLUÇÃO
1823|8|8||80|II|333|HIDRÓXIDO DE SÓDIO, SÓLIDO
1824|8|8||80|II III|333|HIDRÓXIDO DE SÓDIO SOLUÇÃO
1825|8|8||80|II|333|MONÓXIDO DE SÓDIO
1826|8|8|5.1|885 80|I II|20|MISTURA NITRANTE ÁCIDA, RESIDUAL, com mais de 50% de ácido nítrico MISTURA NITRANTE ÁCIDA, RESIDUAL, com até…
1827|8|8||X80|II|333|CLORETO ESTÂNICO, ANIDRO
1828|8|8||X88|I|20|CLORETO(S) DE ENXOFRE
1829|8|8||X88|I|20|TRIÓXIDO DE ENXOFRE, ESTABILIZADO
1830|8|8||80|II|333|ÁCIDO SULFÚRICO, com mais de 51% de ácido
1831|8|8|6.1|X886|I|20|ÁCIDO SULFÚRICO, FUMEGANTE
1832|8|8||80|II|333|ÁCIDO SULFÚRICO, RESIDUAL
1833|8|8||80|II|333|ÁCIDO SULFUROSO
1834|6.1|6.1|8|X668|I|20|CLORETO DE SULFURILA
1835|8|8||80|II III|333|HIDRÓXIDO DE TETRAMETILAMÔNIO SOLUÇÃO
1836|8|8||X88|I|20|CLORETO DE TIONILA
1837|8|8||X80|II|333|CLORETO DE TIOFOSFORILA
1838|6.1|6.1|8|X668 45|I|333|TETRACLORETO DE TITÂNIO
1839|8|8||80|II|333|ÁCIDO TRICLOROACÉTICO
1840|8|8||80|III|1000|CLORETO DE ZINCO SOLUÇÃO
1841|9|9||90|III|1000|ACETALDEÍDO DE AMÔNIA
1843|6.1|6.1||60|II|333|DINITRO-o-CRESOLATO DE AMÔNIO, SÓLIDO
1845|9|9||90|III|I|DIÓXIDO DE CARBONO, SÓLIDO (GELO SECO)
1846|6.1|6.1||60|II|333|TETRACLORETO DE CARBONO
1847|8|8||80|II|333|SULFETO DE POTÁSSIO, HIDRATADO com no mínimo 30% de água de cristalização
1848|8|8||80|III|1000|ÁCIDO PROPIÔNICO com no mínimo 10% e com menos de 90% de ácido em massa
1849|8|8||80|II|333|SULFETO DE SÓDIO, HIDRATADO com no mínimo 30% de água
1851|6.1|6.1||60|II III|333|MEDICAMENTO, TÓXICO, LÍQUIDO, N.E.
1854|4.2|4.2||43|I|Z|LIGAS DE BÁRIO, PIROFÓRICA(S)
1855|4.2|4.2||43|I|Z|CÁLCIO, PIROFÓRICO, ou LIGAS DE CÁLCIO, PIROFÓRICAS
1856||||||N|TRAPOS, OLEOSOS
1857||||||N|RESÍDUOS TÊXTEIS, ÚMIDOS
1858|2.2|2.2||20||1000|HEXAFLUORPROPILENO (GÁS REFRIGERANTE R 1216)
1859|2.3|2.3|8|268||20|TETRAFLUORETO DE SILÍCIO
1860|2.1|2.1||239||333|FLUORETO DE VINILA, ESTABILIZADO
1862|3|3||33|II|333|CROTONATO DE ETILA
1863|3|3||33 30|I II III|20|COMBUSTÍVEL PARA AVIÕES A TURBINA ou QUEROSENE DE AVIAÇÃO QAV-1 ou JET A-1
1865|3|3||33|II|333|NITRATO DE n-PROPILA
1866|3|3||33 30 46|I II III|20|RESINA SOLUÇÃO, inflamável
1868|4.1|4.1|6.1|46|II|333|DECABORANO
1869|4.1|4.1||40|III|1000|MAGNÉSIO ou LIGAS DE MAGNÉSIO com mais de 50% de magnésio, em grânulos, limalhas ou aparas
1870|4.3|4.3||X423|I|20|BORO-HIDRETO DE POTÁSSIO
1871|4.1|4.1||40|II|333|HIDRETO DE TITÂNIO
1872|5.1|5.1||56|III|1000|DIÓXIDO DE CHUMBO
1873|5.1|5.1|8|558|I|20|ÁCIDO PERCLÓRICO com mais de 50% e até 72% de ácido, em massa
1884|6.1|6.1||60|III|333|ÓXIDO DE BÁRIO
1885|6.1|6.1||60|II|333|BENZIDINA
1886|6.1|6.1||60|II|333|CLORETO DE BENZILIDENO
1887|6.1|6.1||60|III|333|BROMOCLOROMETANO
1888|6.1|6.1||60|III|333|CLOROFÓRMIO
1889|6.1|6.1|8|668|I|20|BROMETO DE CIANOGÊNIO
1891|3|3|6.1|36|II|333|BROMETO DE ETILA
1892|6.1|6.1||66|I|20|ETILDICLOROARSINA
1894|6.1|6.1||60|II|333|HIDRÓXIDO FENILMERCÚRIO
1895|6.1|6.1||60|II|333|NITRATO FENILMERCÚRIO
1897|6.1|6.1||60|III|333|TETRACLOROETILENO
1898|8|8||80|II|333|IODETO DE ACETILA
1902|8|8||80|III|1000|FOSFATO ÁCIDO DE DIISOOCTILA
1903|8|8||88 80|I II III|20|DESINFETANTE, CORROSIVO, LÍQUIDO, N.E.
1905|8|8||88 47|I|20|ÁCIDO SELÊNICO
1906|8|8||80|II|333|LAMA ÁCIDA
1907|8|8||80|III|1000|CAL SODADA, com mais de 4% de hidróxido de sódio
1908|8|8||80|II III|333|CLORITO, SOLUÇÃO
1910||||||N|ÓXIDO DE CÁLCIO
1911|2.3|2.3|2.1|263||20|DIBORANO
1912|2.1|2.1||23||333|MISTURA DE CLORETO DE METILA E CLORETO DE METILENO
1913|2.2|2.2||22||1000|NEÔNIO, LÍQUIDO REFRIGERADO
1914|3|3||30|III|1000|PROPIONATOS DE BUTILA
1915|3|3||30|III|1000|CICLOHEXANONA
1916|6.1|6.1|3|63|II|333|ÉTER 2,2'-DICLORODIETÍLICO
1917|3|3||339|II|333|ACRILATO DE ETILA, ESTABILIZADO
1918|3|3||30|III|1000|ISOPROPILBENZENO
1919|3|3||339|II|333|ACRILATO DE METILA, ESTABILIZADO
1920|3|3||30|III|1000|NONANOS
1921|3|3|6.1|336|I|20|PROPILENOIMINA, ESTABILIZADA
1922|3|3|8|338|II|333|PIRROLIDINA
1923|4.2|4.2||40|II|333|DITIONITO DE CÁLCIO (HIDROSSULFITO DE CÁLCIO)
1928|4.3|4.3|3|X323|I|Z|BROMETO DE METILMAGNÉSIO EM ÉTER ETÍLICO
1929|4.2|4.2||40|II|333|DITIONITO DE POTÁSSIO (HIDROSSULFITO DE POTÁSSIO)
1931|9|9||90|III|1000|DITIONITO DE ZINCO (HIDROSSULFITO DE ZINCO)
1932|4.2|4.2||40|III|1000|ZIRCÔNIO, APARAS
1935|6.1|6.1||66 48|I|20|CIANETO SOLUÇÃO, N.E.
1938|8|8||80|II III|333|ÁCIDO BROMOACÉTICO SOLUÇÃO
1939|8|8||80|II|333|OXIBROMETO DE FÓSFORO
1940|8|8||80|II|333|ÁCIDO TIOGLICÓLICO
1941|9|9||90|III|1000|DIBROMODIFLUORMETANO
1942|5.1|5.1||50|III|1000|NITRATO DE AMÔNIO, contendo até 0,2% de substâncias combustíveis, inclusive qualquer substância orgânica…
1944|4.1|4.1||40|III|I|FÓSFOROS DE SEGURANÇA (carteiras, cartelas ou caixas)
1945|4.1|4.1||40|III|I|FÓSFORO DE CERA VIRGEM
1950|2|2||||V|AEROSSÓIS
1951|2.2|2.2||22||1000|ARGÔNIO, LÍQUIDO REFRIGERADO
1952|2.2|2.2||20||1000|MISTURA DE ÓXIDO DE ETILENO E DIÓXIDO DE CARBONO com até 9% de óxido de etileno
1953|2.3|2.3|2.1|263||20|GÁS TÓXICO, INFLAMÁVEL, COMPRIMIDO, N.E.
1954|2.1|2.1||23||333|GÁS INFLAMÁVEL, COMPRIMIDO, N.E.
1955|2.3|2.3||26||20|GÁS TÓXICO, COMPRIMIDO, N.E.
1956|2.2|2.2||20||1000|GÁS COMPRIMIDO, N.E.
1957|2.1|2.1||23||333|DEUTÉRIO, COMPRIMIDO
1958|2.2|2.2||20||1000|1,2-DICLORO-1,1,2,2-TETRAFLUORETANO (GÁS REFRIGERANTE R 114)
1959|2.1|2.1||239||333|1,1-DIFLUORETILENO (GÁS REFRIGERANTE R 1132 a)
1961|2.1|2.1||223||333|ETANO, LÍQUIDO REFRIGERADO
1962|2.1|2.1||23||333|ETILENO
1963|2.2|2.2||22||1000|HÉLIO, LÍQUIDO REFRIGERADO
1964|2.1|2.1||23||333|MISTURA DE HIDROCARBONETO GASOSO, COMPRIMIDA, N.E.
1965|2.1|2.1||23||333|MISTURA DE HIDROCARBONETO GASOSO, LIQUEFEITA, N.E.
1966|2.1|2.1||223 49||333|HIDROGÊNIO, LÍQUIDO REFRIGERADO
1967|2.3|2.3||26||20|INSETICIDA, TÓXICO, GASOSO, N.E.
1968|2.2|2.2||20||1000|INSETICIDA GASOSO, N.E.
1969|2.1|2.1||23||333|ISOBUTANO
1970|2.2|2.2||22||1000|CRIPTÔNIO, LÍQUIDO REFRIGERADO
1971|2.1|2.1||23||333|METANO, COMPRIMIDO, ou GÁS NATURAL, COMPRIMIDO, com elevado teor de metano
1972|2.1|2.1||223||333|METANO, LÍQUIDO REFRIGERADO, ou GÁS NATURAL, LÍQUIDO REFRIGERADO, com alto teor de metano
1973|2.2|2.2||20||1000|MISTURA DE CLORODIFLUORMETANO E CLOROPENTA-FLUORETANO com PE fixo, contendo cerca de 49%
1974|2.2|2.2||20||1000|CLORODIFLUORBROMOMETANO (GÁS REFRIGERANTE R 12B1)
1975|2.3|2.3|5.1 8|265||20|MISTURA DE ÓXIDO NÍTRICO E TETRÓXIDO DE DINITROGÊNIO (MISTURA DE ÓXIDO NÍTRICO E DIÓXIDO DE NITROGÊNIO)
1976|2.2|2.2||20||1000|OCTAFLUORCICLOBUTANO (GÁS REFRIGERANTE RC 318)
1977|2.2|2.2||22||1000|NITROGÊNIO, LÍQUIDO REFRIGERADO
1978|2.1|2.1||23||333|PROPANO
1982|2.2|2.2||20||1000|TETRAFLUORMETANO (GÁS REFRIGERANTE R 14)
1983|2.2|2.2||20||1000|1-CLORO-2,2,2-TRIFLUORETANO (GÁS REFRIGERANTE R 133 a)
1984|2.2|2.2||20||1000|TRIFLUORMETANO (GÁS REFRIGERANTE R 23)
1986|3|3|6.1|336 36|I II III|20|ÁLCOOIS, INFLAMÁVEIS, TÓXICOS, N.E.
1987|3|3||33 30|II III|333|ÁLCOOIS, N.E.
1988|3|3|6.1|336 36|I II III|20|ALDEÍDOS, INFLAMÁVEIS, TÓXICOS, N.E.
1989|3|3||33 30 50|I II III|20|ALDEÍDOS, N.E.
1990|9|9||90|III|1000|BENZALDEÍDO
1991|3|3|6.1|336|I|20|CLOROPRENO, ESTABILIZADO
1992|3|3|6.1|336 36|I II III|20|LÍQUIDO INFLAMÁVEL, TÓXICO, N.E.
1993|3|3||33 30|I II III|20|LÍQUIDO INFLAMÁVEL, N.E.
1994|6.1|6.1|3|663|I|20|FERROPENTACARBONILA
1999|3|3||33 30|II III|333|ALCATRÕES LÍQUIDOS, inclusive asfalto, óleos, betumes e cut backs rodoviários
2000|4.1|4.1||40|III|1000|CELULÓIDE, em blocos, barras, cilindros, folhas, tubos etc, exceto refugos
2001|4.1|4.1||40|III|1000|NAFTENATOS DE COBALTO, EM PÓ
2002|4.2|4.2||40|III|1000|CELULÓIDE, REFUGOS
2004|4.2|4.2||40|II|333|MAGNESIODIAMIDA
2006|4.2|4.2||40|III|1000|PLÁSTICOS, À BASE DE NITROCELULOSE, SUJEITOS A AUTOAQUECIMENTO, N.E.
2008|4.2|4.2||43 40|I II III|Z|ZIRCÔNIO EM PÓ, SECO
2009|4.2|4.2||40 51|III|1000|ZIRCÔNIO, SECO, chapas acabadas, tiras ou bobinas de arame
2010|4.3|4.3||X423|I|20|HIDRETO DE MAGNÉSIO
2011|4.3|4.3|6.1|X462|I|20|FOSFETO DE MAGNÉSIO
2012|4.3|4.3|6.1|X462|I|20|FOSFETO DE POTÁSSIO
2013|4.3|4.3|6.1|X462|I|20|FOSFETO DE ESTRÔNCIO
2014|5.1|5.1|8|58|II|333|PERÓXIDO DE HIDROGÊNIO, SOLUÇÃO AQUOSA, com não menos de 20%, porém não mais que 60% de peróxido
2015|5.1|5.1|8|559|I|20|PERÓXIDO DE HIDROGÊNIO, ESTABILIZADO ou PERÓXIDO DE HIDROGÊNIO, SOLUÇÃO AQUOSA, ESTABILIZADA, com mais de 60%…
2016|6.1|6.1||60||333|MUNIÇÃO TÓXICA, NÃO-EXPLOSIVA, sem ruptor ou carga ejetora, sem espoleta
2017|6.1|6.1|8|68||333|MUNIÇÃO LACRIMOGÊNEA, NÃO-EXPLOSIVA, sem ruptor ou carga ejetora, sem espoleta
2018|6.1|6.1||60|II|333|CLOROANILINAS, SÓLIDAS
2019|6.1|6.1||60|II|333|CLOROANILINAS, LÍQUIDAS
2020|6.1|6.1||60|III|333|CLOROFENÓIS, SÓLIDOS
2021|6.1|6.1||60|III|333|CLOROFENÓIS, LÍQUIDOS
2022|6.1|6.1|8|68|II|333|ÁCIDO CRESÍLICO
2023|6.1|6.1|3|63|II|333|EPICLORIDRINA
2024|6.1|6.1||66 60|I II III|20|MERCÚRIO COMPOSTO, LÍQUIDO, N.E.
2025|6.1|6.1||66 60|I II III|20|MERCÚRIO COMPOSTO, SÓLIDO, N.E.
2026|6.1|6.1||66 60 52|I II|20|FENILMERCÚRIO COMPOSTO, N.E.
2027|6.1|6.1||60|II|333|ARSENITO DE SÓDIO, SÓLIDO
2028|8|8||80|II|333|BOMBAS, FUMÍGENAS, NÃO-EXPLOSIVAS, com líquido corrosivo, sem dispositivo iniciador
2029|8|8|3 6.1|886|I|20|HIDRAZINA, ANIDRA
2030|8|8|6.1|886 86|I II III|20|HIDRAZINA SOLUÇÃO AQUOSA com mais de 37% de hidrazina, em massa
2031|8|8|5.1|885 85 80|I II|20|ÁCIDO NÍTRICO, exceto vermelho fumegante, com mais de 70% de ácido nítrico ÁCIDO NÍTRICO, exceto vermelho…
2032|8|8|5.1 6.1|856|I|20|ÁCIDO NÍTRICO, VERMELHO FUMEGANTE
2033|8|8||80|II|333|MONÓXIDO DE POTÁSSIO
2034|2.1|2.1||23||333|MISTURA DE HIDROGÊNIO E METANO, COMPRIMIDA
2035|2.1|2.1||23||333|1,1,1-TRIFLUORETANO (GÁS REFRIGERANTE R 143 a)
2036|2.2|2.2||20||1000|XENÔNIO
2037|2|2||||V|GÁS EM PEQUENOS RECIPIENTES (CARTUCHOS DE GÁS), não-recarregáveis, sem difusor
2038|6.1|6.1||60|II|333|DINITROTOLUENOS, LÍQUIDOS
2044|2.1|2.1||23||333|2,2-DIMETILPROPANO
2045|3|3||33|II|333|ISOBUTIRALDEÍDO (ALDEÍDO ISOBUTÍLICO)
2046|3|3||30|III|1000|CIMENOS
2047|3|3||33 30|II III|333|DICLOROPROPENOS
2048|3|3||30|III|1000|DICICLOPENTADIENO
2049|3|3||30 53|III|1000|DIETILBENZENO
2050|3|3||33|II|333|DIISOBUTILENO, COMPOSTOS ISOMÉRICOS
2051|8|8|3|83|II|333|2-DIMETILAMINOETANOL
2052|3|3||30|III|1000|DIPENTENO
2053|3|3||30|III|1000|METILISOBUTILCARBINOL
2054|8|8|3|883|I|20|MORFOLINA
2055|3|3||39|III|1000|ESTIRENO MONÔMERO, ESTABILIZADO
2056|3|3||33|II|333|TETRA-HIDROFURANO
2057|3|3||33 30|II III|333|TRIPROPILENO
2058|3|3||33|II|333|VALERALDEÍDO
2059|3|3||33 30|I II III|20|NITROCELULOSE SOLUÇÃO, INFLAMÁVEL, com até 12,6% de nitrogênio, em massa, e até 55% de nitrocelulose
2067|5.1|5.1||50|III|1000|NITRATO DE AMÔNIO, FERTILIZANTES
2071||||||N|NITRATO DE AMÔNIO, FERTILIZANTES
2073|2.2|2.2||20||1000|AMÔNIA SOLUÇÃO aquosa, com densidade relativa inferior a 0,880 a 15ºC, com mais de 35% e até 50% de amônia
2074|6.1|6.1||60|III|333|ACRILAMIDA, SÓLIDA
2075|6.1|6.1||69|II|333|CLORAL, ANIDRO, ESTABILIZADO
2076|6.1|6.1|8|68|II|333|CRESÓIS, LÍQUIDOS
2077|6.1|6.1||60|III|333|alfa-NAFTILAMINA
2078|6.1|6.1||60 54|II|333|DIISOCIANATO DE TOLUENO
2079|8|8||80|II|333|DIETILENOTRIAMINA
2186|2.3|2.3|8|268||Z|CLORETO DE HIDROGÊNIO, LÍQUIDO REFRIGERADO
2187|2.2|2.2||22||1000|DIÓXIDO DE CARBONO, LÍQUIDO REFRIGERADO
2188|2.3|2.3|2.1|263||20|ARSINA
2189|2.3|2.3|2.1 8|263||20|DICLOROSSILANO
2190|2.3|2.3|5.1 8|265||20|DIFLUORETO DE OXIGÊNIO, COMPRIMIDO
2191|2.3|2.3||26||20|FLUORETO DE SULFURILA
2192|2.3|2.3|2.1|263||20|GERMÂNIO
2193|2.2|2.2||20||1000|HEXAFLUORETANO (GÁS REFRIGERANTE R 116)
2194|2.3|2.3|8|268||20|HEXAFLUORETO DE SELÊNIO
2195|2.3|2.3|8|268||20|HEXAFLUORETO DE TELÚRIO
2196|2.3|2.3|8|268||20|HEXAFLUORETO DE TUNGSTÊNIO
2197|2.3|2.3|8|268||20|IODETO DE HIDROGÊNIO, ANIDRO
2198|2.3|2.3|8|268||20|PENTAFLUORETO DE FÓSFORO
2199|2.3|2.3|2.1|263||20|FOSFINA
2200|2.1|2.1||239||333|PROPADIENO, ESTABILIZADO
2201|2.2|2.2|5.1|225||1000|ÓXIDO NITROSO, LÍQUIDO REFRIGERADO
2202|2.3|2.3|2.1|263||20|SELENIETO DE HIDROGÊNIO, ANIDRO
2203|2.1|2.1||23||333|SILANO
2204|2.3|2.3|2.1|263||20|SULFETO DE CARBONILA
2205|6.1|6.1||60|III|333|ADIPONITRILA
2206|6.1|6.1||60|II III|333|ISOCIANATOS, TÓXICOS, N.E. ou SOLUÇÃO DE ISOCIANATOS, TÓXICA, N.E.
2208|5.1|5.1||50|III|1000|MISTURA DE HIPOCLORITO DE CÁLCIO, SECA, com mais de 10% e até 39% de cloro livre
2209|8|8||80|III|1000|FORMALDEÍDO SOLUÇÃO com no mínimo 25% de formaldeído
2210|4.2|4.2|4.3|40|III|1000|MANEB ou PREPARAÇÃO DE MANEB com 60% ou mais de maneb
2211|9|9||90|III|1000|POLÍMEROS GRANULADOS, EXPANSÍVEIS, que desprendem vapores inflamáveis
2212|9|9||90|II|333|AMIANTOS, ANFIBÓLICO (amosita, tremolita, actinólito antofilita, crocidolita)
2213|4.1|4.1||40|III|1000|PARAFORMALDEÍDO
2214|8|8||80 55|III|1000|ANIDRIDO FTÁLICO com mais de 0,05% de anidrido maléico
2215|8|8||80|III|Z|ANIDRIDO MALÉICO ANIDRIDO MALÉICO, FUNDIDO
2216||||||N|FARINHA DE PEIXE (RESTOS DE PEIXE), ESTABILIZADA
2217|4.2|4.2||40|III|1000|TORTA OLEAGINOSA com até 1,5% de óleo e até 11% de umidade
2218|8|8|3|839|II|333|ÁCIDO ACRÍLICO, ESTABILIZADO
2219|3|3||30|III|1000|ÉTER ALILGLICIDÍLICO
2222|3|3||30|III|1000|ANISOL
2224|6.1|6.1||60|II|333|BENZONITRILA
2225|8|8||80|III|1000|CLORETO DE BENZENOSSULFONILA
2226|8|8||80|II|333|BENZOTRICLORETO
2227|3|3||39|III|1000|METACRILATO DE n-BUTILA, ESTABILIZADO
2232|6.1|6.1||66|I|20|2-CLOROETANAL
2233|6.1|6.1||60|III|333|CLOROANISIDINAS
2234|3|3||30|III|1000|TRIFLUORETO(S) DE CLOROBENZILA
2235|6.1|6.1||60|III|333|CLORETO(S) DE CLOROBENZILA, LÍQUIDOS
2236|6.1|6.1||60|II|333|ISOCIANATO DE 3-CLORO-4-MEILFENILA, LÍQUIDO
2237|6.1|6.1||60|III|333|CLORONITROANILINAS
2238|3|3||30|III|1000|CLOROTOLUENOS
2239|6.1|6.1||60|III|333|CLOROTOLUIDINAS, SÓLIDAS
2240|8|8||88 56|I|20|ÁCIDO CROMOSSULFÚRICO
2241|3|3||33|II|333|CICLO HEPTANO
2242|3|3||33|II|333|CICLO HEPTENO
2243|3|3||30|III|1000|ACETATO DE CICLO HEXILA
2244|3|3||30|III|1000|CICLOPENTANOL
2245|3|3||30|III|1000|CICLOPENTANONA
2246|3|3||33|II|333|CICLOPENTENO
2247|3|3||30|III|1000|n-DECANO
2248|8|8|3|83|II|333|DI-n-BUTILAMINA
2249|6.1|6.1|3|663|I|20|ÉTER DICLORODIMETÍLICO, SIMÉTRICO
2250|6.1|6.1||60|II|333|ISOCIANATO(S) DE DICLOROFENILA
2251|3|3||339|II|333|BICICLO [2.2.1]HEPTA-2,5-DIENO, ESTABILIZADO (2,5-NORBONADIENO, ESTABILIZADO)
2252|3|3||33|II|333|1,2-DIMETOXIETANO
2253|6.1|6.1||60|II|333|N,N-DIMETILANILINA
2254|4.1|4.1||40|III|I|FÓSFOROS, QUE SE CONSERVAM ACESOS AO VENTO
2256|3|3||33|II|333|CICLO HEXENO
2257|4.3|4.3||X423|I|20|POTÁSSIO
2258|8|8|3|83|II|333|1,2-PROPILENODIAMINA
2259|8|8||80|II|333|TRIETILENOTETRAMINA
2260|3|3|8|38|III|1000|TRIPROPILAMINA
2261|6.1|6.1||60|II|333|XILENÓIS, SÓLIDOS
2262|8|8||80|II|333|CLORETO DE DIMETILCARBAMOÍLA
2263|3|3||33|II|333|DIMETILCICLO HEXANOS
2264|8|8|3|83|II|333|N,N-DIMETILCICLO HEXILAMINA
2265|3|3||30 57|III|1000|N,N-DIMETILFORMAMIDA
2266|3|3|8|338|II|333|DIMETIL-N-PROPILAMINA
2267|6.1|6.1|8|68|II|333|CLORETO DE DIMETILTIOFOSFORILA
2269|8|8||80|III|1000|3,3' IMINODIPROPILAMINA
2270|3|3|8|338|II|333|ETILAMINA, SOLUÇÃO AQUOSA, com não menos que 50% e não mais que 70% de etilamina
2271|3|3||30|III|1000|ETILAMILCETONA
2272|6.1|6.1||60|III|333|N-ETILANILINA
2273|6.1|6.1||60|III|333|2-ETILANILINA
2274|6.1|6.1||60|III|333|N-ETIL-N-BENZILANILINA
2275|3|3||30|III|1000|2-ETILBUTANOL
2276|3|3|8|38|III|1000|2-ETIL HEXILAMINA
2277|3|3||339|II|333|METACRILATO DE ETILA, ESTABILIZADO
2278|3|3||33|II|333|n-HEPTENO
2279|6.1|6.1||60|III|333|HEXACLOROBUTADIENO
2280|8|8||80|III|1000|HEXAMETILENODIAMINA, SÓLIDA
2281|6.1|6.1||60|II|333|DIISOCIANATO DE HEXAMETILENO
2282|3|3||30|III|1000|HEXANÓIS
2283|3|3||39|III|1000|METACRILATO DE ISOBUTILA, ESTABILIZADO
2284|3|3|6.1|336|II|333|ISOBUTIRONITRILA
2285|6.1|6.1|3|63|II|333|TRIFLUORETO(S) DE ISOBENZOCIANATO
2286|3|3||30 58|III|1000|PENTAMETIL-HEPTANO
2287|3|3||33|II|333|ISO-HEPTENOS
2288|3|3||33|II|333|ISO-HEXENOS
2289|8|8||80|III|1000|ISOFORONADIAMINA
2290|6.1|6.1||60|III|333|DIISOCIANATO DE ISOFORONA
2291|6.1|6.1||60|III|333|CHUMBO COMPOSTO, SOLÚVEL, N.E.
2293|3|3||30|III|1000|4-METÓXI-4-METILPENTAN-2-ONA
2294|6.1|6.1||60|III|333|N-METILANILINA
2295|6.1|6.1|3|663|I|20|CLOROACETATO DE METILA
2296|3|3||33|II|333|METILCICLO-HEXANO
2297|3|3||30|III|1000|METILCICLO-HEXANONA
2298|3|3||33|II|333|METILCICLOPENTANO
2299|6.1|6.1||60|III|333|DICLOROACETATO DE METILA
2300|6.1|6.1||60|III|333|2-METIL-5-ETILPIRIDINA
2301|3|3||33|II|333|2-METILFURANO
2302|3|3||30|III|1000|5-METIL-HEXAN-2-ONA
2303|3|3||30|III|1000|ISOPROPENILBENZENO
2304|4.1|4.1||44|III|1000|NAFTALENO, FUNDIDO
2305|8|8||80|II|333|ÁCIDO NITROBENZENOSSULFÔNICO
2306|6.1|6.1||60|II|333|TRIFLUORETOS DE NITROBENZENO, LÍQUIDO
2307|6.1|6.1||60|II|333|TRIFLUORETO DE 3-NITRO-4-CLOROBENZENO
2308|8|8||X80 59|II|333|ÁCIDO NITROSILSULFÚRICO, LÍQUIDO
2309|3|3||33|II|333|OCTADIENO
2310|3|3|6.1|36|III|1000|PENTANO-2,4-DIONA
2311|6.1|6.1||60|III|333|FENETIDINAS
2312|6.1|6.1||60|II|Z|FENOL, FUNDIDO
2313|3|3||30|III|1000|PICOLINAS
2315|9|9||90|II|Z|BIFENILAS POLICLORADAS, LÍQUIDAS
2316|6.1|6.1||66|I|20|CUPROCIANETO DE SÓDIO, SÓLIDO
2317|6.1|6.1||66|I|20|CUPROCIANETO DE SÓDIO SOLUÇÃO
2318|4.2|4.2||40|II|333|HIDROSSULFETO DE SÓDIO com menos de 25% de água de cristalização
2319|3|3||30|III|1000|HIDROCARBONETOS TERPÊNICOS, N.E.
2320|8|8||80|III|1000|TETRAETILENOPENTAMINA
2321|6.1|6.1||60|III|333|TRICLOROBENZENOS, LÍQUIDOS
2322|6.1|6.1||60|II|333|TRICLOROBUTENO
2323|3|3||30|III|1000|FOSFITO DE TRIETILA
2324|3|3||30|III|1000|TRIISOBUTILENO
2325|3|3||30|III|1000|1,3,5-TRIMETILBENZENO
2326|8|8||80|III|1000|TRIMETILCICLO-HEXILAMINA
2327|8|8||80|III|1000|TRIMETIL-HEXAMETILENODIAMINAS
2328|6.1|6.1||60|III|333|DIISOCIANATO DE TRIMETIL-HEXAMETILENO
2329|3|3||30 60|III|1000|FOSFITO DE TRIMETILA
2330|3|3||30|III|1000|UNDECANO
2331|8|8||80|III|1000|CLORETO DE ZINCO, ANIDRO
2332|3|3||30|III|1000|ACETALDEÍDO OXIMA
2333|3|3|6.1|336|II|333|ACETATO DE ALILA
2334|6.1|6.1|3|663|I|20|ALILAMINA
2335|3|3|6.1|336|II|333|ÉTER ALILETÍLICO
2336|3|3|6.1|336|I|20|FORMIATO DE ALILA
2337|6.1|6.1|3|663|I|20|FENILMERCAPTANA
2338|3|3||33|II|333|BENZOTRIFLUORETO
2339|3|3||33|II|333|2-BROMOBUTANO
2340|3|3||33|II|333|ÉTER 2-BROMOETILETÍLICO
2341|3|3||30|III|1000|1-BROMO-3-METILBUTANO
2342|3|3||33|II|333|BROMOMETILPROPANOS
2343|3|3||33|II|333|2-BROMOPENTANO
2344|3|3||33 30|II III|333|BROMOPROPANOS
2345|3|3||33|II|333|3-BROMOPROPINO
2346|3|3||33|II|333|BUTANODIONA
2347|3|3||33|II|333|BUTILMERCAPTANA
2348|3|3||39|III|1000|ACRILATOS DE BUTILA, ESTABILIZADOS
2350|3|3||33|II|333|ÉTER BUTILMETÍLICO
2351|3|3||33 61|II|333|NITRITOS DE BUTILA
2352|3|3||339|II|333|ÉTER BUTILVINÍLICO, ESTABILIZADO
2353|3|3|8|338|II|333|CLORETO DE BUTIRILA
2354|3|3|6.1|336|II|333|ÉTER CLOROMETILETÍLICO
2356|3|3||33|I|20|2-CLOROPROPANO
2357|8|8|3|83|II|333|CICLO HEXILAMINA
2358|3|3||33|II|333|CICLOOCTATETRAENO
2359|3|3|6.1 8|338|II|333|DIALILAMINA
2360|3|3|6.1|336|II|333|ÉTER DIALÍLICO
2361|3|3|8|38|III|1000|DIISOBUTILAMINA
2362|3|3||33|II|333|1,1-DICLOROETANO
2363|3|3||33|I|20|ETILMERCAPTANA
2364|3|3||30|III|1000|n-PROPILBENZENO
2366|3|3||30|III|1000|CARBONATO DE DIETILA
2367|3|3||33|II|333|alfa-METILVALERALDEÍDO
2368|3|3||30|III|1000|alfa-PINENO
2370|3|3||33|II|333|1-HEXENO
2371|3|3||33|I|20|ISOPENTENOS
2372|3|3||33|II|333|1,2-DI-(DIMETILAMINO) ETANO
2373|3|3||33|II|333|DIETOXIMETANO
2374|3|3||33|II|333|3,3-DIETOXIPROPENO
2375|3|3||33|II|333|SULFETO DE DIETILA
2376|3|3||33 62|II|333|2,3-DI-HIDROPIRANO
2377|3|3||33|II|333|1,1-DIMETOXIETANO
2378|3|3|6.1|336|II|333|2-DIMETILAMINOACETONITRILA
2379|3|3|8|338|II|333|1,3-DIMETILBUTILAMINA
2380|3|3||33|II|333|DIMETILDIETOXISSILANO
2381|3|3|6.1|336|II|333|DISSULFETO DE DIMETILA
2382|6.1|6.1|3|663|I|20|DIMETIL-HIDRAZINA, SIMÉTRICA
2383|3|3|8|338|II|333|DIPROPILAMINA
2384|3|3||33|II|333|ÉTER DI-n-PROPÍLICO
2385|3|3||33|II|333|ISOBUTIRATO DE ETILA
2386|3|3|8|338|II|333|1-ETILPIPERIDINA
2387|3|3||33|II|333|FLUORBENZENO
2388|3|3||33|II|333|FLUORTOLUENOS
2389|3|3||33|I|20|FURANO
2390|3|3||33|II|333|2-IODOBUTANO
2391|3|3||33|II|333|IODOMETILPROPANOS
2392|3|3||30|III|1000|IODOPROPANOS
2393|3|3||33|II|333|FORMIATO DE ISOBUTILA
2394|3|3||30|III|1000|PROPIONATO DE ISOBUTILA
2395|3|3|8|338|II|333|CLORETO DE ISOBUTIRILA
2396|3|3|6.1|336|II|333|METACRILALDEÍDO, ESTABILIZADO
2397|3|3||33|II|333|3-METILBUTAN-2-ONA
2398|3|3||33|II|333|ÉTER METIL-t-BUTÍLICO
2399|3|3|8|338|II|333|1-METILPIPERIDINA
2400|3|3||33 63|II|333|ISOVALERATO DE METILA
2401|8|8|3|883|I|20|PIPERIDINA
2402|3|3||33|II|333|PROPANOTIÓIS
2403|3|3||33|II|333|ACETATO DE ISOPROPENILA
2404|3|3|6.1|336|II|333|PROPIONITRILA
2405|3|3||30|III|1000|BUTIRATO DE ISOPROPILA
2406|3|3||33|II|333|ISOBUTIRATO DE ISOPROPILA
2407|6.1|6.1|3 8|663|I|20|CLOROFORMIATO DE ISOPROPILA
2409|3|3||33|II|333|PROPIONATO DE ISOPROPILA
2410|3|3||33|II|333|1,2,3,6-TETRA-HIDROPIRIDINA
2411|3|3|6.1|336|II|333|BUTIRONITRILA
2412|3|3||33|II|333|TETRA-HIDROTIOFENO
2413|3|3||30|III|1000|ORTOTITANATO DE TETRAPROPILA
2414|3|3||33|II|333|TIOFENO
2416|3|3||33|II|333|BORATO DE TRIMETILA
2417|2.3|2.3|8|268||20|FLUORETO DE CARBONILA
2418|2.3|2.3|8|||20|TETRAFLUORETO DE ENXOFRE
2419|2.1|2.1||23||333|BROMOTRIFLUORETILENO
2420|2.3|2.3|8|268||20|HEXAFLUORACETONA
2421|2.3|2.3|5.1 8|265||Z|TRIÓXIDO DE NITROGÊNIO
2422|2.2|2.2||20||1000|OCTAFLUORBUT-2-ENO (GÁS REFRIGERANTE R 1318)
2424|2.2|2.2||20||1000|OCTAFLUORPROPANO (GÁS REFRIGERANTE R 218)
2426|5.1|5.1||59||Z|NITRATO DE AMÔNIO, LÍQUIDO (solução concentrada por aquecimento)
2427|5.1|5.1||50|II III|333|CLORATO DE POTÁSSIO, SOLUÇÃO AQUOSA
2428|5.1|5.1||50|II III|333|CLORATO DE SÓDIO, SOLUÇÃO AQUOSA
2429|5.1|5.1||50 64|II|333|CLORATO DE CÁLCIO, SOLUÇÃO AQUOSA
2430|8|8||88 80|I II III|20|ALQUILFENÓIS, SÓLIDOS, N.E. (incluindo os homólogos C2-C12)
2431|6.1|6.1||60|III|333|ANISIDINAS
2432|6.1|6.1||60|III|333|N,N-DIETILANILINA
2433|6.1|6.1||60|III|333|CLORONITROTOLUENOS, LÍQUIDOS
2434|8|8||X80|II|333|DIBENZILDICLOROSSILANO
2435|8|8||X80|II|333|ETILFENILDICLOROSSILANO
2436|3|3||33|II|333|ÁCIDO TIOACÉTICO
2437|8|8||X80|II|333|METILFENILDICLOROSSILANO
2438|6.1|6.1|3 8|663|I|20|CLORETO DE TRIMETILACETILA
2439|8|8||80|II|333|HIDROGENODIFLUORETO DE SÓDIO
2440|8|8||80|III|1000|CLORETO ESTÂNICO, PENTAHIDRATADO
2441|4.2|4.2|8|48|I|Z|TRICLORETO DE TITÂNIO, PIROFÓRICO ou MISTURA DE TRICLORETO DE TITÂNIO, PIROFÓRICA
2442|8|8||X80|II|333|CLORETO DE TRICLOROACETILA
2443|8|8||80|II|333|OXITRICLORETO DE VANÁDIO
2444|8|8||X88|I|20|TETRACLORETO DE VANÁDIO
2446|6.1|6.1||60|III|333|NITROCRESÓIS, SÓLIDO
2447|4.2|4.2|6.1|446|I|Z|FÓSFORO, BRANCO, FUNDIDO
2448|4.1|4.1||44|III|1000|ENXOFRE, FUNDIDO
2451|2.2|2.2|5.1|25||1000|TRIFLUORETO DE NITROGÊNIO
2452|2.1|2.1||239 65||333|ETILACETILENO, ESTABILIZADO
2453|2.1|2.1||23||333|FLUORETO DE ETILA (GÁS REGRIGERANTE R 161)
2454|2.1|2.1||23||333|FLUORETO DE METILA (GÁS REFRIGERANTE R 41)
2455|2.2|2.2||20||Z|NITRITO DE METILA
2456|3|3||33|I|20|2-CLOROPROPENO
2457|3|3||33|II|333|2,3-DIMETILBUTANO
2458|3|3||33|II|333|HEXADIENO
2459|3|3||33|I|20|2-METIL-1-BUTENO
2460|3|3||33|II|333|2-METIL-2-BUTENO
2461|3|3||33|II|333|METILPENTADIENO
2463|4.3|4.3||X423|I|20|HIDRETO DE ALUMÍNIO
2464|5.1|5.1|6.1|56|II|333|NITRATO DE BERÍLIO
2465|5.1|5.1||50|II|333|ÁCIDO DICLOROISOCIANÚRICO, SECO, ou SAIS DE ÁCIDO DICLOROISOCIANÚRICO
2466|5.1|5.1||55|I|20|SUPERÓXIDO DE POTÁSSIO
2468|5.1|5.1||50|II|333|ÁCIDO TRICLOROISOCIANÚRICO, SECO
2469|5.1|5.1||50|III|1000|BROMATO DE ZINCO
2470|6.1|6.1||60|III|333|FENILACETONITRILA, LÍQUIDA
2471|6.1|6.1||66|I|20|TETRÓXIDO DE ÓSMIO
2473|6.1|6.1||60|III|333|ARSANILATO DE SÓDIO
2474|6.1|6.1||66|I|333|TIOFOSGÊNIO
2475|8|8||80|III|1000|TRICLORETO DE VANÁDIO
2477|6.1|6.1|3|663|I|20|ISOTIOCIANATO DE METILA
2478|3|3|6.1|336 36|II III|333|ISOCIANATOS, INFLAMÁVEIS, TÓXICOS, N.E. ou SOLUÇÃO DE ISOCIANATOS, INFLAMÁVEL, TÓXICA,…
2480|6.1|6.1|3|663|I|20|ISOCIANATO DE METILA
2481|6.1|6.1|3|663 66|I|20|ISOCIANATO DE ETILA
2482|6.1|6.1|3|663|I|20|ISOCIANATO DE n-PROPILA
2483|6.1|6.1|3|663|I|20|ISOCIANATO DE ISOPROPILA
2484|6.1|6.1|3|663|I|20|ISOCIANATO DE t-BUTILA
2485|6.1|6.1|3|663|I|20|ISOCIANATO DE n-BUTILA
2486|6.1|6.1|3|663|I|333|ISOCIANATO DE ISOBUTILA
2487|6.1|6.1|3|663|I|20|ISOCIANATO DE FENILA
2488|6.1|6.1|3|663|I|20|ISOCIANATO DE CICLO-HEXILA
2490|6.1|6.1||60|II|333|ÉTER DICLOROISOPROPÍLICO
2491|8|8||80|III|1000|ETANOLAMINA ou SOLUÇÃO DE ETANOLAMINA
2493|3|3|8|338|II|333|HEXAMETILENOIMINA
2495|5.1|5.1|6.1 8|568|I|20|PENTAFLUORETO DE IODO
2496|8|8||80|III|1000|ANIDRIDRO PROPIÔNICO
2498|3|3||30|III|1000|1,2,3,6-TETRA-HIDROBENZALDEÍDO
2501|6.1|6.1||60|II III|333|ÓXIDO DE TRIS-(1-AZIRIDINIL) FOSFINA, SOLUÇÃO
2502|8|8|3|83|II|333|CLORETO DE VALERILA
2503|8|8||80|III|1000|TETRACLORETO DE ZIRCÔNIO
2504|6.1|6.1||60 67|III|333|TETRABROMOETANO
2505|6.1|6.1||60|III|333|FLUORETO DE AMÔNIO
2506|8|8||80|II|333|HIDROGENOSSULFATO DE AMÔNIO
2507|8|8||80|III|1000|ÁCIDO CLOROPLATÍNICO, SÓLIDO
2508|8|8||80|III|1000|PENTACLORETO DE MOLIBDÊNIO
2509|8|8||80|II|333|HIDROGENOSSULFATO DE POTÁSSIO
2511|8|8||80|III|1000|ÁCIDO 2-CLOROPROPIÔNICO
2512|6.1|6.1||60|III|333|AMINOFENÓIS (o-,m-,p-)
2513|8|8||X80|II|333|BROMETO DE BROMOACETILA
2514|3|3||30|III|1000|BROMOBENZENO
2515|6.1|6.1||60|III|333|BROMOFÓRMIO
2516|6.1|6.1||60|III|333|TETRABROMETO DE CARBONO
2517|2.1|2.1||23||333|1-CLORO-1,1-DIFLUORETANO (GÁS REFRIGERANTE R 142 b)
2518|6.1|6.1||60|III|333|1,5,9-CICLODODECATRIENO
2520|3|3||30|III|1000|CICLOOCTADIENOS
2521|6.1|6.1|3|663|I|20|DICETENO, ESTABILIZADO
2522|6.1|6.1||69|II|333|METACRILATO DE 2-DIMETILAMINOETILA, ESTABILIZADO
2524|3|3||30|III|1000|ORTOFORMIATO DE ETILA
2525|6.1|6.1||60|III|333|OXALATO DE ETILA
2526|3|3|8|38|III|1000|FURFURILAMINA
2527|3|3||39 68|III|1000|ACRILATO DE ISOBUTILA, ESTABILIZADO
2528|3|3||30|III|1000|ISOBUTIRATO DE ISOBUTILA
2529|3|3|8|38|III|1000|ÁCIDO ISOBUTÍRICO
2531|8|8||89|II|333|ÁCIDO METACRÍLICO, ESTABILIZADO
2533|6.1|6.1||60|III|333|TRICLOROACETATO DE METILA
2534|2.3|2.3|2.1 8|263||20|METILCLOROSSILANO
2535|3|3|8|338|II|333|4-METILMORFOLINA (N-METILMORFOLINA)
2536|3|3||33|II|333|METILTETRA-HIDROFURANO
2538|4.1|4.1||40|III|1000|NITRONAFTALENO
2541|3|3||30|III|1000|TERPINOLENO
2542|6.1|6.1||60|II|333|TRIBUTILAMINA
2545|4.2|4.2||43 40|I II III|Z|HÁFNIO EM PÓ, SECO
2546|4.2|4.2||43 40|I II III|Z|TITÂNIO EM PÓ, SECO
2547|5.1|5.1||55|I|20|SUPERÓXIDO DE SÓDIO
2548|2.3|2.3|5.1 8|265||20|PENTAFLUORETO DE CLORO
2552|6.1|6.1||60|II|333|HIDRATO DE HEXAFLUORACETONA, LÍQUIDO
2554|3|3||33|II|333|CLORETO DE METILALILA
2555|4.1|4.1||40|II|333|NITROCELULOSE, COM ÁGUA (no mínimo 25% de água, em massa)
2556|4.1|4.1||40 69|II|333|NITROCELULOSE COM ÁLCOOL (no mínimo 25% de álcool, em massa, e com até 12,6% de nitrogênio, por massa
2557|4.1|4.1||40|II|333|NITROCELULOSE, com até 12,6% de nitrogênio, por massa seca, MISTURA COM ou SEM PLASTIFICANTE, COM
2558|6.1|6.1|3|663|I|20|EPIBROMIDRINA
2560|3|3||30|III|1000|2-METILPENTAN-2-OL
2561|3|3||33|I|20|3-METIL-1-BUTENO
2564|8|8||80|II III|333|ÁCIDO TRICLOROACÉTICO SOLUÇÃO
2565|8|8||80|III|1000|DICICLO-HEXILAMINA
2567|6.1|6.1||60|II|333|PENTACLOROFENATO DE SÓDIO
2570|6.1|6.1||66 60|I II III|20|CÁDMIO COMPOSTO
2571|8|8||80|II|333|ÁCIDOS ALQUILSULFÚRICOS
2572|6.1|6.1||60|II|333|FENIL-HIDRAZINA
2573|5.1|5.1|6.1|56|II|333|CLORATO DE TÁLIO
2574|6.1|6.1||60|II|333|FOSFATO DE TRICRESILA com mais de 3% de isômero orto
2576|8|8||80|II|333|OXIBROMETO DE FÓSFORO, FUNDIDO
2577|8|8||80|II|333|CLORETO DE FENILACETILA
2578|8|8||80|III|1000|TRIÓXIDO DE FÓSFORO
2579|8|8||80|III|1000|PIPERAZINA
2580|8|8||80|III|1000|BROMETO DE ALUMÍNIO SOLUÇÃO
2581|8|8||80|III|1000|CLORETO DE ALUMÍNIO SOLUÇÃO
2582|8|8||80 70|III|1000|CLORETO FERRICO SOLUÇÃO
2583|8|8||80|II|333|ÁCIDOS ALQUILSULFÔNICOS, SÓLIDOS ou ÁCIDOS ARILSULFÔNICOS, SÓLIDOS, com mais de 5% de ácido
2584|8|8||80|II|333|ÁCIDOS ALQUILSULFÔNICOS, LÍQUIDOS ou ÁCIDOS ARILSULFÔNICOS, LÍQUIDOS, com mais de 5% de…
2585|8|8||80|III|1000|ÁCIDOS ALQUILSULFÔNICOS, SÓLIDOS ou ÁCIDOS ARILSULFÔNICOS, SÓLIDOS, com até 5% de ácido
2586|8|8||80|III|1000|ÁCIDOS ALQUILSULFÔNICOS, LÍQUIDOS ou ÁCIDOS ARILSULFÔNICOS, LÍQUIDOS, com até 5% de ácido
2587|6.1|6.1||60|II|333|BENZOQUINONA
2588|6.1|6.1||66 60|I II III|20|PESTICIDA, SÓLIDO, TÓXICO, N.E.
2589|6.1|6.1|3|63|II|333|CLOROACETATO DE VINILA
2590|9|9||90|III|1000|AMIANTOS, CRISOTILIA
2591|2.2|2.2||22||1000|XENÔNIO, LÍQUIDO REFRIGERADO
2599|2.2|2.2||20||1000|MISTURA AZEOTRÓPICA DE CLOROTRIFLUORMETANO E TRIFLUORMETANO, com aproximadamente 60%
2601|2.1|2.1||23||333|CICLOBUTANO
2602|2.2|2.2||20||1000|MISTURA AZEOTRÓPICA DE DICLORODIFLUORMETANO E DIFLUORETANO, com aproximadamente 74% de…
2603|3|3|6.1|336|II|333|CICLO-HEPTATRIENO
2604|8|8|3|883|I|20|DIETILETERATO DE TRIFLUORETO DE BORO
2605|6.1|6.1|3|663|I|20|ISOCIANATO DE METOXIMETILA
2606|6.1|6.1|3|663|I|20|ORTOSSILICATO DE METILA
2607|3|3||39|III|1000|ACROLEÍNA DIMERIZADA, ESTABILIZADA
2608|3|3||30|III|1000|NITROPROPANOS
2609|6.1|6.1||60|III|333|BORATO DE TRIALILA
2610|3|3|8|38 71|III|1000|TRIALILAMINA
2611|6.1|6.1|3|63|II|333|PROPILENOCLORIDRINA
2612|3|3||33|II|333|ÉTER METILPROPÍLICO
2614|3|3||30|III|1000|ÁLCOOL METALÍLICO
2615|3|3||33|II|333|ÉTER ETILPROPÍLICO
2616|3|3||33 30|II III|333|BORATO DE TRIISOPROPILA
2617|3|3||30|III|1000|METILCICLO-HEXANÓIS, inflamáveis
2618|3|3||39|III|1000|VINILTOLUENOS, ESTABILIZADOS
2619|8|8|3|83|II|333|BENZILDIMETILAMINA
2620|3|3||30|III|1000|BUTIRATOS DE AMILA
2621|3|3||30|III|1000|ACETILMETILCARBINOL
2622|3|3|6.1|336|II|333|GLICIDALDEÍDO
2623|4.1|4.1||40|III|I|ACENDEDORES, SÓLIDOS com líquido inflamável
2624|4.3|4.3||423|II|333|SILICIETO DE MAGNÉSIO
2626|5.1|5.1||50|II|333|ÁCIDO CLÓRICO, SOLUÇÃO AQUOSA, com até 10% de ácido clórico
2627|5.1|5.1||50|II|333|NITRITOS, INORGÂNICOS, N.E.
2628|6.1|6.1||66|I|20|FLUORACETATO DE POTÁSSIO
2629|6.1|6.1||66|I|20|FLUORACETATO DE SÓDIO
2630|6.1|6.1||66|I|20|SELENIATOS ou SELENITOS
2642|6.1|6.1||66|I|20|ÁCIDO FLUORACÉTICO
2643|6.1|6.1||60|II|333|BROMOACETATO DE METILA
2644|6.1|6.1||66 72|I|20|IODETO DE METILA
2645|6.1|6.1||60|II|333|BROMETO DE FENACILA
2646|6.1|6.1||66|I|20|HEXACLOROCICLOPENTADIENO
2647|6.1|6.1||60|II|333|MALONONITRILA
2648|6.1|6.1||60|II|333|1,2-DIBROMOBUTAN-3-ONA
2649|6.1|6.1||60|II|333|1,3-DICLOROACETONA
2650|6.1|6.1||60|II|333|1,1-DICLORO-1-NITROETANO
2651|6.1|6.1||60|III|333|4,4'-DIAMINODIFENILMETANO
2653|6.1|6.1||60|II|333|IODETO DE BENZILA
2655|6.1|6.1||60|III|333|FLUORSILICATO DE POTÁSSIO
2656|6.1|6.1||60|III|333|QUINOLINA
2657|6.1|6.1||60|II|333|DISSULFETO DE SELÊNIO
2659|6.1|6.1||60|III|333|CLOROACETATO DE SÓDIO
2660|6.1|6.1||60|III|333|NITROTOLUIDINAS (MONO)
2661|6.1|6.1||60|III|333|HEXACLOROACETONA
2664|6.1|6.1||60|III|333|DIBROMOMETANO
2667|6.1|6.1||60|III|333|BUTILTOLUENOS
2668|6.1|6.1|3|663|I|333|CLOROACETONITRILA
2669|6.1|6.1||60|II III|333|CLOROCRESÓIS SOLUÇÃO
2670|8|8||80 73|II|333|CLORETO CIANÚRICO
2671|6.1|6.1||60|II|333|AMINOPIRIDINAS (o-,m-,p-)
2672|8|8||80|III|1000|AMÔNIA SOLUÇÃO aquosa, com densidade relativa entre 0,880 e 0,957 a 15ºC, com mais de 10% e até 35% de…
2673|6.1|6.1||60|II|333|2-AMINO-4-CLOROFENOL
2674|6.1|6.1||60|III|333|FLUORSILICATO DE SÓDIO
2676|2.3|2.3|2.1|263||20|ESTIBINA
2677|8|8||80|II III|333|HIDRÓXIDO DE RUBÍDIO SOLUÇÃO
2678|8|8||80|II|333|HIDRÓXIDO DE RUBÍDIO
2679|8|8||80|II III|333|HIDRÓXIDO DE LÍTIO SOLUÇÃO
2680|8|8||80|II|333|HIDRÓXIDO DE LÍTIO
2681|8|8||80|II III|333|HIDRÓXIDO DE CÉSIO SOLUÇÃO
2682|8|8||80|II|333|HIDRÓXIDO DE CÉSIO
2683|8|8|3 6.1|836|II|333|SULFETO DE AMÔNIO SOLUÇÃO
2684|3|3|8|38|III|1000|3-DIETILAMINOPROPILAMINA
2685|8|8|3|83|II|333|N,N-DIETILETILENODIAMINA
2686|8|8|3|83|II|333|2-DIETILAMINOETANOL
2687|4.1|4.1||40|III|1000|NITRITO DE DICICLOHEXILAMÔNIO
2688|6.1|6.1||60|III|333|1-BROMO-3-CLOROPROPANO
2689|6.1|6.1||60|III|333|GLICEROL-alfa-MONOCLORIDRINA
2690|6.1|6.1||60 74|II|333|N,n-BUTILIMIDAZOL
2691|8|8||80|II|333|PENTABROMETO DE FÓSFORO
2692|8|8||X88|I|20|TRIBROMETO DE BORO
2693|8|8||80|III|1000|BISSULFITOS, SOLUÇÃO AQUOSA, N.E.
2698|8|8||80|III|1000|ANIDRIDOS TETRAHIDROFTÁLICOS, com mais de 0,05% de anidrido maléico
2699|8|8||88|I|20|ÁCIDO TRIFLUORACÉTICO
2705|8|8||80|II|333|1-PENTOL
2707|3|3||33 30|II III|333|DIMETILDIOXANAS
2709|3|3||30|III|1000|BUTILBENZENOS
2710|3|3||30|III|1000|DIPROPILCETONA
2713|6.1|6.1||60|III|333|ACRIDINA
2714|4.1|4.1||40|III|1000|RESINATO DE ZINCO
2715|4.1|4.1||40|III|1000|RESINATO DE ALUMÍNIO
2716|6.1|6.1||60|III|333|1,4-BUTINODIOL
2717|4.1|4.1||40|III|1000|CÂNFORA, sintética
2719|5.1|5.1|6.1|56|II|333|BROMATO DE BÁRIO
2720|5.1|5.1||50|III|1000|NITRATO DE CROMO
2721|5.1|5.1||50|II|333|CLORATO DE COBRE
2722|5.1|5.1||50|III|1000|NITRATO DE LÍTIO
2723|5.1|5.1||50|II|333|CLORATO DE MAGNÉSIO
2724|5.1|5.1||50 75|III|1000|NITRATO DE MANGANÊS
2725|5.1|5.1||50|III|1000|NITRATO DE NÍQUEL
2726|5.1|5.1||50|III|1000|NITRITO DE NÍQUEL
2727|6.1|6.1|5.1|65|II|333|NITRATO DE TÁLIO
2728|5.1|5.1||50|III|1000|NITRATO DE ZIRCÔNIO
2729|6.1|6.1||60|III|333|HEXACLOROBENZENO
2730|6.1|6.1||60|III|333|NITROANISÓIS, LÍQUIDOS
2732|6.1|6.1||60|III|333|NITROBROMOBENZENOS, LÍQUIDOS
2733|3|3|8|338 38|I II III|20|AMINAS, INFLAMÁVEIS, CORROSIVAS, N.E., ou POLIAMINAS, INFLAMÁVEIS, CORROSIVAS, N.E.
2734|8|8|3|883 83|I II|20|AMINAS, CORROSIVAS, INFLAMÁVEIS, LÍQUIDAS, N.E. ou POLIAMINAS, CORROSIVAS, INFLAMÁVEIS,…
2735|8|8||88 80|I II III|20|AMINAS, CORROSIVAS, LÍQUIDAS, N.E., ou POLIAMINAS, CORROSIVAS, LÍQUIDAS, N.E.
2738|6.1|6.1||60|II|333|N-BUTILANILINA
2739|8|8||80|III|1000|ANIDRIDO BUTÍRICO
2740|6.1|6.1|3 8|668|I|20|CLOROFORMIATO DE n-PROPILA
2741|5.1|5.1|6.1|56|II|333|HIPOCLORITO DE BÁRIO com mais de 22% de cloro livre
2742|6.1|6.1|3|638 76|II|333|CLOROFORMIATOS, TÓXICOS, CORROSIVOS, INFLAMÁVEIS, N.E.
2743|6.1|6.1|3 8|638|II|333|CLOROFORMIATO DE n-BUTILA
2744|6.1|6.1|3 8|638|II|333|CLOROFORMIATO DE CICLOBUTILA
2745|6.1|6.1|8|68|II|333|CLOROFORMIATO DE CLOROMETILA
2746|6.1|6.1|8|68|II|333|CLOROFORMIATO DE FENILA
2747|6.1|6.1||60|III|333|CLOROFORMIATO DE t-BUTILCICLO-HEXILA
2748|6.1|6.1|8|68|II|333|CLOROFORMIATO DE 2-ETILHEXILA
2749|3|3||33|I|20|TETRAMETILSILANO
2750|6.1|6.1||60|II|333|1,3-DICLOROPROPANOL-2
2751|8|8||80|II|333|CLORETO DE DIETILTIOFOSFORILA
2752|3|3||30|III|1000|1,2-EPÓXI-3-ETOXIPROPANO
2753|6.1|6.1||60|III|333|N-ETILBENZILTOLUIDINAS, LÍQUIDAS
2754|6.1|6.1||60|II|333|N-ETILTOLUIDINAS
2757|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE CARBAMATOS, SÓLIDO, TÓXICO
2758|3|3|6.1|336|I II|20|PESTICIDA À BASE DE CARBAMATOS, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2759|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE ARSÊNIO, SÓLIDO, TÓXICO
2760|3|3|6.1|336 77|I|20|PESTICIDA À BASE DE ARSÊNIO, INFLAMÁVEL, LÍQUIDO, TÓXICO, com PFg inferior a 23ºC
2761|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE ORGANOCLORADOS, SÓLIDO, TÓXICO
2762|3|3|6.1|336|I II|20|PESTICIDA À BASE DE ORGANOCLORADOS, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2763|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE TRIAZINA, SÓLIDO, TÓXICO
2764|3|3|6.1|336|I II|20|PESTICIDA À BASE DE TRIAZINA, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2771|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE TIOCARBAMATOS, SÓLIDO, TÓXICO
2772|3|3|6.1|336|I II|20|PESTICIDA À BASE DE TIOCARBAMATOS, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2775|6.1|6.1||66 60 78|I II III|20|PESTICIDA À BASE DE COBRE, SÓLIDO, TÓXICO
2776|3|3|6.1|336|I II|20|PESTICIDA À BASE DE COBRE, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2777|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE MERCÚRIO, SÓLIDO, TÓXICO
2778|3|3|6.1|336|I II|20|PESTICIDA À BASE DE MERCÚRIO, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2779|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE NITROFENOL SUBSTITUÍDO, SÓLIDO, TÓXICO
2780|3|3|6.1|336|I II|20|PESTICIDA À BASE DE NITROFENOL SUBSTITUÍDO, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a
2781|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE DIPIRIDÍLIO, SÓLIDO, TÓXICO
2782|3|3|6.1|336 79|I II|20|PESTICIDA À BASE DE DIPIRIDÍLIO, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2783|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE ORGANOFOSFORADOS, SÓLIDO, TÓXICO
2784|3|3|6.1|336|I II|20|PESTICIDA À BASE DE ORGANOFOSFORADOS, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2785|6.1|6.1||60|III|333|4-TIAPENTANAL
2786|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE ORGANOESTÂNICOS, SÓLIDOS, TÓXICOS
2787|3|3|6.1|336|I II|20|PESTICIDA À BASE DE ORGANOESTÂNICOS, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a 23ºC
2788|6.1|6.1||66 60|I II III|20|ESTANHO COMPOSTO ORGÂNICO, LÍQUIDO, N.E.
2789|8|8|3|83|II|333|ÁCIDO ACÉTICO, GLACIAL, ou ÁCIDO, ACÉTICO SOLUÇÃO, com mais de 80% de ácido, em massa
2790|8|8||80|II III|333|ÁCIDO ACÉTICO SOLUÇÃO, com não menos de 50% e até 80% de ácido em massa ÁCIDO ACÉTICO SOLUÇÃO, com mais de…
2793|4.2|4.2||40 80|III|1000|METAL FERROSO, LIMALHAS, LASCAS, CAVACOS ou APARAS, sob forma passível de autoaquecimento
2794|8|8||80||1000|BATERIAS elétricas, ÚMIDAS, CONTENDO ÁCIDO
2795|8|8||80||1000|BATERIAS elétricas, ÚMIDAS, CONTENDO ÁLCALIS
2796|8|8||80|II|333|ÁCIDO SULFÚRICO com até 51% de ácido, ou FLUIDO ÁCIDO PARA BATERIAS
2797|8|8||80|II|333|FLUIDO PARA BATERIAS, ALCALINO
2798|8|8||80|II|333|DICLORETO DE FOSFOROFENIL
2799|8|8||80|II|333|DITIOCLORETO DE FOSFOROFENIL
2800|8|8||80||1000|BATERIAS elétricas, ÚMIDAS, Á PROVA DE VAZAMENTO
2801|8|8||88 80|I II III|20|CORANTE, CORROSIVO, LÍQUIDO, N.E., ou INTERMEDIÁRIO PARA CORANTES, CORROSIVO, LÍQUIDO,…
2802|8|8||80|III|1000|CLORETO DE COBRE
2803|8|8||80|III|1000|GÁLIO
2805|4.3|4.3||423|II|333|HIDRETO DE LÍTIO, SÓLIDO FUNDIDO
2806|4.3|4.3||X423|I|20|NITRETO DE LÍTIO
2807||||||N|MATERIAL MAGNETIZADO
2809|8|8|6.1|86|III|1000|MERCÚRIO
2810|6.1|6.1||66 60|I II III|20|LÍQUIDO TÓXICO, ORGÂNICO, N.E.
2811|6.1|6.1||66 60|I II III|20|SÓLIDO TÓXICO, ORGÂNICO, N.E.
2812||||||N|ALUMINATO DE SÓDIO, SÓLIDO
2813|4.3|4.3||X423 423 81|I II|Z|SÓLIDO QUE REAGE COM ÁGUA, N.E.
2814|6.2|6.2||606||Z|SUBSTÂNCIA INFECTANTE, QUE AFETA SERES HUMANOS
2815|8|8|6.1|86|III|1000|N-AMINOETILPIPERAZINA
2817|8|8|6.1|86|II III|333|HIDROGENODIFLUORETO DE AMÔNIO SOLUÇÃO
2818|8|8|6.1|86|II III|333|POLISSULFETO DE AMÔNIO SOLUÇÃO
2819|8|8||80|III|1000|FOSFATO ÁCIDO DE AMILA
2820|8|8||80|III|1000|ÁCIDO BUTÍRICO
2821|6.1|6.1||60|II III|333|FENOL SOLUÇÃO
2822|6.1|6.1||60|II|333|2-CLOROPIRIDINA
2823|8|8||80|III|1000|ÁCIDO CROTÔNICO, SÓLIDO
2826|8|8|3|83|II|333|CLOROTIOFORMIATO DE ETILA
2829|8|8||80|III|1000|ÁCIDO CAPRÓICO
2830|4.3|4.3||423|II|333|LÍTIO-FERRO-SILÍCIO
2831|6.1|6.1||60|III|333|1,1,1-TRICLOROETANO
2834|8|8||80|III|1000|ÁCIDO FOSFOROSO
2835|4.3|4.3||423|II|333|HIDRETO DUPLO DE SÓDIO E ALUMÍNIO
2837|8|8||80 82|II III|333|BISSULFATOS, SOLUÇÃO AQUOSA
2838|3|3||339|II|333|BUTIRATO DE VINILA, ESTABILIZADO
2839|6.1|6.1||60|II|333|ALDOL
2840|3|3||30|III|1000|BUTIRALDOXIMA
2841|3|3|6.1|36|III|1000|DI-n-AMILAMINA
2842|3|3||30|III|1000|NITROETANO
2844|4.3|4.3||423|III|1000|CÁLCIO-MANGANÊS-SILÍCIO
2845|4.2|4.2||333|I|Z|LÍQUIDO PIROFÓRICO, ORGÂNICO, N.E.
2846|4.2|4.2||43|I|Z|SÓLIDO PIROFÓRICO, ORGÂNICO, N.E.
2849|6.1|6.1||60|III|333|3-CLOROPROPANOL-1
2850|3|3||30|III|1000|PROPILENO, TETRÂMERO
2851|8|8||80|II|333|DI-HIDRATO DE TRIFLUORETO DE BORO
2852|4.1|4.1||40|I|20|SULFETO DE DIPICRILA, UMEDECIDO com no mínimo 10% de água, em massa
2853|6.1|6.1||60|III|333|FLUORSILICATO DE MAGNÉSIO
2854|6.1|6.1||60|III|333|FLUORSILICATO DE AMÔNIO
2855|6.1|6.1||60|III|333|FLUORSILICATO DE ZINCO
2856|6.1|6.1||60|III|333|FLUORSILICATOS, N.E.
2857|2.2|2.2||20||1000|MÁQUINAS DE REFRIGERAÇÃO contendo gases, não-inflamáveis e não tóxicos, ou solução de amônia (Ver Nº ONU
2858|4.1|4.1||40|III|1000|ZIRCÔNIO, SECO, bobinas de arame, chapas metálicas acabadas, tiras (mais delgadas que 254 micra, mas com…
2859|6.1|6.1||60|II|333|METAVANADATO DE AMÔNIO
2861|6.1|6.1||60|II|333|POLIVANADATO DE AMÔNIO
2862|6.1|6.1||60|III|333|PENTÓXIDO DE VANÁDIO, não-fundido
2863|6.1|6.1||60 83|II|333|VANADATO DUPLO DE SÓDIO E AMÔNIO
2864|6.1|6.1||60|II|333|METAVANADATO DE POTÁSSIO
2865|8|8||80|III|1000|SULFATO DE HIDROXILAMINA
2869|8|8||80|II III|333|MISTURA DE TRICLORETO DE TITÂNIO
2870|4.2|4.2|4.3|X333|I|Z|BORO-HIDRETO DE ALUMÍNIO BORO-HIDRETO DE ALUMÍNIO, EM DISPOSITIVOS
2871|6.1|6.1||60|III|333|ANTIMÔNIO, EM PÓ
2872|6.1|6.1||60|II III|333|DIBROMOCLOROPROPANOS
2873|6.1|6.1||60|III|333|DIBUTILAMINOETANOL
2874|6.1|6.1||60|III|333|ÁLCOOL FURFURÍLICO
2875|6.1|6.1||60|III|333|HEXACLOROFENO
2876|6.1|6.1||60|III|333|RESORCINOL
2878|4.1|4.1||40|III|1000|TITÂNIO ESPONJOSO, GRÂNULOS ou TITÂNIO ESPONJOSO, EM PÓ
2879|8|8|6.1|X886|I|20|OXICLORETO DE SELÊNIO
2880|5.1|5.1||50|II III|333|HIPOCLORITO DE CÁLCIO, HIDRATADO, ou MISTURA DE HIPOCLORITO DE CÁLCIO, HIDRATADA com…
2881|4.2|4.2||43 40 84|I II III|Z|CATALIZADOR METÁLICO, SECO
2900|6.2|6.2||606||Z|SUBSTÂNCIA INFECTANTE, QUE AFETA apenas ANIMAIS
2901|2.3|2.3|5.1 8|265||20|CLORETO DE BROMO
2902|6.1|6.1||66 60|I II III|20|PESTICIDA, LÍQUIDO, TÓXICO, N.E.
2903|6.1|6.1|3|663 63|I II III|20|PESTICIDA, LÍQUIDO, TÓXICO, INFLAMÁVEL, N.E., com PFg igual ou superior a 23ºC
2904|8|8||80|III|1000|CLOROFENOLATOS, LÍQUIDOS, ou FENOLATOS, LÍQUIDOS
2905|8|8||80|III|1000|CLOROFENOLATOS, SÓLIDOS, ou FENOLATOS, SÓLIDOS
2907|4.1|4.1||40|II|333|DINITRATO DE ISO-SORBIDE MISTURA, com no mínimo 60% de lactose, manose, amido ou fosfato ácido de cálcio
2908|7|7||70||I|MATERIAL, RADIOATIVO, VOLUME EXCEPTIVO EMBALAGEM VAZIA
2909|7|7||70||I|MATERIAL RADIOATIVO, VOLUME EXCEPTIVO - ARTIGOS MANUFATURADOS COM URÂNIO NATURAL
2910|7|7||70||I|MATERIAL RADIOATIVO, VOLUME EXCEPTIVO QUANTIDADE LIMITADA DE MATERIAL
2911|7|7||70||I|MATERIAL RADIOATIVO, VOLUME EXCEPTIVO - INSTRUMENTOS ou ARTIGOS
2912|7|7||70||Z|MATERIAL RADIOATIVO, BAIXA ATIVIDADE ESPECÍFICA (BAE I), não-fissil ou fissil exceptivo
2913|7|7||70||Z|MATERIAL RADIOATIVO, OBJETOS CONTAMINADOS NA SUPERFÍCIE (OCS-I ou OCS-II), não-fissil ou fissil exceptivo
2915|7|7||70||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO A, não sob forma especial, não-fissil ou fissil exceptivo
2916|7|7||70 85||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO B (U), não fissil ou fissil expectivo
2917|7|7||70||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO B (M), não-fissil ou fissil exceptivo
2919|7|7||70||Z|MATERIAL RADIOATIVO, TRANSPORTADO SOB ARRANJO ESPECIAL, não-fissil ou fissil exceptivo
2920|8|8|3|883 83|I II|20|LÍQUIDO CORROSIVO, INFLAMÁVEL, N.E.
2921|8|8|4.1|884 84|I II|20|SÓLIDO CORROSIVO, INFLAMÁVEL, N.E.
2922|8|8|6.1|886 86|I II III|20|LÍQUIDO CORROSIVO, TÓXICO, N.E.
2923|8|8|6.1|886 86|I II III|20|SÓLIDO CORROSIVO, TÓXICO, N.E.
2924|3|3|8|338 38|I II III|20|LÍQUIDO INFLAMÁVEL, CORROSIVO, N.E.
2925|4.1|4.1|8|48|II III|333|SÓLIDO INFLAMÁVEL, CORROSIVO, ORGÂNICO, N.E.
2926|4.1|4.1|6.1|46|II III|333|SÓLIDO INFLAMÁVEL, TÓXICO, ORGÂNICO, N.E.
2927|6.1|6.1|8|668 86|I|20|LÍQUIDO TÓXICO, CORROSIVO, ORGÂNICO, N.E.
2928|6.1|6.1|8|668 68|I II|20|SÓLIDO TÓXICO, CORROSIVO, ORGÂNICO, N.E.
2929|6.1|6.1|3|663 63|I II|20|LÍQUIDO TÓXICO, INFLAMÁVEL, ORGÂNICO, N.E.
2930|6.1|6.1|4.1|664 64|I II|20|SÓLIDO TÓXICO, INFLAMÁVEL, ORGÂNICO, N.E.
2931|6.1|6.1||60|II|333|SULFATO DE VANADILA
2933|3|3||30|III|1000|2-CLOROPROPIONATO DE METILA
2934|3|3||30|III|1000|2-CLOROPROPIONATO DE ISOPROPILA
2935|3|3||30|III|1000|2-CLOROPROPIONATO DE ETILA
2936|6.1|6.1||60|II|333|ÁCIDO TIOLÁTICO
2937|6.1|6.1||60|III|333|ÁLCOOL alfa-METILBENZÍLICO, LÍQUIDO
2940|4.2|4.2||40|II|333|9-FOSFABICICLONONANOS (FOSFINAS DE CICLOOCTADIENO)
2941|6.1|6.1||60|III|333|FLUORANILINAS
2942|6.1|6.1||60|III|333|2-TRIFLUORMETILANILINA
2943|3|3||30|III|1000|TETRA-HIDROFURFURILAMINA
2945|3|3|8|338|II|333|N-METILBUTILAMINA
2946|6.1|6.1||60|III|333|2-AMINO-5-DIETILAMINOPENTANO
2947|3|3||30 87|III|1000|CLOROACETATO DE ISOPROPILA
2948|6.1|6.1||60|II|333|3-TRIFLUORMETILANILINA
2949|8|8||80|II|333|HIDROSSULFETO DE SÓDIO HIDRATADO, com no mínimo, 25% de água de cristalização
2950|4.3|4.3||423|III|1000|MAGNÉSIO, GRÂNULOS REVESTIDOS, partículas com dimensões não-inferiores a 149 micra
2956|4.1|4.1||40|III|1000|5-t-BUTIL-2,4,6-TRINITRO-m-XILENO (ALMISCAR XILENO)
2965|4.3|4.3|3 8|382|I|Z|DIMETILETERATO DE TRIFLUORETO DE BORO
2966|6.1|6.1||60|II|333|TIOGLICOL
2967|8|8||80|III|1000|ÁCIDO SULFÂMICO
2968|4.3|4.3||423|III|Z|MANEB, ESTABILIZADO, ou PREPARAÇÃO DE MANEB, ESTABILIZADA contra autoaquecimento
2969|9|9||90|II|333|MAMONA, GRÃOS, FARINHA, PASTA ou FLOCOS
2977|7|7|6.1 8|768||Z|MATERIAL RADIOATIVO, HEXAFLUORETO DE URÂNIO, FÍSSIL
2978|7|7|6.1 8|768||Z|MATERIAL RADIOATIVO, HEXAFLUORETO DE URÂNIO, não-físsil ou físsil exceptivo
2983|3|3|6.1|336|I|20|MISTURA DE ÓXIDO DE ETILENO E ÓXIDO DE PROPILENO, com até 30% de óxido de etileno
2984|5.1|5.1||50|III|1000|PERÓXIDO DE HIDROGÊNIO, SOLUÇÃO AQUOSA com 8% ou mais e menos de 20% de peróxido de hidrogênio
2985|3|3|8|X338|II|333|CLOROSSILANOS, INFLAMÁVEIS, CORROSIVOS, N.E.
2986|8|8|3|X83|II|333|CLOROSSILANOS, CORROSIVOS, INFLAMÁVEIS, N.E.
2987|8|8||X80|II|333|CLOROSSILANOS, CORROSIVOS, N.E.
2988|4.3|4.3|3 8|X338|I|Z|CLOROSSILANOS, QUE REAGEM COM ÁGUA, INFLAMÁVEIS, CORROSIVOS, N.E.
2989|4.1|4.1||40 88|II III|333|FOSFITO DE CHUMBO, DIBÁSICO
2990|9|9||90||1000|DISPOSITIVOS SALVA-VIDAS, AUTOINFLÁVEIS
2991|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE CARBAMATOS, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a 23ºC
2992|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE CARBAMATOS, LÍQUIDO, TÓXICO
2993|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE ARSÊNIO, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a 23ºC
2994|6.1|6.1||66 60|I II III|20|PESTICIDA Á BASE DE ARSÊNIO, LÍQUIDO, TÓXICO
2995|6.1|6.1|3|663 63 89|I II III|20|PESTICIDA À BASE DE ORGANOCLORADOS, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a
2996|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE ORGANOCLORADOS, LÍQUIDO, TÓXICO
2997|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE TRIAZINA, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a 23ºC
2998|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE TRIAZINA, LÍQUIDO, TÓXICO
3005|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE TIOCARBAMATOS, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a
3006|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE TIOCARBAMATOS, LÍQUIDO, TÓXICO
3009|6.1|6.1|3|663 90|I|20|PESTICIDA À BASE DE COBRE, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a 23ºC
3010|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE COBRE, LÍQUIDO, TÓXICO
3011|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE MERCÚRIO, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a 23ºC
3012|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE MERCÚRIO, LÍQUIDO, TÓXICO
3013|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE NITROFENOL SUBSTITUÍDO, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou…
3014|6.1|6.1||66 91|I|20|PESTICIDA À BASE DE NITROFENOL SUBSTITUÍDO, LÍQUIDO, TÓXICO
3015|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE DIPIRIDÍLIO, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a 23ºC
3016|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE DIPIRIDÍLIO, LÍQUIDO, TÓXICO
3017|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE ORGANOFOSFORADOS, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igualou superior a 23ºC
3018|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE ORGANOFOSFORADOS, LÍQUIDO, TÓXICO
3019|6.1|6.1|3|663 92|I|20|PESTICIDA À BASE DE ORGANOESTÂNICOS, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou superior a
3020|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE ORGANOESTÂNICOS, LÍQUIDO, TÓXICO
3021|3|3|6.1|336|I II|20|PESTICIDA INFLAMÁVEL, LÍQUIDO, TÓXICO, N.E., com PFg inferior a 23ºC
3022|3|3||339|II|333|ÓXIDO DE 1,2-BUTILENO, ESTABILIZADO
3023|6.1|6.1|3|663|I|20|2-METIL-2-HEPTANOTIOL
3024|3|3|6.1|336|I II|20|PESTICIDA À BASE DE DERIVADOS DA CUMARINA, LÍQUIDO, INFLAMÁVEL, TÓXICO, com PFg inferior a
3025|6.1|6.1|3|663 63|I II III|20|PESTICIDA À BASE DE DERIVADOS DA CUMARINA, LÍQUIDO, TÓXICO, INFLAMÁVEL, com PFg igual ou…
3026|6.1|6.1||66 60 93|I II|20|PESTICIDA À BASE DE DERIVADOS DA CUMARINA, LÍQUIDO, TÓXICO
3027|6.1|6.1||66 60|I II III|20|PESTICIDA À BASE DE DERIVADOS DA CUMARINA, SÓLIDO, TÓXICO
3028|8|8||80||1000|BATERIAS elétricas, SECAS, CONTENDO HIDRÓXIDO DE POTÁSSIO SÓLIDO
3048|6.1|6.1||642|I|20|PESTICIDA À BASE DE FOSFETO DE ALUMÍNIO
3054|3|3||30|III|1000|CICLO-HEXIL MERCAPTANA
3055|8|8||80|III|1000|2-(2-AMINOETÓXI) ETANOL
3056|3|3||30|III|1000|n-HEPTALDEÍDO
3057|2.3|2.3|8|268||20|CLORETO DE TRIFLUORACETILA
3064|3|3|||II|333|NITROGLICERINA, EM SOLUÇÃO ALCOÓLICA, com mais de 1% e até 5% de nitroglicerina
3065|3|3||33 30|II III|333|BEBIDAS ALCÓOLICAS, com mais de 70% de álcool, em volume BEBIDAS ÁLCÓOLICAS, com mais de 24% e até 70% de…
3066|8|8||80|II III|333|TINTA (incluindo tintas, lascas, esmaltes, tinturas, goma-lacas,vernizes, polidores, enchimentos líquidos e…
3070|2.2|2.2||20||1000|MISTURA DE ÓXIDO DE ETILENO E DICLORODIFLUORMETANO, com até 12,5% de óxido de etileno
3071|6.1|6.1|3|63|II|333|MERCAPTANAS, TÓXICAS, INFLAMÁVEIS, LÍQUIDAS, N.E., ou MISTURA DE MERCAPTANA, TÓXICA,…
3072|9|9||90||1000|DISPOSITIVOS SALVA-VIDAS, NÃO-AUTOINFLÁVEIS, contendo produtos perigosos como equipamento
3073|6.1|6.1|3 8|638|II|333|VINILPIRIDINAS, ESTABILIZADAS
3077|9|9||90|III|1000|SUBSTÂNCIA QUE APRESENTA RISCO PARA O MEIO AMBIENTE, SÓLIDA, N.E.
3078|4.3|4.3||423 94|II|333|CÉRIO, aparas de torneamento ou pó de granulação grossa
3079|6.1|6.1|3|663|I|20|METACRILONITRILA, ESTABILIZADO
3080|6.1|6.1|3|63|II|333|ISOCIANATOS, TÓXICOS, INFLAMÁVEIS, N.E. ou SOLUÇÃO DE ISOCIANATOS, TÓXICA, INFLAMÁVEL,…
3082|9|9||90|III|1000|SUBSTÂNCIA QUE APRESENTA RISCO PARA O MEIO AMBIENTE, LÍQUIDA, N.E.
3083|2.3|2.3|5.1|265||20|FLUORETO DE PERCLORILA
3084|8|8|5.1|885 85|I II|20|SÓLIDO CORROSIVO, OXIDANTE, N.E.
3085|5.1|5.1|8|558 58|I II III|20|SÓLIDO OXIDANTE, CORROSIVO, N.E.
3086|6.1|6.1|5.1|665 65|I II|20|SÓLIDO TÓXICO, OXIDANTE, N.E.
3087|5.1|5.1|6.1|556 56|I II III|20|SÓLIDO OXIDANTE, TÓXICO, N.E.
3088|4.2|4.2||40|II III|333|SÓLIDO SUJEITO A AUTOAQUECIMENTO, ORGÂNICO, N.E.
3089|4.1|4.1||40|II III|333|METAL EM PÓ, INFLAMÁVEL, N.E.
3090|9|9||90||333|BATERIAS DE LÍTIO METÁLICO (incluindo baterias de liga de lítio)
3091|9|9||90 95||333|BATERIAS DE LÍTIO METÁLICO, CONTIDAS EM EQUIPAMENTOS, ou BATERIAS DE LÍTIO METÁLICO EMBALADAS COM…
3092|3|3||30|III|1000|1-METÓXI-2-PROPANOL
3093|8|8|5.1|885 85|I II|20|LÍQUIDO CORROSIVO, OXIDANTE, N.E.
3094|8|8|4.3|823|I II|20|LÍQUIDO CORROSIVO, QUE REAGE COM ÁGUA, N.E.
3095|8|8|4.2|884 84|I II|20|SÓLIDO CORROSIVO, SUJEITO A AUTOAQUECIMENTO, N.E.
3096|8|8|4.3|842|I II|20|SÓLIDO CORROSIVO, QUE REAGE COM ÁGUA, N.E.
3097|4.1|4.1|5.1|45|II III|Z|SÓLIDO INFLAMÁVEL, OXIDANTE, N.E.
3098|5.1|5.1|8|558 58|I II III|20|LÍQUIDO OXIDANTE, CORROSIVO, N.E.
3099|5.1|5.1|6.1|556 56|I II III|20|LÍQUIDO OXIDANTE, TÓXICO, N.E.
3100|5.1|5.1|4.2|554|I II|Z|SÓLIDO OXIDANTE, SUJEITO A AUTOAQUECIMENTO, N.E.
3101|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO B, LÍQUIDO
3102|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO B, SÓLIDO
3103|5.2|5.2||539 96||20|PERÓXIDO ORGÂNICO, TIPO C, LÍQUIDO
3104|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO C, SÓLIDO
3105|5.2|5.2||539||333|PERÓXIDO ORGÂNICO, TIPO D, LÍQUIDO
3106|5.2|5.2||539||333|PERÓXIDO ORGÂNICO, TIPO D, SÓLIDO
3107|5.2|5.2||539||333|PERÓXIDO ORGÂNICO, TIPO E, LÍQUIDO
3108|5.2|5.2||539||333|PERÓXIDO ORGÂNICO, TIPO E, SÓLIDO
3109|5.2|5.2||539||333|PERÓXIDO ORGÂNICO, TIPO F, LÍQUIDO
3110|5.2|5.2||539||333|PERÓXIDO ORGÂNICO, TIPO F, SÓLIDO
3111|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO B, LÍQUIDO, TEMPERATURA CONTROLADA
3112|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO B, SÓLIDO, TEMPERATURA CONTROLADA
3113|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO C, LÍQUIDO, TEMPERATURA CONTROLADA
3114|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO C, SÓLIDO, TEMPERATURA CONTROLADA
3115|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO D, LÍQUIDO, TEMPERATURA CONTROLADA
3116|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO D, SÓLIDO, TEMPERATURA CONTROLADA
3117|5.2|5.2||539 97||20|PERÓXIDO ORGÂNICO, TIPO E, LÍQUIDO, TEMPERATURA CONTROLADA
3118|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO E, SÓLIDO, TEMPERATURA CONTROLADA
3119|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO F, LÍQUIDO, TEMPERATURA CONTROLADA
3120|5.2|5.2||539||20|PERÓXIDO ORGÂNICO, TIPO F, SÓLIDO, TEMPERATURA CONTROLADA
3121|5.1|5.1|4.3|452|I II|Z|SÓLIDO OXIDANTE, QUE REAGE COM ÁGUA, N.E.
3122|6.1|6.1|5.1|665 65|I II|20|LÍQUIDO TÓXICO, OXIDANTE, N.E.
3123|6.1|6.1|4.3|623|I II|20|LÍQUIDO TÓXICO, QUE REAGE COM ÁGUA, N.E.
3124|6.1|6.1|4.2|664 64|I II|20|SÓLIDO TÓXICO, SUJEITO A AUTOAQUECIMENTO, N.E.
3125|6.1|6.1|4.3|642|I II|20|SÓLIDO TÓXICO, QUE REAGE COM ÁGUA, N.E.
3126|4.2|4.2|8|48|II III|333|SÓLIDO SUJEITO A AUTOAQUECIMENTO, CORROSIVO, ORGÂNICO, N.E.
3127|4.2|4.2|5.1|45|II III|Z|SÓLIDO SUJEITO A AUTOAQUECIMENTO, OXIDANTE, N.E.
3128|4.2|4.2|6.1|46|II III|333|SÓLIDO SUJEITO A AUTOAQUECIMENTO, TÓXICO, ORGÂNICO, N.E.
3129|4.3|4.3|8|X382 382|I II III|Z|LÍQUIDO QUE REAGE COM ÁGUA, CORROSIVO, N.E.
3130|4.3|4.3|6.1|X362 362|I II III|Z|LÍQUIDO QUE REAGE COM ÁGUA, TÓXICO, N.E.
3131|4.3|4.3|8|X482 98|I|Z|SÓLIDO QUE REAGE COM ÁGUA, CORROSIVO, N.E.
3132|4.3|4.3|4.1|X423 423|I II III|Z|SÓLIDO QUE REAGE COM ÁGUA, INFLAMÁVEL, N.E.
3133|4.3|4.3|5.1|452|II III|Z|SÓLIDO QUE REAGE COM ÁGUA, OXIDANTE, N.E.
3134|4.3|4.3|6.1|X462 462|I II III|Z|SÓLIDO QUE REAGE COM ÁGUA, TÓXICO, N.E.
3135|4.3|4.3|4.2|X423 423|I II III|Z|SÓLIDO QUE REAGE COM ÁGUA, SUJEITO A AUTOAQUECIMENTO, N.E.
3136|2.2|2.2||22||1000|TRIFLUORMETANO, LÍQUIDO REFRIGERADO
3137|5.1|5.1|4.1|453|I|20|SÓLIDO OXIDANTE, INFLAMÁVEL, N.E.
3138|2.1|2.1||223||333|MISTURA DE ETILENO, ACETILENO E PROPILENO, LÍQUIDA REFRIGERADA contendo, no mínimo 71,5% de…
3139|5.1|5.1||55 50|I II III|20|LÍQUIDO OXIDANTE, N.E.
3140|6.1|6.1||66 60|I II III|20|ALCALÓIDES, LÍQUIDOS, N.E. ou SAIS DE ALCALÓIDES, LÍQUIDOS, N.E.
3141|6.1|6.1||60|III|333|ANTIMÔNIO, COMPOSTO INORGÂNICO, LÍQUIDO, N.E.
3142|6.1|6.1||66 60|I II III|20|DESINFETANTE, TÓXICO, LÍQUIDO, N.E.
3143|6.1|6.1||66 99|I|20|CORANTE, TÓXICO, SÓLIDO, N.E., ou INTERMEDIÁRIO PARA CORANTES, TÓXICO, SÓLIDO, N.E.
3144|6.1|6.1||66 60|I II III|20|NICOTINA COMPOSTO, LÍQUIDO, N.E. ou NICOTINA PREPARAÇÃO, LÍQUIDA, N.E.
3145|8|8||88 80|I II III|20|ALQUILFENÓIS, LÍQUIDOS, N.E. (incluindo os homólogos C2-C12)
3146|6.1|6.1||66 60|I II III|20|ESTANHO COMPOSTO ORGÂNICO, SÓLIDO, N.E.
3147|8|8||88 80|I II III|20|CORANTE, CORROSIVO, SÓLIDO, N.E., ou INTERMEDIÁRIO PARA CORANTES, CORROSIVO, SÓLIDO, N.E.
3148|4.3|4.3||X323 323|I II III|Z|LÍQUIDO QUE REAGE COM ÁGUA, N.E.
3149|5.1|5.1|8|58|II|333|MISTURA DE PERÓXIDO DE HIDROGÊNIO E ÁCIDO PERACÉTICO, com ácido(s), água e, no máximo, 5% de…
3150|2.1|2.1||23||333|DISPOSITIVOS, PEQUENOS, ACIONADOS POR HIDROCARBONETOS GASOSOS, ou RECARGA DE HIDROCARBONETOS GASOSOS PARA…
3151|9|9||90|II|Z|BIFENILAS POLIHALOGENADAS, LÍQUIDAS ou MONOMETILDIFENILAS-METANOS HALOGENADAS, LÍQUIDAS ou TERFENILAS…
3152|9|9||90|II|Z|BIFENILAS POLIHALOGENADAS, SÓLIDAS ou MONOMETILDIFENILAS-METANOS HALOGENADAS, SÓLIDAS ou TERFENILAS…
3153|2.1|2.1||23||333|PERFLUOR (ÉTER METILVINÍLICO)
3154|2.1|2.1||23 100||333|PERFLUOR (ÉTER ETILVINÍLICO)
3155|6.1|6.1||60|II|333|PENTACLOROFENOL
3156|2.2|2.2|5.1|25||1000|GÁS OXIDANTE, COMPRIMIDO, N.E.
3157|2.2|2.2|5.1|25||1000|GÁS OXIDANTE, LIQUEFEITO, N.E.
3158|2.2|2.2||22||1000|GÁS LÍQUIDO REFRIGERADO, N.E.
3159|2.2|2.2||20||1000|1,1,1,2-TETRAFLUORETANO (GÁS REFRIGERANTE R 134 a)
3160|2.3|2.3|2.1|263||20|GÁS TÓXICO, INFLAMÁVEL, LIQUEFEITO, N.E.
3161|2.1|2.1||23||333|GÁS INFLAMÁVEL, LIQUEFEITO, N.E.
3162|2.3|2.3||26||20|GÁS TÓXICO, LIQUEFEITO, N.E.
3163|2.2|2.2||20||1000|GÁS LIQUEFEITO, N.E.
3164|2.2|2.2||20||1000|ARTIGOS PRESSURIZADOS PNEUMÁTICOS ou HIDRÁULICOS (contendo gás não-inflamável)
3165|3|3|6.1 8|336|I|20|TANQUE DE COMBUSTÍVEL DE UNIDADE DE FORÇA HIDRÁULICA PARA AERONAVE (contendo mistura de…
3166|9|9||||V|VEÍCULO, MOVIDO A GÁS INFLAMÁVEL ou VEÍCULO, MOVIDO A LÍQUIDO INFLAMÁVEL ou VEÍCULO,…
3167|2.1|2.1||23||333|GÁS INFLAMÁVEL, NÃO-PRESSURIZADO, AMOSTRA, N.E., não-líquido refrigerado
3168|2.3|2.3|2.1|263||20|GÁS TÓXICO, INFLAMÁVEL, NÃO-PRESSURIZADO, AMOSTRA, N.E., não-líquido refrigerado
3169|2.3|2.3||26||20|GÁS TÓXICO, NÃO-PRESSURIZADO, AMOSTRA, N.E., não-líquido refrigerado
3170|4.3|4.3||423|II III|333|ALUMÍNIO, SUBPRODUTOS DA FUNDIÇÃO, ou ALUMÍNIO, SUBPRODUTOS DA REFUNDIÇÃO
3171|9|9||||V|VEÍCULO MOVIDO A BATERIA, ou EQUIPAMENTO MOVIDO A BATERIA
3172|6.1|6.1||66 60|I II III|20|TOXINAS EXTRAÍDAS DE FONTES VIVAS, LÍQUIDAS, N.E.
3174|4.2|4.2||40|III|1000|DISSULFETO DE TITÂNIO
3175|4.1|4.1||40|II|333|SÓLIDOS CONTENDO LÍQUIDO INFLAMÁVEL, N.E.
3176|4.1|4.1||44|II III|333|SÓLIDO INFLAMÁVEL, ORGÂNICO, FUNDIDO, N.E.
3178|4.1|4.1||40 101|II|333|SÓLIDO INFLAMÁVEL, INORGÂNICO, N.E.
3179|4.1|4.1|6.1|46|II III|333|SÓLIDO INFLAMÁVEL, TÓXICO, INORGÂNICO, N.E.
3180|4.1|4.1|8|48|II III|333|SÓLIDO INFLAMÁVEL, CORROSIVO, INORGÂNICO, N.E.
3181|4.1|4.1||40|II III|333|SAIS METÁLICOS DE COMPOSTOS ORGÂNICOS, INFLAMÁVEIS, N.E.
3182|4.1|4.1||40|II III|333|HIDRETOS METÁLICOS, INFLAMÁVEIS, N.E.
3183|4.2|4.2||30|II III|333|LÍQUIDO SUJEITO A AUTOAQUECIMENTO, ORGÂNICO, N.E.
3184|4.2|4.2|6.1|36|II III|333|LÍQUIDO SUJEITO A AUTOAQUECIMENTO, TÓXICO, ORGÂNICO, N.E.
3185|4.2|4.2|8|38|II III|333|LÍQUIDO SUJEITO A AUTOAQUECIMENTO, CORROSIVO, ORGÂNICO, N.E.
3186|4.2|4.2||30|II III|333|LÍQUIDO SUJEITO A AUTOAQUECIMENTO, INORGÂNICO, N.E.
3187|4.2|4.2|6.1|36|II III|333|LÍQUIDO SUJEITO A AUTOAQUECIMENTO, TÓXICO, INORGÂNICO, N.E.
3188|4.2|4.2|8|38|II III|333|LÍQUIDO SUJEITO A AUTOAQUECIMENTO, CORROSIVO, INORGÂNICO, N.E.
3189|4.2|4.2||40|II III|333|METAL EM PÓ, SUJEITO A AUTOAQUECIMENTO, N.E.
3190|4.2|4.2||40 102|II|333|SÓLIDO SUJEITO A AUTOAQUECIMENTO, INORGÂNICO, N.E.
3191|4.2|4.2|6.1|46|II III|333|SÓLIDO SUJEITO A AUTOAQUECIMENTO, TÓXICO, INORGÂNICO, N.E.
3192|4.2|4.2|8|48|II III|333|SÓLIDO SUJEITO A AUTOAQUECIMENTO, CORROSIVO, INORGÂNICO, N.E.
3194|4.2|4.2||333|I|Z|LÍQUIDO PIROFÓRICO, INORGÂNICO, N.E.
3200|4.2|4.2||43|I|Z|SÓLIDO PIROFÓRICO, INORGÂNICO, N.E.
3205|4.2|4.2||40|II III|333|ALCOOLATOS DE METAL ALCALINO-TERROSO, N.E.
3206|4.2|4.2|8|48|II III|333|ALCOOLATOS DE METAL ALCALINO, SUJEITO A AUTOAQUECIMENTO, CORROSIVOS, N.E.
3208|4.3|4.3||X423 423|I II III|20|SUBSTÂNCIA METÁLICA, QUE REAGE COM ÁGUA, N.E.
3209|4.3|4.3|4.2|X423 423|I II III|20|SUBSTÂNCIA METÁLICA, QUE REAGE COM ÁGUA, SUJEITAA AUTOAQUECIMENTO, N.E.
3210|5.1|5.1||50|II III|333|CLORATOS INORGÂNICOS, SOLUÇÃO AQUOSA, N.E.
3211|5.1|5.1||50|II III|333|PERCLORATOS INORGÂNICOS, SOLUÇÃO AQUOSA, N.E.
3212||||50|II|333|HIPOCLORITOS INORGÂNICOS, N.E. 5.1
3213|5.1|5.1||50 103|II|333|BROMATOS INORGÂNICOS, SOLUÇÃO AQUOSA, N.E.
3214|5.1|5.1||50|II|333|PERMANGANATOS INORGÂNICOS, SOLIÇÃO AQUOSA, N.E.
3215|5.1|5.1||50|III|1000|PERSULFATOS INORGÂNICOS, N.E.
3216|5.1|5.1||50|III|1000|PERSULFATOS INORGÂNICOS, SOLUÇÃO AQUOSA, N.E.
3218|5.1|5.1||50|II III|333|NITRATOS INORGÂNICOS, SOLUÇÃO AQUOSA, N.E.
3219|5.1|5.1||50|II III|333|NITRITOS INORGÂNICOS, SOLUÇÃO AQUOSA, N.E.
3220|2.2|2.2||20||1000|PENTAFLUORETANO (GÁS REFRIGERANTE R 125)
3221|4.1|4.1||40||20|LÍQUIDO AUTORREAGENTE, TIPO B
3222|4.1|4.1||40||20|SÓLIDO AUTORREAGENTE, TIPO B
3223|4.1|4.1||40||20|LÍQUIDO AUTORREAGENTE, TIPO C
3224|4.1|4.1||40||20|SÓLIDO AUTORREAGENTE, TIPO C
3225|4.1|4.1||40||333|LÍQUIDO AUTORREAGENTE, TIPO D
3226|4.1|4.1||40||333|SÓLIDO AUTORREAGENTE, TIPO D
3227|4.1|4.1||40||333|LÍQUIDO AUTORREAGENTE, TIPO E
3228|4.1|4.1||40||333|SÓLIDO AUTORREAGENTE, TIPO E
3229|4.1|4.1||40||333|LÍQUIDO AUTORREAGENTE, TIPO F
3230|4.1|4.1||40||333|SÓLIDO AUTORREAGENTE, TIPO F
3231|4.1|4.1||40||20|LÍQUIDO AUTORREAGENTE, TIPO B, TEMPERATURA CONTROLADA
3232|4.1|4.1||40||20|SÓLIDO AUTORREAGENTE, TIPO B, TEMPERATURA CONTROLADA
3233|4.1|4.1||40||20|LÍQUIDO AUTORREAGENTE, TIPO C, TEMPERATURA CONTROLADA
3234|4.1|4.1||40||20|SÓLIDO AUTORREAGENTE, TIPO C, TEMPERATURA CONTROLADA
3235|4.1|4.1||40 104||20|LÍQUIDO AUTORREAGENTE, TIPO D, TEMPERATURA CONTROLADA
3236|4.1|4.1||40||20|SÓLIDO AUTORREAGENTE, TIPO D, TEMPERATURA CONTROLADA
3237|4.1|4.1||40||20|LÍQUIDO AUTORREAGENTE, TIPO E, TEMPERATURA CONTROLADA
3238|4.1|4.1||40||20|SÓLIDO AUTORREAGENTE, TIPO E, TEMPERATURA CONTROLADA
3239|4.1|4.1||40||20|LÍQUIDO AUTORREAGENTE, TIPO F, TEMPERATURA CONTROLADA
3240|4.1|4.1||40||20|SÓLIDO AUTORREAGENTE, TIPO F, TEMPERATURA CONTROLADA
3241|4.1|4.1||40|III|1000|2-BROMO-2-NITROPROPANO-1,3-DIOL
3242|4.1|4.1||40|II|333|AZODICARBONAMIDA
3243|6.1|6.1||60|II|333|SÓLIDOS CONTENDO LÍQUIDO TÓXICO, N.E.
3244|8|8||80|II|333|SÓLIDOS CONTENDO LÍQUIDO CORROSIVO, N.E.
3245|9|9||90||333|MICROONGANISMOS GENETICAMENTE MODIFICADOS ou ORGANISMOS GENETICAMENTE MODIFICADOS
3246|6.1|6.1|8|668|I|20|CLORETO DE METANOSSULFONILA
3247|5.1|5.1||50|II|333|PEROXOBORATO DE SÓDIO, ANIDRO
3248|3|3|6.1|336 36|II III|333|MEDICAMENTO, INFLAMÁVEL, TÓXICO, LÍQUIDO, N.E.
3249|6.1|6.1||60|II III|333|MEDICAMENTO, TÓXICO, SÓLIDO, N.E.
3250|6.1|6.1|8|68|II|Z|ÁCIDO CLORACÉTICO, FUNDIDO
3251|4.1|4.1||40|III|1000|5-MONONITRATO DE ISOSORBIDE
3252|2.1|2.1||23||333|DIFLUORMETANO (GÁS REFRIGERANTE R 32)
3253|8|8||80|III|1000|TRIOXOSSILICATO DE DISÓDIO
3254|4.2|4.2||333|I|Z|TRIBUTILFOSFANO
3255|4.2|4.2|8|48|I|Z|HIPOCLORITO DE t-BUTILA
3256|3|3||30|III|1000|LÍQUIDO A TEMPERATURA ELEVADA, INFLAMÁVEL, N.E., com PFg superior a 60ºC, a temperatura igual ou…
3257|9|9||99|III|1000|LÍQUIDO A TEMPERATURA ELEVADA, N.E., a 100ºC ou mais e abaixo do PFg (incluindo metais fundidos, sais
3258|9|9||99 105|III|1000|SÓLIDO A TEMPERATURA ELEVADA, N.E. a 240ºC ou mais
3259|8|8||88 80|I II III|20|AMINAS, CORROSIVAS, SÓLIDAS, N.E., ou POLIAMINAS, CORROSIVAS, SÓLIDAS, N.E.
3260|8|8||88 80|I II III|20|SÓLIDO CORROSIVO, ÁCIDO, INORGÂNICO, N.E.
3261|8|8||88 80|I II III|20|SÓLIDO CORROSIVO, ÁCIDO, ORGÂNICO, N.E.
3262|8|8||88 80|I II III|20|SÓLIDO CORROSIVO, BÁSICO, INORGÂNICO, N.E.
3263|8|8||88 80|I II III|20|SÓLIDO CORROSIVO, BÁSICO, ORGÂNICO, N.E.
3264|8|8||88 80|I II III|20|LÍQUIDO CORROSIVO, ÁCIDO, INORGÂNICO, N.E.
3265|8|8||88 80 106|I II III|20|LÍQUIDO CORROSIVO, ÁCIDO, ORGÂNICO, N.E.
3266|8|8||88 80|I II III|20|LÍQUIDO CORROSIVO, BÁSICO, INORGÂNICO, N.E.
3267|8|8||88 80|I II III|20|LÍQUIDO CORROSIVO, BÁSICO, ORGÂNICO, N.E.
3268|9|9||90||I|DISPOSITIVOS DE SEGURANÇA, acionados eletricamente
3269|3|3||33 30|II III|333|KITS DE RESINA DE POLIÉSTER, material de base líquido
3270|4.1|4.1||40|II|333|FILTROS DE MEMBRANA DE NITROCELULOSE, com até 12,6% de nitrogênio, massa seca
3271|3|3||33 30|II III|333|ÉTERES, N.E.
3272|3|3||33 30|II III|333|ÉSTERES, N.E.
3273|3|3|6.1|336|I II|20|NITRILAS, INFLAMÁVEIS, TÓXICAS, N.E.
3274|3|3|8|338|II|333|ALCOOLATOS SOLUÇÃO alcoólica, N.E.
3275|6.1|6.1|3|663 63 107|I II|20|NITRILAS, TÓXICAS, INFLAMÁVEIS, N.E.
3276|6.1|6.1||66 60|I II III|20|NITRILAS, TÓXICAS, LÍQUIDAS, N.E.
3277|6.1|6.1|8|68|II|333|CLOROFORMIATOS, TÓXICOS, CORROSIVOS, N.E.
3278|6.1|6.1||66 60|I II III|20|COMPOSTO ORGANOFOSFORADO, TÓXICO, LÍQUIDO, N.E.
3279|6.1|6.1|3|663 63|I II|20|COMPOSTO ORGANOFOSFORADO, TÓXICO, INFLAMÁVEL, N.E.
3280|6.1|6.1||66 60|I II III|20|ARSÊNIO, COMPOSTO ORGÂNICO, LÍQUIDO, N.E.
3281|6.1|6.1||66 60|I II III|20|METAL CARBONILAS, LÍQUIDAS, N.E.
3282|6.1|6.1||66 108|I|20|COMPOSTO ORGANOMETÁLICO, TÓXICO, LÍQUIDO, N.E.
3283|6.1|6.1||66 60|I II III|20|SELÊNIO, COMPOSTO, SÓLIDO, N.E.
3284|6.1|6.1||66 60|I II III|20|TELÚRIO, COMPOSTO, N.E.
3285|6.1|6.1||66 60|I II III|20|VANÁDIO, COMPOSTO, N.E.
3286|3|3|6.1 8|368|I II|20|LÍQUIDO INFLAMÁVEL, TÓXICO, CORROSIVO, N.E.
3287|6.1|6.1||66 60|I II III|20|LÍQUIDO TÓXICO, INORGÂNICO, N.E.
3288|6.1|6.1||66 60|I II III|20|SÓLIDO TÓXICO, INORGÂNICO, N.E.
3289|6.1|6.1|8|668 109|I|20|LÍQUIDO TÓXICO, CORROSIVO, INORGÂNICO, N.E.
3290|6.1|6.1|8|668 68|I II|20|SÓLIDO TÓXICO, CORROSIVO, INORGÂNICO, N.E.
3291|6.2|6.2||606||333|RESÍDUOS CLÍNICOS INESPECÍFICOS, N.E., ou RESÍDUOS (BIO) MÉDICOS, N.E., ou RESÍDUOS MÉDICOS
3292|4.3|4.3||423||333|BATERIAS, CONTENDO SÓDIO, ou PILHAS, CONTENDO SÓDIO
3293|6.1|6.1||60|III|333|HIDRAZINA, SOLUÇÃO AQUOSA com até 37% de hidrazina, em massa
3294|6.1|6.1|3|663|I|Z|CIANETO DE HIDROGÊNIO, SOLUÇÃO ALCOÓLICA, com até 45% de cianeto de hidrogênio
3295|3|3||33 30|I II III|20|HIDROCARBONETO(S), LÍQUIDO(S), N.E.
3296|2.2|2.2||20||1000|HEPTAFLUORPROPANO (GÁS REFRIGERANTE R 227)
3297|2.2|2.2||20||1000|MISTURA DE ÓXIDO DE ETILENO E CLOROTETRAFLUORETANO com até 8,8% de óxido de etileno
3298|2.2|2.2||20||1000|MISTURA DE ÓXIDO DE ETILENO E PENTAFLUORETANO com até 7,9% de óxido de etileno
3299|2.2|2.2||20||1000|MISTURA DE ÓXIDO DE ETILENO E TETRAFLUORETANO com até 5,6% de óxido de etileno
3300|2.3|2.3|2.1|263||20|MISTURA DE ÓXIDO DE ETILENO E DIÓXIDO DE CARBONO com mais de 87% de óxido de etileno
3301|8|8|4.2|884 84|I II|20|LÍQUIDO CORROSIVO, SUJEITO A AUTOAQUECIMENTO, N.E.
3302|6.1|6.1||60|II|333|ACRILATO DE 2-DIMETILAMINOETILA, ESTABILIZADO
3303|2.3|2.3|5.1|265||20|GÁS TÓXICO, OXIDANTE, COMPRIMIDO, N.E.
3304|2.3|2.3|8|268||20|GÁS TÓXICO, CORROSIVO, COMPRIMIDO, N.E.
3305|2.3|2.3|2.1 8|263||20|GÁS TÓXICO, INFLAMÁVEL, CORROSIVO, COMPRIMIDO, N.E.
3306|2.3|2.3|5.1 8|265||20|GÁS TÓXICO, OXIDANTE, CORROSIVO, COMPRIMIDO, N.E.
3307|2.3|2.3|5.1|265||20|GÁS TÓXICO, OXIDANTE, LIQUEFEITO, N.E.
3308|2.3|2.3|8|268||20|GÁS TÓXICO, CORROSIVO, LIQUEFEITO, N.E.
3309|2.3|2.3|2.1 8|263||20|GÁS TÓXICO, INFLAMÁVEL, CORROSIVO, LIQUEFEITO, N.E.
3310|2.3|2.3|5.1 8|265||20|GÁS TÓXICO, OXIDANTE, CORROSIVO, LIQUEFEITO, N.E.
3311|2.2|2.2|5.1|225 110||1000|GÁS OXIDANTE, LÍQUIDO REFRIGERADO, N.E.
3312|2.1|2.1||223||333|GÁS INFLAMÁVEL, LÍQUIDO REFRIGERADO, N.E.
3313|4.2|4.2||40|II III|333|PIGMENTOS ORGÂNICOS, SUJEITOS A AUTOAQUECIMENTO
3314|9|9||90|III|1000|COMPOSTO PLÁSTICO PARA MOLDAGEM, sob forma de pasta, folha ou corda extrudada, que desprende vapor
3315|6.1|6.1||66|I|20|AMOSTRA QUÍMICA, TÓXICA
3316|9|9||90||V|ESTOJO QUÍMICO ou ESTOJO DE PRIMEIROS SOCORROS
3317|4.1|4.1||40|I|20|2-AMINO-4,6 - DINITIROFENOL, UMEDECIDO com no mínimo, 20% de água, em massa
3318|2.3|2.3|8|268||20|AMÔNIA, SOLUÇÃO aquosa, com densidade relativa inferior a 0,880 a 15ºC, com mais de 50% de amônia
3319|4.1|4.1||40|II|333|MISTURA DE NITROGLICERINA, INSENSIBILIZADA, SÓLIDA, N.E. com mais de 2% e até 10% de nitroglicerina,…
3320|8|8||80|II III|333|BORO-HIDRETO DE SÓDIO E HIDRÓXIDO DE SÓDIO SOLUÇÃO, com até 12% de boro-hidreto de sódio e até
3321|7|7||70||Z|MATERIAL RADIOATIVO, BAIXA ATIVIDADE ESPECÍFICA (BAE-II), não-físsil ou físsil exceptivo
3322|7|7||70||Z|MATERIAL RADIOATIVO, BAIXA ATIVIDADE ESPECÍFICA (BAE-III), não-físsil ou físsil exceptivo
3323|7|7||70||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO C, não-físsil ou físsil exceptivo
3324|7|7||70||Z|MATERIAL REDIOATIVO, BAIXA ATIVIDADE ESPECÍFICA (BAE-II) FÍSSIL
3325|7|7||70||Z|MATERIAL RADIOATIVO, BAIXA ATIVIDADE ESPECÍFICA (BAE-III), FÍSSIL
3326|7|7||70||Z|MATERIAL RADIOATIVO, OBJETOS CONTAMINADOS NA SUPERFÍCIE (OCS-I OU OCS-II), FÍSSIL
3327|7|7||70||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO A, FÍSSIL, não-sob forma especial
3328|7|7||70||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO B(U), FÍSSIL
3329|7|7||70||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO B(M), FÍSSIL
3330|7|7||70||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO C, FÍSSIL
3331|7|7||70 111||Z|MATERIAL RADIOATIVO, TRANSPORTADO SOB ARANJO ESPECIAL, FÍSSIL
3332|7|7||70||Z|MATERIAL RADIOATIVO, VOLUME TIPO A, TRANSPORTADO SOB FORMA ESPECIAL, não-físsil ou físsil
3333|7|7||70||Z|MATERIAL RADIOATIVO, EM VOLUME TIPO A, TRANSPORTADO SOB FORMA ESPECIAL, FÍSSIL
3334||||||N|LÍQUIDO REGULAMENTADO PARA AVIAÇÃO, N.E.
3335||||||N|SÓLIDO REGULAMENTADO PARA AVIAÇÃO, N.E.
3336|3|3||33 30|I II III|20|MERCAPTANAS, INFLAMÁVEIS, LÍQUIDAS, N.E., ou MISTURA DE MERCAPTANA, INFLAMÁVEL, LÍQUIDA, N.E.
3337|2.2|2.2||20||1000|GÁS REFRIGERANTE R 404 A
3338|2.2|2.2||20||1000|GÁS REFRIGERANTE R 407 A
3339|2.2|2.2||20||1000|GÁS REFRIGERANTE R 407 B
3340|2.2|2.2||20||1000|GÁS REFRIGERANTE R 407 C
3341|4.2|4.2||40|II III|333|DIÓXIDO DE TIOURÉIA
3342|4.2|4.2||40|II III|333|XANTATOS
3343|3|3||33||Z|MISTURA DE NITROGLICERINA, INFLAMÁVEL, INSENSIBILIZADA, LÍQUIDA, N.E., com até 30% de nitroglicerina, em massa
3344|4.1|4.1||40|II|333|TETRANITRATO DE PENTAERITRINA (TETRANITRATO DE PENTAERITROL; PETN), MISTURA, INSENSIBILIZADA, SÓLIDA, N.E.…
3345|6.1|6.1||66 60|I II III|20|PESTICIDA Á BASE DE DERIVADOS DO ÁCIDO FENOXIACÉTICO, TÓXICO, SÓLIDO
3346|3|3|6.1|336|I II|20|PESTICIDA Á BASE DE DERIVADOS DO ÁCIDO FENOXIACÉTICO, INFLAMÁVEL, TÓXICO, LÍQUIDO com…
3347|6.1|6.1|3|663 63 112|I II|20|PESTICIDA Á BASE DE DERIVADOS DO ÁCIDO FENOXIACÉTICO, TÓXICO, INFLAMÁVEL, LÍQUIDO com…
3348|6.1|6.1||66 60|I II III|20|PESTICIDA Á BASE DE DERIVADOS DO ÁCIDO FENOXIACÉTICO, TÓXICO, LÍQUIDO
3349|6.1|6.1||66 60|I II III|20|PESTICIDA Á BASE DE PIRETRÓIDE, TÓXICO, SÓLIDO
3350|3|3|6.1|336|I II|20|PESTICIDA Á BASE DE PIRETRÓIDE, INFLAMÁVEL, TÓXICO, LÍQUIDO com ponto de fulgor inferior a 23ºC
3351|6.1|6.1|3|663 63|I II III|20|PESTICIDA Á BASE DE PIRETRÓIDE, TÓXICO, INFLAMÁVEL, LÍQUIDO com PFg igual ou superior a 23ºC
3352|6.1|6.1||66 60|I II III|20|PESTICIDA Á BASE DE PIRETRÓIDE, TÓXICO, LÍQUIDO
3354|2.1|2.1||23||333|INSETICIDA INFLAMÁVEL, GASOSO, N.E.
3355|2.3|2.3|2.1|263||20|INSETICIDA, TÓXICO, INFLAMÁVEL, GASOSO, N.E.
3356|5.1|5.1||50||333|GERADOR DE OXIGÊNIO, QUÍMICO
3357|3|3||33 113|II|333|MISTURA DE NITROGLICERINA, INSENSIBILIZADA, LÍQUIDA, N.E., com até 30% de nitroglicerina, em massa
3358|2.1|2.1||23||333|MÁQUINAS DE REFRIGERAÇÃO contendo gás liquefeito, inflamável, não-tóxico
3359|9|9||90||V|VEÍCULO SOB FUMIGAÇÃO ou EQUIPAMENTO DE TRANSPORTE SOB FUMIGAÇÃO
3360||||||N|FIBRAS VEGETAIS, SECAS
3361|6.1|6.1|8|68|II|333|CLOROSILANOS, TÓXICO, CORROSIVO, N.E.
3362|6.1|6.1|3 8|638|II|333|CLOROSILANOS, TÓXICO, CORROSIVO, INFLAMÁVEL, N.E.
3363|9|9||90||V|PRODUTOS PERIGOSOS EM ARTIGOS ou PRODUTOS PERIGOSOS EM MAQUINARIA ou PRODUTOS PERIGOSOS EM APARELHOS
3364|4.1|4.1||40|I|20|TRINITROFENOL (ÁCIDO PÍCRICO) UMEDECIDO, com teor de água igual ou superior a 10% em massa
3365|4.1|4.1||40|I|20|TRINITROCLOROBENZENO (CLORETO DE PICRILA), UMEDECIDO, com teor de água igual ou superior a 10%
3366|4.1|4.1||40|I|20|TRINITROTOLUENO (TNT), UMEDECIDO, com teor de água igual ou superior a 10%, em massa
3367|4.1|4.1||40|I|20|TRINITROBENZENO, UMEDECIDO, com teor de água igual ou superior a 10%, em massa
3368|4.1|4.1||40|I|20|ÁCIDO TRINITROBENZÓICO, UMEDECIDO, com teor de água igual ou superior a 10%, em massa
3369|4.1|4.1||40|I|20|DINITRO-o-CRESOLATO DE SÓDIO, UMEDECIDO, com teor de água igual ou superior a 10%, em massa
3370|4.1|4.1||40|I|20|NITRATO DE URÉIA, UMEDECIDO, com teor de água igual ou superior a 10%, em massa
3371|3|3||33|II|333|2-METILBUTANAL
3373|6.2|6.2||606||Z|SUBSTÂNCIA BIOLÓGICA, CATEGORIA B
3374|2.1|2.1||239||333|ACETILENO, LIVRE DE SOLVENTE
3375|5.1|5.1||50|II|333|NITRATO DE AMÔNIO, EMULSÃO ou SUSPENSÃO ou GEL, explosivos intermediários para detonantes
3376|4.1|4.1||40|I|20|4-NITROFENILHIDRAZINA, com até de 30% de água, em massa
3377|5.1|5.1||50|III|1000|PERBORATO DE SÓDIO MONOHIDRATADO
3378|5.1|5.1||50|II III|333|CARBONATO DE SÓDIO PEROXI-HIDRATADO
3379|3|3||33|I|V|LÍQUIDO EXPLOSIVO INSENSIBILIZADO, N.E.
3380|4.1|4.1||40|I|V|SÓLIDO EXPLOSIVO INSENSIBILIZADO, N.E.
3381|6.1|6.1||66 114|I|20|LÍQUIDO TÓXICO À INALAÇÃO, N.E. com toxicidade à inalação inferior ou igual a 200 ml/m³ e com concentração de…
3382|6.1|6.1||66|I|20|LÍQUIDO TÓXICO À INALAÇÃO, N.E. com toxicidade à inalação inferior ou igual a 1000 ml/m³ e com concentração
3383|6.1|6.1|3|663|I|20|LÍQUIDO TÓXICO À INALAÇÃO, INFLAMÁVEL, N.E. com toxicidade à inalação inferior ou igual a 200 ml/m³ e
3384|6.1|6.1|3|663|I|20|LÍQUIDO TÓXICO À INALAÇÃO, INFLAMÁVEL, N.E. com toxicidade à inalação inferior ou igual a 1000 ml/m³ e
3385|6.1|6.1|4.3|623|I|20|LÍQUIDO TÓXICO À INALAÇÃO, QUE REAGE COM ÁGUA, N.E. com toxicidade à inalação inferior ou igual a 200
3386|6.1|6.1|4.3|623|I|20|LÍQUIDO TÓXICO À INALAÇÃO, QUE REAGE COM ÁGUA, N.E. com toxicidade à inalação inferior ou igual a
3387|6.1|6.1|5.1|665|I|20|LÍQUIDO TÓXICO À INALAÇÃO, OXIDANTE, N.E. com toxicidade à inalação inferior ou igual a 200 ml/m³ e com…
3388|6.1|6.1|5.1|665|I|20|LÍQUIDO TÓXICO À INALAÇÃO, OXIDANTE, N.E. com toxicidade à inalação inferior ou igual a 1000 ml/m³ e com…
3389|6.1|6.1|8|668|I|20|LÍQUIDO TÓXICO À INALAÇÃO, CORROSIVO, N.E. com toxicidade à inalação inferior ou igual a 200 ml/m³ e com…
3390|6.1|6.1|8|668|I|20|LÍQUIDO TÓXICO À INALAÇÃO, CORROSIVO, N.E. com toxicidade à inalação inferior ou igual a 1000 ml/m³ e com…
3391|4.2|4.2||43|I|Z|SUBSTÂNCIA ORGANOMETÁLICA, PIROFÓRICA, SÓLIDA
3392|4.2|4.2||333|I|Z|SUBSTÂNCIA ORGANOMETÁLICA, PIROFÓRICA, LÍQUIDA
3393|4.2|4.2|4.3|X432|I|Z|SUBSTÂNCIA ORGANOMETÁLICA, PIROFÓRICA, QUE REAGE COM ÁGUA, SÓLIDA
3394|4.2|4.2|4.3|X333|I|Z|SUBSTÂNCIA ORGANOMETÁLICA, PIROFÓRICA, QUE REAGE COM ÁGUA, LÍQUIDA
3395|4.3|4.3||X423 423 115|I II III|20|SUBSTÂNCIA ORGANOMETÁLICA, QUE REAGE COM ÁGUA, SÓLIDA
3396|4.3|4.3|4.1|X423 423|I II III|Z|SUBSTÂNCIA ORGANOMETÁLICA, QUE REAGE COM ÁGUA, INFLAMÁVEL, SÓLIDA
3397|4.3|4.3|4.2|X423 423|I II III|20|SUBSTÂNCIA ORGANOMETÁLICA, QUE REAGE COM ÁGUA, SUJEITA A AUTOAQUECIMENTO, SÓLIDA
3398|4.3|4.3||X323 323|I II III|Z|SUBSTÂNCIA ORGANOMETÁLICA, QUE REAGE COM ÁGUA, LÍQUIDA
3399|4.3|4.3|3|X323 323|I II III|Z|SUBSTÂNCIA ORGANOMETÁLICA, QUE REAGE COM ÁGUA, INFLAMÁVEL, LÍQUIDA
3400|4.2|4.2||40 116|II III|333|SUBSTÂNCIA ORGANOMETÁLICA, SUJEITA A AUTOAQUECIMENTO, SÓLIDA
3401|4.3|4.3||X423|I|20|AMALGAMA DE METAIS ALCALINOS, SÓLIDA
3402|4.3|4.3||X423|I|20|AMALGAMA DE METAIS ALCALINO-TERROSOS, SÓLIDA
3403|4.3|4.3||X423|I|20|LIGAS METÁLICAS DE POTÁSSIO, SÓLIDAS
3404|4.3|4.3||X423|I|20|LIGAS DE POTÁSSIO E SÓDIO, SÓLIDAS
3405|5.1|5.1|6.1|56|II III|333|CLORATO DE BÁRIO, SOLUÇÃO
3406|5.1|5.1|6.1|56|II III|333|PERCLORATO DE BÁRIO EM SOLUÇÃO
3407|5.1|5.1||50|II III|333|MISTURA DE CLORATO E CLORETO DE MAGNÉSIO EM SOLUÇÃO
3408|5.1|5.1|6.1|56|II III|333|PERCLORATO DE CHUMBO SOLUÇÃO
3409|6.1|6.1||60|II|333|CLORONITROBENZENOS, LÍQUIDOS
3410|6.1|6.1||60|III|333|HIDROCLORETO DE 4-CLORO-o-TOLUIDINA SOLUÇÃO
3411|6.1|6.1||60|II III|333|beta-NAFTILAMINA SOLUÇÃO
3412|8|8||80|II III|333|ÁCIDO FÓRMICO com no mínimo 10% e no máximo 85% de ácido, em massa ÁCIDO FÓRMICO com no mínimo 5% e com menos…
3413|6.1|6.1||66 60|I II III|20|CIANETO DE POTÁSSIO SOLUÇÃO
3414|6.1|6.1||66 60 117|I II|20|CIANETO DE SÓDIO SOLUÇÃO
3415|6.1|6.1||60|III|333|FLUORETO DE SÓDIO SOLUÇÃO
3416|6.1|6.1||60|II|333|CLOROACETOFENONA, LÍQUIDA
3417|6.1|6.1||60|II|333|BROMETO DE XILILO, SÓLIDO
3418|6.1|6.1||60|III|333|2,4-TOLUILENODIAMINA EM SOLUÇÃO
3419|8|8||80|II|333|COMPLEXO DE TRIFLUORETO DE BORO E DE ÁCIDO ACÉTICO, SÓLIDO
3420|8|8||80|II|333|COMPLEXO DE TRIFLUORETO DE BORO E DE ÁCIDO PROPIÔNICO, SÓLIDO
3421|8|8|6.1|86|II III|333|HIDROGENODIFLUORETO DE POTÁSSIO SOLUÇÃO
3422|6.1|6.1||60|III|333|FLUORETO DE POTÁSSIO SOLUÇÃO
3423|8|8||80|II|333|HIDRÓXIDO DE TETRAMETIL-AMÔNIO, SÓLIDO
3424|6.1|6.1||60|II III|333|DINITRO-o-CRESOLATO DE AMÔNIO SOLUÇÃO
3425|8|8||80|II|333|ÁCIDO BROMOACÉTICO, SÓLIDO
3426|6.1|6.1||60|III|333|ACRILAMIDA EM SOLUÇÃO
3427|6.1|6.1||60|III|333|CLORETOS DE CLOROBENZILA. SÓLIDO
3428|6.1|6.1||60|II|333|ISOCIANATO DE 3-CLORO-4-METILFENILA, SÓLIDO
3429|6.1|6.1||60|III|333|CLOROTOLUIDINAS, LÍQUIDAS
3430|6.1|6.1||60|II|333|XILENÓIS, LÍQUIDOS
3431|6.1|6.1||60|II|333|TRIFLUORETOS DE NITROBENZENO, SÓLIDOS
3432|9|9||90|II|Z|BIFENILAS POLICLORADAS, SÓLIDAS
3434|6.1|6.1||60 118|III|333|NITROCRESSÓIS, LÍQUIDOS
3436|6.1|6.1||60|II|333|HIDRATOS DE HEXAFLUORACETONA, SÓLIDO
3437|6.1|6.1||60|II|333|CLOROCRESSÓIS, SÓLIDOS
3438|6.1|6.1||60|III|333|ÁLCOOL alpha-METILBENZÍLICO, SÓLIDO
3439|6.1|6.1||66 60|I II III|20|NITRILOS, TÓXICOS, SÓLIDOS, N.E.
3440|6.1|6.1||66 60|I II III|20|COMPOSTO DE SELÊNIO, LÍQUIDO, N.E.
3441|6.1|6.1||60|II|333|CLORODINITROBENZENOS, SÓLIDOS
3442|6.1|6.1||60|II|333|DICLOROANILINAS, SÓLIDAS
3443|6.1|6.1||60|II|333|DINITROBENZENOS, SÓLIDOS
3444|6.1|6.1||60|II|333|HIDROCLORETO DE NICOTINA, SÓLIDO
3445|6.1|6.1||60|II|333|SULFATO DE NICOTINA, SÓLIDA
3446|6.1|6.1||60|II|333|NITROTOLUENOS, SÓLIDOS
3447|6.1|6.1||60|II|333|NITROXILENOS, SÓLIDOS
3448|6.1|6.1||66 60|I II|20|SUBSTÂNCIA PARA PRODUÇÃO DE GÁS LACRIMOGÊNEO, SÓLIDA, N.E.
3449|6.1|6.1||66|I|333|CIANETOS DE BROMOBENZILA, SÓLIDOS
3450|6.1|6.1||66|I|20|DIFENILCLOROARSINA, SÓLIDA
3451|6.1|6.1||60|II|333|TOLUIDINAS, SÓLIDAS
3452|6.1|6.1||60|II|333|XILIDINAS, SÓLIDAS
3453|8|8||80|III|1000|ÁCIDO FOSFÓRICO, SÓLIDO
3454|6.1|6.1||60 119|II|333|DINITROTOLUENOS, SÓLIDOS
3455|6.1|6.1|8|68|II|333|CRESÓIS, SÓLIDOS
3456|8|8||X80|II|333|ÁCIDO NITROSILSULFÚRICO, SÓLIDO
3457|6.1|6.1||60|III|333|CLORONITROTOLUENOS, SÓLIDOS
3458|6.1|6.1||60|III|333|NITROANISÓIS, SÓLIDOS
3459|6.1|6.1||60|III|333|NITROBROMOBENZENOS, SÓLIDOS
3460|6.1|6.1||60|III|333|N-ETILBENZILTOLUIDINAS, SÓLIDAS
3462|6.1|6.1||66 60|I II III|20|TOXINAS, EXTRAÍDAS DE ORGANISMOS VIVOS, SÓLIDAS, N.E.
3463|8|8|3|83|II|333|ÁCIDO PROPIÔNICO com no mínimo 90% de ácido em massa
3464|6.1|6.1||66 60|I II III|20|FÓSFORO, COMPOSTO ORGÂNICO, TÓXICO, SÓLIDO, N.E.
3465|6.1|6.1||66 60|I II III|20|ARSÊNICO, COMPOSTO ORGÂNICO, SÓLIDO, N.E.
3466|6.1|6.1||66 60|I II III|20|METAL CARBONILAS, SÓLIDAS, N.E.
3467|6.1|6.1||66 60 120|I II|20|COMPOSTO ORGANOMETÁLICO, TÓXICO, SÓLIDO, N.E.
3468|2.1|2.1||23||333|HIDROGÊNIO EM UM SISTEMA DE ARMAZENAGEM DE HIDRETO METÁLICO ou HIDROGÊNIO EM UM
3469|3|3|8|338 38|I II III|20|TINTA INFLAMÁVEL, CORROSIVA (incluindo tintas, lacas, esmaltes, tinturas, goma-lacas, vernizes, polidores,…
3470|8|8|3|83|II|333|TINTA CORROSIVA, INFLAMÁVEL (incluindo tintas, lacas, esmaltes, tinturas, goma-lacas, vernizes, polidores,…
3471|8|8|6.1|86|II III|333|HIDROGENODIFLUORETO SOLUÇÃO, N.E.
3472|8|8||80|III|1000|ÁCIDO CROTÔNICO, LÍQUIDO
3473|3|3||30||1000|CARTUCHOS PARA PILHAS DE COMBUSTÍVEL ou CARTUCHOS PARA PILHAS DE COMBUSTÍVEL
3474|4.1|4.1||40|I|20|1 - HIDROXIBENZOTRIAZOL MONOHIDRATADO
3475|3|3||33|II|333|MISTURA DE ETANOL E GASOLINA ou MISTURA DE ETANOL E COMBUSTÍVEL PARA MOTORES com…
3476|4.3|4.3||423||1000|CARTUCHOS PARA PILHAS DE COMBUSTÍVEL ou CARTUCHOS PARA PILHAS DE COMBUSTÍVEL
3477|8|8||80||1000|CARTUCHOS PARA PILHAS DE COMBUSTÍVEL ou CARTUCHOS PARA PILHAS DE COMBUSTÍVEL
3478|2.1|2.1||23||333|CARTUCHOS PARA PILHAS DE COMBUSTÍVEL ou CARTUCHOS PARA PILHAS DE COMBUSTÍVEL
3479|2.1|2.1||23||333|CARTUCHOS PARA PILHAS DE COMBUSTÍVEL ou CARTUCHOS PARA PILHAS DE COMBUSTÍVEL
3480|9|9||90 121||333|BATERIAS DE ÍON LÍTIO (incluindo baterias de polímero de íon lítio)
3481|9|9||90||333|BATERIAS DE ÍON LÍTIO CONTIDAS EM EQUIPAMENTOS ou BATERIAS DE ÍON LÍTIO EMBALADAS COM
3482|4.3|4.3|3|X323|I|20|DISPERSÃO DE METAIS ALCALINOS, INFLAMÁVEL ou DISPERSÃO DE METAIS ALCALINOS TERROSOS,…
3483|6.1|6.1|3|663|I|20|MISTURA ANTIDETONANTE PARA COMBUSTÍVEL DE MOTORES, INFLAMÁVEL
3484|8|8|3 6.1|886|I|20|HIDRAZINA, SOLUÇÃO AQUOSA, INFLAMÁVEL, com mais de 37% de hidrazina, em massa
3485|5.1|5.1|8|58|II|333|HIPOCLORITO DE CÁLCIO, SECO, CORROSIVO ou MISTURA DE HIPOCLORITO DE CÁLCIO, SECO, CORROSIVO, com mais de 39%…
3486|5.1|5.1|8|58|III|1000|MISTURA DE HIPOCLORITO DE CÁLCIO, SECO, CORROSIVO, com mais de 10% e até 39% de cloro ativo
3487|5.1|5.1|8|58|II III|333|HIPOCLORITO DE CÁLCIO, HIDRATADO, CORROSIVO ou MISTURA DE HIPOCLORITO DE CÁLCIO, HIDRATADO, CORROSIVO com não…
3488|6.1|6.1 3|8|663|I|20|LÍQUIDO TÓXICO POR INALAÇÃO, INFLAMÁVEL, CORROSIVO, N.E. com uma CL50 inferior ou igual a 200
3489|6.1|6.1 3|8|663|I|20|LÍQUIDO TÓXICO POR INALAÇÃO, INFLAMÁVEL, CORROSIVO, N.E. com uma CL50 inferior ou igual a 1000
3490|6.1|6.1|4.3 3|623|I|20|LÍQUIDO TÓXICO POR INALAÇÃO, QUE REAGE COM ÁGUA, INFLAMÁVEL, N.E. com uma CL50 inferior ou…
3491|6.1|6.1|4.3 3|623|I|20|LÍQUIDO TÓXICO POR INALAÇÃO, QUE REAGE COM ÁGUA, INFLAMÁVEL, N.E. com uma CL50 inferior ou…
3494|3|3|6.1|336 36|I II III|20|PETRÓLEO CRU ÁCIDO, INFLAMÁVEL, TÓXICO
3495|8|8|6.1|86|III|1000|IODO
3496||||||N|PILHAS DE NÍQUEL-HIDRETO METÁLICO
3497|4.2|4.2||40|II III|333|FARINHA DE KRILL
3498|8|8||80|II|333|IODO MONOCLORADO, LÍQUIDO
3499|9|9||90 122||I|CAPACITOR, ELÉTRICO DE DUPLA CAMADA (com capacidade de armazenamento de energia superior a 0,3 Wh)
3500|2.2|2.2||20||1000|PRODUTO QUÍMICO SOB PRESSÃO, N.E.
3501|2.1|2.1||23||333|PRODUTO QUÍMICO SOB PRESSÃO, INFLAMÁVEL, N.E.
3502|2.2|2.2|6.1|26||20|PRODUTO QUÍMICO SOB PRESSÃO, TÓXICO, N.E.
3503|2.2|2.2|8|28||20|PRODUTO QUÍMICO SOB PRESSÃO, CORROSIVO, N.E.
3504|2.1|2.1|6.1|263||20|PRODUTO QUÍMICO SOB PRESSÃO, INFLAMÁVEL, TÓXICO, N.E.
3505|2.1|2.1|8|238||20|PRODUTO QUÍMICO SOB PRESSÃO, INFLAMÁVEL, CORROSIVO, N.E.
3506|8|8|6.1|||1000|MERCÚRIO CONTIDO EM ARTIGOS MANUFATURADOS
3507|6.1|6.1|7 8||I|Z|HEXAFLUORETO DE URÂNIO, MATERIAL RADIOATIVO, EMBALAGEM EXCEPTIVA, com menos de 0,1 kg
3508|9|9||90||I|CAPACITOR, ASSIMÉTRICO (com capacidade de armazenamento de energia superior a 0.3Wh)
3509|9|9||||V|EMBALAGENS VAZIAS, NÃO LIMPAS
3510|2.1|2.1||23||Z|GÁS ADSORVIDO, INFLAMÁVEL, N.E.
3511|2.2|2.2||20||Z|GÁS ADSORVIDO, N.E.
3512|2.3|2.3||26||Z|GÁS ADSORVIDO TÓXICO, N.E.
3513|2.2|2.2|5.1|225||Z|GÁS ADSORVIDO, OXIDANTE, N.E.
3514|2.3|2.3|2.1|263||Z|GÁS ADSORVIDO,TÓXICO INFLAMÁVEL, N.E.
3515|2.3|2.3|5.1|265||Z|GÁS ADSORVIDO TÓXICO, OXIDANTE, N.E.
3516|2.3|2.3|8|268||Z|GÁS ADSORVIDO, TÓXICO, CORROSIVO, N.E.
3517|2.3|2.3|2.1 8|263||Z|GÁS ADSORVIDO, TÓXICO, INFLAMÁVEL, CORROSIVO, N.E.
3518|2.3|2.3|5.1 8|265||Z|GÁS ADSORVIDO, TÓXICO, OXIDANTE, CORROSIVO, N.E.
3519|2.3|2.3|8|268||Z|TRIFLUORETO DE BORO, ADSORVIDO
3520|2.3|2.3|5.1 8|265||Z|CLORO, ADSORVIDO
3521|2.3|2.3|8|268||Z|TETRAFLUORETO DE SILICONE, ADSORVIDO
3522|2.3|2.3|2.1|263||Z|ARSINA, ADSORVIDA
3523|2.3|2.3|2.1|263||Z|GERMANO, ADSORVIDO
3524|2.3|2.3|8|268||Z|PENTAFLUORETO DE FÓSFORO, ADSORVIDO
3525|2.3|2.3|2.1|263||Z|FOSFINA, ADSORVIDA
3526|2.3|2.3|2.1|263||Z|SELENETO DE HIDROGÊNIO, ADSORVIDO
3527|4.1|4.1||40|II III|1000|KIT DE RESINA DE POLIÉSTER, material de base sólido
3528|3|3||30 123||Z|MOTOR, COMBUSTÃO INTERNA, MOVIDO A LÍQUIDO INFLAMÁVEL ou MOTOR, PILHA DE COMBUSTÍVEL, MOVIDO A LÍQUIDO…
3529|2.1|2.1||23||Z|MOTOR, COMBUSTÃO INTERNA, MOVIDO A GÁS INFLAMÁVEL ou MOTOR, PILHA DE COMBUSTÍVEL, MOVIDO A GÁS INFLAMÁVEL ou…
3530|9|9||90|III|Z|MOTOR, COMBUSTÃO INTERNA, ou MAQUINÁRIO, COMBUSTÃO INTERNA
3531|4.1|4.1||40|III|Z|SUBSTÂNCIA POLIMERIZANTE SÓLIDA, ESTABILIZADA, N.E.
3532|4.1|4.1||40|III|Z|SUBSTÂNCIA POLIMERIZANTE LÍQUIDA, ESTABILIZADA, N.E.
3533|4.1|4.1||40|III|Z|SUBSTÂNCIA POLIMERIZANTE SÓLIDA, TEMPERATURA CONTROLADA, N.E. SUBSTÂNCIA POLIMERIZANTE LÍQUIDA, TEMPERATURA…
3534|4.1|4.1||40|III|V|4.1
3535|6.1|6.1|4.1|664 64|I II|20|SÓLIDO INORGÂNICO TÓXICO, INFLAMÁVEL, N.E.
3536|9|9||90||V|BATERIAS DE LÍTIO INSTALADAS EM EQUIPAMENTOS DE TRANSPORTE sendo baterias de íon lítio ou baterias de lítio…
3537|2.1|2.1|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO GÁS INFLAMÁVEL, N.E.
3538|2.2|2.2|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO GÁS NÃO INFLAMÁVEL E NÃO TÓXICO, N.E.
3539|2.3|2.3|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO GÁS TÓXICO, N.E.
3540|3|3|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO LÍQUIDO INFLAMÁVEL, N.E.
3541|4.1|4.1|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO SÓLIDO INFLAMÁVEL, N.E.
3542|4.2|4.2|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO SUBSTÂNCIA SUJEITA DE COMBUSTÃO ESPONTÂNEA, N.E.
3543|4.3|4.3|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO SUBSTÂNCIA QUE, EM CONTATO COM A ÁGUA, EMITE GASES INFLAMÁVEIS, N.E.
3544|5.1|5.1|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO SUBSTÂNCIA OXIDANTE, N.E.
3545|5.2|5.2|Ver item 2.0.5.6|||I|ARTIGOS CONTENDO PERÓXIDOS ORGÃNICOS, N.E. ARTIGOS CONTENDO SUBSTÂNCIA TÓXICA, N.E.
3546|6.1|6.1|2.0.5.6 Ver item|||I|ARTIGOS CONTENDO SUBSTÂNCIA CORROSIVA, N.E.
3547|8|8|2.0.5.6|124||I|
3548|9|9|2.0.5.6|||I|RISCO PARA O MEIO AMBIENTE, N.E. RESÍDUOSMÉDICOS,CATEGORIAA,QUEAFETASERESHUMANOS,sólidoouRESÍDUOSMÉDICOS
3549|6.2|6.2||606||Z|CATEGORIA A, QUE AFETA apenas ANIMAIS, sólido
3550|6.1|6.1||66 125|I|Z|DIHIDRÓXIDO DE COBALTO EM PÓ contendo, no mínimo, 10% de partículas respiráveis
`;
// RELACAO_ANTT>>
