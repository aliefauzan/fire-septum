"""Print the Markdown tables used in docs/burned-area.md and docs/emissions-crosscheck.md from the JSON outputs.

    uv run --project ml/rs python ml/rs/make_tables.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT  # noqa: E402

BA = ROOT / "data" / "validation" / "burned-area"
EM = ROOT / "data" / "validation" / "emissions-crosscheck.json"


def f(x, nd=0, pct=False):
    if x is None:
        return "–"
    if pct:
        return f"{x * 100:.0f}%"
    return f"{x:,.{nd}f}"


def burned():
    s = json.loads((BA / "summary.json").read_text())
    print("| Event | S2 clear | S1 | Observed | Burned ha (S2 / S1) | FIRMS det. | FIRMS footprint ha (observed) | Overlap ha | Burned inside footprint | Footprint burned |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for e in s["events"]:
        if "error" in e:
            print(f"| {e['id']} | error: {e['error'][:60]} |||||||||")
            continue
        print(f"| {e['id']} | {f(e['s2_clear_frac'], pct=True)} | {f(e['s1_frac'], pct=True)} | {f(e['observed_frac'], pct=True)} | "
              f"{f(e['burned_ha'])} ({f(e['burned_ha_s2'])} / {f(e['burned_ha_s1'])}) | {e['firms_detections']} | "
              f"{f(e['firms_footprint_ha'])} ({f(e['firms_footprint_observed_ha'])}) | {f(e['overlap_ha'])} | "
              f"{f(e['share_of_burned_inside_firms_footprint'], pct=True) if e['burned_ha'] else '–'} | "
              f"{f(e['share_of_observed_firms_footprint_burned'], pct=True) if e['firms_footprint_observed_ha'] else '–'} |")
    print()
    print("| Event | S2 pre dates (clear share) | S2 post dates (clear share) | S1 orbit: pre → post | S1 burned cells at −2 / −3 / −4 dB | S2 burned cells dNBR>0.10 / 0.27 / 0.44 (post NBR<0.10) |")
    print("|---|---|---|---|---|---|")
    for e in s["events"]:
        p = BA / f"{e['id']}.json"
        if not p.exists() or "error" in e:
            continue
        d = json.loads(p.read_text())
        s2, s1 = d["sentinel2"], d["sentinel1"]
        best = lambda ds: ", ".join(f"{k[5:]} ({v:.0%})" for k, v in ds if v >= 0.05) or "none ≥5%"  # noqa: E731
        orb = "; ".join(f"{o['relative_orbit']}: {','.join(x[5:] for x in o['pre'])} → {','.join(x[5:] for x in o['post'])}" for o in s1["orbits"]) or "no post pass yet"
        ss = s1["burned_cells_sensitivity_on_s1_cells"]
        s1s = " / ".join(str(ss.get(k, "–")) for k in ("dVH<=-2dB", "dVH<=-3dB", "dVH<=-4dB")) if ss else "–"
        s2s = s2["burned_cells_sensitivity_on_s2_clear_cells"]
        s2t = " / ".join(str(s2s[f"dnbr>{t:.2f},post<0.10"]) for t in (0.10, 0.27, 0.44))
        print(f"| {e['id']} | {best(s2['pre_dates_clear_frac'])} | {best(s2['post_dates_clear_frac'])} | {orb} | {s1s} | {s2t} |")
    print()
    print("| Event | Cells seen by both | S2 burned there | S1 recall / precision vs S2 at −2 dB | −3 dB | −4 dB |")
    print("|---|---|---|---|---|---|")
    for e in s["events"]:
        p = BA / f"{e['id']}.json"
        if not p.exists() or "error" in e:
            continue
        v = json.loads(p.read_text()).get("s1_vs_s2_where_both_clear", {})
        if not v.get("cells_with_both"):
            continue
        cell = lambda k: f"{v[k]['s1_recall_of_s2']:.2f} / {v[k]['s1_precision_vs_s2']:.2f}" if k in v else "–"  # noqa: E731
        print(f"| {e['id']} | {v['cells_with_both']} | {v['s2_burned']} | {cell('dVH<=-2dB')} | {cell('dVH<=-3dB')} | {cell('dVH<=-4dB')} |")
    rec = [e for e in s["events"] if e.get("forecast")]
    for e in rec:
        fc = e["forecast"]
        print()
        print(f"Recorded event {e['id']}: candidates {fc['candidates']}, observed new blocks {fc['observed_new_blocks']}, unscored cloudy blocks {fc['unscored_cloudy_blocks']}")
        for h in ("24h", "48h"):
            m = fc[h]
            print(f"  {h}: predicted {m['predicted']}, hits {m['hits']}, misses {m['misses']}, FA {m['false_alarms']}, POD {m['pod']}, FAR {m['far']}, CSI {m['csi']} (distance {m['distance_only_csi']}); "
                  f"mean p(new) over new burned cells {m['mean_p_new_over_new_burned_cells']}; over unburned observed {m['mean_p_new_over_unburned_observable_cells']}")


def emissions():
    d = json.loads(EM.read_text())
    print("| Year | Cell (centre) | VIIRS det. | Peat share | DM FRP method (kt) | DM GFED4.1s (kt) | Ratio | Daily r (Pearson / Spearman) | CO2 FRP (Mt) | CO2 GFED (Mt) | Peat DM FRP / GFED (kt) |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for y, yr in d["years"].items():
        for c in yr["cells"]:
            print(f"| {y} | {c['lat_center']:.3f}, {c['lon_center']:.3f} | {c['detections']:,} | {c['peat_share_of_detections']:.0%} | "
                  f"{c['dm']['frp_total'] / 1e3:,.0f} | {c['dm']['gfed_total'] / 1e3:,.0f} | {f(c['dm']['ratio_frp_over_gfed'], 2)} | "
                  f"{f(c['dm']['pearson_r_daily'], 2)} / {f(c['dm']['spearman_r_daily'], 2)} | {c['co2']['frp_total'] / 1e6:,.2f} | {c['co2']['gfed_total'] / 1e6:,.2f} | "
                  f"{c['frp_dm_peat_t'] / 1e3:,.0f} / {c['gfed_dm_peat_t'] / 1e3:,.0f} |")
        p = yr["pooled_top_cells"]
        print(f"| {y} | **5 cells pooled** | | | **{p['dm']['frp_total'] / 1e3:,.0f}** | **{p['dm']['gfed_total'] / 1e3:,.0f}** | **{f(p['dm']['ratio_frp_over_gfed'], 2)}** | "
              f"**{f(p['dm']['pearson_r_daily'], 2)} / {f(p['dm']['spearman_r_daily'], 2)}** | **{p['co2']['frp_total'] / 1e6:,.2f}** | **{p['co2']['gfed_total'] / 1e6:,.2f}** | |")
    print()
    print("| Year | VIIRS det. (all Indonesia, type 0) | Peat share | CO2 FRP method (Mt) | CO2e FRP method (Mt) | GFED5.1 EQAS CO2 (Mt) | Ratio |")
    print("|---|---|---|---|---|---|---|")
    for y, yr in d["years"].items():
        n = yr["indonesia_year"]
        print(f"| {y} | {n['detections']:,} | {n['peat_share_of_detections']:.0%} | {n['frp_co2_t'] / 1e6:,.0f} | {n['frp_co2e_t'] / 1e6:,.0f} | "
              f"{f(n['gfed5_eqas_co2_t'] / 1e6 if n['gfed5_eqas_co2_t'] else None)} | {f(n['ratio_frp_over_gfed5_eqas_co2'], 2)} |")
    print()
    print("| Year | Pooled DM ratio, hold cap 3 h | 6 h | 12 h (app default) |")
    print("|---|---|---|---|")
    for y, yr in d["years"].items():
        h = yr["pooled_top_cells"].get("dm_ratio_by_max_hold_h", {})
        print(f"| {y} | {f(h.get('3'), 2)} | {f(h.get('6'), 2)} | {f(h.get('12'), 2)} |")
    print()
    for y, yr in d["years"].items():
        p = yr["pooled_top_cells"]
        print(f"{y} pooled: DM bias {p['dm']['mean_bias_t_per_day'] / 1e3:,.1f} kt/day, median daily ratio {f(p['dm']['median_daily_ratio_where_both_positive'], 2)}; "
              f"CO2 ratio {f(p['co2']['ratio_frp_over_gfed'], 2)}, r {p['co2']['pearson_r_daily']}")


if __name__ == "__main__":
    if (BA / "summary.json").exists():
        burned()
        print()
    if EM.exists():
        emissions()
