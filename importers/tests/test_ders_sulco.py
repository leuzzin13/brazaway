"""Testes unitários da geometria e da curadoria das regras do Sul e do Centro-Oeste (PR, RS, GO, MT, DF), sem rede, sem banco e
sem Valhalla (o índice de ways por ref é trocado por um sintético).

Rodar:  cd importers && DATA_DIR=../data python3 -m unittest tests.test_ders_sulco -v
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
if not (pathlib.Path(os.environ.get('DATA_DIR', '/data')) / 'raw' / 'ders_estaduais').exists():
    os.environ['DATA_DIR'] = str(pathlib.Path(__file__).resolve().parents[2] / 'data')

from sources import _ders, _ders_sulco as ds  # noqa: E402

# Rodovia sintética "XX-100" correndo para leste a 0,001° (~100 m) por vértice, com uma falha de 150 m entre dois ways
# (o ref do OSM tem way sem `ref` no meio) e uma pista paralela a ~30 m de um dos ways.
LAT = -20.0
def pt(i: int, dy: float = 0.0) -> list[float]:
    return [round(-50.0 + i * 0.001, 6), round(LAT + dy, 6)]
SINT = {
    'XX-100': [
        {'hw': 'primary', 'ow': None, 'c': [pt(i) for i in range(0, 11)]},             # 0..10  (~1,05 km)
        {'hw': 'primary', 'ow': None, 'c': [pt(i) for i in range(12, 21)]},            # 12..20 (falha de ~210 m entre 10 e 12)
        {'hw': 'primary', 'ow': 'yes', 'c': [pt(i, 0.00027) for i in range(14, 18)]},  # pista paralela a ~30 m
    ],
    'YY-200': [{'hw': 'primary', 'ow': None, 'c': [[-49.99, LAT - 0.005], [-49.99, LAT], [-49.99, LAT + 0.005]]}],
    'XX-300': [{'hw': 'primary', 'ow': None, 'c': [pt(i, 0.05) for i in range(0, 5)]}],
}


class GeometriaOsmRef(unittest.TestCase):
    def setUp(self):
        self._old = ds._idx
        ds._idx = SINT

    def tearDown(self):
        ds._idx = self._old

    def test_norm_ref(self):
        self.assertEqual(ds.norm_ref('pr 534'), 'PR-534')
        self.assertEqual(ds.norm_ref('ERS-020A'), 'ERS-020A')
        self.assertEqual(ds.norm_ref('GO108'), 'GO-108')

    def test_caminho_atravessa_falha_curta_do_ref(self):
        spec = {'osm_ref': ['XX-100'], 'de': {'lon': pt(1)[0], 'lat': LAT, 'tol_m': 300}, 'para': {'lon': pt(19)[0], 'lat': LAT, 'tol_m': 300},
                'lacuna_m': 300}
        g, info = ds.geometria_regra(spec)
        self.assertEqual(g['type'], 'MultiLineString')
        km = info['extensao_km']
        self.assertAlmostEqual(km, 1.9 * 1.0446, delta=0.15)   # 18 passos de 0,001° ao longo de uma latitude de -20°
        self.assertEqual(info['pistas_paralelas'], 1)
        # sem a costura da falha o ref não liga as duas pontas
        with self.assertRaises(ValueError):
            ds.geometria_regra({**spec, 'lacuna_m': 50})

    def test_extensao_do_ato_confere_e_avisa(self):
        base = {'osm_ref': ['XX-100'], 'de': {'lon': pt(1)[0], 'lat': LAT, 'tol_m': 300}, 'para': {'lon': pt(9)[0], 'lat': LAT, 'tol_m': 300}}
        _, ok = ds.geometria_regra({**base, 'extensao_km': 0.84})
        self.assertNotIn('aviso', ok)
        _, ruim = ds.geometria_regra({**base, 'extensao_km': 2.0})
        self.assertIn('aviso', ruim)

    def test_inicio_km_e_ultimos_km(self):
        base = {'osm_ref': ['XX-100'], 'de': {'lon': pt(0)[0], 'lat': LAT, 'tol_m': 300}, 'para': {'lon': pt(10)[0], 'lat': LAT, 'tol_m': 300}}
        _, tudo = ds.geometria_regra(base)
        _, sem3 = ds.geometria_regra({**base, 'inicio_km': 0.5})
        _, fim = ds.geometria_regra({**base, 'ultimos_km': 0.3})
        self.assertAlmostEqual(tudo['extensao_km'] - sem3['extensao_km'], 0.5, delta=0.11)
        self.assertAlmostEqual(fim['extensao_km'], 0.3, delta=0.11)

    def test_ancora_longe_do_ref_e_cruzamento(self):
        longe = {'osm_ref': ['XX-100'], 'de': {'lon': -49.9, 'lat': LAT + 0.5}, 'para': {'lon': pt(9)[0], 'lat': LAT}}
        with self.assertRaises(ValueError):
            ds.geometria_regra(longe)
        # cruzamento YY-200 × XX-100: nó em (-49.99, LAT)
        idx = dict(SINT)
        idx['XX-100'] = [{'hw': 'primary', 'ow': None, 'c': [pt(i) for i in range(0, 21)]}]
        ds._idx = idx
        g, info = ds.geometria_regra({'osm_ref': ['XX-100'], 'de': {'cruza': 'YY-200'}, 'para': {'lon': pt(20)[0], 'lat': LAT, 'tol_m': 300}})
        self.assertAlmostEqual(info['ancoras'][0]['lon'], -49.99, places=3)
        self.assertAlmostEqual(info['extensao_km'], 1.0446, delta=0.1)

    def test_ref_inexistente(self):
        with self.assertRaises(ValueError):
            ds.geometria_regra({'osm_ref': ['ZZ-999']})

    def test_rodovia_inteira_sem_ancoras(self):
        g, info = ds.geometria_regra({'osm_ref': ['XX-300']})
        self.assertEqual(len(g['coordinates']), 1)
        self.assertEqual(info['ways_ref'], 1)

    def test_lista_de_trechos_junta_geometrias(self):
        s1 = {'osm_ref': ['XX-100'], 'de': {'lon': pt(1)[0], 'lat': LAT, 'tol_m': 300}, 'para': {'lon': pt(9)[0], 'lat': LAT, 'tol_m': 300}}
        g, info = ds.geometria_regra([s1, {'osm_ref': ['XX-300']}])
        self.assertEqual(len(g['coordinates']), 2)
        self.assertAlmostEqual(info['extensao_km'], 0.84 + 0.42, delta=0.15)


class CuradoriaDoSulECentroOeste(unittest.TestCase):
    UFS = {'PR', 'RS', 'GO', 'MT', 'DF'}
    CRITERIOS = {'todos', 'caminhoes', 'exceto_vuc', 'peso_acima_t', 'peso_igual_ou_acima_t', 'peso_ate_t', 'eixos_acima', 'eixos_ate',
                 'comprimento_acima_m', 'comprimento_ate_m', 'cumulativo', 'ou', 'isenta_carga'}

    @classmethod
    def setUpClass(cls):
        cls.regras = [r for r in _ders.carrega_regras()['trechos'] if r['uf'] in cls.UFS]

    def test_regras_existem_em_todas_as_ufs_esperadas(self):
        self.assertEqual({r['uf'] for r in self.regras}, self.UFS)
        self.assertGreaterEqual(len([r for r in self.regras if r['ativa']]), 30)

    def test_criterio_so_com_campos_que_a_api_entende(self):
        for r in self.regras:
            self.assertTrue(set(r['criterio']) <= self.CRITERIOS, r['regra_id'])
            for sub in r['criterio'].get('ou', []):
                self.assertTrue(set(sub) <= self.CRITERIOS, r['regra_id'])
            for k, v in r['criterio'].items():
                if k.endswith(('_t', '_m')) or k.startswith(('eixos_',)):
                    self.assertIsInstance(v, (int, float), r['regra_id'])

    def test_janelas_bem_formadas(self):
        for r in self.regras:
            for j in r.get('janelas', []):
                self.assertTrue(j.get('datas') or j.get('dias_semana'), r['regra_id'])
                for d in j.get('datas', []):
                    self.assertRegex(d, r'^\d{4}-\d{2}-\d{2}$')
                for dw in j.get('dias_semana', []):
                    self.assertIn(dw, range(1, 8))
                self.assertLess(j.get('inicio', '00:00'), j.get('fim', '24:00'), r['regra_id'])

    def test_geometria_aponta_para_osm_ou_rota(self):
        def confere(sp, rid):
            if isinstance(sp, list):
                for x in sp:
                    confere(x, rid)
            elif sp.get('specs_arquivo'):
                self.assertTrue((pathlib.Path(os.environ['DATA_DIR']) / 'raw' / 'ders_estaduais' / sp['specs_arquivo']).exists(), rid)
            elif sp.get('rota'):
                self.assertEqual(len(sp['rota']['de']), 2, rid)
                self.assertEqual(len(sp['rota']['para']), 2, rid)
            else:
                self.assertTrue(sp.get('osm_ref'), rid)
                if sp.get('de') or sp.get('para'):
                    self.assertTrue(sp.get('de') and sp.get('para'), rid)
        for r in self.regras:
            if r.get('geometria'):
                confere(r['geometria'], r['regra_id'])
            elif r['ativa']:
                self.fail(f'{r["regra_id"]}: regra ativa sem geometria')

    def test_ativa_so_com_ato_vigente_e_confianca_suficiente(self):
        for r in self.regras:
            if r['ativa']:
                self.assertEqual(r['status'], 'vigente', r['regra_id'])
                self.assertIn(r['confianca'], ('alta', 'media'), r['regra_id'])
            else:
                self.assertTrue(r.get('motivo_inativa'), r['regra_id'])

    def test_anexo_da_dn148_do_rs(self):
        base = pathlib.Path(os.environ['DATA_DIR']) / 'raw' / 'ders_estaduais' / 'rs_dn148_trechos.json'
        itens = json.loads(base.read_text(encoding='utf-8'))
        self.assertEqual(len(itens), 165)
        ok = [i for i in itens if i.get('spec')]
        self.assertGreaterEqual(len(ok), 120)
        for i in ok:
            ext = i['ext_ato_km']
            self.assertLessEqual(abs(i['extensao_osm_km'] - ext), max(0.4, 0.25 * ext), i['item'])


if __name__ == '__main__':
    unittest.main()
