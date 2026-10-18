"""Testes unitários dos importadores de pedágio estadual do RS, MS e MT (sem rede e sem banco).

Rodar: cd importers && python3 -m unittest tests.test_pedagio_sul_co -v
"""
from __future__ import annotations
import json, pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import _toll_estaduais as base, toll_agems, toll_agermt, toll_rs_estadual  # noqa: E402

RAW = pathlib.Path(__file__).resolve().parents[2] / 'data' / 'raw' / 'pedagio'
SUL_CO = RAW / 'concessoes_estaduais_sul_co.json'
if (RAW / 'concessoes_estaduais.json').exists():  # fora do contêiner (DATA_DIR padrão não existe)
    base.CURATED = RAW / 'concessoes_estaduais.json'
    base.CURATED_SUL_CO = SUL_CO


def curated() -> dict:
    return json.loads((SUL_CO if SUL_CO.exists() else base.CURATED_SUL_CO).read_text(encoding='utf-8'))


def concs(imp: str) -> list[dict]:
    return [c for c in curated()['concessoes'] if c['importador'] == imp]


class Curadoria(unittest.TestCase):
    def test_load_soma_os_dois_arquivos(self):
        ids = {c['id'] for c in base.load()['concessoes']}
        self.assertIn('rj_vialagos', ids)
        self.assertIn('ms_way306', ids)
        self.assertEqual(len(base.concessoes('agems')[1]), 3)
        self.assertEqual(len(base.concessoes('agermt')[1]), 4)
        self.assertEqual(len(base.concessoes('rs_estadual')[1]), 6)

    def test_toda_concessao_cita_ato_e_fonte(self):
        for c in curated()['concessoes']:
            self.assertTrue(c.get('ato') and c.get('ato_url'), c['id'])
            self.assertIn(c['uf'], ('RS', 'MS', 'MT'))
            self.assertEqual(c['esfera'], 'estadual')
            self.assertTrue(c.get('pracas'), c['id'])
            for p in c['pracas']:
                self.assertEqual(p['posicao']['metodo'], 'osm', f"{c['id']}/{p['id']}")
                self.assertEqual(len(p['posicao']['ancora']), 2)

    def test_tabelas_lineares_conferem_com_o_multiplicador(self):
        for c in curated()['concessoes']:
            t = c['tarifa']
            for cat in t['categorias']:
                self.assertAlmostEqual(cat['valor'], round(t['base'] * cat['mult'], 2), delta=0.051, msg=f"{c['id']} cat {cat.get('cat')}")

    def test_valores_transcritos_dos_atos(self):
        by = {c['id']: c for c in curated()['concessoes']}
        v5 = lambda cid: next(x['valor'] for x in by[cid]['tarifa']['categorias'] if x['eixos'] == 5 and x['rodagem'] == 'dupla')
        # AGEMS (Portarias 333 e 326/2026): categoria 7 (5 eixos)
        self.assertEqual(v5('ms_way306'), 72.00)
        self.assertEqual(v5('ms_way112'), 70.00)
        self.assertEqual(v5('ms_way112_p6'), 23.00)
        # AGER/MT
        self.assertEqual(v5('mt_morro_da_mesa'), 58.50)
        self.assertEqual(v5('mt_via_brasil_mt246'), 57.00)
        self.assertEqual(v5('mt_via_brasil_mt320'), 58.50)
        self.assertEqual(v5('mt_via_brasil_mt100'), 58.50)
        # RS: Rota de Santa Maria (cat. VII = 5 eixos) e EGR por grupo de praças (5 eixos)
        self.assertEqual(v5('rs_rota_de_santa_maria'), 27.00)
        self.assertEqual([v5(f'rs_egr_{g}') for g in 'abcde'], [31.5, 35.5, 16.25, 24.5, 31.5])

    def test_categoria_13_ms_e_eixo_adicional(self):
        by = {c['id']: c for c in curated()['concessoes']}
        self.assertEqual(by['ms_way306']['tarifa']['eixo_adicional'], 14.40)   # nota (2): cat. 9 + cat. 1 por eixo excedente
        self.assertEqual(by['ms_way112_p6']['tarifa']['eixo_adicional'], 4.60)
        self.assertEqual(by['mt_via_brasil_mt320']['vigencia_fim'], '2026-10-28')  # 7º reajuste em tramitação

    def test_pendentes_nao_entram(self):
        txt = json.dumps(curated(), ensure_ascii=False).lower()
        for nome in ('mt_via_norte_sul', 'rota_dos_graos', 'csg', 'intervias', 'apasi', 'celulose'):
            self.assertFalse(any(nome in c['id'] for c in curated()['concessoes']), nome)
        self.assertIn('não entram', txt)


class Features(unittest.TestCase):
    NODES = [
        {'id': 'n1', 'lon': -53.08426, 'lat': -18.38226, 'operador': 'Way-306', 'name': 'Costa Rica', 'rodovias': [], 'kind': 'praca'},
        {'id': 'n2', 'lon': -53.08407, 'lat': -18.38223, 'operador': 'Way-306', 'name': 'Costa Rica', 'rodovias': [], 'kind': 'praca'},
    ]

    def test_praca_casa_com_no_do_osm_e_leva_tarifa(self):
        d = base.load()
        conc = next(c for c in d['concessoes'] if c['id'] == 'ms_way306')
        tarifa = base.build_tariff(conc, d, 'AGEMS', conc['ato_url'])
        log: list[str] = []
        feats = base.features(conc, d, tarifa, self.NODES, log=log)
        p1 = next(f for f in feats if f['props']['praca_id'] == 'P1')
        self.assertEqual(p1['props']['precisao'], 'osm')
        self.assertEqual(p1['props']['osm_nodes'], ['n1', 'n2'])
        self.assertEqual(p1['props']['tarifa']['vigencia_inicio'], '2026-04-09')
        self.assertEqual(p1['props']['regulador'], 'AGEMS')
        # sem nó do OSM perto: âncora curada, precisão aproximada e aviso
        self.assertTrue(any('P2' in l for l in log))
        p2 = next(f for f in feats if f['props']['praca_id'] == 'P2')
        self.assertEqual(p2['props']['precisao'], 'aprox')

    def test_modulos_declaram_fonte_e_licenca(self):
        for m, s in ((toll_agems, 'agems'), (toll_agermt, 'agermt'), (toll_rs_estadual, 'rs-estadual')):
            self.assertEqual(m.LAYER_ID, 'pedagio')
            self.assertEqual(m.SOURCE, s)
            self.assertIn('OpenStreetMap', m.LICENSE)


if __name__ == '__main__':
    unittest.main()
