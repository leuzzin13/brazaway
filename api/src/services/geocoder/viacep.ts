/** ViaCEP (https://viacep.com.br) — SÓ para CEP ausente de cep_centroid (grandes usuários "-9xx", CEPs novos).
 *  Devolve logradouro/complemento/bairro/município; NÃO dá coordenada (o ponto sai da cascata do CNEFE).
 *  Resposta guardada em cep_lookup_cache (encontrado: 180 dias; não encontrado: 7 dias) para não martelar o serviço,
 *  que é gratuito, sem SLA e avisa que uso massivo pode bloquear. Desligar: VIACEP_URL= (vazio). */
import { query } from '../../db.js';

export interface ViaCep {
  cep: string; logradouro?: string; complemento?: string; unidade?: string; bairro?: string; localidade?: string; uf?: string; ibge?: string;
}

const BASE = process.env.VIACEP_URL ?? 'https://viacep.com.br';
const TIMEOUT_MS = Number(process.env.VIACEP_TIMEOUT_MS ?? 3500);

export async function viacepLookup(cep: string): Promise<ViaCep | null> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8 || !BASE) return null;
  const n = Number(digits);
  try {
    const c = await query<{ found: boolean; payload: ViaCep | null; age_d: number }>(
      `select found, payload, extract(epoch from now() - fetched_at) / 86400 as age_d from cep_lookup_cache where cep = $1`, [n]);
    const row = c.rows[0];
    if (row && ((row.found && row.age_d < 180) || (!row.found && row.age_d < 7))) return row.found ? row.payload : null;
  } catch { /* migration ausente: segue sem cache */ }

  let payload: ViaCep | null = null;
  let ok = false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE.replace(/\/$/, '')}/ws/${digits}/json/`, { signal: ctl.signal, headers: { 'user-agent': 'truck-router-mvp' } });
    clearTimeout(t);
    if (res.ok) {
      const j = (await res.json()) as ViaCep & { erro?: boolean | string };
      ok = true;
      payload = j && !j.erro ? j : null;
    } else if (res.status === 400 || res.status === 404) {
      ok = true;
    }
  } catch { /* rede/timeout: não grava cache */ }
  if (ok) {
    await query(
      `insert into cep_lookup_cache (cep, found, payload, fetched_at) values ($1, $2, $3, now())
       on conflict (cep) do update set found = excluded.found, payload = excluded.payload, fetched_at = now()`,
      [n, !!payload, payload ? JSON.stringify(payload) : null]).catch(() => undefined);
  }
  return payload;
}
