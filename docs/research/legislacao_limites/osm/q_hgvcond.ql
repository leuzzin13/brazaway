[out:json][timeout:120];
area["boundary"="administrative"]["admin_level"="8"]["name"="São Paulo"]["wikidata"="Q174"]->.sp;
(
  way(area.sp)["hgv:conditional"];
  way(area.sp)["maxweight:conditional"];
  way(area.sp)["hgv"="no"]["highway"~"^(primary|secondary|trunk|motorway|tertiary)$"];
);
out tags;
