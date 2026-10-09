[out:json][timeout:180];
rel(2661855);map_to_area->.a;
(
  nwr["amenity"="fuel"](area.a);
  nwr["highway"~"^(rest_area|services)$"](area.a);
  nwr["amenity"="parking"]["hgv"~"designated|yes"](area.a);
  nwr["amenity"="parking"]["parking"~"truck|hgv"](area.a);
  nwr["amenity"="truck_stop"](area.a);
  nwr["hgv"="designated"]["amenity"~"parking|fuel"](area.a);
  nwr["amenity"~"shower|toilets"]["hgv"](area.a);
);
out center tags;
