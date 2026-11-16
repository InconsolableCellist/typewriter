// World placements of the fax (machine.kind === 'fax'): its units as the word processor's (wp-geometry.js placeUnits),
// the block-out's named boxes in world space, and the desk's things. Pure data from the definition; shared by the kit,
// the views and the layout tests. docs/fax/architecture.md 2.
import { placeUnits } from './wp-geometry.js';

export function deriveFaxGeometry(m) {
  const units = placeUnits(m);
  const o = units.body.origin;
  const parts = {};
  for (const [name, b] of Object.entries(m.blockout ?? {})) {
    if (!Array.isArray(b)) continue;
    parts[name] = { min: [o[0] + b[0][0], o[1] + b[0][1], o[2] + b[0][2]], max: [o[0] + b[1][0], o[1] + b[1][1], o[2] + b[1][2]] };
  }
  return { fax: true, units, parts, dots: m.mech.printer.dots };
}
