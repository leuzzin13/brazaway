"""Testes unitários das fontes de acidentes de SC (GeoSIE) e GO/DF (RENAEST): agregação em células, privacidade e jurisdição
(sem rede e sem banco). Rodar: cd importers && python3 -m unittest tests.test_acidentes_sul_co -v
"""
from __future__ import annotations
import datetime as dt, json, pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import acidentes_geosie_sc as sc, acidentes_renaest as rn  # noqa: E402
from sources.acidentes_infosiga import cell_of  # noqa: E402

TODAY = dt.date(2026, 10, 18)


def sc_ev(i, lon=-48.5061, lat=-27.5790, rod='SC401', d='2026-03-10', ob=0, fe=0, g=3, mun='Florianópolis'):
    return {'k': f'2026-{i}-1', 'd': d, 'lon': lon + i * 1e-6, 'lat': lat, 'rod': rod, 'mun': mun, 'ob': ob, 'fe': fe, 'g': g}


class GeoSieSc(unittest.TestCase):
    def test_celula_so_com_minimo_de_sinistros_e_sem_registro_individual(self):
        evs = [sc_ev(i) for i in range(4)]                       # 4 < MIN_SINISTROS
        feats, *_ = sc.build(evs, set(), TODAY)
        self.assertEqual(feats, [])
        feats, start, end, _ = sc.build(evs + [sc_ev(4, fe=1, g=2), sc_ev(5, ob=1, g=1)], set(), TODAY)
        self.assertEqual(len(feats), 1)
        p = feats[0]['props']
        self.assertEqual((p['total'], p['fatais'], p['vitima'], p['obitos']), (6, 1, 2, 1))
        self.assertEqual(p['escopo'], 'todos_veiculos')
        self.assertEqual((p['caminhao'], p['caminhao_vitima'], p['caminhao_fatais']), (0, 0, 0))   # a fonte não tem tipo de veículo
        self.assertEqual(p['via'], 'SC-401')
        self.assertEqual(p['municipio'], 'Florianópolis')
        # nada individual: sem data, boletim nem chave de boletim na saída
        txt = json.dumps(feats, ensure_ascii=False)
        self.assertNotIn('2026-03-10', txt)                      # a janela dos dados sai com granularidade de mês
        self.assertEqual(p['janela'], {'de': '2026-03-01', 'ate': '2026-03-31'})
        self.assertNotIn('2026-0-1', txt)
        self.assertEqual(set(p) & {'k', 'd', 'data', 'boletim'}, set())
        self.assertEqual(p['score'], round(2 + 2 * 1 + 0.2 * 4, 1))

    def test_br_e_celulas_da_prf_ficam_com_a_prf(self):
        evs = [sc_ev(i, rod='BR101') for i in range(6)]
        feats, _, _, sk = sc.build(evs, set(), TODAY)
        self.assertEqual(feats, [])
        self.assertEqual(sk['federal_prf'], 6)
        evs = [sc_ev(i) for i in range(6)]
        cov = {cell_of(evs[0]['lon'], evs[0]['lat'])}
        feats, _, _, sk = sc.build(evs, cov, TODAY)
        self.assertEqual(feats, [])
        self.assertEqual(sk['coberta_prf'], 6)

    def test_janela_de_3_anos(self):
        evs = [sc_ev(i, d='2022-01-05') for i in range(6)]       # fora da janela que termina em 10/2026
        evs += [sc_ev(10 + i, lon=-49.0, d='2026-05-05') for i in range(5)]
        feats, start, end, _ = sc.build(evs, set(), TODAY)
        self.assertEqual(len(feats), 1)
        self.assertEqual(start, dt.date(2023, 6, 1))     # termina no último dia do mês do dado mais recente
        self.assertEqual(end, dt.date(2026, 5, 31))


def rn_ev(i, uf='GO', lon=-49.2539, lat=-16.6869, end='RUA 1', tp='MUNICIPAL', tk=True, ob=0, d='2026-02-10', h=8, mun='GOIANIA'):
    return {'uf': uf, 'd': d, 'lat': lat + i * 1e-5, 'lon': lon + i * 1e-5, 'h': h, 'tp': tp, 'end': end, 'mun': mun, 'ob': ob, 'tk': tk, 'mo': False}


