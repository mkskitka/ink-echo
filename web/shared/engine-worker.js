// Ink Echo engine worker.
//  1. Coarse search: region HOG index (index.bin), optional *masked* scoring that
//     only compares the cells your drawing touches (a subset match, so a painting
//     isn't penalised for having strokes you didn't draw).
//  2. Fine alignment: chamfer matching of your stroke points against a painting's
//     ink map over zoom x position x rotation, scored for
//       - distance to painted ink,
//       - direction: the painted line must run the way you drew (structure tensor),
//       - cleanliness: a line inside dense texture or a wash is not a match,
//       - discrimination: the pose must beat the same drawing turned or mirrored.
//  3. Snap: a few rounds of robust point-to-line fitting (ICP, similarity
//     transform) tighten the pose to sub-pixel accuracy, and the leftover
//     residuals are returned as a gentle warp field for display.
"use strict";

const GRID = 4, BINS = 8;
const INK_T = 90;          // ink-map value (0..255) that counts as a painted line
const MAX_MAPS = 48;       // LRU cap: ink maps are a few MB each once expanded
let dims = 0, n = 0, table = null, descs = null, norms = null, cellE = null, allow = null;
const maps = new Map(); // work -> map (insertion order = LRU order)

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === "load") return loadIndex(m);
    if (m.type === "coarse") return self.postMessage({ type: "coarse", id: m.id, top: coarse(m) });
    if (m.type === "ink") { addMap(m); return self.postMessage({ type: "ink", id: m.id, work: m.work }); }
    if (m.type === "align") return self.postMessage({ type: "align", id: m.id, results: align(m) });
    if (m.type === "cost") return self.postMessage({ type: "cost", id: m.id, cost: poseCost(m) });
    if (m.type === "has") return self.postMessage({ type: "has", id: m.id, has: maps.has(m.work) });
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

function coarse({ desc: q, k = 10, masked = true, exclude = [], only = null }) {
  if (!descs) return [];
  const C = GRID * GRID;
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
  const onlySet = only ? new Set(only) : null;
  const best = new Map();
  for (let i = 0; i < n; i++) {
    const w = table[i * 4];
    if (ex.has(w) || (onlySet && !onlySet.has(w))) continue;
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
function boxPass(src, out, W, H, r, horiz) {
  // running-sum box filter along one axis, clamped edges
  const len = horiz ? W : H, lines = horiz ? H : W, stride = horiz ? 1 : W, jump = horiz ? W : 1;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const o = l * jump;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[o + Math.min(len - 1, Math.max(0, i)) * stride];
    for (let i = 0; i < len; i++) {
      out[o + i * stride] = acc * inv;
      acc += src[o + Math.min(len - 1, i + r + 1) * stride] - src[o + Math.max(0, i - r) * stride];
    }
  }
}
/** ~Gaussian blur: two box passes per axis (fast at any radius). */
function blur(src, W, H, sigma) {
  const r = Math.max(1, Math.round(sigma * 0.9));
  const a = new Float32Array(W * H), b = new Float32Array(W * H);
  boxPass(src, a, W, H, r, true); boxPass(a, b, W, H, r, true);
  boxPass(b, a, W, H, r, false); boxPass(a, b, W, H, r, false);
  return b;
}

function addMap({ work, W, H, data }) {
  const INF = 1e6;
  const N = W * H;
  const dt = new Float32Array(N);
  for (let i = 0; i < N; i++) dt[i] = data[i] > INK_T ? 0 : INF;
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
  for (let i = 0; i < N; i++) { dt[i] /= 3; if (dt[i] === 0) inkCount++; }
  // integral image of binary ink: O(1) local density at any radius
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += data[y * W + x] > INK_T ? 1 : 0;
      integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row;
    }
  }
  // painted-line direction: structure tensor of the (lightly blurred) ink
  const f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = data[i] / 255;
  const g = blur(f, W, H, 1.0);
  const jxx = new Float32Array(N), jyy = new Float32Array(N), jxy = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = g[i + 1] - g[i - 1], gy = g[i + W] - g[i - W];
    jxx[i] = gx * gx; jyy[i] = gy * gy; jxy[i] = gx * gy;
  }
  const sig = Math.max(1.5, Math.min(W, H) / 160);
  const bxx = blur(jxx, W, H, sig), byy = blur(jyy, W, H, sig), bxy = blur(jxy, W, H, sig);
  // store (cos 2a, sin 2a) of the *along-line* angle, scaled by coherence
  const ori = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const a = bxx[i] - byy[i], b = 2 * bxy[i];
    const tr = bxx[i] + byy[i];
    if (tr < 1e-6) continue;
    const coh = Math.hypot(a, b) / tr; // 0 isotropic .. 1 a clean line
    // gradient-direction double angle is (a, b); along-line is rotated by 90 deg -> negate
    const l = Math.hypot(a, b) || 1;
    ori[i * 2] = -(a / l) * coh; ori[i * 2 + 1] = -(b / l) * coh;
  }
  if (maps.has(work)) maps.delete(work);
  maps.set(work, { W, H, dt, integ, ori, ink: data, density: inkCount / N });
  while (maps.size > MAX_MAPS) maps.delete(maps.keys().next().value);
}

