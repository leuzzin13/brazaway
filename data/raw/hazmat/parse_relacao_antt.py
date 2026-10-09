"""Extrai a Relação de Produtos Perigosos (anexo da Res. ANTT 5.998/2022, Parte 3, cap. 3.2) do PDF oficial.

Fonte: https://anexosportal.datalegis.net/arquivos/1774888.pdf (125 páginas, versão publicada em 2022).
Saída: relacao_antt_5998_2022_parse.csv (uma linha por nº ONU, colunas (1) a (9) da Relação).

Uso (precisa de pdfplumber; não está no requirements do importador porque roda só quando a ANTT publicar nova Relação):
    python -m venv /tmp/v && /tmp/v/bin/pip install pdfplumber
    curl -o /tmp/relacao.pdf https://anexosportal.datalegis.net/arquivos/1774888.pdf
    /tmp/v/bin/python data/raw/hazmat/parse_relacao_antt.py /tmp/relacao.pdf
    python3 data/raw/hazmat/build_relacao.py      # normaliza e atualiza api/src/services/hazmat.ts

As colunas são separadas pela posição x dos rótulos "(1)".."(10)" do cabeçalho de cada página (pdfplumber.extract_words).
"""
import csv
import pathlib
import re
import sys

import pdfplumber

HERE = pathlib.Path(__file__).resolve().parent
pdf_path = sys.argv[1] if len(sys.argv) > 1 else 'antt_relacao_produtos_perigosos.pdf'
pdf = pdfplumber.open(pdf_path)
out = []
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
    data = [w for w in ws if w['top'] > htop + 3 and 'SEI' not in w['text']]
    starts = [w for w in data if re.fullmatch(r'\d{4}', w['text']) and w['x0'] < c['(1)'] + 15]
    starts.sort(key=lambda w: w['top'])
    footer_top = min([w['top'] for w in ws if w['text'] in ('Anexo', 'SEI')] or [p.height])
    for i, s in enumerate(starts):
        top = s['top'] - 2
        bot = (starts[i + 1]['top'] - 2) if i + 1 < len(starts) else footer_top - 2
        blk = [w for w in data if top <= w['top'] < bot and w is not s]
        row = {'onu': s['text'], 'nome': [], **{k: [] for k in cols}}
        for w in sorted(blk, key=lambda w: (round(w['top']), w['x0'])):
            xc = (w['x0'] + w['x1']) / 2
            if xc < left3:
                row['nome'].append(w['text'])
                continue
            j = sum(1 for b in bounds if xc > b)
            row[cols[j]].append(w['text'])
        out.append({'onu': row['onu'], 'nome': ' '.join(row['nome']), 'classe': ' '.join(row['3']),
                    'risco_subsidiario': ' '.join(row['4']), 'numero_risco': ' '.join(row['5']),
                    'grupo_embalagem': ' '.join(row['6']), 'provisoes_especiais': ' '.join(row['7']),
                    'qtd_limitada_veiculo_kg': ' '.join(row['8']), 'qtd_limitada_emb_interna': ' '.join(row['9']),
                    'pagina': pi + 1})
print(len(out), 'linhas')
with open(HERE / 'relacao_antt_5998_2022_parse.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)
