"""Fire Septum: cross-check of the FRP emission method against CAMS GFAS v1.2 (needs an ADS key).

    ADS_API_KEY=<your key> uv run --project ml/rs python ml/rs/gfas_crosscheck.py

GFAS is only distributed through the Copernicus Atmosphere Data Store (ADS), which needs a free account
and a personal API key (https://ads.atmosphere.copernicus.eu/how-to-api). Without ADS_API_KEY in the
environment (or in .env) this script stops and says so; nothing else in ml/rs/ depends on it.

It reads the daily per-cell FRP-method series written by emissions_crosscheck.py
(data/validation/emissions-crosscheck.json, run that first), downloads GFAS daily dry-matter and CO2
fluxes (0.1 degree) over each season for Indonesia, sums the GFAS 0.1-degree cells whose centres fall
inside each GFED 0.25-degree cell (0.1 does not nest in 0.25, so edge cells are split 2/3 vs 1/3: an
approximation of about +-10% of a cell's area), and writes data/validation/gfas-crosscheck.json.

Note that our method uses GFAS's own conversion factors (Kaiser et al. 2012, Table 2), so agreement with
GFAS mostly tests the pass-holding rule and the cover assignment, not the factors themselves; GFAS also
uses MODIS FRP (Terra/Aqua, 1 km) with its own cloud gap-filling, not VIIRS.
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, ROOT, read_env  # noqa: E402

IN_JSON = ROOT / "data" / "validation" / "emissions-crosscheck.json"
OUT_JSON = ROOT / "data" / "validation" / "gfas-crosscheck.json"
ADS_URL = "https://ads.atmosphere.copernicus.eu/api"
AREA = [6, 95, -11, 141]  # N, W, S, E: Indonesia


def main():
    key = os.environ.get("ADS_API_KEY") or read_env("ADS_API_KEY")
    if not key:
        print("ADS_API_KEY is not set: GFAS needs a (free) Copernicus ADS account and API key. Skipping.", file=sys.stderr)
        sys.exit(2)
    if not IN_JSON.exists():
        sys.exit(f"{IN_JSON} missing: run ml/rs/emissions_crosscheck.py first")
    try:
        import cdsapi  # noqa: F401
    except ImportError:
        sys.exit("pip package 'cdsapi' missing: uv add --project ml/rs cdsapi")
    import cdsapi
    import netCDF4

    base = json.loads(IN_JSON.read_text())
    client = cdsapi.Client(url=ADS_URL, key=key, quiet=True)
    out = {"source": "CAMS GFAS v1.2 daily, ADS dataset cams-global-fire-emissions-gfas", "years": {}}
    for y, yr in base["years"].items():
        first = yr["cells"][0]["daily"]["first_day"]
        n = len(yr["cells"][0]["daily"]["frp_dm_t"])
        import datetime as dt
        d0 = dt.date.fromisoformat(first)
        d1 = d0 + dt.timedelta(days=n - 1)
        target = CACHE / "gfas" / f"gfas_{y}_{d0}_{d1}.nc"
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            client.retrieve("cams-global-fire-emissions-gfas", {
                "variable": ["wildfire_flux_of_dry_matter", "wildfire_flux_of_carbon_dioxide"],
                "date": f"{d0}/{d1}", "area": AREA, "data_format": "netcdf",
            }, str(target))
        with netCDF4.Dataset(target) as ds:
            names = {v.lower(): v for v in ds.variables}
            dm_name = next(v for k, v in names.items() if "dm" in k or "dry" in k)
            co2_name = next(v for k, v in names.items() if "co2" in k)
            lat = ds["latitude"][:]
            lon = ds["longitude"][:]
            dm = np.asarray(ds[dm_name][:], float)     # kg m-2 s-1, (time, lat, lon)
            co2 = np.asarray(ds[co2_name][:], float)
        R = 6371007.2
        area = (R ** 2) * math.radians(0.1) * np.abs(np.sin(np.radians(lat + 0.05)) - np.sin(np.radians(lat - 0.05)))
        rows = []
        for c in yr["cells"]:
            r, cc = map(int, c["cell"].split("_"))
            la0, lo0 = -90 + r * 0.25, -180 + cc * 0.25
            mi = (lat >= la0) & (lat < la0 + 0.25)
            mj = (lon >= lo0) & (lon < lo0 + 0.25)
            g_dm = (dm[:, mi][:, :, mj] * area[mi][None, :, None]).sum((1, 2)) * 86400 / 1000   # t/day
            g_co2 = (co2[:, mi][:, :, mj] * area[mi][None, :, None]).sum((1, 2)) * 86400 / 1000
            a = np.array(c["daily"]["frp_dm_t"])
            m = min(len(a), len(g_dm))
            rr = float(np.corrcoef(a[:m], g_dm[:m])[0, 1]) if a[:m].std() > 0 and g_dm[:m].std() > 0 else None
            rows.append({"cell": c["cell"], "frp_dm_t": float(a.sum()), "gfas_dm_t": float(g_dm.sum()),
                         "ratio_frp_over_gfas_dm": float(a.sum() / g_dm.sum()) if g_dm.sum() > 0 else None,
                         "pearson_r_daily_dm": rr, "gfas_co2_t": float(g_co2.sum()),
                         "frp_co2_t": float(np.sum(c["daily"]["frp_co2_t"]))})
        out["years"][y] = rows
        print(y, [(r_["cell"], round(r_["ratio_frp_over_gfas_dm"] or float("nan"), 2), r_["pearson_r_daily_dm"]) for r_ in rows])
    OUT_JSON.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT_JSON}")


if __name__ == "__main__":
    main()
