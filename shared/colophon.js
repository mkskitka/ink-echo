// Colophon -- the closing pages of a session. Handscroll owners wrote colophons
// at the end of a scroll: what they saw, who made it, how. This one gathers the
// works you met, shows each at the passage your line found, says how it was
// made and what its brushwork does, and sets your strokes beside theirs.
import { imageAffine, screenToInk } from "./engine.js";
import { TECHNIQUES, PRINCIPLES, describeWork, measurePassage, brushWords, readStroke } from "./lore.js";

const CSS = `
.colophon { position: fixed; inset: 0; z-index: 20; overflow-y: auto; -webkit-overflow-scrolling: touch;
  background: #f1e9d6; color: #2a241c; font: 16px/1.55 "Iowan Old Style", "Palatino", Georgia, serif;
  padding: calc(env(safe-area-inset-top) + 20px) 18px calc(env(safe-area-inset-bottom) + 40px); }
.colophon .inner { max-width: 720px; margin: 0 auto; }
.colophon h1 { font-weight: 400; font-size: 30px; letter-spacing: .04em; margin: 8px 0 2px; }
.colophon h2 { font-weight: 400; font-size: 21px; margin: 34px 0 6px; border-top: 1px solid #c9b994; padding-top: 18px; }
.colophon h3 { font-weight: 600; font-size: 17px; margin: 0; }
.colophon .meta { color: #6d6150; font-size: 14px; }
.colophon .seal { display: inline-block; color: #f6efe0; background: #a8322a; padding: 6px 8px; border-radius: 3px;
  font-size: 13px; letter-spacing: .1em; writing-mode: vertical-rl; float: right; margin: 6px 0 10px 14px; }
.colophon .work { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin: 26px 0; }
@media (min-width: 640px) { .colophon .work { grid-template-columns: 260px minmax(0, 1fr); gap: 18px; } }
.colophon canvas { width: 100%; aspect-ratio: 1; border-radius: 4px; background: #e8dfc9; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
.colophon .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.colophon .chip { font: 13px system-ui, sans-serif; background: rgba(60,45,25,.08); border-radius: 999px; padding: 3px 9px; }
.colophon .vs { font: 13px/1.4 system-ui, sans-serif; color: #4d4335; background: rgba(255,255,255,.45); border-radius: 6px; padding: 8px 10px; }
.colophon .tech { border-left: 3px solid #a8322a; padding: 2px 0 2px 12px; margin: 12px 0; }
.colophon .tech b { font-weight: 600; } .colophon .tech i { color: #6d6150; font-style: normal; }
.colophon a { color: #7a2a22; }
.colophon .close { position: sticky; top: 0; float: right; z-index: 2; font: 15px system-ui, sans-serif;
  background: #2a241c; color: #f1e9d6; border: 0; border-radius: 999px; padding: 8px 16px; }
.colophon .strokes { width: 100%; height: 120px; aspect-ratio: auto; background: transparent; box-shadow: none; }
.colophon .ribbon { width: 100%; height: 64px; aspect-ratio: auto; background: transparent; box-shadow: none; margin-top: 6px; }
.colophon .rlabel { font: 12px system-ui, sans-serif; color: #6d6150; }
.colophon blockquote { margin: 14px 0; font-style: italic; color: #4d4335; }
`;

let styled = false;
function style() {
  if (styled) return;
  const s = document.createElement("style"); s.textContent = CSS; document.head.append(s); styled = true;
}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * Open the colophon.
 * engine: the Engine. encounters: [{work, pose, frame, strokes, warp?}] in the order met.
 * strokes: all of the user's strokes (with .mech from Brush, if any).
 * opts: {title, onClose}
 */
