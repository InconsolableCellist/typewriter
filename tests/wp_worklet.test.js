// The word processor's mechanism runs on the audio thread once the page hands it over. An AudioWorkletGlobalScope has
// no structuredClone, setTimeout or DOM; this runs the real processor (src/audio/worklet-wordproc.js) with those taken away, after
// a warm start's state is handed over as the page does it, and checks a disk read completes and the machine hums.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MACHINES, geometryFor } from '../src/machine/index.js';
import { createMechanism } from '../src/sim/host-factory.js';

test('the worklet takes over a warm-started machine: no structuredClone there, a disk read completes, it hums', async () => {
  const msgs = [];
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => msgs.push(m), onmessage: null }; } };
  let Proc; globalThis.registerProcessor = (n, c) => { Proc = c; };
  await import('../src/audio/worklet-wordproc.js');
  const machine = MACHINES.wordproc1980, geometry = await geometryFor(machine);
  const local = createMechanism({ machine, geometry, cold: false, drives: [{ mediaId: 'CMBDSK', type: '2D' }, { mediaId: 'WORK01', type: '2D' }] });
  for (let i = 0; i < Math.round(1 / local.h); i++) local.step();
  const opts = structuredClone({ machine, geometry, glyphs: null, state: local.exportState() });
  const saved = { structuredClone: globalThis.structuredClone, setTimeout: globalThis.setTimeout };
  delete globalThis.structuredClone;
  let p;
  try {
    p = new Proc({ processorOptions: opts });
    assert.deepEqual(p.sim.diskStatus(0), { ready: true, type: '2D', mediaId: 'CMBDSK' });
    p.port.onmessage({ data: { c: 'dev', msg: { dev: 'disk', op: 'transfer', drive: 0, track: 14, side: 1, sector: 22, count: 5, write: false, id: 1 } } });
    const out = [new Float32Array(128), new Float32Array(128)];
    let done = null, ss = 0, n = 0;
    for (let b = 0; b < (48000 / 128) * 3 && !done; b++) {
      p.process([], [out]);
      for (const v of out[0]) { ss += v * v; n++; }
      for (const m of msgs.splice(0)) for (const e of m.ev ?? []) if (e.dev === 'disk' && e.id === 1) done = e;
    }
    assert.ok(done?.ok, `the read completes: ${JSON.stringify(done)}`);
    assert.ok(10 * Math.log10(ss / n) > -60, 'the machine is audible');
  } finally {
    globalThis.structuredClone = saved.structuredClone;
  }
});
