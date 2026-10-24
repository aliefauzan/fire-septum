"""FWI against the cffdrs reference outputs.

tests/data/cffdrs_test_fwi.csv is the Van Wagner & Pickett (1985) 49-day test weather shipped
with cffdrs (data/test_fwi.csv, lat 40 N, April 13 to May 30 1985). tests/data/cffdrs_fwi_01.csv
is cffdrs' own expected output for `fwi(test_fwi)` (tests/testthat/data/fwi_01.csv, rounded to
4 significant digits), from github.com/cran/cffdrs.
"""
import csv
import math
from pathlib import Path

import pytest

import fwi as F

DATA = Path(__file__).parent / "data"


def rows(name):
    with open(DATA / name) as f:
        txt = f.read()
    delim = ";" if ";" in txt.splitlines()[0] else ","
    return list(csv.DictReader(txt.splitlines(), delimiter=delim))


def test_matches_cffdrs_reference_series():
    wx = rows("cffdrs_test_fwi.csv")
    ref = rows("cffdrs_fwi_01.csv")
    assert len(wx) == len(ref) == 48
    days = [{"temp": float(r["temp"]), "rh": float(r["rh"]), "ws": float(r["ws"]), "prec": float(r["prec"]), "month": int(r["mon"])} for r in wx]
    out = F.fwi_series(days, lat=40.0)
    worst = 0.0
    for o, r in zip(out, ref):
        for k in ("ffmc", "dmc", "dc", "isi", "bui", "fwi", "dsr"):
            exp = float(r[k.upper()])
            # Reference values are rounded to 4 significant digits.
            tol = max(5e-4 * abs(exp), 1e-3)
            assert o[k] == pytest.approx(exp, abs=tol), (r["MON"], r["DAY"], k, o[k], exp)
            worst = max(worst, abs(o[k] - exp) / max(abs(exp), 1e-9))
    assert worst < 5e-4


def test_equatorial_day_length_bands():
    for lat in (-9.99, -4.5, 0.0, 4.5, 6.0, 10.0):
        for m in range(1, 13):
            assert F.day_length_dmc(lat, m) == 9.0
    for lat in (-19.99, 0.0, 20.0):
        for m in range(1, 13):
            assert F.day_length_dc(lat, m) == 1.4
    assert F.day_length_dmc(10.01, 1) == 7.9
    assert F.day_length_dmc(-10.0, 1) == 10.1
    assert F.day_length_dc(20.01, 7) == 6.4
    assert F.day_length_dc(-20.0, 1) == 6.4
    # 1.39 is the annual mean of the northern factors; cffdrs rounds it to 1.4.
    assert sum(F.LF_N20) / 12 == pytest.approx(1.39, abs=0.005)
    # Dry-day increments at the equator.
    assert F.dmc(10, 30, 60, 0, 0.0, 8) - 10 == pytest.approx(1.894 * 31.1 * 40 * 9 * 1e-4)
    assert F.dc(100, 30, 0, 0.0, 8) - 100 == pytest.approx((0.36 * 32.8 + 1.4) / 2)


def test_rain_resets_codes():
    dry = F.fwi_day(F.Codes(90, 60, 400), 32, 50, 10, 0, -2.0, 9)
    wet = F.fwi_day(F.Codes(90, 60, 400), 26, 95, 5, 40, -2.0, 9)
    assert wet["ffmc"] < 40 < dry["ffmc"]
    assert wet["dmc"] < dry["dmc"] and wet["dc"] < dry["dc"]
    assert all(math.isfinite(v) and v >= 0 for v in wet.values())
