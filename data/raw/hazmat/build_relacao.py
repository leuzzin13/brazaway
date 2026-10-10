"""Normaliza a Relação de Produtos Perigosos (Res. ANTT 5.998/2022) e gera a tabela embutida em api/src/services/hazmat.ts.

Entradas:
  relacao_antt_5998_2022_parse.csv    saída bruta de parse_relacao_antt.py (pdfplumber, uma linha por nº ONU)
  [opcional] texto do PDF com `pdftotext -layout` (padrão: data/cache/antt_relacao_produtos_perigosos.txt), usado só
             para recuperar nomes que o pdfplumber colou sem espaços e os casos especiais da coluna 8.
Saídas:
  relacao_antt_5998_2022.csv          tabela limpa (versionada)
  api/src/services/hazmat.ts          bloco entre os marcadores RELACAO_ANTT (gerado; não edite à mão)

Coluna 8 ("Quantidade limitada por veículo", Res. 5.998 Parte 3, item 3.2 e 3.4.3) normalizada em `qtd_veiculo`:
  número  = kg de peso bruto total (vale o MENOR valor quando a linha tem um valor por grupo de embalagem)
  Z       = "ZERO": não há isenção por quantidade limitada
  I       = "ILIMITADA": isenção em qualquer quantidade
  N       = "PRODUTO NÃO SUJEITO À REGULAMENTAÇÃO DO TRANSPORTE RODOVIÁRIO DE PRODUTOS PERIGOSOS"
  P       = "TRANSPORTE PROIBIDO"
  V       = depende de provisão especial (ex.: "Ver PE 277") ou célula vazia: sem isenção automática

Uso: python3 data/raw/hazmat/build_relacao.py [caminho_do_txt]
"""
import csv
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
TS = ROOT / 'api' / 'src' / 'services' / 'hazmat.ts'
TXT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'cache' / 'antt_relacao_produtos_perigosos.txt'


def txt_blocks() -> dict[str, str]:
    """nº ONU -> primeira linha da entrada no texto (layout) do PDF."""
    if not TXT.exists():
        print(f'  (sem {TXT}: nomes colados ficam como estão)')
        return {}
    out = {}
    for line in TXT.read_text(encoding='utf-8', errors='replace').splitlines():
        m = re.match(r'^\s{0,3}(\d{4})\s{2,}(.*)$', line)
        if m and m.group(1) not in out:
            out[m.group(1)] = m.group(2)
    return out


def clean_name(s: str) -> str:
    s = s.replace('†', '').replace('­', '')
    s = re.sub(r'\s+', ' ', s).strip(' ,;')
    if len(s) > 110:
        s = s[:110].rsplit(' ', 1)[0].rstrip(' ,;(') + '…'
    return s


def join_spaced(raw: str) -> str:
    """O PDF espaça letras em algumas células: "I L IMITADA" -> "ILIMITADA", "Z E RO" -> "ZERO"."""
    out: list[str] = []
    buf = ''
    for t in raw.split():
        if re.fullmatch(r'[A-Za-z]+', t) and t.upper() not in ('ZERO', 'ILIMITADA'):
            buf += t
            if buf.upper() in ('ZERO', 'ILIMITADA'):
                out.append(buf.upper())
                buf = ''
            continue
        if buf:
            out.append(buf)
            buf = ''
        out.append(t)
    if buf:
        out.append(buf)
    return ' '.join(out)


def qty_code(raw: str, txt_line: str) -> tuple[str, str]:
    """(código normalizado, valores originais)"""
    toks = join_spaced(raw).split()
    vals = []
    ok = bool(toks)
    for t in toks:
        tu = t.upper()
        if re.fullmatch(r'\d+', t):
            vals.append(int(t))
        elif tu == 'ZERO':
            vals.append(0)
        elif tu == 'ILIMITADA':
            vals.append(float('inf'))
        else:
            ok = False
    up = txt_line.upper()
    if 'NÃO SUJEITO' in up or 'NAO SUJEITO' in up:
        return 'N', 'não sujeito'
    if 'TRANSPORTE PROIBIDO' in up or raw.upper().startswith('TRANSPORTE'):
        return 'P', 'transporte proibido'
    if not ok or not vals:
        return 'V', raw or '(vazio)'
    m = min(vals)
    if m == 0:
        return 'Z', raw
    if m == float('inf'):
        return 'I', raw
    return str(int(m)), raw


