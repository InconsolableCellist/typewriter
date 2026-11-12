// World placements of a system machine's units (machine.kind === 'system'). Pure data from the definition; shared
// by the scene, the layout tests and the mechanism host. See docs/displaywriter/architecture.md 3.2.

/**
 * Each unit's world origin (on the surface it stands on, under its centre) and its world-space box.
 * A unit with `on` stands on another unit at `at`, in that unit's local coordinates.
 */
export function deriveWordprocGeometry(m) {
  const units = {};
  const place = (name) => {
    if (units[name]) return units[name];
    const u = m.units[name];
    let origin;
    if (u.on) {
      const base = place(u.on);
      origin = [base.origin[0] + u.at[0], base.origin[1] + u.at[1], base.origin[2] + u.at[2]];
    } else {
      origin = [u.place.x, 0, u.place.z];
    }
    const [w, h, d] = u.size;
    const box = { min: [origin[0] - w / 2, origin[1], origin[2] - d / 2], max: [origin[0] + w / 2, origin[1] + h, origin[2] + d / 2] };
    return (units[name] = { origin, size: u.size, box, on: u.on ?? null });
  };
  for (const name of Object.keys(m.units)) place(name);
  return {
    system: true, units,
    ...(m.printer ? { printer: printerGeometry(m.printer) } : null),
    ...(m.diskettes ? { diskettes: { drives: 2 } } : null),
  };
}

/**
 * The printer in its own unit coordinates, shaped as the geometry SoftWorld and buildFaceTables take (6.2): the
 * print point on the platen's front at axle height, and one "bar" per petal. The wheel's axis runs front to back
 * below the print line, with its top petal standing in front of the print point.
 */
function printerGeometry(p) {
  const { center, radius } = p.platen;
  const printPoint = [center[0], center[1], center[2] + radius];
  const W = p.wheel;
  const bars = [...W.order].map((ch, index) => ({ index, lower: ch, upper: ch, skew: 0, offsetX: 0, offsetY: 0 }));
  return {
    printPoint, printNormal: [0, 0, 1], strikeDown: [0, -1, 0],
    bars, nPrint: bars.length, keys: [], nKeys: 0,
    wheel: {
      center: [printPoint[0], printPoint[1] - W.tipRadius, printPoint[2] + p.hammer.petalTravel],
      axis: [0, 0, 1], radius: W.tipRadius, petalStep: (2 * Math.PI) / W.petals, order: W.order,
    },
  };
}
