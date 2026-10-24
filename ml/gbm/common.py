"""Shared paths, table loading and metrics for the Fire Septum statistical forecaster.

Tables come from scripts/ml/extract.ts + scripts/ml/assemble.ts (.cache/ml/rows_<split>.csv): one
row per candidate block (not on fire at t0, within 3 km of fire at t0) of every box, features in
src/sim/features.ts FEATURE_NAMES order, labels y1 y2 y3 (new VIIRS fire in the block in lead 1,
2, 3 = the 24 h windows after t0).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
ML = ROOT / ".cache" / "ml"
LEADS = (1, 2, 3)
SPLITS = ("train", "validation", "test", "oot", "oot_allviirs")
META = ["id", "split", "island", "year", "block"]


def manifest() -> dict:
    return json.loads((ML / "manifest.json").read_text())


def feature_names() -> list[str]:
    return list(manifest()["features"])


def load(split: str) -> pd.DataFrame:
    f = ML / f"rows_{split}.csv"
    if not f.exists():
        return pd.DataFrame()
    # round_trip: parse every number exactly as JavaScript wrote it.
    return pd.read_csv(f, float_precision="round_trip", dtype={"id": str, "split": str, "island": str})


def week_key(df: pd.DataFrame) -> pd.Series:
    """Island + ISO week of day D: boxes of the same fire on neighbouring days share a key."""
    d = pd.to_datetime(df["id"].str.extract(r"(\d{4}-\d{2}-\d{2})")[0])
    iso = d.dt.isocalendar()
    return df["island"] + "-" + iso["year"].astype(str) + "-" + iso["week"].astype(str)


# --- metrics -----------------------------------------------------------------------------------

def brier(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2)) if len(y) else float("nan")


def auc(y: np.ndarray, p: np.ndarray) -> float:
    """ROC AUC by the rank-sum formula (ties get the average rank). NaN with one class only."""
    y = np.asarray(y)
    n1 = int(y.sum())
    n0 = len(y) - n1
    if n1 == 0 or n0 == 0:
        return float("nan")
    r = pd.Series(p).rank(method="average").to_numpy()
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def confusion(y: np.ndarray, p: np.ndarray, thr: float) -> tuple[int, int, int]:
    f = p >= thr
    hits = int(np.sum(f & (y == 1)))
    misses = int(np.sum(~f & (y == 1)))
    fa = int(np.sum(f & (y == 0)))
    return hits, misses, fa


def ratio(a: float, b: float) -> float:
    return a / b if b > 0 else 0.0


def csi_pod_far(hits: int, misses: int, fa: int) -> dict:
    return {"csi": ratio(hits, hits + misses + fa), "pod": ratio(hits, hits + misses), "far": ratio(fa, hits + fa),
            "hits": hits, "misses": misses, "falseAlarms": fa}


def best_threshold(y: np.ndarray, p: np.ndarray) -> float:
    """Threshold in 0.01 … 0.99 with the highest CSI (ties: the lower threshold)."""
    best, bt = -1.0, 0.5
    for t in np.round(np.arange(0.01, 1.0, 0.01), 2):
        c = csi_pod_far(*confusion(y, p, t))["csi"]
        if c > best + 1e-12:
            best, bt = c, float(t)
    return bt


def reliability(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    """Ten equal-width bins of the forecast probability: count, mean forecast, observed frequency."""
    idx = np.minimum((p * bins).astype(int), bins - 1)
    out = []
    for b in range(bins):
        m = idx == b
        n = int(m.sum())
        out.append({"bin": [b / bins, (b + 1) / bins], "n": n,
                    "meanForecast": float(p[m].mean()) if n else None,
                    "observed": float(y[m].mean()) if n else None})
    return out


def reliability_deciles(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    """Bins holding equal numbers of blocks (forecast deciles): readable when most forecasts are small."""
    order = np.argsort(p, kind="stable")
    out = []
    for part in np.array_split(order, bins):
        if len(part) == 0:
            continue
        out.append({"n": int(len(part)), "pMin": float(p[part].min()), "pMax": float(p[part].max()),
                    "meanForecast": float(p[part].mean()), "observed": float(y[part].mean())})
    return out
