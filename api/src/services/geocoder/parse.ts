/** Parser de endereço brasileiro em texto livre.
 *
 *  "Avenida Doutor Gastão Vidigal, 1946, Vila Leopoldina, São Paulo - SP, 05316-900"
 *  "av dr gastao vidigal 1946 sp"            "Rua Costa Aguiar 1686 Ipiranga São Paulo"
 *  "Avenida Santos Dumont, s/n, Guarujá"     "Rod. Anhanguera km 30, Cajamar"      "05316-900"
 *
 *  Separa CEP, número (ou s/n, ou km), logradouro (tipo + nome + núcleo sem título), bairro, município e UF.
 *  Não consulta o banco: recebe a normalização (Canon) e o índice de municípios já carregados. */
import { Canon, TITLE_WORDS, TYPE_WORDS, UF_CODES, isMonth, normBasic } from './normalize.js';
import type { Municipio, MunicipioIndex } from './municipios.js';

export interface ParsedStreet {
  /** texto digitado (limpo) */
  text: string;
  /** tipo canônico (RUA, AVENIDA...) se informado */
  tipo?: string;
  /** nome canônico sem o tipo, com título ("DOUTOR GASTAO VIDIGAL") */
  nome: string;
  /** núcleo sem tipo nem título ("GASTAO VIDIGAL") */
  core: string;
}

export interface ParsedAddress {
  raw: string;
  cep?: string;
  numero?: number;
  numeroTexto?: string;
  km?: boolean;
  /** com km: posição em metros ("km 30" = 30000, "km 30,325" = 30325) */
  kmM?: number;
  /** com km: o texto trazia a fração ("km 30,5"); sem ela, "km 30" aceita qualquer ponto entre 30,000 e 30,999 */
  kmFracao?: boolean;
  semNumero?: boolean;
  street?: ParsedStreet;
  bairro?: string;
  bairroTexto?: string;
  municipio?: Municipio;
  /** município deduzido do fim de um texto sem vírgula: só preferência, não filtro */
  municipioFraco?: boolean;
  /** com município fraco: o trecho inteiro, com o nome do município (ex.: "Vila Leopoldina") */
  textoCompleto?: string;
  uf?: string;
  /** trechos não classificados (ex.: nome de empresa) */
  extras: string[];
  /** tem cara de endereço (tipo de logradouro, número, s/n ou km); senão pode ser POI, bairro ou cidade */
  enderecoLike: boolean;
}

const ROAD_PREFIX = new Set([...UF_CODES, 'BR', 'KM', 'SPA', 'SPI', 'SPM', 'RODOVIA']);

/** 30000 → "30"; 30325 → "30,325"; 30500 → "30,5" */
export function fmtKm(m: number): string {
  const km = Math.floor(m / 1000);
  const r = m % 1000;
  return r ? `${km},${String(r).padStart(3, '0').replace(/0+$/, '')}` : String(km);
}

export function parseStreet(text: string, canon: Canon): ParsedStreet | undefined {
  const toks = canon.tokens(text);
  if (!toks.length) return undefined;
  let tipo: string | undefined;
  let name = toks;
  if (toks.length > 1 && TYPE_WORDS.has(toks[0])) {
    tipo = toks[0];
    name = toks.slice(1);
  }
  let coreToks = name;
  while (coreToks.length > 1 && TITLE_WORDS.has(coreToks[0])) coreToks = coreToks.slice(1);
  return { text: text.trim(), tipo, nome: name.join(' '), core: coreToks.join(' ') };
}

