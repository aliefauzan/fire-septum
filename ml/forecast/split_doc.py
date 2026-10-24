"""Write docs/forecast-split.md from data/validation/events.json and train-boxes.json.

    uv run python split_doc.py [--ots-status TEXT]
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter

from common import ROOT

V = ROOT / "data" / "validation"


def main() -> None:
    ots_status = sys.argv[sys.argv.index("--ots-status") + 1] if "--ots-status" in sys.argv else "pending"
    raw = (V / "events.json").read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    ev = json.loads(raw)
    tb = json.loads((V / "train-boxes.json").read_text())
    c = Counter((e["split"], e["island"], e["d"][:4]) for e in ev["events"])
    ct = Counter((e["island"], e["d"][:4]) for e in tb["events"])
    keys = {(e["island"], e["d"][:4]) for e in ev["events"]}
    distinct_days = {k: len({e["d"] for e in ev["events"] if (e["island"], e["d"][:4]) == k}) for k in keys}
    order = ["train", "validation", "test", "oot"]
    rows = sorted(c.items(), key=lambda kv: (order.index(kv[0][0]), kv[0][2], kv[0][1]))
    tot = Counter()
    for (s, _, _), n in c.items():
        tot[s] += n
    lines = [
        "# Fire Septum forecaster: validation events and the published split",
        "",
        f"Generated {ev['generatedAt']} by `ml/forecast/events.py`, before any forecaster was trained or tuned.",
        "",
        "## Published before tuning",
        "",
        "The event rule and the train / validation / test split below were written down and the event list",
        "(`data/validation/events.json`) was timestamped on the Bitcoin blockchain with OpenTimestamps",
        "*before* any model was fitted, any hyperparameter searched or any calibration chosen. Nothing in",
        "this file or in `events.json` may change after a score has been seen; a new rule needs a new file,",
        "a new timestamp and a note saying why.",
        "",
        f"- SHA-256 of `data/validation/events.json`: `{digest}`",
        f"- OpenTimestamps proof: `data/validation/events.json.ots` ({ots_status})",
        "- Verify: `uvx --from opentimestamps-client ots verify data/validation/events.json.ots` (once the",
        "  calendar has committed the digest to a Bitcoin block, typically a few hours; `ots upgrade` first).",
        "",
        "## Split",
        "",
        "| Split | Data | Use |",
        "|---|---|---|",
        "| **train** | 2015 and 2019, Kalimantan and Sumatra | fitting the forecaster |",
        "| **validation** | 2023 Kalimantan | all tuning: isotonic calibration, any hyperparameter search, feature choices |",
        "| **test** | 2023 Sumatra | touched once, at the end, and reported whatever it says |",
        "| **out-of-time test** | the 12 events of 8 to 18 October 2026 and the prospective forecast register | reported after the test split |",
        "",
        "2015 (strong El Nino) and 2019 (strong positive Indian Ocean Dipole) were severe fire seasons; 2023",
        "(El Nino with a positive IOD) was large but smaller. Holding out a whole year, and a whole island",
        "for the test, keeps neighbouring days and the same fires out of training and tuning.",
        "",
        "## Event rule (exact text, also in `events.json`)",
        "",
        "> " + ev["rule"],
        "",
        "It generalises the 12-event rule of `docs/hindcast.md` (busiest box per island per day, with fire on",
        "D+1) from one box to up to three non-overlapping boxes, and adds the minimum of 5 detections on D.",
        "Scoring keeps the hindcast conventions of `src/sim/hindcast.ts`: 400 m blocks, new fire only (blocks",
        "burning or burned at t0 are excluded), and a 3 km reach from the fire at t0.",
        "",
        "Inputs are restricted to what was knowable at t0. The detections that define an event on day D and",
        "D+1 are VIIRS S-NPP only (standard processing, from the yearly archive), so the label source is",
        "consistent across 2015 to 2023. NOAA-20 flies from 2018 but has no yearly country file at the",
        "corresponding `viirs-noaa20` path (HTTP 404 on 24 Oct 2026), and is not needed: S-NPP covers all years.",
        "",
        "## Counts",
        "",
        "| Split | Island | Year | Events | Days with an event |",
        "|---|---|---|---|---|",
    ]
    for (s, isl, y), n in rows:
        dd = distinct_days[(isl, y)]
        lines.append(f"| {s} | {isl} | {y} | {n} | {dd} |")
    lines += [
        "",
        "Totals: " + ", ".join(f"{s} {tot[s]}" for s in order) + f"; all {sum(tot.values())}.",
        "",
        "## Training-sample boxes (train only)",
        "",
        "`data/validation/train-boxes.json` applies the same rule with up to **8** boxes per day per island,",
        "for 2015 and 2019 only, to give the forecaster more training samples. Every box in it has",
        "`split: \"train\"`. It must never be used for validation or test, and it contains no 2023 or 2026 box.",
        "",
        "| Island | Year | Boxes |",
        "|---|---|---|",
    ]
    for (isl, y), n in sorted(ct.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        lines.append(f"| {isl} | {y} | {n} |")
    lines += [
        "",
        f"Total training boxes: {len(tb['events'])}.",
        "",
        "## Source files",
        "",
        "| File | SHA-256 | Rows | Dropped (type != 0) |",
        "|---|---|---|---|",
    ]
    for f in ev["firmsFiles"]:
        lines.append(f"| `{f['name']}` | `{f['sha256'][:16]}...` | {f['rows']:,} | {f['droppedNonVegetation']:,} |")
    lines += [
        "",
        "Downloaded keyless from `https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/<YEAR>/` into",
        "`.cache/firms-archive/` by `ml/forecast/firms_archive.py`. FIRMS `type`: 0 presumed vegetation fire,",
        "1 active volcano, 2 other static land source, 3 offshore; only type 0 is used.",
        "",
        "## Caveats",
        "",
        "- Satellites miss fire under smoke and cloud and miss cool smouldering peat; a box with no D+1",
        "  detection is not proof the fire stopped. The D+1 requirement makes every event scoreable.",
        "- Boxes on consecutive days often cover the same fire. Scores must be pooled over events and",
        "  reported with that dependence in mind (for example a block bootstrap by fire or by week).",
        "- The Kalimantan bbox reaches 119.5 E and so includes a strip of western Sulawesi; the country file",
        "  holds Indonesian detections only, so Malaysian Borneo is not in it.",
        "",
    ]
    (ROOT / "docs" / "forecast-split.md").write_text("\n".join(lines))
    print("docs/forecast-split.md", digest)


if __name__ == "__main__":
    main()
