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

# 1. Download ink paintings + calligraphy (public domain, Asian Art dept) and their metadata.
python scripts/fetch_ink_paintings.py        # web-large copies -> data/images/
python scripts/fetch_details.py              # period, artist bio, tags, additional images -> data/details.json

# 2. Sharper sources (optional but recommended; about 5 GB + 10 GB, gitignored in web/hi/).
python scripts/fetch_originals.py            # full-resolution originals, long side <= 4096
python scripts/fetch_additional.py           # album leaves and detail photos ("views")

# 3. Curate and build.
python scripts/corpus_stats.py               # colourfulness / backdrop per image
python scripts/curate.py                     # East Asian ink works (+ their views)
python scripts/picture_box.py                # find the picture inside mounts and frames
python scripts/build_ink_maps.py             # web/ink/<id>.jpg (alignment maps)
python scripts/build_contour_index.py        # web/index.json + web/index.bin

# 4. Serve it on your Wi-Fi and open the printed URL on your iPhone/iPad.
python serve.py
```

On iOS, use Share → **Add to Home Screen** to run it full-screen like an app.

The built index and ink maps are committed, so after cloning you can go straight to
step 4. Without `web/hi/`, the app falls back to the Met's own (softer) images.

## With real ink (versions 6–10)

These simulate the brush and the paper (`web/shared/inkpaper.js`, `brush.js`):

- **Paper** (WebGL2): water wicks through a fibre field, so wet strokes feather on
  raw xuan paper; pigment rides the water more slowly and settles as the paper dries,
  darker at the drying edge. Sized paper and silk barely wick: lines stay crisp.
- **Brush**: a fixed ink load that each dab spends, so a long or fast stroke runs dry
  into *flying white* (飛白); Pencil pressure (or finger slowness) widens the line;
  **Pencil tilt** lays the side of the brush down (側鋒, side tip) for broad,
  one-edged texture strokes; holding still pools ink into the paper. Strokes can't be
  erased, as on real paper.
- **Inkwells**: thick, middle and pale ink (濃 重 淡), after "ink has five colours".
- **Brush sound**: filtered noise that follows speed and pressure, grainier when dry.
- **Colophon** (`colophon.js`): the closing pages. Your brushwork read the way a
  teacher would (pressure, speed, tip, concealed entry, flying white), then each work
  you met, shown sharp at the passage your line found, with how it was made (format,
  school, period, paper or silk), its brushwork measured from its ink and compared
  with yours, and what the hands have in common and where they differ. Teaching
  content lives in `lore.js`.

| Version | From | Idea |
|---|---|---|
| **6 · Sumi Scroll** (`v6-sumi/`) | Handscroll | The unrolling scroll, painted with real ink. A passage is laid only where a master's stroke truly continues yours (the engine checks how much of your line sits on a painted line going the same way, and skips the weakest matches). *Ink only* shows their brushwork alone on your paper; *With silk* shows their surface too. Finish → unroll → colophon. |
| **7 · Contemplation** (`v7-contemplation/`) | Bloom, meditative | Grind ink on an inkstone, paced by a breathing ring (slower circles grind better; longer grinding gives darker ink). Choose one of three works (a new three each day). The work lies faint at full resolution; trace the painter's brush and their strokes come up sharp. Quiet notes say what the brush is doing in each passage. *Move along* goes passage by passage (right to left on a handscroll) while your strokes fade like water-writing on stone. *Rest the brush* shows the whole work, then its colophon. |
| **8 · Brush Lessons** (`v8-lessons/`) | Collage, embodied | Learning by copying (臨摹): a model stroke plays in pale ink with a teacher's timing and pressure (永 and its eight principles, ensō, bamboo stalk and leaves, orchid, plum, rock); you copy it, get a reading of your mechanics, and meet a master's stroke of the same subject (filtered by Met tags). |
| **9 · Many Hands** (`v9-hands/`) | Collage | Each stroke meets a different master; a card per hand describes their brush in that passage. *Compare the hands* writes the comparison. |
| **10 · Soak** (`v10-soak/`) | Bloom | Where your line meets a painter's ink, the painting soaks up through a simulated paper along their connected strokes: feathered on xuan, crisp on silk. |

## The first experiments (versions 0–5)

The root page (`web/index.html`) is a launcher. Every version shares one engine
(`web/shared/`) and differs in how drawing and matching meet:

| Version | Idea | Why it helps the "second stroke drifts" problem |
|---|---|---|
| **1 · Lens** (`v1-lens/`) | Fits your lines at every zoom, position and slight rotation; the camera flies to the best fit. A zoom ladder offers Detail / Passage / Composition. | Subset matching (your lines must lie *on* ink, and extra painted ink isn't penalized) plus free zoom, so added strokes can find a scale where they all fit. |
| **2 · Trace** (`v2-trace/`) | First stroke anchors a painting; nearby real strokes glow as hints; strokes that land on them reveal it. Two misses → re-anchor. | Later strokes aren't re-searched globally. They're judged against the painter's strokes, so drawing becomes following. |
| **3 · Collage** (`v3-collage/`) | Every stroke is matched alone and opens a window onto a different painting, posed under that stroke. | No single painting has to contain the whole idiosyncratic drawing. |
| **4 · Handscroll** (`v4-scroll/`) | The scroll unrolls as you draw (dry, velocity-sensitive brush). Ink soaks in and fades; only the last ~3.5 s of gesture is matched. | The query is always a fresh, small gesture, never an accumulated pile. |
| **5 · Bloom** (`v5-bloom/`) | Where your line touches real ink, ink flows along the painter's connected strokes (flood fill on the ink map) and reveals the work. | The painting extends *your* mark along its own brushwork, instead of trying to match everything you drew. |
| 0 · Original (`v0-original/`) | Whole-drawing HOG match with Ghost / Reveal. | The baseline. |

### The shared engine (`web/shared/`)

- **Thin dynamic brush** (`pad.js`): Pencil pressure; finger *speed* sets width
  (fast = thin, slow = pooled ink); tapered entry and exit; optional dry-brush
  bristles.
- **Coarse search** (`engine-worker.js`): the region HOG index with *masked*
  scoring, which compares only the grid cells your drawing occupies.
- **Fine alignment**: chamfer matching of your resampled stroke points against
  each candidate's ink-map distance transform over zoom × position × rotation,
  with:
  - stroke-direction agreement;
  - a "blob" penalty, so ink washes don't count as lines;
  - a **discrimination** test: the pose must fit your drawing better than the
    same drawing rotated 90° or mirrored. Busy texture fits everything equally
    and fails it.
- **Ink maps** (`web/ink/<id>.jpg`, about 8 KB each): The Met's image server
  sends no CORS headers, so the browser can't read painting pixels. These
  same-origin stroke maps make alignment, hints and Bloom possible.

Known limits: deep zooms into very wide handscrolls look soft, because the Met's
`web-large` image is spread across the whole scroll. Straight strokes tend to find
straight mount edges.

## Stroke alignment (Nov 2026 rework)

The question that matters: when a passage appears, does a painted stroke really run
under your line? `scripts/eval_alignment.py` measures it. It drives the real engine
in a headless browser with 96 finger-like gestures (curves, arcs, ridges, loops,
pairs…) and scores each returned pose against a sharp reference of the painting:
**follow** = share of your line with a painted centreline within 6 screen px running
the same way (±30°); **clutter** = ink coverage in a band around your line.

| | follow ↑ | clutter ↓ |
|---|---|---|
| Original engine | 0.49 | 0.40 |
| Hi-res maps, mount/edge suppression, clutter + direction terms | 0.56 | 0.27 |
| + continuity term, no zoom-out bias, snap warp | 0.61 | 0.29 |
| + picture areas, 7,874 views (album leaves, details, manual pages) | 0.62 | 0.28 |
| Upper bound: gestures traced from real painted strokes | 0.67 | – |

So free gestures now come close to what the corpus can give a rigid pose. What changed:

- **Sharper data**: alignment maps built from the Met's full-resolution originals
  (320 px short side, up from 160 from a 600 px copy); views show our hi-res copies.
- **Cleaner data**: East Asian ink works only (no Indian or Tibetan painting, no
  heavily pigmented works); long straight lines erased from the ink maps (mount
  edges, frames, panel seams); the **picture area** found inside mounts and photo
  backdrops (`picture_box.py`) so brocade and borders can't attract lines, and
  displays fade out at the painting's edge.
- **More data**: the Met's *additional images* (album leaves, handscroll details,
  photographed at full resolution) are matched as views of their works.
- **Scoring** (`engine-worker.js`): distance to painted ink; **direction** against the
  painting's structure tensor; **clutter** (a line inside dense texture or a wash is
  not a match); **continuity** (walking along your line, the nearest painted point
  should walk with you: one stroke, not hops between marks); the discrimination test.
- **Snap**: robust point-to-line ICP refines the pose to sub-pixel accuracy, and the
  leftover offsets become a gentle, clamped warp (at most 5% of the drawing) so the
  painter's stroke lands exactly under yours (`view.js drawWarped`).
- **Honesty**: each result reports `follow`; the new versions show nothing rather
  than a passage that doesn't really continue your line. Passages are revealed
  wider where your line hits a painted stroke and narrower where it doesn't.
- **Speed**: 28 candidates per gesture (up from 12), refined only at the 8 best poses;
  ink maps for likely paintings are prefetched while you're still drawing.

## How matching works (coarse search)

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
  index.html            launcher
  v0-original … v10-soak/  the versions
  shared/
    engine.js, engine-worker.js   coarse search + alignment + snap (worker)
    view.js             passage rendering, warp, picture-edge fade, soft masks
    pad.js              the original thin dynamic brush (versions 1-5)
    inkpaper.js         GPU ink-on-paper simulation (and painting reveal)
    brush.js            ink load, pressure, tilt, dry brush, stroke mechanics
    brushsound.js       the sound of the brush
    lore.js             techniques, lessons, how works were made, brushwork measures
    colophon.js         the closing pages
    ui.js               inkwells, sound toggle, toasts
  lab/                  dev pages: eval.html (alignment harness), ink.html (brush lab)
  descriptor.js         JS twin of scripts/descriptor.py
  index.json/.bin       built contour index (works + views + regions + descriptors)
  ink/                  alignment ink maps
  hi/                   hi-res copies of originals and views (gitignored)
scripts/
  fetch_ink_paintings.py   Met API -> data/objects.json + data/images/
  fetch_details.py         period, artist bio, tags, additional images -> data/details.json
  fetch_originals.py, fetch_additional.py      hi-res sources -> web/hi/
  corpus_stats.py, curate.py, picture_box.py   what to use, and where the picture is
  build_ink_maps.py, build_contour_index.py    -> web/ink/, web/index.*
  descriptor.py            ink map (+ straight-edge suppression) + descriptor
  eval_alignment.py        alignment benchmark (see above)
  make_icons.py            home-screen icons
data/
  objects.json, details.json   metadata for every downloaded work
  curated.json, curated_views.json, boxes.json, corpus_stats.json   build inputs
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
  region) pairs to replace the hand-made descriptor. The eval harness and the
  traced-stroke oracle (`--traced`) are ready to measure it.
- A per-stroke non-rigid fit (each of your strokes snapped to its own painted
  stroke) would go past the 0.67 rigid ceiling, at some cost to faithfulness.
- Stroke-order-aware matching for calligraphy.
- Export: save a composite of drawing + painting. This would need CORS-enabled
  image fetches, because the canvas is currently tainted.
