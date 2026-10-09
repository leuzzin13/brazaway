# Imagem oficial e mantida pelo projeto Valhalla (https://github.com/valhalla/valhalla/tree/master/docker)
FROM ghcr.io/valhalla/valhalla-scripted:latest

# Wrapper: garante que valhalla.json exista com service_limits adequados para
# exclude_polygons grandes (ZMRC) antes de chamar o entrypoint original.
COPY entrypoint.sh /valhalla/scripts/truck-router-entrypoint.sh
RUN chmod +x /valhalla/scripts/truck-router-entrypoint.sh

ENTRYPOINT ["/valhalla/scripts/truck-router-entrypoint.sh"]
CMD ["build_tiles"]