export async function openColophon(engine, encounters, strokes, opts = {}) {
  style();
  const root = el("div", "colophon");
  const inner = el("div", "inner");
  root.append(inner);
  const close = el("button", "close", "Close");
  close.onclick = () => { root.remove(); opts.onClose && opts.onClose(); };
  inner.append(close);
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  inner.append(el("div", "seal", "墨 響"));
  inner.append(el("h1", null, esc(opts.title || "Colophon")));
  inner.append(el("p", "meta", `Written ${esc(date)}, after ${strokes.length} stroke${strokes.length === 1 ? "" : "s"} and ${new Set(encounters.map((e) => engine.works[e.work].parent ?? engine.works[e.work].id)).size} works from The Met.`));

  // ---- your hand
  inner.append(el("h2", null, "Your hand"));
  const sc = el("canvas", "strokes"); inner.append(sc);
  drawStrokes(sc, strokes);
  const mechs = strokes.map((s) => s.mech).filter((m) => m && m.length);
  const yours = summarise(mechs);
  inner.append(el("p", null, yours.text));

  // ---- the works
  const uniq = [];
  const seen = new Set();
  const key = (e) => { const w = engine.works[e.work]; return w.parent ?? w.id; };   // album leaves and details belong to one work
  for (const e of encounters) if (!seen.has(key(e))) { seen.add(key(e)); uniq.push(e); }
  inner.append(el("h2", null, uniq.length === 1 ? "The work you met" : "The works you met"));
  const rows = [];
  for (const e of uniq.slice(0, 10)) {
    const w = engine.works[e.work];
    const d = describeWork(w, w);
    const ink = await engine.ensureInk(e.work).catch(() => null);
    const m = ink ? measurePassage(ink, passageBox(e.pose)) : null;
    rows.push({ e, w, d, m });
    const card = el("div", "work");
    const cv = el("canvas"); card.append(cv);
    const body = el("div");
    body.append(el("h3", null, esc(w.title)));
    body.append(el("div", "meta", esc([w.artist, w.artistBio].filter(Boolean).join(", ") || w.culture)));
    body.append(el("div", "meta", esc([d.period || w.date, w.medium].filter(Boolean).join(" · "))));
    const chips = el("div", "chips");
    for (const c of [d.format, d.school, ...brushWords(m)].filter(Boolean)) chips.append(el("span", "chip", esc(c)));
    body.append(chips);
    const how = [d.formatText, d.schoolText, d.materialText, !d.schoolText ? d.periodText : ""].filter(Boolean).join(" ");
    if (how) body.append(el("p", null, esc(how)));
    if (m && yours.m) body.append(el("div", "vs", compare(yours.m, m)));
    const prof = ink ? widthProfile(ink, e) : null;
    if (prof) {
      const rc = el("canvas", "ribbon"); body.append(rc);
      body.append(el("div", "rlabel", "Width along the stroke: theirs in ink, yours outlined in red."));
      requestAnimationFrame(() => drawRibbon(rc, prof));
    }
    body.append(el("p", "meta", `<a href="${esc(w.url)}" target="_blank" rel="noopener">See it at metmuseum.org ↗</a>`));
    card.append(body);
    inner.append(card);
    drawPassage(engine, cv, e).catch(() => {});
  }

  // ---- across the hands
  if (rows.length) {
    inner.append(el("h2", null, rows.length > 1 ? "Across these hands" : "In the hand"));
    inner.append(el("p", null, esc(across(rows))));
    for (const t of techniquesFor(rows, yours)) {
      const T = TECHNIQUES[t];
      const c = el("div", "tech", `<b>${esc(T.name)}</b> <i>${esc(T.term)}</i><br>${esc(T.why)} <i>Try:</i> ${esc(T.how)}`);
      inner.append(c);
    }
    const p = PRINCIPLES[(rows.length + strokes.length) % PRINCIPLES.length];
    inner.append(el("blockquote", null, `${esc(p.term)}: ${esc(p.name)}. ${esc(p.text)}`));
  }
  document.body.append(root);
  return root;
}

/** Square region (ink-map px) around the passage a pose shows. */
export function passageBox(pose) {
  const r = pose.s * 0.75;
  return [pose.cx - r, pose.cy - r, pose.cx + r, pose.cy + r];
}

async function drawPassage(engine, cv, e) {
  const img = await engine.loadPainting(e.work);
  const ink = await engine.ensureInk(e.work);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth || 260;
  cv.width = cv.height = W * dpr;
  const g = cv.getContext("2d");
  const side = e.frame.S * 1.5, k = (W * dpr) / side;
  const tx = W * dpr / 2 - e.frame.cx * k, ty = W * dpr / 2 - e.frame.cy * k;
  const [a, b, c, d, ee, f] = imageAffine(e.pose, e.frame, ink.W, img.naturalWidth);
  g.fillStyle = "#e8dfc9"; g.fillRect(0, 0, cv.width, cv.height);
  g.setTransform(k * a, k * b, k * c, k * d, k * ee + tx, k * f + ty);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0);
  g.setTransform(k, 0, 0, k, tx, ty);
  g.strokeStyle = "rgba(168,50,42,0.75)"; g.lineWidth = 2 * dpr / k; g.lineCap = g.lineJoin = "round";
  for (const s of e.strokes) {
    g.beginPath(); s.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  }
}

/** Along your (first) stroke in an encounter: your width, and the width of the
 *  painted stroke under it (measured across the painted line in its ink map). */
