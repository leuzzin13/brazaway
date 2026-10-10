import { DateTime } from 'luxon';
import { query } from '../db.js';
import { env } from '../config.js';

export interface Holiday {
  id?: string;
  name: string;
  scope: string;
  uf?: string | null;
  ibge_code?: string | null;
  legal_basis?: string | null;
  source_url?: string | null;
  confidence?: string | null;
}
export interface Suspension { scope: string; applies_to_heavy: boolean; description: string | null; period?: string | null; source_url?: string | null; raw_text?: string | null }

export interface LegalDayInfo {
  /** feriado (nacional, estadual da UF do município ou municipal do município informado) */
  holiday: Holiday | null;
  /** todos os feriados do dia (ex.: 20/11 é nacional e municipal em SP) */
  holidays: Holiday[];
  /** suspensões publicadas (CET) vigentes no instante */
  suspensions: Suspension[];
}

export const SAO_PAULO_IBGE = '3550308';

/** UF pelo código IBGE do município (2 primeiros dígitos = código da UF). */
const UF_BY_IBGE_PREFIX: Record<string, string> = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};
export function ufFromIbge(ibge?: string | null): string | null {
  return ibge && /^\d{7}$/.test(ibge) ? UF_BY_IBGE_PREFIX[ibge.slice(0, 2)] ?? null : null;
}

/**
 * Erro de coluna ausente (Postgres 42703, undefined_column): banco sem a migration que criou a coluna.
 * Só esse erro autoriza a consulta antiga, sem o filtro `active` (num banco sem a 0202 ainda não há linha desativada).
 * Outro erro (conexão que caiu, tempo limite) não pode cair na consulta sem filtro: segue adiante e vira dia comum
 * (o lado seguro: a regra "exceto feriados" continua valendo).
 */
export function isMissingColumn(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '42703';
}
/** `.catch(onlyIfMissingColumn(() => consultaAntiga()))`: repassa qualquer erro que não seja de coluna ausente. */
export function onlyIfMissingColumn<T>(fallback: () => Promise<T>): (err: unknown) => Promise<T> {
  return (err) => (isMissingColumn(err) ? fallback() : Promise.reject(err));
}

const HOLIDAY_WHERE = `day = $1 and (scope = 'national' or (scope = 'state' and uf = $2) or (scope = 'municipal' and ibge_code = $3))`;
const HOLIDAY_ORDER = `order by case scope when 'national' then 1 when 'state' then 2 else 3 end`;

/**
 * Feriados e suspensões vigentes no instante `at` para o município (default: São Paulo).
 * A UF do feriado estadual vem do parâmetro `uf` ou, sem ele, dos 2 primeiros dígitos do IBGE (33 = RJ: São Jorge, Carnaval
 * e Corpus Christi do RJ; 35 = SP: 9/7). Município desconhecido (IBGE inválido) só recebe os nacionais.
 * Só feriados com active = true (migration 0202): os registrados com confiança baixa ou norma inconstitucional/revogada
 * nunca são aplicados.
 * Feriados: db/seed/0004_holidays.sql (nacionais, SP) e importers/sources/feriados_sudeste.py (RJ, MG, ES e municípios).
 * Suspensões: importers/sources/cet_suspensoes.py. Falha de banco (tabela ausente, conexão, tempo limite) não derruba a
 * rota: devolve dia comum. A consulta sem `active` só roda quando a coluna não existe (isMissingColumn).
 */
export async function legalDayInfo(at: Date, ibgeCode = SAO_PAULO_IBGE, uf?: string | null): Promise<LegalDayInfo> {
  const day = DateTime.fromJSDate(at).setZone(env.tz).toISODate();
  const ufEff = uf ?? ufFromIbge(ibgeCode);
  const params = [day, ufEff, ibgeCode];
  const [h, s] = await Promise.all([
    query<Holiday>(
      `select id::text, name, scope, uf, ibge_code, legal_basis, source_url, confidence from holidays
        where ${HOLIDAY_WHERE} and active ${HOLIDAY_ORDER}`, params)
      // banco sem a migration 0202 (sem active/source_url/confidence): ainda não há linha desativada
      .catch(onlyIfMissingColumn(() => query<Holiday>(`select id::text, name, scope, uf, ibge_code, legal_basis from holidays where ${HOLIDAY_WHERE} ${HOLIDAY_ORDER}`, params)))
      // banco sem a migration 0101 (sem legal_basis)
      .catch(onlyIfMissingColumn(() => query<Holiday>(`select name, scope from holidays where ${HOLIDAY_WHERE} ${HOLIDAY_ORDER}`, params)))
      // outro erro: dia comum
      .catch(() => ({ rows: [] as Holiday[] })),
    query<Suspension>(
      `select scope, applies_to_heavy, description, period, source_url, raw_text from rule_suspensions
        where ibge_code = $1 and starts_at <= $2 and ends_at > $2`, [ibgeCode, at.toISOString()])
      .catch(() => query<Suspension>(
        `select scope, applies_to_heavy, description from rule_suspensions
          where ibge_code = $1 and starts_at <= $2 and ends_at > $2`, [ibgeCode, at.toISOString()]))
      .catch(() => ({ rows: [] as Suspension[] })),
  ]);
  return { holiday: h.rows[0] ?? null, holidays: h.rows, suspensions: s.rows };
}

