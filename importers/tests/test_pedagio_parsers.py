"""Testes unitários dos parsers das camadas pedagio/balancas (sem rede e sem banco).

Rodar (na imagem do importador):
  docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest discover -s tests -v
"""
from __future__ import annotations
import json, pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import toll_antt, toll_artesp, toll_osm  # noqa: E402

FIX = pathlib.Path(__file__).parent / 'fixtures'


def _tariff_html(headers: list[str], rows: list[tuple]) -> str:
    """Quadro no formato das páginas gov.br/antt: cabeçalho das colunas de valor numa linha própria."""
    head = '<tr><td>Categoria de Veículo</td><td>Tipo</td><td>Número de Eixos</td><td>Rodagem</td><td>Multiplicador da Tarifa</td>' \
           '<td>Valores a serem Praticados (R$)</td></tr>'
    hdr = '<tr>' + ''.join(f'<td>{h}</td>' for h in headers) + '</tr>'
    body = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return (f'<html><body><span class="documentModified"><span>Atualizado em</span><span class="value">06/03/2026 10h00</span></span>'
            f'<div id="content-core"><p>Tarifas de Pedágio</p><table>{head}{hdr}{body}</table></div></body></html>')


class TariffColumnByHeaderName(unittest.TestCase):
    """EPR Litoral Pioneiro: o quadro pula a P4 (P1, P2, P3, P5, …, P9). A coluna tem de sair do NOME do cabeçalho."""

    # valores de 5 eixos da página da ANTT (06/03/2026): P1 120,00; P2 38,50; P3 64,00; P5 60,50; P6 40,00; P7 69,00; P8 64,00; P9 64,00
    HDR = ['P1', 'P2', 'P3', 'P5', 'P6', 'P7', 'P8', 'P9']
    ROWS = [
        ('1', 'Automóvel', '2', 'Simples', '1,0', '24,00', '7,70', '12,80', '12,10', '8,00', '13,80', '12,80', '12,80'),
        ('7', 'Caminhão com reboque', '5', 'Dupla', '5,0', '120,00', '38,50', '64,00', '60,50', '40,00', '69,00', '64,00', '64,00'),
    ]

    def setUp(self):
        self.page = toll_antt.parse_tariff_page(_tariff_html(self.HDR, self.ROWS))

    def v5(self, name: str):
        idx = toll_antt.plaza_index(name, {})
        t = toll_antt.tariff_for(self.page, name, idx)
        return t and next(c['valor'] for c in t['categorias'] if c['eixos'] == 5)

    def test_header_and_date(self):
        self.assertEqual(self.page['data'], '2026-03-06')
        self.assertEqual(self.page['tables'][0]['cols'], self.HDR)

    def test_columns_after_the_gap(self):
        self.assertEqual(self.v5('P05 CARAMBEÍ'), 60.50)     # antes: 40,00 (coluna da P6)
        self.assertEqual(self.v5('P06 JAGUARIAÍVA'), 40.00)  # antes: 69,00
        self.assertEqual(self.v5('P07 QUATIGUÁ'), 69.00)     # antes: 64,00
        self.assertEqual(self.v5('P01 SÃO JOSÉ DOS PINHAIS'), 120.00)

    def test_missing_column_is_none_not_neighbour(self):
        self.assertIsNone(toll_antt.tariff_for(self.page, 'P04 X', 4))
        self.assertIsNone(toll_antt.tariff_for(self.page, 'SEM NUMERO', None))

    def test_header_variants(self):
        for h, k in (('P1', (1, False)), ('P01', (1, False)), ('P 1', (1, False)), ('Praça 12', (12, False)), ('P8 FDS', (8, True))):
            self.assertEqual(toll_antt.col_key(h), k, h)
        self.assertIsNone(toll_antt.col_key('Categoria'))


class TariffWithoutPlazaNumber(unittest.TestCase):
    def test_all_columns_equal_uses_any(self):
        # Autopista Fluminense (04/09/2026): R$ 54,00 para 5 eixos nas 5 praças; nomes do CKAN sem número
        page = toll_antt.parse_tariff_page(_tariff_html(['P1', 'P2', 'P3', 'P4', 'P5'], [
            ('7', 'Caminhão', '5', 'Dupla', '5,0', '54,00', '54,00', '54,00', '54,00', '54,00')]))
        t = toll_antt.tariff_for(page, 'São Gonçalo', None)
        self.assertEqual(t['categorias'][0]['valor'], 54.0)

    def test_different_columns_need_the_number(self):
        page = toll_antt.parse_tariff_page(_tariff_html(['Praça 1', 'Praça 2', 'Praça 3'], [
            ('7', 'Caminhão', '5', 'Dupla', '5,0', '50,00', '54,00', '41,00')]))
        self.assertIsNone(toll_antt.tariff_for(page, 'UBERABA', None))
        self.assertEqual(toll_antt.tariff_for(page, 'ARAGUARI I', 3)['categorias'][0]['valor'], 41.0)

    def test_location_page_maps_name_to_number(self):
        # página "Localização das praças de pedágio" (Ecovias Minas Goiás)
        html = ('<div id="content-core"><table><tr><td>PRAÇA DE PEDÁGIO</td><td>RODOVIA</td><td>UF</td><td>KM/M</td><td>MUNICÍPIO</td></tr>'
                '<tr><td>P03 - ARAGUARI I</td><td>BR-50</td><td>MG</td><td>13,94</td><td>Araguari</td></tr>'
                '<tr><td>P05 - UBERABA</td><td>BR-50</td><td>MG</td><td>104,98</td><td>Uberaba</td></tr></table></div>')
        loc = toll_antt.parse_location_page(html)
        self.assertEqual([e['idx'] for e in loc], [3, 5])
        self.assertEqual(toll_antt.plaza_index('UBERABA', {}, loc, 'BR-50', 104.98), 5)
        self.assertEqual(toll_antt.plaza_index('ARAGUARI I', {}, loc, 'BR-50', 13.94), 3)
        # RIOSP: 'P01 | 204+200 | Arujá | BR116 | SP' (nome no município, km com '+')
        html2 = ('<div id="content-core"><table><tr><td>Praça de Pedágio</td><td>Km</td><td>Município</td><td>Rodovia</td><td>UF</td></tr>'
                 '<tr><td>P06</td><td>86+900</td><td>Moreira César</td><td>BR116</td><td>SP</td></tr></table></div>')
        loc2 = toll_antt.parse_location_page(html2)
        self.assertEqual(loc2[0]['km'], 86.9)
        self.assertEqual(toll_antt.plaza_index('Moreira César Norte', {}, loc2, 'BR-116', 87.0), 6)

    def test_numbering_mismatch(self):
        # Via Campo: CKAN P01–P03, quadro P3–P5
        page = toll_antt.parse_tariff_page(_tariff_html(['P3', 'P4', 'P5'], [('7', 'Caminhão', '5', 'Dupla', '5,0', '94,00', '94,00', '90,00')]))
        self.assertFalse(toll_antt.numbering_ok(page, [1, 2, 3]))
        self.assertTrue(toll_antt.numbering_ok(page, [3, 5]))


