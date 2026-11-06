// Ink Echo engine worker.
//  1. Coarse search: region HOG index (index.bin), optional *masked* scoring that
//     only compares the cells your drawing touches (a subset match, so a painting
//     isn't penalised for having strokes you didn't draw).
//  2. Fine alignment: chamfer matching of your stroke points against a painting's
//     ink map (distance transform) over zoom x position x rotation.
"use strict";

const GRID = 4, BINS = 8;
let dims = 0, n = 0, table = null, descs = null, norms = null, cellE = null;
const maps = new Map(); // work -> {W, H, dt: Float32Array}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === "load") return loadIndex(m);
    if (m.type === "coarse") return self.postMessage({ type: "coarse", id: m.id, top: coarse(m) });
    if (m.type === "ink") { addMap(m); return self.postMessage({ type: "ink", id: m.id, work: m.work }); }
    if (m.type === "align") return self.postMessage({ type: "align", id: m.id, results: align(m) });
    if (m.type === "cost") return self.postMessage({ type: "cost", id: m.id, cost: poseCost(m) });
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, error: String(err && err.stack || err) });
  }
};

// ---------------------------------------------------------------- coarse index
async function loadIndex(m) {
  const res = await fetch(m.url);
  if (!res.ok) { self.postMessage({ type: "error", id: m.id, error: `index.bin ${res.status}` }); return; }
  const buf = await res.arrayBuffer();
  dims = m.dims; n = m.regions;
  table = new Float32Array(buf, 0, n * 4);
  descs = new Uint8Array(buf, m.tableBytes, n * dims);
  norms = new Float32Array(n);
  cellE = new Float32Array(n * GRID * GRID); // squared energy per spatial cell
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < GRID * GRID; c++) {
      let e = 0;
      const o = i * dims + c * BINS;
      for (let b = 0; b < BINS; b++) e += descs[o + b] * descs[o + b];
      cellE[i * GRID * GRID + c] = e;
      s += e;
    }
    norms[i] = Math.sqrt(s) || 1;
  }
  self.postMessage({ type: "ready", id: m.id, regions: n });
}

function coarse({ desc: q, k = 10, masked = true, exclude = [] }) {
  if (!descs) return [];
  const C = GRID * GRID;
  // cells the drawing actually occupies
  const qE = new Float32Array(C);
  let qMax = 0;
  for (let c = 0; c < C; c++) {
    let e = 0;
    for (let b = 0; b < BINS; b++) e += q[c * BINS + b] ** 2;
    qE[c] = e; qMax = Math.max(qMax, e);
  }
  const cells = [];
  let qm = 0;
  for (let c = 0; c < C; c++) if (!masked || qE[c] > qMax * 0.04) { cells.push(c); qm += qE[c]; }
  qm = Math.sqrt(qm) || 1;
  const ex = new Set(exclude);
  const best = new Map();
  for (let i = 0; i < n; i++) {
    const w = table[i * 4];
    if (ex.has(w)) continue;
    let dot = 0, pm = 0;
    for (const c of cells) {
      const o = i * dims + c * BINS;
      for (let b = 0; b < BINS; b++) dot += q[c * BINS + b] * descs[o + b];
      pm += cellE[i * C + c];
    }
    if (pm <= 0) continue;
    pm = Math.sqrt(pm);
    let s = dot / (qm * pm);
    if (masked) s *= Math.pow(pm / norms[i], 0.3); // prefer regions whose ink is *where you drew*
    const cur = best.get(w);
    if (!cur || s > cur.score) best.set(w, { score: s, region: i });
  }
  return [...best.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, k).map(([work, r]) => ({
    work, score: r.score,
    crop: { x: table[r.region * 4 + 1], y: table[r.region * 4 + 2], s: table[r.region * 4 + 3] },
  }));
}

