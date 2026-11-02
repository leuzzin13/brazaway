import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { PADRAO } from '../services/abastecimento.js';
import { asUser, httpError } from './auth.js';

/**
 * Conferência do diesel por placa (conciliação): quanto cada caminhão devia ter gasto no período (km ÷ consumo de
 * referência) contra o que foi comprado, e o que foi comprado fora do plano de abastecimento da viagem e da rede
 * conveniada. Achado da simulação de 90 dias: a frota comprava na rede menos litros do que consumia e a equipe pedia
 * toda semana "puxar no cartão quem abasteceu fora da rede"; desvio de diesel é queixa comum de frota.
 *
 * - km: hodômetro informado nos abastecimentos do período (2 leituras ou mais: última − primeira) ou, sem isso, as
 *   viagens concluídas no período (a mesma fonte do consumo médio medido, consumoMedio em routes.ts). Com hodômetro,
 *   conferem-se só os litros comprados depois da primeira leitura até a última: o primeiro abastecimento repôs o que
 *   foi gasto antes dela.
 * - consumo de referência: cadastro do veículo, senão o padrão do tipo de caminhão (PADRAO do plano de abastecimento).
 *   O consumo medido (90 dias) vai só como informação: o medido já carrega o desvio que se quer achar.
 * - abastecimento sem placa entra no veículo da viagem ou, sem viagem, no veículo padrão do motorista.
 * - fora do plano: abastecimento de viagem com plano (trips.plano_abastecimento) num posto que não é parada do plano
 *   nem conveniado ativo; sobrepreço = (preço pago − menor preço entre as paradas do plano, ou o preço médio da rota do
 *   plano) × litros, quando positivo.
 * Tudo agregado no banco (poucas consultas, em paralelo, qualquer tamanho de frota). A permissão (equipe da empresa) é conferida com
 * RLS; as somas rodam fora dela, com a empresa filtrada em toda tabela: a política por linha custava ~0,3 ms por linha
 * (as 5 mil viagens da frota de 100 caminhões da simulação levavam 1,5 s só para serem lidas).
 */

const Query = z.object({
  dias: z.coerce.number().int().min(7).max(365).default(30),
  vehicle_id: z.string().uuid().optional(),
  tolerancia_pct: z.coerce.number().min(0).max(100).default(8),
  detalhe: z.enum(['true', 'false', '1', '0']).optional().transform((v) => v === 'true' || v === '1'),
});

