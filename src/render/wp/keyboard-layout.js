// Where the keyboard's keys and the openings round them lie, shared by the view (src/render/wp/keyboard-view.js) and the
// case builder (tools/blender/build_wp_keyboard.py, through tools/gen/export_wp_keyboard.mjs). Everything is in the
// deck frame: the plane of the cover's top surface, tilted up toward the back at the documented 12 degrees, its origin
// on that plane above the centre of the key field; x right, y out of the surface, z down the slope toward the typist.
import { KEYS, KEY_UNIT as U, KEY_FIELD } from '../../machine/wp-keys.js';

export const CASE = {
  rearTop: 0.101,      // m, the rear top edge is the unit's height (MD p.5): the keys stay below it
  fieldZ: 0.0,         // m, the key field's centre from the unit's centre, horizontally (brochure p.18: equal borders)
  capBase: -0.0085,    // m, cap bottoms below the cover surface: the caps stand in their wells, tops a few mm proud
  plate: -0.0150,      // m, the key plate (contamination shield) seen between the caps
  gap: 0.0008,         // m, between neighbouring cap bases (KBD_2.JPG)
  margin: 0.0021,      // m, clearance from the cap bases to the opening's edge
};

/** Height of the cover plane over the unit's centre, so that it reaches `rearTop` at the rear edge. */
export const deckOrigin = (size, slope) => [0, CASE.rearTop - (size[2] / 2 + CASE.fieldZ) * Math.tan(slope), CASE.fieldZ];

const MAIN_X = 2.5, RIGHT_X = 18;

/** Group a key belongs to: each has its own opening in the cover. */
export function keyGroup(key) {
  if (key.x < MAIN_X) return 'left';
  if (key.x >= RIGHT_X) return key.row <= 1 ? 'rightUpper' : 'rightLower';
  return 'main';
}

/**
 * The key's footprint in the deck frame: x0..x1, z0..z1 of its cap base, and for RETURN the L as a rectilinear
 * polygon (the upper arm across the tab row, the leg down through the lock row at its right).
 */
export function keyRect(key) {
  const x0 = (key.x - KEY_FIELD.w / 2) * U, x1 = x0 + key.w * U;
  const z0 = (key.row - KEY_FIELD.rows / 2) * U, z1 = z0 + (key.tall ? 2 : 1) * U;
  const g = CASE.gap / 2;
  const r = { x0: x0 + g, x1: x1 - g, z0: z0 + g, z1: z1 - g };
  if (key.tall) {
    const lx = x1 - key.leg * U + g, zm = z0 + U - g;
    // Counter-clockwise seen from above (x right, z toward the typist): back edge right to left, down the left side.
    r.poly = [[r.x1, r.z0], [r.x0, r.z0], [r.x0, zm], [lx, zm], [lx, r.z1], [r.x1, r.z1]];
  }
  return r;
}

/** Each group's opening: the rows' extents stacked, grown by the margin; a rectilinear polygon in (x, z). */
export function openings() {
  const groups = new Map();
  for (const key of KEYS) {
    const g = keyGroup(key), r = keyRect(key);
    if (!groups.has(g)) groups.set(g, new Map());
    const rows = groups.get(g);
    const add = (row, a, b) => { const e = rows.get(row); rows.set(row, e ? [Math.min(e[0], a), Math.max(e[1], b)] : [a, b]); };
    add(key.row, r.x0, r.x1);
    if (key.tall) add(key.row + 1, r.x1 - key.leg * U + CASE.gap, r.x1);
  }
  const m = CASE.margin + CASE.gap / 2;
  const out = {};
  for (const [name, rows] of groups) {
    const list = [...rows.entries()].sort((a, b) => a[0] - b[0]);
    const zTop = (row) => (row - KEY_FIELD.rows / 2) * U;
    const span = list.map(([row, [a, b]], i) => ({ a: a - m, b: b + m, t: zTop(row) - (i === 0 ? m : 0), bt: zTop(row + 1) + (i === list.length - 1 ? m : 0) }));
    // Down the right side, then back up the left; a vertex only where the edge turns.
    const poly = [];
    const push = (x, z) => {
      const n = poly.length;
      if (n && Math.abs(poly[n - 1][0] - x) < 1e-9 && Math.abs(poly[n - 1][1] - z) < 1e-9) return;
      if (n >= 2) {
        const [p, q] = [poly[n - 2], poly[n - 1]];
        if ((Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(q[0] - x) < 1e-9) || (Math.abs(p[1] - q[1]) < 1e-9 && Math.abs(q[1] - z) < 1e-9)) poly.pop();
      }
      poly.push([x, z]);
    };
    for (const s of span) { push(s.b, s.t); push(s.b, s.bt); }
    for (const s of [...span].reverse()) { push(s.a, s.bt); push(s.a, s.t); }
    out[name] = poly;
  }
  return out;
}
