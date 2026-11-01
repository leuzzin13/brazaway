import type Anthropic from '@anthropic-ai/sdk';
import { DateTime } from 'luxon';
import type pg from 'pg';
import { z } from 'zod';
import { env } from '../config.js';
import { RouteRequest, VehicleInput } from '../schemas.js';
import { computeRoute } from '../services/routing.js';
import { httpError, withRls, type Claims } from './auth.js';
import { vectorLiteral, type Embedder } from './brain.js';

/**
 * Tools do Mentor de Logística.
 *
 *  - LEITURA: consultas SQL fixas e parametrizadas (o modelo escolhe a consulta e os parâmetros validados por zod; nunca
 *    escreve SQL). Rodam com a RLS do gestor (withRls com as claims dele), além do filtro explícito por empresa.
 *  - AÇÃO: NÃO executam. Gravam agent_actions com status 'proposta' (requires_confirmation = true); quem executa é
 *    POST /api/frota/mentor/actions/:id/confirm (executeAction), depois que o gestor confirma.
 */

const TZ = 'America/Sao_Paulo';
export const MAX_TOOL_RESULT_CHARS = 14_000;

export interface ToolCtx {
  claims: Claims;
  userId: string;
  companyId: string;
  role: string;
  conversationId: string;
  embedder: Embedder;
  route: typeof computeRoute;
}

export interface ToolDef {
  name: string;
  kind: 'read' | 'action';
  description: string;
  schema: Anthropic.Tool['input_schema'];
  zod: z.ZodTypeAny;
  run(ctx: ToolCtx, args: any): Promise<unknown>;
}

const SERVICE: Claims = { role: 'service_role' };
const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const Uuid = z.string().uuid();
const Local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'use YYYY-MM-DDTHH:mm (horário de Brasília)');
const Lat = z.number().min(-90).max(90);
const Lon = z.number().min(-180).max(180);

// ------------------------------------------------------------------ utilitários de esquema JSON (para o modelo)
const S = {
  str: (description: string, extra: object = {}) => ({ type: 'string', description, ...extra }),
  int: (description: string) => ({ type: 'integer', description }),
  num: (description: string) => ({ type: 'number', description }),
  obj: (properties: Record<string, unknown>, required: string[] = []) =>
    ({ type: 'object' as const, properties, required, additionalProperties: false }),
};
const DIA_DESC = 'data no formato YYYY-MM-DD (fuso de Brasília)';
const PERIODO_PROPS = { inicio: S.str(`início do período, ${DIA_DESC}. Padrão: 30 dias atrás.`), fim: S.str(`fim do período (inclusive), ${DIA_DESC}. Padrão: hoje.`) };

function periodo(a: { inicio?: string; fim?: string }) {
  const hoje = DateTime.now().setZone(TZ).startOf('day');
  const fim = a.fim ? DateTime.fromISO(a.fim, { zone: TZ }) : hoje;
  const ini = a.inicio ? DateTime.fromISO(a.inicio, { zone: TZ }) : fim.minus({ days: 29 });
  if (!ini.isValid || !fim.isValid) throw httpError(400, 'data inválida (use YYYY-MM-DD)');
  if (ini > fim) throw httpError(400, 'o início do período é depois do fim');
  if (fim.diff(ini, 'days').days > 366) throw httpError(400, 'período máximo de 366 dias');
  return { from: ini.startOf('day').toUTC().toISO()!, to: fim.plus({ days: 1 }).startOf('day').toUTC().toISO()!, inicio: ini.toISODate()!, fim: fim.toISODate()! };
}
const num = (v: unknown) => (v == null ? null : Number(v));

// ------------------------------------------------------------------ tools de leitura

const PeriodoZ = { inicio: Dia.optional(), fim: Dia.optional() };

