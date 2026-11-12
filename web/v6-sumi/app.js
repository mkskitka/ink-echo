// V6 · Sumi Scroll -- Handscroll with real ink. The scroll unrolls while you
// paint; the brush is simulated (load, pressure, tilt, dry brush) and the ink
// soaks into xuan paper or sits on silk. Each recent gesture calls up a passage
// from a painting, shown sharp (hi-res) and snapped so the master's stroke
// continues yours. "Finish" unrolls the whole scroll and writes its colophon.
import { Engine } from "../shared/engine.js";
import { InkPaper, paperBackground } from "../shared/inkpaper.js";
import { Brush } from "../shared/brush.js";
import { renderPassage } from "../shared/view.js";
import { openColophon } from "../shared/colophon.js";
import { inkwells, toast, soundToggle } from "../shared/ui.js";
import { BrushSound } from "../shared/brushsound.js";

const $ = (id) => document.getElementById(id);
const DRIFT = 20;          // px / s the scroll unrolls
const WINDOW_MS = 3500;    // gestures younger than this are matched together
const MIN_FOLLOW = 0.62;   // below this share of your line on a painted stroke, lay nothing

let paperKind = "xuan";
paperBackground($("paper"), { kind: paperKind });
const paper = new InkPaper($("ink"), { paper: paperKind });
if (!paper.ok) $("status").textContent = "This browser has no WebGL2, so the ink can't be simulated.";
const brush = new Brush($("hit"), paper, { size: 7.5 });
inkwells(brush);
soundToggle(new BrushSound(brush));
const layer = $("scroll");

let engine = null;
let passages = [];        // {canvas, x, y, w, h, work, born}
const encounters = [];    // for the colophon
let inkOnly = true;        // show the master's ink alone on your paper (vs. with their paper/silk)
let flowing = true, started = false, last = performance.now(), busy = false, again = false, shiftAcc = 0;

Engine.create("../").then((e) => {
  engine = e;
  $("status").textContent = `${e.works.length.toLocaleString()} works ready`;
}).catch((err) => { $("status").textContent = "Couldn't load the index."; console.error(err); });

function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  layer.width = layer.clientWidth * dpr; layer.height = layer.clientHeight * dpr;
}
window.addEventListener("resize", () => { size(); paperBackground($("paper"), { kind: paperKind }); });
size();

brush.on("start", () => { started = true; $("hint").classList.add("gone"); });
brush.on("move", () => engine && engine.warm(recent()));
brush.on("end", () => match());

function recent() {
  const now = performance.now();
  return brush.strokes.filter((s) => !s.t1 || now - s.t1 < WINDOW_MS);
}

async function match() {
  if (!engine) return;
  if (busy) { again = true; return; }
  const strokes = recent().filter((s) => s.t1);
  if (!strokes.length) return;
  busy = true; again = false;
  $("busy").classList.add("on");
  try {
    const used = passages.slice(-6).map((p) => p.work);
    const r = await engine.match(strokes, { k: 28, alignK: 5, exclude: used });
    if (!r || !r.results.length) return;
    // the best that truly continues your line; prefer handscrolls when close
    const ok = r.results.filter((x) => x.follow >= MIN_FOLLOW);
    if (!ok.length) { toast("The paper takes your ink. No painter's stroke answers this one."); return; }
    const best = ok[0];
    const scroll = ok.find((x) => engine.works[x.work].aspect < 0.55 && x.score > best.score - 0.04);
    const pick = scroll || best;
    const p = await renderPassage(engine, pick, r.frame, strokes, { inkOnly });
    passages.push({ ...p, work: pick.work, born: performance.now() });
    encounters.push({ work: pick.work, pose: pick.pose, frame: r.frame, strokes, warp: pick.warp });
    trail();
  } catch (err) { console.error(err); }
  finally {
    busy = false; $("busy").classList.remove("on");
    if (again) match();
  }
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
  if (flowing && started && brush.pointer === null) {
    shiftAcc += DRIFT * dt;
    const step = Math.floor(shiftAcc);
    if (step >= 1) {               // move ink and world together, whole pixels only
      shiftAcc -= step;
      brush.offset.x += step;
      paper.shift(-step, 0);
    }
  }
  requestAnimationFrame(frame);
  // Only repaint the passages layer when it would look different: the scroll
  // moved, a passage is fading in, or the canvas/passage list changed.
  const fading = passages.some((p) => now - p.born < 1400);
  const key = `${brush.offset.x},${brush.offset.y},${layer.width},${layer.height},${passages.length}`;
  if (key === lastPaint && !fading && !fadedLast) return;
  lastPaint = key; fadedLast = fading;
  const g = layer.getContext("2d");
  const dpr = layer.width / layer.clientWidth;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, layer.width, layer.height);
  for (const p of passages) {
    const sx = p.x - brush.offset.x;
    if (sx > layer.clientWidth || sx + p.w < 0) continue;
    g.globalAlpha = Math.min(1, (now - p.born) / 1400) * 0.95;
    g.drawImage(p.canvas, sx * dpr, (p.y - brush.offset.y) * dpr, p.w * dpr, p.h * dpr);
  }
  g.globalAlpha = 1;
}
let lastPaint = "", fadedLast = false;
requestAnimationFrame(frame);

