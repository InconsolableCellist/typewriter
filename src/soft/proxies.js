// Collision proxies for the machine body, from the bounds of frame.glb and enclosure.glb (metres, world).
// The body is a height field over its footprint: the sheet may rest on top of it but never get below it.
export const MACHINE_BODY = {
  halfWidth: 0.195,
  topMax: 0.1456,      // highest point of the profile
  zMin: -0.160,
  zMax: 0.2436,
  // (z, top y) knots along the machine centreline: rear panel, carriage rails, type segment, keyboard slope, front.
  profile: [[-0.160, 0.118], [-0.148, 0.1418], [-0.072, 0.1418], [-0.046, 0.1456], [0.012, 0.1456], [0.060, 0.118], [0.2436, 0.080]],
  // Side decks stand outside the type segment. Kept just under the lowest point of the paper path.
  deckAbsX: 0.136,
  deckTop: 0.150,
};

/** Top of the body at (x, z), or -Infinity outside the footprint. */
export function bodyTop(x, z, b = MACHINE_BODY) {
  if (x > b.halfWidth || x < -b.halfWidth || z < b.zMin || z > b.zMax) return -Infinity;
  const P = b.profile;
  let k = 0;
  while (k < P.length - 2 && z > P[k + 1][0]) k++;
  const f = (z - P[k][0]) / (P[k + 1][0] - P[k][0]);
  let top = P[k][1] + (P[k + 1][1] - P[k][1]) * f;
  if (b.deckAbsX && (x > b.deckAbsX || x < -b.deckAbsX) && top < b.deckTop) top = b.deckTop;
  return top;
}