const readTools: ToolDef[] = [
  {
    name: 'listar_cadastros', kind: 'read',
    description: 'Lista motoristas (ativos), veículos ou viagens da empresa, com os ids que as outras tools e as ações exigem. Use SEMPRE antes de propor uma ação, para resolver nomes e placas em ids. Para viagens, filtre por status se quiser.',
    schema: S.obj({
      tipo: S.str('o que listar', { enum: ['motoristas', 'veiculos', 'viagens'] }),
      status: S.str('só para viagens: planejada, atribuida, em_andamento, concluida ou cancelada', { enum: ['planejada', 'atribuida', 'em_andamento', 'concluida', 'cancelada'] }),
      limite: S.int('máximo de linhas (padrão 40, máximo 100)'),
    }, ['tipo']),
    zod: z.object({ tipo: z.enum(['motoristas', 'veiculos', 'viagens']), status: z.enum(['planejada', 'atribuida', 'em_andamento', 'concluida', 'cancelada']).optional(), limite: z.number().int().min(1).max(100).optional() }).strict(),
    async run(ctx, a) {
      const lim = a.limite ?? 40;
      return withRls(ctx.claims, async (c) => {
        if (a.tipo === 'motoristas') {
          const r = await c.query(
            `select m.user_id as motorista_id, m.display_name as nome, m.phone as telefone, m.default_vehicle_id as veiculo_padrao_id, v.plate as veiculo_padrao_placa,
                    (select count(*)::int from trips t where t.driver_id = m.user_id and t.status = 'em_andamento') as viagens_em_andamento
               from company_members m left join vehicles v on v.id = m.default_vehicle_id
              where m.company_id = app.company_id() and m.role = 'motorista' and m.status = 'active' order by m.display_name limit $1`, [lim]);
          return { motoristas: r.rows };
        }
        if (a.tipo === 'veiculos') {
          const r = await c.query(
            `select id as veiculo_id, plate as placa, label as apelido, preset as perfil, height_m::float8 as altura_m, weight_t::float8 as pbt_t, payload_t::float8 as carga_t, status::text as status
               from vehicles where company_id = app.company_id() order by plate limit $1`, [lim]);
          return { veiculos: r.rows };
        }
        const r = await c.query(
          `select t.id as viagem_id, t.title as titulo, t.status::text as status, m.display_name as motorista, t.driver_id as motorista_id, v.plate as placa,
                  t.origin_label as origem, t.destination_label as destino, t.departure_planned_at as saida_planejada,
                  (select count(*)::int from deliveries d where d.trip_id = t.id) as entregas
             from trips t left join company_members m on m.user_id = t.driver_id left join vehicles v on v.id = t.vehicle_id
            where t.company_id = app.company_id() and ($1::text is null or t.status::text = $1)
            order by t.created_at desc limit $2`, [a.status ?? null, lim]);
        return { viagens: r.rows };
      });
    },
  },
  {
    name: 'kpi_atrasos_por_motorista', kind: 'read',
    description: 'Atrasos por motorista no período: entregas feitas FORA da janela (entregues depois do fim da janela), falhas de entrega e pendentes já vencidas. O período filtra pela data da entrega (ou fim da janela, se ainda pendente).',
    schema: S.obj({ ...PERIODO_PROPS, limite: S.int('máximo de motoristas (padrão 20)') }),
    zod: z.object({ ...PeriodoZ, limite: z.number().int().min(1).max(100).optional() }).strict(),
    async run(ctx, a) {
      const p = periodo(a);
      return withRls(ctx.claims, async (c) => {
        const r = await c.query(
          `with base as (
             select t.driver_id, d.status::text as status, d.window_end,
                    case when d.status = 'entregue' and d.window_end is not null and d.status_at > d.window_end
                         then extract(epoch from d.status_at - d.window_end) / 60 end as atraso_min
               from deliveries d join trips t on t.id = d.trip_id
              where d.company_id = app.company_id() and t.status <> 'cancelada'
                and coalesce(d.status_at, d.window_end) >= $1 and coalesce(d.status_at, d.window_end) < $2)
           select b.driver_id as motorista_id, coalesce(m.display_name, '(sem motorista)') as motorista,
                  count(*)::int as entregas_total,
                  count(*) filter (where b.status = 'entregue')::int as entregues,
                  count(*) filter (where b.atraso_min is not null)::int as fora_da_janela,
                  round(avg(b.atraso_min) filter (where b.atraso_min is not null))::int as atraso_medio_min,
                  round(max(b.atraso_min))::int as atraso_maximo_min,
                  count(*) filter (where b.status = 'falhou')::int as falhas,
                  count(*) filter (where b.status = 'pendente' and b.window_end < now())::int as pendentes_vencidas
             from base b left join company_members m on m.user_id = b.driver_id
            group by 1, 2 order by fora_da_janela desc, falhas desc, entregas_total desc limit $3`, [p.from, p.to, a.limite ?? 20]);
        return { periodo: { inicio: p.inicio, fim: p.fim }, motoristas: r.rows };
      });
    },
  },
  {
    name: 'kpi_tempo_parado', kind: 'read',
    description: 'Tempo parado no período (paradas com saída registrada), agrupado por tipo de parada (entrega, descanso, abastecimento, pernoite, imprevisto, nao_classificada), por local (endereço ou região de ~100 m) ou por motorista.',
    schema: S.obj({ ...PERIODO_PROPS, agrupar_por: S.str('agrupamento', { enum: ['tipo', 'local', 'motorista'] }), limite: S.int('máximo de linhas (padrão 20)') }, ['agrupar_por']),
    zod: z.object({ ...PeriodoZ, agrupar_por: z.enum(['tipo', 'local', 'motorista']), limite: z.number().int().min(1).max(100).optional() }).strict(),
    async run(ctx, a) {
      const p = periodo(a);
      const key = a.agrupar_por === 'tipo' ? `s.type::text` : a.agrupar_por === 'motorista' ? `coalesce(m.display_name, '(sem nome)')`
        : `coalesce(nullif(s.address, ''), round(ST_Y(s.geom)::numeric, 3)::text || ', ' || round(ST_X(s.geom)::numeric, 3)::text)`;
      return withRls(ctx.claims, async (c) => {
        const r = await c.query(
          `select ${key} as grupo, count(*)::int as paradas, round(sum(s.duration_s) / 60.0)::int as total_min,
                  round(avg(s.duration_s) / 60.0)::int as media_min, round(max(s.duration_s) / 60.0)::int as maior_min
             from stops s left join company_members m on m.user_id = s.driver_id
            where s.company_id = app.company_id() and s.duration_s is not null and s.arrived_at >= $1 and s.arrived_at < $2
            group by 1 order by total_min desc limit $3`, [p.from, p.to, a.limite ?? 20]);
        return { periodo: { inicio: p.inicio, fim: p.fim }, agrupado_por: a.agrupar_por, grupos: r.rows };
      });
    },
  },
  {
    name: 'kpi_km_rodados', kind: 'read',
    description: 'Quilômetros rodados em viagens concluídas no período (distância da rota feita, compactada dos pings), por motorista ou por veículo, com viagens, horas e km planejado para comparação.',
    schema: S.obj({ ...PERIODO_PROPS, agrupar_por: S.str('agrupamento', { enum: ['motorista', 'veiculo'] }) }, ['agrupar_por']),
    zod: z.object({ ...PeriodoZ, agrupar_por: z.enum(['motorista', 'veiculo']) }).strict(),
    async run(ctx, a) {
      const p = periodo(a);
      const key = a.agrupar_por === 'motorista' ? `coalesce(m.display_name, '(sem motorista)')` : `coalesce(v.plate, '(sem veículo)')`;
      return withRls(ctx.claims, async (c) => {
        const r = await c.query(
          `select ${key} as grupo, count(*)::int as viagens, round(sum(t.distance_m) / 1000.0, 1)::float8 as km_rodados,
                  round(sum(t.planned_distance_m) / 1000.0, 1)::float8 as km_planejados, round(sum(t.duration_s) / 3600.0, 1)::float8 as horas
             from trips t left join company_members m on m.user_id = t.driver_id left join vehicles v on v.id = t.vehicle_id
            where t.company_id = app.company_id() and t.status = 'concluida' and t.distance_m is not null
              and coalesce(t.ended_at, t.created_at) >= $1 and coalesce(t.ended_at, t.created_at) < $2
            group by 1 order by km_rodados desc limit 50`, [p.from, p.to]);
        return { periodo: { inicio: p.inicio, fim: p.fim }, agrupado_por: a.agrupar_por, grupos: r.rows };
      });
    },
  },
  {
    name: 'kpi_viagens_por_status', kind: 'read',
    description: 'Quantidade de viagens por status (planejada, atribuida, em_andamento, concluida, cancelada) no período (data de início, saída planejada ou criação).',
    schema: S.obj({ ...PERIODO_PROPS }),
    zod: z.object({ ...PeriodoZ }).strict(),
    async run(ctx, a) {
      const p = periodo(a);
      return withRls(ctx.claims, async (c) => {
        const r = await c.query(
          `select t.status::text as status, count(*)::int as viagens from trips t
            where t.company_id = app.company_id()
              and coalesce(t.started_at, t.departure_planned_at, t.created_at) >= $1 and coalesce(t.started_at, t.departure_planned_at, t.created_at) < $2
            group by 1 order by 2 desc`, [p.from, p.to]);
        return { periodo: { inicio: p.inicio, fim: p.fim }, por_status: r.rows };
      });
    },
  },
  {
    name: 'kpi_desvios_rota', kind: 'read',
    description: 'Viagens concluídas com maior desvio em relação à rota planejada (distância máxima da rota feita à planejada), com km planejado × feito.',
    schema: S.obj({ ...PERIODO_PROPS, desvio_minimo_m: S.int('só desvios a partir deste valor em metros (padrão 0)'), limite: S.int('máximo de viagens (padrão 15)') }),
    zod: z.object({ ...PeriodoZ, desvio_minimo_m: z.number().int().min(0).optional(), limite: z.number().int().min(1).max(50).optional() }).strict(),
    async run(ctx, a) {
      const p = periodo(a);
      return withRls(ctx.claims, async (c) => {
        const r = await c.query(
          `select t.id as viagem_id, t.title as titulo, m.display_name as motorista, v.plate as placa, t.deviation_max_m as desvio_max_m,
                  round(t.planned_distance_m / 1000.0, 1)::float8 as km_planejados, round(t.distance_m / 1000.0, 1)::float8 as km_feitos, t.ended_at as fim
             from trips t left join company_members m on m.user_id = t.driver_id left join vehicles v on v.id = t.vehicle_id
            where t.company_id = app.company_id() and t.status = 'concluida' and t.deviation_max_m is not null and t.deviation_max_m >= $3
              and coalesce(t.ended_at, t.created_at) >= $1 and coalesce(t.ended_at, t.created_at) < $2
            order by t.deviation_max_m desc limit $4`, [p.from, p.to, a.desvio_minimo_m ?? 0, a.limite ?? 15]);
        return { periodo: { inicio: p.inicio, fim: p.fim }, viagens: r.rows };
      });
    },
  },
  {
    name: 'posicao_atual', kind: 'read',
    description: 'Última posição conhecida (live_positions) dos motoristas: coordenadas, velocidade, se está em movimento, viagem e há quantos minutos foi o último ping. Sem motorista_id, lista todos.',
    schema: S.obj({ motorista_id: S.str('id do motorista (de listar_cadastros); omita para todos') }),
    zod: z.object({ motorista_id: Uuid.optional() }).strict(),
    async run(ctx, a) {
      return withRls(ctx.claims, async (c) => {
        const r = await c.query(
          `select lp.driver_id as motorista_id, m.display_name as motorista, v.plate as placa, lp.trip_id as viagem_id, t.title as viagem,
                  round(ST_Y(lp.geom)::numeric, 5)::float8 as lat, round(ST_X(lp.geom)::numeric, 5)::float8 as lon,
                  lp.speed_kmh as velocidade_kmh, lp.moving as em_movimento, lp.recorded_at as registrada_em,
                  round(extract(epoch from now() - lp.recorded_at) / 60)::int as minutos_atras
             from live_positions lp left join company_members m on m.user_id = lp.driver_id
             left join vehicles v on v.id = lp.vehicle_id left join trips t on t.id = lp.trip_id
            where lp.company_id = app.company_id() and ($1::uuid is null or lp.driver_id = $1) order by lp.recorded_at desc limit 100`, [a.motorista_id ?? null]);
        return { posicoes: r.rows };
      });
    },
  },
  {
    name: 'historico_viagem', kind: 'read',
    description: 'Histórico completo de uma viagem: dados, planejado × feito, paradas, entregas (janela, status, atraso) e mensagens trocadas, mais o resumo gerado quando existir.',
    schema: S.obj({ viagem_id: S.str('id da viagem (de listar_cadastros)') }, ['viagem_id']),
    zod: z.object({ viagem_id: Uuid }).strict(),
    async run(ctx, a) {
      return withRls(ctx.claims, async (c) => {
        const t = (await c.query(
          `select t.id as viagem_id, t.title as titulo, t.status::text as status, m.display_name as motorista, v.plate as placa, t.origin_label as origem,
                  t.destination_label as destino, t.departure_planned_at as saida_planejada, t.started_at as inicio, t.ended_at as fim,
                  t.planned_distance_m, t.planned_duration_s, t.distance_m, t.duration_s, t.deviation_max_m, t.summary as resumo
             from trips t left join company_members m on m.user_id = t.driver_id left join vehicles v on v.id = t.vehicle_id
            where t.id = $1 and t.company_id = app.company_id()`, [a.viagem_id])).rows[0];
        if (!t) throw httpError(404, 'viagem não encontrada nesta empresa');
        const stops = (await c.query(
          `select type::text as tipo, source::text as origem, arrived_at as chegada, departed_at as saida, round(duration_s / 60.0)::int as minutos, address as endereco, note as obs
             from stops where trip_id = $1 order by arrived_at limit 60`, [a.viagem_id])).rows;
        const dels = (await c.query(
          `select id as entrega_id, sequence as ordem, customer_name as cliente, address as endereco, status::text as status, window_start as janela_inicio, window_end as janela_fim, status_at as registrada_em,
                  case when status = 'entregue' and window_end is not null and status_at > window_end then round(extract(epoch from status_at - window_end) / 60)::int end as atraso_min,
                  failure_reason as motivo_falha
             from deliveries where trip_id = $1 order by sequence nulls last, created_at limit 60`, [a.viagem_id])).rows;
        const msgs = (await c.query(
          `select ms.created_at as em, s.display_name as de, r.display_name as para, ms.body as texto, (ms.agent_action_id is not null) as via_mentor
             from messages ms left join company_members s on s.user_id = ms.sender_id left join company_members r on r.user_id = ms.recipient_id
            where ms.trip_id = $1 and ms.company_id = app.company_id() order by ms.created_at limit 30`, [a.viagem_id])).rows;
        return { viagem: t, paradas: stops, entregas: dels, mensagens: msgs };
      });
    },
  },
  {
    name: 'status_entregas', kind: 'read',
    description: 'Status das entregas (pendente, entregue, falhou) com janela e atraso. Filtre por viagem, por status e/ou por dia (da janela ou do registro).',
    schema: S.obj({
      viagem_id: S.str('id da viagem'), status: S.str('status', { enum: ['pendente', 'entregue', 'falhou'] }),
      dia: S.str(`dia da janela/registro, ${DIA_DESC}`), limite: S.int('máximo de linhas (padrão 40)'),
    }),
    zod: z.object({ viagem_id: Uuid.optional(), status: z.enum(['pendente', 'entregue', 'falhou']).optional(), dia: Dia.optional(), limite: z.number().int().min(1).max(100).optional() }).strict(),
    async run(ctx, a) {
      const day = a.dia ? periodo({ inicio: a.dia, fim: a.dia }) : null;
      return withRls(ctx.claims, async (c) => {
        const r = await c.query(
          `select d.id as entrega_id, d.trip_id as viagem_id, t.title as viagem, mm.display_name as motorista, d.sequence as ordem, d.customer_name as cliente, d.address as endereco,
                  d.status::text as status, d.window_start as janela_inicio, d.window_end as janela_fim, d.status_at as registrada_em,
                  case when d.status = 'entregue' and d.window_end is not null and d.status_at > d.window_end then round(extract(epoch from d.status_at - d.window_end) / 60)::int end as atraso_min,
                  d.failure_reason as motivo_falha
             from deliveries d join trips t on t.id = d.trip_id left join company_members mm on mm.user_id = t.driver_id
            where d.company_id = app.company_id() and ($1::uuid is null or d.trip_id = $1) and ($2::text is null or d.status::text = $2)
              and ($3::timestamptz is null or (coalesce(d.status_at, d.window_end, d.window_start) >= $3 and coalesce(d.status_at, d.window_end, d.window_start) < $4))
            order by coalesce(d.window_end, d.status_at) desc nulls last limit $5`, [a.viagem_id ?? null, a.status ?? null, day?.from ?? null, day?.to ?? null, a.limite ?? 40]);
        return { entregas: r.rows };
      });
    },
  },
  {
    name: 'buscar_conhecimento', kind: 'read',
    description: 'Busca semântica no Second Brain da empresa (resumos de viagens, entregas que falharam ou atrasaram, conversas anteriores do Mentor). Use para perguntas sobre histórico, causas, padrões e casos parecidos. Devolve os trechos mais próximos com a similaridade (0 a 1).',
    schema: S.obj({
      pergunta: S.str('o que procurar, em linguagem natural'),
      tipos: { type: 'array', items: { type: 'string', enum: ['trip', 'delivery', 'conversation'] }, description: 'restringe os tipos de documento (padrão: todos)' },
      limite: S.int('máximo de trechos (padrão 6, máximo 12)'),
    }, ['pergunta']),
    zod: z.object({ pergunta: z.string().min(2).max(1000), tipos: z.array(z.enum(['trip', 'delivery', 'conversation'])).max(3).optional(), limite: z.number().int().min(1).max(12).optional() }).strict(),
    async run(ctx, a) {
      const [qv] = await ctx.embedder.embed([a.pergunta], 'query');
      const lim = a.limite ?? 6;
      return withRls(ctx.claims, async (c) => {
        const r = await c.query(`select * from app.search_knowledge($1, $2::vector, $3, $4)`, [ctx.companyId, vectorLiteral(qv), lim * 3, a.tipos ?? null]);
        const admin = ctx.role === 'owner' || ctx.role === 'admin';
        // conversas anteriores são privadas do gestor que conversou (admin vê todas)
        const rows = r.rows.filter((d: any) => d.source_type !== 'conversation' || admin || d.metadata?.user_id === ctx.userId).slice(0, lim);
        const stale = (await c.query(`select count(*)::int as n from knowledge_docs where company_id = app.company_id() and embedding_model is distinct from $1`, [ctx.embedder.model])).rows[0].n as number;
        return {
          modelo_embedding: ctx.embedder.model,
          aviso: stale ? `${stale} documento(s) têm embedding de outro modelo ou nenhum e não aparecem na busca até o job do Second Brain rodar.` : undefined,
          resultados: rows.map((d: any) => ({
            tipo: d.source_type, origem_id: d.source_id, titulo: d.title, similaridade: Math.round(d.similarity * 1000) / 1000,
            trecho: String(d.content).length > 1500 ? String(d.content).slice(0, 1500) + '…' : d.content,
          })),
        };
      });
    },
  },
];

