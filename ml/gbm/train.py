"""Train the gradient-boosted forecaster, one model per lead, tuned on validation only.

    uv run python train.py

Split (docs/forecast-split.md, published and timestamped before any fitting):
  train       2015 + 2019, both islands (data/validation/train-boxes.json, up to 8 boxes / day / island)
  validation  2023 Kalimantan: early stopping, the hyperparameter grid, isotonic calibration
  test        2023 Sumatra: NOT read here (evaluate.py --final, once)
  out-of-time 2026: NOT read here

Model: sklearn HistGradientBoostingClassifier (log loss), early_stopping off; for each grid point
the number of trees is chosen by the validation log loss of the staged predictions, and the grid
point with the lowest validation log loss wins (no refit: the chosen model is the fitted one, cut
to that many trees). Then IsotonicRegression (out_of_bounds="clip") maps the raw validation
probabilities to the observed validation frequencies.

Baselines fitted on train only: climatology (train base rate), distance-only (logistic regression
in d_fire_km), persistence (two rates: blocks with a detection of the last 24 h within 1 km, and
the rest).

Writes .cache/ml/models.pkl, public/data/forecaster/gbm-v1.json (trees as node arrays, isotonic
tables, metadata) and src/sim/gbm.fixture.json (the TS parity fixture).
"""
from __future__ import annotations

import hashlib
import json
import math
import pickle
import sys
import time
from datetime import datetime, timezone

import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

from common import LEADS, ML, ROOT, feature_names, load, manifest

GRID = [
    {"max_leaf_nodes": leaves, "min_samples_leaf": msl, "l2_regularization": l2}
    for leaves in (15, 31, 63) for msl in (100, 400) for l2 in (0.0, 1.0)
]
LEARNING_RATE = 0.1
MAX_ITER = 400
SEED = 20261024


def logloss_curve(model: HistGradientBoostingClassifier, X: np.ndarray, y: np.ndarray) -> np.ndarray:
    eps = 1e-15
    out = []
    for p in model.staged_predict_proba(X):
        q = np.clip(p[:, 1], eps, 1 - eps)
        out.append(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q)))
    return np.array(out)


def truncate(model: HistGradientBoostingClassifier, n: int) -> HistGradientBoostingClassifier:
    model._predictors = model._predictors[:n]
    return model


def export_tree(predictor) -> dict:
    nd = predictor.nodes
    if np.any(nd["is_categorical"]):
        raise ValueError("categorical splits are not supported by src/sim/gbm.ts")
    f = [int(v) if not leaf else -1 for v, leaf in zip(nd["feature_idx"], nd["is_leaf"])]
    # +inf thresholds (split "missing vs not missing") are written as null.
    t = [None if (leaf or not math.isfinite(v)) else float(v) for v, leaf in zip(nd["num_threshold"], nd["is_leaf"])]
    return {
        "f": f, "t": t,
        "m": [int(v) for v in nd["missing_go_to_left"]],
        "l": [int(v) for v in nd["left"]], "r": [int(v) for v in nd["right"]],
        "v": [float(v) for v in nd["value"]],
    }


def sigmoid(raw: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-raw))


