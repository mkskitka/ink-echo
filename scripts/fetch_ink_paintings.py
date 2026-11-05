"""Fetch public-domain ink paintings & calligraphy from The Met Collection API.

Uses /public/collection/v1.1/search (the v1 search endpoint was retired
2026-10-01). v1.1 is paginated: limit <= 500 and offset + limit <= 10,000.
The docs ask for <= 80 requests/second. In practice the API sits behind an
Imperva firewall that answers *parallel* connections with HTTP 403, so the
default is one worker at 10 req/s (~15 min for the full ~4k-work corpus).

Docs: https://metmuseum.github.io/

Usage:
    python scripts/fetch_ink_paintings.py              # everything (~4k works)
    python scripts/fetch_ink_paintings.py --max 300    # quick sample

Writes data/objects.json and caches images in data/images/<objectID>.jpg.
Re-running is incremental: cached objects/images are skipped.
"""
import argparse
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

API = "https://collectionapi.metmuseum.org/public/collection"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMAGES = DATA / "images"
ASIAN_ART = 6
PAGE = 500
SEARCH_CAP = 10_000

# (q, medium) searches to union. `medium` on the search API filters on the
# object-type facet (Paintings, Calligraphy, ...), `q` on full text.
SEARCHES = [("ink", "Paintings"), ("ink", "Calligraphy")]
CLASSIFICATIONS = {"paintings", "calligraphy"}

session = requests.Session()
session.headers["User-Agent"] = "met-ink-draw/0.1 (research prototype)"
adapter = requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=16)
session.mount("https://", adapter)


class RateLimiter:
    def __init__(self, rps):
        self.interval = 1.0 / rps
        self.lock = threading.Lock()
        self.next = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            t = max(now, self.next)
            self.next = t + self.interval
        if t > now:
            time.sleep(t - now)


limiter = RateLimiter(10)


retry_log = {}
retry_lock = threading.Lock()


def note_retry(reason):
    with retry_lock:
        retry_log[reason] = retry_log.get(reason, 0) + 1


def get(url, **params):
    for attempt in range(5):
        limiter.wait()
        try:
            r = session.get(url, params=params, timeout=30)
        except requests.RequestException as e:
            note_retry(type(e).__name__)
            time.sleep(2 ** attempt)
            continue
        if r.status_code == 404:
            return None
        if r.status_code in (403, 429, 500, 502, 503, 504):
            note_retry(f"HTTP {r.status_code} {url.split('/')[2]}")
            time.sleep(2 ** attempt)
            continue
        if "json" not in r.headers.get("Content-Type", "") and "/collection/" in url:
            note_retry("non-JSON (bot challenge?)")
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
        return r
    return None


def search_ids(q, medium):
    ids, offset = [], 0
    while offset < SEARCH_CAP:
        limit = min(PAGE, SEARCH_CAP - offset)
        r = get(f"{API}/v1.1/search", q=q, medium=medium, departmentId=ASIAN_ART,
                hasImages="true", offset=offset, limit=limit)
        if r is None:
            break
        res = r.json()
        page = res.get("objectIDs") or []
        ids.extend(page)
        offset += limit
        if len(page) < limit or offset >= res.get("total", 0):
            break
    return ids


def keep(obj):
    if not obj or not obj.get("isPublicDomain") or not obj.get("primaryImageSmall"):
        return False
    medium = (obj.get("medium") or "").lower()
    cls = (obj.get("classification") or "").lower()
    return "ink" in medium and cls in CLASSIFICATIONS


def record(obj):
    return {
        "id": obj["objectID"],
        "title": obj.get("title") or "Untitled",
        "artist": obj.get("artistDisplayName") or "",
        "culture": obj.get("culture") or "",
        "date": obj.get("objectDate") or "",
        "medium": obj.get("medium") or "",
        "classification": obj.get("classification") or "",
        "image": obj.get("primaryImageSmall"),
        "imageLarge": obj.get("primaryImage") or obj.get("primaryImageSmall"),
        "url": obj.get("objectURL") or f"https://www.metmuseum.org/art/collection/search/{obj['objectID']}",
        "credit": obj.get("creditLine") or "",
    }


def process(oid):
    r = get(f"{API}/v1/objects/{oid}")
    obj = r.json() if r is not None else None
    if not keep(obj):
        return None
    rec = record(obj)
    img = IMAGES / f"{oid}.jpg"
    if not img.exists():
        ir = get(rec["image"])
        if ir is None or not ir.content:
            return None
        img.write_bytes(ir.content)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=0, help="max works to keep (0 = all)")
    ap.add_argument("--rps", type=float, default=10, help="request rate cap (API limit is 80)")
    ap.add_argument("--workers", type=int, default=1, help=">1 tends to trigger HTTP 403s from the firewall")
    args = ap.parse_args()
    limiter.interval = 1.0 / min(args.rps, 75)

    IMAGES.mkdir(parents=True, exist_ok=True)
    out_path = DATA / "objects.json"
    kept = {o["id"]: o for o in json.loads(out_path.read_text(encoding="utf-8"))} if out_path.exists() else {}
    rejected_path = DATA / "rejected_ids.json"
    rejected = set(json.loads(rejected_path.read_text())) if rejected_path.exists() else set()

    seeds = json.loads((DATA / "seeds.json").read_text())["objectIDs"] if (DATA / "seeds.json").exists() else []
    ids = list(seeds)
    for q, medium in SEARCHES:
        found = search_ids(q, medium)
        print(f"search q={q!r} medium={medium!r}: {len(found)} ids", flush=True)
        ids.extend(found)
    ids = list(dict.fromkeys(ids))  # dedupe, keep order (seeds first)
    todo = [i for i in ids if i not in kept and i not in rejected]
    if args.max:
        todo = todo[: max(0, args.max - len(kept)) * 2]  # oversample: some get filtered out
    print(f"{len(ids)} candidates, {len(kept)} cached, {len(todo)} to fetch", flush=True)

    def save():
        (DATA / "objects.json").write_text(json.dumps(list(kept.values()), indent=1, ensure_ascii=False), encoding="utf-8")
        rejected_path.write_text(json.dumps(sorted(rejected)))

    done = 0
    with ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(process, oid): oid for oid in todo}
        for f in as_completed(futures):
            oid = futures[f]
            done += 1
            try:
                rec = f.result()
            except Exception as e:  # keep going on odd records
                print(f"  error {oid}: {e}", flush=True)
                continue
            if rec:
                kept[oid] = rec
            else:
                rejected.add(oid)
            if done % 100 == 0:
                print(f"  {done}/{len(todo)} checked, {len(kept)} kept, retries {retry_log}", flush=True)
                save()
            if args.max and len(kept) >= args.max:
                for other in futures:
                    other.cancel()
                break
    save()
    print(f"wrote {len(kept)} works -> {out_path}; retries {retry_log}", flush=True)


if __name__ == "__main__":
    main()