export interface Municipio { ibge: string; nome: string; uf: string }

/**
 * Município (IBGE) de cada ponto, pela malha municipal do IBGE já carregada em data_features:
 * camada geocoding (importador cnefe_municipios: os 1.668 municípios do Sudeste) e, se ela faltar, os limites da
 * camada restricoes_rmsp (39 municípios da Grande SP). Ponto fora das malhas => null.
 * A malha é a 'intermediária' do IBGE: a poucos metros da divisa o município pode sair trocado.
 */
export async function municipiosAt(points: { lat: number; lon: number }[]): Promise<(Municipio | null)[]> {
  if (!points.length) return [];
  const vals = points.map((_, i) => `(${i}, $${2 * i + 1}::float, $${2 * i + 2}::float)`).join(', ');
  const r = await query<{ i: number; ibge: string; nome: string; uf: string | null; pri: number }>(
    `select p.i, coalesce(f.props->>'ibge', f.source_id) as ibge, coalesce(f.props->>'municipio', f.name) as nome,
            f.props->>'uf' as uf, case f.layer_id when 'geocoding' then 1 else 2 end as pri
       from (values ${vals}) as p(i, lon, lat)
       join data_features f
         on ((f.layer_id = 'geocoding' and f.source = 'ibge-malhas') or f.layer_id = 'restricoes_rmsp') and f.kind = 'municipio'
        and ST_Intersects(f.geom, ST_SetSRID(ST_Point(p.lon, p.lat), 4326))
      order by p.i, pri`,
    points.flatMap((p) => [p.lon, p.lat]),
  );
  return points.map((_, i) => {
    const row = r.rows.find((x) => x.i === i && /^\d{7}$/.test(x.ibge));
    return row ? { ibge: row.ibge, nome: row.nome, uf: row.uf ?? ufFromIbge(row.ibge) ?? '' } : null;
  });
}

export interface EndpointHolidays {
  municipio: Municipio;
  /** 'origem', 'destino' ou os dois (mesmo município e mesmo dia) */
  pontos: ('origem' | 'destino')[];
  /** dia avaliado (AAAA-MM-DD, fuso da API): o da saída para a origem, o da chegada prevista para o destino */
  day: string;
  /** o dia é o da chegada prevista ao destino e difere do dia de saída */
  chegada: boolean;
  /**
   * Feriados do dia nesse município: estaduais e municipais; no dia da chegada (diferente do da saída) também os
   * nacionais, porque o aviso 'holiday' do routing.ts só fala do dia de saída.
   */
  holidays: Holiday[];
}

type Pt = { lat: number; lon: number };
const isoDay = (t: Date) => DateTime.fromJSDate(t).setZone(env.tz).toISODate() as string;

/**
 * Feriados no município da origem, no dia da saída (`at`), e no do destino, no dia da chegada prevista
 * (`opts.arrivalAt`; sem ele, o dia da saída). É o que a rota precisa saber do município para o aviso: as regras
 * locais com "exceto feriados" já consultam o feriado do próprio município da regra (legalDayInfo(at, ibge) nas
 * camadas). `opts.municipios` evita refazer a busca espacial quando o chamador já tem [origem, destino].
 * Falha de banco devolve lista vazia.
 */
export async function endpointHolidays(
  at: Date, origin: Pt, destination: Pt,
  opts: { arrivalAt?: Date; municipios?: (Municipio | null)[] } = {},
): Promise<EndpointHolidays[]> {
  const [o, d] = opts.municipios ?? await municipiosAt([origin, destination]).catch(() => [null, null]);
  const depDay = isoDay(at);
  const groups = new Map<string, { e: EndpointHolidays; when: Date }>();
  for (const [m, ponto, when] of [[o, 'origem', at], [d, 'destino', opts.arrivalAt ?? at]] as const) {
    if (!m) continue;
    const day = isoDay(when);
    const cur = groups.get(`${m.ibge}:${day}`);
    if (cur) { cur.e.pontos.push(ponto); continue; }
    groups.set(`${m.ibge}:${day}`, { e: { municipio: m, pontos: [ponto], day, chegada: day !== depDay, holidays: [] }, when });
  }
  await Promise.all([...groups.values()].map(async ({ e, when }) => {
    const info = await legalDayInfo(when, e.municipio.ibge, e.municipio.uf || undefined);
    e.holidays = e.chegada ? info.holidays : info.holidays.filter((h) => h.scope !== 'national');
  }));
  return [...groups.values()].map((g) => g.e).filter((e) => e.holidays.length);
}