function widthProfile(ink, e) {
  const s = e.strokes && e.strokes.find((x) => x.points && x.points.length > 8);
  if (!s) return null;
  const { pose, frame } = e;
  const scale = frame.S / pose.s;                 // screen px per ink px
  const T = 90, P = s.points, N = 48;
  const theirs = [], yours = [];
  let hits = 0;
  for (let k = 0; k < N; k++) {
    const i = Math.min(P.length - 2, Math.floor((k / (N - 1)) * (P.length - 2)));
    const a = P[i], b = P[i + 1];
    const [qx, qy] = screenToInk(pose, frame, a.x, a.y);
    const [rx, ry] = screenToInk(pose, frame, b.x, b.y);
    let tx = rx - qx, ty = ry - qy; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;
    const at = (x, y) => { const X = Math.round(x), Y = Math.round(y); return X >= 0 && Y >= 0 && X < ink.W && Y < ink.H ? ink.data[Y * ink.W + X] : 0; };
    // find the painted line across your stroke (within a few px), then measure its width
    let best = null;
    for (let o = -4; o <= 4; o += 0.5) if (at(qx + nx * o, qy + ny * o) > T && (best === null || Math.abs(o) < Math.abs(best))) best = o;
    yours.push(a.w || 3);
    if (best === null) { theirs.push(0); continue; }
    hits++;
    const cx = qx + nx * best, cy = qy + ny * best;
    let l = 0, r = 0;
    while (l < 40 && at(cx - nx * (l + 0.5), cy - ny * (l + 0.5)) > T) l += 0.5;
    while (r < 40 && at(cx + nx * (r + 0.5), cy + ny * (r + 0.5)) > T) r += 0.5;
    const wpx = (l + r + 1) * scale;
    theirs.push(wpx > Math.max(24, (a.w || 3) * 8) ? 0 : wpx);   // a wash or a gap, not a stroke
  }
  return hits >= N * 0.3 ? { theirs, yours } : null;
}

function drawRibbon(cv, { theirs, yours }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth || 260, H = cv.clientHeight || 64;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const max = Math.max(4, ...theirs, ...yours);
  const k = (H - 8) / max, N = theirs.length, y0 = H / 2;
  const X = (i) => 6 + (i / (N - 1)) * (W - 12);
  const smooth = (a) => a.map((v, i) => (a[Math.max(0, i - 1)] + v * 2 + a[Math.min(a.length - 1, i + 1)]) / 4);
  const t = smooth(theirs).map((v, i) => (theirs[i] ? v : 0)), y = smooth(yours);
  g.fillStyle = "rgba(27,25,21,.85)";
  // painted stroke as filled ribbons, one shape per unbroken run (gaps where it
  // broke into flying white or left your line)
  let i = 0;
  while (i < N) {
    while (i < N && !t[i]) i++;
    const a = i;
    while (i < N && t[i]) i++;
    const b = i - 1;
    if (b <= a) continue;
    g.beginPath();
    for (let j = a; j <= b; j++) g.lineTo(X(j), y0 - (t[j] * k) / 2);
    for (let j = b; j >= a; j--) g.lineTo(X(j), y0 + (t[j] * k) / 2);
    g.closePath(); g.fill();
  }
  g.strokeStyle = "rgba(168,50,42,.95)"; g.lineWidth = 1.3;
  for (const sgn of [-1, 1]) {
    g.beginPath();
    y.forEach((v, i) => (i ? g.lineTo(X(i), y0 + (sgn * v * k) / 2) : g.moveTo(X(i), y0 + (sgn * v * k) / 2)));
    g.stroke();
  }
}

function drawStrokes(cv, strokes) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth || 600, H = cv.clientHeight || 120;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (!isFinite(x0)) return;
  const k = Math.min((W * dpr - 20) / Math.max(1, x1 - x0), (H * dpr - 20) / Math.max(1, y1 - y0));
  g.setTransform(k, 0, 0, k, (W * dpr - (x1 - x0) * k) / 2 - x0 * k, (H * dpr - (y1 - y0) * k) / 2 - y0 * k);
  g.lineCap = g.lineJoin = "round";
  for (const s of strokes) {
    const p = s.points;
    for (let i = 1; i < p.length; i++) {
      g.strokeStyle = "rgba(30,24,18,0.85)";
      g.lineWidth = Math.max(0.8 / k * dpr, (p[i].w || 2) * 0.6);
      g.beginPath(); g.moveTo(p[i - 1].x, p[i - 1].y); g.lineTo(p[i].x, p[i].y); g.stroke();
    }
  }
}

