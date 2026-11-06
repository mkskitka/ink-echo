// V8 · Brush Lessons -- learning the brush the way it was taught: by copying.
// Each lesson (after the Mustard Seed Garden Manual's stroke-by-stroke method)
// plays a model stroke in pale ink with a teacher's timing and pressure. You
// copy it on the same sheet; the ink spreads, runs dry and can't be erased.
// After each stroke: a teacher's reading of its mechanics, and a window onto a
// Met painting of the same subject where a master's stroke matches yours.
import { Engine } from "../shared/engine.js";
import { InkPaper, paperBackground } from "../shared/inkpaper.js";
import { Brush } from "../shared/brush.js";
import { renderPassage } from "../shared/view.js";
import { openColophon } from "../shared/colophon.js";
import { LESSONS, TECHNIQUES, TREASURES, readStroke } from "../shared/lore.js";
import { inkwells, toast, soundToggle } from "../shared/ui.js";
import { BrushSound } from "../shared/brushsound.js";
import { YONG } from "../shared/lore.js";

const $ = (id) => document.getElementById(id);
paperBackground($("paper"), { kind: "xuan" });
const paper = new InkPaper($("ink"), { paper: "xuan" });
const brush = new Brush($("hit"), paper, { size: 8 });
inkwells(brush);
soundToggle(new BrushSound(brush));
const win = $("windows");
let engine = null, lesson = null, playing = false;
let windows = [];            // {canvas, x, y, w, h, born}
const encounters = [];
Engine.create("../").then((e) => { engine = e; }).catch((err) => console.error(err));

// ---------------------------------------------------------------- picker
$("grid").replaceChildren(...LESSONS.map((l) => {
  const b = document.createElement("button");
  b.innerHTML = `<b>${l.title}</b><span>${l.techniques.map((t) => TECHNIQUES[t].name).join(" · ")}</span>`;
  b.onclick = () => start(l);
  return b;
}));
$("treasures").innerHTML = `<p><b>The four treasures of the study.</b></p>` +
  Object.entries(TREASURES).map(([k, v]) => `<p><b>${{ brush: "Brush", ink: "Ink", stone: "Inkstone", paper: "Paper and silk" }[k]}.</b> ${v}</p>`).join("");

function start(l) {
  lesson = l;
  $("picker").classList.add("gone");
  $("lesson").hidden = false; $("lesson").classList.remove("min");
  $("lTitle").textContent = `${l.title} · ${l.subject}`;
  $("lIntro").textContent = l.intro;
  $("lChips").replaceChildren(...l.techniques.map((t) => {
    const b = document.createElement("button");
    b.textContent = `${TECHNIQUES[t].name} ${TECHNIQUES[t].term.split(" ")[0]}`;
    b.onclick = () => explain(t);
    return b;
  }));
  sheet();
  if (l.id === "yong") note({ html: YONG.map((y) => `<b>${y.term}</b> ${y.name}: ${y.text}`).join("<br>"), kind: "src" }, 26000);
  setTimeout(demo, 700);
}

function explain(t) {
  const T = TECHNIQUES[t];
  $("modalBody").innerHTML = `<b>${T.name}</b> <i>${T.term}</i><p style="margin-top:8px">${T.how}</p><p style="margin-top:8px">${T.why}</p>`;
  $("modal").classList.add("on");
}
$("modal").onclick = () => $("modal").classList.remove("on");

