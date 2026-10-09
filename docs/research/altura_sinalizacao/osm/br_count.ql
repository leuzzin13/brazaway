[out:json][timeout:600];
area["ISO3166-1"="BR"][admin_level=2]->.br;
way["highway"]["maxheight"](area.br);out count;
way["highway"]["maxheight:physical"](area.br);out count;
node["traffic_sign"~"maxheight|R-15"](area.br);out count;
node["barrier"="height_restrictor"](area.br);out count;
way["highway"]["maxweight"](area.br);out count;
