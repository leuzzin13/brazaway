"""Testes do importador core_legal/feriados_sudeste (sem rede e sem banco; só stdlib).

Conferem as datas calculadas e as correções do verify.json da pesquisa feriados_sudeste: Lei RJ 8.174/2018 (ADI 6133) e
Lei RJ 8.217/2018 (ADI 6083) registradas como inconstitucionais e nunca aplicadas; Guarujá 29/06/2026 (antecipado do
30/06); Penha do ES só desde 2020; Campinas 12/08; Jubileu de Contagem 2027+ desativado (regra inferida).

Rodar (na raiz do repositório):
  cd importers && python3 -m unittest tests.test_feriados_sudeste -v
  docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data:/data --entrypoint python truck-router-importer -m unittest tests.test_feriados_sudeste -v
"""
from __future__ import annotations
import copy
import datetime as dt
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import feriados_sudeste as fs  # noqa: E402

D = dt.date
CFG = fs.load_rules()
ROWS, STATS = fs.compute(CFG, [2026, 2027, 2028])


def find(day: D, scope: str, uf: str, ibge: str | None = None) -> dict | None:
    return next((r for r in ROWS if r['day'] == day and r['scope'] == scope and r['uf'] == uf and r['ibge_code'] == ibge), None)


class Datas(unittest.TestCase):
    def test_pascoa(self):
        self.assertEqual([fs.easter(y) for y in (2026, 2027, 2028)], [D(2026, 4, 5), D(2027, 3, 28), D(2028, 4, 16)])

    def test_regras_de_data(self):
        self.assertEqual(fs.date_for('fixa:04-23', 2027), D(2027, 4, 23))
        self.assertEqual(fs.date_for('pascoa:-47', 2028), D(2028, 2, 29))
        self.assertEqual(fs.date_for('pascoa:+68', 2026), D(2026, 6, 12))        # Sagrado Coração (Colatina)
        self.assertEqual(fs.date_for('domingo:05:2', 2026), D(2026, 5, 10))
        self.assertIsNone(fs.date_for('data:2025-07-07', 2026))
        with self.assertRaises(ValueError):
            fs.date_for('quinta:qualquer', 2026)


class Estaduais(unittest.TestCase):
    def test_rj_sao_jorge_carnaval_corpus(self):
        for y in (2026, 2027, 2028):
            r = find(D(y, 4, 23), 'state', 'RJ')
            self.assertTrue(r and r['active'], f'São Jorge {y}')
            self.assertIn('Lei estadual RJ 5.198/2008, art. 1º', r['legal_basis'])
        self.assertEqual([r['day'] for r in ROWS if r['rule_key'] == 'rj_carnaval'], [D(2026, 2, 17), D(2027, 2, 9), D(2028, 2, 29)])
        self.assertEqual([r['day'] for r in ROWS if r['rule_key'] == 'rj_corpus_christi'], [D(2026, 6, 4), D(2027, 5, 27), D(2028, 6, 15)])

    def test_rj_leis_inconstitucionais_registradas_e_nunca_aplicadas(self):
        maes = [r for r in ROWS if r['rule_key'] == 'rj_dia_das_maes']
        self.assertEqual([r['day'] for r in maes], [D(2026, 5, 10), D(2027, 5, 9), D(2028, 5, 14)])
        self.assertTrue(all(not r['active'] and r['status'] == 'inconstitucional' and 'ADI 6133' in r['inactive_reason'] for r in maes))
        cinzas = [r for r in ROWS if r['rule_key'] == 'rj_quarta_cinzas_bancaria']
        self.assertTrue(cinzas and all(not r['active'] and 'ADI 6083' in r['inactive_reason'] for r in cinzas))

    def test_es_penha_e_redundantes(self):
        self.assertEqual([r['day'] for r in ROWS if r['rule_key'] == 'es_penha'], [D(2026, 4, 13), D(2027, 4, 5), D(2028, 4, 24)])
        # vigência: a Lei ES 11.010/2019 só vale a partir de 2020
        rows19, _ = fs.compute(CFG, [2019])
        self.assertFalse([r for r in rows19 if r['rule_key'] == 'es_penha'])
        # MG 21/04 e RJ 20/11 já são nacionais: não geram linha
        self.assertFalse([r for r in ROWS if r['scope'] == 'state' and r['uf'] == 'MG'])
        self.assertIsNone(find(D(2026, 11, 20), 'state', 'RJ'))
        self.assertEqual(STATS['redundantes'], 2)


