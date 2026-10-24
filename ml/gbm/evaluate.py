"""Score the forecaster and its baselines at scale; write docs/validation-scale.json and the plots.

    uv run python evaluate.py            # validation only (development)
    uv run python evaluate.py --final    # + test (2023 Sumatra) and out-of-time (2026): ONCE

Models, per lead: gbm (raw), gbm_iso (isotonic, fitted on validation, so in-sample there),
climatology (train base rate), distance (logistic in d_fire_km, fitted on train), persistence
(two train rates: a detection of the last 24 h within 1 km of the block or not), ca (the cellular
automaton, leads 1-2, scripts/ml/ca.ts; only boxes with cached ERA5 weather).

Metrics on the candidate blocks (the scorer's rule): Brier score, Brier skill vs climatology
(1 - BS / BS of the train base rate on the same rows), AUC, reliability (10 bins with counts), CSI /
POD / FAR at the CSI-optimal threshold chosen on validation and at 0.5. 95% intervals: bootstrap
over boxes (1,000 draws; AUC 300), and for BSS also over island-weeks (boxes of the same fire on
neighbouring days are not independent).

The test split may be evaluated once: every --final run is logged in .cache/ml/test-evaluations.json
and in the output, and a second run on the same model needs --again "<reason>".
"""
from __future__ import annotations

import glob
import json
import pickle
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from common import LEADS, ML, ROOT, auc, best_threshold, brier, confusion, csi_pod_far, load, reliability, reliability_deciles, week_key

B = 1000
B_AUC = 300
RNG = np.random.default_rng(7)
MODELS = ["gbm", "gbm_iso", "climatology", "distance", "persistence", "ca"]
LABEL = {"gbm": "GBM (raw)", "gbm_iso": "GBM + isotonic", "climatology": "Climatology", "distance": "Distance-only",
         "persistence": "Persistence", "ca": "Cellular automaton"}


def load_ca() -> dict[tuple[str, int], dict]:
    """(box id, lead) -> {block: p} for boxes the CA ran on; plus per-box status counts."""
    out: dict[str, dict] = {}
    for f in sorted(glob.glob(str(ML / "ca*.jsonl"))):
        for line in open(f):
            if line.strip():
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if o.get("status") == "ok" or o["id"] not in out:
                    out[o["id"]] = o
    return out


def predict(df: pd.DataFrame, feats: list[str], m: dict, lead: int, ca: dict, blocks_of: dict) -> dict[str, np.ndarray]:
    X = df[feats].to_numpy(np.float64)
    p = m["gbm"].predict_proba(X)[:, 1]
    near = df["n_active_1km"].to_numpy() >= 1
    preds = {
        "gbm": p,
        "gbm_iso": m["iso"].predict(p),
        "climatology": np.full(len(df), m["climatology"]),
        "distance": m["distance"].predict_proba(df[["d_fire_km"]].to_numpy())[:, 1],
        "persistence": np.where(near, m["persistence"]["near"], m["persistence"]["far"]),
    }
    c = np.full(len(df), np.nan)
    if lead in (1, 2):
        for i, (bid, blk) in enumerate(zip(df["id"], df["block"])):
            o = ca.get(bid)
            if o and o.get("status") == "ok":
                c[i] = blocks_of[bid][int(blk)][lead - 1]
    preds["ca"] = c
    return preds


def boot_weights(n_groups: int, b: int) -> np.ndarray:
    draws = RNG.integers(0, n_groups, size=(b, n_groups))
    w = np.zeros((b, n_groups))
    for i in range(b):
        w[i] = np.bincount(draws[i], minlength=n_groups)
    return w


def ci(a: np.ndarray) -> list[float] | None:
    a = a[np.isfinite(a)]
    return [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))] if len(a) else None


