// Page sources for the scanner: our own test chart and a few sample documents, drawn procedurally (canvas.js) as
// grey reflectance images in millimetres. Nothing here is copied from an ITU or other published test chart; the
// chart's content is ours, chosen to show what the CIS, the video path, the coder and the thermal head each do:
// text in sizes from 1.2 to 10 mm, rules from 0.1 to 1 mm, a star, bar groups (a resolution wedge) from 1 to 7 line
// pairs a millimetre both across the bar and along the feed, a converging-line fan, a 64-step grey scale, smooth
// gradients and a photograph-like still life.
//
//   PAGES[name]({ dpmm }) -> page   names: chart, memo, cover, menu, drawing
//   barTarget({ lpmm, ... }) -> page  a small page of bars for MTF measurements
//   greyWedge({ steps }) -> page      a small page of grey steps
// A page is { name, title, widthMm, heightMm, dpmmX, dpmmY, w, h, data } (canvas.js). The default 16 dots a mm is
// twice the sensor's pitch, so the source does not limit the scan [A]. Pure module.

import { PageCanvas, PAPER, INK } from './canvas.js';

const A4 = { widthMm: 210, heightMm: 297 };
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Reflectance of grey step k of n, equal steps from the paper to the ink. */
export const greyStep = (k, n = 64) => lerp(PAPER, INK, k / (n - 1));

function cornerMarks(c, m = 5, L = 6, t = 0.3) {
  const W = c.widthMm, H = c.heightMm;
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    c.line(x, y, x + sx * L, y, t, INK, 'flat');
    c.line(x, y, x, y + sy * L, t, INK, 'flat');
  }
}

/** Bars of `lpmm` line pairs a mm in a box; vertical bars (resolve across the bar) or horizontal (along the feed). */
function bars(c, x, y, w, h, lpmm, vertical = true, r = INK) {
  const period = 1 / lpmm;
  const n = Math.floor((vertical ? w : h) / period);
  for (let k = 0; k < n; k++) {
    if (vertical) c.rect(x + k * period, y, period / 2, h, r);
    else c.rect(x, y + k * period, w, period / 2, r);
  }
}

/** A photograph-like still life: a lit sphere and a vase on a table before a soft wall, in reflectance. */
export function stillLife(w, h) {
  return (u, v) => {
    // u, v in 0..1 across the picture
    const wall = lerp(0.72, 0.38, smooth(v * 1.1)) * (1 - 0.18 * (u - 0.5) * (u - 0.5) * 4);
    const tableY = 0.66;
    let r = v < tableY ? wall : lerp(0.55, 0.30, (v - tableY) / (1 - tableY)) + 0.04 * Math.sin(u * 40 + v * 7) * (v - tableY);
    // shadow of the sphere on the table
    const sx = 0.36, sy = 0.47, sr = 0.17;
    const dsh = Math.hypot((u - (sx + 0.09)) / 1.6, (v - (tableY + 0.04)) / 0.35) / sr;
    if (v >= tableY) r *= 1 - 0.45 * (1 - smooth(dsh));
    // sphere, lit from upper left
    const dx = (u - sx) / sr, dy = ((v - sy) * (h / w)) / sr;
    const rr = dx * dx + dy * dy;
    if (rr < 1) {
      const nz = Math.sqrt(1 - rr);
      const lam = Math.max(0, -0.55 * dx - 0.6 * dy + 0.58 * nz);
      const spec = Math.pow(Math.max(0, -0.3 * dx - 0.35 * dy + 0.89 * nz), 40);
      r = 0.08 + 0.72 * lam + 0.25 * spec;
    }
    // vase: a cylinder with a curved silhouette, lit from the left
    const vx = 0.72, vTop = 0.22, vBot = tableY + 0.02;
    if (v > vTop && v < vBot) {
      const t = (v - vTop) / (vBot - vTop);
      const halfW = 0.05 + 0.075 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + (t < 0.12 ? 0.02 : 0);
      const a = (u - vx) / halfW;
      if (Math.abs(a) < 1) {
        const lam = 0.5 + 0.5 * Math.cos((a + 0.45) * 1.4);
        r = 0.12 + 0.55 * lam + 0.04 * Math.sin(t * 30);
      }
    }
    return r < 0.03 ? 0.03 : r > 0.9 ? 0.9 : r;
  };
}

