// Terminal mode end to end, with a real PTY bridge on a random loopback port and only benign commands.
// Run ONLY through tests/e2e/xrun.sh (private Xvfb):  tests/e2e/xrun.sh node tests/e2e/terminal.mjs [outdir]
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.argv[2] ?? join(process.env.E2E_OUT ?? join(tmpdir(), 'typewriter-e2e'), 'terminal');
mkdirSync(outDir, { recursive: true });
const report = { checks: [], measures: {} };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page: a private production build, so other agents editing src/ cannot reload it mid-test.
const distDir = join(outDir, 'dist');
execFileSync(join(root, 'node_modules/.bin/vite'), ['build', '--outDir', distDir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
const port = 5400 + Math.floor(Math.random() * 400);
const vite = spawn(join(root, 'node_modules/.bin/vite'), ['preview', '--outDir', distDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite did not start')), 20000); vite.stdout.on('data', (d) => { if (/127\.0\.0\.1/.test(String(d))) { clearTimeout(t); res(); } }); vite.on('exit', (c) => rej(new Error('vite exit ' + c))); });

// The bridge, on a random port.
const pageOrigin = `http://127.0.0.1:${port}`;
const server = spawn('python3', [join(root, 'tools/term-server.py'), '--port', '0', '--page-origin', pageOrigin, '--plain-shell'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stderr.on('data', (d) => { serverLog += d; });
let out = '';
const url = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('bridge did not print a URL: ' + out + serverLog)), 10000);
  server.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/\S+terminal=\S+/); if (m) { clearTimeout(t); res(m[0]); } });
  server.on('exit', (c) => rej(new Error('bridge exited ' + c + ' ' + serverLog)));
});
const u = new URL(url);
const token = u.searchParams.get('terminal'), termport = Number(u.searchParams.get('termport'));
check('bridge prints a token URL', token.length >= 40 && termport > 0, url.replace(token, '<token>'));

const finish = async () => {
  try { server.kill('SIGTERM'); } catch { /* gone */ }
  await sleep(600);
  let portOpen = await canConnect('127.0.0.1', termport);
  check('server stopped: port closed', !portOpen);
  try { vite.kill(); } catch { /* gone */ }
  report.ok = report.checks.every((c) => c.ok);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', report.ok ? 'all checks passed' : 'some checks FAILED');
};

function canConnect(host, p) {
  return new Promise((res) => {
    const s = net.connect({ host, port: p, timeout: 1500 });
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    s.on('timeout', () => { s.destroy(); res(false); });
  });
}

