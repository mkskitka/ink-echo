// V5 · Bloom — your line touches the painting's real ink, and ink flows from
// those contact points along the painter's *connected* strokes (a flood fill
// over the ink map that bridges small gaps), revealing the work in the order a
// brush could have travelled. Longer strokes carry more ink.
import { Engine, imageAffine, poseAffine, screenToInk } from "../shared/engine.js";
import { Pad } from "../shared/pad.js";
import { setCaption, applySoftMask, pictureEdge } from "../shared/view.js";

const $ = (id) => document.getElementById(id);
const pad = new Pad($("pad"), { base: 2.4 });
const layer = $("bloom");
const INK = 70;             // ink-map value that counts as ink
const LAYERS_PER_FRAME = 2; // flow speed

let engine = null;
let anchor = null;    // {work, pose, frame, img, ink, visited: Int32Array(time), mask, glow}
let frontier = [];
let budget = 0;       // flow layers left
let layerNo = 0;
let dry = 0;          // consecutive strokes that found no ink
let running = false;

Engine.create("../").then((e) => {
  engine = e;
  $("status").textContent = `${e.works.length.toLocaleString()} works ready`;
}).catch((err) => { $("status").textContent = "Couldn't load the index."; console.error(err); });

function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  layer.width = layer.clientWidth * dpr; layer.height = layer.clientHeight * dpr;
  paint();
}
window.addEventListener("resize", size);

pad.on("start", () => $("hint").classList.add("gone"));
pad.on("end", (s) => onStroke(s));

async function onStroke(stroke) {
  if (!engine) return;
  $("busy").classList.add("on");
  try {
    if (!anchor) await setAnchor(pad.strokes);
    if (!anchor) return;
    let seeds = seedsFor(stroke);
    if (!seeds.length) {
      dry++;
      if (dry >= 2) {
        toast("No ink there. Looking for a painting that meets your lines…");
        await setAnchor(pad.strokes.slice(-2));
        seeds = anchor ? pad.strokes.slice(-2).flatMap(seedsFor) : [];
        dry = 0;
      } else {
        toast("Dry paper. Try running along a line nearby");
      }
    } else dry = 0;
    if (seeds.length) {
      frontier.push(...seeds);
      budget += 25 + Math.round(strokeLength(stroke) / 6);
      if (!running) loop();
    }
  } catch (err) { console.error(err); }
  finally { $("busy").classList.remove("on"); }
}

async function setAnchor(strokes) {
  const prev = anchor ? anchor.work : null;
  const r = await engine.match(strokes, { k: 28, alignK: 6, exclude: prev != null ? [prev] : [] });
  if (!r || !r.results.length) return;
  const best = r.results.find((x) => x.follow >= 0.25) || r.results[0];
  const w = engine.works[best.work];
  const [img, ink] = await Promise.all([engine.loadPainting(best.work), engine.ensureInk(best.work)]);
  const mask = document.createElement("canvas"); mask.width = ink.W; mask.height = ink.H;
  const glow = document.createElement("canvas"); glow.width = ink.W; glow.height = ink.H;
  anchor = { work: best.work, pose: best.pose, frame: r.frame, img, ink,
    visited: new Int32Array(ink.W * ink.H).fill(-1), mask, glow,
    maskData: mask.getContext("2d").createImageData(ink.W, ink.H),
    glowData: glow.getContext("2d").createImageData(ink.W, ink.H) };
  frontier = []; budget = 0; layerNo = 0;
  setCaption($("caption"), w);
}

/** Ink-map pixels under (or within 2px of) the stroke. */
function seedsFor(stroke) {
  const { ink, pose, frame, visited } = anchor;
  const out = [];
  const R = 2;
  for (let i = 0; i < stroke.points.length; i += 2) {
    const p = stroke.points[i];
    const [qx, qy] = screenToInk(pose, frame, p.x, p.y);
    const x0 = Math.round(qx), y0 = Math.round(qy);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= ink.W || y >= ink.H) continue;
      const k = y * ink.W + x;
      if (ink.data[k] >= INK && visited[k] < 0) { visited[k] = layerNo; out.push(k); mark(k, layerNo); }
    }
  }
  return out;
}

const NB = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) NB.push([dx, dy]); // bridges 1px gaps

function step() {
  const { ink, visited } = anchor;
  const W = ink.W, H = ink.H;
  const next = [];
  layerNo++;
  for (const k of frontier) {
    const x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (visited[n] >= 0 || ink.data[n] < INK) continue;
      visited[n] = layerNo;
      next.push(n);
      mark(n, layerNo);
    }
  }
  frontier = next;
  budget--;
}

function mark(k, t) {
  const a = anchor;
  a.maskData.data[k * 4 + 3] = 255;
  // glowing front: seal red, fades as the flow moves on
  a.glowData.data[k * 4] = 168; a.glowData.data[k * 4 + 1] = 50; a.glowData.data[k * 4 + 2] = 42;
  a.glowData.data[k * 4 + 3] = 220;
}

function fadeGlow() {
  const d = anchor.glowData.data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) d[i] = Math.max(0, d[i] - 14);
}

function loop() {
  running = true;
  const tick = () => {
    if (!anchor) { running = false; return; }
    for (let i = 0; i < LAYERS_PER_FRAME && budget > 0 && frontier.length; i++) step();
    fadeGlow();
    paint();
    const flowing = budget > 0 && frontier.length;
    $("flowmeter").textContent = flowing ? `ink flowing · ${frontier.length} brush tips` : "";
    if (flowing || anchor.glowData.data.some((v, i) => i % 4 === 3 && v > 0)) requestAnimationFrame(tick);
    else running = false;
  };
  requestAnimationFrame(tick);
}

function paint() {
  const g = layer.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, layer.width, layer.height);
  if (!anchor) return;
  const dpr = layer.width / layer.clientWidth;
  const a = anchor;
  a.mask.getContext("2d").putImageData(a.maskData, 0, 0);
  a.glow.getContext("2d").putImageData(a.glowData, 0, 0);
  // painting (hi-res), faded at its picture edge
  const M = imageAffine(a.pose, a.frame, a.ink.W, a.img.naturalWidth);
  g.setTransform(...M.map((v) => v * dpr));
  g.imageSmoothingQuality = "high";
  g.drawImage(a.img, 0, 0);
  pictureEdge(g, engine.works[a.work], a.img, M, [dpr, 0, 0]);
  // keep only where ink has flowed (mask in ink-map space, softened when scaled up)
  const m = poseAffine(a.pose, a.frame).map((v) => v * dpr);
  applySoftMask(g, a.mask, m, Math.max(1.5, Math.hypot(m[0], m[1]) * 0.6));
  // the flow front
  g.setTransform(...m);
  g.globalCompositeOperation = "source-over";
  g.drawImage(a.glow, 0, 0);
}

function strokeLength(s) {
  let L = 0;
  for (let i = 1; i < s.points.length; i++) L += Math.hypot(s.points[i].x - s.points[i - 1].x, s.points[i].y - s.points[i - 1].y);
  return L;
}

let toastT = 0;
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 1800);
}

$("undo").onclick = () => { pad.undo(); if (!pad.strokes.length) reset(); };
$("clear").onclick = () => { pad.clear(); reset(); };
$("lines").onclick = (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  $("pad").style.opacity = on ? 1 : 0.05;
};
function reset() {
  anchor = null; frontier = []; budget = 0; dry = 0;
  $("caption").hidden = true; $("flowmeter").textContent = "";
  $("hint").classList.remove("gone");
  paint();
}
size();
