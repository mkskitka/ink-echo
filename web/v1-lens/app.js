// V1 · Lens — zoom-aware matching. Every stroke re-runs a subset match over
// zoom x position x rotation; the camera flies to the best fit, and a "zoom
// ladder" offers the best Detail / Passage / Composition alternatives.
import { Engine } from "../shared/engine.js";
import { Pad } from "../shared/pad.js";
import { placeImage, renderPoseThumb, setCaption } from "../shared/view.js";

const $ = (id) => document.getElementById(id);
const img = $("painting");
const pad = new Pad($("pad"), { base: 2.4 });
const STICKY = 0.03;
const BAND_LABEL = { detail: "Detail", passage: "Passage", composition: "Composition" };

let engine = null;
let seq = 0, busy = false, again = false, lastRun = 0;
let current = null; // {work, pose, frame}

Engine.create("../").then((e) => {
  engine = e;
  $("status").textContent = `${e.works.length.toLocaleString()} works ready`;
}).catch((err) => { $("status").textContent = "Couldn't load the index."; console.error(err); });

pad.on("start", () => $("hint").classList.add("gone"));
pad.on("move", (s) => {
  if (performance.now() - lastRun > 700 && s.points.length > 25) run();
});
pad.on("end", () => run());

async function run() {
  if (!engine || !pad.strokes.length) return;
  if (busy) { again = true; return; }
  busy = true; again = false; lastRun = performance.now();
  $("busy").classList.add("on");
  const my = ++seq;
  try {
    const include = current ? [current.work] : [];
    const r = await engine.match(pad.strokes, { k: 14, alignK: 8, include });
    if (!r || my !== seq || !r.results.length) return;
    let best = r.results[0];
    if (current) {
      const mine = r.results.find((x) => x.work === current.work);
      if (mine && mine.score + STICKY >= best.score) best = mine;
    }
    show(best.work, best.pose, r.frame, best.zoom);
    ladder(r);
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
    $("busy").classList.remove("on");
    if (again) run();
  }
}

function show(work, pose, frame, zoom) {
  const w = engine.works[work];
  const ink = engine.ink.get(work);
  if (!ink) return;
  const same = current && current.work === work;
  current = { work, pose, frame };
  if (same) {
    img.classList.add("animate");
    placeImage(img, pose, frame, ink);
  } else {
    img.classList.remove("show", "animate");
    const onload = () => {
      if (!current || current.work !== work) return;
      placeImage(img, pose, frame, ink);
      requestAnimationFrame(() => img.classList.add("show"));
    };
    img.onload = onload;
    img.src = w.image;
    if (img.complete && img.naturalWidth) onload();
  }
  setCaption($("caption"), w);
  $("zoombar").textContent = zoomText(zoom ?? pose.s / Math.min(ink.W, ink.H));
}

function zoomText(z) {
  const band = z < 0.35 ? "a detail" : z < 0.7 ? "a passage" : "the whole composition";
  return `Your lines match ${band} (${Math.round(z * 100)}% of the painting's width)`;
}

function ladder(r) {
  const el = $("ladder");
  el.replaceChildren();
  for (const band of ["detail", "passage", "composition"]) {
    let pick = null;
    for (const res of r.results) {
      const b = res.bands[band];
      if (b && (!pick || b.cost < pick.b.cost)) pick = { res, b };
    }
    if (!pick) continue;
    const btn = document.createElement("button");
    const cv = document.createElement("canvas");
    const label = document.createElement("span");
    label.textContent = BAND_LABEL[band];
    btn.append(cv, label);
    btn.setAttribute("aria-label", `${BAND_LABEL[band]}: ${engine.works[pick.res.work].title}`);
    const pose = { cx: pick.b.cx, cy: pick.b.cy, s: pick.b.s, th: pick.b.th };
    btn.classList.toggle("active", current && current.work === pick.res.work && Math.abs(current.pose.s - pose.s) < 1);
    btn.addEventListener("click", () => {
      show(pick.res.work, pose, r.frame, pick.b.zoom);
      for (const b of el.children) b.classList.toggle("active", b === btn);
    });
    el.append(btn);
    requestAnimationFrame(() => renderPoseThumb(cv, engine.works[pick.res.work], pose, r.frame,
      engine.ink.get(pick.res.work), pad.strokes, { pad: band === "composition" ? 2.2 : 1.4 }).catch(() => {}));
  }
}

$("undo").onclick = () => { pad.undo(); pad.strokes.length ? run() : reset(); };
$("clear").onclick = () => { pad.clear(); reset(); };
$("lines").onclick = (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  $("pad").style.opacity = on ? 1 : 0.06;
};
function reset() {
  seq++; current = null;
  img.classList.remove("show");
  $("ladder").replaceChildren();
  $("caption").hidden = true;
  $("zoombar").textContent = "";
  $("hint").classList.remove("gone");
}
