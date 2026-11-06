// Main-thread API for the engine worker + geometry helpers shared by all versions.
import { SIZE, descriptor } from "../descriptor.js";

export class Engine {
  static async create(base = "../") {
    const e = new Engine(base);
    await e._init();
    return e;
  }

  constructor(base) {
    this.base = base;
    this.worker = new Worker(new URL("./engine-worker.js", import.meta.url));
    this.pending = new Map();
    this.nextId = 1;
    this.inkLoads = new Map();   // work -> Promise
    this.ink = new Map();        // work -> {W, H, data: Uint8ClampedArray (ink 0..255)}
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.type === "error") p.reject(new Error(m.error)); else p.resolve(m);
    };
  }

  _call(msg, transfer) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer || []);
    });
  }

  async _init() {
    const res = await fetch(this.base + "index.json");
    if (!res.ok) throw new Error("index.json " + res.status);
    const meta = await res.json();
    this.works = meta.works;
    const r = await this._call({ type: "load", url: new URL(this.base + "index.bin", location.href).href,
      dims: meta.dims, regions: meta.regions, tableBytes: meta.tableBytes });
    this.regions = r.regions;
  }

  async coarse(desc, opts = {}) {
    return (await this._call({ type: "coarse", desc, ...opts })).top;
  }

  /** Sharpest image we can show for a work: our hi-res copy when built, else the Met's web-large. */
  imageURL(work) {
    const w = this.works[work];
    return w.hi ? this.base + w.hi : w.image;
  }

  /** The painting as an <img>: hi-res copy when the server has it, else the Met's. */
  loadPainting(work) {
    const w = this.works[work];
    if (!w.hi || this.noHi) return loadImage(w.image);
    return loadImage(this.base + w.hi).catch(() => { this.noHi = true; return loadImage(w.image); });
  }

  ensureInk(work) {
    if (this.inkLoads.has(work)) {          // LRU touch
      const p = this.inkLoads.get(work);
      this.inkLoads.delete(work); this.inkLoads.set(work, p);
    }
    while (this.inkLoads.size > 40) {       // the worker keeps 48; stay under it
      const old = this.inkLoads.keys().next().value;
      this.inkLoads.delete(old); this.ink.delete(old);
    }
    if (!this.inkLoads.has(work)) {
      const id = this.works[work].id;
      const p = loadImage(`${this.base}ink/${id}.jpg`).then(async (img) => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        const data = new Uint8ClampedArray(c.width * c.height);
        for (let i = 0; i < data.length; i++) data[i] = px[i * 4];
        this.ink.set(work, { W: c.width, H: c.height, data, img });
        const copy = data.slice();
        await this._call({ type: "ink", work, W: c.width, H: c.height, data: copy }, [copy.buffer]);
        return this.ink.get(work);
      });
      p.catch(() => this.inkLoads.delete(work));
      this.inkLoads.set(work, p);
    }
    return this.inkLoads.get(work);
  }

  async align(pts, works, opts = {}) {
    await Promise.all(works.map((w) => this.ensureInk(w).catch(() => null)));
    const res = (await this._call({ type: "align", works, pts, opts })).results;
    const got = new Set(res.map((r) => r.work));
    for (const w of works) if (!got.has(w)) { this.inkLoads.delete(w); this.ink.delete(w); } // evicted: reload next time
    return res;
  }

  async cost(pts, work, pose) {
    await this.ensureInk(work);
    return (await this._call({ type: "cost", work, pts, pose })).cost;
  }

  /** While a stroke is still being drawn: guess the likely paintings and start
   *  loading their ink maps, so matching at pen-up doesn't wait on the network.
   *  Throttled; safe to call on every pointer move. */
  warm(strokes, { k = 20, exclude = [], only = null } = {}) {
    const now = performance.now();
    if (this._warmBusy || now - (this._warmT || 0) < 350) return;
    const s = samplePoints(strokes);
    if (!s || s.length < 40) return;
    this._warmT = now; this._warmBusy = true;
    this.coarse(drawingDescriptor(strokes, s.frame), { k, masked: true, exclude, only })
      .then((top) => { for (const t of top.slice(0, 12)) this.ensureInk(t.work).catch(() => {}); })
      .finally(() => { this._warmBusy = false; });
  }

  /** Coarse prefilter then chamfer alignment: the standard "find me paintings" call. */
  async match(strokes, { k = 28, alignK = 6, opts = {}, include = [], exclude = [], only = null } = {}) {
    const s = samplePoints(strokes);
    if (!s) return null;
    const top = await this.coarse(drawingDescriptor(strokes, s.frame), { k: Math.max(k, 28), masked: true, exclude, only });
    const works = [...new Set([...include, ...top.map((t) => t.work)])];
    const res = await this.align(s.pts, works, opts);
    return { frame: s.frame, pts: s.pts, results: res.slice(0, alignK), coarse: top };
  }
}