def main():
    rows = list(csv.DictReader(open(HERE / 'relacao_antt_5998_2022_parse.csv', encoding='utf-8')))
    blocks = txt_blocks()
    clean = []
    fixed = 0
    for r in rows:
        onu = r['onu'].strip()
        nome = r['nome']
        if (re.search(r'[A-ZÀ-Úa-zà-ú(),;]{24,}', nome) or len(nome) < 3) and onu in blocks:
            first = re.split(r'\s{3,}', blocks[onu].strip())[0]
            # só troca se a linha do nº ONU no texto trouxer o nome (letras); em linhas centralizadas na vertical o nome
            # pode estar acima ou abaixo, e o primeiro campo seria a classe (ex.: "6.2" no 3549)
            if len(first) >= 3 and re.search(r'[A-Za-zÀ-ú]{3}', first):
                nome = first + ('…' if re.search(r'(\bou|\(|,|-|\bde|\bcom)$', first) else '')
                fixed += 1
        code, raw = qty_code(r['qtd_limitada_veiculo_kg'].strip(), blocks.get(onu, ''))
        if code in ('N', 'P'):   # linha sem colunas 3 a 9 (texto ocupa a linha): limpa o que o parser pegou por posição
            r = {**r, 'classe': r['classe'] if code == 'P' else '', 'risco_subsidiario': '', 'numero_risco': '' if code == 'N' else r['numero_risco'], 'grupo_embalagem': ''}
        classes = []
        for c in r['classe'].split():
            if c not in classes:
                classes.append(c)
        clean.append({
            'onu': onu, 'nome': clean_name(nome), 'classe': classes[0] if classes else '', 'classes': ' '.join(classes),
            'risco_subsidiario': ' '.join(dict.fromkeys(r['risco_subsidiario'].split())),
            'numero_risco': ' '.join(dict.fromkeys(r['numero_risco'].split())),
            'grupo_embalagem': ' '.join(dict.fromkeys(r['grupo_embalagem'].split())),
            'qtd_veiculo': code, 'qtd_veiculo_original': raw, 'pagina': r['pagina'],
        })
    clean.sort(key=lambda x: x['onu'])
    with open(HERE / 'relacao_antt_5998_2022.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(clean[0].keys()))
        w.writeheader()
        w.writerows(clean)
    from collections import Counter
    cnt = Counter(c['qtd_veiculo'] for c in clean)
    print(f'{len(clean)} nº ONU; {fixed} nomes recuperados do texto; coluna 8: {dict(cnt.most_common())}')

    # bloco embutido no hazmat.ts: onu|classe|classes|risco_sub|n_risco|grupo_emb|qtd|nome
    def esc(s: str) -> str:
        return s.replace('\\', '\\\\').replace('`', "'").replace('${', '$ {').replace('|', '/')
    lines = ['|'.join(esc(c[k]) for k in ('onu', 'classe', 'classes', 'risco_subsidiario', 'numero_risco', 'grupo_embalagem', 'qtd_veiculo', 'nome'))
             for c in clean]
    block = ('// <<RELACAO_ANTT (gerado por data/raw/hazmat/build_relacao.py a partir de relacao_antt_5998_2022.csv; não edite à mão)\n'
             'const RELACAO_ANTT_RAW = `\n' + '\n'.join(lines) + '\n`;\n// RELACAO_ANTT>>')
    src = TS.read_text(encoding='utf-8')
    new, n = re.subn(r'// <<RELACAO_ANTT.*?// RELACAO_ANTT>>', lambda _m: block, src, flags=re.S)
    if n != 1:
        sys.exit('marcadores RELACAO_ANTT não encontrados em ' + str(TS))
    TS.write_text(new, encoding='utf-8')
    print(f'{TS.relative_to(ROOT)} atualizado ({len(block) / 1024:.0f} KB de tabela)')


if __name__ == '__main__':
    main()
