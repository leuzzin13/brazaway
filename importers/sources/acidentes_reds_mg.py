"""Acidentes com caminhão: SEJUSP-MG, base do Painel de Sinistro de Trânsito (REDS), estado de MG inteiro, com e sem vítima.
Agregados em pontos críticos com o MESMO método do Infosiga (grade de 250 m, janela de 3 anos, mínimo de 3 acidentes com
caminhão por célula; ver acidentes_infosiga). Nunca grava registro individual.

Fonte: pasta pública do Google Drive da SEJUSP (link "Acesse a Base de Dados do Painel" na página 289 do portal), com um CSV
por ano em cada subpasta: Ocorrências (Registros), Veículo e Vítimas, ligados por numero_ocorrencia_associado (hash).
- Veículo dá o tipo (caminhão = CAMINHAO, CAMINHAO/TRATOR, SEMI-REBOQUE, REBOQUE; os mesmos tipos da PRF);
- Vítimas dá os óbitos (condicao_fisica_descricao = FATAL) e o envolvimento de pedestre;
- Registros dá data, hora, logradouro, município e lat/lon (SIRGAS 2000, decimal com vírgula).
Os arquivos de Registros têm ~100 MB por ano: são lidos em STREAMING direto do Drive e só um extrato compacto (gzip, por id
de arquivo) fica em data/cache/reds_mg; nada passa inteiro pela memória.

Divisão por jurisdição (igual à do Infosiga em SP):
  - logradouro com código de BR (ou Fernão Dias como rodovia)  -> PRF (acidentes_prf), sempre descartado aqui;
  - logradouro "de rodovia" (tipo RODOVIA/ESTRADA, código MG/MGC/AMG/LMG, Anel Rodoviário) numa célula (±1) onde a PRF tem
    acidentes -> descartado (a PRF cobre aquele trecho);
  - demais (vias urbanas, rodovias estaduais e o Anel Rodoviário de BH fora das células da PRF) -> REDS (este módulo).
Coordenadas repetidas: o REDS geocodifica o endereço informado, e a mesma coordenada exata se repete muito (24% dos
acidentes com caminhão caem em coordenadas com MIN_REPETICAO ou mais repetições; 93% no Anel Rodoviário). Conferido em
10/10/2026: esses pontos ficam SOBRE a via informada (mediana de 19 m da via de mesmo nome no OSM) e se espalham ao longo
dela (137 pontos distintos no Anel), mas a posição exata do acidente se perde. Regra:
  - coordenada repetida sem logradouro dominante (nenhum nome com PADRAO_NOME_DOMINANTE dos casos, ou sem nome): centro de
    bairro/município usado quando falta o endereço -> todos os acidentes nela são descartados;
  - coordenada repetida de um logradouro só: ficam os acidentes COM vítima (registro da PM no local) e saem os SEM vítima
    (autodeclarados, quase todos pela Delegacia Virtual), que formariam "pontos críticos" só de batidas sem vítima
    empilhadas no ponto do endereço (ex.: 294 na Av. Amazonas com 3 com vítima).
Ver docs/layers/seguranca_mg.md.
"""
from __future__ import annotations
import csv, datetime as dt, gzip, html, io, re, time
from collections import Counter
from common import CACHE_DIR, UA, http_get
from sources.acidentes_infosiga import Hotspots, cell_of, in_bbox, janela, norm_txt, num, parse_hour, titulo

LAYER_ID = 'acidentes'
SOURCE = 'sejusp-mg'
SOURCE_URL = 'https://drive.google.com/drive/folders/1W_4SsAW8u5bvsaBoHhwInpUr72vES8yw'
PAGE_URL = 'https://www.seguranca.mg.gov.br/index.php/component/sppagebuilder/page/289'
# mesma redação de meta.sources em api/src/layers/acidentes.layer.ts e de docs/layers/seguranca_mg.md
LICENSE = ('SEJUSP-MG/REDS (Painel de Sinistro de Trânsito) — sem licença nomeada nos arquivos nem no CKAN; dados de '
           'transparência ativa "de livre utilização pela sociedade" (Decreto MG 48.383/2022, art. 22, observados o art. 6º '
           'da LGPD e a Lei 14.129/2021); atribuir SEJUSP-MG/REDS; confirmar uso comercial por pedido de acesso à informação')
