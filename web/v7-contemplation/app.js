// V7 · Contemplation -- a slow, meditative version.
//  1. Grind the ink: slow circles on an inkstone, paced by a breathing ring.
//     The longer and slower you grind, the darker your ink.
//  2. Choose one of three works (a different three each day).
//  3. Slow looking: the work lies faint on the paper at full resolution. Trace
//     the painter's strokes; where your brush meets their ink, it flows along
//     their brushwork and the painting comes up sharp. Notes on what the brush
//     is doing appear quietly. "Move along" goes to the next passage (right to
//     left on a handscroll); your ink fades like water-writing on stone.
//  4. Rest the brush: the whole work, then its colophon.
import { Engine, screenToInk } from "../shared/engine.js";
import { InkPaper, paperBackground, mulberry } from "../shared/inkpaper.js";
import { Brush } from "../shared/brush.js";
import { pictureEdge, applySoftMask } from "../shared/view.js";
import { openColophon } from "../shared/colophon.js";
import { describeWork, measurePassage, brushWords, TECHNIQUES } from "../shared/lore.js";
import { toast, soundToggle } from "../shared/ui.js";
import { BrushSound } from "../shared/brushsound.js";

const $ = (id) => document.getElementById(id);
const INK = 70;

paperBackground($("paper"), { kind: "xuan", tint: [235, 227, 208] });
const paper = new InkPaper($("ink"), { paper: "xuan" });
const brush = new Brush($("hit"), paper, { size: 6, tone: 0.75, water: 0.6 });
brush.disabled = true;
soundToggle(new BrushSound(brush, { volume: 0.16 }));
const view = $("view");
let engine = null;
Engine.create("../").then((e) => { engine = e; prepareChoices(); }).catch((err) => console.error(err));

// ---------------------------------------------------------------- breath
let inhale = true;
const breathEl = $("breath");
function breathe() {
  breathEl.className = "breath " + (inhale ? "in" : "out");
  setTimeout(() => { inhale = !inhale; breathe(); }, inhale ? 4000 : 6000);
}
breathe();

let whisperT = 0;
function whisper(text, ms = 9000) {
  const w = $("whisper");
  w.classList.remove("on");
  clearTimeout(whisperT);
  setTimeout(() => { w.textContent = text; w.classList.add("on"); whisperT = setTimeout(() => w.classList.remove("on"), ms); }, 900);
}

// ---------------------------------------------------------------- 1. grinding
const stone = $("stone");
let ground = 0, lastAng = null, grindDone = false, stickAt = null;
function drawStone() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const S = stone.clientWidth;
  if (stone.width !== S * dpr) { stone.width = stone.height = S * dpr; }
  const g = stone.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, S, S);
  // the stone
  const rg = g.createRadialGradient(S * 0.45, S * 0.4, S * 0.1, S / 2, S / 2, S / 2);
  rg.addColorStop(0, "#4a4744"); rg.addColorStop(1, "#262422");
  g.fillStyle = rg; g.beginPath(); g.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2); g.fill();
  // grinding surface, wet with ink as it darkens
  const k = Math.min(1, ground / 10);
  g.fillStyle = `rgba(${60 - 50 * k},${58 - 50 * k},${55 - 48 * k},1)`;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2); g.fill();
  g.fillStyle = `rgba(10,9,8,${0.15 + 0.7 * k})`;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2); g.fill();
  // sheen
  g.strokeStyle = `rgba(255,255,255,${0.05 + 0.12 * k})`; g.lineWidth = 2;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.3, -2.4, -1.4); g.stroke();
  // the inkstick under your finger
  if (stickAt) {
    g.save(); g.translate(stickAt[0], stickAt[1]); g.rotate(stickAt[2] + Math.PI / 2);
    g.fillStyle = "#14110e"; g.fillRect(-11, -26, 22, 52);
    g.fillStyle = "rgba(176,137,47,.7)"; g.fillRect(-7, -16, 14, 2); g.fillRect(-7, 14, 14, 2);
    g.restore();
  }
}
drawStone();
window.addEventListener("resize", drawStone);
stone.addEventListener("pointerdown", (e) => { stone.setPointerCapture(e.pointerId); lastAng = null; });
stone.addEventListener("pointermove", (e) => {
  if (!e.buttons && e.pointerType === "mouse") return;
  const r = stone.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const a = Math.atan2(y - r.height / 2, x - r.width / 2);
  stickAt = [x, y, a];
  if (lastAng !== null) {
    let d = a - lastAng.a;
    if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    const dt = Math.max(1, e.timeStamp - lastAng.t) / 1000;
    const w = Math.abs(d) / dt;                         // rad/s
    const calm = w < 5 ? 1 : Math.max(0.15, 5 / w);     // slow circles grind best
    ground += (Math.abs(d) / (2 * Math.PI)) * calm;
    $("meter").style.width = `${Math.min(100, ground * 10)}%`;
    if (w > 9) $("grindText").textContent = "Slower. The stick should glide; there is no hurry.";
    if (ground >= 10 && !grindDone) finishGrinding();
  }
  lastAng = { a, t: e.timeStamp };
  drawStone();
});
stone.addEventListener("pointerup", () => { stickAt = null; drawStone(); });
$("skip").onclick = () => finishGrinding(true);