const DIAS_MEDIDO = 90;          // janela do consumo medido (informativo)
const DIF_MIN_L = 100;           // abaixo disso a diferença não vira alerta, qualquer que seja o %
const FORA_MAX = 0.2;            // fatia dos litros fora do plano que vira alerta
const KM_SEM_REGISTRO = 300;     // rodou isso sem nenhum abastecimento registrado → alerta

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw httpError(422, `entrada inválida: ${r.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
}

/**
 * Abastecimentos de diesel (sem ARLA) da empresa na janela maior (período ou 90 dias), com o veículo atribuído e as
 * marcas de conferência. $1 = dias do período, $2 = vehicle_id (ou null), $3 = empresa (toda tabela filtrada por ela).
 */
const BASE = `
with conv as (select cnpj from postos_conveniados where company_id = $3::uuid and ativo),
ab0 as (
  select a.id, a.ocorrido_em, a.driver_id, a.trip_id, a.litros::float8 as litros, a.valor_cents, a.posto_nome, a.posto_cnpj,
         a.odometro_km::float8 as odometro_km,
         coalesce(a.vehicle_id, t.vehicle_id, m.default_vehicle_id) as vehicle_id,
         (a.vehicle_id is null and t.vehicle_id is null and m.default_vehicle_id is not null) as pelo_motorista,
         a.ocorrido_em > now() - make_interval(days => $1::int) as no_periodo,
         case when a.valor_cents is null then null else a.valor_cents / 100.0 / a.litros end as preco,
         p.cnpjs, p.preco_ref,
         coalesce(p.cnpjs is not null and (cardinality(p.cnpjs) > 0 or p.preco_ref is not null), false) as com_plano,
         exists (select 1 from conv where conv.cnpj = a.posto_cnpj) as conveniado
    from abastecimentos a
    left join trips t on t.id = a.trip_id and t.company_id = a.company_id
    left join company_members m on m.user_id = a.driver_id and m.company_id = a.company_id
    left join lateral (
      select coalesce(array_agg(regexp_replace(x->>'cnpj', '\\D', '', 'g')) filter (where jsonb_typeof(x->'cnpj') = 'string'), '{}') as cnpjs,
             coalesce(min((x->>'preco_rs_l')::numeric) filter (where jsonb_typeof(x->'preco_rs_l') = 'number'),
                      case when jsonb_typeof(t.plano_abastecimento->'preco_medio_rota_rs_l') = 'number'
                           then (t.plano_abastecimento->>'preco_medio_rota_rs_l')::numeric end) as preco_ref
        from jsonb_array_elements(case when jsonb_typeof(t.plano_abastecimento->'paradas') = 'array'
                                       then t.plano_abastecimento->'paradas' else '[]'::jsonb end) x
    ) p on t.plano_abastecimento is not null
   where a.company_id = $3::uuid and a.combustivel <> 'arla32'
     and a.ocorrido_em > now() - make_interval(days => greatest($1::int, ${DIAS_MEDIDO}))
),
ab1 as (
  select ab0.*, com_plano and coalesce(posto_cnpj = any(cnpjs), false) as no_plano,
         com_plano and posto_cnpj is not null and not coalesce(posto_cnpj = any(cnpjs), false) and not conveniado as fora
    from ab0 where $2::uuid is null or vehicle_id = $2::uuid
),
ab2 as (
  select ab1.*, (case when fora and preco is not null and preco_ref is not null then greatest(0, preco - preco_ref) * litros else 0 end)::float8 as sobrepreco
    from ab1
),
odo0 as (
  select vehicle_id, count(*)::int as leituras,
         (array_agg(odometro_km order by ocorrido_em, id))[1] as odo_ini,
         (array_agg(odometro_km order by ocorrido_em desc, id desc))[1] as odo_fim,
         min(ocorrido_em) as t_ini, max(ocorrido_em) as t_fim
    from ab2 where no_periodo and odometro_km is not null and vehicle_id is not null group by vehicle_id
),
-- hodômetro vale com 2 leituras ou mais, em horários diferentes, e a última maior que a primeira
odo as (select odo0.*, leituras >= 2 and t_fim > t_ini and odo_fim > odo_ini as valido from odo0),
ab as (
  select ab2.*, coalesce(o.valido, false) as hodometro, o.leituras, o.odo_ini, o.odo_fim, o.t_ini, o.t_fim,
         ab2.no_periodo and (not coalesce(o.valido, false) or (ab2.ocorrido_em > o.t_ini and ab2.ocorrido_em <= o.t_fim)) as conferido
    from ab2 left join odo o on o.vehicle_id = ab2.vehicle_id
)`;

/** somas do período comuns a veículo e motorista */
const SOMAS = `
  count(*) filter (where no_periodo)::int as abastecimentos,
  coalesce(sum(litros) filter (where no_periodo), 0)::float8 as litros,
  coalesce(sum(valor_cents) filter (where no_periodo), 0)::float8 as valor_cents,
  coalesce(sum(litros) filter (where no_periodo and valor_cents is not null), 0)::float8 as litros_com_valor,
  count(*) filter (where no_periodo and fora)::int as fora_n,
  coalesce(sum(litros) filter (where no_periodo and fora), 0)::float8 as fora_l,
  coalesce(sum(valor_cents) filter (where no_periodo and fora), 0)::float8 as fora_cents,
  coalesce(sum(sobrepreco) filter (where no_periodo), 0)::float8 as sobrepreco,
  count(*) filter (where no_periodo and posto_cnpj is null)::int as sem_cnpj_n,
  coalesce(sum(litros) filter (where no_periodo and posto_cnpj is null), 0)::float8 as sem_cnpj_l`;

type Somas = { abastecimentos: number; litros: number; valor_cents: number; litros_com_valor: number; fora_n: number; fora_l: number;
  fora_cents: number; sobrepreco: number; sem_cnpj_n: number; sem_cnpj_l: number };
type Alerta = { tipo: 'consumo_acima' | 'consumo_abaixo' | 'fora_do_plano' | 'sem_hodometro' | 'sem_registro'; mensagem: string };

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number, casas = 0) => x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function consumoRef(v: { preset: string | null; consumo_km_l: number | null } | undefined) {
  if (v?.consumo_km_l) return { km_l: v.consumo_km_l, fonte: 'cadastro do veículo' };
  return { km_l: (PADRAO[v?.preset ?? ''] ?? PADRAO.truck).consumo_km_l, fonte: 'estimativa do tipo de caminhão' };
}

/** diferença, valor e alertas de uma placa ou de um motorista */
function conferir(x: { km: number; esperados: number; conferidos: number; s: Somas; preco: number | null; hodometro?: boolean },
                  tol: number) {
  const dif = x.conferidos - x.esperados;
  const pct = x.esperados > 0 ? (dif / x.esperados) * 100 : null;
  const valorDif = x.preco !== null ? dif * x.preco : null;
  const alertas: Alerta[] = [];
  if (x.km > KM_SEM_REGISTRO && x.s.abastecimentos === 0) {
    alertas.push({ tipo: 'sem_registro', mensagem: `Rodou ${fmt(x.km)} km sem nenhum abastecimento registrado: confira no cartão onde abasteceu.` });
  } else if (pct !== null && pct > tol && dif > DIF_MIN_L) {
    alertas.push({ tipo: 'consumo_acima', mensagem: `Comprou ${fmt(dif)} L (${fmt(pct, 1)}%) a mais do que o esperado para ${fmt(x.km)} km: confira desvio de diesel ou consumo fora do normal.` });
  } else if (pct !== null && pct < -tol && dif < -DIF_MIN_L) {
    alertas.push({ tipo: 'consumo_abaixo', mensagem: `Comprou ${fmt(-dif)} L (${fmt(-pct, 1)}%) a menos do que o esperado para ${fmt(x.km)} km: há abastecimento sem registro (fora da rede?). Puxe no cartão.` });
  }
  if (x.s.litros > 0 && x.s.fora_l > FORA_MAX * x.s.litros) {
    alertas.push({ tipo: 'fora_do_plano', mensagem: `${fmt((x.s.fora_l / x.s.litros) * 100)}% dos litros (${fmt(x.s.fora_l)} L) comprados fora do plano da viagem e da rede conveniada${x.s.sobrepreco > 0 ? `, R$ ${fmt(x.s.sobrepreco, 2)} acima do preço do plano` : ''}.` });
  }
  if (x.hodometro === false && x.s.abastecimentos > 0) {
    alertas.push({ tipo: 'sem_hodometro', mensagem: 'Menos de duas leituras de hodômetro válidas nos abastecimentos: os km vêm das viagens concluídas. Peça o hodômetro em todo abastecimento.' });
  }
  const valor_em_risco_rs = Math.max(0, valorDif ?? 0) + x.s.sobrepreco;
  return {
    litros_esperados: r1(x.esperados), diferenca_l: r1(dif), diferenca_pct: pct === null ? null : r1(pct),
    valor_diferenca_rs: valorDif === null ? null : r2(valorDif), valor_em_risco_rs: r2(valor_em_risco_rs), alertas,
  };
}

const foraDo = (s: Somas) => ({ abastecimentos: s.fora_n, litros: r1(s.fora_l), valor_rs: r2(s.fora_cents / 100), sobrepreco_rs: r2(s.sobrepreco) });
const semCnpj = (s: Somas) => ({ abastecimentos: s.sem_cnpj_n, litros: r1(s.sem_cnpj_l) });
const precoMedio = (s: Pick<Somas, 'valor_cents' | 'litros_com_valor'>) => (s.litros_com_valor > 0 ? s.valor_cents / 100 / s.litros_com_valor : null);

function item(a: Record<string, any>) {
  const marcas: string[] = [];
  if (!a.posto_cnpj) marcas.push('sem_cnpj');
  if (a.conveniado) marcas.push('conveniado');
  if (a.no_plano) marcas.push('no_plano');
  if (a.fora) marcas.push('fora_do_plano');
  if (!a.com_plano) marcas.push('sem_plano');
  if (a.sobrepreco > 0) marcas.push('sobrepreco');
  if (a.pelo_motorista) marcas.push('veiculo_do_motorista');
  if (a.hodometro && !a.conferido) marcas.push(a.antes_do_hodometro ? 'antes_do_hodometro' : 'depois_do_hodometro');
  return {
    id: a.id, ocorrido_em: a.ocorrido_em, driver_id: a.driver_id, driver_name: a.driver_name, trip_id: a.trip_id,
    litros: a.litros, valor_rs: a.valor_cents === null ? null : a.valor_cents / 100, preco_rs_l: a.preco === null ? null : r2(a.preco),
    posto_nome: a.posto_nome, posto_cnpj: a.posto_cnpj, odometro_km: a.odometro_km,
    preco_ref_rs_l: a.preco_ref === null ? null : r2(a.preco_ref), sobrepreco_rs: r2(a.sobrepreco), marcas,
  };
}

async function conciliacao(cid: string, q: z.infer<typeof Query>) {
  const p = [q.dias, q.vehicle_id ?? null, cid];
  // consultas independentes, em paralelo (cada uma num cliente do pool)
  const [veics, membros, viagens, porVeic, porMot, itens] = await Promise.all([
    pool.query(`select v.id, v.plate, v.label, v.preset, v.consumo_km_l::float8 as consumo_km_l, v.status
                  from vehicles v where v.company_id = $1 and ($2::uuid is null or v.id = $2::uuid)`, [cid, q.vehicle_id ?? null]),
    pool.query(`select user_id, display_name, default_vehicle_id from company_members where company_id = $1`, [cid]),
    // km: a mesma fonte do consumo médio medido (viagens concluídas, distance_m, pelo fim da viagem)
    pool.query(
      `select t.vehicle_id, t.driver_id,
              (coalesce(sum(t.distance_m) filter (where t.ended_at > now() - make_interval(days => $1::int)), 0) / 1000.0)::float8 as km,
              (coalesce(sum(t.distance_m) filter (where t.ended_at > now() - make_interval(days => ${DIAS_MEDIDO})), 0) / 1000.0)::float8 as km_90
         from trips t
        where t.company_id = $3::uuid and t.status = 'concluida'
          and t.ended_at > now() - make_interval(days => greatest($1::int, ${DIAS_MEDIDO}))
          and ($2::uuid is null or t.vehicle_id = $2::uuid)
        group by t.vehicle_id, t.driver_id`, p),
    pool.query(
      `${BASE}
       select vehicle_id, ${SOMAS},
              coalesce(sum(litros) filter (where conferido), 0)::float8 as litros_conferidos,
              bool_or(hodometro) as hodometro, max(leituras) as leituras, max(odo_ini) as odo_ini, max(odo_fim) as odo_fim,
              count(*) filter (where no_periodo and pelo_motorista)::int as pelo_motorista,
              coalesce(sum(litros) filter (where ocorrido_em > now() - make_interval(days => ${DIAS_MEDIDO})), 0)::float8 as litros_90
         from ab group by vehicle_id`, p),
    pool.query(`${BASE} select driver_id, ${SOMAS} from ab where no_periodo group by driver_id`, p),
    q.detalhe ? pool.query(
      `${BASE}
       select ab.id, ab.vehicle_id, ab.ocorrido_em, ab.driver_id, m.display_name as driver_name, ab.trip_id, ab.litros, ab.valor_cents,
              ab.preco::float8 as preco, ab.posto_nome, ab.posto_cnpj, ab.odometro_km, ab.preco_ref::float8 as preco_ref, ab.sobrepreco,
              ab.com_plano, ab.no_plano, ab.fora, ab.conveniado, ab.pelo_motorista, ab.hodometro, ab.conferido,
              ab.ocorrido_em <= ab.t_ini as antes_do_hodometro
         from ab left join company_members m on m.user_id = ab.driver_id and m.company_id = $3::uuid
        where ab.no_periodo order by ab.vehicle_id, ab.ocorrido_em, ab.id`, p) : null,
  ]).then(([v, m, t, pv, pm, it]) => [v.rows, m.rows, t.rows as { vehicle_id: string | null; driver_id: string | null; km: number; km_90: number }[],
                                      pv.rows, pm.rows, it?.rows ?? []] as const);
  if (q.vehicle_id && !veics.length) throw httpError(404, 'veículo não encontrado');

  const veicPorId = new Map(veics.map((v) => [v.id as string, v]));
  const membroPorId = new Map(membros.map((m) => [m.user_id as string, m]));
  const vazio: Somas = { abastecimentos: 0, litros: 0, valor_cents: 0, litros_com_valor: 0, fora_n: 0, fora_l: 0, fora_cents: 0, sobrepreco: 0, sem_cnpj_n: 0, sem_cnpj_l: 0 };
  const somaDe = (rows: Record<string, any>[], chave: string) => new Map<string | null, any>(rows.map((r) => [r[chave] as string | null, r]));
  const abVeic = somaDe(porVeic, 'vehicle_id');
  const total = porVeic.reduce((t, r) => ({ valor_cents: t.valor_cents + r.valor_cents, litros_com_valor: t.litros_com_valor + r.litros_com_valor }), { valor_cents: 0, litros_com_valor: 0 });
  const precoFrota = precoMedio(total);
  const itensDe = new Map<string | null, ReturnType<typeof item>[]>();
  for (const a of itens) {
    const k = a.vehicle_id as string | null;
    if (!itensDe.has(k)) itensDe.set(k, []);
    itensDe.get(k)!.push(item(a));
  }

  // ---- por veículo
  const kmVeic = new Map<string, { km: number; km_90: number }>();
  for (const t of viagens) {
    if (!t.vehicle_id) continue;
    const k = kmVeic.get(t.vehicle_id) ?? { km: 0, km_90: 0 };
    k.km += t.km; k.km_90 += t.km_90;
    kmVeic.set(t.vehicle_id, k);
  }
  const veiculos = veics
    .filter((v) => q.vehicle_id || (kmVeic.get(v.id)?.km ?? 0) > 0 || (abVeic.get(v.id)?.abastecimentos ?? 0) > 0)
    .map((v) => {
      const s: Somas & Record<string, any> = abVeic.get(v.id) ?? { ...vazio, litros_conferidos: 0, hodometro: false, leituras: 0, pelo_motorista: 0, litros_90: 0 };
      const viag = kmVeic.get(v.id) ?? { km: 0, km_90: 0 };
      const ref = consumoRef(v);
      const hod = !!s.hodometro;
      const km = hod ? Number(s.odo_fim) - Number(s.odo_ini) : viag.km;
      const preco = precoMedio(s) ?? precoFrota;
      const conf = conferir({ km, esperados: km / ref.km_l, conferidos: s.litros_conferidos, s, preco, hodometro: hod }, q.tolerancia_pct);
      return {
        vehicle_id: v.id, plate: v.plate, label: v.label, preset: v.preset,
        km: r1(km), km_fonte: hod ? 'hodometro' as const : 'viagens' as const, km_viagens: r1(viag.km),
        hodometro: s.leituras ? { leituras: s.leituras, inicial_km: s.odo_ini, final_km: s.odo_fim } : null,
        consumo_ref_km_l: ref.km_l, consumo_fonte: ref.fonte,
        consumo_medido_km_l: viag.km_90 >= 300 && s.litros_90 >= 100 ? r2(viag.km_90 / s.litros_90) : null,
        abastecimentos: s.abastecimentos, litros_comprados: r1(s.litros), litros_conferidos: r1(s.litros_conferidos),
        valor_rs: r2(s.valor_cents / 100), preco_medio_rs_l: preco === null ? null : r2(preco),
        ...conf,
        fora_do_plano: foraDo(s), sem_cnpj: semCnpj(s), atribuidos_pelo_motorista: s.pelo_motorista,
        ...(q.detalhe ? { detalhe: itensDe.get(v.id) ?? [] } : {}),
      };
    })
    .sort((a, b) => b.valor_em_risco_rs - a.valor_em_risco_rs || b.alertas.length - a.alertas.length || String(a.plate).localeCompare(String(b.plate)));

  // ---- por motorista (km das viagens dele, com o consumo de referência do veículo de cada viagem)
  const kmMot = new Map<string, { km: number; esperados: number }>();
  for (const t of viagens) {
    if (!t.driver_id) continue;
    const k = kmMot.get(t.driver_id) ?? { km: 0, esperados: 0 };
    const vid = t.vehicle_id ?? membroPorId.get(t.driver_id)?.default_vehicle_id ?? null;
    k.km += t.km; k.esperados += t.km / consumoRef(vid ? veicPorId.get(vid) : undefined).km_l;
    kmMot.set(t.driver_id, k);
  }
  const abMot = somaDe(porMot, 'driver_id');
  const ids = new Set<string>([...kmMot.keys(), ...porMot.map((r) => r.driver_id).filter((x): x is string => !!x)]);
  const por_motorista = [...ids]
    .map((id) => {
      const s: Somas = abMot.get(id) ?? vazio;
      const k = kmMot.get(id) ?? { km: 0, esperados: 0 };
      if (k.km === 0 && s.abastecimentos === 0) return null;
      const preco = precoMedio(s) ?? precoFrota;
      return {
        driver_id: id, nome: membroPorId.get(id)?.display_name ?? null, km: r1(k.km),
        abastecimentos: s.abastecimentos, litros_comprados: r1(s.litros), valor_rs: r2(s.valor_cents / 100),
        ...conferir({ km: k.km, esperados: k.esperados, conferidos: s.litros, s, preco }, q.tolerancia_pct),
        fora_do_plano: foraDo(s), sem_cnpj: semCnpj(s),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.valor_em_risco_rs - a.valor_em_risco_rs || b.alertas.length - a.alertas.length || b.litros_comprados - a.litros_comprados);

  // ---- resumo (abastecimento que não deu para ligar a placa nenhuma entra nos totais e em sem_veiculo)
  const semVeic: Somas = abVeic.get(null) ?? vazio;
  const soma = (f: (v: (typeof veiculos)[number]) => number) => veiculos.reduce((t, v) => t + f(v), 0);
  const tot = [...abVeic.values()].reduce((t: Somas, s) => {
    for (const k of Object.keys(vazio) as (keyof Somas)[]) t[k] += Number(s[k] ?? 0);
    return t;
  }, { ...vazio });
  const alertas: Record<Alerta['tipo'], number> = { consumo_acima: 0, consumo_abaixo: 0, fora_do_plano: 0, sem_hodometro: 0, sem_registro: 0 };
  for (const v of veiculos) for (const a of v.alertas) alertas[a.tipo] += 1;
  const dias = q.dias;
  return {
    dias, tolerancia_pct: q.tolerancia_pct, vehicle_id: q.vehicle_id ?? null,
    nota: `Litros esperados = km ÷ consumo de referência (cadastro do veículo ou, sem cadastro, o padrão do tipo de caminhão). `
      + `Os km vêm do hodômetro informado nos abastecimentos (com duas leituras ou mais; aí só contam os litros comprados depois da primeira leitura até a última) `
      + `ou, sem isso, das viagens concluídas. O nível do tanque no começo e no fim do período não é conhecido (nem o diesel de uma viagem ainda em andamento), `
      + `por isso a diferença só vira alerta acima de ${fmt(q.tolerancia_pct, 1)}% e de ${DIF_MIN_L} L. Diferença positiva: comprou mais do que devia gastar `
      + `(desvio ou consumo fora do normal); negativa: abasteceu sem registrar (puxe no cartão). Fora do plano: abastecimento de viagem com plano num posto que não é `
      + `parada do plano nem conveniado; sem CNPJ não dá para conferir. Abastecimento sem placa entra no veículo da viagem ou, sem viagem, no veículo padrão do motorista.`,
    resumo: {
      veiculos: veiculos.length, veiculos_com_alerta: veiculos.filter((v) => v.alertas.length).length, alertas,
      km: r1(soma((v) => v.km)), litros_esperados: r1(soma((v) => v.litros_esperados)),
      litros_comprados: r1(tot.litros), valor_rs: r2(tot.valor_cents / 100), preco_medio_rs_l: precoFrota === null ? null : r2(precoFrota),
      diferenca_l: r1(soma((v) => v.diferenca_l)), valor_diferenca_rs: r2(soma((v) => v.valor_diferenca_rs ?? 0)),
      fora_do_plano: foraDo(tot), sem_cnpj: semCnpj(tot),
      sem_veiculo: { abastecimentos: semVeic.abastecimentos, litros: r1(semVeic.litros), valor_rs: r2(semVeic.valor_cents / 100),
                     ...(q.detalhe ? { detalhe: itensDe.get(null) ?? [] } : {}) },
      valor_em_risco_rs: r2(soma((v) => v.valor_em_risco_rs) + semVeic.sobrepreco),
    },
    veiculos,
    por_motorista,
  };
}

export async function conciliacaoRoutes(api: FastifyInstance) {
  // conciliação do diesel por placa: só a equipe (motorista → 403)
  api.get('/conciliacao-diesel', async (req) => {
    const cid = await asUser(req, async (c) => {
      const r = (await c.query('select app.is_staff() as ok, app.company_id() as cid')).rows[0];
      if (!r.ok) throw httpError(403, 'apenas a equipe da empresa (owner, admin ou gestor)');
      return r.cid as string;
    });
    return conciliacao(cid, parse(Query, req.query));
  });
}