def metrics(y: np.ndarray, p: np.ndarray, clim: float, thr: float, boxes: np.ndarray, weeks: np.ndarray) -> dict:
    n = len(y)
    if n == 0:
        return {"rows": 0}
    c = np.full(n, clim)
    bs, bs_c = brier(y, p), brier(y, c)
    at_opt = csi_pod_far(*confusion(y, p, thr))
    at_05 = csi_pod_far(*confusion(y, p, 0.5))
    out = {
        "rows": int(n), "boxes": int(len(np.unique(boxes))), "positives": int(y.sum()), "baseRate": float(y.mean()),
        "brier": bs, "bss": 1 - bs / bs_c if bs_c > 0 else None, "auc": auc(y, p),
        "threshold": thr, "atThreshold": at_opt, "at05": at_05,
        "meanForecast": float(p.mean()),
        "reliability": reliability(y, p),
        "reliabilityDeciles": reliability_deciles(y, p),
    }
    # Box bootstrap (vectorised through per-box sums).
    g, gi = np.unique(boxes, return_inverse=True)
    sse = np.bincount(gi, (p - y) ** 2, len(g))
    ssc = np.bincount(gi, (c - y) ** 2, len(g))
    cnt = np.bincount(gi, minlength=len(g)).astype(float)
    f_opt, f_05 = p >= thr, p >= 0.5
    def parts(f):
        h = np.bincount(gi, (f & (y == 1)).astype(float), len(g))
        d = np.bincount(gi, ((f | (y == 1))).astype(float), len(g))
        return h, d
    h1, d1 = parts(f_opt)
    h2, d2 = parts(f_05)
    w = boot_weights(len(g), B)
    with np.errstate(invalid="ignore", divide="ignore"):
        out["ci"] = {
            "unit": "box", "draws": B,
            "brier": ci((w @ sse) / (w @ cnt)),
            "bss": ci(1 - (w @ sse) / (w @ ssc)),
            "csiAtThreshold": ci((w @ h1) / (w @ d1)),
            "csi05": ci((w @ h2) / (w @ d2)),
        }
    rows_by_box = [np.flatnonzero(gi == k) for k in range(len(g))]
    a = []
    for i in range(B_AUC):
        idx = np.concatenate([rows_by_box[k] for k in RNG.integers(0, len(g), len(g))])
        a.append(auc(y[idx], p[idx]))
    out["ci"]["auc"] = ci(np.array(a))
    out["ci"]["aucDraws"] = B_AUC
    # Island-week bootstrap for BSS.
    wk, wi = np.unique(weeks, return_inverse=True)
    if len(wk) > 1:
        sse_w = np.bincount(wi, (p - y) ** 2, len(wk))
        ssc_w = np.bincount(wi, (c - y) ** 2, len(wk))
        ww = boot_weights(len(wk), B)
        with np.errstate(invalid="ignore", divide="ignore"):
            out["ci"]["bssIslandWeek"] = ci(1 - (ww @ sse_w) / (ww @ ssc_w))
        out["ci"]["islandWeeks"] = int(len(wk))
    return out