class Renaest(unittest.TestCase):
    def test_endereco_para_codigo_de_rodovia(self):
        self.assertEqual(rn.via_do_endereco('GO 070 KM 12', 'GO'), 'GO-070')
        self.assertEqual(rn.via_do_endereco('GO-020, km 3', 'GO'), 'GO-020')
        self.assertEqual(rn.via_do_endereco('BR 153', 'GO'), 'BR-153')
        self.assertEqual(rn.via_do_endereco('DF 003 KM 5', 'DF'), 'DF-003')
        self.assertIsNone(rn.via_do_endereco('AV GOIAS', 'GO'))

    def test_celula_com_3_caminhoes_e_sem_registro_individual(self):
        evs = [rn_ev(i) for i in range(2)]
        hs, *_ = rn.hotspots_uf(evs, 'GO', set())
        self.assertEqual(hs.features('renaest-go', dt.date(2023, 6, 1), dt.date(2026, 5, 31), 'RENAEST (DETRAN-GO)'), [])
        evs = [rn_ev(i, ob=1 if i == 0 else 0) for i in range(3)] + [rn_ev(9, tk=False)]
        hs, start, end, sk = rn.hotspots_uf(evs, 'GO', set())
        feats = hs.features('renaest-go', start, end, 'RENAEST (DETRAN-GO)')
        self.assertEqual(len(feats), 1)
        p = feats[0]['props']
        self.assertEqual((p['caminhao'], p['total'], p['caminhao_fatais'], p['obitos']), (3, 4, 1, 1))
        self.assertEqual(p['periodo']['manha'], 3)
        self.assertEqual(start, dt.date(2026, 2, 1))     # período REAL dos dados (mês e ano), dentro da janela de 3 anos
        self.assertEqual(end, dt.date(2026, 2, 28))
        self.assertNotIn('2026-02-10', json.dumps(feats))

    def test_federal_e_celulas_da_prf_ficam_com_a_prf(self):
        evs = [rn_ev(i, end='BR 153 KM 10', tp='ESTADUAL') for i in range(3)] + [rn_ev(i, lon=-49.5, tp='FEDERAL') for i in range(3)]
        hs, start, end, sk = rn.hotspots_uf(evs, 'GO', set())
        self.assertEqual(hs.features('x', start, end, 'x'), [])
        self.assertEqual(sk['federal_prf'], 6)
        # rodovia estadual dentro de célula coberta pela PRF: descartada; via urbana na mesma célula: fica
        rod = [rn_ev(i, end='GO 070 KM 4', tp='ESTADUAL') for i in range(3)]
        cov = {cell_of(rod[0]['lon'], rod[0]['lat'])}
        hs, start, end, sk = rn.hotspots_uf(rod, 'GO', cov)
        self.assertEqual(sk['rodovia_coberta_prf'], 3)
        urb = [rn_ev(i, end='AV GOIAS') for i in range(3)]
        hs, start, end, sk = rn.hotspots_uf(urb, 'GO', cov)
        self.assertEqual(len(hs.features('x', start, end, 'x')), 1)

    def test_coordenada_repetida_e_centroide(self):
        evs = [{**rn_ev(0), 'lat': -16.7, 'lon': -49.3} for _ in range(rn.MIN_REPETICAO)]
        hs, start, end, sk = rn.hotspots_uf(evs, 'GO', set())
        self.assertEqual(hs.features('x', start, end, 'x'), [])
        self.assertEqual(sk['coordenada_repetida'], rn.MIN_REPETICAO)

    def test_ufs_sem_coordenada_nao_entram(self):
        for uf in ('PR', 'SC', 'RS', 'MT', 'MS'):
            self.assertNotIn(uf, rn.UFS)
        with self.assertRaises(SystemExit):
            rn.runs('PR')
        self.assertEqual([j['source'] for j in rn.runs()], ['renaest-go', 'renaest-df'])

    def test_licenca_igual_a_da_api(self):
        api = (pathlib.Path(__file__).resolve().parents[2] / 'api' / 'src' / 'layers' / 'acidentes.layer.ts').read_text(encoding='utf-8')
        self.assertIn('Outra (Domínio Público)', api)
        self.assertIn('licença NÃO declarada pela fonte', api)


if __name__ == '__main__':
    unittest.main()
