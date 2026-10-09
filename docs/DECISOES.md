# Dados para decisão — Rota Caminhão

Pesquisa feita em 09/10/2026 com 16 temas, cada um com teste real de acesso às fontes. O detalhe de cada tema
(fontes, URLs testadas, licenças, contagens, fatos com link) está em `docs/research/<tema>/` (`research.json`,
`NOTES.md` e, quando houve, `verify.json` com a checagem independente).

**Grau de confiança:** os temas `restricoes_sp_capital`, `pontes_sp_estado_municipio`, `rodovias_restricoes` e
`pesagem_pedagio` passaram por verificador independente (a maioria dos fatos confirmada, correções anotadas no
`verify.json`). Os demais ainda não tiveram a 2ª checagem; os valores legais usados no código são reconferidos na
fonte primária por quem implementa a camada.

## 1. Mercado

| Indicador | Brasil | Grande SP | Fonte |
|---|---|---|---|
| Caminhões (Renavam, ago/2026) | 3.253.427 | 279.623 | Senatran |
| Caminhões-trator | 1.029.220 | 85.638 | Senatran |
| Transportadores RNTRC ativos | 906.022 | 120.525 | ANTT (CC-BY) |
| Autônomos (TAC) ativos | 632.817 | 91.850 | ANTT |
| Idade média da frota de tração do TAC | 24 anos | — | ANTT |
| Veículos leves (caminhonete, furgão, caminhão leve) entre os de tração | — | 40% em SP | ANTT |

- **Perfil:** idade média de 45 anos, e 41% dos autônomos estudaram até a 9ª série (CNT 2025).
- **Celular:** 98% acessam a internet principalmente pelo celular (CNT 2019), e o Android tem 79% do mercado.
- **Descanso:** 96,6% param em posto para cumprir a Lei do Descanso e 78,4% acham difícil achar local (CNTA 2025). Só 5 a 8% pernoitam em PPD homologado (CNT 2025).
- **Segurança:** 57,7% nunca se sentem seguros na rodovia (CNTA 2025). A RMSP concentra 83% dos roubos de carga do estado.

### Concorrência

| Produto | Restrição urbana na RMSP | Preço |
|---|---|---|
| Google Maps / Waze | Não tem modo caminhão no Brasil | grátis |
| HERE WeGo Pro | Só rodovias e vias principais no Brasil | pago |
| Sygic Truck Brasil | Altura/peso, sem regras municipais | R$ 499,90 |
| TomTom GO / CoPilot | Altura/peso, sem regras municipais | R$ 380–400/ano |
| WikiRota | Custo e pedágio; review diz que não respeita a Grande SP | R$ 80–100/ano |
| Maplink (B2B) | API com zona ZMRC | contrato |

**Leitura:** o diferencial defensável é a malha urbana da RMSP: ZMRC, VER, rodízio, perigosos, municípios
vizinhos, feriados e suspensões da CET. Nenhum concorrente de consumo cobre isso.

## 2. O que existe e o que NÃO existe de dado aberto

