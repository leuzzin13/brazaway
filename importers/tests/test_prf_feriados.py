"""Testes unitários da escolha de portarias do importador prf_feriados (sem rede e sem banco).

Rodar (na imagem do importador):
  docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest tests.test_prf_feriados -v

Cobre o achado da revisão: o fetch() lia (e quebrava em) portarias antigas que nem seriam usadas, e descartava a cauda
do Fim de Ano do ano anterior. A busca do DOU, o download e o parser completo são substituídos por dublês.
"""
from __future__ import annotations
import pathlib, sys, unittest
from datetime import date, datetime, timedelta, timezone

from bs4 import BeautifulSoup

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources import prf_feriados as prf  # noqa: E402

BRT = timezone(timedelta(hours=-3))


def _act(numero: int, ano_ato: int, pub: date, ano: int, janelas: list[tuple[str, str]], quebra: bool = False) -> dict:
    """Portaria falsa: ementa com o ano dos feriados e as datas das janelas no texto (dd/mm/aaaa)."""
    datas = ' '.join(f'{datetime.fromisoformat(i):%d/%m/%Y}' for i, _ in janelas)
    return {'numero': numero, 'ano_ato': ano_ato, 'pub': pub, 'ano': ano, 'janelas': janelas, 'quebra': quebra,
            'url': f'https://www.in.gov.br/web/dou/-/portaria-diop-prf-n-{numero}-{ano_ato}',
            'html': f'<div class="texto-dou"><p>Dispõe sobre a restrição ... nos feriados do ano de {ano}.</p><p>{datas}</p></div>'}


