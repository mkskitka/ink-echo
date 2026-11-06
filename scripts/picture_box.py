"""Find the picture area inside each photo -> data/boxes.json {id: [x0, y0, x1, y1]} (fractions).

Many works are photographed in their mounts (brocade borders, rollers, frames,
studio backdrop). The painting's own edge is the innermost long, straight,
axis-aligned edge on each side: we look for edges that run through most of the
image (present in >= 70% of bands along it) in the outer 38% of each side.
Ink outside the box is ignored for matching, and views fade out at its edge.

Usage:
    python scripts/picture_box.py [--sheet]
"""
import argparse
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent


def profile(g, axis):
    """Edge strength of straight lines running along `axis` (0: vertical lines -> per column)."""
    if axis == 0:
        d = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3))
    else:
        d = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)).T
    bands = np.array_split(d, 24, axis=0)
    bm = np.stack([b.mean(0) for b in bands])          # bands x positions
    bm = np.maximum(bm, np.roll(bm, 1, 1))              # tolerate 1 px wobble / tilt
    return np.percentile(bm, 30, axis=0)                # must be present along most of the length


def inner_edge(prof, side, frac=0.38):
    n = len(prof)
    m = int(n * frac)
    base = np.median(prof) + 1e-3
    thr = max(6 * base, 8.0)
    idx = np.arange(2, m) if side == 0 else np.arange(n - 3, n - m, -1)
    best = None
    for i in idx:                                       # walk inward, keep the innermost strong peak
        if prof[i] >= thr and prof[i] >= prof[max(0, i - 2):i + 3].max():
            best = i
    return best


def box_for(path):
    try:
        with Image.open(path) as im:
            im = im.convert("L")
            k = 900 / max(im.size)
            if k < 1:
                im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.BOX)
            g = cv2.GaussianBlur(np.asarray(im, np.float32), (0, 0), 1.0)
    except OSError:
        return None
    h, w = g.shape
    cx, cy = profile(g, 0), profile(g, 1)
    # wide formats (handscrolls, screens) have paper joins and panel seams inside:
    # along their length only trim the very ends; tall ones likewise for top/bottom
    fx = 0.10 if w / h > 1.5 else 0.38
    fy = 0.10 if h / w > 1.5 else 0.38
    x0, x1 = inner_edge(cx, 0, fx), inner_edge(cx, 1, fx)
    y0, y1 = inner_edge(cy, 0, fy), inner_edge(cy, 1, fy)
    b = [(x0 or 0) / w, (y0 or 0) / h, (x1 if x1 is not None else w) / w, (y1 if y1 is not None else h) / h]
    if (b[2] - b[0]) * (b[3] - b[1]) < 0.4 or b == [0, 0, 1, 1]:
        return None
    # pull in a hair so the edge line itself is outside
    pad = 0.006
    return [round(b[0] + pad, 4), round(b[1] + pad, 4), round(b[2] - pad, 4), round(b[3] - pad, 4)]


def job(oid):
    hi = ROOT / "web" / "hi" / f"{oid}.jpg"
    return oid, box_for(hi if hi.exists() else ROOT / "data" / "images" / f"{oid}.jpg")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()
    ids = [str(i) for i in json.loads((ROOT / "data" / "curated.json").read_text())]
    extra = [p.stem for p in (ROOT / "web" / "hi").glob("*_*.jpg")]
    with ProcessPoolExecutor() as pool:
        out = {k: v for k, v in pool.map(job, ids + extra, chunksize=16) if v}
    (ROOT / "data" / "boxes.json").write_text(json.dumps(out))
    print(f"picture boxes: {len(out)} of {len(ids) + len(extra)} images have a mount/border to trim")
    if args.sheet:
        import random
        random.seed(5)
        pick = random.sample(sorted(out), 24)
        S = Image.new("RGB", (6 * 170, 4 * 170), "white")
        from PIL import ImageDraw
        for i, k in enumerate(pick):
            src = ROOT / "data" / "images" / f"{k}.jpg"
            im = Image.open(src).convert("RGB"); im.thumbnail((166, 166))
            d = ImageDraw.Draw(im); b = out[k]
            d.rectangle([b[0] * im.width, b[1] * im.height, b[2] * im.width, b[3] * im.height], outline=(220, 30, 30), width=2)
            S.paste(im, ((i % 6) * 170, (i // 6) * 170))
        S.save(ROOT / "data" / "eval" / "boxes.jpg", quality=88)


if __name__ == "__main__":
    main()