// ------------------------------------------------------------------ tools de ação (só PROPÕEM)

const Ponto = z.object({ lat: Lat, lon: Lon, rotulo: z.string().max(200).optional() }).strict();
const PontoSchema = S.obj({ lat: S.num('latitude'), lon: S.num('longitude'), rotulo: S.str('nome/endereço do ponto') }, ['lat', 'lon']);

const CriarViagemZ = z.object({
  titulo: z.string().min(2).max(200),
  veiculo_id: Uuid,
  motorista_id: Uuid.optional(),
  origem: Ponto, destino: Ponto,
  saida_planejada: Local.optional(),
  entregas: z.array(z.object({
    cliente: z.string().min(1).max(200), endereco: z.string().min(1).max(300),
    janela_inicio: z.string().datetime({ offset: true }).optional(), janela_fim: z.string().datetime({ offset: true }).optional(),
    lat: Lat.optional(), lon: Lon.optional(),
  }).strict()).max(40).optional(),
}).strict();
const AtribuirZ = z.object({ viagem_id: Uuid, motorista_id: Uuid, veiculo_id: Uuid.optional() }).strict();
const MensagemZ = z.object({ motorista_id: Uuid, texto: z.string().min(1).max(1500), viagem_id: Uuid.optional() }).strict();
const ReordenarZ = z.object({ viagem_id: Uuid, ordem: z.array(Uuid).min(1).max(100) }).strict();

