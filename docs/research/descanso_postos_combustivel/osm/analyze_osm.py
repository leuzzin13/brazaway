import json,collections,sys
def load(fn):
    out=[];seen=set()
    for line in open(fn):
        line=line.strip().lstrip('\x1e')
        if not line: continue
        f=json.loads(line); p=f['properties']
        if p.get('boundary')=='administrative': continue
        k=(p.get('@type'),p.get('@id'))
        if k in seen: continue
        seen.add(k); out.append(f)
    return out
for name in sys.argv[1:]:
    fs=load(f'{name}_sel.geojsonseq')
    P=lambda f,k: f['properties'].get(k)
    fuel=[f for f in fs if P(f,'amenity')=='fuel']
    # dedupe: osmium exports areas (ways closed) as polygons; nodes as points
    print('=====',name,'features',len(fs),'amenity=fuel',len(fuel),'(ways/areas',sum(1 for f in fuel if f['geometry']['type']!='Point'),')')
    for k in ('name','brand','operator','fuel:diesel','fuel:HGV_diesel','fuel:adblue','hgv','opening_hours','ref:vatin','addr:street','addr:postcode','addr:housenumber'):
        print('  fuel com',k, sum(1 for f in fuel if P(f,k)))
    print('  fuel:diesel',dict(collections.Counter(P(f,'fuel:diesel') for f in fuel)))
    print('  hgv',dict(collections.Counter(P(f,'hgv') for f in fuel)))
    print('  fuel:HGV_diesel',dict(collections.Counter(P(f,'fuel:HGV_diesel') for f in fuel)))
    print('  fuel:adblue',dict(collections.Counter(P(f,'fuel:adblue') for f in fuel)))
    print('  brands',collections.Counter(P(f,'brand') for f in fuel).most_common(10))
    rest=[f for f in fs if P(f,'highway') in ('rest_area','services')]
    print('  highway=rest_area',sum(1 for f in rest if P(f,'highway')=='rest_area'),'services',sum(1 for f in rest if P(f,'highway')=='services'))
    print('  amenity=truck_stop',sum(1 for f in fs if P(f,'amenity')=='truck_stop'))
    park=[f for f in fs if P(f,'amenity')=='parking']
    hgvp=[f for f in park if P(f,'hgv') in ('designated','yes','only') or P(f,'parking') in ('truck','hgv') or 'caminh' in (P(f,'name') or '').lower()]
    print('  amenity=parking',len(park),'parking p/ caminhao (hgv=designated|yes|only, parking=truck ou nome caminh*)',len(hgvp),dict(collections.Counter(P(f,'hgv') for f in hgvp)))
    print('  hgv=designated qualquer',sum(1 for f in fs if P(f,'hgv')=='designated'))
    with_cap=[f for f in hgvp if P(f,'capacity') or P(f,'capacity:hgv')]
    print('  estac. caminhao c/ capacity',len(with_cap))
    print('  nomes estac caminhao (amostra)',[P(f,'name') for f in hgvp][:15])
