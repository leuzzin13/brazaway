"""CEP → centroide (ipea/padronizacao_cnefe, arquivo municipio_cep.parquet) → tabela cep_centroid.

O IPEA publica o CNEFE 2022 padronizado (base do pacote geocodebr). municipio_cep traz, para 928.905 CEPs do Brasil,
a média das coordenadas dos endereços do CNEFE no CEP (n_casos) e o desvio em metros.
CEPs de grandes usuários (-9xx, ex.: 05316-900 CEAGESP) NÃO estão: a API consulta o ViaCEP só nesses casos.

Sem seed versionado (~930 mil linhas). Rode com --no-seed; precisa de pyarrow:
    docker run ... --entrypoint sh truck-router-importer -c "pip install -q pyarrow==17.0.0 && python run.py cep_ipea --no-seed"
"""
import io, json, os
from common import _pg_conn, http_get

LAYER_ID = 'geocoding'
SOURCE = 'ipea-cep'
RELEASE = os.environ.get('IPEA_CNEFE_RELEASE', 'v0.5.0')
SOURCE_URL = f'https://github.com/ipea/padronizacao_cnefe/releases/download/{RELEASE}/municipio_cep.parquet'
LICENSE = ('Dados: IBGE — CNEFE 2022 (público, citar a fonte), padronizados pelo IPEA (ipea/padronizacao_cnefe; o repositório não '
           'declara licença; o pacote geocodebr que os distribui é MIT)')
NOTES = None


def fetch():
    global NOTES
    import pyarrow.parquet as pq
    raw = http_get(SOURCE_URL, cache=f'geocoding/municipio_cep_{RELEASE}.parquet', max_age_h=24 * 180, timeout=600)
    t = pq.read_table(io.BytesIO(raw), columns=['estado', 'municipio', 'code_muni', 'cep', 'n_casos', 'lon', 'lat', 'desvio_metros'])
    rows = t.to_pylist()
    n = 0
    with _pg_conn() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute('truncate cep_centroid')
        with cur.copy('copy cep_centroid (cep, cod_mun, municipio, uf, n, desvio_m, lat, lon) from stdin') as cp:
            for r in rows:
                cep = ''.join(ch for ch in (r['cep'] or '') if ch.isdigit())
                if len(cep) != 8 or r['lat'] is None or r['lon'] is None:
                    continue
                cp.write_row((int(cep), r['code_muni'], r['municipio'], r['estado'], r['n_casos'],
                              None if r['desvio_metros'] is None else round(float(r['desvio_metros']), 1),
                              float(r['lat']), float(r['lon'])))
                n += 1
        # cobertura por UF (só para /api/sources e mapa): fecho convexo dos centroides
        cur.execute("""select uf, count(*), ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_ConvexHull(ST_Collect(ST_MakePoint(lon, lat))), 0.01), 5)
                         from cep_centroid group by uf order by uf""")
        cov = cur.fetchall()
    NOTES = f'{n:,} CEPs em cep_centroid (tabela própria; release {RELEASE}). As feições aqui são só a cobertura por UF.'
    print('    ' + NOTES)
    return [{'source_id': uf, 'geometry': json.loads(g), 'name': f'CEPs {uf}', 'kind': 'cobertura_cep',
             'props': {'uf': uf, 'ceps': c}} for uf, c, g in cov if g]