const PROPOSTA_MSG = 'Ação registrada como PROPOSTA. NADA foi executado. Avise o gestor que ela só será executada depois que ele confirmar (POST /api/frota/mentor/actions/:id/confirm, ou o botão Confirmar do painel); ele também pode rejeitar.';

async function insertProposal(ctx: ToolCtx, tool: string, input: object, resumo: string) {
  const r = await withRls(SERVICE, (c) => c.query(
    // sempre com a empresa e o usuário do gestor autenticado, mesmo gravando como service_role
    `insert into agent_actions (company_id, conversation_id, tool, input, requires_confirmation, status, requested_by)
     values ($1, $2, $3, $4::jsonb, true, 'proposta', $5) returning id, status::text as status`,
    [ctx.companyId, ctx.conversationId, tool, JSON.stringify({ ...input, _resumo: resumo }), ctx.userId]));
  return { acao_id: r.rows[0].id as string, status: r.rows[0].status as string, resumo, aviso: PROPOSTA_MSG };
}

async function motoristaNome(c: pg.PoolClient, id: string): Promise<string> {
  const r = await c.query(`select display_name from company_members where user_id = $1 and company_id = app.company_id() and role = 'motorista' and status = 'active'`, [id]);
  if (!r.rows[0]) throw httpError(400, 'motorista não encontrado na empresa (ou desativado); use listar_cadastros');
  return r.rows[0].display_name;
}
async function veiculoPlaca(c: pg.PoolClient, id: string): Promise<string> {
  const r = await c.query(`select plate from vehicles where id = $1 and company_id = app.company_id() and status = 'active'`, [id]);
  if (!r.rows[0]) throw httpError(400, 'veículo não encontrado na empresa (ou inativo); use listar_cadastros');
  return r.rows[0].plate;
}

