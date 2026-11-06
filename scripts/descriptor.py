"""Contour descriptor shared by the indexer and (mirrored in JS) by the web app.

Keep `descriptor()` in sync with `web/descriptor.js` -- both sides must compute
the exact same vector or matching falls apart.

Descriptor: an oriented-gradient histogram (a tiny HOG).
  1. Input is a SIZE x SIZE "ink" image in [0, 1] (1 = ink, 0 = paper).
  2. 3x3 box blur.
  3. Central-difference gradients; unsigned orientation in [0, pi).
  4. GRID x GRID spatial cells x BINS orientation bins, weighted by magnitude.
  5. L2 normalise.

`ink_map()` turns a painting into an ink image:
  - brightest RGB channel, so red seals and colored pigment read as paper and
    only black ink reads as ink;
  - 3x3 median to quiet silk weave;
  - black top-hat (morphological closing minus image) with a disc ~1/12 of the
    short side: keeps dark *strokes* up to that width but drops broad tonal
    areas (fan silk, mount borders, photo backgrounds) that otherwise create
    huge false contours;
  - noise floor + contrast stretch;
  - optionally (`suppress_lines`) erase long, straight, axis-aligned lines:
    mount edges, screen frames, scroll rollers and photo borders. Brushwork is
    almost never ruler-straight for a quarter of the picture, but these edges
    otherwise attract every straight-ish gesture.
"""
import cv2
import numpy as np
from PIL import Image

SIZE = 64
GRID = 4
BINS = 8
DIMS = GRID * GRID * BINS


def box_blur(img: np.ndarray) -> np.ndarray:
    p = np.pad(img, 1, mode="edge")
    h, w = img.shape
    out = np.zeros_like(img)
    for dy in range(3):
        for dx in range(3):
            out += p[dy:dy + h, dx:dx + w]
    return out / 9.0


def raw_histogram(ink: np.ndarray) -> np.ndarray:
    """Un-normalised descriptor; its norm says how much contour there is."""
    assert ink.shape == (SIZE, SIZE)
    img = box_blur(ink.astype(np.float64))
    gx = np.zeros_like(img)
    gy = np.zeros_like(img)
    gx[:, 1:-1] = img[:, 2:] - img[:, :-2]
    gy[1:-1, :] = img[2:, :] - img[:-2, :]
    mag = np.hypot(gx, gy)
    ang = np.mod(np.arctan2(gy, gx), np.pi)
    bins = np.floor(ang / np.pi * BINS + 1e-6).astype(int) % BINS  # epsilon: keep exact bin edges stable across Python/JS
    cell = np.arange(SIZE) * GRID // SIZE
    cell_idx = cell[:, None] * GRID + cell[None, :]
    hist = np.zeros(DIMS)
    np.add.at(hist, (cell_idx * BINS + bins).ravel(), mag.ravel())
    return hist


def descriptor(ink: np.ndarray) -> np.ndarray:
    hist = raw_histogram(ink)
    n = np.linalg.norm(hist)
    return hist / n if n > 0 else hist


def suppress_long_lines(ink: np.ndarray, frac: float = 0.22) -> np.ndarray:
    """Zero out long, *thin*, straight horizontal/vertical runs (mount edges,
    frames, panel seams, photo borders). Thick runs (tree trunks) are kept."""
    h, w = ink.shape
    b = (ink > 0.25).astype(np.uint8)
    b = cv2.dilate(b, np.ones((3, 3), np.uint8))           # tolerate slight photo tilt
    t = max(5, int(min(h, w) * 0.012)) + 2                  # max thickness of a "line"
    kill = np.zeros_like(b)
    m = max(4, int(min(h, w) * 0.07))
    edge = np.zeros_like(b, dtype=bool)
    edge[:m] = edge[-m:] = True
    edge[:, :m] = edge[:, -m:] = True
    for along, across in (((1, max(15, int(w * frac))), (t, 1)), ((max(15, int(h * frac)), 1), (1, t))):
        run = cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones(along, np.uint8))
        thick = cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones(across, np.uint8))
        kill |= run & (1 - thick)
        kill[edge] |= run[edge]                             # frames: any thickness near the border
    # gaps and seams that cross the whole picture (e.g. between a pair of scrolls
    # photographed side by side): any thickness, if dead straight for 90% of it
    for along in ((1, int(w * 0.9)), (int(h * 0.9), 1)):
        kill |= cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones(along, np.uint8))
    if kill.any():
        kill = cv2.dilate(kill, np.ones((5, 5), np.uint8))
        ink = ink.copy()
        ink[kill > 0] = 0.0
    return ink


def ink_map(im: Image.Image, short_side: int = 256, max_long: int = 4096, suppress_lines: bool = True) -> np.ndarray:
    """Painting -> float ink map (1 = ink) at a working resolution."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    scale = short_side / min(w, h)
    if max(w, h) * scale > max_long:
        scale = max_long / max(w, h)
    rgb = rgb.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BOX if scale < 0.5 else Image.BILINEAR)
    value = cv2.medianBlur(np.asarray(rgb).max(axis=2).astype(np.uint8), 3)
    k = max(3, (min(value.shape) // 12) | 1)
    disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    closed = cv2.morphologyEx(value, cv2.MORPH_CLOSE, disc)
    ink = (closed.astype(np.float64) - value) / 255.0
    floor = 0.035
    hi = max(np.percentile(ink, 99.5), 0.12)
    ink = np.clip((ink - floor) / (hi - floor), 0.0, 1.0)
    return suppress_long_lines(ink) if suppress_lines else ink


def crop_resize(ink: np.ndarray, x: float, y: float, s: float) -> np.ndarray:
    """Square crop (may extend past the image; outside = paper) resized to SIZE."""
    h, w = ink.shape
    xi, yi, si = int(round(x)), int(round(y)), max(1, int(round(s)))
    canvas = np.zeros((si, si), dtype=np.float32)
    x0, y0 = max(0, xi), max(0, yi)
    x1, y1 = min(w, xi + si), min(h, yi + si)
    if x1 > x0 and y1 > y0:
        canvas[y0 - yi:y1 - yi, x0 - xi:x1 - xi] = ink[y0:y1, x0:x1]
    small = Image.fromarray(canvas, mode="F").resize((SIZE, SIZE), Image.BOX)
    return np.asarray(small, dtype=np.float64)
