"""Print the Markdown tables of docs/forecaster.md from docs/validation-scale.json (no numbers typed by hand).

    uv run python report.py > /tmp/tables.md
"""
from __future__ import annotations

import json

from common import LEADS, ROOT

D = json.loads((ROOT / "docs" / "validation-scale.json").read_text())
MODELS = ["gbm", "gbm_iso", "climatology", "distance", "persistence", "ca"]
LABEL = {"gbm": "GBM (raw)", "gbm_iso": "GBM + isotonic", "climatology": "Climatology (train rate)", "distance": "Distance-only (logistic)",
         "persistence": "Persistence", "ca": "Cellular automaton"}
SPLIT = {"validation": "Validation: 2023 Kalimantan", "test": "Test: 2023 Sumatra", "oot": "Out-of-time: Oct 2026 (VIIRS S-NPP)",
         "oot_allviirs": "Out-of-time: Oct 2026 (all three VIIRS, as the app)"}


def f(v, d=3, sign=False):
    if v is None:
        return "–"
    return f"{v:+.{d}f}" if sign else f"{v:.{d}f}"


def cell_bss(r):
    c = r.get("ci", {}).get("bss")
    return f"{f(r['bss'], 3, True)} [{f(c[0], 3, True)}, {f(c[1], 3, True)}]" if c else f(r.get("bss"), 3, True)


def extraction():
    print("| Split | Boxes extracted / expected | Failed | Boxes with no candidate block | Candidate blocks (rows) | New-fire blocks lead 1 / 2 / 3 | Boxes with FWI |")
    print("|---|---|---|---|---|---|---|")
    for s, st in D["extraction"].items():
        print(f"| {s} | {st['boxesOk']} / {st['boxesExpected']} | {st['boxesFailed']} | {st['boxesNoCandidates']} | {st['rows']:,} | "
              f"{' / '.join(str(p) for p in st['positives'])} | {st['boxesFwi']} |")


def main_table(s):
    r = D["results"].get(s)
    if not r:
        return
    print(f"\n**{SPLIT[s]}** ({r['1']['gbm']['all']['boxes']} boxes, {r['1']['gbm']['all']['rows']:,} candidate blocks; base rate lead 1/2/3: "
          + " / ".join(f(r[str(l)]['gbm']['all']['baseRate'], 3) for l in LEADS) + ")\n")
    print("| Model | BSS lead 1 [95% CI] | BSS lead 2 | BSS lead 3 | AUC 1 / 2 / 3 |")
    print("|---|---|---|---|---|")
    for m in MODELS:
        cells, aucs = [], []
        for l in LEADS:
            a = r[str(l)].get(m, {}).get("all")
            cells.append(cell_bss(a) if a and a.get("rows") else "–")
            aucs.append(f(a.get("auc"), 3) if a and a.get("rows") else "–")
        note = ""
        if m == "ca" and "coverage" in r["1"].get("ca", {}):
            cv = r["1"]["ca"]["coverage"]
            note = f" ({cv['boxesWithCA']}/{cv['boxes']} boxes)"
        print(f"| {LABEL[m]}{note} | {' | '.join(cells)} | {' / '.join(aucs)} |")


def csi_table(s):
    r = D["results"].get(s)
    if not r:
        return
    print(f"\n**{SPLIT[s]}**: CSI at the validation-chosen threshold (threshold in brackets), and at 0.5\n")
    print("| Model | Lead 1 | Lead 2 | Lead 3 | CSI at 0.5 (1 / 2 / 3) | POD / FAR lead 1 |")
    print("|---|---|---|---|---|---|")
    for m in MODELS:
        cells, at5 = [], []
        pf = "–"
        for l in LEADS:
            a = r[str(l)].get(m, {}).get("all")
            if not a or not a.get("rows"):
                cells.append("–"); at5.append("–"); continue
            ci = a["ci"]["csiAtThreshold"]
            cells.append(f"{f(a['atThreshold']['csi'])} [{f(ci[0], 2)}, {f(ci[1], 2)}] (p ≥ {a['threshold']:.2f})")
            at5.append(f(a["at05"]["csi"]))
            if l == 1:
                pf = f"{f(a['atThreshold']['pod'], 2)} / {f(a['atThreshold']['far'], 2)}"
        print(f"| {LABEL[m]} | {' | '.join(cells)} | {' / '.join(at5)} | {pf} |")