function touch(work) {
  const m = maps.get(work);
  if (m) { maps.delete(work); maps.set(work, m); }
  return m;
}

function density(map, x, y, r) {
  const { W, H, integ } = map;
  const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
  const x1 = Math.min(W, Math.round(x + r) + 1), y1 = Math.min(H, Math.round(y + r) + 1);
  const area = (x1 - x0) * (y1 - y0);
  if (area <= 0) return 0;
  const W1 = W + 1;
  return (integ[y1 * W1 + x1] - integ[y0 * W1 + x1] - integ[y1 * W1 + x0] + integ[y0 * W1 + x0]) / area;
}

// ---------------------------------------------------------------- chamfer cost
// pts: Float32Array [x, y, tx, ty]* in drawing-frame units (frame side = 1, centred).
// pose: {cx, cy, s, th} -- frame centre & side in ink-map pixels, rotation (rad).
const W_DIR = 0.55, W_CLUT = 1.1, W_BLOB = 0.5, W_CONT = 0.6;
let ZOOM_BIAS = 0; // set from opts
function cost(map, pts, step, cx, cy, s, th, full) {
  const { W, H, dt, ori, ink } = map;
  let lnx = NaN, lny = NaN, lqx = 0, lqy = 0;
  const co = Math.cos(th), si = Math.sin(th);
  const Dm = Math.max(2.2, s * 0.035);
  const side = Math.max(1.6, Dm * 0.7);
  const rD = Math.max(2, s * 0.05);                 // clutter radius
  let c = 0, k = 0;
  for (let i = 0; i < pts.length; i += 4 * step) {
    k++;
    const px = pts[i], py = pts[i + 1];
    const qx = cx + (co * px - si * py) * s, qy = cy + (si * px + co * py) * s;
    const xi = Math.round(qx), yi = Math.round(qy);
    if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) { c += 1.6; continue; }
    const j = yi * W + xi;
    const d = dt[j];
    let ci = d < Dm ? d / Dm : 1;
    // a clean line has low ink density around it; texture and washes don't
    const dens = density(map, qx, qy, rD);
    ci += W_CLUT * Math.max(0, dens - 0.32);
    if (full && d < Dm) {
      // direction: |cos| between your tangent and the painted line, weighted by coherence
      const tx = co * pts[i + 2] - si * pts[i + 3], ty = si * pts[i + 2] + co * pts[i + 3];
      const c2 = tx * tx - ty * ty, s2 = 2 * tx * ty;      // double angle of your tangent
      const oc = ori[j * 2], os = ori[j * 2 + 1];
      const coh = Math.hypot(oc, os);
      // agreement in [-1, 1] on double angles -> 0 (same way) .. 1 (perpendicular)
      if (coh > 0.05) ci += W_DIR * coh * (1 - (c2 * oc + s2 * os) / coh) / 2;
      else ci += W_DIR * 0.35;                              // no clear line direction
      // blob check: both sides of your line also inked => a wash, not a stroke
      const ax = Math.round(qx - ty * side), ay = Math.round(qy + tx * side);
      const bx = Math.round(qx + ty * side), by = Math.round(qy - tx * side);
      if (ax >= 0 && ay >= 0 && ax < W && ay < H && bx >= 0 && by >= 0 && bx < W && by < H &&
          ink[ay * W + ax] > INK_T && ink[by * W + bx] > INK_T) ci += W_BLOB;
    }
    if (full) {
      // continuity: walking along your line, the nearest painted point should walk
      // with you -- one stroke under your stroke, not hops between unrelated marks
      let nx = qx, ny = qy;
      if (d > 0 && d < Dm * 1.5) {
        const gx = dt[j + 1] - dt[j - 1], gy = dt[j + W] - dt[j - W], gl = Math.hypot(gx, gy);
        if (gl > 0) { nx = qx - (gx / gl) * d; ny = qy - (gy / gl) * d; }
      }
      if (d < Dm * 1.5) {
        if (lnx === lnx) {
          const step = Math.hypot(qx - lqx, qy - lqy);
          const jump = Math.abs(Math.hypot(nx - lnx, ny - lny) - step);
          ci += W_CONT * Math.min(1, jump / Dm);
        }
        lnx = nx; lny = ny;
      } else lnx = NaN;
      lqx = qx; lqy = qy;
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
  const map = touch(work);
  if (!map) return 9;
  return cost(map, pts, 1, pose.cx, pose.cy, pose.s, pose.th, true);
}

// ---------------------------------------------------------------- snap (ICP)
/** Nearest painted-line point to (qx, qy): walk down the distance field. */
function nearestInk(map, qx, qy) {
  const { W, H, dt } = map;
  let x = qx, y = qy;
  for (let it = 0; it < 4; it++) {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) return null;
    const j = yi * W + xi;
    const d = dt[j];
    if (d === 0) return [x, y, Math.hypot(x - qx, y - qy)];
    const gx = (dt[j + 1] - dt[j - 1]) / 2, gy = (dt[j + W] - dt[j - W]) / 2;
    const gl = Math.hypot(gx, gy);
    if (gl < 1e-3) return null;
    x -= (gx / gl) * d; y -= (gy / gl) * d;
  }
  return [x, y, Math.hypot(x - qx, y - qy)];
}

