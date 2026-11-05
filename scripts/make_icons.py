"""Generate the home-screen icons (a brush stroke and a red seal on paper)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

WEB = Path(__file__).resolve().parent.parent / "web"
S = 1024
im = Image.new("RGB", (S, S), (243, 238, 227))
d = ImageDraw.Draw(im)
pts = [(160 + t * 640, 640 - math.sin(t * math.pi * 1.15) * 330 + t * 60) for t in [i / 200 for i in range(201)]]
for i, (x, y) in enumerate(pts):
    r = 16 + 46 * math.sin(i / 200 * math.pi) ** 0.8
    d.ellipse((x - r, y - r, x + r, y + r), fill=(27, 25, 21))
im = im.filter(ImageFilter.GaussianBlur(2))
d = ImageDraw.Draw(im)
d.rounded_rectangle((690, 700, 850, 860), radius=14, fill=(168, 50, 42))
d.rectangle((730, 740, 810, 820), outline=(243, 238, 227), width=14)
for n in (180, 512):
    im.resize((n, n), Image.LANCZOS).save(WEB / f"icon-{n}.png")
print("icons written")
