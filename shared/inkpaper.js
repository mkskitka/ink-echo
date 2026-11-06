// InkPaper -- ink soaking into paper, simulated on the GPU (WebGL2).
//
// State per pixel (RGBA, half float when available):
//   r  water held in the paper fibres
//   g  pigment still suspended in that water (can still travel)
//   b  pigment deposited (bound to the fibres: permanent)
//   a  unused
// Each frame, water wicks outward through a fibre field (fast along fibres, so
// wet edges feather the way xuan paper does), pigment rides the water but more
// slowly, and as the paper dries the pigment settles -- a little more at the
// drying edge, which gives the dark rim of a wet stroke. Sized silk barely
// wicks: lines stay crisp. Brush dabs are splatted in with bristle lanes so a
// dry, fast brush leaves "flying white" streaks (feibai).
//
// The layer renders ink only (premultiplied alpha), so it composites over the
// paper and any painting passages beneath it.

const PAPERS = {
  // wick: water diffusion; carry: pigment mobility; front: how readily a dry
  // fibre takes water; evap: drying rate; settle: pigment deposition rate
  xuan: { wick: 0.24, carry: 0.05, front: 0.012, evap: 0.045, settle: 0.8, fibre: 0.85, label: "Xuan paper (raw, absorbent)" },
  sized: { wick: 0.09, carry: 0.03, front: 0.030, evap: 0.070, settle: 1.6, fibre: 0.6, label: "Sized paper" },
  silk: { wick: 0.035, carry: 0.012, front: 0.060, evap: 0.10, settle: 2.6, fibre: 0.35, label: "Silk (sized, smooth)" },
};

