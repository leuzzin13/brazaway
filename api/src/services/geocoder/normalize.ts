/** Normalização de texto de endereço — espelho de geo_norm/geo_canon (db/migrations/0116_geocoding.sql).
 *  A tabela de abreviações (geo_abbrev) é a fonte única: a base foi normalizada com ela no import e a busca
 *  é normalizada com a mesma tabela aqui (carregada do banco). */
import { query } from '../../db.js';

/** caixa alta, sem acento, só [A-Z0-9] separados por 1 espaço (= geo_norm) */
export function normBasic(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export class Canon {
  constructor(private readonly map: Map<string, string>) {}

  /** = geo_canon: troca abreviações pela palavra canônica e remove preposições ('D' conforme o contexto: dWord) */
  canon(s: string): string {
    const toks = normBasic(s).split(' ').filter(Boolean);
    const out: string[] = [];
    toks.forEach((tok, i) => {
      const full = tok === 'D' ? dWord(toks[i + 1]) : this.map.has(tok) ? this.map.get(tok)! : tok;
      if (full) out.push(full);
    });
    return out.join(' ');
  }

  tokens(s: string): string[] {
    const c = this.canon(s);
    return c ? c.split(' ') : [];
  }
}

/** 'D' isolado (= geo_canon no SQL): último token ou antes de algarismo fica 'D' (ruas com letra: "Rua Projetada D",
 *  "Viela 6 D"); antes de vogal sai (elisão: D'Avila, Olho d'Água); antes de consoante vira 'DOM' ("Av. D. Pedro I").
 *  "D. Maria" (Dona) também vira DOM: o título fica fora do núcleo, então o casamento pelo núcleo não muda. */
export function dWord(next: string | undefined): string {
  if (!next) return 'D';
  if (/^[AEIOU]/.test(next)) return '';
  if (/^[0-9]/.test(next)) return 'D';
  return 'DOM';
}

// Fallback mínimo (se a migration 0116 ainda não rodou). O normal é carregar geo_abbrev.
const FALLBACK: [string, string][] = [
  ['AV', 'AVENIDA'], ['R', 'RUA'], ['AL', 'ALAMEDA'], ['EST', 'ESTRADA'], ['ROD', 'RODOVIA'], ['TV', 'TRAVESSA'],
  ['PC', 'PRACA'], ['PCA', 'PRACA'], ['DR', 'DOUTOR'], ['PROF', 'PROFESSOR'], ['ENG', 'ENGENHEIRO'], ['STA', 'SANTA'],
  ['STO', 'SANTO'], ['JD', 'JARDIM'], ['VL', 'VILA'], ['PQ', 'PARQUE'], ['DE', ''], ['DA', ''], ['DO', ''], ['DAS', ''], ['DOS', ''],
];

let canonCache: { at: number; value: Promise<Canon> } | null = null;

export function getCanon(): Promise<Canon> {
  if (canonCache && Date.now() - canonCache.at < 3600_000) return canonCache.value;
  const value = (async () => {
    try {
      const r = await query<{ abbr: string; full_word: string }>('select abbr, full_word from geo_abbrev');
      if (r.rows.length) return new Canon(new Map(r.rows.map((x) => [x.abbr, x.full_word])));
    } catch { /* tabela ausente */ }
    return new Canon(new Map(FALLBACK));
  })();
  canonCache = { at: Date.now(), value };
  value.catch(() => { canonCache = null; });
  return value;
}

/** Tipos de logradouro (forma canônica). Primeira palavra do trecho da rua → tipo. */
export const TYPE_WORDS = new Set([
  'RUA', 'AVENIDA', 'ALAMEDA', 'ESTRADA', 'RODOVIA', 'TRAVESSA', 'PRACA', 'LARGO', 'VIADUTO', 'VIELA', 'PASSAGEM',
  'BECO', 'LADEIRA', 'ESCADARIA', 'PONTE', 'ACESSO', 'MARGINAL', 'VIA', 'CAMINHO', 'SERVIDAO', 'TUNEL', 'BOULEVARD',
  'CONTORNO', 'RAMAL', 'ESTRADINHA', 'ANEL', 'TREVO', 'COMPLEXO', 'ENTRADA', 'PATIO', 'CALCADAO', 'PASSARELA',
]);

/** Palavras de título (forma canônica) que o cadastro guarda à parte do nome ("DOUTOR" + "GASTAO VIDIGAL"). */
export const TITLE_WORDS = new Set([
  'DOUTOR', 'DOUTORA', 'PROFESSOR', 'PROFESSORA', 'ENGENHEIRO', 'ENGENHEIRA', 'SAO', 'SANTA', 'SANTO', 'DONA', 'DOM',
  'PRESIDENTE', 'SOLDADO', 'PAPA', 'SARGENTO', 'CABO', 'BRIGADEIRO', 'PADRE', 'NOSSA', 'SENHORA', 'SENHOR', 'CAPITAO',
  'TERCEIRO', 'SEGUNDO', 'PRIMEIRO', 'CORONEL', 'CONSUL', 'SENADOR', 'MADAME', 'PREFEITO', 'TENENTE', 'AVIADOR',
  'VEREADOR', 'COMENDADOR', 'VISCONDE', 'CONEGO', 'BARAO', 'GENERAL', 'MARECHAL', 'ALMIRANTE', 'MAJOR', 'GOVERNADOR',
  'DEPUTADO', 'MINISTRO', 'DESEMBARGADOR', 'MONSENHOR', 'FREI', 'IRMA', 'IRMAO', 'MAESTRO', 'ARQUITETO', 'JORNALISTA',
  'CONSELHEIRO', 'DUQUE', 'CONDE', 'MARQUES', 'PRINCESA', 'PRINCIPE', 'IMPERADOR', 'BISPO', 'CARDEAL', 'PASTOR',
  'DELEGADO', 'JUIZ', 'COMANDANTE', 'EMBAIXADOR', 'VIGARIO', 'CADETE', 'MESTRE', 'DEPUTADA', 'VEREADORA', 'PREFEITA',
  'ENFERMEIRA', 'APOSTOLO', 'BEATO', 'BEATA',
]);

export const UF_CODES = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

const MONTHS = new Set(['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO']);
export function isMonth(tok: string | undefined) { return !!tok && MONTHS.has(tok); }

// ----------------------------------------------------------------------------------------------
// Exibição
// ----------------------------------------------------------------------------------------------
const LOWER = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'a', 'o']);
const DISPLAY_EXPAND: Record<string, string> = { JD: 'Jardim', VL: 'Vila', PQ: 'Parque', CJ: 'Conjunto', RES: 'Residencial', CH: 'Chácara', STA: 'Santa', STO: 'Santo', NSRA: 'Nossa Senhora' };