/** Our test chart, A4. */
export function chartPage({ dpmm = 16 } = {}) {
  const c = new PageCanvas({ ...A4, dpmm, name: 'chart', title: 'FO-70 test chart (ours)' });
  cornerMarks(c);
  c.text('FO-70 TEST CHART', 12, 10, 7, { weight: 1.6 });
  c.text('Our own chart for the scanner, the coder and the thermal head; not an ITU-T chart.', 12, 23, 2.2);
  c.text('CIS 1728 x 8/mm   3.85 / 7.7 / 15.4 lines/mm   64-level halftone   MH / MR', 12, 28.5, 2.2);
  c.line(12, 34, 198, 34, 0.4, INK, 'flat');

  // Text in sizes
  let y = 38;
  const sample = 'Fax 0123456789 The quick brown fox jumps';
  for (const s of [1.2, 1.5, 2, 2.5, 3, 4, 5]) {
    c.text(`${s.toFixed(1)} mm`, 12, y, 2);
    c.text(sample.slice(0, Math.floor(166 / (s * 8 / 9))), 30, y, s);
    y += s * 16 / 9 + 1.4;
  }
  c.text('Bold 10', 12, y + 1, 10, { weight: 1.8 });
  c.text('mm', 12 + c.textWidth('Bold 10 ', 10), y + 1, 10, { weight: 0.9 });
  y += 20;

  // Rules, horizontal and vertical, 0.1 to 1 mm
  const widths = [0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1.0];
  let ly = y;
  for (const t of widths) {
    c.text(`${t.toFixed(2)}`, 12, ly - 1.0, 1.8);
    c.line(24, ly, 84, ly, t, INK, 'flat');
    ly += 4;
  }
  widths.forEach((t, k) => {
    const x = 92 + k * 6;
    c.line(x, y - 1, x, y + 25, t, INK, 'flat');
  });
  // a star of 48 spokes
  const sx = 170, sy = y + 13, R = 15;
  for (let k = 0; k < 48; k++) {
    const a0 = (k / 48) * 2 * Math.PI, a1 = ((k + 0.5) / 48) * 2 * Math.PI;
    c.polygon([[sx, sy], [sx + R * Math.cos(a0), sy + R * Math.sin(a0)], [sx + R * Math.cos(a1), sy + R * Math.sin(a1)]]);
  }
  c.circle(sx, sy, R + 0.8, { t: 0.25 });
  y += 33;

  // Resolution wedge: bar groups across the bar (vertical bars) and along the feed (horizontal bars)
  const lps = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7];
  c.text('line pairs / mm', 12, y, 2);
  y += 5;
  lps.forEach((lp, k) => {
    const x = 12 + k * 18.6;
    c.text(String(lp), x, y, 2);
    bars(c, x, y + 4, 14, 10, lp, true);
    bars(c, x, y + 16, 14, 10, lp, false);
  });
  y += 30;
  // converging fan: 24 lines, 1 mm apart on the left (1 lp/mm) and 0.125 mm apart on the right (8 lp/mm)
  {
    const n = 24, top = y;
    for (let k = 0; k < n; k++) c.line(12, top + k, 198, top + 10.5 + k * 0.125, 0.1, INK, 'flat');
    y += n + 3;
  }

  // 64-step grey scale
  c.text('64 grey steps', 12, y, 2);
  y += 4.5;
  for (let k = 0; k < 64; k++) {
    c.rect(12 + k * 2.9, y, 2.9, 14, greyStep(k));
    if (k % 8 === 0) c.text(String(k), 12 + k * 2.9, y + 15, 1.6);
  }
  y += 20;

  // Photograph-like gradients and a still life
  const gy = y, gh = 297 - 14 - gy;
  c.fill(12, gy, 18, gh, (xm, ym) => lerp(PAPER, INK, (ym - gy) / gh));
  c.fill(33, gy, 50, gh, (xm, ym) => {
    const d = Math.hypot(xm - 58, ym - gy - gh / 2) / (gh / 2);
    return lerp(INK + 0.05, PAPER, smooth(d));
  });
  const life = stillLife(108, gh);
  c.fill(90, gy, 108, gh, (xm, ym) => life((xm - 90) / 108, (ym - gy) / gh));
  c.frame(90, gy, 108, gh, 0.3);
  c.text('Page 1/1  chart', 12, 297 - 10, 1.8);
  return c.page();
}

function paragraph(c, text, x, y, width, size = 2.8, lead = 1.55) {
  const per = Math.floor(width / c.textWidth('M', size));
  const words = text.split(/\s+/);
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > per) {
      c.text(line, x, y, size);
      y += size * lead + size * 0.45;
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) { c.text(line, x, y, size); y += size * lead + size * 0.45; }
  return y;
}