/** Robust similarity fit of your points onto the nearest painted line. */
function snap(map, pts, p) {
  let best = { ...p, c: cost(map, pts, 1, p.cx, p.cy, p.s, p.th, true) };
  for (let it = 0; it < 6; it++) {
    const co = Math.cos(best.th), si = Math.sin(best.th);
    const Dm = Math.max(2.2, best.s * 0.035) * 1.6;
    let sw = 0, ux = 0, uy = 0, vx = 0, vy = 0;
    const U = [], V = [], Wt = [];
    for (let i = 0; i < pts.length; i += 4) {
      const qx = best.cx + (co * pts[i] - si * pts[i + 1]) * best.s;
      const qy = best.cy + (si * pts[i] + co * pts[i + 1]) * best.s;
      const nb = nearestInk(map, qx, qy);
      if (!nb || nb[2] > Dm) continue;
      const w = 1 - (nb[2] / Dm) ** 2;               // Tukey-ish
      U.push(pts[i], pts[i + 1]); V.push(nb[0], nb[1]); Wt.push(w);
      sw += w; ux += w * pts[i]; uy += w * pts[i + 1]; vx += w * nb[0]; vy += w * nb[1];
    }
    if (Wt.length < 8 || sw < 4) break;
    ux /= sw; uy /= sw; vx /= sw; vy /= sw;
    let A = 0, B = 0, UU = 0;
    for (let k = 0; k < Wt.length; k++) {
      const ax = U[2 * k] - ux, ay = U[2 * k + 1] - uy, bx = V[2 * k] - vx, by = V[2 * k + 1] - vy;
      A += Wt[k] * (ax * bx + ay * by); B += Wt[k] * (ax * by - ay * bx); UU += Wt[k] * (ax * ax + ay * ay);
    }
    if (UU < 1e-9) break;
    const th = Math.atan2(B, A);
    let s = Math.hypot(A, B) / UU;
    s = Math.min(best.s * 1.15, Math.max(best.s * 0.87, s));   // small steps only
    const dth = Math.max(-0.12, Math.min(0.12, th - best.th));
    const th2 = best.th + dth;
    const c2 = Math.cos(th2), s2 = Math.sin(th2);
    const q = { cx: vx - (c2 * ux - s2 * uy) * s, cy: vy - (s2 * ux + c2 * uy) * s, s, th: th2 };
    const c = cost(map, pts, 1, q.cx, q.cy, q.s, q.th, true);
    if (c < best.c - 1e-4) best = { ...best, ...q, c }; else break;
  }
  return best;
}

