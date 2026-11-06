// Rendering helpers shared by the versions.
import { imageAffine, cssMatrix, loadImage, warpField } from "./engine.js";

/** Draw `src` (image or canvas) with affine M (src px -> screen px), bent by a
 *  warp field so painted strokes land under the drawn ones. `pre` maps screen px
 *  into the target canvas: [k, ox, oy] (canvas = k * screen + o).
 *  The unbent image is drawn first; mesh cells near your line are redrawn bent
 *  on top (paintings are opaque, so cells cover what's under them). */
export function drawWarped(g, src, M, field, pre = [1, 0, 0]) {
  const [k, ox, oy] = pre;
  const [a, b, c, d, e, f] = M;
  g.save();
  g.setTransform(k * a, k * b, k * c, k * d, k * e + ox, k * f + oy);
  g.drawImage(src, 0, 0);
  g.restore();
  if (!field) return;
  // inverse of M: screen -> src
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  const toSrc = (x, y) => [ia * (x - e) + ic * (y - f), ib * (x - e) + id * (y - f)];
  const [x0, y0, x1, y1] = field.box;
  const N = 22;
  const cw = (x1 - x0) / N, ch = (y1 - y0) / N;
  const V = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = x0 + i * cw, y = y0 + j * ch;
    const [dx, dy] = field.at(x, y);
    V.push({ x, y, live: Math.hypot(dx, dy) > 0.25, s: toSrc(x + dx, y + dy) });
  }
  const tri = (p, q, r) => {
    // destination triangle p,q,r (screen), source triangle p.s,q.s,r.s
    const [u0, v0] = p.s, [u1, v1] = q.s, [u2, v2] = r.s;
    const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(den) < 1e-9) return;
    // affine src -> screen solving for the three correspondences
    const A = ((q.x - p.x) * (v2 - v0) - (r.x - p.x) * (v1 - v0)) / den;
    const C = ((r.x - p.x) * (u1 - u0) - (q.x - p.x) * (u2 - u0)) / den;
    const B = ((q.y - p.y) * (v2 - v0) - (r.y - p.y) * (v1 - v0)) / den;
    const D = ((r.y - p.y) * (u1 - u0) - (q.y - p.y) * (u2 - u0)) / den;
    const E = p.x - A * u0 - C * v0, F = p.y - B * u0 - D * v0;
    // grow the clip a hair around its centroid to hide seams
    const mx = (p.x + q.x + r.x) / 3, my = (p.y + q.y + r.y) / 3, gr = 1.04;
    g.save();
    g.setTransform(k, 0, 0, k, ox, oy);
    g.beginPath();
    g.moveTo(mx + (p.x - mx) * gr, my + (p.y - my) * gr);
    g.lineTo(mx + (q.x - mx) * gr, my + (q.y - my) * gr);
    g.lineTo(mx + (r.x - mx) * gr, my + (r.y - my) * gr);
    g.closePath();
    g.clip();
    g.setTransform(k * A, k * B, k * C, k * D, k * E + ox, k * F + oy);
    g.drawImage(src, 0, 0);
    g.restore();
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = V[j * (N + 1) + i], q = V[j * (N + 1) + i + 1];
    const r = V[(j + 1) * (N + 1) + i], t = V[(j + 1) * (N + 1) + i + 1];
    if (!(p.live || q.live || r.live || t.live)) continue;
    tri(p, q, t); tri(p, t, r);
  }
}

export { warpField };

/** Place an <img> (painting, natural size) so the pose lands on the drawing frame. */
export function placeImage(img, pose, frame, ink) {
  img.style.width = img.naturalWidth + "px";
  img.style.height = img.naturalHeight + "px";
  img.style.transform = cssMatrix(imageAffine(pose, frame, ink.W, img.naturalWidth));
}

/** Draw the posed painting into a canvas, optionally showing just a window around
 *  the frame (thumb) and overlaying the strokes. */
