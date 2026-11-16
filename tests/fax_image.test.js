// The FO-70's scanner: the CIS optics (src/fax/image/optics.js), the video path (video.js) and the page sources
// (pages.js, canvas.js). docs/fax/plan.md 2 and M4.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CisSensor, CIS } from '../src/fax/image/optics.js';
import { VideoProcessor, BAYER8 } from '../src/fax/image/video.js';
import { PAGES, barTarget, greyWedge, flatPage } from '../src/fax/image/pages.js';
import { PageCanvas } from '../src/fax/image/canvas.js';
import { scanPage } from '../src/fax/pages/scan-source.js';

const N = CIS.elements;
const elementAt = (pageWidthMm, xMm) => Math.round((xMm - pageWidthMm / 2) / CIS.pitchMm + N / 2 - 0.5);

/** Shaded line (1 = the reference white) of a page at yMm. */
function shadedLine(sensor, page, pose) {
  const vp = new VideoProcessor();
  const raw = new Float32Array(N);
  const w = [], d = [];
  for (let k = 0; k < 8; k++) w.push(Float32Array.from(sensor.scanLine(null, null, raw)));
  for (let k = 0; k < 8; k++) d.push(Float32Array.from(sensor.scanLine(null, null, raw, { led: false })));
  vp.calibrate(w, d);
  sensor.scanLine(page, pose, raw);
  return Float32Array.from(vp.shade(raw));
}

const modulation = (v, i0, i1) => {
  const s = Array.from(v.subarray(i0, i1)).sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * 0.05)], hi = s[Math.floor(s.length * 0.95)];
  return (hi - lo) / (hi + lo);
};
/** Modulation of the fundamental at f cycles a mm, samples `pitch` mm apart (a lock-in, robust to aliasing). */
const lockIn = (v, i0, i1, f, pitch) => {
  let re = 0, im = 0, m = 0;
  for (let i = i0; i < i1; i++) { const a = 2 * Math.PI * f * i * pitch; re += v[i] * Math.cos(a); im += v[i] * Math.sin(a); m += v[i]; }
  return (2 * Math.hypot(re, im)) / m;
};

test('optics MTF: modulation falls with spatial frequency, with lift off the glass and with motion smear', () => {
  const quiet = { readNoise: 0, shotNoise: 0 };
  const m = {};
  for (const lp of [1, 2, 3, 3.5]) {
    const page = barTarget({ lpmm: lp, vertical: true });
    m[lp] = lockIn(shadedLine(new CisSensor(quiet), page, { yMm: 10 }), 200, 1528, lp, CIS.pitchMm);
  }
  // a square wave's fundamental is 4/pi of its modulation
  assert.ok(m[1] > 0.75 * 4 / Math.PI, `1 lp/mm ${m[1]}`);
  assert.ok(m[1] > m[2] && m[2] > m[3] && m[3] > m[3.5], JSON.stringify(m));
  assert.ok(m[3.5] < 0.6 * m[1], `near Nyquist ${m[3.5]}`);
  // a sheet lifted 0.3 mm off the glass goes soft (a contact sensor has almost no depth of field)
  const p2 = barTarget({ lpmm: 2, vertical: true });
  const lifted = lockIn(shadedLine(new CisSensor(quiet), p2, { yMm: 10, liftMm: 0.3 }), 200, 1528, 2, CIS.pitchMm);
  assert.ok(lifted < 0.5 * m[2], `lifted ${lifted} vs ${m[2]}`);
  // along the feed: horizontal bars, scanned line by line at a fine and at a standard step (travel during the line)
  const ph = barTarget({ lpmm: 2, vertical: false, heightMm: 20 });
  const along = (travel) => {
    const s = new CisSensor(quiet);
    const vals = [];
    for (let y = 4; y < 16; y += 0.05) vals.push(shadedLine(s, ph, { yMm: y, travelMm: travel })[864]);
    return modulation(Float32Array.from(vals), 0, vals.length);
  };
  const fine = along(1 / 7.7), standard = along(1 / 3.85);
  assert.ok(fine > 0.5 && standard < fine, `fine ${fine}, standard ${standard}`);
});

test('shading correction removes a known light profile, chip steps and element gains', () => {
  const sensor = new CisSensor({ readNoise: 0, shotNoise: 0, led: { endFalloff: 4, ripple: 0.05 }, chipGainSpread: 0.08 });
  const raw = new Float32Array(N);
  sensor.scanLine(flatPage({ reflectance: 0.5 }), { yMm: 5 }, raw);
  const cv = (v) => { let s = 0, s2 = 0; for (const x of v) { s += x; s2 += x * x; } const m = s / v.length; return Math.sqrt(s2 / v.length - m * m) / m; };
  assert.ok(cv(raw) > 0.15, `raw profile ${cv(raw)}`);
  const v = shadedLine(new CisSensor({ readNoise: 0, shotNoise: 0, led: { endFalloff: 4, ripple: 0.05 }, chipGainSpread: 0.08 }), flatPage({ reflectance: 0.5 }), { yMm: 5 });
  assert.ok(cv(v) < 0.01, `after shading ${cv(v)}`);
  let mean = 0; for (const x of v) mean += x / N;
  assert.ok(Math.abs(mean - 0.5 / CIS.whiteReference) < 0.02, `level ${mean}`);
});