// ---------------------------------------------------------------- ink maps
function addMap({ work, W, H, data }) {
  const INF = 1e6;
  const dt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dt[i] = data[i] > 90 ? 0 : INF;
  // two-pass 3-4 chamfer distance transform
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = dt[i];
    if (x > 0) v = Math.min(v, dt[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, dt[i - W] + 3);
      if (x > 0) v = Math.min(v, dt[i - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, dt[i - W + 1] + 4);
    }
    dt[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let v = dt[i];
    if (x < W - 1) v = Math.min(v, dt[i + 1] + 3);
    if (y < H - 1) {
      v = Math.min(v, dt[i + W] + 3);
      if (x < W - 1) v = Math.min(v, dt[i + W + 1] + 4);
      if (x > 0) v = Math.min(v, dt[i + W - 1] + 4);
    }
    dt[i] = v;
  }
  let inkCount = 0;
  for (let i = 0; i < W * H; i++) { dt[i] /= 3; if (dt[i] === 0) inkCount++; }
  maps.set(work, { W, H, dt, density: inkCount / (W * H) });
}

// ---------------------------------------------------------------- chamfer cost
// pts: Float32Array [x, y, tx, ty]* in drawing-frame units (frame side = 1, centred).
// pose: {cx, cy, s, th} -- frame centre & side in ink-map pixels, rotation (rad).
function cost(map, pts, step, cx, cy, s, th, full) {
  const { W, H, dt } = map;
  const co = Math.cos(th), si = Math.sin(th);
  const Dm = Math.max(2.5, s * 0.05);
  const side = Math.max(1.6, Dm * 0.7);
  let c = 0, k = 0;
  for (let i = 0; i < pts.length; i += 4 * step) {
    k++;
    const px = pts[i], py = pts[i + 1];
    const qx = cx + (co * px - si * py) * s, qy = cy + (si * px + co * py) * s;
    const xi = Math.round(qx), yi = Math.round(qy);
    if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) { c += 1.3; continue; }
    const d = dt[yi * W + xi];
    let ci = d < Dm ? d / Dm : 1;
    if (full) {
      const tx = co * pts[i + 2] - si * pts[i + 3], ty = si * pts[i + 2] + co * pts[i + 3];
      if (d >= 1.5 && d < Dm) {
        // near (not on) a painted line: the line runs perpendicular to grad(dt);
        // your stroke should run along it.
        const gx = dt[yi * W + xi + 1] - dt[yi * W + xi - 1];
        const gy = dt[(yi + 1) * W + xi] - dt[(yi - 1) * W + xi];
        const gl = Math.hypot(gx, gy);
        if (gl > 0) ci += 0.45 * Math.abs(gx * tx + gy * ty) / gl;
      }
      // blob check: both sides of your line also inked => a wash, not a stroke
      const ax = Math.round(qx - ty * side), ay = Math.round(qy + tx * side);
      const bx = Math.round(qx + ty * side), by = Math.round(qy - tx * side);
      if (ax >= 0 && ay >= 0 && ax < W && ay < H && bx >= 0 && by >= 0 && bx < W && by < H &&
          dt[ay * W + ax] < 1 && dt[by * W + bx] < 1) ci += 0.6;
    }
    c += ci;
  }
  return c / Math.max(1, k);
}

function mirrored(pts) {
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 4) {
    out[i] = -pts[i]; out[i + 1] = pts[i + 1]; out[i + 2] = -pts[i + 2]; out[i + 3] = pts[i + 3];
  }
  return out;
}

function poseCost({ work, pts, pose }) {
  const map = maps.get(work);
  if (!map) return 9;
  return cost(map, pts, 1, pose.cx, pose.cy, pose.s, pose.th, true);
}