const actionTools: ToolDef[] = [
  {
    name: 'propor_criar_viagem', kind: 'action',
    description: 'PROPÕE criar uma viagem com rota calculada pelo roteador interno, respeitando as dimensões, o peso e o perfil do veículo escolhido (restrições, zonas e pontes baixas entram no cálculo). Opcionalmente já atribui a um motorista e cadastra entregas (na ordem). NÃO executa: fica pendente até o gestor confirmar. Use listar_cadastros antes para obter veiculo_id e motorista_id.',
    schema: S.obj({
      titulo: S.str('título da viagem'), veiculo_id: S.str('id do veículo'), motorista_id: S.str('id do motorista (opcional)'),
      origem: PontoSchema, destino: PontoSchema,
      saida_planejada: S.str('saída planejada, YYYY-MM-DDTHH:mm no horário de Brasília (opcional)'),
      entregas: { type: 'array', description: 'entregas na ordem de atendimento (opcional)', items: S.obj({
        cliente: S.str('nome do cliente'), endereco: S.str('endereço'), janela_inicio: S.str('ISO 8601 com fuso, ex.: 2026-10-13T08:00:00-03:00'),
        janela_fim: S.str('ISO 8601 com fuso'), lat: S.num('latitude'), lon: S.num('longitude'),
      }, ['cliente', 'endereco']) },
    }, ['titulo', 'veiculo_id', 'origem', 'destino']),
    zod: CriarViagemZ,
    async run(ctx, a: z.infer<typeof CriarViagemZ>) {
      const { placa, nome } = await withRls(ctx.claims, async (c) => ({
        placa: await veiculoPlaca(c, a.veiculo_id), nome: a.motorista_id ? await motoristaNome(c, a.motorista_id) : null }));
      const resumo = `Criar viagem "${a.titulo}" de ${a.origem.rotulo ?? `${a.origem.lat},${a.origem.lon}`} para ${a.destino.rotulo ?? `${a.destino.lat},${a.destino.lon}`} com o veículo ${placa}`
        + (nome ? `, atribuída a ${nome}` : ', sem motorista') + (a.entregas?.length ? `, com ${a.entregas.length} entrega(s)` : '') + '.';
      return insertProposal(ctx, 'criar_viagem', a, resumo);
    },
  },
  {
    name: 'propor_atribuir_viagem', kind: 'action',
    description: 'PROPÕE atribuir uma viagem planejada/atribuída a um motorista (e opcionalmente trocar o veículo). NÃO executa até o gestor confirmar.',
    schema: S.obj({ viagem_id: S.str('id da viagem'), motorista_id: S.str('id do motorista'), veiculo_id: S.str('id do veículo (opcional)') }, ['viagem_id', 'motorista_id']),
    zod: AtribuirZ,
    async run(ctx, a: z.infer<typeof AtribuirZ>) {
      const info = await withRls(ctx.claims, async (c) => {
        const t = (await c.query(`select title, status::text as status from trips where id = $1 and company_id = app.company_id()`, [a.viagem_id])).rows[0];
        if (!t) throw httpError(400, 'viagem não encontrada nesta empresa');
        if (!['planejada', 'atribuida'].includes(t.status)) throw httpError(400, `viagem ${t.status}: só dá para atribuir viagem planejada ou atribuída`);
        return { titulo: t.title, nome: await motoristaNome(c, a.motorista_id), placa: a.veiculo_id ? await veiculoPlaca(c, a.veiculo_id) : null };
      });
      return insertProposal(ctx, 'atribuir_viagem', a, `Atribuir a viagem "${info.titulo ?? a.viagem_id.slice(0, 8)}" ao motorista ${info.nome}${info.placa ? ` com o veículo ${info.placa}` : ''}.`);
    },
  },
  {
    name: 'propor_enviar_mensagem', kind: 'action',
    description: 'PROPÕE enviar uma mensagem ao motorista (chega no app dele, identificada como enviada pelo Mentor). NÃO envia até o gestor confirmar. Escreva o texto final, claro e curto, em português.',
    schema: S.obj({ motorista_id: S.str('id do motorista'), texto: S.str('texto da mensagem (até 1500 caracteres)'), viagem_id: S.str('id da viagem a que a mensagem se refere (opcional)') }, ['motorista_id', 'texto']),
    zod: MensagemZ,
    async run(ctx, a: z.infer<typeof MensagemZ>) {
      const nome = await withRls(ctx.claims, async (c) => {
        const n = await motoristaNome(c, a.motorista_id);
        if (a.viagem_id && !(await c.query(`select 1 from trips where id = $1 and company_id = app.company_id()`, [a.viagem_id])).rows[0]) throw httpError(400, 'viagem não encontrada nesta empresa');
        return n;
      });
      return insertProposal(ctx, 'enviar_mensagem', a, `Enviar ao motorista ${nome}: "${a.texto.length > 160 ? a.texto.slice(0, 159) + '…' : a.texto}"`);
    },
  },
  {
    name: 'propor_reordenar_entregas', kind: 'action',
    description: 'PROPÕE nova ordem de atendimento das entregas de uma viagem ainda não concluída. `ordem` deve conter TODOS os ids de entrega da viagem (de status_entregas ou historico_viagem), na nova sequência. NÃO executa até o gestor confirmar.',
    schema: S.obj({ viagem_id: S.str('id da viagem'), ordem: { type: 'array', items: { type: 'string' }, description: 'ids das entregas na nova ordem (todas as da viagem)' } }, ['viagem_id', 'ordem']),
    zod: ReordenarZ,
    async run(ctx, a: z.infer<typeof ReordenarZ>) {
      const t = await withRls(ctx.claims, (c) => checkReorder(c, a));
      return insertProposal(ctx, 'reordenar_entregas', a, `Reordenar as ${a.ordem.length} entrega(s) da viagem "${t.title ?? a.viagem_id.slice(0, 8)}".`);
    },
  },
];