class ArtespPontoAPonto(unittest.TestCase):
    def test_papa_is_not_pap(self):
        self.assertTrue(toll_artesp.is_ponto_a_ponto('Pórtico Salto 1 (PaP)'))
        self.assertTrue(toll_artesp.is_ponto_a_ponto('Pórtico PaP Itu'))
        self.assertFalse(toll_artesp.is_ponto_a_ponto('PRAÇA 7 - TRECHO SUL / AV. PAPA JOÃO XXIII (Mauá)'))
        self.assertFalse(toll_artesp.is_ponto_a_ponto('Praça Leste 1 (Alça de Ligação) / Trecho Leste - Papa João XXIII'))


class ArtespNamesAcrossLines(unittest.TestCase):
    """Trecho do PDF de tarifas ARTESP 2026 (lote 25, SPMar) em `pdftotext -layout`: nome da praça quebrado acima e
    abaixo da linha de valores."""

    @classmethod
    def setUpClass(cls):
        txt = (FIX / 'artesp_tarifas_2026_lote25.txt').read_text(encoding='utf-8')
        cls.rows, _ = toll_artesp.parse_tarifas(txt, None)
        cls.by_km = {r['km_txt']: r for r in cls.rows}

    def test_names(self):
        exp = {
            '50+000': 'PRAÇA 1 - TRECHO SUL / TRECHO OESTE (Pista Interna)',
            '70+200': 'PRAÇA 2 - TRECHO SUL / IMIGRANTES (Pista Externa)',
            '86+950': 'PRAÇA 6 - TRECHO SUL INTERSECÇÃO TRECHO LESTE (Pista Externa - P6E)',
            '0+300': 'PRAÇA 7 - TRECHO SUL / AV. PAPA JOÃO XXIII (Mauá)',
            '88+000': 'Praça Leste 1 (Alça de Ligação) / Trecho Leste - Papa João XXIII',
            '87+940': 'Praça Leste 2 (Pista Interna) / Trecho Leste - Trecho Sul',
            '124+740': 'Praça Leste 5 e 6 (Alça Interna e Externa) / Trecho Leste - Ayrton Senna',
            '127+485': 'Praça Leste 7 (Pista Externa) - Intersecção Trecho Leste com Via Dutra',
        }
        for km, name in exp.items():
            self.assertEqual(self.by_km[km]['praca'], name, km)

    def test_values_and_lote(self):
        self.assertEqual(len(self.rows), 11)
        self.assertTrue(all(r['lote'] == 25 for r in self.rows))
        self.assertEqual(self.by_km['0+300']['eixo'], 5.70)
        self.assertEqual(self.by_km['88+000']['eixo'], 4.30)
        self.assertFalse(any(toll_artesp.is_ponto_a_ponto(r['praca']) for r in self.rows))


class OsmOverpassFallback(unittest.TestCase):
    """Fallback sem .osm.pbf: as ways precisam vir com `nodes` (saída `out body geom`), senão o nó fica sem via."""

    def test_ways_attached_to_toll_nodes(self):
        raw = (FIX / 'overpass_toll_bandeirantes.json').read_bytes()
        orig = toll_osm.http_get
        toll_osm.http_get = lambda *a, **k: raw
        try:
            feats = {f['source_id']: f for f in toll_osm._from_overpass()}
        finally:
            toll_osm.http_get = orig
        self.assertIn('n6661114507', feats)  # Pedágio Campo Limpo (sentido interior)
        for f in feats.values():
            p = f['props']
            self.assertEqual(p['rodovia'], 'SP-348')
            self.assertTrue(p['way_bearings'], f['source_id'])
            self.assertTrue(p['oneway'])
            self.assertEqual(p['tarifa']['charge']['hgv_axle']['all'], 14.5)

    def test_query_asks_for_way_nodes(self):
        import inspect
        src = inspect.getsource(toll_osm._from_overpass)
        self.assertIn('out body geom;', src)
        self.assertNotIn('out tags geom;', src)


if __name__ == '__main__':
    unittest.main()
