// Size of the Print Point window: dragged from its corner, from a small strip to most of the window's width, and
// remembered. It never grows down into the telemetry panel, and it gives way when the panel grows.
const KEY = 'typewriter.printPoint.size';
const MIN_W = 220, MIN_H = 90, DEFAULT_H = 440, EDGE = 28, GAP = 12, HEADER = 22;

function loadSize() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return Number.isFinite(s?.w) && Number.isFinite(s?.h) ? s : null;
  } catch { return null; }
}

function saveSize(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* the size just isn't remembered */ }
}

export function setupPrintPointWindow({ panel, insets, front, handle }) {
  let size = loadSize();
  const apply = () => {
    const room = panel.getBoundingClientRect().top - insets.getBoundingClientRect().top - HEADER - GAP;
    const w = size ? size.w : Math.min(620, window.innerWidth * 0.42);
    const h = size ? size.h : DEFAULT_H;
    insets.style.width = `${Math.round(Math.max(MIN_W, Math.min(window.innerWidth - EDGE, w)))}px`;
    front.style.height = `${Math.round(Math.max(MIN_H, Math.min(room, h)))}px`;
  };

  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    drag = { x: e.clientX, y: e.clientY, w: insets.getBoundingClientRect().width, h: front.getBoundingClientRect().height };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    size = { w: drag.w + e.clientX - drag.x, h: drag.h + e.clientY - drag.y };
    apply();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    size = { w: Math.round(insets.getBoundingClientRect().width), h: Math.round(front.getBoundingClientRect().height) };
    saveSize(size);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  new ResizeObserver(apply).observe(panel);
  window.addEventListener('resize', apply);
  apply();
}
