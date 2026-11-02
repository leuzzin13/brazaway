#!/usr/bin/env python3
"""Relatório da simulação 2.0 (com × sem BrasaWay, 100 motoristas cada) em HTML.
Lê sim/out2/estado.json, os relatórios semanais e as decisões; escreve docs/simulacao/relatorio_90_dias.html.
Uso: python3 sim/relatorio_final2.py"""
import collections, html, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'sim' / 'out2'
DEST = ROOT / 'docs' / 'simulacao' / 'relatorio_90_dias.html'

st = json.loads((OUT / 'estado.json').read_text())
G = st['grupos']
semanas = sorted({e['semana'] for e in G['com']['eventos']})
NS = len(semanas)
rel = {(n, g): json.loads((OUT / 'relatorios' / f'semana_{n}_{g}.json').read_text())['semana'] for n in semanas for g in ('com', 'sem')}
HOJE = json.loads((OUT / 'relatorios' / f'semana_{semanas[-1]}_com.json').read_text()).get('hoje', '')



def esc(s): return html.escape(str(s))
def brl(v, casas=0): return ('−' if v < 0 else '') + 'R$ ' + f'{abs(v):,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
def num(v, casas=0): return f'{v:,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
def fmt_data(iso): return f'{iso[8:10]}/{iso[5:7]}/{iso[:4]}' if len(iso) >= 10 else iso
def pct(a, b): return (a - b) / b * 100 if b else 0.0


# ------------------------------------------------------------------ totais
def totais(g):
    evs = G[g]['eventos']; mult = [mu for e in evs for mu in e['multas']]
    cons = sum(e.get('diesel_consumido_l', 0) for e in evs); compr = sum(e.get('diesel_comprado_l', 0) for e in evs)
    gasto = sum(e.get('diesel_gasto_rs', 0) for e in evs)
    preco = gasto / compr if compr else 0
    pts = {pid: sum(x['pontos'] for x in m['pontos']) for pid, m in G[g]['motoristas'].items()}
    return {
        'viagens': len(evs), 'km': sum(e['km'] for e in evs),
        'multas': len(mult), 'multas_rs': sum(mu['valor'] for mu in mult), 'pontos': sum(pts.values()),
        'mot_20': sum(1 for v in pts.values() if v >= 20), 'presenciais': sum(1 for mu in mult if mu.get('presencial')),
        'retornos': sum(e['retornos'] for e in evs), 'colisoes': sum(e['colisoes'] for e in evs),
        'atrasos': sum(e['atraso'] for e in evs), 'passagens': sum(len(e['violacoes']) for e in evs),
        'diesel_l': cons, 'diesel_preco': preco, 'diesel_custo': cons * preco,
        'alertas': sum(e.get('evitadas_alerta', 0) for e in evs),
        'ignorando': sum(1 for e in evs if e.get('rota') == 'ignorou_app'),
        'conveniados': len(G[g].get('conveniados', [])),
    }


T = {g: totais(g) for g in ('com', 'sem')}
RES = json.loads((OUT / 'resultado.json').read_text()) if (OUT / 'resultado.json').exists() else None
C, S = T['com'], T['sem']
eco_diesel = S['diesel_preco'] * C['diesel_l'] - C['diesel_custo']          # o mesmo volume da A ao preço que a B pagou
eco_multas = S['multas_rs'] - C['multas_rs']

# de onde vieram as multas que sobraram na A
orig = collections.Counter()
for e in G['com']['eventos']:
    for mu in e['multas']:
        k = mu['k']
        if e.get('rota') == 'ignorou_app': orig['ignorou'] += 1
        elif k.startswith('sem_alt'): orig['sem_alt'] += 1
        elif k.startswith('zona_destino'): orig['destino'] += 1
        else: orig['outro'] += 1

# diesel da A: quem seguiu o plano × quem ignorou o app
seg = {'plano': [0.0, 0.0], 'ignorou': [0.0, 0.0]}
for e in G['com']['eventos']:
    k = 'ignorou' if e.get('rota') == 'ignorou_app' else 'plano'
    seg[k][0] += e.get('diesel_comprado_l', 0); seg[k][1] += e.get('diesel_gasto_rs', 0)
preco_plano = seg['plano'][1] / seg['plano'][0] if seg['plano'][0] else 0
preco_ign = seg['ignorou'][1] / seg['ignorou'][0] if seg['ignorou'][0] else 0

