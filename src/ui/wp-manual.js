// The operator's manual, open: an overlay of off-white pages set like a period IBM reference, one page at a time.
// ← and → (or a click on either half of the page, a swipe, the buttons) turn the pages; Esc or the close button
// shuts it. Esc is also the machine's CANCL, so while the binder is open every key stops here, in the capture phase
// on window, before the machine's keyboard (or the view shortcuts) can see it. Closed, it takes nothing.
import { PAGES } from './wp-manual-pages.js';

const CSS = `
#wpManual { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: rgba(8, 9, 12, 0.72); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  opacity: 0; transition: opacity 0.18s ease; }
#wpManual.on { opacity: 1; }
#wpManual[hidden] { display: none; }
#wpManual .sheet { position: relative; box-sizing: border-box; width: min(620px, calc(100vw - 24px));
  height: min(800px, calc(100dvh - 24px)); display: flex; flex-direction: column;
  background: #f4f1e8; color: #1c1c1c; border-radius: 2px 6px 6px 2px;
  box-shadow: 0 18px 50px rgba(0,0,0,0.55), inset 14px 0 18px -14px rgba(0,0,0,0.25);
  font: 15px/1.45 "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif; touch-action: pan-y;
  -webkit-user-select: none; user-select: none; overflow: hidden; }
#wpManual .holes { position: absolute; left: 10px; top: 0; bottom: 0; width: 12px; pointer-events: none;
  background: radial-gradient(circle at 6px 50%, #2a2c33 0 4.5px, transparent 5px) 0 0 / 12px 33.3% repeat-y; opacity: 0.55; }
#wpManual header { padding: 22px 30px 0 40px; display: flex; justify-content: space-between; align-items: baseline;
  font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #555; }
#wpManual header .logo { font-weight: 700; letter-spacing: 0.02em; color: #1b2233;
  background: repeating-linear-gradient(#1b2233 0 1.5px, transparent 1.5px 2.6px); -webkit-background-clip: text;
  background-clip: text; -webkit-text-fill-color: transparent; font-size: 17px; line-height: 1; }
#wpManual .body { flex: 1; overflow-y: auto; padding: 6px 30px 10px 40px; transition: transform 0.18s ease, opacity 0.18s ease; }
#wpManual .body.out-l { transform: translateX(-24px); opacity: 0; }
#wpManual .body.out-r { transform: translateX(24px); opacity: 0; }
#wpManual h2 { font-size: 26px; line-height: 1.15; font-weight: 700; margin: 14px 0 4px; letter-spacing: -0.01em; }
#wpManual h2 + .rule { height: 3px; background: #1b2233; margin: 0 0 14px; width: 64px; }
#wpManual h3 { font-size: 14px; font-weight: 700; margin: 14px 0 2px; }
#wpManual p { margin: 0 0 10px; }
#wpManual .lead { font-size: 16px; }
#wpManual .note, #wpManual .aside { border-left: 3px solid #1b2233; padding: 4px 0 4px 10px; font-size: 14px; color: #333; }
#wpManual ol.steps { padding-left: 1.4em; margin: 0 0 10px; }
#wpManual ol.steps li { margin: 0 0 7px; padding-left: 2px; }
#wpManual ol.toc { list-style: none; padding: 0; margin: 10px 0 16px; counter-reset: toc; }
#wpManual ol.toc li { counter-increment: toc; display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px dotted #999;
  cursor: pointer; font-weight: 600; }
#wpManual ol.toc li::before { content: counter(toc); width: 1.4em; color: #1b2233; }
#wpManual ol.toc .pg { margin-left: auto; font-weight: 400; color: #666; }
#wpManual ol.toc li:hover { color: #0b3d91; }
#wpManual table { border-collapse: collapse; width: 100%; font-size: 13.5px; margin: 4px 0 12px; }
#wpManual th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #444;
  border-bottom: 2px solid #1b2233; padding: 4px 6px 4px 0; }
#wpManual td { border-bottom: 1px solid #d3cfc3; padding: 5px 8px 5px 0; vertical-align: top; }
#wpManual table.msgs td:first-child { font-family: "IBM Plex Mono", Menlo, Consolas, monospace; font-size: 12.5px; width: 48%; }
#wpManual kbd { display: inline-block; font: 600 11px/1 "Helvetica Neue", Helvetica, Arial, sans-serif; letter-spacing: 0.03em;
  padding: 3px 5px 2px; margin: 0 1px; border: 1px solid #8f8a7d; border-bottom-width: 2px; border-radius: 3px;
  background: #fffdf6; color: #111; white-space: nowrap; vertical-align: 1px; }
#wpManual .seq { white-space: normal; }
#wpManual .seq b { font-family: "IBM Plex Mono", Menlo, Consolas, monospace; font-weight: 700; }
#wpManual footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 18px 14px 32px;
  font-size: 12px; color: #555; border-top: 1px solid #ddd8ca; }
#wpManual footer button, #wpManual .close { font: inherit; background: none; border: 1px solid #b9b3a4; border-radius: 4px;
  color: #1b2233; cursor: pointer; min-width: 44px; min-height: 36px; font-size: 18px; line-height: 1; }
#wpManual footer button:disabled { opacity: 0.3; cursor: default; }
#wpManual .close { position: absolute; top: 10px; right: 10px; border: none; font-size: 22px; min-height: 40px; z-index: 1; }
#wpManual header { padding-right: 56px; }
@media (max-width: 520px) {
  #wpManual .sheet { width: calc(100vw - 12px); height: calc(100dvh - 12px); font-size: 14.5px; }
  #wpManual header { padding: 16px 52px 0 30px; font-size: 10px; }
  #wpManual .body { padding: 4px 16px 10px 30px; }
  #wpManual h2 { font-size: 22px; }
  #wpManual footer { padding: 6px 10px 10px 24px; }
  #wpManual .holes { left: 6px; }
}
`;

