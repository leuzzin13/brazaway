"""Testes unitários dos importadores de pedágio estaduais/municipais e da balança do DER-MG (sem rede e sem banco).

Rodar (na imagem do importador):
  docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data:/data --entrypoint python truck-router-importer -m unittest tests.test_pedagio_estaduais -v
"""
from __future__ import annotations
import json, pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import _toll_estaduais as base, toll_agetransp, weigh_dermg  # noqa: E402

FIX = pathlib.Path(__file__).parent / 'fixtures'
CURATED = pathlib.Path(__file__).resolve().parents[2] / 'data' / 'raw' / 'pedagio' / 'concessoes_estaduais.json'


def curated() -> dict:
    p = CURATED if CURATED.exists() else base.CURATED
    return json.loads(p.read_text(encoding='utf-8'))


class AgetranspPage(unittest.TestCase):
    def test_vialagos_tbp_tba(self):
        page = toll_agetransp.parse_page((FIX / 'agetransp_vialagos.html').read_text(encoding='utf-8'))
        self.assertEqual(page['desde'], '2025-08-01')
        self.assertEqual(page['deliberacao'][0], '1630')
        by = {r['mult']: r for r in page['linhas']}
        self.assertEqual(by[1.0]['valor'], 18.40)
        self.assertEqual(by[1.0]['valor_fds'], 30.60)
        self.assertEqual(by[5.0]['valor'], 92.00)
        self.assertEqual(by[5.0]['valor_fds'], 153.00)

    def test_rota116_nao_linear(self):
        page = toll_agetransp.parse_page((FIX / 'agetransp_rota116.html').read_text(encoding='utf-8'))
        self.assertEqual(page['deliberacao'][0], '1631')
        by = {r['mult']: r['valor'] for r in page['linhas']}
        self.assertEqual(by, {1.0: 9.60, 2.0: 19.20, 4.0: 38.40, 7.0: 67.20})  # isentos fora

    def test_merge_mantem_transcricao_e_completa_8_eixos(self):
        d = curated()
        conc = next(c for c in d['concessoes'] if c['id'] == 'rj_rota116')
        page = toll_agetransp.parse_page((FIX / 'agetransp_rota116.html').read_text(encoding='utf-8'))
        cats, tbp, eixo_ad, diffs = toll_agetransp.merge_tariff(conc, page)
        self.assertEqual(diffs, [])
        self.assertEqual(tbp, 9.60)
        self.assertEqual(eixo_ad, 9.60)
        self.assertEqual(next(c for c in cats if c['eixos'] == 8)['valor'], 76.80)
        # página com reajuste hipotético: TBP 10,00 -> categorias recalculadas pela página (8 eixos = 8 x TBP)
        html = (FIX / 'agetransp_rota116.html').read_text(encoding='utf-8')
        for a, b in (('R$ 9,60', 'R$ 10,00'), ('R$ 19,20', 'R$ 20,00'), ('R$ 38,40', 'R$ 40,00'), ('R$ 67,20', 'R$ 70,00')):
            html = html.replace(a, b)
        cats2, tbp2, _, diffs2 = toll_agetransp.merge_tariff(conc, toll_agetransp.parse_page(html))
        self.assertEqual(tbp2, 10.0)
        self.assertEqual(next(c for c in cats2 if c['eixos'] == 8)['valor'], 80.0)
        self.assertTrue(diffs2)


