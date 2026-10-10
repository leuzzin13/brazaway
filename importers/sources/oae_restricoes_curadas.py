"""Restrições oficiais em pontes/viadutos curadas à mão (data/raw/oae_restricoes_curadas.csv).

Cada linha é uma restrição publicada por órgão oficial (portaria, notícia oficial da Prefeitura/DER/Defesa Civil),
com fonte, datas, data de verificação e status:
  - `vigente`  : confirmada por fonte oficial recente → a API bloqueia (exclusão pequena sobre o tabuleiro) para os
                 veículos que o `criterio` alcança;
  - `historica`: restrição que existiu mas não tem confirmação recente (ou já foi liberada) → só informa.

Colunas do CSV (todas texto; vazias = desconhecido):
  id, nome, municipio, orgao, tipo (proibido_pesados|interditada|peso|altura|faixa_interditada), valor, unidade,
  aplica_a (texto do ato), criterio (todos|caminhoes|nenhum|pbt>X|eixos>N|altura>=X), exceto_vuc (sim|nao), sentido,
  status (vigente|historica), inicio, fim (AAAA-MM-DD), ato, fonte_url, fonte_data, liberacao, liberacao_url,
  liberacao_data, liberacao_fonte, verificado_em, eixo ("lon lat;lon lat;..."), bloqueio_pontos ("lon lat;..."),
  bloqueio_raio_m, obs

Critério: `pbt>X` (peso bruto total acima de X t), `eixos>N` (mais de N eixos) e `altura>=X` usam exatamente o operador
que a API aplica (`>` estrito para peso e eixos, `>=` para altura). Outro operador é recusado, para não trocar a
semântica do ato em silêncio (ex.: um ato "a partir de 10 t" se escreve `pbt>9.99` ou se discute antes de entrar).

`fim` só é preenchido quando a fonte diz explicitamente que os veículos alcançados pela restrição foram liberados
(ex.: "liberada para todos os tipos de veículos"). Obra concluída ou faixas liberadas sem citar caminhões/pesados vão em
`liberacao`/`liberacao_data`, sem `fim`: a API avisa "confira a placa" em vez de "já liberada".

Geometria: `eixo` é o eixo aproximado da obra (poucos pontos; traçado sobre o OSM e conferido com a descrição oficial).
`bloqueio_pontos` são pontos SOBRE o tabuleiro onde nenhuma outra via passa por baixo (ex.: sobre o rio), para a
exclusão não bloquear a Marginal sob a ponte. Sem ponto de bloqueio a linha nunca bloqueia (só informa).
O importador confere cada ponto no /locate do Valhalla: se houver uma aresta que não é a própria estrutura (nem ponte,
nem com o nome dela) a menos de `bloqueio_raio_m` + MARGEM_OUTRA_VIA_M, a carga falha com a linha do erro. Sem Valhalla
a conferência é pulada (com aviso no log).
"""
import csv
import os
import re

from common import DATA_DIR
from sources._oae_locate import locate, norm

LAYER_ID = 'oae'
SOURCE = 'curadoria'
CSV_PATH = os.environ.get('CURADORIA_CSV') or str(DATA_DIR / 'raw' / 'oae_restricoes_curadas.csv')
SOURCE_URL = 'data/raw/oae_restricoes_curadas.csv (curadoria manual de atos e notícias oficiais; URL de cada fonte em props.restricao)'
LICENSE = ('Fatos extraídos de atos e notícias oficiais (PMSP, Prefeituras, CET, SIURB, Defesa Civil) com citação da fonte; '
           'geometria aproximada derivada do OSM (ODbL, extração não substancial). Mantida fora do OSM.')
NOTES = 'Revisar a cada 3 meses. Só status=vigente bloqueia rota; historica apenas informa.'

