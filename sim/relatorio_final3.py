#!/usr/bin/env python3
"""Relatório da simulação 3.0 (A+ com as novidades × A com BrasaWay × B sem, 100 motoristas cada) em HTML.
Lê sim/out3/estado.json, resultado.json (rode antes `motor.py final` com SIM_V3=1), os relatórios semanais, as decisões
e o que a empresa não enxerga (sim/out3/verdade/); escreve docs/simulacao/relatorio_3_0.html.
Uso: python3 sim/relatorio_final3.py   (SIM_OUT e SIM_RELATORIO trocam a pasta de entrada e o arquivo de saída)"""
import collections, html, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get('SIM_OUT', ROOT / 'sim' / 'out3'))
DEST = Path(os.environ.get('SIM_RELATORIO', ROOT / 'docs' / 'simulacao' / 'relatorio_3_0.html'))

if not (OUT / 'resultado.json').exists():
    sys.exit(f'falta {OUT}/resultado.json: rode antes SIM_OUT={OUT} SIM_V3=1 GRUPOS=com,mais,sem python3 sim/motor.py final')
st = json.loads((OUT / 'estado.json').read_text())
RES = json.loads((OUT / 'resultado.json').read_text())
G = st['grupos']
GR = ('mais', 'com', 'sem')                      # ordem fixa de cor e coluna: A+, A, B
NOME = {'mais': 'A+', 'com': 'A', 'sem': 'B'}
NOME_LONGO = {'mais': 'A+ (BrasaWay com as novidades)', 'com': 'A (BrasaWay como na 2.0)', 'sem': 'B (sem BrasaWay)'}
semanas = sorted({e['semana'] for e in G['com']['eventos']})
NS = len(semanas)
rel = {(n, g): json.loads((OUT / 'relatorios' / f'semana_{n}_{g}.json').read_text()) for n in semanas for g in GR}
verd = {n: json.loads((OUT / 'verdade' / f'semana_{n}.json').read_text()) for n in semanas if (OUT / 'verdade' / f'semana_{n}.json').exists()}
HOJE = rel[(semanas[-1], 'com')].get('hoje', '')


def esc(s): return html.escape(str(s))
def brl(v, casas=0): return ('−' if v < 0 else '') + 'R$ ' + f'{abs(v):,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
def num(v, casas=0): return ('−' if v < 0 else '') + f'{abs(v):,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
def fmt_data(iso): return f'{iso[8:10]}/{iso[5:7]}/{iso[:4]}' if iso and len(iso) >= 10 else (iso or '')
def pct(a, b): return (a - b) / b * 100 if b else 0.0
def semana_de(iso):
    """semana da simulação de uma data (a semana 1 começa em 01/09/2026)"""
    import datetime as dt
    return (dt.date.fromisoformat(iso) - dt.date(2026, 9, 1)).days // 7 + 1


# ------------------------------------------------------------------ totais
def totais(g):
    evs = G[g]['eventos']; R = RES[g]
    mult = [mu for e in evs for mu in e['multas']]
    pts = {pid: sum(x['pontos'] for x in m['pontos']) for pid, m in G[g]['motoristas'].items()}
    cons = sum(e.get('diesel_consumido_l', 0) for e in evs); compr = sum(e.get('diesel_comprado_l', 0) for e in evs)
    gasto = sum(e.get('diesel_gasto_rs', 0) for e in evs)
    tipos = R.get('diesel_litros_por_tipo_de_compra') or {}
    return {
        'viagens': len(evs), 'km': sum(e['km'] for e in evs), 'multas': len(mult), 'multas_pago': R['multas_rs'], 'multas_cheio': R['multas_rs_valor_cheio'],
        'nic': R['nic'], 'nic_pago': R['nic_rs'], 'pontos': sum(pts.values()), 'mot_20': sum(1 for v in pts.values() if v >= 20),
        'retornos': sum(e['retornos'] for e in evs), 'colisoes': sum(e['colisoes'] for e in evs), 'atrasos': sum(e['atraso'] for e in evs),
        'passagens': sum(len(e['violacoes']) for e in evs), 'diesel_l': cons, 'diesel_preco': gasto / compr if compr else 0.0,
        'desviado_l': R['diesel_desviado_l'], 'desviado_rs': R['diesel_desviado_rs'], 'diesel_custo': R['diesel_custo_rs'],
        'km_desvio': R.get('km_desvio_bloqueios', 0), 'km_desvio_rs': R.get('km_desvio_bloqueios_rs', 0),
        'fora_plano_l': tipos.get('fora_do_plano', 0), 'plano_l': tipos.get('plano', 0),
        'perdidas': R['notificacoes_perdidas'], 'atrasadas': R['notificacoes_atrasadas'], 'sne': R.get('sne_desde'),
        'desconto': R['multas_desconto_rs'], 'pendentes_fim': R['multas_aguardando_indicacao_no_fim'], 'custo': R['custo_total_rs'],
        'ignorando': sum(1 for e in evs if e.get('rota') == 'ignorou_app'), 'alertas': sum(e.get('evitadas_alerta', 0) for e in evs),
        'restrito_app': sum(1 for mu in mult if mu.get('fonte') == 'restrito_app'),
    }


