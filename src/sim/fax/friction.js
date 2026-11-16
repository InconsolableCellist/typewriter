// Friction at the fax's roller nips and rubbing surfaces. A nip joins a roller on its train (inertia J, speed w, every
// other torque To) to a body moving along the path (mass m, speed v, every other force Fo): the force it passes is
// whatever keeps the two surfaces together this substep, up to mu N, so a sheet sticks to its roller or slips on it
// as the forces say (stick and slip by the same rule as a contact solver's friction cone, in one dimension).

/**
 * The force on the body (+ forward) at a nip of radius R that can pass at most Fmax. oneWay: a roller on a one-way
 * clutch, which pushes but never holds back.
 */
export function nipForce(h, J, w, To, R, m, v, Fo, Fmax, oneWay = false) {
  if (!(Fmax > 0)) return 0;
  const inv = 1 / m + (R * R) / J;
  let F = ((R * w - v) / h + (R * To) / J - Fo / m) / inv;
  if (F > Fmax) F = Fmax; else if (F < -Fmax) F = -Fmax;
  if (oneWay && F < 0) F = 0;
  return F;
}

/** Kinetic friction of magnitude F against speed v, smoothed below v0 (a drag, not a clamp). */
export const drag = (v, F, v0) => (v > v0 ? -F : v < -v0 ? F : (-F * v) / v0);