// ---------------------------------------------------------------- geometry
const imageCache = new Map();
const IMAGE_CACHE = 10;     // hi-res decodes are big; iOS Safari has little memory
export function loadImage(url) {
  if (imageCache.has(url)) { const p = imageCache.get(url); imageCache.delete(url); imageCache.set(url, p); }
  while (imageCache.size >= IMAGE_CACHE) imageCache.delete(imageCache.keys().next().value);
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => { imageCache.delete(url); reject(new Error("image " + url)); };
      img.src = url;
    }));
  }
  return imageCache.get(url);
}

/** Resample strokes by arc length; returns frame (square around the drawing) and
 *  Float32Array [x, y, tx, ty]* normalised to the frame (side 1, centred). */
export function samplePoints(strokes, maxPts = 160) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0;
  for (const s of strokes) {
    const p = s.points;
    for (let i = 0; i < p.length; i++) {
      x0 = Math.min(x0, p[i].x); y0 = Math.min(y0, p[i].y);
      x1 = Math.max(x1, p[i].x); y1 = Math.max(y1, p[i].y);
      if (i) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    }
  }
  if (!isFinite(x0)) return null;
  const S = Math.max(40, Math.max(x1 - x0, y1 - y0));
  const frame = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, S };
  const spacing = Math.max(2, len / maxPts);
  const out = [];
  for (const s of strokes) {
    const p = s.points;
    if (p.length < 2) continue;
    let carry = 0;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1].x, ay = p[i - 1].y, bx = p[i].x, by = p[i].y;
      const d = Math.hypot(bx - ax, by - ay);
      if (d === 0) continue;
      const tx = (bx - ax) / d, ty = (by - ay) / d;
      let t = carry;
      while (t <= d) {
        out.push((ax + tx * t - frame.cx) / S, (ay + ty * t - frame.cy) / S, tx, ty);
        t += spacing;
      }
      carry = t - d;
    }
  }
  return { frame, pts: Float32Array.from(out), length: len };
}

/** HOG of the drawing (thin uniform line) inside a padded square around it. */
const small = document.createElement("canvas");
small.width = small.height = SIZE;
const sctx = small.getContext("2d", { willReadFrequently: true });
export function drawingDescriptor(strokes, frame) {
  const side = frame.S * 1.12;
  const k = SIZE / side;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, SIZE, SIZE);
  sctx.setTransform(k, 0, 0, k, (side / 2 - frame.cx) * k, (side / 2 - frame.cy) * k);
  sctx.strokeStyle = "#000";
  sctx.lineWidth = 1.4 / k;
  sctx.lineCap = sctx.lineJoin = "round";
  for (const s of strokes) {
    sctx.beginPath();
    s.points.forEach((p, i) => (i ? sctx.lineTo(p.x, p.y) : sctx.moveTo(p.x, p.y)));
    sctx.stroke();
  }
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;
  const ink = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < ink.length; i++) ink[i] = 1 - px[i * 4] / 255;
  return Float32Array.from(descriptor(ink));
}

/** Affine [a, b, c, d, e, f] mapping *ink-map pixel* coords to screen, so that the
 *  pose's frame lands on the drawing frame. Multiply a..d by inkW/imgW for image px. */
export function poseAffine(pose, frame) {
  const m = frame.S / pose.s;
  const co = Math.cos(pose.th), si = Math.sin(pose.th);
  const a = m * co, b = -m * si, c = m * si, d = m * co;
  return [a, b, c, d, frame.cx - (a * pose.cx + c * pose.cy), frame.cy - (b * pose.cx + d * pose.cy)];
}