function finishGrinding(skipped = false) {
  grindDone = true;
  const k = Math.min(1, ground / 10);
  brush.opts.tone = 0.35 + 0.6 * k;
  $("grind").classList.remove("on");
  $("choose").classList.add("on");
  if (!skipped) toast(k >= 1 ? "The ink is dark and ready." : "A pale ink: good for quiet, distant things.");
}

// ---------------------------------------------------------------- 2. choosing
function candidates() {
  const out = [];
  engine.works.forEach((w, i) => {
    if (!w.hi || !/ink on (paper|silk)/i.test(w.medium || "") || /color|gold/i.test(w.medium || "")) return;
    out.push(i);
  });
  return out;
}

let reroll = 0;
function prepareChoices() {
  const day = Math.floor(Date.now() / 864e5);
  const rnd = mulberry(day * 7919 + reroll * 104729);
  const pool = candidates();
  const picks = [];
  while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  $("choices").replaceChildren(...picks.map((wi) => {
    const w = engine.works[wi];
    const b = document.createElement("button");
    const c = document.createElement("canvas");
    b.append(c, document.createTextNode(w.title), Object.assign(document.createElement("div"), { textContent: w.artist || w.culture, style: "color:#6d6150;margin-top:2px" }));
    engine.loadPainting(wi).then((img) => {
      const dpr = 2, W = c.clientWidth || 200, H = c.clientHeight || 260;
      c.width = W * dpr; c.height = H * dpr;
      const g = c.getContext("2d");
      const bx = w.box || [0, 0, 1, 1];
      const sw = (bx[2] - bx[0]) * img.naturalWidth, sh = (bx[3] - bx[1]) * img.naturalHeight;
      const k = Math.max(c.width / sw, c.height / sh);
      g.drawImage(img, bx[0] * img.naturalWidth + (sw - c.width / k) / 2, bx[1] * img.naturalHeight + (sh - c.height / k) / 2, c.width / k, c.height / k, 0, 0, c.width, c.height);
    });
    b.onclick = () => begin(wi);
    return b;
  }));
}

$("others").onclick = () => { reroll++; if (engine) prepareChoices(); };

// ---------------------------------------------------------------- 3. slow looking
let S = null; // session: {work, w, img, ink, regions, ri, cam, mask, maskData, visited, frontier, budget, layer}
const encounters = [];

async function begin(wi) {
  $("choose").classList.remove("on");
  $("busy").classList.add("on");
  const w = engine.works[wi];
  const [img, ink] = await Promise.all([engine.loadPainting(wi), engine.ensureInk(wi)]);
  $("busy").classList.remove("on");
  const mask = document.createElement("canvas"); mask.width = ink.W; mask.height = ink.H;
  S = { work: wi, w, img, ink, regions: passages(ink, w), ri: 0, mask, maskData: mask.getContext("2d").createImageData(ink.W, ink.H),
    visited: new Int32Array(ink.W * ink.H).fill(-1), frontier: [], budget: 0, layer: 0, cam: null, camFrom: null, camT: 1, revealAll: 0 };
  $("workname").textContent = `${w.title}${w.artist ? " · " + w.artist : ""}`;
  S.cam = camFor(S.regions[0]);
  brush.disabled = false;
  const d = describeWork(w, w);
  whisper(d.formatText || "Look first. Find where the brush entered, and where it lifted away.", 11000);
  setTimeout(() => passageWhisper(), 13000);
  render();
}

