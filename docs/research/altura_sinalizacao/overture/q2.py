import duckdb
con=duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
src="s3://overturemaps-us-west-2/release/2026-09-23.1/theme=transportation/type=segment/*"
con.execute(f"""CREATE TABLE h AS SELECT id, class, names.primary AS nm, access_restrictions, sources FROM read_parquet('{src}',hive_partitioning=1)
 WHERE bbox.xmin>-47.21 AND bbox.xmax<-45.69 AND bbox.ymin>-24.07 AND bbox.ymax<-23.18 AND subtype='road' AND cast(access_restrictions as varchar) ilike '%height%'""")
print('height segs',con.execute("select count(*) from h").fetchone())
print('fontes por propriedade',con.execute("select s.dataset, s.property, count(*) from (select unnest(sources) s from h) group by 1,2 order by 3 desc limit 15").fetchall())
print('licencas',con.execute("select s.license, count(*) from (select unnest(sources) s from h) group by 1").fetchall())
print('classes',con.execute("select class,count(*) from h group by 1 order by 2 desc").fetchall())
