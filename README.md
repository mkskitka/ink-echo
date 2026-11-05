# Ink Echo

Draw a line with your finger (iPhone) or Apple Pencil (iPad), and ink paintings and
calligraphy from The Met's Asian Art collection answer it. As you draw, the app finds
the **region** of a painting whose contours best match your line, and places that
painting so its contours sit on your strokes.

- **Ghost**: the matched painting fades in behind your drawing, aligned to it.
- **Reveal**: the painting appears only along your lines, as if you were painting it.
- **Plain**: only your drawing, with the matches in the strip at the bottom.
- **Lines**: shows or hides your strokes, so you can look at the painting itself.
- Tap a thumbnail to switch works. Tap the caption for details and a link to
  metmuseum.org. *Show another match* steps through the results.

All images and data come from [The Met Collection API](https://metmuseum.github.io/)
(Open Access, CC0).

## Quick start

```bash
pip install -r requirements.txt

# 1. Download ink paintings + calligraphy (public domain, Asian Art dept).
#    About 15 min for the full corpus; incremental, so it's safe to stop and resume.
python scripts/fetch_ink_paintings.py            # or: --max 300 for a quick sample

# 2. Build the contour index (writes web/index.json + web/index.bin).
python scripts/build_contour_index.py

# 3. Serve it on your Wi-Fi and open the printed URL on your iPhone/iPad.
python serve.py
```

On iOS, use Share → **Add to Home Screen** to run it full-screen like an app.

The built index is committed, so after cloning you can go straight to step 3. The
`web/` folder is a static site, so it can also be hosted on GitHub Pages.

## How matching works

```
painting ─► ink map ─► many square regions ─► 128-d contour descriptor ─┐
                                                                         ├─► cosine similarity ─► best region per work
your strokes ─► bounding square ─► 64×64 render ─► same descriptor ─────┘
```

1. **Ink map** (`scripts/descriptor.py: ink_map`): each painting uses its *brightest*
   RGB channel, so red seals and colored pigment count as paper and black ink counts
   as ink. A heavily blurred background is subtracted so yellowed silk doesn't read
   as ink.
2. **Regions** (`build_contour_index.py`): up to 24 square crops per work at two
   scales: the whole composition, then squares sliding along hanging scrolls and
   handscrolls. A drawn ridge line can therefore match one mountain in a long
   handscroll. Blank silk is skipped.
3. **Descriptor**: a small HOG, a 4×4 grid × 8 orientation bins of gradient energy
   on a 64×64 image. It is implemented twice, in `scripts/descriptor.py` and
   `web/descriptor.js`, and **the two must stay identical**. They agree to about 1e-17.
4. **Your drawing**: the square around everything you've drawn is rendered at
   64×64 and described the same way, so *where* and *how big* you draw don't
   matter, only the shape.
5. **Search** runs in a Web Worker (`web/search-worker.js`) over uint8-quantized
   descriptors. It returns the best region per work, and the app maps that region
   onto your drawing's square. A small "stickiness" margin keeps the featured
   painting from flickering while you draw.

Pencil vs. finger: Apple Pencil pressure sets line width. After the Pencil has
touched the screen once, finger touches are ignored, which acts as palm rejection.

## Repo layout

```
web/                    static app (open web/index.html via any static server)
  app.js                drawing, matching, display modes
  descriptor.js         JS twin of scripts/descriptor.py
  search-worker.js      region search off the main thread
  index.json/.bin       built contour index (works + regions + descriptors)
scripts/
  fetch_ink_paintings.py   Met API → data/objects.json + data/images/ (images gitignored)
  build_contour_index.py   images → web/index.*
  descriptor.py            ink map + descriptor
  make_icons.py            home-screen icons
data/
  objects.json          metadata for every downloaded work
  seeds.json            works that are always included (the project's reference pieces)
serve.py                LAN server for testing on a phone/tablet
```

## Met API notes (as of Nov 2026)

- `/public/collection/v1/search` was **retired on 2026-10-01**. Use
  `/public/collection/v1.1/search`, which pages with `offset`/`limit` (max 500 per
  page), and `offset + limit ≤ 10,000`.
- The documented limit is 80 req/s, but the API sits behind an Imperva firewall that
  answers **parallel** connections with HTTP 403. The fetcher therefore defaults to
  one connection at 10 req/s.
- Corpus query: `q=ink`, `departmentId=6` (Asian Art), `hasImages=true`, and
  `medium=Paintings` or `medium=Calligraphy`. It keeps public-domain works whose
  medium mentions ink.

## Ideas / next steps

- **Hugging Face dataset**:
  [`metmuseum/met-asian-art-open-access-hackathon`](https://huggingface.co/datasets/metmuseum/met-asian-art-open-access-hackathon)
  has DINOv2/SigLIP2 embeddings and precomputed nearest neighbors for the same
  objects. These could drive a "more like this" row under the contour matches. The
  dataset is gated: the local HF token needs *"read access to public gated repos"*
  turned on in its fine-grained settings.
- Learned sketch-to-image retrieval: train a small CNN on (edge map, painting
  region) pairs to replace the hand-made descriptor.
- Stroke-order-aware matching for calligraphy.
- Export: save a composite of drawing + painting. This would need CORS-enabled
  image fetches, because the canvas is currently tainted.
