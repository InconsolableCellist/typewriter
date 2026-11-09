import test from 'node:test';
import assert from 'node:assert/strict';
import { planStrike, THUNDER_PARTS } from '../src/audio/ambience.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('thunder follows its flash by the speed of sound, and a near strike is brighter and louder than a far one', () => {
  const near = planStrike(seq(0, 0.5)), far = planStrike(seq(0.999, 0.5));
  assert.ok(Math.abs(near.delayS - near.km / 0.343) < 1e-9);
  assert.ok(near.delayS < 1.5 && far.delayS > 8, `delays ${near.delayS} ${far.delayS}`);
  assert.ok(near.flash > far.flash && near.gain > far.gain && near.cutoffHz > far.cutoffHz);
});

test('every strike is playable and strikes stay spaced apart', () => {
  let rand = 12345;
  const rng = () => (rand = (rand * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 500; i++) {
    const s = planStrike(rng);
    assert.ok(THUNDER_PARTS[s.part], s.part);
    assert.ok(s.nextS >= 13 && s.nextS <= 48);
    assert.ok(s.flash > 0 && s.flash <= 1 && s.gain > 0 && s.gain <= 1);
    assert.ok(s.rate > 0.7 && s.rate < 1.2);
  }
});