/** Your strokes, read together. */
function summarise(mechs) {
  if (!mechs.length) return { text: "Your strokes were recorded as lines; draw with the ink brush to have your brushwork read.", m: null };
  const avg = (k) => mechs.reduce((s, m) => s + (m[k] || 0), 0) / mechs.length;
  const n = mechs.length;
  const pressVar = avg("pressVar"), speedVar = avg("speedVar"), tip = avg("tip"), speed = avg("speed");
  const concealed = mechs.filter((m) => m.concealedEntry).length;
  const dry = mechs.filter((m) => m.load1 < 0.25).length;
  const parts = [];
  parts.push(pressVar > 0.1 ? "Your pressure rose and fell within strokes, so the lines breathe." :
    "Your pressure stayed fairly even, so the lines are steady, closer to the even iron-wire line than to a swelling leaf stroke.");
  parts.push(speedVar > 0.45 ? "You changed speed inside strokes: slow entries and quick exits are how a brush gets its rhythm." :
    "Your speed was even; painters usually vary it, slow where the stroke turns or presses and quick where it releases.");
  if (tip > 0.35) parts.push("You often laid the brush on its side, the way painters texture rocks and bark.");
  if (concealed) parts.push(`${concealed} of ${n} strokes began with a concealed entry, the tip turned back into the stroke.`);
  if (dry) parts.push(`${dry} stroke${dry > 1 ? "s" : ""} ran the brush dry enough for flying white.`);
  // your marks in the same terms as the passages
  const m = { widthVar: Math.min(1.5, pressVar * 6), broken: Math.min(1, dry / n + (speed > 1 ? 0.3 : 0)), toneRange: 0.3, coverage: 0.1, width: 0.03 };
  return { text: parts.join(" "), m };
}

function compare(you, them) {
  const s = [];
  if (them.widthVar > you.widthVar + 0.25) s.push("Their lines swell and thin more than yours: more lift and press.");
  else if (you.widthVar > them.widthVar + 0.25) s.push("Your lines vary in width more than theirs here; this passage keeps an even line.");
  else s.push("Your line and theirs vary in width about as much.");
  if (them.broken > 0.55 && you.broken < 0.4) s.push("Their edges are drier and more broken: faster strokes with less ink.");
  if (them.broken < 0.3 && you.broken > 0.5) s.push("Their ink is wetter and softer-edged than yours.");
  if (them.toneRange > 0.55) s.push("They used many tones of ink; try a paler dip for what lies behind.");
  return s.join(" ");
}

function across(rows) {
  if (rows.length === 1) {
    const { w, d } = rows[0];
    return `${w.artist || "The painter"} worked ${d.period ? "in the " + d.period : ""}${d.school ? ", within the " + d.school : ""}. Look at where the brush presses and where it lifts: the passage your line found shows the hand moving, not only the picture.`;
  }
  const cultures = [...new Set(rows.map((r) => (r.w.culture || "").split(/[ ,]/)[0]).filter(Boolean))];
  const schools = [...new Set(rows.map((r) => r.d.school).filter(Boolean))];
  const words = rows.map((r) => new Set(brushWords(r.m)));
  const shared = [...words[0] || []].filter((x) => words.every((s) => s.has(x)));
  const onPaper = rows.filter((r) => /paper/i.test(r.w.medium)).length, onSilk = rows.filter((r) => /silk|satin/i.test(r.w.medium)).length;
  const s = [];
  s.push(`Your lines led you across ${rows.length} works${cultures.length ? " from " + cultures.join(", ") : ""}${schools.length ? ", including " + schools.join(", ") : ""}.`);
  if (shared.length) s.push(`They share ${shared.join(" and ")}.`);
  if (onPaper && onSilk) s.push(`${onPaper} are on paper and ${onSilk} on silk: on paper the ink sank in and spread at once; on silk it stayed where it was put and could be layered.`);
  const dry = rows.filter((r) => r.m && r.m.broken > 0.55), wet = rows.filter((r) => r.m && r.m.broken < 0.3);
  if (dry.length && wet.length) s.push(`Compare the dry, broken brush of ${dry[0].w.artist || dry[0].w.title} with the wet, soft ink of ${wet[0].w.artist || wet[0].w.title}: the same tool, held with a different load and speed.`);
  const swell = rows.filter((r) => r.m && r.m.widthVar > 0.85), even = rows.filter((r) => r.m && r.m.widthVar < 0.5);
  if (swell.length && even.length) s.push(`${swell[0].w.artist || swell[0].w.title} presses and lifts as the line travels; ${even[0].w.artist || even[0].w.title} keeps it even and wiry.`);
  return s.join(" ");
}

function techniquesFor(rows, yours) {
  const t = new Set();
  for (const { m, d } of rows) {
    if (!m) continue;
    if (m.broken > 0.55) t.add("flyingwhite");
    if (m.widthVar > 0.85) t.add("liftpress");
    if (m.toneRange > 0.55) t.add("tones");
    if (m.broken < 0.3) t.add("brokenink");
    if (d.school === "Rinpa") t.add("tarashikomi");
    if (/Southern Song|Muromachi/.test(d.period || "")) t.add("axe");
    if (/Yuan|Orthodox|literati/i.test((d.period || "") + (d.school || ""))) t.add("hemp");
  }
  if (yours.m && yours.m.widthVar < 0.5) t.add("liftpress");
  t.add("centred");
  return [...t].slice(0, 4);
}

export { readStroke };
