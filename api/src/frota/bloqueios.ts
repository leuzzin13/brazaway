import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { findPreset } from '../config.js';
import type { Bloqueios } from '../schemas.js';
import { withTimeout } from '../services/routing.js';
import * as valhalla from '../services/valhalla.js';
import { resolveVehicle } from '../services/vehicle.js';
import { asUser, httpError } from './auth.js';

/**
 * Trechos bloqueados pela empresa (/api/frota/trechos-bloqueados; tabela da migration 0405).
 *
 * A equipe trava um trecho para a frota inteira, ou só para alguns tipos de caminhão (`presets`): um item de camada que
 * a rota avisou (`item_id` = o `id` do aviso, ex.: "trecho restrito sem alternativa razoável") ou uma linha desenhada
 * no mapa (`coordinates`). Toda rota que a Frota calcula para um veículo da empresa leva esses trechos em `bloqueios`
 * (bloqueiosDaEmpresa): o roteador os evita com o fator de "proibido salvo sem nenhum caminho" e, se ainda assim a rota
 * passar por um deles, avisa `uses_company_blocked_way`. O alerta ao vivo avisa o motorista que for entrar num deles.
 * Achado da simulação de 90 dias: orientar motorista por motorista não resolvia (o problema voltava com outro
 * motorista); quando a equipe travou o desvio para todos, sumiu.
 *
 * O item de camada segue a regra da camada (só pesa nos horários em que ela restringe o trecho); a linha desenhada vale
 * a qualquer hora, no sentido em que foi desenhada, e precisa seguir as vias do mapa (ex.: um pedaço da rota): se não
 * casar, a rota a ignora com o aviso `cost_line_ignored` (o POST já responde `casa_com_vias`).
 */

/** limites do pedido de rota (schemas.ts, Bloqueios) */
const MAX_ITENS = 500;
const MAX_LINHAS = 100;

type Db = pg.PoolClient;
type Consulta = Pick<pg.ClientBase, 'query'>;

const Uuid = z.string().uuid();
const Text = (max: number) => z.string().trim().min(1).max(max);
// [lon, lat] dentro do Brasil (com folga para as ilhas oceânicas)
const PontoBR = z.tuple([
  z.number().min(-74.1, 'ponto fora do Brasil').max(-28.6, 'ponto fora do Brasil'),
  z.number().min(-33.9, 'ponto fora do Brasil').max(5.4, 'ponto fora do Brasil'),
]);
const Presets = z.array(z.string().trim().min(1).max(60)).min(1).max(30).nullable();
const NovoBloqueio = z.object({
  item_id: Text(300).optional(),
  nome: Text(200).optional(),
  coordinates: z.array(PontoBR).min(2, 'a linha precisa de pelo menos 2 pontos').max(2000, 'no máximo 2000 pontos').optional(),
  presets: Presets.optional(),                     // null ou ausente = todos os veículos
  motivo: z.string().trim().max(1000).nullable().optional(),
  ativo: z.boolean().optional(),
});
const EditaBloqueio = z.object({
  nome: Text(200).optional(),
  ativo: z.boolean().optional(),
  presets: Presets.optional(),
  motivo: z.string().trim().max(1000).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'nada para alterar' });

const COLS = `id, item_id, nome, coordinates, presets, motivo, ativo, created_by, created_at, updated_at`;

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const msg = r.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
  throw httpError(422, `entrada inválida: ${msg}`);
}
const idParam = (req: FastifyRequest) => parse(Uuid, (req.params as Record<string, string>).id);

async function requireStaff(c: Db) {
  const r = await c.query('select app.is_staff() as ok');
  if (!r.rows[0].ok) throw httpError(403, 'apenas a equipe da empresa (owner, admin ou gestor)');
}

/** tipos de caminhão pelo id canônico de config/vehicle-presets.json (aceita os ids antigos dos "aliases") */
function presetsCanonicos(ps: string[] | null | undefined): string[] | null | undefined {
  if (!ps) return ps;
  return [...new Set(ps.map((p) => {
    const pr = findPreset(p);
    if (!pr) throw httpError(422, `tipo de caminhão desconhecido: ${p}`);
    return pr.id;
  }))];
}

/** O pedido de rota aceita até 500 itens e 100 linhas: recusa ativar um trecho além disso. */
async function confereLimite(c: Db, comItem: boolean, comLinha: boolean, excetoId: string | null) {
  const r = (await c.query(
    `select count(*) filter (where item_id is not null)::int as itens, count(*) filter (where coordinates is not null)::int as linhas
       from trechos_bloqueados where ativo and id is distinct from $1::uuid`, [excetoId])).rows[0];
  if (comItem && r.itens >= MAX_ITENS) throw httpError(422, `a empresa já tem ${MAX_ITENS} trechos de camada bloqueados (o limite); desative ou apague algum`);
  if (comLinha && r.linhas >= MAX_LINHAS) throw httpError(422, `a empresa já tem ${MAX_LINHAS} linhas desenhadas bloqueadas (o limite); desative ou apague alguma`);
}

/**
 * A linha desenhada segue as vias do mapa? Mesma conferência que a rota faz com os trechos penalizados (o "edge walk"
 * do Valhalla): uma rota do começo ao fim da linha com ela como trecho penalizado. null = não deu para conferir.
 */
async function casaComVias(coords: [number, number][]): Promise<boolean | null> {
  const [lon0, lat0] = coords[0], [lon1, lat1] = coords[coords.length - 1];
  try {
    await withTimeout(valhalla.route({ origin: { lat: lat0, lon: lon0 }, destination: { lat: lat1, lon: lon1 }, vehicle: resolveVehicle({}),
      costLines: [{ coordinates: coords, factor: 2 }] }), 8000, 'conferência da linha bloqueada');
    return true;
  } catch (e) {
    return /edge walk/i.test(String((e as Error)?.message ?? '')) ? false : null;
  }
}