# decisões da equipe
dec = {g: collections.Counter() for g in ('com', 'sem')}
for n in semanas:
    for g in ('com', 'sem'):
        p = OUT / 'decisoes' / f'semana_{n}_{g}.json'
        if p.exists():
            for a in json.loads(p.read_text()).get('acoes', []): dec[g][a.get('acao')] += 1
NOME_ACAO = {'orientar': 'Orientar sobre um trecho', 'feedback': 'Conversa sobre multa (feedback)', 'renegociar_janela': 'Renegociar janela com o cliente',
             'mudar_horario': 'Mudar horário de saída', 'suspender_linha': 'Suspender linha', 'reativar_linha': 'Reativar linha',
             'exigir_app': 'Exigir o uso do app', 'treinamento': 'Treinamento', 'advertir': 'Advertência', 'trocar_veiculo': 'Trocar veículo',
             'cadastrar_aetc': 'Tirar AETC (VUC)', 'convenio_pix': 'Convênio PIX com postos', 'recorrer_multas': 'Recorrer de multas', 'nenhuma': 'Nada a mudar'}


# ------------------------------------------------------------------ gráficos (SVG, uma escala por gráfico)
def grafico_barras(serie_a, serie_b, rotulo):
    W, H, ml, mr, mt, mb = 640, 220, 34, 8, 12, 28
    vmax = max(serie_a + serie_b + [1]); passo = 5 if vmax <= 25 else 10
    topo = ((vmax + passo - 1) // passo) * passo
    iw, ih = W - ml - mr, H - mt - mb; gw = iw / len(serie_a); bw = min(16, gw * 0.32)
    y = lambda v: mt + ih - v / topo * ih
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{esc(rotulo)}" class="chart">']
    for t in range(0, topo + 1, passo):
        out.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(t):.1f}" y2="{y(t):.1f}" class="grid"/>'
                   f'<text x="{ml - 6}" y="{y(t) + 4:.1f}" text-anchor="end" class="tick">{t}</text>')
    for i, (a, b) in enumerate(zip(serie_a, serie_b)):
        cx = ml + gw * i + gw / 2
        out.append(f'<rect x="{cx - bw - 1:.1f}" y="{y(a):.1f}" width="{bw:.1f}" height="{mt + ih - y(a):.1f}" class="b-com"><title>Semana {i + 1}, com BrasaWay: {a}</title></rect>')
        out.append(f'<rect x="{cx + 1:.1f}" y="{y(b):.1f}" width="{bw:.1f}" height="{mt + ih - y(b):.1f}" class="b-sem"><title>Semana {i + 1}, sem BrasaWay: {b}</title></rect>')
        out.append(f'<text x="{cx:.1f}" y="{H - 10}" text-anchor="middle" class="tick">{i + 1}</text>')
    out.append('</svg>')
    return ''.join(out)