const VS_QUAD = `#version 300 es
in vec2 a; out vec2 uv;
void main(){ uv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

const VS_DAB = `#version 300 es
in vec2 a;
in vec4 i0;   // x, y (px), radius (px), elongation
in vec4 i1;   // dir x, dir y, water, ink
in vec4 i2;   // lane seed, dryness, tip (0 centred .. 1 side), along (arc px)
uniform vec2 res;
out vec2 q; out vec4 v1; out vec4 v2;
void main(){
  vec2 d = normalize(i1.xy + vec2(1e-5, 0.0));
  vec2 n = vec2(-d.y, d.x);
  vec2 p = i0.xy + d * a.x * i0.z * i0.w + n * a.y * i0.z;
  q = a; v1 = i1; v2 = i2;
  vec2 c = p / res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FS_DAB = `#version 300 es
precision highp float;
in vec2 q; in vec4 v1; in vec4 v2; out vec4 o;
float h1(float x){ return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
void main(){
  float r = length(q);
  if (r > 1.0) discard;
  // side tip: the footprint is a wedge, heavy on one edge (the belly) and
  // light on the other (the point); centred tip is round and even
  float tip = v2.z;
  float wedge = mix(1.0, smoothstep(-1.1, 0.9, q.y), tip);
  float fall = (1.0 - smoothstep(0.62, 1.0, r)) * wedge;
  // bristle lanes run along the stroke (q.y is across it)
  float lanes = mix(11.0, 20.0, tip);
  float l = (q.y * 0.5 + 0.5) * lanes + v2.x;
  float b = mix(h1(floor(l)), h1(floor(l) + 1.0), smoothstep(0.15, 0.85, fract(l)));
  float dry = v2.y;
  float bristle = smoothstep(dry * 0.95 - 0.05, dry * 0.95 + 0.12, b);
  float water = v1.z * fall * mix(1.0, bristle, 0.6 + 0.4 * dry);
  float ink = v1.w * fall * bristle * (0.72 + 0.28 * b);
  o = vec4(water, ink, ink * dry * 0.6, 0.0);   // a dry brush binds some pigment at once
}`;

const FS_SIM = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S; uniform sampler2D F;
uniform vec2 px; uniform vec2 ftile; uniform float dt;
uniform float wick, carry, front, evap, settle;
// fibre channels carry water; the matted pulp between them barely does
float perm(vec2 p){ float f = texture(F, p * ftile).r; return 0.08 + 0.92 * smoothstep(0.45, 0.95, f); }
void main(){
  vec4 c = texture(S, uv);
  float pc = perm(uv);
  vec2 off[4] = vec2[4](vec2(px.x, 0.0), vec2(-px.x, 0.0), vec2(0.0, px.y), vec2(0.0, -px.y));
  float dw = 0.0, dp = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 n = texture(S, uv + off[i]);
    float pn = perm(uv + off[i]);
    float k = min(pc, pn);
    // capillary front: water moves into a drier fibre only past a small threshold,
    // so the wet edge advances in irregular feathered fingers along the fibres
    float wd = n.r - c.r;
    // the wetter side must be past the front threshold to push into the drier one
    float gate = smoothstep(front, front * 3.0 + 0.002, wd > 0.0 ? n.r : c.r);
    dw += wick * k * gate * wd;
    // pigment: diffuses only through wet paper, and rides the outward flow toward
    // the drying edge (conserved: what leaves one cell enters the next)
    float wet = smoothstep(0.02, 0.2, min(n.r, c.r) + 0.5 * max(n.r, c.r));
    dp += carry * k * wet * (n.g - c.g);
    dp += 0.5 * wick * k * gate * wet * (max(wd, 0.0) * n.g - max(-wd, 0.0) * c.g);
  }
  float w = max(0.0, c.r + dw * dt * 60.0);
  float p = max(0.0, c.g + dp * dt * 60.0);
  // drying: thin water evaporates fastest -> the rim dries first and pigment piles up there
  float e = evap * dt * (0.25 + 0.75 * smoothstep(0.35, 0.0, w)) * (1.15 - pc * 0.3);
  w = max(0.0, w - e);
  float s = p * clamp(settle * dt * (0.2 + 2.2 * smoothstep(0.25, 0.0, w)), 0.0, 1.0);
  if (w < 0.004) s = p;           // dry: everything settles
  o = vec4(w, p - s, min(4.0, c.b + s), 0.0);
}`;

const FS_SHIFT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S; uniform vec2 shift;
void main(){
  vec2 p = uv + shift;
  o = (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) ? vec4(0.0) : texture(S, p);
}`;

const FS_FADE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S; uniform float k;
void main(){ vec4 c = texture(S, uv); o = vec4(c.r, c.g * k, c.b * k, c.a); }`;

// Reveal mode: instead of black ink, show a painting wherever the simulated
// pigment has soaked in. (Painting texture must be same-origin.)
const FS_REVEAL = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S; uniform sampler2D F; uniform sampler2D R;
uniform vec2 ftile; uniform vec2 view;   // CSS px size of the canvas
uniform vec3 m0; uniform vec3 m1;        // inverse affine: CSS px -> painting uv
void main(){
  vec4 c = texture(S, uv);
  vec2 css = vec2(uv.x, 1.0 - uv.y) * view;
  vec2 t = vec2(dot(m0, vec3(css, 1.0)), dot(m1, vec3(css, 1.0)));
  if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) { o = vec4(0.0); return; }
  float fib = texture(F, uv * ftile).r;
  float dens = c.b + c.g * 0.8;
  // soaked-in edge: feathered by the fibres
  float a = smoothstep(0.02, 0.22 + 0.1 * fib, dens);
  vec3 col = texture(R, t).rgb;
  o = vec4(col * a, a);
}`;

