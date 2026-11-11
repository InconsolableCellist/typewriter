// Display Index of Diskette Contents (SS 2.8, ORG p.132): the diskette's name, how much is available and unusable,
// one line per document in creation order with its type and comment, `*` before a document that needs recovery.
// The cursor keys page through a long index; ENTER leaves.
import { ROW } from '../../screen.js';
import { DOC_TYPE, FLAG } from '../../disk/fs.js';
import { fmt } from '../messages.js';
import { getKey, isEnter, isCancel } from '../input.js';
import { TASKS, chooseDiskette } from './common.js';

const PER_SCREEN = 15;          // rows 7 to 21

export function drawIndex(sys, vol, first) {
  const s = sys.screen;
  const docs = vol.docs();
  const n = docs.length;
  const last = Math.min(n, first + PER_SCREEN);
  const { available, unusable } = vol.stats();
  sys.drawStatus({ A: fmt('displayingIndex') });
  s.clearRows(ROW.SCALE, ROW.PROMPT);
  s.put(4, 1, `Diskette: ${vol.name}`);
  s.put(4, 21, `Available: ${available}%`);
  s.put(4, 40, `Unusable: ${unusable}%`);
  s.put(4, 55, `Displaying: ${n ? first + 1 : 0} to ${last} of ${n}`);
  s.put(6, 2, 'DOCUMENT NAME');
  s.put(6, 24, 'TYPE');
  s.put(6, 49, 'COMMENT');
  docs.slice(first, last).forEach((e, k) => {
    if (e.flags & FLAG.OPEN) s.put(7 + k, 2, '*');
    s.put(7 + k, 3, e.name.slice(0, 18));
    s.put(7 + k, 22, DOC_TYPE[e.type] ?? 'Unknown');
    s.put(7 + k, 47, e.comment.slice(0, 34));
  });
  if (last === n) s.put(22, 19, 'END OF INDEX OF DISKETTE CONTENTS');
  s.put(23, 1, '* indicates that document needs recovery.');
  s.put(ROW.PROMPT, 1, fmt('indexMore'));
  s.put(ROW.PROMPT, 41, fmt('whenFinished'));
  s.setCursor(ROW.PROMPT, 68, true);
}

function* displayIndex(sys) {
  const vol = yield* chooseDiskette(sys);
  if (!vol) return null;
  let first = 0;
  for (;;) {
    drawIndex(sys, vol, first);
    const ev = yield* getKey(sys, (e) => isEnter(e) || isCancel(e) || e.name === 'END' || e.name === 'UP' || e.name === 'DOWN');
    if (ev.name === 'DOWN') { if (first + PER_SCREEN < vol.docs().length) first += PER_SCREEN; continue; }
    if (ev.name === 'UP') { first = Math.max(0, first - PER_SCREEN); continue; }
    return null;
  }
}

Object.assign(TASKS, { index: displayIndex });
