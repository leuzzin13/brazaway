# Imagem oficial e mantida pelo projeto Valhalla (https://github.com/valhalla/valhalla/tree/master/docker)
# Versão fixada pela digest (Valhalla 3.9.1-c803bdc2f, publicada em 08/10/2026, arm64/amd64). Para atualizar:
# docker pull ghcr.io/valhalla/valhalla-scripted:latest, rodar a suíte e trocar a digest abaixo.
FROM ghcr.io/valhalla/valhalla-scripted@sha256:b8c4c818575668aa6dc459ce62f5fc1b12832e39992d84aa57318fa6417253ad

# Wrapper: garante que valhalla.json exista com service_limits adequados para
# exclude_polygons grandes (ZMRC) antes de chamar o entrypoint original.
COPY entrypoint.sh /valhalla/scripts/truck-router-entrypoint.sh
RUN chmod +x /valhalla/scripts/truck-router-entrypoint.sh

ENTRYPOINT ["/valhalla/scripts/truck-router-entrypoint.sh"]
CMD ["build_tiles"]
