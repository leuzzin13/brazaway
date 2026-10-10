# Postgres 16 + PostGIS a partir da imagem OFICIAL do Postgres (multi-arquitetura: amd64 e arm64).
# A imagem postgis/postgis só publica amd64; em Mac Apple Silicon (Colima/Docker Desktop) ela roda emulada e o
# backend chegou a cair com "malloc(): invalid size". O pacote vem do repositório apt.postgresql.org já configurado na base.
FROM postgres:16-bookworm
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
 && rm -rf /var/lib/apt/lists/*
