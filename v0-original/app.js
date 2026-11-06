import { SIZE, descriptor } from "../descriptor.js";

const $ = (id) => document.getElementById(id);
const canvas = $("ink");
const ctx = canvas.getContext("2d");
const revealCanvas = $("reveal");
const rctx = revealCanvas.getContext("2d");
const ghost = $("ghost");
const hint = $("hint");
const statusEl = $("status");
const matchesEl = $("matches");
const caption = $("caption");
const modeBtn = $("mode");
const inkBtn = $("ink-toggle");
const sheet = $("sheet");

const TOP_K = 10;
const QUERY_INTERVAL_MS = 120;
const STICKY_MARGIN = 0.02; // keep the current work unless a rival beats it by this much
const MODES = ["Ghost", "Reveal", "Plain"];

// ---------- state ----------
let works = [];
let ready = false;
let strokes = [];         // [{points: [{x, y, w}]}]
let active = null;
let activePointer = null;
let penSeen = false;      // after an Apple Pencil touches down, ignore fingers (palm rejection)
let lastQuery = 0;
let queryId = 0;
let pendingQuery = false;
let results = [];         // [{work, score, crop}]
let current = null;       // {work, crop}
let locked = false;       // user tapped a thumbnail: don't auto-switch until next stroke
let frame = null;         // drawing square {x, y, side} in CSS px
let revealImg = null;
let mode = load("mode", "Ghost");
let showLines = load("lines", "1") === "1";

function load(k, d) { try { return localStorage.getItem("ink." + k) ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem("ink." + k, v); } catch { /* private mode */ } }

// ---------- search worker ----------
const worker = new Worker("search-worker.js");
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === "ready") {
    ready = true;
    statusEl.textContent = `${works.length.toLocaleString()} works · ${m.regions.toLocaleString()} contours`;
  } else if (m.type === "error") {
    statusEl.textContent = "Couldn't load the index — see README.md to build it.";
  } else if (m.type === "results" && m.id === queryId) {
    pendingQuery = false;
    onResults(m.top);
  }
};

async function boot() {
  try {
    const res = await fetch("../index.json");
    if (!res.ok) throw new Error(res.status);
    const meta = await res.json();
    works = meta.works;
    worker.postMessage({ type: "load", url: new URL("../index.bin", location.href).href,
      dims: meta.dims, regions: meta.regions, tableBytes: meta.tableBytes });
  } catch (err) {
    statusEl.textContent = "No index yet — run the build scripts in README.md, then reload.";
    console.warn("[ink] index load failed", err);
  }
}

// ---------- sizing ----------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  for (const c of [canvas, revealCanvas]) {
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  redraw();
  if (strokes.length) query(true);
}
window.addEventListener("resize", resize);

// ---------- strokes ----------
function widthFor(e) {
  if (e.pointerType === "pen") return 1.2 + Math.pow(e.pressure || 0.5, 1.4) * 11;
  return 5;
}

function drawStroke(c, pts, scale = 1, minW = 1, widthMul = 1) {
  if (!pts.length) return;
  c.lineCap = "round";
  c.lineJoin = "round";
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0].x * scale, pts[0].y * scale, Math.max(minW, pts[0].w * widthMul * scale) / 2, 0, Math.PI * 2);
    c.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    c.lineWidth = Math.max(minW, ((a.w + b.w) / 2) * widthMul * scale);
    c.beginPath();
    c.moveTo(a.x * scale, a.y * scale);
    c.lineTo(b.x * scale, b.y * scale);
    c.stroke();
  }
}

function redraw() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.strokeStyle = ctx.fillStyle = "#1b1915";
  for (const s of strokes) drawStroke(ctx, s.points);
  scheduleReveal();
}

function addPoints(e) {
  const rect = canvas.getBoundingClientRect();
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  const start = active.points.length;
  for (const ev of evs.length ? evs : [e]) {
    active.points.push({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, w: widthFor(ev) });
  }
  ctx.strokeStyle = ctx.fillStyle = "#1b1915";
  drawStroke(ctx, active.points.slice(Math.max(0, start - 1)));
  scheduleReveal();
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "pen") penSeen = true;
  if (penSeen && e.pointerType === "touch") return;
  if (activePointer !== null) return;
  e.preventDefault();
  activePointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  active = { points: [] };
  strokes.push(active);
  locked = false;
  hint.classList.add("gone");
  addPoints(e);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== activePointer) return;
  addPoints(e);
  if (performance.now() - lastQuery > QUERY_INTERVAL_MS) query();
});
function endStroke(e) {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  active = null;
  query(true);
}
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

