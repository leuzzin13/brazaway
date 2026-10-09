[out:json][timeout:180];
area["ISO3166-1"="BR"][admin_level=2]->.br;
(
  way["highway"]["hazmat"](area.br);
)->.h;
.h out count;
(
  way["highway"]["hazmat:water"](area.br);
)->.hw;
.hw out count;
(
  way["highway"][~"^hazmat:[A-E]$"~"."](area.br);
)->.ht;
.ht out count;
