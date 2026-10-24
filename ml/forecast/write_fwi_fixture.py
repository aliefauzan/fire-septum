"""Write src/sim/fwi.fixture.json: Python FWI outputs that src/sim/fwi.test.ts must reproduce.

Two series: the cffdrs / Van Wagner & Pickett (1985) 48-day test weather at 40 N, and a
deterministic 120-day tropical series at 2.2 S (Central Kalimantan) with dry spells and heavy rain.
"""
import csv
import json
import math
import random

from common import ROOT
from fwi import fwi_series

OUT = ROOT / "src" / "sim" / "fwi.fixture.json"


def cffdrs_days():
    with open(ROOT / "ml/forecast/tests/data/cffdrs_test_fwi.csv") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    return [{"tempC": float(r["temp"]), "rh": float(r["rh"]), "windKmh": float(r["ws"]), "rainMm": float(r["prec"]), "month": int(r["mon"])} for r in rows]


def tropical_days():
    rnd = random.Random(2015)
    out = []
    for i in range(120):
        month = 7 + i // 31
        wet = rnd.random() < (0.35 if i < 40 or i > 100 else 0.08)
        out.append({
            "tempC": round(29 + 4 * math.sin(i / 9) + rnd.uniform(-1.5, 1.5), 1),
            "rh": round(rnd.uniform(45, 95) if wet else rnd.uniform(35, 75), 0),
            "windKmh": round(rnd.uniform(2, 22), 1),
            "rainMm": round(rnd.expovariate(1 / 12), 1) if wet else 0.0,
            "month": min(month, 12),
        })
    return out


def run(days, lat):
    py = [{"temp": d["tempC"], "rh": d["rh"], "ws": d["windKmh"], "prec": d["rainMm"], "month": d["month"]} for d in days]
    return fwi_series(py, lat)


series = []
for name, lat, days in (("cffdrs-test-40N", 40.0, cffdrs_days()), ("tropical-2.2S", -2.2, tropical_days())):
    series.append({"name": name, "lat": lat, "days": days, "expected": run(days, lat)})
OUT.write_text(json.dumps({"v": 1, "generator": "ml/forecast/write_fwi_fixture.py", "series": series}))
print(OUT, sum(len(s["days"]) for s in series), "days")
