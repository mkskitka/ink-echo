"""Download the Met's *additional images* for curated works: individual album
leaves, handscroll sections and close-up details, photographed at full
resolution. Each becomes a "view" the app can match against.

Writes web/hi/<id>_<k>.jpg (long side <= --max-long) and a small
data/images/<id>_<k>.jpg (600 px) used for corpus statistics. Resumable.

Usage:
    python scripts/fetch_additional.py [--max-long 3072] [--rps 4]
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-long", type=int, default=3072)
    ap.add_argument("--rps", type=float, default=4)
    ap.add_argument("--reverse", action="store_true", help="work from the end (run a second copy to halve the time)")
    ap.add_argument("--books", action="store_true", help="only illustrated books, prints and drawings (manual pages)")
    args = ap.parse_args()
    det = json.loads((ROOT / "data" / "details.json").read_text(encoding="utf-8"))
    cur = json.loads((ROOT / "data" / "curated.json").read_text())
    if args.books:
        objs = json.loads((ROOT / "data" / "objects.json").read_text(encoding="utf-8"))
        bookish = {o["id"] for o in objs if (o.get("classification") or "").lower() in ("illustrated books", "prints", "drawings")}
        cur = [c for c in cur if c in bookish]
    jobs = [(oid, k, u) for oid in cur for k, u in enumerate(det.get(str(oid), {}).get("additionalImages") or [])]
    todo = [j for j in jobs if not (ROOT / "web" / "hi" / f"{j[0]}_{j[1]}.jpg").exists()]
    if args.reverse:
        todo.reverse()
    print(f"{len(jobs) - len(todo)} done, {len(todo)} to fetch", flush=True)
    s = requests.Session()
    s.headers["User-Agent"] = "met-ink-draw/0.1 (research prototype)"
    gap, last, ok, fail = 1 / args.rps, 0.0, 0, 0
    for i, (oid, k, url) in enumerate(todo):
        if (ROOT / "web" / "hi" / f"{oid}_{k}.jpg").exists():
            continue                                     # the other copy got there first
        r = None
        for attempt in range(4):
            wait = last + gap - time.time()
            if wait > 0:
                time.sleep(wait)
            last = time.time()
            try:
                r = s.get(url, timeout=90)
            except requests.RequestException:
                time.sleep(5 * (attempt + 1)); continue
            if r.status_code in (403, 429, 503):
                gap = min(2.0, gap * 2); time.sleep(20 * (attempt + 1)); continue
            break
        if r is None or r.status_code != 200:
            fail += 1; continue
        try:
            im = Image.open(io.BytesIO(r.content)).convert("RGB")
            big = im.copy()
            f = args.max_long / max(big.size)
            if f < 1:
                big = big.resize((round(big.size[0] * f), round(big.size[1] * f)), Image.LANCZOS)
            big.save(ROOT / "web" / "hi" / f"{oid}_{k}.jpg", quality=85, optimize=True, progressive=True)
            im.thumbnail((600, 600), Image.LANCZOS)
            im.save(ROOT / "data" / "images" / f"{oid}_{k}.jpg", quality=88)
            ok += 1
        except OSError:
            fail += 1
        gap = max(1 / args.rps, gap * 0.97)
        if (i + 1) % 200 == 0:
            print(f"  {i + 1}/{len(todo)} ok={ok} fail={fail}", flush=True)
    print(f"done: ok={ok} fail={fail}", flush=True)


if __name__ == "__main__":
    main()
