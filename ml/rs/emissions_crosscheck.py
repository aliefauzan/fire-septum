"""Fire Septum: cross-check of the satellite FRP emission method (src/sim/frp.ts) against GFED.

    uv run --project ml/rs python ml/rs/emissions_crosscheck.py

What it does
1. For each fire season (2015, 2019, 2023; 1 Jul - 30 Nov UTC) picks the 5 busiest GFED 0.25-degree cells
   in Indonesia by VIIRS S-NPP detections (FIRMS country archive, type 0 = vegetation fire).
2. Runs a faithful Python port of src/sim/frp.ts per cell: passes = (satellite, 10-minute bin), FRP summed
   over the pass and held until the next pass seen in the same cell, at most 12 h; FRE -> dry matter with
   GFAS beta by cover (Kaiser et al. 2012, Table 2); -> CO2 and CO2e with the IPCC factors used by the app.
   Cover per detection: peat = Global Forest Watch peatland tile alpha > 0; elsewhere ESA WorldCover 2021
   mapped like src/data/landcover.ts fuelFromCover + src/sim/frp.ts coverOf; a detection on water / built-up
   takes the most common burnable cover within ~500 m, like frp.ts coverAt.
3. Compares daily and season dry matter (DM) and CO2 with GFED4.1s for the same cells and days
   (GEOS-Chem mirror of the GFED4.1s files: monthly DM by source + daily fractions; keyless).
4. Compares whole-Indonesia annual CO2 from the FRP method with the keyless GFED5.1 summary table for
   region EQAS (Equatorial Asia, which also contains Malaysia, Brunei, Timor-Leste and Papua New Guinea).

Outputs: data/validation/emissions-crosscheck.json, docs/img/emissions-crosscheck.png
Raw downloads are cached under .cache/rs/.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, ROOT  # noqa: E402

YEARS = [2015, 2019, 2023]
SEASON = ("07-01", "11-30")
TOP_N = 5
ARCHIVE = ROOT / ".cache" / "firms-archive"
FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/{y}/viirs-snpp_{y}_Indonesia.csv"
GFED_URL = "http://geoschemdata.wustl.edu/ExtData/HEMCO/GFED4/v2023-03/{y}/{f}"
GFED5_TABLE = "https://www.globalfiredata.org/tables/GFED5.1_{sp}.txt"
PEAT_URL = "https://tiles.globalforestwatch.org/gfw_peatlands/latest/default/{z}/{x}/{y}.png"
OUT_JSON = ROOT / "data" / "validation" / "emissions-crosscheck.json"
OUT_PNG = ROOT / "docs" / "img" / "emissions-crosscheck.png"

# ---- src/sim/frp.ts, ported --------------------------------------------------------------
GFAS_BETA = {"peat": 5.87, "tropicalForest": 0.96, "savanna": 0.78, "agriculture": 0.29}   # kg DM / MJ
IPCC_FIRE_EF = {"tropicalForest": (1580, 6.8), "savanna": (1613, 2.3), "agriculture": (1515, 2.7)}  # g CO2, g CH4 per kg DM
PEAT_CO2C, PEAT_CH4, CH4_GWP = 464.0, 21.0, 27.0  # doctrine.ts DEFAULT_RATES (Wetlands Supplement; AR6)
CO2_PER_C = 44 / 12
MAX_HOLD_S = 12 * 3600
COVERS = ["peat", "tropicalForest", "savanna", "agriculture"]


def gco2_per_kg(c: str) -> float:
    return PEAT_CO2C * CO2_PER_C if c == "peat" else IPCC_FIRE_EF[c][0]


def tco2e_per_tdm(c: str) -> float:
    if c == "peat":
        return (PEAT_CO2C * CO2_PER_C + PEAT_CH4 * CH4_GWP) / 1000
    co2, ch4 = IPCC_FIRE_EF[c]
    return (co2 + ch4 * CH4_GWP) / 1000


# GFED4 emission factors for CO2, g per kg DM (GFED4_Emission_Factors.txt; van der Werf et al. 2017,
# based on Akagi et al. 2011): SAVA, BORF, TEMF, DEFO, PEAT, AGRI.
GFED_CO2_EF = {"SAVA": 1686, "BORF": 1489, "TEMP": 1647, "DEFO": 1643, "PEAT": 1703, "AGRI": 1585}

WC_TREE, WC_SHRUB, WC_GRASS, WC_CROP, WC_BUILT, WC_BARE, WC_SNOW, WC_WATER, WC_WETLAND, WC_MANGROVE, WC_MOSS = 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100


def cover_from(cls: int, on_peat: bool) -> str | None:
    """landcover.ts fuelFromCover + frp.ts coverOf. None = not burnable / no data."""
    if cls in (WC_WATER, WC_BUILT, 0, WC_SNOW, WC_MOSS):
        return None
    if cls == WC_MANGROVE:
        return "agriculture"            # mangrove -> 'agri' fuel
    if on_peat:
        return "peat"                   # peat / shrub fuels -> ON_PEAT -> peat
    if cls == WC_TREE:
        return "tropicalForest"         # plantation
    if cls in (WC_CROP, WC_WETLAND):
        return "agriculture"
    return "savanna"                    # grass


# ---- downloads --------------------------------------------------------------------------
def get(url: str, dest: Path, timeout=600) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    if not dest.exists():
        tmp.replace(dest)
    return dest


def firms_archive(y: int) -> pd.DataFrame:
    p = ARCHIVE / f"viirs-snpp_{y}_Indonesia.csv"
    if not p.exists():
        # Same name another process uses; download to our cache and move into place only if still absent.
        mine = get(FIRMS_URL.format(y=y), CACHE / "firms-dl" / p.name, timeout=1800)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            mine.replace(p)
        else:
            p = mine if mine.exists() else p
    d = pd.read_csv(p, usecols=["latitude", "longitude", "acq_date", "acq_time", "satellite", "frp", "type"])
    d = d[(d["type"] == 0) & (d["frp"] > 0)].copy()
    t = d["acq_time"].astype(int).astype(str).str.zfill(4)
    d["t"] = pd.to_datetime(d["acq_date"] + " " + t.str[:2] + ":" + t.str[2:], utc=True)
    return d


# ---- cover sampling ---------------------------------------------------------------------
def lon2x(lon, z):
    return (np.asarray(lon) + 180) / 360 * 2 ** z


def lat2y(lat, z):
    r = np.radians(np.asarray(lat))
    return (1 - np.log(np.tan(r) + 1 / np.cos(r)) / np.pi) / 2 * 2 ** z


_tile_cache: dict = {}


def peat_tile(z: int, x: int, y: int) -> np.ndarray | None:
    k = (z, x, y)
    if k in _tile_cache:
        return _tile_cache[k]
    p = CACHE / "gfw-peat" / f"{z}_{x}_{y}.png"
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(3):
            try:
                r = requests.get(PEAT_URL.format(z=z, x=x, y=y), timeout=60)
                break
            except requests.RequestException:
                if attempt == 2:
                    raise
        if r.status_code == 404:
            p.write_bytes(b"")
        else:
            r.raise_for_status()
            p.write_bytes(r.content)
    b = p.read_bytes()
    a = None if not b else (np.asarray(Image.open(io.BytesIO(b)).convert("RGBA"))[..., 3] > 0)
    _tile_cache[k] = a
    return a


def peat_at(lat: np.ndarray, lon: np.ndarray, z: int) -> np.ndarray:
    fx, fy = lon2x(lon, z), lat2y(lat, z)
    tx, ty = np.floor(fx).astype(int), np.floor(fy).astype(int)
    px = np.minimum(255, ((fx - tx) * 256).astype(int))
    py = np.minimum(255, ((fy - ty) * 256).astype(int))
    tiles = sorted(set(zip(tx.tolist(), ty.tolist())))
    with cf.ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda t: peat_tile(z, *t), tiles))
    out = np.zeros(len(lat), bool)
    for i, (a, b) in enumerate(zip(tx, ty)):
        t = _tile_cache[(z, int(a), int(b))]
        out[i] = bool(t[py[i], px[i]]) if t is not None else False
    return out


_wc: dict = {}


def worldcover_item(lat0: int, lon0: int):
    """WorldCover 2021 3x3-degree item at overview factor 8 (80 m), cached as .npy."""
    key = (lat0, lon0)
    if key in _wc:
        return _wc[key]
    name = f"ESA_WorldCover_10m_2021_v200_{'S' if lat0 < 0 else 'N'}{abs(lat0):02d}{'W' if lon0 < 0 else 'E'}{abs(lon0):03d}"
    p = CACHE / "worldcover" / f"{name}_ov8.npy"
    if p.exists():
        a = np.load(p)
    else:
        import planetary_computer as pc
        import pystac_client
        import rasterio
        cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
        its = [i for i in cat.search(collections=["esa-worldcover"], ids=[name]).items()]
        p.parent.mkdir(parents=True, exist_ok=True)
        if not its:
            a = np.zeros((1, 1), np.uint8)   # no land item (open sea)
        else:
            href = pc.sign(its[0]).assets["map"].href
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="5"):
                with rasterio.open(href, overview_level=2) as ds:   # overviews [2,4,8,...] -> level 2 = x8
                    a = ds.read(1)
        np.save(p, a)
    _wc[key] = a
    return a


def worldcover_at(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    cls = np.zeros(len(lat), np.uint8)
    lat0 = (np.floor(lat / 3) * 3).astype(int)
    lon0 = (np.floor(lon / 3) * 3).astype(int)
    for (a, b) in sorted(set(zip(lat0.tolist(), lon0.tolist()))):
        m = (lat0 == a) & (lon0 == b)
        arr = worldcover_item(a, b)
        if arr.shape == (1, 1):
            continue
        n = arr.shape[0]
        r = np.clip(((a + 3 - lat[m]) / 3 * n).astype(int), 0, n - 1)
        c = np.clip(((lon[m] - b) / 3 * n).astype(int), 0, n - 1)
        cls[m] = arr[r, c]
        # Non-burnable / no data under the detection: most common burnable class within +-3 px (~500 m).
        bad = np.isin(cls[m], [0, WC_WATER, WC_BUILT, WC_SNOW, WC_MOSS])
        idx = np.flatnonzero(m)[bad]
        for i, rr, cc in zip(idx, r[bad], c[bad]):
            win = arr[max(0, rr - 3): rr + 4, max(0, cc - 3): cc + 4].ravel()
            win = win[~np.isin(win, [0, WC_WATER, WC_BUILT, WC_SNOW, WC_MOSS])]
            if win.size:
                v, k = np.unique(win, return_counts=True)
                cls[i] = v[np.argmax(k)]
    return cls


def assign_cover(d: pd.DataFrame, peat_z: int) -> pd.DataFrame:
    lat, lon = d["latitude"].to_numpy(), d["longitude"].to_numpy()
    peat = peat_at(lat, lon, peat_z)
    wc = worldcover_at(lat, lon)
    cov = [cover_from(int(c), bool(p)) for c, p in zip(wc, peat)]
    # Still unburnable after the neighbourhood search (rare): count as savanna, like frp.ts's fallback to grass.
    d = d.assign(peat=peat, wc=wc, cover=[c if c else ("peat" if p else "savanna") for c, p in zip(cov, peat)])
    return d


# ---- FRP method -------------------------------------------------------------------------
def frp_method(d: pd.DataFrame, end: pd.Timestamp, max_hold_s: float = MAX_HOLD_S) -> pd.DataFrame:
    """Per GFED cell and UTC day: FRE (MJ), DM (t), CO2 (t), CO2e (t) by the frp.ts holding rule.
    The pass sequence is per cell: the next pass is the next one with a detection in that cell."""
    d = d.copy()
    epoch = pd.Timestamp(0, tz="UTC")
    d["bin"] = ((d["t"] - epoch).dt.total_seconds() // 600).astype("int64")   # frp.ts: floor(t / 6e5 ms)
    rows = []
    for cell, g in d.groupby("cell", sort=False):
        passes = g.groupby(["satellite", "bin"]).agg(t=("t", "min"))
        mw = g.pivot_table(index=["satellite", "bin"], columns="cover", values="frp", aggfunc="sum", fill_value=0.0)
        p = passes.join(mw).sort_values("t")
        ts = (p["t"] - epoch).dt.total_seconds().to_numpy()
        nxt = np.append(ts[1:], end.timestamp())
        hold = np.clip(nxt - ts, 0, max_hold_s)
        day = p["t"].dt.strftime("%Y-%m-%d").to_numpy()
        for c in COVERS:
            if c not in p:
                p[c] = 0.0
        fre = {c: p[c].to_numpy() * hold for c in COVERS}            # MW x s = MJ
        dm = {c: fre[c] * GFAS_BETA[c] / 1000 for c in COVERS}       # t
        df = pd.DataFrame({"cell": cell, "day": day,
                           "fre_MJ": sum(fre.values()),
                           "dm_t": sum(dm.values()),
                           "dm_peat_t": dm["peat"],
                           "co2_t": sum(dm[c] * gco2_per_kg(c) / 1000 for c in COVERS),
                           "co2e_t": sum(dm[c] * tco2e_per_tdm(c) for c in COVERS)})
        rows.append(df.groupby(["cell", "day"], as_index=False).sum())
    return pd.concat(rows) if rows else pd.DataFrame(columns=["cell", "day", "fre_MJ", "dm_t", "dm_peat_t", "co2_t", "co2e_t"])


# ---- GFED ------------------------------------------------------------------------------
def cell_of(lat, lon):
    """GFED 0.25-degree cell index (row from the south in the netCDF, col from -180)."""
    return (np.floor((np.asarray(lat) + 90) / 0.25).astype(int), np.floor((np.asarray(lon) + 180) / 0.25).astype(int))


def cell_area_m2(row: int) -> float:
    R = 6371007.2
    la1, la2 = math.radians(-90 + row * 0.25), math.radians(-90 + (row + 1) * 0.25)
    return R * R * math.radians(0.25) * (math.sin(la2) - math.sin(la1))


def gfed_daily(y: int, cells: list[tuple[int, int]]) -> pd.DataFrame:
    import netCDF4
    out = []
    for m in range(int(SEASON[0][:2]), int(SEASON[1][:2]) + 1):
        ym = f"{y}{m:02d}"
        fm = get(GFED_URL.format(y=y, f=f"GFED4_gen.025x025.{ym}.nc"), CACHE / "gfed" / f"GFED4_gen.025x025.{ym}.nc")
        fd = get(GFED_URL.format(y=y, f=f"GFED4_dailyfrac_gen.025x025.{ym}.nc"), CACHE / "gfed" / f"GFED4_dailyfrac_gen.025x025.{ym}.nc")
        ndays = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.date(y, m, 1)).days
        secs = ndays * 86400
        with netCDF4.Dataset(fm) as dm, netCDF4.Dataset(fd) as dd:
            frac = dd["GFED_FRACDAY"]
            if frac.shape[0] != ndays:
                raise RuntimeError(f"GFED daily fractions {ym}: {frac.shape[0]} days, expected {ndays}")
            for (r, c) in cells:
                area = cell_area_m2(r)
                src = {s: float(dm[f"DM_{s}"][0, r, c]) * secs * area / 1000 for s in GFED_CO2_EF}  # t DM / month
                # GFED_FRACDAY is a per-day multiplier on the monthly mean rate (it sums to the number of
                # days in the month), so the share of the month emitted on day i is frac_i / sum(frac).
                f = np.asarray(frac[:, r, c], dtype=float)
                f = f / f.sum() if f.sum() > 0 else np.full(ndays, 1 / ndays)
                tot = sum(src.values())
                co2 = sum(src[s] * GFED_CO2_EF[s] / 1000 for s in src)
                for i in range(ndays):
                    out.append({"cell": f"{r}_{c}", "day": dt.date(y, m, i + 1).isoformat(),
                                "gfed_dm_t": tot * f[i], "gfed_dm_peat_t": src["PEAT"] * f[i], "gfed_co2_t": co2 * f[i]})
    return pd.DataFrame(out)


def gfed5_eqas(sp: str) -> dict[int, float]:
    p = get(GFED5_TABLE.format(sp=sp), CACHE / "gfed" / f"GFED5.1_{sp}.txt")
    vals = {}
    hdr = None
    for ln in p.read_text().splitlines():
        if ln.startswith("Year"):
            hdr = ln.split()
            continue
        parts = ln.split()
        if hdr and parts and parts[0].isdigit():
            vals[int(parts[0])] = float(parts[hdr.index("EQAS")]) * 1e13 / 1e6   # 1E13 g -> t
    return vals


# ---- stats ------------------------------------------------------------------------------
def stats(a: np.ndarray, b: np.ndarray) -> dict:
    """a = FRP method, b = GFED (daily series, same days)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    both = (a > 0) | (b > 0)
    r = float(np.corrcoef(a, b)[0, 1]) if a.std() > 0 and b.std() > 0 else None
    rs = float(pd.Series(a).rank().corr(pd.Series(b).rank())) if a.std() > 0 and b.std() > 0 else None
    return {"frp_total": float(a.sum()), "gfed_total": float(b.sum()), "ratio_frp_over_gfed": float(a.sum() / b.sum()) if b.sum() > 0 else None,
            "pearson_r_daily": None if r is None else round(r, 3), "spearman_r_daily": None if rs is None else round(rs, 3),
            "mean_bias_t_per_day": float((a - b).mean()), "days": int(len(a)), "days_with_fire_either": int(both.sum()),
            "median_daily_ratio_where_both_positive": float(np.median(a[(a > 0) & (b > 0)] / b[(a > 0) & (b > 0)])) if ((a > 0) & (b > 0)).any() else None}


