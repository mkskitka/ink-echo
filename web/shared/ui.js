// Small shared UI pieces for the ink-brush versions.

const CSS = `
.wells { position: fixed; left: 12px; bottom: calc(env(safe-area-inset-bottom) + 54px); z-index: 5; display: flex; flex-direction: column; gap: 10px; }
.well { width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgba(60,45,25,.25); box-shadow: inset 0 2px 6px rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center; font: 11px system-ui, sans-serif; color: rgba(255,255,255,.85); }
.well[aria-pressed="true"] { outline: 2px solid var(--seal); outline-offset: 3px; }
.well span { pointer-events: none; }
body:has(.wells) .caption { left: 68px; max-width: min(calc(100vw - 80px), 460px); }
.toast { position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 64px); transform: translateX(-50%); z-index: 9;
  background: rgba(27,25,21,.82); color: #f3eee3; font: 14px system-ui, sans-serif; padding: 8px 14px; border-radius: 999px;
  opacity: 0; transition: opacity .3s; pointer-events: none; max-width: 86vw; text-align: center; }
.toast.on { opacity: 1; }
`;
let styled = false;
export function style() {
  if (styled) return;
  const s = document.createElement("style"); s.textContent = CSS; document.head.append(s); styled = true;
}

/** Three inkwells: thick, middle, pale ("ink has five colours"). Tapping one
 *  sets the tone the brush is reloaded with. */
export function inkwells(brush, { onDip } = {}) {
  style();
  const box = document.createElement("div");
  box.className = "wells";
  const tones = [
    { label: "濃", name: "thick", tone: 1.0, water: 0.45, bg: "#1b1915" },
    { label: "重", name: "middle", tone: 0.55, water: 0.6, bg: "#5b554c" },
    { label: "淡", name: "pale", tone: 0.22, water: 0.85, bg: "#a39b8c" },
  ];
  const btns = tones.map((t, i) => {
    const b = document.createElement("button");
    b.className = "well"; b.style.background = t.bg; b.title = `${t.name} ink`;
    b.setAttribute("aria-label", `${t.name} ink`);
    b.setAttribute("aria-pressed", String(i === 0));
    b.innerHTML = `<span>${t.label}</span>`;
    b.onclick = () => {
      brush.opts.tone = t.tone; brush.opts.water = t.water; brush.dip(t.tone, t.water);
      btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      onDip && onDip(t);
    };
    return b;
  });
  box.append(...btns);
  document.body.append(box);
  brush.opts.tone = tones[0].tone; brush.opts.water = tones[0].water;
  return box;
}

let toastEl = null, toastT = 0;
export function toast(msg, ms = 2200) {
  style();
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.append(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), ms);
}
