// Way markers (docs/displaywriter/architecture.md 3.5): a circle with an arrow over each place the camera can go from
// here, the station's focus items and, from the desk, the other stations. The arrow points the way the camera will
// move: up for a step forward toward something ahead, sideways or down toward something off to one side, a turn for
// the view around the back. Only a marker (or the bar, or an edge arrow) moves the camera; the objects themselves no
// longer do, and nothing is outlined. The bar's ◉ button hides them all; the choice is remembered.
import * as THREE from 'three';
import { unionBox } from '../interact/wp-views.js';

const KEY = 'wpMarkers';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 L19 12 H14.5 V20 H9.5 V12 H5 Z"/></svg>';
const TURN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7 A7 7 0 1 1 5 13" fill="none" stroke-width="2.6" stroke-linecap="round"/><path d="M2.5 4.5 L8.5 5 L6.5 10.5 Z"/></svg>';
const AHEAD = 0.16;             // within this fraction of the window's shorter side from its centre, a marker is ahead

export function markersShown() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

/** Markers over the canvas. update() each frame places them; setShown(on) is the bar's toggle. */
export class WayMarkers {
  constructor({ nav, boxes, camera, canvas }) {
    this.nav = nav; this.boxes = boxes; this.camera = camera; this.canvas = canvas;
    this.shown = markersShown();
    this.root = document.createElement('div');
    this.root.id = 'navMarkers';
    document.body.appendChild(this.root);
    this.items = [];
    this.v = new THREE.Vector3();
    nav.onChange(() => this.rebuild());
    this.rebuild();
  }

  setShown(on) {
    this.shown = on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* the choice lasts the visit */ }
    this.root.hidden = !on;
  }

  /** The targets of this view: focus items, and from the desk the stations; none in the free view. */
  rebuild() {
    this.root.replaceChildren();
    this.root.hidden = !this.shown;
    this.items = [];
    const nav = this.nav, atDesk = nav.station === 'desk' && !nav.focusId;
    for (const t of nav.targets()) {
      if (t.kind === 'station' && !atDesk) continue;          // the edge arrows and the bar go to the other stations
      const b = unionBox(t.boxes.map((n) => this.boxes()[n]).filter(Boolean));
      if (!Number.isFinite(b.min[0])) continue;
      const rear = t.id.endsWith('/rear');
      // The marker sits on the near face of its box, at its middle; the view around the back on its right side.
      const at = rear ? [b.max[0], (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
        : [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]];
      const el = document.createElement('button');
      el.type = 'button'; el.tabIndex = -1; el.className = 'way';
      el.innerHTML = `<span class="ring">${rear ? TURN : ARROW}</span><span class="name">${t.label}</span>`;
      el.title = `${t.label}${t.kind === 'focus' ? ' · look closer' : ' · go there'}`;
      el.addEventListener('click', (e) => { e.stopPropagation(); nav.go(t.id); });
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.root.appendChild(el);
      this.items.push({ el, at: new THREE.Vector3(...at), rear, svg: el.querySelector('svg') });
    }
  }

  update() {
    if (!this.shown || !this.items.length) return;
    const r = this.canvas.getBoundingClientRect(), cam = this.camera;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, near = AHEAD * Math.min(r.width, r.height);
    for (const it of this.items) {
      const p = this.v.copy(it.at).project(cam);
      const off = p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05;
      it.el.style.display = off ? 'none' : '';
      if (off) continue;
      const x = r.left + (p.x + 1) / 2 * r.width, y = r.top + (1 - p.y) / 2 * r.height;
      it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (it.rear) continue;
      // Up for ahead, else toward where it lies from the middle of the view.
      const dx = x - cx, dy = y - cy;
      const deg = Math.hypot(dx, dy) < near ? 0 : (Math.atan2(dx, -dy) * 180) / Math.PI;
      it.svg.style.transform = `rotate(${deg.toFixed(0)}deg)`;
    }
  }
}
