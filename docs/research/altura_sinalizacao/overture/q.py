import duckdb,time
con=duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
src="s3://overturemaps-us-west-2/release/2026-09-23.1/theme=transportation/type=segment/*"
t=time.time()
cols=con.execute(f"DESCRIBE SELECT * FROM read_parquet('{src}',hive_partitioning=1) LIMIT 1").fetchall()
for c in cols: print(c[0], str(c[1])[:300])
con.execute(f"""CREATE TABLE seg AS SELECT id, class, subtype, access_restrictions, names.primary AS name, sources, ST_AsText(geometry) wkt
 FROM read_parquet('{src}',hive_partitioning=1)
 WHERE bbox.xmin>-47.21 AND bbox.xmax<-45.69 AND bbox.ymin>-24.07 AND bbox.ymax<-23.18 AND subtype='road'""")
print('segmentos rodoviarios bbox RMSP',con.execute("select count(*) from seg").fetchone(),'em',round(time.time()-t),'s')
print('com access_restrictions',con.execute("select count(*) from seg where access_restrictions is not null").fetchone())
for k in ['height','weight','length','width','hazardous','hgv']:
    print(k,con.execute(f"select count(*) from seg where cast(access_restrictions as varchar) ilike '%{k}%'").fetchone())
for r in con.execute("select name, cast(access_restrictions as varchar) from seg where cast(access_restrictions as varchar) ilike '%height%' limit 3").fetchall(): print(r)
con.execute("COPY (select id,class,name,cast(access_restrictions as varchar) ar,wkt from seg where cast(access_restrictions as varchar) ilike '%height%' limit 200) TO 'overture/overture_height_amostra.csv' (HEADER)")
print(con.execute("select ds, count(*) from (select unnest(sources).dataset ds from seg) group by 1").fetchall())
