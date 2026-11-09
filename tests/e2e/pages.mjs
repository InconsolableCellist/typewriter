// Finished pages end to end: retire a sheet, see it on the desk, browse it, save it as PDF.
// Run ONLY through tests/e2e/xrun.sh (private Xvfb):  tests/e2e/xrun.sh node tests/e2e/pages.mjs [outdir]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.argv[2] ?? join(process.env.E2E_OUT ?? join(tmpdir(), 'typewriter-e2e'), 'pages');
mkdirSync(outDir, { recursive: true });
const report = { checks: [], measures: {} };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const distDir = join(outDir, 'dist');
execFileSync(join(root, 'node_modules/.bin/vite'), ['build', '--outDir', distDir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
const port = 5400 + Math.floor(Math.random() * 400);
const vite = spawn(join(root, 'node_modules/.bin/vite'), ['preview', '--outDir', distDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite did not start')), 20000); vite.stdout.on('data', (d) => { if (/127\.0\.0\.1/.test(String(d))) { clearTimeout(t); res(); } }); vite.on('exit', (c) => rej(new Error('vite exit ' + c))); });

const exe = join(homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome');
if (!existsSync(exe)) throw new Error('chromium not found at ' + exe);
const browser = await chromium.launch({ executablePath: exe, headless: false, args: ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const shot = (name) => page.screenshot({ path: join(outDir, name) });
const typeText = async (text) => { for (const c of text) { await page.keyboard.press(c === ' ' ? 'Space' : c); await sleep(170); } await sleep(300); };
const waitPaper = () => page.waitForFunction(() => window.__tw && !window.__tw.hands.cancelLoad && window.__tw.soft.readouts().printV !== null, null, { timeout: 60000 });
const pileScreen = () => page.evaluate(() => {
  const { pages, stage } = window.__tw;
  const v = pages.pile.group.position.clone(); v.y = 0.003; v.project(stage.camera);
  const c = stage.renderer.domElement.getBoundingClientRect();
  return { x: c.left + (v.x + 1) / 2 * c.width, y: c.top + (1 - v.y) / 2 * c.height };
});

try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__tw?.pages, null, { timeout: 60000 });
  await waitPaper();
  await sleep(1500);
  check('no pile before anything is archived', await page.evaluate(() => window.__tw.pages.pile.sheets.length === 0 && window.__tw.pages.archive.pages.length === 0));
  await shot('01-no-pile.png');

  await page.evaluate(() => { window.__strikes = 0; window.__tw.sim.on('strike', () => window.__strikes++); });
  await typeText('hello desk');
  await page.keyboard.press('Enter');
  await sleep(1800);
  await typeText('page one');
  await sleep(500);
  report.measures.redMaskCellsDefaultRibbon = await page.evaluate(() => window.__tw.soft.colorMask.data.reduce((a, v) => a + (v > 0), 0));
  check('typing printed', (await page.evaluate(() => window.__strikes)) > 10, await page.evaluate(() => window.__strikes));

  // Retirement: frame pacing and the cost of the swap, on a fully inked sheet.
  await page.evaluate(() => {
    const { soft } = window.__tw;
    const log = window.__spawnLog = [];
    const orig = soft.spawnSheet.bind(soft);
    soft.spawnSheet = (p) => { const t0 = performance.now(); orig(p); log.push(performance.now() - t0); };
    window.__rafLog = [];
    let last = performance.now();
    const tick = (n) => { window.__rafLog.push([n, n - last]); last = n; window.__rafId = requestAnimationFrame(tick); };
    window.__rafId = requestAnimationFrame(tick);
  });
  await sleep(1500);
  const tRetire = await page.evaluate(() => { const t = performance.now(); window.__tw.hands.loadPaper(); return t; });
  await page.waitForFunction(() => window.__tw.pages.archive.pages.length === 1, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__tw.pages.pile.sheets.length === 1, null, { timeout: 10000 });
  const encodeMs = await page.evaluate(() => performance.now()) - tRetire;
  await sleep(1200);
  const pacing = await page.evaluate((tR) => {
    const log = window.__rafLog;
    cancelAnimationFrame(window.__rafId);
    const before = log.filter(([t]) => t < tR).map(([, d]) => d);
    const after = log.filter(([t]) => t >= tR).map(([, d]) => d);
    const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
    return { baselineMs: med(before), baselineMaxMs: Math.max(...before), afterMaxMs: Math.max(...after), framesAfter: after.length, spawnSheetMs: window.__spawnLog };
  }, tRetire);
  report.measures.retirement = { ...pacing, msToArchiveAndDesk: encodeMs };
  console.log('retirement', JSON.stringify(report.measures.retirement));
  const info = await page.evaluate(async () => {
    const p = window.__tw.pages.archive.pages[0];
    return { jpeg: p.blob.size, thumb: p.thumb.size, w: p.width, h: p.height };
  });
  report.measures.firstPage = info;
  check('page archived as compressed blobs', info.jpeg > 1000 && info.jpeg < 6e6 && info.thumb < 1e6, JSON.stringify(info));
  await waitPaper();
  await sleep(800);
  await shot('02-page-on-desk.png');

  // A close look at how the sheet lies on the desk.
  await page.evaluate(() => { const o = window.__tw.orbit; o.target.set(0.335, 0, 0.085); o.radius = 0.55; o.theta = 0.05; o.phi = 0.5; o.apply(); });
  await sleep(500);
  await shot('03-pile-closeup.png');
  await page.evaluate(() => window.__tw.orbit.reset());
  await sleep(300);

  // A second page, then a third thing: the archive growing while the viewer is open is covered below.
  await typeText('second sheet');
  await page.evaluate(() => window.__tw.hands.loadPaper());
  await page.waitForFunction(() => window.__tw.pages.archive.pages.length === 2 && window.__tw.pages.pile.sheets.length === 2, null, { timeout: 30000 });
  await waitPaper();
  await sleep(800);

  // Hover label and picking.
  const at = await pileScreen();
  await page.mouse.move(at.x - 3, at.y - 2);
  await page.mouse.move(at.x, at.y);
  await sleep(300);
  const label = await page.evaluate(() => { const t = document.getElementById('labelTip'); return t.style.display === 'none' ? null : t.textContent; });
  check('hover labels the pile', /Finished pages \(2\)/.test(label ?? ''), label);
  await shot('04-hover.png');

  await page.mouse.down(); await sleep(60); await page.mouse.up();
  await sleep(600);
  check('click opens the viewer', await page.evaluate(() => window.__tw.pages.viewer.isOpen));
  check('viewer opens on the newest page', (await page.textContent('#pvCount')) === 'page 2 of 2', await page.textContent('#pvCount'));
  await page.waitForFunction(() => { const i = document.getElementById('pvImage'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  await shot('05-viewer.png');

  // Keys: the terminal's capture-phase handler, armed the way enter() arms it, must not fire while the overlay is open.
  await page.evaluate(() => {
    const t = window.__tw.terminal;
    window.__sent = [];
    Object.defineProperty(t.bridge, 'open', { value: true, configurable: true });
    window.__origSend = t.bridge.send;
    t.bridge.send = (b) => window.__sent.push(b);
    window.addEventListener('keydown', t.onKeyDown, true);
  });
  const strikes0 = await page.evaluate(() => window.__strikes);
  await page.keyboard.press('x'); await page.keyboard.press('Enter');
  await sleep(500);
  check('keystrokes reach neither shell nor machine while open', (await page.evaluate(() => window.__sent.length)) === 0 && (await page.evaluate(() => window.__strikes)) === strikes0);
  await page.keyboard.press('ArrowLeft');
  await sleep(200);
  check('arrow keys browse with terminal mode armed', (await page.textContent('#pvCount')) === 'page 1 of 2', await page.textContent('#pvCount'));
  await page.keyboard.press('ArrowRight'); await sleep(150);
  check('arrow right returns', (await page.textContent('#pvCount')) === 'page 2 of 2');
  await page.keyboard.press('ArrowLeft'); await sleep(300);
  await page.waitForFunction(() => { const i = document.getElementById('pvImage'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  await page.keyboard.press('+'); await sleep(200);
  check('zoom in', await page.evaluate(() => window.__tw.pages.viewer.zoom > 1));
  await shot('06-viewer-zoomed.png');
  await page.keyboard.press('0'); await sleep(100);

  // Save: page 1 and everything.
  const save = async (btn, name) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(btn)]);
    const file = join(outDir, name);
    await dl.saveAs(file);
    return { file, suggested: dl.suggestedFilename() };
  };
  const one = await save('#pvSave', 'page.pdf');
  check('save page downloads', one.suggested === 'typewriter-page-1.pdf', one.suggested);
  await page.waitForFunction(() => !window.__tw.pages.viewer.saving);
  const all = await save('#pvSaveAll', 'all.pdf');
  check('save all downloads', all.suggested === 'typewriter-pages.pdf', all.suggested);

  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc closes', await page.evaluate(() => !window.__tw.pages.viewer.isOpen && document.getElementById('pagesViewer').hidden));
  await page.keyboard.press('z');
  await sleep(300);
  check('keys go to the shell again after closing', (await page.evaluate(() => window.__sent.length)) === 1, await page.evaluate(() => window.__sent.length));
  await page.evaluate(() => {
    const t = window.__tw.terminal;
    window.removeEventListener('keydown', t.onKeyDown, true);
    t.bridge.send = window.__origSend;
    delete t.bridge.open;
  });

  // Typing and orbit afterward.
  const s1 = await page.evaluate(() => window.__strikes);
  await typeText('ok');
  check('typing works after closing', (await page.evaluate(() => window.__strikes)) > s1);
  const th0 = await page.evaluate(() => window.__tw.orbit.theta);
  await page.mouse.move(1450, 160);
  await page.mouse.down(); await page.mouse.move(1380, 170, { steps: 6 }); await page.mouse.up();
  await sleep(200);
  check('orbit works after closing', Math.abs((await page.evaluate(() => window.__tw.orbit.theta)) - th0) > 0.02);

  // Reopen by the button, and the close button.
  await page.evaluate(() => window.__tw.orbit.reset());
  await sleep(300);
  const at2 = await pileScreen();
  await page.mouse.move(at2.x, at2.y); await sleep(200);
  await page.mouse.down(); await page.mouse.up();
  await sleep(300);
  check('viewer reopens', await page.evaluate(() => window.__tw.pages.viewer.isOpen));
  await page.click('#pvClose');
  await sleep(200);
  check('close button closes', await page.evaluate(() => !window.__tw.pages.viewer.isOpen));

  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  check('run completed', false, String(e?.stack ?? e));
  await shot('error.png').catch(() => {});
} finally {
  report.ok = report.checks.every((c) => c.ok);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', report.ok ? 'all checks passed' : 'some checks FAILED');
  await browser.close();
  vite.kill();
}
process.exit(report.ok ? 0 : 1);
