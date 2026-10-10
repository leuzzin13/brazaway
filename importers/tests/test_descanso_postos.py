"""Testes unitários dos importadores das camadas descanso e postos_diesel (sem rede e sem banco).

Rodar (na imagem do importador):
  docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest tests.test_descanso_postos -v
"""
from __future__ import annotations
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import descanso_ppd, postos_anp  # noqa: E402


class ParseEndereco(unittest.TestCase):
    """O cadastro da ANP grava 'LOGRADOURO,  NÚMERO': separar na vírgula, não no primeiro número."""

    def test_logradouro_com_numero_no_nome(self):
        self.assertEqual(postos_anp.parse_endereco('RUA 7 DE SETEMBRO, 500'), ('RUA 7 DE SETEMBRO', 500, False))
        self.assertEqual(postos_anp.parse_endereco('RUA 24 DE MAIO,  1281'), ('RUA 24 DE MAIO', 1281, False))
        self.assertEqual(postos_anp.parse_endereco('RODOVIA MG 238,  125'), ('RODOVIA MG 238', 125, False))

    def test_rodovia_com_km(self):
        self.assertEqual(postos_anp.parse_endereco('RODOVIA BR 101,  KM 578'), ('RODOVIA BR 101', 578, True))
        self.assertEqual(postos_anp.parse_endereco('RODOVIA BR 354, KM 310, S/N'), ('RODOVIA BR 354', 310, True))
        self.assertEqual(postos_anp.parse_endereco('ROD PRES DUTRA, KM 210'), ('ROD PRES DUTRA', 210, True))
        # km dentro do próprio logradouro, número "S/N"
        self.assertEqual(postos_anp.parse_endereco('RODOVIA BR 262 KM 169, S/N'), ('RODOVIA BR 262', 169, True))
        self.assertEqual(postos_anp.parse_endereco('AREA LMG 798, QUILOMETRO 36,8, S/N'), ('AREA LMG 798', 36, True))

    def test_sem_numero_e_casos_sujos(self):
        self.assertEqual(postos_anp.parse_endereco('RODOVIA BR 040,  S/N'), ('RODOVIA BR 040', None, False))
        self.assertEqual(postos_anp.parse_endereco('AVENIDA GETULIO VARGAS, 1.310'), ('AVENIDA GETULIO VARGAS', 1310, False))
        self.assertEqual(postos_anp.parse_endereco('RODOVIA WASHINGTON LUIZ,, 14040'), ('RODOVIA WASHINGTON LUIZ', 14040, False))
        self.assertEqual(postos_anp.parse_endereco('AVENIDA , ARAGUAIA, 164'), ('AVENIDA ARAGUAIA', 164, False))
        self.assertEqual(postos_anp.parse_endereco('AVENIDA JOSE RUI LINO,  500'), ('AVENIDA JOSE RUI LINO', 500, False))


class PmqcPositions(unittest.TestCase):
    """Pontos-padrão do PMQC (o mesmo ponto para vários CNPJs, baixa precisão, coletas espalhadas) não viram posição."""

    def test_ponto_repetido_em_outros_cnpjs(self):
        centro = (-20.8113, -49.3758, 4)
        amostras = {f'{i:014d}': [centro] for i in range(3)}
        amostras['99999999000199'] = [(-20.80001234, -49.36001234, 8), (-20.80001300, -49.36001300, 8)]
        pos, rej = postos_anp.pmqc_positions(amostras)
        self.assertEqual(set(pos), {'99999999000199'})
        self.assertEqual({rej[c][0] for c in rej}, {'ponto_repetido'})

    def test_amostra_repetida_sai_mas_as_boas_ficam(self):
        padrao = (-22.778031, -43.337101, 6)
        amostras = {'1': [padrao, (-23.5001234, -46.6001234, 7)], '2': [padrao]}
        pos, rej = postos_anp.pmqc_positions(amostras)
        self.assertAlmostEqual(pos['1']['lat'], -23.5001234)
        self.assertEqual(pos['1']['n'], 1)
        self.assertIn('2', rej)

    def test_baixa_precisao_e_dispersao(self):
        amostras = {'a': [(-22.123, -47.456, 3)],
                    'b': [(-17.20, -46.80, 6), (-17.21, -46.81, 6), (-17.90, -47.50, 6)]}
        pos, rej = postos_anp.pmqc_positions(amostras)
        self.assertEqual(rej['a'][0], 'baixa_precisao')
        self.assertEqual(rej['b'][0], 'espalhado')
        self.assertEqual(pos, {})

    def test_casas_decimais(self):
        self.assertEqual(postos_anp._decimais('-22.0572'), 4)
        self.assertEqual(postos_anp._decimais('-22,120'), 2)
        self.assertEqual(postos_anp._decimais('-18.54224638'), 8)
        self.assertEqual(postos_anp._decimais('-22'), 0)


class PpdValidade(unittest.TestCase):
    """O Power BI serializa a coluna Date como meia-noite UTC: ler em UTC (em -03 daria um dia antes)."""

    def test_data_utc(self):
        self.assertEqual(descanso_ppd._date_ms(1748736000000), '2025-06-01')   # Paradouro Batistella
        self.assertEqual(descanso_ppd._date_ms(None), None)


if __name__ == '__main__':
    unittest.main()