/** Sends one raw upgrade request and returns the status line. */
function handshake({ token: t, origin = pageOrigin, host = `127.0.0.1:${termport}`, noOrigin = false, holdMs = 0 }) {
  return new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port: termport });
    let buf = '';
    s.on('connect', () => {
      s.write(`GET /tty?token=${encodeURIComponent(t)}&cols=75 HTTP/1.1\r\nHost: ${host}\r\n${noOrigin ? '' : `Origin: ${origin}\r\n`}Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    });
    s.on('data', (d) => {
      buf += d;
      if (buf.includes('\r\n')) { const status = buf.split('\r\n')[0]; if (holdMs) setTimeout(() => { s.destroy(); res(status); }, holdMs); else { s.destroy(); res(status); } }
    });
    s.on('error', (e) => res('error ' + e.code));
    s.on('close', () => res(buf.split('\r\n')[0] || 'closed'));
  });
}

// ---- security checks, before any page connects ----------------------------------------------
const listening = readFileSync('/proc/net/tcp', 'utf8').split('\n').slice(1).filter((l) => l.trim());
const portHex = termport.toString(16).toUpperCase().padStart(4, '0');
const ours = listening.filter((l) => l.trim().split(/\s+/)[1].endsWith(':' + portHex) && l.trim().split(/\s+/)[3] === '0A');
check('listens only on 127.0.0.1', ours.length === 1 && ours[0].trim().split(/\s+/)[1].startsWith('0100007F:'), ours.map((l) => l.trim().split(/\s+/)[1]).join(','));
for (const list of Object.values(networkInterfaces())) {
  for (const iface of list) {
    if (iface.internal || iface.family !== 'IPv4') continue;
    check(`no connection through ${iface.address}`, !(await canConnect(iface.address, termport)));
  }
}
check('no token refused', (await handshake({ token: '' })).includes('403'));
check('wrong token refused', (await handshake({ token: 'not-the-token-' + 'x'.repeat(30) })).includes('403'));
check('wrong origin refused', (await handshake({ token, origin: 'http://evil.example' })).includes('403'));
check('missing origin refused', (await handshake({ token, noOrigin: true })).includes('403'));
check('wrong host header refused', (await handshake({ token, host: 'evil.example:80' })).includes('403'));
check('correct token and origin accepted', (await handshake({ token, holdMs: 200 })).includes('101'));
await sleep(300);

// ---- the browser --------------------------------------------------------------------------
const exe = join(homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome');
if (!existsSync(exe)) throw new Error('chromium not found at ' + exe);
const browser = await chromium.launch({ executablePath: exe, headless: false, args: ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--window-size=1600,1000', '--window-position=0,0'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

const shot = async (name) => { const p = join(outDir, name + '.png'); await page.screenshot({ path: p }); console.log('shot', p); };
const waitIdle = () => page.waitForFunction(() => { const d = window.__tw.terminal.driver; return d.idle && d.queued === 0 && performance.now() - window.__tl.lastBytes > 900; }, null, { timeout: 240000, polling: 200 });
const pressRun = async (cmd) => { await page.keyboard.type(cmd, { delay: 25 }); await page.keyboard.press('Enter'); await sleep(400); await waitIdle(); };
const strikes = () => page.evaluate(() => window.__tl.strikes.map((s) => s.ch).join(''));
const stats = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__tw.terminal.driver.stats)));

async function inkPng(name) {
  const data = await page.evaluate(() => {
    const t = window.__tw.soft.inkTexture, W = t.width, H = t.height, d = t.data;
    const ch = d.length / (W * H);
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(x + y * W) * ch] > 20) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (minX > maxX) return null;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx2 = c.getContext('2d'), im = ctx2.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 255 - d[(x + minX + (y + minY) * W) * ch]; const k = (x + y * w) * 4; im.data[k] = v; im.data[k + 1] = v; im.data[k + 2] = v; im.data[k + 3] = 255; }
    ctx2.putImageData(im, 0, 0);
    return { url: c.toDataURL('image/png'), w, h, minY, maxY };
  });
  if (!data) return null;
  const p = join(outDir, name + '.png');
  writeFileSync(p, Buffer.from(data.url.split(',')[1], 'base64'));
  console.log('ink', p, data.w, data.h);
  return data;
}

let failure = null;
try {
  await page.goto(`${pageOrigin}/?terminal=${encodeURIComponent(token)}&termport=${termport}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__tw && window.__tw.terminal, null, { timeout: 60000 });
  await page.evaluate(() => {
    const t = window.__tw.terminal;
    const L = (window.__tl = { ops: [], strikes: [], bells: 0, bs: 0, lastBytes: performance.now(), bytes: 0, t0: performance.now() });
    const enq = t.driver.enqueue.bind(t.driver);
    t.driver.enqueue = (ops) => { for (const o of ops) { if (o.t === 'char' && o.ch !== ' ') L.ops.push(o.ch); if (o.t === 'bs') L.bs++; } enq(ops); };
    const ob = t.onBytes.bind(t);
    t.onBytes = (b) => { L.lastBytes = performance.now(); L.bytes += b.length; ob(b); };
    window.__tw.sim.on('strike', (e) => {
      const k = window.__tw.geometry.keys[e.bar];
      L.strikes.push({ ch: e.char ?? (e.caseIndex ? k.upper : k.lower), wall: performance.now(), sim: e.tBegin, cx: e.carriageX, psi: e.platenPsi, char: e.char });
    });
    window.__tw.sim.on('event', (e) => { if (e.type === 'bell') L.bells++; });
  });
  await page.waitForFunction(() => window.__tw.terminal.bridge.open, null, { timeout: 40000 });
  check('page connected to the bridge', true);
  check('a second session is refused while one runs', (await handshake({ token })).includes('409'));
  await waitIdle();
  const v0 = await page.evaluate(() => window.__tw.soft.readouts().printV);
  check('first line near the 25 mm top margin', v0 !== null && Math.abs(v0 - 0.025) < 0.005, `printV=${v0}`);
  // The shell's prompt has already printed by now, so check where its first character was struck.
  const after0 = await page.evaluate(() => [window.__tl.strikes[0]?.cx ?? NaN, window.__tw.sim.state[window.__tw.sim.layout.marginL], window.__tw.terminal.cols]);
  check('carriage at left margin on entry', Math.abs(after0[0] - after0[1]) < 0.0015, after0.join(' '));
  report.measures.cols = after0[2];

  // Canonical full ASCII through the shell.
  await pressRun("for i in $(seq 33 126); do printf \"\\\\$(printf %o $i)\"; done; echo");
  const ascii = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join('');
  check('every printable ASCII character struck in order', (await strikes()).includes(ascii));
  await inkPng('ink-ascii');

  await pressRun('echo hello teletype');
  await pressRun('pwd');
  await pressRun("printf '\\033[1;31mred\\033[0m \\033]0;title\\007plain\\n'");
  check('colours and titles stripped from the print', (await strikes()).includes('redplain'), (await strikes()).slice(-40));
  const bellsBefore = await page.evaluate(() => window.__tl.bells);
  await pressRun("printf '\\a'");
  await sleep(600);
  const bellsAfter = await page.evaluate(() => window.__tl.bells);
  check('BEL rang the bell', bellsAfter > bellsBefore, `${bellsBefore}->${bellsAfter}`);
  await pressRun("printf 'ab\\bX\\tq\\n'");
  await pressRun("printf '\\033[?1049h'");
  check('full-screen attempt reported in the UI', /full-screen/.test(await page.evaluate(() => document.getElementById('termMsg').textContent)));
  await shot('terminal-overview');

  // Character pace (real time and sim time) on an uninterrupted line.
  // Timed on the shell's output line only, from its first strike to its last, counting spaces as the keystrokes they are.
  const lineRate = async (phrase) => page.evaluate((p) => {
    const s = window.__tl.strikes, flat = s.map((x) => x.ch).join(''), bare = p.replace(/ /g, '');
    const i = flat.lastIndexOf(bare);
    if (i < 0) return null;
    const a = s[i], b = s[i + bare.length - 1], keys = p.length - 1;
    return { keystrokes: keys, wallS: (b.wall - a.wall) / 1000, simS: b.sim - a.sim, perSecWall: keys / ((b.wall - a.wall) / 1000), perSecSim: keys / (b.sim - a.sim) };
  }, phrase);
  const phrase = 'pack my box with five dozen liquor jugs then pack them all again ok';
  await pressRun(`printf '%s\\n' '${phrase}'`);
  const stdRate = await lineRate(phrase);
  report.measures.standard = stdRate;
  check('standard pace is in a plausible range', stdRate && stdRate.perSecWall > 4 && stdRate.perSecWall < 20, JSON.stringify(stdRate));
  const spacing = await page.evaluate(() => {
    const s = window.__tl.strikes, pitch = window.__tw.machine.escapement.pitch;
    let same = 0;
    for (let i = 1; i < s.length; i++) if (Math.abs(s[i].psi - s[i - 1].psi) < 0.05 && Math.abs(s[i].cx - s[i - 1].cx) < 0.5 * pitch) same++;
    return { same, bs: window.__tl.bs };
  });
  check('no strike lands on the previous one except after a backspace', spacing.same <= spacing.bs, JSON.stringify(spacing));
  report.measures.statsStandard = await stats();

  await page.locator('#termSpeed').click();
  const fastPhrase = 'fast mode line through the mechanism with nothing dropped at all today';
  await pressRun(`printf '%s\\n' '${fastPhrase}'`);
  await page.locator('#termSpeed').click();
  report.measures.fast = await lineRate(fastPhrase);
  check('fast mode printed its line intact', !!report.measures.fast, JSON.stringify(report.measures.fast));
  check('fast mode restores the unlimited setting afterwards', await page.evaluate(() => document.getElementById('termSpeed').getAttribute('aria-pressed') === 'false'));

  // Ctrl-C clears the print queue as well as reaching the shell.
  await page.keyboard.type('seq 1 400', { delay: 25 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__tw.terminal.driver.queued > 40, null, { timeout: 30000, polling: 100 });
  const beforeCtrlC = await page.evaluate(() => ({ ops: window.__tl.ops.slice(), strikes: window.__tl.strikes.map((s) => s.ch) }));
  await page.keyboard.press('Control+c');
  await sleep(300);
  check('Ctrl-C emptied the print queue', await page.evaluate(() => window.__tw.terminal.driver.queued < 8));
  await waitIdle();

  // Every character queued and every strike agree, in order, across the whole session.
  // Everything struck before the Ctrl-C is exactly the head of what was queued; after it the queue is deliberately dropped.
  check('strikes equal the queued characters, in order, up to Ctrl-C', beforeCtrlC.strikes.join('') === beforeCtrlC.ops.join('').slice(0, beforeCtrlC.strikes.length), `${beforeCtrlC.strikes.length} strikes, ${beforeCtrlC.ops.length} ops`);

  // Page break: run a sheet out, and confirm a fresh sheet is loaded and printing continues.
  const before = await stats();
  await page.keyboard.type('seq 1 58', { delay: 25 });
  await page.keyboard.press('Enter');
  await sleep(500);
  await waitIdle();
  const after = await stats();
  report.measures.statsFinal = after;
  check('a new sheet was fetched automatically', after.sheets > before.sheets, `${before.sheets}->${after.sheets}`);
  check('exactly one line per newline (no mis-indexed line spaces)', after.lineErrors === 0, `lineErrors=${after.lineErrors}, ${after.newlines} newlines`);
  check('no characters lost', after.lost === 0 && after.mismatches === 0, JSON.stringify({ lost: after.lost, mismatches: after.mismatches, jams: after.jams, retries: after.retries }));
  check('no jams during the session', after.jams === 0, `${after.jams}`);
  const lv = await page.evaluate(() => window.__tw.soft.readouts().printV);
  check('printing resumed on the new sheet', lv !== null && lv < 0.2, `printV=${lv}`);
  await inkPng('ink-sheet2');

  await page.evaluate(() => { const g = window.__tw.geometry; const { orbit } = window.__tw; orbit.target.set(g.printPoint[0], g.printPoint[1] + 0.012, g.printPoint[2]); orbit.radius = 0.2; orbit.theta = 0; orbit.phi = 0.88; orbit.apply(); });
  await sleep(600);
  await shot('terminal-closeup');

  await page.locator('#termExit').click();
  await sleep(300);
  check('exit leaves terminal mode and frees the session', (await handshake({ token, holdMs: 100 })).includes('101'));
} catch (e) {
  failure = e;
  console.error(e);
  check('e2e script completed', false, String(e.message).slice(0, 400));
}
console.log('page errors:', logs.filter((l) => /pageerror|error/i.test(l)).slice(0, 20));
report.measures.pageLogs = logs.filter((l) => /terminal|pageerror/i.test(l)).slice(0, 20);
try { await shot('terminal-final'); } catch { /* browser gone */ }
await browser.close();
await finish();
report.serverLog = serverLog.slice(0, 2000);
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
