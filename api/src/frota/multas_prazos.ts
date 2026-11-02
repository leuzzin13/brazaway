import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { env } from '../config.js';
import { pool } from '../db.js';
import { asUser, httpError } from './auth.js';

/**
 * Prazos das multas no automático. Achado da simulação de 90 dias: a equipe passou as 13 semanas correndo atrás do prazo
 * de indicação do condutor, e perder o prazo gera para a empresa a multa por não identificação (NIC).
 *
 * Regras (CTB):
 * - indicação do condutor: 30 dias a partir da notificação da autuação (art. 257 §7, redação da Lei 14.071/2020). O
 *   prazo é preenchido pelo banco a partir de `notificada_em` (trigger app.multas_prazos, migration 0406);
 * - NIC (art. 257 §8): a multa original multiplicada pelo número de infrações iguais cometidas em 12 meses. Estimativa:
 *   multas da empresa (menos as canceladas) com o mesmo enquadramento, ou a mesma `restricao` quando o enquadramento
 *   falta, nos 365 dias antes da ocorrência, contando ela;
 * - pagamento até o vencimento: 80% do valor (art. 284); 60% com o SNE (art. 284 §1º: empresa aderida ao Sistema de
 *   Notificação Eletrônica, multa notificada por ele e sem recurso); depois do vencimento, 100%. Sem `vencimento`, vale o
 *   `prazo_pagamento` antigo (0402).
 *
 * A indicação em lote só muda o status e devolve o formulário pronto para imprimir: o BrasaWay não envia nada ao órgão.
 * As listas de prazos conferem a permissão com RLS (equipe da empresa) e somam fora dela, com a empresa filtrada em toda
 * tabela (a contagem de infrações iguais lê a tabela de multas uma vez por multa listada).
 */

const SNE_PCT = 60;          // art. 284 §1º
const ATE_VENC_PCT = 80;     // art. 284
const STATUS_ABERTO = ['registrada', 'notificada'];

