"""Extrai a Relação de Produtos Perigosos (anexo da Res. ANTT 5.998/2022, Parte 3, cap. 3.2) do PDF oficial.

Fonte: https://anexosportal.datalegis.net/arquivos/1774888.pdf (125 páginas, versão publicada em 2022).
Saída: relacao_antt_5998_2022_parse.csv (uma linha por nº ONU, colunas (1) a (9) da Relação).

Uso (precisa de pdfplumber; não está no requirements do importador porque roda só quando a ANTT publicar nova Relação):
    python -m venv /tmp/v && /tmp/v/bin/pip install pdfplumber
    curl -o /tmp/relacao.pdf https://anexosportal.datalegis.net/arquivos/1774888.pdf
    /tmp/v/bin/python data/raw/hazmat/parse_relacao_antt.py /tmp/relacao.pdf
    python3 data/raw/hazmat/build_relacao.py      # normaliza e atualiza api/src/services/hazmat.ts

Colunas: separadas pela posição x dos rótulos "(1)".."(10)" do cabeçalho de cada página (pdfplumber.extract_words).
Linhas: cada nº ONU ocupa uma célula da coluna (1) delimitada pelos fios horizontais da tabela (page.edges). O texto das
outras colunas é centralizado na vertical dentro da linha, então pode começar ACIMA do nº ONU (ex.: 3534, 3546, 3547);
por isso cada palavra vai para a linha cuja faixa entre fios contém o centro vertical da palavra, e não para "o último
nº ONU acima dela". Sem fios na página, cai no nº ONU de centro vertical mais próximo.
Nome (coluna 2): extraído com x_tolerance menor (NAME_X_TOL), porque as linhas justificadas têm espaços estreitos.
Rodapé: o número da página (sozinho, centralizado, ~28 pt acima do rodapé "Anexo ... SEI ... pg. N") e o rodapé ficam
fora; antes, o número da página entrava na coluna (5) da última linha de cada página.
"""
import csv
import pathlib
import re
import sys

import pdfplumber

HERE = pathlib.Path(__file__).resolve().parent
pdf_path = sys.argv[1] if len(sys.argv) > 1 else 'antt_relacao_produtos_perigosos.pdf'
out_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / 'relacao_antt_5998_2022_parse.csv'
pdf = pdfplumber.open(pdf_path)
# tolerância horizontal (pt) para juntar letras em palavras na coluna (2). O padrão do pdfplumber (3) cola palavras: nas
# linhas justificadas o espaço entre palavras chega a 1,4 pt (ex.: 0133), e dentro da palavra o vão é <= 0,2 pt.
NAME_X_TOL = 1.0
out = []


def row_bands(p, x1col: float, top_min: float) -> list[float]:
    """Topos dos fios horizontais que cruzam a coluna (1), abaixo do cabeçalho (fios duplos a < 2 pt viram um)."""
    ys = sorted(e['top'] for e in p.edges if e['orientation'] == 'h' and e['x0'] <= x1col <= e['x1'] and e['top'] > top_min)
    merged: list[float] = []
    for y in ys:
        if not merged or y - merged[-1] > 2:
            merged.append(y)
    return merged


for pi, p in enumerate(pdf.pages):
    ws = p.extract_words()
    hdr = {w['text']: (w['x0'] + w['x1']) / 2 for w in ws if re.fullmatch(r'\((\d+)\)', w['text']) and w['top'] < 160}
    need = ['(1)', '(3)', '(4)', '(5)', '(6)', '(7)', '(8)', '(9)', '(10)']
    if not all(k in hdr for k in need):
        print('página', pi + 1, 'sem cabeçalho', sorted(hdr))
        continue
    htop = max(w['top'] for w in ws if w['text'] in need)
    c = {k: hdr[k] for k in need}
    cols = ['3', '4', '5', '6', '7', '8', '9', '10']
    centers = [c['(' + k + ')'] for k in cols]
    bounds = [(centers[i] + centers[i + 1]) / 2 for i in range(len(centers) - 1)]
    left3 = centers[0] - (centers[1] - centers[0]) / 2 - 4
    # rodapé: "Anexo Relação de Produtos Perigosos (...) SEI ... / pg. N" e o número da página isolado acima dele
    footer_top = min([w['top'] for w in ws if w['text'] in ('Anexo', 'SEI')] or [p.height])
    page_no = [w for w in ws if w['text'] == str(pi + 1) and footer_top - 45 < w['top'] < footer_top - 5
               and not any(o is not w and abs(o['top'] - w['top']) < 2 for o in ws)]
    cut = min([footer_top] + [w['top'] for w in page_no]) - 1
    # coluna (2), o nome: tolerância menor, senão o pdfplumber cola palavras de linhas justificadas ("RESÍDUOSMÉDICOS")
    in_name = lambda w: (w['x0'] + w['x1']) / 2 < left3 and w['x0'] > c['(1)'] + 15
    ws_data = [w for w in ws if not in_name(w)] + [w for w in p.extract_words(x_tolerance=NAME_X_TOL) if in_name(w)]
    data = [w for w in ws_data if htop + 3 < w['top'] < cut and 'SEI' not in w['text']]
    starts = [w for w in data if re.fullmatch(r'\d{4}', w['text']) and w['x0'] < c['(1)'] + 15]
    starts.sort(key=lambda w: w['top'])
    if not starts:
        continue
    ymid = lambda w: (w['top'] + w['bottom']) / 2
    lines = row_bands(p, c['(1)'], htop)
    # faixa [topo, base) de cada nº ONU pelos fios; sem fio em volta, usa o meio do caminho até o vizinho
    band = []
    for i, s in enumerate(starts):
        y = ymid(s)
        above = [b for b in lines if b <= y]
        below = [b for b in lines if b > y]
        prev_y = ymid(starts[i - 1]) if i else None
        next_y = ymid(starts[i + 1]) if i + 1 < len(starts) else None
        top = above[-1] if above else ((prev_y + y) / 2 if prev_y is not None else htop + 3)
        bot = below[0] if below else ((y + next_y) / 2 if next_y is not None else cut)
        band.append((top, bot))
    rows = [{'onu': s['text'], 'nome': [], **{k: [] for k in cols}} for s in starts]
    for w in sorted(data, key=lambda w: (round(w['top']), w['x0'])):
        if any(w is s for s in starts):
            continue
        y = ymid(w)
        idx = [i for i, (t, b) in enumerate(band) if t <= y < b]
        if not idx:
            if y < band[0][0]:
                continue   # continuação da última linha da página anterior: fica de fora, como antes
            idx = [min(range(len(starts)), key=lambda i: abs(ymid(starts[i]) - y))]
        row = rows[idx[0]]
        xc = (w['x0'] + w['x1']) / 2
        if xc < left3:
            row['nome'].append(w['text'])
            continue
        j = sum(1 for b in bounds if xc > b)
        row[cols[j]].append(w['text'])
    for row in rows:
        out.append({'onu': row['onu'], 'nome': ' '.join(row['nome']), 'classe': ' '.join(row['3']),
                    'risco_subsidiario': ' '.join(row['4']), 'numero_risco': ' '.join(row['5']),
                    'grupo_embalagem': ' '.join(row['6']), 'provisoes_especiais': ' '.join(row['7']),
                    'qtd_limitada_veiculo_kg': ' '.join(row['8']), 'qtd_limitada_emb_interna': ' '.join(row['9']),
                    'pagina': pi + 1})
print(len(out), 'linhas')
with open(out_path, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)
