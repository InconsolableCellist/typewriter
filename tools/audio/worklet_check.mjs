// Runs the app in real Chromium under the private Xvfb (tests/e2e/xrun.sh, never the user's display), unlocks
// audio, types and reports the AudioWorklet's own DSP load and the output level from an AnalyserNode.
// Usage: [HOLD_MS=110] tests/e2e/xrun.sh node tools/audio/worklet_check.mjs
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const port = 5620 + Math.floor(Math.random() * 200);
const exe = join(homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome');
if (!existsSync(exe)) throw new Error('chromium not found ' + exe);
const vite = spawn(join(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite timeout')), 30000); vite.stdout.on('data', (d) => { if (/Local|127\.0\.0\.1/.test(String(d))) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ executablePath: exe, headless: false, args: ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--window-size=1600,1000'] });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__frameCount > 10, null, { timeout: 60000 });
  await page.mouse.click(800, 500);
  await page.waitForFunction(() => window.__tw.sim.host?.node !== undefined || window.__tw.sim.host?.constructor?.name?.includes('Worklet'), null, { timeout: 15000 }).catch(() => {});
  const startInfo = await page.evaluate(() => {
    const s = window.__tw.sim; const h = s.host; const out = { hostClass: h?.constructor?.name };
    if (h?.node) {
      const ctx = h.node.context; out.sampleRate = ctx.sampleRate; out.state = ctx.state; out.base = ctx.baseLatency;
      const an = ctx.createAnalyser(); an.fftSize = 2048; h.node.connect(an); window.__an = an;
      window.__peak = 0; window.__buf = new Float32Array(an.fftSize);
      window.__iv = setInterval(() => { an.getFloatTimeDomainData(window.__buf); for (const v of window.__buf) { const a = Math.abs(v); if (a > window.__peak) window.__peak = a; } }, 20);
    }
    return out;
  });
  console.log('host', JSON.stringify(startInfo));
  const status = () => page.evaluate(() => new Promise((res) => {
    const { node } = window.__tw.sim.host;
    const h = (e) => { if (e.data?.samplesStatus) { node.port.removeEventListener('message', h); res(e.data.samplesStatus); } };
    node.port.addEventListener('message', h); node.port.start?.(); node.port.postMessage({ c: 'samplesStatus' });
  }));
  for (const w of [50, 500, 1000, 1500]) { await page.waitForTimeout(w); console.log('t+', w, JSON.stringify(await status())); }
  await page.keyboard.press('Escape');
  const loadSamples = [];
  await page.evaluate(() => { window.__strikes = []; window.__tw.sim.on('strike', (e) => window.__strikes.push(Math.round(e.peakForce))); });
  for (const ch of 'the quick brown fox jumps over the lazy dog') {
    await page.keyboard.press(ch === ' ' ? 'Space' : ch, { delay: Number(process.env.HOLD_MS ?? 110) });
    await page.waitForTimeout(90);
    loadSamples.push(await page.evaluate(() => { const { sim } = window.__tw; return [sim.state[sim.layout.dspLoad], sim.state[sim.layout.rms]]; }));
  }
  await page.waitForTimeout(500);
  const res = await page.evaluate(() => ({ peak: window.__peak }));
  const loads = loadSamples.map((s) => s[0]).filter((v) => v > 0).sort((a, b) => a - b);
  const rmsMax = Math.max(...loadSamples.map((s) => s[1]));
  const med = loads[Math.floor(loads.length / 2)] ?? -1;
  const blockMs = 128 / (startInfo.sampleRate ?? 48000) * 1000;
  console.log(JSON.stringify({ dspLoad: { median: +med.toFixed(4), max: +(loads.at(-1) ?? -1).toFixed(4), percentOfBlock: +(med * 100).toFixed(1), blockMs: +blockMs.toFixed(3) }, rmsMax: +rmsMax.toFixed(4), analyserPeak: +res.peak.toFixed(4), analyserPeakDbfs: +(20 * Math.log10(res.peak + 1e-9)).toFixed(2) }));
  // Recorded samples: did they reach the worklet, in time, and do real events trigger them?
  console.log('strike peak forces (N)', JSON.stringify(await page.evaluate(() => window.__strikes)));
  console.log('after typing', JSON.stringify(await status()));
  const idle0 = await page.evaluate(() => window.__tw.sim.paperSpeed);
  await page.waitForTimeout(1500);
  console.log('paper speed reported at idle', idle0, await page.evaluate(() => window.__tw.sim.paperSpeed));
  await page.evaluate(() => { window.__peak = 0; });
  await page.waitForTimeout(800);
  console.log('peak while idle', await page.evaluate(() => window.__peak));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  console.log('after Enter', JSON.stringify(await status()), 'peak', await page.evaluate(() => window.__peak));
  const decoded = await page.evaluate(async () => {
    const ctx = window.__tw.sim.host.node.context;
    const m = await (await fetch('/assets/audio/samples/manifest.json')).json();
    const a = await ctx.decodeAudioData(await (await fetch('/assets/audio/samples/' + m.sprite)).arrayBuffer());
    const x = a.getChannelData(0); let first = -1;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.3) { first = i; break; }
    return { sr: a.sampleRate, len: x.length, firstAbove03: first };
  });
  console.log('browser decode', JSON.stringify(decoded));
  console.log('page errors:', logs.length ? logs.join('\n') : 'none');
} finally {
  await browser.close();
  vite.kill();
}