/** A short office memo. */
export function memoPage({ dpmm = 16 } = {}) {
  const c = new PageCanvas({ ...A4, dpmm, name: 'memo', title: 'Memo' });
  c.text('MEMORANDUM', 20, 20, 8, { weight: 1.6 });
  c.line(20, 36, 190, 36, 0.6, INK, 'flat');
  let y = 42;
  for (const [k, v] of [['TO:', 'All staff, second floor'], ['FROM:', 'R. Okafor, office manager'], ['DATE:', '12 March 1999'], ['RE:', 'New fax machine by the copier']]) {
    c.text(k, 20, y, 3, { weight: 1.4 });
    c.text(v, 50, y, 3);
    y += 7;
  }
  c.line(20, y + 1, 190, y + 1, 0.3, INK, 'flat');
  y += 8;
  y = paragraph(c, 'The new fax machine is on the table beside the copier. Load documents face down, up to five sheets at a time, and set the guides to the width of the paper. Press RESOLUTION for fine print or for photographs before you dial.', 20, y, 170);
  y += 3;
  y = paragraph(c, 'Received faxes come out on thermal paper and are cut to length. Thermal paper fades in sunlight and near heat, so please photocopy anything you need to keep and file the copy, not the fax.', 20, y, 170);
  y += 3;
  y = paragraph(c, 'If the display shows CHECK PAPER, a new roll is in the cupboard under the window. The coated side goes toward the head; a roll put in the wrong way round prints blank pages.', 20, y, 170);
  y += 3;
  y = paragraph(c, 'Thank you.', 20, y, 170);
  c.text('R.O.', 20, y + 6, 6, { weight: 1.2 });
  c.line(18, y + 16, 60, y + 13, 0.35);
  c.text('Page 1 of 1', 165, 280, 2.2);
  return c.page();
}

/** A fax cover sheet for a fictional company. */
export function coverPage({ dpmm = 16 } = {}) {
  const c = new PageCanvas({ ...A4, dpmm, name: 'cover', title: 'Fax cover sheet' });
  // logo: a lighthouse in a ring
  c.circle(35, 32, 16, { t: 1.2 });
  c.polygon([[31, 44], [39, 44], [37.2, 22], [32.8, 22]]);
  c.rect(31.5, 18, 7, 4);
  c.polygon([[30.5, 18], [39.5, 18], [35, 13.5]]);
  for (const a of [-0.35, 0.35]) c.line(35, 20, 35 + 14 * Math.cos(a), 20 + 14 * Math.sin(a) - 2, 0.6);
  c.text('HARBOUR LANE', 58, 20, 6, { weight: 1.5 });
  c.text('OFFICE SUPPLY', 58, 31, 6, { weight: 1.5 });
  c.text('14 Harbour Lane, Unit 3', 58, 42, 2.4);
  c.text('FAX', 20, 60, 30, { weight: 2.2 });
  const fields = [['To', 'Accounts Department'], ['Fax', '555 0142'], ['From', 'Despatch desk'], ['Date', '15 April 1999'], ['Pages', '2 including this page'], ['Re', 'Order 4471, delivery note']];
  let y = 120;
  for (const [k, v] of fields) {
    c.text(k, 20, y, 3.2, { weight: 1.4 });
    c.line(45, y + 5.5, 190, y + 5.5, 0.2, INK, 'flat');
    c.text(v, 48, y, 3.2);
    y += 10;
  }
  y += 4;
  c.frame(20, y, 170, 70, 0.4);
  c.text('Comments', 24, y + 4, 3, { weight: 1.4 });
  paragraph(c, 'Two cartons of the 30 m thermal rolls go out on Friday with the copier toner. Please check the delivery note against your order and fax back any changes by Thursday noon.', 24, y + 12, 160, 3);
  for (const [k, lbl] of [['URGENT', 22], ['PLEASE REPLY', 70], ['FOR REVIEW', 140]]) {
    c.frame(lbl, 272, 5, 5, 0.35);
    c.text(k, lbl + 7, 272, 3);
  }
  c.line(70.8, 274.5, 72.3, 276.4, 0.6); c.line(72.3, 276.4, 75.5, 270.5, 0.6);   // PLEASE REPLY ticked
  return c.page();
}