test('64-level halftone: a grey wedge scans to monotonic density with many distinct levels', () => {
  assert.equal(new Set(BAYER8).size, 64);
  const page = greyWedge({ steps: 64, stepMm: 3, heightMm: 12 });
  const s = scanPage(page, { vres: 'fine', mode: 'halftone' });
  const frac = [];
  for (let k = 0; k < 64; k++) {
    const c = elementAt(page.widthMm, (k + 0.5) * 3);
    let black = 0, n = 0;
    for (let y = 16; y < 80; y++) for (let i = c - 8; i < c + 8; i++) { black += (s.bitmap[y * s.stride + (i >> 3)] >> (7 - (i & 7))) & 1; n++; }
    frac.push(black / n);
  }
  for (let k = 1; k < 64; k++) assert.ok(frac[k] >= frac[k - 1] - 0.02, `step ${k}: ${frac[k - 1]} -> ${frac[k]}`);
  assert.ok(frac[0] < 0.02 && frac[63] > 0.97, `${frac[0]} .. ${frac[63]}`);
  const distinct = new Set(frac.map((f) => Math.round(f * 64))).size;
  assert.ok(distinct >= 40, `distinct levels ${distinct}`);
});

test('text mode: the contrast setting moves the threshold; white tracking follows a grey original', () => {
  // a grey band (0.40) on white paper (0.86): about 0.47 of the tracked background
  const gc = new PageCanvas({ widthMm: 216, heightMm: 10, dpmm: 8 });
  gc.rect(58, 0, 100, 10, 0.40);
  const grey = gc.page();
  const blackCount = (contrast, page) => {
    const s = scanPage(page, { vres: 'fine', contrast });
    let n = 0;
    for (let i = 500; i < 1200; i++) n += (s.bitmap[40 * s.stride + (i >> 3)] >> (7 - (i & 7))) & 1;
    return n / 700;
  };
  assert.ok(blackCount('light', grey) > 0.95, 'light original: darkened');
  assert.ok(blackCount('normal', grey) > 0.95, 'normal');
  assert.ok(blackCount('dark', grey) < 0.05, 'dark original: lightened');
  // a uniformly grey sheet is taken as its own background (white tracking): it scans white
  assert.ok(blackCount('normal', flatPage({ reflectance: 0.45, heightMm: 12 })) < 0.05);
  // a cream original with dark text: the background is tracked to white, the text stays black
  const c = new PageCanvas({ widthMm: 216, heightMm: 20, dpmm: 8, paper: 0.62 });
  c.rect(100, 0, 2, 20);
  const s = scanPage(c.page(), { vres: 'fine' });
  const row = 100;
  const bit = (i) => (s.bitmap[row * s.stride + (i >> 3)] >> (7 - (i & 7))) & 1;
  let bg = 0; for (let i = 100; i < 600; i++) bg += bit(i);
  assert.equal(bg, 0, 'background white');
  assert.equal(bit(elementAt(216, 101)), 1, 'rule black');
});

test('skew from the feeder moves a vertical rule across the bar by tan(skew) per mm of feed', () => {
  const c = new PageCanvas({ widthMm: 210, heightMm: 200, dpmm: 8 });
  c.rect(104.5, 0, 1, 200);
  const page = c.page();
  const pos = (y, skewRad) => {
    const v = shadedLine(new CisSensor({ readNoise: 0, shotNoise: 0 }), page, { yMm: y, skewRad });
    let s = 0, w = 0;
    for (let i = 0; i < N; i++) { const d = Math.max(0, 0.7 - v[i]); s += d * i; w += d; }
    return s / w;
  };
  const skew = 0.02;
  const shift = (pos(150, skew) - pos(50, skew)) * CIS.pitchMm;
  assert.ok(Math.abs(Math.abs(shift) - 100 * Math.tan(skew)) < 0.15, `shift ${shift} mm`);
  assert.ok(Math.abs(pos(150, 0) - pos(50, 0)) < 0.2);
});

test('page sources: the chart and the sample documents are A4 with ink on them', () => {
  for (const [name, f] of Object.entries(PAGES)) {
    const p = f({ dpmm: 4 });
    assert.equal(p.widthMm, 210); assert.equal(p.heightMm, 297);
    assert.equal(p.data.length, p.w * p.h);
    let dark = 0; for (const v of p.data) if (v < 100) dark++;
    assert.ok(dark > 0.005 * p.data.length, `${name}: ${dark}`);
  }
});

test('worklet hygiene: image, thermal and page-adapter modules use no DOM, timers or structuredClone', () => {
  for (const dir of ['src/fax/image', 'src/fax/thermal', 'src/fax/pages']) {
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\/.*$/gm, '');
      for (const bad of [/setTimeout/, /setInterval/, /structuredClone/, /\bdocument\.\w/, /\bwindow\.\w/, /from 'node:/]) {
        assert.ok(!bad.test(src), `${dir}/${f} uses ${bad}`);
      }
    }
  }
});