/** Leftover offsets between your line and the painted line, in frame units:
 *  [x, y, dx, dy]*. The view bends the painting by these (smoothly) so the
 *  painter's stroke sits exactly under yours. */
function residuals(map, pts, p) {
  const co = Math.cos(p.th), si = Math.sin(p.th);
  const Dm = Math.max(2.2, p.s * 0.035) * 1.3;
  const out = [];
  const hits = [];
  const step = Math.max(1, Math.floor(pts.length / 4 / 90));
  for (let i = 0; i < pts.length; i += 4 * step) {
    const qx = p.cx + (co * pts[i] - si * pts[i + 1]) * p.s;
    const qy = p.cy + (si * pts[i] + co * pts[i + 1]) * p.s;
    const nb = nearestInk(map, qx, qy);
    if (!nb || nb[2] > Dm) { out.push(pts[i], pts[i + 1], 0, 0); hits.push(0); continue; }
    if (nb[2] < 0.3) { out.push(pts[i], pts[i + 1], 0, 0); hits.push(1); continue; }
    // direction agreement at the painted point
    const j = Math.round(nb[1]) * map.W + Math.round(nb[0]);
    const tx = co * pts[i + 2] - si * pts[i + 3], ty = si * pts[i + 2] + co * pts[i + 3];
    const oc = map.ori[j * 2], os = map.ori[j * 2 + 1], coh = Math.hypot(oc, os);
    const agree = coh > 0.1 ? ((tx * tx - ty * ty) * oc + 2 * tx * ty * os) / coh : 0;
    if (agree < 0.5) { out.push(pts[i], pts[i + 1], 0, 0); hits.push(0); continue; }
    hits.push(1);
    // map-space offset -> frame units (inverse rotation / scale)
    const ex = (nb[0] - qx) / p.s, ey = (nb[1] - qy) / p.s;
    out.push(pts[i], pts[i + 1], co * ex + si * ey, -si * ex + co * ey);
  }
  return { warp: out, hits };
}