def same_boxes(s):
    sb = D["sameBoxesAsCA"].get(s)
    if not sb:
        return
    for l in ("1", "2"):
        if l not in sb:
            continue
        a0 = sb[l]["gbm"]
        print(f"\n**{SPLIT[s]}, lead {l}, only the {a0['boxes']} boxes the CA ran on** ({a0['rows']:,} blocks)\n")
        print("| Model | BSS [95% CI] | AUC | CSI (validation threshold) | CSI at 0.5 |")
        print("|---|---|---|---|---|")
        for m in MODELS:
            a = sb[l].get(m)
            if a and a.get("rows"):
                print(f"| {LABEL[m]} | {cell_bss(a)} | {f(a['auc'])} | {f(a['atThreshold']['csi'])} | {f(a['at05']['csi'])} |")


def islands(s):
    r = D["results"].get(s)
    if not r:
        return
    isl = [k for k in r["1"]["gbm"] if k not in ("all",)]
    if len(isl) < 2:
        return
    print(f"\n**{SPLIT[s]} by island** (BSS, lead 1 / 2 / 3)\n")
    print("| Model | " + " | ".join(isl) + " |")
    print("|---|" + "---|" * len(isl))
    for m in MODELS:
        row = []
        for i in isl:
            vals = []
            for l in LEADS:
                a = r[str(l)].get(m, {}).get(i)
                vals.append(f(a["bss"], 2, True) if a and a.get("rows") and a.get("bss") is not None else "–")
            row.append(" / ".join(vals))
        print(f"| {LABEL[m]} | " + " | ".join(row) + " |")


def reliability(s, m="gbm_iso"):
    r = D["results"].get(s)
    if not r:
        return
    print(f"\n**Reliability of {LABEL[m]}, {SPLIT[s]}**: forecast deciles (mean forecast / observed frequency); "
          "equal-width bins (10, with counts) are in validation-scale.json\n")
    print("| Decile | " + " | ".join(f"Lead {l}" for l in LEADS) + " |")
    print("|---|---|---|---|")
    for b in range(10):
        row = []
        for l in LEADS:
            x = r[str(l)][m]["all"]["reliabilityDeciles"][b]
            row.append(f"{f(x['meanForecast'])} / {f(x['observed'])}")
        print(f"| {b + 1} | " + " | ".join(row) + " |")


def importance():
    print("\n| Rank | Lead 1 | Lead 2 | Lead 3 |")
    print("|---|---|---|---|")
    imp = D["importanceValidation"]
    for i in range(12):
        print(f"| {i + 1} | " + " | ".join(f"{imp[str(l)][i]['feature']} ({imp[str(l)][i]['meanLogLossIncrease'] * 1e4:.1f})" for l in LEADS) + " |")


def posthoc():
    p = D.get("registerPostHoc")
    if not p:
        return
    po = p["pooled"]
    print(f"\n**Register, POST HOC** ({po['boxes']} sealed boxes of 20 Oct 2026, lead 1)\n")
    print("| Model | CSI at 0.5 | Hits / misses / false alarms | BSS (own base rate, pooled as the register) |")
    print("|---|---|---|---|")
    for k, lab in (("fire-septum-ca", "Cellular automaton (sealed)"), ("distance", "Distance reference"), ("climatology", "Climatology reference"), ("gbmRaw", "GBM raw (post hoc)"), ("gbmIso", "GBM + isotonic (post hoc)")):
        x = po[k]
        print(f"| {lab} | {f(x['csi'])} | {x['hits']} / {x['misses']} / {x['falseAlarms']} | {f(x['bssOwnBaseRate'], 2, True)} |")
    t = po.get("gbmIsoAtValidationThreshold")
    if t:
        print(f"| GBM + isotonic at its validation threshold p ≥ {t['threshold']:.2f} (post hoc) | {f(t['csi'])} | {t['hits']} / {t['misses']} / {t['falseAlarms']} | – |")


if __name__ == "__main__":
    print("## Extraction\n")
    extraction()
    print("\n## Brier skill and AUC\n")
    for s in SPLIT:
        main_table(s)
    print("\n## CSI\n")
    for s in SPLIT:
        csi_table(s)
    print("\n## Same boxes as the CA\n")
    for s in SPLIT:
        same_boxes(s)
    print("\n## Islands\n")
    for s in SPLIT:
        islands(s)
    print("\n## Reliability\n")
    for s in ("validation", "test", "oot"):
        reliability(s)
    print("\n## Importance\n")
    importance()
    posthoc()
    print("\n## CSI by lead (validation thresholds)\n")
    for s, d in D["csiByLead"].items():
        print(f"- {s}: " + "; ".join(f"{LABEL[m]} " + " / ".join(f(v) for v in d[m]) for m in MODELS if any(v is not None for v in d[m])))
