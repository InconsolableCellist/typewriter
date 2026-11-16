// Keystroke scripts for Node tests of the FO-70's firmware, after src/wp/testkit.js. A script is key names
// separated by spaces: digits and * # typed as written ("5550142" is seven key presses), A-E the rapid keys, and the
// names START STOP COPY FUNCTION SPEED REDIAL HOLD SPEAKER VOLUME RES; NAME*n repeats; a bracketed number waits
// that many seconds of machine time ("[2.5]"). Each key goes in as a key event, a second apart by default.

import { createFirmware } from './main.js';
import { VirtualDevices } from './virtual.js';
import { MemoryStorage } from './setup.js';
import { deskProgramming } from '../remote/directory.js';
import { blankPage, STRIDE } from './page.js';

const ALIAS = {
  COPY: 'COPY_HELP', HELP: 'COPY_HELP', SPEED: 'SPEED_DIAL', HOLD: 'HOLD_SEARCH', SEARCH: 'HOLD_SEARCH',
  RES: 'RESOLUTION', RECEPTION: 'RESOLUTION', POLL: 'E', ENTER: 'START', ESC: 'STOP',
};
const NAMED = new Set(['START', 'STOP', 'COPY_HELP', 'FUNCTION', 'SPEED_DIAL', 'REDIAL', 'HOLD_SEARCH', 'SPEAKER', 'VOLUME', 'RESOLUTION', 'A', 'B', 'C', 'D', 'E']);

/** 16 November 2026, 09:30, the visitor's day (decision 12: the real date). */
export const TEST_WALL = Date.UTC(2026, 10, 16, 9, 30);

/**
 * A machine on virtual devices, warm started (decision 11) unless `cold`: desk numbers programmed, the clock at
 * TEST_WALL, standing by. `storage` to carry settings between boots.
 */
export function boot({ cold = false, storage = new MemoryStorage(), transport = 'ideal', paperMm, settle = 1, devicesOptions = {} } = {}) {
  const devices = new VirtualDevices({ transport, paperMm, ...devicesOptions });
  const fw = createFirmware({ devices, storage, options: { cold, wallClockMs: TEST_WALL, desk: cold ? null : deskProgramming() } });
  if (settle) fw.runFor(settle);
  return { fw, devices, storage, sb: devices.sb, dir: devices.directory };
}

/** Script words to key names and waits: [{ key } | { wait }]. */
export function strokes(script) {
  const out = [];
  for (const w of String(script).trim().split(/\s+/).filter(Boolean)) {
    const pause = /^\[(\d+(?:\.\d+)?)\]$/.exec(w);
    if (pause) { out.push({ wait: +pause[1] }); continue; }
    let word = w, n = 1;
    const rep = /^(.*?)\*(\d+)$/.exec(w);
    if (rep && rep[1]) { word = rep[1]; n = +rep[2]; }
    const name = ALIAS[word] ?? word;
    let keys;
    if (NAMED.has(name)) keys = [name];
    else if (/^[0-9*#-]+$/.test(name)) keys = [...name.replace(/-/g, '')];
    else throw new Error(`no key ${w}`);
    for (let i = 0; i < n; i++) for (const k of keys) out.push({ key: k });
  }
  return out;
}

/** Press a script's keys `gap` seconds apart (machine time). */
export function press(fw, script, { gap = 0.4 } = {}) {
  for (const s of strokes(script)) {
    if (s.wait != null) { fw.runFor(s.wait); continue; }
    fw.keyDown(s.key);
    fw.runFor(gap);
  }
}

/** Run until the LCD shows text matching `re` (checked as time passes). Returns true if it did. */
export function untilLcd(fw, re, limit = 600) {
  return fw.runUntil(() => re.test(fw.lcd.text), limit);
}

/** A stand-in sheet: `height` fine rows with black bars and a block per sheet number, 1728 wide. */
export function testSheet({ height = 240, seed = 1, jam = false } = {}) {
  const p = blankPage(height, 'fine');
  for (let y = 0; y < height; y++) {
    const row = p.rows.subarray(y * STRIDE, (y + 1) * STRIDE);
    if (y % 40 < 6) row.fill(0xff, 10, 200);                       // bars
    if (y > 20 && y < 60) row.fill(0xf0, 20 + seed * 10, 30 + seed * 10);   // a mark per sheet
    if ((y * 7 + seed) % 23 === 0) row[100 + (y % 50)] = 0xaa;    // texture
  }
  return { ...p, jam };
}
