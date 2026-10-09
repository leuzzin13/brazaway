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

  /** = geo_canon: troca abreviações pela palavra canônica e remove preposições */
  canon(s: string): string {
    const out: string[] = [];
    for (const tok of normBasic(s).split(' ')) {
      if (!tok) continue;
      const full = this.map.has(tok) ? this.map.get(tok)! : tok;
      if (full) out.push(full);
    }
    return out.join(' ');
  }

  tokens(s: string): string[] {
    const c = this.canon(s);
    return c ? c.split(' ') : [];
  }
}

// Fallback mínimo (se a migration 0116 ainda não rodou). O normal é carregar geo_abbrev.
const FALLBACK: [string, string][] = [
  ['AV', 'AVENIDA'], ['R', 'RUA'], ['AL', 'ALAMEDA'], ['EST', 'ESTRADA'], ['ROD', 'RODOVIA'], ['TV', 'TRAVESSA'],
  ['PC', 'PRACA'], ['PCA', 'PRACA'], ['DR', 'DOUTOR'], ['PROF', 'PROFESSOR'], ['ENG', 'ENGENHEIRO'], ['STA', 'SANTA'],
  ['STO', 'SANTO'], ['JD', 'JARDIM'], ['VL', 'VILA'], ['PQ', 'PARQUE'], ['DE', ''], ['DA', ''], ['DO', ''], ['DAS', ''], ['DOS', ''], ['D', ''],
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
