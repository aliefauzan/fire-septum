"""Fire Septum: measured burned area after the 12 validation fires (Sentinel-2 dNBR + Sentinel-1 VH change),
compared with VIIRS (FIRMS) detections and, for the one recorded event, with the model forecast.

    uv run --project ml/rs python ml/rs/burned_area.py            # all 12 events
    uv run --project ml/rs python ml/rs/burned_area.py --only kalimantan-2026-10-18

Run `npx tsx ml/rs/forecast_events.ts` first to (re)create the forecast file for the recorded event.

Inputs: Microsoft Planetary Computer STAC (keyless; assets signed with `planetary_computer`):
sentinel-2-l2a (B02, B08, B12, SCL) and sentinel-1-rtc (VH, VV gamma0). NASA FIRMS area API with
FIRMS_MAP_KEY from .env (the key is never printed). Raw reads are cached under .cache/rs/.

Outputs: data/validation/burned-area/<event-id>.json and <event-id>.png, and summary.json.
Thresholds and their sources are in THRESH below and in docs/burned-area.md.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import io
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import planetary_computer as pc
import pystac_client
import rasterio
import requests
from PIL import Image, ImageDraw
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, CELL_M, GRID, ROOT, b64_bits, bbox_around, read_env, to_cell  # noqa: E402

OUT = ROOT / "data" / "validation" / "burned-area"
TODAY = dt.date(2026, 10, 24)
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"

# The 12 events of docs/hindcast.md / src/data/hindcastBatch.ts VALIDATION_EVENTS, t0 from
# docs/hindcast-rerun-2026-10-24.json.
EVENTS = [
    ("Kalimantan", -2.5235, 113.0298, "2026-10-08", "2026-10-08T18:53:00Z"),
    ("Kalimantan", -3.1011, 112.1923, "2026-10-10", "2026-10-10T18:36:00Z"),
    ("Kalimantan", -3.3284, 112.1442, "2026-10-12", "2026-10-12T17:02:00Z"),
    ("Kalimantan", -2.8114, 110.6903, "2026-10-14", "2026-10-14T19:00:00Z"),
    ("Kalimantan", -2.8132, 110.6886, "2026-10-16", "2026-10-16T18:21:00Z"),
    ("Kalimantan", -2.8179, 110.6934, "2026-10-18", "2026-10-18T19:06:00Z"),
    ("Sumatra", -1.8698, 103.9044, "2026-10-08", "2026-10-08T19:13:00Z"),
    ("Sumatra", -3.5741, 105.7519, "2026-10-10", "2026-10-10T18:36:00Z"),
    ("Sumatra", -3.5711, 105.7507, "2026-10-12", "2026-10-12T06:57:00Z"),
    ("Sumatra", -3.389, 105.2462, "2026-10-14", "2026-10-14T19:02:00Z"),
    ("Sumatra", -3.3833, 105.2407, "2026-10-16", "2026-10-16T19:08:00Z"),
    ("Sumatra", -3.393, 105.2368, "2026-10-18", "2026-10-18T19:06:00Z"),
]
RECORDED = "kalimantan-2026-10-18"

THRESH = {
    # Key & Benson 2006 (FIREMON LA, USDA RMRS-GTR-164-CD): dNBR 0.27 is the lower bound of
    # "moderate-low severity"; 0.10-0.27 is "low severity". 0.27 is the conservative choice.
    "dnbr": 0.27,
    # Post-fire NBR ceiling: our own guard against haze/phenology false positives (dense tropical
    # vegetation has NBR around 0.4-0.7, fresh peat/shrub scars near or below 0). Not from a paper;
    # sensitivity at 0.0 and 0.2 is reported.
    "post_nbr": 0.10,
    # Sentinel-1: burned tropical vegetation shows a VH (cross-pol) backscatter DECREASE
    # (Lohberger et al. 2018, Global Change Biology 24:644-654, Indonesia 2015 with S1;
    # Belenguer-Plomer et al. 2019, Remote Sensing of Environment 233:111345, VH most sensitive).
    # Neither gives one transferable dB threshold, so we use -3 dB on 100 m means (about 100
    # looks, speckle ~0.5 dB) and report -2 / -4 dB sensitivity.
    "s1_dvh_db": -3.0,
    # Pre-fire VH below this (linear gamma0, about -24 dB) is open water: not scored by S1.
    "s1_water_vh": 10 ** (-24 / 10),
}
S2_VALID_SCL = {2, 4, 5, 6}   # dark area (fresh scars are often labelled 2), vegetation, bare, water
S2_MAX_BLUE = 0.10            # B02 surface reflectance above this = smoke/haze not caught by SCL
S2_PIX = 320                  # 20 m pixels across the 6.4 km box (5 x 5 per 100 m cell)
S1_PIX = 128                  # 50 m, then 2 x 2 mean -> 100 m

GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2",
                CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF,.tiff", GDAL_HTTP_TIMEOUT="60")


def event_id(isl: str, d: str) -> str:
    return f"{isl.lower()}-{d}"


# ----------------------------------------------------------------------------- STAC reads
def search(collection: str, geo: dict, start: dt.date, end: dt.date) -> list:
    cache = CACHE / "stac" / f"{collection}_{geo['west']:.4f}_{geo['south']:.4f}_{start}_{end}.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        import pystac
        return [pystac.Item.from_dict(d) for d in json.loads(cache.read_text())]
    cat = pystac_client.Client.open(STAC)
    items = list(cat.search(collections=[collection], bbox=[geo["west"], geo["south"], geo["east"], geo["north"]],
                            datetime=f"{start}/{end}T23:59:59Z").items())
    cache.write_text(json.dumps([i.to_dict() for i in items]))
    return items


def warp_read(href: str, geo: dict, npix: int, resampling: Resampling, nodata) -> np.ndarray:
    tr = from_bounds(geo["west"], geo["south"], geo["east"], geo["north"], npix, npix)
    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(href) as src:
            with WarpedVRT(src, crs="EPSG:4326", transform=tr, width=npix, height=npix, resampling=resampling,
                           src_nodata=nodata, nodata=nodata) as vrt:
                return vrt.read(1).astype(np.float32)


def cached_read(key: str, fn):
    p = CACHE / "chips" / f"{key}.npy"
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():
        return np.load(p)
    for attempt in range(4):
        try:
            a = fn()
            np.save(p, a)
            return a
        except Exception as e:  # network hiccups on COG range reads
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def s2_chip(item, geo: dict, eid: str) -> dict:
    """Surface reflectance B02, B08, B12 and SCL on the 320 x 320 grid for one S2 item."""
    off = -1000.0 if float(item.properties.get("s2:processing_baseline", "0")) >= 4.0 else 0.0
    out = {}
    for band, rs in (("B02", Resampling.average), ("B08", Resampling.average), ("B12", Resampling.nearest), ("SCL", Resampling.nearest)):
        def fn(band=band, rs=rs):
            # Sign on every attempt: planetary_computer caches the SAS token and renews it when it expires.
            return warp_read(pc.sign(item).assets[band].href, geo, S2_PIX, rs, 0)
        a = cached_read(f"{eid}_{item.id}_{band}", fn)
        out[band] = a if band == "SCL" else np.where(a > 0, (a + off) / 10000.0, np.nan)
    return out


def s1_chip(item, geo: dict, eid: str) -> dict:
    out = {}
    for pol in ("vh", "vv"):
        def fn(pol=pol):
            return warp_read(pc.sign(item).assets[pol].href, geo, S1_PIX, Resampling.average, -32768)
        a = cached_read(f"{eid}_{item.id}_{pol}", fn)
        a = np.where((a > 0) & np.isfinite(a), a, np.nan)
        out[pol] = np.nanmean(a.reshape(GRID, 2, GRID, 2), axis=(1, 3)) if np.isfinite(a).any() else np.full((GRID, GRID), np.nan)
    return out


# ----------------------------------------------------------------------------- Sentinel-2
def s2_burn(geo: dict, eid: str, d: dt.date) -> dict:
    pre_s, pre_e = d - dt.timedelta(days=32), d - dt.timedelta(days=2)
    post_s, post_e = d + dt.timedelta(days=1), TODAY
    items = search("sentinel-2-l2a", geo, pre_s, post_e)
    pre_items = [i for i in items if pre_s <= i.datetime.date() <= pre_e]
    post_items = [i for i in items if post_s <= i.datetime.date() <= post_e]

    def nbr_stack(its):
        stack, dates = [], []
        with cf.ThreadPoolExecutor(6) as ex:
            chips = list(ex.map(lambda it: s2_chip(it, geo, eid), its))
        for it, c in zip(its, chips):
            valid = np.isin(c["SCL"], list(S2_VALID_SCL)) & np.isfinite(c["B08"]) & np.isfinite(c["B12"]) & (c["B02"] < S2_MAX_BLUE)
            nbr = (c["B08"] - c["B12"]) / (c["B08"] + c["B12"] + 1e-6)
            stack.append(np.where(valid, nbr, np.nan))
            dates.append((it.datetime.date().isoformat(), float(valid.mean())))
        return (np.stack(stack) if stack else np.full((1, S2_PIX, S2_PIX), np.nan)), dates

    pre, pre_dates = nbr_stack(pre_items)
    post, post_dates = nbr_stack(post_items)
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore", RuntimeWarning)
        pre_m = np.nanmedian(pre, axis=0)
        post_m = np.nanmedian(post, axis=0)
    dnbr = pre_m - post_m
    ok = np.isfinite(dnbr)
    blk = lambda a: a.reshape(GRID, 5, GRID, 5).swapaxes(1, 2).reshape(GRID, GRID, 25)  # noqa: E731

    def cells(dthr, pthr):
        burned_px = ok & (dnbr > dthr) & (post_m < pthr)
        okc = blk(ok).sum(-1)
        clear = okc >= 13
        frac = blk(burned_px).sum(-1) / np.maximum(1, okc)
        return clear, clear & (frac >= 0.5)

    clear, burned = cells(THRESH["dnbr"], THRESH["post_nbr"])
    sens = {}
    for dthr in (0.10, 0.27, 0.44):
        for pthr in (0.0, 0.10, 0.20):
            sens[f"dnbr>{dthr:.2f},post<{pthr:.2f}"] = int(cells(dthr, pthr)[1].sum())
    dnbr_cell = np.nanmean(np.where(ok, dnbr, np.nan).reshape(GRID, 5, GRID, 5), axis=(1, 3))
    # Distinct dates (tiles of the same date counted once) with their best clear fraction.
    agg = lambda ds: sorted({k: max(v for kk, v in ds if kk == k) for k, _ in ds}.items())  # noqa: E731
    return dict(clear=clear, burned=burned, dnbr=dnbr_cell, sens=sens,
                pre_dates=agg(pre_dates), post_dates=agg(post_dates),
                pre_window=[pre_s.isoformat(), pre_e.isoformat()], post_window=[post_s.isoformat(), post_e.isoformat()])


# ----------------------------------------------------------------------------- Sentinel-1
def s1_burn(geo: dict, eid: str, d: dt.date) -> dict:
    pre_s, pre_e = d - dt.timedelta(days=32), d - dt.timedelta(days=2)
    post_s, post_e = d + dt.timedelta(days=1), TODAY
    items = search("sentinel-1-rtc", geo, pre_s, post_e)
    by_orbit: dict[int, dict] = {}
    for it in items:
        o = it.properties.get("sat:relative_orbit")
        dd = it.datetime.date()
        slot = "pre" if pre_s <= dd <= pre_e else "post" if post_s <= dd <= post_e else None
        if slot:
            by_orbit.setdefault(o, {"pre": [], "post": []})[slot].append(it)
    dvh_list, dvv_list, used = [], [], []
    water = np.zeros((GRID, GRID), bool)
    for o, g in sorted(by_orbit.items()):
        if not g["pre"] or not g["post"]:
            continue
        with cf.ThreadPoolExecutor(4) as ex:
            pre = list(ex.map(lambda it: s1_chip(it, geo, eid), g["pre"]))
            post = list(ex.map(lambda it: s1_chip(it, geo, eid), g["post"]))
        import warnings
        warnings.simplefilter("ignore", RuntimeWarning)
        m = lambda cs, p: np.nanmean(np.stack([c[p] for c in cs]), axis=0)  # noqa: E731  (linear power mean)
        pvh, qvh, pvv, qvv = m(pre, "vh"), m(post, "vh"), m(pre, "vv"), m(post, "vv")
        dvh_list.append(10 * np.log10(qvh / pvh))
        dvv_list.append(10 * np.log10(qvv / pvv))
        water |= pvh < THRESH["s1_water_vh"]
        used.append({"relative_orbit": o, "pre": sorted({i.datetime.date().isoformat() for i in g["pre"]}),
                     "post": sorted({i.datetime.date().isoformat() for i in g["post"]})})
    if not dvh_list:
        z = np.zeros((GRID, GRID), bool)
        return dict(ok=z, burned=z, dvh=np.full((GRID, GRID), np.nan), sens={}, orbits=[],
                    note="no relative orbit with both a pre (D-32..D-2) and a post (D+1..24 Oct) acquisition")
    import warnings
    warnings.simplefilter("ignore", RuntimeWarning)
    dvh = np.nanmean(np.stack(dvh_list), axis=0)
    dvv = np.nanmean(np.stack(dvv_list), axis=0)
    ok = np.isfinite(dvh) & ~water
    sens = {f"dVH<={t:.0f}dB": int((ok & (dvh <= t)).sum()) for t in (-2.0, -3.0, -4.0)}
    return dict(ok=ok, burned=ok & (dvh <= THRESH["s1_dvh_db"]), dvh=dvh, dvv=dvv, sens=sens, orbits=used,
                water_cells=int(water.sum()), note="")


# ----------------------------------------------------------------------------- FIRMS
FIRMS_SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]


def firms(geo: dict, start: dt.date, end: dt.date) -> list[dict]:
    """All VIIRS detections in the box acquired on start..end (UTC dates), from the FIRMS area API."""
    key = read_env("FIRMS_MAP_KEY")
    if not key:
        raise RuntimeError("FIRMS_MAP_KEY missing in .env")
    w, s, e, n = (round(geo[k], 4) for k in ("west", "south", "east", "north"))
    rows = []
    for src in FIRMS_SOURCES:
        day = start
        while day <= end:
            ndays = min(5, (end - day).days + 1)  # the area API accepts 1..5 days
            cache = CACHE / "firms" / f"{src}_{w}_{s}_{e}_{n}_{day}_{ndays}.csv"
            cache.parent.mkdir(parents=True, exist_ok=True)
            if not cache.exists():
                url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{src}/{w},{s},{e},{n}/{ndays}/{day}"
                txt = None
                for attempt in range(4):
                    try:
                        r = requests.get(url, timeout=120)
                        if r.status_code == 200 and r.text.startswith("latitude"):
                            txt = r.text
                            break
                        err = f"HTTP {r.status_code}: {r.text[:80]!r}"
                    except requests.RequestException as ex:
                        err = type(ex).__name__  # never echo the URL: it holds the key
                    time.sleep(5 * (attempt + 1))
                if txt is None:
                    raise RuntimeError(f"FIRMS {src} {day}+{ndays}d failed: {err}".replace(key, "<KEY>"))
                # Only cache windows that are fully in the past (NRT fills in for ~3 h after a pass).
                if day + dt.timedelta(days=ndays) < TODAY:
                    cache.write_text(txt)
            else:
                txt = cache.read_text()
            lines = txt.strip().splitlines()
            hdr = lines[0].split(",")
            for ln in lines[1:]:
                rec = dict(zip(hdr, ln.split(",")))
                ad = dt.date.fromisoformat(rec["acq_date"])
                if start <= ad <= end:
                    rows.append({"lat": float(rec["latitude"]), "lon": float(rec["longitude"]), "frp": float(rec["frp"] or 0),
                                 "acquired": f"{rec['acq_date']}T{rec['acq_time'].zfill(4)[:2]}:{rec['acq_time'].zfill(4)[2:]}:00Z",
                                 "src": src})
            day += dt.timedelta(days=ndays)
    uniq = {(r["lat"], r["lon"], r["acquired"], r["src"]): r for r in rows}
    return list(uniq.values())


def firms_footprint(geo: dict, dets: list[dict], radius_m: float = 187.5) -> np.ndarray:
    """Cells whose centre is within a 375 m VIIRS pixel (radius 187.5 m) of a detection."""
    fp = np.zeros((GRID, GRID), bool)
    if not dets:
        return fp
    x, y = to_cell(geo, [d["lat"] for d in dets], [d["lon"] for d in dets])
    r = radius_m / CELL_M
    yy, xx = np.mgrid[0:GRID, 0:GRID]
    for cx, cy in zip(x, y):
        fp |= (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    return fp


# ----------------------------------------------------------------------------- forecast
def forecast_metrics(burned: np.ndarray, observable: np.ndarray, fc: dict, min_cells: int = 2) -> dict:
    """POD/FAR/CSI of the forecast against measured NEW burn, in 400 m blocks (src/sim/hindcast.ts logic)."""
    B = fc["block"]
    bw = bh = GRID // B
    fire0 = np.array(fc["fireAtT0"], bool).reshape(GRID, GRID)
    blk = lambda a: a.reshape(bh, B, bw, B).swapaxes(1, 2).reshape(bh, bw, B * B)  # noqa: E731
    fire_b = blk(fire0).any(-1)
    # Distance (km) from each block to the nearest block on fire at t0.
    by, bx = np.mgrid[0:bh, 0:bw]
    fb = np.argwhere(fire_b)
    dist = np.full((bh, bw), np.inf)
    for fy, fx in fb:
        dist = np.minimum(dist, np.hypot(by - fy, bx - fx) * B * CELL_M / 1000)
    new_burn = burned & ~fire0
    obs_b = blk(new_burn).sum(-1) >= min_cells
    seen_b = blk(observable).sum(-1) >= (B * B) // 2
    cand = ~fire_b & (dist <= 3.0) & seen_b
    res = {"block_m": B * CELL_M, "min_burned_cells_per_block": min_cells, "candidates": int(cand.sum()),
           "observed_new_blocks": int((obs_b & cand).sum()),
           "unscored_cloudy_blocks": int((~fire_b & (dist <= 3.0) & ~seen_b).sum())}
    for h in ("24", "48"):
        p = np.array(fc[f"blockPNew{h}"]).reshape(bh, bw)
        pred = (p >= 0.5) & cand
        o = obs_b & cand
        hits, miss, fa = int((pred & o).sum()), int((~pred & o).sum()), int((pred & ~o).sum())
        # Distance-only forecast with the same number of blocks.
        order = sorted(zip(dist[cand], np.flatnonzero(cand.ravel())))[: max(1, hits + fa)]
        near = np.zeros(bh * bw, bool)
        near[[k for _, k in order]] = True
        near = near.reshape(bh, bw) & cand
        dh, dm, dfa = int((near & o).sum()), int((~near & o).sum()), int((near & ~o).sum())
        rat = lambda a, b: round(a / b, 3) if b else None  # noqa: E731
        pc_ = np.array(fc[f"pNew{h}"]).reshape(GRID, GRID)
        pany = np.array(fc[f"p{h}"]).reshape(GRID, GRID)
        res[f"{h}h"] = {
            "predicted": hits + fa, "hits": hits, "misses": miss, "false_alarms": fa,
            "pod": rat(hits, hits + miss), "far": rat(fa, hits + fa), "csi": rat(hits, hits + miss + fa),
            "distance_only_csi": rat(dh, dh + dm + dfa),
            # Mean forecast probability over the measured burned cells (each cell weighted by its 1 ha).
            "mean_p_new_over_new_burned_cells": round(float(pc_[new_burn].mean()), 3) if new_burn.any() else None,
            "mean_p_any_over_all_burned_cells": round(float(pany[burned].mean()), 3) if burned.any() else None,
            "mean_p_new_over_unburned_observable_cells": round(float(pc_[observable & ~burned & ~fire0].mean()), 3) if (observable & ~burned & ~fire0).any() else None,
        }
    return res


# ----------------------------------------------------------------------------- quicklook
def quicklook(path: Path, title: str, s2, s1, sensor, burned, fp, dets, geo, fc=None):
    S = 4
    rgb = np.zeros((GRID, GRID, 3), np.uint8)
    rgb[:] = (60, 60, 60)                              # no clear observation
    rgb[sensor == 2] = (222, 222, 210)                 # S2 clear, unburned
    rgb[sensor == 1] = (170, 185, 205)                 # S1 only, unburned
    rgb[burned & (sensor == 2)] = (200, 40, 30)        # burned (S2)
    rgb[burned & (sensor == 1)] = (240, 150, 30)       # burned (S1)
    a = Image.fromarray(rgb).resize((GRID * S, GRID * S), Image.NEAREST)
    dr = ImageDraw.Draw(a)
    pad = np.pad(fp, 1, mode="edge")
    edge = fp & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    for y, x in np.argwhere(edge):
        dr.rectangle([x * S + 1, y * S + 1, x * S + 2, y * S + 2], fill=(20, 20, 20))
    panels = [a]
    # Change strength, white = burn-like: S2 dNBR (-0.2..0.7) where S2 decided, else S1 VH drop (+2..-6 dB).
    g = np.full((GRID, GRID), np.nan)
    g2 = np.clip((s2["dnbr"] + 0.2) / 0.9, 0, 1)
    g1 = np.clip((2.0 - s1["dvh"]) / 8.0, 0, 1)
    g[sensor == 2] = g2[sensor == 2]
    g[sensor == 1] = g1[sensor == 1]
    b = np.stack([(np.nan_to_num(g) * 255).astype(np.uint8)] * 3, -1)
    b[sensor == 0] = (40, 60, 90)
    panels.append(Image.fromarray(b).resize((GRID * S, GRID * S), Image.NEAREST))
    if fc is not None:
        p = np.array(fc["pNew48"]).reshape(GRID, GRID)
        c = np.zeros((GRID, GRID, 3), np.uint8)
        c[..., 0] = (p * 255).astype(np.uint8)
        c[..., 1] = (p * 120).astype(np.uint8)
        c[np.array(fc["fireAtT0"], bool).reshape(GRID, GRID)] = (90, 90, 90)
        cimg = Image.fromarray(c).resize((GRID * S, GRID * S), Image.NEAREST)
        dc = ImageDraw.Draw(cimg)
        for y, x in np.argwhere(burned & ~np.array(fc["fireAtT0"], bool).reshape(GRID, GRID)):
            dc.rectangle([x * S + 1, y * S + 1, x * S + 2, y * S + 2], fill=(80, 200, 255))
        panels.append(cimg)
    W = len(panels) * (GRID * S + 6) + 6
    img = Image.new("RGB", (W, GRID * S + 34), (250, 250, 248))
    for i, pnl in enumerate(panels):
        img.paste(pnl, (6 + i * (GRID * S + 6), 28))
    d = ImageDraw.Draw(img)
    d.text((6, 4), title, fill=(20, 20, 20))
    labels = ["burned: red S2 / orange S1; grey = no clear obs; dots = FIRMS 375 m footprint", "change: S2 dNBR or S1 VH drop (white = burn-like)", "forecast P(new fire, 48 h); blue = measured new burn"]
    d.text((6, 16), " | ".join(labels[: len(panels)])[:150], fill=(80, 80, 80))
    buf = io.BytesIO()
    img.quantize(64).save(buf, "PNG", optimize=True)
    path.write_bytes(buf.getvalue())


# ----------------------------------------------------------------------------- main
def run_event(isl, lat, lon, d, t0, fc_all):
    eid = event_id(isl, d)
    geo = bbox_around(lat, lon)
    D = dt.date.fromisoformat(d)
    print(f"[{eid}] Sentinel-2 ...", flush=True)
    s2 = s2_burn(geo, eid, D)
    print(f"[{eid}] Sentinel-1 ...", flush=True)
    s1 = s1_burn(geo, eid, D)
    sensor = np.where(s2["clear"], 2, np.where(s1["ok"], 1, 0)).astype(np.uint8)
    burned = np.where(sensor == 2, s2["burned"], np.where(sensor == 1, s1["burned"], False))
    observable = sensor > 0
    # Where both sensors see the ground, how often does S1 agree with S2 (taken as the reference)?
    both = s2["clear"] & s1["ok"]
    s1_vs_s2 = {"cells_with_both": int(both.sum()), "s2_burned": int((both & s2["burned"]).sum())}
    if both.any():
        for t in (-2.0, -3.0, -4.0):
            b1 = both & (s1["dvh"] <= t)
            tp, fp_, fn = int((b1 & s2["burned"]).sum()), int((b1 & ~s2["burned"]).sum()), int((both & ~b1 & s2["burned"]).sum())
            s1_vs_s2[f"dVH<={t:.0f}dB"] = {"both_burned": tp, "s1_only": fp_, "s2_only": fn,
                                           "s1_recall_of_s2": round(tp / max(1, tp + fn), 3), "s1_precision_vs_s2": round(tp / max(1, tp + fp_), 3)}
    print(f"[{eid}] FIRMS ...", flush=True)
    fw = (D - dt.timedelta(days=2), TODAY)
    dets = firms(geo, *fw)
    x, y = to_cell(geo, [r["lat"] for r in dets], [r["lon"] for r in dets])
    in_box = [(r) for r, xi, yi in zip(dets, x, y) if -0.5 <= xi < GRID - 0.5 and -0.5 <= yi < GRID - 0.5]
    fp = firms_footprint(geo, in_box)
    ha = lambda m: int(m.sum()) * CELL_M * CELL_M / 1e4  # noqa: E731
    metrics = {
        "burned_ha": ha(burned), "burned_ha_s2": ha(burned & (sensor == 2)), "burned_ha_s1": ha(burned & (sensor == 1)),
        "observed_ha": ha(observable), "observed_frac": round(float(observable.mean()), 3),
        "s2_clear_frac": round(float(s2["clear"].mean()), 3), "s1_frac": round(float(s1["ok"].mean()), 3),
        "s1_only_frac": round(float((sensor == 1).mean()), 3),
        "firms_detections": len(in_box), "firms_footprint_ha": ha(fp),
        "firms_footprint_observed_ha": ha(fp & observable),
        "overlap_ha": ha(fp & burned),
        "share_of_burned_inside_firms_footprint": round(float((fp & burned).sum() / max(1, burned.sum())), 3),
        "share_of_observed_firms_footprint_burned": round(float((fp & burned).sum() / max(1, (fp & observable).sum())), 3),
    }
    out = {
        "id": eid, "island": isl, "lat": lat, "lon": lon, "day": d, "t0": t0,
        "grid": {"w": GRID, "h": GRID, "cellM": CELL_M, "geo": geo, "origin": "cell (0,0) = north-west corner; arrays row-major (y*64+x)",
                 "encoding": "base64 of numpy.packbits(mask.ravel()), MSB first, 4096 bits"},
        "masks": {"burned": b64_bits(burned), "clear": b64_bits(observable),
                  "sensorS2": b64_bits(sensor == 2), "sensorS1": b64_bits(sensor == 1), "firmsFootprint": b64_bits(fp)},
        "thresholds": THRESH | {"s2_valid_scl": sorted(S2_VALID_SCL), "s2_max_blue": S2_MAX_BLUE,
                                 "s2_cell_rule": ">=13 of 25 20-m pixels with pre and post; burned if >=50% of them pass",
                                 "combine": "S2 where clear, else S1 where available"},
        "sentinel2": {"pre_window": s2["pre_window"], "post_window": s2["post_window"],
                      "pre_dates_clear_frac": [[k, round(v, 3)] for k, v in s2["pre_dates"]],
                      "post_dates_clear_frac": [[k, round(v, 3)] for k, v in s2["post_dates"]],
                      "burned_cells_sensitivity_on_s2_clear_cells": s2["sens"]},
        "s1_vs_s2_where_both_clear": s1_vs_s2,
        "sentinel1": {"orbits": s1["orbits"], "note": s1["note"], "water_cells": s1.get("water_cells", 0),
                      "burned_cells_sensitivity_on_s1_cells": s1["sens"]},
        "firms": {"window_utc_dates": [fw[0].isoformat(), fw[1].isoformat()], "sources": FIRMS_SOURCES,
                  "footprint": "375 m disc (radius 187.5 m) per detection, rasterised at cell centres"},
        "metrics": metrics,
    }
    fc = fc_all if eid == RECORDED else None
    if fc is not None:
        out["forecast"] = {"source": f"data/validation/burned-area/forecast-{RECORDED}.json (ml/rs/forecast_events.ts)",
                           "t0": fc["t0"], "weather48": fc["weather48"],
                           "vs_measured_burned_area": forecast_metrics(burned, observable, fc),
                           "sensitivity_min_cells_per_block": {str(m): forecast_metrics(burned, observable, fc, m)
                                                              for m in (1, 4)},
                           "note": "Measured burn spans D-2 (pre composite) to the last post scene, so it is not limited to 24/48 h."}
    else:
        out["forecast"] = None
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{eid}.json").write_text(json.dumps(out, indent=1))
    quicklook(OUT / f"{eid}.png", f"{eid}  burned {metrics['burned_ha']:.0f} ha  (S2 clear {metrics['s2_clear_frac']:.0%}, S1 {metrics['s1_frac']:.0%})",
              s2, s1, sensor, burned, fp, in_box, geo, fc)
    print(f"[{eid}] burned {metrics['burned_ha']:.0f} ha (S2 {metrics['burned_ha_s2']:.0f}, S1 {metrics['burned_ha_s1']:.0f}); "
          f"observed {metrics['observed_frac']:.0%}; FIRMS {metrics['firms_detections']} det, {metrics['firms_footprint_ha']:.0f} ha; overlap {metrics['overlap_ha']:.0f} ha", flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="event id, e.g. kalimantan-2026-10-18")
    a = ap.parse_args()
    fpath = OUT / f"forecast-{RECORDED}.json"
    fc = json.loads(fpath.read_text()) if fpath.exists() else None
    if fc is None:
        print("forecast file missing: run `npx tsx ml/rs/forecast_events.ts` first", file=sys.stderr)
    rows = []
    for ev in EVENTS:
        if a.only and event_id(ev[0], ev[3]) != a.only:
            continue
        try:
            rows.append(run_event(*ev, fc))
        except Exception as e:
            msg = str(e).split("?")[0][:300]   # drop SAS query strings from asset URLs
            print(f"[{event_id(ev[0], ev[3])}] FAILED: {msg}", flush=True)
            rows.append({"id": event_id(ev[0], ev[3]), "error": msg})
    if not a.only:
        summ = {"ranAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "today": TODAY.isoformat(),
                "events": [{"id": r["id"], **({"error": r["error"]} if "error" in r else r["metrics"]),
                            **({"forecast": r["forecast"]["vs_measured_burned_area"]} if r.get("forecast") else {})} for r in rows]}
        (OUT / "summary.json").write_text(json.dumps(summ, indent=1))
        print(f"wrote {OUT / 'summary.json'}")


if __name__ == "__main__":
    main()
