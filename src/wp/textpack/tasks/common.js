// What the task menus share: the registry of tasks by `go` name, the REQST key over any menu, and the prompts that
// name a document and a diskette (TB1 p.8, p.12: the last names used are suggested on the prompt line).
import { MENUS } from '../menus.js';
import { runMenu } from '../menu-runner.js';
import { promptLine, splitName, getKey, isEnter, drawPrompt } from '../input.js';
import { fmt } from '../messages.js';
import { waitSignal } from '../../sched.js';
import { DiskError } from '../../disk/fs.js';

/** Tasks reached from the task menus, by `go` name. */
export const TASKS = {};

/** The keys every task menu answers besides its own: REQST opens the request menu over it. */
export function menuKeys(sys) {
  return {
    accepts: (e) => e.name === 'REQST' && !e.code,
    onKey: function* (ev) {
      if (ev.name === 'REQST') yield* requestTasks(sys);
      return null;
    },
  };
}

/** TEXTPACK REQUEST TASKS (REQST, ORG p.238): returns to where the operator was. */
export function* requestTasks(sys) {
  for (;;) {
    const r = yield* runMenu(sys, MENUS.requestTasks, null, {});
    if (!r.go) return;
    const task = TASKS[r.go];
    if (!task) { sys.messages.show('notAvailable', { what: MENUS.requestTasks.items.find((i) => i.go === r.go).item }); continue; }
    yield* task(sys, { from: 'request' });
    return;
  }
}

/**
 * The mounted work diskette named `disk`, asking for it to be inserted if it is not in a drive. REPLY (CODE+MSG)
 * refuses the request and cancels the task (ORG p.499). Returns null then.
 */
export function* volumeNamed(sys, disk) {
  for (;;) {
    const v = sys.volume(disk);
    if (v) {
      if (v.isProgram) { sys.messages.show('notWorkDiskette', { disk }); return null; }
      return v;
    }
    drawPrompt(sys, fmt('insertDiskette', { disk }), null);
    const ev = yield* getKey(sys, (e) => isEnter(e) || (e.code && e.name === 'MSG'));
    if (!isEnter(ev)) return null;
    if (!sys.volume(disk)) yield* waitMountedOrKey(sys);
  }
}

function* waitMountedOrKey(sys) {
  if (sys.sched.tasks.some((t) => t.name === 'mount')) yield* waitSignal('mounted');
}

/** Document name, then diskette name (unless typed after the CODE+M separator). Returns { name, vol } or null. */
export function* chooseDocument(sys) {
  for (;;) {
    const s = yield* promptLine(sys, 'docName', { suggest: sys.lastDocument, max: 44, sep: true });
    if (s === null) return null;
    let { name, disk } = splitName(s);
    if (!name) continue;
    if (disk === null) {
      disk = yield* promptLine(sys, 'diskName', { suggest: sys.lastDiskette, max: 6 });
      if (disk === null) return null;
    }
    const vol = yield* volumeNamed(sys, disk);
    if (!vol) return null;
    sys.lastDocument = name;
    sys.lastDiskette = disk;
    return { name, vol };
  }
}

/** Diskette name only (index display). */
export function* chooseDiskette(sys) {
  const suggest = sys.lastDiskette || (sys.workVolumes()[0]?.name ?? '');
  const disk = yield* promptLine(sys, 'diskName', { suggest, max: 6 });
  if (disk === null) return null;
  const vol = yield* volumeNamed(sys, disk);
  if (vol) sys.lastDiskette = disk;
  return vol;
}

/** Run a task body, turning a diskette failure into its message. */
export function* guarded(sys, vol, body) {
  try {
    return yield* body();
  } catch (e) {
    if (!(e instanceof DiskError)) throw e;
    sys.messages.show(e.code === 'full' ? 'diskFull' : 'diskError', { disk: vol?.name ?? '' });
    return null;
  }
}
