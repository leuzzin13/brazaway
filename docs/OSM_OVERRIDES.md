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

Para ativar uma pendente: anexar a evidência (ato, ofício ou foto da placa), mudar o status para `ativa`, rodar
`scripts/build-tiles.sh --swap` e a suíte.
