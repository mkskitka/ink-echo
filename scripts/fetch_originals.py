"""Download the Met's full-resolution originals for every indexed work and keep a
sharper working copy (long side <= --max-long px) in web/hi/<objectID>.jpg.

The web-large images (~600 px) are too soft for close-up passages and for
precise stroke alignment. These copies feed both:
  - the app's display tier (served from our own origin, so canvases stay clean), and
  - build_ink_maps.py --hires (higher-resolution ink maps for alignment).

One polite connection, resumable. web/hi/ is gitignored (about 1-2 GB).

Usage:
    python scripts/fetch_originals.py [--max-long 4096] [--rps 4]
"""
import argparse
import io
import json
import time
from pathlib import Path

import requests
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "hi"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-long", type=int, default=4096)
    ap.add_argument("--rps", type=float, default=4)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    objs = json.loads((ROOT / "data" / "objects.json").read_text(encoding="utf-8"))
    todo = [o for o in objs if o.get("imageLarge") and not (OUT / f"{o['id']}.jpg").exists()]
    print(f"{len(objs) - len(todo)} done, {len(todo)} to fetch", flush=True)
    s = requests.Session()
    s.headers["User-Agent"] = "met-ink-draw/0.1 (research prototype)"
    gap, last, ok, fail = 1 / args.rps, 0.0, 0, 0
    for i, o in enumerate(todo):
        for attempt in range(4):
            wait = last + gap - time.time()
            if wait > 0:
                time.sleep(wait)
            last = time.time()
            try:
                r = s.get(o["imageLarge"], timeout=90)
            except requests.RequestException:
                time.sleep(5 * (attempt + 1))
                continue
            if r.status_code in (403, 429, 503):
                gap = min(2.0, gap * 2)
                time.sleep(20 * (attempt + 1))
                continue
            break
        else:
            fail += 1
            continue
        if r.status_code != 200:
            fail += 1
            continue
        try:
            im = Image.open(io.BytesIO(r.content)).convert("RGB")
            k = args.max_long / max(im.size)
            if k < 1:
                im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
            im.save(OUT / f"{o['id']}.jpg", quality=86, optimize=True, progressive=True)
            ok += 1
        except OSError:
            fail += 1
        gap = max(1 / args.rps, gap * 0.97)
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(todo)} ok={ok} fail={fail}", flush=True)
    print(f"done: ok={ok} fail={fail}", flush=True)


if __name__ == "__main__":
    main()