/** A takeaway menu. */
export function menuPage({ dpmm = 16 } = {}) {
  const c = new PageCanvas({ ...A4, dpmm, name: 'menu', title: 'Takeaway menu' });
  c.frame(10, 10, 190, 277, 1.2);
  c.frame(13, 13, 184, 271, 0.3);
  // a cup
  c.polygon([[90, 26], [120, 26], [116, 46], [94, 46]], { t: 0.8 });
  c.circle(122, 33, 5, { t: 0.8 });
  for (let k = 0; k < 3; k++) c.line(98 + k * 7, 23, 100 + k * 7, 15, 0.5);
  c.line(86, 48, 124, 48, 0.8);
  const title = 'THE CORNER TABLE';
  c.text(title, 105 - c.textWidth(title, 7) / 2, 54, 7, { weight: 1.6 });
  const sub = 'Takeaway and delivery  -  phone orders welcome';
  c.text(sub, 105 - c.textWidth(sub, 2.6) / 2, 68, 2.6);
  const sections = [
    ['SOUPS', [['Tomato and basil', '2.40'], ['Lentil with cumin', '2.40'], ['Soup of the day', '2.80']]],
    ['SANDWICHES', [['Cheese and pickle', '2.10'], ['Egg mayonnaise and cress', '2.10'], ['Ham and mustard', '2.60'], ['Toasted club', '3.90']]],
    ['HOT DISHES', [['Shepherd\'s pie', '4.80'], ['Vegetable curry and rice', '4.50'], ['Fish of the day, chips', '5.20'], ['Jacket potato, two fillings', '3.30']]],
    ['DRINKS', [['Tea', '0.80'], ['Coffee', '0.95'], ['Hot chocolate', '1.10'], ['Orange juice', '1.00']]],
  ];
  let y = 80;
  for (const [head, items] of sections) {
    c.text(head, 24, y, 4, { weight: 1.5 });
    y += 9;
    for (const [n, p] of items) {
      c.text(n, 28, y, 3);
      const px = 186 - c.textWidth(p, 3);
      const startDots = 28 + c.textWidth(n, 3) + 2;
      for (let x = startDots; x < px - 2; x += 2.2) c.circle(x, y + 2.9, 0.22);
      c.text(p, px, y, 3);
      y += 7;
    }
    y += 6;
  }
  const foot = 'Open 7.30 to 15.00, Monday to Saturday';
  c.text(foot, 105 - c.textWidth(foot, 2.6) / 2, 272, 2.6);
  return c.page();
}