TIPOS = {'proibido_pesados', 'interditada', 'peso', 'altura', 'faixa_interditada'}
STATUS = {'vigente', 'historica'}
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MARGEM_OUTRA_VIA_M = 10   # folga entre o círculo de bloqueio e a via mais próxima que não é a estrutura


def _pts(s: str) -> list[list[float]]:
    out = []
    for part in (s or '').split(';'):
        part = part.strip()
        if not part:
            continue
        lon, lat = (float(x) for x in part.split())
        if not (-75 <= lon <= -28 and -35 <= lat <= 6):
            raise ValueError(f'coordenada fora do Brasil: {part}')
        out.append([lon, lat])
    return out


def _criterio(s: str, exceto_vuc: bool) -> dict:
    """Converte o critério textual em regra que a API avalia contra o veículo."""
    s = (s or '').strip().lower().replace(' ', '')
    if s in ('', 'nenhum'):
        return {'nenhum': True}
    if s == 'todos':
        return {'todos': True}
    if s == 'caminhoes':
        return {'caminhoes': True, 'exceto_vuc': exceto_vuc}
    m = re.match(r'^(pbt|eixos|altura)(>=|>|<=|<|=)(\d+(?:\.\d+)?)$', s)
    if not m:
        raise ValueError(f'critério inválido: {s}')
    campo, op, val = m.group(1), m.group(2), float(m.group(3))
    # o operador gravado tem de ser o que a API aplica (criterioAplica): > para peso/eixos, >= para altura
    esperado = {'pbt': '>', 'eixos': '>', 'altura': '>='}[campo]
    if op != esperado:
        raise ValueError(f'{campo} usa "{esperado}" (a API compara assim); recebido "{op}" em {s}')
    key = {'pbt': 'peso_acima_t', 'eixos': 'eixos_acima', 'altura': 'altura_min_m'}[campo]
    return {key: val, 'exceto_vuc': exceto_vuc}


