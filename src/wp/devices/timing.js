// The diskette drive's documented figures as pure functions (architecture 8.4). Used only by the virtual devices
// for Node and by the tests that hold the mechanism to them; in the browser the times come out of the mechanism.

export const DRIVE = {
  stepS: 0.005,            // per track, ST p.97
  settleS: 0.035,          // after the last step, ST p.97
  headLoadS: 0.04,         // not documented; assumed (architecture 13.3)
  headUnloadS: 2,          // the head lifts after this long without a command (assumed)
  rotationS: 60 / 360,     // 360 rpm, ST p.93
  tracks: 77,
  spinUpS: 0.5,            // lever closed to index pulses in range (assumed, under the 0.6 s the mechanism must meet)
};

export function seek(n) { return n > 0 ? n * DRIVE.stepS + DRIVE.settleS : 0; }

export const RECALIBRATE_S = DRIVE.tracks * DRIVE.stepS + DRIVE.settleS;

/** Time from t until the start of sector s (1-based, spt per track) comes under the head. */
export function latency(t, s, spt) {
  const turn = (t / DRIVE.rotationS) % 1;
  const at = (s - 1) / spt;
  return (((at - turn) % 1) + 1) % 1 * DRIVE.rotationS;
}

export function transfer(n, spt) { return n * DRIVE.rotationS / spt; }
