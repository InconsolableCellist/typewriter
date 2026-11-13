// Where the word processor's camera may stand (docs/displaywriter/architecture.md 3.5). Named stations, each a unit
// seen head-on at a natural distance, joined left and right like the rooms of a point-and-click game; within a station,
// focus items: a closer look at one part. The camera moves only when the user asks: an edge arrow, a station's or a
// focus item's name, a click on a highlighted object, Back, or the free view the user switches on. Pure data and
// arithmetic, no DOM and no three.js, so the graph and the framing are tested in Node.

const deg = Math.PI / 180;

/**
 * Stations. The three units stand in a row, printer, computer, diskettes, and the edge arrows walk along it; the desk
 * is the overview above them, which Back goes up to and whose arrows go down to the row's ends. `boxes` are the named
 * boxes the head-on view frames, `items` the station's focus items, `left` and `right` the edge arrows' stations.
 */
export const STATIONS = {
  desk: { label: 'Desk', boxes: ['printer', 'station', 'display', 'keyboard', 'diskette'], view: { azim: 0, elev: 30 * deg, margin: 1.1 }, left: 'printer', right: 'diskettes', items: ['paper'] },
  printer: { label: 'Printer', boxes: ['printer'], view: { azim: 0, elev: 26 * deg, margin: 1.1 }, left: null, right: 'computer', items: ['panel', 'mechanism', 'paperPath'] },
  computer: { label: 'Computer', boxes: ['station', 'display', 'keyboard'], view: { azim: 0, elev: 14 * deg, margin: 1.08 }, left: 'printer', right: 'diskettes', items: ['screen', 'keyboard', 'controls', 'rear'] },
  diskettes: { label: 'Diskettes', boxes: ['diskette', 'file'], view: { azim: 0, elev: 16 * deg, margin: 1.1 }, left: 'computer', right: null, items: ['slots', 'levers', 'file'] },
};

/** Focus items: a closer look at part of a station. `note(ctx)` may add a word, such as how to open the cover. */
export const FOCUS = {
  screen: { label: 'Screen', boxes: ['screen'], view: { azim: 0, elev: 6 * deg, margin: 1.5, minDistance: 0.32 } },
  keyboard: { label: 'Keyboard', boxes: ['keyboard'], view: { azim: 0, elev: 46 * deg, margin: 1.06 } },
  controls: { label: 'Controls', boxes: ['controls'], view: { azim: 20 * deg, elev: 12 * deg, margin: 1.5, minDistance: 0.34 } },
  rear: { label: 'Rear', boxes: ['station', 'display'], view: { azim: 180 * deg, elev: 20 * deg, margin: 1.12 } },
  slots: { label: 'Slots', boxes: ['slots'], view: { azim: 0, elev: 8 * deg, margin: 1.25, minDistance: 0.3 } },
  levers: { label: 'Levers', boxes: ['levers'], view: { azim: -14 * deg, elev: 22 * deg, margin: 1.5, minDistance: 0.3 } },
  file: { label: 'Desk file', boxes: ['file'], view: { azim: -20 * deg, elev: 34 * deg, margin: 1.3, minDistance: 0.3 } },
  panel: { label: 'Panel', boxes: ['panel'], view: { azim: 0, elev: 34 * deg, margin: 1.35, minDistance: 0.3 } },
  mechanism: { label: 'Mechanism', boxes: ['mechanism'], view: { azim: 0, elev: 58 * deg, margin: 1.15 }, note: (c) => (c?.coverOpen?.() === false ? 'click the cover to open it' : '') },
  paperPath: { label: 'Paper path', boxes: ['paperPath'], view: { azim: -90 * deg, elev: 14 * deg, margin: 1.1 } },
  paper: { label: 'Paper', boxes: ['paper'], view: { azim: 0, elev: 42 * deg, margin: 1.2, minDistance: 0.4 } },
};

const STATION_ORDER = ['desk', 'printer', 'computer', 'diskettes'];

/** The station or focus item named `id` ("computer", or "computer/keyboard"), or null. */
export function viewSpec(id) {
  const [s, f] = String(id).split('/');
  if (!STATIONS[s]) return null;
  if (!f) return { id: s, station: s, focus: null, ...STATIONS[s] };
  if (!STATIONS[s].items.includes(f)) return null;
  return { id: `${s}/${f}`, station: s, focus: f, ...FOCUS[f] };
}

/** The old camera presets (?cam=) as views. */
export const LEGACY_CAMERAS = { overview: 'desk', operator: 'computer', keyboard: 'computer/keyboard', printer: 'printer', diskette: 'diskettes' };

