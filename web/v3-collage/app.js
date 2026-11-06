// V3 · Collage — every stroke is its own query. Each one opens a soft window
// onto a *different* painting, posed so the painter's stroke sits under yours.
// Idiosyncratic combinations are fine: no single painting has to contain them.
import { Engine } from "../shared/engine.js";
import { renderPassage } from "../shared/view.js";
import { Pad } from "../shared/pad.js";

const $ = (id) => document.getElementById(id);
const pad = new Pad($("pad"), { base: 2.3 });
const collage = $("collage");
const COLORS = ["#a8322a", "#b0892f", "#3f6b5c", "#5b4a7a", "#2f5d8a", "#8a5a2f"];

let engine = null;
let fragments = []; // {stroke, work, pose, frame, img, ink, born, color}
let queue = Promise.resolve();
let focusFrag = null;

Engine.create("../").then((e) => {
  engine = e;
  $("status").textContent = `${e.works.length.toLocaleString()} works ready`;
}).catch((err) => { $("status").textContent = "Couldn't load the index."; console.error(err); });

function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  collage.width = collage.clientWidth * dpr; collage.height = collage.clientHeight * dpr;
  draw();
}
window.addEventListener("resize", size);

pad.on("start", () => $("hint").classList.add("gone"));
pad.on("move", (s) => engine && engine.warm([s]));
pad.on("end", (s) => {
  if (isTap(s)) { pad.undo(); return tap(s.points[0]); }
  queue = queue.then(() => addFragment(s)); // keep strokes in order
});

function isTap(s) {
  let len = 0;
  for (let i = 1; i < s.points.length; i++) len += Math.hypot(s.points[i].x - s.points[i - 1].x, s.points[i].y - s.points[i - 1].y);
  return len < 6;
}

async function addFragment(stroke) {
  if (!engine) return;
  $("busy").classList.add("on");
  try {
    const used = fragments.slice(-8).map((f) => f.work);
    const r = await engine.match([stroke], { k: 28, alignK: 3, exclude: used });
    if (!r || !r.results.length || !pad.strokes.includes(stroke)) return;
    const best = r.results.find((x) => x.follow >= 0.6) || r.results[0];
    const p = await renderPassage(engine, best, r.frame, [stroke], { band: Math.max(44, r.frame.S * 0.4) });
    fragments.push({ stroke, work: best.work, pose: best.pose, frame: r.frame, passage: p, born: performance.now(),
      color: COLORS[fragments.length % COLORS.length] });
    sources();
    animate();
  } catch (err) { console.error(err); }
  finally { $("busy").classList.remove("on"); }
}

let anim = 0;
function animate() {
  cancelAnimationFrame(anim);
  const step = () => {
    draw();
    if (fragments.some((f) => performance.now() - f.born < 900)) anim = requestAnimationFrame(step);
  };
  step();
}

function draw() {
  const g = collage.getContext("2d");
  const dpr = collage.width / collage.clientWidth;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, collage.width, collage.height);
  for (const f of fragments) {
    const grow = Math.min(1, (performance.now() - f.born) / 900);
    const ease = 1 - Math.pow(1 - grow, 3);
    const p = f.passage;
    g.globalAlpha = ease * (focusFrag && focusFrag !== f ? 0.35 : 1);
    g.drawImage(p.canvas, p.x * dpr, p.y * dpr, p.w * dpr, p.h * dpr);
  }
  g.globalAlpha = 1;
}

function sources() {
  const el = $("sources");
  el.replaceChildren(...fragments.map((f) => {
    const w = engine.works[f.work];
    const a = document.createElement("a");
    a.href = w.url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = `${w.title}${w.artist ? " · " + w.artist : ""}`;
    a.style.setProperty("--c", f.color);
    a.classList.toggle("focus", f === focusFrag);
    return a;
  }));
}

function tap(p) {
  let best = null, bd = 60;
  for (const f of fragments) for (const q of f.stroke.points) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = f; }
  }
  focusFrag = best === focusFrag ? null : best;
  sources(); draw();
}

$("undo").onclick = () => {
  const s = pad.strokes[pad.strokes.length - 1];
  pad.undo();
  fragments = fragments.filter((f) => f.stroke !== s);
  focusFrag = null; sources(); draw();
  if (!pad.strokes.length) $("hint").classList.remove("gone");
};
$("clear").onclick = () => {
  pad.clear(); fragments = []; focusFrag = null; sources(); draw();
  $("hint").classList.remove("gone");
};
$("lines").onclick = (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  $("pad").style.opacity = on ? 1 : 0.05;
};

size();
