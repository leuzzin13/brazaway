"""Testes unitários do importador hazmat_trechos_sudeste (sem rede, sem banco e sem Valhalla).

Conferem o arquivo de regras (data/raw/hazmat/trechos_sudeste_pp.json) contra o verify.json da pesquisa e as convenções da
frente (todo limite cita ato e artigo; regra não confirmada entra desativada com a razão; revogada nunca vale) e a lógica
de encadeamento/corte das arestas.

Rodar (na imagem do importador):
  docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data/raw:/data/raw:ro --entrypoint python truck-router-importer \
    -m unittest tests.test_hazmat_trechos_sudeste -v
"""
from __future__ import annotations
import json, os, pathlib, re, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
if not (pathlib.Path(os.environ.get('DATA_DIR', '/data')) / 'raw' / 'hazmat').exists():
    os.environ['DATA_DIR'] = str(pathlib.Path(__file__).resolve().parents[2] / 'data')  # fora do container: data/ do repo

from sources import hazmat_trechos_sudeste as imp  # noqa: E402

CFG = json.load(open(imp.RULES_PATH, encoding='utf-8'))
RULES = {r['id']: r for r in CFG['regras']}
REG = {r['id']: r for r in CFG['registradas']}


class RegrasConferidas(unittest.TestCase):
    def test_todas_citam_ato_artigo_e_url(self):
        for r in [*CFG['regras'], *CFG['registradas']]:
            for k in ('norma', 'artigo', 'url', 'situacao'):
                self.assertTrue(r.get(k), f"{r['id']}: falta {k}")
        for r in CFG['regras']:
            for k in ('via', 'regra', 'janela', 'publicacao', 'confianca', 'selecao'):
                self.assertTrue(r.get(k), f"{r['id']}: falta {k}")
            self.assertIn('isencao_qtd_limitada', r)

    def test_ponte_rio_niteroi_portaria_407(self):
        p = RULES['RJ-PONTE-RIO-NITEROI']
        self.assertEqual(p['norma'], 'Portaria SPRF-RJ/PRF nº 407/2024')
        self.assertIn('DOU 22/11/2024', p['publicacao'])          # verify.json: edição 225, Seção 1
        self.assertEqual(p['classes_proibidas'], ['1', '2.1', '2.3', '3', '4', '5', '6', '8'])   # 2.2, 7 e 9 de fora
        self.assertTrue(p['isencao_qtd_limitada'])                # art. 1º, parágrafo único
        self.assertTrue(p['ativa'])
        mc = p['excecao_mocangue']
        self.assertEqual(mc['artigo'], 'art. 2º')
        self.assertEqual(mc['janelas'], [{'from': '23:00', 'to': '04:00'}, {'from': '11:00', 'to': '16:00'}])
        self.assertEqual(mc['aviso_previo_h'], 24)
        self.assertEqual(mc['municipio_ibge'], '3303302')          # Niterói

    def test_av_portuaria_art_4a(self):
        a = RULES['RJ-AV-PORTUARIA']
        self.assertEqual(a['artigo'], 'art. 4º-A')
        self.assertEqual(a['classes_proibidas'], RULES['RJ-PONTE-RIO-NITEROI']['classes_proibidas'])
        self.assertNotIn('excecao_mocangue', a)
        # verify.json corrigiu: a Res. 5.936/2021 só acrescentou o art. 4º-A (não falava em "trajeto então utilizado")
        self.assertNotRegex(json.dumps(a, ensure_ascii=False), r'trajeto então utilizado')

    def test_linha_vermelha_todas_as_classes_sem_isencao(self):
        lv = RULES['RJ-RIO-LINHA-VERMELHA']
        self.assertEqual((lv['norma'], lv['artigo']), ('Res. SMTR nº 2.204/2012', 'art. 1º, IV'))
        self.assertIsNone(lv['classes_proibidas'])
        self.assertFalse(lv['isencao_qtd_limitada'])
        self.assertTrue(lv['ativa'])
        self.assertEqual(lv['selecao']['excluir_municipios_ibge'], ['3301702'])   # só o trecho do Rio

    def test_terceira_ponte_desativada_com_razao(self):
        t = RULES['ES-TERCEIRA-PONTE']
        self.assertFalse(t['ativa'])
        self.assertEqual(t['situacao'], 'vigencia_nao_confirmada')
        self.assertRegex(t['motivo_inativa'], r'Vigência não confirmada')
        self.assertTrue(t['aviso_inativa'])

    def test_baixa_confianca_e_revogadas_nunca_ativas(self):
        for r in CFG['regras']:
            if re.match(r'(baixa|unverifiable)', str(r.get('confianca', ''))):
                self.assertFalse(r['ativa'], r['id'])
        for r in CFG['registradas']:
            self.assertTrue(r.get('motivo_inativa') or r.get('revogacao'), r['id'])
            if r['situacao'] == 'revogada':
                self.assertTrue(r.get('valid_to'), r['id'])
        # Lei Rio 2.959/1999: publicação corrigida pelo verify.json (DCM 03/01/2000, não 01/03/2000)
        self.assertIn('DCM 03/01/2000', REG['RJ-RIO-LEI-2959']['publicacao'])

    def test_nomes_da_selecao(self):
        def ok(rule_id, nome):
            rx = re.compile(RULES[rule_id]['selecao']['nome'])
            return bool(rx.fullmatch(re.sub(r'\s+', ' ', imp.strip_accents(nome)).strip()))
        self.assertTrue(ok('RJ-PONTE-RIO-NITEROI', 'Ponte Rio-Niterói'))
        self.assertTrue(ok('RJ-PONTE-RIO-NITEROI', 'Ponte Presidente Costa e Silva'))
        self.assertTrue(ok('RJ-AV-PORTUARIA', 'Avenida Portuária'))
        self.assertFalse(ok('RJ-AV-PORTUARIA', 'Avenida Portuária 8 de Janeiro'))
        self.assertTrue(ok('RJ-RIO-LINHA-VERMELHA', 'Linha Vermelha'))
        self.assertTrue(ok('RJ-RIO-LINHA-VERMELHA', 'Via Expressa Presidente João Goulart'))
        self.assertFalse(ok('RJ-RIO-LINHA-VERMELHA', 'Linha Amarela'))
        self.assertTrue(ok('ES-TERCEIRA-PONTE', 'Ponte Deputado Darcy Castello de Mendonça'))


