"""Shared paths and constants for the Fire Septum forecast data pipeline."""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
FIRMS_DIR = CACHE / "firms-archive"
ERA5_DIR = CACHE / "era5"

# Same boxes as src/data/firms.ts (west, south, east, north).
ISLANDS: dict[str, tuple[float, float, float, float]] = {
    "Kalimantan": (108.5, -4.5, 119.5, 4.5),
    "Sumatra": (95.0, -6.0, 106.5, 6.0),
}

FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/{src}/{year}/{src}_{year}_Indonesia.csv"
SOURCES = {"viirs-snpp": range(2012, 2026), "modis": range(2001, 2026)}

# src/sim/scenarios.ts: GRID = 64 cells of CELL_M = 100 m, so the live box is 6.4 km.
BOX_M = 64 * 100


def firms_name(src: str, year: int) -> str:
    return f"{src}_{year}_Indonesia.csv"


def bbox_around(lat: float, lon: float, size_m: float = BOX_M) -> dict[str, float]:
    """Port of bboxAround in src/data/live.ts."""
    d_lat = size_m / 2 / 111_320
    d_lon = size_m / 2 / (111_320 * math.cos(math.radians(lat)))
    return {"north": lat + d_lat, "south": lat - d_lat, "west": lon - d_lon, "east": lon + d_lon}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
