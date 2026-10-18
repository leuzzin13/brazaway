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
        self.assertEqual(STATS['redundantes'], 3)   # + DF 21/04 (Tiradentes)


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


class SulCentroOeste(unittest.TestCase):
    """Expansão para PR, SC, RS, GO, MT, MS e DF (pesquisa docs/research/estados_sul_co, verificada em 18/10/2026)."""

    def test_pr_sem_feriado_estadual(self):
        # Lei PR 18.384/2014: 19/12 "não se constituindo em feriado civil" (revoga a Lei 4.658/1962)
        self.assertFalse([r for r in ROWS if r['scope'] == 'state' and r['uf'] == 'PR'])
        self.assertTrue(any(r['id'] == 'pr_emancipacao_19dez' and r['status'] == 'revogada' for r in CFG['regras']))
        self.assertTrue(find(D(2026, 9, 8), 'municipal', 'PR', '4106902')['active'])   # Padroeira de Curitiba (TJPR 621/2025)

    def test_sc_data_magna_transferida_para_domingo_nao_aplica(self):
        for dia in (D(2026, 8, 16), D(2027, 8, 15), D(2028, 8, 13), D(2026, 11, 29), D(2027, 11, 28)):
            r = find(dia, 'state', 'SC')
            self.assertEqual(dia.weekday(), 6)
            self.assertTrue(r and not r['active'] and 'Lei estadual SC 18.531/2022' in r['legal_basis'], dia)
        self.assertIsNone(find(D(2026, 8, 11), 'state', 'SC'))
        self.assertIsNone(find(D(2028, 11, 25), 'state', 'SC'))

    def test_rs_farroupilha_e_municipais_trt4(self):
        for y in (2026, 2027, 2028):
            self.assertTrue(find(D(y, 9, 20), 'state', 'RS')['active'], y)
        self.assertEqual(find(D(2026, 6, 4), 'municipal', 'RS', '4314902')['name'], 'Corpus Christi')
        self.assertTrue(find(D(2027, 5, 27), 'municipal', 'RS', '4314902')['active'])       # Páscoa + 60
        self.assertTrue(find(D(2026, 5, 26), 'municipal', 'RS', '4305108')['active'])       # Caxias, Caravaggio
        self.assertIn('Lei nº 3.130/1987', find(D(2026, 5, 26), 'municipal', 'RS', '4305108')['legal_basis'])
        self.assertIsNone(find(D(2026, 6, 4), 'municipal', 'RS', '4303004'))               # Cachoeira do Sul: facultativo

    def test_go_decretos_de_transferencia(self):
        self.assertTrue(find(D(2026, 7, 20), 'state', 'GO')['active'])
        self.assertIsNone(find(D(2026, 7, 26), 'state', 'GO'))                              # Decreto 10.935/2026
        self.assertTrue(find(D(2026, 10, 30), 'state', 'GO')['active'])
        self.assertIsNone(find(D(2026, 10, 28), 'state', 'GO'))                             # Decreto 10.987/2026
        self.assertTrue(find(D(2027, 7, 26), 'state', 'GO')['active'])
        self.assertTrue(find(D(2026, 10, 24), 'state', 'GO')['active'])
        # municipais só do TRT18/2024: registrados sem aplicar
        r = find(D(2026, 7, 31), 'municipal', 'GO', '5201108')
        self.assertTrue(r and not r['active'] and r['confidence'] == 'baixa')

    def test_ms_criacao_do_estado(self):
        for y, d in ((2026, D(2026, 10, 11)), (2027, D(2027, 10, 11)), (2028, D(2028, 10, 11))):
            self.assertTrue(find(d, 'state', 'MS')['active'], y)
        self.assertIsNone(find(D(2026, 10, 28), 'state', 'MS'))                              # ponto facultativo
        self.assertTrue(find(D(2026, 5, 11), 'municipal', 'MS', '5005681')['active'])        # Mundo Novo (Lei 1.504/2026)
        self.assertIsNone(find(D(2026, 5, 13), 'municipal', 'MS', '5005681'))
        self.assertFalse(find(D(2026, 6, 24), 'municipal', 'MS', '5003207')['active'])       # São João de Corumbá: baixa
        self.assertEqual({r['day'].year for r in ROWS if r['rule_key'].startswith('ms_') and r['scope'] == 'municipal'}, {2026})

    def test_mt_sem_estadual_e_municipais_conferidos_no_doe(self):
        self.assertFalse([r for r in ROWS if r['scope'] == 'state' and r['uf'] == 'MT'])
        self.assertTrue(find(D(2026, 10, 31), 'municipal', 'MT', '5105580')['active'])      # Marcelândia
        self.assertTrue(find(D(2026, 9, 8), 'municipal', 'MT', '5101001')['active'])        # Araguaiana
        self.assertFalse(find(D(2026, 12, 8), 'municipal', 'MT', '5103403')['active'])      # Cuiabá: lei não achada

    def test_df_distrital(self):
        self.assertEqual([r['day'] for r in ROWS if r['rule_key'] == 'df_corpus_christi'], [D(2026, 6, 4), D(2027, 5, 27), D(2028, 6, 15)])
        self.assertEqual([r['day'] for r in ROWS if r['rule_key'] == 'df_dia_evangelico'], [D(2026, 11, 30), D(2027, 11, 30), D(2028, 11, 30)])
        self.assertIsNone(find(D(2026, 4, 21), 'state', 'DF'))                               # Tiradentes já é nacional
        self.assertIn('Lei distrital DF 963/1995', find(D(2026, 11, 30), 'state', 'DF')['legal_basis'])

    def test_codigos_ibge_dos_novos_estados_batem_com_a_uf(self):
        for r in ROWS:
            if r['scope'] == 'municipal' and r['uf'] in ('PR', 'SC', 'RS', 'GO', 'MT', 'MS', 'DF'):
                self.assertEqual(fs.UF_BY_PREFIX[r['ibge_code'][:2]], r['uf'], r['rule_key'])


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