NOTES = ('Grade 250 m (EPSG:5880), janela de 3 anos, mínimo de 3 acidentes com caminhão por célula. Com e sem vítima. '
         'BRs ficam com a PRF. Coordenada repetida (>= 5): saem os sem vítima e, se não for de um logradouro só, todos.')

FOLDER = '1W_4SsAW8u5bvsaBoHhwInpUr72vES8yw'
LIST = 'https://drive.google.com/embeddedfolderview?id={id}'
DRIVE = 'https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t'
# subpastas (título normalizado) -> tabela
TABELAS = {'OCORRENCIAS': 'registros', 'VEICULO': 'veiculos', 'VITIMAS': 'vitimas'}
MESES = {m: i + 1 for i, m in enumerate(('JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'))}
# ids do Drive em 10/10/2026 (usados se a listagem da pasta falhar; o arquivo do ano corrente troca de id todo mês)
FALLBACK = {
    'registros': {2023: ('1JkOxNL-vuN_an-R8CmldR2NXdTBmt03I', 12), 2024: ('1L0RC3o2Ep1jPY6tuAxyCQN0EGwZ8bBAi', 12),
                  2025: ('1KI90qtnejfpJXK2euTTFpFnJH8segtRb', 12), 2026: ('15TYzFOkD9PGvQc6G-mufUUUsntR7upAM', 8)},
    'veiculos': {2023: ('1EUYOVh47Dd8h_AGhJCpmkI_TVY1RTLsh', 12), 2024: ('1OBn7mLkVz1drjTeKtL5MB9_vWET35HJM', 12),
                 2025: ('1s5DsZqHiZ9_gcqoKrJhnZj8zICmnD6lT', 12), 2026: ('17DF23PMml1z6Uizjt2qXOqSjoIdHCz6U', 8)},
    'vitimas': {2023: ('16dSXFGQeg2Zr0jPqvlORCokb0w4ZgYtl', 12), 2024: ('14sK6D_LDM601R0ZZ_Ca_IkzmntWsqy5h', 12),
                2025: ('1rzSDS7IrfUpABl_3p3t1mMtiJJbxeLJF', 12), 2026: ('1GB8hU-6Px-3HnoXrKPX_c-5fx-jmh_y9', 8)},
}

CAMINHAO = {'CAMINHAO', 'CAMINHAO/TRATOR', 'SEMI REBOQUE', 'REBOQUE'}   # norm_txt troca '-' por espaço
MOTO = {'MOTOCICLETA', 'MOTONETA', 'CICLOMOTOR'}
MG_BBOX = (-51.1, -23.0, -39.8, -14.2)   # estado de MG (com folga)
MIN_REPETICAO = 5        # coordenada exata em >= 5 acidentes com caminhão na janela é "repetida" (endereço geocodificado)...
PADRAO_NOME_DOMINANTE = 0.8   # ...e é centro de bairro/município se nenhum logradouro responde por 80% dos casos dela
CACHE = 'reds_mg'

