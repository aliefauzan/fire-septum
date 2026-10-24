"""Fire Septum: snapshot OpenStreetMap barriers and drainage for Kalimantan and Sumatra.

Run from the repo root:  uv run --project ml/osm python ml/osm/snapshot_barriers.py

Downloads the Geofabrik extracts into .cache/osm-pbf/ if missing, extracts canals, ditches,
drains, rivers, streams, water areas, roads and built-up areas, simplifies them
(Douglas-Peucker, SIMPLIFY_M metres), clips them to 0.25 degree tiles padded by PAD_M metres,
and writes public/data/osm-barriers/index.json plus one <south>_<west>.json per non-empty tile.
The format is decoded by src/data/barriers.ts.

Tile file: {"b": [west, south, east, north],
            "l": [[kind, x0, y0, dx1, dy1, ...], ...],   # lines
            "a": [[kind, x0, y0, dx1, dy1, ...], ...]}   # closed outer rings
with x = round(lon * 1e5), y = round(lat * 1e5), the first point absolute, then deltas.

If the total size exceeds BUDGET_BYTES, minor features outside peat are dropped in this order:
road_minor, stream, track (peat = Global Forest Watch gfw_peatlands tiles, alpha > 0, at z9).
Canal, ditch, drain, river, water and road_major are never dropped.
"""

from __future__ import annotations

import io
import json
import math
import os
import shutil
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import osmium
import shapely
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.base import BaseGeometry

ROOT = Path(__file__).resolve().parents[2]
PBF_DIR = ROOT / ".cache" / "osm-pbf"
PEAT_DIR = ROOT / ".cache" / "gfw-peat-z9"
OUT_DIR = ROOT / "public" / "data" / "osm-barriers"

REGIONS = [
    ("kalimantan", "https://download.geofabrik.de/asia/indonesia/kalimantan-latest.osm.pbf"),
    ("sumatra", "https://download.geofabrik.de/asia/indonesia/sumatra-latest.osm.pbf"),
]
UA = "FireSeptum/0.1 (IEEE ClimateChain hackathon prototype)"

TILE_DEG = 0.25
QUANT = 100_000
SIMPLIFY_M = 7.0
PAD_M = 200.0
M_PER_DEG = 111_320.0
BUDGET_BYTES = 80 * 1024 * 1024
DROP_ORDER = ["road_minor", "stream", "track"]  # only outside peat, in this order
PEAT_Z = 9

KINDS = ["canal", "ditch", "drain", "river", "stream", "road_major", "road_minor", "track", "water", "built"]
KIDX = {k: i for i, k in enumerate(KINDS)}
LINE_KINDS = {"canal", "ditch", "drain", "river", "stream", "road_major", "road_minor", "track"}

MAJOR = {"motorway", "trunk", "primary", "secondary", "tertiary"}
MAJOR |= {h + "_link" for h in MAJOR}
MINOR = {"unclassified", "residential", "service"}


def line_kind(tags) -> str | None:
    ww = tags.get("waterway")
    if ww in ("canal", "ditch", "drain", "river", "stream"):
        return ww
    hw = tags.get("highway")
    if hw in MAJOR:
        return "road_major"
    if hw in MINOR:
        return "road_minor"
    if hw == "track":
        return "track"
    return None


def area_kind(tags) -> str | None:
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or "water" in tags:
        return "water"
    lu = tags.get("landuse")
    if lu in ("reservoir", "basin"):
        return "water"
    if lu in ("residential", "industrial", "commercial", "retail"):
        return "built"
    return None


def download(name: str, url: str) -> Path:
    PBF_DIR.mkdir(parents=True, exist_ok=True)
    path = PBF_DIR / f"{name}-latest.osm.pbf"
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    print(f"downloading {url}", file=sys.stderr)
    tmp = path.with_suffix(".part")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.rename(path)
    return path


def osm_timestamp(path: Path) -> str | None:
    h = osmium.io.Reader(str(path), osmium.osm.NOTHING).header()
    return h.get("osmosis_replication_timestamp") or None


def tile_range(minx, miny, maxx, maxy, pad_deg):
    ix0 = math.floor((minx - pad_deg) / TILE_DEG)
    ix1 = math.floor((maxx + pad_deg) / TILE_DEG)
    iy0 = math.floor((miny - pad_deg) / TILE_DEG)
    iy1 = math.floor((maxy + pad_deg) / TILE_DEG)
    for iy in range(iy0, iy1 + 1):
        for ix in range(ix0, ix1 + 1):
            yield ix, iy


def tile_key(ix: int, iy: int) -> str:
    return f"{iy * TILE_DEG:.2f}_{ix * TILE_DEG:.2f}"


def encode(kind_i: int, coords) -> list[int] | None:
    out = [kind_i]
    px = py = None
    n = 0
    for lon, lat in coords:
        x, y = round(lon * QUANT), round(lat * QUANT)
        if px is None:
            out += (x, y)
        elif x == px and y == py:
            continue
        else:
            out += (x - px, y - py)
        px, py = x, y
        n += 1
    return out if n >= 2 else None