export async function renderPoseThumb(canvas, work, pose, frame, ink, strokes, { pad = 1.35, lineColor = "168,50,42" } = {}) {
  const img = await loadImage(work.image);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || 96, H = canvas.clientHeight || 96;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  const side = frame.S * pad;
  const k = Math.min(W, H) / side;
  // screen -> thumb
  const sx = k * dpr, tx = (W / 2 - frame.cx * k) * dpr, ty = (H / 2 - frame.cy * k) * dpr;
  g.fillStyle = "#f3eee3";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const [a, b, c, d, e, f] = imageAffine(pose, frame, ink.W, img.naturalWidth);
  g.setTransform(sx * a, sx * b, sx * c, sx * d, sx * e + tx, sx * f + ty);
  g.drawImage(img, 0, 0);
  g.setTransform(sx, 0, 0, sx, tx, ty);
  g.strokeStyle = `rgba(${lineColor},0.85)`;
  g.lineWidth = 1.6 / k;
  g.lineCap = g.lineJoin = "round";
  for (const s of strokes) {
    g.beginPath();
    s.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
  }
}

/** Ink map as a tinted, transparent layer (ink -> color, paper -> clear). */
const tintCache = new Map();
export function tintedInk(work, ink, rgb = [27, 25, 21]) {
  const key = work + ":" + rgb.join(",");
  if (tintCache.has(key)) return tintCache.get(key);
  const c = document.createElement("canvas");
  c.width = ink.W; c.height = ink.H;
  const g = c.getContext("2d");
  const im = g.createImageData(ink.W, ink.H);
  for (let i = 0; i < ink.data.length; i++) {
    im.data[i * 4] = rgb[0]; im.data[i * 4 + 1] = rgb[1]; im.data[i * 4 + 2] = rgb[2];
    im.data[i * 4 + 3] = ink.data[i];
  }
  g.putImageData(im, 0, 0);
  tintCache.set(key, c);
  return c;
}

export function setCaption(el, work, extra = "") {
  el.hidden = false;
  el.innerHTML = "";
  const t = document.createElement("span"); t.className = "t"; t.textContent = work.title;
  const m = document.createElement("span"); m.className = "m";
  m.textContent = [work.artist, work.culture, work.date].filter(Boolean).join(" · ") + (extra ? " — " + extra : "");
  const a = document.createElement("a"); a.href = work.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "metmuseum.org ↗";
  el.append(t, m, a);
}


/**
 * Render a matched passage into its own canvas (world/screen coords):
 * the hi-res painting, snapped to your line by the warp field, seen through a
 * soft window around your strokes. The window is wider where the painter's
 * stroke really continues yours (res.hits), narrower where it doesn't, so what
 * you see first is the part that matches.
 * Returns {canvas, x, y, w, h} (CSS px, in the strokes' coordinate space).
 */
export async function renderPassage(engine, res, frame, strokes, { band, dpr = Math.min(window.devicePixelRatio || 1, 2), max = 2400, offset = { x: 0, y: 0 } } = {}) {
  const img = await engine.loadPainting(res.work);
  const ink = await engine.ensureInk(res.work);
  band = band ?? Math.max(60, frame.S * 0.42);
  const x = frame.cx - frame.S / 2 - band, y = frame.cy - frame.S / 2 - band;
  const wd = Math.min(max, frame.S + band * 2), ht = Math.min(max, frame.S + band * 2);
  const c = document.createElement("canvas");
  c.width = Math.round(wd * dpr); c.height = Math.round(ht * dpr);
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  const M = imageAffine(res.pose, frame, ink.W, img.naturalWidth);
  drawWarped(g, img, M, warpField(res.warp, frame), [dpr, -x * dpr, -y * dpr]);
  // window: strokes as a blurred mask, thicker where they hit painted lines
  const m = document.createElement("canvas");
  m.width = c.width; m.height = c.height;
  const mg = m.getContext("2d");
  mg.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
  mg.lineCap = mg.lineJoin = "round"; mg.strokeStyle = "#000";
  // soft edge from shadowBlur (canvas filter isn't in every Safari); keep the
  // whole falloff inside the canvas so no hard rectangle edges show
  mg.shadowColor = "#000"; mg.shadowBlur = band * 0.38 * dpr;
  const hits = res.hits || [];
  const pts = [];
  for (const s of strokes) for (const p of s.points) pts.push(p);
  // the worker sampled ~evenly along all strokes; spread hits over points by arc position
  const hitAt = (i) => (hits.length ? hits[Math.min(hits.length - 1, Math.floor((i / Math.max(1, pts.length - 1)) * hits.length))] : 1);
  let idx = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.points.length; i++, idx++) {
      const h = hitAt(idx);
      mg.lineWidth = band * (h ? 0.75 : 0.28);
      mg.globalAlpha = h ? 1 : 0.6;
      mg.beginPath(); mg.moveTo(s.points[i - 1].x, s.points[i - 1].y); mg.lineTo(s.points[i].x, s.points[i].y); mg.stroke();
    }
    idx++;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(m, 0, 0);
  pictureEdge(g, engine.works[res.work], img, M, [dpr, -x * dpr, -y * dpr]);
  g.globalCompositeOperation = "source-over";
  return { canvas: c, x, y, w: wd, h: ht };
}