# ----------------------------------------------------------------------------------------------------------------
# Logradouro: nome legível e classe de jurisdição
# ----------------------------------------------------------------------------------------------------------------
RE_BR = re.compile(r'\bBR\s*0*(\d{2,3})\b')
RE_ESTADUAL = re.compile(r'^(MGC|MGT|AMG|LMG|MG)\s*0*(\d{1,3})\b')
NOMES_FEDERAIS = ('FERNAO DIAS', 'RIO BAHIA')          # BR-381 e BR-116 em MG, quando o tipo é RODOVIA
TIPOS_RODOVIA = {'RODOVIA', 'ESTRADA'}
TIPOS_VIA = {'RUA': 'Rua', 'AVENIDA': 'Avenida', 'VIA': 'Via', 'PRACA': 'Praça', 'ESTRADA': 'Estrada', 'RODOVIA': 'Rodovia',
             'ALAMEDA': 'Alameda', 'TRAVESSA': 'Travessa', 'ACESSO': 'Acesso', 'VIADUTO': 'Viaduto', 'TREVO': 'Trevo',
             'CONTORNO': 'Contorno', 'MARGINAL': 'Marginal', 'LADEIRA': 'Ladeira', 'PONTE': 'Ponte', 'TUNEL': 'Túnel',
             'ELEVADO': 'Elevado', 'LARGO': 'Largo', 'ANEL': 'Anel'}
SEM_NOME = {'', 'NAN', 'DESCONHECIDO', 'NAO INFORMADO', 'INVALIDO', 'IGNORADO', 'SEM NOME'}
_MINUSC = {'De', 'Da', 'Do', 'Das', 'Dos', 'E'}


def classe_via(tipo: str | None, nome: str | None) -> int:
    """0 = via comum (fica com o REDS); 1 = rodovia (descartada só nas células cobertas pela PRF); 2 = BR (sempre PRF)."""
    t, n = norm_txt(tipo), norm_txt(nome).strip(' -')
    if RE_BR.search(n) or (t == 'RODOVIA' and any(k in n for k in NOMES_FEDERAIS)):
        return 2
    if t in TIPOS_RODOVIA or RE_ESTADUAL.match(n) or 'ANEL RODOVIARIO' in n or 'RODOVIA' in n or 'FERNAO DIAS' in n:
        return 1
    return 0


def nome_via(tipo: str | None, nome: str | None) -> str | None:
    """('RODOVIA', 'MG 050') -> 'MG-050'; ('AVENIDA', 'CRISTIANO MACHADO') -> 'Avenida Cristiano Machado';
    ('RODOVIA', 'ANEL RODOVIARIO') -> 'Anel Rodoviário'. Tipos que não são via (fazenda, povoado...) ficam sem nome."""
    t, n = norm_txt(tipo), norm_txt(nome).strip(' -')
    if n in SEM_NOME:
        return None
    m = RE_BR.search(n)
    if m:
        return f'BR-{int(m.group(1)):03d}'
    m = RE_ESTADUAL.match(n)
    if m:
        return f'{m.group(1)}-{int(m.group(2)):03d}'
    if 'ANEL RODOVIARIO' in n:
        return 'Anel Rodoviário'
    if t not in TIPOS_VIA:
        return None
    words = ' '.join(str(nome).split()).strip(' -').title().split()
    nome_fmt = ' '.join(w if i == 0 or w not in _MINUSC else w.lower() for i, w in enumerate(words))
    return f'{TIPOS_VIA[t]} {nome_fmt}'


# ----------------------------------------------------------------------------------------------------------------
# Descoberta dos arquivos (listagem pública da pasta do Drive)
# ----------------------------------------------------------------------------------------------------------------
_ENTRY = re.compile(r'<div class="flip-entry" id="entry-([\w-]+)".*?<div class="flip-entry-title">(.*?)</div>', re.S)


def _entries(folder_id: str) -> list[tuple[str, str]]:
    page = http_get(LIST.format(id=folder_id), cache=f'{CACHE}/pasta_{folder_id}.html', max_age_h=24).decode('utf-8', 'replace')
    return [(i, html.unescape(t).strip()) for i, t in _ENTRY.findall(page)]