def main() -> None:
    final = "--final" in sys.argv
    # models.pkl is our own artifact written by train.py in this repo's .cache, never downloaded.
    with open(ML / "models.pkl", "rb") as fh:
        art = pickle.load(fh)
    feats, models, sha = art["features"], art["models"], art["modelSha256"]

    log_file = ML / "test-evaluations.json"
    test_log = json.loads(log_file.read_text()) if log_file.exists() else []
    if final:
        prior = [e for e in test_log if e["modelSha256"] == sha]
        if prior and "--again" not in sys.argv:
            sys.exit(f"the test split was already evaluated for this model at {prior[0]['at']}; pass --again \"<reason>\" to re-run (it is logged)")
        reason = sys.argv[sys.argv.index("--again") + 1] if "--again" in sys.argv else "first evaluation"
        test_log.append({"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "modelSha256": sha, "reason": reason})
        log_file.write_text(json.dumps(test_log, indent=1) + "\n")

    splits = ["validation"] + (["test", "oot", "oot_allviirs"] if final else [])
    ca = load_ca()
    blocks_of = {}
    ext = {}
    for line in open(ML / "boxes.jsonl"):
        o = json.loads(line)
        ext[o["id"]] = o
    for bid, o in ca.items():
        if o.get("status") == "ok" and bid in ext:
            blocks_of[bid] = {blk: (o["p1"][i], o["p2"][i]) for i, blk in enumerate(ext[bid]["blocks"])}

    data = {s: load(s) for s in splits}
    preds = {s: {lead: predict(data[s], feats, models[lead], lead, ca, blocks_of) for lead in LEADS} for s in splits}

    # Thresholds: CSI-optimal on validation, per model and lead.
    thresholds: dict[str, dict[str, float]] = {}
    va = data["validation"]
    for lead in LEADS:
        y = va[f"y{lead}"].to_numpy(int)
        for mname in MODELS:
            p = preds["validation"][lead][mname]
            ok = np.isfinite(p)
            if ok.sum() == 0:
                continue
            thresholds.setdefault(mname, {})[str(lead)] = best_threshold(y[ok], p[ok])

    results: dict = {}
    same_boxes: dict = {}
    csi_by_lead: dict = {}
    for s in splits:
        df = data[s]
        if df.empty:
            continue
        weeks = week_key(df).to_numpy()
        boxes = df["id"].to_numpy()
        subsets = {"all": np.ones(len(df), bool)}
        for isl in sorted(df["island"].unique()):
            subsets[isl] = (df["island"] == isl).to_numpy()
        results[s] = {}
        same_boxes[s] = {}
        for lead in LEADS:
            y = df[f"y{lead}"].to_numpy(int)
            clim = models[lead]["climatology"]
            results[s][str(lead)] = {}
            for mname in MODELS:
                p = preds[s][lead][mname]
                if np.isfinite(p).sum() == 0 or mname not in thresholds or str(lead) not in thresholds[mname]:
                    continue
                thr = thresholds[mname][str(lead)]
                r = {}
                for sub, msk in subsets.items():
                    mm = msk & np.isfinite(p)
                    r[sub] = metrics(y[mm], p[mm], clim, thr, boxes[mm], weeks[mm])
                if mname == "ca":
                    r["coverage"] = {"boxesWithCA": int(len(np.unique(boxes[np.isfinite(p)]))), "boxes": int(len(np.unique(boxes)))}
                results[s][str(lead)][mname] = r
            # Every model on exactly the boxes the CA ran on.
            cam = np.isfinite(preds[s][lead]["ca"])
            if cam.any():
                same_boxes[s][str(lead)] = {m: metrics(y[cam], preds[s][lead][m][cam], clim, thresholds[m][str(lead)], boxes[cam], weeks[cam])
                                            for m in MODELS if str(lead) in thresholds.get(m, {})}
        csi_by_lead[s] = {m: [results[s][str(l)].get(m, {}).get("all", {}).get("atThreshold", {}).get("csi") for l in LEADS] for m in MODELS}

    # Permutation importance on validation (raw GBM, log loss).
    from sklearn.inspection import permutation_importance
    importance = {}
    Xva = va[feats].to_numpy(np.float64)
    for lead in LEADS:
        r = permutation_importance(models[lead]["gbm"], Xva, va[f"y{lead}"].to_numpy(int), scoring="neg_log_loss", n_repeats=3, random_state=0)
        order = np.argsort(-r.importances_mean)
        importance[str(lead)] = [{"feature": feats[i], "meanLogLossIncrease": float(r.importances_mean[i]), "std": float(r.importances_std[i])} for i in order]

    man = json.loads((ML / "manifest.json").read_text())
    ca_status: dict = {}
    for o in ca.values():
        ca_status.setdefault(o["split"], {}).setdefault(o["status"], 0)
        ca_status[o["split"]][o["status"]] += 1
    doc = {
        "kind": "fireseptum.validation-scale", "v": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "final": final,
        "model": {"path": "public/data/forecaster/gbm-v1.json", "sha256": sha, "features": feats,
                  "hyperparameters": {str(l): {**models[l]["hp"], "nTrees": models[l]["nIter"]} for l in LEADS}},
        "split": "train 2015+2019 (train-boxes.json); validation 2023 Kalimantan; test 2023 Sumatra; out-of-time 2026 (oot: VIIRS S-NPP as training; oot_allviirs: S-NPP + NOAA-20 + NOAA-21 as the app reads)",
        "eventsSha256": man["eventsSha256"], "trainBoxesSha256": man["trainBoxesSha256"],
        "extraction": man["splits"], "fwiFiles": man["fwiFiles"],
        "baselines": {str(l): {"climatology": models[l]["climatology"],
                               "distance": {"intercept": float(models[l]["distance"].intercept_[0]), "slopePerKm": float(models[l]["distance"].coef_[0][0])},
                               "persistence": models[l]["persistence"]} for l in LEADS},
        "thresholds": thresholds,
        "results": results,
        "sameBoxesAsCA": same_boxes,
        "csiByLead": csi_by_lead,
        "caStatus": ca_status,
        "importanceValidation": importance,
        "testEvaluations": test_log,
        "notes": [
            "gbm_iso on validation is in-sample (the isotonic map was fitted there); its honest numbers are test and out-of-time.",
            "BSS is against the train base rate of each lead (climatology), on the same rows.",
            "Thresholds for CSI were chosen on validation for each model and lead and then fixed.",
            "CA: direction-averaged (8 wind directions x 5 runs) because the cached ERA5 archive has no wind direction; lead 2 = burning at some time in (24, 48 h].",
        ],
    }
    ph = ML / "register-posthoc.json"
    if ph.exists():
        doc["registerPostHoc"] = json.loads(ph.read_text())
    out = ROOT / "docs" / "validation-scale.json"
    out.write_text(json.dumps(doc, indent=1, allow_nan=False, default=lambda v: None) + "\n")
    print(f"wrote {out}")
    plots(results, splits)
    summary(results, same_boxes)


def plots(results: dict, splits: list[str]) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    colors = {"gbm": "#1f6f8b", "gbm_iso": "#c0392b", "distance": "#7f8c8d", "ca": "#d68910", "persistence": "#8e44ad"}
    img = ROOT / "docs" / "img"
    img.mkdir(parents=True, exist_ok=True)
    for s in splits:
        if s not in results:
            continue
        fig, axes = plt.subplots(1, 3, figsize=(12, 4.2), sharey=True)
        for ax, lead in zip(axes, LEADS):
            ax.plot([0, 1], [0, 1], color="#bbb", lw=1, ls="--")
            for m, col in colors.items():
                r = results[s][str(lead)].get(m, {}).get("all")
                if not r or not r.get("rows"):
                    continue
                pts = [(b["meanForecast"], b["observed"], b["n"]) for b in r["reliabilityDeciles"]]
                if not pts:
                    continue
                x, yv, n = zip(*pts)
                ax.plot(x, yv, "-o", color=col, lw=1.5, ms=3, label=f"{LABEL[m]} (BSS {r['bss']:.2f})")
            ax.set_title(f"Lead {lead} ({24 * (lead - 1)}-{24 * lead} h)")
            ax.set_xlabel("Forecast probability")
            top = max(0.05, max((b["observed"] for m2 in colors for b in (results[s][str(lead)].get(m2, {}).get("all", {}).get("reliabilityDeciles") or [])), default=0.05)) * 1.15
            ax.set_xlim(0, top)
            ax.set_ylim(0, top)
            ax.legend(fontsize=7, loc="upper left")
        axes[0].set_ylabel("Observed frequency of new fire")
        fig.suptitle(f"Reliability, {s}: forecast deciles (10 bins of equal block count)", fontsize=11)
        fig.tight_layout()
        fig.savefig(img / f"forecaster-reliability-{s}.png", dpi=110)
        plt.close(fig)


def summary(results: dict, same: dict) -> None:
    for s, r in results.items():
        print(f"\n== {s}")
        for lead in LEADS:
            for m in MODELS:
                a = r[str(lead)].get(m, {}).get("all")
                if not a or not a.get("rows"):
                    continue
                c = a["ci"]
                print(f"  L{lead} {m:12s} rows {a['rows']:6d} boxes {a['boxes']:4d} BS {a['brier']:.4f} BSS {a['bss']:+.3f} "
                      f"[{c['bss'][0]:+.3f}, {c['bss'][1]:+.3f}] AUC {a['auc']:.3f} CSI@{a['threshold']:.2f} {a['atThreshold']['csi']:.3f} CSI@.5 {a['at05']['csi']:.3f}")


if __name__ == "__main__":
    main()