T = {g: totais(g) for g in GR}
P, A, B = T['mais'], T['com'], T['sem']
dias = min(NS * 7, 90)          # a última semana tem 6 dias (90 dias no total)
mensal = lambda v: v / dias * 30


# ------------------------------------------------------------------ F1: trechos bloqueados (A+ contra A, nos mesmos trechos e semanas)
def periodo(b):
    """semanas em que o bloqueio valeu: decidido na semana s, vale da s+1 até a semana em que foi tirado"""
    return b['semana'] + 1, b.get('removido_semana', semanas[-1])


blocos = sorted(RES['mais'].get('bloqueios', []) + RES['mais'].get('bloqueios_removidos', []), key=lambda b: b['semana'])
f1_linhas, f1 = [], {'multas_A': 0, 'multas_P': 0, 'pago_A': 0.0, 'pago_P': 0.0, 'pass_A': 0, 'pass_P': 0, 'viagens': 0, 'km': 0.0}


def pago(mu):
    if mu.get('situacao') == 'cancelada': return 0.0
    f = RES['params']['pagamento_sne'] if mu.get('sne') and mu.get('situacao') is None else RES['params']['pagamento_no_prazo']
    v = mu['valor'] * f
    if mu.get('nic'): v += mu['nic']['valor'] * (RES['params']['pagamento_sne'] if mu.get('sne') else RES['params']['pagamento_no_prazo'])
    return v


for b in blocos:
    s0, s1 = periodo(b)
    linha = {'nome': b['nome'], 'semana': b['semana'], 'removido': b.get('removido_semana')}
    for g, tag in (('com', 'A'), ('mais', 'P')):
        evs = [e for e in G[g]['eventos'] if s0 <= e['semana'] <= s1]
        ms = [mu for e in evs for mu in e['multas'] if mu['k'] == b['k']]
        linha['multas_' + tag] = len(ms); linha['pago_' + tag] = sum(pago(mu) for mu in ms)
        linha['pass_' + tag] = sum(1 for e in evs for v in e['violacoes'] if v['k'] == b['k'])
    dv = [e for e in G['mais']['eventos'] if b['item_id'] in (e.get('bloqueios_evitados') or [])]
    linha['viagens'] = len(dv); linha['km'] = sum((e.get('km_desvio_bloqueio') or 0) / len(e['bloqueios_evitados']) for e in dv)
    for k in f1: f1[k] += linha[k]
    f1_linhas.append(linha)
f1_saldo = f1['pago_A'] - f1['pago_P'] - P['km_desvio_rs']


# ------------------------------------------------------------------ F2: desvio de diesel e conferência do painel
desv = sorted(set(RES['mais'].get('desviadores', {})) | set(RES['com'].get('desviadores', {})))


def parou(g, pid):
    d = (RES[g].get('desviadores') or {}).get(pid) or {}
    p = d.get('parou')
    return (f"semana {p['semana']} ({p['como']})" if p else 'não parou'), d.get('litros', 0), d.get('rs', 0)


serie_desv = {g: [] for g in GR}
for g in GR:
    ac = 0.0
    for n in semanas:
        ac += (verd.get(n, {}).get(g) or {}).get('diesel_desviado_l', 0); serie_desv[g].append(round(ac))
conf = [(n, (verd.get(n, {}).get('mais') or {}).get('conferencia_painel') or {}) for n in semanas]
conf = [(n, c) for n, c in conf if c and not c.get('erro')]
primeiro_alerta = {}
for n, c in conf:
    for pid in c.get('acertos') or []: primeiro_alerta.setdefault(pid, n)
falsos = sorted({pid for _, c in conf for pid in c.get('falsos_alarmes') or []})
ultimo = conf[-1][1] if conf else {}
fora_pct = {g: (T[g]['fora_plano_l'] / (T[g]['fora_plano_l'] + T[g]['plano_l']) * 100 if (T[g]['fora_plano_l'] + T[g]['plano_l']) else 0) for g in ('mais', 'com')}
cobr = {g: RES[g].get('cobrancas', []) for g in GR}


# ------------------------------------------------------------------ F3: prazos das multas
nic_sem = {g: [sum(1 for e in G[g]['eventos'] for mu in e['multas'] if (mu.get('nic') or {}).get('semana') == n) for n in semanas] for g in GR}
mult_sem = {g: [rel[(n, g)]['semana']['multas_cometidas'] for n in semanas] for g in GR}


# ------------------------------------------------------------------ gráficos (SVG, uma escala por gráfico; dica no hover de cada marca)
def barra(x, base, w, h, cls, titulo):
    if h <= 0: return ''
    r = min(4.0, w / 2, h)
    d = f'M{x:.1f},{base:.1f}V{base - h + r:.1f}Q{x:.1f},{base - h:.1f} {x + r:.1f},{base - h:.1f}H{x + w - r:.1f}Q{x + w:.1f},{base - h:.1f} {x + w:.1f},{base - h + r:.1f}V{base:.1f}Z'
    return f'<path d="{d}" class="{cls}"><title>{esc(titulo)}</title></path>'


