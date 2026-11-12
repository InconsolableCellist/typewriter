// Flat Float32Array snapshot of the word processor's mechanism host (architecture.md 4.3). Names shared with
// src/sim/layout.js mean the same thing, which is what lets SoftWorld read the printer unchanged. Each body adds its
// group when it exists; the keyboard group and the rest of the station's arrive with their milestones.
export function makeWpLayout(geo) {
  let o = 0;
  const scalar = () => o++;
  const arr = (n) => { const i = o; o += n; return i; };
  const L = { time: scalar(), dspLoad: scalar(), rms: scalar(), lastForce: scalar() };
  if (geo.printer) {
    Object.assign(L, {
      // Soft-body names, in the carrier frame of the element machine: carriageX is minus the carrier's x.
      carriageX: scalar(), carriageV: scalar(), platenPsi: scalar(), platenOmega: scalar(), shiftY: scalar(),
      vibratorLift: scalar(), ribbonPawlTravel: scalar(), ribbonSelector: scalar(), paperRelease: scalar(), bail: scalar(),
      // The printer's own.
      printerPower: scalar(), cover: scalar(), wheelTheta: scalar(), wheelOmega: scalar(), hammerX: scalar(), cam: scalar(),
      panelKeyX: arr(8), leds: scalar(), digits: scalar(), fifo: scalar(), printerFan: scalar(),
    });
  }
  // The station: its power (0 or 1) and the power supply's fan speed (rad/s).
  if (geo.units?.station) Object.assign(L, { power: scalar(), fanOmega: scalar() });
  if (geo.diskettes) {
    // Per drive, two entries each: lever angle (rad), slide depth (m, -1 with no diskette), clamp force (N), diskette
    // and motor speeds (rad/s), diskette angle from the index hole (rad), head position (tracks), head load (0 lifted,
    // 1 on the diskette), and the adapter's ready line.
    const n = geo.diskettes.drives;
    Object.assign(L, {
      lever: arr(n), slide: arr(n), clamp: arr(n), diskOmega: arr(n), diskAngle: arr(n), headTrack: arr(n),
      headLoad: arr(n), motorOmega: arr(n), diskReady: arr(n),
    });
  }
  L.length = o;
  return L;
}
