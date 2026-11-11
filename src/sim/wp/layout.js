// Flat Float32Array snapshot of the word processor's mechanism host (architecture.md 4.3). Names shared with
// src/sim/layout.js mean the same thing, which is what lets SoftWorld read the printer unchanged. Each body adds its
// group when it exists; the keyboard, station and diskette groups arrive with their milestones.
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
  L.length = o;
  return L;
}
