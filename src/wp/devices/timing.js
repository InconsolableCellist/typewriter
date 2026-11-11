// The diskette drive's and the printer's figures as pure functions (architecture 8.4, 6.4). Used only by the virtual
// devices for Node and by the tests that hold the mechanisms to them; in the browser the times come out of the
// mechanisms.

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

// The printer's figures (architecture 6.4, 6.8): the same rates the mechanism's controller plans with, so the virtual
// printer prints at about 60 characters a second at 10 pitch and feeds a 6 lpi line in well under 66 ms.
export const PRINTER = {
  printRate: 1440,         // carrier steps/s while printing on the move (60 cps at 10 pitch)
  slewRate: 3000,          // steps/s for tabs, returns and long moves
  ramp: 40000,             // steps/s^2
  minCycle: 0.014,         // s per character at the least
  onTheMove: 48,           // a print this close after the last one, in the same direction, keeps the carrier moving
  indexRate: 400, indexStart: 250, indexRamp: 25000, indexSettle: 0.004,
  camS: 0.3,               // one paper-cam move (bail or release), assumed
  feedChunk: 16,           // steps fed per sensor check while loading
  loadSteps: 96,           // steps a load feeds to bring the edge to the first writing line, assumed
  fifo: 32,                // the attachment's command queue (architecture 6.5)
};

/** Time to move D steps from rest to rest, ramping at a from v0 (a start rate) up to vMax. */
export function moveTime(D, vMax, a, v0 = 0) {
  if (D <= 0) return 0;
  const vp = Math.max(v0, Math.min(vMax, Math.sqrt(a * D + 0.5 * v0 * v0)));
  const up = (vp * vp - v0 * v0) / (2 * a), down = (vp * vp) / (2 * a);
  return (vp - v0) / a + Math.max(0, D - up - down) / vp + vp / a;
}

export function indexTime(steps) {
  const P = PRINTER;
  return steps ? moveTime(Math.abs(steps), P.indexRate, P.indexRamp, P.indexStart) + P.indexSettle : 0;
}
