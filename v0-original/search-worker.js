// Holds the region index off the main thread and ranks regions against a
// drawing descriptor (cosine similarity), returning the best region per work.
let dims = 0, n = 0, table = null, descs = null, norms = null;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "load") {
    const res = await fetch(msg.url);
    if (!res.ok) { self.postMessage({ type: "error", error: `index.bin ${res.status}` }); return; }
    const buf = await res.arrayBuffer();
    dims = msg.dims; n = msg.regions;
    table = new Float32Array(buf, 0, n * 4);
    descs = new Uint8Array(buf, msg.tableBytes, n * dims);
    norms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * dims;
      for (let j = 0; j < dims; j++) s += descs[o + j] * descs[o + j];
      norms[i] = Math.sqrt(s) || 1;
    }
    self.postMessage({ type: "ready", regions: n });
    return;
  }
  if (msg.type === "query" && descs) {
    const q = msg.desc; // Float32Array, L2-normalised
    const k = msg.k || 8;
    const exclude = new Set(msg.exclude || []);
    const best = new Map(); // work -> {score, region}
    for (let i = 0; i < n; i++) {
      const w = table[i * 4];
      if (exclude.has(w)) continue;
      const o = i * dims;
      let s = 0;
      for (let j = 0; j < dims; j++) s += q[j] * descs[o + j];
      s /= norms[i];
      const cur = best.get(w);
      if (!cur || s > cur.score) best.set(w, { score: s, region: i });
    }
    const top = [...best.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, k)
      .map(([work, { score, region }]) => ({
        work, score,
        crop: { x: table[region * 4 + 1], y: table[region * 4 + 2], s: table[region * 4 + 3] },
      }));
    self.postMessage({ type: "results", id: msg.id, top });
  }
};