// ---------- matching ----------
const small = document.createElement("canvas");
small.width = small.height = SIZE;
const sctx = small.getContext("2d", { willReadFrequently: true });

// Square around everything drawn so far; the drawing is matched (and the
// painting region placed) inside this square, so position & size don't matter.
function drawingFrame() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s.points) {
    const r = p.w / 2;
    x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r);
    x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
  }
  if (!isFinite(x0)) return null;
  const side = Math.max(90, Math.max(x1 - x0, y1 - y0) * 1.12);
  return { x: (x0 + x1) / 2 - side / 2, y: (y0 + y1) / 2 - side / 2, side };
}

function drawingDescriptor(f) {
  const scale = SIZE / f.side;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, SIZE, SIZE);
  sctx.setTransform(1, 0, 0, 1, -f.x * scale, -f.y * scale);
  sctx.strokeStyle = sctx.fillStyle = "#000";
  for (const s of strokes) drawStroke(sctx, s.points, scale, 1.2);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;
  const ink = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < ink.length; i++) ink[i] = 1 - px[i * 4] / 255;
  return Float32Array.from(descriptor(ink));
}

function query(force = false) {
  if (!ready || !strokes.length) return;
  if (pendingQuery && !force) return;
  lastQuery = performance.now();
  frame = drawingFrame();
  if (!frame) return;
  pendingQuery = true;
  worker.postMessage({ type: "query", id: ++queryId, desc: drawingDescriptor(frame), k: TOP_K });
}

function onResults(top) {
  if (!top.length || !strokes.length) return;
  results = top;
  let pick = top[0];
  if (current) {
    const mine = top.find((r) => r.work === current.work);
    if (locked && mine) pick = mine;
    else if (locked) pick = { work: current.work, crop: current.crop, score: 0 };
    else if (mine && mine.score + STICKY_MARGIN >= top[0].score) pick = mine;
  }
  feature(pick.work, pick.crop);
  renderThumbs();
}

// ---------- display ----------
// Image placement so that crop (fractions of image width) fills square f.
function placement(work, crop, f) {
  const w = f.side / crop.s;
  return { left: f.x - crop.x * w, top: f.y - crop.y * w, w, h: w * work.aspect };
}

function feature(workIdx, crop) {
  const work = works[workIdx];
  const changed = !current || current.work !== workIdx;
  current = { work: workIdx, crop };
  if (!frame) return;
  const p = placement(work, crop, frame);
  if (changed) {
    ghost.classList.remove("show");
    ghost.style.transition = "opacity 0.35s ease";
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!current || current.work !== workIdx) return;
      revealImg = img;
      ghost.style.backgroundImage = `url("${work.image}")`;
      applyGhost(p);
      requestAnimationFrame(() => {
        ghost.style.transition = "";
        ghost.classList.toggle("show", mode === "Ghost");
      });
      scheduleReveal();
    };
    img.src = work.image;
    $("caption-title").textContent = work.title;
    $("caption-meta").textContent = [work.artist, work.culture, work.date].filter(Boolean).join(" · ");
    caption.hidden = false;
  } else {
    applyGhost(p);
    scheduleReveal();
  }
  for (const b of matchesEl.children) b.classList.toggle("active", Number(b.dataset.work) === workIdx);
}

function applyGhost(p) {
  ghost.style.backgroundSize = `${p.w}px ${p.h}px`;
  ghost.style.backgroundPosition = `${p.left}px ${p.top}px`;
}

