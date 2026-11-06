"""Fetch richer metadata for every work in data/objects.json -> data/details.json.

Adds what the app needs for its closing "colophon" (period, dynasty, artist bio,
dimensions, tags) and the list of *additional images*: individual album leaves
and close-up detail photos of handscroll passages, which make sharper and more
varied passages for matching.

Usage:
    python scripts/fetch_details.py [--rps 6]
"""
import argparse
import json
from pathlib import Path

import fetch_ink_paintings as met

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "details.json"
FIELDS = ("period", "dynasty", "reign", "objectBeginDate", "objectEndDate", "artistDisplayBio",
          "artistNationality", "dimensions", "objectName", "creditLine", "additionalImages", "accessionYear")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rps", type=float, default=6)
    args = ap.parse_args()
    met.limiter.set_rate(args.rps)
    objs = json.loads((ROOT / "data" / "objects.json").read_text(encoding="utf-8"))
    done = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    todo = [o["id"] for o in objs if str(o["id"]) not in done]
    print(f"{len(done)} cached, {len(todo)} to fetch", flush=True)
    for i, oid in enumerate(todo):
        try:
            r = met.get(f"{met.API}/v1/objects/{oid}")
        except met.Throttled:
            continue
        if r is None:
            continue
        o = r.json()
        rec = {k: o.get(k) for k in FIELDS}
        rec["tags"] = [t.get("term") for t in (o.get("tags") or []) if t.get("term")]
        done[str(oid)] = rec
        if (i + 1) % 200 == 0:
            OUT.write_text(json.dumps(done, ensure_ascii=False), encoding="utf-8")
            print(f"  {i + 1}/{len(todo)}", flush=True)
    OUT.write_text(json.dumps(done, ensure_ascii=False), encoding="utf-8")
    n_add = sum(len(v.get("additionalImages") or []) for v in done.values())
    print(f"done: {len(done)} works, {n_add} additional images", flush=True)


if __name__ == "__main__":
    main()
