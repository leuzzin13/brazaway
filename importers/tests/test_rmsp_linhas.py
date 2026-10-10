"""Testes unitários do corte/encadeamento das linhas da camada restricoes_rmsp (sem rede e sem banco); a biblioteca é a do importador municipios.

Rodar (na imagem do importador):
  docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest discover -s tests -v
"""
from __future__ import annotations
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import _municipios_lib as b  # noqa: E402


def _reta(n_pts: int, passo_graus: float = 0.0005, lon0: float = -46.85, lat0: float = -23.47):
    return [[round(lon0 + i * passo_graus, 7), lat0] for i in range(n_pts)]


class SplitLong(unittest.TestCase):
    def test_linha_curta_fica_inteira(self):
        c = _reta(5)                       # ~200 m
        self.assertEqual(b.split_long(c), [c])

    def test_corta_em_pedacos_de_ate_400m_sem_perder_comprimento(self):
        c = _reta(60)                      # ~3 km, vértices a cada ~51 m
        ps = b.split_long(c)
        self.assertGreater(len(ps), 6)
        ls = [b.line_length_m(p) for p in ps]
        self.assertLessEqual(max(ls), b.MAX_PIECE_M + 1)
        self.assertAlmostEqual(sum(ls), b.line_length_m(c), delta=1)
        self.assertEqual(ps[0][0], c[0])
        self.assertEqual(ps[-1][-1], c[-1])
        for p1, p2 in zip(ps, ps[1:]):
            self.assertEqual(p1[-1], p2[0])     # contíguos

    def test_aresta_longa_e_cortada_no_meio(self):
        c = [[-46.85, -23.47], [-46.84, -23.47]]   # uma aresta de ~1 km
        ps = b.split_long(c)
        self.assertEqual(len(ps), 3)
        self.assertTrue(all(b.line_length_m(p) <= b.MAX_PIECE_M for p in ps))


class MergeChains(unittest.TestCase):
    def _via(self, sid, coords, sentido='ambos'):
        return {'source_id': sid, 'kind': 'via', 'geometry': {'type': 'LineString', 'coordinates': coords},
                'props': {'regra_id': 'r', 'inciso': 'I', 'via': 'Rua X', 'sentido': sentido, 'mao_unica': sentido == 'unico',
                          'comprimento_m': round(b.line_length_m(coords))}}

    def test_encadeia_ate_o_limite(self):
        c = _reta(41)                       # ~2 km em 20 trechos contíguos de ~100 m
        segs = [self._via(f's{i}', c[i * 2:(i + 1) * 2 + 1]) for i in range(20)]
        out = b.merge_chains(segs, lambda _c: True)
        self.assertLess(len(out), len(segs))
        self.assertTrue(all(b.line_length_m(f['geometry']['coordinates']) <= b.MAX_PIECE_M + 1 for f in out))
        self.assertAlmostEqual(sum(b.line_length_m(f['geometry']['coordinates']) for f in out), b.line_length_m(c), delta=1)

    def test_nao_encadeia_se_o_valhalla_recusa(self):
        c = _reta(9)
        segs = [self._via('a', c[:5]), self._via('b', c[4:])]
        out = b.merge_chains(segs, lambda _c: False)
        self.assertEqual(sorted(f['source_id'] for f in out), ['a', 'b'])


class ExplodeAndSplit(unittest.TestCase):
    def test_multilinestring_vira_uma_feicao_por_parte(self):
        f = {'source_id': 'm', 'kind': 'via', 'geometry': {'type': 'MultiLineString', 'coordinates': [_reta(3), _reta(3, lat0=-23.48)]},
             'props': {'regra_id': 'r', 'sentido': 'ambos'}}
        out = b.explode_and_split([f])
        self.assertEqual([x['source_id'] for x in out], ['m-p0', 'm-p1'])
        self.assertTrue(all(x['geometry']['type'] == 'LineString' for x in out))
        self.assertIsNot(out[0]['props'], out[1]['props'])     # o sentido de uma parte não contamina a outra


if __name__ == '__main__':
    unittest.main()
