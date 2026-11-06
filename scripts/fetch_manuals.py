"""Add brush-teaching sources and ink drawings to the corpus.

  - The Mustard Seed Garden Painting Manual (芥子園畫傳, 1679 and later editions):
    the stroke-by-stroke manual Brush Lessons follows. Many pages, as additional images.
  - Hokusai's sketchbooks (Hokusai Manga) and other painting manuals (gafu).
  - Ink drawings and sketches in the Asian Art department.

Appends to data/objects.json and data/details.json (with additionalImages), and
saves web-large copies to data/images/ and originals to web/hi/. Then run
fetch_additional.py again for the pages, and the curate/build steps.

Usage:
    python scripts/fetch_manuals.py
"""
import io
import json
from pathlib import Path

from PIL import Image

import fetch_ink_paintings as met

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
QUERIES = [  # (q, medium facet or None, title must contain one of)
    ("Mustard Seed Garden", None, ("mustard seed",)),
    ("painting manual", None, ("manual", "gafu", "画譜", "畫譜")),
    ("Hokusai sketchbook", None, ("sketchbook", "manga", "漫画")),
    ("Hokusai manga", None, ("sketchbook", "manga", "漫画")),
    ("ink", "Drawings", ()),
]
CLASSES = {"illustrated books", "prints", "drawings", "paintings"}


def main():
    met.limiter.set_rate(4)
    objs = json.loads((DATA / "objects.json").read_text(encoding="utf-8"))
    have = {o["id"] for o in objs}
    det = json.loads((DATA / "details.json").read_text(encoding="utf-8"))
    ids = []
    for q, medium, must in QUERIES:
        params = dict(q=q, departmentId=6, hasImages="true", offset=0, limit=500)
        if medium:
            params["medium"] = medium
        r = met.get(f"{met.API}/v1.1/search", **params)
        found = (r.json().get("objectIDs") or []) if r is not None else []
        print(f"{q!r} {medium or ''}: {len(found)}", flush=True)
        ids += [(i, must) for i in found]
    added = 0
    for oid, must in ids:
        if oid in have:
            continue
        r = met.get(f"{met.API}/v1/objects/{oid}")
        o = r.json() if r is not None else None
        if not o or not o.get("isPublicDomain") or not o.get("primaryImageSmall"):
            continue
        if (o.get("classification") or "").lower() not in CLASSES or "ink" not in (o.get("medium") or "").lower():
            continue
        if must and not any(m in (o.get("title") or "").lower() for m in must):
            continue
        rec = met.record(o)
        try:
            ir = met.get(rec["image"])
            (DATA / "images" / f"{oid}.jpg").write_bytes(ir.content)
            big = met.get(rec["imageLarge"])
            im = Image.open(io.BytesIO(big.content)).convert("RGB")
            k = 4096 / max(im.size)
            if k < 1:
                im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
            im.save(ROOT / "web" / "hi" / f"{oid}.jpg", quality=86, optimize=True, progressive=True)
        except Exception as e:  # noqa: BLE001
            print("  image failed", oid, e, flush=True)
            continue
        objs.append(rec); have.add(oid)
        det[str(oid)] = {k: o.get(k) for k in ("period", "dynasty", "reign", "objectBeginDate", "objectEndDate",
                                                "artistDisplayBio", "artistNationality", "dimensions", "objectName",
                                                "creditLine", "additionalImages", "accessionYear")}
        det[str(oid)]["tags"] = [t.get("term") for t in (o.get("tags") or []) if t.get("term")]
        added += 1
        print(f"  + {oid} {rec['classification']}: {rec['title'][:60]} ({len(o.get('additionalImages') or [])} pages)", flush=True)
    (DATA / "objects.json").write_text(json.dumps(objs, indent=1, ensure_ascii=False), encoding="utf-8")
    (DATA / "details.json").write_text(json.dumps(det, ensure_ascii=False), encoding="utf-8")
    print(f"added {added} works", flush=True)


if __name__ == "__main__":
    main()