// ---------------------------------------------------------------- pose search
// opts: fMin/fMax (frame side as a fraction of the painting's short side),
// scales, rotations (refine), near: {cx, cy, s, th, radius} to search locally.
function align({ works, pts, opts = {} }) {
  const out = [];
  const nPts = pts.length / 4;
  const coarseStep = Math.max(1, Math.floor(nPts / 28));
  for (const work of works) {
    const map = maps.get(work);
    if (!map) continue;
    const { W, H } = map;
    const short = Math.min(W, H);
    const fMin = Math.max(opts.fMin ?? 0.25, 26 / short);
    const fMax = opts.fMax ?? 1.1;
    const nS = opts.scales ?? 6;
    const keep = [];
    const KEEP = opts.keep ?? 4; // per scale, so every zoom band competes
    let level = [];
    const push = (p) => {
      if (level.length < KEEP) { level.push(p); level.sort((a, b) => a.c - b.c); return; }
      if (p.c < level[KEEP - 1].c) { level[KEEP - 1] = p; level.sort((a, b) => a.c - b.c); }
    };
    const near = opts.near;
    for (let si = 0; si < nS; si++) {
      if (si) keep.push(...level);
      level = [];
      const f = nS === 1 ? fMax : fMin * Math.pow(fMax / fMin, si / (nS - 1));
      let s = f * short;
      if (near) s = near.s * (0.8 + 0.4 * (nS === 1 ? 0.5 : si / (nS - 1)));
      const stepPx = Math.max(1.5, s / 7);
      let x0 = Math.min(s * 0.3, W / 2), x1 = Math.max(W - s * 0.3, W / 2);
      let y0 = Math.min(s * 0.3, H / 2), y1 = Math.max(H - s * 0.3, H / 2);
      if (near) {
        x0 = Math.max(0, near.cx - near.radius); x1 = Math.min(W, near.cx + near.radius);
        y0 = Math.max(0, near.cy - near.radius); y1 = Math.min(H, near.cy + near.radius);
      }
      const th = near ? near.th : 0;
      for (let cy = y0; cy <= y1; cy += stepPx)
        for (let cx = x0; cx <= x1; cx += stepPx) {
          const c = cost(map, pts, coarseStep, cx, cy, s, th, false);
          if (level.length < KEEP || c < level[level.length - 1].c) push({ c, cx, cy, s, th, step: stepPx });
        }
    }
    keep.push(...level);
    // refine: hill-climb on full cost (zoom, position, rotation)
    const rots = opts.rotate === false ? [0] : [-0.14, -0.07, 0.07, 0.14];
    let refined = keep.map((p) => {
      let best = { ...p, c: cost(map, pts, 1, p.cx, p.cy, p.s, p.th, true) };
      for (let round = 0; round < 3; round++) {
        const d = best.step / (round + 2);
        const cands = [
          [d, 0, 1, 0], [-d, 0, 1, 0], [0, d, 1, 0], [0, -d, 1, 0],
          [0, 0, 1.08, 0], [0, 0, 0.93, 0],
          ...rots.map((r) => [0, 0, 1, r / (round + 1)]),
        ];
        for (const [dx, dy, ds, dth] of cands) {
          const q = { cx: best.cx + dx, cy: best.cy + dy, s: best.s * ds, th: best.th + dth };
          const c = cost(map, pts, 1, q.cx, q.cy, q.s, q.th, true);
          if (c < best.c) best = { ...best, ...q, c };
        }
      }
      return best;
    });
    // Discrimination: a real contour fits your drawing better than the same
    // drawing turned 90 degrees or mirrored; busy texture fits all of them equally.
    const flip = mirrored(pts);
    for (const p of refined) {
      const c90 = cost(map, pts, 1, p.cx, p.cy, p.s, p.th + Math.PI / 2, true);
      const cm = cost(map, flip, 1, p.cx, p.cy, p.s, p.th, true);
      p.disc = Math.min(c90, cm) - p.c; // > 0 is good
    }
    const zoomOf = (p) => p.s / short;
    // small preference for larger views (tiny regions fit almost anything)
    const adj = (p) => p.c - 0.8 * Math.min(0.5, p.disc) +
      0.1 * Math.log(fMax / Math.max(zoomOf(p), 1e-3)) / Math.log(fMax / fMin || 2);
    refined.sort((a, b) => adj(a) - adj(b));
    const bands = {};
    for (const p of refined) {
      const z = zoomOf(p);
      const band = z < 0.35 ? "detail" : z < 0.7 ? "passage" : "composition";
      if (!bands[band]) bands[band] = { cx: p.cx, cy: p.cy, s: p.s, th: p.th, cost: adj(p), zoom: z };
    }
    const b = refined[0];
    out.push({
      work, W, H,
      pose: { cx: b.cx, cy: b.cy, s: b.s, th: b.th },
      cost: b.c, score: 1 - adj(b), zoom: zoomOf(b), bands,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
