// Mirror of scripts/descriptor.py -- keep the two in sync.
export const SIZE = 64, GRID = 4, BINS = 8, DIMS = GRID * GRID * BINS;

export function descriptor(ink /* Float64Array(SIZE*SIZE), 1 = ink */) {
  // 3x3 box blur with edge padding
  const img = new Float64Array(SIZE * SIZE);
  const at = (y, x) => ink[Math.min(SIZE - 1, Math.max(0, y)) * SIZE + Math.min(SIZE - 1, Math.max(0, x))];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += at(y + dy, x + dx);
      img[y * SIZE + x] = s / 9;
    }

  const hist = new Float64Array(DIMS);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const gx = x > 0 && x < SIZE - 1 ? img[y * SIZE + x + 1] - img[y * SIZE + x - 1] : 0;
      const gy = y > 0 && y < SIZE - 1 ? img[(y + 1) * SIZE + x] - img[(y - 1) * SIZE + x] : 0;
      const mag = Math.hypot(gx, gy);
      if (mag === 0) continue;
      let ang = Math.atan2(gy, gx) % Math.PI;
      if (ang < 0) ang += Math.PI;
      const bin = Math.floor((ang / Math.PI) * BINS + 1e-6) % BINS;
      const cell = Math.floor((y * GRID) / SIZE) * GRID + Math.floor((x * GRID) / SIZE);
      hist[cell * BINS + bin] += mag;
    }

  let n = 0;
  for (const v of hist) n += v * v;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < DIMS; i++) hist[i] /= n;
  return hist;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // both are L2-normalised
}