def grafico_barras(series, rotulo, unidade):
    W, H, ml, mr, mt, mb = 640, 220, 34, 8, 12, 28
    vmax = max([v for _, vals, _ in series for v in vals] + [1]); passo = 1 if vmax <= 5 else 5 if vmax <= 25 else 10 if vmax <= 60 else 20
    topo = ((int(vmax) + passo - 1) // passo) * passo
    n = len(series[0][1]); iw, ih = W - ml - mr, H - mt - mb; gw = iw / n; bw = min(12, (gw * 0.78 - 2 * (len(series) - 1)) / len(series))
    y = lambda v: mt + ih - v / topo * ih
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{esc(rotulo)}" class="chart">']
    for t in range(0, topo + 1, passo):
        out.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(t):.1f}" y2="{y(t):.1f}" class="grid"/>'
                   f'<text x="{ml - 6}" y="{y(t) + 4:.1f}" text-anchor="end" class="tick">{t}</text>')
    for i in range(n):
        cx = ml + gw * i + gw / 2; x0 = cx - (len(series) * bw + 2 * (len(series) - 1)) / 2
        for j, (cls, vals, nome) in enumerate(series):
            out.append(barra(x0 + j * (bw + 2), mt + ih, bw, mt + ih - y(vals[i]), cls, f'Semana {semanas[i]}, {nome}: {vals[i]} {unidade}'))
        out.append(f'<text x="{cx:.1f}" y="{H - 10}" text-anchor="middle" class="tick">{semanas[i]}</text>')
    out.append('</svg>')
    return ''.join(out)


