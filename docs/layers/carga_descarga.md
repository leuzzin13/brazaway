# Camada `carga_descarga` — Zona Azul Caminhão (São Paulo)

Onde parar para carregar/descarregar perto do destino, na cidade de São Paulo: vagas de Zona Azul destinadas a
caminhão ("Bolsão Caminhão"), com horário de operação por dia e a regra do Cartão Azul Digital (CAD).

- Módulo da API: `api/src/layers/carga_descarga.layer.ts` (grupo `servicos`, não altera a rota).
- Importadores: `importers/sources/geosampa_zona_azul.py` e `importers/sources/geosampa_vaga_caminhao.py`.
- Utilitários compartilhados da frente: `api/src/layers/apoio_urbano.ts` (janelas semanais, formatação).
- Testes: `api/test/layers/apoio_urbano.test.ts`.

## Fontes e licença

| fonte (`source`) | camada GeoSampa | o que entra | licença |
|---|---|---|---|
| `geosampa-zona-azul` | `geoportal:zona_azul` (cadastro CET) | 775 faces de quadra com `qt_vaga_caminhao > 0` (2.806 vagas), com horário seg–sex / sáb / dom / feriado | CC-BY-SA 4.0 — GeoSampa/PMSP |
| `geosampa-vaga-especial` | `geoportal:vaga_especial`, `cd_tipo_area = 'CA'` | 816 pontos de vaga de caminhão (2.521 vagas sinalizadas, todas rotativas) | CC-BY-SA 4.0 — GeoSampa/PMSP |

WFS: `https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs` (GeoJSON, EPSG:4326, até 30.000 feições
por requisição; o importador falha se `numberMatched` passar disso). Licença de uso dos dados do GeoSampa:
CC-BY-SA 4.0 (uso comercial permitido, com atribuição; dado derivado redistribuído deve manter a licença). Os dados
ficam em `data_features`, separados do OSM; nunca vão para o OSM.

Os pontos `vaga_especial` não têm horário: cada ponto é casado com a face de Zona Azul com vaga de caminhão mais
próxima (até 35 m; 814 de 816 casaram) e herda dela o horário e a regra (`props.zona_azul_id` liga os dois, e a API
não repete a mesma vaga).

## Regra (conferida na fonte)

CET, "Regras para estacionar em áreas de Zona Azul"
(https://www.cetsp.com.br/consultas/zona-azul/tudo-sobre-zona-azul-digital.aspx, conferido em 09/10/2026):

- Bolsão Caminhão: **1 CAD = 30 min, 2 CADs = 1 h**; no máximo 2 CADs na mesma vaga; vale para caminhão,
  caminhonete e veículo misto.
- Exceção publicada pela CET: no Bolsão Caminhão da **R. Santa Rosa** e da **R. Eurípedes Simões de Paula** vale a
  regra geral (1 CAD = 1 h, 2 CADs = 2 h) — 7 trechos marcados com `cad_min = 60`.
- Vencido o CAD, o veículo tem de sair (multa grave e remoção, segundo a mesma página).

A página da CET não cita o número da norma municipal que fixa a validade do CAD do Bolsão Caminhão, e eu não
encontrei a norma no Catálogo de Legislação Municipal. Por isso a camada cita a **CET** como base (`base_legal`) e
avisa que a placa do local prevalece. Uma versão anterior deste trabalho citava "Portaria SMT 97/2007"; essa
citação foi **removida** por não ter sido confirmada na fonte primária.

Horário de operação: vem do próprio cadastro da CET por face de quadra (`hr_inicio_*`/`hr_termino_*`). Campo vazio =
a Zona Azul não opera naquele dia; 61 faces não têm horário de seg–sex e aparecem como "horário não informado:
confira a placa". "23:59" vira 24:00; janelas como 07:00–02:00 atravessam a meia-noite. Em feriado só vale a janela
de feriado (2 faces têm; nas demais a Zona Azul não opera).

## Como entra na rota

`annotate()` (não muda o traçado):
- as **5 vagas mais próximas do destino a até 1 km**, agrupadas por face de quadra, com distância em linha reta até
  o ponto mais próximo da face, número de vagas, lado da via, horário, regra do CAD e se a Zona Azul estará em
  operação na **hora estimada de chegada** (saída + duração da rota, com feriado pelo calendário legal);
- aviso `loading_bay_near_destination` (`info`) com a mais próxima; se não houver nenhuma até 1 km, aviso
  `no_loading_bay_near_destination` (`info`) com a distância da mais próxima (busca até 5 km);
- destino a mais de 5 km de qualquer vaga (fora do município) → a camada não devolve nada.

`features()`: pontos e trechos a partir do zoom 13, com horário, regra, veículos e fonte para o popup.

## Como atualizar

```sh
docker compose --profile import run --rm importer geosampa_zona_azul geosampa_vaga_caminhao
```

Gera `db/seed/layers/carga_descarga__geosampa-zona-azul.sql` e `carga_descarga__geosampa-vaga-especial.sql`
(0,8 MB cada). O cache do WFS fica em `data/cache/` (3 dias para a Zona Azul, 7 para as vagas). A CET atualiza a
Zona Azul com frequência (`dt_carga` 2026-10-03 na última carga); recomendado semanal.

## Limitações

- Distância em linha reta (não a pé pela calçada) até a face de quadra.
- O cadastro não diz se a vaga está livre; não há dado de ocupação.
- Vagas de carga e descarga fora da Zona Azul (placas R-6a com "exceto carga e descarga", docas privadas) não existem
  em base aberta.
- "Caminhão" aqui segue a placa da CET (caminhão, caminhonete, misto); restrições de circulação (ZMRC, VER) são de
  outras camadas e continuam valendo para chegar à vaga.
