"""Write a small "ink map" per painting to web/ink/<objectID>.jpg.

The Met's image server sends no CORS headers, so the browser can't read
painting pixels. These same-origin ink maps (white = ink, black = paper) let
the app do fine alignment (chamfer matching at any zoom / position / rotation)
and stroke-following effects. Same aspect ratio as the source image.

Usage:
    python scripts/build_ink_maps.py [--short 320] [--max-long 4096]

Source is the sharp copy in web/hi/ when downloaded (scripts/fetch_originals.py),
else the web-large copy in data/images/. data/ink_sources.json records which, so
re-running upgrades maps once a sharper source arrives.
"""
import argparse
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from descriptor import ink_map

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "web" / "ink"


def source(oid):
    hi = ROOT / "web" / "hi" / f"{oid}.jpg"
    return (hi, "hi") if hi.exists() else (DATA / "images" / f"{oid}.jpg", "lo")


BOXES = json.loads((DATA / "boxes.json").read_text()) if (DATA / "boxes.json").exists() else {}


def clip_box(ink, box):
    """Keep only the picture area (mounts, frames and backdrop become paper)."""
    if not box:
        return ink
    h, w = ink.shape
    m = np.zeros_like(ink)
    x0, y0, x1, y1 = int(box[0] * w), int(box[1] * h), int(np.ceil(box[2] * w)), int(np.ceil(box[3] * h))
    m[y0:y1, x0:x1] = 1
    return ink * m


def build(args):
    oid, short, max_long, force, prev = args
    dst = OUT / f"{oid}.jpg"
    src, tier = source(oid)
    tier = tier + ("+box" if BOXES.get(str(oid)) else "")
    if dst.exists() and not force and prev == tier:
        return oid, tier
    try:
        with Image.open(src) as im:
            ink = clip_box(ink_map(im, short_side=short, max_long=max_long), BOXES.get(str(oid)))
    except OSError:
        return oid, None
    Image.fromarray((ink * 255).astype(np.uint8)).save(dst, quality=80, optimize=True)
    return oid, tier


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--short", type=int, default=320)
    ap.add_argument("--max-long", type=int, default=4096)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    ids = [i for i in json.loads((DATA / "curated.json").read_text()) if (DATA / "images" / f"{i}.jpg").exists()]
    vp = DATA / "curated_views.json"
    ids += json.loads(vp.read_text()) if vp.exists() else []
    src_path = DATA / "ink_sources.json"
    prev = json.loads(src_path.read_text()) if src_path.exists() else {}
    with ProcessPoolExecutor() as pool:
        res = dict(pool.map(build, [(i, args.short, args.max_long, args.force, prev.get(str(i))) for i in ids], chunksize=8))
    tiers = {str(k): v for k, v in res.items() if v}
    src_path.write_text(json.dumps(tiers))
    ok = len(tiers)
    keep = {f"{i}.jpg" for i in ids}
    for f in OUT.glob("*.jpg"):          # drop maps for works no longer curated
        if f.name not in keep:
            f.unlink()
    print(f"sources: {sum(v.startswith('hi') for v in tiers.values())} hi-res, {sum(v.startswith('lo') for v in tiers.values())} web-large, {sum('box' in v for v in tiers.values())} trimmed to the picture")
    total = sum(f.stat().st_size for f in OUT.glob("*.jpg"))
    print(f"ink maps: {ok}/{len(ids)} -> web/ink/ ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
