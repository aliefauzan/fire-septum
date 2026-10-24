"""Validation events, the published train/validation/test split, and the training-box list.

    uv run python events.py

Reads the per-island VIIRS S-NPP extracts written by firms_archive.py and writes
data/validation/events.json and data/validation/train-boxes.json. The rule below is fixed
before any forecaster score is seen; it generalises the 12-event rule of docs/hindcast.md.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from common import FIRMS_DIR, ISLANDS, ROOT, bbox_around, firms_name

OUT_DIR = ROOT / "data" / "validation"
YEARS = (2015, 2019, 2023)
TRAIN_YEARS = (2015, 2019)
SEED_CELL_DEG = 0.06  # clusterHotspots in src/data/firms.ts
MIN_DET_D = 5
MIN_DET_D1 = 1

RULE = (
    "For every UTC day D from 1 August to 31 October of 2015, 2019 and 2023, separately for "
    "Kalimantan [108.5, -4.5, 119.5, 4.5] and Sumatra [95, -6, 106.5, 6] (west, south, east, north), "
    "using NASA FIRMS VIIRS S-NPP standard-processing detections from the yearly Indonesia country "
    "files with type == 0 (presumed vegetation fire): (1) group the detections of day D on a 0.06 degree "
    "grid (clusterHotspots in src/data/firms.ts); (2) for each group, centre = mean latitude and mean "
    "longitude of its detections, box = bboxAround(centre) from src/data/live.ts (6.4 km x 6.4 km); "
    "(3) detD = VIIRS S-NPP detections inside the box on day D, detD1 = VIIRS S-NPP detections inside "
    "the box on UTC day D+1; (4) drop boxes with detD < 5 or detD1 < 1; (5) rank the rest by detD "
    "(ties: higher detD1, then lower latitude, then lower longitude) and take them greedily, skipping "
    "any box that overlaps one already taken, until 3 boxes (events) or 8 boxes (training-sample list, "
    "train years only) are taken. t0 = the latest detection inside the box on day D (UTC). "
    "The 12 events of 8 to 18 October 2026 (docs/hindcast.md, VALIDATION_EVENTS in "
    "src/data/hindcastBatch.ts) are added unchanged as an out-of-time set."
)

SPLIT = {
    "train": "2015 and 2019, Kalimantan and Sumatra",
    "validation": "2023 Kalimantan: all tuning, including isotonic calibration and any hyperparameter search",
    "test": "2023 Sumatra: touched once, at the end",
    "oot": "out-of-time test: the 12 events of October 2026 and the prospective forecast register",
}

# docs/hindcast.md and docs/hindcast-rerun-2026-10-24.json (t0 is the same in every rerun).
EVENTS_2026 = [
    ("Kalimantan", "2026-10-08", "2026-10-08T18:53:00Z", -2.5235, 113.0298),
    ("Kalimantan", "2026-10-10", "2026-10-10T18:36:00Z", -3.1011, 112.1923),
    ("Kalimantan", "2026-10-12", "2026-10-12T17:02:00Z", -3.3284, 112.1442),
    ("Kalimantan", "2026-10-14", "2026-10-14T19:00:00Z", -2.8114, 110.6903),
    ("Kalimantan", "2026-10-16", "2026-10-16T18:21:00Z", -2.8132, 110.6886),
    ("Kalimantan", "2026-10-18", "2026-10-18T19:06:00Z", -2.8179, 110.6934),
    ("Sumatra", "2026-10-08", "2026-10-08T19:13:00Z", -1.8698, 103.9044),
    ("Sumatra", "2026-10-10", "2026-10-10T18:36:00Z", -3.5741, 105.7519),
    ("Sumatra", "2026-10-12", "2026-10-12T06:57:00Z", -3.5711, 105.7507),
    ("Sumatra", "2026-10-14", "2026-10-14T19:02:00Z", -3.3890, 105.2462),
    ("Sumatra", "2026-10-16", "2026-10-16T19:08:00Z", -3.3833, 105.2407),
    ("Sumatra", "2026-10-18", "2026-10-18T19:06:00Z", -3.3930, 105.2368),
]
CODE = {"Kalimantan": "KAL", "Sumatra": "SUM"}


def split_of(island: str, year: int) -> str:
    if year in TRAIN_YEARS:
        return "train"
    if year == 2023:
        return "validation" if island == "Kalimantan" else "test"
    return "oot"


def boxes_for_day(day: pd.DataFrame, nxt: pd.DataFrame, k: int) -> list[dict]:
    if len(day) < MIN_DET_D:
        return []
    lat, lon = day.lat.to_numpy(np.float64), day.lon.to_numpy(np.float64)
    t = day.t.dt.tz_convert(None).to_numpy()  # naive UTC datetime64
    nlat, nlon = nxt.lat.to_numpy(np.float64), nxt.lon.to_numpy(np.float64)
    key = np.floor(lat / SEED_CELL_DEG).astype(np.int64) * 100_000 + np.floor(lon / SEED_CELL_DEG).astype(np.int64)
    cands = []
    for g in np.unique(key):
        m = key == g
        c_lat, c_lon = float(lat[m].mean()), float(lon[m].mean())
        b = bbox_around(c_lat, c_lon)
        inside = (lat >= b["south"]) & (lat <= b["north"]) & (lon >= b["west"]) & (lon <= b["east"])
        det_d = int(inside.sum())
        if det_d < MIN_DET_D:
            continue
        det_d1 = int(((nlat >= b["south"]) & (nlat <= b["north"]) & (nlon >= b["west"]) & (nlon <= b["east"])).sum())
        if det_d1 < MIN_DET_D1:
            continue
        t0 = pd.Timestamp(t[inside].max())
        cands.append({"lat": c_lat, "lon": c_lon, "box": b, "detD": det_d, "detD1": det_d1, "t0": t0})
    cands.sort(key=lambda c: (-c["detD"], -c["detD1"], c["lat"], c["lon"]))
    taken: list[dict] = []
    for c in cands:
        b = c["box"]
        if any(b["west"] < o["box"]["east"] and o["box"]["west"] < b["east"] and b["south"] < o["box"]["north"] and o["box"]["south"] < b["north"] for o in taken):
            continue
        taken.append(c)
        if len(taken) == k:
            break
    return taken


def build(years, k: int) -> list[dict]:
    out = []
    for isl in ISLANDS:
        df = pd.read_parquet(FIRMS_DIR / f"{isl.lower()}-viirs-snpp.parquet", columns=["lat", "lon", "t", "year"])
        df = df[df.year.isin(years)]
        df["d"] = df.t.dt.strftime("%Y-%m-%d")
        by_day = {d: g for d, g in df.groupby("d")}
        empty = df.iloc[:0]
        for y in years:
            d = date(y, 8, 1)
            while d <= date(y, 10, 31):
                ds, ns = d.isoformat(), (d + timedelta(days=1)).isoformat()
                for rank, c in enumerate(boxes_for_day(by_day.get(ds, empty), by_day.get(ns, empty), k), 1):
                    out.append({
                        "id": f"{CODE[isl]}-{ds}-{rank}", "island": isl, "d": ds,
                        "t0": c["t0"].strftime("%Y-%m-%dT%H:%M:00Z"),
                        "lat": round(c["lat"], 5), "lon": round(c["lon"], 5),
                        "split": split_of(isl, y), "detD": c["detD"], "detD1": c["detD1"],
                    })
                d += timedelta(days=1)
    out.sort(key=lambda e: (e["d"], e["island"], e["id"]))
    return out


def firms_files(years) -> list[dict]:
    man = {m["name"]: m for m in json.loads((FIRMS_DIR / "manifest.json").read_text())}
    return [{"name": n, "sha256": man[n]["sha256"], "rows": man[n]["rows"], "droppedNonVegetation": man[n]["droppedNonVegetation"]}
            for n in (firms_name("viirs-snpp", y) for y in years)]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    events = build(YEARS, 3)
    for i, (isl, d, t0, lat, lon) in enumerate(EVENTS_2026):
        events.append({"id": f"{CODE[isl]}-{d}-1", "island": isl, "d": d, "t0": t0, "lat": lat, "lon": lon,
                       "split": "oot", "detD": None, "detD1": None})
    doc = {"v": 1, "kind": "fireseptum.validation-events", "rule": RULE, "split": SPLIT, "generatedAt": now,
           "firmsFiles": firms_files(YEARS),
           "notes": "detD and detD1 are VIIRS S-NPP counts in the box; they are null for the 2026 events, which "
                    "were chosen in October 2026 from VIIRS S-NPP + NOAA-20 + NOAA-21 near-real-time data "
                    "(no 2026 yearly archive file exists yet).",
           "events": events}
    (OUT_DIR / "events.json").write_text(json.dumps(doc, indent=1) + "\n")
    boxes = build(TRAIN_YEARS, 8)
    tdoc = {"v": 1, "kind": "fireseptum.train-boxes", "rule": RULE.replace("until 3 boxes (events) or 8 boxes", "until 8 boxes"),
            "split": {"train": SPLIT["train"] + "; TRAIN-ONLY sample list, never used for validation or test"},
            "generatedAt": now, "firmsFiles": firms_files(TRAIN_YEARS), "events": boxes}
    (OUT_DIR / "train-boxes.json").write_text(json.dumps(tdoc, indent=1) + "\n")
    c = pd.DataFrame(events)
    c["year"] = c.d.str[:4]
    print(c.groupby(["split", "island", "year"]).size().to_string())
    print("train boxes:", len(boxes), pd.DataFrame(boxes).assign(year=lambda x: x.d.str[:4]).groupby(["island", "year"]).size().to_dict())


if __name__ == "__main__":
    main()
