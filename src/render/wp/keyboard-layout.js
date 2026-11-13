// Where the keyboard's keys and the openings round them lie, shared by the view (src/render/wp/keyboard-view.js) and the
// case builder (tools/blender/build_wp_keyboard.py, through tools/gen/export_wp_keyboard.mjs). Everything is in the
// deck frame: the plane of the cover's top surface, tilted up toward the back at the documented 12 degrees, its origin
// on that plane above the centre of the key field; x right, y out of the surface, z down the slope toward the typist.
import { KEYS, KEY_UNIT as U, KEY_FIELD } from '../../machine/wp-keys.js';

export const CASE = {
  rearTop: 0.101,      // m, the unit's height (MD p.5), reached by the round of the rear top edge: the keys stay below it
  backRound: 0.009,    // m, radius of that round (the owner's side photograph)
  fieldZ: 0.020,       // m, the key field's centre ahead of the unit's centre, horizontally: a deep rear band holds the
                       // card recess, the front band is little more than the nose (owner's US top view; the
                       // three-quarter photograph's camera solved on the openings, models.md Keyboard)
  capBase: -0.0055,    // m, cap bottoms below the cover surface: tall caps, their tops 7 to 9 mm proud of the cover
  plate: -0.0150,      // m, the key plate (contamination shield) seen between the caps
  gap: 0.0008,         // m, between neighbouring cap bases (KBD_2.JPG)
  margin: 0.0021,      // m, clearance from the cap bases to the opening's edge
};

/** The cover plane's height where it meets the back (the sharp corner the rear round replaces), so the round's crown is `rearTop`. */
export const rearCorner = (slope) => CASE.rearTop + CASE.backRound * (Math.tan(slope) + 1 / Math.cos(slope) - 1);

/** The deck's origin: on the cover plane above the key field's centre (`fieldZ` ahead of the unit's centre). */
export const deckOrigin = (size, slope) => [0, rearCorner(slope) - (size[2] / 2 + CASE.fieldZ) * Math.tan(slope), CASE.fieldZ];

const MAIN_X = 2.5, RIGHT_X = 18;

/**
 * The card recess behind the main block (owner's photographs): a shallow well with a stepped rim, from just left of
 * the main opening to INDEX's left edge, its front edge 11.5 mm behind the main opening's, 54 mm deep. A clear window
 * lies on the ledge (`ledge` deep, `rim` wide) over the information card on the floor (`floor` deep). Deck frame.
 */
export function recess() {
  const main = openings().main;
  const x0 = Math.min(...main.map((p) => p[0])) - 0.0026;
  const top = Math.min(...main.map((p) => p[1]));
  const index = KEYS.find((k) => k.pos === 84);
  const x1 = keyRect(index).x0 - 0.0002;
  const z1 = top - 0.0115, z0 = z1 - 0.054;
  return { x0, x1, z0, z1, r: 0.003, ledge: 0.0016, rim: 0.0045, floor: 0.0036 };
}

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