// ---- boxes --------------------------------------------------------------------------------------------------------

const box = (min, max) => ({ min: [...min], max: [...max] });

export function unionBox(list) {
  const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const b of list) for (let i = 0; i < 3; i++) { out.min[i] = Math.min(out.min[i], b.min[i]); out.max[i] = Math.max(out.max[i], b.max[i]); }
  return out;
}

/** A sub-box of `b` by fractions of its size along x, y and z (0 = min, 1 = max). */
function part(b, [x0, x1], [y0, y1], [z0, z1]) {
  const at = (i, f) => b.min[i] + (b.max[i] - b.min[i]) * f;
  return box([at(0, x0), at(1, y0), at(2, z0)], [at(0, x1), at(1, y1), at(2, z1)]);
}

/**
 * Named boxes from the unit boxes alone (wp-geometry.js) and the desk layout: what the views fall back on when a
 * part's model is missing, and all the tests see. The kit replaces them with the boxes of the parts themselves.
 */
export function fallbackBoxes(geometry, machine) {
  const u = Object.fromEntries(Object.entries(geometry.units).map(([n, v]) => [n, box(v.box.min, v.box.max)]));
  const L = machine.deskLayout ?? {};
  const around = (p, r, h) => box([p.x - r, 0, p.z - r], [p.x + r, h, p.z + r]);
  return {
    ...u,
    screen: part(u.display, [0.17, 0.83], [0.3, 0.92], [0.9, 1]),
    controls: unionBox([part(u.station, [0.7, 1], [0.2, 0.8], [0.85, 1]), part(u.display, [0.6, 0.95], [0, 0.25], [0.85, 1])]),
    slots: part(u.diskette, [0.05, 0.95], [0.3, 0.95], [0.9, 1]),
    levers: part(u.diskette, [0.1, 0.9], [0.35, 0.95], [0.95, 1.05]),
    file: L.disketteHolder ? around(L.disketteHolder, 0.08, 0.26) : part(u.diskette, [0, 1], [0, 1], [0, 1]),
    panel: part(u.printer, [0.72, 0.98], [0.75, 1], [0.6, 1]),
    mechanism: part(u.printer, [0.15, 0.85], [0.5, 1], [0.2, 0.75]),
    paperPath: unionBox([u.printer, part(u.printer, [0.1, 0.9], [1, 2.3], [0, 0.4])]),
    paper: L.freshStack && L.pagePile ? unionBox([around(L.freshStack, 0.15, 0.05), around(L.pagePile, 0.15, 0.05)]) : part(u.printer, [0, 1], [0, 0.1], [1, 1.4]),
  };
}

// ---- framing ------------------------------------------------------------------------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** The unit vector from the target toward the camera for a view { azim, elev }: azim 0 is from the front (+z). */
export function viewDirection({ azim = 0, elev = 0 }) {
  return [Math.sin(azim) * Math.cos(elev), Math.sin(elev), Math.cos(azim) * Math.cos(elev)];
}

/**
 * The camera { position, target } that sees box `b` from direction `view`, as near as it can with the whole box on
 * screen and `margin` to spare, for a camera of vertical field `fovDeg` and `aspect`.
 */
export function framePose(b, view, aspect, fovDeg) {
  const target = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const back = viewDirection(view);
  const right = norm(cross([0, 1, 0], back));
  const up = cross(back, right);
  const tanV = Math.tan((fovDeg * deg) / 2), tanH = tanV * aspect;
  const margin = view.margin ?? 1.1;
  let d = view.minDistance ?? 0;
  for (let i = 0; i < 8; i++) {
    const c = sub([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]], target);
    const z = dot(c, back);
    d = Math.max(d, z + (Math.abs(dot(c, right)) * margin) / tanH, z + (Math.abs(dot(c, up)) * margin) / tanV);
  }
  return { position: [target[0] + back[0] * d, target[1] + back[1] * d, target[2] + back[2] * d], target };
}

/** The pose for view `id` given the named boxes. */
export function poseOf(id, boxes, aspect, fovDeg) {
  const v = viewSpec(id);
  return framePose(unionBox(v.boxes.map((n) => boxes[n]).filter(Boolean)), v.view, aspect, fovDeg);
}

// ---- navigation ---------------------------------------------------------------------------------------------------

/**
 * Where the camera is: a station, a focus item within it, or the free view. Every camera move goes through `glide`,
 * and only from a method the user's own action calls. poseOf(id) frames a view for the camera as it is now;
 * cameraPose() reads the camera, so leaving the free view goes to the nearest station.
 */