// ---------------------------------------------------------------- finish
$("unrollBtn").onclick = () => {
  if (!brush.strokes.length && !passages.length) { toast("Paint something first."); return; }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of passages) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + p.w); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y + p.h); }
  for (const s of brush.strokes) for (const q of s.points) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  const W = x1 - x0 + 40, H = y1 - y0 + 40;
  const c = $("unrollC");
  const k = Math.min((window.innerWidth * 0.96) / W, (window.innerHeight * 0.62) / H);
  c.width = W * k * 2; c.height = H * k * 2;
  c.style.width = W * k + "px"; c.style.height = H * k + "px";
  const g = c.getContext("2d");
  g.fillStyle = paperKind === "silk" ? "#e9dfc6" : "#efe6d2"; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(2 * k, 0, 0, 2 * k, (20 - x0) * 2 * k, (20 - y0) * 2 * k);
  g.globalCompositeOperation = "multiply";
  for (const p of passages) g.drawImage(p.canvas, p.x, p.y, p.w, p.h);
  g.globalCompositeOperation = "source-over";
  g.lineCap = g.lineJoin = "round";
  for (const s of brush.strokes) {
    const pts = s.points;
    for (let i = 1; i < pts.length; i++) {
      g.strokeStyle = `rgba(22,19,15,${0.25 + 0.6 * (s.mech?.tone ?? 0.9)})`;
      g.lineWidth = Math.max(1, pts[i].w * 0.8);
      g.beginPath(); g.moveTo(pts[i - 1].x, pts[i - 1].y); g.lineTo(pts[i].x, pts[i].y); g.stroke();
    }
  }
  $("unroll").classList.add("on");
};
$("backBtn").onclick = () => $("unroll").classList.remove("on");
$("colophonBtn").onclick = () => {
  if (!engine) return;
  openColophon(engine, encounters, brush.strokes, { title: "Colophon to a handscroll" });
};
$("newBtn").onclick = () => {
  brush.clear(); passages = []; encounters.length = 0; brush.offset.x = 0; started = false; trail();
  $("unroll").classList.remove("on"); $("hint").classList.remove("gone");
};
$("flow").onclick = (e) => {
  flowing = !flowing;
  e.currentTarget.setAttribute("aria-pressed", String(flowing));
  e.currentTarget.textContent = flowing ? "Flowing" : "Paused";
};
$("paperBtn").onclick = (e) => {
  const order = ["xuan", "sized", "silk"];
  paperKind = order[(order.indexOf(paperKind) + 1) % order.length];
  paper.setPaper(paperKind);
  paperBackground($("paper"), { kind: paperKind });
  e.currentTarget.textContent = { xuan: "Xuan paper", sized: "Sized paper", silk: "Silk" }[paperKind];
  toast(InkPaper.papers()[paperKind].label);
};

$("inkOnlyBtn").onclick = (e) => {
  inkOnly = !inkOnly;
  e.currentTarget.textContent = inkOnly ? "Ink only" : "With silk";
  toast(inkOnly ? "Passages show the master's ink alone, on your paper." : "Passages show their paper or silk too.");
};