def listar() -> dict[str, dict[int, tuple[str, int]]]:
    """{'registros'|'veiculos'|'vitimas': {ano: (id do arquivo, último mês)}}; com duas versões do mesmo ano
    ('Jan a Jul 2026' e 'Jan a Ago 2026'), fica a mais recente."""
    try:
        out: dict[str, dict[int, tuple[str, int]]] = {}
        for fid, title in _entries(FOLDER):
            tab = TABELAS.get(norm_txt(title))
            if not tab:
                continue
            files: dict[int, tuple[str, int]] = {}
            for arq, nome in _entries(fid):
                m = re.search(r'JAN A (\w{3}) (\d{4})\.CSV$', norm_txt(nome))
                if not m or m.group(1) not in MESES:
                    continue
                ano, mes = int(m.group(2)), MESES[m.group(1)]
                if ano not in files or mes > files[ano][1]:
                    files[ano] = (arq, mes)
            out[tab] = files
        if set(out) != set(TABELAS.values()) or not all(out.values()):
            raise RuntimeError(f'subpastas incompletas: {sorted(out)}')
        return out
    except Exception as e:
        print(f'  ! listagem da pasta da SEJUSP indisponível ({e}); usando ids conhecidos')
        return {k: dict(v) for k, v in FALLBACK.items()}


# ----------------------------------------------------------------------------------------------------------------
# Leitura em streaming + extrato compacto em cache (por id de arquivo)
# ----------------------------------------------------------------------------------------------------------------
def _stream_rows(file_id: str):
    """Linhas (dict) do CSV direto da resposta HTTP, sem gravar o arquivo bruto."""
    import requests
    with requests.get(DRIVE.format(id=file_id), headers=UA, stream=True, timeout=(30, 300)) as r:
        r.raise_for_status()
        if 'text/html' in (r.headers.get('content-type') or ''):
            raise RuntimeError(f'Drive devolveu HTML para {file_id} (aviso de cota ou confirmação); tente mais tarde')
        r.raw.decode_content = True
        r.raw.auto_close = False      # sem isso o urllib3 fecha o corpo no fim e o TextIOWrapper falha ("closed file")
        text = io.TextIOWrapper(io.BufferedReader(r.raw, 1 << 20), encoding='utf-8-sig', errors='replace', newline='')
        yield from csv.DictReader(text, delimiter=';')


def _extrato(kind: str, file_id: str, build) -> 'pathlib.Path':
    """Gera (uma vez por id de arquivo) o extrato gzip de `kind` com build(rows, writer); tenta 3 vezes do zero."""
    p = CACHE_DIR / CACHE / f'{kind}_{file_id}.csv.gz'
    if p.exists() and p.stat().st_size > 0:
        return p
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.part')
    for attempt in range(3):
        try:
            t0 = time.time()
            with gzip.open(tmp, 'wt', encoding='utf-8', newline='') as fh:
                n = build(_stream_rows(file_id), csv.writer(fh, delimiter=';'))
            tmp.replace(p)
            print(f'    {kind} {file_id}: {n} linhas em {time.time() - t0:.0f}s')
            return p
        except Exception as e:
            tmp.unlink(missing_ok=True)
            if attempt == 2:
                raise
            print(f'  ! {kind} {file_id}: {e}; nova tentativa')
            time.sleep(10 * (attempt + 1))
    return p


def _build_veiculos(rows, w) -> int:
    """id;caminhao;moto (só ocorrências com caminhão ou moto)."""
    cam, moto, n = set(), set(), 0
    for r in rows:
        n += 1
        i, tv = r.get('numero_ocorrencia_associado'), norm_txt(r.get('tipo_veiculo_descricao_longa'))
        if not i:
            continue
        if tv in CAMINHAO:
            cam.add(i)
        elif tv in MOTO:
            moto.add(i)
    for i in sorted(cam | moto):
        w.writerow([i, int(i in cam), int(i in moto)])
    return n


