"""Invariants of the published event list and training boxes (data/validation/)."""
import json
from collections import defaultdict

from common import ROOT, bbox_around

V = ROOT / "data" / "validation"


def load(name):
    return json.loads((V / name).read_text())


def overlap(a, b):
    return a["west"] < b["east"] and b["west"] < a["east"] and a["south"] < b["north"] and b["south"] < a["north"]


def test_events_follow_rule_and_split():
    doc = load("events.json")
    assert doc["kind"] == "fireseptum.validation-events" and doc["v"] == 1
    by_day = defaultdict(list)
    for e in doc["events"]:
        y = int(e["d"][:4])
        expected = {2015: "train", 2019: "train", 2026: "oot"}.get(y) or ("validation" if e["island"] == "Kalimantan" else "test")
        assert e["split"] == expected, e
        assert e["t0"].startswith(e["d"])
        if y != 2026:
            assert e["detD"] >= 5 and e["detD1"] >= 1
            assert "08-01" <= e["d"][5:] <= "10-31"
            by_day[(e["island"], e["d"])].append(e)
    assert sum(e["split"] == "oot" for e in doc["events"]) == 12
    for evs in by_day.values():
        assert len(evs) <= 3
        assert [e["detD"] for e in evs] == sorted((e["detD"] for e in evs), reverse=True)
        boxes = [bbox_around(e["lat"], e["lon"]) for e in evs]
        assert not any(overlap(a, b) for i, a in enumerate(boxes) for b in boxes[i + 1:])
    assert len({e["id"] for e in doc["events"]}) == len(doc["events"])


def test_train_boxes_are_train_only_and_contain_the_events():
    tb = load("train-boxes.json")
    assert all(b["split"] == "train" and b["d"][:4] in ("2015", "2019") for b in tb["events"])
    per_day = defaultdict(int)
    for b in tb["events"]:
        per_day[(b["island"], b["d"])] += 1
    assert max(per_day.values()) <= 8
    ids = {b["id"]: b for b in tb["events"]}
    for e in load("events.json")["events"]:
        if e["split"] == "train":
            assert ids[e["id"]] == e  # greedy order: the first 3 of 8 are the events