// ---------------------------------------------------------------- pose search
// opts: fMin/fMax (frame side as a fraction of the painting's short side),
// scales, rotate, keep, near: {cx, cy, s, th, radius} to search locally.
function align({ works, pts, opts = {} }) {
  const out = [];
  const nPts = pts.length / 4;
  const coarseStep = Math.max(1, Math.floor(nPts / 28));
  for (const work of works) {
    const map = touch(work);
    if (!map) continue;
    const { W, H } = map;
    const short = Math.min(W, H);
    const fMin = Math.max(opts.fMin ?? 0.2, 30 / short);
    const fMax = opts.fMax ?? 1.1;
    const nS = opts.scales ?? 7;
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
      const stepPx = Math.max(1.5, s / 8);
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
    // refine the most promising seeds only (each zoom band keeps its best one)
    keep.sort((a, b) => a.c - b.c);
    const seeds = [];
    const seenBand = new Set();
    for (const p of keep) {
      const z = p.s / short, band = z < 0.35 ? 0 : z < 0.7 ? 1 : 2;
      if (!seenBand.has(band)) { seenBand.add(band); seeds.push(p); }
    }
    for (const p of keep) { if (seeds.length >= (opts.refine ?? 8)) break; if (!seeds.includes(p)) seeds.push(p); }
    // refine: hill-climb on full cost (zoom, position, rotation), half the points
    const rStep = Math.max(1, Math.floor(nPts / 70));
    const rots = opts.rotate === false ? [0] : [-0.14, -0.07, 0.07, 0.14];
    let refined = seeds.map((p) => {
      let best = { ...p, c: cost(map, pts, rStep, p.cx, p.cy, p.s, p.th, true) };
      for (let round = 0; round < 3; round++) {
        const d = best.step / (round + 2);
        const cands = [
          [d, 0, 1, 0], [-d, 0, 1, 0], [0, d, 1, 0], [0, -d, 1, 0],
          [0, 0, 1.08, 0], [0, 0, 0.93, 0],
          ...rots.map((r) => [0, 0, 1, r / (round + 1)]),
        ];
        for (const [dx, dy, ds, dth] of cands) {
          const q = { cx: best.cx + dx, cy: best.cy + dy, s: best.s * ds, th: best.th + dth };
          const c = cost(map, pts, rStep, q.cx, q.cy, q.s, q.th, true);
          if (c < best.c) best = { ...best, ...q, c };
        }
      }
      return best;
    });
    refined.sort((a, b) => a.c - b.c);
    refined = refined.slice(0, 4).map((p) => (opts.snap === false
      ? { ...p, c: cost(map, pts, 1, p.cx, p.cy, p.s, p.th, true) } : snap(map, pts, p)));
    // Discrimination: a real contour fits your drawing better than the same
    // drawing turned 90 degrees or mirrored; busy texture fits all of them equally.
    const flip = mirrored(pts);
    for (const p of refined) {
      const c90 = cost(map, pts, 1, p.cx, p.cy, p.s, p.th + Math.PI / 2, true);
      const cm = cost(map, flip, 1, p.cx, p.cy, p.s, p.th, true);
      p.disc = Math.min(c90, cm) - p.c; // > 0 is good
    }
    const zoomOf = (p) => p.s / short;
    // optional preference for larger views (opts.zoomBias; tiny regions fit more things)
    const zb = opts.zoomBias ?? 0;
    const adj = (p) => p.c - 0.8 * Math.min(0.5, p.disc) +
      zb * Math.log(fMax / Math.max(zoomOf(p), 1e-3)) / Math.log(fMax / fMin || 2);
    refined.sort((a, b) => adj(a) - adj(b));
    const bands = {};
    for (const p of refined) {
      const z = zoomOf(p);
      const band = z < 0.35 ? "detail" : z < 0.7 ? "passage" : "composition";
      if (!bands[band]) bands[band] = { cx: p.cx, cy: p.cy, s: p.s, th: p.th, cost: adj(p), zoom: z };
    }
    const b = refined[0];
    const rs = opts.warp === false ? null : residuals(map, pts, b);
    out.push({
      work, W, H,
      pose: { cx: b.cx, cy: b.cy, s: b.s, th: b.th },
      cost: b.c, disc: b.disc, score: 1 - adj(b), zoom: zoomOf(b), bands,
      warp: rs && rs.warp, hits: rs && rs.hits,
      follow: rs ? rs.hits.reduce((a, h) => a + h, 0) / Math.max(1, rs.hits.length) : 0,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
