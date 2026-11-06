// Drawing surface shared by the versions: pointer capture, palm rejection, and a
// thin, dynamic brush -- Pencil pressure, finger *speed* (fast = thin, slow =
// pooled ink), tapered entry/exit, and an optional dry-brush texture.
export class Pad {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = { base: 2.6, color: "27,25,21", dry: false, ...opts };
    this.strokes = [];
    this.active = null;
    this.pointer = null;
    this.penSeen = false;
    this.listeners = { start: [], move: [], end: [] };
    this.offset = { x: 0, y: 0 }; // world offset (handscroll)
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => this._down(e));
    canvas.addEventListener("pointermove", (e) => this._move(e));
    canvas.addEventListener("pointerup", (e) => this._up(e));
    canvas.addEventListener("pointercancel", (e) => this._up(e));
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  on(evt, fn) { this.listeners[evt].push(fn); return this; }
  _emit(evt, s) { for (const fn of this.listeners[evt]) fn(s, this); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.redraw();
  }

  _pt(e, prev) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left + this.offset.x, y = e.clientY - r.top + this.offset.y;
    const t = e.timeStamp || performance.now();
    let w;
    if (e.pointerType === "pen") {
      w = this.opts.base * (0.25 + 1.5 * Math.pow(e.pressure || 0.4, 1.3));
    } else {
      // speed in px/ms -> width: slow strokes pool ink, fast ones thin out
      const v = prev ? Math.hypot(x - prev.x, y - prev.y) / Math.max(1, t - prev.t) : 0;
      const target = this.opts.base * Math.min(1.7, Math.max(0.35, 1.5 - v * 0.75));
      w = prev ? prev.w * 0.7 + target * 0.3 : target * 0.6;
    }
    return { x, y, w, t };
  }

  _down(e) {
    if (e.pointerType === "pen") this.penSeen = true;
    if (this.penSeen && e.pointerType === "touch") return;
    if (this.pointer !== null || this.disabled) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    this.active = { points: [this._pt(e)], t0: performance.now() };
    this.strokes.push(this.active);
    this._emit("start", this.active);
  }

  _move(e) {
    if (e.pointerId !== this.pointer) return;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    for (const ev of evs.length ? evs : [e]) {
      const prev = this.active.points[this.active.points.length - 1];
      const p = this._pt(ev, prev);
      if (Math.hypot(p.x - prev.x, p.y - prev.y) < 0.8) continue;
      this.active.points.push(p);
    }
    this.drawStroke(this.ctx, this.active, { tail: 6 });
    this._emit("move", this.active);
  }

  _up(e) {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    const s = this.active;
    this.active = null;
    s.t1 = performance.now();
    // taper the exit
    const n = s.points.length;
    for (let i = 0; i < Math.min(6, n); i++) s.points[n - 1 - i].w *= 0.4 + 0.1 * i;
    this.redraw();
    this._emit("end", s);
  }

  undo() { this.strokes.pop(); this.redraw(); }
  clear() { this.strokes = []; this.redraw(); }

  /** Paint one stroke. tail: only repaint the last N segments (live drawing). */
  drawStroke(ctx, s, { tail = 0, alpha = 1, scale = 1, color } = {}) {
    const p = s.points;
    const dpr = this.dpr;
    ctx.save();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -this.offset.x * dpr * scale, -this.offset.y * dpr * scale);
    ctx.lineCap = ctx.lineJoin = "round";
    const rgb = color || this.opts.color;
    const start = tail ? Math.max(1, p.length - tail) : 1;
    if (p.length === 1) {
      ctx.fillStyle = `rgba(${rgb},${alpha})`;
      ctx.beginPath(); ctx.arc(p[0].x, p[0].y, p[0].w / 2, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = start; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      // taper the entry over the first few points
      const taper = Math.min(1, 0.35 + i * 0.13);
      const w = ((a.w + b.w) / 2) * taper;
      if (this.opts.dry) {
        // dry brush: a few bristles, gaps where the brush moves fast
        const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);
        const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
        const bristles = 5;
        for (let k = 0; k < bristles; k++) {
          const seed = Math.sin((i * 12.9898 + k * 78.233) * 43758.5453) % 1;
          if (Math.abs(seed) < Math.min(0.4, v * 0.12)) continue; // gaps when fast
          const off = ((k / (bristles - 1)) - 0.5) * Math.max(2.5, w * 1.6);
          ctx.strokeStyle = `rgba(${rgb},${alpha * (0.35 + 0.4 * Math.abs(seed))})`;
          ctx.lineWidth = Math.max(0.9, w * 0.5);
          ctx.beginPath();
          ctx.moveTo(a.x + (nx / nl) * off, a.y + (ny / nl) * off);
          ctx.lineTo(b.x + (nx / nl) * off, b.y + (ny / nl) * off);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = `rgba(${rgb},${alpha})`;
        ctx.lineWidth = Math.max(0.6, w);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  redraw(styleFn) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const vw = this.canvas.clientWidth, vh = this.canvas.clientHeight;
    for (const s of this.strokes) {
      if (s.t1 && !s.box) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of s.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        s.box = [x0 - 20, y0 - 20, x1 + 20, y1 + 20];
      }
      if (s.box && (s.box[2] < this.offset.x || s.box[0] > this.offset.x + vw ||
                    s.box[3] < this.offset.y || s.box[1] > this.offset.y + vh)) continue; // off-screen
      this.drawStroke(ctx, s, styleFn ? styleFn(s) : {});
    }
  }
}
