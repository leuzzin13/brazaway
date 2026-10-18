# Correções locais do OSM (antes do build dos tiles)

O Valhalla aplica as tags de caminhão do OpenStreetMap (`hgv`, `hgv:conditional`, `maxweight`...). Quando a pesquisa
encontra uma tag que **contradiz um ato oficial vigente**, ela desvia ou bloqueia caminhão sem base legal, e isso não se
desfaz por camada (`costLines` só encarecem; não liberam uma via que o grafo proíbe). Por isso há um passo de correção
local do PBF antes do build dos tiles.

- Regras: `data/osm-overrides/overrides.json`. Cada regra tem bbox, critério de casamento, ação (tags a remover ou
  definir), base legal, evidências, pasta da pesquisa e data de conferência.
- Só regras com `status: "ativa"` são aplicadas. As `pendente_confirmacao` são listadas no relatório, sem aplicar.
- Aplicação: `scripts/osm-overrides/apply.sh <entrada.pbf> <saída.pbf>` (gera um osmChange e usa `osmium apply-changes`;
  relatório em `data/osm-overrides/ultimo_relatorio.json`). O build completo é `scripts/build-tiles.sh [--swap]`.
- O OSM público **não** é editado por este passo. Editar o OSM é ação pública e fica para a comunidade/usuário; quando a
  correção chegar ao OSM, a regra local pode ser removida.

## Regras atuais

| Regra | Status | Efeito |
|---|---|---|
| `rio-res-smtr-3055-suspensa` | **ativa** | Remove a `hgv:conditional` "Mo-Fr 06:00-10:00,17:00-21:00" de 29 ways no Rio (Av. Menezes Côrtes, Estr. dos Três Rios, Estr. do Pau-Ferro). Base: Res. SMTR 3.254/2020 art. 1º suspende a Res. SMTR 3.055/2018 por prazo indeterminado. |
| `rio-condicionais-outras` | pendente | 4 ways no Rio (Av. Atlântica, R. Equador, R. Nelson Carneiro) com horários que não batem com a Res. 3.055. Confirmar com a SMTR/CET-Rio. |
| `es060-contorno-guarapari-hgv-no` | pendente | ES-060 km ~51–65: `hgv=no` + `maxweight=15` em 25 ways sem ato encontrado (barra todo caminhão). Confirmar com DER-ES/CETURB. |
| `sorocaba-hgv-no-itavuvu-ipanema` | pendente | `hgv=no` em 96 ways (Itavuvu, Ipanema, Afonso Vergueiro) fora das vias da Res. SEMOB 02/25. Confirmar com URBES/SEMOB. |
| `saojeronimo-antonio-de-carvalho-maxweight-15` | **ativa** | São Jerônimo/RS: 10 ways da R. Antônio de Carvalho de `maxweight=10` para 15. Base: Dec. 4.274/2010, art. 2º, II. |
| `novaveneza-rua-dos-imigrantes-hgv-no-maxweight-12` | **ativa** | Nova Veneza/SC: 2 ways da R. dos Imigrantes perdem `hgv=no` e o `maxweight` vai de 12 para 15. Base: Dec. 187/2020, art. 1º e parágrafo único. |
| `gaspar-ponte-hercilio-deeke-hgv-no` | pendente | Gaspar/SC, ponte Hercílio Deeke (way 112322733): `hgv=no` mais restritivo que o Dec. 7.588/2017, art. 1º (só PBT > 10 t; `maxweight=10` fica). Decisão de produto pendente; ato posterior não conferido. |
| `gaspar-centro-hgv-no-sem-ato` | pendente | Gaspar/SC: `hgv=no` na R. Cel. Aristiliano Ramos e R. Barão do Rio Branco, sem ato. |
| `ventania-hgv-no-sem-ato` | pendente | Ventania/PR: `hgv=no` na R. Enelcio Carneiro e Trav. Santa Felicidade, fora da Lei 779/2019. |
| `salto-do-lontra-av-nicolau-inacio-hgv-no` | pendente | Salto do Lontra/PR: `hgv=no` na Av. Nicolau Inácio, sem ato (a Lei 328/2021 só classifica a via). |
| `ascurra-travessa-zonta-hgv-no` | pendente | Ascurra/SC: `hgv=no` na Trav. Zonta (4 ways), sem ato; o `maxweight=3` fica. |
| `saojeronimo-trechos-maxweight-30` | pendente | São Jerônimo/RS: `maxweight` em 18 ways (Gen. Osório, Sen. Salgado Filho, Rafael Athanásio); o decreto cobre só trechos — restringir aos ways certos antes de ativar. |
| `riodosul-elevado-jose-thome-hgv-no` | pendente | Rio do Sul/SC: `hgv=no` no Elevado José Thomé, resíduo dos decretos emergenciais de 2015 (revogação não documentada). |
| `maracaja-alcino-de-freitas-maxweight-10` | pendente | Maracajá/SC: `maxweight=10` na R. Alcino de Freitas; a Lei 1.537/2026 foi lida com confiança baixa. |

As regras do Sul/Centro-Oeste valem no próximo build dos tiles (`scripts/build-tiles-regioes.sh --swap`); cada uma faz um
`osmium extract` no PBF inteiro, então o build fica alguns minutos mais lento.

Para ativar uma pendente: anexar a evidência (ato, ofício ou foto da placa), mudar o status para `ativa`, rodar
`scripts/build-tiles.sh --swap` e a suíte.
