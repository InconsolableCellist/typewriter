// One worklet bundle per machine family (docs/perf-review.md 26): each entry carries only its own family's mechanism
// and engine, and the typewriters' entry runs a machine on the audio thread as the word processor's does
// (tests/wp_worklet.test.js), with no structuredClone, setTimeout or DOM in its scope.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { loadGlyphsNode } from '../src/sim/harness.js';

const root = fileURLToPath(new URL('..', import.meta.url));

async function inputsOf(entry) {
  const r = await build({ entryPoints: [root + entry], bundle: true, write: false, metafile: true, format: 'esm', logLevel: 'silent' });
  return Object.keys(r.metafile.inputs);
}

test('each family\'s worklet entry bundles only its own mechanism and engine', async () => {
  const tw = await inputsOf('src/audio/worklet-typewriter.js');
  const wp = await inputsOf('src/audio/worklet-wordproc.js');
  assert.ok(tw.includes('src/sim/mechanics.js') && tw.includes('src/audio/engine.js'));
  assert.ok(!tw.some((f) => f.startsWith('src/sim/wp/') || /src\/audio\/wp-/.test(f)), `typewriter worklet carries the word processor: ${tw.filter((f) => f.includes('wp'))}`);
  assert.ok(wp.includes('src/sim/wp/index.js') && wp.includes('src/audio/wp-engine.js'));
  assert.ok(!wp.includes('src/sim/mechanics.js') && !wp.includes('src/audio/engine.js') && !wp.includes('src/sim/actions.js'), 'word processor worklet carries the typewriters');
});

test('the typewriter worklet types without structuredClone or setTimeout', async () => {
  const msgs = [];
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => msgs.push(m), onmessage: null }; } };
  let Proc; globalThis.registerProcessor = (n, c) => { assert.equal(n, 'typewriter-sim'); Proc = c; };
  await import('../src/audio/worklet-typewriter.js');
  const geometry = deriveGeometry(machine), g = await loadGlyphsNode();
  const glyphs = { N: g.N, texelMm: g.texelMm, chars: g.chars, data: g.data };
  const saved = { structuredClone: globalThis.structuredClone, setTimeout: globalThis.setTimeout };
  delete globalThis.structuredClone; delete globalThis.setTimeout;
  try {
    const p = new Proc({ processorOptions: { machine, geometry, glyphs, state: null } });
    assert.equal(msgs.shift()?.t, 'ready');
    const k = geometry.keys.findIndex((x) => x.kind === 'print' && x.lower === 'e');
    p.port.onmessage({ data: { c: 'pressKey', k, f: 28, d: 0.09 } });
    const out = [new Float32Array(128), new Float32Array(128)];
    let strikes = 0, peak = 0;
    for (let b = 0; b < (48000 / 128) * 0.5; b++) {
      p.process([], [out]);
      for (const v of out[1]) peak = Math.max(peak, Math.abs(v));
      for (const m of msgs.splice(0)) for (const e of m.ev ?? []) if (e.type === 'strike') strikes++;
    }
    assert.equal(strikes, 1, 'the key strikes once');
    assert.ok(peak > 0.05, `it sounds on both channels: ${peak}`);
  } finally {
    globalThis.structuredClone = saved.structuredClone; globalThis.setTimeout = saved.setTimeout;
  }
});