def parts(g: BaseGeometry, want_poly: bool):
    if g.is_empty:
        return
    t = g.geom_type
    if want_poly and t == "Polygon":
        yield g
    elif not want_poly and t == "LineString":
        yield g
    elif t.startswith("Multi") or t == "GeometryCollection":
        for p in g.geoms:
            yield from parts(p, want_poly)
    elif not want_poly and t == "LinearRing":
        yield LineString(g.coords)


def seg_km(coords) -> float:
    km = 0.0
    for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
        dx = (x1 - x0) * math.cos(math.radians((y0 + y1) / 2))
        km += math.hypot(dx, y1 - y0) * M_PER_DEG / 1000
    return km


class Snapshot:
    def __init__(self):
        self.tol = SIMPLIFY_M / M_PER_DEG
        self.pad = PAD_M / M_PER_DEG
        # tile -> list of (kind_name, is_area, json_text)
        self.tiles: dict[tuple[int, int], list[tuple[str, bool, str]]] = defaultdict(list)
        self.seen: set[tuple[str, int]] = set()
        self.counts: dict[str, dict[str, int]] = {}
        self.km: dict[str, dict[str, float]] = {}

    def add(self, region: str, kind: str, geom: BaseGeometry, is_area: bool):
        minx, miny, maxx, maxy = geom.bounds
        ki = KIDX[kind]
        for ix, iy in tile_range(minx, miny, maxx, maxy, self.pad):
            w, s = ix * TILE_DEG - self.pad, iy * TILE_DEG - self.pad
            e, n = (ix + 1) * TILE_DEG + self.pad, (iy + 1) * TILE_DEG + self.pad
            if minx >= w and maxx <= e and miny >= s and maxy <= n:
                clipped = geom
            else:
                if maxx < w or minx > e or maxy < s or miny > n:
                    continue
                clipped = shapely.clip_by_rect(geom, w, s, e, n)
            for p in parts(clipped, is_area):
                coords = list(p.exterior.coords) if is_area else list(p.coords)
                enc = encode(ki, coords)
                if enc is None or (is_area and len(enc) < 9):
                    continue
                self.tiles[(ix, iy)].append((kind, is_area, json.dumps(enc, separators=(",", ":"))))

    def run_region(self, region: str, path: Path):
        counts = self.counts.setdefault(region, defaultdict(int))
        km = self.km.setdefault(region, defaultdict(float))
        keys = osmium.filter.KeyFilter("waterway", "highway", "natural", "water", "landuse")
        fp = (
            osmium.FileProcessor(str(path))
            .with_locations()
            .with_areas(keys)
            .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY | osmium.osm.AREA))
            .with_filter(keys)
        )
        t0 = time.time()
        nobj = 0
        for obj in fp:
            nobj += 1
            if nobj % 500_000 == 0:
                print(f"  {region}: {nobj} objects, {time.time() - t0:.0f}s", file=sys.stderr)
            tags = obj.tags
            if obj.is_way():
                kind = line_kind(tags)
                if kind is None:
                    continue
                sid = ("w", obj.id)
                if sid in self.seen:
                    continue
                self.seen.add(sid)
                try:
                    coords = [(n.lon, n.lat) for n in obj.nodes]
                except osmium.InvalidLocationError:
                    coords = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
                if len(coords) < 2:
                    continue
                g = LineString(coords).simplify(self.tol, preserve_topology=False)
                if g.is_empty or g.length == 0:
                    continue
                counts[kind] += 1
                km[kind] += seg_km(list(g.coords))
                self.add(region, kind, g, False)
            elif obj.is_area():
                kind = area_kind(tags)
                if kind is None:
                    continue
                sid = ("a", obj.id)
                if sid in self.seen:
                    continue
                self.seen.add(sid)
                added = False
                for ring in obj.outer_rings():
                    try:
                        coords = [(n.lon, n.lat) for n in ring]
                    except osmium.InvalidLocationError:
                        continue
                    if len(coords) < 4:
                        continue
                    poly = Polygon(coords)
                    if not poly.is_valid:
                        poly = shapely.make_valid(poly)
                    poly = poly.simplify(self.tol, preserve_topology=True)
                    for p in parts(poly, True):
                        if p.area <= 0:
                            continue
                        self.add(region, kind, p, True)
                        added = True
                if added:
                    counts[kind] += 1
        print(f"  {region}: done, {nobj} objects in {time.time() - t0:.0f}s", file=sys.stderr)

    def tile_bytes(self, items) -> int:
        # {"b":[...],"l":[a,b],"a":[c]} -- close enough to the written size for budgeting
        return 40 + sum(len(t) + 1 for _, _, t in items)


