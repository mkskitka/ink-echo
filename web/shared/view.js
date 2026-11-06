// Rendering helpers shared by the versions.
import { imageAffine, cssMatrix, loadImage } from "./engine.js";

/** Place an <img> (painting, natural size) so the pose lands on the drawing frame. */
export function placeImage(img, pose, frame, ink) {
  img.style.width = img.naturalWidth + "px";
  img.style.height = img.naturalHeight + "px";
  img.style.transform = cssMatrix(imageAffine(pose, frame, ink.W, img.naturalWidth));
}

/** Draw the posed painting into a canvas, optionally showing just a window around
 *  the frame (thumb) and overlaying the strokes. */
export async function renderPoseThumb(canvas, work, pose, frame, ink, strokes, { pad = 1.35, lineColor = "168,50,42" } = {}) {
  const img = await loadImage(work.image);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || 96, H = canvas.clientHeight || 96;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  const side = frame.S * pad;
  const k = Math.min(W, H) / side;
  // screen -> thumb
  const sx = k * dpr, tx = (W / 2 - frame.cx * k) * dpr, ty = (H / 2 - frame.cy * k) * dpr;
  g.fillStyle = "#f3eee3";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const [a, b, c, d, e, f] = imageAffine(pose, frame, ink.W, img.naturalWidth);
  g.setTransform(sx * a, sx * b, sx * c, sx * d, sx * e + tx, sx * f + ty);
  g.drawImage(img, 0, 0);
  g.setTransform(sx, 0, 0, sx, tx, ty);
  g.strokeStyle = `rgba(${lineColor},0.85)`;
  g.lineWidth = 1.6 / k;
  g.lineCap = g.lineJoin = "round";
  for (const s of strokes) {
    g.beginPath();
    s.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
  }
}

/** Ink map as a tinted, transparent layer (ink -> color, paper -> clear). */
const tintCache = new Map();
export function tintedInk(work, ink, rgb = [27, 25, 21]) {
  const key = work + ":" + rgb.join(",");
  if (tintCache.has(key)) return tintCache.get(key);
  const c = document.createElement("canvas");
  c.width = ink.W; c.height = ink.H;
  const g = c.getContext("2d");
  const im = g.createImageData(ink.W, ink.H);
  for (let i = 0; i < ink.data.length; i++) {
    im.data[i * 4] = rgb[0]; im.data[i * 4 + 1] = rgb[1]; im.data[i * 4 + 2] = rgb[2];
    im.data[i * 4 + 3] = ink.data[i];
  }
  g.putImageData(im, 0, 0);
  tintCache.set(key, c);
  return c;
}

export function setCaption(el, work, extra = "") {
  el.hidden = false;
  el.innerHTML = "";
  const t = document.createElement("span"); t.className = "t"; t.textContent = work.title;
  const m = document.createElement("span"); m.className = "m";
  m.textContent = [work.artist, work.culture, work.date].filter(Boolean).join(" · ") + (extra ? " — " + extra : "");
  const a = document.createElement("a"); a.href = work.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "metmuseum.org ↗";
  el.append(t, m, a);
}