async function checkReorder(c: pg.PoolClient, a: { viagem_id: string; ordem: string[] }) {
  const t = (await c.query(`select title, status::text as status from trips where id = $1 and company_id = app.company_id()`, [a.viagem_id])).rows[0];
  if (!t) throw httpError(400, 'viagem não encontrada nesta empresa');
  if (['concluida', 'cancelada'].includes(t.status)) throw httpError(400, `viagem ${t.status}: não dá para reordenar`);
  const ids = (await c.query(`select id from deliveries where trip_id = $1`, [a.viagem_id])).rows.map((r) => r.id as string);
  if (new Set(a.ordem).size !== a.ordem.length) throw httpError(400, 'ids de entrega repetidos em `ordem`');
  if (ids.length !== a.ordem.length || !a.ordem.every((i) => ids.includes(i))) {
    throw httpError(400, `\`ordem\` deve conter exatamente as ${ids.length} entrega(s) da viagem`);
  }
  return t as { title: string | null; status: string };
}

export const TOOLS: ToolDef[] = [...readTools, ...actionTools];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Definições para a API (sem `run`/`zod`). A ordem é fixa: o prefixo (tools + system) precisa ser estável para o cache. */
export const TOOL_DEFS: Anthropic.Tool[] = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));

export interface ToolRunResult { content: string; is_error: boolean; action?: { id: string; tool: string; resumo: string } }