/** Builds the reader (hidden). Returns { open(page), close(), turn(d), get isOpen, get page }. */
export function installManualReader({ pages = PAGES } = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'wpManual'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'IBM Displaywriter System Operator Reference');
  root.innerHTML = `
    <div class="sheet">
      <div class="holes"></div>
      <button class="close" type="button" title="close (Esc)" aria-label="close">✕</button>
      <header><span class="logo">IBM</span><span>Displaywriter System · Operator Reference</span></header>
      <div class="body" aria-live="polite"></div>
      <footer><button class="prev" type="button" aria-label="previous page" title="previous page (←)">‹</button>
        <span class="num"></span><button class="next" type="button" aria-label="next page" title="next page (→)">›</button></footer>
    </div>`;
  document.body.appendChild(root);
  const sheet = root.querySelector('.sheet'), body = root.querySelector('.body'), num = root.querySelector('.num');
  const prev = root.querySelector('.prev'), next = root.querySelector('.next');
  let open = false, page = 0, turning = 0;
  const swallowUp = new Set();

  const render = () => {
    const p = pages[page];
    body.innerHTML = `<h2>${p.title}</h2><div class="rule"></div>${p.html}`;
    body.scrollTop = 0;
    num.textContent = `${page + 1} of ${pages.length}`;
    prev.disabled = page === 0; next.disabled = page === pages.length - 1;
    for (const li of body.querySelectorAll('[data-page]')) {
      li.insertAdjacentHTML('beforeend', `<span class="pg">${+li.dataset.page + 1}</span>`);
      li.addEventListener('click', (e) => { e.stopPropagation(); go(+li.dataset.page); });
    }
  };
  const go = (n) => {
    n = Math.max(0, Math.min(pages.length - 1, n));
    if (n === page) return;
    const dir = n > page ? 'out-l' : 'out-r';
    page = n;
    clearTimeout(turning);
    body.classList.add(dir);
    turning = setTimeout(() => { render(); body.classList.remove(dir); }, 140);
  };
  const turn = (d) => go(page + d);

  const show = (n = page) => {
    if (open) { go(n); return; }
    open = true; page = Math.max(0, Math.min(pages.length - 1, n)); render();
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('on'));
    document.activeElement?.blur?.();
  };
  const hide = () => {
    if (!open) return;
    open = false; root.classList.remove('on');
    setTimeout(() => { if (!open) root.hidden = true; }, 180);
  };

  root.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); hide(); });
  prev.addEventListener('click', (e) => { e.stopPropagation(); turn(-1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); turn(1); });
  // A click outside the sheet closes it.
  root.addEventListener('click', (e) => { if (e.target === root) hide(); });

  // A tap on either half of the page turns it; a horizontal swipe too. A vertical drag scrolls a long page.
  let down = null;
  sheet.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  sheet.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    const d = down; down = null;
    if (e.target.closest('button, [data-page]')) return;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) { turn(dx < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) < 8 && performance.now() - d.t < 600) {
      const r = sheet.getBoundingClientRect();
      turn(e.clientX > r.left + r.width / 2 ? 1 : -1);
    }
  });
  sheet.addEventListener('pointercancel', () => { down = null; });

  // Every key while open is the binder's, none the machine's.
  window.addEventListener('keydown', (e) => {
    if (!open) return;
    e.stopImmediatePropagation();
    swallowUp.add(e.code);
    if (!e.ctrlKey && !e.metaKey) e.preventDefault();
    if (e.repeat && e.key === 'Escape') return;
    if (e.key === 'Escape') hide();
    else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') turn(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn(-1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(pages.length - 1);
    else if (e.key === 'ArrowDown') body.scrollBy(0, 40);
    else if (e.key === 'ArrowUp') body.scrollBy(0, -40);
  }, true);
  window.addEventListener('keyup', (e) => {
    // Only the releases of keys the binder took: a key already down for the machine still lets go there.
    if (!swallowUp.delete(e.code)) return;
    e.stopImmediatePropagation();
  }, true);

  return { open: show, close: hide, turn, get isOpen() { return open; }, get page() { return page; }, root };
}
