"""Testes unitários das regras e da conferência de texto da camada ver (sem rede, sem banco e sem osmium).

Rodar (na imagem do importador, com data/raw montado para a conferência do texto oficial):
  docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data/raw:/data/raw:ro --entrypoint python truck-router-importer \
    -m unittest tests.test_ver_regras -v
"""
from __future__ import annotations
import os, pathlib, sys, unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
if not (pathlib.Path(os.environ.get('DATA_DIR', '/data')) / 'raw' / 'ver').exists():
    os.environ['DATA_DIR'] = str(pathlib.Path(__file__).resolve().parents[2] / 'data')  # fora do container: data/ do repo

from sources import ver_portaria137 as ver  # noqa: E402


def _em(janelas, dia: int, hhmm: str) -> bool:
    return janelas == 'integral' or any(dia in w['days'] and w['from'] <= hhmm < w['to'] for w in janelas)


def _exc(par: int, codigo: str) -> dict:
    return next(e for e in ver.PARAGRAFOS[par]['excecoes'] if e['codigo'] == codigo)


class ConcretagemPar1(unittest.TestCase):
    """Art. 28, § 3º: a concretagem-bomba fica estacionada seg–sex 12–14h, exceto nas VER dos §§ 2º–4º."""

    def test_par1_sem_12_14_nos_dias_uteis(self):
        j = _exc(1, 'concreto_aetc')['janelas']
        self.assertTrue(_em(j, 2, '11:59'))
        self.assertFalse(_em(j, 2, '12:00'))
        self.assertFalse(_em(j, 2, '13:00'))
        self.assertTrue(_em(j, 2, '14:00'))
        self.assertFalse(_em(j, 2, '16:00'))
        self.assertTrue(_em(j, 6, '12:30'))  # o § 3º do art. 28 fala só de 2ª a 6ª
        self.assertIn('28, I e § 3º', _exc(1, 'concreto_aetc')['artigo'])

    def test_par2_e_par3_mantem_05_16(self):
        for par in (2, 3):
            j = _exc(par, 'concreto_aetc')['janelas']
            self.assertTrue(_em(j, 2, '13:00'))
            self.assertFalse(_em(j, 2, '16:00'))


class ConferenciaDoTexto(unittest.TestCase):
    def test_textos_conferem_com_o_oficial(self):
        self.assertTrue(ver.RAW_DIR.exists(), f'texto oficial ausente em {ver.RAW_DIR}')
        self.assertEqual(ver.conferir_textos(ver.TRECHOS), [])

    def test_texto_divergente_derruba_a_importacao(self):
        trechos = [dict(ver.TRECHOS[0], texto=ver.TRECHOS[0]['texto'] + ' e Av. Inventada')] + ver.TRECHOS[1:]
        with mock.patch.dict(os.environ, {'VER_IGNORAR_TEXTO': ''}), self.assertRaises(RuntimeError):
            ver.build_features(trechos)

    def test_override_segue_para_o_casamento(self):
        trechos = [dict(ver.TRECHOS[0], texto='texto que não existe')]
        with mock.patch.dict(os.environ, {'VER_IGNORAR_TEXTO': '1'}), \
                mock.patch.object(ver, 'ensure_opl', side_effect=LookupError('passou da conferência')), \
                self.assertRaises(LookupError):
            ver.build_features(trechos)


if __name__ == '__main__':
    unittest.main()
