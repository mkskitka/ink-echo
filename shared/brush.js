// Brush -- input for InkPaper with the mechanics of an East Asian ink brush.
//
//  - Load: the brush carries a fixed amount of ink and water. Every dab spends
//    some; as it runs dry and moves fast, the bristles separate and leave
//    "flying white" (feibai) streaks. Dipping (each new stroke by default, or an
//    explicit inkstone in some versions) reloads it.
//  - Press and lift (ti-an): Pencil pressure, or for a finger, slowness, widens
//    the line; speed thins it.
//  - Tip: an upright Pencil gives the centred tip (zhongfeng) -- a round line,
//    ink even on both edges. Tilting it gives the side tip (cefeng): a broad
//    wedge, dark along one edge, used for rocks and texture strokes.
//  - Pauses: holding still pools ink into the paper (the press, dun, at the
//    start or end of a stroke).
//
// Emits the same {points: [{x, y, w, t}], t0, t1} strokes as Pad, so the match
// engine works unchanged, plus per-stroke mechanics in stroke.mech.
export class Brush {
  constructor(el, paper, opts = {}) {
    this.el = el;
    this.paper = paper;
    this.opts = { size: 7, tone: 0.9, water: 0.55, autoDip: true, capacity: 1, ...opts };
    this.strokes = [];
    this.active = null;
    this.pointer = null;
    this.penSeen = false;
    this.listeners = { start: [], move: [], end: [], dip: [] };
    this.offset = { x: 0, y: 0 };
    this.load = 1;       // ink left in the brush, 0..1
    this.water = this.opts.water;
    this.disabled = false;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => this._down(e));
    el.addEventListener("pointermove", (e) => this._move(e));
    el.addEventListener("pointerup", (e) => this._up(e));
    el.addEventListener("pointercancel", (e) => this._up(e));
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    const tick = () => { this._dwell(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  on(evt, fn) { this.listeners[evt].push(fn); return this; }
  _emit(evt, s) { for (const fn of this.listeners[evt]) fn(s, this); }

  /** Reload the brush. tone: ink concentration (1 = thick/dark .. 0.2 = pale wash);
   *  water: how wet (more water = more bleeding). */
  dip(tone = this.opts.tone, water = this.opts.water) {
    this.opts.tone = tone; this.opts.water = water;
    this.load = this.opts.capacity; this.water = water;
    this._emit("dip", { tone, water });
  }

  _pos(e) {
    const r = this.el.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  _sample(e, prev) {
    const { sx, sy } = this._pos(e);
    const t = e.timeStamp || performance.now();
    const pen = e.pointerType === "pen";
    // tilt: altitude 90 deg = upright. Pointer Events give tiltX/tiltY (deg) or altitudeAngle (rad)
    let alt = Math.PI / 2;
    if (pen) {
      if (typeof e.altitudeAngle === "number" && e.altitudeAngle > 0) alt = e.altitudeAngle;
      else if (e.tiltX || e.tiltY) {
        const tx = Math.tan((e.tiltX * Math.PI) / 180), ty = Math.tan((e.tiltY * Math.PI) / 180);
        alt = Math.atan(1 / Math.max(1e-3, Math.hypot(tx, ty)));
      }
    }
    const tip = pen ? Math.min(1, Math.max(0, (1.25 - alt) / 0.75)) : 0; // upright .. ~30 deg tilt
    const v = prev ? Math.hypot(sx - prev.sx, sy - prev.sy) / Math.max(1, t - prev.t) : 0; // px/ms
    let press;
    if (pen) press = Math.min(1, Math.max(0.05, e.pressure || 0.4));
    else {
      // finger: slow = pressed in, fast = lifted (the hand lifts as it speeds up)
      const target = Math.min(1, Math.max(0.15, 1.05 - v * 0.55));
      press = prev ? prev.press * 0.75 + target * 0.25 : target * 0.7;
    }
    return { sx, sy, x: sx + this.offset.x, y: sy + this.offset.y, t, v, press, tip, pen };
  }

  _down(e) {
    if (e.pointerType === "pen" && !e.ghost) this.penSeen = true;
    if (this.penSeen && e.pointerType === "touch") return;   // palm rejection
    if (this.pointer !== null || (this.disabled && !e.ghost)) return;
    if (e.preventDefault) e.preventDefault();
    this.pointer = e.pointerId;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (this.opts.autoDip) this.dip();
    const p = this._sample(e);
    this.seed = Math.random() * 97;
    this.active = { ghost: !!e.ghost, points: [{ x: p.x, y: p.y, w: this._radius(p) * 2, t: p.t }], t0: performance.now(),
      raw: [p], mech: { load0: this.load, tone: this.opts.tone, water: this.water, pen: p.pen } };
    this.lastMove = performance.now();
    this.strokes.push(this.active);
    this._stamp(p, p, 0);
    this._emit("start", this.active);
  }

  _radius(p) {
    const base = this.opts.size * 0.5;
    // pressing spreads the bristles; side tip lays the belly down
    return base * (0.3 + 1.25 * Math.pow(p.press, 1.15)) * (1 + 1.6 * p.tip);
  }

  _move(e) {
    if (e.pointerId !== this.pointer) return;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    for (const ev of evs.length ? evs : [e]) {
      const raw = this.active.raw;
      const prev = raw[raw.length - 1];
      const p = this._sample(ev, prev);
      const d = Math.hypot(p.sx - prev.sx, p.sy - prev.sy);
      if (d < 0.7) continue;
      raw.push(p);
      this.active.points.push({ x: p.x, y: p.y, w: this._radius(p) * 2, t: p.t });
      this._stamp(prev, p, d);
      this.lastMove = performance.now();
    }
    this._emit("move", this.active);
  }

  /** Dabs along the segment a -> b. */
  _stamp(a, b, d) {
    const steps = Math.max(1, Math.ceil(d / Math.max(0.8, this._radius(b) * 0.22)));
    let dx = b.sx - a.sx, dy = b.sy - a.sy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    const n = this.active.raw.length;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.sx + (b.sx - a.sx) * t, y = a.sy + (b.sy - a.sy) * t;
      const q = { press: a.press + (b.press - a.press) * t, tip: a.tip + (b.tip - a.tip) * t };
      let r = this._radius(q);
      const entry = Math.min(1, 0.45 + n * 0.08);            // the tip touches down first
      r *= entry;
      const v = b.v;
      // dryness: low load and speed separate the bristles
      const dry = Math.min(1, Math.max(0, (1 - this.load) * 1.2 - 0.3 + v * 0.38 * (1.35 - this.load) + (0.45 - this.water) * 0.7));
      const wet = this.water * (0.35 + 0.65 * this.load) * Math.max(0.25, 1 - v * 0.35);
      const ink = this.opts.tone * (0.25 + 0.75 * this.load);
      this.paper.dab(x, y, r, dx, dy, wet * (0.1 + 0.08 * Math.max(0, 1 - v * 2)), ink * 0.2, dry, q.tip, this.seed, 1 + q.tip * 0.4);
      // spend ink: more for wider, wetter dabs
      const spend = (d / steps) * r * 0.00034 * (0.6 + this.water) / this.opts.capacity;
      this.load = Math.max(0, this.load - spend);
      this.water = Math.max(0, this.water - spend * 0.6);
    }
  }

  /** Holding still: ink keeps flowing from the tip into the paper. */
  _dwell() {
    if (!this.active) return;
    const idle = performance.now() - this.lastMove;
    if (idle < 90 || this.load <= 0.02) return;
    const raw = this.active.raw, p = raw[raw.length - 1];
    const r = this._radius(p) * (1 + Math.min(0.6, idle / 1500));
    this.paper.dab(p.sx, p.sy, r, 1, 0, this.water * 0.05, this.opts.tone * 0.05, 0, p.tip, this.seed, 1);
    this.load = Math.max(0, this.load - 0.004);
    this.active.mech.pools = (this.active.mech.pools || 0) + 1;
  }

  _up(e) {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    const s = this.active;
    this.active = null;
    s.t1 = performance.now();
    s.mech = { ...s.mech, ...analyse(s.raw), load1: this.load };
    delete s.raw;
    this._emit("end", s);
  }

  clear() { this.strokes = []; this.paper.clear(); }

  /** Play a demonstration stroke (a teacher's hand): samples [[x, y, pressure, tilt?], ...]
   *  in element px over `ms`. Doesn't count as Pencil use and runs while disabled. */
  async demo(samples, ms, { holdStart = 0, holdEnd = 0 } = {}) {
    const r = this.el.getBoundingClientRect();
    const ev = (i, extra = {}) => {
      const [x, y, pr = 0.5, tilt = 0] = samples[i];
      return { ghost: true, pointerId: -7, pointerType: "pen", clientX: r.left + x, clientY: r.top + y, pressure: pr,
        tiltX: tilt, tiltY: 0, timeStamp: performance.now(), ...extra };
    };
    const wait = (t) => new Promise((res) => setTimeout(res, t));
    this._down(ev(0));
    if (holdStart) await wait(holdStart);
    const dt = ms / Math.max(1, samples.length - 1);
    for (let i = 1; i < samples.length; i++) {
      const e = ev(i); e.getCoalescedEvents = null;
      this._move(e);
      await wait(dt);
    }
    if (holdEnd) await wait(holdEnd);
    const s = this.active;
    this._up(ev(samples.length - 1));
    return s;
  }
}

/** Mechanics of one stroke, for feedback: how a teacher would read it. */
export function analyse(raw) {
  if (!raw || raw.length < 3) return { length: 0 };
  let L = 0, turn = 0, rev = false;
  const speeds = [], press = [], tips = [];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    L += Math.hypot(b.sx - a.sx, b.sy - a.sy);
    speeds.push(b.v); press.push(b.press); tips.push(b.tip);
    if (i > 1) {
      const z = raw[i - 2];
      const a1 = Math.atan2(a.sy - z.sy, a.sx - z.sx), a2 = Math.atan2(b.sy - a.sy, b.sx - a.sx);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
      turn += d;
    }
  }
  // concealed entry (cangfeng): the first few px head *against* the stroke, then turn back
  const k = Math.min(raw.length - 1, 8);
  const head = [raw[k].sx - raw[0].sx, raw[k].sy - raw[0].sy];
  const far = raw[Math.min(raw.length - 1, Math.floor(raw.length / 3))];
  const body = [far.sx - raw[0].sx, far.sy - raw[0].sy];
  if (Math.hypot(...head) > 2 && head[0] * body[0] + head[1] * body[1] < 0) rev = true;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  const third = Math.max(1, Math.floor(press.length / 3));
  const dur = raw[raw.length - 1].t - raw[0].t;
  return {
    length: L, duration: dur, speed: mean(speeds), speedVar: sd(speeds) / Math.max(1e-3, mean(speeds)),
    press: mean(press), pressVar: sd(press),
    pressStart: mean(press.slice(0, third)), pressMid: mean(press.slice(third, -third)), pressEnd: mean(press.slice(-third)),
    tip: mean(tips), turning: turn / Math.max(1, L / 100), concealedEntry: rev,
  };
}
