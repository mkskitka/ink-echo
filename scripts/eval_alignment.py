"""Measure how well matched paintings line up under drawn gestures.

Drives web/lab/eval.html (the real engine) with Playwright using a fixed set of
synthetic finger gestures, then scores each returned pose against a *sharp*
reference ink map of the matched painting (web/hi/ original if downloaded, else
the web-large copy):

  follow  share of the drawn line with a painted line under it, same direction (higher = better)
  clutter ink coverage in a band around the line (lower = cleaner)
  med   median screen-px distance from the drawn line to a painted centreline
  blur  screen px per reference-image px: >3 means the close-up looks soft

Usage (server must be running on --url):
    python scripts/eval_alignment.py [--n 60] [--tag baseline] [--opts '{"k":14}']
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from skimage.morphology import skeletonize

sys.path.insert(0, str(Path(__file__).resolve().parent))
from descriptor import ink_map  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "eval"


# ---------------------------------------------------------------- gestures
def catmull(ctrl, n):
    ctrl = np.asarray(ctrl, float)
    P = np.vstack([ctrl[0], ctrl, ctrl[-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


def finger(path, rng, jitter=1.2):
    """Resample to ~2 px spacing, add low-frequency wobble + sensor jitter."""
    seg = np.hypot(*np.diff(path, axis=0).T)
    L = np.concatenate([[0], np.cumsum(seg)])
    s = np.arange(0, L[-1], 2.0)
    pts = np.stack([np.interp(s, L, path[:, 0]), np.interp(s, L, path[:, 1])], 1)
    k = max(3, len(pts) // 6)
    wob = cv2.GaussianBlur(rng.normal(0, 3.0, (len(pts), 2)).astype(np.float32), (1, 2 * k + 1), k / 2).astype(float)
    pts = pts + wob + rng.normal(0, jitter * 0.3, pts.shape)
    t0 = 0.0
    return [{"x": float(x), "y": float(y), "w": 2.6, "t": t0 + i * 8} for i, (x, y) in enumerate(pts)]


def gestures(n, seed=7):
    rng = np.random.default_rng(seed)
    kinds = ["curve", "arc", "ridge", "s", "loop", "pair", "trunk", "wave"]
    out = []
    for i in range(n):
        kind = kinds[i % len(kinds)]
        size = rng.uniform(90, 320)
        cx, cy = rng.uniform(140, 250), rng.uniform(250, 600)
        a = rng.uniform(0, 2 * math.pi)
        R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])

        def place(p):
            p = np.asarray(p, float) * size
            return p @ R.T + [cx, cy]

        strokes = []
        if kind == "curve":
            strokes.append(catmull(place(rng.uniform(-0.5, 0.5, (5, 2))), 18))
        elif kind == "arc":
            th = np.linspace(0, rng.uniform(1.5, 3.2), 50)
            strokes.append(place(np.stack([0.5 * np.cos(th), 0.5 * np.sin(th)], 1)))
        elif kind == "ridge":
            x = np.linspace(-0.5, 0.5, 7)
            y = rng.uniform(-0.25, 0.25, 7) * np.array([0, 1, 1, 1.4, 1, 1, 0])
            strokes.append(catmull(place(np.stack([x, -np.abs(y)], 1)), 12))
        elif kind == "s":
            t = np.linspace(-1, 1, 60)
            strokes.append(place(np.stack([0.5 * np.sin(t * 2.6), 0.5 * t], 1)))
        elif kind == "loop":
            th = np.linspace(0, 2 * math.pi * 0.92, 70)
            r = 0.4 + rng.uniform(-0.05, 0.05, 8)
            rr = np.interp(th, np.linspace(0, 2 * math.pi, 8), r)
            strokes.append(place(np.stack([rr * np.cos(th), 0.75 * rr * np.sin(th)], 1)))
        elif kind == "pair":
            for off in (-0.18, 0.18):
                c = rng.uniform(-0.12, 0.12, (4, 2)) + np.stack([np.linspace(-0.5, 0.5, 4), [off] * 4], 1)
                strokes.append(catmull(place(c), 14))
        elif kind == "trunk":
            strokes.append(catmull(place([[0, 0.5], [0.04, 0.1], [-0.03, -0.25], [0.02, -0.5]]), 14))
            strokes.append(catmull(place([[0.01, -0.05], [0.2, -0.2], [0.42, -0.25]]), 14))
        else:  # wave
            x = np.linspace(-0.5, 0.5, 80)
            strokes.append(place(np.stack([x, 0.12 * np.sin(x * rng.uniform(9, 16))], 1)))
        out.append({"kind": kind, "strokes": [finger(np.asarray(s), rng) for s in strokes]})
    return out


def traced(n, seed=11):
    """Oracle queries: real painted strokes (skeleton walks) from curated works,
    finger-jittered. A perfect system finds a pose with follow ~ 1."""
    rng = np.random.default_rng(seed)
    ids = json.loads((ROOT / "data" / "curated.json").read_text())
    out = []
    while len(out) < n:
        oid = str(ids[rng.integers(len(ids))])
        R = reference(oid)
        sk = R["dt"] == 0
        ys, xs = np.nonzero(sk)
        if len(ys) < 500:
            continue
        i = rng.integers(len(ys))
        path, seen = [(xs[i], ys[i])], {(xs[i], ys[i])}
        target = rng.uniform(0.06, 0.18) * min(sk.shape)
        L = 0.0
        while L < target:
            x, y = path[-1]
            nb = [(x + dx, y + dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                  if (dx or dy) and 0 <= y + dy < sk.shape[0] and 0 <= x + dx < sk.shape[1]
                  and sk[y + dy, x + dx] and (x + dx, y + dy) not in seen]
            if not nb:
                break
            if len(path) > 2:   # keep going straight-ish
                px, py = path[-1][0] - path[-3][0], path[-1][1] - path[-3][1]
                nb.sort(key=lambda q: -((q[0] - x) * px + (q[1] - y) * py))
            q = nb[0]
            seen.add(q); path.append(q); L += math.hypot(q[0] - x, q[1] - y)
        if L < target * 0.7:
            continue
        P = np.array(path, float)
        P = cv2.GaussianBlur(P.astype(np.float32).reshape(-1, 1, 2), (1, 9), 2).reshape(-1, 2).astype(float)
        size = rng.uniform(120, 300)
        P = (P - P.mean(0)) * (size / max(np.ptp(P[:, 0]), np.ptp(P[:, 1]), 1)) + [195, 420]
        out.append({"kind": "traced", "src": oid, "strokes": [finger(P, rng, 0.8)]})
    return out


# ---------------------------------------------------------------- reference maps
_ref = {}


def reference(oid):
    """Sharp reference for a work: ink, skeleton distance + nearest-skeleton
    index, and painted-line orientation (radians, along the line)."""
    if oid in _ref:
        return _ref[oid]
    hi = ROOT / "web" / "hi" / f"{oid}.jpg"
    src = hi if hi.exists() else ROOT / "data" / "images" / f"{oid}.jpg"
    with Image.open(src) as im:
        w, h = im.size
        k = min(1.0, 2400 / max(w, h))  # cap work size; still >= 2.5x web-large
        ink = ink_map(im, short_side=round(min(w, h) * k), max_long=round(max(w, h) * k))
    B = (ink >= 0.3).astype(np.uint8)
    skel = skeletonize(B > 0)
    dt, lab = cv2.distanceTransformWithLabels((~skel).astype(np.uint8), cv2.DIST_L2, 5,
                                              labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(skel)
    lut = np.zeros((lab.max() + 1, 2), np.int32)
    # labels of zero pixels are assigned in raster order
    zl = lab[ys, xs]
    lut[zl] = np.stack([ys, xs], 1)
    g = cv2.GaussianBlur(ink.astype(np.float32), (0, 0), 1.5)
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)
    sig = max(2.0, min(ink.shape) / 300)
    Jxx = cv2.GaussianBlur(gx * gx, (0, 0), sig); Jyy = cv2.GaussianBlur(gy * gy, (0, 0), sig)
    Jxy = cv2.GaussianBlur(gx * gy, (0, 0), sig)
    across = 0.5 * np.arctan2(2 * Jxy, Jxx - Jyy)        # gradient direction = across the line
    along = across + np.pi / 2
    _ref[oid] = dict(B=B, dt=dt, lab=lab, lut=lut, along=along, W=ink.shape[1], tier=src.parent.name)
    if len(_ref) > 30:
        _ref.pop(next(iter(_ref)))
    return _ref[oid]


WARP = dict(sigma=0.06, clamp=0.05, norm=1.5, smooth=3)   # == web/shared/engine.js WARP


def warp_fn(r):
    """Same field as engine.js warpField: screen point -> content shift (screen px)."""
    w = r.get("warp")
    if not w:
        return None
    w = np.asarray(w, float).reshape(-1, 4)
    n, k = len(w), WARP["smooth"]
    sm = np.array([w[max(0, i - k):i + k + 1, 2:].mean(0) for i in range(n)])
    if not np.any(sm):
        return None
    f, s2 = r["frame"], 2 * WARP["sigma"] ** 2

    def at(x, y):
        u, v = (x - f["cx"]) / f["S"], (y - f["cy"]) / f["S"]
        g = np.exp(-((u - w[:, 0]) ** 2 + (v - w[:, 1]) ** 2) / s2)
        d = (g[:, None] * sm).sum(0) / max(g.sum(), WARP["norm"])
        m = np.hypot(*d)
        if m > WARP["clamp"]:
            d *= WARP["clamp"] / m
        return d * f["S"]
    return at


def to_ref(q, r, R, warped=True):
    """Drawn points (and tangents) -> reference px, plus screen px per ref px."""
    f, p = r["frame"], r["pose"]
    u = R["W"] / r["W"]
    co, si = math.cos(p["th"]), math.sin(p["th"])
    at = warp_fn(r) if warped else None
    out = []
    for s in q["strokes"]:
        for i in range(0, len(s) - 1, 2):
            a, b = s[i], s[min(len(s) - 1, i + 2)]
            ax, ay = a["x"], a["y"]
            if at:
                dx, dy = at(ax, ay)
                ax, ay = ax + dx, ay + dy
            px, py = (ax - f["cx"]) / f["S"], (ay - f["cy"]) / f["S"]
            x = (p["cx"] + (co * px - si * py) * p["s"]) * u
            y = (p["cy"] + (si * px + co * py) * p["s"]) * u
            tx, ty = b["x"] - a["x"], b["y"] - a["y"]
            out.append((x, y, co * tx - si * ty, si * tx + co * ty))
    return np.array(out), f["S"] / (p["s"] * u)


def score(q, r):
    out = score1(q, r, True)
    if r.get("warp"):
        out["follow_rigid"] = score1(q, r, False)["follow"]
    else:
        out["follow_rigid"] = out["follow"]
    return out


def score1(q, r, warped):
    """follow: share of your line with a painted line under it (within 6 screen px)
    running the same way (within 30 deg). clutter: ink coverage in a 24 px band
    around your line (busy texture reads as noise, not as your line)."""
    R = reference(r["id"])
    H, W = R["dt"].shape
    P, spr = to_ref(q, r, R, warped)
    fol, dist = [], []
    for x, y, tx, ty in P:
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < W and 0 <= yi < H):
            fol.append(0); dist.append(99); continue
        d = R["dt"][yi, xi] * spr
        dist.append(d)
        ny, nx = R["lut"][R["lab"][yi, xi]]
        th = R["along"][ny, nx]
        ang = abs(math.atan2(ty, tx) - th) % math.pi
        ang = min(ang, math.pi - ang)
        fol.append(1 if d <= 6 and ang < math.radians(30) else 0)
    m = np.zeros((H, W), np.uint8)
    pts = np.round(P[:, :2]).astype(np.int32)
    cv2.polylines(m, [pts], False, 1, max(1, int(round(2 * 24 / spr))))
    clutter = float(R["B"][m > 0].mean()) if m.any() else 1.0
    return {"follow": float(np.mean(fol)), "med": float(np.median(dist)), "clutter": clutter,
            "blur": float(spr), "tier": R["tier"]}


def tile(q, r, size=260):
    """Posed painting (reference image) under the drawn line, as seen on screen."""
    R = reference(r["id"])
    hi = ROOT / "web" / "hi" / f"{r['id']}.jpg"
    src = hi if hi.exists() else ROOT / "data" / "images" / f"{r['id']}.jpg"
    img = np.asarray(Image.open(src).convert("RGB"))
    k = R["W"] / img.shape[1]
    f, p = r["frame"], r["pose"]
    u = R["W"] / r["W"] / k                 # ink-map px -> image px
    m = f["S"] / (p["s"] * u)               # screen px per image px
    co, si = math.cos(p["th"]), math.sin(p["th"])
    side = f["S"] * 1.5
    z = size / side
    # image px -> tile px
    a, b, c, d = m * co * z, -m * si * z, m * si * z, m * co * z
    cx, cy = p["cx"] * u, p["cy"] * u
    M = np.array([[a, c, size / 2 - (a * cx + c * cy)], [b, d, size / 2 - (b * cx + d * cy)]], np.float32)
    out = cv2.warpAffine(img, M, (size, size), flags=cv2.INTER_LINEAR, borderValue=(230, 225, 215))
    for s in q["strokes"]:
        pts = np.array([[(pt["x"] - f["cx"]) * z + size / 2, (pt["y"] - f["cy"]) * z + size / 2] for pt in s], np.int32)
        cv2.polylines(out, [pts], False, (200, 40, 40), 2, cv2.LINE_AA)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8765/lab/eval.html")
    ap.add_argument("--n", type=int, default=64)
    ap.add_argument("--tag", default="run")
    ap.add_argument("--traced", action="store_true", help="oracle queries traced from real strokes")
    ap.add_argument("--sheet", action="store_true", help="save a contact sheet of the first 24")
    ap.add_argument("--opts", default='{"k":14,"alignK":5}')
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    qs = traced(args.n) if args.traced else gestures(args.n)
    opts = json.loads(args.opts)
    rows, tiles = [], []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="msedge")
        page = b.new_page(viewport={"width": 390, "height": 844})
        page.goto(args.url + f"?t={time.time()}")
        page.wait_for_function("window.ready === true", timeout=120000)
        for i, q in enumerate(qs):
            r = page.evaluate("([s, o]) => runQuery(s, o)", [q["strokes"], opts])
            if not r:
                rows.append({"kind": q["kind"], "follow": 0, "follow_rigid": 0, "clutter": 1, "med": 99, "blur": 0, "ms": 0, "tier": "-"})
                continue
            sc = score(q, r)
            if args.sheet and len(tiles) < 24:
                tiles.append(tile(q, r))
            rows.append({"kind": q["kind"], "work": r["id"], "ms": r["ms"], "src": q.get("src"), **sc})
        b.close()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{args.tag}.json").write_text(json.dumps(rows, indent=1))
    if tiles:
        while len(tiles) % 6:
            tiles.append(np.full_like(tiles[0], 255))
        sheet = np.vstack([np.hstack(tiles[i:i + 6]) for i in range(0, len(tiles), 6)])
        Image.fromarray(sheet).save(OUT / f"{args.tag}.jpg", quality=88)
    A = lambda k: np.mean([r[k] for r in rows])  # noqa: E731
    print(f"[{args.tag}] n={len(rows)}  FOLLOW={A('follow'):.3f} (rigid {A('follow_rigid'):.3f})  clutter={A('clutter'):.3f}  med={np.median([r['med'] for r in rows]):.1f}px  "
          f"blur={np.median([r['blur'] for r in rows]):.2f}  ms={np.median([r['ms'] for r in rows]):.0f}  "
          f"hi-ref={sum(r['tier'] == 'hi' for r in rows)}")
    if args.traced:
        print(f"  found the source work: {np.mean([str(r.get('work')) == str(r.get('src')) for r in rows]):.2f}")
    by = {}
    for r in rows:
        by.setdefault(r["kind"], []).append(r["follow"])
    print("  by kind follow: " + "  ".join(f"{k}={np.mean(v):.2f}" for k, v in by.items()))


if __name__ == "__main__":
    main()
