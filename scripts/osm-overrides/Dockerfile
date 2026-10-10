# Ferramentas para corrigir o PBF localmente antes do build dos tiles (osmium-tool + pyosmium, nativos amd64/arm64).
FROM debian:bookworm-slim
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends osmium-tool python3 python3-pyosmium \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