export function imageAffine(pose, frame, inkW, imgW) {
  const [a, b, c, d, e, f] = poseAffine(pose, frame);
  const u = inkW / imgW;
  return [a * u, b * u, c * u, d * u, e, f];
}

// ---------------------------------------------------------------- snap warp
// The worker returns residuals [x, y, dx, dy]* (frame units): where your line is,
// and how far off the painted line lies. A smooth field built from them lets
// views bend the painting a little so the painter's stroke sits exactly under
// yours. Kept identical to scripts/eval_alignment.py (warp_at).
export const WARP = { sigma: 0.06, clamp: 0.05, norm: 1.5, smooth: 3 };

export function warpField(warp, frame) {
  if (!warp || !warp.length) return null;
  const n = warp.length / 4;
  // smooth offsets along the line (neighbouring samples), keeping zeros as anchors
  const sx = new Float32Array(n), sy = new Float32Array(n), px = new Float32Array(n), py = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let ax = 0, ay = 0, c = 0;
    for (let j = Math.max(0, i - WARP.smooth); j <= Math.min(n - 1, i + WARP.smooth); j++) {
      ax += warp[j * 4 + 2]; ay += warp[j * 4 + 3]; c++;
    }
    px[i] = warp[i * 4]; py[i] = warp[i * 4 + 1]; sx[i] = ax / c; sy[i] = ay / c;
  }
  const s2 = 2 * WARP.sigma * WARP.sigma;
  /** content shift at screen point (x, y), in screen px: show what lies at p + D(p) */
  const at = (x, y) => {
    const u = (x - frame.cx) / frame.S, v = (y - frame.cy) / frame.S;
    let gx = 0, gy = 0, gs = 0;
    for (let i = 0; i < n; i++) {
      const d2 = (u - px[i]) ** 2 + (v - py[i]) ** 2;
      if (d2 > 9 * s2) continue;
      const g = Math.exp(-d2 / s2);
      gx += g * sx[i]; gy += g * sy[i]; gs += g;
    }
    const k = 1 / Math.max(gs, WARP.norm);
    let dx = gx * k, dy = gy * k;
    const m = Math.hypot(dx, dy);
    if (m > WARP.clamp) { dx *= WARP.clamp / m; dy *= WARP.clamp / m; }
    return [dx * frame.S, dy * frame.S];
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
  for (let i = 0; i < n; i++) {
    if (sx[i] || sy[i]) any = true;
    x0 = Math.min(x0, px[i]); y0 = Math.min(y0, py[i]); x1 = Math.max(x1, px[i]); y1 = Math.max(y1, py[i]);
  }
  if (!any) return null;
  const pad = WARP.sigma * 2.5;
  const box = [frame.cx + (x0 - pad) * frame.S, frame.cy + (y0 - pad) * frame.S,
               frame.cx + (x1 + pad) * frame.S, frame.cy + (y1 + pad) * frame.S];
  return { at, box };
}

export const cssMatrix = (m) => `matrix(${m.map((v) => +v.toFixed(5)).join(",")})`;

/** Inverse map: screen point -> ink-map pixel. */
export function screenToInk(pose, frame, x, y) {
  const px = (x - frame.cx) / frame.S, py = (y - frame.cy) / frame.S;
  const co = Math.cos(pose.th), si = Math.sin(pose.th);
  return [pose.cx + (co * px - si * py) * pose.s, pose.cy + (si * px + co * py) * pose.s];
}

export function workCaption(w) {
  return { title: w.title, meta: [w.artist, w.culture, w.date].filter(Boolean).join(" · ") };
}

/** Sample strokes into an *existing* frame (e.g. a locked anchor's frame). */
export function ptsInFrame(strokes, frame, maxPts = 120) {
  const tmp = samplePoints(strokes, maxPts);
  if (!tmp) return null;
  const { pts } = tmp, f0 = tmp.frame;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 4) {
    out[i] = (pts[i] * f0.S + f0.cx - frame.cx) / frame.S;
    out[i + 1] = (pts[i + 1] * f0.S + f0.cy - frame.cy) / frame.S;
    out[i + 2] = pts[i + 2]; out[i + 3] = pts[i + 3];
  }
  return out;
}