/** The passages to visit: windows with clear, moderate brushwork, in reading order. */
function passages(ink, w) {
  const { W, H, data } = ink;
  const bx = w.box || [0, 0, 1, 1];
  const X0 = bx[0] * W, Y0 = bx[1] * H, X1 = bx[2] * W, Y1 = bx[3] * H;
  const short = Math.min(X1 - X0, Y1 - Y0);
  const s = short * (w.aspect < 0.6 ? 0.9 : 0.55);
  const cand = [];
  for (let y = Y0; y + s <= Y1 + 1; y += s / 3) for (let x = X0; x + s <= X1 + 1; x += s / 3) {
    const m = measurePassage(ink, [x, y, x + s, y + s]);
    if (!m) continue;
    const score = -Math.abs(m.coverage - 0.16) + 0.3 * Math.min(1, m.widthVar);
    cand.push({ x, y, s, score });
  }
  cand.sort((a, b) => b.score - a.score);
  const pick = [];
  for (const c of cand) {
    if (pick.length >= 6) break;
    if (pick.every((p) => Math.abs(p.x - c.x) > s * 0.6 || Math.abs(p.y - c.y) > s * 0.6)) pick.push(c);
  }
  if (!pick.length) pick.push({ x: X0, y: Y0, s: Math.max(X1 - X0, Y1 - Y0) });
  // reading order: handscrolls right to left; everything else top to bottom
  if (w.aspect < 0.6) pick.sort((a, b) => b.x - a.x); else pick.sort((a, b) => a.y - b.y || b.x - a.x);
  return pick;
}

/** Camera for a region (ink-map px): ink px -> screen px is (p - c) * k + screen centre. */
function camFor(r) {
  const vw = view.clientWidth, vh = view.clientHeight;
  const k = (Math.min(vw, vh * 0.86) * 0.92) / r.s;
  return { cx: r.x + r.s / 2, cy: r.y + r.s / 2, k };
}
function camNow() {
  if (S.camT >= 1 || !S.camFrom) return S.cam;
  const t = S.camT, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const a = S.camFrom, b = S.cam;
  return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, k: a.k * Math.pow(b.k / a.k, e) };
}
/** pose/frame pair (the shared convention) for the current camera. */
function poseFrame(cam) {
  const S0 = Math.min(view.clientWidth, view.clientHeight);
  return { pose: { cx: cam.cx, cy: cam.cy, s: S0 / cam.k, th: 0 }, frame: { cx: view.clientWidth / 2, cy: view.clientHeight / 2, S: S0 } };
}

// breath and stroke: painters were taught to move the brush on the out-breath
let onExhale = 0, strokesN = 0, breathNoted = false;
brush.on("start", () => {
  document.body.classList.add("quiet");
  strokesN++; if (!inhale) onExhale++;
  if (!breathNoted && strokesN >= 6) {
    breathNoted = true;
    whisper(onExhale / strokesN >= 0.6
      ? "Most of your strokes began as you breathed out. That is how the brush was taught: the stroke rides the breath."
      : "Try beginning each stroke as you breathe out, when the ring contracts. Let the stroke ride the breath.", 9000);
  }
});
brush.on("end", (stroke) => {
  if (!S || S.camT < 1) return;
  const { pose, frame } = poseFrame(S.cam);
  const seeds = [];
  const R = 2;
  for (let i = 0; i < stroke.points.length; i += 2) {
    const p = stroke.points[i];
    const [qx, qy] = screenToInk(pose, frame, p.x - brush.offset.x, p.y - brush.offset.y);
    const x0 = Math.round(qx), y0 = Math.round(qy);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= S.ink.W || y >= S.ink.H) continue;
      const k = y * S.ink.W + x;
      if (S.ink.data[k] >= INK && S.visited[k] < 0) { S.visited[k] = S.layer; seeds.push(k); S.maskData.data[k * 4 + 3] = 255; }
    }
  }
  if (seeds.length) {
    S.frontier.push(...seeds);
    S.budget += 30 + Math.round(stroke.points.length / 4);
    if (!encounters.length) encounters.push({ work: S.work, pose, frame, strokes: [] });
    encounters[0].strokes.push(stroke);
  } else if (Math.random() < 0.5) {
    whisper("Find the painter's line, and let your brush follow it.", 5000);
  }
});

const NB = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) NB.push([dx, dy]);
function flowStep() {
  const { ink, visited, maskData } = S;
  const next = [];
  S.layer++;
  for (const k of S.frontier) {
    const x = k % ink.W, y = (k / ink.W) | 0;
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ink.W || ny >= ink.H) continue;
      const n = ny * ink.W + nx;
      if (visited[n] >= 0 || ink.data[n] < INK) continue;
      visited[n] = S.layer; next.push(n); maskData.data[n * 4 + 3] = 255;
    }
  }
  S.frontier = next; S.budget--;
}