def _build_vitimas(rows, w) -> int:
    """id;obitos;pedestre (só ocorrências com óbito ou pedestre vítima)."""
    ob, ped, n = Counter(), set(), 0
    for r in rows:
        n += 1
        i = r.get('numero_ocorrencia_associado')
        if not i:
            continue
        if norm_txt(r.get('condicao_fisica_descricao')) == 'FATAL':
            ob[i] += max(1, int(num(r.get('qtd_envolvido')) or 1))
        if 'PEDESTRE' in norm_txt(r.get('envolvimento_descricao')):
            ped.add(i)
    for i in sorted(set(ob) | ped):
        w.writerow([i, ob.get(i, 0), int(i in ped)])
    return n


def _data(s: str | None) -> dt.date | None:
    s = (s or '').strip()
    try:
        return dt.date.fromisoformat(s[:10]) if '-' in s else dt.datetime.strptime(s[:10], '%d/%m/%Y').date()
    except ValueError:
        return None


def _build_registros(rows, w) -> int:
    """id;data;hora;lat;lon;vitima;tipo_logradouro;logradouro;municipio (todas as ocorrências; coordenada com 7 casas)."""
    n, seen = 0, set()
    for r in rows:
        i = r.get('numero_ocorrencia_associado')
        d = _data(r.get('data_fato'))
        if not i or i in seen or d is None:
            continue
        seen.add(i)
        n += 1
        lat, lon = num(r.get('latitude_sirgas2000')), num(r.get('longitude_sirgas2000'))
        h = parse_hour(r.get('horario_fato'))
        w.writerow([i, d.isoformat(), '' if h is None else h,
                    '' if lat is None else f'{lat:.7f}', '' if lon is None else f'{lon:.7f}',
                    int('COM VITIMA' in norm_txt(r.get('natureza_descricao'))),
                    (r.get('tipo_logradouro_descricao') or '').strip(), (r.get('logradouro_nome') or '').strip(),
                    (r.get('nome_municipio') or '').strip()])
    return n


def _read(path) -> 'Iterator[list[str]]':
    with gzip.open(path, 'rt', encoding='utf-8', newline='') as fh:
        yield from csv.reader(fh, delimiter=';')


# ----------------------------------------------------------------------------------------------------------------
# Importação
# ----------------------------------------------------------------------------------------------------------------
_mun_cache: dict[str, str | None] = {}


def _municipio(raw: str) -> str | None:
    if raw not in _mun_cache:
        _mun_cache[raw] = titulo(raw, 'MG')
    return _mun_cache[raw]