type Db = pg.PoolClient;

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw httpError(422, `entrada inválida: ${r.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
}

async function requireStaff(c: Db) {
  const r = await c.query('select app.is_staff() as ok');
  if (!r.rows[0].ok) throw httpError(403, 'apenas a equipe da empresa (owner, admin ou gestor)');
}

const hojeLocal = () => DateTime.now().setZone(env.tz).toISODate()!;
/** AAAA-MM-DD → dd/mm/aaaa */
const dataBr = (d: string) => d.split('-').reverse().join('/');
const horaLocal = (t: Date | string | null) => (t ? DateTime.fromJSDate(new Date(t)).setZone(env.tz).toISO() : null);

const IndicarBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });
const PrazosQuery = z.object({ dias: z.coerce.number().int().min(7).max(90).default(15) });
const SneBody = z.object({ aderida: z.boolean() });

/** multas abertas com prazo de indicação até hoje + $3 dias e sem indicação; $1 empresa, $2 hoje */
const SQL_INDICACAO = `
select x.id, x.status::text as status, x.driver_id, m.display_name as driver_name, x.vehicle_id, v.plate as vehicle_plate,
       x.ait, x.orgao, x.enquadramento, x.restricao, x.gravidade::text as gravidade, x.valor_cents, x.ocorrida_em,
       x.notificada_em::text as notificada_em, x.prazo_indicacao::text as prazo_indicacao,
       (x.prazo_indicacao - $2::date)::int as dias_restantes,
       greatest(1, (select count(*) from multas y
                     where y.company_id = x.company_id and y.status <> 'cancelada'
                       and y.ocorrida_em <= x.ocorrida_em and y.ocorrida_em > x.ocorrida_em - interval '365 days'
                       and case when x.enquadramento is not null then lower(btrim(y.enquadramento)) = lower(btrim(x.enquadramento))
                                when x.restricao is not null then y.restricao = x.restricao
                                else y.id = x.id end))::int as infracoes_iguais_12m
  from multas x
  left join company_members m on m.user_id = x.driver_id and m.company_id = x.company_id
  left join vehicles v on v.id = x.vehicle_id and v.company_id = x.company_id
 where x.company_id = $1 and x.status::text = any($4::text[]) and x.prazo_indicacao is not null
   and x.condutor_indicado_em is null and x.prazo_indicacao <= $2::date + $3::int
 order by x.prazo_indicacao, x.ocorrida_em, x.id`;

/** multas não pagas nem canceladas com vencimento (ou prazo_pagamento); $1 empresa, $2 hoje */
const SQL_PAGAMENTO = `
select x.id, x.status::text as status, x.driver_id, m.display_name as driver_name, x.vehicle_id, v.plate as vehicle_plate,
       x.ait, x.orgao, x.enquadramento, x.valor_cents, x.sne, x.ocorrida_em,
       coalesce(x.vencimento, x.prazo_pagamento)::text as vencimento,
       (coalesce(x.vencimento, x.prazo_pagamento) - $2::date)::int as dias_para_vencer
  from multas x
  left join company_members m on m.user_id = x.driver_id and m.company_id = x.company_id
  left join vehicles v on v.id = x.vehicle_id and v.company_id = x.company_id
 where x.company_id = $1 and x.status not in ('paga', 'cancelada') and coalesce(x.vencimento, x.prazo_pagamento) is not null
 order by coalesce(x.vencimento, x.prazo_pagamento), x.ocorrida_em, x.id`;

export async function multasPrazosRoutes(api: FastifyInstance) {
  // Indica o condutor em lote: cada multa aberta (registrada/notificada) com motorista vira 'condutor_indicado' (o banco
  // grava quando e quem) e volta com o formulário para imprimir e colher a assinatura.
  api.post('/multas/indicar-condutor', (req) => asUser(req, async (c) => {
    await requireStaff(c);
    const ids = [...new Set(parse(IndicarBody, req.body ?? {}).ids)];
    const feitas = new Set((await c.query<{ id: string }>(
      `update multas set status = 'condutor_indicado'
        where id = any($1::uuid[]) and driver_id is not null and status in ('registrada', 'notificada') returning id`, [ids])).rows.map((r) => r.id));
    const rows = (await c.query(
      `select x.id, x.status::text as status, x.driver_id, m.display_name as condutor, v.plate as placa, x.ait, x.orgao, x.ocorrida_em,
              x.local, x.enquadramento, x.prazo_indicacao::text as prazo_indicacao
         from multas x left join company_members m on m.user_id = x.driver_id left join vehicles v on v.id = x.vehicle_id
        where x.id = any($1::uuid[])`, [ids])).rows;
    const porId = new Map(rows.map((x) => [x.id as string, x]));
    const hoje = hojeLocal();
    const items = ids.map((id) => {
      const x = porId.get(id);
      if (!x) return { id, ok: false, motivo: 'não encontrada', formulario: null };   // não existe ou é de outra empresa (RLS)
      const ok = feitas.has(id);
      const motivo = ok ? undefined
        : x.status === 'condutor_indicado' ? 'já indicada'
        : !STATUS_ABERTO.includes(x.status) ? `status ${x.status}`
        : !x.driver_id ? 'sem condutor' : 'não alterada';
      if (!x.driver_id) return { id, ok, motivo, formulario: null };
      const prazo: string | null = x.prazo_indicacao;
      return {
        id, ok, motivo,
        formulario: {
          condutor: x.condutor, placa: x.placa, ait: x.ait, orgao: x.orgao, ocorrida_em: horaLocal(x.ocorrida_em), local: x.local,
          enquadramento: x.enquadramento, prazo_indicacao: prazo,
          instrucao: `Imprima, colha a assinatura do condutor e envie ao órgão autuador ${prazo ? `até ${dataBr(prazo)}` : 'dentro do prazo da notificação'}. O BrasaWay não envia ao órgão.`,
          ...(prazo && prazo < hoje ? { aviso: `O prazo de indicação venceu em ${dataBr(prazo)}: o órgão pode recusar a indicação e cobrar da empresa a multa por não identificação (NIC).` } : {}),
        },
      };
    });
    return { indicadas: feitas.size, items };
  }));

  // Prazos: indicação do condutor (vencida, até 7 dias, até N dias) com a NIC estimada, e pagamento com o desconto possível.
  api.get('/multas/prazos', async (req) => {
    const q = parse(PrazosQuery, req.query);
    const co = await asUser(req, async (c) => {
      await requireStaff(c);
      return (await c.query(`select id, sne_aderida_em::text as sne_aderida_em from companies where id = app.company_id()`)).rows[0] as
        { id: string; sne_aderida_em: string | null };
    });
    const hoje = hojeLocal();
    const [ind, pag] = await Promise.all([
      pool.query(SQL_INDICACAO, [co.id, hoje, q.dias, STATUS_ABERTO]),
      pool.query(SQL_PAGAMENTO, [co.id, hoje]),
    ]);

    const grupoN = `ate_${q.dias}_dias`;
    const indicacao: Record<string, unknown[]> = { vencida: [], ate_7_dias: [], [grupoN]: [] };
    let nicRisco = 0;
    for (const x of ind.rows) {
      const grupo = x.dias_restantes < 0 ? 'vencida' : x.dias_restantes <= 7 ? 'ate_7_dias' : grupoN;
      const nic = x.valor_cents === null ? null : x.valor_cents * x.infracoes_iguais_12m;
      nicRisco += nic ?? 0;
      indicacao[grupo].push({ ...x, ocorrida_em: horaLocal(x.ocorrida_em), grupo, tem_condutor: !!x.driver_id, nic_estimado_cents: nic });
    }

    const sneAderida = co.sne_aderida_em !== null;
    let aPagar = 0, economia = 0, economiaSne = 0;
    const pagamento = pag.rows.map((x) => {
      const vencida = x.dias_para_vencer < 0;
      const comSne = sneAderida && x.sne && x.status !== 'em_recurso';
      const pct = vencida ? 100 : comSne ? SNE_PCT : ATE_VENC_PCT;
      const valor: number | null = x.valor_cents;
      const aPagarX = valor === null ? null : Math.round((valor * pct) / 100);
      const economiaX = valor === null ? null : valor - aPagarX!;
      // a mais com o SNE: multa ainda no prazo, sem recurso, que hoje sairia por 80%
      const maisSne = valor !== null && !vencida && !comSne && x.status !== 'em_recurso' ? aPagarX! - Math.round((valor * SNE_PCT) / 100) : 0;
      aPagar += aPagarX ?? 0; economia += economiaX ?? 0; economiaSne += maisSne;
      return {
        ...x, ocorrida_em: horaLocal(x.ocorrida_em), vencida, percentual: pct,
        desconto: vencida ? 'vencida: valor cheio' : comSne ? 'SNE: 40% de desconto até o vencimento' : '20% de desconto até o vencimento',
        valor_a_pagar_cents: aPagarX, economia_cents: economiaX, economia_sne_possivel_cents: maisSne,
      };
    });

    return {
      hoje, dias: q.dias, indicacao, pagamento,
      resumo: {
        vencidas: indicacao.vencida.length, ate_7_dias: indicacao.ate_7_dias.length, [grupoN]: indicacao[grupoN].length,
        nic_risco_cents: nicRisco, a_pagar_cents: aPagar, economia_cents: economia,
        economia_sne_possivel_cents: economiaSne, sne_aderida: sneAderida, sne_aderida_em: co.sne_aderida_em,
      },
    };
  });

  // Adesão ao SNE (owner, admin ou gestor): grava a data de hoje (ou mantém a da primeira adesão); false limpa.
  api.patch('/empresa/sne', (req) => asUser(req, async (c) => {
    await requireStaff(c);
    const b = parse(SneBody, req.body ?? {});
    const em = (await c.query('select app.set_sne($1)::text as em', [b.aderida])).rows[0].em as string | null;
    return { sne_aderida: em !== null, sne_aderida_em: em };
  }));
}
