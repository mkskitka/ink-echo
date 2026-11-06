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

  ensureInk(work) {
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
    return (await this._call({ type: "align", works, pts, opts })).results;
  }

  async cost(pts, work, pose) {
    await this.ensureInk(work);
    return (await this._call({ type: "cost", work, pts, pose })).cost;
  }

  /** Coarse prefilter then chamfer alignment: the standard "find me paintings" call. */
  async match(strokes, { k = 12, alignK = 6, opts = {}, include = [], exclude = [] } = {}) {
    const s = samplePoints(strokes);
    if (!s) return null;
    const top = await this.coarse(drawingDescriptor(strokes, s.frame), { k, masked: true, exclude });
    const works = [...new Set([...include, ...top.map((t) => t.work)])];
    const res = await this.align(s.pts, works, opts);
    return { frame: s.frame, pts: s.pts, results: res.slice(0, alignK), coarse: top };
  }
}

// ---------------------------------------------------------------- geometry
const imageCache = new Map();
export function loadImage(url) {
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