function renderThumbs() {
  const T = matchesEl.clientHeight || 96;
  matchesEl.replaceChildren(...results.map((r) => {
    const work = works[r.work];
    const b = document.createElement("button");
    b.dataset.work = r.work;
    b.setAttribute("aria-label", `${work.title}${work.artist ? ", " + work.artist : ""}`);
    const w = T / r.crop.s;
    b.style.backgroundImage = `url("${work.image}")`;
    b.style.backgroundSize = `${w}px ${w * work.aspect}px`;
    b.style.backgroundPosition = `${-r.crop.x * w}px ${-r.crop.y * w}px`;
    b.classList.toggle("active", current && current.work === r.work);
    b.addEventListener("click", () => {
      locked = true;
      feature(r.work, r.crop);
    });
    return b;
  }));
}

// Reveal mode: the painting shows through a soft brush that follows your lines.
let revealQueued = false;
function scheduleReveal() {
  if (revealQueued) return;
  revealQueued = true;
  requestAnimationFrame(() => { revealQueued = false; drawReveal(); });
}
function drawReveal() {
  const W = revealCanvas.clientWidth, H = revealCanvas.clientHeight;
  rctx.clearRect(0, 0, W, H);
  if (mode !== "Reveal" || !current || !revealImg || !frame) return;
  const work = works[current.work];
  const p = placement(work, current.crop, frame);
  // Build the soft brush mask offscreen (compositing each segment with
  // destination-in directly would erase all but the last segment).
  const dpr = revealCanvas.width / W;
  if (mask.width !== revealCanvas.width || mask.height !== revealCanvas.height) {
    mask.width = revealCanvas.width;
    mask.height = revealCanvas.height;
  }
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, mask.width, mask.height);
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.strokeStyle = mctx.fillStyle = "#000";
  mctx.shadowColor = "#000";
  mctx.shadowBlur = 18 * dpr; // softness (shadowBlur works on all Safari versions; ctx.filter needs 18+)
  const reach = Math.max(34, frame.side * 0.1);
  for (const s of strokes) drawStroke(mctx, s.points, 1, reach, 1);
  mctx.shadowBlur = 0;

  rctx.globalCompositeOperation = "source-over";
  rctx.drawImage(revealImg, p.left, p.top, p.w, p.h);
  rctx.globalCompositeOperation = "destination-in";
  rctx.drawImage(mask, 0, 0, W, H);
  rctx.globalCompositeOperation = "source-over";
}
const mask = document.createElement("canvas");
const mctx = mask.getContext("2d");

// ---------- detail sheet ----------
$("caption-open").addEventListener("click", () => {
  if (!current) return;
  const w = works[current.work];
  $("sheet-img").src = w.image;
  $("sheet-img").alt = w.title;
  $("sheet-title").textContent = w.title;
  $("sheet-meta").textContent = [w.artist, w.culture, w.date].filter(Boolean).join(" · ");
  $("sheet-medium").textContent = [w.medium, w.classification].filter(Boolean).join(" — ");
  $("sheet-link").href = w.url;
  sheet.showModal();
});
$("sheet-next").addEventListener("click", () => {
  if (!results.length || !current) return;
  const i = results.findIndex((r) => r.work === current.work);
  const next = results[(i + 1) % results.length];
  locked = true;
  feature(next.work, next.crop);
  sheet.close();
});
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });

// ---------- toolbar ----------
$("undo").addEventListener("click", () => {
  strokes.pop();
  redraw();
  if (strokes.length) query(true); else reset();
});
$("clear").addEventListener("click", () => { strokes = []; redraw(); reset(); });
modeBtn.addEventListener("click", () => {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  save("mode", mode);
  applyMode();
});
inkBtn.addEventListener("click", () => {
  showLines = !showLines;
  save("lines", showLines ? "1" : "0");
  applyMode();
});
function applyMode() {
  if (!MODES.includes(mode)) mode = "Ghost";
  modeBtn.textContent = mode;
  ghost.classList.toggle("show", mode === "Ghost" && !!current);
  inkBtn.setAttribute("aria-pressed", String(showLines));
  canvas.classList.toggle("hide-lines", !showLines);
  scheduleReveal();
}

function reset() {
  current = null; results = []; frame = null; revealImg = null; locked = false;
  ghost.classList.remove("show");
  matchesEl.replaceChildren();
  caption.hidden = true;
  hint.classList.remove("gone");
  scheduleReveal();
}

applyMode();
resize();
boot();