def main():
    res = {"method": {"frp": "Python port of src/sim/frp.ts (pass = satellite x 10-min bin; hold to next pass in the cell, max 12 h; GFAS beta by cover; IPCC EFs as in the app)",
                      "detections": "FIRMS VIIRS S-NPP country archive (Indonesia), type 0 only, FRP > 0; NOAA-20/21 not used",
                      "cover": "peat = GFW peatland tile alpha > 0 (z12 for the cells, z10 country-wide); else ESA WorldCover 2021 at 80 m (overview x8)",
                      "gfed4": "GFED4.1s via GEOS-Chem mirror http://geoschemdata.wustl.edu/ExtData/HEMCO/GFED4/v2023-03/ (monthly DM_* kg m-2 s-1 x daily fractions); 2017+ is the 'beta' version scaled from MODIS active fires",
                      "gfed4_co2_ef_g_per_kg": GFED_CO2_EF,
                      "gfed5": "GFED5.1 summary table, region EQAS, https://www.globalfiredata.org/tables/GFED5.1_CO2.txt",
                      "season_utc": SEASON, "top_cells_per_year": TOP_N},
           "years": {}}
    eq_co2 = gfed5_eqas("CO2")
    plot = {}
    for y in YEARS:
        print(f"== {y}: FIRMS archive", flush=True)
        d = firms_archive(y)
        s0, s1 = pd.Timestamp(f"{y}-{SEASON[0]}", tz="UTC"), pd.Timestamp(f"{y}-{SEASON[1]}", tz="UTC") + pd.Timedelta(days=1)
        r, c = cell_of(d["latitude"], d["longitude"])
        d["cell"] = [f"{a}_{b}" for a, b in zip(r, c)]
        season = d[(d["t"] >= s0) & (d["t"] < s1)]
        top = season["cell"].value_counts().head(TOP_N)
        cells = [tuple(map(int, k.split("_"))) for k in top.index]
        print(f"   top cells {list(top.items())}", flush=True)

        # Per-cell, season: cover at z12 like the app.
        sub = assign_cover(season[season["cell"].isin(top.index)], peat_z=12)
        ours = frp_method(sub, s1)
        g4 = gfed_daily(y, cells)
        days = pd.date_range(s0, s1 - pd.Timedelta(days=1), freq="D").strftime("%Y-%m-%d")
        cell_rows = []
        pooled_a, pooled_b, pooled_ac, pooled_bc = np.zeros(len(days)), np.zeros(len(days)), np.zeros(len(days)), np.zeros(len(days))
        for k, n in top.items():
            o = ours[ours["cell"] == k].drop(columns="cell").set_index("day").reindex(days, fill_value=0.0)
            g = g4[g4["cell"] == k].drop(columns="cell").set_index("day").reindex(days, fill_value=0.0)
            rr, cc = map(int, k.split("_"))
            cs = sub[sub["cell"] == k]
            row = {"cell": k, "lat_center": -90 + rr * 0.25 + 0.125, "lon_center": -180 + cc * 0.25 + 0.125, "detections": int(n),
                   "peat_share_of_detections": round(float((cs["cover"] == "peat").mean()), 3),
                   "dm": stats(o["dm_t"], g["gfed_dm_t"]), "co2": stats(o["co2_t"], g["gfed_co2_t"]),
                   "frp_co2e_t": float(o["co2e_t"].sum()), "frp_dm_peat_t": float(o["dm_peat_t"].sum()), "gfed_dm_peat_t": float(g["gfed_dm_peat_t"].sum()),
                   "frp_fre_MJ": float(o["fre_MJ"].sum()),
                   "daily": {"first_day": days[0], "frp_dm_t": [round(float(v), 1) for v in o["dm_t"]],
                             "gfed_dm_t": [round(float(v), 1) for v in g["gfed_dm_t"]],
                             "frp_co2_t": [round(float(v), 1) for v in o["co2_t"]]}}
            cell_rows.append(row)
            pooled_a += o["dm_t"].to_numpy(); pooled_b += g["gfed_dm_t"].to_numpy()
            pooled_ac += o["co2_t"].to_numpy(); pooled_bc += g["gfed_co2_t"].to_numpy()
            print(f"   cell {k} ({row['lat_center']:.3f},{row['lon_center']:.3f}) n={n} peat {row['peat_share_of_detections']:.0%}: "
                  f"DM FRP {row['dm']['frp_total']/1e3:.0f} kt vs GFED {row['dm']['gfed_total']/1e3:.0f} kt (x{row['dm']['ratio_frp_over_gfed'] or float('nan'):.2f}, r {row['dm']['pearson_r_daily']})", flush=True)
        pooled = {"dm": stats(pooled_a, pooled_b), "co2": stats(pooled_ac, pooled_bc)}
        # Sensitivity of the pooled season DM to the holding cap (the app uses 12 h).
        gsum = float(pooled_b.sum())
        pooled["dm_ratio_by_max_hold_h"] = {str(h): round(float(frp_method(sub, s1, h * 3600)["dm_t"].sum()) / gsum, 3) for h in (3, 6, 12)}
        plot[y] = (list(days), pooled_a, pooled_b)

        # Whole Indonesia, full year (z10 peat tiles: 153 m pixels, finer than the 232 m layer).
        print(f"   whole-Indonesia year: cover sampling for {len(d)} detections", flush=True)
        dy = assign_cover(d, peat_z=10)
        allc = frp_method(dy, pd.Timestamp(f"{y + 1}-01-01", tz="UTC"))
        nat = {"detections": int(len(dy)), "peat_share_of_detections": round(float((dy["cover"] == "peat").mean()), 3),
               "frp_dm_t": float(allc["dm_t"].sum()), "frp_co2_t": float(allc["co2_t"].sum()), "frp_co2e_t": float(allc["co2e_t"].sum()),
               "gfed5_eqas_co2_t": eq_co2.get(y),
               "ratio_frp_over_gfed5_eqas_co2": float(allc["co2_t"].sum() / eq_co2[y]) if eq_co2.get(y) else None}
        res["years"][str(y)] = {"cells": cell_rows, "pooled_top_cells": pooled, "indonesia_year": nat}
        print(f"   pooled DM ratio {pooled['dm']['ratio_frp_over_gfed']:.2f}, r {pooled['dm']['pearson_r_daily']}; "
              f"Indonesia CO2 FRP {nat['frp_co2_t']/1e6:.0f} Mt vs GFED5.1 EQAS {nat['gfed5_eqas_co2_t']/1e6 if nat['gfed5_eqas_co2_t'] else float('nan'):.0f} Mt", flush=True)

    res["ranAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(res, indent=1))
    print(f"wrote {OUT_JSON}")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(len(YEARS), 1, figsize=(8, 2.3 * len(YEARS)), constrained_layout=True)
    for ax, y in zip(axes, YEARS):
        days, a, b = plot[y]
        x = pd.to_datetime(days)
        ax.plot(x, b / 1e3, color="#3b6ea5", lw=1.4, label="GFED4.1s")
        ax.plot(x, a / 1e3, color="#c8502a", lw=1.4, label="Fire Septum FRP method")
        p = res["years"][str(y)]["pooled_top_cells"]["dm"]
        ax.set_title(f"{y}: top {TOP_N} cells, dry matter per day (FRP/GFED season ×{p['ratio_frp_over_gfed']:.2f}, r={p['pearson_r_daily']})", fontsize=9, loc="left")
        ax.set_ylabel("kt DM / day", fontsize=8)
        ax.tick_params(labelsize=7)
        ax.spines[["top", "right"]].set_visible(False)
    axes[0].legend(fontsize=8, frameon=False)
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT_PNG, dpi=110)
    print(f"wrote {OUT_PNG}")


if __name__ == "__main__":
    main()
