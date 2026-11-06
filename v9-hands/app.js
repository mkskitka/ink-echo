// V9 · Many Hands -- Collage with real ink, and a comparison at the end.
// Each stroke is matched alone and opens a sharp, snapped window onto a
// different painting. A card for each hand says how that master's brush moves
// in the passage you met (measured from its ink). "Compare the hands" writes
// the colophon: your brushwork beside theirs, and theirs beside each other.
import { Engine } from "../shared/engine.js";
import { InkPaper, paperBackground } from "../shared/inkpaper.js";
import { Brush } from "../shared/brush.js";
import { renderPassage } from "../shared/view.js";
import { openColophon, passageBox } from "../shared/colophon.js";
import { measurePassage, brushWords, describeWork } from "../shared/lore.js";
import { inkwells, toast, soundToggle } from "../shared/ui.js";
import { BrushSound } from "../shared/brushsound.js";

const $ = (id) => document.getElementById(id);
const COLORS = ["#a8322a", "#b0892f", "#3f6b5c", "#5b4a7a", "#2f5d8a", "#8a5a2f"];
paperBackground($("paper"), { kind: "xuan" });
const paper = new InkPaper($("ink"), { paper: "xuan" });
const brush = new Brush($("hit"), paper, { size: 7 });
inkwells(brush);
soundToggle(new BrushSound(brush));
const win = $("windows");
let engine = null, windows = [], queue = Promise.resolve();
const encounters = [];
Engine.create("../").then((e) => { engine = e; $("status").textContent = `${e.works.length.toLocaleString()} works ready`; })
  .catch((err) => { $("status").textContent = "Could not load the index."; console.error(err); });

brush.on("start", () => $("hint").classList.add("gone"));
brush.on("move", (s) => engine && engine.warm([s]));
brush.on("end", (s) => { queue = queue.then(() => meet(s)); });

const parentOf = (wi) => { const w = engine.works[wi]; return w.parent ?? w.id; };

async function meet(stroke) {
  if (!engine) return;
  $("busy").classList.add("on");
  try {
    // a different hand each time: skip every view of works already met
    const met = new Set(windows.map((w) => parentOf(w.work)));
    const exclude = engine.works.map((w, i) => (met.has(w.parent ?? w.id) ? i : -1)).filter((i) => i >= 0);
    const r = await engine.match([stroke], { k: 28, alignK: 4, exclude });
    if (!r || !r.results.length) return;
    const best = r.results[0];
    if (best.follow < 0.25) { toast("No master's stroke runs quite like that one. It stays yours."); return; }
    const p = await renderPassage(engine, best, r.frame, [stroke], { band: Math.max(56, r.frame.S * 0.4), inkOnly: true });
    const color = COLORS[windows.length % COLORS.length];
    windows.push({ ...p, work: best.work, born: performance.now(), color });
    encounters.push({ work: best.work, pose: best.pose, frame: r.frame, strokes: [stroke], warp: best.warp });
    animate();
    card(best, color);
  } catch (err) { console.error(err); }
  finally { $("busy").classList.remove("on"); }
}

async function card(res, color) {
  const w = engine.works[res.work];
  const ink = await engine.ensureInk(res.work);
  const words = brushWords(measurePassage(ink, passageBox(res.pose)));
  const d = describeWork(w, w);
  const el = document.createElement("div");
  el.className = "hand"; el.style.setProperty("--c", color);
  el.innerHTML = `<b></b><span class="m"></span><div class="w"></div><a target="_blank" rel="noopener">metmuseum.org ↗</a>`;
  el.querySelector("b").textContent = w.artist || w.title;
  el.querySelector(".m").textContent = [w.artist ? w.title : "", d.school || d.period || w.culture].filter(Boolean).join(" · ");
  el.querySelector(".w").textContent = words.length ? `Here: ${words.join(", ")}.` : "";
  el.querySelector("a").href = w.url;
  $("hands").append(el);
  el.scrollIntoView({ behavior: "smooth", inline: "end" });
}

let anim = 0;
function animate() {
  cancelAnimationFrame(anim);
  const step = () => { draw(); if (windows.some((w) => performance.now() - w.born < 1200)) anim = requestAnimationFrame(step); };
  step();
}
function draw() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (win.width !== win.clientWidth * dpr) { win.width = win.clientWidth * dpr; win.height = win.clientHeight * dpr; }
  const g = win.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, win.width, win.height);
  for (const w of windows) {
    g.globalAlpha = Math.min(1, (performance.now() - w.born) / 1200) * 0.92;
    g.drawImage(w.canvas, w.x * dpr, w.y * dpr, w.w * dpr, w.h * dpr);
  }
  g.globalAlpha = 1;
}
window.addEventListener("resize", () => { paperBackground($("paper"), { kind: "xuan" }); draw(); });

$("clear").onclick = () => {
  brush.clear(); windows = []; encounters.length = 0; draw(); $("hands").replaceChildren();
  $("hint").classList.remove("gone");
};
$("doneBtn").onclick = () => {
  if (!engine || encounters.length < 2) { toast("Meet at least two hands first."); return; }
  openColophon(engine, encounters, brush.strokes, { title: "Many hands" });
};