// ---------------------------------------------------------------- the model stroke
/** The teacher's strokes for a lesson, in the left half of the sheet. */
function modelStrokes(kind) {
  const W = $("hit").clientWidth, H = $("hit").clientHeight;
  const cx = W * 0.3, cy = H * 0.55, S = Math.min(W * 0.42, H * 0.36);
  const n = 70, T = (f) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
  switch (kind) {
    case "yong": {
      // 永 in a box on the left half: [x, y] in 0..1, with a pressure profile per stroke
      const B = Math.min(W * 0.44, H * 0.42), ox = cx - B / 2, oy = cy - B / 2;
      const seg = (pts, press, n2 = 26) => {
        const out = [];
        for (let k = 1; k < pts.length; k++) for (let i = 0; i <= n2; i++) {
          const t = i / n2, a = pts[k - 1], b = pts[k];
          const g = (k - 1 + t) / (pts.length - 1);
          out.push([ox + (a[0] + (b[0] - a[0]) * t) * B, oy + (a[1] + (b[1] - a[1]) * t) * B, press(g)]);
        }
        return out;
      };
      return [
        { ms: 380, holdStart: 200, holdEnd: 150, pts: seg([[0.47, 0.06], [0.56, 0.15]], (g) => 0.45 + 0.5 * g) },                       // 側 dot
        { ms: 1500, holdStart: 200, pts: seg([[0.33, 0.30], [0.57, 0.28], [0.57, 0.86], [0.49, 0.80]],                                  // 勒 努 趯
          (g) => (g < 0.05 ? 0.85 : g < 0.33 ? 0.5 : g < 0.38 ? 0.85 : g < 0.9 ? 0.6 : 0.6 - (g - 0.9) * 5)), holdEnd: 0 },
        { ms: 900, holdStart: 150, pts: seg([[0.20, 0.50], [0.40, 0.46], [0.17, 0.76]], (g) => (g < 0.5 ? 0.5 : 0.7 - (g - 0.5) * 1.2)) }, // 策 掠
        { ms: 380, holdStart: 120, pts: seg([[0.82, 0.38], [0.62, 0.57]], (g) => 0.75 - 0.65 * g) },                                    // 啄
        { ms: 1200, pts: seg([[0.60, 0.50], [0.76, 0.70], [0.92, 0.88]], (g) => (g < 0.75 ? 0.25 + g * 0.95 : 0.95 - (g - 0.75) * 3.4)), holdEnd: 0 }, // 磔
      ];
    }
    case "circle": return [{ ms: 2600, pts: T((t) => { const a = -2.2 + t * Math.PI * 1.93; const r = S * 0.45 * (1 + 0.04 * Math.sin(t * 9));
      return [cx + r * Math.cos(a), cy + r * Math.sin(a), 0.85 - 0.55 * t]; }), holdStart: 350 }];
    case "stalk": return [0, 1, 2, 3].map((k) => ({ ms: 650, holdStart: 260, holdEnd: 180, pts: T((t) => {
      const y0 = cy + S * 0.75 - k * S * 0.42;
      return [cx + Math.sin(k * 1.3) * 3 + t * 2, y0 - t * S * 0.38, t < 0.12 ? 0.9 : t > 0.9 ? 0.8 : 0.55]; }) }));
    case "leaf": return [[-0.6, 0.2], [-0.2, 0.55], [0.35, 0.15], [0.1, -0.3]].map(([a, b], k) => ({ ms: 260, holdStart: 120, pts: T((t) => {
      const L = S * 0.7, ang = -0.5 + k * 0.55;
      const x = cx + a * S * 0.4 + Math.cos(ang) * L * t, y = cy + b * S * 0.4 + Math.sin(ang) * L * t + Math.sin(t * Math.PI) * 10;
      return [x, y, t < 0.15 ? 0.95 : Math.max(0.05, 0.95 - (t - 0.15) * 1.15)]; }) }));
    case "orchid": return [{ ms: 1700, holdStart: 120, pts: T((t) => [cx - S * 0.55 + t * S * 1.1, cy + S * 0.5 - Math.sin(t * Math.PI * 0.9) * S * 0.8,
      0.15 + 0.7 * Math.sin(Math.PI * Math.min(1, t * 1.6)) ** 2 * (t < 0.62 ? 1 : 0.5) + (t > 0.62 ? 0.25 * Math.sin((t - 0.62) * 8) ** 2 : 0)]) },
      { ms: 1300, holdStart: 80, pts: T((t) => [cx - S * 0.35 + t * S * 0.5, cy + S * 0.5 - Math.sin(t * Math.PI * 0.8) * S * 0.95 - t * 10, 0.2 + 0.6 * Math.sin(Math.PI * t)]) }];
    case "plum": return [{ ms: 900, holdStart: 200, pts: (() => {
      const knots = [[0, 0.6], [0.15, 0.25], [0.05, -0.05], [0.3, -0.3], [0.25, -0.6]];
      const out = [];
      for (let k = 1; k < knots.length; k++) for (let i = 0; i <= 15; i++) {
        const t = i / 15, a = knots[k - 1], b = knots[k];
        out.push([cx + (a[0] + (b[0] - a[0]) * t) * S, cy + (a[1] + (b[1] - a[1]) * t) * S, i < 3 ? 0.85 : 0.5]);
      }
      return out; })() }];
    case "rock": return [{ ms: 1100, pts: T((t) => { const a = Math.PI * (1.05 + 1.1 * t); return [cx + Math.cos(a) * S * 0.45, cy + Math.sin(a) * S * 0.32, 0.6, 50]; }) },
      ...[0, 1, 2].map((k) => ({ ms: 420, pts: T((t) => [cx - S * 0.25 + k * S * 0.15, cy - S * 0.12 + t * S * 0.3, 0.75, 60]) }))];
  }
  return [];
}

async function demo() {
  if (!lesson || playing) return;
  playing = true; brush.disabled = true;
  const keepTone = brush.opts.tone, keepWater = brush.opts.water;
  brush.opts.tone = 0.32;                     // the model in pale ink
  if (lesson.demo.kind === "plum") brush.opts.water = 0.28;
  note({ text: "Watch the model: where it presses, where it pauses, how fast it travels.", kind: "src" }, 4000);
  for (const m of modelStrokes(lesson.demo.kind)) await brush.demo(m.pts, m.ms, m);
  brush.opts.tone = keepTone; brush.opts.water = keepWater;
  brush.disabled = false; playing = false;
  setTimeout(() => $("lesson").classList.add("min"), 1500);
  note({ text: "Now copy it on the right. Breathe out as the brush travels.", kind: "src" }, 5000);
}