class Encadeamento(unittest.TestCase):
    def edge(self, coords, use='road'):
        return {'coords': coords, 'use': use, 'names': ['X']}

    def test_cadeia_segue_o_sentido_e_prefere_a_pista(self):
        a = self.edge([[0, 0], [0.001, 0]])
        b = self.edge([[0.001, 0], [0.002, 0]])
        rampa = self.edge([[0.001, 0], [0.002, 0.0002]], use='ramp')
        volta = self.edge([[0.002, 0.0001], [0, 0.0001]])        # outra pista, sentido contrário
        chains = imp.chain_edges([a, b, rampa, volta])
        self.assertIn([0, 1], chains)          # a -> b (a alça vira cadeia própria)
        self.assertIn([2], chains)
        self.assertIn([3], chains)

    def test_pedacos_cortados_em_fronteira_de_aresta(self):
        # 6 arestas de ~550 m: pedaços de até ~2,5 km (CHUNK_M * 1,25)
        es = [self.edge([[i * 0.005, 0], [(i + 1) * 0.005, 0]]) for i in range(6)]
        pcs = imp.pieces_of(es, list(range(6)))
        self.assertGreater(len(pcs), 1)
        # 7 vértices; o nó compartilhado entre dois pedaços aparece nos dois
        self.assertEqual(sum(len(c) for c, _, _ in pcs), 7 + len(pcs) - 1)
        self.assertTrue(all(L <= imp.CHUNK_M * 1.25 for _, L, _ in pcs))
        self.assertEqual(pcs[0][0][-1], pcs[1][0][0])   # o pedaço seguinte começa onde o anterior termina


if __name__ == '__main__':
    unittest.main()
