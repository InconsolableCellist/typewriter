// The reports and lists the machine prints: the transmission report (after a send, by the TRANS. REPORT option),
// the activity report (the journal of recent calls), the telephone number list, the setup list and the help list.
// The operation manual has a chapter "printing reports and lists" [S: contents]; these layouts are ours [A] until
// its figures are transcribed. Each is drawn by chargen.js at fine resolution and returned as a page bitmap
// { width, height, vres: 'fine', rows } for the printer.

import { Raster, CELL, MARGIN, metrics, COLUMNS } from './chargen.js';
import { ERRORS } from './messages.js';
import { LEGENDS } from './panel.js';
import { OPTIONS, RX_MODES, SPEED_COUNT } from './setup.js';

export const JOURNAL_LENGTH = 30;   // entries kept for the activity report [A]

const p2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A wall-clock time (ms, read with UTC fields) as MMM-DD-YYYY HH:MM. */
export function stamp(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]}-${p2(d.getUTCDate())}-${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
const shortStamp = (ms) => { const d = new Date(ms); return `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const mmss = (s) => `${p2(Math.floor(s / 60))}'${p2(Math.round(s % 60))}"`;
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);

/** Text lines with a title in double size; returns a page bitmap. */
function sheet(title, lines, { now }) {
  const big = metrics(6, 6);
  const top = 2 * CELL.line;
  const height = top + big.line + 2 * CELL.line + (lines.length + 4) * CELL.line;
  const r = new Raster(height);
  r.text(MARGIN, top, title, { sx: 6, sy: 6 });
  const y0 = top + big.line;
  r.text(MARGIN, y0, stamp(now), {});
  r.hline(MARGIN, y0 + CELL.line, CELL.pitch * (COLUMNS - 4), 3);
  lines.forEach((s, i) => r.text(MARGIN, y0 + CELL.line + 12 + i * CELL.line, s));
  r.hline(MARGIN, y0 + CELL.line + 12 + lines.length * CELL.line + 6, CELL.pitch * (COLUMNS - 4), 3);
  return { width: r.width, height: r.height, vres: 'fine', rows: r.data };
}

const headerLines = (s) => [`NAME   : ${s.ownName || '-'}`, `FAX #  : ${s.ownNumber || '-'}`, ''];

/** One journal entry's result text: OK, or the code and its words. */
export function noteOf(e) {
  const err = ERRORS[e.result] ?? ERRORS.LINE_DROP;
  return e.result === 'OK' ? 'OK' : `${err.code} ${err.text}`;
}

/**
 * The transmission report for one journal entry (a send or a poll), with a strip of the first page reduced to
 * 1/4 when the page is given (as small machines printed the top of the page sent [M]).
 */
export function transmissionReport(entry, settings, { now, firstPage = null } = {}) {
  const lines = [
    ...headerLines(settings),
    `DATE/TIME : ${stamp(entry.wallMs)}`,
    `TO        : ${entry.remote || entry.dialled || '-'}`,
    `NUMBER    : ${entry.dialled || '-'}`,
    `MODE      : ${entry.mode || '-'}`,
    `PAGES     : ${entry.pages ?? 0}`,
    `DURATION  : ${mmss(entry.durationS ?? 0)}`,
    `RESULT    : ${noteOf(entry)}`,
  ];
  const page = sheet('TRANSMISSION REPORT', lines, { now });
  if (!firstPage) return page;
  // The top of the first page at a quarter: 432 pels across, the first 300 rows.
  const keep = Math.min(firstPage.height, 1200);
  const extra = Math.ceil(keep / 4) + 40;
  const r = new Raster(page.height + extra);
  r.data.set(page.rows);
  const x0 = MARGIN;
  const get = (x, y) => (firstPage.rows[y * 216 + (x >>> 3)] >>> (7 - (x & 7))) & 1;
  for (let y = 0; y < keep; y += 4) for (let x = 0; x < 1728; x += 4) {
    let on = 0;
    for (let dy = 0; dy < 4 && y + dy < keep; dy++) for (let dx = 0; dx < 4; dx++) on += get(x + dx, y + dy);
    if (on >= 4) r.set(x0 + (x >>> 2), page.height + (y >>> 2));
  }
  r.frame(x0 - 4, page.height - 4, 440, Math.ceil(keep / 4) + 8, 2);
  return { width: r.width, height: r.height, vres: 'fine', rows: r.data };
}

/** The activity report: the journal, newest last. */
export function activityReport(journal, settings, { now }) {
  const head = ` NO. DATE  TIME  ${pad('REMOTE', 20)} ${pad('MODE', 10)} TIME   PG NOTE`;
  const rows = journal.slice(-JOURNAL_LENGTH).map((e) => {
    const note = e.result === 'OK' ? 'OK' : (ERRORS[e.result] ?? ERRORS.LINE_DROP).code;
    return ` ${String(e.no).padStart(3, '0')} ${shortStamp(e.wallMs)} ${pad(e.remote || e.dialled || '-', 20)} ${pad(`${e.kind} ${e.mode ?? ''}`, 10)} ${mmss(e.durationS ?? 0)} ${String(e.pages ?? 0).padStart(2)} ${note}`;
  });
  if (!rows.length) rows.push(' (NO ENTRIES)');
  return sheet('ACTIVITY REPORT', [...headerLines(settings), head, ...rows], { now });
}

/** The telephone number list: rapid keys and speed dial numbers. */
export function telephoneList(settings, { now }) {
  const rows = [];
  for (let i = 0; i < SPEED_COUNT; i++) {
    const e = settings.speed[i];
    if (!e) continue;
    const key = i < 5 ? `${'ABCDE'[i]}` : ' ';
    rows.push(` ${p2(i + 1)} ${key}  ${pad(e.name, 18)} ${e.number}`);
  }
  if (!rows.length) rows.push(' (NO NUMBERS STORED)');
  return sheet('TELEPHONE # LIST', [...headerLines(settings), ' NO KEY NAME               NUMBER', ...rows], { now });
}

/** The setup list: every setting. */
export function setupList(settings, { now }) {
  const label = (o) => (o.values.find(([, v]) => v === settings[o.key]) ?? [String(settings[o.key])])[0];
  const names = { rings: '# OF RINGS', contrast: 'PRINT CONTRAST', pseudoRingS: 'PSEUDO RING', report: 'TRANS. REPORT',
    callerId: 'CALLER ID', distinctive: 'DISTINCTIVE RING', blocking: 'FAX BLOCKING', header: 'HEADER PRINT', dialMode: 'DIAL MODE' };
  const vol = ['OFF', 'LOW', 'MIDDLE', 'HIGH'];
  const rows = [
    ...headerLines(settings),
    `RECEPTION MODE    : ${settings.rxMode}`,
    ...OPTIONS.map((o) => `${pad(names[o.key], 18)}: ${label(o)}`),
    `SPEAKER VOLUME    : ${vol[settings.volume.speaker]}`,
    `RINGER VOLUME     : ${vol[settings.volume.ringer]}`,
    `JUNK FAX #        : ${settings.junk.filter(Boolean).join(', ') || '-'}`,
    `CLOCK             : ${settings.clock.set ? 'SET' : 'NOT SET'}`,
  ];
  return sheet('SETUP LIST', rows, { now });
}

/** The help list (COPY/HELP with no document): a reminder of the keys [A]. */
export function helpList(settings, { now }) {
  const rows = [
    'SENDING: PUT DOCUMENT FACE DOWN (MAX. 5 SHEETS).',
    '  DIAL THE NUMBER AND PRESS START, OR PRESS A RAPID',
    '  KEY (A-E), OR SPEED DIAL + 2 DIGITS + START.',
    `  ${LEGENDS.RESOLUTION}: STANDARD/FINE/SUPER FINE/HALF TONE.`,
    `  ${LEGENDS.REDIAL}: THE LAST NUMBER DIALLED.`,
    'RECEIVING: PRESS RESOLUTION/RECEPTION MODE WITH NO',
    `  DOCUMENT IN THE FEEDER: ${RX_MODES.join(' / ')}.`,
    '  BY HAND: LIFT THE HANDSET, HEAR FAX TONES, PRESS START.',
    'POLLING: NO DOCUMENT, PRESS E/POLL, DIAL, PRESS START.',
    'COPYING: PUT DOCUMENT IN, PRESS COPY/HELP.',
    'SETTINGS: FUNCTION, THEN 1-6. STOP LEAVES.',
    '  1 DATE&TIME 2 FAX #/NAME 3 TEL # 4 OPTIONS',
    '  5 JUNK FAX # 6 PRINT LIST',
    'STOP CANCELS ANY OPERATION AND RELEASES THE LINE.',
  ];
  return sheet('HELP LIST', rows, { now });
}

/**
 * The header line sent at the top of every page [A: its layout]: date and time, name, number, page. Drawn at the
 * page's vertical resolution so it is the same size on paper at each.
 */
export function headerPage(settings, { wallMs, page, vres }) {
  const sy = vres === 'standard' ? 1 : vres === 'superfine' ? 4 : 2;
  const m = metrics(2, sy);
  const r = new Raster(m.line + 2 * sy);
  const text = `${stamp(wallMs)}  ${pad(settings.ownName, 16)}  FAX ${pad(settings.ownNumber, 16)}  P.${p2(page)}`;
  r.text(MARGIN, sy * 2, text, { sx: 2, sy });
  return { width: r.width, height: r.height, vres, rows: r.data };
}
