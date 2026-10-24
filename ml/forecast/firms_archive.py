"""Download the keyless NASA FIRMS yearly country files for Indonesia and write per-island extracts.

    uv run python firms_archive.py            # download (cached) + extracts + manifest

Files land in .cache/firms-archive/ under their original names (viirs-snpp_<Y>_Indonesia.csv,
modis_<Y>_Indonesia.csv). Only type == 0 (presumed vegetation fire) is kept in the extracts;
type 1 (active volcano), 2 (other static land source) and 3 (offshore) are dropped and counted.
Extracts: .cache/firms-archive/<island>-<src>.parquet with lat, lon, t (UTC), frp, conf, year.
"""
from __future__ import annotations

import json
import sys
import time

import pandas as pd
import requests

from common import FIRMS_DIR, FIRMS_URL, ISLANDS, SOURCES, firms_name, sha256_file

USECOLS = ["latitude", "longitude", "acq_date", "acq_time", "frp", "confidence", "type"]


def download(src: str, year: int) -> None:
    out = FIRMS_DIR / firms_name(src, year)
    if out.exists() and out.stat().st_size > 0:
        return
    url = FIRMS_URL.format(src=src, year=year)
    for attempt in range(4):
        try:
            with requests.get(url, stream=True, timeout=120) as r:
                if r.status_code == 404:
                    print(f"  missing: {url}")
                    return
                r.raise_for_status()
                tmp = out.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                tmp.rename(out)
                print(f"  {out.name}: {out.stat().st_size / 1e6:.1f} MB")
                return
        except requests.RequestException as e:
            print(f"  retry {attempt + 1} {url}: {e}")
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"could not download {url}")


def load(src: str, year: int) -> tuple[pd.DataFrame, dict]:
    p = FIRMS_DIR / firms_name(src, year)
    df = pd.read_csv(p, usecols=lambda c: c in USECOLS, dtype={"acq_time": str, "confidence": str})
    rows = len(df)
    has_type = "type" in df.columns
    dropped = 0
    if "type" in df.columns:
        keep = df["type"] == 0
        dropped = int((~keep).sum())
        df = df[keep]
    t = pd.to_datetime(df["acq_date"] + " " + df["acq_time"].str.zfill(4), format="%Y-%m-%d %H%M", utc=True)
    out = pd.DataFrame({
        "lat": df["latitude"].astype("float32"),
        "lon": df["longitude"].astype("float32"),
        "t": t,
        "frp": df["frp"].astype("float32"),
        "conf": df["confidence"].astype(str),
        "year": t.dt.year.astype("int16"),
    })
    meta = {"name": p.name, "sha256": sha256_file(p), "rows": rows, "droppedNonVegetation": dropped,
            "hasType": has_type}
    return out, meta


def main() -> None:
    """Args: optional source names (viirs-snpp, modis) to process only those; --no-download."""
    FIRMS_DIR.mkdir(parents=True, exist_ok=True)
    only = [a for a in sys.argv[1:] if not a.startswith("--")] or list(SOURCES)
    sources = {k: v for k, v in SOURCES.items() if k in only}
    if "--no-download" not in sys.argv:
        for src, years in sources.items():
            for y in years:
                download(src, y)
    mf = FIRMS_DIR / "manifest.json"
    manifest = [m for m in (json.loads(mf.read_text()) if mf.exists() else []) if not any(m["name"].startswith(s + "_") for s in sources)]
    for src, years in sources.items():
        parts: dict[str, list[pd.DataFrame]] = {k: [] for k in ISLANDS}
        for y in years:
            if not (FIRMS_DIR / firms_name(src, y)).exists():
                continue
            df, meta = load(src, y)
            for isl, (w, s, e, n) in ISLANDS.items():
                m = (df.lon >= w) & (df.lon <= e) & (df.lat >= s) & (df.lat <= n)
                parts[isl].append(df[m])
                meta[f"rows{isl}"] = int(m.sum())
            manifest.append(meta)
            print(f"{meta['name']}: {meta['rows']} rows, dropped {meta['droppedNonVegetation']} non-vegetation", flush=True)
        for isl, ps in parts.items():
            d = pd.concat(ps, ignore_index=True).sort_values("t", kind="stable")
            d.to_parquet(FIRMS_DIR / f"{isl.lower()}-{src}.parquet", index=False)
            print(f"  {isl} {src}: {len(d)} vegetation detections", flush=True)
    manifest.sort(key=lambda m: m["name"])
    mf.write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    sys.exit(main())