const FS_DRAW = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D S; uniform sampler2D F; uniform vec2 ftile; uniform vec3 ink; uniform float tone;
void main(){
  vec4 c = texture(S, uv);
  vec2 fu = uv * ftile;
  float fib = texture(F, fu).r, grain = texture(F, fu * 2.7 + 0.31).g;
  // optical density of settled + still-wet pigment; pigment lodges in the fibres (granulation)
  float dens = c.b * (0.82 + 0.36 * grain) + c.g * 0.75;
  float a = 1.0 - exp(-dens * 2.8 * tone);
  // wet paper turns slightly translucent and darker
  float wet = smoothstep(0.0, 0.5, c.r) * 0.07 * (0.7 + 0.3 * fib);
  float alpha = clamp(a + wet * (1.0 - a), 0.0, 1.0);
  vec3 col = mix(vec3(0.36, 0.33, 0.29), ink, clamp(a / max(alpha, 1e-4), 0.0, 1.0));
  o = vec4(col * alpha, alpha);
}`;

export class InkPaper {
  /** canvas: a <canvas> sized by CSS. opts: paper ('xuan' | 'sized' | 'silk'),
   *  ink [r, g, b] 0..1, maxPixels (simulation resolution cap). */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = { paper: "xuan", ink: [0.08, 0.07, 0.06], maxPixels: 2.4e6, tone: 1, ...opts };
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    this.ok = !!gl;
    if (!gl) return;
    this.gl = gl;
    const half = gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float");
    gl.getExtension("EXT_float_blend");
    this.fmt = half ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    this.p = {
      sim: this._prog(VS_QUAD, FS_SIM), draw: this._prog(VS_QUAD, FS_DRAW),
      shift: this._prog(VS_QUAD, FS_SHIFT), fade: this._prog(VS_QUAD, FS_FADE), dab: this._prog(VS_DAB, FS_DAB),
      reveal: this._prog(VS_QUAD, FS_REVEAL),
    };
    // geometry
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.inst = gl.createBuffer();
    this.dabs = [];
    this.fibre = this._fibreTexture();
    this.wetUntil = 0;
    this.dirty = true;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    const loop = (t) => { this._frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  get paper() { return PAPERS[this.opts.paper] || PAPERS.xuan; }
  setPaper(name) { this.opts.paper = name; this.dirty = true; }
  static papers() { return PAPERS; }

  _prog(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u, a: gl.getAttribLocation(p, "a") };
  }

  _tex(w, h, data = null, internal = this.fmt.internal, format = this.gl.RGBA, type = this.fmt.type, wrap = this.gl.CLAMP_TO_EDGE) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  /** Fibre field: long, slightly curved fibres over a soft cloudy base, tileable. */
  _fibreTexture() {
    const N = 512;
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d");
    // base: cloudy permeability (mulberry/bark pulp lies unevenly)
    const img = g.createImageData(N, N);
    const rnd = mulberry(7);
    const grid = 16, v = [];
    for (let i = 0; i < grid * grid; i++) v.push(rnd());
    const val = (x, y) => {
      const gx = (x / N) * grid, gy = (y / N) * grid;
      const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      const at = (i, j) => v[((j % grid) * grid + (i % grid))];
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const cloud = 0.55 + 0.3 * val(x, y) + 0.15 * val(x * 3 % N, y * 3 % N);
      img.data[i] = cloud * 200; img.data[i + 1] = rnd() * 255; img.data[i + 2] = 0; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // fibres: bright = permeable channels
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (let k = 0; k < 2600; k++) {
      let x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2;
      const len = 10 + rnd() * 60;
      g.strokeStyle = `rgba(${40 + rnd() * 60},0,0,1)`;
      g.lineWidth = 0.6 + rnd() * 1.1;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < len; s += 4) {
        a += (rnd() - 0.5) * 0.35; x += Math.cos(a) * 4; y += Math.sin(a) * 4;
        g.lineTo(x, y);
      }
      g.stroke();
      // wrap so the tile repeats seamlessly
      if (x < 0 || y < 0 || x > N || y > N) {
        g.save(); g.translate(x < 0 ? N : x > N ? -N : 0, y < 0 ? N : y > N ? -N : 0); g.stroke(); g.restore();
      }
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const t = this._tex(N, N, null, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.fibreSize = N;
    return t;
  }

  resize() {
    if (!this.ok) return;
    const gl = this.gl;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let k = dpr;
    if (cw * ch * k * k > this.opts.maxPixels) k = Math.sqrt(this.opts.maxPixels / (cw * ch));
    const W = Math.round(cw * k), H = Math.round(ch * k);
    if (W === this.W && H === this.H) return;
    const old = this.tex ? { tex: this.tex[this.cur], W: this.W, H: this.H } : null;
    this.W = W; this.H = H; this.k = k;
    this.canvas.width = W; this.canvas.height = H;
    this.tex = [this._tex(W, H), this._tex(W, H)];
    this.fbo = this.tex.map((t) => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    });
    this.cur = 0;
    if (old) { // keep what was painted (stretched) rather than wiping the sheet
      this._pass(this.p.shift, this.fbo[0], { S: old.tex }, { shift: [0, 0] });
    }
    this.dirty = true;
  }

  clear() {
    if (!this.ok) return;
    const gl = this.gl;
    for (const f of this.fbo) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    this.dabs = []; this.dirty = true;
  }

  /** One brush dab, CSS px. dir: unit travel direction. water/ink 0..~1.
   *  dry 0..1 (bristles separate), tip 0 centred .. 1 side, seed: per-stroke lane seed. */
  dab(x, y, r, dx, dy, water, ink, dry = 0, tip = 0, seed = 0, elong = 1) {
    this.dabs.push(x * this.k, y * this.k, Math.max(0.6, r * this.k), elong, dx, dy, water, ink, seed, dry, tip, 0);
    this.wetUntil = performance.now() + 12000;
  }

  /** Move everything painted by (dx, dy) CSS px (handscroll). */
  shift(dx, dy) {
    if (!this.ok || (!dx && !dy)) return;
    this._flush();
    this._pass(this.p.shift, this.fbo[1 - this.cur], { S: this.tex[this.cur] }, { shift: [-dx * this.k / this.W, dy * this.k / this.H] });
    this.cur = 1 - this.cur; this.dirty = true;
  }

  /** Lighten everything (ink soaking back / scroll fading). k: 0..1 multiplier. */
  fade(k) {
    if (!this.ok) return;
    this._pass(this.p.fade, this.fbo[1 - this.cur], { S: this.tex[this.cur] }, { k });
    this.cur = 1 - this.cur; this.dirty = true;
  }

  get wet() { return performance.now() < this.wetUntil; }

  /** Reveal mode: show `img` (same-origin) wherever pigment soaks in. M maps
   *  image px -> CSS px ([a, b, c, d, e, f], canvas convention). null to turn off. */
  setReveal(img, M) {
    const gl = this.gl;
    if (!img) { this.revealTex = null; this.dirty = true; return; }
    if (this.revealImg !== img) {
      if (this.revealTex) gl.deleteTexture(this.revealTex);
      this.revealTex = this._tex(1, 1, null, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.revealImg = img;
    }
    // invert M, then scale to uv
    const [a, b, c, d, e, f] = M;
    const det = a * d - b * c;
    const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
    const W = img.naturalWidth, H = img.naturalHeight;
    // image px = [ia ic; ib id] (css - [e f])
    this.revealM = [
      [ia / W, ic / W, -(ia * e + ic * f) / W],
      [ib / H, id / H, -(ib * e + id * f) / H],
    ];
    this.dirty = true;
  }

  _pass(prog, fbo, texs, unis) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(prog.p);
    let unit = 0;
    for (const [name, t] of Object.entries(texs)) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(prog.u[name], unit++);
    }
    for (const [name, v] of Object.entries(unis)) {
      const loc = prog.u[name];
      if (loc == null) continue;
      if (Array.isArray(v)) (v.length === 2 ? gl.uniform2fv : gl.uniform3fv).call(gl, loc, v); else gl.uniform1f(loc, v);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(prog.a);
    gl.vertexAttribPointer(prog.a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _flush() {
    if (!this.dabs.length) return;
    const gl = this.gl, P = this.p.dab;
    const data = new Float32Array(this.dabs);
    const n = data.length / 12;
    this.dabs = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.cur]);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(P.p);
    gl.uniform2f(P.u.res, this.W, this.H);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(P.a); gl.vertexAttribPointer(P.a, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(P.a, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    const locs = ["i0", "i1", "i2"].map((nm) => gl.getAttribLocation(P.p, nm));
    locs.forEach((loc, i) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 48, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    locs.forEach((loc) => { gl.vertexAttribDivisor(loc, 0); gl.disableVertexAttribArray(loc); });
    gl.disable(gl.BLEND);
    this.dirty = true;
  }

  _frame(t) {
    if (!this.ok) return;
    const dt = Math.min(1 / 30, ((t - (this._t || t)) / 1000) || 1 / 60);
    this._t = t;
    this._flush();
    if (this.wet) {
      const P = this.paper;
      const steps = 2;
      for (let i = 0; i < steps; i++) {
        this._pass(this.p.sim, this.fbo[1 - this.cur], { S: this.tex[this.cur], F: this.fibre }, {
          px: [1 / this.W, 1 / this.H], ftile: [this.W / this.fibreSize / Math.max(1, this.k * 0.75), this.H / this.fibreSize / Math.max(1, this.k * 0.75)],
          dt: dt / steps, wick: P.wick, carry: P.carry, front: P.front, evap: P.evap, settle: P.settle,
        });
        this.cur = 1 - this.cur;
      }
      this.dirty = true;
    }
    if (this.dirty) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const ftile = [this.W / this.fibreSize / Math.max(1, this.k * 0.75), this.H / this.fibreSize / Math.max(1, this.k * 0.75)];
      if (this.revealTex) {
        this._pass(this.p.reveal, null, { S: this.tex[this.cur], F: this.fibre, R: this.revealTex }, {
          ftile, view: [this.W / this.k, this.H / this.k], m0: this.revealM[0], m1: this.revealM[1],
        });
      } else {
        this._pass(this.p.draw, null, { S: this.tex[this.cur], F: this.fibre }, { ftile, ink: this.opts.ink, tone: this.opts.tone });
      }
      this.dirty = false;
    }
  }
}

/** A paper-coloured background with visible fibres, for under the ink layer. */
export function paperBackground(canvas, { tint = [239, 230, 210], kind = "xuan" } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  g.fillStyle = `rgb(${tint.join(",")})`;
  g.fillRect(0, 0, canvas.width, canvas.height);
  const rnd = mulberry(3);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * (kind === "silk" ? 5 : 9);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);
  if (kind === "silk") {           // a faint warp/weft weave
    g.globalAlpha = 0.05; g.strokeStyle = "#6b5a3e";
    for (let x = 0; x < canvas.width; x += 3 * dpr) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, canvas.height); g.stroke(); }
    for (let y = 0; y < canvas.height; y += 3 * dpr) { g.beginPath(); g.moveTo(0, y); g.lineTo(canvas.width, y); g.stroke(); }
  } else {                          // long pale fibres
    g.lineCap = "round";
    for (let k = 0; k < (W * H) / 900; k++) {
      let x = rnd() * canvas.width, y = rnd() * canvas.height, a = rnd() * Math.PI * 2;
      g.strokeStyle = rnd() < 0.6 ? "rgba(255,252,240,0.22)" : "rgba(150,130,100,0.06)";
      g.lineWidth = (0.4 + rnd() * 0.6) * dpr;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 8; s++) { a += (rnd() - 0.5) * 0.4; x += Math.cos(a) * 5 * dpr; y += Math.sin(a) * 5 * dpr; g.lineTo(x, y); }
      g.stroke();
    }
  }
  g.globalAlpha = 1;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
