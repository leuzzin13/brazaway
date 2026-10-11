#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
diarios_consolidados.py - cliente unico para DIARIOS OFICIAIS CONSOLIDADOS (varios municipios num diario so)
do Sudeste, para achar atos de restricao de caminhoes. Somente leitura; nao chama Valhalla; nao escreve no repo.

USO (agentes de pesquisa por cidade) - SEMPRE comece pelo lead pronto, depois busque termos novos:
  python3 diarios_consolidados.py lead 3118601                    # o que a varredura ja achou (JSON)
  python3 diarios_consolidados.py buscar 3118601 "circulação de caminhões"
  python3 diarios_consolidados.py buscar "Colatina" "carga e descarga" --json
  python3 diarios_consolidados.py buscar "Itu/SP" "zona de máxima restrição" --fonte doesp,dosp
  python3 diarios_consolidados.py fontes                          # o que cada diario cobre e como busca
  Lead pronto: ../leads/diarios_consolidados.json -> {ibge: {acertos, ocorrencias[{data,titulo,trecho,url,
  score,motivos,fonte,termos}], indicios[...], fontes_que_cobrem, ...}}; _meta explica criterio e cobertura.

VARREDURA EM ESCALA (preparador; retomavel - checkpoint por pagina em leads/diarios_consolidados_raw/estado.json):
  python3 diarios_consolidados.py cobertura [--fontes x,y] [--ufs MG,RJ,ES,SP]   # mede cobertura (dosp: descobre slugs)
  python3 diarios_consolidados.py varrer [--fontes x,y] [--termos a,b]          # termos-chave no diario INTEIRO
  python3 diarios_consolidados.py reatribuir-domes                             # DOM-ES: municipio via pagina anterior
  python3 diarios_consolidados.py consolidar                                   # raw -> leads/diarios_consolidados.json
  Se cair: rode o mesmo comando de novo (pula o que esta 'completo' no estado; hits ficam em hits_<fonte>.jsonl).

FONTES (testadas em 10/10/2026; detalhes e cobertura medida em `fontes` e no _meta do JSON):
  amm-mg  SIGPub/Vox  www.diariomunicipal.com.br/amm-mg  (MG, AMM: ~504 aderentes no seletor + historicos)
  aemerj  SIGPub/Vox  www.diariomunicipal.com.br/aemerj  (RJ, AEMERJ: 10)
  apm     SIGPub/Vox  www.diariomunicipal.com.br/apm     (SP, APM: 7)
  domes   DOM-ES/AMUNES no DIO-ES  ioes.dio.es.gov.br/dom (ES; acervo desde 2021; o antigo
          diariomunicipal.es.gov.br responde 404 e tem certificado incompleto)
  doesp   DOE-SP caderno "Municipios"  doe.sp.gov.br (SP: 640 com alguma publicacao desde 05/2023)
  dosp    DiOE/"Imprensa Oficial Municipal" www.imprensaoficialmunicipal.com.br/<slug> (=dosp.com.br; ~256 SP + MG)
  qd      Querido Diario  api.queridodiario.org.br (161 cidades do Sudeste com spider)

Semantica das buscas:
  SIGPub: E logico entre palavras (aspas ignoradas), relevancia, 25/pag, teto de 10.000; resultado = MATERIA
          (titulo, entidade, trecho, data, edicao, codigo) -> municipio pela entidade.
  DOM-ES: Elasticsearch, frase exata entre aspas (sem aspas = OU), 10 PAGINAS de edicao por pedido ->
          municipio por heuristica no texto (campo 'atribuicao').
  DOE-SP: frase exata, 100/pag, filtro por municipio (SectionId); 'hierarchy' traz o municipio.
  DOSP:   frase exata na integra da edicao, por cidade; devolve ate 100 edicoes (sem trecho; trecho via PDF).
  QD:     frase entre aspas; territory_ids multiplos; API lenta e instavel (size>=50 -> 520).