/** Executa uma tool pedida pelo modelo. Nunca lança: erro vira tool_result com is_error. */
export async function runTool(ctx: ToolCtx, name: string, rawInput: unknown): Promise<ToolRunResult> {
  const def = byName.get(name);
  if (!def) return { content: `tool desconhecida: ${name}`, is_error: true };
  const parsed = def.zod.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { content: 'parâmetros inválidos: ' + parsed.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; '), is_error: true };
  }
  try {
    const out = await def.run(ctx, parsed.data);
    let s = JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
    if (s.length > MAX_TOOL_RESULT_CHARS) s = s.slice(0, MAX_TOOL_RESULT_CHARS) + '…[resultado truncado; refine o filtro]';
    const res: ToolRunResult = { content: s, is_error: false };
    if (def.kind === 'action') { const o = out as any; res.action = { id: o.acao_id, tool: def.name.replace(/^propor_/, ''), resumo: o.resumo }; }
    return res;
  } catch (e: any) {
    return { content: e?.statusCode && e.statusCode < 500 ? e.message : 'erro interno ao consultar os dados', is_error: true };
  }
}

// ------------------------------------------------------------------ execução das ações confirmadas

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

/**
 * Executa a ação já CONFIRMADA (status 'confirmada'). `input` é o jsonb gravado na proposta (revalidado aqui: o estado
 * pode ter mudado entre a proposta e a confirmação). Retorna o `result` a gravar. Lança em caso de falha.
 */