def grafico_linhas(series, lo, hi, passo, rotulo, fmt):
    W, H, ml, mr, mt, mb = 640, 220, 46, 12, 12, 28
    iw, ih = W - ml - mr, H - mt - mb; n = len(series[0][1])
    x = lambda i: ml + (iw * i / (n - 1) if n > 1 else iw / 2)
    y = lambda v: mt + ih - (v - lo) / (hi - lo) * ih
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{esc(rotulo)}" class="chart">']
    t = lo
    while t <= hi + 1e-9:
        out.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(t):.1f}" y2="{y(t):.1f}" class="grid"/>'
                   f'<text x="{ml - 6}" y="{y(t) + 4:.1f}" text-anchor="end" class="tick">{fmt(t)}</text>')
        t += passo
    for i in range(n): out.append(f'<text x="{x(i):.1f}" y="{H - 10}" text-anchor="middle" class="tick">{i + 1}</text>')
    for cls, vals, nome in series:
        pts = ' '.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(vals))
        out.append(f'<polyline points="{pts}" class="{cls}" fill="none"/>')
        for i, v in enumerate(vals):
            out.append(f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="{4 if i == n - 1 else 2.5}" class="{cls}-pt"><title>Semana {i + 1}, {esc(nome)}: {fmt(v)}</title></circle>')
    out.append('</svg>')
    return ''.join(out)


mult_sem = [rel[(n, 'com')]['multas_cometidas'] for n in semanas], [rel[(n, 'sem')]['multas_cometidas'] for n in semanas]
atr_sem = [rel[(n, 'com')]['atrasos'] for n in semanas], [rel[(n, 'sem')]['atrasos'] for n in semanas]
preco_com = [rel[(n, 'com')]['diesel_preco_medio_pago'] for n in semanas]
preco_sem = [rel[(n, 'sem')]['diesel_preco_medio_pago'] for n in semanas]
preco_rota = [rel[(n, 'com')].get('diesel_preco_medio_das_rotas') or preco_sem[i] for i, n in enumerate(semanas)]
lo = min(preco_com + preco_sem + preco_rota) // 0.1 * 0.1 - 0.05; hi = max(preco_com + preco_sem + preco_rota) // 0.1 * 0.1 + 0.15
lo, hi = round(lo * 20) / 20, round(hi * 20) / 20

g_multas = grafico_barras(*mult_sem, 'Multas cometidas por semana')
g_atrasos = grafico_barras(*atr_sem, 'Entregas atrasadas por semana')
g_diesel = grafico_linhas([('l-sem', preco_sem, 'sem BrasaWay'), ('l-rota', preco_rota, 'média dos postos da rota'), ('l-com', preco_com, 'com BrasaWay')],
                          lo, hi, 0.1, 'Preço médio pago pelo litro de diesel por semana', lambda v: num(v, 2))


# ------------------------------------------------------------------ tabela principal
def linha(nome, a, b, fmt, menor_melhor=True, nota=''):
    d = pct(a, b) if b else 0
    bom = (a < b) if menor_melhor else (a > b)
    chip = '' if a == b or not b else f'<span class="chip {"ok" if bom else "ruim"}">{"−" if d < 0 else "+"}{num(abs(d), 0 if abs(d) >= 10 else 1)}%</span>'
    return f'<tr><th scope="row">{nome}{f"<small>{nota}</small>" if nota else ""}</th><td>{fmt(a)}</td><td>{fmt(b)}</td><td>{chip}</td></tr>'


i0 = lambda v: num(v); r2 = lambda v: 'R$ ' + num(v, 3)
tabela = ''.join([
    linha('Viagens feitas', C['viagens'], S['viagens'], i0, menor_melhor=False),
    linha('Multas', C['multas'], S['multas'], i0),
    linha('Valor das multas', C['multas_rs'], S['multas_rs'], brl),
    linha('Pontos na CNH (soma)', C['pontos'], S['pontos'], i0),
    linha('Motoristas com 20+ pontos', C['mot_20'], S['mot_20'], i0, nota='perto de perder a CNH'),
    linha('Voltas por rua proibida', C['retornos'], S['retornos'], i0, nota='altura ou peso: o caminhão não passa e volta'),
    linha('Batidas em viaduto', C['colisoes'], S['colisoes'], i0),
    linha('Entregas atrasadas', C['atrasos'], S['atrasos'], i0),
    linha('Passagens por trecho proibido', C['passagens'], S['passagens'], i0, nota='inclui as que não viraram multa'),
    linha('Diesel consumido (litros)', C['diesel_l'], S['diesel_l'], i0),
    linha('Preço médio pago pelo litro', C['diesel_preco'], S['diesel_preco'], r2),
    linha('Custo do diesel consumido', C['diesel_custo'], S['diesel_custo'], brl),
])

acoes_rows = ''.join(f'<tr><th scope="row">{esc(NOME_ACAO.get(k, k))}</th><td>{dec["com"].get(k, 0)}</td><td>{dec["sem"].get(k, 0)}</td></tr>'
                     for k, _ in (dec['com'] + dec['sem']).most_common() if k)
sobra = C['multas'] or 1
semana_rows = ''.join(
    f'<tr><th scope="row">{n}</th><td>{rel[(n, "com")]["multas_cometidas"]}</td><td>{rel[(n, "sem")]["multas_cometidas"]}</td>'
    f'<td>{rel[(n, "com")]["retornos"]}</td><td>{rel[(n, "sem")]["retornos"]}</td><td>{rel[(n, "com")]["atrasos"]}</td><td>{rel[(n, "sem")]["atrasos"]}</td>'
    f'<td>{num(rel[(n, "com")]["diesel_preco_medio_pago"], 3)}</td><td>{num(rel[(n, "sem")]["diesel_preco_medio_pago"], 3)}</td>'
    f'<td>{rel[(n, "com")].get("alertas_ao_vivo_que_evitaram") or 0}</td></tr>' for n in semanas)

dias = min(NS * 7, 90)          # a última semana tem 6 dias (90 dias no total)
mensal = lambda v: v / dias * 30
pct_mult = -pct(C['multas'], S['multas']); pct_dies = (S['diesel_preco'] - C['diesel_preco']) / S['diesel_preco'] * 100

secao_custos = ''
if RES:
    rc, rs = RES['com'], RES['sem']
    itens = [('Diesel (consumido × preço pago)', rc['diesel_custo_do_consumido_rs'], rs['diesel_custo_do_consumido_rs']),
             ('Multas', rc['multas_rs'], rs['multas_rs']),
             ('Atrasos (R$ 150 por entrega atrasada)', rc['atrasos_rs'], rs['atrasos_rs']),
             ('Tempo do roteirista planejando (3 × 12 min por viagem)', rc['planejamento_rs'], rs['planejamento_rs']),
             ('Custos das decisões (treinamentos, recursos, autorizações)', rc['decisoes_custos_rs'], rs['decisoes_custos_rs']),
             ('Mensalidade do BrasaWay (R$ 30 por caminhão por mês)', rc['mensalidade_rs'], rs['mensalidade_rs'])]
    linhas_c = ''.join(f'<tr><th scope="row">{esc(t)}</th><td>{brl(a)}</td><td>{brl(b)}</td><td>{brl(b - a)}</td></tr>' for t, a, b in itens)
    tot_a = sum(a for _, a, _ in itens); tot_b = sum(b for _, _, b in itens)
    secao_custos = f'''<section>
  <div class="eyebrow">Dinheiro</div>
  <h2>Onde a empresa A gastou menos</h2>
  <p>Custos que mudam com a ferramenta, em {dias} dias, para 100 caminhões. O salário e o tempo dos motoristas ficaram praticamente iguais nas duas e não entram aqui.</p>
  <div class="scroll"><table>
    <thead><tr><th scope="col"></th><th scope="col" class="c">Com BrasaWay</th><th scope="col">Sem BrasaWay</th><th scope="col">A gastou a menos</th></tr></thead>
    <tbody>{linhas_c}<tr><th scope="row"><b>Total</b></th><td><b>{brl(tot_a)}</b></td><td><b>{brl(tot_b)}</b></td><td><b>{brl(tot_b - tot_a)}</b></td></tr></tbody>
  </table></div>
  <p class="muted">Por mês, são {brl(mensal(tot_b - tot_a))} a menos. Por caminhão, {brl(mensal(tot_b - tot_a) / 100)} por mês, contra os R$ 30 da mensalidade.</p>
</section>'''

pagina = f'''<title>BrasaWay em 90 dias</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: relatório de uma coluna, como um boletim de frota; a placa verde de rodovia marca o que é BrasaWay, o cinza-asfalto o que não é. */
:root {{
  --bg: #f6f7f5; --surface: #ffffff; --ink: #1d2320; --muted: #5a645f; --line: #dde2de;
  --com: #0b6b3a; --sem: #8a8f8c; --rota: #c08a1e; --ok: #0b6b3a; --ruim: #b3401f; --chip-ok: #e1f0e6; --chip-ruim: #f7e3dc; --placa-bg: #0b6b3a; --placa-fg: #ffffff;
  --display: "Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif;
  --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg: #121614; --surface: #1a201d; --ink: #e6ebe8; --muted: #9aa49f; --line: #2c3430;
  --com: #3fb878; --sem: #8e9692; --rota: #d9a441; --ok: #3fb878; --ruim: #e2774f; --chip-ok: #173826; --chip-ruim: #3d2117; --placa-bg: #17482f; --placa-fg: #eaf5ee; color-scheme: dark }} }}
:root[data-theme="dark"] {{
  --bg: #121614; --surface: #1a201d; --ink: #e6ebe8; --muted: #9aa49f; --line: #2c3430;
  --com: #3fb878; --sem: #8e9692; --rota: #d9a441; --ok: #3fb878; --ruim: #e2774f; --chip-ok: #173826; --chip-ruim: #3d2117; --placa-bg: #17482f; --placa-fg: #eaf5ee; color-scheme: dark }}
body {{ background: var(--bg); color: var(--ink); font: 400 15px/1.6 var(--body); }}
.wrap {{ max-width: 860px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 40px 64px; display: grid; gap: 44px; }}
h1, h2 {{ font-family: var(--display); font-weight: 700; letter-spacing: .005em; text-wrap: balance; margin: 0; line-height: 1.1; }}
h1 {{ font-size: clamp(2.1rem, 6vw, 3.2rem); }}
h2 {{ font-size: 1.6rem; }}
p {{ margin: 0; max-width: 66ch; }}
section {{ display: grid; gap: 16px; min-width: 0; }}
.eyebrow {{ font: 600 .75rem/1 var(--mono); text-transform: uppercase; letter-spacing: .12em; color: var(--com); }}
.lead {{ font-size: 1.08rem; color: var(--ink); }}
.muted {{ color: var(--muted); }}
.placa {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }}
.placa div {{ background: var(--placa-bg); color: var(--placa-fg); border-radius: 6px; padding: 14px 16px; display: grid; gap: 4px; }}
.placa b {{ font: 700 2rem/1 var(--display); font-variant-numeric: tabular-nums; }}
.placa span {{ font-size: .86rem; line-height: 1.35; opacity: .92; }}
.scroll {{ overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }}
table {{ border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }}
th, td {{ padding: 9px 12px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }}
th[scope="row"] {{ text-align: left; font-weight: 500; white-space: normal; min-width: 11em; }}
thead th:first-child {{ text-align: left; }}
@media (max-width: 520px) {{ th, td {{ padding: 8px 9px; }} td {{ font-size: .84rem; }} }}
th[scope="row"] small {{ display: block; color: var(--muted); font-weight: 400; font-size: .8rem; }}
thead th {{ font: 600 .72rem/1.2 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }}
thead th.c {{ color: var(--com); }}
tr:last-child th, tr:last-child td {{ border-bottom: 0; }}
td {{ font-family: var(--mono); font-size: .9rem; }}
.chip {{ font: 600 .78rem/1 var(--mono); padding: 4px 7px; border-radius: 4px; }}
.chip.ok {{ background: var(--chip-ok); color: var(--ok); }}
.chip.ruim {{ background: var(--chip-ruim); color: var(--ruim); }}
.chart {{ width: 100%; height: auto; display: block; }}
.chart .grid {{ stroke: var(--line); stroke-width: 1; }}
.chart .tick {{ fill: var(--muted); font: 400 11px var(--mono); }}
.chart .b-com {{ fill: var(--com); }} .chart .b-sem {{ fill: var(--sem); }}
.chart .l-com {{ stroke: var(--com); stroke-width: 2.5; }} .chart .l-com-pt {{ fill: var(--com); }}
.chart .l-sem {{ stroke: var(--sem); stroke-width: 2.5; }} .chart .l-sem-pt {{ fill: var(--sem); }}
.chart .l-rota {{ stroke: var(--rota); stroke-width: 1.5; stroke-dasharray: 5 4; }} .chart .l-rota-pt {{ fill: var(--rota); }}
.legenda {{ display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: .85rem; color: var(--muted); }}
.legenda i {{ display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }}
.fig {{ background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 16px; display: grid; gap: 10px; min-width: 0; }}
.duas {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }}
ul {{ margin: 0; padding-left: 1.2em; display: grid; gap: 8px; max-width: 70ch; }}
.barra {{ display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; }}
.barra .t {{ height: 10px; background: var(--line); border-radius: 3px; overflow: hidden; grid-column: 1 / -1; }}
.barra .t i {{ display: block; height: 100%; background: var(--com); }}
.barra b {{ font: 500 .9rem var(--mono); }}
footer {{ font-size: .85rem; color: var(--muted); display: grid; gap: 8px; }}
</style>
<main class="wrap">
<header style="display:grid;gap:14px">
  <div class="eyebrow">Simulação 2.0 · {NS} semanas · 100 motoristas por empresa</div>
  <h1>BrasaWay em {dias} dias: a mesma frota, com e sem o app</h1>
  <p class="lead">Duas transportadoras iguais, com os mesmos 100 motoristas, as mesmas linhas, os mesmos horários e a mesma sorte, rodaram de 1º de setembro a {esc(fmt_data(HOJE)) if HOJE else "novembro"}. A empresa A usou o BrasaWay. A empresa B seguiu como sempre: planilha, WhatsApp e o GPS do celular. Toda semana, uma equipe interna (roteirista, financeiro e gerente, cada um um agente) leu o relatório e decidiu o que mudar.</p>
  <div class="placa">
    <div><b>−{num(pct_mult, 0)}%</b><span>multas ({C["multas"]} contra {S["multas"]})</span></div>
    <div><b>−{num(pct_dies, 1)}%</b><span>no preço do diesel ({r2(C["diesel_preco"])} contra {r2(S["diesel_preco"])} o litro)</span></div>
    <div><b>{brl(mensal(eco_diesel + eco_multas))}</b><span>por mês a menos em diesel e multas, na frota de 100 caminhões</span></div>
    <div><b>{C["retornos"]} × {S["retornos"]}</b><span>voltas por rua proibida para o caminhão</span></div>
  </div>
</header>

<section>
  <div class="eyebrow">Resultado</div>
  <h2>Os números das {NS} semanas</h2>
  <div class="scroll"><table>
    <thead><tr><th scope="col"></th><th scope="col" class="c">Com BrasaWay</th><th scope="col">Sem BrasaWay</th><th scope="col">Diferença</th></tr></thead>
    <tbody>{tabela}</tbody>
  </table></div>
  <p class="muted">A economia do diesel usa o volume que a empresa A consumiu ao preço médio que a empresa B pagou ({brl(eco_diesel)} em {dias} dias). A das multas é a diferença do valor das multas ({brl(eco_multas)}). Não entram aqui os pontos na CNH, o seguro e o tempo de quem cuida das multas.</p>
</section>

{secao_custos}

<section>
  <div class="eyebrow">Multas</div>
  <h2>As multas caem nas duas empresas, mas com o app ficam na metade ou menos</h2>
  <p>As duas equipes aprendem com as multas que chegam. A diferença é o tempo: a empresa B só sabe da multa quando a notificação chega pelo correio, umas 3 semanas depois. A empresa A vê a restrição antes da saída, recebe o alerta ao vivo quando o motorista sai da rota e registra a multa no app na hora.</p>
  <div class="fig">
    <div class="legenda"><span><i style="background:var(--com)"></i>Com BrasaWay</span><span><i style="background:var(--sem)"></i>Sem BrasaWay</span><span>multas cometidas, por semana</span></div>
    {g_multas}
  </div>
  <div class="duas">
    <div class="fig" style="align-content:start">
      <b>De onde vieram as {C["multas"]} multas que sobraram com o app</b>
      {''.join(f'<div class="barra"><span>{t}</span><b>{v}</b><div class="t"><i style="width:{v / sobra * 100:.0f}%"></i></div></div>' for t, v in [
          ("Motorista ignorou a rota do app", orig["ignorou"]),
          ("Destino sem acesso legal para o caminhão", orig["sem_alt"]),
          ("Entrega dentro de zona restrita no horário proibido", orig["destino"]),
          ("Outras", orig["outro"])] if v)}
    </div>
    <div class="fig" style="align-content:start">
      <b>O que o app fez nas viagens</b>
      <ul>
        <li><b>{num(C["alertas"])}</b> multas evitadas pelo alerta ao vivo: o motorista saiu da rota, o app apitou antes da restrição e ele voltou.</li>
        <li><b>{num(C["ignorando"])}</b> das {num(C["viagens"])} viagens ({num(C["ignorando"] / C["viagens"] * 100, 0)}%) foram feitas ignorando a rota do app. É o maior espaço para ganhar mais.</li>
        <li>Nos destinos sem acesso legal, o app avisa, mas não existe caminho. Isso se resolve com o cliente (horário), com autorização da prefeitura ou com veículo menor.</li>
      </ul>
    </div>
  </div>
</section>

<section>
  <div class="eyebrow">Diesel</div>
  <h2>Encher no posto barato da rota e pagar no PIX com desconto</h2>
  <p>Ao iniciar a viagem, o motorista informa quanto tem no tanque. O app monta o plano: em que posto da rota parar, quantos litros pôr e onde vale encher o tanque porque o preço está abaixo da média do caminho. Os postos com convênio PIX entram com o preço já descontado. A empresa A fechou convênio com <b>{C["conveniados"]}</b> postos ao longo da simulação.</p>
  <div class="fig">
    <div class="legenda"><span><i style="background:var(--com)"></i>Com BrasaWay</span><span><i style="background:var(--sem)"></i>Sem BrasaWay</span><span><i style="background:var(--rota)"></i>Média dos postos das rotas</span><span>R$ por litro, por semana</span></div>
    {g_diesel}
  </div>
  <div class="scroll"><table>
    <thead><tr><th scope="col">Empresa A, por tipo de viagem</th><th scope="col">Litros comprados</th><th scope="col">Preço médio</th></tr></thead>
    <tbody>
      <tr><th scope="row">Seguiu o plano de abastecimento</th><td>{num(seg["plano"][0])}</td><td>{r2(preco_plano)}</td></tr>
      <tr><th scope="row">Ignorou o app (abasteceu por hábito)</th><td>{num(seg["ignorou"][0])}</td><td>{r2(preco_ign)}</td></tr>
      <tr><th scope="row">Empresa B (posto de costume)</th><td>{num(S["diesel_l"])}</td><td>{r2(S["diesel_preco"])}</td></tr>
    </tbody>
  </table></div>
</section>

<section>
  <div class="eyebrow">Entregas</div>
  <h2>Atrasos: o app mostra antes quando a janela não cabe na viagem</h2>
  <p>O painel avisa quando a janela do cliente não fecha com a viagem legal (rota, pausas obrigatórias e restrições de horário) e diz até que hora sair. A equipe da empresa A usou isso para renegociar janelas e mudar saídas.</p>
  <div class="fig">
    <div class="legenda"><span><i style="background:var(--com)"></i>Com BrasaWay</span><span><i style="background:var(--sem)"></i>Sem BrasaWay</span><span>entregas atrasadas, por semana</span></div>
    {g_atrasos}
  </div>
</section>

<section>
  <div class="eyebrow">Equipe</div>
  <h2>O que as equipes decidiram</h2>
  <p>As decisões foram tomadas toda semana por agentes no papel de roteirista, financeiro e gerente, só com o que cada empresa enxerga. A empresa A tinha o painel; a B, a planilha e as notificações do correio.</p>
  <div class="scroll"><table>
    <thead><tr><th scope="col">Decisão</th><th scope="col" class="c">Empresa A</th><th scope="col">Empresa B</th></tr></thead>
    <tbody>{acoes_rows}</tbody>
  </table></div>
</section>

<section>
  <div class="eyebrow">Semana a semana</div>
  <h2>Todas as semanas</h2>
  <div class="scroll"><table>
    <thead><tr><th scope="col">Sem.</th><th scope="col" class="c">Multas A</th><th scope="col">Multas B</th><th scope="col" class="c">Voltas A</th><th scope="col">Voltas B</th><th scope="col" class="c">Atrasos A</th><th scope="col">Atrasos B</th><th scope="col" class="c">Diesel A</th><th scope="col">Diesel B</th><th scope="col" class="c">Alertas A</th></tr></thead>
    <tbody>{semana_rows}</tbody>
  </table></div>
</section>

<footer>
  <p><b>Como foi feito.</b> Cada motorista existe nas duas empresas com a mesma persona (hábitos, veículo, linhas e horários) e o mesmo sorteio em cada viagem; só muda a ferramenta. Na empresa A, a rota vem da API do BrasaWay (restrições de altura, peso, horário, zonas e perigosos) e as viagens, multas e abastecimentos passam pelo painel da frota de verdade. Na B, a rota é a de GPS de carro, e o trajeto é conferido contra as mesmas restrições. Multa, volta e batida são sorteadas com probabilidades fixas por tipo de restrição. Os preços de diesel vêm da ANP por posto, e a aceitação dos convênios PIX também é sorteada.</p>
  <p>É uma simulação: os números servem para comparar as duas empresas, não para prometer valores exatos a um cliente.</p>
</footer>
</main>
'''
DEST.write_text(pagina)
print(f'{DEST} ({NS} semanas): multas {C["multas"]}×{S["multas"]}, diesel {C["diesel_preco"]:.3f}×{S["diesel_preco"]:.3f}, '
      f'economia diesel {eco_diesel:,.0f}, multas {eco_multas:,.0f}, mensal {mensal(eco_diesel + eco_multas):,.0f}; origem {dict(orig)}')