const tmp = document.createElement("canvas");
function render() {
  if (!S) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (view.width !== view.clientWidth * dpr) { view.width = view.clientWidth * dpr; view.height = view.clientHeight * dpr; }
  if (tmp.width !== view.width || tmp.height !== view.height) { tmp.width = view.width; tmp.height = view.height; }
  const cam = camNow();
  const u = S.img.naturalWidth / S.ink.W;                   // image px per ink px
  // image px -> canvas px
  const kk = (cam.k / u) * dpr;
  const M = [cam.k / u, 0, 0, cam.k / u, view.clientWidth / 2 - cam.cx * cam.k, view.clientHeight / 2 - cam.cy * cam.k];
  const g = view.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, view.width, view.height);
  g.imageSmoothingQuality = "high";
  // faint: the whole work, barely there
  const t = tmp.getContext("2d");
  t.setTransform(1, 0, 0, 1, 0, 0); t.clearRect(0, 0, tmp.width, tmp.height);
  t.imageSmoothingQuality = "high";
  t.setTransform(kk, 0, 0, kk, M[4] * dpr, M[5] * dpr);
  t.drawImage(S.img, 0, 0);
  pictureEdge(t, S.w, S.img, M, [dpr, 0, 0]);
  g.globalAlpha = 0.14 + 0.86 * S.revealAll;
  g.drawImage(tmp, 0, 0);
  g.globalAlpha = 1;
  // revealed: full strength where the ink has flowed
  if (S.revealAll < 1) {
    S.mask.getContext("2d").putImageData(S.maskData, 0, 0);
    applySoftMask(t, S.mask, [cam.k * dpr, 0, 0, cam.k * dpr, (view.clientWidth / 2 - cam.cx * cam.k) * dpr,
      (view.clientHeight / 2 - cam.cy * cam.k) * dpr], Math.max(2, cam.k * dpr * 0.9));
    g.drawImage(tmp, 0, 0);
  }
}

let lastT = performance.now();
function loop(now) {
  const dt = (now - lastT) / 1000; lastT = now;
  if (S) {
    let dirty = false;
    if (S.camT < 1) { S.camT = Math.min(1, S.camT + dt / 2.8); dirty = true; if (S.camT >= 1) brush.disabled = false; }
    for (let i = 0; i < 2 && S.budget > 0 && S.frontier.length; i++) { flowStep(); dirty = true; }
    if (S.revealAll > 0 && S.revealAll < 1) { S.revealAll = Math.min(1, S.revealAll + dt / 4); dirty = true; }
    if (S.fading > 0) { paper.fade(0.93); S.fading--; if (!S.fading) paper.clear(); }
    if (dirty) render();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.addEventListener("resize", () => { paperBackground($("paper"), { kind: "xuan", tint: [235, 227, 208] }); render(); });

function passageWhisper() {
  if (!S) return;
  const r = S.regions[S.ri];
  const m = measurePassage(S.ink, [r.x, r.y, r.x + r.s, r.y + r.s]);
  const words = brushWords(m);
  let text = words.length ? `Here: ${words.join(", ")}.` : "Here the paper is mostly empty; the space is part of the painting.";
  if (m && m.broken > 0.55) text += ` ${TECHNIQUES.flyingwhite.why}`;
  else if (m && m.widthVar > 0.85) text += ` ${TECHNIQUES.liftpress.why}`;
  else if (m && m.broken < 0.3) text += ` ${TECHNIQUES.brokenink.how}`;
  whisper(text, 12000);
}

$("next").onclick = () => {
  if (!S) return;
  S.ri = (S.ri + 1) % S.regions.length;
  S.camFrom = camNow(); S.cam = camFor(S.regions[S.ri]); S.camT = 0;
  brush.disabled = true;
  S.fading = 40;             // like water-writing on stone, your strokes evaporate
  setTimeout(passageWhisper, 3200);
};

$("rest").onclick = () => {
  if (!S) { location.href = "../"; return; }
  const bx = S.w.box || [0, 0, 1, 1];
  const r = { x: bx[0] * S.ink.W, y: bx[1] * S.ink.H, s: Math.max((bx[2] - bx[0]) * S.ink.W, (bx[3] - bx[1]) * S.ink.H) };
  S.camFrom = camNow(); S.cam = camFor(r); S.camT = 0; S.revealAll = 0.001;
  brush.disabled = true; S.fading = 40;
  const d = describeWork(S.w, S.w);
  whisper([d.schoolText, d.materialText].filter(Boolean).join(" ") || "The whole work, as the painter left it.", 9000);
  setTimeout(() => {
    const enc = encounters.length ? encounters : [{ work: S.work, ...poseFrame(S.cam), strokes: [] }];
    openColophon(engine, enc, brush.strokes, { title: "Colophon", onClose: () => location.reload() });
  }, 7500);
};
