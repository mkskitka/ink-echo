"""Per-work image statistics used to curate the corpus (data/corpus_stats.json):
colorfulness (Hasler & Suesstrunk), and how much of the frame is studio backdrop."""
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def stats(oid):
    try:
        im = np.asarray(Image.open(ROOT / "data" / "images" / f"{oid}.jpg").convert("RGB")).astype(np.float32)
    except OSError:
        return oid, None
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    rg, yb = r - g, 0.5 * (r + g) - b
    colorful = float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean()))
    # saturated, non-paper-ish pixels: blue/green/strong-red pigment
    mx, mn = im.max(2), im.min(2)
    sat = (mx - mn) / np.maximum(mx, 1)
    hue_blue_green = (sat > 0.25) & ((g > r + 10) | (b > r + 10))
    # backdrop: border pixels that are neutral gray/black (studio) rather than paper
    border = np.concatenate([im[:6].reshape(-1, 3), im[-6:].reshape(-1, 3), im[:, :6].reshape(-1, 3), im[:, -6:].reshape(-1, 3)])
    bmx, bmn = border.max(1), border.min(1)
    neutral = ((bmx - bmn) < 12) & ((bmx < 110) | (bmx > 225))
    return oid, {"colorful": round(colorful, 1), "pigment": round(float(hue_blue_green.mean()), 3),
                 "backdrop": round(float(neutral.mean()), 3)}


if __name__ == "__main__":
    objs = json.loads((ROOT / "data" / "objects.json").read_text(encoding="utf-8"))
    path = ROOT / "data" / "corpus_stats.json"
    out = json.loads(path.read_text()) if path.exists() else {}
    ids = [str(o["id"]) for o in objs] + [p.stem for p in (ROOT / "data" / "images").glob("*_*.jpg")]
    ids = [i for i in ids if i not in out]
    with ProcessPoolExecutor() as pool:
        out.update({str(oid): s for oid, s in pool.map(stats, ids, chunksize=32) if s})
    (ROOT / "data" / "corpus_stats.json").write_text(json.dumps(out))
    c = np.array([v["colorful"] for v in out.values()]); p = np.array([v["pigment"] for v in out.values()]); bd = np.array([v["backdrop"] for v in out.values()])
    print("colorful pct 50/75/90/95:", np.percentile(c, [50, 75, 90, 95]).round(1))
    print("pigment  pct 50/75/90/95:", np.percentile(p, [50, 75, 90, 95]).round(3))
    print("backdrop >0.5:", (bd > 0.5).sum(), " >0.8:", (bd > 0.8).sum())