class Curadoria(unittest.TestCase):
    def test_dms_e_utm(self):
        lon, lat = base.dms('21°58\'56.40"S 46°19\'48.40"W')
        self.assertAlmostEqual(lat, -21.982333, places=5)
        self.assertAlmostEqual(lon, -46.330111, places=5)
        lon, lat = base.utm23s(349444.1235, 7527152.3217)
        self.assertAlmostEqual(lat, -22.35496, places=4)
        self.assertAlmostEqual(lon, -46.46213, places=4)

    def test_tabelas_lineares_conferem_com_o_multiplicador(self):
        """Tabelas ARTEMIG por multiplicador: valor = TBP x mult (até R$ 0,05 de arredondamento publicado)."""
        for c in curated()['concessoes']:
            t = c.get('tarifa')
            if not t or t.get('nao_linear') or c.get('importador') == 'municipais':
                continue
            for cat in t['categorias']:
                self.assertAlmostEqual(cat['valor'], round(t['base'] * cat['mult'], 2), delta=0.051, msg=f"{c['id']} cat {cat.get('cat')}")

    def test_toda_regra_ativa_cita_ato_e_inativa_tem_motivo(self):
        for c in curated()['concessoes']:
            if c.get('importador') is None:
                continue
            self.assertTrue(c.get('ato') and c.get('ato_url'), c['id'])
            if c.get('confianca') == 'baixa':
                self.assertFalse(c.get('ativo', True), c['id'])
            if c.get('ativo') is False:
                self.assertTrue(c.get('motivo_inativo'), c['id'])
            for p in c.get('pracas', []):
                if p.get('ativo') is False:
                    self.assertTrue(p.get('motivo_inativo'), f"{c['id']}/{p['id']}")

    def test_reajuste_suspenso_nao_aplicado(self):
        c = next(c for c in curated()['concessoes'] if c['id'] == 'mg_lote2_sul_de_minas')
        self.assertEqual(c['tarifa']['base'], 10.10)
        self.assertFalse(c['reajuste_suspenso']['aplicado'])

    def test_casamento_osm_pelo_operador(self):
        conc = {'id': 'x', 'operador': 'Rota 116', 'operador_osm': 'rota ?116'}
        nodes = [
            {'id': 'n1', 'lon': -42.81135, 'lat': -22.71576, 'operador': 'Rota 116', 'name': 'Itaboraí', 'rodovias': [], 'kind': 'praca'},
            {'id': 'n2', 'lon': -42.81145, 'lat': -22.71570, 'operador': 'Rota 116', 'name': 'Itaboraí', 'rodovias': [], 'kind': 'praca'},
            {'id': 'n3', 'lon': -42.8110, 'lat': -22.7158, 'operador': 'Autopista Fluminense', 'name': 'P4', 'rodovias': [], 'kind': 'praca'},
        ]
        pt, meta = base.place_osm({'ancora': [-42.81140, -22.71573], 'raio_m': 600}, conc, nodes)
        self.assertEqual(meta['osm_nodes'], ['n1', 'n2'])
        self.assertLess(meta['distancia_ancora_m'], 5)
        self.assertIsNone(base.place_osm({'ancora': [-40.0, -20.0], 'raio_m': 600}, conc, nodes))


class DerMgTabela(unittest.TestCase):
    def test_parse_tabela_do_site(self):
        rows = weigh_dermg.parse_site((FIX / 'dermg_pracas_pesagem.html').read_text(encoding='utf-8'))
        self.assertEqual(len(rows), 43)
        r = next(x for x in rows if x['rodovia'] == 'MG050' and x['km'] == 109)
        self.assertEqual(r['municipio'], 'Carmo do Cajuru')
        self.assertEqual(r['operacao'], '24 horas')
        self.assertEqual(r['concessao'], 'Nascentes das Gerais')
        ramos = [x for x in rows if x['rodovia'] == 'MGC267']
        self.assertEqual(sorted(x['ramo'] for x in ramos), ['A', 'B'])

    def test_casamento_por_numero_km_e_ramo(self):
        pts = [
            {'rodovia': 'BR267', 'km': 536.5, 'municipio': 'Poços de Caldas (Ramo A)', 'lon': -46.6, 'lat': -21.8, 'status': 'x'},
            {'rodovia': 'BR267', 'km': 536.5, 'municipio': 'Poços de Caldas (Ramo B)', 'lon': -46.61, 'lat': -21.81, 'status': 'x'},
            {'rodovia': 'MG449', 'km': 9.3, 'municipio': 'Arceburgo (Ramo A)', 'lon': -46.9, 'lat': -21.3, 'status': 'x'},
            {'rodovia': 'MG449', 'km': 9.3, 'municipio': 'Arceburgo (Ramo B)', 'lon': -46.91, 'lat': -21.31, 'status': 'x'},
        ]
        a = weigh_dermg.match_point({'rodovia': 'MGC267', 'km': 536.5, 'municipio': 'Poços de Caldas - Ramo B (Sentido Minas Gerais/São Paulo)', 'ramo': 'B'}, pts, set())
        self.assertIn('Ramo B', a['municipio'])
        b = weigh_dermg.match_point({'rodovia': 'MG449', 'km': 9.3, 'municipio': 'Arceburgo - Ramo A', 'ramo': 'A'}, pts, set())
        self.assertIn('Ramo A', b['municipio'])
        self.assertIsNone(weigh_dermg.match_point({'rodovia': 'MG458', 'km': 10, 'municipio': 'Careaçu', 'ramo': None}, pts, set()))


if __name__ == '__main__':
    unittest.main()
