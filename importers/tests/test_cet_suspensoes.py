"""Testes do importador core_legal/cet_suspensoes.

Interpretação das linhas da CET: sem rede e sem banco. Proteções da gravação (write_db): só com CET_DB_TEST=1 e um banco
com a migration 0101 (usa o ano de 2031, que a CET não publica, e apaga o que gravou).

Rodar (na imagem do importador):
  docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest tests.test_cet_suspensoes -v
  docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
    -e CET_DB_TEST=1 -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest tests.test_cet_suspensoes -v
"""
from __future__ import annotations
import datetime as dt
import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import cet_suspensoes as cet  # noqa: E402

D = dt.datetime


class Interpret(unittest.TestCase):
    def test_mantido_para_pesados(self):
        got = cet.interpret(['20/04/2026', '', 'Redução de circulação', '',
                             'Rodízio Municipal de Veículos SUSPENSO para veículos de passeio. MANTIDO para veículos pesados.'])
        self.assertEqual([(g['scope'], g['applies_to_heavy']) for g in got], [('rodizio', True)])
        self.assertEqual((got[0]['starts_at'], got[0]['ends_at']), (D(2026, 4, 20), D(2026, 4, 21)))

    def test_feriado_suspende_rodizio_e_zmrc(self):
        got = cet.interpret(['07/09/2026', '', 'Feriado', '', 'Rodízio, ZMRC e ZMRF SUSPENSOS.'])
        self.assertEqual(sorted(g['scope'] for g in got), ['rodizio', 'zmrc', 'zmrf'])
        self.assertTrue(all(not g['applies_to_heavy'] for g in got))

    def test_periodo_em_varios_dias_vira_um_registro_por_dia(self):
        got = cet.interpret(['10/02/2027 a 12/02/2027', '', 'Evento', 'Manhã', 'Rodízio SUSPENSO.'])
        self.assertEqual([(g['starts_at'], g['ends_at']) for g in got],
                         [(D(2027, 2, d), D(2027, 2, d, 12)) for d in (10, 11, 12)])
        self.assertTrue(all(g['period'] == 'manha' for g in got))

    def test_intervalo_sem_periodo_e_um_bloco(self):
        got = cet.interpret(['22/12/2025 a 09/01/2026', '', 'Fim de ano', '', 'Rodízio SUSPENSO. MANTIDO para veículos pesados.'])
        self.assertEqual(len(got), 1)
        self.assertEqual((got[0]['starts_at'], got[0]['ends_at']), (D(2025, 12, 22), D(2026, 1, 10)))

    def test_local_afetado_nao_suspende_zona(self):
        got = cet.interpret(['05/05/2026', 'Av. Paulista', 'Evento', '', 'Rodízio SUSPENSO no local.'])
        self.assertEqual([g['scope'] for g in got], ['local'])

    def test_texto_desconhecido_e_ignorado(self):
        self.assertEqual(cet.interpret(['05/05/2026', '', 'Evento', '', 'Operação especial de trânsito.']), [])
        self.assertEqual(cet.interpret(['sem data', '', '', '', 'Rodízio SUSPENSO.']), [])

    def test_seed_so_mexe_em_linhas_da_cet_e_registra_a_carga_uma_vez(self):
        items = [{**it, 'source_url': 'teste'} for it in cet.interpret(['07/09/2026', '', 'Feriado', '', 'Rodízio SUSPENSO.'])]
        sql = cet.seed_sql({2026: items}, len(items), 'seed: teste')
        self.assertIn("where rule_suspensions.source = 'cet'", sql)
        self.assertIn('where not exists (select 1 from data_layer_runs', sql)


@unittest.skipUnless(os.environ.get('CET_DB_TEST') == '1', 'defina CET_DB_TEST=1 (precisa de banco com a migration 0101)')
class WriteDb(unittest.TestCase):
    Y = 2031

    def _rows(self):
        from common import _pg_conn
        with _pg_conn() as c, c.cursor() as cur:
            cur.execute("""select to_char(starts_at at time zone 'America/Sao_Paulo', 'MM-DD'), scope, source from rule_suspensions
                            where ibge_code = '3550308' and starts_at >= '2031-01-01' and starts_at < '2032-01-01' order by 1, 2, 3""")
            return cur.fetchall()

    def _clean(self):
        from common import _pg_conn
        with _pg_conn() as c, c.cursor() as cur:
            cur.execute("delete from rule_suspensions where ibge_code = '3550308' and starts_at >= '2031-01-01' and starts_at < '2032-01-01'")

    def setUp(self):
        self._clean()

    def tearDown(self):
        self._clean()

    def _items(self, *days):
        out = []
        for d in days:
            for it in cet.interpret([f'{d:02d}/03/{self.Y}', '', 'teste', '', 'Rodízio SUSPENSO.']):
                it['source_url'] = 'teste'
                out.append(it)
        return out

    def test_protecoes(self):
        from common import _pg_conn
        with _pg_conn() as c, c.cursor() as cur:   # linha manual com a mesma chave de uma suspensão da CET
            cur.execute("""insert into rule_suspensions (ibge_code, starts_at, ends_at, scope, applies_to_heavy, description, source)
                           values ('3550308', '2031-03-03T00:00-03', '2031-03-04T00:00-03', 'rodizio', false, 'manual', 'manual')""")
        notes: list[str] = []
        cet.write_db({self.Y: self._items(1, 2, 3)}, {self.Y: (3, 0)}, notes)
        self.assertEqual(self._rows(), [('03-01', 'rodizio', 'cet'), ('03-02', 'rodizio', 'cet'), ('03-03', 'rodizio', 'manual')])
        self.assertTrue(any('outra origem' in n for n in notes))
        # leitura incerta (a CET mudou o texto): nada é apagado
        notes = []
        cet.write_db({self.Y: self._items(1)}, {self.Y: (10, 9)}, notes)
        self.assertEqual(len(self._rows()), 3)
        self.assertTrue(any('nada foi apagado' in n for n in notes))
        cet.write_db({self.Y: []}, {self.Y: (5, 5)}, [])
        self.assertEqual(len(self._rows()), 3)
        # leitura boa: a suspensão que sumiu da fonte sai; a manual fica
        cet.write_db({self.Y: self._items(1)}, {self.Y: (1, 0)}, [])
        self.assertEqual(self._rows(), [('03-01', 'rodizio', 'cet'), ('03-03', 'rodizio', 'manual')])


if __name__ == '__main__':
    unittest.main()
