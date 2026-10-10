"""Testes do formato de município (data/raw/municipios/<ibge>.json) e do importador genérico `municipios`.

Sem rede, sem banco e sem Valhalla. Usa o município fictício de fixture (tests/fixtures/municipios/3599999.json) e os
arquivos reais (os 6 da RMSP + o registro do ABC), conferindo que a montagem das feições não mudou.

Rodar (na imagem do importador, com o repositório montado: o schema e os arquivos ficam em data/raw/municipios):
  docker run --rm -v $(pwd):/repo -w /repo/importers -e DATA_DIR=/repo/data --entrypoint python truck-router-importer \
    -m unittest tests.test_municipios -v
ATUALIZAR=1 regrava a fixture compilada da API (api/test/fixtures/municipio_ficticio.json) e os digests "exato"
(depois de uma mudança INTENCIONAL num arquivo de município). Os digests "legado" foram tirados dos importadores rmsp_*
antigos e não se regravam.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from sources import _municipios_lib as lib  # noqa: E402
from sources import _municipios_schema as sch  # noqa: E402
from sources import municipios as m  # noqa: E402

ROOT = HERE.parents[1]
DATA_RAW = ROOT / 'data' / 'raw'
SCHEMA = DATA_RAW / 'municipios' / 'schema.json'
FIX = HERE / 'fixtures'
FIX_DOC = FIX / 'municipios' / '3599999.json'
API_FIXTURE = ROOT / 'api' / 'test' / 'fixtures' / 'municipio_ficticio.json'
DIGESTS = FIX / 'municipios_digests.json'
ATUALIZAR = os.environ.get('ATUALIZAR') == '1'

# campos novos do formato por município (não existiam nas props dos importadores rmsp_* antigos)
NOVOS = {'uf', 'confianca', 'status_motivo', 'excecao_destino_local_artigo', 'abrangencia_ibge'}


# mudanças intencionais depois dos importadores antigos: desfeitas NOS DOIS LADOS antes do digest "legado"
LEGADO_IGNORAR: dict = {}


class Dirs:
    """Aponta o importador para outra pasta de municípios/data raw durante o teste."""
    def __init__(self, raw: pathlib.Path, municipios: pathlib.Path):
        self.raw, self.mun = raw, municipios

    def __enter__(self):
        self.antes = (lib.RAW_DIR, m.MUNICIPIOS_DIR, m.SCHEMA)
        lib.RAW_DIR, m.MUNICIPIOS_DIR, m.SCHEMA = self.raw, self.mun, SCHEMA
        return self

    def __exit__(self, *exc):
        lib.RAW_DIR, m.MUNICIPIOS_DIR, m.SCHEMA = self.antes


def precisa_repo(t: unittest.TestCase):
    if not SCHEMA.exists():
        t.skipTest('data/raw/municipios/schema.json não encontrado: monte o repositório inteiro (ver docstring)')


def legado(feats: list[dict], fonte: str | None = None) -> list[dict]:
    """Forma comparável com a saída dos importadores rmsp_* antigos: sem source_id, sem os campos novos e sem as mudanças
    intencionais da fonte (LEGADO_IGNORAR)."""
    out = []
    ignorar = LEGADO_IGNORAR.get(fonte, lambda p: p)
    for f in feats:
        p = ignorar({k: v for k, v in f['props'].items() if k not in NOVOS and k != 'trevo'})
        if p.get('status') == 'vigente':
            p['status'] = 'ativa'
        if 'base_legal' in p:
            p['base_legal'] = [{k: v for k, v in b.items() if k != 'artigo'} for b in p['base_legal']]
        out.append({'geometry': f['geometry'], 'name': f['name'], 'kind': f['kind'], 'valid_from': f.get('valid_from'),
                    'valid_to': f.get('valid_to'), 'props': p})
    return sorted(out, key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False))


def digest(x) -> str:
    return hashlib.sha1(json.dumps(x, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def exato(feats: list[dict]) -> list[dict]:
    return sorted(feats, key=lambda f: f['source_id'])


# ----------------------------------------------------------------------------- validador (subconjunto do JSON Schema)
class Validador(unittest.TestCase):
    def test_recusa_palavra_chave_nao_suportada(self):
        with self.assertRaises(ValueError):
            sch.Validador({'type': 'object', 'properties': {'x': {'type': 'string', 'format': 'date'}}})

    def test_tipos_oneof_e_ref(self):
        v = sch.Validador({'$defs': {'n': {'type': 'number', 'minimum': 0}}, 'type': 'object', 'required': ['a'],
                           'additionalProperties': False,
                           'properties': {'a': {'$ref': '#/$defs/n'}, 'b': {'oneOf': [{'type': 'null'}, {'type': 'string', 'pattern': '^x'}]}}})
        self.assertEqual(v.erros({'a': 1, 'b': None}), [])
        self.assertEqual(v.erros({'a': 1, 'b': 'xy'}), [])
        self.assertTrue(v.erros({'a': -1}))
        self.assertTrue(v.erros({'a': True}))                 # booleano não é número
        self.assertTrue(v.erros({'a': 1, 'b': 'y'}))
        self.assertTrue(any('campo desconhecido' in e for e in v.erros({'a': 1, 'c': 2})))
        self.assertTrue(any('obrigatório' in e for e in v.erros({})))


# ----------------------------------------------------------------------------- município fictício
class Fixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SCHEMA.exists():
            raise unittest.SkipTest('schema não encontrado: monte o repositório inteiro (ver docstring)')
        with Dirs(FIX, FIX / 'municipios'):
            cls.docs = m.carregar_todos()
            cls.feats = m.compilar(cls.docs[0])
        cls.por_regra = {}
        for f in cls.feats:
            cls.por_regra.setdefault(f['props']['regra_id'], []).append(f)

    def test_arquivo_valido_e_runs(self):
        self.assertEqual([d['ibge'] for d in self.docs], ['3599999'])
        with Dirs(FIX, FIX / 'municipios'):
            jobs = m.runs('3599999')
            self.assertEqual([j['source'] for j in jobs], ['teste-municipio-ficticio'])
            self.assertIn('FIXTURE', jobs[0]['source_url'])
            self.assertEqual([j['source'] for j in m.runs('teste-municipio-ficticio')], ['teste-municipio-ficticio'])
            self.assertEqual({j['source'] for j in m.runs()}, {'ibge', 'teste-municipio-ficticio'})
            with self.assertRaises(SystemExit):
                m.runs('1234567')

    def test_kind_por_tipo_e_status(self):
        k = {rid: {f['kind'] for f in fs} for rid, fs in self.por_regra.items()}
        self.assertEqual(k, {'ficticio_area_central': {'zona'}, 'ficticio_corredor': {'via'}, 'ficticio_ponte': {'via'},
                             'ficticio_lei_antiga': {'desativada'}, 'ficticio_suspensa': {'suspensa'}, 'ficticio_revogada': {'revogada'}})
        self.assertEqual(self.por_regra['ficticio_ponte'][0]['props']['tipo'], 'ponte')
        rev = self.por_regra['ficticio_revogada'][0]
        self.assertEqual((rev['source_id'], rev['valid_to']), ('ficticio-revogada', '2020-01-01'))
        self.assertEqual(self.por_regra['ficticio_lei_antiga'][0]['props']['confianca'], 'baixa')
        self.assertIn('Confiança baixa', self.por_regra['ficticio_lei_antiga'][0]['props']['status_motivo'])

    def test_props_da_regra(self):
        z = self.por_regra['ficticio_area_central'][0]
        p = z['props']
        self.assertEqual((p['ibge'], p['uf'], p['municipio'], p['regra_id']), ('3599999', 'SP', 'Município Fictício (teste)', 'ficticio_area_central'))
        self.assertEqual(p['vuc']['payload_max_t'], 3)                          # definição local de VUC herdada do município
        self.assertEqual(p['alvo']['qualquer'][0], {'campo': 'payload_t', 'acima': 5.5})
        self.assertEqual(p['base_legal'][0]['artigo'][:6], 'art. 1')
        self.assertEqual((p['verificado_em'], z['valid_from'], z['name']), ('2026-10-10', '2026-01-01', 'Área Central do Município Fictício'))
        c = self.por_regra['ficticio_corredor'][0]
        self.assertIsNone(c['props']['vuc'])                                     # vuc null explícito não herda
        self.assertEqual(c['name'], 'Município Fictício (teste): Corredor — Avenida Fictícia')
        self.assertEqual(c['props']['alvo']['todas'], [{'campo': 'eixos', 'acima': 2}, {'campo': 'pbt_t', 'acima': 10}])
        for fora in ('id', 'geometria', 'trechos', 'source_id'):
            self.assertNotIn(fora, p)

    def test_geometria_de_arquivo_e_embutida(self):
        s = self.por_regra['ficticio_suspensa'][0]
        g = json.loads((FIX / 'municipios' / 'geo' / '3599999_suspensa.geojson').read_text())['features'][0]['geometry']
        self.assertEqual(s['geometry'], g)
        self.assertEqual(s['props']['fonte_geometria'], 'desenho de teste')      # propriedade da feição prevalece
        self.assertEqual(self.por_regra['ficticio_ponte'][0]['geometry']['type'], 'LineString')

    def test_source_id_estavel_e_unico(self):
        with Dirs(FIX, FIX / 'municipios'):
            de_novo = m.compilar(m.carregar_todos()[0])
        self.assertEqual([f['source_id'] for f in de_novo], [f['source_id'] for f in self.feats])
        self.assertEqual(len({f['source_id'] for f in self.feats}), len(self.feats))

    def test_fixture_compilada_da_api_em_dia(self):
        atual = {'gerado_por': 'importers/tests/test_municipios.py (ATUALIZAR=1)', 'fonte_id': 'teste-municipio-ficticio',
                 'features': self.feats}
        if ATUALIZAR or not API_FIXTURE.exists():
            if not API_FIXTURE.parent.parent.exists():
                self.skipTest('api/test não montado')
            API_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
            API_FIXTURE.write_text(json.dumps(atual, ensure_ascii=False, indent=1) + '\n')
        self.assertEqual(json.loads(API_FIXTURE.read_text()), json.loads(json.dumps(atual)),
                         'fixture da API desatualizada: rode com ATUALIZAR=1')


# ----------------------------------------------------------------------------- erros de formato
class Erros(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SCHEMA.exists():
            raise unittest.SkipTest('schema não encontrado: monte o repositório inteiro (ver docstring)')
        cls.v = sch.carregar_schema(SCHEMA)
        cls.base = json.loads(FIX_DOC.read_text())

    def erros(self, mudar, nome='3599999.json') -> list[str]:
        d = copy.deepcopy(self.base)
        mudar(d)
        return sch.validar(d, self.v, nome, existe=lambda rel: (FIX / rel).exists())

    def assertErro(self, mudar, trecho: str, nome='3599999.json'):
        es = self.erros(mudar, nome)
        self.assertTrue(any(trecho in e for e in es), f'esperava "{trecho}" em {es}')

    def test_fixture_sem_erros(self):
        self.assertEqual(self.erros(lambda d: None), [])

    def test_confianca_baixa_nao_entra_ativa(self):
        def f(d):
            d['regras'][0]['confianca'] = 'baixa'
        self.assertErro(f, 'não pode entrar ativa')

    def test_unverifiable_tambem(self):
        def f(d):
            d['regras'][1]['confianca'] = 'unverifiable'
        self.assertErro(f, 'não pode entrar ativa')

    def test_status_nao_ativo_exige_motivo(self):
        self.assertErro(lambda d: d['regras'][3].pop('status_motivo'), 'exige status_motivo')

    def test_revogada_exige_data(self):
        self.assertErro(lambda d: d['regras'][5].pop('vigencia_fim'), 'exige vigencia_fim')

    def test_janela_virando_a_noite(self):
        def f(d):
            d['regras'][0]['janelas'] = [{'days': [1], 'from': '22:00', 'to': '06:00'}]
        self.assertErro(f, 'virando a noite')

    def test_hora_invalida(self):
        def f(d):
            d['regras'][0]['janelas'][0]['to'] = '25:00'
        self.assertErro(f, 'não casa com')

    def test_uf_e_nome_do_arquivo(self):
        self.assertErro(lambda d: d.update(uf='MG'), 'não bate com o código IBGE')
        self.assertErro(lambda d: None, 'deve se chamar 3599999.json', nome='3599998.json')

    def test_campo_desconhecido(self):
        self.assertErro(lambda d: d['regras'][0].update(horario='7h-20h'), 'campo desconhecido "horario"')

    def test_artigo_obrigatorio(self):
        self.assertErro(lambda d: d['regras'][0]['base_legal'][0].pop('artigo'), 'falta o campo obrigatório "artigo"')

    def test_condicao_com_dois_operadores(self):
        def f(d):
            d['regras'][0]['alvo']['qualquer'][0]['ate'] = 10
        self.assertErro(f, 'exatamente uma das alternativas')

    def test_condicao_tipo_exige_lista(self):
        def f(d):
            d['regras'][0]['variantes'][0]['quando']['qualquer'] = [{'campo': 'tipo', 'acima': 1}]
        self.assertErro(f, 'só serve (e é obrigatória) para o campo "tipo"')

    def test_geometria_com_duas_origens(self):
        def f(d):
            d['regras'][0]['geometria'][0]['arquivo'] = 'municipios/geo/3599999_suspensa.geojson'
        self.assertErro(f, 'exatamente uma das alternativas')

    def test_arquivo_manual_ausente(self):
        def f(d):
            d['regras'][4]['geometria'][0]['arquivo'] = 'municipios/geo/nao_existe.geojson'
        self.assertErro(f, 'arquivo ausente')

    def test_zona_vinculada_inexistente(self):
        self.assertErro(lambda d: d['regras'][1].update(zona_vinculada='nao_existe'), 'zona_vinculada')

    def test_fonte_ibge_reservada(self):
        self.assertErro(lambda d: d.update(fonte_id='ibge'), 'reservado')

    def test_tipo_de_geometria_errado_na_montagem(self):
        d = copy.deepcopy(self.base)
        d['regras'][2]['geometria'][0]['geojson'] = {'type': 'Point', 'coordinates': [-44.79, -24.805]}
        with Dirs(FIX, FIX / 'municipios'):
            with self.assertRaisesRegex(ValueError, 'não serve para o tipo ponte'):
                m.compilar(d)

    def test_fonte_id_repetido_entre_arquivos(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        try:
            (tmp / 'municipios' / 'geo').mkdir(parents=True)
            shutil.copy(FIX / 'municipios' / 'geo' / '3599999_suspensa.geojson', tmp / 'municipios' / 'geo')
            shutil.copy(FIX_DOC, tmp / 'municipios' / '3599999.json')
            outro = copy.deepcopy(self.base)
            outro['ibge'] = '3599998'
            for r in outro['regras']:
                r['id'] = r['id'] + '_b'
                r.pop('source_id', None)
            (tmp / 'municipios' / '3599998.json').write_text(json.dumps(outro, ensure_ascii=False))
            with Dirs(tmp, tmp / 'municipios'):
                with self.assertRaisesRegex(ValueError, 'fonte_id "teste-municipio-ficticio" repetido'):
                    m.carregar_todos()
        finally:
            shutil.rmtree(tmp)


# ----------------------------------------------------------------------------- validação offline e carga de limites
def _proibido(*a, **k):
    raise AssertionError('a validação offline tentou acessar a rede ou gerar geometria')


class Offline(unittest.TestCase):
    """--validar (compilar com construir=False) não acessa a rede nem grava em data/raw; a carga 'ibge' não roda vazia."""
    @classmethod
    def setUpClass(cls):
        if not SCHEMA.exists():
            raise unittest.SkipTest('schema não encontrado: monte o repositório inteiro (ver docstring)')
        cls.base = json.loads(FIX_DOC.read_text())

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        shutil.copytree(FIX / 'municipios', self.tmp / 'municipios')
        self.antes = (lib.build_or_load, lib._overpass, lib.http_get, lib.CACHE_DIR)
        lib.build_or_load = lib._overpass = lib.http_get = _proibido
        lib.CACHE_DIR = self.tmp / 'cache'

    def tearDown(self):
        lib.build_or_load, lib._overpass, lib.http_get, lib.CACHE_DIR = self.antes
        shutil.rmtree(self.tmp)

    def test_trechos_a_gerar_nao_sao_construidos(self):
        doc = copy.deepcopy(self.base)
        doc['regras'][1]['geometria'] = [{'arquivo': 'municipios/geo/3599999_a_gerar.geojson', 'construir': 'trechos'}]
        doc['regras'][1]['trechos'] = [{'inciso': 'I', 'via': ['Avenida Fictícia']}]
        with Dirs(self.tmp, self.tmp / 'municipios'):
            with self.assertRaises(lib.GeometriaAusente):
                m.compilar(doc, construir=False)
            texto, ok = m._resumo(doc)
        self.assertTrue(ok)
        self.assertIn('geometria a gerar no import: data/raw/municipios/geo/3599999_a_gerar.geojson', texto)
        self.assertFalse((self.tmp / 'municipios' / 'geo' / '3599999_a_gerar.geojson').exists())

    def test_limite_do_ibge_fora_da_rmsp_sem_cache(self):
        doc = copy.deepcopy(self.base)
        doc['regras'][0]['geometria'] = [{'municipios': ['3106200']}]          # BH: fora dos limites curados da RMSP
        with Dirs(self.tmp, self.tmp / 'municipios'):
            texto, ok = m._resumo(doc)
        self.assertTrue(ok)
        self.assertIn('geometria a gerar no import: limite do município 3106200', texto)

    def test_geometria_existente_incoerente_falha(self):
        doc = copy.deepcopy(self.base)
        doc['regras'][2]['geometria'][0]['geojson'] = {'type': 'Point', 'coordinates': [-44.79, -24.805]}
        with Dirs(self.tmp, self.tmp / 'municipios'):
            texto, ok = m._resumo(doc)
        self.assertFalse(ok)
        self.assertIn('geometria inválida', texto)

    def test_limites_sem_arquivo_recusa_carga_vazia(self):
        with Dirs(self.tmp, self.tmp / 'municipios'):
            self.assertEqual(lib.municipios(), [])           # o municipio_geom cai na malha do IBGE
            with self.assertRaisesRegex(FileNotFoundError, 'limites municipais curados ausentes'):
                m.limites()


# ----------------------------------------------------------------------------- arquivos reais
class Reais(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SCHEMA.exists():
            raise unittest.SkipTest('data/raw não encontrado: monte o repositório inteiro (ver docstring)')
        with Dirs(DATA_RAW, DATA_RAW / 'municipios'):
            cls.docs = {d['fonte_id']: d for d in m.carregar_todos()}

    def test_todos_os_arquivos_validos_com_ato_artigo_e_url(self):
        self.assertGreaterEqual(len(self.docs), 7)
        for d in self.docs.values():
            for r in d['regras']:
                for b in r['base_legal']:
                    self.assertTrue(b['artigo'] and b['url'].startswith('http'), f'{d["ibge"]} {r["id"]}')

    def test_rmsp_igual_aos_importadores_antigos(self):
        """A montagem das feições dos 6 municípios da RMSP é a mesma dos importadores rmsp_* antigos (antes do Valhalla)."""
        dig = json.loads(DIGESTS.read_text())
        with Dirs(DATA_RAW, DATA_RAW / 'municipios'):
            feats = {fid: m.compilar(self.docs[fid]) for fid in dig['legado'] if fid != 'ibge'}
            feats['ibge'] = m.limites()
            for fid in self.docs:
                if fid in dig['exato'] and fid not in feats:
                    feats[fid] = m.compilar(self.docs[fid])
        for fid, d in dig['legado'].items():
            self.assertEqual(digest(legado(feats[fid], fid)), d, f'{fid}: conteúdo mudou em relação aos importadores rmsp_* antigos')
        novo = {fid: digest(exato(feats[fid])) for fid in dig['exato']}
        if ATUALIZAR:
            dig['exato'] = novo
            DIGESTS.write_text(json.dumps(dig, ensure_ascii=False, indent=1) + '\n')
        self.assertEqual(novo, dig['exato'], 'feições mudaram: se a mudança no arquivo do município foi intencional, rode com ATUALIZAR=1')


if __name__ == '__main__':
    unittest.main()