def grafico_linhas(series, lo, hi, passo, rotulo, fmt):
    W, H, ml, mr, mt, mb = 640, 220, 52, 12, 12, 28
    iw, ih = W - ml - mr, H - mt - mb; n = len(series[0][1])
    x = lambda i: ml + (iw * i / (n - 1) if n > 1 else iw / 2)
    y = lambda v: mt + ih - (v - lo) / (hi - lo) * ih
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{esc(rotulo)}" class="chart">']
    t = lo
    while t <= hi + 1e-9:
        out.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(t):.1f}" y2="{y(t):.1f}" class="grid"/>'
                   f'<text x="{ml - 6}" y="{y(t) + 4:.1f}" text-anchor="end" class="tick">{fmt(t)}</text>')
        t += passo
    for i in range(n): out.append(f'<text x="{x(i):.1f}" y="{H - 10}" text-anchor="middle" class="tick">{semanas[i]}</text>')
    for cls, vals, nome in series:
        pts = ' '.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(vals))
        out.append(f'<polyline points="{pts}" class="{cls}" fill="none"/>')
        for i, v in enumerate(vals):
            out.append(f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="{4 if i == n - 1 else 2.5}" class="{cls}-pt"><title>Semana {semanas[i]}, {esc(nome)}: {fmt(v)}</title></circle>')
    out.append('</svg>')
    return ''.join(out)


def escala(vals, passos=5):
    hi = max(vals + [1]); bruto = hi / passos
    mag = 10 ** (len(str(int(bruto))) - 1) if bruto >= 1 else 1
    passo = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= bruto)
    return 0, -(-hi // passo) * passo, passo


SERIE = [('mais', 'mais'), ('com', 'com'), ('sem', 'sem')]
g_multas = grafico_barras([(f'b-{c}', mult_sem[g], NOME_LONGO[g]) for g, c in SERIE], 'Multas cometidas por semana', 'multas')
g_nic = grafico_barras([(f'b-{c}', nic_sem[g], NOME_LONGO[g]) for g, c in SERIE], 'NIC (multa por não indicar o condutor) por semana', 'NIC')
lo, hi, passo = escala([v for g in GR for v in serie_desv[g]])
g_desv = grafico_linhas([(f'l-{c}', serie_desv[g], NOME_LONGO[g]) for g, c in SERIE], lo, hi, passo,
                        'Diesel desviado acumulado (litros)', lambda v: num(v))
preco = {g: [rel[(n, g)]['semana'].get('diesel_preco_medio_pago') or 0 for n in semanas] for g in GR}
pr_all = [v for g in GR for v in preco[g] if v]
plo, phi = (min(pr_all) // 0.1 * 0.1 - 0.05, max(pr_all) // 0.1 * 0.1 + 0.15) if pr_all else (0, 1)
plo, phi = round(plo * 20) / 20, round(phi * 20) / 20
g_preco = grafico_linhas([(f'l-{c}', preco[g], NOME_LONGO[g]) for g, c in SERIE], plo, phi, 0.1, 'Preço médio pago pelo litro de diesel por semana', lambda v: num(v, 2))


def legenda(extra):
    return ('<div class="legenda">' + ''.join(f'<span><i style="background:var(--{c})"></i>{esc(NOME_LONGO[g])}</span>' for g, c in SERIE)
            + f'<span>{esc(extra)}</span></div>')


# ------------------------------------------------------------------ tabelas
def chip(a, b, menor_melhor=True):
    if a == b or not b: return ''
    d = pct(a, b); bom = (a < b) if menor_melhor else (a > b)
    return f'<span class="chip {"ok" if bom else "ruim"}">{"−" if d < 0 else "+"}{num(abs(d), 0 if abs(d) >= 10 else 1)}%</span>'


def linha3(nome, chave, fmt, menor_melhor=True, nota=''):
    a, b, c = P[chave], A[chave], B[chave]
    return (f'<tr><th scope="row">{nome}{f"<small>{nota}</small>" if nota else ""}</th><td>{fmt(a)}</td><td>{fmt(b)}</td><td>{fmt(c)}</td>'
            f'<td>{chip(a, b, menor_melhor)}</td></tr>')


i0 = lambda v: num(v); r3 = lambda v: 'R$ ' + num(v, 3); b0 = lambda v: brl(v)
tabela = ''.join([
    linha3('Viagens feitas', 'viagens', i0, menor_melhor=False),
    linha3('Multas', 'multas', i0),
    linha3('Multas pagas', 'multas_pago', b0, nota='com o desconto de pagar no prazo (e o do SNE)'),
    linha3('NIC (condutor não indicado)', 'nic', i0, nota='a empresa paga o valor da multa × as multas iguais em 12 meses'),
    linha3('NIC pagas', 'nic_pago', b0),
    linha3('Pontos na CNH (soma)', 'pontos', i0, nota='só vão para o motorista quando o condutor é indicado'),
    linha3('Voltas por rua proibida', 'retornos', i0),
    linha3('Batidas em viaduto', 'colisoes', i0),
    linha3('Entregas atrasadas', 'atrasos', i0),
    linha3('Passagens por trecho proibido', 'passagens', i0, nota='inclui as que não viraram multa'),
    linha3('Diesel consumido (litros)', 'diesel_l', i0),
    linha3('Preço médio pago pelo litro', 'diesel_preco', r3),
    linha3('Diesel desviado (litros)', 'desviado_l', i0, nota='cobrado da empresa e não posto no tanque'),
    linha3('Km a mais por trecho bloqueado', 'km_desvio', i0, nota='só a A+ bloqueia'),
])

itens_custo = [('Diesel (consumido × preço pago)', lambda g: RES[g]['diesel_custo_do_consumido_rs']),
               ('Diesel desviado (pago e não posto no tanque)', lambda g: RES[g]['diesel_desviado_rs']),
               ('Multas pagas', lambda g: RES[g]['multas_rs']),
               ('NIC pagas', lambda g: RES[g]['nic_rs']),
               ('Batidas em viaduto (R$ 30 mil cada)', lambda g: RES[g]['colisoes_rs']),
               ('Atrasos (R$ 150 por entrega atrasada)', lambda g: RES[g]['atrasos_rs']),
               ('Tempo do roteirista planejando', lambda g: RES[g]['planejamento_rs']),
               ('Custos das decisões (treinamentos, recursos, autorizações)', lambda g: RES[g]['decisoes_custos_rs']),
               ('Mensalidade do BrasaWay (R$ 30 por caminhão por mês)', lambda g: RES[g]['mensalidade_rs'])]
linhas_c = ''.join(f'<tr><th scope="row">{esc(t)}</th>' + ''.join(f'<td>{brl(f(g))}</td>' for g in GR) + f'<td>{brl(f("com") - f("mais"))}</td></tr>'
                   for t, f in itens_custo)
tot = {g: sum(f(g) for _, f in itens_custo) for g in GR}
dif_mes = mensal(tot['com'] - tot['mais']); dif_mes_b = mensal(tot['sem'] - tot['mais'])

f1_rows = ''.join(
    f'<tr><th scope="row">{esc(l["nome"][:90])}<small>bloqueado na semana {l["semana"]}'
    f'{f", tirado na semana {l["removido"]}" if l["removido"] else ""}</small></th>'
    f'<td>{l["multas_A"]}</td><td>{l["multas_P"]}</td><td>{l["viagens"]}</td><td>{num(l["km"])}</td></tr>' for l in f1_linhas) \
    or '<tr><th scope="row">A equipe da A+ não bloqueou nenhum trecho.</th><td></td><td></td><td></td><td></td></tr>'
f2_rows = ''.join(f'<tr><th scope="row">{esc(pid)}</th>' + ''.join(
    f'<td>{esc(parou(g, pid)[0])}<small>{num(parou(g, pid)[1])} L</small></td>' for g in GR)
    + f'<td>{f"semana {primeiro_alerta[pid]}" if pid in primeiro_alerta else "não apontou"}</td></tr>' for pid in desv)

dec = {g: collections.Counter() for g in GR}
for n in semanas:
    for g in GR:
        p = OUT / 'decisoes' / f'semana_{n}_{g}.json'
        if p.exists():
            for a in json.loads(p.read_text()).get('acoes', []): dec[g][a.get('acao')] += 1
NOME_ACAO = {'orientar': 'Orientar sobre um trecho', 'feedback': 'Conversa sobre multa (feedback)', 'renegociar_janela': 'Renegociar janela com o cliente',
             'mudar_horario': 'Mudar horário de saída', 'suspender_linha': 'Suspender linha', 'reativar_linha': 'Reativar linha',
             'exigir_app': 'Exigir o uso do app', 'treinamento': 'Treinamento', 'advertir': 'Advertência', 'trocar_veiculo': 'Trocar veículo',
             'cadastrar_aetc': 'Tirar AETC (VUC)', 'convenio_pix': 'Convênio PIX com postos', 'recorrer_multas': 'Recorrer de multas', 'nenhuma': 'Nada a mudar',
             'indicar_condutor': 'Indicar o condutor', 'cobrar_abastecimento': 'Cobrar abastecimento', 'aderir_sne': 'Aderir ao SNE',
             'bloquear_trecho': 'Bloquear trecho para a frota', 'desbloquear_trecho': 'Desbloquear trecho'}
total_dec = dec['mais'] + dec['com'] + dec['sem']
acoes_rows = ''.join(f'<tr><th scope="row">{esc(NOME_ACAO.get(k, k))}</th>' + ''.join(f'<td>{dec[g].get(k, 0)}</td>' for g in GR) + '</tr>'
                     for k, _ in total_dec.most_common() if k)
semana_rows = ''.join(
    f'<tr><th scope="row">{n}</th>' + ''.join(f'<td>{mult_sem[g][i]}</td>' for g in GR) + ''.join(f'<td>{nic_sem[g][i]}</td>' for g in GR)
    + ''.join(f'<td>{num(serie_desv[g][i])}</td>' for g in GR) + ''.join(f'<td>{num(preco[g][i], 3)}</td>' for g in GR) + '</tr>'
    for i, n in enumerate(semanas))
prem_rows = ''.join(f'<tr><th scope="row">{esc(p["nome"])}<small>{esc(p["id"])}</small></th><td class="txt">{esc(p["valor"])}</td><td class="txt">{esc(p["texto"])}</td></tr>'
                    for p in RES.get('premissas', []))
cab3 = ''.join(f'<th scope="col"{" class=c" if g == "mais" else ""}>{NOME[g]}</th>' for g in GR)
sne_txt = {g: (f'aderiu em {fmt_data(T[g]["sne"])} (semana {semana_de(T[g]["sne"])})' if T[g]['sne'] else 'não aderiu') for g in GR}

pagina = f'''<title>BrasaWay 3.0 em 90 dias</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: o mesmo boletim de frota da 2.0. Placa verde de rodovia = BrasaWay (A); placa azul de serviço = A+, as novidades; cinza-asfalto = sem o app (B). */
:root {{
  --bg: #f6f7f5; --surface: #ffffff; --ink: #1d2320; --muted: #5a645f; --line: #dde2de;
  --com: #0b6b3a; --mais: #2a63b0; --sem: #8a8f8c; --rota: #c08a1e; --ok: #0b6b3a; --ruim: #b3401f; --chip-ok: #e1f0e6; --chip-ruim: #f7e3dc; --placa-bg: #0b6b3a; --placa-fg: #ffffff;
  --placa2-bg: #1f4f8f;
  --display: "Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif;
  --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg: #121614; --surface: #1a201d; --ink: #e6ebe8; --muted: #9aa49f; --line: #2c3430;
  --com: #34a56a; --mais: #3f7fd6; --sem: #6b726e; --rota: #d9a441; --ok: #3fb878; --ruim: #e2774f; --chip-ok: #173826; --chip-ruim: #3d2117; --placa-bg: #17482f; --placa-fg: #eaf5ee; --placa2-bg: #1b3a63; color-scheme: dark }} }}
:root[data-theme="dark"] {{
  --bg: #121614; --surface: #1a201d; --ink: #e6ebe8; --muted: #9aa49f; --line: #2c3430;
  --com: #34a56a; --mais: #3f7fd6; --sem: #6b726e; --rota: #d9a441; --ok: #3fb878; --ruim: #e2774f; --chip-ok: #173826; --chip-ruim: #3d2117; --placa-bg: #17482f; --placa-fg: #eaf5ee; --placa2-bg: #1b3a63; color-scheme: dark }}
body {{ background: var(--bg); color: var(--ink); font: 400 15px/1.6 var(--body); }}
.wrap {{ max-width: 900px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 40px 64px; display: grid; gap: 44px; }}
h1, h2 {{ font-family: var(--display); font-weight: 700; letter-spacing: .005em; text-wrap: balance; margin: 0; line-height: 1.1; }}
h1 {{ font-size: clamp(2.1rem, 6vw, 3.2rem); }}
h2 {{ font-size: 1.6rem; }}
p {{ margin: 0; max-width: 68ch; }}
section {{ display: grid; gap: 16px; min-width: 0; }}
.eyebrow {{ font: 600 .75rem/1 var(--mono); text-transform: uppercase; letter-spacing: .12em; color: var(--com); }}
.eyebrow.mais {{ color: var(--mais); }}
.lead {{ font-size: 1.08rem; color: var(--ink); }}
.muted {{ color: var(--muted); }}
.placa {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }}
.placa div {{ background: var(--placa2-bg); color: var(--placa-fg); border-radius: 6px; padding: 14px 16px; display: grid; gap: 4px; }}
.placa b {{ font: 700 2rem/1 var(--display); }}
.placa span {{ font-size: .86rem; line-height: 1.35; opacity: .92; }}
.scroll {{ overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }}
table {{ border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }}
th, td {{ padding: 9px 12px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }}
th[scope="row"] {{ text-align: left; font-weight: 500; white-space: normal; min-width: 11em; }}
td.txt {{ text-align: left; white-space: normal; font-family: var(--body); font-size: .86rem; min-width: 14em; }}
td small {{ display: block; color: var(--muted); font-size: .76rem; }}
thead th:first-child {{ text-align: left; }}
@media (max-width: 520px) {{ th, td {{ padding: 8px 9px; }} td {{ font-size: .84rem; }} }}
th[scope="row"] small {{ display: block; color: var(--muted); font-weight: 400; font-size: .8rem; }}
thead th {{ font: 600 .72rem/1.2 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }}
thead th.c {{ color: var(--mais); }}
tr:last-child th, tr:last-child td {{ border-bottom: 0; }}
td {{ font-family: var(--mono); font-size: .9rem; }}
.chip {{ font: 600 .78rem/1 var(--mono); padding: 4px 7px; border-radius: 4px; }}
.chip.ok {{ background: var(--chip-ok); color: var(--ok); }}
.chip.ruim {{ background: var(--chip-ruim); color: var(--ruim); }}
.chart {{ width: 100%; height: auto; display: block; }}
.chart .grid {{ stroke: var(--line); stroke-width: 1; }}
.chart .tick {{ fill: var(--muted); font: 400 11px var(--mono); }}
.chart .b-com {{ fill: var(--com); }} .chart .b-mais {{ fill: var(--mais); }} .chart .b-sem {{ fill: var(--sem); }}
.chart path:hover, .chart circle:hover {{ opacity: .8; }}
.chart .l-com {{ stroke: var(--com); stroke-width: 2; }} .chart .l-com-pt {{ fill: var(--com); stroke: var(--surface); stroke-width: 2; }}
.chart .l-mais {{ stroke: var(--mais); stroke-width: 2; }} .chart .l-mais-pt {{ fill: var(--mais); stroke: var(--surface); stroke-width: 2; }}
.chart .l-sem {{ stroke: var(--sem); stroke-width: 2; }} .chart .l-sem-pt {{ fill: var(--sem); stroke: var(--surface); stroke-width: 2; }}
.legenda {{ display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: .85rem; color: var(--muted); }}
.legenda i {{ display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }}
.fig {{ background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 16px; display: grid; gap: 10px; min-width: 0; }}
.duas {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }}
ul {{ margin: 0; padding-left: 1.2em; display: grid; gap: 8px; max-width: 70ch; }}
footer {{ font-size: .85rem; color: var(--muted); display: grid; gap: 8px; }}
</style>
<main class="wrap">
<header style="display:grid;gap:14px">
  <div class="eyebrow mais">Simulação 3.0 · {NS} semanas · 100 motoristas por empresa</div>
  <h1>BrasaWay 3.0: as três novidades na mesma frota</h1>
  <p class="lead">Três transportadoras iguais, com os mesmos 100 motoristas, as mesmas linhas e a mesma sorte em cada viagem, rodaram de 1º de setembro a {esc(fmt_data(HOJE)) or "novembro"}. A <b>A+</b> usou o BrasaWay com as três novidades: trechos bloqueados pela empresa, conferência do diesel e prazos das multas no automático. A <b>A</b> usou o BrasaWay como na simulação 2.0. A <b>B</b> seguiu sem sistema. Toda semana, uma equipe interna de cada empresa (roteirista, financeiro e gerente, cada um um agente) leu o próprio relatório e decidiu o que mudar.</p>
  <div class="placa">
    <div><b>{brl(dif_mes)}</b><span>por mês a menos na A+ do que na A, na frota de 100 caminhões ({brl(dif_mes / 100)} por caminhão)</span></div>
    <div><b>{P["nic"]} × {A["nic"]}</b><span>NIC pagas pela A+ e pela A ({brl(P["nic_pago"])} contra {brl(A["nic_pago"])})</span></div>
    <div><b>{num(P["desviado_l"])} × {num(A["desviado_l"])}</b><span>litros de diesel desviados na A+ e na A (na B, {num(B["desviado_l"])})</span></div>
    <div><b>{P["multas"]} × {A["multas"]} × {B["multas"]}</b><span>multas na A+, na A e na B</span></div>
  </div>
</header>

<section>
  <div class="eyebrow">Resultado</div>
  <h2>Os números das {NS} semanas</h2>
  <div class="scroll"><table>
    <thead><tr><th scope="col"></th>{cab3}<th scope="col">A+ × A</th></tr></thead>
    <tbody>{tabela}</tbody>
  </table></div>
  <p class="muted">A coluna A+ × A mostra quanto a A+ ficou acima ou abaixo da A. A B é a referência de quem não usa nenhum sistema.</p>
</section>

<section>
  <div class="eyebrow">Dinheiro</div>
  <h2>Onde cada empresa gastou</h2>
  <p>Custos que mudam com a ferramenta e com o modelo novo de multas e diesel, em {dias} dias, para 100 caminhões. O salário dos motoristas ficou praticamente igual nas três e não entra aqui.</p>
  <div class="scroll"><table>
    <thead><tr><th scope="col"></th>{cab3}<th scope="col">A+ gastou a menos que a A</th></tr></thead>
    <tbody>{linhas_c}<tr><th scope="row"><b>Total</b></th>{"".join(f"<td><b>{brl(tot[g])}</b></td>" for g in GR)}<td><b>{brl(tot["com"] - tot["mais"])}</b></td></tr></tbody>
  </table></div>
  <p class="muted">Por mês, a A+ gastou {brl(dif_mes)} a menos que a A e {brl(dif_mes_b)} a menos que a B.</p>
</section>

<section>
  <div class="eyebrow mais">Novidade 1</div>
  <h2>Trechos bloqueados: a rota de todos desvia</h2>
  <p>Alguns trechos proibidos não têm alternativa razoável: a rota do app passa por eles e avisa. Na 2.0, orientar motorista por motorista não resolvia. Na A+, a equipe trava o trecho para a frota inteira e a rota de todos desvia dele quando existe qualquer caminho, pagando alguns km a mais. Abaixo, cada trecho bloqueado pela A+ e o que aconteceu nele, nas mesmas semanas, na A (que não tem o bloqueio).</p>
  <div class="scroll"><table>
    <thead><tr><th scope="col">Trecho</th><th scope="col">Multas na A</th><th scope="col" class="c">Multas na A+</th><th scope="col" class="c">Viagens que desviaram</th><th scope="col" class="c">Km a mais</th></tr></thead>
    <tbody>{f1_rows}</tbody>
  </table></div>
  <ul>
    <li>Nos trechos bloqueados, enquanto valeu o bloqueio: <b>{f1["multas_A"]}</b> multas na A contra <b>{f1["multas_P"]}</b> na A+ ({f1["pass_A"]} contra {f1["pass_P"]} passagens), {brl(f1["pago_A"] - f1["pago_P"])} a menos pagos em multas e NIC.</li>
    <li>O desvio custou <b>{num(P["km_desvio"])} km</b> a mais, cerca de {brl(P["km_desvio_rs"])} em diesel e hora de motorista (já dentro do diesel e das horas da A+). Saldo da novidade: <b>{brl(f1_saldo)}</b>.</li>
    <li>Multas em trechos “sem alternativa” da rota do app, em todos os trechos: {P["restrito_app"]} na A+, {A["restrito_app"]} na A. A chave desses trechos agora é o id real do item (na 2.0, ruas diferentes caíam na mesma chave e a equipe não conseguia apontar o trecho).</li>
  </ul>
</section>

<section>
  <div class="eyebrow mais">Novidade 2</div>
  <h2>Conferência do diesel: achar quem desvia</h2>
  <p>Quatro motoristas, os mesmos nas três empresas, cobram 8% a mais de litros do que põem no tanque. Sem conferência, a empresa só vê que comprou mais diesel do que o km explicaria, sem saber de quem. O painel da A+ compara, por placa e por motorista, os litros esperados pelo km com os comprados, e aponta compra fora do plano de abastecimento.</p>
  <div class="fig">
    {legenda("diesel desviado acumulado, em litros")}
    {g_desv}
  </div>
  <div class="scroll"><table>
    <thead><tr><th scope="col">Motorista que desvia</th>{cab3}<th scope="col" class="c">Painel da A+ apontou</th></tr></thead>
    <tbody>{f2_rows}</tbody>
  </table></div>
  <ul>
    <li>Diesel desviado: {num(P["desviado_l"])} L ({brl(P["desviado_rs"])}) na A+, {num(A["desviado_l"])} L ({brl(A["desviado_rs"])}) na A e {num(B["desviado_l"])} L ({brl(B["desviado_rs"])}) na B.</li>
    <li>Falsos alarmes do painel (motorista apontado sem desviar, por consumo acima do normal ou nível do tanque): {", ".join(falsos) if falsos else "nenhum"}.{f' Na última conferência, o painel somou {num(ultimo.get("litros_comprados_painel") or 0)} L comprados e a simulação enviou {num(ultimo.get("litros_cobrados_sim") or 0)} L na mesma janela.' if ultimo else ''}</li>
    <li>Compra fora do posto do plano, seguindo a rota do app: {num(fora_pct["mais"], 1)}% dos litros na A+ e {num(fora_pct["com"], 1)}% na A. Cobranças feitas pela equipe: {len(cobr["mais"])} na A+, {len(cobr["com"])} na A, {len(cobr["sem"])} na B.</li>
  </ul>
  <div class="fig">
    {legenda("preço médio pago pelo litro, por semana")}
    {g_preco}
  </div>
</section>

<section>
  <div class="eyebrow mais">Novidade 3</div>
  <h2>Prazos das multas: indicar o condutor a tempo</h2>
  <p>A notificação da multa chega pelo correio umas 3 semanas depois; uma parte atrasa e uma parte se perde. A empresa tem 30 dias da chegada para indicar quem dirigia. Se não indica, paga a NIC: o valor da multa vezes o número de multas iguais em 12 meses. Na A+, o sistema indica o condutor sozinho até 2 dias depois da notificação, e o painel recomenda aderir ao SNE: a notificação eletrônica não atrasa nem se perde, e a multa sem recurso sai com 40% de desconto em vez de 20%.</p>
  <div class="fig">
    {legenda("NIC por semana")}
    {g_nic}
  </div>
  <ul>
    <li>NIC: <b>{P["nic"]}</b> na A+ ({brl(P["nic_pago"])}), <b>{A["nic"]}</b> na A ({brl(A["nic_pago"])}) e <b>{B["nic"]}</b> na B ({brl(B["nic_pago"])}). Por notificação extraviada: {RES["mais"]["nic_notificacao_perdida"]} na A+, {RES["com"]["nic_notificacao_perdida"]} na A, {RES["sem"]["nic_notificacao_perdida"]} na B.</li>
    <li>SNE: a A+ {sne_txt["mais"]}; a A {sne_txt["com"]}; a B {sne_txt["sem"]}. Desconto nas multas pagas: {brl(P["desconto"])} na A+, {brl(A["desconto"])} na A, {brl(B["desconto"])} na B.</li>
    <li>Notificações extraviadas: {P["perdidas"]} na A+, {A["perdidas"]} na A, {B["perdidas"]} na B; atrasadas: {P["atrasadas"]}, {A["atrasadas"]} e {B["atrasadas"]}. No fim, ainda corriam no prazo {P["pendentes_fim"]}, {A["pendentes_fim"]} e {B["pendentes_fim"]} multas sem indicação.</li>
    <li>O outro lado: condutor indicado leva os pontos. A A+ tem {P["pontos"]} pontos na CNH dos motoristas ({P["mot_20"]} com 20 ou mais), contra {A["pontos"]} na A ({A["mot_20"]}): a empresa que não indica paga a NIC, mas os pontos não chegam a ninguém.</li>
  </ul>
  <div class="fig">
    {legenda("multas cometidas, por semana")}
    {g_multas}
  </div>
</section>

<section>
  <div class="eyebrow">Equipe</div>
  <h2>O que as equipes decidiram</h2>
  <p>As decisões foram tomadas toda semana por agentes no papel de roteirista, financeiro e gerente, só com o que cada empresa enxerga. A A+ tinha o painel com as novidades; a A, o painel da 2.0; a B, a planilha e as notificações do correio.</p>
  <div class="scroll"><table>
    <thead><tr><th scope="col">Decisão</th>{cab3}</tr></thead>
    <tbody>{acoes_rows}</tbody>
  </table></div>
</section>

<section>
  <div class="eyebrow">Semana a semana</div>
  <h2>Todas as semanas</h2>
  <div class="scroll"><table>
    <thead><tr><th scope="col">Sem.</th><th scope="col" class="c">Multas A+</th><th scope="col">Multas A</th><th scope="col">Multas B</th><th scope="col" class="c">NIC A+</th><th scope="col">NIC A</th><th scope="col">NIC B</th>
      <th scope="col" class="c">Desviado A+</th><th scope="col">Desviado A</th><th scope="col">Desviado B</th><th scope="col" class="c">Diesel A+</th><th scope="col">Diesel A</th><th scope="col">Diesel B</th></tr></thead>
    <tbody>{semana_rows}</tbody>
  </table></div>
  <p class="muted">Desviado: diesel desviado acumulado, em litros. Diesel: preço médio pago pelo litro, em R$.</p>
</section>

<section>
  <div class="eyebrow">Premissas</div>
  <h2>O que foi suposto, e com que valor</h2>
  <p>Valem para as três empresas, salvo indicado. Mudar uma premissa muda os números; por isso elas estão aqui, com os valores usados.</p>
  <div class="scroll"><table>
    <thead><tr><th scope="col">Premissa</th><th scope="col">Valor</th><th scope="col">O que significa</th></tr></thead>
    <tbody>{prem_rows}</tbody>
  </table></div>
</section>

<footer>
  <p><b>Como foi feito.</b> Cada motorista existe nas três empresas com a mesma persona (hábitos, veículo, linhas e horários) e o mesmo sorteio em cada viagem; só muda a ferramenta. Nas empresas A e A+, a rota vem da API do BrasaWay (restrições de altura, peso, horário, zonas e perigosos; na A+, também os trechos que a empresa bloqueou) e as viagens, abastecimentos e multas passam pelo painel da frota de verdade, que fez a conferência do diesel e os prazos da A+. Na B, a rota é a de GPS de carro, e o trajeto é conferido contra as mesmas restrições. Multa, volta, batida, notificação extraviada e desvio de diesel são sorteados com as premissas acima. Os preços de diesel vêm da ANP por posto, e a aceitação dos convênios PIX também é sorteada.</p>
  <p>É uma simulação: os números servem para comparar as empresas, não para prometer valores exatos a um cliente.</p>
</footer>
</main>
'''
DEST.parent.mkdir(parents=True, exist_ok=True)
DEST.write_text(pagina)
print(f'{DEST} ({NS} semanas): custo total A+ {tot["mais"]:,.0f} × A {tot["com"]:,.0f} × B {tot["sem"]:,.0f}; NIC {P["nic"]}×{A["nic"]}×{B["nic"]}; '
      f'desviado {P["desviado_l"]}×{A["desviado_l"]}×{B["desviado_l"]} L; F1 multas {f1["multas_A"]}→{f1["multas_P"]}, km {P["km_desvio"]}')
