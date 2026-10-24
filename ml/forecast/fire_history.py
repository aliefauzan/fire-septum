"""Fire-history raster: which calendar years 2001-2025 had fire on each 0.005 degree cell.

    uv run python fire_history.py

For per-cell peat burn depth (Konecny et al. 2016 classes: first, second, third, fourth+ fire on
the same ground; see docs/burn-depth.md). Input: the per-island extracts from firms_archive.py
(type == 0 only). A detection marks every cell whose rectangle comes within the sensor's
footprint radius of the detection point: VIIRS S-NPP 187 m (half of the 375 m I-band pixel),
MODIS 500 m (half of the 1 km pixel). Both sensors are used for every year they cover
(MODIS Terra/Aqua 2001-2025, VIIRS S-NPP 2012-2025).

Output, per island, public/data/fire-history/<island>.bin: sorted pairs of little-endian uint32
(cellIndex, yearMask). cellIndex = row * width + col with row 0 at the north edge and col 0 at the
west edge of the island bbox; bit i of yearMask = calendar year 2001 + i (UTC acquisition date).
Cells with no fire are absent. public/data/fire-history/index.json describes the grid.
"""
from __future__ import annotations

import hashlib
import json
import math

import numpy as np
import pandas as pd

from common import FIRMS_DIR, ISLANDS, ROOT

OUT = ROOT / "public" / "data" / "fire-history"
CELL_DEG = 0.005
Y0, Y1 = 2001, 2025
RADIUS_M = {"viirs-snpp": 187.0, "modis": 500.0}
M_PER_DEG = 111_320.0


def grid(bbox):
    w, s, e, n = bbox
    return round((e - w) / CELL_DEG), round((n - s) / CELL_DEG)


def mark(mask: np.ndarray, bbox, width: int, height: int, lat: np.ndarray, lon: np.ndarray, bits: np.ndarray, r_m: float) -> None:
    w, s, e, n = bbox
    fr = (n - lat) / CELL_DEG          # fractional row from the north edge
    fc = (lon - w) / CELL_DEG          # fractional column from the west edge
    row0, col0 = np.floor(fr).astype(np.int64), np.floor(fc).astype(np.int64)
    m_lat = CELL_DEG * M_PER_DEG
    m_lon = CELL_DEG * M_PER_DEG * np.cos(np.radians(lat))
    k = int(math.ceil(r_m / (CELL_DEG * M_PER_DEG * math.cos(math.radians(6.5))))) + 1
    for dr in range(-k, k + 1):
        for dc in range(-k, k + 1):
            r, c = row0 + dr, col0 + dc
            # Distance (m) from the point to the nearest edge of cell (r, c); 0 inside it.
            ddr = np.maximum(np.maximum(r - fr, fr - (r + 1)), 0) * m_lat
            ddc = np.maximum(np.maximum(c - fc, fc - (c + 1)), 0) * m_lon
            ok = (np.hypot(ddr, ddc) <= r_m) & (r >= 0) & (r < height) & (c >= 0) & (c < width)
            if ok.any():
                np.bitwise_or.at(mask, r[ok] * width + c[ok], bits[ok])


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = {
        "v": 1, "kind": "fireseptum.fire-history", "cellDeg": CELL_DEG, "years": [Y0, Y1], "bit0Year": Y0,
        "encoding": "pairs of little-endian uint32 (cellIndex, yearMask), sorted by cellIndex; cellIndex = row * width + col, "
                    "row 0 at the north edge, col 0 at the west edge of bbox; bit i of yearMask = calendar year 2001 + i (UTC); "
                    "cells without fire are absent",
        "footprint": {"viirs-snpp": "cells within 187 m of a detection (half the 375 m pixel), 2012-2025",
                      "modis": "cells within 500 m of a detection (half the 1 km pixel), 2001-2025"},
        "source": "NASA FIRMS yearly Indonesia country files (standard processing), type == 0 only",
        "islands": {},
    }
    for isl, bbox in ISLANDS.items():
        width, height = grid(bbox)
        mask = np.zeros(width * height, dtype=np.uint32)
        per_src = {}
        for src, r_m in RADIUS_M.items():
            df = pd.read_parquet(FIRMS_DIR / f"{isl.lower()}-{src}.parquet", columns=["lat", "lon", "year"])
            df = df[(df.year >= Y0) & (df.year <= Y1)]
            before = int((mask != 0).sum())
            # Chunk to bound memory.
            for i in range(0, len(df), 2_000_000):
                ch = df.iloc[i:i + 2_000_000]
                mark(mask, bbox, width, height, ch.lat.to_numpy(np.float64), ch.lon.to_numpy(np.float64),
                     (np.uint32(1) << (ch.year.to_numpy(np.uint32) - Y0)).astype(np.uint32), r_m)
            per_src[src] = {"detections": len(df), "newCells": int((mask != 0).sum()) - before}
        idx = np.flatnonzero(mask).astype(np.uint32)
        pairs = np.empty(idx.size * 2, dtype="<u4")
        pairs[0::2], pairs[1::2] = idx, mask[idx]
        name = f"{isl.lower()}.bin"
        raw = pairs.tobytes()
        (OUT / name).write_bytes(raw)
        years_per_cell = np.bitwise_count(mask[idx]).astype(np.int64)
        by_year = {str(Y0 + b): int(((mask[idx] >> b) & 1).sum()) for b in range(Y1 - Y0 + 1)}
        index["islands"][isl.lower()] = {
            "name": isl, "bbox": list(bbox), "width": width, "height": height, "file": name,
            "cells": int(idx.size), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "cellsByYear": by_year, "sources": per_src,
            "cellsByFireYears": {str(k): int((years_per_cell == k).sum()) for k in range(1, int(years_per_cell.max()) + 1)} if idx.size else {},
        }
        print(isl, width, "x", height, "cells with fire:", idx.size, f"{len(raw) / 1e6:.1f} MB", flush=True)
    (OUT / "index.json").write_text(json.dumps(index, indent=1) + "\n")


if __name__ == "__main__":
    main()
