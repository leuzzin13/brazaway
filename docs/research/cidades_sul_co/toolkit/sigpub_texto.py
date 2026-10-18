#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sigpub_texto.py - busca em TEXTO INTEGRAL nos diarios SIGPub (diariomunicipal.com.br/<assoc>) filtrando por ENTIDADE
(Prefeitura/Municipio/Camara), com faixa do acervo por entidade. R4 2026-10-18. Somente leitura.

O formulario /<assoc>/pesquisar (GET) aceita busca_avancada[texto|titulo|entidade|dataInicio|dataFim|ordenacao|pagina];
texto vazio + entidade lista tudo (ordenacao antiga/recente da a FAIXA do acervo). E logico entre palavras (sem frase exata), 25/pag.
Reaproveita a classe SIGPub de diarios_consolidados.py (entidades -> ibge, pesquisar).

  python3 sigpub_texto.py faixa 5221403 [--fontes agm,fgm]            # entidades do municipio e faixa de datas/qtde
  python3 sigpub_texto.py varrer 5221403 [--saida x.json] [--paginas 3] # 6 termos x entidades x (todos|decreto|lei|portaria)
  python3 sigpub_texto.py lote ../fila_r3/R4-AGM-GO.json SAIDA_DIR      # todos os municipios do lote que sao entidades
Termos: caminhoes | veiculos pesados | transito pesado | toneladas | eixos | carga descarga.
Cada hit sai com score (pontua do diarios_consolidados) e 'plausivel' (score>=4 ou palavra-chave de peso+restricao no trecho).
Lead nao e prova: abrir a url e ler o ato.
"""
import argparse, json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import diarios_consolidados as D

TERMOS = ["caminhões", "veículos pesados", "trânsito pesado", "toneladas", "eixos", "carga descarga"]
TITULOS = ["", "decreto", "lei", "portaria"]
RX_PESO = re.compile(r"caminh|ve[ií]culos? (de carga|pesad)|tr[aâ]nsito pesado|tonelad|eixos?\b|carga e descarga|\bVUC\b|\bPBT", re.I)
RX_REST = re.compile(r"proib|vedad|restri|rod[ií]zio|hor[aá]rio|circula|permitid|limite|zona", re.I)


def faixa(fonte, ent_id):
    s = D.FONTES[fonte]
    h1, t = s.pesquisar("", entidade=ent_id, ordenacao="antiga")
    h2, _ = s.pesquisar("", entidade=ent_id, ordenacao="recente")
    return {"total": t, "primeira": h1[0]["data"] if h1 else None, "ultima": h2[0]["data"] if h2 else None,
            "total_truncado_em_10000": t >= 10001}


# Mapa completo das entidades de TODOS os seletores SIGPub (famurs, amp, agm, fgm, amm-mt, ms): sigpub_entidades_mapa.json (R4 2026-10-18).
# Contem os nomes truncados do AGM ("Municipio de Abadia", "Municipal de Sao Francisco"...), Teresina (FGM), Rio Verde de MT (MS) e a
# correcao "Municipio de Divinopolis" (resolve_entidade dava Davinopolis; e Divinopolis de Goias 5208301).
MAPA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sigpub_entidades_mapa.json")
try:
    MAPA = json.load(open(MAPA_PATH, encoding="utf-8"))["fontes"]
except Exception:
    MAPA = {}
ALIAS = {(f, i): e["ibge"] for f, d in MAPA.items() for i, e in d.items() if e.get("origem") in ("alias", "corrigido")}


def aplicar_mapa():
    """Sobrescreve em memoria o ibge das entidades do cache do SIGPub (D.FONTES[f].entidades()) com o mapa; afeta tambem hit['ibge']."""
    for f, d in MAPA.items():
        if f not in D.FONTES:
            continue
        for e in D.FONTES[f].entidades():
            m = d.get(e["id"])
            if m and m.get("ibge"):
                e["ibge"] = m["ibge"]


aplicar_mapa()


def entidades(ibge, fontes=("agm", "fgm")):
    out = []
    for f in fontes:
        for e in D.FONTES[f].entidades():
            if (e["ibge"] or ALIAS.get((f, e["id"]))) == ibge:
                out.append((f, e))
    return out


def varrer(ibge, fontes=("agm", "fgm"), paginas=3, termos=TERMOS, titulos=TITULOS):
    res = {"ibge": ibge, "entidades": [], "hits": []}
    vistos = set()
    for f, e in entidades(ibge, fontes):
        fx = faixa(f, e["id"])
        res["entidades"].append(dict(fonte=f, id=e["id"], nome=e["nome"], **fx))
        if fx["total"] == 0:
            continue
        s = D.FONTES[f]
        for t in termos:
            for tit in titulos:
                for p in range(1, paginas + 1):
                    hits, total = s.pesquisar(t, pagina=p, entidade=e["id"], ordenacao="relevancia", titulo=tit)
                    for h in hits:
                        if h["id"] in vistos:
                            continue
                        vistos.add(h["id"])
                        sc = D.pontua(h["titulo"], h["trecho"])
                        h["score"] = sc[0] if isinstance(sc, (tuple, list)) else sc
                        h["termo"] = t
                        h["plausivel"] = bool(RX_PESO.search(h["titulo"] + " " + h["trecho"]) and RX_REST.search(h["titulo"] + " " + h["trecho"])) or h["score"] >= 4
                        res["hits"].append(h)
                    if p * 25 >= total:
                        break
    res["hits"].sort(key=lambda h: -h["score"])
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["faixa", "varrer", "lote"])
    ap.add_argument("alvo"); ap.add_argument("saida", nargs="?")
    ap.add_argument("--fontes", default="agm,fgm"); ap.add_argument("--paginas", type=int, default=3)
    ap.add_argument("--saida", dest="saida2")
    a = ap.parse_args()
    fontes = tuple(a.fontes.split(","))
    if a.cmd == "faixa":
        for f, e in entidades(a.alvo, fontes):
            print(f, e["id"], e["nome"], json.dumps(faixa(f, e["id"])))
    elif a.cmd == "varrer":
        r = varrer(a.alvo, fontes, a.paginas)
        out = a.saida or a.saida2
        if out:
            json.dump(r, open(out, "w"), ensure_ascii=False, indent=1)
        print(json.dumps(r["entidades"], ensure_ascii=False, indent=1)); print(len(r["hits"]), "hits;", sum(h["plausivel"] for h in r["hits"]), "plausiveis")
    else:
        os.makedirs(a.saida, exist_ok=True)
        for c in json.load(open(a.alvo))["cidades"]:
            if not entidades(c["ibge"], fontes):
                continue
            dest = os.path.join(a.saida, c["ibge"] + ".json")
            if os.path.exists(dest):
                continue
            r = varrer(c["ibge"], fontes, a.paginas)
            json.dump(r, open(dest, "w"), ensure_ascii=False, indent=1)
            print(c["ibge"], c["nome"], len(r["hits"]), "hits", sum(h["plausivel"] for h in r["hits"]), "plausiveis", flush=True)

if __name__ == "__main__":
    main()