/** A technical drawing: a bracket in two views with dimensions and a title block. */
export function drawingPage({ dpmm = 16 } = {}) {
  const c = new PageCanvas({ ...A4, dpmm, name: 'drawing', title: 'Bracket drawing' });
  c.frame(10, 10, 190, 277, 0.7);
  const thick = 0.5, thin = 0.18;
  const dash = (xa, ya, xb, yb, on = 4, off = 1.5, dot = true) => {
    const L = Math.hypot(xb - xa, yb - ya), ux = (xb - xa) / L, uy = (yb - ya) / L;
    for (let s = 0; s < L; s += on + off + (dot ? off + 0.5 : 0)) {
      const e = Math.min(L, s + on);
      c.line(xa + ux * s, ya + uy * s, xa + ux * e, ya + uy * e, thin, INK, 'flat');
      if (dot && e + off < L) c.line(xa + ux * (e + off), ya + uy * (e + off), xa + ux * (e + off + 0.5), ya + uy * (e + off + 0.5), thin, INK, 'flat');
    }
  };
  const arrow = (x, y, dx, dy) => {
    const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    c.polygon([[x, y], [x - 3 * ux - 0.9 * uy, y - 3 * uy + 0.9 * ux], [x - 3 * ux + 0.9 * uy, y - 3 * uy - 0.9 * ux]]);
  };
  const dimH = (xa, xb, y, label) => {
    c.line(xa, y, xb, y, thin, INK, 'flat');
    arrow(xa, y, -1, 0); arrow(xb, y, 1, 0);
    c.text(label, (xa + xb) / 2 - c.textWidth(label, 2.5) / 2, y - 4.2, 2.5);
  };
  const dimV = (x, ya, yb, label) => {
    c.line(x, ya, x, yb, thin, INK, 'flat');
    arrow(x, ya, 0, -1); arrow(x, yb, 0, 1);
    c.text(label, x + 1.5, (ya + yb) / 2 - 1.5, 2.5);
  };
  // front view: an L bracket with two holes and a fillet
  const ox = 35, oy = 40;
  c.polygon([[ox, oy], [ox + 12, oy], [ox + 12, oy + 68], [ox + 100, oy + 68], [ox + 100, oy + 80], [ox, oy + 80]], { t: thick });
  for (const hx of [ox + 45, ox + 80]) {           // the holes, hidden in this view: dashed edges and centre line
    for (const e of [-4, 4]) dash(hx + e, oy + 68, hx + e, oy + 80, 2, 1, false);
    dash(hx, oy + 62, hx, oy + 86, 3, 1);
  }
  c.circle(ox + 6, oy + 22, 3.5, { t: thick });
  dash(ox - 4, oy + 22, ox + 16, oy + 22, 3, 1);
  dash(ox + 6, oy + 14, ox + 6, oy + 30, 3, 1);
  // plan view: the base plate with holes
  const py = 150;
  c.polygon([[ox + 12, py], [ox + 100, py], [ox + 100, py + 50], [ox + 12, py + 50]], { t: thick });
  c.line(ox, py, ox + 12, py, thick); c.line(ox, py, ox, py + 50, thick); c.line(ox, py + 50, ox + 12, py + 50, thick);
  for (const hx of [ox + 45, ox + 80]) for (const hy of [py + 12, py + 38]) {
    c.circle(hx, hy, 4, { t: thick });
    dash(hx - 7, hy, hx + 7, hy, 3, 1);
    dash(hx, hy - 7, hx, hy + 7, 3, 1);
  }
  // hatched section of the upright: 45-degree lines 3 mm apart, clipped to it
  c.shape(ox, oy, ox + 12, oy + 68, (xm, ym) => {
    const box = Math.max(ox - xm, xm - ox - 12, oy - ym, ym - oy - 68);
    let m = ((xm - ox) - (ym - oy)) % 3; if (m < 0) m += 3;
    return Math.max(box, Math.abs(m - 1.5) / Math.SQRT2 - 0.09);
  });
  dimH(ox, ox + 100, oy + 92, '100');
  dimV(ox - 8, oy, oy + 80, '80');
  dimH(ox + 45, ox + 80, py + 60, '35');
  dimV(ox + 108, py + 12, py + 38, '26');
  c.text('4 HOLES  DIA 8', ox + 112, py + 44, 2.5);
  c.text('R 3.5 SLOT', ox + 14, oy + 20, 2.5);
  // title block
  c.frame(120, 250, 80, 37, 0.5);
  c.line(120, 262, 200, 262, 0.3, INK, 'flat');
  c.line(120, 274, 200, 274, 0.3, INK, 'flat');
  c.line(160, 262, 160, 287, 0.3, INK, 'flat');
  c.text('MOTOR BRACKET', 124, 253, 4, { weight: 1.5 });
  c.text('MATL  2 MM STEEL', 123, 265, 2.2);
  c.text('SCALE 1:1', 163, 265, 2.2);
  c.text('DRAWN  J.T.', 123, 277, 2.2);
  c.text('SHEET 1 OF 1', 163, 277, 2.2);
  return c.page();
}

export const PAGES = Object.freeze({ chart: chartPage, memo: memoPage, cover: coverPage, menu: menuPage, drawing: drawingPage });

/** A small page of vertical (across the bar) or horizontal (along the feed) bars, for MTF measurements. */
export function barTarget({ lpmm = 2, vertical = true, widthMm = 216, heightMm = 20, dpmm = 32 } = {}) {
  const c = new PageCanvas({ widthMm, heightMm, dpmm, name: `bars-${lpmm}`, title: `${lpmm} lp/mm` });
  bars(c, 0, 0, widthMm, heightMm, lpmm, vertical);
  return c.page();
}

/** A small page of `steps` grey patches side by side, each `stepMm` wide, the full height. */
export function greyWedge({ steps = 64, stepMm = 3, heightMm = 30, dpmm = 16 } = {}) {
  const c = new PageCanvas({ widthMm: steps * stepMm, heightMm, dpmm, name: 'wedge', title: `${steps} grey steps` });
  for (let k = 0; k < steps; k++) c.rect(k * stepMm, 0, stepMm, heightMm, greyStep(k, steps));
  return c.page();
}

/** A uniform page of one reflectance. */
export function flatPage({ reflectance = 0.5, widthMm = 216, heightMm = 10, dpmm = 8 } = {}) {
  const c = new PageCanvas({ widthMm, heightMm, dpmm, paper: reflectance, name: 'flat', title: 'flat' });
  return c.page();
}
