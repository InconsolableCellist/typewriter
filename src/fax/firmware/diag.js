// The service diagnostics [SM p.2-2 to 2-4/pdf17-19]: FUNCTION 9 * 8 # 7 shows "ROM Ver. FZL0 *" for 2 seconds, then
// DIAG MODE; START, and the items are chosen with * and # (or their direct key, A-E) and entered with START. Built:
// the soft switch mode (view and set SW-A1 to SW-K1: FUNCTION toggles the bit at the cursor, # and * move it, START
// keeps the switch and shows the next, STOP leaves and drops the switch on display), the memory clear, the country
// select, the ROM & RAM check (its buzzer count: none, no error) and the panel check (each key's name). The other items
// show their name and do nothing [A]: aging, check pattern, signal send, shading, all black, auto feeder, entry data
// send and receive, cutter aging.

import { msg, DIAG_ITEMS } from './messages.js';
import { SOFT_SWITCHES, swText } from './softswitch.js';
import { LEGENDS } from './panel.js';

const COUNTRIES = [['HONG KONG', 'HK'], ['INDIA', 'IN'], ['MALAYSIA', 'MY'], ['RUSSIAN', 'RA'], ['SINGAPORE', 'SG'],
  ['SOUTH AFRICA', 'ZA'], ['TAIWAN', 'AU'], ['THAILAND', 'TH'], ['GENERAL AREA', 'GRU'], ['GENERAL AREA', 'GRH'],
  ['AUSTRALIA', 'A'], ['CHINA', 'CN']];      // [SM p.2-4]; TAIWAN's code is printed "AU"

export function* diagnostics(ui) {
  for (const want of ['*', '8', '#', '7']) {
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k !== want) { if (k != null) ui.beep('error'); return; }
  }
  ui.show(msg('ROM_VER'));
  yield* ui.pause(2);
  const k = yield* ui.showKey(msg('DIAG_MODE'));
  if (k !== 'START') return;
  let i = 0;
  for (;;) {
    const name = DIAG_ITEMS[i][0];
    const key = yield* ui.showKey(msg(name));
    if (key == null) return;
    if (key === '#') { i = (i + 1) % DIAG_ITEMS.length; continue; }
    if (key === '*') { i = (i + DIAG_ITEMS.length - 1) % DIAG_ITEMS.length; continue; }
    const direct = DIAG_ITEMS.findIndex(([, d]) => d === key);
    if (direct >= 0) { i = direct; continue; }
    if (key !== 'START') continue;
    if (name === 'D_SOFT') yield* softSwitchMode(ui);
    else if (name === 'D_MEMCLR') { ui.memoryClear(); ui.beep('end'); yield* ui.flash(msg('MEMORY_CLEARED'), 2); }
    else if (name === 'D_COUNTRY') yield* countrySelect(ui);
    else if (name === 'D_ROMRAM') ui.beep('key');
    else if (name === 'D_PANEL') yield* panelCheck(ui);
  }
}

function* softSwitchMode(ui) {
  const sws = ui.settings.softSwitches;
  for (const s of SOFT_SWITCHES) {
    const bits = (sws[s.id] ?? s.bits).slice();
    let cur = 0;
    for (;;) {
      ui.show(swText(s.id, bits), { cursor: 8 + cur });
      const k = yield* ui.keyOrStop(ui.MENU_TIMEOUT);
      if (k == null || k === 'STOP') { ui.save(); return; }
      if (k === 'FUNCTION') bits[cur] ^= 1;
      else if (k === '#') cur = Math.min(7, cur + 1);
      else if (k === '*') cur = Math.max(0, cur - 1);
      else if (k === 'START') { sws[s.id] = bits; break; }
    }
  }
  ui.save();
}

function* countrySelect(ui) {
  let i = Math.max(0, COUNTRIES.findIndex(([, c]) => c === ui.settings.country));
  for (;;) {
    const k = yield* ui.showKey(`${COUNTRIES[i][0]}`.slice(0, 16));
    if (k == null) return;
    if (k === '#') i = (i + 1) % COUNTRIES.length;
    else if (k === '*') i = (i + COUNTRIES.length - 1) % COUNTRIES.length;
    else if (k === 'START') { ui.settings.country = COUNTRIES[i][1]; ui.save(); return; }
  }
}

function* panelCheck(ui) {
  ui.show(msg('D_PANEL'));
  for (;;) {
    const k = yield* ui.keyOrStop(ui.MENU_TIMEOUT);
    if (k == null || k === 'STOP') return;
    ui.show(LEGENDS[k] ?? k);
  }
}
