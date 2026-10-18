/**
 * feriados_sudeste (expansão Sul e Centro-Oeste): um feriado estadual por UF (PR, SC, RS, GO, MS, MT, DF) e municipais
 * conferidos, lidos pelo calendário legal (tabela holidays, UF derivada do IBGE). Pesquisa: docs/research/estados_sul_co
 * (verificada em 18/10/2026). Requer o seed core_legal__feriados-sudeste.sql (ou o importador) e a migration 0202.
 *   PR: nenhum feriado estadual (Lei PR 18.384/2014: 19/12 "não se constituindo em feriado civil")
 *   SC: 11/08 e 25/11 transferidos para o domingo (Lei SC 18.531/2022): registrados sem aplicar
 *   RS: 20/09 Revolução Farroupilha (Decreto RS 36.180/1995); GO: 20/07/2026 (Decreto GO 10.935/2026)
 *   MS: 11/10 (Decreto 'E' MS 46/2025); DF: Corpus Christi (Lei DF 72/1989) e 30/11 (Lei DF 963/1995)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { pool } from '../helpers.js';
import { pool as apiPool } from '../../src/db.js';
import { legalDayInfo, ufFromIbge } from '../../src/services/calendar.js';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Sao_Paulo' }).toJSDate();
const CURITIBA = '4106902';
const FLORIANOPOLIS = '4205407';
const PORTO_ALEGRE = '4314902';
const CAXIAS = '4305108';
const GOIANIA = '5208707';
const CAMPO_GRANDE = '5002704';
const CUIABA = '5103403';
const BRASILIA = '5300108';
const names = (hs: { name: string }[]) => hs.map((h) => h.name);

afterAll(async () => { await apiPool.end(); await pool.end(); });

describe('feriados Sul e Centro-Oeste — calendário (banco)', () => {
  it('UF pelo IBGE: 41 PR, 42 SC, 43 RS, 50 MS, 51 MT, 52 GO, 53 DF', () => {
    expect([CURITIBA, FLORIANOPOLIS, PORTO_ALEGRE, CAMPO_GRANDE, CUIABA, GOIANIA, BRASILIA].map(ufFromIbge))
      .toEqual(['PR', 'SC', 'RS', 'MS', 'MT', 'GO', 'DF']);
  });

  it('PR: 19/12 não é feriado (Lei 18.384/2014); Padroeira de Curitiba (08/09) é municipal e só vale em Curitiba', async () => {
    expect((await legalDayInfo(at('2026-12-19T10:00'), CURITIBA)).holidays).toEqual([]);
    const cwb = await legalDayInfo(at('2026-09-08T10:00'), CURITIBA);
    expect(cwb.holiday?.scope).toBe('municipal');
    expect(cwb.holiday?.name).toContain('Padroeira de Curitiba');
    expect(cwb.holiday?.legal_basis).toContain('Decreto Judiciário TJPR 621/2025');
    expect(names((await legalDayInfo(at('2026-09-08T10:00'), '4113700')).holidays)).toEqual([]);   // Londrina
  });

  it('SC: Data Magna transferida para o domingo fica registrada e nunca é aplicada', async () => {
    expect((await legalDayInfo(at('2026-08-16T10:00'), FLORIANOPOLIS)).holidays).toEqual([]);
    expect((await legalDayInfo(at('2026-08-11T10:00'), FLORIANOPOLIS)).holidays).toEqual([]);
    const r = await pool.query(`select active, status, legal_basis from holidays where day = '2026-08-16' and scope = 'state' and uf = 'SC'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ active: false, status: 'a_confirmar' });
    expect(r.rows[0].legal_basis).toContain('Lei estadual SC 18.531/2022');
  });

  it('RS: 20/09 é feriado estadual (domingo em 2026, segunda em 2027) e Corpus Christi vale nos municípios do TRT4', async () => {
    for (const d of ['2026-09-20', '2027-09-20']) {
      const rs = await legalDayInfo(at(`${d}T10:00`), PORTO_ALEGRE);
      expect(rs.holiday).toMatchObject({ scope: 'state', uf: 'RS', name: 'Revolução Farroupilha' });
      expect(rs.holiday?.legal_basis).toContain('Decreto estadual RS 36.180/1995');
    }
    expect(names((await legalDayInfo(at('2026-09-20T10:00'), CURITIBA)).holidays)).toEqual([]);
    expect((await legalDayInfo(at('2026-05-26T10:00'), CAXIAS)).holiday?.legal_basis).toContain('Lei nº 3.130/1987');
    expect((await legalDayInfo(at('2027-05-27T10:00'), PORTO_ALEGRE)).holiday?.name).toBe('Corpus Christi');   // Páscoa + 60
  });

  it('GO: 20/07/2026 (Decreto 10.935/2026) é feriado e 26/07 não; Goiânia 24/05 municipal; polos do TRT18/2024 não aplicam', async () => {
    expect((await legalDayInfo(at('2026-07-20T10:00'), GOIANIA)).holiday?.scope).toBe('state');
    expect((await legalDayInfo(at('2026-07-26T10:00'), GOIANIA)).holidays).toEqual([]);
    expect((await legalDayInfo(at('2026-10-30T10:00'), GOIANIA)).holiday?.legal_basis).toContain('Decreto estadual GO 10.987');
    expect((await legalDayInfo(at('2026-05-24T10:00'), GOIANIA)).holiday?.scope).toBe('municipal');
    expect((await legalDayInfo(at('2026-07-31T10:00'), '5201108')).holidays).toEqual([]);                  // Anápolis: baixa
  });

  it('MS: 11/10 é feriado estadual (Decreto E 46/2025); aniversário de Campo Grande (26/08) municipal; 28/10 não é feriado', async () => {
    const ms = await legalDayInfo(at('2027-10-11T10:00'), CAMPO_GRANDE);
    expect(ms.holiday).toMatchObject({ scope: 'state', uf: 'MS' });
    expect(ms.holiday?.legal_basis).toContain("Decreto 'E' estadual MS 46/2025");
    expect((await legalDayInfo(at('2026-08-26T10:00'), CAMPO_GRANDE)).holiday?.scope).toBe('municipal');
    expect((await legalDayInfo(at('2026-10-28T10:00'), CAMPO_GRANDE)).holidays).toEqual([]);
  });

  it('MT: sem feriado estadual; Marcelândia 31/10/2026 (DOE) aplica e Cuiabá 08/12 (lei não achada) não', async () => {
    expect((await legalDayInfo(at('2026-10-31T10:00'), '5105580')).holiday?.scope).toBe('municipal');
    expect((await legalDayInfo(at('2026-12-08T10:00'), CUIABA)).holidays).toEqual([]);
    const r = await pool.query(`select count(*)::int as n from holidays where scope = 'state' and uf = 'MT' and source = 'feriados-sudeste'`);
    expect(r.rows[0].n).toBe(0);
  });

  it('DF: Corpus Christi (Lei 72/1989) e 30/11 (Lei 963/1995) valem em Brasília; 21/04 já é nacional', async () => {
    const cc = await legalDayInfo(at('2026-06-04T10:00'), BRASILIA);
    expect(cc.holiday).toMatchObject({ scope: 'state', uf: 'DF', name: 'Corpus Christi' });
    expect(cc.holiday?.legal_basis).toContain('Lei distrital DF 72/1989');
    const ev = await legalDayInfo(at('2026-11-30T10:00'), BRASILIA);
    expect(ev.holiday?.legal_basis).toContain('Lei distrital DF 963/1995');
    expect(names((await legalDayInfo(at('2026-06-04T10:00'), GOIANIA)).holidays)).not.toContain('Corpus Christi');
    const r = await pool.query(`select count(*)::int as n from holidays where day = '2026-04-21' and uf = 'DF' and source = 'feriados-sudeste'`);
    expect(r.rows[0].n).toBe(0);
  });
});
