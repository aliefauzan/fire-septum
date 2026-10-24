"""Shared helpers for the Fire Septum remote-sensing checks (ml/rs/)."""
from __future__ import annotations

import base64
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache" / "rs"
CACHE.mkdir(parents=True, exist_ok=True)

GRID = 64      # src/sim/scenarios.ts GRID
CELL_M = 100   # src/sim/scenarios.ts CELL_M


def bbox_around(lat: float, lon: float, size_m: float = GRID * CELL_M) -> dict:
    """Same as src/data/live.ts bboxAround: a square box in degrees around (lat, lon)."""
    d_lat = size_m / 2 / 111_320
    d_lon = size_m / 2 / (111_320 * math.cos(math.radians(lat)))
    return {"north": lat + d_lat, "south": lat - d_lat, "west": lon - d_lon, "east": lon + d_lon}


def to_cell(geo: dict, lat, lon, w: int = GRID, h: int = GRID):
    """Same as live.ts toCell: fractional cell coords with cell centres on integers."""
    x = (np.asarray(lon) - geo["west"]) / (geo["east"] - geo["west"]) * w - 0.5
    y = (geo["north"] - np.asarray(lat)) / (geo["north"] - geo["south"]) * h - 0.5
    return x, y


def b64_bits(mask: np.ndarray) -> str:
    """Row-major (y*w+x) boolean mask -> numpy packbits (MSB first) -> base64."""
    return base64.b64encode(np.packbits(mask.astype(bool).ravel())).decode()


def bits_from_b64(s: str, n: int = GRID * GRID) -> np.ndarray:
    return np.unpackbits(np.frombuffer(base64.b64decode(s), dtype=np.uint8))[:n].astype(bool)


def read_env(key: str) -> str | None:
    """Read one variable from the repo's .env without printing it."""
    p = ROOT / ".env"
    if not p.exists():
        return None
    for line in p.read_text().splitlines():
        if line.strip().startswith(f"{key}="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            return v or None
    return None