def main() -> None:
    global GRID, MAX_ITER
    if "--quick" in sys.argv:  # development only: one grid point, few trees
        GRID, MAX_ITER = GRID[2:3], 60
    feats_all = feature_names()
    tr, va = load("train"), load("validation")
    if tr.empty or va.empty:
        sys.exit("rows_train.csv / rows_validation.csv missing: run scripts/ml/extract.ts and assemble.ts")
    for c in ("dc", "dmc", "ffmc"):
        if tr[c].isna().all() or va[c].isna().all():
            if "--allow-missing-fwi" not in sys.argv:
                sys.exit(f"FWI column {c} is empty: wait for data/fwi/era5-<year>.json.gz and re-run assemble.ts")
    # Features that are never observed in training cannot be learned (wind_align: no wind direction in ERA5 archive).
    feats = [c for c in feats_all if tr[c].notna().any()]
    dropped = [c for c in feats_all if c not in feats]
    print(f"train {len(tr)} rows / {tr['id'].nunique()} boxes, validation {len(va)} rows / {va['id'].nunique()} boxes; "
          f"{len(feats)} features (dropped, never observed in train: {dropped})")
    Xtr, Xva = tr[feats].to_numpy(np.float64), va[feats].to_numpy(np.float64)

    out_leads: dict[str, dict] = {}
    models: dict[int, dict] = {}
    for lead in LEADS:
        ytr, yva = tr[f"y{lead}"].to_numpy(int), va[f"y{lead}"].to_numpy(int)
        t0 = time.time()
        trials = []
        best = None
        for i, hp in enumerate(GRID):
            m = HistGradientBoostingClassifier(learning_rate=LEARNING_RATE, max_iter=MAX_ITER, early_stopping=False,
                                               random_state=SEED, **hp)
            m.fit(Xtr, ytr)
            curve = logloss_curve(m, Xva, yva)
            n = int(np.argmin(curve)) + 1
            trials.append({**hp, "bestIter": n, "valLogLoss": float(curve[n - 1]), "valLogLossAtMax": float(curve[-1])})
            print(f"  lead {lead} [{i + 1}/{len(GRID)}] {hp} -> {n} trees, val log loss {curve[n - 1]:.5f} ({time.time() - t0:.0f} s)")
            if best is None or curve[n - 1] < best[0]:
                best = (float(curve[n - 1]), hp, n, m)
        _, hp, n, m = best
        truncate(m, n)
        p_va = m.predict_proba(Xva)[:, 1]
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0, increasing=True).fit(p_va, yva)

        base = float(ytr.mean())
        lr = LogisticRegression(C=1e6, max_iter=1000).fit(tr[["d_fire_km"]].to_numpy(), ytr)
        near = tr["n_active_1km"].to_numpy() >= 1
        pers = {"near": float(ytr[near].mean()), "far": float(ytr[~near].mean())}
        models[lead] = {"gbm": m, "iso": iso, "hp": hp, "nIter": n, "climatology": base, "distance": lr, "persistence": pers}
        out_leads[str(lead)] = {
            "baseline": float(m._baseline_prediction.ravel()[0]),
            "nTrees": n,
            "hyperparameters": {"learning_rate": LEARNING_RATE, **hp},
            "isotonic": {"x": [float(v) for v in iso.X_thresholds_], "y": [float(v) for v in iso.y_thresholds_]},
            "trees": [export_tree(it[0]) for it in m._predictors],
            "tuning": trials,
            "trainBaseRate": base,
            "trainRows": int(len(ytr)), "trainPositives": int(ytr.sum()),
            "validationRows": int(len(yva)), "validationPositives": int(yva.sum()),
        }
        print(f"lead {lead}: chose {hp}, {n} trees; train base rate {base:.4f}; isotonic {len(iso.X_thresholds_)} knots")

    man = manifest()
    doc = {
        "kind": "fireseptum.gbm-forecaster",
        "v": 1,
        "model": {"id": "fire-septum-gbm", "name": "Fire Septum gradient-boosted forecaster", "version": "1"},
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "target": "P(new VIIRS S-NPP fire in a 400 m block that is not on fire at t0) in the 24 h window of each lead after t0",
        "features": feats,
        "featuresDroppedNeverObserved": dropped,
        "missing": "NaN (null in JSON inputs) follows each node's missing-goes-left flag; a null threshold means +Infinity",
        "output": "p = 1 / (1 + exp(-(baseline + sum of leaf values))); calibrated = isotonic(p), linear between knots, clipped to the end knots",
        "leads": out_leads,
        "training": {
            "library": f"scikit-learn {sklearn.__version__} HistGradientBoostingClassifier",
            "split": "train 2015+2019 both islands; validation 2023 Kalimantan (early stopping, grid, isotonic); test 2023 Sumatra; out-of-time 2026",
            "eventsSha256": man["eventsSha256"], "trainBoxesSha256": man["trainBoxesSha256"],
            "fwiFiles": man["fwiFiles"],
            "trainBoxes": int(tr["id"].nunique()), "validationBoxes": int(va["id"].nunique()),
            "seed": SEED,
        },
    }
    out = ROOT / "public" / "data" / "forecaster" / "gbm-v1.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, separators=(",", ":"), allow_nan=False)
    out.write_text(text + "\n")
    print(f"wrote {out} ({len(text) / 1e6:.2f} MB, sha256 {hashlib.sha256(text.encode()).hexdigest()[:16]})")

    with open(ML / "models.pkl", "wb") as fh:
        pickle.dump({"features": feats, "models": models, "modelSha256": hashlib.sha256(text.encode()).hexdigest()}, fh)

    # Parity fixture: validation rows (every 50th) plus rows with features knocked out to NaN.
    rng = np.random.default_rng(SEED)
    idx = np.arange(0, len(va), max(1, len(va) // 200))[:200]
    X = Xva[idx].copy()
    Xn = Xva[rng.choice(len(va), 60, replace=False)].copy()
    Xn[rng.random(Xn.shape) < 0.3] = np.nan
    X = np.vstack([X, Xn])
    fix = {"note": "Generated by ml/gbm/train.py from public/data/forecaster/gbm-v1.json; src/sim/gbm.test.ts must reproduce these to 1e-12.",
           "modelSha256": hashlib.sha256(text.encode()).hexdigest(),
           "features": feats, "rows": [[None if not math.isfinite(v) else float(v) for v in r] for r in X], "leads": {}}
    for lead in LEADS:
        m, iso = models[lead]["gbm"], models[lead]["iso"]
        raw = m._raw_predict(X)[:, 0]
        p = m.predict_proba(X)[:, 1]
        fix["leads"][str(lead)] = {"raw": raw.tolist(), "p": p.tolist(), "calibrated": iso.predict(p).tolist()}
    (ROOT / "src" / "sim" / "gbm.fixture.json").write_text(json.dumps(fix, allow_nan=False) + "\n")
    print(f"wrote src/sim/gbm.fixture.json ({len(X)} rows)")


if __name__ == "__main__":
    main()