def _palavras(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', norm(s)).strip()


def conferir_pontos(rows: list[dict]) -> None:
    """Confere no Valhalla que cada ponto de bloqueio 'sobre' toca só a própria estrutura (ver docstring do módulo)."""
    alvos = [(f, tuple(p)) for f in rows for p in ((f['props']['bloqueio'] or {}).get('pontos') or [])
             if f['props']['bloqueio']['modo'] == 'sobre']
    if not alvos:
        return
    maior = max(f['props']['bloqueio']['raio_m'] for f, _ in alvos) + MARGEM_OUTRA_VIA_M
    res = locate([p for _, p in alvos], maior)
    if res is None:
        print('  ! pontos de bloqueio NÃO conferidos no Valhalla')
        return
    erros = []
    for (f, p), edges in zip(alvos, res):
        raio = f['props']['bloqueio']['raio_m']
        nome = _palavras(f['name'])
        def propria(e):
            return e['bridge'] or any(len(_palavras(n)) >= 6 and (_palavras(n) in nome or nome in _palavras(n)) for n in e['names'])
        outras = [e for e in edges if e['dist'] <= raio + MARGEM_OUTRA_VIA_M and not propria(e)]
        if outras:
            o = outras[0]
            erros.append(f"{f['source_id']}: ponto {p[0]} {p[1]} a {o['dist']:.1f} m de '{(o['names'] or ['via sem nome'])[0]}' "
                         f'(limite {raio:g} + {MARGEM_OUTRA_VIA_M} m): o bloqueio pegaria essa via')
        if not any(propria(e) and e['dist'] <= raio for e in edges):
            print(f"  ! {f['source_id']}: nenhuma aresta da estrutura a até {raio:g} m do ponto {p[0]} {p[1]} "
                  '(estrutura fora do grafo, ex.: obra/interditada no OSM?). Bloqueio vale se o OSM reabrir a via.')
    if erros:
        raise ValueError('pontos de bloqueio inválidos:\n  ' + '\n  '.join(erros))


def _kind(nome: str) -> str:
    n = nome.lower()
    if n.startswith('viaduto') or 'elevado' in n:
        return 'viaduto'
    if 'passarela' in n:
        return 'passarela'
    if 'túnel' in n or 'tunel' in n:
        return 'tunel'
    return 'ponte'


def _num(s):
    s = (s or '').strip().replace(',', '.')
    return float(s) if s else None


def fetch():
    path = CSV_PATH
    with open(path, newline='', encoding='utf-8') as fh:
        rows = list(csv.DictReader(fh))
    out = []
    for i, r in enumerate(rows, start=2):
        r = {k: (v or '').strip() for k, v in r.items() if k}
        rid = r['id']
        try:
            if r['tipo'] not in TIPOS:
                raise ValueError(f"tipo inválido: {r['tipo']}")
            if r['status'] not in STATUS:
                raise ValueError(f"status inválido: {r['status']}")
            for k in ('inicio', 'fim', 'fonte_data', 'liberacao_data', 'verificado_em'):
                if r.get(k) and not DATE.match(r[k]):
                    raise ValueError(f'{k} fora do formato AAAA-MM-DD: {r[k]}')
            if not r.get('fonte_url') or not r.get('verificado_em'):
                raise ValueError('fonte_url e verificado_em são obrigatórios')
            eixo = _pts(r['eixo'])
            if not eixo:
                raise ValueError('eixo vazio')
            pontos = _pts(r.get('bloqueio_pontos', ''))
            valor = _num(r.get('valor'))
            crit = _criterio(r.get('criterio', ''), r.get('exceto_vuc', '').lower() == 'sim')
        except Exception as e:
            raise ValueError(f'{os.path.basename(path)} linha {i} ({rid}): {e}') from e
        vigente = r['status'] == 'vigente'
        geom = {'type': 'LineString', 'coordinates': eixo} if len(eixo) > 1 else {'type': 'Point', 'coordinates': eixo[0]}
        restricao = {
            'tipo': r['tipo'], 'valor': valor, 'unidade': r.get('unidade') or None, 'aplica_a': r.get('aplica_a') or None,
            'criterio': crit, 'sentido': r.get('sentido') or None, 'status': r['status'],
            'inicio': r.get('inicio') or None, 'fim': r.get('fim') or None,
            'ato': r.get('ato') or None, 'fonte_url': r['fonte_url'], 'fonte_data': r.get('fonte_data') or None,
            'liberacao': r.get('liberacao') or None, 'liberacao_url': r.get('liberacao_url') or None,
            'liberacao_data': r.get('liberacao_data') or None, 'liberacao_fonte': r.get('liberacao_fonte') or None,
            'verificado_em': r['verificado_em'], 'orgao': r.get('orgao') or None, 'obs': r.get('obs') or None,
        }
        raio = _num(r.get('bloqueio_raio_m')) or 12
        out.append({
            'source_id': rid,
            'geometry': geom,
            'name': r['nome'],
            'kind': _kind(r['nome']),
            'props': {
                'admin': r.get('orgao') or None, 'municipio': r.get('municipio') or None,
                'restricao': restricao,
                # limites numéricos genéricos (lidos pela regra geral da camada) só quando vigentes
                'altura_livre_m': valor if (vigente and r['tipo'] == 'altura') else None,
                'peso_max_t': valor if (vigente and r['tipo'] == 'peso') else None,
                'altura_fonte': 'curadoria (ato oficial)' if (vigente and r['tipo'] == 'altura') else None,
                'bloqueio': {'modo': 'sob' if r['tipo'] == 'altura' else 'sobre', 'pontos': pontos, 'raio_m': raio} if pontos else None,
            },
            # vigência com fim conhecido expira sozinha; histórica fica visível (sem valid_to) para informar
            'valid_from': None,
            'valid_to': (r['fim'] + 'T23:59:59-03:00') if (vigente and r.get('fim')) else None,
        })
    conferir_pontos(out)
    return out
