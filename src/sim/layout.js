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
  L.length = o;
  return L;
}
