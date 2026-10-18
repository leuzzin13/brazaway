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

    def test_terceira_ponte_ativa(self):
        # pesquisa: confiança 'alta'; verify.json: 'confirmed' (PDF lido; o DER-ES ainda lista a IS). Só confiança
        # baixa/unverifiable entra desativada: a dúvida sobre a vigência depois de 2023 fica em nota_vigencia
        t = RULES['ES-TERCEIRA-PONTE']
        self.assertTrue(t['ativa'])
        self.assertEqual((t['situacao'], t['confianca']), ('vigente', 'alta'))
        self.assertEqual(t['norma'], 'Instrução de Serviço DERTES nº 021-N/2004')
        self.assertEqual(t['artigo'], "art. 1º, g, e 'Horários', item 2")
        self.assertIsNone(t['classes_proibidas'])          # "Todos veículos transportando produtos perigosos"
        self.assertFalse(t['isencao_qtd_limitada'])
        self.assertRegex(t['nota_vigencia'], r'DER-ES')
        self.assertNotIn('motivo_inativa', t)

    def test_baixa_confianca_e_revogadas_nunca_ativas(self):
        for r in CFG['regras']:
            if re.match(r'(baixa|unverifiable)', str(r.get('confianca', ''))):
                self.assertFalse(r['ativa'], r['id'])
        for r in CFG['registradas']:
            self.assertTrue(r.get('motivo_inativa') or r.get('revogacao'), r['id'])
            if r['situacao'] in ('revogada', 'sem_efeito'):
                self.assertTrue(r.get('valid_to'), r['id'])
        # verify.json: a 5.936/2021 é "Alteradora" no ANTTlegis, não revogada (o efeito caiu com a 1.713)
        self.assertEqual(REG['RES-ANTT-5936-2021']['situacao'], 'sem_efeito')
        self.assertEqual(REG['RES-ANTT-1713-2006']['situacao'], 'revogada')
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


    def test_rs_rota_do_sol_e_estrada_do_mar_dn_daer(self):
        # pesquisa docs/research/estados_sul_co (RS, 18/10/2026): DN DAER 127/2019 (+136/2021) e 152/2023, todas as classes
        rs = RULES['RS-ROTA-DO-SOL']
        self.assertTrue(rs['ativa'])
        self.assertEqual((rs['situacao'], rs['uf'], rs['jurisdicao']), ('vigente', 'RS', 'estadual'))
        self.assertEqual(rs['norma'], 'Decisão Normativa DAER nº 127/2019 (alterada pela DN 136/2021)')
        self.assertEqual(rs['artigo'], 'arts. 1º, 2º e 6º')
        self.assertIsNone(rs['classes_proibidas'])
        self.assertFalse(rs['isencao_qtd_limitada'])
        self.assertRegex(rs['excecoes'], r'lindeiros.*segunda a quinta, das 10h às 15h')
        self.assertEqual(rs['valid_from'], '2019-12-22T00:00:00-03:00')      # 30 dias após o DOE de 22/11/2019 (art. 11)
        mar = RULES['RS-ESTRADA-DO-MAR']
        self.assertTrue(mar['ativa'])
        self.assertEqual((mar['norma'], mar['artigo']), ('Decisão Normativa DAER nº 152/2023', 'art. 8º, § 2º, c/c art. 3º, §§ 2º a 4º'))
        self.assertIsNone(mar['classes_proibidas'])
        self.assertFalse(mar['isencao_qtd_limitada'])

    def test_rs_dn_29_2002_registrada_e_nao_aplicada(self):
        r = REG['RS-DN-29-2002-ERS-030-040-118']
        self.assertEqual((r['situacao'], r['confianca']), ('vigencia_incerta', 'baixa'))
        self.assertRegex(r['motivo_inativa'], r'não aplicada')
        self.assertRegex(r['regra'], r'22h às 6h')
        self.assertEqual(len(r['ponto']), 2)

    def test_nomes_da_selecao_rs(self):
        def ok(rule_id, nome):
            rx = re.compile(RULES[rule_id]['selecao']['nome'])
            return bool(rx.fullmatch(re.sub(r'\s+', ' ', imp.strip_accents(nome)).strip()))
        for n in ('ERS-486', 'RSC-453', 'Rota do Sol Euclides Triches'):
            self.assertTrue(ok('RS-ROTA-DO-SOL', n), n)
        self.assertFalse(ok('RS-ROTA-DO-SOL', 'ERS-020'))
        for n in ('Estrada do Mar', 'ERS-389', 'Rodovia Nelson Gonçalves'):
            self.assertTrue(ok('RS-ESTRADA-DO-MAR', n), n)
        self.assertFalse(ok('RS-ESTRADA-DO-MAR', 'Avenida Beira Mar'))

    def test_nenhuma_regra_ativa_sem_semente_nos_dois_sentidos(self):
        for r in CFG['regras']:
            self.assertEqual(len(r['selecao']['sementes']), 2, r['id'])
            self.assertEqual(r['selecao']['sementes'][0], r['selecao']['sementes'][1][::-1], r['id'])


class Recasamento(unittest.TestCase):
    def test_props_osm_guarda_o_costing_da_selecao(self):
        # a API recasa com este costing quando o tileset muda; com 'truck' a Linha Vermelha (hgv=no) não casa
        self.assertEqual(imp.osm_props(1, RULES['RJ-RIO-LINHA-VERMELHA']['selecao']), {'tileset': 1, 'geom': True, 'costing': 'auto'})
        self.assertEqual(imp.osm_props(1, RULES['RJ-AV-PORTUARIA']['selecao'])['costing'], 'truck')
        for r in CFG['regras']:
            self.assertIn(r['selecao'].get('costing'), ('auto', 'truck'), r['id'])


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
