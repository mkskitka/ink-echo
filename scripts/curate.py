"""Choose which works the app uses -> data/curated.json (list of objectIDs).

Ink Echo is about the East Asian ink-brush tradition, so we keep works from
China, Japan and Korea, and drop the most heavily pigmented ones (where colour,
not the brush line, carries the image). Needs data/corpus_stats.json
(scripts/corpus_stats.py).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EAST_ASIA = ("china", "japan", "korea")
MAX_PIGMENT = 0.10


def main():
    objs = json.loads((ROOT / "data" / "objects.json").read_text(encoding="utf-8"))
    st = json.loads((ROOT / "data" / "corpus_stats.json").read_text())
    keep, why = [], {"culture": 0, "pigment": 0}
    for o in objs:
        c = (o.get("culture") or "").lower()
        if not any(k in c for k in EAST_ASIA):
            why["culture"] += 1
            continue
        s = st.get(str(o["id"]))
        if s and s["pigment"] > MAX_PIGMENT:
            why["pigment"] += 1
            continue
        keep.append(o["id"])
    (ROOT / "data" / "curated.json").write_text(json.dumps(keep))
    print(f"curated {len(keep)} of {len(objs)} works; dropped {why}")
    # views: the Met's additional images of curated works (album leaves, details)
    kept = set(map(str, keep))
    views, vwhy = [], {"pigment": 0, "backdrop": 0}
    for p in sorted((ROOT / "data" / "images").glob("*_*.jpg")):
        parent = p.stem.split("_")[0]
        if parent not in kept or not (ROOT / "web" / "hi" / f"{p.stem}.jpg").exists():
            continue
        s = st.get(p.stem)
        if s and s["pigment"] > MAX_PIGMENT:
            vwhy["pigment"] += 1; continue
        if s and s["backdrop"] > 0.9:      # objects photographed on a backdrop: boxes, rollers, backs
            vwhy["backdrop"] += 1; continue
        views.append(p.stem)
    (ROOT / "data" / "curated_views.json").write_text(json.dumps(views))
    print(f"views: {len(views)} additional images kept; dropped {vwhy}")


if __name__ == "__main__":
    main()
