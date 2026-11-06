// V2 · Trace — anchor on one painting, then follow the master's strokes.
// The first stroke picks a painting + pose. After that the painting is locked:
// real strokes near your drawing glow as hints, and each new stroke is scored
// against the painting's ink under the *same* pose. Hits reveal the painting
// along your line; two misses in a row and the brush goes looking for a
// different painting that fits everything you've drawn.
import { Engine, ptsInFrame, poseAffine, imageAffine, loadImage } from "../shared/engine.js";
import { Pad } from "../shared/pad.js";
import { tintedInk, setCaption } from "../shared/view.js";

const $ = (id) => document.getElementById(id);
const pad = new Pad($("pad"), { base: 2.2 });
const hintC = $("hintLayer"), revealC = $("revealLayer"), peekC = $("peekLayer");
const HIT = 0.42;        // per-stroke chamfer cost that counts as "on the line"
const HINT_REACH = 0.45; // hint radius, as a fraction of the anchor frame

let engine = null;
let anchor = null;   // {work, pose, frame, img, ink}
let hits = [];       // strokes that landed (reveal mask)
let log = [];        // "hit" | "miss" per stroke since anchoring
let misses = 0;
let showHints = true, peek = false;

Engine.create("../").then((e) => {
  engine = e;
  $("status").textContent = `${e.works.length.toLocaleString()} works ready`;
}).catch((err) => { $("status").textContent = "Couldn't load the index."; console.error(err); });

for (const c of [hintC, revealC, peekC]) sizeCanvas(c);
window.addEventListener("resize", () => { for (const c of [hintC, revealC, peekC]) sizeCanvas(c); render(); });
function sizeCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
}

pad.on("start", () => $("hint").classList.add("gone"));
pad.on("end", (s) => onStroke(s));

async function onStroke(stroke) {
  if (!engine) return;
  busy(true);
  try {
    if (!anchor) { await findAnchor(); return; }
    const pts = ptsInFrame([stroke], anchor.frame);
    if (!pts) return;
    const c = await engine.cost(pts, anchor.work, anchor.pose);
    if (c < HIT) {
      hits.push(stroke); log.push("hit"); misses = 0;
      toast(c < HIT * 0.6 ? "Exactly the master's line" : "On the line");
    } else {
      log.push("miss"); misses++;
      if (misses >= 2) {
        toast("The brush looks for another painting…");
        await findAnchor();
        return;
      }
    }
    render();
  } finally { busy(false); }
}

async function findAnchor() {
  const prev = anchor ? anchor.work : null;
  const r = await engine.match(pad.strokes, { k: 14, alignK: 6 });
  if (!r || !r.results.length) return;
  const best = r.results.find((x) => x.work !== prev) || r.results[0];
  const w = engine.works[best.work];
  const [img, ink] = await Promise.all([loadImage(w.image), engine.ensureInk(best.work)]);
  anchor = { work: best.work, pose: best.pose, frame: r.frame, img, ink };
  // every stroke so far counts as drawn on this painting
  hits = pad.strokes.slice(); log = pad.strokes.map(() => "hit"); misses = 0;
  setCaption($("caption"), w);
  render();
}

function render() {
  for (const c of [hintC, revealC, peekC]) c.getContext("2d").clearRect(0, 0, c.width, c.height);
  meter();
  if (!anchor) return;
  const dpr = hintC.width / hintC.clientWidth;
  const { pose, frame, img, ink } = anchor;
  const toScreenInk = poseAffine(pose, frame);
  const toScreenImg = imageAffine(pose, frame, ink.W, img.naturalWidth);

  // peek: the whole painting, faint
  if (peek) {
    const g = peekC.getContext("2d");
    g.setTransform(...toScreenImg.map((v, i) => (v * dpr)));
    g.globalAlpha = 0.35;
    g.drawImage(img, 0, 0);
    g.globalAlpha = 1;
  }

  // reveal: the painting through a soft brush along every hit stroke
  if (hits.length) {
    const g = revealC.getContext("2d");
    g.setTransform(...toScreenImg.map((v) => v * dpr));
    g.drawImage(img, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(strokeMask(hits, Math.max(26, frame.S * 0.09), 16), 0, 0, revealC.clientWidth, revealC.clientHeight);
    g.globalCompositeOperation = "source-over";
  }

  // hints: the master's strokes (ink map, tinted) near what you've drawn
  if (showHints) {
    const g = hintC.getContext("2d");
    g.setTransform(...toScreenInk.map((v) => v * dpr));
    g.globalAlpha = 0.75;
    g.drawImage(tintedInk(anchor.work, ink, [168, 50, 42]), 0, 0);
    g.globalAlpha = 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(strokeMask(pad.strokes, frame.S * HINT_REACH, 40), 0, 0, hintC.clientWidth, hintC.clientHeight);
    g.globalCompositeOperation = "source-over";
  }
}

const maskC = document.createElement("canvas");
function strokeMask(strokes, width, blur) {
  const W = hintC.clientWidth, H = hintC.clientHeight;
  if (maskC.width !== W || maskC.height !== H) { maskC.width = W; maskC.height = H; }
  const g = maskC.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.strokeStyle = g.fillStyle = "#000";
  g.shadowColor = "#000"; g.shadowBlur = blur;
  g.lineCap = g.lineJoin = "round"; g.lineWidth = width;
  for (const s of strokes) {
    g.beginPath();
    s.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    if (s.points.length === 1) g.lineTo(s.points[0].x + 0.1, s.points[0].y);
    g.stroke();
  }
  g.shadowBlur = 0;
  return maskC;
}

function meter() {
  const el = $("meter");
  el.replaceChildren();
  if (!anchor) return;
  const n = log.filter((x) => x === "hit").length;
  for (const r of log.slice(-12)) {
    const d = document.createElement("span"); d.className = "dot " + r; el.append(d);
  }
  const t = document.createElement("span");
  t.textContent = ` ${n} of ${log.length} strokes on the master's line`;
  el.append(t);
}

let toastT = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg; el.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 1300);
}
function busy(on) { $("busy").classList.toggle("on", on); }

$("undo").onclick = () => {
  const s = pad.strokes[pad.strokes.length - 1];
  pad.undo();
  hits = hits.filter((h) => h !== s); log.pop();
  if (!pad.strokes.length) reset(); else render();
};
$("clear").onclick = () => { pad.clear(); reset(); };
$("peek").onclick = (e) => { peek = !peek; e.currentTarget.setAttribute("aria-pressed", String(peek)); render(); };
$("hints").onclick = (e) => { showHints = !showHints; e.currentTarget.setAttribute("aria-pressed", String(showHints)); render(); };
function reset() {
  anchor = null; hits = []; log = []; misses = 0;
  $("caption").hidden = true;
  $("hint").classList.remove("gone");
  render();
}