function sheet() {
  brush.clear(); windows = []; drawWindows();
  $("notes").replaceChildren();
}

// ---------------------------------------------------------------- your strokes
brush.on("start", (s) => { if (!s.ghost) $("lesson").classList.add("min"); });
brush.on("end", async (s) => {
  if (s.ghost || !lesson) return;
  const notes = readStroke(s.mech, lesson);
  for (const n of notes.slice(0, 3)) note({ text: n.text, kind: n.good ? "" : "try" });
  meetMaster(s);
});

async function meetMaster(stroke) {
  if (!engine) return;
  $("busy").classList.add("on");
  try {
    const tags = new Set(lesson.tags);
    const cls = lesson.classification;
    // the subject's paintings, plus the painting manuals themselves (Mustard Seed Garden, Hokusai's sketchbooks)
    const isManual = (w) => w.classification === "Illustrated Books" || /mustard seed|ten bamboo|manual|sketchbook/i.test(w.title);
    const only = tags.size || cls ? engine.works.map((w, i) => (((w.tags || []).some((t) => tags.has(t)) || (cls && w.classification === cls) || isManual(w)) ? i : -1)).filter((i) => i >= 0) : null;
    const used = windows.map((w) => w.work);
    const r = await engine.match([stroke], { k: 24, alignK: 4, exclude: used, only });
    if (!r || !r.results.length) return;
    const best = r.results[0];
    if (best.follow < 0.25) { note({ text: "No master's stroke quite like that one in the collection. Try again, closer to the model.", kind: "try" }); return; }
    const p = await renderPassage(engine, best, r.frame, [stroke], { band: Math.max(50, r.frame.S * 0.35), inkOnly: true });
    windows.push({ ...p, work: best.work, born: performance.now() });
    encounters.push({ work: best.work, pose: best.pose, frame: r.frame, strokes: [stroke], warp: best.warp });
    animate();
    const w = engine.works[best.work];
    const manual = /mustard seed/i.test(w.title) ? "A page from the Mustard Seed Garden Manual itself, teaching a stroke like yours: " :
      /ten bamboo/i.test(w.title) ? "A page from the Ten Bamboo Studio Manual (1633), teaching a stroke like yours: " :
      /sketchbook|manga/i.test(w.title) ? "From Hokusai's sketchbooks, made to teach drawing: " : "A stroke like yours: ";
    note({ html: `${manual}<a href="${w.url}" target="_blank" rel="noopener">${w.title}</a>${w.artist ? " · " + w.artist : ""}`, kind: "src" }, 9000);
  } catch (err) { console.error(err); }
  finally { $("busy").classList.remove("on"); }
}

function note({ text, html, kind = "" }, ms = 7000) {
  const el = document.createElement("div");
  el.className = "note " + kind;
  if (html) el.innerHTML = html; else el.textContent = text;
  $("notes").append(el);
  while ($("notes").children.length > 4) $("notes").firstChild.remove();
  setTimeout(() => el.remove(), ms);
}

let anim = 0;
function animate() {
  cancelAnimationFrame(anim);
  const step = () => { drawWindows(); if (windows.some((w) => performance.now() - w.born < 1400)) anim = requestAnimationFrame(step); };
  step();
}
function drawWindows() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (win.width !== win.clientWidth * dpr) { win.width = win.clientWidth * dpr; win.height = win.clientHeight * dpr; }
  const g = win.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, win.width, win.height);
  for (const w of windows) {
    g.globalAlpha = Math.min(1, (performance.now() - w.born) / 1400) * 0.9;
    g.drawImage(w.canvas, w.x * dpr, w.y * dpr, w.w * dpr, w.h * dpr);
  }
  g.globalAlpha = 1;
}
window.addEventListener("resize", () => { paperBackground($("paper"), { kind: "xuan" }); drawWindows(); });

$("lessonsBtn").onclick = () => { $("picker").classList.remove("gone"); $("lesson").hidden = true; };
$("demoBtn").onclick = () => { $("lesson").classList.remove("min"); demo(); };
$("sheetBtn").onclick = () => { sheet(); toast("A fresh sheet. The model is gone: try it from memory, or watch again."); };
$("doneBtn").onclick = () => {
  if (!engine) return;
  const mine = brush.strokes.filter((s) => !s.ghost);
  if (!mine.length) { toast("Make a few strokes first."); return; }
  openColophon(engine, encounters, mine, { title: lesson ? `Colophon to a lesson: ${lesson.title}` : "Colophon" });
};