class PeatMask:
    """GFW peat (alpha > 0) sampled from z9 tiles, cached on disk."""

    def __init__(self):
        from PIL import Image  # noqa: F401  (import check)

        self.cache: dict[tuple[int, int], object] = {}
        PEAT_DIR.mkdir(parents=True, exist_ok=True)

    def _tile(self, tx: int, ty: int):
        k = (tx, ty)
        if k in self.cache:
            return self.cache[k]
        from PIL import Image

        f = PEAT_DIR / f"{tx}_{ty}.png"
        if not f.exists():
            url = f"https://tiles.globalforestwatch.org/gfw_peatlands/latest/default/{PEAT_Z}/{tx}/{ty}.png"
            data = b""
            for attempt in range(4):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        data = r.read()
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        break
                    time.sleep(2 * (attempt + 1))
                except Exception:
                    time.sleep(2 * (attempt + 1))
            f.write_bytes(data)
        data = f.read_bytes()
        alpha = None
        if data:
            alpha = Image.open(io.BytesIO(data)).convert("RGBA").getchannel("A").load()
        self.cache[k] = alpha
        return alpha

    def at(self, lon: float, lat: float) -> bool:
        n = 2**PEAT_Z
        fx = (lon + 180) / 360 * n
        lr = math.radians(lat)
        fy = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n
        tx, ty = int(fx), int(fy)
        a = self._tile(tx, ty)
        if a is None:
            return False
        px, py = min(255, int((fx - tx) * 256)), min(255, int((fy - ty) * 256))
        return a[px, py] > 0

    def touches(self, enc: list[int]) -> bool:
        x, y = enc[1], enc[2]
        if self.at(x / QUANT, y / QUANT):
            return True
        for i in range(3, len(enc) - 1, 2):
            x += enc[i]
            y += enc[i + 1]
            if self.at(x / QUANT, y / QUANT):
                return True
        return False


def main():
    t0 = time.time()
    snap = Snapshot()
    sources = []
    for name, url in REGIONS:
        path = download(name, url)
        ts = osm_timestamp(path)
        print(f"{name}: {path} ({path.stat().st_size / 1e6:.0f} MB), osm timestamp {ts}", file=sys.stderr)
        sources.append({"region": name, "url": url, "osmTimestamp": ts})
        snap.run_region(name, path)

    total = sum(snap.tile_bytes(v) for v in snap.tiles.values())
    by_kind: dict[str, int] = defaultdict(int)
    for items in snap.tiles.values():
        for kind, _, t in items:
            by_kind[kind] += len(t) + 1
    print(f"measured total {total / 1e6:.1f} MB in {len(snap.tiles)} tiles", file=sys.stderr)
    for k in KINDS:
        print(f"  {k:11s} {by_kind[k] / 1e6:8.2f} MB", file=sys.stderr)

    dropped = []
    if total > BUDGET_BYTES:
        peat = PeatMask()
        for kind in DROP_ORDER:
            if total <= BUDGET_BYTES:
                break
            freed = 0
            nfeat = 0
            for key, items in snap.tiles.items():
                keep = []
                for it in items:
                    if it[0] == kind and not peat.touches(json.loads(it[2])):
                        freed += len(it[2]) + 1
                        nfeat += 1
                    else:
                        keep.append(it)
                snap.tiles[key] = keep
            total -= freed
            dropped.append({"kind": kind, "where": "outside peat", "pieces": nfeat, "bytes": freed})
            print(f"dropped {kind} outside peat: {nfeat} pieces, {freed / 1e6:.1f} MB -> {total / 1e6:.1f} MB", file=sys.stderr)

    if OUT_DIR.exists():
        for f in OUT_DIR.glob("*.json"):
            f.unlink()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index_tiles = {}
    written = 0
    for (ix, iy), items in sorted(snap.tiles.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        if not items:
            continue
        w, s = ix * TILE_DEG, iy * TILE_DEG
        lines = [t for k, a, t in items if not a]
        areas = [t for k, a, t in items if a]
        text = (
            '{"b":' + json.dumps([w, s, w + TILE_DEG, s + TILE_DEG], separators=(",", ":"))
            + ',"l":[' + ",".join(lines) + '],"a":[' + ",".join(areas) + "]}"
        )
        key = tile_key(ix, iy)
        (OUT_DIR / f"{key}.json").write_text(text)
        index_tiles[key] = {"bytes": len(text), "lines": len(lines), "areas": len(areas)}
        written += len(text)

    index = {
        "v": 1,
        "kind": "fireseptum.osm-barriers",
        "tileDeg": TILE_DEG,
        "quant": QUANT,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": sources,
        "attribution": "OpenStreetMap contributors (ODbL), via Geofabrik extracts",
        "simplifyM": SIMPLIFY_M,
        "padM": PAD_M,
        "kinds": KINDS,
        "dropped": dropped,
        "stats": {
            r: {
                "features": dict(snap.counts[r]),
                "km": {k: round(v, 1) for k, v in snap.km[r].items()},
            }
            for r in snap.counts
        },
        "tiles": index_tiles,
    }
    (OUT_DIR / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"wrote {len(index_tiles)} tiles, {written / 1e6:.1f} MB, in {time.time() - t0:.0f}s", file=sys.stderr)
    for r in snap.counts:
        drain = sum(snap.km[r].get(k, 0) for k in ("canal", "ditch", "drain"))
        print(f"{r}: canal+ditch+drain {drain:.0f} km; features {dict(snap.counts[r])}", file=sys.stderr)


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