def fetch():
    files = listar()
    anos_comuns = set(files['registros']) & set(files['veiculos']) & set(files['vitimas'])
    ultimo = min(max((a, files[t][a][1]) for a in anos_comuns) for t in files)   # tabela mais atrasada manda
    start, end = janela(min(dt.date(ultimo[0], ultimo[1], 1), dt.date.today()))
    anos = [a for a in range(start.year, end.year + 1) if a in anos_comuns]
    print(f'    janela {start}..{end}; anos {anos}')

    # BRs em MG: células (±1) com acidentes da PRF
    from sources import acidentes_prf
    covered = acidentes_prf.covered_cells(MG_BBOX)
    print(f'    {len(covered)} células cobertas pela PRF em MG')

    truck, moto, obitos, ped = set(), set(), {}, set()
    regs = []
    for a in anos:
        for i, c, m in _read(_extrato('veiculos', files['veiculos'][a][0], _build_veiculos)):
            if c == '1':
                truck.add(i)
            if m == '1':
                moto.add(i)
        for i, o, p in _read(_extrato('vitimas', files['vitimas'][a][0], _build_vitimas)):
            if int(o):
                obitos[i] = int(o)
            if p == '1':
                ped.add(i)
        regs.append(_extrato('registros', files['registros'][a][0], _build_registros))

    def linhas():
        for p in regs:
            for row in _read(p):
                d = dt.date.fromisoformat(row[1])
                if start <= d <= end:
                    yield row

    # 1ª passada: acidentes com caminhão (e contagem de coordenadas repetidas entre eles)
    skipped = Counter()
    eventos, rep = [], {}
    n_truck_janela = 0
    for i, d, h, la, lo, vit, tipo, logr, mun in linhas():
        if i not in truck:
            continue
        n_truck_janela += 1
        lat, lon = num(la), num(lo)
        if not in_bbox(lon, lat, MG_BBOX):
            skipped['sem_coord'] += 1
            continue
        rep.setdefault((la, lo), Counter())[nome_via(tipo, logr) or ''] += 1
        eventos.append((i, h, la, lo, vit, tipo, logr, mun))

    def _centro(nomes: Counter) -> bool:
        nome, k = nomes.most_common(1)[0]
        return not nome or k < PADRAO_NOME_DOMINANTE * sum(nomes.values())
    repetidas = {k for k, c in rep.items() if sum(c.values()) >= MIN_REPETICAO}
    centros = {k for k in repetidas if _centro(rep[k])}
    del rep

    def posicao(la: str, lo: str, vitima: bool) -> str | None:
        """Motivo de descarte pela qualidade da coordenada (ver o docstring do módulo)."""
        if (la, lo) in centros:
            return 'coord_centro'
        if (la, lo) in repetidas and not vitima:
            return 'coord_repetida_sem_vitima'
        return None

    def jurisdicao(lon: float, lat: float, tipo: str, logr: str) -> str | None:
        cls = classe_via(tipo, logr)
        if cls == 2:
            return 'br_prf'
        if cls == 1 and cell_of(lon, lat) in covered:
            return 'rodovia_coberta'
        return None

    hs = Hotspots()
    for i, h, la, lo, vit, tipo, logr, mun in eventos:
        lon, lat = float(lo), float(la)
        ob = obitos.get(i, 0)
        vitima = vit == '1' or ob > 0
        motivo = jurisdicao(lon, lat, tipo, logr) or posicao(la, lo, vitima)
        if motivo:
            skipped[motivo] += 1
            continue
        hs.add(lon, lat, truck=True, fatal=ob > 0, vitima=vitima, obitos=ob, moto=i in moto, pedestre=i in ped,
               hour=int(h) if h != '' else None, via=nome_via(tipo, logr), municipio=_municipio(mun))
    celulas = set(hs.cells)

    # 2ª passada: as demais ocorrências (qualquer veículo) só para `total`/`fatais` das células que têm caminhão
    n_janela = n_validas = 0
    for i, d, h, la, lo, vit, tipo, logr, mun in linhas():
        n_janela += 1
        if i in truck:
            continue
        lat, lon = num(la), num(lo)
        if not in_bbox(lon, lat, MG_BBOX) or jurisdicao(lon, lat, tipo, logr) or posicao(la, lo, vit == '1' or i in obitos):
            continue
        n_validas += 1
        if cell_of(lon, lat) in celulas:
            hs.add(lon, lat, truck=False, fatal=obitos.get(i, 0) > 0, vitima=vit == '1')
    hs.n_events = n_validas + hs.n_truck   # Hotspots só viu as ocorrências das células com caminhão

    feats = hs.features(SOURCE, start, end, 'SEJUSP-MG (REDS)')
    resumo = (f'{n_janela} ocorrências na janela, {n_truck_janela} com caminhão; {len(repetidas)} coordenadas com >= '
              f'{MIN_REPETICAO} acidentes com caminhão, {len(centros)} delas sem logradouro dominante')
    global NOTES
    NOTES = (f'{NOTES} Fonte: {PAGE_URL}. Janela {start}..{end}. {resumo}. {hs.summary(feats)}. '
             f'Descartados (com caminhão): {dict(skipped)}.')
    print(f'    {resumo}')
    print('   ', hs.summary(feats), dict(skipped))
    return feats
