// Power-on test and program load (SS 1, TP4 p.1, ORG p.58 and 59). The test shows its stage numbers at row 20,
// column 10: 05 after a few seconds, 06 about a second later, 09 a few seconds after that, then *11* with the large
// initials when no program diskette is in a drive. A program diskette in either drive is loaded: the screen clears,
// "Loading Program" goes up on status line 1, and the nucleus is read; TASK SELECTION follows about 10 s after the
// lever is closed. The warm start (architecture decision 9) skips all of this.
import { wait, io, waitSignal } from './sched.js';
import { ATTR } from './screen.js';
import { SYM } from './charset.js';
import { Volume } from './disk/fs.js';
import { fmt } from './textpack/messages.js';

export const BAT = [[3, '05'], [1, '06'], [3, '09'], [3, null]];    // seconds before each stage, TP4 p.1
export const TEST_PASSED = '*11*';

// Our own drawing of the initials, striped as on the start-up screen (ORG p.59 drawing), bottom right of the tube.
const LOGO = [
  '███████ ██████  ███   ███',
  '                         ',
  '  ███    ██  ██ ████ ████',
  '                         ',
  '  ███    █████  ██ ███ ██',
  '                         ',
  '  ███    ██  ██ ██  █  ██',
  '                         ',
  '███████ ██████  ███   ███',
];
export const LOGO_AT = [15, 55];

export function drawLogo(screen) {
  LOGO.forEach((line, r) => [...line].forEach((ch, c) => {
    if (ch !== ' ') screen.sym(LOGO_AT[0] + r, LOGO_AT[1] + c, SYM.BLOCK, ATTR.BRIGHT);
  }));
}

/** The program diskette among the drives that report ready, from the devices (before anything is mounted). */
function programDrive(sys) {
  for (const d of [0, 1]) {
    const s = sys.devices.disk.status(d);
    if (!s.ready) continue;
    const vol = sys.peekVolume(s.mediaId);
    if (vol?.isProgram) return d;
  }
  return null;
}

export function* coldStart(sys) {
  sys.screen.clear();
  for (const [s, code] of BAT) {
    yield* wait(s);
    if (code) sys.screen.put(20, 10, code);
  }
  yield* waitForProgram(sys, true);
}

/** CONTROL+RET then ENTER on TASK SELECTION (ORG p.59): start again without powering off. */
export function* reIpl(sys) {
  sys.program.loaded = false;
  sys.program.segment = null;
  sys.screen.clear();
  yield* wait(3);
  yield* waitForProgram(sys, true);
}

function* waitForProgram(sys, showLogo) {
  let drive = programDrive(sys);
  if (drive === null && showLogo) {
    sys.screen.clearRows(20);
    sys.screen.put(20, 10, TEST_PASSED);
    drawLogo(sys.screen);
  }
  while (drive === null) {
    yield* waitSignal('diskReady');
    drive = programDrive(sys);
  }
  yield* loadProgram(sys, drive);
}

export function* loadProgram(sys, drive) {
  const s = sys.screen;
  s.clear();
  s.put(1, 1, fmt('loadingProgram'));
  s.sym(1, 21, SYM.BAR);
  s.attr(2, 1, 80, ATTR.UNDER);
  const st = sys.devices.disk.status(drive);
  const vol = new Volume(sys.library.get(st.mediaId), drive);
  yield* io({ dev: 'disk', op: 'recalibrate', drive });
  yield* vol.mount();
  sys.drives[drive] = vol;
  sys.settings = { ...sys.settings, ...((yield* vol.readSettings()) ?? {}) };
  yield* vol.readRun(vol.find('nucleus'));
  const other = 1 - drive;
  if (sys.devices.disk.status(other).ready) yield* sys.mountDrive(other);
  sys.program.loaded = true;
  sys.program.loadedAt = sys.now;
  sys.startTextpack();
}