class Municipais(unittest.TestCase):
    def test_guaruja_antecipado(self):
        self.assertTrue(find(D(2026, 6, 29), 'municipal', 'SP', '3518701'))
        self.assertIsNone(find(D(2026, 6, 30), 'municipal', 'SP', '3518701'))
        self.assertFalse([r for r in ROWS if r['rule_key'] == 'guaruja_emancipacao_2026' and r['day'].year > 2026])

    def test_campinas_evangelico(self):
        self.assertEqual([r['day'] for r in ROWS if r['rule_key'] == 'campinas_evangelico' and r['active']],
                         [D(2026, 8, 12), D(2027, 8, 12), D(2028, 8, 12)])

    def test_contagem_jubileu(self):
        r26 = find(D(2026, 3, 27), 'municipal', 'MG', '3118601')
        self.assertTrue(r26['active'] and r26['confidence'] == 'alta')
        r27 = find(D(2027, 3, 19), 'municipal', 'MG', '3118601')
        self.assertFalse(r27['active'])
        self.assertEqual(r27['confidence'], 'baixa')

    def test_serra_sem_corpus_christi(self):
        self.assertIsNone(find(D(2026, 6, 4), 'municipal', 'ES', '3205002'))      # ponto facultativo
        self.assertTrue(find(D(2026, 6, 4), 'municipal', 'ES', '3205309')['active'])   # Vitória: feriado

    def test_rio_paixao_nao_confirmada(self):
        r = find(D(2026, 4, 3), 'municipal', 'RJ', '3304557')
        self.assertFalse(r['active'])
        self.assertEqual(r['confidence'], 'unverifiable')

    def test_datas_fixas_de_edital_so_no_ano_do_ato(self):
        for key in ('cajamar_municipio', 'sbc_aniversario', 'santos_fundacao', 'extrema_aniversario', 'guarulhos_fundacao'):
            self.assertEqual({r['day'].year for r in ROWS if r['rule_key'] == key}, {2026}, key)


class Consistencia(unittest.TestCase):
    def test_ativo_so_vigente_com_confianca(self):
        for r in ROWS:
            if r['active']:
                self.assertEqual(r['status'], 'vigente', r['rule_key'])
                self.assertIn(r['confidence'], ('alta', 'media'), r['rule_key'])
                self.assertIsNone(r['inactive_reason'])
            else:
                self.assertTrue(r['inactive_reason'], r['rule_key'])
            self.assertTrue(r['legal_basis'] and r['source_url'].startswith('http'), r['rule_key'])

    def test_regra_inconsistente_falha(self):
        base = next(r for r in CFG['regras'] if r['id'] == 'rj_sao_jorge')
        sem_motivo = dict(copy.deepcopy(base), confianca='baixa')
        with self.assertRaises(ValueError):
            fs.check_rule(sem_motivo, CFG['fontes'])
        uf_errada = dict(copy.deepcopy(base), escopo='municipal', ibge='3550308')
        with self.assertRaises(ValueError):
            fs.check_rule(uf_errada, CFG['fontes'])
        dup = copy.deepcopy(CFG)
        dup['regras'].append(dict(copy.deepcopy(base), id='rj_sao_jorge_2'))
        with self.assertRaises(ValueError):
            fs.compute(dup, [2026])

    def test_seed(self):
        sql = fs.seed_sql(ROWS, 'teste')
        self.assertIn("delete from holidays where source = 'feriados-sudeste';", sql)
        self.assertIn("on conflict (day, scope, coalesce(uf, ''), coalesce(ibge_code, '')) do nothing;", sql)
        self.assertEqual(sql.count("'feriados-sudeste', "), len(ROWS) + 1)   # linhas + data_layer_runs


if __name__ == '__main__':
    unittest.main()
