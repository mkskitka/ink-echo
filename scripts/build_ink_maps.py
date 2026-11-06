"""Write a small "ink map" per painting to web/ink/<objectID>.jpg.

The Met's image server sends no CORS headers, so the browser can't read
painting pixels. These same-origin ink maps (white = ink, black = paper) let
the app do fine alignment (chamfer matching at any zoom / position / rotation)
and stroke-following effects. Same aspect ratio as the source image.

Usage:
    python scripts/build_ink_maps.py [--short 160] [--max-long 2048]
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


def build(args):
    oid, short, max_long, force = args
    dst = OUT / f"{oid}.jpg"
    if dst.exists() and not force:
        return oid, True
    src = DATA / "images" / f"{oid}.jpg"
    try:
        with Image.open(src) as im:
            ink = ink_map(im, short_side=short, max_long=max_long)
    except OSError:
        return oid, False
    Image.fromarray((ink * 255).astype(np.uint8)).save(dst, quality=82, optimize=True)
    return oid, True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--short", type=int, default=160)
    ap.add_argument("--max-long", type=int, default=2048)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    ids = [o["id"] for o in json.loads((DATA / "objects.json").read_text(encoding="utf-8"))
           if (DATA / "images" / f"{o['id']}.jpg").exists()]
    with ProcessPoolExecutor() as pool:
        ok = sum(r for _, r in pool.map(build, [(i, args.short, args.max_long, args.force) for i in ids], chunksize=16))
    total = sum(f.stat().st_size for f in OUT.glob("*.jpg"))
    print(f"ink maps: {ok}/{len(ids)} -> web/ink/ ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
