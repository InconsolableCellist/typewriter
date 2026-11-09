// Screenshot harness. Run only through tests/e2e/xrun.sh (private Xvfb). Usage:
//   tests/e2e/xrun.sh node tests/e2e/smoke.mjs [outdir] [?query]
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.argv[2] ?? join(process.env.E2E_OUT ?? join(tmpdir(), 'typewriter-e2e'));
const query = process.argv[3] ?? '';
mkdirSync(outDir, { recursive: true });

const port = 5400 + Math.floor(Math.random() * 200);
const exe = join(homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome');
if (!existsSync(exe)) throw new Error('chromium not found at ' + exe);

// E2E_DIST=dir serves a production build: `vite dev` reloads the page whenever other agents touch src/.
const dist = process.env.E2E_DIST;
const viteArgs = dist ? ['preview', '--outDir', dist, '--host', '127.0.0.1', '--port', String(port), '--strictPort'] : ['--host', '127.0.0.1', '--port', String(port), '--strictPort'];
const vite = spawn(join(root, 'node_modules/.bin/vite'), viteArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let viteErr = '';
vite.stderr.on('data', (d) => { viteErr += d; });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite did not start: ' + viteErr)), 20000);
  vite.stdout.on('data', (d) => { if (/Local|localhost|127\.0\.0\.1/.test(String(d))) { clearTimeout(t); res(); } });
  vite.on('exit', (c) => rej(new Error('vite exit ' + c + ' ' + viteErr)));
});

