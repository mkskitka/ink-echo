// The sound of the brush on paper: filtered noise that follows the stroke.
// Pressure opens it up, speed raises its pitch, a dry brush makes it grainy.
// Starts on the first touch (browsers only allow audio after a gesture).
export class BrushSound {
  constructor(brush, { volume = 0.22 } = {}) {
    this.brush = brush;
    this.volume = volume;
    this.on = true;
    this.ctx = null;
    brush.on("start", () => this._start());
    brush.on("move", (s) => this._move(s));
    brush.on("end", () => this._end());
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = (this.ctx = new AC());
    // a few seconds of pink-ish noise, looped
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 0.6;
    }
    this.src = ctx.createBufferSource(); this.src.buffer = buf; this.src.loop = true;
    this.band = ctx.createBiquadFilter(); this.band.type = "bandpass"; this.band.Q.value = 0.7; this.band.frequency.value = 1200;
    this.grain = ctx.createGain(); this.grain.gain.value = 1;        // tremolo for a dry, scratchy brush
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 38;
    this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain).connect(this.grain.gain);
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.src.connect(this.band).connect(this.grain).connect(this.out).connect(ctx.destination);
    this.src.start(); this.lfo.start();
    return true;
  }

  _start() {
    if (!this.on) return;
    if (!this.ctx && !this._init()) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  _move(s) {
    if (!this.on || !this.ctx) return;
    const p = s.points, n = p.length;
    if (n < 2) return;
    const a = p[n - 2], b = p[n - 1];
    const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);   // px/ms
    const w = b.w || 4;
    const t = this.ctx.currentTime;
    const level = Math.min(1, v * 0.9) * Math.min(1, 0.35 + w / 14) * this.volume;
    this.out.gain.setTargetAtTime(level, t, 0.03);
    this.band.frequency.setTargetAtTime(500 + Math.min(2600, v * 1400), t, 0.05);
    const dry = 1 - this.brush.load;
    this.lfoGain.gain.setTargetAtTime(Math.max(0, dry - 0.3) * 0.9, t, 0.1);
  }

  _end() {
    if (!this.ctx) return;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
  }

  toggle() {
    this.on = !this.on;
    if (!this.on && this.ctx) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    return this.on;
  }
}
