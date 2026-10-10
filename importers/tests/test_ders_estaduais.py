"""Testes unitários da frente ders_estaduais (sem rede, sem banco e sem Valhalla).

Rodar (na imagem do importador, com data/raw montado para validar a curadoria):
  docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data/raw:/data/raw:ro --entrypoint python truck-router-importer \
    -m unittest tests.test_ders_estaduais -v
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
if not (pathlib.Path(os.environ.get('DATA_DIR', '/data')) / 'raw' / 'ders_estaduais').exists():
    os.environ['DATA_DIR'] = str(pathlib.Path(__file__).resolve().parents[2] / 'data')  # fora do container: data/ do repo

from sources import _ders  # noqa: E402
from sources import oae_der_mg  # noqa: E402
from sources import rodovias_estaduais_der_mg as pc  # noqa: E402


class SituacaoPontoCritico(unittest.TestCase):
    """O campo do painel público (trafeg_variante) manda; trafegabilidade é o reserva."""

    def test_trafeg_variante_tem_prioridade(self):
        # caso real (MG-220, Santo Hipólito, 10/10/2026): trafegabilidade 1 (livre) e trafeg_variante "para pesados"
        p = {'trafeg_variante': 'Pista interrompida para veículos pesados', 'trafegabilidade': '1', 'solucao_trafego': '2'}
        self.assertEqual(pc.situacao(p), ('interrompida_pesados', 'trafeg_variante'))
        self.assertEqual(pc.situacao({'trafeg_variante': 'Pista Interrompida - Com Variante', 'trafegabilidade': '3'})[0],
                         'interrompida_com_variante')
        self.assertEqual(pc.situacao({'trafeg_variante': 'Meia-Pista', 'trafegabilidade': '0'})[0], 'meia_pista')

    def test_reserva_por_trafegabilidade_e_variante(self):
        self.assertEqual(pc.situacao({'trafegabilidade': '3', 'solucao_trafego': '1'}), ('interrompida_com_variante', 'trafegabilidade'))
        self.assertEqual(pc.situacao({'trafegabilidade': '3', 'solucao_trafego': '2'})[0], 'interrompida')
        self.assertEqual(pc.situacao({'trafegabilidade': '4'})[0], 'interrompida_pesados')
        self.assertEqual(pc.situacao({'trafegabilidade': '0'})[0], 'a_definir')

    def test_interrupcao_com_leves_liberados_vira_so_pesados(self):
        self.assertEqual(pc.situacao({'trafeg_variante': 'Pista Interrompida', 'veiculos_leves': '1'})[0], 'interrompida_pesados')


class Rodovias(unittest.TestCase):
    def test_codigos_de_mg(self):
        self.assertEqual(_ders.rodovia_mg('MG457 '), 'MG-457')
        self.assertEqual(_ders.rodovia_mg('CMG262'), 'MGC-262')
        self.assertEqual(_ders.rodovia_mg('AMG-900'), 'AMG-900')
        self.assertEqual(_ders.rodovia_de_sre_mg('010EMG0040D'), 'MG-010')
        self.assertEqual(_ders.rodovia_de_sre_mg('262CMG0010'), 'MGC-262')
        self.assertEqual(_ders.refs_osm('MGC-262'), ['MGC-262', 'BR-262'])

    def test_tipo_da_oae(self):
        self.assertEqual(oae_der_mg._kind('Ponte', 'Madeira', None), ('ponte_madeira', False))
        self.assertEqual(oae_der_mg._kind('Viaduto Ferroviário', 'Concreto', None), ('viaduto', False))
        self.assertEqual(oae_der_mg._kind(None, None, 'Rio Pomba'), ('ponte', True))
        self.assertEqual(oae_der_mg._kind('Esteira Transportadora', None, None), ('outra', False))


class RecorteKm(unittest.TestCase):
    def test_recorte_proporcional(self):
        # linha reta de ~11,1 km (0,1° de latitude) representando o km 30 ao 40
        linha = [[-40.0, -20.0], [-40.0, -20.1]]
        r = _ders.recorte_km(linha, 30, 40, 33, 39)
        self.assertAlmostEqual(r[0][1], -20.03, places=3)
        self.assertAlmostEqual(r[-1][1], -20.09, places=3)


class Curadoria(unittest.TestCase):
    def test_regras_versionadas_sao_validas(self):
        d = _ders.carrega_regras()
        ativas = {r['regra_id'] for r in d['trechos'] if r['ativa']}
        self.assertEqual(ativas, {'es_060_km33_39_23t', 'es_060_acesso_9020_23t'})
        self.assertEqual(next(r for r in d['trechos'] if r['regra_id'] == 'es_060_darly_jones_23t_2023')['status'], 'revogada')
        self.assertFalse(next(r for r in d['trechos'] if r['regra_id'] == 'rj_127_serra_paracambi')['ativa'])
        self.assertEqual(len(d['pontes']), 17)
        for r in d['trechos'] + d['pontes']:
            self.assertRegex(r['ato'], r'(arts?\.|item|Não há ato normativo)', r['regra_id'])

    def _carrega(self, regras: dict):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump(regras, f)
        os.environ['DERS_REGRAS_JSON'] = f.name
        try:
            return _ders.carrega_regras()
        finally:
            del os.environ['DERS_REGRAS_JSON']
            os.unlink(f.name)

    def test_confianca_baixa_nao_pode_ficar_ativa(self):
        base = {'regra_id': 'x', 'ato': 'IS 1-N/2024, art. 1º', 'status': 'vigente', 'ativa': True, 'confianca': 'baixa'}
        with self.assertRaises(ValueError):
            self._carrega({'trechos': [base], 'pontes': []})
        with self.assertRaises(ValueError):   # revogada ativa
            self._carrega({'trechos': [{**base, 'confianca': 'alta', 'status': 'revogada'}], 'pontes': []})
        with self.assertRaises(ValueError):   # sem artigo
            self._carrega({'trechos': [{**base, 'confianca': 'alta', 'ato': 'IS 1-N/2024'}], 'pontes': []})
        with self.assertRaises(ValueError):   # desligada sem motivo
            self._carrega({'trechos': [{**base, 'confianca': 'alta', 'ativa': False, 'status': 'desativada'}], 'pontes': []})
        ok = self._carrega({'trechos': [{**base, 'confianca': 'alta'}], 'pontes': []})
        self.assertTrue(ok['trechos'][0]['ativa'])


if __name__ == '__main__':
    unittest.main()
