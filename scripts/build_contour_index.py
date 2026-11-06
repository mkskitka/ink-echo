"""Build the contour index the web app searches.

For every cached painting we describe many square regions ("crops") at a few
scales, so a drawn contour can match one ridge line on a mountain, a single
character in a calligraphy scroll, or the whole composition.

Outputs (in web/):
  index.json  works metadata + layout of the binary file
  index.bin   [Float32 N x 4 crop table: work, x, y, s] [Uint8 N x DIMS descriptors]
Crop coordinates are fractions of the image *width* (y and s too), so the
app can position any rendition of the image.

Usage:
    python scripts/build_contour_index.py [--per-work 24]
"""
import argparse
import json
import math
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from descriptor import BINS, DIMS, GRID, SIZE, crop_resize, ink_map, raw_histogram

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WEB = ROOT / "web"
MIN_ENERGY = 1.5  # skip crops that are basically blank silk/paper


def crop_boxes(w, h, per_work):
    short, long_ = min(w, h), max(w, h)
    boxes = []
    if long_ / short <= 2.2:  # whole composition, padded to square
        boxes.append(((w - long_) / 2, (h - long_) / 2, long_))
    for frac in (1.0, 0.5, 0.3):
        s = short * frac
        nx = max(1, math.ceil((w - s) / (s / 2)) + 1)
        ny = max(1, math.ceil((h - s) / (s / 2)) + 1)
        xs = np.linspace(0, w - s, nx) if nx > 1 else [(w - s) / 2]
        ys = np.linspace(0, h - s, ny) if ny > 1 else [(h - s) / 2]
        level = [(x, y, s) for y in ys for x in xs]
        budget = {1.0: max(1, per_work // 3), 0.5: per_work // 3}.get(frac, per_work - len(boxes))
        if len(level) > budget > 0:
            pick = np.linspace(0, len(level) - 1, budget).round().astype(int)
            level = [level[i] for i in pick]
        boxes.extend(level)
    return boxes[:per_work]


def describe(args):
    path, per_work, box = args
    try:
        with Image.open(path) as im:
            ink = ink_map(im)
    except OSError:
        return None
    h, w = ink.shape
    bx0, by0, bx1, by1 = (box or [0, 0, 1, 1])
    ox, oy = bx0 * w, by0 * h
    ink = ink.copy()
    m = np.zeros_like(ink); m[int(by0 * h):int(np.ceil(by1 * h)), int(bx0 * w):int(np.ceil(bx1 * w))] = 1; ink *= m
    out = []
    for x, y, s in crop_boxes((bx1 - bx0) * w, (by1 - by0) * h, per_work):
        x, y = x + ox, y + oy
        hist = raw_histogram(crop_resize(ink, x, y, s))
        n = np.linalg.norm(hist)
        if n < MIN_ENERGY:
            continue
        d = hist / n
        q = np.round(d / d.max() * 255).astype(np.uint8)
        out.append(((x / w, y / w, s / w), q))
    return {"aspect": h / w, "crops": out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-work", type=int, default=32, help="max regions per painting")
    args = ap.parse_args()

    objects = json.loads((DATA / "objects.json").read_text(encoding="utf-8"))
    curated = set(json.loads((DATA / "curated.json").read_text()))
    objects = [o for o in objects if o["id"] in curated and (DATA / "images" / f"{o['id']}.jpg").exists()]
    # views: each additional image (album leaf, detail) is matched on its own,
    # carrying its parent's metadata
    vp = DATA / "curated_views.json"
    det_all = json.loads((DATA / "details.json").read_text(encoding="utf-8")) if (DATA / "details.json").exists() else {}
    by_id = {str(o["id"]): o for o in objects}
    for v in (json.loads(vp.read_text()) if vp.exists() else []):
        pid, k = v.split("_")
        par = by_id.get(pid)
        urls = det_all.get(pid, {}).get("additionalImages") or []
        if not par or int(k) >= len(urls):
            continue
        objects.append(par | {"id": v, "parent": par["id"], "view": int(k) + 1,
                              "image": urls[int(k)].replace("/original/", "/web-large/"), "imageLarge": urls[int(k)]})
    hi = lambda o: WEB / "hi" / f"{o['id']}.jpg"  # noqa: E731
    boxes = json.loads((DATA / "boxes.json").read_text()) if (DATA / "boxes.json").exists() else {}
    jobs = [(hi(o) if hi(o).exists() else DATA / "images" / f"{o['id']}.jpg", args.per_work, boxes.get(str(o["id"]))) for o in objects]

    det_path = DATA / "details.json"
    det = json.loads(det_path.read_text(encoding="utf-8")) if det_path.exists() else {}

    def extra(o):
        d = det.get(str(o.get("parent", o["id"])), {})
        e = {"period": d.get("period") or d.get("dynasty") or "", "artistBio": d.get("artistDisplayBio") or "",
             "dims": (d.get("dimensions") or "").splitlines()[0][:90] if d.get("dimensions") else "", "tags": (d.get("tags") or [])[:8]}
        return {k: v for k, v in e.items() if v}

    works, table, descs = [], [], []
    with ProcessPoolExecutor() as pool:
        for o, res in zip(objects, pool.map(describe, jobs, chunksize=8)):
            if not res or not res["crops"]:
                continue
            wi = len(works)
            works.append({k: o[k] for k in ("id", "title", "artist", "culture", "date",
                                            "medium", "classification", "image", "imageLarge", "url")}
                         | ({"parent": o["parent"], "view": o["view"]} if "parent" in o else {})
                         | {"aspect": round(res["aspect"], 5)}
                         | ({"hi": f"hi/{o['id']}.jpg"} if hi(o).exists() else {}) | extra(o)
                         | ({"box": boxes[str(o["id"])]} if str(o["id"]) in boxes else {}))
            for (x, y, s), q in res["crops"]:
                table.append((wi, x, y, s))
                descs.append(q)
            if len(works) % 250 == 0:
                print(f"  {len(works)} works, {len(table)} regions", flush=True)

    n = len(table)
    table_bytes = np.asarray(table, dtype=np.float32).tobytes()
    (WEB / "index.bin").write_bytes(table_bytes + np.asarray(descs, dtype=np.uint8).tobytes())
    (WEB / "index.json").write_text(json.dumps({
        "version": 2, "size": SIZE, "grid": GRID, "bins": BINS, "dims": DIMS,
        "regions": n, "tableBytes": len(table_bytes), "works": works,
    }, ensure_ascii=False), encoding="utf-8")
    mb = (len(table_bytes) + n * DIMS) / 1e6
    print(f"indexed {len(works)} works / {n} regions -> web/index.bin ({mb:.1f} MB)")


if __name__ == "__main__":
    main()
