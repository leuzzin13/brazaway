# data/raw — dados brutos das zonas de restrição

Os dois GeoJSON aqui foram baixados automaticamente do **WFS público do GeoSampa**
(Prefeitura de São Paulo), tema *Sistema Viário > Restrição à circulação de veículos*:

| Arquivo | Camada WFS | Conteúdo | Fonte original | Carga |
|---|---|---|---|---|
| `geosampa_restricao_circulacao_veiculo_zmrc.geojson` | `geoportal:restricao_circulacao_veiculo_zmrc` | ZMRC — Zona Máxima de Restrição a Caminhões | CET | 2018-02-14 |
| `geosampa_restricao_circulacao_veiculo_mian.geojson` | `geoportal:restricao_circulacao_veiculo_mian` | Mini-Anel (área do rodízio municipal) | CET | 2018-02-14 |

Endpoint: `https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs`
(`request=GetFeature&typeName=<camada>&outputFormat=application/json&srsName=EPSG:4326`).

> A data de carga é 2018. **Confirme com a CET** se o perímetro mudou. Existe ainda a camada
> `geoportal:restricao_circulacao_veiculo_zmrf` (fretados), fora do escopo.

## Se o download automático falhar

1. Acesse o GeoSampa (https://geosampa.prefeitura.sp.gov.br), menu **Download de camadas**,
   tema **Sistema Viário**, item **Restrição à circulação de veículos**.
2. Baixe a ZMRC (e, se quiser rodízio, o Mini-Anel) em **GeoJSON, Shapefile ou GPKG**.
3. Salve nesta pasta com `zmrc` / `mian` no nome do arquivo, por exemplo
   `data/raw/zmrc.shp` (com `.dbf/.shx/.prj`) ou `data/raw/zmrc.geojson`.
4. Rode a importação (usa `ogr2ogr` dentro de um container GDAL, nada a instalar):

```bash
docker compose --profile import run --rm gdal
```

O script `data/import/import-zmrc.sh` dá prioridade ao arquivo baixado à mão (o mais recente); senão usa o GeoJSON
desta pasta; senão baixa do WFS. O resultado é sempre gravado em `geosampa_restricao_circulacao_veiculo_<camada>.geojson`.
Ele atualiza a ZMRC no banco na hora. O Mini-Anel **não** vai direto para o banco: a zona do rodízio de caminhões é o
Mini-Anel menos o corredor das vias-limite (Decreto 58.584/2018 art. 2º §2º), e o corte depende de remedir a borda.
Depois do script, no host:

```bash
python3 scripts/gen-zones-seed.py --measure
docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/0002_zones.sql
```

## Seed

`db/seed/0002_zones.sql` (zonas) e `db/seed/0004_holidays.sql` (feriados) são gerados por
`python3 scripts/gen-zones-seed.py` a partir destes arquivos e de `config/zmrc-rules.json`, e são aplicados
automaticamente no `docker compose up` (serviço `migrate`), então o app já sobe com as zonas sem precisar do passo de
importação. Detalhes em `docs/layers/core_legal.md`.