"""
import argparse
import base64
import datetime
import difflib
import functools
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
CIDADES = os.path.dirname(AQUI)
CSV_MUN = os.path.join(CIDADES, "municipios_sudeste.csv")
QD_CITIES = os.path.join(CIDADES, "qd_cities.json")
LEADS = os.path.join(CIDADES, "leads")
RAW = os.path.join(LEADS, "diarios_consolidados_raw")
OUT = os.path.join(LEADS, "diarios_consolidados.json")
ESTADO = os.path.join(RAW, "estado.json")
COBERTURA = os.path.join(RAW, "cobertura.json")
LOG = os.path.join(RAW, "log.txt")
UA = "Mozilla/5.0 (truck-router pesquisa municipal; contato via projeto)"
HOJE = datetime.date.today().isoformat()

# --------------------------------------------------------------------------------------
# Termos-chave. "frase" = backends com frase exata; "sigpub" = palavras (E logico) no SIGPub
# (None = nao roda naquele backend). "fontes" restringe (None = todas).
TERMOS = [
    {"id": "circ_caminhoes", "frase": "circulação de caminhões", "sigpub": "circulação caminhões"},
    {"id": "traf_caminhoes", "frase": "tráfego de caminhões", "sigpub": "tráfego caminhões"},
    {"id": "trans_caminhoes", "frase": "trânsito de caminhões", "sigpub": "trânsito caminhões"},
    {"id": "circ_pesados", "frase": "circulação de veículos pesados", "sigpub": "circulação veículos pesados"},
    {"id": "traf_pesados", "frase": "tráfego de veículos pesados", "sigpub": "tráfego veículos pesados"},
    {"id": "trans_pesados", "frase": "trânsito de veículos pesados", "sigpub": "trânsito veículos pesados"},
    {"id": "circ_carga", "frase": "circulação de veículos de carga", "sigpub": "circulação veículos carga"},
    {"id": "carga_descarga", "frase": "carga e descarga", "sigpub": "carga descarga horário", "amplo": True},
    {"id": "zmrc", "frase": "zona de máxima restrição", "sigpub": "máxima restrição circulação"},
    {"id": "restr_circ", "frase": "restrição de circulação", "sigpub": "restrição circulação", "amplo": True},
    {"id": "restr_a_circ", "frase": "restrição à circulação", "sigpub": None, "amplo": True},
    {"id": "grande_porte", "frase": "veículos de grande porte", "sigpub": "grande porte circulação", "amplo": True},
    {"id": "estac_caminhoes", "frase": "estacionamento de caminhões", "sigpub": "estacionamento caminhões"},
    {"id": "trafego_pesado", "frase": "tráfego pesado", "sigpub": "tráfego pesado", "amplo": True},
    {"id": "perimetro_caminhoes", "frase": None, "sigpub": "perímetro urbano caminhões"},
    {"id": "carretas", "frase": "circulação de carretas", "sigpub": "carretas circulação", "amplo": True},
    {"id": "vuc", "frase": "veículo urbano de carga", "sigpub": None, "amplo": True},
    {"id": "bitrem", "frase": "bitrem", "sigpub": "bitrem circulação", "amplo": True},
]
# Termos mais especificos que valem o custo de abrir PDF (DOSP, sem trecho na busca).
TERMOS_PDF_DOSP = {"circ_caminhoes", "traf_caminhoes", "trans_caminhoes", "circ_pesados", "traf_pesados",
                   "trans_pesados", "circ_carga", "zmrc", "restr_circ", "restr_a_circ", "estac_caminhoes"}

# Teto de paginas por (fonte, termo) na varredura global.
MAX_PAG = {"sigpub": 40, "domes": 60, "doesp": 20, "qd": 20, "qd_amplo": 6}  # qd: paginas de 10 diarios

# Intervalo minimo entre pedidos ao MESMO host (segundos).
DELAYS = {
    "www.diariomunicipal.com.br": 1.0,
    "ioes.dio.es.gov.br": 0.8,
    "do-api-web-search.doe.sp.gov.br": 0.5,
    "www.imprensaoficialmunicipal.com.br": 0.5,
    "www.dosp.com.br": 1.0,
    "api.queridodiario.org.br": 2.0,
}

_lock_log = threading.Lock()
_lock_estado = threading.Lock()
_host_lock = {}
_host_ult = {}
_host_lock_global = threading.Lock()
_SO_CURL = set()


def log(msg):
    linha = "[%s] %s" % (datetime.datetime.now().strftime("%H:%M:%S"), msg)
    with _lock_log:
        print(linha, flush=True)
        try:
            os.makedirs(RAW, exist_ok=True)
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(linha + "\n")
        except Exception:
            pass


# --------------------------------------------------------------------------------------
# HTTP via curl, com taxa por host e retentativa
def _espera(host):
    with _host_lock_global:
        lk = _host_lock.setdefault(host, threading.Lock())
    lk.acquire()
    try:
        d = DELAYS.get(host, 1.0)
        dt = time.time() - _host_ult.get(host, 0)
        if dt < d:
            time.sleep(d - dt)
        _host_ult[host] = time.time()
    finally:
        lk.release()


class _SemRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_OPENER = urllib.request.build_opener()
_OPENER_SR = urllib.request.build_opener(_SemRedir)


def _via_urllib(url, data, timeout, seguir, headers):
    """Pedido em processo (sem fork de curl: sob carga alta o fork/exec e o gargalo)."""
    hd = {"User-Agent": UA, "Accept": "*/*"}
    for h in (headers or []):
        k, v = h.split(":", 1)
        hd[k.strip()] = v.strip()
    corpo = None
    if data is not None:
        items = data.items() if isinstance(data, dict) else data
        corpo = urllib.parse.urlencode(list(items)).encode()
        hd["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=corpo, headers=hd)
    op = _OPENER if seguir else _OPENER_SR
    try:
        with op.open(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read()
        except Exception:
            return e.code, b""


def http(url, params=None, data=None, timeout=90, tentativas=5, seguir=True, headers=None, aceitar=(200,)):
    """Devolve (status, bytes). params/data: lista de tuplas ou dict. Retenta em 0/429/5xx.
    Usa urllib; se der erro de SSL/conexao, tenta curl."""
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    host = urllib.parse.urlparse(url).netloc
    espera = [5, 15, 40, 90, 180]
    st, body = 0, b""
    for t in range(tentativas):
        _espera(host)
        if host not in _SO_CURL:
            try:
                st, body = _via_urllib(url, data, timeout, seguir, headers)
            except Exception as ex:
                st, body = 0, b""
                if "SSL" in str(ex) or "CERTIFICATE" in str(ex).upper():
                    _SO_CURL.add(host)
            if st in aceitar or (st and st < 500 and st != 429):
                return st, body
            if host not in _SO_CURL:
                w = espera[min(t, len(espera) - 1)]
                log("  http %s em %s (tentativa %d) - aguardando %ss" % (st, url[:120], t + 1, w))
                time.sleep(w)
                continue
        fd, tmp = tempfile.mkstemp(prefix="dc_")
        os.close(fd)
        cmd = ["curl", "-s", "-m", str(timeout), "-A", UA, "-o", tmp, "-w", "%{http_code}"]
        if seguir:
            cmd.append("-L")
        for h in (headers or []):
            cmd += ["-H", h]
        if data is not None:
            items = data.items() if isinstance(data, dict) else data
            for k, v in items:
                cmd += ["--data-urlencode", "%s=%s" % (k, v)]
        cmd.append(url)
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=timeout + 30).stdout.decode().strip()
            st = int(out or 0)
        except Exception:
            st = 0
        try:
            with open(tmp, "rb") as f:
                body = f.read()
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass
        if st in aceitar or (st and st < 500 and st != 429):
            return st, body
        w = espera[min(t, len(espera) - 1)]
        log("  http %s em %s (tentativa %d) - aguardando %ss" % (st, url[:120], t + 1, w))
        time.sleep(w)
    return st, body


def http_json(url, params=None, **kw):
    st, b = http(url, params=params, **kw)
    try:
        return json.loads(b.decode("utf-8", "ignore"))
    except Exception:
        return None


def limpa_html(s):
    s = re.sub(r"<script.*?</script>|<style.*?</style>", " ", s or "", flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


# --------------------------------------------------------------------------------------
# Municipios e normalizacao de nomes
def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[-'`´’‘\"]", " ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


_MUN = None
ALIASES = {  # variantes de grafia -> nome oficial normalizado
    "embu": "embu das artes", "moji mirim": "mogi mirim", "moji guacu": "mogi guacu",
    "moji das cruzes": "mogi das cruzes", "parati": "paraty", "trajano de morais": "trajano de moraes",
    "armacao de buzios": "armacao dos buzios", "buzios": "armacao dos buzios", "brasopolis": "brazopolis",
    "sao thome das letras": "sao tome das letras", "gouvea": "gouveia", "dona eusebia": "dona euzebia",
    "sao joao del rey": "sao joao del rei", "florinia": "florinea", "ipaucu": "ipaussu",
    "itu": "itu", "itabirinha de mantena": "itabirinha", "pingo dagua": "pingo d agua",
    "olhos dagua": "olhos d agua", "passa 4": "passa quatro", "sao luis do paraitinga": "sao luiz do paraitinga",
    "santa barbara do oeste": "santa barbara d oeste",
}


def municipios():
    global _MUN
    if _MUN is None:
        _MUN = {}
        with open(CSV_MUN, encoding="utf-8") as f:
            for ln in f:
                p = ln.strip().split(";")
                if len(p) >= 3 and p[0].isdigit():
                    _MUN[p[0]] = {"ibge": p[0], "nome": p[1], "uf": p[2], "n": norm(p[1])}
    return _MUN


_IDX = {}
_RXCONT = {}


def _idx_uf(uf):
    if uf not in _IDX:
        _IDX[uf] = {m["n"]: m["ibge"] for m in municipios().values() if (uf is None or m["uf"] == uf)}
    return _IDX[uf]


def _rx_contido(uf):
    if uf not in _RXCONT:
        nomes = sorted((k for k in _idx_uf(uf) if len(k) >= 4), key=len, reverse=True)
        _RXCONT[uf] = re.compile(r"(?:^| )(?:de|do|da|dos|das) (%s)(?= |$)" % "|".join(re.escape(k) for k in nomes))
    return _RXCONT[uf]


@functools.lru_cache(maxsize=20000)
def resolve_nome(nome, uf=None, fuzzy=0.88):
    """nome livre -> ibge (ou None). Tenta exato, alias e difflib dentro da UF."""
    n = norm(nome)
    n = re.sub(r"\b(sp|mg|rj|es)$", "", n).strip()
    n = ALIASES.get(n, n)
    idx = _idx_uf(uf)
    if n in idx:
        return idx[n]
    n2 = n.replace(" d ", " d ").replace("dagua", "d agua")
    if n2 in idx:
        return idx[n2]
    c = difflib.get_close_matches(n, list(idx), n=1, cutoff=fuzzy)
    return idx[c[0]] if c else None


PREFIXOS_ENT = r"^(prefeitura municipal|prefeitura|camara municipal|camara|municipio|poder legislativo|poder executivo)( (de|do|da|dos|das))?\s+"


def resolve_entidade(nome_ent, uf):
    """Nome de entidade (Prefeitura/Camara/SAAE/Instituto de X) -> ibge."""
    n = norm(nome_ent)
    if re.match(r"(associac|consorci|agencia|federac|amaje|amnor|aris\b|arismig|acispes|cimi|cis\b|cisa|codevasf|tribunal|assembleia)", n):
        return None
    m = re.sub(PREFIXOS_ENT, "", n).strip()
    if m != n:
        m = re.split(r"\s+(estado de|mg|rj|sp|es)\b", m)[0].strip()
        r = resolve_nome(m, uf)
        if r:
            return r
    # procura nome de municipio contido (palavra inteira), so se unico entre os mais longos
    idx = _idx_uf(uf)
    achados = list(set(m.group(1) for m in _rx_contido(uf).finditer(n)))
    if achados:
        achados.sort(key=len, reverse=True)
        top = [a for a in achados if not any(a != b and a in b for b in achados)]
        if len(top) == 1:
            return idx[top[0]]
    return None


def resolve_municipio_arg(arg, uf=None):
    """'3118601' ou 'Contagem' ou 'Contagem/MG' -> lista de ibge."""
    arg = arg.strip()
    if arg.isdigit():
        return [arg] if arg in municipios() else []
    m = re.match(r"(.+?)\s*[/-]\s*(SP|MG|RJ|ES)$", arg, re.I)
    if m:
        arg, uf = m.group(1), m.group(2).upper()
    n = ALIASES.get(norm(arg), norm(arg))
    exatos = [x["ibge"] for x in municipios().values() if x["n"] == n and (uf is None or x["uf"] == uf)]
    if exatos:
        return exatos
    r = resolve_nome(arg, uf)
    return [r] if r else []


# --------------------------------------------------------------------------------------
# Pontuacao de relevancia (restricao a caminhoes x ruido de compras/contratos)
_VEIC = re.compile(r"caminh(ao|oes)|veiculos? (de carga|pesados?|de grande porte|automotores de carga|com peso|de transporte de carga)|carretas?\b|bitre(m|ns)|treminh|cavalos? mecanico|peso bruto|\bpbt\b|\bvuc\b|veiculos? urbanos? de carga|trafego pesado|combinac\w* de veiculos de carga|\bcvc\b|\d (ou mais )?eixos")
_CD = re.compile(r"carga e descarga|carga descarga|operac\w* de carga")
_ACAO = re.compile(r"circul\w*|trafeg\w*|transit\w*|acesso|ingresso|entrada|estaciona\w*|parada|carga e descarga")
_RESTR = re.compile(r"proib|restri|vedad|\bveda\b|nao (sera|e) permitid|somente (sera|e) permitid|apenas (sera|e) permitid|horario|maxima restricao|\bzmrc\b|\bzerc\b|perimetro urbano|area central|centro da cidade|disciplin|regulament|ordenamento|\brota|desvio|limita|toneladas|eixos|sinalizac")
_ATO = re.compile(r"(^|\b)(decreto|lei complementar|lei ordinaria|lei|portaria|resolucao|instrucao normativa|deliberacao)\b( municipal)?( n| no| n o|\s*\d|\s*$)")
_RUIDO_T = re.compile(r"locac|aquisic|pregao|licitac|registro de preco|contratac|extrato|homologac|adjudicac|ata de registro|dispensa|inexigib|credenciamento|leilao|cotacao|aviso de|edital|chamamento|tomada de preco|concorrencia|termo aditivo|aditivo|contrato|ratificac|resultado|julgamento|errata|retificac|empenho|ordem de servico|ordem de fornecimento|convite|ata de|intimacao|notificacao|rescisao|apostilamento|orcamentari|plano plurianual|\bloa\b|\bldo\b|\bppa\b|credito (adicional|suplementar|especial)")
_RUIDO_C = re.compile(r"locacao de|aquisicao de|fornecimento de|prestacao de servicos|manutencao (preventiva|corretiva|de)|pecas|pneus|combustive|lubrificant|seguro|transporte escolar|coleta de (lixo|residuos)|registro de precos|valor (global|total|estimado)|\br \d{1,3}( \d{3})* \d\d\b|\bqtde?\b|\bvlr\b|valor unit|cnpj|contratad[ao]|licitante|pregao|motorista|frete|aluguel|guincho|munck|basculante|caminhao pipa|carro pipa|compactador|dotacao|elemento de despesa|ficha")
_RUIDO_TEMA = re.compile(r"covid|pandemia|coronavirus|toque de recolher|isolamento social|veiculos oficiais|frota (municipal|oficial)|uso (dos|de) veiculos|acidente de transito|transito em julgado|circulacao de mercadorias|circulacao de pessoas")
_FORTES = [
    (re.compile(r"(circulacao|trafego|transito) (de|dos) (caminh|veiculos (de carga|pesados|de grande porte)|carretas)"), 3, "frase circulação/tráfego de caminhões", False),
    (re.compile(r"maxima restricao|\bzmrc\b"), 4, "ZMRC", False),
    (re.compile(r"restric\w* (de|a|da) (circulacao|trafego|transito)"), 3, "restrição de circulação", True),
    (re.compile(r"(proibid[ao]|vedad[ao]|proibe|proibicao|veda)\b.{0,50}?\b(circul\w*|trafeg\w*|transit\w*|estacionamento|acesso|ingresso|entrada)"), 3, "proibição de circulação", True),
    (re.compile(r"carga e descarga.{0,120}?(horario|\b\d{1,2} ?h\b|\b\d{1,2} \d\d\b)|(horario|\b\d{1,2} ?h\b).{0,120}?carga e descarga"), 3, "horário de carga e descarga", False),
    (re.compile(r"(dispoe|disciplina|regulamenta|estabelece|institui|regula)\w*\b.{0,70}?\b(circulacao|trafego|transito|estacionamento|carga e descarga)"), 2, "ementa de regulamentação", True),
    (re.compile(r"(\d+[,.]?\d*) ?(t|ton|toneladas)\b"), 1, "limite em toneladas", True),
]


def pontua(titulo, trecho):
    t = norm(titulo)
    c = norm(trecho)
    tc = (t + " | " + c)
    sc, mot = 0, []
    veic = bool(_VEIC.search(tc))
    cd = bool(_CD.search(tc))
    alvo = veic or cd
    acao = bool(_ACAO.search(tc))
    restr = bool(_RESTR.search(tc))
    if veic:
        sc += 2; mot.append("veículo pesado/carga")
    elif cd:
        sc += 2; mot.append("carga e descarga")
    if acao:
        sc += 1; mot.append("circulação/acesso")
    if alvo and acao and restr:
        sc += 2; mot.append("restrição")
    for rx, pts, nome, exige_alvo in _FORTES:
        if (alvo or not exige_alvo) and rx.search(tc):
            sc += pts; mot.append(nome)
    if _ATO.search(t):
        sc += 2; mot.append("título é ato normativo")
    if _RUIDO_T.search(t):
        sc -= 4; mot.append("título de licitação/contrato/orçamento")
    nr = len(_RUIDO_C.findall(c))
    if nr:
        sc -= min(4, nr); mot.append("texto de compras(%d)" % nr)
    if _RUIDO_TEMA.search(tc):
        sc -= 3; mot.append("tema alheio (covid/frota/etc.)")
    return sc, mot


LIMIAR_RELEVANTE = 6
LIMIAR_INDICIO = 4
# fontes sem titulo de materia (diario inteiro): a frase buscada sozinha ja vale ~6 -> exige mais
LIMIAR_FONTE = {"qd": 8, "dosp": 8}


def limiar(fonte):
    return LIMIAR_FONTE.get(fonte, LIMIAR_RELEVANTE)


# --------------------------------------------------------------------------------------
# Fonte: SIGPub (diariomunicipal.com.br/<slug>) - amm-mg, aemerj, apm
class SIGPub(object):
    tipo = "sigpub"
    BASE = "https://www.diariomunicipal.com.br/"

    def __init__(self, slug, uf, descricao):
        self.nome = slug
        self.slug = slug
        self.uf = uf
        self.descricao = descricao
        self.url = self.BASE + slug + "/"
        self._ent = None

    def entidades(self, atualizar=False):
        cache = os.path.join(RAW, "sigpub_%s_entidades.json" % self.slug)
        if self._ent is not None and not atualizar:
            return self._ent
        if os.path.exists(cache) and not atualizar:
            self._ent = json.load(open(cache, encoding="utf-8"))
            return self._ent
        st, b = http(self.url + "pesquisar")
        h = b.decode("utf-8", "ignore")
        s = re.search(r'<select[^>]*name="busca_avancada\[entidade\]"[^>]*>(.*?)</select>', h, re.S)
        ents = []
        if s:
            for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', s.group(1), re.S):
                if not v:
                    continue
                nome = limpa_html(t)
                ents.append({"id": v, "nome": nome, "ibge": resolve_entidade(nome, self.uf)})
        os.makedirs(RAW, exist_ok=True)
        json.dump(ents, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        self._ent = ents
        return ents

    def _ibge_ent(self, nome_ent):
        for e in self.entidades():
            if e["nome"] == nome_ent:
                return e["ibge"]
        return resolve_entidade(nome_ent, self.uf)

    def pesquisar(self, texto, pagina=1, entidade="", ordenacao="relevancia", desde="2009-01-01", ate=None):
        params = [("busca_avancada[texto]", texto), ("busca_avancada[titulo]", ""),
                  ("busca_avancada[entidade]", entidade), ("busca_avancada[orgao]", ""),
                  ("busca_avancada[dataInicio]", desde), ("busca_avancada[dataFim]", ate or HOJE),
                  ("busca_avancada[ordenacao]", ordenacao), ("busca_avancada[pagina]", str(pagina))]
        st, b = http(self.url + "pesquisar", params=params, timeout=120)
        h = b.decode("utf-8", "ignore")
        if st != 200:
            raise IOError("SIGPub %s status %s" % (self.slug, st))
        m = re.search(r'busca-avancada__resumo">(.*?)</p>', h, re.S)
        total = 0
        if m:
            nums = re.findall(r"<strong>([\d.]+)</strong>", m.group(1))
            if len(nums) >= 3:
                total = int(nums[2].replace(".", ""))
        elif "lista-materias" not in h:
            if re.search(r"Nenhum[a]? (mat[ée]ria|resultado)", h):
                return [], 0
        hits = []
        for bloco in h.split('<li class="materia-card">')[1:]:
            bloco = bloco.split("</li>")[0] if "</li>" in bloco else bloco
            a = re.search(r'materia-card__titulo">\s*<a href="([^"]+)"[^>]*>(.*?)</a>', bloco, re.S)
            if not a:
                continue
            href, titulo = a.group(1), limpa_html(a.group(2))
            ent = re.search(r'materia-card__entidade">(.*?)</span>', bloco, re.S)
            org = re.search(r'materia-card__orgao">(.*?)</span>', bloco, re.S)
            tre = re.search(r'materia-card__trecho">(.*?)</p>', bloco, re.S)
            dd = dict((limpa_html(k), limpa_html(v)) for k, v in re.findall(r"<dt>(.*?)</dt>\s*<dd>(.*?)</dd>", bloco, re.S))
            data = dd.get("Circulação", "")
            md = re.match(r"(\d\d)/(\d\d)/(\d{4})", data)
            data = "%s-%s-%s" % (md.group(3), md.group(2), md.group(1)) if md else data
            cod = dd.get("Código identificador", href.rstrip("/").split("/")[-1])
            ent_n = limpa_html(ent.group(1)) if ent else ""
            hits.append({
                "fonte": self.nome, "id": "%s:%s" % (self.nome, cod), "ibge": self._ibge_ent(ent_n),
                "entidade": ent_n, "orgao": limpa_html(org.group(1)) if org else "",
                "titulo": titulo, "trecho": limpa_html(tre.group(1)) if tre else "", "data": data,
                "edicao": dd.get("Edição", ""),
                "url": urllib.parse.urljoin(self.BASE, href),
                "url_pdf": urllib.parse.urljoin(self.BASE, "/%s/download/edicao/%s" % (self.slug, cod)),
            })
        return hits, total

    # varredura global: pagina 1..N
    def varrer_termo(self, termo, pagina):
        q = termo.get("sigpub")
        if not q:
            return None
        hits, total = self.pesquisar(q, pagina=pagina)
        npag = min((total + 24) // 25, 400, MAX_PAG["sigpub"])
        return hits, total, pagina < npag

    def buscar_municipio(self, ibge, termo_txt, max_pag=4):
        ents = [e for e in self.entidades() if e["ibge"] == ibge]
        q = re.sub(r"\b(de|da|do|das|dos|a|à|e|o)\b", " ", termo_txt).replace('"', " ")
        q = re.sub(r"\s+", " ", q).strip()
        out = []
        if ents:
            for e in ents:
                for p in range(1, max_pag + 1):
                    hits, total = self.pesquisar(q, pagina=p, entidade=e["id"], ordenacao="relevancia")
                    out += hits
                    if p * 25 >= total:
                        break
        else:  # entidade nao listada (historica): diario inteiro filtrando
            for p in range(1, max_pag * 3 + 1):
                hits, total = self.pesquisar(q, pagina=p)
                out += [x for x in hits if x["ibge"] == ibge]
                if p * 25 >= total:
                    break
        return out

    def cobertura(self, atualizar=False):
        ents = self.entidades(atualizar=atualizar)
        cob = {}
        for e in ents:
            if e["ibge"]:
                cob.setdefault(e["ibge"], []).append(e["nome"])
        sem = [e["nome"] for e in ents if not e["ibge"]]
        return {"municipios": {k: {"entidades": v} for k, v in sorted(cob.items())},
                "entidades_sem_municipio": sem, "n_entidades": len(ents)}


# --------------------------------------------------------------------------------------
# Fonte: DOM-ES (AMUNES) no DIO-ES (IONEWS/Elasticsearch)
class DOMES(object):
    tipo = "domes"
    nome = "domes"
    uf = "ES"
    BASE = "https://ioes.dio.es.gov.br"
    descricao = ("DOM/ES - Diário Oficial dos Municípios do ES (AMUNES), hospedado no DIO-ES desde 2021. "
                 "Busca Elasticsearch por PÁGINA de edição (campo conteudo); município atribuído pelo texto "
                 "(cabeçalho após 'Protocolo NNN', 'Município de X', 'X/ES'). Acervo 2014-2021 "
                 "(diariomunicipal.es.gov.br) fora do ar em 10/10/2026 (404).")

    def __init__(self):
        self._rx = None

    def _rx_mun(self):
        if self._rx is None:
            es = [m for m in municipios().values() if m["uf"] == "ES"]
            nomes = sorted(set(m["nome"] for m in es), key=len, reverse=True)
            alt = "|".join(re.escape(n) for n in nomes)
            self._nomes = nomes
            # cabeçalho: logo apos "Protocolo 1234567 "
            self._rx = {
                "hdr": re.compile(r"Protocolo\s+\d{5,9}\s+(%s)\b" % alt, re.I),
                "ref": re.compile(r"(?:Prefeitura Municipal|Prefeito Municipal|C[âa]mara Municipal|Munic[íi]pio|Prefeitura)\s+(?:de|do|da)\s+(%s)\b|\b(%s)\s*(?:/|-|,|–)\s*ES\b" % (alt, alt), re.I),
            }
        return self._rx

    def _ibge_nome(self, nome):
        return resolve_nome(nome, "ES", fuzzy=0.95)

    def atribui(self, conteudo, pos):
        """Atribui municipio a uma ocorrencia na posicao pos da pagina."""
        rx = self._rx_mun()
        prots = [m.start() for m in re.finditer(r"Protocolo\s+\d{5,9}", conteudo)]
        ini = max([p for p in prots if p < pos] or [0])
        fim = min([p for p in prots if p > pos] or [len(conteudo)])
        seg_fim = conteudo[ini:fim + 30]
        if ini > 0:
            mh = rx["hdr"].match(conteudo, ini)
            if mh:
                return self._ibge_nome(mh.group(1)), "cabecalho"
        cont = {}
        for m in rx["ref"].finditer(seg_fim):
            n = m.group(1) or m.group(2)
            cont[n] = cont.get(n, 0) + 1
        if cont:
            best = sorted(cont.items(), key=lambda kv: -kv[1])
            if len(best) == 1 or best[0][1] > best[1][1]:
                return self._ibge_nome(best[0][0]), "segmento"
        # pagina inteira: referencia mais proxima antes de pos
        refs = [(m.start(), m.group(1) or m.group(2)) for m in rx["ref"].finditer(conteudo)]
        refs += [(m.start(), m.group(1)) for m in rx["hdr"].finditer(conteudo)]
        if refs:
            antes = [r for r in refs if r[0] <= pos]
            r = max(antes) if antes else min(refs)
            return self._ibge_nome(r[1]), "pagina(incerta)"
        return None, "nao_atribuido"

    def pesquisar(self, frase, pagina=0, di=None, df=None):
        path = "/busca/busca/buscar/query/%d" % pagina
        if di:
            path += "/di:" + di
        if df:
            path += "/df:" + df
        q = '"%s"' % frase.replace('"', "")
        url = self.BASE + path + "/?1=1&q=" + urllib.parse.quote(q) + "&subtheme=dom"
        d = http_json(url, timeout=90)
        if not d or "hits" not in d:
            raise IOError("DOM-ES sem resposta valida")
        total = d["hits"]["total"]
        total = total.get("value", 0) if isinstance(total, dict) else total
        hits = []
        rxt = re.compile(r"\W+".join(re.escape(w) for w in frase.split()), re.I)
        for h in d["hits"]["hits"]:
            s = h.get("_source") or h.get("fields") or {}
            cont = s.get("conteudo", "") or ""
            posicoes = [m.start() for m in rxt.finditer(cont)]
            if not posicoes:
                posicoes = [0]
            ed_id = s.get("diario_id") or s.get("edicao_id")
            pag = s.get("pagina")
            data = s.get("data") or "%s-%s-%s" % (s.get("year"), s.get("month"), s.get("day"))
            vistos = set()
            for p in posicoes:
                ibge, metodo = self.atribui(cont, p)
                chave = (ibge, metodo)
                if chave in vistos:
                    continue
                vistos.add(chave)
                tre = cont[max(0, p - 350):p + 450]
                # titulo aproximado: inicio do segmento da materia
                prots = [m.end() for m in re.finditer(r"Protocolo\s+\d{5,9}", cont) if m.end() <= p]
                ini = prots[-1] if prots else 0
                tit = cont[ini:ini + 160]
                hits.append({
                    "fonte": self.nome, "id": "domes:%s:%s" % (h.get("_id"), ibge), "ibge": ibge,
                    "atribuicao": metodo, "entidade": "", "orgao": "",
                    "titulo": re.sub(r"\s+", " ", tit).strip(), "trecho": re.sub(r"\s+", " ", tre).strip(),
                    "data": data, "edicao": "%s pág. %s" % (h.get("suplemento", ""), pag),
                    "url": "%s/dom/portal/edicoes/download/%s/%s" % (self.BASE, ed_id, pag),
                    "url_pdf": "%s/dom/portal/edicoes/download/%s" % (self.BASE, ed_id),
                })
        return hits, total

    def _texto_pagina(self, ed_id, pag):
        cache = os.path.join(RAW, "domes_paginas")
        os.makedirs(cache, exist_ok=True)
        arq = os.path.join(cache, "%s_%s.txt" % (ed_id, pag))
        if os.path.exists(arq):
            return open(arq, encoding="utf-8").read()
        st, b = http("%s/dom/portal/edicoes/download/%s/%s" % (self.BASE, ed_id, pag), timeout=180)
        if st != 200 or not b.startswith(b"%PDF") or not shutil_which("pdftotext"):
            return ""
        fd, tmp = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            open(tmp, "wb").write(b)
            txt = subprocess.run([shutil_which("pdftotext"), tmp, "-"], capture_output=True, timeout=600).stdout.decode("utf-8", "ignore")
        finally:
            os.remove(tmp)
        txt = re.sub(r"\s+", " ", txt)
        open(arq, "w", encoding="utf-8").write(txt)
        return txt

    def reatribuir(self, hit, max_volta=3):
        """Para hit sem municipio certo: le paginas anteriores (PDF de 1 pagina) e pega a ultima materia
        aberta antes da pagina do hit (cabecalho 'Protocolo NNN <Municipio>' ou referencias)."""
        m = re.search(r"/download/(\d+)/(\d+)$", hit.get("url", ""))
        if not m:
            return None, "sem_url"
        if not re.match(r"\s*(\d+\s+)?DOM/ES\s*-\s*Edi", hit.get("titulo", "")):
            # a materia do hit comeca na propria pagina (apos um 'Protocolo') sem cabecalho de municipio
            return None, "materia_sem_cabecalho_municipal"
        ed, pag = int(m.group(1)), int(m.group(2))
        rx = self._rx_mun()
        for k in range(1, max_volta + 1):
            if pag - k < 1:
                break
            txt = self._texto_pagina(ed, pag - k)
            if not txt:
                continue
            hdrs = list(rx["hdr"].finditer(txt))
            prots = [mm.start() for mm in re.finditer(r"Protocolo\s+\d{5,9}", txt)]
            if prots:
                ult = prots[-1]
                mh = rx["hdr"].match(txt, ult)
                if mh:
                    return self._ibge_nome(mh.group(1)), "cabecalho(pág.-%d)" % k
                seg = txt[ult:]
            else:
                seg = txt
            cont = {}
            for mm in rx["ref"].finditer(seg):
                n = mm.group(1) or mm.group(2)
                cont[n] = cont.get(n, 0) + 1
            if cont:
                best = sorted(cont.items(), key=lambda kv: -kv[1])
                if len(best) == 1 or best[0][1] > best[1][1]:
                    return self._ibge_nome(best[0][0]), "segmento(pág.-%d)" % k
            if prots:
                break
        return None, "nao_atribuido"

    def varrer_termo(self, termo, pagina):
        f = termo.get("frase")
        if not f:
            return None
        hits, total = self.pesquisar(f, pagina=pagina - 1)
        npag = min((total + 9) // 10, MAX_PAG["domes"])
        return hits, total, pagina < npag

    def buscar_municipio(self, ibge, termo_txt, max_pag=8):
        out = []
        for p in range(max_pag):
            hits, total = self.pesquisar(termo_txt.replace('"', ""), pagina=p)
            out += [x for x in hits if x["ibge"] == ibge]
            if (p + 1) * 10 >= total:
                break
        return out

    def cobertura(self, atualizar=False):
        cob = {}
        for m in sorted((x for x in municipios().values() if x["uf"] == "ES"), key=lambda x: x["nome"]):
            n_pm = n_cm = 0
            for rot in ("Prefeitura Municipal de %s", "Câmara Municipal de %s"):
                url = self.BASE + "/busca/busca/buscar/query/0/?1=1&q=" + urllib.parse.quote('"%s"' % (rot % m["nome"])) + "&subtheme=dom"
                d = http_json(url, timeout=90) or {}
                t = (d.get("hits") or {}).get("total", 0)
                t = t.get("value", 0) if isinstance(t, dict) else t
                if rot.startswith("Pref"):
                    n_pm = t
                else:
                    n_cm = t
            if n_pm + n_cm > 0:
                cob[m["ibge"]] = {"paginas_prefeitura": n_pm, "paginas_camara": n_cm,
                                  "provavel_publicador": (n_pm + n_cm) >= 20}
            log("  cobertura domes %s: PM=%s CM=%s" % (m["nome"], n_pm, n_cm))
        return {"municipios": cob}


# --------------------------------------------------------------------------------------
# Fonte: DOE-SP caderno Municipios
class DOESP(object):
    tipo = "doesp"
    nome = "doesp"
    uf = "SP"
    API = "https://do-api-web-search.doe.sp.gov.br/v2/"
    JOURNAL = "d65936d7-1ca8-4267-934e-1dea132fa237"  # "Municípios"
    PAI = "b3477daf-479d-4f3d-7d60-08db6b94d2bf"  # "Atos Municipais" / "Diário dos Municípios"
    descricao = ("DOE-SP (doe.sp.gov.br), caderno 'Municípios' > 'Diário dos Municípios' > <cidade>: municípios "
                 "paulistas que publicam no Diário Oficial do Estado. API pública v2/advanced-search; frase exata; "
                 "acervo do novo DOE desde 29/05/2023.")

    def secoes(self, atualizar=False):
        cache = os.path.join(RAW, "doesp_secoes.json")
        if os.path.exists(cache) and not atualizar:
            return json.load(open(cache, encoding="utf-8"))
        d = http_json(self.API + "sections", params={"JournalId": self.JOURNAL, "ParentId": self.PAI}) or {}
        out = []
        for it in d.get("items", []):
            out.append({"id": it["id"], "nome": it["name"], "ibge": resolve_nome(it["name"], "SP")})
        os.makedirs(RAW, exist_ok=True)
        json.dump(out, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return out

    def pesquisar(self, frase, pagina=1, secao=None, desde="2000-01-01", ate=None, tamanho=100):
        p = [("JournalId", self.JOURNAL), ("FromDate", desde), ("ToDate", ate or HOJE),
             ("PageNumber", pagina), ("PageSize", tamanho), ("SortField", "Date")]
        if frase:
            p.append(("Terms[0]", frase))
        if secao:
            p.append(("SectionId", secao))
        d = http_json(self.API + "advanced-search/publications", params=p, timeout=90)
        if d is None or "items" not in d:
            raise IOError("DOE-SP sem resposta valida")
        hits = []
        for it in d["items"]:
            hier = (it.get("hierarchy") or "").split(" > ")
            mun = hier[2] if len(hier) > 2 else ""
            slug = it.get("slug") or ""
            url = slug if slug.startswith("http") else ("https://doe.sp.gov.br/" + slug.lstrip("/") if slug else "https://doe.sp.gov.br/publicacao/" + it["id"])
            hits.append({
                "fonte": self.nome, "id": "doesp:%s" % it["id"], "ibge": resolve_nome(mun, "SP") if mun else None,
                "entidade": hier[3] if len(hier) > 3 else mun, "orgao": " > ".join(hier[4:]),
                "titulo": it.get("title", ""), "trecho": limpa_html(it.get("excerpt", "")),
                "data": (it.get("date") or "")[:10], "edicao": "legado" if it.get("isLegacy") else "",
                "url": url, "url_pdf": "",
            })
        return hits, d.get("totalItems", 0)

    def varrer_termo(self, termo, pagina):
        f = termo.get("frase")
        if not f:
            return None
        hits, total = self.pesquisar(f, pagina=pagina)
        npag = min((total + 99) // 100, MAX_PAG["doesp"])
        return hits, total, pagina < npag

    def _secao_ibge(self, ibge):
        for s in self.secoes():
            if s["ibge"] == ibge:
                return s["id"]
        return None

    def buscar_municipio(self, ibge, termo_txt, max_pag=3):
        sec = self._secao_ibge(ibge)
        if not sec:
            return []
        out = []
        for p in range(1, max_pag + 1):
            hits, total = self.pesquisar(termo_txt.replace('"', ""), pagina=p, secao=sec)
            out += hits
            if p * 100 >= total:
                break
        return out

    def cobertura(self, atualizar=False):
        cob = {}
        for s in self.secoes(atualizar=atualizar):
            if not s["ibge"]:
                continue
            try:
                hits, total = self.pesquisar("", pagina=1, secao=s["id"], tamanho=1)
            except Exception:
                total = -1
                hits = []
            if total:
                cob[s["ibge"]] = {"publicacoes": total, "secao": s["id"],
                                  "primeira": hits[0]["data"] if hits else ""}
        return {"municipios": cob, "n_secoes": len(self.secoes())}


# --------------------------------------------------------------------------------------
# Fonte: DOSP / DiOE (imprensaoficialmunicipal.com.br/<slug>) - busca por cidade, devolve edicoes
class DOSP(object):
    tipo = "dosp"
    nome = "dosp"
    uf = None
    BASE = "https://www.imprensaoficialmunicipal.com.br/"
    descricao = ("DiOE/DOSP (P&P Colibri) - www.imprensaoficialmunicipal.com.br/<cidade> (redireciona de dosp.com.br): "
                 "plataforma comum de diário eletrônico de dezenas de municípios (sobretudo SP). Sem busca entre "
                 "cidades: busca por cidade (POST pesquisar.php?c=<slug>, termo na íntegra da edição), devolve só "
                 "as edições (máx. 100, sem trecho). Trecho extraído do PDF da edição (pdftotext) quando --pdf.")

    def slugs(self, atualizar=False, ufs=("SP",)):
        cache = os.path.join(RAW, "dosp_slugs.json")
        res = {}
        if os.path.exists(cache):
            res = json.load(open(cache, encoding="utf-8"))
        if not atualizar:
            return res
        alvo = [m for m in municipios().values() if m["uf"] in ufs]
        for i, m in enumerate(sorted(alvo, key=lambda x: x["ibge"])):
            if m["ibge"] in res:
                continue
            base = norm(m["nome"])
            cands = []
            for c in (base.replace(" ", "_"), base.replace(" ", ""), base.replace(" ", "-")):
                if c not in cands:
                    cands.append(c)
            achou = None
            for c in cands:
                st, b = http(self.BASE + c, seguir=False, timeout=40, aceitar=(200, 301, 302))
                if st == 200:
                    achou = c
                    break
            res[m["ibge"]] = achou
            if achou:
                log("  dosp: %s -> %s" % (m["nome"], achou))
            if i % 25 == 0:
                json.dump(res, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        json.dump(res, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        return res

    def pesquisar(self, slug, termo, desde="", ate=""):
        dados = [("termo", termo), ("secao", ""), ("subsecao", ""), ("datai", desde), ("dataf", ate),
                 ("btnSubmitsrc", "Pesquisar")]
        st, b = http(self.BASE + "pesquisar.php?c=" + slug, data=dados, timeout=120)
        h = b.decode("utf-8", "ignore")
        m = re.search(r"var dioe = (\[.*?\]|\{.*?\});", h, re.S)
        if not m:
            if "var dioe = null" in h or "var dioe=null" in h or "Nenhum resultado" in h:
                return []
            raise IOError("DOSP sem lista de resultados (%s)" % slug)
        try:
            r = json.loads(m.group(1))
        except Exception:
            return []
        return r if isinstance(r, list) else []

    def trecho_pdf(self, url, frase):
        if not shutil_which("pdftotext"):
            return ""
        st, b = http(url, timeout=180)
        if st != 200 or not b.startswith(b"%PDF"):
            return ""
        fd, tmp = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            open(tmp, "wb").write(b)
            txt = subprocess.run([shutil_which("pdftotext"), "-layout", tmp, "-"], capture_output=True, timeout=600).stdout.decode("utf-8", "ignore")
        finally:
            os.remove(tmp)
        txt = re.sub(r"\s+", " ", txt)
        rx = re.compile(r"\W+".join(re.escape(w) for w in frase.split()), re.I)
        ms = list(rx.finditer(txt))
        if not ms:
            return ""
        return " [...] ".join(txt[max(0, mm.start() - 300):mm.end() + 400] for mm in ms[:3])

    def hits_de(self, ibge, slug, termo_txt, pdf=False):
        eds = self.pesquisar(slug, termo_txt)
        out = []
        for e in eds:
            j = base64.b64encode(str(e["iddo"]).encode()).decode()
            url = "https://www.dosp.com.br/exibe_do.php?i=%s" % j
            out.append({
                "fonte": self.nome, "id": "dosp:%s" % e["iddo"], "ibge": ibge, "entidade": slug, "orgao": "",
                "titulo": "Edição nº %s%s" % (e.get("edicao_do"), " (extra)" if e.get("flag_extra") == 1 else ""),
                "trecho": self.trecho_pdf(url, termo_txt) if pdf else "", "data": (e.get("data") or "")[:10],
                "edicao": str(e.get("edicao_do")), "url": url, "url_pdf": url,
            })
        return out

    def buscar_municipio(self, ibge, termo_txt, max_pag=1, pdf=True, max_pdf=8):
        """Edicoes com o termo; trecho do PDF (pdftotext) nas max_pdf edicoes mais recentes."""
        slug = self.slugs().get(ibge)
        if not slug:
            return []
        frase = termo_txt.replace('"', "")
        hits = self.hits_de(ibge, slug, frase, pdf=False)
        if pdf:
            for h in sorted(hits, key=lambda x: x["data"], reverse=True)[:max_pdf]:
                h["trecho"] = self.trecho_pdf(h["url"], frase)
        return hits

    def cobertura(self, atualizar=False, ufs=None):
        s = self.slugs(atualizar=atualizar, ufs=tuple(ufs or ("SP",)))
        return {"municipios": {k: {"slug": v, "url": self.BASE + v} for k, v in sorted(s.items()) if v},
                "testados": len(s)}


def shutil_which(x):
    for p in os.environ.get("PATH", "").split(os.pathsep) + ["/opt/homebrew/bin", "/usr/local/bin"]:
        f = os.path.join(p, x)
        if os.path.isfile(f) and os.access(f, os.X_OK):
            return f
    return None


# --------------------------------------------------------------------------------------
# Fonte: Querido Diario (agregador de diarios municipais)
class QD(object):
    tipo = "qd"
    nome = "qd"
    uf = None
    API = "https://api.queridodiario.org.br/gazettes"
    descricao = ("Querido Diário (Open Knowledge Brasil): agregador com busca full-text (OpenSearch) nos diários "
                 "das cidades com spider. Filtro territory_ids (vários por pedido); trechos (excerpts) na resposta. "
                 "Lento (30-90 s por pedido) e instável: retentativas longas.")

    def territorios(self):
        try:
            d = json.load(open(QD_CITIES, encoding="utf-8"))
        except Exception:
            return {}
        return {c["territory_id"]: c for c in d.get("cities", []) if c.get("state_code") in ("SP", "MG", "RJ", "ES")}

    def pesquisar(self, frase, ids, offset=0, size=100):
        p = [("territory_ids", i) for i in ids]
        p += [("querystring", '"%s"' % frase.replace('"', "")), ("offset", offset), ("size", size),
              ("excerpt_size", 500), ("number_of_excerpts", 3), ("sort_by", "descending_date")]
        d = http_json(self.API, params=p, timeout=180, headers=["Accept: application/json"], tentativas=6)
        if not d or "gazettes" not in d:
            raise IOError("QD sem resposta valida")
        hits = []
        for g in d["gazettes"]:
            ex = [re.sub(r"\s+", " ", e) for e in g.get("excerpts", [])]
            hits.append({
                "fonte": self.nome, "id": "qd:%s:%s:%s" % (g.get("territory_id"), g.get("date"), (g.get("url") or "")[-16:]),
                "ibge": g.get("territory_id"), "entidade": g.get("territory_name", ""), "orgao": "",
                "titulo": "Diário %s ed. %s%s" % (g.get("date"), g.get("edition") or "?", " (extra)" if g.get("is_extra_edition") else ""),
                "trecho": " [...] ".join(ex), "data": g.get("date", ""), "edicao": g.get("edition") or "",
                "url": g.get("url", ""), "url_pdf": g.get("url", ""), "url_txt": g.get("txt_url", ""),
            })
        return hits, d.get("total_gazettes", 0)

    TAM = 10  # a API devolve 520 (timeout do proxy) com size>=50 e muitos territorios

    def varrer_termo(self, termo, pagina):
        f = termo.get("frase")
        if not f:
            return None
        ids = sorted(self.territorios())
        hits, total = self.pesquisar(f, ids, offset=(pagina - 1) * self.TAM, size=self.TAM)
        teto = MAX_PAG["qd_amplo"] if termo.get("amplo") else MAX_PAG["qd"]
        npag = min((total + self.TAM - 1) // self.TAM, teto)
        return hits, total, pagina < npag

    def buscar_municipio(self, ibge, termo_txt, max_pag=2):
        if ibge not in self.territorios():
            return []
        out = []
        for p in range(max_pag * 3):
            hits, total = self.pesquisar(termo_txt, [ibge], offset=p * 30, size=30)
            out += hits
            if (p + 1) * 30 >= total:
                break
        return out

    def cobertura(self, atualizar=False):
        t = self.territorios()
        return {"municipios": {k: {"nivel": v.get("level"), "desde": v.get("availability_date"),
                                   "fonte_original": (v.get("publication_urls") or [""])[0]} for k, v in sorted(t.items())}}


# --------------------------------------------------------------------------------------
FONTES = {
    "amm-mg": SIGPub("amm-mg", "MG", "Diário Oficial dos Municípios Mineiros (AMM) - SIGPub/Vox. Busca por MATÉRIA (título, entidade, trecho, data, edição, código), diário inteiro ou por entidade, desde 2009."),
    "aemerj": SIGPub("aemerj", "RJ", "Diário Oficial dos Municípios do RJ (AEMERJ) - SIGPub/Vox; mesma busca do AMM. Poucos municípios aderentes."),
    "apm": SIGPub("apm", "SP", "Diário Oficial dos Municípios (APM - Associação Paulista de Municípios) - SIGPub/Vox; mesma busca do AMM. Poucos municípios aderentes."),
    "domes": DOMES(),
    "doesp": DOESP(),
    "dosp": DOSP(),
    "qd": QD(),
}
URLS = {
    "amm-mg": "https://www.diariomunicipal.com.br/amm-mg/pesquisar",
    "aemerj": "https://www.diariomunicipal.com.br/aemerj/pesquisar",
    "apm": "https://www.diariomunicipal.com.br/apm/pesquisar",
    "domes": "https://ioes.dio.es.gov.br/dom (API: /busca/busca/buscar/query/<pag>/?q=\"frase\"&subtheme=dom)",
    "doesp": "https://doe.sp.gov.br/busca-avancada (API: https://do-api-web-search.doe.sp.gov.br/v2/advanced-search/publications)",
    "dosp": "https://www.imprensaoficialmunicipal.com.br/<slug> (POST /pesquisar.php?c=<slug>)",
    "qd": "https://api.queridodiario.org.br/gazettes",
}
PERIODOS = {
    "amm-mg": "2009-hoje", "aemerj": "2009-hoje (conforme adesão)", "apm": "2009-hoje (conforme adesão)",
    "domes": "2021-hoje (acervo DOM-ES 2014-2021 indisponível)", "doesp": "29/05/2023-hoje (novo DOE)",
    "dosp": "acervo da plataforma por cidade (busca devolve as 100 edições mais recentes com o termo)",
    "qd": "conforme spider de cada cidade (availability_date em qd_cities.json)",
}
LIMITACOES = {
    "amm-mg": ("Entidades no seletor de busca = municípios aderentes atuais (~504 de 853 MG); municípios que já "
               "publicaram e saíram aparecem só nos resultados. Busca E-lógico com radical, sem frase exata; "
               "varredura limitada às 1.000 matérias mais relevantes por termo (relevância do próprio SIGPub)."),
    "aemerj": "Só ~10 municípios RJ aderentes; mesma semântica do AMM.",
    "apm": "Só ~7 municípios SP aderentes; mesma semântica do AMM.",
    "domes": ("Resultado é a PÁGINA da edição (várias matérias de municípios diferentes): município atribuído por "
              "heurística (campo 'atribuicao': cabecalho > segmento > pagina(incerta); '(pág.-N)' = achado lendo a "
              "página anterior em PDF). Hits sem município ficam em sem_municipio.json. Frase exata; sem operador E. "
              "Varredura limitada a 600 páginas por termo. 'Cobre' = PM>=250 ou CM>=150 páginas citando "
              "'Prefeitura/Câmara Municipal de X' desde 2021, ou hit atribuído; cidades com diário próprio (Vitória, "
              "Vila Velha, Cariacica, Cachoeiro...) ficam de fora."),
    "doesp": ("640 municípios SP têm ao menos 1 publicação no caderno Municípios desde 05/2023, mas o volume é "
              "dominado por avisos/extratos de licitação (publicação legal obrigatória em DOE); atos normativos de "
              "trânsito aparecem pouco. Acervo legado (antes de 05/2023) não indexado neste caderno. Contagem por "
              "município em cobertura.json (campo publicacoes)."),
    "dosp": ("Sem busca entre cidades: varredura cidade a cidade (slugs descobertos por tentativa do nome; "
             "cidades com slug fora do padrão podem faltar). Sem trecho na busca: trecho vem do PDF (pdftotext) "
             "só para termos específicos e até 12 edições por cidade/termo."),
    "qd": ("Cobre só as cidades com spider (161 no Sudeste); API lenta (~25 s/pedido) e instável (520 com size>=50); "
           "varredura limitada aos 200 diários mais recentes por termo específico e 60 por termo amplo."),
}
OUTRAS_PLATAFORMAS = {
    "diariomunicipal.es.gov.br": "Acervo antigo do DOM-ES (2014-2021): em 10/10/2026 responde 404 em todos os caminhos e a cadeia TLS está incompleta; não usado.",
    "ioerj.com.br (DOERJ)": "Portal da Imprensa Oficial do RJ sem busca pública simples por script; não avaliado a fundo (municípios RJ grandes têm diário próprio).",
    "doem.org.br (DOEM)": "Responde com página de detecção de robô (ibdm.org.br/challenge); não usado (não se contorna bot-detection).",
    "imprensaoficialmunicipal.com.br": "É o DOSP/DiOE (fonte 'dosp').",
    "diariomunicipal.com.br (outras associações)": "Plataforma SIGPub também hospeda AAM, AGM, AMA, AMM-MT, AMP, AMUPE, APRECE, FAMURS etc. — fora do Sudeste; no Sudeste só amm-mg, aemerj e apm.",
    "atende.net, Instar, SAPL, legislacaodigital, etc.": "Plataformas por cidade (sem busca entre cidades); ver ferramentas por cidade em cidades/_tools_A01 e similares.",
}
UF_FONTES = {"MG": ["amm-mg", "qd"], "RJ": ["aemerj", "qd"], "SP": ["doesp", "apm", "dosp", "qd"], "ES": ["domes", "qd"]}


# --------------------------------------------------------------------------------------
# Estado / checkpoint
def le_estado():
    if not os.path.exists(ESTADO):
        return {}
    for _ in range(5):
        try:
            return json.load(open(ESTADO, encoding="utf-8"))
        except Exception:
            time.sleep(0.5)
    raise IOError("estado.json ilegivel - nao sobrescrevo")


def grava_estado(chave, val):
    """Trava entre threads E entre processos (varios `varrer` podem rodar em paralelo, um por fonte)."""
    import fcntl
    with _lock_estado:
        with open(ESTADO + ".lock", "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                e = le_estado()
                e[chave] = val
                tmp = ESTADO + ".tmp%d" % os.getpid()
                json.dump(e, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
                os.replace(tmp, ESTADO)
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)


def anexa_hits(fonte, termo_id, hits):
    arq = os.path.join(RAW, "hits_%s.jsonl" % fonte)
    with _lock_estado:
        with open(arq, "a", encoding="utf-8") as f:
            for h in hits:
                h = dict(h)
                h["termo"] = termo_id
                f.write(json.dumps(h, ensure_ascii=False) + "\n")


def varre_fonte(nome, termos, refazer=False):
    f = FONTES[nome]
    for t in termos:
        chave = "%s|%s" % (nome, t["id"])
        st = le_estado().get(chave, {})
        if st.get("completo") and not refazer:
            continue
        pag = 1 if refazer else st.get("pagina", 0) + 1
        while True:
            try:
                r = f.varrer_termo(t, pag)
            except Exception as ex:
                log("ERRO %s pag %d: %s - pulo este termo (retome depois)" % (chave, pag, ex))
                grava_estado(chave, {"pagina": pag - 1, "total": st.get("total"), "completo": False, "erro": str(ex)[:200], "em": HOJE})
                break
            if r is None:
                grava_estado(chave, {"pagina": 0, "total": 0, "completo": True, "nao_aplicavel": True, "em": HOJE})
                break
            hits, total, mais = r
            anexa_hits(nome, t["id"], hits)
            st = {"pagina": pag, "total": total, "completo": not mais, "em": HOJE}
            grava_estado(chave, st)
            log("%s | %s | pag %d | +%d (total %s)%s" % (nome, t["id"], pag, len(hits), total, "" if mais else " FIM"))
            if not mais:
                break
            pag += 1


def varre_dosp(termos, pdf=True, refazer=False, shard=(0, 1)):
    f = FONTES["dosp"]
    slugs = {k: v for k, v in f.slugs().items() if v}
    if not slugs:
        log("dosp: sem slugs (rode `cobertura --fontes dosp` antes)")
        return
    for i, (ibge, slug) in enumerate(sorted(slugs.items())):
        if i % shard[1] != shard[0]:
            continue
        for t in termos:
            # so termos especificos: sem trecho na busca, termo amplo (carga e descarga...) so traz edicao de licitacao
            if not t.get("frase") or t["id"] not in TERMOS_PDF_DOSP:
                continue
            chave = "dosp|%s|%s" % (ibge, t["id"])
            if le_estado().get(chave, {}).get("completo") and not refazer:
                continue
            try:
                usa_pdf = pdf and t["id"] in TERMOS_PDF_DOSP
                hits = f.hits_de(ibge, slug, t["frase"], pdf=False)
                if usa_pdf and hits and len(hits) <= 12:
                    for h in hits:
                        h["trecho"] = f.trecho_pdf(h["url"], t["frase"])
                anexa_hits("dosp", t["id"], hits)
                grava_estado(chave, {"pagina": 1, "total": len(hits), "completo": True, "em": HOJE})
                if hits:
                    log("dosp | %s %s | %s | %d edições" % (ibge, slug, t["id"], len(hits)))
            except Exception as ex:
                log("ERRO dosp %s %s: %s" % (slug, t["id"], ex))


# --------------------------------------------------------------------------------------
# Consolidacao
def carrega_raw():
    hits = {}
    for arq in sorted(os.listdir(RAW)) if os.path.isdir(RAW) else []:
        if not (arq.startswith("hits_") and arq.endswith(".jsonl")):
            continue
        with open(os.path.join(RAW, arq), encoding="utf-8") as f:
            for ln in f:
                try:
                    h = json.loads(ln)
                except Exception:
                    continue
                k = h["id"]
                if k in hits:
                    ts = hits[k].setdefault("termos", [hits[k].pop("termo", None)])
                    if h.get("termo") not in ts:
                        ts.append(h.get("termo"))
                    # mesmo documento achado por outro termo: fica o trecho que pontua mais (empate: o mais longo)
                    a = (pontua(hits[k].get("titulo", ""), hits[k].get("trecho", ""))[0], len(hits[k].get("trecho", "")))
                    b = (pontua(h.get("titulo", ""), h.get("trecho", ""))[0], len(h.get("trecho", "")))
                    if b > a:
                        hits[k]["trecho"] = h["trecho"]
                else:
                    h["termos"] = [h.pop("termo", None)]
                    hits[k] = h
    try:
        trechos = json.load(open(TRECHOS_DOSP, encoding="utf-8"))
    except Exception:
        trechos = {}
    for k, tr in trechos.items():
        if k in hits and tr and not hits[k].get("trecho"):
            hits[k]["trecho"] = tr
    for h in hits.values():  # re-pontua (permite ajustar o criterio sem refazer a varredura)
        h["termos"] = sorted(set(t for t in h["termos"] if t))
        if h["fonte"] == "dosp" and not h.get("trecho"):
            # edicao inteira sem trecho (PDF nao lido): termo especifico na edicao = indicio, nunca acerto
            h["score"], h["motivos"] = (LIMIAR_INDICIO, ["termo específico na edição (sem trecho; abrir PDF)"])
            continue
        h["score"], h["motivos"] = pontua(h.get("titulo", ""), h.get("trecho", ""))
        h["score"] += min(2, len(h["termos"]) - 1)
    return hits


REATRIB = os.path.join(RAW, "domes_reatribuicao.json")


def cobertura_efetiva(fonte, c):
    """Municipios que de fato publicam na fonte. DOM-ES: a contagem de paginas que citam 'Prefeitura/Camara
    Municipal de X' tambem pega citacoes de terceiros, entao exige volume (PM>=250 ou CM>=150); os demais
    entram so se algum hit for atribuido a eles por cabecalho/segmento."""
    mm = c.get("municipios") or {}
    if fonte == "domes":
        return [ib for ib, v in mm.items() if v.get("paginas_prefeitura", 0) >= 250 or v.get("paginas_camara", 0) >= 150]
    return list(mm)


def cmd_reatribuir_domes(args):
    """Hits DOM-ES relevantes/indicios sem municipio certo -> le paginas anteriores e reatribui."""
    hits = carrega_raw()
    try:
        feito = json.load(open(REATRIB, encoding="utf-8"))
    except Exception:
        feito = {}
    alvo = [h for h in hits.values() if h["fonte"] == "domes" and h["score"] >= LIMIAR_INDICIO
            and h.get("atribuicao") in ("nao_atribuido", "pagina(incerta)") and h["id"] not in feito]
    alvo.sort(key=lambda h: -h["score"])  # mais relevantes primeiro (cada um baixa 1-3 PDFs de ~3 MB)
    if getattr(args, "min_score", None) is not None:
        alvo = [h for h in alvo if h["score"] >= args.min_score]
    log("reatribuir-domes: %d hits" % len(alvo))
    d = FONTES["domes"]
    lk = threading.Lock()

    def um(h):
        try:
            ib, met = d.reatribuir(h)
        except Exception as ex:
            ib, met = None, "erro: %s" % ex
        with lk:
            feito[h["id"]] = {"ibge": ib, "atribuicao": met}
            log("  %s -> %s (%s)" % (h["url"], municipios()[ib]["nome"] if ib else None, met))
            json.dump(feito, open(REATRIB, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    paralelo_map(um, alvo, getattr(args, "paralelo", 4) or 4)


def paralelo_map(fn, itens, n):
    """Executa fn em n threads (o gargalo sob carga alta e o fork do pdftotext, nao a rede)."""
    fila = list(itens)
    lk = threading.Lock()

    def worker():
        while True:
            with lk:
                if not fila:
                    return
                it = fila.pop(0)
            fn(it)
    ths = [threading.Thread(target=worker) for _ in range(max(1, n))]
    for t in ths:
        t.start()
    for t in ths:
        t.join()


TRECHOS_DOSP = os.path.join(RAW, "dosp_trechos.json")


def cmd_enriquecer_dosp(args):
    """Hits DOSP sem trecho (so edicao): baixa o PDF da edicao e extrai o trecho do termo (pdftotext)."""
    hits = carrega_raw()
    try:
        feito = json.load(open(TRECHOS_DOSP, encoding="utf-8"))
    except Exception:
        feito = {}
    por_par = {}
    for h in hits.values():
        if h["fonte"] != "dosp" or h.get("trecho") or h["id"] in feito:
            continue
        for t in h["termos"]:
            if t in TERMOS_PDF_DOSP:
                por_par.setdefault((h["ibge"], t), []).append(h)
    alvo = []
    for (ib, t), hs in por_par.items():
        hs.sort(key=lambda x: x.get("data") or "", reverse=True)
        frase = [x["frase"] for x in TERMOS if x["id"] == t][0]
        alvo += [(h, frase) for h in hs[:args.max_por_termo]]
    vistos = set()
    alvo = [a for a in alvo if not (a[0]["id"] in vistos or vistos.add(a[0]["id"]))]
    log("enriquecer-dosp: %d edições" % len(alvo))
    d = FONTES["dosp"]
    lk = threading.Lock()

    def um(a):
        h, frase = a
        try:
            tr = d.trecho_pdf(h["url"], frase)
        except Exception as ex:
            tr = ""
            log("  erro %s: %s" % (h["url"], ex))
        with lk:
            feito[h["id"]] = tr
            json.dump(feito, open(TRECHOS_DOSP, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
            log("  dosp %s %s %s -> %s" % (h["ibge"], h["data"], frase, "trecho ok" if tr else "sem trecho"))
    paralelo_map(um, alvo, args.paralelo)


def consolidar(max_ocorr=40):
    hits = carrega_raw()
    try:
        reat = json.load(open(REATRIB, encoding="utf-8"))
    except Exception:
        reat = {}
    for k, v in reat.items():
        if k in hits and v.get("ibge"):
            hits[k]["ibge"] = v["ibge"]
            hits[k]["atribuicao"] = v["atribuicao"]
    cob = {}
    try:
        cob = json.load(open(COBERTURA, encoding="utf-8"))
    except Exception:
        pass
    mun = municipios()
    res = {}
    sem = []
    vistos_fonte = {}
    for h in hits.values():
        ib = h.get("ibge")
        if not ib or ib not in mun:
            sem.append(h)
            continue
        r = res.setdefault(ib, {"nome": mun[ib]["nome"], "uf": mun[ib]["uf"], "acertos": 0, "acertos_brutos": 0,
                                "ocorrencias": [], "_ruido": []})
        r["acertos_brutos"] += 1
        oc = {k: h.get(k) for k in ("fonte", "data", "titulo", "trecho", "url", "url_pdf", "edicao", "entidade",
                                     "orgao", "termos", "score", "motivos", "atribuicao", "url_txt") if h.get(k)}
        if h["score"] >= limiar(h["fonte"]):
            r["acertos"] += 1
            r["ocorrencias"].append(oc)
        else:
            r["_ruido"].append(oc)
        if not (h["fonte"] == "domes" and str(h.get("atribuicao", "")).startswith("pagina")):
            vistos_fonte.setdefault(ib, set()).add(h["fonte"])
    # cobertura: inclui municipios cobertos sem acerto
    cob_por_ibge = {}
    for fonte, c in cob.get("fontes", {}).items():
        for ib in cobertura_efetiva(fonte, c):
            cob_por_ibge.setdefault(ib, []).append(fonte)
    for ib, fs in vistos_fonte.items():  # quem aparece em resultado de uma fonte e coberto por ela
        for f in fs:
            if f not in cob_por_ibge.setdefault(ib, []):
                cob_por_ibge[ib].append(f)
    for ib, fs in cob_por_ibge.items():
        if ib in mun and ib not in res:
            res[ib] = {"nome": mun[ib]["nome"], "uf": mun[ib]["uf"], "acertos": 0, "acertos_brutos": 0,
                       "ocorrencias": [], "_ruido": []}
    for ib, r in res.items():
        r["ocorrencias"].sort(key=lambda o: (o.get("score", 0), o.get("data") or ""), reverse=True)
        r["ocorrencias"] = r["ocorrencias"][:max_ocorr]
        r["ocorrencias_omitidas"] = max(0, r["acertos"] - len(r["ocorrencias"]))
        ruido = r.pop("_ruido")
        ind = sorted((o for o in ruido if o.get("score", 0) >= LIMIAR_INDICIO), key=lambda o: (o.get("score", 0), o.get("data") or ""), reverse=True)
        r["indicios"] = [{k: (o.get(k)[:400] if k == "trecho" and o.get(k) else o.get(k)) for k in ("fonte", "data", "titulo", "trecho", "url", "score") if o.get(k)} for o in ind[:10]]
        r["n_indicios"] = len(ind)
        r["descartadas_como_ruido"] = len(ruido) - len(ind)
        r["fontes_que_cobrem"] = sorted(cob_por_ibge.get(ib, []))
        r["fontes_com_acerto"] = sorted(set(o["fonte"] for o in r["ocorrencias"]))
    resumo_f, resumo_uf = {}, {}
    for h in hits.values():
        rf = resumo_f.setdefault(h["fonte"], {"hits_brutos": 0, "hits_relevantes": 0, "municipios_com_acerto": set()})
        rf["hits_brutos"] += 1
        if h["score"] >= limiar(h["fonte"]) and h.get("ibge") in mun:
            rf["hits_relevantes"] += 1
            rf["municipios_com_acerto"].add(h["ibge"])
    for f, rf in resumo_f.items():
        rf["municipios_com_acerto"] = len(rf["municipios_com_acerto"])
    for ib, r in res.items():
        ru = resumo_uf.setdefault(r["uf"], {"municipios_no_arquivo": 0, "com_acerto": 0, "so_indicio": 0, "cobertos_sem_achado": 0})
        ru["municipios_no_arquivo"] += 1
        if r["acertos"]:
            ru["com_acerto"] += 1
        elif r["n_indicios"]:
            ru["so_indicio"] += 1
        elif r["fontes_que_cobrem"]:
            ru["cobertos_sem_achado"] += 1
    estado = le_estado()
    meta = {
        "gerado_em": datetime.datetime.now().isoformat(timespec="seconds"),
        "gerador": os.path.join(AQUI, "diarios_consolidados.py"),
        "como_ler": ("acertos = nº de ocorrências com score >= %d (>= 8 para qd e dosp, que não têm título de matéria) (critério regex em título+trecho: veículo pesado/"
                     "carga + circulação + restrição/horário/ato normativo, menos ruído de licitação/contrato); "
                     "'ocorrencias' lista até 40 delas (maior score primeiro). 'indicios' = score >= %d e abaixo do limiar "
                     "(ex.: licitação de placas 'proibido caminhões', ata de câmara, menção indireta; no dosp, edição "
                     "com o termo cujo PDF não foi lido) - úteis quando não há acerto. acertos_brutos "
                     "inclui ruído; o bruto completo fica em leads/diarios_consolidados_raw/hits_<fonte>.jsonl. "
                     "Lead NÃO é prova: abrir a url e conferir ato, número, artigo e vigência. Município com "
                     "acertos=0 e fontes_que_cobrem não vazio = varrido sem achado naquele(s) diário(s) (só nos "
                     "termos e períodos da varredura)." % (LIMIAR_RELEVANTE, LIMIAR_INDICIO)),
        "termos": TERMOS,
        "varredura": {k: v for k, v in sorted(estado.items()) if not k.startswith("dosp|")},
        "varredura_dosp": {"pares_cidade_termo": sum(1 for k in estado if k.startswith("dosp|")),
                           "completos": sum(1 for k, v in estado.items() if k.startswith("dosp|") and v.get("completo"))},
        "cobertura": {f: {"descricao": FONTES[f].descricao, "url": URLS.get(f, ""), "periodo": PERIODOS.get(f, ""),
                          "limitacoes": LIMITACOES.get(f, ""), "medido_em": c.get("medido_em"),
                          "n_municipios": len(set(cobertura_efetiva(f, c)) | set(ib for ib, fs in vistos_fonte.items() if f in fs)),
                          "ibges": sorted(set(cobertura_efetiva(f, c)) | set(ib for ib, fs in vistos_fonte.items() if f in fs))}
                      for f, c in cob.get("fontes", {}).items()},
        "cobertura_detalhe": os.path.join(RAW, "cobertura.json"),
        "sem_municipio": len(sem),
        "sem_municipio_arquivo": os.path.join(RAW, "sem_municipio.json"),
        "outras_plataformas_avaliadas": OUTRAS_PLATAFORMAS,
        "resumo_por_fonte": resumo_f,
        "resumo_por_uf": resumo_uf,
    }
    out = {"_meta": meta}
    for ib in sorted(res, key=lambda k: (-res[k]["acertos"], k)):
        out[ib] = res[ib]
    tmp = OUT + ".tmp"
    json.dump(out, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)
    json.dump(sorted(sem, key=lambda h: -h["score"])[:500], open(os.path.join(RAW, "sem_municipio.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    n_rel = sum(1 for k, v in res.items() if v["acertos"])
    log("consolidado: %d municípios no arquivo, %d com acertos relevantes; %d hits sem município -> %s" % (len(res), n_rel, len(sem), OUT))


# --------------------------------------------------------------------------------------
def grava_cobertura(fonte, c):
    """Mescla sob trava de arquivo (varios processos podem medir fontes diferentes ao mesmo tempo)."""
    import fcntl
    os.makedirs(RAW, exist_ok=True)
    with open(COBERTURA + ".lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            cob = json.load(open(COBERTURA, encoding="utf-8"))
        except Exception:
            cob = {"fontes": {}}
        cob.setdefault("fontes", {})[fonte] = c
        tmp = COBERTURA + ".tmp%d" % os.getpid()
        json.dump(cob, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        os.replace(tmp, COBERTURA)
        fcntl.flock(lk, fcntl.LOCK_UN)


def cmd_cobertura(args):
    os.makedirs(RAW, exist_ok=True)
    alvo = args.fontes.split(",") if args.fontes else list(FONTES)
    for f in alvo:
        log("cobertura: %s ..." % f)
        try:
            if f == "dosp" and args.ufs:
                c = FONTES[f].cobertura(atualizar=True, ufs=args.ufs.split(","))
            else:
                c = FONTES[f].cobertura(atualizar=True)
        except Exception as ex:
            log("ERRO cobertura %s: %s" % (f, ex))
            continue
        c["medido_em"] = HOJE
        grava_cobertura(f, c)
        log("cobertura: %s -> %d municípios" % (f, len(c.get("municipios") or {})))


def cmd_varrer(args):
    os.makedirs(RAW, exist_ok=True)
    alvo = args.fontes.split(",") if args.fontes else ["amm-mg", "aemerj", "apm", "domes", "doesp", "qd", "dosp"]
    termos = [t for t in TERMOS if not args.termos or t["id"] in args.termos.split(",")]
    grupos = {}
    for f in alvo:
        host = {"sigpub": "sigpub"}.get(FONTES[f].tipo, f)
        grupos.setdefault(host, []).append(f)
    ths = []
    for g, fs in grupos.items():
        if fs == ["dosp"] and args.paralelo > 1:  # varias cidades em paralelo; a taxa por host continua valendo
            for k in range(args.paralelo):
                th = threading.Thread(target=varre_dosp, args=(termos,), kwargs={"pdf": not args.sem_pdf, "refazer": args.refazer, "shard": (k, args.paralelo)})
                th.start()
                ths.append(th)
            continue

        def run(fs=fs):
            for f in fs:
                if f == "dosp":
                    varre_dosp(termos, pdf=not args.sem_pdf, refazer=args.refazer)
                else:
                    varre_fonte(f, termos, refazer=args.refazer)
        th = threading.Thread(target=run, name=g)
        th.start()
        ths.append(th)
    for th in ths:
        th.join()
    log("varredura terminada; rode `consolidar`")
    if not args.sem_consolidar:
        consolidar()


def cmd_buscar(args):
    ibges = resolve_municipio_arg(args.municipio, args.uf)
    if not ibges:
        print("Município não encontrado no Sudeste: %s" % args.municipio)
        sys.exit(2)
    mun = municipios()
    todos = []
    for ib in ibges:
        m = mun[ib]
        fs = args.fonte.split(",") if args.fonte else UF_FONTES[m["uf"]]
        print("# %s (%s/%s) termo=%r fontes=%s" % (ib, m["nome"], m["uf"], args.termo, ",".join(fs)), file=sys.stderr)
        for fn in fs:
            f = FONTES[fn]
            if f.uf and f.uf != m["uf"]:
                continue
            try:
                kw = {}
                if args.max_paginas:
                    kw["max_pag"] = args.max_paginas
                hs = f.buscar_municipio(ib, args.termo, **kw)
            except Exception as ex:
                print("  [%s] ERRO: %s" % (fn, ex), file=sys.stderr)
                continue
            print("  [%s] %d resultado(s)" % (fn, len(hs)), file=sys.stderr)
            for h in hs:
                h["score"], h["motivos"] = pontua(h.get("titulo", ""), h.get("trecho", ""))
            todos += hs
    todos.sort(key=lambda h: (-h["score"], h.get("data") or ""))
    if args.json:
        print(json.dumps(todos, ensure_ascii=False, indent=1))
        return
    for h in todos:
        print("\n[%s] %s  score=%s  %s" % (h["fonte"], h.get("data"), h["score"], ("ent: " + h["entidade"]) if h.get("entidade") else ""))
        print("  título: %s" % (h.get("titulo") or "")[:200])
        if h.get("trecho"):
            print("  trecho: %s" % h["trecho"][:600])
        print("  url: %s" % h.get("url"))


def cmd_lead(args):
    try:
        d = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        print("Sem %s ainda." % OUT)
        sys.exit(1)
    for ib in resolve_municipio_arg(args.municipio, args.uf):
        r = d.get(ib)
        if not r:
            print("%s: não coberto pelos diários consolidados varridos." % ib)
            continue
        print(json.dumps({ib: r}, ensure_ascii=False, indent=1))


def cmd_fontes(args):
    try:
        cob = json.load(open(COBERTURA, encoding="utf-8")).get("fontes", {})
    except Exception:
        cob = {}
    for n, f in FONTES.items():
        c = cob.get(n, {})
        print("== %s (%s)\n   %s\n   cobertura medida: %s municípios (em %s)\n   período: %s\n   limitações: %s" % (
            n, f.uf or "várias UFs", f.descricao, len(cobertura_efetiva(n, c)), c.get("medido_em", "-"),
            PERIODOS.get(n, ""), LIMITACOES.get(n, "")))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd")
    b = sp.add_parser("buscar", help="buscar <ibge|nome> <termo>: busca o termo nos diários consolidados que cobrem a cidade")
    b.add_argument("municipio")
    b.add_argument("termo")
    b.add_argument("--uf")
    b.add_argument("--fonte", help="lista separada por vírgula (amm-mg,aemerj,apm,domes,doesp,dosp,qd)")
    b.add_argument("--max-paginas", type=int)
    b.add_argument("--json", action="store_true")
    l = sp.add_parser("lead", help="mostra o que a varredura consolidada já achou para a cidade")
    l.add_argument("municipio")
    l.add_argument("--uf")
    v = sp.add_parser("varrer", help="varredura global (todos os termos x fontes), retomável")
    v.add_argument("--fontes")
    v.add_argument("--termos")
    v.add_argument("--refazer", action="store_true")
    v.add_argument("--sem-pdf", action="store_true")
    v.add_argument("--sem-consolidar", action="store_true")
    v.add_argument("--paralelo", type=int, default=1, help="dosp: nº de cidades em paralelo (taxa por host mantida)")
    c = sp.add_parser("cobertura", help="mede a cobertura de cada diário (municípios)")
    c.add_argument("--fontes")
    c.add_argument("--ufs", help="dosp: UFs onde descobrir slugs (padrão SP)")
    sp.add_parser("consolidar", help="raw -> leads/diarios_consolidados.json")
    r = sp.add_parser("reatribuir-domes", help="DOM-ES: atribui município lendo páginas anteriores (PDF) dos hits incertos")
    r.add_argument("--paralelo", type=int, default=4)
    r.add_argument("--min-score", type=int)
    e = sp.add_parser("enriquecer-dosp", help="DOSP: extrai trecho do PDF das edições achadas (termos específicos)")
    e.add_argument("--paralelo", type=int, default=6)
    e.add_argument("--max-por-termo", type=int, default=6, help="edições mais recentes por cidade/termo")
    sp.add_parser("fontes", help="descreve as fontes e a cobertura medida")
    a = ap.parse_args()
    if a.cmd == "buscar":
        cmd_buscar(a)
    elif a.cmd == "lead":
        cmd_lead(a)
    elif a.cmd == "varrer":
        cmd_varrer(a)
    elif a.cmd == "cobertura":
        cmd_cobertura(a)
    elif a.cmd == "consolidar":
        consolidar()
    elif a.cmd == "reatribuir-domes":
        cmd_reatribuir_domes(a)
    elif a.cmd == "enriquecer-dosp":
        cmd_enriquecer_dosp(a)
    elif a.cmd == "fontes":
        cmd_fontes(a)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