/** Fade a drawn painting out at the edge of its picture area (inside mounts,
 *  frames and photo borders), so no hard rectangles appear. Call with the
 *  painting already drawn in g with affine M (image px -> CSS px) and
 *  pre = [k, ox, oy] (canvas = k * CSS + o). Uses a small computed alpha ramp
 *  (no shadow/filter tricks, so it looks the same in every browser). */
const edgeCache = new Map();
function edgeMask(work, W, H) {
  const key = (work.id ?? "") + ":" + W + "x" + H;
  if (edgeCache.has(key)) return edgeCache.get(key);
  const b = work.box || [0, 0, 1, 1];
  const mw = 192, mh = Math.max(8, Math.round((mw * H) / W));
  const c = document.createElement("canvas"); c.width = mw; c.height = mh;
  const g = c.getContext("2d");
  const im = g.createImageData(mw, mh);
  const feather = Math.max(8, Math.min((b[2] - b[0]) * W, (b[3] - b[1]) * H) * 0.04); // image px
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const u = ((x + 0.5) / mw), v = ((y + 0.5) / mh);
    const d = Math.min((u - b[0]) * W, (b[2] - u) * W, (v - b[1]) * H, (b[3] - v) * H);
    const t = Math.max(0, Math.min(1, d / feather));
    im.data[(y * mw + x) * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
  }
  g.putImageData(im, 0, 0);
  if (edgeCache.size > 60) edgeCache.delete(edgeCache.keys().next().value);
  edgeCache.set(key, c);
  return c;
}

export function pictureEdge(g, work, img, M, pre = [1, 0, 0]) {
  const [k, ox, oy] = pre;
  const W = img.naturalWidth, H = img.naturalHeight;
  const m = edgeMask(work, W, H);
  const sx = W / m.width, sy = H / m.height;
  g.save();
  g.setTransform(k * M[0] * sx, k * M[1] * sx, k * M[2] * sy, k * M[3] * sy, k * M[4] + ox, k * M[5] + oy);
  g.globalCompositeOperation = "destination-in";
  g.imageSmoothingEnabled = true;
  g.drawImage(m, 0, 0);
  g.restore();
}

/** Apply a low-resolution mask (canvas, alpha = keep) to what's already drawn in
 *  g, with transform T (mask px -> canvas px), softened by `blur` canvas px.
 *  Blurs via a shadow (works in Safari, which lacks canvas filters). */
export function applySoftMask(g, mask, T, blur) {
  const off = 100000;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "destination-in";
  // draw the mask far off-canvas; only its blurred shadow lands on the canvas
  g.shadowColor = "#000";
  g.shadowBlur = blur;
  g.shadowOffsetX = off;
  g.setTransform(T[0], T[1], T[2], T[3], T[4] - off, T[5]);
  g.imageSmoothingEnabled = true;
  g.drawImage(mask, 0, 0);
  g.restore();
}
