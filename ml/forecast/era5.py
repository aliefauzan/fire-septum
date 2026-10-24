"""ERA5 noon weather from the Open-Meteo archive and the daily FWI System at every event point.

    uv run python era5.py plan        # point counts and API-call cost per grid, no requests
    uv run python era5.py fetch       # download (cached in .cache/era5/), rate-limited
    uv run python era5.py build       # FWI + data/fwi/era5-<year>.json.gz

Weather: Open-Meteo historical API (https://archive-api.open-meteo.com/v1/archive, models=era5,
ERA5 0.25 degree), hourly temperature_2m, relative_humidity_2m, wind_speed_10m (km/h) and
precipitation. FWI inputs are taken at 05 UTC everywhere (local noon in WIB, UTC+7; 13:00 in
WITA, UTC+8, for central and east Kalimantan). rain24 = precipitation in the 24 h ending at
05 UTC (hourly values stamped D-1 06:00 .. D 05:00, each the sum over the preceding hour).

2026 (out-of-time events): the archive from 2025-12-31 to its last complete day, then the
Open-Meteo forecast API (api.open-meteo.com/v1/forecast, past_days, best-match model, not ERA5)
for the days the archive does not have yet.

Free-tier cost (open-meteo.com/en/pricing): a request costs (days / 14) x max(1, vars / 10) x
locations "calls", and the free tier allows 600 / minute, 5,000 / hour, 10,000 / day per IP.
One point-year is about 26 calls. The live app and other tools share this IP, so we spend at
most BUDGET calls (80% of a day's quota) and fetch 1 Jan to 2 Nov of each past year; the grid is
the finest of 0.25, 0.5 and 1.0 degree that fits.
"""
from __future__ import annotations

import gzip
import json
import math
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests

from common import ERA5_DIR, ROOT
from fwi import Codes, fwi_day

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"
HOURLY = "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation"
HOUR_UTC = 5
BUDGET = 8000.0
GRIDS = (0.25, 0.5, 1.0)
PER_REQUEST = 4          # locations per request
CALLS_PER_MIN = 60.0     # pace: 3,600 / hour, under the 5,000 / hour free limit
OUT = ROOT / "data" / "fwi"
UA = {"User-Agent": "FireSeptum/0.1 (IEEE ClimateChain 2026 research prototype)"}
TODAY = date.today()


def event_points() -> dict[int, list[tuple[float, float]]]:
    pts: dict[int, list[tuple[float, float]]] = {}
    for f in ("events.json", "train-boxes.json"):
        for e in json.loads((ROOT / "data" / "validation" / f).read_text())["events"]:
            pts.setdefault(int(e["d"][:4]), []).append((e["lat"], e["lon"]))
    return pts


def snap(lat: float, lon: float, g: float) -> tuple[float, float]:
    return round(round(lat / g) * g, 4), round(round(lon / g) * g, 4)


def year_span(y: int) -> tuple[date, date]:
    """Inclusive request span: 31 Dec of the year before (for the first rain24 at 05 UTC on 1 Jan)
    to 2 Nov (the last event day is 31 Oct, D+1 is 1 Nov, plus one spare day), or for the current
    year to yesterday. November and December are not fetched: no event or training box uses them,
    and they would cost 17% of the free-tier budget."""
    end = date(y, 11, 2)
    if y == TODAY.year:
        end = TODAY - timedelta(days=1)
    return date(y - 1, 12, 31), end


def cost(n_points: int, start: date, end: date) -> float:
    return n_points * max(1.0, ((end - start).days + 1) / 14)


def plan(verbose=True) -> tuple[float, dict[int, list[tuple[float, float]]]]:
    pts = event_points()
    chosen = None
    for g in GRIDS:
        per_year = {y: sorted({snap(a, b, g) for a, b in v}) for y, v in pts.items()}
        total = sum(cost(len(v), *year_span(y)) for y, v in per_year.items())
        if verbose:
            print(f"grid {g}: " + ", ".join(f"{y}: {len(v)} points" for y, v in sorted(per_year.items())) + f" -> ~{total:.0f} calls")
        if chosen is None and total <= BUDGET:
            chosen = (g, per_year)
    if chosen is None:
        raise SystemExit("no grid fits the budget")
    if verbose:
        print("chosen grid", chosen[0])
    return chosen