| Necessidade | Situação | Consequência |
|---|---|---|
| Limite de peso de pontes e viadutos | **Não publicado** por PMSP, DER, ARTESP nem ANTT. O DNIT publica só por segmento de BR (SIAET, para AET). | Não prometer "rota segura por peso". Avisar "limite não informado" e coletar por reporte. |
| Altura livre de viadutos urbanos | Não publicada. O OSM tem cerca de 1.100 vias com maxheight na RMSP, e cerca de 1.100 a 2.100 passagens em via principal estão sem. | Usar o OSM, as placas R-15 do DER (sem valor) e os reportes. |
| Restrições da capital (ZMRC, rodízio, VER, perigosos) | Texto legal completo. A geometria oficial só existe para ZMRC, Mini-Anel e ZMRF; as VER só como texto e KML da CET. | Digitalizar as VER a partir da portaria, casando com o OSM. |
| Restrições dos outros municípios da RMSP | Só em PDF de decreto (Osasco tem mapa vetorial). | Curadoria manual, com vigilância no Querido Diário. |
| Feriados/suspensões | CET publica histórico de suspensões; PRF publica portaria anual no DOU. | Raspagem diária/semanal. |
| Acidentes e roubo de carga | Abertos e georreferenciados: Infosiga, ARTESP, PRF e microdados da SSP-SP. | Camadas de risco por horário. |
| Pedágio | Praças ANTT/ARTESP abertas (CC-BY); tarifa em HTML/PDF; OSM tem `charge` em 687 praças do Sudeste. | Estimar custo por eixo. |
| Relevo | ANADEM (CC BY 4.0) é o melhor DEM aberto para o Brasil; LiDAR 0,5 m da PMSP só na capital. | Ligar elevação com DEM próprio. O costing truck do Valhalla não usa rampa: avisar por trace_attributes. |
| Pontos de descanso | Não há dataset oficial de PPD (só painel Power BI). Na Grande SP há só 1 PPD certificado, e está vencido. | Postos (ANP, CC-BY) + OSM + reportes. |
| Tráfego por horário | Não há fonte aberta desde 2024 (a CET migrou para o Waze). | ETA por fator horário agora; GPS próprio ou TomTom depois. |
| Endereço com número | O CNEFE 2022 do IBGE cobre 106,8 M endereços com coordenada. Photon e Nominatim erram mais de 1 km em 4 de 10 endereços logísticos. | Geocodificador próprio sobre o CNEFE. |

## 3. Decisões que precisam do Arthur

1. **Posicionamento:** começar pelo motorista urbano leve da RMSP (VUC, 3/4, toco), onde moram ZMRC, rodízio e VER, ou pelo rodoviário? Os dados apontam para o urbano.
2. **Preço:** os GPS de caminhão cobram R$ 380 a 500 por ano e o WikiRota R$ 80 a 100. Um plano de R$ 10 a 15 por mês, com rota básica grátis, cabe no bolso do TAC.
3. **Distribuição:** 46,6% dos autônomos pegam frete por aplicativo. Vale buscar integração por deep link com Fretebras ou TruckPad?
4. **Pedidos via LAI**, a protocolar em nome da empresa:
   - SIURB/PMSP: cadastro de OAEs com gabarito, trem-tipo e restrições.
   - DER-SP e ARTESP: classe portante e gabarito das OAEs, mais as portarias vigentes de restrição.
   - DNIT: extração do SGE (código SGO, trem-tipo, nota). O prazo da Portaria MT 309/2026 vence em mai/2027.
   - Osasco, Diadema, SBC, Santo André e São Caetano: textos e anexos dos decretos de restrição.
5. **Licenças:**
   - GeoSampa é CC-BY-SA 4.0. Derivados ficam em base separada, com atribuição.
   - O LiDAR da PMSP é GPL-3.0. Pedir parecer jurídico antes de distribuir derivados.
   - Mapillary é CC BY-SA e exige token.
6. **Tráfego pago:** fazer um piloto TomTom (cerca de EUR 1 por mil chamadas acima da franquia) só para o ETA de entrada na ZMRC? Antes, validar contratualmente o uso sobre mapa OSM.
7. **Reportes colaborativos novos:** vagas lotadas, posto aceita caminhão, ARLA, preço do diesel, balança aberta. Eles cobrem lacunas que nenhuma fonte pública cobre.

## 4. Fontes descartadas e por quê

| Fonte | Motivo |
|---|---|
| Google Routes/Geocoding | Os termos proíbem uso com mapa que não seja Google; não há rota de caminhão no Brasil. |
| Waze for Cities | Só para governo e operadores, e os dados não podem ser publicados. |
| Uber Movement | Descontinuado. |
| FABDEM, SRTM do CGIAR, TanDEM-X | A licença não permite uso comercial. |
| Restrição do ABC de 2012 | Cancelada pelo Consórcio. Fica marcada como revogada. |
| BrasilAPI v2 (coordenada de CEP) | A coordenada vem do Photon, sem precisão. |
