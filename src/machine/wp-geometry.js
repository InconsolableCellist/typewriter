// World placements of a system machine's units (machine.kind === 'system'). Pure data from the definition; shared
// by the scene, the layout tests and, later, the mechanism host. See docs/displaywriter/architecture.md 3.2.

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
  return { system: true, units };
}
