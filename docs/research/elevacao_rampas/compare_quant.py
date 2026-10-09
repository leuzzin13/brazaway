# Efeito da quantização Int16 (formato HGT do Valhalla) na rampa: compara com LiDAR 1 m
import sys, json
from osgeo import gdal
gdal.UseExceptions()
sys.argv = ["x"]
import grade_analysis as ga
areas = {"sumare": ("/w/dem/lidar_dtm_sumare_4326.tif", "/w/dem/lidar_dtm_sumare_1arcsec.tif"),
         "fo": ("/w/dem/lidar_fo_4326.tif", "/w/dem/lidar_fo_1arcsec.tif"),
         "mooca": ("/w/dem/lidar_mooca_4326.tif", "/w/dem/lidar_mooca_1arcsec.tif")}
out = {}
for a, (ref, l1) in areas.items():
    ds = gdal.Open(ref); gt = ds.GetGeoTransform()
    bb = [gt[0] + 0.0012, gt[3] + gt[5] * ds.RasterYSize + 0.0012, gt[0] + gt[1] * ds.RasterXSize - 0.0012, gt[3] - 0.0012]
    ga.DEMS.clear()
    ga.DEMS.update({"anadem_float32": "/w/dem/anadem_S24W047.tif",
                    "anadem_hgt_int16": "/w/dem/hgt_anadem/S24/S24W047.hgt",
                    "lidar_1arcsec_float32": l1,
                    "lidar_1arcsec_int16": l1.replace(".tif", "_int16.tif").replace("lidar_dtm_sumare", "lidar_sumare")})
    sys.argv = ["lidar_compare.py", "/w/roads.geojsonseq", ref, f"/w/quant_{a}.json"] + [str(x) for x in bb]
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        exec(open("/w/lidar_compare.py").read(), {"__name__": "__main__"})
    r = json.load(open(f"/w/quant_{a}.json"))["posting_60m"]
    out[a] = {k: {"mae": v["rampa_mae_pp"], "rmse": v["rampa_rmse_pp"], "P/R15": (v["thr15"]["precisao"], v["thr15"]["recall"]), "P/R8": (v["thr8"]["precisao"], v["thr8"]["recall"])}
              for k, v in r.items() if isinstance(v, dict) and "rampa_mae_pp" in v}
    out[a]["km"] = r["km"]
print(json.dumps(out, indent=1))