def cache_path(y: int, lat: float, lon: float, kind: str = "archive") -> Path:
    return ERA5_DIR / str(y) / f"{kind}_{lat:+.2f}_{lon:+.2f}.json"


class Pacer:
    """Spreads cost evenly: after a request of cost c, the next one waits c / per_min minutes."""

    def __init__(self, per_min: float):
        self.per_min = per_min
        self.next_at = 0.0

    def wait(self, c: float) -> None:
        now = time.time()
        if now < self.next_at:
            time.sleep(self.next_at - now)
        self.next_at = max(now, self.next_at) + 60.0 * c / self.per_min


def get(url: str, params: dict, pacer: Pacer, c: float):
    for attempt in range(6):
        pacer.wait(c)
        try:
            r = requests.get(url, params=params, headers=UA, timeout=180)
            if r.status_code == 429 or r.status_code >= 500:
                print(f"  HTTP {r.status_code}: {r.text[:200]}; backing off", flush=True)
                time.sleep(60 * (attempt + 1))
                continue
            r.raise_for_status()
            j = r.json()
        except (requests.RequestException, ValueError) as e:
            print(f"  retry after {type(e).__name__}: {str(e)[:120]}", flush=True)
            time.sleep(30 * (attempt + 1))
            continue
        return j if isinstance(j, list) else [j]
    raise RuntimeError(f"giving up on {url}")


def fetch() -> None:
    g, per_year = plan()
    pacer = Pacer(CALLS_PER_MIN)
    spent = 0.0
    for y, pts in sorted(per_year.items()):
        start, end = year_span(y)
        todo = [p for p in pts if not cache_path(y, *p).exists()]
        print(f"{y}: {len(todo)} of {len(pts)} points to fetch", flush=True)
        for i in range(0, len(todo), PER_REQUEST):
            batch = todo[i:i + PER_REQUEST]
            c = cost(len(batch), start, end)
            res = get(ARCHIVE, {"latitude": ",".join(str(p[0]) for p in batch), "longitude": ",".join(str(p[1]) for p in batch),
                                "start_date": start.isoformat(), "end_date": end.isoformat(), "hourly": HOURLY,
                                "models": "era5", "timezone": "GMT", "wind_speed_unit": "kmh"}, pacer, c)
            spent += c
            for p, j in zip(batch, res):
                f = cache_path(y, *p)
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(json.dumps({"request": {"lat": p[0], "lon": p[1], "grid": g}, "response": j}))
            print(f"  {y} {i + len(batch)}/{len(todo)} (~{spent:.0f} calls)", flush=True)
        if y == TODAY.year:
            # Archive lags ~5 days: fill the end from the forecast API's past_days (not ERA5).
            todo = [p for p in pts if not cache_path(y, *p, "forecast").exists()]
            for i in range(0, len(todo), PER_REQUEST):
                batch = todo[i:i + PER_REQUEST]
                res = get(FORECAST, {"latitude": ",".join(str(p[0]) for p in batch), "longitude": ",".join(str(p[1]) for p in batch),
                                     "past_days": 14, "forecast_days": 1, "hourly": HOURLY, "timezone": "GMT", "wind_speed_unit": "kmh"},
                          pacer, len(batch) * 15 / 14)
                for p, j in zip(batch, res):
                    cache_path(y, *p, "forecast").write_text(json.dumps({"request": {"lat": p[0], "lon": p[1], "grid": g}, "response": j}))
    print(f"done, ~{spent:.0f} calls", flush=True)


def hourly_series(y: int, p: tuple[float, float]) -> tuple[dict[str, dict[str, float]], dict]:
    """{iso hour: {t, rh, ws, pr}} from the archive, gaps filled from the forecast cache; plus provenance."""
    j = json.loads(cache_path(y, *p).read_text())["response"]
    h = j["hourly"]
    out: dict[str, dict[str, float]] = {}
    for i, t in enumerate(h["time"]):
        v = (h["temperature_2m"][i], h["relative_humidity_2m"][i], h["wind_speed_10m"][i], h["precipitation"][i])
        if None not in v:
            out[t] = {"t": v[0], "rh": v[1], "ws": v[2], "pr": v[3]}
    prov = {"archiveCell": [j.get("latitude"), j.get("longitude")], "archiveLast": max(out) if out else None, "forecastFrom": None}
    fp = cache_path(y, *p, "forecast")
    if fp.exists():
        fh = json.loads(fp.read_text())["response"]["hourly"]
        for i, t in enumerate(fh["time"]):
            v = (fh["temperature_2m"][i], fh["relative_humidity_2m"][i], fh["wind_speed_10m"][i], fh["precipitation"][i])
            if t not in out and None not in v and t[:4] == str(y):
                out[t] = {"t": v[0], "rh": v[1], "ws": v[2], "pr": v[3]}
                prov["forecastFrom"] = min(prov["forecastFrom"] or t, t)
    return out, prov


