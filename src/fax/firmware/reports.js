// The reports and lists the FO-70 prints [OM p.50-51, p.81-82]: the Transaction Report (after a transaction, by the
// TRANSACTION LIST setting; it cannot be printed on demand), the Telephone Number List and the Anti Junk Number List
// (FUNCTION 2), and the Help List (COPY/HELP with no document, OM p.9). The Transaction Report's layout is the
// manual's figure (OM p.51): a frame of asterisks, TRANSACTION REPORT, the date and time, FOR: the own name and number,
// then DATE START RECEIVER (SENDER for a reception) PAGES TIME NOTE. The lists are not shown in the manual: their
// layouts are ours [A], in the same manner. Each is drawn by chargen.js at fine resolution and returned as a page
// bitmap { width, height, vres: 'fine', rows } for the printer.

import { Raster, CELL, MARGIN, COLUMNS } from './chargen.js';
import { noteFor } from './messages.js';
import { SPEED_COUNT } from './setup.js';

export const JOURNAL_LENGTH = 30;   // entries kept [A]

const p2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A wall-clock time (ms, read with UTC fields) as 25-JAN-1999 10:30 [OM p.51]. */
export function stamp(ms) {
  const d = new Date(ms);
  return `${p2(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
/** 25-JAN 10:30 [OM p.51]. */
const shortStamp = (ms) => { const d = new Date(ms); return `${p2(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
/** 01'05" ; **'**" for a transaction that did not take place [OM p.51]. */
const mmss = (s) => (s == null ? `**'**"` : `${p2(Math.floor(s / 60))}'${p2(Math.round(s % 60))}"`);
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);

/** A framed sheet: a border of asterisks, a title centred, the stamp at the right, then rule-separated blocks. */
function framed(title, blocks, { now }) {
  const cols = COLUMNS - 6;                                  // characters inside the frame
  const lines = [];
  lines.push('*'.repeat(cols + 4));
  lines.push('*' + ' '.repeat(cols + 2) + '*');
  lines.push('*' + pad(' '.repeat(Math.max(0, (cols + 2 - title.length) >> 1)) + title, cols + 2) + '*');
  lines.push('*' + pad(' '.repeat(Math.max(0, cols - 18)) + stamp(now), cols + 2) + '*');
  const rules = [];
  for (const b of blocks) {
    for (const l of b) lines.push('* ' + pad(l, cols) + ' *');
    rules.push(lines.length);
    lines.push('*' + ' '.repeat(cols + 2) + '*');
  }
  lines.push('*'.repeat(cols + 4));
  const top = 2 * CELL.line;
  const r = new Raster(top + (lines.length + 2) * CELL.line);
  lines.forEach((s, i) => r.text(MARGIN, top + i * CELL.line, s));
  for (const i of rules) r.hline(MARGIN + 2 * CELL.pitch, top + i * CELL.line + CELL.line / 2, cols * CELL.pitch, 3);
  return { width: r.width, height: r.height, vres: 'fine', rows: r.data };
}

const forLine = (s) => `     FOR: ${pad(s.ownName || '', 28)}${s.ownNumber || ''}`;

/** The Transaction Report for one journal entry [OM p.51]. */
export function transactionReport(entry, settings, { now } = {}) {
  const who = entry.kind === 'TX' ? 'RECEIVER' : 'SENDER';
  const happened = entry.result !== 'STOPPED' || (entry.durationS ?? 0) > 0;
  const remote = entry.remote || entry.dialled || entry.mode?.split(' ')[0] || 'G3';
  return framed('TRANSACTION REPORT', [
    [forLine(settings)],
    [`DATE   START   ${pad(who, 26)}PAGES    TIME    NOTE`],
    [`${shortStamp(entry.wallMs)}   ${pad(remote, 26)}${String(entry.pages ?? 0).padStart(4)}    ${mmss(happened ? entry.durationS : null)}  ${noteFor(entry)}`],
  ], { now });
}

/** The Telephone Number List: the Rapid Key and Speed Dial numbers [OM p.82; layout A]. */
export function telephoneList(settings, { now }) {
  const rows = [];
  for (let i = 0; i < SPEED_COUNT; i++) {
    const e = settings.speed[i];
    if (!e) continue;
    rows.push(`${p2(i + 1)}  ${i < 5 ? 'ABCDE'[i] : ' '}   ${pad(e.name, 24)} ${e.number}`);
  }
  if (!rows.length) rows.push('NO DATA');
  return framed('TELEPHONE NUMBER LIST', [[forLine(settings)], ['NO. KEY NAME                     NUMBER'], rows], { now });
}

/** The Anti Junk Number List [OM p.82; layout A]. */
export function junkList(settings, { now }) {
  const rows = settings.junk.map((j, i) => (j ? `${i + 1}   ${j}` : null)).filter(Boolean);
  if (!rows.length) rows.push('NO DATA');
  return framed('ANTI JUNK NUMBER LIST', [[forLine(settings)], ['NO. NUMBER'], rows], { now });
}

/** The Help List, "a quick reference guide to the operation of your fax machine" [OM p.9]: from the Quick Reference
 * Guide, OM p.95-96 [wording condensed, A]. */
export function helpList(settings, { now }) {
  const rows = [
    'SENDING FAXES: PLACE YOUR DOCUMENT (UP TO 5 PAGES) FACE DOWN.',
    ' NORMAL DIALING: LIFT THE HANDSET OR PRESS SPEAKER, DIAL,',
    '  WAIT FOR THE RECEPTION TONE, PRESS START.',
    ' RAPID KEY DIALING: PRESS THE RAPID KEY (A-E).',
    ' SPEED DIALING: SPEED DIAL, 2-DIGIT NUMBER, START.',
    'RECEIVING FAXES: PRESS RESOLUTION/RECEPTION MODE UNTIL THE',
    ' ARROW POINTS TO TEL, FAX, TEL/FAX OR A.M.',
    'NAME AND NUMBER: FUNCTION 3 # #, START.',
    'DATE AND TIME: FUNCTION 3 # # #, START.',
    'AUTO DIAL NUMBERS: FUNCTION 3 #, 1 STORE OR 2 CLEAR.',
    'OPTIONS: FUNCTION 4, THEN # OR *.  LISTS: FUNCTION 2.',
    'COPY: LOAD THE DOCUMENT, PRESS COPY/HELP.',
  ];
  return framed('HELP LIST', [[forLine(settings)], rows], { now });
}

/**
 * The line sent at the top of every page: the date and time, the name and number [OM p.20, p.24; layout A]. Drawn at
 * the page's vertical resolution so it is the same size on paper at each.
 */
export function headerPage(settings, { wallMs, page, vres }) {
  const sy = vres === 'standard' ? 1 : vres === 'superfine' ? 4 : 2;
  const r = new Raster(11 * sy + 2 * sy);
  const text = `${stamp(wallMs)}  ${pad(settings.ownName, 24)}  ${pad(settings.ownNumber, 20)}  P.${p2(page)}`;
  r.text(MARGIN, sy * 2, text, { sx: 2, sy });
  return { width: r.width, height: r.height, vres, rows: r.data };
}