export async function executeAction(ctx: Pick<ToolCtx, 'claims' | 'userId' | 'companyId' | 'route'>, actionId: string, tool: string, input: any): Promise<Record<string, unknown>> {
  switch (tool) {
    case 'criar_viagem': {
      const a = CriarViagemZ.parse(stripMeta(input));
      const veh = await withRls(ctx.claims, async (c) => (await c.query(
        `select id, plate, preset, height_m::float8 as height_m, width_m::float8 as width_m, length_m::float8 as length_m, weight_t::float8 as weight_t,
                payload_t::float8 as payload_t, axle_load_t::float8 as axle_load_t, axle_count, hazmat, is_vuc, has_aetc
           from vehicles where id = $1 and company_id = app.company_id() and status = 'active'`, [a.veiculo_id])).rows[0]);
      if (!veh) throw new Error('veículo não encontrado ou inativo');
      const last = /\d$/.test(veh.plate) ? Number(veh.plate.slice(-1)) : undefined;
      // O roteador recebe o veículo da frota: preset + dimensões cadastradas (as que existirem sobrescrevem o preset)
      const vehicle = VehicleInput.parse(clean({
        preset: veh.preset ?? undefined, height_m: veh.height_m, width_m: veh.width_m, length_m: veh.length_m, weight_t: veh.weight_t,
        payload_t: veh.payload_t, axle_load_t: veh.axle_load_t, axle_count: veh.axle_count, hazmat: veh.hazmat, is_vuc: veh.is_vuc, has_aetc: veh.has_aetc || undefined, plate_last_digit: last,
      }));
      const req = RouteRequest.parse({ origin: { lat: a.origem.lat, lon: a.origem.lon }, destination: { lat: a.destino.lat, lon: a.destino.lon }, departure_at: a.saida_planejada, vehicle });
      const r = await ctx.route(req); // fora da transação: o roteamento é lento
      const dep = a.saida_planejada ? DateTime.fromISO(a.saida_planejada, { zone: env.tz }).toUTC().toISO() : null;
      return withRls(ctx.claims, async (c) => {
        const t = (await c.query(
          `insert into trips (company_id, vehicle_id, status, title, origin, origin_label, destination, destination_label, departure_planned_at,
                              planned_route, planned_distance_m, planned_duration_s, route_response, created_by)
           values (app.company_id(), $1, 'planejada', $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9,
                   ST_SetSRID(ST_GeomFromGeoJSON($10), 4326), $11, $12, $13::jsonb, auth.uid()) returning id`,
          [a.veiculo_id, a.titulo, a.origem.lon, a.origem.lat, a.origem.rotulo ?? null, a.destino.lon, a.destino.lat, a.destino.rotulo ?? null, dep,
           JSON.stringify(r.geometry), Math.round(r.distance_km * 1000), Math.round(r.duration_s),
           JSON.stringify({ avoided: r.avoided, warnings: r.warnings, alertas_motorista: r.alertas_motorista, resumo_avisos: r.resumo_avisos, vehicle: r.vehicle, departure_at: r.departure_at })])).rows[0];
        let seq = 0;
        for (const d of a.entregas ?? []) {
          await c.query(
            `insert into deliveries (company_id, trip_id, sequence, customer_name, address, geom, window_start, window_end)
             values (app.company_id(), $1, $2, $3, $4, case when $5::float8 is null then null else ST_SetSRID(ST_MakePoint($5, $6), 4326) end, $7, $8)`,
            [t.id, ++seq, d.cliente, d.endereco, d.lon ?? null, d.lat ?? null, d.janela_inicio ?? null, d.janela_fim ?? null]);
        }
        let status = 'planejada';
        if (a.motorista_id) { status = (await c.query(`select status::text as status from app.assign_trip($1, $2, $3)`, [t.id, a.motorista_id, a.veiculo_id])).rows[0].status; }
        return {
          viagem_id: t.id, status, veiculo: veh.plate, distancia_km: Math.round(r.distance_km * 10) / 10, duracao_min: Math.round(r.duration_s / 60),
          evitado: r.avoided.length, avisos: r.warnings.slice(0, 8).map((w) => w.message), entregas: seq, motorista_id: a.motorista_id ?? null,
        };
      });
    }
    case 'atribuir_viagem': {
      const a = AtribuirZ.parse(stripMeta(input));
      return withRls(ctx.claims, async (c) => {
        const t = (await c.query(`select id, status::text as status, driver_id, vehicle_id from app.assign_trip($1, $2, $3)`, [a.viagem_id, a.motorista_id, a.veiculo_id ?? null])).rows[0];
        return { viagem_id: t.id, status: t.status, motorista_id: t.driver_id, veiculo_id: t.vehicle_id };
      });
    }
    case 'enviar_mensagem': {
      const a = MensagemZ.parse(stripMeta(input));
      // A RLS de messages recusa mensagem com agent_action_id para o usuário; grava como service_role, mas sempre com
      // empresa e remetente do gestor que confirmou, e só para membro ativo da MESMA empresa.
      return withRls(SERVICE, async (c) => {
        const r = await c.query(
          `insert into messages (company_id, trip_id, sender_id, recipient_id, body, agent_action_id)
           select $1, $2, $3, m.user_id, $5, $6 from company_members m where m.user_id = $4 and m.company_id = $1 and m.status = 'active'
           returning id, created_at`,
          [ctx.companyId, a.viagem_id ?? null, ctx.userId, a.motorista_id, a.texto, actionId]);
        if (!r.rows[0]) throw new Error('motorista não é membro ativo da empresa');
        return { mensagem_id: r.rows[0].id, enviada_em: r.rows[0].created_at, motorista_id: a.motorista_id };
      });
    }
    case 'reordenar_entregas': {
      const a = ReordenarZ.parse(stripMeta(input));
      return withRls(ctx.claims, async (c) => {
        await checkReorder(c, a);
        await c.query(`update deliveries d set sequence = x.n from unnest($1::uuid[]) with ordinality as x(id, n) where d.id = x.id and d.trip_id = $2`, [a.ordem, a.viagem_id]);
        return { viagem_id: a.viagem_id, entregas_reordenadas: a.ordem.length };
      });
    }
    default:
      throw new Error(`ação desconhecida: ${tool}`);
  }
}

function stripMeta(input: any) {
  return Object.fromEntries(Object.entries(input ?? {}).filter(([k]) => !k.startsWith('_')));
}
