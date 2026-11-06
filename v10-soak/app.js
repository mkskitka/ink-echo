// V10 · Soak -- Bloom, with the paper simulated. Your line finds a painting;
// where it touches the painter's ink, wetness spreads along their *connected*
// strokes (a flood fill over the ink map), and each step of that spread is
// dabbed into a paper simulation that shows the hi-res painting wherever the
// "ink" has soaked in. On xuan paper the reveal feathers along the fibres; on
// silk it rises crisp. Your own strokes are real ink on top.
import { Engine, imageAffine, screenToInk, poseAffine } from "../shared/engine.js";
import { InkPaper, paperBackground } from "../shared/inkpaper.js";
import { Brush } from "../shared/brush.js";
import { setCaption, pictureEdge } from "../shared/view.js";
import { openColophon } from "../shared/colophon.js";
import { inkwells, toast } from "../shared/ui.js";

const $ = (id) => document.getElementById(id);
const INK = 70;
let paperKind = "xuan";
paperBackground($("paper"), { kind: paperKind });
const paper = new InkPaper($("ink"), { paper: paperKind });
const soak = new InkPaper($("reveal"), { paper: paperKind, maxPixels: 1.6e6 });
const brush = new Brush($("hit"), paper, { size: 6.5 });
inkwells(brush);
if (!paper.ok) $("status").textContent = "This browser has no WebGL2, so the paper can't be simulated.";

let engine = null, anchor = null, frontier = [], budget = 0, layerNo = 0, dry = 0, ghostOn = false;
const encounters = [];
Engine.create("../").then((e) => { engine = e; $("status").textContent = `${e.works.length.toLocaleString()} works ready`; })
  .catch((err) => { $("status").textContent = "Could not load the index."; console.error(err); });

brush.on("start", () => $("hint").classList.add("gone"));
brush.on("move", () => engine && !anchor && engine.warm(brush.strokes));
brush.on("end", (s) => onStroke(s));

async function onStroke(stroke) {
  if (!engine) return;
  $("busy").classList.add("on");
  try {
    if (!anchor) await setAnchor(brush.strokes);
    if (!anchor) return;
    let seeds = seedsFor(stroke);
    if (!seeds.length) {
      if (++dry >= 2) {
        toast("No ink there. Looking for a painting that meets your lines…");
        await setAnchor(brush.strokes.slice(-2));
        seeds = anchor ? brush.strokes.slice(-2).flatMap(seedsFor) : [];
        dry = 0;
      } else toast("Dry paper here. Try running along a line nearby.");
    } else dry = 0;
    if (seeds.length) {
      frontier.push(...seeds);
      budget += 30 + Math.round(stroke.points.length / 3);
      if (encounters.length) encounters[encounters.length - 1].strokes.push(stroke);
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
  anchor = { work: best.work, pose: best.pose, frame: r.frame, img, ink, visited: new Int32Array(ink.W * ink.H).fill(-1) };
  frontier = []; budget = 0; layerNo = 0;
  soak.clear();
  soak.setReveal(img, imageAffine(best.pose, r.frame, ink.W, img.naturalWidth));
  // ink-map px -> CSS px, and the size of one ink-map px on screen
  anchor.toScreen = poseAffine(best.pose, r.frame);
  anchor.px = Math.hypot(anchor.toScreen[0], anchor.toScreen[1]);
  encounters.push({ work: best.work, pose: best.pose, frame: r.frame, strokes: [...strokes] });
  setCaption($("caption"), w);
  drawGhost();
}

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
      if (ink.data[k] >= INK && visited[k] < 0) { visited[k] = layerNo; out.push(k); wet(k, 1.6); }
    }
  }
  return out;
}

/** Dab wetness into the reveal paper at ink-map pixel k. */
function wet(k, boost = 1) {
  const { ink, toScreen: m, px } = anchor;
  const x = k % ink.W, y = (k / ink.W) | 0;
  const sx = m[0] * x + m[2] * y + m[4], sy = m[1] * x + m[3] * y + m[5];
  const v = ink.data[k] / 255;
  soak.dab(sx, sy, Math.max(1.2, px * 0.9), 1, 0, 0.05 * boost * (paperKind === "silk" ? 0.5 : 1), 0.09 * v * boost, 0, 0, 0, 1);
}

const NB = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) NB.push([dx, dy]);
function step() {
  const { ink, visited } = anchor;
  const next = [];
  layerNo++;
  for (const k of frontier) {
    const x = k % ink.W, y = (k / ink.W) | 0;
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ink.W || ny >= ink.H) continue;
      const n = ny * ink.W + nx;
      if (visited[n] >= 0 || ink.data[n] < INK) continue;
      visited[n] = layerNo; next.push(n); wet(n);
    }
  }
  frontier = next; budget--;
}

function loop() {
  if (anchor && budget > 0 && frontier.length) {
    step();
    $("flowmeter").textContent = `soaking · ${frontier.length} fronts`;
  } else $("flowmeter").textContent = "";
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/** Hint: the whole painting, very faint, so you can find its lines. */
function drawGhost() {
  const c = $("ghost");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  if (!anchor || !ghostOn) return;
  const M = imageAffine(anchor.pose, anchor.frame, anchor.ink.W, anchor.img.naturalWidth);
  g.setTransform(...M.map((v) => v * dpr));
  g.globalAlpha = 0.16;
  g.drawImage(anchor.img, 0, 0);
  pictureEdge(g, engine.works[anchor.work], anchor.img, M, [dpr, 0, 0]);
}

$("ghostBtn").onclick = (e) => {
  ghostOn = !ghostOn; e.currentTarget.setAttribute("aria-pressed", String(ghostOn)); drawGhost();
};
$("paperBtn").onclick = (e) => {
  const order = ["xuan", "sized", "silk"];
  paperKind = order[(order.indexOf(paperKind) + 1) % order.length];
  paper.setPaper(paperKind); soak.setPaper(paperKind);
  paperBackground($("paper"), { kind: paperKind });
  e.currentTarget.textContent = { xuan: "Xuan paper", sized: "Sized paper", silk: "Silk" }[paperKind];
  toast(InkPaper.papers()[paperKind].label);
};
$("clear").onclick = () => {
  brush.clear(); soak.clear(); soak.setReveal(null); anchor = null; frontier = []; budget = 0;
  $("caption").hidden = true; $("hint").classList.remove("gone"); drawGhost();
};
$("doneBtn").onclick = () => {
  if (!engine || !brush.strokes.length) { toast("Draw first."); return; }
  openColophon(engine, encounters, brush.strokes, { title: "Colophon" });
};
window.addEventListener("resize", () => { paperBackground($("paper"), { kind: paperKind }); drawGhost(); });