def daily(y: int, p: tuple[float, float]):
    hs, prov = hourly_series(y, p)
    d, last = date(y, 1, 1), year_span(y)[1]
    days = []
    while d <= last:
        noon = f"{d.isoformat()}T{HOUR_UTC:02d}:00"
        if noon not in hs:
            break
        base = datetime(d.year, d.month, d.day, HOUR_UTC)
        rain = [hs.get((base - timedelta(hours=k)).strftime("%Y-%m-%dT%H:00"), {}).get("pr") for k in range(24)]
        if any(r is None for r in rain):
            break
        x = hs[noon]
        days.append({"date": d.isoformat(), "temp": x["t"], "rh": x["rh"], "ws": x["ws"], "prec": float(sum(rain)), "month": d.month})
        d += timedelta(days=1)
    return days, prov


def build() -> None:
    g, per_year = plan(verbose=False)
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for y, pts in sorted(per_year.items()):
        series, provs, n_days = [], [], None
        for p in pts:
            days, prov = daily(y, p)
            prev, since, out = Codes(), None, []
            for i, dd in enumerate(days):
                r = fwi_day(prev, dd["temp"], dd["rh"], dd["ws"], dd["prec"], p[0], dd["month"])
                prev = Codes(r["ffmc"], r["dmc"], r["dc"])
                since = 0 if dd["prec"] >= 1.0 else (i + 1 if since is None else since + 1)
                out.append({**r, "daysSinceRain": since, "rain24": dd["prec"], "rh": dd["rh"], "windKmh": dd["ws"], "tempC": dd["temp"]})
            series.append(out)
            provs.append(prov)
            n_days = len(out) if n_days is None else min(n_days, len(out))
        dates = [(date(y, 1, 1) + timedelta(days=i)).isoformat() for i in range(n_days)]
        keys = ("ffmc", "dmc", "dc", "isi", "bui", "fwi", "daysSinceRain", "rain24", "rh", "windKmh", "tempC")
        vals = {k: [[(round(s[i][k], 1) if k != "daysSinceRain" else s[i][k]) for i in range(n_days)] for s in series] for k in keys}
        forecast_from = sorted({pv["forecastFrom"] for pv in provs if pv["forecastFrom"]})
        doc = {
            "v": 1, "kind": "fireseptum.fwi-archive", "year": y, "gridDeg": g, "hourUtc": HOUR_UTC,
            "source": "ERA5 (Open-Meteo archive API, models=era5)" + (
                f"; from {forecast_from[0]} UTC the Open-Meteo forecast API (best-match model, not ERA5) fills the archive's lag" if forecast_from else ""),
            "method": "Canadian FWI System (Van Wagner 1987, cffdrs equations, equatorial day length: DMC Le 9 h, DC Lf 1.4), "
                      "started 1 Jan at FFMC 85, DMC 6, DC 15. Inputs at 05 UTC; rain24 = rain in the 24 h ending 05 UTC; "
                      "daysSinceRain = days since rain24 >= 1 mm (counted from 1 Jan if no such day yet).",
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "points": [{"lat": p[0], "lon": p[1], "era5Cell": pv["archiveCell"]} for p, pv in zip(pts, provs)],
            "dates": dates, "vars": vals,
        }
        f = OUT / f"era5-{y}.json.gz"
        f.write_bytes(gzip.compress(json.dumps(doc, separators=(",", ":")).encode(), 9))
        total += f.stat().st_size
        print(f"{f.name}: {len(pts)} points x {n_days} days, {f.stat().st_size / 1e6:.2f} MB", flush=True)
    print(f"total {total / 1e6:.2f} MB")


if __name__ == "__main__":
    {"plan": lambda: plan(), "fetch": fetch, "build": build}[sys.argv[1] if len(sys.argv) > 1 else "plan"]()