/** "AVENIDA DOUTOR GASTAO VIDIGAL" → "Avenida Doutor Gastao Vidigal" (o CNEFE vem sem acento). */
export function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const up = w.toUpperCase();
      if (DISPLAY_EXPAND[up]) return DISPLAY_EXPAND[up];
      if (i > 0 && LOWER.has(w)) return w;
      if (/^[ivx]+$/.test(w) && w.length <= 4) return up; // algarismos romanos (Pedro II)
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export function fmtCep(cep: number | string | null | undefined): string | undefined {
  if (cep === null || cep === undefined || cep === '') return undefined;
  const s = String(cep).replace(/\D/g, '').padStart(8, '0');
  return s.length === 8 ? `${s.slice(0, 5)}-${s.slice(5)}` : undefined;
}

/** similaridade de trigramas no estilo do pg_trgm (para listas pequenas em memória) */
export function trigramSim(a: string, b: string): number {
  const tg = (s: string) => {
    const set = new Set<string>();
    for (const w of s.split(' ')) {
      if (!w) continue;
      const p = `  ${w} `;
      for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    }
    return set;
  };
  const A = tg(a);
  const B = tg(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}

/** Palavras que indicam destino de carga (terminal, CD, armazém...) — ordenam os estabelecimentos "s/n". */
const CARGO_RE = /\b(TERMINA|PORT[OU]|ARMAZ|LOGIST|TRANSPORT|DISTRIBUI|ENTREPOSTO|ALFANDEG|PATIO|GALPA|INDUSTRI|FABRICA|ATACAD|CEAGESP|CORREIOS|TECON|CONT[AE]INER|GRANE|CARGA|DEPOSITO|FRIGORIF|USINA|REDEX|EADI|CD|CENTRAL|COMPANHIA|CIA|LTDA|S A)\b/;
const GENERIC_RE = /^(VAGO|SEM NOME|BAR|LANCHONETE|BORRACHARIA|CASA|RESIDENCIA|GARAGEM|IGREJA|COMERCIO|LOJA|OFICINA|SALAO|TERRENO VAGO|EM CONSTRUCAO|DEPOSITO)$/;
export function cargoRank(estab: string): number {
  const n = normBasic(estab);
  if (GENERIC_RE.test(n)) return -1;
  return (CARGO_RE.test(n) ? 2 : 0) + (n.length >= 12 ? 0.5 : 0);
}

// ----------------------------------------------------------------------------------------------
// Números por extenso: o CNEFE grava "RUA VINTE E CINCO DE MARCO", o usuário digita "Rua 25 de Março" (e vice-versa).
// A busca tenta as duas formas (variantes), sem mexer na base.
// ----------------------------------------------------------------------------------------------
const UNI = ['', 'UM', 'DOIS', 'TRES', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE', 'DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE',
  'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE'];
const DEZ = ['', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA'];
const CEN = ['', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS'];
const WORD_VAL = new Map<string, number>([
  ...UNI.map((w, i) => [w, i] as [string, number]).filter(([w]) => w),
  ...DEZ.map((w, i) => [w, i * 10] as [string, number]).filter(([w]) => w),
  ...CEN.map((w, i) => [w, i * 100] as [string, number]).filter(([w]) => w),
  ['CEM', 100], ['UMA', 1], ['DUAS', 2], ['CATORZE', 14], ['DUZENTAS', 200], ['TREZENTAS', 300],
]);

export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 9999) return String(n);
  const mil = Math.floor(n / 1000);
  const rest = n % 1000;
  let r = rest;
  let low = '';
  if (r === 100) low = 'CEM';
  else if (r) {
    const c = Math.floor(r / 100);
    r %= 100;
    const sub: string[] = [];
    if (c) sub.push(CEN[c]);
    if (r >= 20) { sub.push(DEZ[Math.floor(r / 10)]); if (r % 10) sub.push(UNI[r % 10]); } else if (r) sub.push(UNI[r]);
    low = sub.join(' E ');
  }
  if (!mil) return low;
  const head = mil === 1 ? 'MIL' : `${numberToWords(mil)} MIL`;
  if (!low) return head;
  // "mil e vinte", "mil e quinhentos", mas "mil novecentos e trinta e dois"
  return `${head}${rest < 100 || rest % 100 === 0 ? ' E ' : ' '}${low}`;
}

/** "VINTE E CINCO MARCO" → "25 MARCO"; "MIL NOVECENTOS E TRINTA E DOIS" → "1932" */
export function wordsToDigits(text: string): string {
  const toks = text.split(' ');
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    if (!WORD_VAL.has(toks[i]) && toks[i] !== 'MIL') { out.push(toks[i]); i++; continue; }
    let total = 0, cur = 0, j = i, used = false;
    while (j < toks.length) {
      const t = toks[j];
      if (t === 'MIL') { total += (cur || 1) * 1000; cur = 0; used = true; j++; continue; }
      if (WORD_VAL.has(t)) { cur += WORD_VAL.get(t)!; used = true; j++; continue; }
      if (t === 'E' && j + 1 < toks.length && (WORD_VAL.has(toks[j + 1]) || toks[j + 1] === 'MIL') && used) { j++; continue; }
      break;
    }
    out.push(String(total + cur));
    i = j;
  }
  return out.join(' ');
}

/** Variantes da busca com números por extenso/algarismos ("1 MAIO" também vira "PRIMEIRO MAIO"). */
export function numberVariants(text: string): string[] {
  const vs = new Set<string>([text]);
  if (/\b\d+\b/.test(text)) {
    vs.add(text.split(' ').map((t, i, a) => (/^\d+$/.test(t) ? (t === '1' && isMonth(a[i + 1]) ? 'PRIMEIRO' : numberToWords(Number(t))) : t)).join(' '));
  }
  const d = wordsToDigits(text.replace(/\bPRIMEIRO (?=(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\b)/, 'UM '));
  if (d !== text) vs.add(d);
  return [...vs];
}
