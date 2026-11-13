// The word processor's view controls (docs/displaywriter/architecture.md 3.5): an arrow at each edge of the window
// to the neighbouring station, named on hover (always on a touch screen); a bar at the top with the stations, the
// focus items of this one, Back and the free view; and keyboard shortcuts that the machine never sees. The machine
// takes nearly every key of the PC keyboard (Escape is CANCL), so the shortcuts are Ctrl+Shift chords and the numeric
// keypad, which the machine does not use.

/** Shortcuts: e.code (with Ctrl+Shift held), and the keypad's own codes, to an action. */
export const SHORTCUTS = {
  chord: { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'back', ArrowUp: 'free' },
  keypad: { Numpad4: 'left', Numpad6: 'right', Numpad2: 'back', Numpad0: 'back', Numpad5: 'free', NumpadDecimal: 'free' },
};

/** The action a keydown asks for, or null when it is the machine's. */
export function shortcutFor(e) {
  if (e.ctrlKey && e.shiftKey && !e.altKey && SHORTCUTS.chord[e.code]) return SHORTCUTS.chord[e.code];
  if (!e.ctrlKey && !e.altKey && !e.metaKey && SHORTCUTS.keypad[e.code]) return SHORTCUTS.keypad[e.code];
  return null;
}

export function runAction(nav, action) {
  if (action === 'left') return nav.left();
  if (action === 'right') return nav.right();
  if (action === 'back') return nav.back();
  if (action === 'free') return nav.toggleFree();
  return false;
}

/** Builds the arrows, the bar and the hover label. Returns { hint(text), show(hit, e) }. */
export function installNavUi({ nav, highlight }) {
  const make = (tag, attrs, html = '') => { const el = document.createElement(tag); Object.assign(el, attrs); el.innerHTML = html; return el; };
  const edge = (side) => {
    const b = make('button', { className: `nav-edge ${side}`, type: 'button', tabIndex: -1 }, `<span class="arrow">${side === 'left' ? '‹' : '›'}</span><span class="name"></span>`);
    b.addEventListener('click', () => { nav[side](); b.blur(); });
    document.body.appendChild(b);
    return b;
  };
  document.body.classList.add('wp-views');
  const left = edge('left'), right = edge('right');
  const bar = make('nav', { id: 'navBar', ariaLabel: 'views' });
  document.body.appendChild(bar);
  const note = make('div', { id: 'navNote' });
  document.body.appendChild(note);
  const tip = document.getElementById('labelTip');

  const button = (label, title, fn, cls = '', pressed = null) => {
    const b = make('button', { type: 'button', tabIndex: -1, title, className: cls }, label);
    if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', () => { fn(); b.blur(); });
    return b;
  };

  const render = (w) => {
    for (const [b, n] of [[left, w.left], [right, w.right]]) {
      b.hidden = !n;
      if (!n) continue;
      b.querySelector('.name').textContent = n.label;
      b.title = `${n.label} (${b === left ? 'Ctrl+Shift+←' : 'Ctrl+Shift+→'})`;
    }
    bar.replaceChildren();
    const stations = make('div', { className: 'row stations' });
    for (const s of w.stations) {
      const b = button(s.label, `go to the ${s.label.toLowerCase()}`, () => nav.go(s.id), s.id === w.station && !w.free ? 'here' : '');
      if (s.current && !w.free) b.setAttribute('aria-current', 'true');
      stations.appendChild(b);
    }
    stations.appendChild(button('◎', 'free view: drag to orbit, right-drag or two fingers to pan, wheel or pinch to zoom (Ctrl+Shift+↑)', () => nav.toggleFree(), 'free', w.free));
    bar.appendChild(stations);
    const items = make('div', { className: 'row items' });
    if (w.free) items.appendChild(make('span', { className: 'where' }, 'Free view · drag to orbit · right-drag to pan · wheel to zoom'));
    else for (const f of w.items) {
      const b = button(f.label, f.note ? `${f.label}: ${f.note}` : `look closer: ${f.label.toLowerCase()}`, () => nav.focus(f.id), 'item');
      if (f.current) b.setAttribute('aria-current', 'true');
      items.appendChild(b);
    }
    if (w.canBack) items.appendChild(button('Back', w.free ? 'leave the free view (Ctrl+Shift+↓)' : 'back (Ctrl+Shift+↓)', () => nav.back(), 'back'));
    bar.appendChild(items);
  };
  nav.onChange(render);
  render(nav.where());

  // The shortcuts are taken before the machine's keyboard sees them (both listen on window; capture comes first).
  window.addEventListener('keydown', (e) => {
    if (e.target?.closest?.('input, select, textarea')) return;
    const action = shortcutFor(e);
    if (!action) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) runAction(nav, action);
  }, true);

  let noteTimer = 0;
  const hint = (text) => {
    note.textContent = text; note.classList.add('on');
    clearTimeout(noteTimer); noteTimer = setTimeout(() => note.classList.remove('on'), 2600);
  };

  const show = (hit, e) => {
    const label = !hit ? '' : hit.kind === 'key' ? hit.label ?? '' : hit.kind === 'control' ? hit.label
      : `${hit.target.label} · ${hit.target.kind === 'focus' ? 'look closer' : 'go there'}`;
    highlight?.(hit?.kind === 'nav' ? hit.target.box : null);
    if (tip) {
      tip.style.display = label ? 'block' : 'none';
      if (label) { tip.textContent = label; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 12}px`; }
    }
    if (e.target?.style) e.target.style.cursor = !hit ? '' : hit.kind === 'nav' ? 'zoom-in' : 'pointer';
  };
  // A move clears the hover: what was under the pointer is somewhere else now.
  nav.onChange(() => { highlight?.(null); if (tip) tip.style.display = 'none'; });
  return { hint, show };
}