export function parseAddress(q: string, canon: Canon, munis: MunicipioIndex): ParsedAddress {
  const out: ParsedAddress = { raw: q, extras: [], enderecoLike: false };
  let s = ` ${q.replace(/\s+/g, ' ').trim()} `;

  // CEP (com ou sem hífen/ponto)
  const cepM = s.match(/(?:\bCEP\b[:\s]*)?\b(\d{5})[-.\s]?(\d{3})\b/i);
  if (cepM) {
    out.cep = cepM[1] + cepM[2];
    s = s.replace(cepM[0], ' , ');
  }
  s = s.replace(/\bCEP\b:?/gi, ' ');

  // sem número
  const snRe = /(^|[\s,;(])(s\s*\/\s*n[º°o.]?|s\.\s*n\.?|sn|s\/numero|sem\s+n[uú]mero)(?=$|[\s,;).])/i;
  if (snRe.test(s)) {
    out.semNumero = true;
    s = s.replace(snRe, '$1 , ');
  }

  // km de rodovia ("km 30", "km30,5", "km 30.325")
  const kmM = s.match(/\bkm\s*\.?\s*(\d{1,4})(?:[.,](\d{1,3}))?\b/i);
  if (kmM) {
    out.km = true;
    out.numero = Number(kmM[1]);
    const frac = kmM[2] ? Number(kmM[2].padEnd(3, '0')) : 0;
    out.kmM = out.numero * 1000 + frac;
    out.kmFracao = !!kmM[2];
    out.numeroTexto = `km ${fmtKm(out.kmM)}`;
    s = s.replace(kmM[0], ' , ');
  }

  // "nº 1946", "n. 1946", "número 1946"
  if (out.numero === undefined) {
    const nM = s.match(/\b(?:n[º°o]\.?|n\.|num\.?|n[uú]mero)\s*(\d{1,6})\s?([a-z])?\b/i);
    if (nM) {
      out.numero = Number(nM[1]);
      out.numeroTexto = nM[1] + (nM[2] ? nM[2].toUpperCase() : '');
      s = s.replace(nM[0], ' , ');
    }
  }
  s = s.replace(/[º°ª]/g, ' ');

  let parts = s
    .split(/\s*[,;|/]\s*|\s+[-–—]\s+|\s+[-–—]|[-–—]\s+/)
    .map((p) => p.trim())
    .filter((p) => normBasic(p).length > 0);

  // número como parte isolada ("..., 1946, ...") — só depois do primeiro trecho
  if (out.numero === undefined) {
    for (let i = 1; i < parts.length; i++) {
      const n = normBasic(parts[i]);
      const m = n.match(/^(\d{1,6})(?: ?([A-Z]))?$/);
      if (m) {
        out.numero = Number(m[1]);
        out.numeroTexto = m[1] + (m[2] ?? '');
        parts.splice(i, 1);
        break;
      }
    }
  }

  // número no meio do primeiro trecho ("av dr gastao vidigal 1946 sp")
  if (out.numero === undefined && parts.length) {
    const toks = normBasic(parts[0]).split(' ');
    for (let j = toks.length - 1; j >= 1; j--) {
      const m = toks[j].match(/^(\d{1,6})([A-Z])?$/);
      if (!m) continue;
      if (isMonth(toks[j + 1]) || (toks[j + 1] === 'DE' && isMonth(toks[j + 2]))) continue;   // "25 de Março"
      if (ROAD_PREFIX.has(toks[j - 1])) continue;                                              // "SP 55", "BR 116"
      const before = toks.slice(0, j);
      const beforeCanon = canon.tokens(before.join(' '));
      if (!beforeCanon.length || (beforeCanon.length === 1 && TYPE_WORDS.has(beforeCanon[0]))) continue; // "Rua 2"
      out.numero = Number(m[1]);
      out.numeroTexto = m[1] + (m[2] ?? '');
      const tail = toks.slice(j + 1).join(' ');
      parts = [before.join(' '), ...(tail ? [tail] : []), ...parts.slice(1)];
      break;
    }
  }

  // UF isolada no fim ("..., SP") ou colada ao município ("São Paulo SP")
  const last = parts.length ? normBasic(parts[parts.length - 1]) : '';
  if (parts.length > 1 && UF_CODES.has(last)) {
    out.uf = last;
    parts.pop();
  }

  // município: do fim para o começo, sem olhar o 1º trecho (que é o logradouro)
  for (let i = parts.length - 1; i >= 1 && !out.municipio; i--) {
    let toks = normBasic(parts[i]).split(' ');
    let uf = out.uf;
    if (toks.length > 1 && UF_CODES.has(toks[toks.length - 1])) {
      uf = toks[toks.length - 1];
      toks = toks.slice(0, -1);
    }
    const c = canon.canon(toks.join(' '));
    const m = c ? munis.find(c, uf) : undefined;
    if (m) {
      out.municipio = m;
      out.uf = out.uf ?? uf ?? m.uf;
      parts.splice(i, 1);
      break;
    }
    // sufixo do trecho ("IPIRANGA SAO PAULO" → bairro IPIRANGA + município); nunca dentro de um logradouro ("Rua Itu")
    const ct = c.split(' ').filter(Boolean);
    if (ct.length > 1 && TYPE_WORDS.has(ct[0])) continue;
    for (let k = 1; k < ct.length; k++) {
      const mm = munis.find(ct.slice(k).join(' '), uf);
      if (mm) {
        out.municipio = mm;
        out.uf = out.uf ?? uf ?? mm.uf;
        parts[i] = ct.slice(0, k).join(' ');
        break;
      }
    }
  }

  // um trecho só, sem número: pode ser só o município ("Cajamar") ou terminar com ele ("CEAGESP São Paulo")
  if (!out.municipio && parts.length >= 1) {
    let toks = normBasic(parts[0]).split(' ');
    if (toks.length > 1 && UF_CODES.has(toks[toks.length - 1]) && parts.length === 1) {
      const uf = toks[toks.length - 1];
      const rest = toks.slice(0, -1);
      const restCanon = canon.tokens(rest.join(' '));
      // "... SP" no fim do trecho único: é UF, desde que sobre algo que não seja só tipo
      if (restCanon.length && !(restCanon.length === 1 && TYPE_WORDS.has(restCanon[0]))) {
        out.uf = out.uf ?? uf;
        toks = rest;
        parts[0] = rest.join(' ');
      }
    }
    const ct = canon.tokens(toks.join(' '));
    const whole = ct.length ? munis.find(ct.join(' '), out.uf) : undefined;
    if (whole && parts.length === 1 && out.numero === undefined && !out.semNumero) {
      out.municipio = whole;
      out.uf = out.uf ?? whole.uf;
      parts = [];
    } else if (parts.length === 1) {
      for (let k = 1; k < ct.length; k++) {
        const prefix = ct.slice(0, k);
        if (prefix.every((t) => TYPE_WORDS.has(t) || TITLE_WORDS.has(t))) continue; // "Rua Itu", "Rua São Paulo"
        const mm = munis.find(ct.slice(k).join(' '), out.uf);
        if (mm) {
          // sem vírgula o fim do texto pode ser parte do nome ("Vila Leopoldina", "Shopping Eldorado"): pista fraca,
          // que só dá preferência ao município e não filtra nem muda a UF de referência
          out.municipio = mm;
          out.municipioFraco = true;
          out.textoCompleto = parts[0];
          parts[0] = prefix.join(' ');
          break;
        }
      }
    }
  }

  if (parts.length) {
    // o logradouro é o primeiro trecho que começa com tipo ("Santos Brasil, Av. Santos Dumont, s/n" → nome + rua);
    // sem tipo em nenhum trecho, é o primeiro. Trechos antes dele viram "extras" (nome de empresa/terminal).
    let si = parts.findIndex((x) => { const t = canon.tokens(x); return t.length > 1 && TYPE_WORDS.has(t[0]); });
    if (si < 0) si = 0;
    out.street = parseStreet(parts[si], canon);
    const before = parts.slice(0, si).filter((p) => canon.canon(p));
    const rest = parts.slice(si + 1).filter((p) => canon.canon(p));
    if (rest.length) {
      out.bairroTexto = rest[0];
      out.bairro = canon.canon(rest[0]);
    }
    out.extras = [...before, ...rest.slice(1)];
  }
  out.enderecoLike = !!(out.street?.tipo || out.numero !== undefined || out.semNumero || out.km);
  return out;
}
