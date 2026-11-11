// Textpack: the shell that moves between the task menus (SS 2, SR 8). Each screen is a generator that returns the
// next one; Navigate, thrown from anywhere below, jumps straight to a target (Menu Bypass, Go to Task Selection).
// Entering a task family whose program segment is not in memory reads it from the program diskette, with TASK
// SELECTION showing the chosen task highlighted meanwhile (TB2 p.68, p.74).
import { MENUS } from './menus.js';
import { runMenu, drawMenu } from './menu-runner.js';
import { Navigate, getKey, isEnter, drawPrompt } from './input.js';
import { fmt } from './messages.js';
import { DEFAULT_FORMAT, copyFormat } from './editor/format.js';
import { reIpl } from '../rom.js';
import { TASKS, menuKeys } from './tasks/common.js';
import './tasks/typing.js';
import './tasks/index.js';
import './tasks/workdisk.js';
import './tasks/print.js';
import './formats.js';
import './editor/functions.js';
import { waitSignal } from '../sched.js';

export const DEFAULT_SETTINGS = {
  // WORK STATION DESCRIPTION (ORG p.246): Auto CR On, required carrier return and hyphen Non-Coded.
  autoCR: 1, reqCR: 2, reqHyphen: 2, keyboard: 1,
  docFormat: copyFormat(DEFAULT_FORMAT), altFormat: copyFormat(DEFAULT_FORMAT),
};

const SEGMENT = { typingTasks: 'typing', workDiskTasks: 'workdisk', spellingTasks: 'spelling' };

export function* shell(sys) {
  let next = { to: 'taskSelection' };
  for (;;) {
    if (next.to === 'ipl') return yield* reIpl(sys);
    try {
      const screen = SCREENS[next.to] ?? TASKS[next.to];
      next = (yield* screen(sys, next)) ?? { to: 'taskSelection' };
    } catch (e) {
      if (!(e instanceof Navigate)) throw e;
      next = e.target;
    }
  }
}

/** Load a task family's program segment, asking for the program diskette if none is in a drive. */
export function* loadSegment(sys, name) {
  if (!name || sys.program.segment === name) return;
  let vol = sys.programVolume();
  while (!vol) {
    drawPrompt(sys, fmt('insertProgram'), null);
    const ev = yield* getKey(sys, (e) => isEnter(e));
    if (ev) vol = sys.programVolume() ?? (yield* waitMounted(sys));
  }
  yield* vol.readRun(vol.find(name));
  sys.program.segment = name;
}

function* waitMounted(sys) {
  for (let k = 0; k < 2 && !sys.programVolume(); k++) yield* waitSignal('mounted');
  return sys.programVolume();
}

function* taskSelection(sys, { highlight } = {}) {
  let zicr = false;
  const r = yield* runMenu(sys, MENUS.taskSelection, null, {
    root: true, highlight,
    accepts: (e) => e.control && e.name === 'RETURN',
    onKey: function* () { zicr = true; return null; },
    onEmpty: () => (zicr ? { go: 'ipl' } : null),
  });
  if (r.go === 'ipl') return { to: 'ipl' };
  const item = MENUS.taskSelection.items.find((i) => i.go === r.go);
  if (SEGMENT[r.go] && sys.program.segment !== SEGMENT[r.go]) {
    flash(sys, item.id);
    yield* loadSegment(sys, SEGMENT[r.go]);
  }
  return { to: r.go };
}

/** TASK SELECTION with the chosen task highlighted, while its program loads. */
function flash(sys, id) {
  sys.drawStatus({});
  drawMenu(sys, MENUS.taskSelection, null, { highlight: id });
  drawPrompt(sys, '', null);
}

/** A task family's menu. REQST and Menu Bypass work over every one but the program diskette tasks (ORG p.446, 501). */
function* menuScreen(sys, def, { highlight } = {}, keys = true) {
  for (;;) {
    const r = yield* runMenu(sys, def, null, { highlight, ...(keys ? menuKeys(sys) : {}) });
    if (r.cancel || r.go === 'taskSelection') return { to: 'taskSelection' };
    const task = TASKS[r.go];
    if (!task) { sys.messages.show('notAvailable', { what: def.items.find((i) => i.go === r.go).item }); continue; }
    const next = yield* task(sys, {});
    if (next?.to) return next;
    highlight = next?.highlight;
  }
}

/** A Menu Bypass target: its family's program segment, then the task, then the family's menu (ORG p.445). */
function* bypass(sys, { family, task, preset }) {
  yield* loadSegment(sys, SEGMENT[family]);
  const next = yield* TASKS[task](sys, { preset });
  return next?.to ? next : { to: family };
}

const SCREENS = {
  bypass,
  taskSelection,
  typingTasks: (sys, a) => menuScreen(sys, MENUS.typingTasks, a),
  workDiskTasks: (sys, a) => menuScreen(sys, MENUS.workDiskTasks, a),
  programTasks: (sys, a) => menuScreen(sys, MENUS.programTasks, a, false),
  spellingTasks: (sys, a) => menuScreen(sys, MENUS.spellingTasks, a),
};
