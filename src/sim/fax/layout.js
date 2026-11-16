// Flat Float32Array snapshot of the fax's mechanism host (docs/fax/architecture.md 3.4), as src/sim/wp/layout.js. The
// kit reads it each frame to pose the model; nothing in it is needed to run the machine.
export function makeFaxLayout(machine) {
  let o = 0;
  const scalar = () => o++;
  const arr = (n) => { const i = o; o += n; return i; };
  const L = { time: scalar(), dspLoad: scalar(), rms: scalar(), lastForce: scalar() };
  Object.assign(L, {
    // Drive unit: motor angle and speed (rad, rad/s), the swing arm (rad, + toward scanning), the rollers (rad).
    motorTheta: scalar(), motorOmega: scalar(), planet: scalar(), scanPsi: scalar(), platenPsi: scalar(),
    // Document feed: the moving sheet's leading edge along the path (m from the separation nip; -1 with none), which
    // sheet it is, how many wait in the tray and how many have left.
    sheetS: scalar(), sheetIndex: scalar(), sheetsInTray: scalar(), sheetsOut: scalar(),
    // Recording: paper paid out past the head (m), the leading end's strip coordinate, the roll's radius and the paper
    // left on it, the head down (1) or lifted, the cover's angle (rad, 0 shut).
    paperU: scalar(), paperLead: scalar(), rollRadius: scalar(), rollRemaining: scalar(), headDown: scalar(), cover: scalar(),
    // Cutter: its crank's angle (rad, 0 home) and blade travel (0 open, 1 through).
    cutterCam: scalar(), blade: scalar(),
    // Telephone: the hook switch lever's travel (m, 0 up), handset on its cradle, the line relay's armature (0..1).
    hookX: scalar(), onCradle: scalar(), relays: arr(1),
    // Sensors as the controllers read them, and the line loop (closed 1).
    docSensor: scalar(), regSensor: scalar(), paperSensor: scalar(), cutterHome: scalar(), camHome: scalar(), coverClosed: scalar(), lineLoop: scalar(),
    // Panel keys' stem travel (m).
    keyX: arr(machine.mech.panel.keys.length),
  });
  L.length = o;
  return L;
}