/**
 * Trechos bloqueados ativos da empresa que valem para este tipo de caminhão, no formato de `bloqueios` do pedido de
 * rota. Com a conexão da requisição (RLS), a empresa é a do usuário; com o pool (sem RLS, ex.: alerta ao vivo), passe
 * `companyId`. Os mais novos primeiro, dentro dos limites do pedido.
 */
export async function bloqueiosDaEmpresa(c: Consulta, preset: string | null | undefined, companyId?: string | null) {
  const p = preset ? findPreset(preset)?.id ?? preset : null;
  const r = await c.query<{ id: string; item_id: string | null; nome: string; coordinates: [number, number][] | null }>(
    `select id, item_id, nome, coordinates from trechos_bloqueados
      where company_id = coalesce($1::uuid, app.company_id()) and ativo and (presets is null or $2::text = any(presets))
      order by created_at desc, id`, [companyId ?? null, p]);
  const item_ids = r.rows.filter((x) => x.item_id).map((x) => x.item_id!).slice(0, MAX_ITENS);
  const linhas = r.rows.filter((x) => Array.isArray(x.coordinates) && x.coordinates.length >= 2)
    .map((x) => ({ id: x.id, nome: x.nome.slice(0, 200), coordinates: x.coordinates! })).slice(0, MAX_LINHAS);
  return { item_ids, linhas } satisfies Bloqueios;
}

export async function bloqueiosRoutes(api: FastifyInstance) {
  // toda a empresa lê (motorista inclusive); filtro opcional `ativo`
  api.get('/trechos-bloqueados', (req) => asUser(req, async (c) => {
    const q = parse(z.object({ ativo: z.enum(['true', 'false']).optional() }), req.query);
    const r = await c.query(`select ${COLS} from trechos_bloqueados ${q.ativo ? 'where ativo = $1' : ''} order by created_at desc, id`,
      q.ativo ? [q.ativo === 'true'] : []);
    return { items: r.rows };
  }));

  api.post('/trechos-bloqueados', async (req, reply) => {
    const b = parse(NovoBloqueio, req.body ?? {});
    if (!b.item_id && !b.coordinates) throw httpError(422, 'informe item_id (o id do aviso da rota) ou coordinates (a linha desenhada)');
    const presets = presetsCanonicos(b.presets);
    const row = await asUser(req, async (c, claims) => {
      await requireStaff(c);
      if (b.item_id && (await c.query('select 1 from trechos_bloqueados where item_id = $1', [b.item_id])).rowCount) {
        throw httpError(409, 'esse trecho já está bloqueado na empresa');
      }
      if (b.ativo !== false) await confereLimite(c, !!b.item_id, !!b.coordinates, null);
      const r = await c.query(
        `insert into trechos_bloqueados (company_id, item_id, nome, coordinates, presets, motivo, ativo, created_by)
         values (app.company_id(), $1, $2, $3::jsonb, $4::text[], $5, coalesce($6, true), $7) returning ${COLS}`,
        [b.item_id ?? null, b.nome ?? b.item_id ?? 'Trecho bloqueado pela empresa', b.coordinates ? JSON.stringify(b.coordinates) : null,
         presets ?? null, b.motivo ?? null, b.ativo ?? null, claims.sub ?? null]);
      return r.rows[0];
    });
    // fora da transação: conferir a linha no Valhalla é lento e não muda o que foi gravado
    const casa = b.coordinates ? await casaComVias(b.coordinates) : undefined;
    return reply.code(201).send({
      ...row,
      ...(casa === undefined ? {} : { casa_com_vias: casa }),
      ...(casa === false ? { aviso: 'A linha não segue as vias do mapa e será ignorada nas rotas. Desenhe em cima da via (por exemplo, marcando um pedaço da rota).' } : {}),
    });
  });

  api.patch('/trechos-bloqueados/:id', (req) => asUser(req, async (c) => {
    const id = idParam(req);
    await requireStaff(c);
    const b = parse(EditaBloqueio, req.body ?? {});
    const presets = presetsCanonicos(b.presets);
    if (b.ativo === true) {
      const atual = (await c.query('select item_id, coordinates is not null as linha, ativo from trechos_bloqueados where id = $1', [id])).rows[0];
      if (atual && !atual.ativo) await confereLimite(c, !!atual.item_id, atual.linha, id);
    }
    const campos: [string, unknown][] = [['nome', b.nome], ['ativo', b.ativo], ['presets', presets], ['motivo', b.motivo]];
    const usados = campos.filter(([, v]) => v !== undefined);
    const sql = usados.map(([k], i) => `${k} = $${i + 2}${k === 'presets' ? '::text[]' : ''}`).join(', ');
    const r = await c.query(`update trechos_bloqueados set ${sql}, updated_at = now() where id = $1 returning ${COLS}`, [id, ...usados.map(([, v]) => v)]);
    if (!r.rows[0]) throw httpError(404, 'trecho bloqueado não encontrado');
    return r.rows[0];
  }));

  api.delete('/trechos-bloqueados/:id', (req) => asUser(req, async (c) => {
    const id = idParam(req);
    await requireStaff(c);
    const r = await c.query('delete from trechos_bloqueados where id = $1 returning id', [id]);
    if (!r.rows[0]) throw httpError(404, 'trecho bloqueado não encontrado');
    return { ok: true };
  }));
}
