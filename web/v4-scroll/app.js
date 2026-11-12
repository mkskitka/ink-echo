// V4 · Handscroll — a scroll that keeps unrolling while you draw. Ink soaks in
// and fades; only the gestures of the last few seconds are matched, so the
// query is always a fresh, small gesture (never an idiosyncratic pile-up).
// Each match lays a passage from a painting along the scroll, at the place you
// drew it. Velocity-sensitive dry brush.
import { Engine } from "../shared/engine.js";
import { renderPassage } from "../shared/view.js";
import { Pad } from "../shared/pad.js";

const $ = (id) => document.getElementById(id);
const pad = new Pad($("pad"), { base: 3.2, dry: true, color: "30,24,18" });
const layer = $("scroll");
const DRIFT = 22;         // px / s the scroll unrolls
const WINDOW_MS = 3500;   // gestures younger than this are matched together
const SOAK_MS = 5000;     // ink fades to its soaked-in tone over this time

let engine = null;
let passages = [];        // {canvas, x, y, w, h, work, born}
let flowing = true, started = false, last = performance.now(), busy = false, again = false;

Engine.create("../").then((e) => {
  engine = e;
  $("status").textContent = `${e.works.length.toLocaleString()} works ready`;
}).catch((err) => { $("status").textContent = "Couldn't load the index."; console.error(err); });

function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  layer.width = layer.clientWidth * dpr; layer.height = layer.clientHeight * dpr;
}
window.addEventListener("resize", size);
size();

pad.on("start", () => { started = true; $("hint").classList.add("gone"); });
pad.on("move", () => engine && engine.warm(recent()));
pad.on("end", () => match());

function recent() {
  const now = performance.now();
  return pad.strokes.filter((s) => !s.t1 || now - s.t1 < WINDOW_MS);
}

async function match() {
  if (!engine) return;
  if (busy) { again = true; return; }
  const strokes = recent();
  if (!strokes.length) return;
  busy = true; again = false;
  $("busy").classList.add("on");
  try {
    const used = passages.slice(-6).map((p) => p.work);
    const r = await engine.match(strokes.filter((s) => s.t1), { k: 28, alignK: 5, exclude: used });
    if (!r || !r.results.length) return;
    // only passages where a painted stroke really continues yours
    const ok = r.results.filter((x) => x.follow >= 0.62);
    if (!ok.length) return;
    // prefer real handscrolls (wide works) when they're nearly as good
    const best = ok[0];
    const scroll = ok.find((x) => engine.works[x.work].aspect < 0.55 && x.score > best.score - 0.05);
    const pick = scroll || best;
    await lay(pick, r.frame, strokes);
  } catch (err) { console.error(err); }
  finally {
    busy = false; $("busy").classList.remove("on");
    if (again) match();
  }
}

/** Render a passage once into its own canvas (world coords): hi-res, snapped
 *  to your line, seen through a soft band around the gesture. */
async function lay(res, frame, strokes) {
  const p = await renderPassage(engine, res, frame, strokes, { band: Math.max(70, frame.S * 0.45) });
  passages.push({ ...p, work: res.work, born: performance.now() });
  trail();
}

function trail() {
  $("trail").replaceChildren(...passages.slice(-6).map((p) => {
    const s = document.createElement("span");
    const w = engine.works[p.work];
    s.textContent = `${w.title}${w.artist ? " · " + w.artist : ""}`;
    return s;
  }));
}

// ---------------------------------------------------------------- frame loop
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (flowing && started && pad.pointer === null) pad.offset.x += DRIFT * dt;
  requestAnimationFrame(frame);
  // Only repaint when something visible changed: the scroll moved a whole device
  // pixel, you're drawing, ink is still soaking in, or a passage is fading in.
  const dprNow = layer.width / layer.clientWidth;
  const px = Math.round(pad.offset.x * dprNow), py = Math.round(pad.offset.y * dprNow);
  const soaking = pad.strokes.some((s) => !s.t1 || now - s.t1 < SOAK_MS);
  const fading = passages.some((p) => now - p.born < 1200);
  const sized = layer.width !== lastPaint.w || layer.height !== lastPaint.h || passages.length !== lastPaint.n;
  if (px === lastPaint.x && py === lastPaint.y && pad.pointer === null && !soaking && !fading && !sized && !lastPaint.trailing) return;
  lastPaint = { x: px, y: py, w: layer.width, h: layer.height, n: passages.length, trailing: soaking || fading };
  // the pad keeps drawing in world coords while the scroll moves
  pad.redraw((s) => {
    const age = s.t1 ? now - s.t1 : 0;
    return { alpha: Math.max(0.4, 1 - age / SOAK_MS) };
  });
  const g = layer.getContext("2d");
  const dpr = layer.width / layer.clientWidth;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, layer.width, layer.height);
  for (const p of passages) {
    const sx = p.x - pad.offset.x;
    if (sx > layer.clientWidth || sx + p.w < 0) continue;
    g.globalAlpha = Math.min(1, (now - p.born) / 1200) * 0.92;
    g.drawImage(p.canvas, sx * dpr, (p.y - pad.offset.y) * dpr, p.w * dpr, p.h * dpr);
  }
  g.globalAlpha = 1;
}
let lastPaint = {};
requestAnimationFrame(frame);

// ---------------------------------------------------------------- unroll view
$("unrollBtn").onclick = () => {
  if (!pad.strokes.length && !passages.length) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of passages) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + p.w); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y + p.h); }
  for (const s of pad.strokes) for (const q of s.points) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  const W = x1 - x0 + 40, H = y1 - y0 + 40;
  const c = $("unrollC");
  const k = Math.min((window.innerWidth * 0.96) / W, (window.innerHeight * 0.7) / H);
  c.width = W * k * 2; c.height = H * k * 2;
  c.style.width = W * k + "px"; c.style.height = H * k + "px";
  const g = c.getContext("2d");
  g.fillStyle = "#efe6d2"; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(2 * k, 0, 0, 2 * k, (20 - x0) * 2 * k, (20 - y0) * 2 * k);
  g.globalCompositeOperation = "multiply";
  for (const p of passages) g.drawImage(p.canvas, p.x, p.y, p.w, p.h);
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = "rgba(30,24,18,0.55)"; g.lineCap = g.lineJoin = "round";
  for (const s of pad.strokes) {
    g.lineWidth = 2;
    g.beginPath(); s.points.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke();
  }
  $("unroll").classList.add("on");
};
$("unroll").onclick = () => $("unroll").classList.remove("on");

$("flow").onclick = (e) => {
  flowing = !flowing;
  e.currentTarget.setAttribute("aria-pressed", String(flowing));
  e.currentTarget.textContent = flowing ? "Flowing" : "Paused";
};
$("clear").onclick = () => {
  pad.clear(); passages = []; pad.offset.x = 0; started = false; trail();
  $("hint").classList.remove("gone");
};
