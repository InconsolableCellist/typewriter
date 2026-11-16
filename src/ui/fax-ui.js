// The fax kit's flat pieces (docs/fax/plan.md M7), in the manner of the Displaywriter's manual reader and PDF viewer
// (src/ui/wp-pdf-viewer.js): one overlay that shows a received page to read, the card index of correspondents, the
// document tray's sample documents (and an uploaded image, decision 21: kept in the browser), and the keyboard's keys
// (decision 14); and a small inset that repeats the 16-character LCD where the panel is too small to read.
// While the overlay is open no key reaches the machine (Esc closes).
const CSS = `
#faxOv { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(5,6,8,.72);
  font: 12px "IBM Plex Mono", "SF Mono", Menlo, Consolas, monospace; }
#faxOv[hidden] { display: none; }
#faxOv .win { width: min(760px, calc(100vw - 24px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  background: #2b2a33; border-radius: 4px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.5); color: #ebe8f4; }
#faxOv header { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px; background: #3a3846; }
#faxOv header .t { flex: 1; letter-spacing: .05em; }
#faxOv button, #faxOv label.btn { color: #fff; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.28);
  border-radius: 3px; padding: 4px 10px; font: inherit; cursor: pointer; }
#faxOv .body { overflow: auto; padding: 12px 14px; }
#faxOv .page { display: block; margin: 0 auto; background: #eeebde; box-shadow: 0 2px 10px rgba(0,0,0,.4); max-width: 100%; }
#faxOv .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
#faxOv .card { background: #f3eedc; color: #2a2a30; border-radius: 3px; padding: 8px 10px; line-height: 1.45; }
#faxOv .card b { display: block; letter-spacing: .04em; }
#faxOv .card .n { font-size: 14px; }
#faxOv .card .k { float: right; color: #6a5f7e; }
#faxOv .docs { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
#faxOv .doc { background: none; border: 1px solid rgba(255,255,255,.2); padding: 6px; text-align: center; }
#faxOv .doc canvas { width: 100%; background: #fff; display: block; margin-bottom: 4px; }
#faxOv table { border-collapse: collapse; } #faxOv td { padding: 2px 10px 2px 0; vertical-align: top; }
#faxOv kbd { background: #504d5e; border-radius: 3px; padding: 1px 6px; }
#faxLcd { position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%); z-index: 20; pointer-events: none;
  background: #b9c2ae; color: #252c28; font: 18px "DejaVu Sans Mono", "Courier New", monospace; letter-spacing: .12em;
  padding: 4px 10px; border-radius: 3px; box-shadow: inset 0 1px 4px rgba(0,0,0,.35), 0 1px 6px rgba(0,0,0,.4); white-space: pre; }
#faxLcd[hidden] { display: none; }
`;

export function installFaxUi() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'faxOv'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.innerHTML = `<div class="win"><header><span class="t"></span><span class="extra"></span>
    <button class="close" type="button" title="close (Esc)" aria-label="close">✕</button></header><div class="body"></div></div>`;
  document.body.appendChild(root);
  const title = root.querySelector('.t'), body = root.querySelector('.body'), extra = root.querySelector('.extra');
  const lcd = document.createElement('div');
  lcd.id = 'faxLcd'; lcd.textContent = ''.padEnd(16, ' ');
  document.body.appendChild(lcd);
  const close = () => { root.hidden = true; body.innerHTML = ''; extra.innerHTML = ''; };
  root.querySelector('.close').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') close();
    e.stopPropagation();
  }, true);
  const open = (t, el) => { title.textContent = t; body.innerHTML = ''; extra.innerHTML = ''; body.appendChild(el); root.hidden = false; };
  const div = (cls, html = '') => { const d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = html; return d; };

  return {
    get isOpen() { return !root.hidden; },
    close,
    setLcd(text) { lcd.textContent = String(text ?? '').slice(0, 16).padEnd(16, ' '); },
    showLcd(on) { lcd.hidden = !on; },

    /** A received page: its canvas (one row a line), its size; ‹ › for the others. */
    page(pages, index) {
      const show = (i) => {
        const p = pages[i];
        const c = p.canvas;
        const img = document.createElement('canvas');
        img.width = c.width; img.height = c.height;
        img.getContext('2d').drawImage(c, 0, 0);
        img.className = 'page';
        // The canvas is 4 px a mm across and 7.7 rows a mm along: shown at its paper's proportions.
        const wmm = c.width / 4, hmm = p.lengthM * 1000;
        img.style.width = `${Math.min(680, wmm * 3)}px`;
        img.style.aspectRatio = `${wmm} / ${hmm}`;
        img.style.height = 'auto';
        open(`RECEIVED ${i + 1} OF ${pages.length} · ${hmm.toFixed(0)} MM`, img);
        if (pages.length > 1) {
          const prev = document.createElement('button'), next = document.createElement('button');
          prev.textContent = '‹'; next.textContent = '›';
          prev.onclick = () => show((i + pages.length - 1) % pages.length);
          next.onclick = () => show((i + 1) % pages.length);
          extra.append(prev, ' ', next);
        }
      };
      show(index ?? pages.length - 1);
    },

    /** The card index: each card's number, name and what is written on it. */
    cards(cards) {
      const g = div('cards');
      for (const c of cards) {
        g.appendChild(div('card', `<span class="k">${c.speed <= 5 ? 'RAPID ' + 'ABCDE'[c.speed - 1] : 'SPEED ' + String(c.speed).padStart(2, '0')}</span>
          <b class="n">${c.number}</b><b>${c.name}</b>${c.card}`));
      }
      const note = div('', '<p>Dial with the keypad and START, a rapid key, or SPEED DIAL and two digits. The desk\'s own number is 555-0100.</p>');
      const wrap = div('');
      wrap.append(note, g);
      open('CARD INDEX', wrap);
    },

    /** The document tray: sample documents (thumbs), and an image of one's own. pick(name) or upload(file). */
    documents(samples, { pick, upload }) {
      const g = div('docs');
      for (const s of samples) {
        const b = document.createElement('button');
        b.className = 'doc'; b.type = 'button';
        b.appendChild(s.thumb);
        b.appendChild(document.createTextNode(s.title));
        b.onclick = () => { close(); pick(s.name); };
        g.appendChild(b);
      }
      const up = document.createElement('label');
      up.className = 'btn';
      up.innerHTML = 'an image of your own… <input type="file" accept="image/*" hidden>';
      up.querySelector('input').onchange = (e) => { const f = e.target.files?.[0]; if (f) { close(); upload(f); } };
      const wrap = div('');
      wrap.append(div('', '<p>Lay a sheet face down in the feeder. Up to five; the machine draws the first in.</p>'), g, div('', '<p></p>'), up,
        div('', '<p style="opacity:.7">An image stays in this browser: it is scaled onto a letter sheet here and sent only to the desk\'s own exchange.</p>'));
      open('DOCUMENTS', wrap);
    },

    /** The keyboard (decision 14). */
    keys(rows) {
      const t = document.createElement('table');
      for (const [k, v] of rows) t.insertAdjacentHTML('beforeend', `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`);
      open('KEYS', t);
    },
  };
}
