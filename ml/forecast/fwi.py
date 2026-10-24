"""Canadian Forest Fire Weather Index (FWI) System, daily.

Equations: Van Wagner (1987) "Development and structure of the Canadian Forest Fire Weather
Index System", Forestry Technical Report 35, as implemented in the R package cffdrs
(Wang, Wotton, Anderson et al. 2017, Fire Technology 53:1285; Wang, Anderson & Suddaby 2015,
Information Report NOR-X-424). The code follows cffdrs function by function:
fine_fuel_moisture_code, duff_moisture_code, drought_code, initial_spread_index, buildup_index,
fire_weather_index (cffdrs R/*.r, CRAN mirror github.com/cran/cffdrs). Indonesia's Fire Danger
Rating System (FDRS, BMKG) is built on the same system.

Moisture-content conversion uses cffdrs' FFMC_COEFFICIENT = 250 * 59.5 / 101 = 147.27723
(Van Wagner 1987 printed 147.2; cffdrs switched to the exact value, and its reference outputs
use it).

Day-length adjustment by latitude (cffdrs `lat.adjust = TRUE`):
  DMC effective day length Le (hours):
    lat > 30           : 6.5 7.5 9.0 12.8 13.9 13.9 12.4 10.9 9.4 8.0 7.0 6.0 (Canadian standard, 46 N)
    10 < lat <= 30     : 7.9 8.4 8.9 9.5 9.9 10.2 10.1 9.7 9.1 8.6 8.1 7.8
    -10 < lat <= 10    : 9 for every month (equatorial band)
    -30 < lat <= -10   : 10.1 9.6 9.1 8.5 8.1 7.8 7.9 8.3 8.9 9.4 9.9 10.2
    lat <= -30         : 11.5 10.5 9.2 7.9 6.8 6.2 6.5 7.4 8.7 10.0 11.2 11.8
  DC day-length factor Lf:
    lat > 20           : -1.6 -1.6 -1.6 0.9 3.8 5.8 6.4 5.0 2.4 0.4 -1.6 -1.6
    -20 < lat <= 20    : 1.4 for every month (equatorial band)
    lat <= -20         : 6.4 5.0 2.4 0.4 -1.6 -1.6 -1.6 -1.6 -1.6 0.9 3.8 5.8
  The equatorial Lf is the annual mean of the northern factors, 16.7 / 12 = 1.39; cffdrs rounds it
  to 1.4 and so do we, so our numbers equal cffdrs'. All of Kalimantan (-4.5..4.5) and Sumatra
  (-6..6) falls in both equatorial bands, so Le = 9 h and Lf = 1.4 all year.

Start-up values (Van Wagner 1987; cffdrs defaults): FFMC 85, DMC 6, DC 15.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

FFMC_COEFFICIENT = 250.0 * 59.5 / 101.0

LE_N30 = (6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0)
LE_N10 = (7.9, 8.4, 8.9, 9.5, 9.9, 10.2, 10.1, 9.7, 9.1, 8.6, 8.1, 7.8)
LE_S10 = (10.1, 9.6, 9.1, 8.5, 8.1, 7.8, 7.9, 8.3, 8.9, 9.4, 9.9, 10.2)
LE_S30 = (11.5, 10.5, 9.2, 7.9, 6.8, 6.2, 6.5, 7.4, 8.7, 10.0, 11.2, 11.8)
LE_EQ = 9.0
LF_N20 = (-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6)
LF_S20 = (6.4, 5.0, 2.4, 0.4, -1.6, -1.6, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8)
LF_EQ = 1.4

START = {"ffmc": 85.0, "dmc": 6.0, "dc": 15.0}


def day_length_dmc(lat: float, month: int) -> float:
    m = month - 1
    if lat > 30:
        return LE_N30[m]
    if lat > 10:
        return LE_N10[m]
    if lat > -10:
        return LE_EQ
    if lat > -30:
        return LE_S10[m]
    return LE_S30[m]


def day_length_dc(lat: float, month: int) -> float:
    m = month - 1
    if lat > 20:
        return LF_N20[m]
    if lat > -20:
        return LF_EQ
    return LF_S20[m]


def ffmc(ffmc_yda: float, temp: float, rh: float, ws: float, prec: float) -> float:
    wmo = FFMC_COEFFICIENT * (101.0 - ffmc_yda) / (59.5 + ffmc_yda)
    if prec > 0.5:
        ra = prec - 0.5
        add = 42.5 * ra * math.exp(-100.0 / (251.0 - wmo)) * (1.0 - math.exp(-6.93 / ra))
        if wmo > 150.0:
            add += 0.0015 * (wmo - 150.0) ** 2 * math.sqrt(ra)
        wmo = min(wmo + add, 250.0)
    ed = 0.942 * rh ** 0.679 + 11.0 * math.exp((rh - 100.0) / 10.0) + 0.18 * (21.1 - temp) * (1.0 - math.exp(-0.115 * rh))
    ew = 0.618 * rh ** 0.753 + 10.0 * math.exp((rh - 100.0) / 10.0) + 0.18 * (21.1 - temp) * (1.0 - math.exp(-0.115 * rh))
    if wmo > ed:  # drying
        ko = 0.424 * (1.0 - (rh / 100.0) ** 1.7) + 0.0694 * math.sqrt(ws) * (1.0 - (rh / 100.0) ** 8)
        kd = ko * 0.581 * math.exp(0.0365 * temp)
        wm = ed + (wmo - ed) / 10.0 ** kd
    elif wmo < ed and wmo < ew:  # wetting
        k1 = 0.424 * (1.0 - ((100.0 - rh) / 100.0) ** 1.7) + 0.0694 * math.sqrt(ws) * (1.0 - ((100.0 - rh) / 100.0) ** 8)
        kw = k1 * 0.581 * math.exp(0.0365 * temp)
        wm = ew - (ew - wmo) / 10.0 ** kw
    else:
        wm = wmo
    out = 59.5 * (250.0 - wm) / (FFMC_COEFFICIENT + wm)
    return min(max(out, 0.0), 101.0)


def dmc(dmc_yda: float, temp: float, rh: float, prec: float, lat: float, month: int) -> float:
    t = max(temp, -1.1)
    rk = 1.894 * (t + 1.1) * (100.0 - rh) * day_length_dmc(lat, month) * 1e-4
    if prec > 1.5:
        rw = 0.92 * prec - 1.27
        wmi = 20.0 + 280.0 / math.exp(0.023 * dmc_yda)
        if dmc_yda <= 33:
            b = 100.0 / (0.5 + 0.3 * dmc_yda)
        elif dmc_yda <= 65:
            b = 14.0 - 1.3 * math.log(dmc_yda)
        else:
            b = 6.2 * math.log(dmc_yda) - 17.2
        wmr = wmi + 1000.0 * rw / (48.77 + b * rw)
        pr = 43.43 * (5.6348 - math.log(wmr - 20.0))
    else:
        pr = dmc_yda
    pr = max(pr, 0.0)
    return max(pr + rk, 0.0)


def dc(dc_yda: float, temp: float, prec: float, lat: float, month: int) -> float:
    t = max(temp, -2.8)
    pe = max((0.36 * (t + 2.8) + day_length_dc(lat, month)) / 2.0, 0.0)
    if prec > 2.8:
        rw = 0.83 * prec - 1.27
        smi = 800.0 * math.exp(-dc_yda / 400.0)
        dr = max(dc_yda - 400.0 * math.log(1.0 + 3.937 * rw / smi), 0.0)
    else:
        dr = dc_yda
    return max(dr + pe, 0.0)


def isi(ffmc_v: float, ws: float) -> float:
    fm = FFMC_COEFFICIENT * (101.0 - ffmc_v) / (59.5 + ffmc_v)
    fw = math.exp(0.05039 * ws)
    ff = 91.9 * math.exp(-0.1386 * fm) * (1.0 + fm ** 5.31 / 49_300_000.0)
    return 0.208 * fw * ff


def bui(dmc_v: float, dc_v: float) -> float:
    if dmc_v == 0 and dc_v == 0:
        return 0.0
    b1 = 0.8 * dc_v * dmc_v / (dmc_v + 0.4 * dc_v)
    if b1 < dmc_v:
        p = (dmc_v - b1) / dmc_v
        cc = 0.92 + (0.0114 * dmc_v) ** 1.7
        return max(dmc_v - cc * p, 0.0)
    return b1


def fwi(isi_v: float, bui_v: float) -> float:
    if bui_v > 80:
        bb = 0.1 * isi_v * (1000.0 / (25.0 + 108.64 / math.exp(0.023 * bui_v)))
    else:
        bb = 0.1 * isi_v * (0.626 * bui_v ** 0.809 + 2.0)
    return bb if bb <= 1 else math.exp(2.72 * (0.434 * math.log(bb)) ** 0.647)


@dataclass
class Codes:
    ffmc: float = START["ffmc"]
    dmc: float = START["dmc"]
    dc: float = START["dc"]


def fwi_day(prev: Codes, temp: float, rh: float, ws: float, prec: float, lat: float, month: int) -> dict[str, float]:
    """One day of the system. rh is clamped to [0, 100] like cffdrs::fwi."""
    rh = min(max(rh, 0.0), 100.0)
    ws = max(ws, 0.0)
    prec = max(prec, 0.0)
    f = ffmc(prev.ffmc, temp, rh, ws, prec)
    d = dmc(prev.dmc, temp, rh, prec, lat, month)
    c = dc(prev.dc, temp, prec, lat, month)
    i = isi(f, ws)
    b = bui(d, c)
    w = fwi(i, b)
    return {"ffmc": f, "dmc": d, "dc": c, "isi": i, "bui": b, "fwi": w, "dsr": 0.0272 * w ** 1.77}


def fwi_series(days: list[dict], lat: float, start: Codes | None = None) -> list[dict[str, float]]:
    """days: [{temp, rh, ws, prec, month}], consecutive. Runs continuously from `start`."""
    prev = start or Codes()
    out = []
    for d in days:
        r = fwi_day(prev, d["temp"], d["rh"], d["ws"], d["prec"], lat, d["month"])
        prev = Codes(r["ffmc"], r["dmc"], r["dc"])
        out.append(r)
    return out