const browser = await chromium.launch({
  executablePath: exe,
  headless: false,
  args: ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--window-size=1600,1000', '--window-position=0,0'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

const shot = async (name) => { const p = join(outDir, name + '.png'); await page.screenshot({ path: p }); console.log('shot', p); };

async function frameStats(label) {
  return page.evaluate((l) => {
    const f = window.__frameTimes; if (!f) return `${l}: no frames`;
    const n = Math.min(window.__frameCount, f.length);
    const arr = [...f.slice(0, n)].sort((a, b) => a - b);
    const soft = window.__tw?.soft?.stats?.avgMs;
    const g = window.__gpu;
    let gpu = '';
    if (g && g.n) { const m = Math.min(g.n, g.recent.length); const a = [...g.recent.slice(0, m)].sort((x, y) => x - y); gpu = ` gpu mean=${(a.reduce((x, y) => x + y, 0) / m).toFixed(2)}ms p95=${a[Math.floor(m * 0.95)].toFixed(2)}ms`; }
    return `${l}: n=${n} cpu-frame mean=${(arr.reduce((a, b) => a + b, 0) / n).toFixed(2)}ms p95=${arr[Math.floor(n * 0.95)].toFixed(2)}ms max=${arr[n - 1].toFixed(2)}ms soft=${soft?.toFixed(2) ?? '-'}ms${gpu}`;
  }, label);
}

await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype, up = P.useProgram;
  const seen = new Set();
  P.useProgram = function (prog) {
    if (prog && !this.getProgramParameter(prog, this.LINK_STATUS) && !seen.has(prog)) {
      seen.add(prog);
      const shaders = this.getAttachedShaders(prog) || [];
      console.error('LINK FAIL: ' + (this.getProgramInfoLog(prog) || '').slice(0, 2000));
      for (const sh of shaders) {
        const log = this.getShaderInfoLog(sh);
        if (log) console.error('SHADER LOG: ' + log.slice(0, 1500));
      }
    }
    return up.call(this, prog);
  };
});
try {
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__frameCount > 30, null, { timeout: 60000 });
  await page.waitForTimeout(3500);
  console.log(await frameStats('idle'));
  const renderer = await page.evaluate(() => {
    const gl = window.__tw.stage.renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('webgl renderer', renderer);
  await shot('01-hero');

  const dof = (name, i = 0) => page.evaluate(([n, i]) => { const { sim } = window.__tw; return sim.state[sim.layout[n] + i]; }, [name, i]);
  // Type a word.
  await page.evaluate(() => { window.__strikes = []; window.__tw.sim.on('strike', (e) => { const l = window.__tw.soft.printer?.lastStrike; window.__strikes.push({ bar: e.bar, up: e.caseIndex, v: +(e.vImpact ?? e.v ?? 0).toFixed(2), peak: e.peakForce, indent: e.maxIndent, covered: l?.covered, pressed: l?.pressed, inked: l?.inked, keys: Object.keys(e).join() }); }); });
  await page.mouse.click(800, 500); // focus
  await page.keyboard.press('Escape');
  for (const ch of 'Quick brown fox') {
    const upper = ch !== ch.toLowerCase();
    if (upper) { await page.keyboard.down('Shift'); await page.waitForTimeout(200); }
    await page.keyboard.press(ch, { delay: 95 });
    await page.waitForTimeout(130);
    if (upper) { await page.keyboard.up('Shift'); await page.waitForTimeout(90); }
  }
  await page.waitForTimeout(350);
  console.log(await frameStats('typing'));
  await shot('02-typed');
  const ppos = await page.evaluate(() => { const g = window.__tw.geometry; const { orbit } = window.__tw; orbit.target.set(g.printPoint[0], g.printPoint[1] + 0.012, g.printPoint[2]); orbit.radius = 0.2; orbit.theta = 0; orbit.phi = 0.88; orbit.apply(); return 1; });
  void ppos; await page.waitForTimeout(100);
  console.log('strikes', JSON.stringify(await page.evaluate(() => window.__strikes)));
  // Dump the printed line straight from the ink texture, independent of the shading and the camera.
  const inkDump = await page.evaluate(() => {
    const { soft } = window.__tw; const t = soft.inkTexture; const d = t.data; const ch = t.channels ?? (d.length / (t.width * t.height));
    let x0 = t.width, x1 = 0, y0 = t.height, y1 = 0;
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) if (d[(x + y * t.width) * ch] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) return null;
    const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
    const ctx = c.getContext('2d'); const im = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const v = 255 - d[(x + x0 + (y + y0) * t.width) * ch]; const o = (x + y * c.width) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255; }
    ctx.putImageData(im, 0, 0);
    return { url: c.toDataURL('image/png'), box: [x0, y0, x1, y1], tex: [t.width, t.height], ch, last: soft.printer?.lastStrike ?? null };
  });
  if (inkDump) { writeFileSync(join(outDir, '09-ink-texture.png'), Buffer.from(inkDump.url.split(',')[1], 'base64')); console.log('ink box', inkDump.box, 'of', inkDump.tex, 'channels', inkDump.ch, 'last strike', JSON.stringify(inkDump.last)); }
  else console.log('ink texture empty');

  // Carriage return by hand, then a few more lines so the typed line clears the ribbon and bail.
  const crX0 = await dof('carriageX');
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(1100); }
  console.log('carriage return: x', crX0, '->', await dof('carriageX'), 'psi', await dof('platenPsi'));
  await page.evaluate(() => { const g = window.__tw.geometry; const { orbit } = window.__tw; orbit.target.set(g.printPoint[0], g.printPoint[1] + 0.03, g.printPoint[2] - 0.01); orbit.radius = 0.16; orbit.theta = 0; orbit.phi = 0.75; orbit.apply(); });
  await page.waitForTimeout(100);
  await shot('08-paper-text');
  // Aim directly at the printed line, located from the ink data, not from the print point.
  if (inkDump) {
    const textPos = await page.evaluate((box) => {
      const { soft, orbit, stage } = window.__tw; const p = soft.paper; const t = soft.inkTexture;
      const fu = (box[0] + box[2]) / 2 / t.width, fv = (box[1] + box[3]) / 2 / t.height;
      const at = (u, v) => { let best = 0, bd = 9; const n = p.uvs.length / 2; for (let i = 0; i < n; i++) { const d = (p.uvs[i * 2] - u) ** 2 + (p.uvs[i * 2 + 1] - v) ** 2; if (d < bd) { bd = d; best = i; } } return [p.positions[best * 3], p.positions[best * 3 + 1], p.positions[best * 3 + 2]]; };
      const w = at(fu, fv), wFlip = at(fu, 1 - fv);
      const v = stage.camera.position.clone().set(...w).project(stage.camera);
      const pp = window.__tw.geometry.printPoint; const out = { fu, fv, w, wFlip, printPoint: pp, screen: [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight] };
      orbit.target.set(...w); orbit.radius = 0.09; orbit.theta = 0; orbit.phi = 0.72; orbit.apply();
      return out;
    }, inkDump.box);
    console.log('text located at', JSON.stringify(textPos));
    await page.waitForTimeout(100);
    await shot('16-text-close');
  }

  // Close-up of the type basket mid strike.
  await page.evaluate(() => {
    const { orbit } = window.__tw;
    orbit.target.set(0, 0.16, -0.03); orbit.radius = 0.32; orbit.theta = 0.55; orbit.phi = 1.0; orbit.apply();
  });
  await page.keyboard.down('e');
  await page.waitForTimeout(16);
  await shot('03-basket-close');
  await page.keyboard.up('e');
  await page.waitForTimeout(200);

  // Static views used to check that all parts are in sensible positions.
  const view = async (name, tx, ty, tz, r, th, ph) => {
    await page.evaluate(([tx, ty, tz, r, th, ph]) => { const { orbit } = window.__tw; orbit.target.set(tx, ty, tz); orbit.radius = r; orbit.theta = th; orbit.phi = ph; orbit.apply(); }, [tx, ty, tz, r, th, ph]);
    await page.waitForTimeout(80);
    await shot(name);
  };
  await view('10-keys-close', 0, 0.11, 0.14, 0.26, 0.15, 0.85);
  await view('11-rear', 0, 0.14, -0.09, 0.62, 3.0, 1.1);
  await view('12-left', -0.1, 0.15, -0.03, 0.5, -1.1, 1.1);
  await view('13-print-point', 0, 0.178, -0.05, 0.13, 0.25, 1.05);

  // Project a world point to client pixels for pointer tests.
  const project = (w) => page.evaluate((w) => {
    const { stage } = window.__tw;
    const v = stage.camera.position.clone().set(w[0], w[1], w[2]).project(stage.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }, w);
  const drag = async (from, to, steps = 12, delay = 16) => {
    await page.mouse.move(from.x, from.y);
    await page.waitForTimeout(32);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await page.waitForTimeout(delay); }
    await page.mouse.up();
  };
  await page.evaluate(() => { const { orbit } = window.__tw; orbit.target.set(0, 0.11, 0.1); orbit.radius = 0.55; orbit.theta = 0.4; orbit.phi = 0.8; orbit.apply(); });
  await page.waitForTimeout(100);
  const whatIsAt = (p) => page.evaluate(({ x, y }) => {
    const hit = window.__tw.interaction.picker.pick((x / innerWidth) * 2 - 1, -((y / innerHeight) * 2 - 1));
    return hit ? { kind: hit.part.kind, index: hit.part.index, dist: hit.hit.distance } : null;
  }, p);
  // Hover highlight on a key.
  const keyG = await page.evaluate(() => { const g = window.__tw.geometry; const k = g.keys.find((k) => k.lower === 'g'); return { i: g.keys.indexOf(k), pos: k.pos }; });
  const keyP = await project(keyG.pos);
  await page.mouse.move(keyP.x, keyP.y);
  await page.waitForTimeout(120);
  await shot('14-hover-key');
  // Key drag: a slow push tracks gently, a quick flick is a hard strike.
  await drag(keyP, { x: keyP.x, y: keyP.y + 26 }, 30, 30);
  const slowT = await dof('keyX', keyG.i);
  await page.waitForTimeout(250);
  await drag(keyP, { x: keyP.x, y: keyP.y + 60 }, 3, 8);
  console.log('key drag: slow press travel', slowT, 'state after flick theta', await dof('barTheta', keyG.i));
  await page.waitForTimeout(300);

  // Carriage body drag: carriage slides.
  const cx0 = await dof('carriageX');
  await page.evaluate(() => { const { orbit } = window.__tw; orbit.target.set(0, 0.16, -0.06); orbit.radius = 0.5; orbit.theta = 0.3; orbit.phi = 1.1; orbit.apply(); });
  await page.waitForTimeout(80);
  const carP = await project(await page.evaluate(() => { const { rig, view } = window.__tw; return [view.carriage.position.x - rig.knobX + 0.012, rig.c[1] - 0.012, rig.c[2] + 0.004]; }));
  console.log('at carriage point:', JSON.stringify(await whatIsAt(carP)));
  await drag(carP, { x: carP.x + 90, y: carP.y }, 24, 16);
  await page.waitForTimeout(200);
  console.log('carriage drag', cx0, '->', await dof('carriageX'));

  // Line-space lever: swings, then carries the carriage. Frame it clear of the panel.
  await page.evaluate(() => { const { orbit, view } = window.__tw; orbit.target.set(view.carriage.position.x - 0.1, 0.2, -0.05); orbit.radius = 0.5; orbit.theta = -0.55; orbit.phi = 1.05; orbit.apply(); });
  await page.waitForTimeout(100);
  const lsP = await page.evaluate(() => { const { rig, view, stage } = window.__tw; const c = view.carriage.position; const tip = view.lsLever.localToWorld(view.lsLever.position.clone().set(0, 0, rig.ls.length)); const v = tip.clone().project(stage.camera); void c; return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; });
  await page.mouse.move(lsP.x, lsP.y); await page.waitForTimeout(60); await shot('15-hover-lever');
  console.log('at lever tip:', JSON.stringify(await whatIsAt(lsP)));
  const psiBefore = await dof('platenPsi');
  await page.mouse.move(lsP.x, lsP.y); await page.waitForTimeout(32); await page.mouse.down();
  for (let i = 1; i <= 34; i++) { await page.mouse.move(lsP.x + i * 5, lsP.y + i * 0.5); await page.waitForTimeout(16); }
  console.log('drag active:', await page.evaluate(() => !!window.__tw.interaction.drag), 'mock grab state', await page.evaluate(() => JSON.stringify([...((window.__tw.sim.grabs)?.entries?.() ?? [])])));
  console.log('ls lever during drag: lever', await dof('lsLever'), 'psi', psiBefore, '->', await dof('platenPsi'), 'carriage', await dof('carriageX'));
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Drag the right platen knob.
  await page.evaluate(() => { const { orbit } = window.__tw; orbit.target.set(0.08, 0.17, -0.06); orbit.radius = 0.5; orbit.theta = 0.9; orbit.phi = 1.05; orbit.apply(); });
  await page.waitForTimeout(100);
  const knobPt = await page.evaluate(() => {
    const { view, stage, rig } = window.__tw;
    const v = view.knobR.position.clone();
    const p = new (view.root.constructor)(); void p;
    const c = view.carriage.position;
    const w = { x: rig.knobX + 0.009 + c.x, y: rig.c[1] + c.y, z: rig.c[2] + 0.024 };
    const pv = stage.camera.position.clone().set(w.x, w.y, w.z).project(stage.camera);
    return { x: (pv.x + 1) / 2 * innerWidth, y: (1 - pv.y) / 2 * innerHeight };
  });
  await page.mouse.move(knobPt.x, knobPt.y);
  await page.waitForTimeout(40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) { await page.mouse.move(knobPt.x, knobPt.y + i * 3); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(120);
  const psi = await page.evaluate(() => window.__tw.sim.state[window.__tw.sim.layout.platenPsi]);
  console.log('platen psi after knob drag', psi);
  await shot('04-after-knob');

  // Orbit from empty space.
  await page.evaluate(() => { const { orbit } = window.__tw; orbit.target.set(0, 0.122, 0.018); orbit.radius = 0.95; orbit.theta = 0.6; orbit.phi = 1.15; orbit.apply(); });
  await page.waitForTimeout(40);
  // ---- Every remaining physical input, with the cover off so the pointer reaches the parts ----
  await page.evaluate(() => { window.__tw.enclosure.group.visible = false; });
  const setView = (t, r, th, ph) => page.evaluate(([t, r, th, ph]) => { const { orbit } = window.__tw; orbit.target.set(...t); orbit.radius = r; orbit.theta = th; orbit.phi = ph; orbit.apply(); }, [t, r, th, ph]);
  const centerOf = (name, off = [0, 0, 0]) => page.evaluate(([name, off]) => { const o = window.__tw.view[name]; o.updateWorldMatrix(true, true); const B = new o.position.constructor(); const box = new (window.__tw.THREE_Box3)().setFromObject(o); box.getCenter(B); return [B.x + off[0], B.y + off[1], B.z + off[2]]; }, [name, off]);
  await page.evaluate(() => { window.__tw.THREE_Box3 = window.__tw.view.root.parent.constructor && (class { constructor() { this.min = [Infinity, Infinity, Infinity]; this.max = [-Infinity, -Infinity, -Infinity]; }
    setFromObject(o) { o.traverse((c) => { if (!c.geometry || c.material?.visible === false || c.isInstancedMesh) return; const p = c.geometry.getAttribute('position'); const e = c.matrixWorld.elements; for (let i = 0; i < p.count; i += Math.max(1, p.count >> 6)) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const w = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; for (let k = 0; k < 3; k++) { this.min[k] = Math.min(this.min[k], w[k]); this.max[k] = Math.max(this.max[k], w[k]); } } }); return this; }
    getCenter(v) { v.set((this.min[0] + this.max[0]) / 2, (this.min[1] + this.max[1]) / 2, (this.min[2] + this.max[2]) / 2); return v; } }); });
  const exercise = async (label, world, dx, dy, read, view) => {
    if (view) { await setView(world, ...view); await page.waitForTimeout(120); }
    const p = await project(world);
    const at = await whatIsAt(p);
    const before = await read();
    await drag(p, { x: p.x + dx, y: p.y + dy }, 18, 16);
    const during = await read();
    await page.waitForTimeout(250);
    console.log(`exercise ${label}: picked ${at?.kind ?? 'nothing'} at ${Math.round(p.x)},${Math.round(p.y)}: ${before} -> during ${during} -> after ${await read()}`);
  };
  const dofS = (n, i = 0) => async () => (+(await dof(n, i))).toFixed(5);
  await exercise('margin L', await centerOf('marginL'), 50, 0, dofS('marginL'), [0.42, 0.25, 0.75]);
  await exercise('margin R', await centerOf('marginR'), -50, 0, dofS('marginR'), [0.42, 0.25, 0.75]);
  await exercise('bail', await centerOf('bailMesh', [0.07, 0, 0]), 0, -60, dofS('bail'), [0.3, 0.2, 1.0]);
  await exercise('carriage release', await centerOf('crLever'), 40, 30, dofS('carriageRelease'), [0.3, 0.7, 0.9]);
  await exercise('paper release', await centerOf('prLever'), 0, -50, dofS('paperRelease'), [0.3, 0.7, 0.9]);
  const barWorld = await page.evaluate(() => { const { view, geometry: g } = window.__tw; const i = g.nPrint >> 1; const m = new view.root.matrix.constructor(); view.barsMesh.getMatrixAt(i, m); const e = m.elements; const x = 0.055; return [e[0] * x + e[12], e[1] * x + e[13], e[2] * x + e[14]]; });
  await exercise('typebar', barWorld, 0, -70, () => page.evaluate(() => { const { sim, geometry: g } = window.__tw; let m = 0; for (let i = 0; i < g.nPrint; i++) m = Math.max(m, sim.state[sim.layout.barTheta + i]); return m.toFixed(4); }), [0.34, 0.1, 1.0]);
  await exercise('typebar other way', barWorld, 0, 70, () => page.evaluate(() => { const { sim, geometry: g } = window.__tw; let m = 0; for (let i = 0; i < g.nPrint; i++) m = Math.max(m, sim.state[sim.layout.barTheta + i]); return m.toFixed(4); }), [0.34, 0.1, 1.0]);
  const spoolW = await page.evaluate(() => { const r = window.__tw.machine.ribbon; return [r.spoolX, r.spoolY + r.spoolWidth / 2 + 0.002, r.spoolZ]; });
  const spoolRead = () => page.evaluate(() => { const s = window.__tw.soft.ribbon.spoolR; return (typeof s === 'number' ? s : s?.angle ?? 0).toFixed(4); });
  await exercise('spool R', spoolW, 45, 25, spoolRead, [0.28, 0.4, 0.75]);
  const ribW = await page.evaluate(() => { const r = window.__tw.soft.ribbon; const i = Math.floor(r.count * 0.5); return [r.positions[i * 3], r.positions[i * 3 + 1], r.positions[i * 3 + 2]]; });
  const ribRead = () => page.evaluate(() => { const r = window.__tw.soft.ribbon; const i = Math.floor(r.count * 0.5); return r.positions[i * 3 + 1].toFixed(4); });
  // A click with no movement must not grab anything.
  await setView(ribW, 0.2, 0.0, 0.8); await page.waitForTimeout(100);
  const rp = await project(ribW);
  await page.mouse.move(rp.x, rp.y); await page.mouse.down();
  await page.waitForTimeout(150);
  console.log('ribbon click-without-drag: picked', (await whatIsAt(rp))?.kind, 'grabs while held', await page.evaluate(() => window.__tw.soft._grabKinds?.size));
  await page.mouse.up();
  await exercise('ribbon', ribW, 0, -35, ribRead, null);

  // Lever carrying the carriage: move away from the margin first.
  for (let i = 0; i < 10; i++) { await page.keyboard.press(' ', { delay: 90 }); await page.waitForTimeout(130); }
  await page.waitForTimeout(200);
  const tipW = await page.evaluate(() => { const { rig, view } = window.__tw; const v = view.lsLever.position.clone().set(0, 0, rig.ls.length); return view.lsLever.localToWorld(v).toArray(); });
  await setView(tipW, 0.5, -0.55, 1.05); await page.waitForTimeout(150);
  const tip = await project(tipW);
  console.log('at lever tip for carry:', (await whatIsAt(tip))?.kind);
  const xBefore = await dof('carriageX');
  await page.mouse.move(tip.x, tip.y); await page.mouse.down();
  for (let i = 1; i <= 50; i++) { await page.mouse.move(tip.x + i * 7, tip.y + i * 1.2); await page.waitForTimeout(20); }
  await page.waitForTimeout(400);
  console.log('lever carries carriage by drag: x', xBefore, '->', await dof('carriageX'), 'lever', await dof('lsLever'), 'target margin', await dof('marginL'));
  await page.mouse.up(); await page.waitForTimeout(300);

  // Enter indexes exactly one set line space per stroke (lineSpaceSetting ratchet teeth).
  for (let i = 0; i < 4; i++) { const a = await dof('platenPsi'); await page.keyboard.press('Enter'); await page.waitForTimeout(800); console.log(`enter ${i}: dpsi ${((await dof('platenPsi') - a) * 180 / Math.PI).toFixed(2)} deg, carriage ${(await dof('carriageX')).toFixed(4)}`); }

  // Paper: a hard sideways pull on a gripped sheet.
  const sheetW = await page.evaluate(() => { const { soft } = window.__tw; const p = soft.paper; const k = (p.nx >> 1) + Math.floor(p.ny * 0.96) * p.nx; return [p.positions[k * 3], p.positions[k * 3 + 1], p.positions[k * 3 + 2]]; });
  const readSheet = async () => page.evaluate(() => { const r = window.__tw.soft.readouts(); return `skew ${r.skewDeg.toFixed(2)} lateral ${r.lateralMm.toFixed(2)}`; });
  await exercise('sheet lateral hard', sheetW, 280, 0, readSheet, [0.55, 0.15, 0.85]);

  // Key force mapping: tap, hold, drag.
  const keyPos = await page.evaluate(() => { const g = window.__tw.geometry; const k = g.keys.find((x) => x.lower === 'g'); return [k.pos[0], k.pos[1] + 0.004, k.pos[2]]; });
  await setView(keyPos, 0.45, 0.0, 0.95); await page.waitForTimeout(150);
  const keyS = await project(keyPos);
  const lastStrike = () => page.evaluate(() => { const s = window.__strikes?.at(-1); return s ? `count ${window.__strikes.length}: v ${window.__strikes.slice(-3).map((x) => x.v).join(',')}` : 'none'; });
  console.log('at key:', (await whatIsAt(keyS))?.kind, await lastStrike());
  await page.mouse.move(keyS.x, keyS.y); await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up(); await page.waitForTimeout(400);
  console.log('key click 90 ms:', await lastStrike());
  await page.mouse.move(keyS.x, keyS.y); await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up(); await page.waitForTimeout(400);
  console.log('key hold 450 ms:', await lastStrike());
  await page.mouse.move(keyS.x, keyS.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(keyS.x, keyS.y + i * 11); await page.waitForTimeout(16); }
  await page.waitForTimeout(40); await shot('18-key-force-tip'); await page.mouse.up(); await page.waitForTimeout(400);
  console.log('key drag 110 px in 160 ms:', await lastStrike());

  // Sliders and slow time.
  const setSlider = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById('p-' + id); el.value = v; el.dispatchEvent(new Event('input')); return el.value; }, [id, v]);
  const strikeAt = async () => { const b = await page.evaluate(() => window.__strikes.length); await page.keyboard.down('g'); await page.waitForTimeout(130); await page.keyboard.up('g'); await page.waitForTimeout(350); return page.evaluate((b) => { const a = window.__strikes.slice(b); const s = a.reduce((m, x) => (x.peak > (m?.peak ?? 0) ? x : m), null); return `${a.length} strikes, peak ${s?.peak?.toFixed(1)} N, v ${s?.v}, indent ${(s?.indent * 1e6)?.toFixed(1)} um`; }, b); };
  console.log('slider baseline strike:', await strikeAt());
  await setSlider('hardness', 2.5); console.log('slider hardness 2.5:', await strikeAt()); await setSlider('hardness', 1);
  await setSlider('force', 40); console.log('slider force 40:', await strikeAt()); await setSlider('force', 34);
  await setSlider('wear', 0.2); console.log('slider wear 0.2 mm:', await strikeAt()); await setSlider('wear', 0);
  await setSlider('ribink', 0.1); console.log('slider ribbon ink 0.1:', await strikeAt(), await page.evaluate(() => window.__tw.soft.printer?.lastStrike?.meanInk)); await setSlider('ribink', 0.8);
  const ms0 = await dof('mainspringN'); await setSlider('spring', 9); await page.waitForTimeout(300); console.log('slider mainspring 9: tension', ms0, '->', await dof('mainspringN')); await setSlider('spring', 4.6);
  await setSlider('cmass', 3.5); console.log('slider carriage mass 3.5:', await strikeAt()); await setSlider('cmass', 2.05);
  const rate = async () => { const a = await dof('time'); const t0 = Date.now(); await page.waitForTimeout(500); return ((await dof('time') - a) / ((Date.now() - t0) / 1000)).toFixed(4); };
  console.log('time rate at 1:', await rate());
  await setSlider('time', -2); console.log('time rate at 1/100:', await rate());
  await setView([0, 0.17, 0.0], 0.45, 0.3, 1.0); await page.waitForTimeout(100);
  await page.keyboard.down('g');
  let shotSlow = false;
  for (let i = 0; i < 400 && !shotSlow; i++) {
    const f = await page.evaluate(() => { const { sim, geometry: g } = window.__tw; let m = 0; for (let i = 0; i < g.nPrint; i++) m = Math.max(m, sim.state[sim.layout.barTheta + i] / g.bars[i].thetaTravel); return m; });
    if (f > 0.93) { await shot('19-slow-strike'); shotSlow = true; }
    await page.waitForTimeout(40);
  }
  console.log('slow strike captured:', shotSlow);
  await page.keyboard.up('g');
  await setSlider('time', 0); await page.waitForTimeout(400);
  console.log('time rate restored:', await rate());
  await page.evaluate(() => window.__tw.enclosure.sync());

  await page.mouse.move(1450, 150);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) { await page.mouse.move(1450 - i * 12, 150 + i * 2); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(600);
  console.log(await frameStats('orbit'));
  await shot('05-orbited');

} finally {
  console.log('--- console (deduplicated) ---');
  const counts = new Map();
  for (const l of logs) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const [l, c] of counts) console.log(c > 1 ? `(${c}x) ${l.slice(0, 3000)}` : l.slice(0, 3000));
  await browser.close().catch(() => {});
  vite.kill('SIGTERM');
}