export class ViewNav {
  constructor({ glide, poseOf: pose, cameraPose, start = 'desk', context = null }) {
    this.glide = glide; this.pose = pose; this.cameraPose = cameraPose; this.context = context;
    const s = viewSpec(start) ?? viewSpec('desk');
    this.station = s.station; this.focusId = s.focus; this.free = false;
    this.listeners = new Set();
  }

  get id() { return this.focusId ? `${this.station}/${this.focusId}` : this.station; }

  /** What the bar and the arrows show. */
  where() {
    const st = STATIONS[this.station];
    const neighbour = (n) => (n ? { id: n, label: STATIONS[n].label } : null);
    return {
      id: this.id, free: this.free, station: this.station, focus: this.focusId,
      label: this.free ? 'Free view' : this.focusId ? `${st.label} › ${FOCUS[this.focusId].label}` : st.label,
      left: this.free ? null : neighbour(st.left), right: this.free ? null : neighbour(st.right),
      items: st.items.map((f) => ({ id: f, label: FOCUS[f].label, note: FOCUS[f].note?.(this.context) ?? '', current: f === this.focusId })),
      stations: STATION_ORDER.map((n) => ({ id: n, label: STATIONS[n].label, current: n === this.station && !this.focusId })),
      canBack: this.free || !!this.focusId || this.station !== 'desk',
    };
  }

  /**
   * What a click on the scene can choose here: the station's focus items, and the other stations by their units.
   * None in the free view, where a click on empty space is the start of an orbit.
   */
  targets() {
    if (this.free) return [];
    const st = STATIONS[this.station];
    const out = st.items.filter((f) => f !== this.focusId).map((f) => ({ id: `${this.station}/${f}`, kind: 'focus', label: FOCUS[f].label, boxes: FOCUS[f].boxes }));
    for (const n of STATION_ORDER) {
      if (n === 'desk' || n === this.station) continue;
      out.push({ id: n, kind: 'station', label: STATIONS[n].label, boxes: STATIONS[n].boxes });
    }
    if (this.focusId) out.push({ id: this.station, kind: 'station', label: st.label, boxes: st.boxes });
    return out;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _changed() { const w = this.where(); for (const fn of this.listeners) fn(w); }

  /** Goes to a station or a focus item ("printer", "printer/panel"); leaves the free view. */
  go(id) {
    const v = viewSpec(id);
    if (!v) return false;
    this.station = v.station; this.focusId = v.focus; this.free = false;
    this.glide(this.pose(v.id), v.id);
    this._changed();
    return true;
  }

  focus(item) { return this.go(`${this.station}/${item}`); }
  left() { const n = STATIONS[this.station].left; return !this.free && !!n && this.go(n); }
  right() { const n = STATIONS[this.station].right; return !this.free && !!n && this.go(n); }

  /** Back: from the free view to the nearest station, from a focus item to its station, from a station to the desk. */
  back() {
    if (this.free) return this.setFree(false);
    if (this.focusId) return this.go(this.station);
    if (this.station !== 'desk') return this.go('desk');
    return false;
  }

  /** The free view: the camera stays where it is and the user orbits, pans and zooms it. Off, to the nearest station. */
  setFree(on) {
    if (on === this.free) return false;
    if (on) { this.free = true; this._changed(); return true; }
    return this.go(this.nearestStation());
  }

  toggleFree() { return this.setFree(!this.free); }

  /** The station whose head-on view is closest to the camera now, its target counting double. */
  nearestStation() {
    const cam = this.cameraPose();
    let best = 'desk', bestD = Infinity;
    for (const n of STATION_ORDER) {
      const p = this.pose(n);
      const d = Math.hypot(...sub(p.position, cam.position)) + 2 * Math.hypot(...sub(p.target, cam.target));
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }
}

/** Contains point p, with `pad` m to spare. */
export function boxContains(b, p, pad = 0) {
  for (let i = 0; i < 3; i++) if (p[i] < b.min[i] - pad || p[i] > b.max[i] + pad) return false;
  return true;
}

/**
 * The navigation target a click at world point `p` (on a unit's surface) chooses: the smallest target box holding
 * it, focus items before stations. Null when the point is in none.
 */
export function targetAt(p, targets, boxes, pad = 0.012) {
  let best = null, bestV = Infinity;
  for (const t of targets) {
    const b = unionBox(t.boxes.map((n) => boxes[n]).filter(Boolean));
    if (!boxContains(b, p, pad)) continue;
    const v = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]) * (t.kind === 'station' ? 1e3 : 1);
    if (v < bestV) { bestV = v; best = { ...t, box: b }; }
  }
  return best;
}
