"""Contour descriptor shared by the indexer and (mirrored in JS) by the web app.

Keep `descriptor()` in sync with `web/descriptor.js` -- both sides must compute
the exact same vector or matching falls apart.

Descriptor: an oriented-gradient histogram (a tiny HOG).
  1. Input is a SIZE x SIZE "ink" image in [0, 1] (1 = ink, 0 = paper).
  2. 3x3 box blur.
  3. Central-difference gradients; unsigned orientation in [0, pi).
  4. GRID x GRID spatial cells x BINS orientation bins, weighted by magnitude.
  5. L2 normalise.

`ink_map()` turns a painting into an ink image: it uses the *brightest* RGB
channel (so red seals and colored pigments read as paper, black ink as ink),
subtracts a heavily blurred background (so yellowed silk doesn't read as ink),
then stretches contrast.
"""
import numpy as np
from PIL import Image, ImageFilter

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


def ink_map(im: Image.Image, short_side: int = 256, max_long: int = 4096) -> np.ndarray:
    """Painting -> float ink map (1 = ink) at a working resolution."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    scale = short_side / min(w, h)
    if max(w, h) * scale > max_long:
        scale = max_long / max(w, h)
    rgb = rgb.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BILINEAR)
    a = np.asarray(rgb, dtype=np.float64) / 255.0
    value = a.max(axis=2)  # brightest channel: seals & color -> light
    v_img = Image.fromarray((value * 255).astype(np.uint8))
    bg = np.asarray(v_img.filter(ImageFilter.GaussianBlur(radius=min(rgb.size) / 6)),
                    dtype=np.float64) / 255.0
    ink = np.clip(bg - value, 0.0, 1.0)
    hi = np.percentile(ink, 99.5)
    return np.clip(ink / max(hi, 0.05), 0.0, 1.0)


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
