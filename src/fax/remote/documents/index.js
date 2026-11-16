// The correspondents' pages, made procedurally from a seed and the date: our own text, set in the desk's office
// (the 1889 blind-writer, the 1926 front-strike, the 1971 single-element machine and the Displaywriter are the
// site's other machines). All letter size at fine resolution.

import { Raster } from '../../firmware/chargen.js';
import { newPage, toPage, typed, typedBlock, handBlock, handwritten, stroke, disc, grey, overlayFine, rng } from './draw.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p2 = (n) => String(n).padStart(2, '0');
const dayOf = (ms) => Math.floor(ms / 86400000);
const longDate = (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];

// ---- the Records Room's stamp ----------------------------------------------------------------------------------------

/** The office's rubber stamp, drawn at fine resolution: RECEIVED, the date and time, the room. */
export function stampRaster(wallMs, { office = 'RECORDS ROOM 14', seed = 7 } = {}) {
  const r = new Raster(190, 600);
  const rand = rng(seed + dayOf(wallMs));
  const d = new Date(wallMs);
  r.frame(4, 4, 592, 182, 5);
  r.frame(16, 16, 568, 158, 2);
  r.text(60, 30, 'RECEIVED', { sx: 6, sy: 6 });
  const when = `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}/${d.getUTCFullYear()}  ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  r.text(48, 94, when, { sx: 4, sy: 4 });
  r.text(48, 134, office, { sx: 4, sy: 4 });
  // Ink that did not take: a rubber stamp is never even.
  for (let i = 0; i < 2600; i++) {
    const x = Math.floor(rand() * 600), y = Math.floor(rand() * 190);
    r.data[y * r.stride + (x >>> 3)] &= ~(0x80 >>> (x & 7));
  }
  return r;
}

/** A received page with the stamp at its top right, as the Records Room sends it back. */
export function stampPage(page, wallMs, opts) {
  return overlayFine(page, stampRaster(wallMs, opts), 1728 - 640, 180);
}

// ---- the information line (polling) ---------------------------------------------------------------------------------

const SKIES = ['CLEAR', 'FAIR', 'CLOUDY', 'SHOWERS', 'RAIN', 'FOG IN THE MORNING', 'WINDY', 'SNOW FLURRIES'];
const SOUPS = ['TOMATO', 'SPLIT PEA', 'CHICKEN NOODLE', 'MINESTRONE', 'CLAM CHOWDER', 'POTATO AND LEEK', 'VEGETABLE BEEF'];
const MAINS = ['MEAT LOAF, MASHED POTATOES', 'BAKED COD, PARSLEY SAUCE', 'CHICKEN POT PIE', 'MACARONI AND CHEESE',
  'TURKEY CLUB SANDWICH', 'BEEF STEW', 'SPAGHETTI AND MEATBALLS', 'GRILLED CHEESE AND COLESLAW'];
const SWEETS = ['APPLE PIE', 'RICE PUDDING', 'JELLO', 'CHOCOLATE CAKE', 'PEACH COBBLER', 'TAPIOCA'];

/** The town information line's fax-back sheet for a day: weather with a little map (halftone) and the canteen menu. */
export function infoSheet(wallMs) {
  const rand = rng(dayOf(wallMs) * 2654435761);
  const r = newPage();
  const L = 120;
  r.text(L, 90, 'TOWN INFORMATION LINE', { sx: 8, sy: 8, bold: true });
  typed(r, L, 180, `FAX-BACK SERVICE  -  ${longDate(wallMs).toUpperCase()}`, { seed: 3 });
  r.hline(L, 230, 1488, 4);
  r.text(L, 270, 'WEATHER', { sx: 6, sy: 6 });
  const hi = 40 + Math.floor(rand() * 45), lo = hi - 8 - Math.floor(rand() * 14);
  const skies = SKIES.filter((x) => (hi > 45 ? !x.startsWith('SNOW') : true));
  const sky = pick(rand, skies), sky2 = pick(rand, skies);
  let y = typedBlock(r, L, 340, [
    `TODAY:     ${sky}. HIGH ${hi}°F, LOW ${lo}°F.`,
    `TONIGHT:   ${sky2}. WINDS ${pick(rand, ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])} ${5 + Math.floor(rand() * 20)} MPH.`,
    `TOMORROW:  ${pick(rand, skies)}. HIGH NEAR ${hi + Math.floor(rand() * 7) - 3}°F.`,
  ], { seed: 11 });
  // The map: a coast, isobars round a low, a shaded area of rain (a halftone in grey).
  const mx = L, my = y + 20, mw = 1488, mh = 640;
  r.frame(mx, my, mw, mh, 3);
  const cx = mx + 300 + rand() * 800, cy = my + 200 + rand() * 260;
  grey(r, mx + 3, my + 3, mw - 6, mh - 6, (x, yy) => {
    const d = Math.hypot(x - cx, yy - cy);
    return d < 260 ? 0.55 * (1 - d / 260) : 0;
  });
  for (let k = 1; k <= 5; k++) {
    const rad = 70 * k, n = 90;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 0.6) / n) * 2 * Math.PI;
      const sq = 1.4;
      const x0 = cx + Math.cos(a0) * rad * sq, y0 = cy + Math.sin(a0) * rad, x1 = cx + Math.cos(a1) * rad * sq, y1 = cy + Math.sin(a1) * rad;
      if (x0 > mx + 6 && x1 < mx + mw - 6 && y0 > my + 6 && y1 < my + mh - 6 && y0 < my + mh - 6) stroke(r, x0, y0, x1, y1, 1);
    }
  }
  r.text(cx - 18, cy - 24, 'L', { sx: 8, sy: 8, bold: true });
  let px = mx + mw - 220, py = my + 10;
  for (let i = 0; i < 40; i++) {                     // the coast
    const nx = px + (rand() - 0.6) * 40, ny = py + mh / 40;
    stroke(r, px, py, nx, ny, 2);
    px = nx; py = ny;
  }
  r.text(mx + mw - 180, my + 60, 'H', { sx: 8, sy: 8, bold: true });
  y = my + mh + 60;
  r.text(L, y, 'CANTEEN - MENU OF THE DAY', { sx: 6, sy: 6 });
  y = typedBlock(r, L, y + 70, [
    `SOUP      ${pick(rand, SOUPS)}`,
    `MAIN      ${pick(rand, MAINS)}`,
    `DESSERT   ${pick(rand, SWEETS)}`,
    'COFFEE OR TEA, 25 CENTS. SERVED 11:30 TO 1:30.',
  ], { seed: 23 });
  r.hline(L, y + 20, 1488, 2);
  typedBlock(r, L, y + 60, [
    'THIS SHEET WAS SENT BECAUSE YOUR MACHINE POLLED THIS LINE.',
    'TO RECEIVE IT AGAIN: NO DOCUMENT IN THE FEEDER, PRESS POLL,',
    'DIAL 555-0167 AND PRESS START.',
  ], { seed: 31 });
  return toPage(r);
}

// ---- the correspondent's reply ------------------------------------------------------------------------------------

const OPENERS = [
  ['Your fax came through', 'clear as a bell.'],
  ['Got your fax -', 'thank you!'],
  ['Your page arrived', 'this afternoon.'],
];
const MIDDLES = [
  ['Was it typed on the old', '1926 front-strike? The', "e's look a little filled in -", 'time for a new ribbon.'],
  ['It looks like the', 'Displaywriter printed it.', 'Such even letters. Mine', 'still sulks on cold days.'],
  ['I could swear that was', 'the golfball machine -', 'the type is so crisp.', 'Do you still have the', 'Courier element?'],
  ['Is that the blind-writer?', 'I never know how anyone', 'typed on a machine where', 'you cannot see the line.'],
];
const CLOSERS = [
  ['More soon -', 'M.'],
  ['Write again when', 'you can. - M.'],
  ['Regards to the desk,', 'Margaret'],
];

/** A short handwritten reply on the correspondent's note paper, chosen by what was sent. */
export function replyNote({ pages = 1, wallMs = 0, seed = 1 } = {}) {
  const rand = rng(seed * 7 + pages * 31 + dayOf(wallMs));
  const r = newPage(1500);                           // note paper: shorter than letter
  // The note paper's printed head.
  r.text(140, 70, 'FROM THE DESK OF', { sx: 3, sy: 3 });
  r.text(140, 104, 'M. OKAFOR', { sx: 6, sy: 6, bold: true });
  r.hline(140, 170, 1440, 2);
  const lines = [
    `${longDate(wallMs)}`,
    '',
    'Dear Desk,',
    ...pick(rand, OPENERS),
    pages > 1 ? `All ${pages} pages, in order.` : 'One page, nicely sent.',
    ...pick(rand, MIDDLES),
    '',
    ...pick(rand, CLOSERS),
  ];
  handBlock(r, 180, 240, lines, { seed: seed + 3, lead: 80, size: 6 });
  // A doodle: a typewriter key.
  const kx = 1380, ky = 1250;
  for (let a = 0; a < 64; a++) {
    const t0 = (a / 64) * 2 * Math.PI, t1 = ((a + 1) / 64) * 2 * Math.PI;
    stroke(r, kx + Math.cos(t0) * 70, ky + Math.sin(t0) * 70, kx + Math.cos(t1) * 70, ky + Math.sin(t1) * 70, 2);
  }
  handwritten(r, kx - 20, ky - 30, 'M', { seed: 5, size: 7 });
  disc(r, kx, ky + 120, 3);
  return toPage(r);
}
