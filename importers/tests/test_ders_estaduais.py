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

import common  # noqa: E402
from sources import _arcgis  # noqa: E402
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


class CacheDaFonteViva(unittest.TestCase):
    """Pontos críticos: fonte fora do ar não pode carimbar cache velho como fresco (o http_get comum devolve o cache
    antigo de qualquer idade depois de 3 falhas)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._cache_dir, self._http_get = common.CACHE_DIR, _arcgis.http_get
        common.CACHE_DIR = pathlib.Path(self._tmp.name)
        (common.CACHE_DIR / 'pc_teste_0.json').write_text(json.dumps({'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [-44.0, -19.0]}, 'properties': {'objectid': 1}}]}))
        # simula o http_get comum: a consulta falhou e ele devolveu o arquivo do cache, qualquer que seja a idade
        _arcgis.http_get = lambda url, cache=None, max_age_h=24: (common.CACHE_DIR / cache).read_bytes()

    def tearDown(self):
        common.CACHE_DIR, _arcgis.http_get = self._cache_dir, self._http_get
        self._tmp.cleanup()

    def _idade(self, horas: float):
        import time
        t = time.time() - horas * 3600
        os.utime(common.CACHE_DIR / 'pc_teste_0.json', (t, t))
        return t

    def test_cache_vencido_faz_a_carga_falhar(self):
        self._idade(5)
        with self.assertRaises(RuntimeError):
            _arcgis.query_geojson('https://x/FeatureServer/0', cache='pc_teste', max_age_h=0.5, page=10, sem_cache_vencido=True)
        # outras fontes (sem a opção) seguem aceitando o cache antigo
        self.assertEqual(len(_arcgis.query_geojson('https://x/FeatureServer/0', cache='pc_teste', max_age_h=0.5, page=10)), 1)

    def test_cache_valido_data_a_consulta_pelo_download(self):
        t = self._idade(0.2)
        info: dict = {}
        feats = _arcgis.query_geojson('https://x/FeatureServer/0', cache='pc_teste', max_age_h=0.5, page=10,
                                      sem_cache_vencido=True, info=info)
        self.assertEqual(len(feats), 1)
        # lido_em = hora do download (mtime do cache), não a desta execução: valid_to = lido_em + 72 h
        self.assertAlmostEqual(info['lido_em'].timestamp(), t, delta=1)


class RaioDoBloqueio(unittest.TestCase):
    """O raio encolhe pela distância de OUTRA via ao ponto de bloqueio q (2º /locate em q), não ao ponto da fonte."""

    def setUp(self):
        self._locate = _ders.locate

    def tearDown(self):
        _ders.locate = self._locate

    def test_transversal_junto_de_q_encolhe_o_raio(self):
        rodovia = {'dist': 0.0, 'lon': 0, 'lat': 0, 'names': ['MG-430'], 'way_id': 1, 'link': False, 'bridge': False}
        transversal = {'dist': 9.0, 'lon': 0, 'lat': 0, 'names': ['Rua A'], 'way_id': 2, 'link': False, 'bridge': False}
        alca = {'dist': 3.0, 'lon': 0, 'lat': 0, 'names': [], 'way_id': 3, 'link': True, 'bridge': False}
        chamadas = []

        def fake_locate(pts, raio):
            chamadas.append((pts, raio))
            return [[rodovia, alca, transversal] for _ in pts]
        _ders.locate = fake_locate
        mesma = lambda e: e['way_id'] == 1
        # a 9 m de q: raio = 9 - 5 = 4 -> mínimo de 8 m; a alça (link) não conta
        self.assertEqual(_ders._raio_livre([(-44.0, -19.0)], 20, mesma), _ders.RAIO_MIN_M)
        self.assertEqual(chamadas[0][1], 20 + _ders.FOLGA_OUTRA_VIA_M)
        transversal['dist'] = 18.0
        self.assertEqual(_ders._raio_livre([(-44.0, -19.0)], 20, mesma), 13.0)
        transversal['dist'] = 40.0
        self.assertEqual(_ders._raio_livre([(-44.0, -19.0)], 20, mesma), 20)

    def test_sem_valhalla_usa_as_arestas_do_primeiro_locate(self):
        _ders.locate = lambda pts, raio: None
        q = (-44.0, -19.0)
        # o ponto correlato da outra via fica a 18 m de q (a distância ao ponto da fonte, 50 m, não importa)
        perto = {'dist': 50.0, 'lon': -44.0, 'lat': -19.0 + 18 / 110540, 'names': ['Rua B'], 'way_id': 9, 'link': False}
        self.assertEqual(_ders._raio_livre([q], 20, lambda e: False, reserva=[perto]), 13.0)


class PontePorKmSemPonteNoOsm(unittest.TestCase):
    """Ato sem coordenada e sem ponte no OSM (ex.: Córrego Santo Amaro, ES-165 km 192,22): bloqueia a pista da rodovia
    no km do SRE em vez de ficar sem bloqueio."""

    def setUp(self):
        self._orig = {k: getattr(_ders, k) for k in ('sre_es', 'ponto_km_sre_es', 'locate', 'snap_bloqueio')}

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(_ders, k, v)

    def test_cai_no_snap_da_rodovia(self):
        seg = {'properties': {'km_inicial': 185.638, 'km_final': 193.819},
               'geometry': {'type': 'LineString', 'coordinates': [[-41.30, -20.45], [-41.31, -20.52]]}}
        _ders.sre_es = lambda cql, cache: [seg]
        _ders.ponto_km_sre_es = lambda code, km: (-41.305, -20.4975)
        _ders.locate = lambda pts, raio: [[{'dist': 1.0, 'lon': -41.305, 'lat': -20.4975, 'names': ['ES-165/ES-379'],
                                            'way_id': 5, 'link': False, 'bridge': False}] for _ in pts]
        vistos = []

        def fake_snap(pontos, rodovias, raio):
            vistos.append((pontos, rodovias, raio))
            return [{'pontos': [[-41.305, -20.4975]], 'raio_m': raio, 'ajuste': 'rodovia', 'distancia_m': [9.0], 'way_ids': [5]}]
        _ders.snap_bloqueio = fake_snap
        alvo, b = _ders.ponte_por_km_sre('165EES0150', 192.22, 'ES-165')
        self.assertEqual(alvo, (-41.305, -20.4975))
        self.assertEqual(b['ajuste'], 'km_sre+rodovia_sem_ponte_osm')
        self.assertEqual(vistos[0], ([(-41.305, -20.4975)], ['ES-165'], _ders.RAIO_PONTE_M))
        # nada perto do km: fica sem bloqueio (só aviso), como antes
        _ders.snap_bloqueio = lambda pontos, rodovias, raio: [{'pontos': [list(pontos[0])], 'raio_m': raio, 'ajuste': 'ponto_original'}]
        self.assertIsNone(_ders.ponte_por_km_sre('165EES0150', 192.22, 'ES-165')[1])


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