class FetchYearSelection(unittest.TestCase):
    def run_fetch(self, acts: list[dict], now: datetime):
        by_url = {a['url']: a for a in acts}
        self.fetched: list[int] = []
        self.parsed: list[int] = []

        def candidates():
            return sorted(({'url': a['url'], 'title': f"PORTARIA DIOP/PRF Nº {a['numero']}", 'pub': a['pub']} for a in acts),
                          key=lambda c: c['pub'], reverse=True)

        def fetch_act(url):
            a = by_url[url]
            self.fetched.append(a['numero'])
            return BeautifulSoup(a['html'], 'lxml').select_one('div.texto-dou'), {}

        def parse_act(body, url, meta):
            a = by_url[url]
            self.parsed.append(a['numero'])
            if a['quebra']:
                raise RuntimeError('§ 2º (pista simples / UFs excluídas) não encontrado')
            act = {'ato': f"Portaria DIOP/PRF nº {a['numero']}/{a['ano_ato']}", 'numero': a['numero'], 'ano_ato': a['ano_ato'],
                   'ano': a['ano'], 'url': url, 'dou': 'DOU', 'limites': {'largura_m': 2.6, 'altura_m': 4.4, 'comprimento_m': 19.8, 'pbtc_t': 58.5},
                   'ufs_excluidas': ['AC'], 'ufs_so_fim_de_ano': [], 'revoga': None, 'infracao': None}
            ws = [{'operacao': 'FIM DE ANO', 'escopo': 'pista_simples_federal', 'criterio': 'art1', 'inicio': i, 'fim': f, 'ufs': None}
                  for i, f in a['janelas']]
            return {'act': act, 'windows': ws}

        orig = (prf.candidates, prf.fetch_act, prf.parse_act, prf._agora)
        prf.candidates, prf.fetch_act, prf.parse_act, prf._agora = candidates, fetch_act, parse_act, (lambda: now)
        try:
            return prf.fetch()
        finally:
            prf.candidates, prf.fetch_act, prf.parse_act, prf._agora = orig

    # janelas no formato do importador (horário de Brasília)
    W25 = [('2025-12-23T16:00:00-03:00', '2025-12-23T22:00:00-03:00'), ('2026-01-04T16:00:00-03:00', '2026-01-04T22:00:00-03:00')]
    W26 = [('2026-11-20T06:00:00-03:00', '2026-11-20T12:00:00-03:00'), ('2027-01-03T16:00:00-03:00', '2027-01-03T22:00:00-03:00')]
    W27 = [('2027-02-05T16:00:00-03:00', '2027-02-05T22:00:00-03:00')]

    def acts_2026(self):
        return [
            _act(121, 2026, date(2026, 9, 9), 2026, self.W26),
            _act(26, 2026, date(2026, 3, 9), 2026, self.W26),
            _act(12, 2026, date(2026, 1, 30), 2026, self.W26),
            _act(172, 2025, date(2025, 12, 29), 2025, self.W25, quebra=True),   # o parser não lê a de 2025
            _act(80, 2025, date(2025, 6, 1), 2025, self.W25, quebra=True),
        ]

    def test_outubro_so_le_a_vigente_e_nao_quebra_na_de_2025(self):
        feats = self.run_fetch(self.acts_2026(), datetime(2026, 10, 9, 12, 0, tzinfo=BRT))
        self.assertEqual(self.parsed, [121])                 # revogadas de 2026 e a de 2025 (já acabou) não são lidas
        self.assertNotIn(80, self.fetched)                   # para quando 2026 e 2025 estão resolvidos
        self.assertEqual(len(feats), 2)
        self.assertNotIn('ignoradas', prf.NOTES)

    def test_janeiro_sem_portaria_nova_guarda_a_cauda_do_ano_anterior(self):
        feats = self.run_fetch(self.acts_2026(), datetime(2027, 1, 2, 12, 0, tzinfo=BRT))
        self.assertEqual([f['valid_to'] for f in feats], ['2027-01-03T22:00:00-03:00'])   # 20/11 já acabou; 03/01 fica
        self.assertIn('ATENÇÃO: nenhuma portaria com os feriados de 2027', prf.NOTES)
        self.assertNotIn(172, self.parsed)

    def test_portaria_nova_antes_do_fim_da_cauda_mantem_as_duas(self):
        acts = [_act(150, 2026, date(2026, 12, 20), 2027, self.W27)] + self.acts_2026()
        feats = self.run_fetch(acts, datetime(2027, 1, 2, 12, 0, tzinfo=BRT))
        self.assertEqual(sorted(f['valid_to'] for f in feats), ['2027-01-03T22:00:00-03:00', '2027-02-05T22:00:00-03:00'])
        self.assertEqual(self.parsed, [150, 121])

    def test_revisao_de_fim_de_ano_e_ano_seguinte(self):
        """Revisão de 2026 em dez/2026 (como a 172/2025) e a de 2027 já publicada: usa as duas e não lê as revogadas."""
        acts = [_act(170, 2026, date(2026, 12, 28), 2026, self.W26), _act(150, 2026, date(2026, 12, 20), 2027, self.W27)] + self.acts_2026()
        feats = self.run_fetch(acts, datetime(2026, 12, 29, 12, 0, tzinfo=BRT))
        self.assertEqual(self.parsed, [170, 150])
        self.assertEqual(len(feats), 3)

    def test_falha_na_portaria_do_ano_corrente_derruba_a_carga(self):
        acts = self.acts_2026()
        acts[0]['quebra'] = True
        with self.assertRaises(RuntimeError):
            self.run_fetch(acts, datetime(2026, 10, 9, 12, 0, tzinfo=BRT))

    def test_falha_na_do_ano_anterior_com_cauda_e_tolerada_e_registrada(self):
        acts = [_act(150, 2026, date(2026, 12, 20), 2027, self.W27), _act(121, 2026, date(2026, 9, 9), 2026, self.W26, quebra=True)]
        feats = self.run_fetch(acts, datetime(2027, 1, 2, 12, 0, tzinfo=BRT))
        self.assertEqual(len(feats), 1)
        self.assertIn('ignoradas por falha de leitura', prf.NOTES)


if __name__ == '__main__':
    unittest.main()
