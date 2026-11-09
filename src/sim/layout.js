// Flat Float32Array snapshot layout published by the mechanical simulation. Field name -> offset.
export function makeLayout(geo) {
  let o = 0;
  const scalar = () => o++;
  const arr = (n) => { const i = o; o += n; return i; };
  const L = {
    time: scalar(), dspLoad: scalar(),
    keyX: arr(geo.nKeys), keyV: arr(geo.nKeys),
    barTheta: arr(geo.nPrint), barOmega: arr(geo.nPrint), barLateral: arr(geo.nPrint),
    ubar: scalar(), rocker: scalar(),
    dogFixedR: scalar(), dogLooseR: scalar(), dogLooseS: scalar(),
    carriageX: scalar(), carriageV: scalar(), mainspringN: scalar(), carriageRelease: scalar(),
    shiftY: scalar(), shiftLock: scalar(),
    platenPsi: scalar(), platenOmega: scalar(), lsLever: scalar(), lsPawl: scalar(), lineSpaceSetting: scalar(),
    bellHammer: scalar(), marginL: scalar(), marginR: scalar(),
    vibratorLift: scalar(), ribbonPawlTravel: scalar(), ribbonSelector: scalar(),
    paperRelease: scalar(), bail: scalar(),
    lastForce: scalar(), rms: scalar(),
  };
  if (geo.element) {   // single-element machine only, appended so other machines' snapshots are unchanged
    Object.assign(L, {
      motorOmega: scalar(), motorOn: scalar(), printShaft: scalar(), clutchOn: scalar(), opShaft: scalar(), shiftShaft: scalar(),
      interposerKey: scalar(), selectedKey: scalar(), tilt: scalar(), rotate: scalar(), hemisphere: scalar(), printRocker: scalar(),
      returnLatched: scalar(), tabLatched: scalar(), correctionLift: scalar(), correctionTape: scalar(),
    });
  }
  L.length = o;
  return L;
}
