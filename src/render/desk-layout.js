// Where things stand on the desk. A machine with a `deskLayout` (the word processor) names each spot; the typewriters
// use the props' own constants, pushed outward by `deskSpread` for the wider machine.

/**
 * The desk position { x, z } of a named spot. `fallback` is the typewriters' position and `side` (+1 or -1) the
 * direction `deskSpread` moves it. A layout entry that stands on a unit (`{ on, at }`) is not a desk spot: callers
 * that support it read machine.deskLayout themselves, and get the fallback here.
 */
export function deskSpot(machine, name, fallback, side = 1) {
  const s = machine?.deskLayout?.[name];
  if (s && typeof s.x === 'number' && typeof s.z === 'number') return { x: s.x, z: s.z };
  return { x: fallback.x + side * (machine?.deskSpread ?? 0), z: fallback.z };
}
