"""Testes unitários dos importadores das camadas altura_osm e lacunas_osm (sem PBF, sem rede e sem banco).

Rodar (na imagem do importador):
  docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest tests.test_osm_altura -v
"""
from __future__ import annotations
import itertools, pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources.osm_altura_nos import oneway_dir, parse_length, parse_weight, valhalla_weight  # noqa: E402
from sources.osm_lacunas import SID_PREFIX, classify_restrictor, height_status, way_source_id  # noqa: E402


class ParseLength(unittest.TestCase):
    def test_numero_simples_e_virgula(self):
        self.assertEqual(parse_length('4.5'), 4.5)
        self.assertEqual(parse_length('4,5'), 4.5)
        self.assertEqual(parse_length(' 4.3 '), 4.3)

    def test_metros_por_extenso(self):
        # antes da correção a alternância do regex casava 'm' e sobrava 'etros'/'eters' -> None
        for v in ('4,5 metros', '4.5 metros', '1 metro', '4 meters', '4 meter', '4 metres', '4.5 m', '4.5m', '4 mts', '4 mt'):
            self.assertIsNotNone(parse_length(v), v)
        self.assertEqual(parse_length('4,5 metros'), 4.5)
        self.assertEqual(parse_length('4 meters'), 4.0)
        self.assertEqual(parse_length('4 METROS'), 4.0)

    def test_centimetros(self):
        self.assertEqual(parse_length('450 cm'), 4.5)
        self.assertEqual(parse_length('4 m 30 cm'), 4.3)

    def test_pes_e_polegadas(self):
        self.assertEqual(parse_length('12 inches'), 0.3)
        self.assertEqual(parse_length('12 inch'), 0.3)
        self.assertEqual(parse_length('12 in'), 0.3)
        self.assertEqual(parse_length('14\'6"'), 4.42)
        self.assertEqual(parse_length("14'6''"), 4.42)
        self.assertEqual(parse_length('14 ft'), 4.27)
        self.assertEqual(parse_length('14 feet'), 4.27)

    def test_sem_valor(self):
        for v in (None, '', 'default', 'none', 'below_default', 'no_indications', 'unsigned', 'baixo', '4 min', '4.5 metros e meio'):
            self.assertIsNone(parse_length(v), v)


class ParseWeight(unittest.TestCase):
    def test_unidades(self):
        self.assertEqual(parse_weight('12'), (12.0, None))
        self.assertEqual(parse_weight('3,5'), (3.5, None))
        self.assertEqual(parse_weight('12 t'), (12.0, None))
        self.assertEqual(parse_weight('12000 kg'), (12.0, None))

    def test_suspeitos(self):
        self.assertEqual(parse_weight('5000')[1], 'número sem unidade muito alto (provável kg)')
        self.assertEqual(parse_weight('0.5')[1], 'menor que 1 t')
        self.assertEqual(parse_weight('doze')[1], 'formato não reconhecido')

    def test_valhalla_le_virgula_errado(self):
        # normalize_weight do graph.lua 3.9.1 não trata vírgula: '3,5' vira 3
        self.assertEqual(valhalla_weight('3,5'), 3.0)
        self.assertEqual(valhalla_weight('12000kg'), 12.0)


class Sentido(unittest.TestCase):
    def test_oneway(self):
        self.assertEqual(oneway_dir({'oneway': 'yes'}), 1)
        self.assertEqual(oneway_dir({'oneway': '-1'}), -1)
        self.assertEqual(oneway_dir({'junction': 'roundabout'}), 1)
        self.assertEqual(oneway_dir({'highway': 'motorway'}), 0)   # sem oneway implícito em motorway (graph.lua)


class Restritor(unittest.TestCase):
    """barrier=height_restrictor sem valor: a classificação não pode depender da ordem das ways no PBF."""

    def _classifica(self, ways):
        r = {'way': None}
        for wid, hs in ways:
            classify_restrictor(r, (wid, f'via {wid}', 'residential'), hs)
        return r['way']

    def test_via_com_maxheight_prevalece_em_qualquer_ordem(self):
        vias = [(1, 'sem_tag'), (2, 'numerico'), (3, 'sem_placa')]
        for ordem in itertools.permutations(vias):
            self.assertEqual(self._classifica(ordem), 'conhecida', ordem)

    def test_sem_via_numerica_fica_a_primeira(self):
        self.assertEqual(self._classifica([(1, 'sem_tag'), (3, 'sem_placa')]), (1, 'via 1', 'residential'))

    def test_height_status(self):
        self.assertEqual(height_status({'maxheight': '4.5'}), 'numerico')
        self.assertEqual(height_status({'maxheight': '4,5 metros'}), 'numerico')
        self.assertEqual(height_status({'maxheight:physical': '5'}), 'numerico')
        self.assertEqual(height_status({'maxheight': 'below_default'}), 'below_default')
        self.assertEqual(height_status({'maxheight': 'default'}), 'sem_placa')
        self.assertEqual(height_status({'maxheight:signed': 'no'}), 'sem_placa')
        self.assertEqual(height_status({}), 'sem_tag')


class SourceId(unittest.TestCase):
    def test_um_prefixo_por_motivo(self):
        # 'maxheight_suspeito' e 'maxweight_suspeito' na mesma via geravam o mesmo 'max<id>' e uma feição sumia
        ids = {way_source_id(reason, 123) for reason in SID_PREFIX}
        self.assertEqual(len(ids), len(SID_PREFIX))
        self.assertNotEqual(way_source_id('maxheight_suspeito', 123), way_source_id('maxweight_suspeito', 123))

    def test_sem_colisao_com_passagem_e_restritor(self):
        # passagem = 'p<way>_<m>', restritor = 'r<nó>': nenhum prefixo de via inteira começa com 'p' ou 'r'
        for pre in SID_PREFIX.values():
            self.assertFalse(pre.startswith(('p', 'r')), pre)


if __name__ == '__main__':
    unittest.main()
