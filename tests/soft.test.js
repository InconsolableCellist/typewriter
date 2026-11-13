// Emergent behaviour of the paper and ribbon soft bodies, driven by a hand-written fake mechanism state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run, STEP, strikeEvent, barFor } from '../src/soft/testkit.js';

function feedSheet(world, state, L, m, radians) {
  const dtheta = Math.max(1, Math.round(radians / 0.05));
  const step = radians / dtheta;
  for (let k = 0; k < dtheta; k++) {
    state[L.platenPsi] += step;
    world.step(STEP, state, L);
  }
}

function loadedSheet(world, state, L, m, feedRad = 3.4) {
  world.spawnSheet({ onTable: { offset: 0.005 } });
  run(world, state, L, 0.7);
  feedSheet(world, state, L, m, feedRad);
  run(world, state, L, 0.4);
  // Bring the carriage to centre and put the ribbon in the lifted position so strikes reach it.
  const lift = 0.72 * m.ribbon.vibrator.fullLift;  // upper band
  run(world, state, L, 0.08, (k, t) => { state[L.vibratorLift] = lift * Math.min(1, t / 0.05); });
}

test('platen feeds the sheet from the wedge with no slip at normal load', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  loadedSheet(world, state, L, m);
  const before = world.readouts().printV;
  assert.ok(before !== null, 'sheet at the print point');
  feedSheet(world, state, L, m, 1.2);
  run(world, state, L, 0.1);
  const after = world.readouts().printV;
  const expected = m.platen.radius * 1.2;
  assert.ok(Math.abs((after - before) - expected) < 0.0008, `advance ${((after - before) * 1000).toFixed(2)} mm for ${(expected * 1000).toFixed(2)} mm of platen surface`);
});

test('the edge stops at the nip until the platen turns (no pushing past the wedge)', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  world.spawnSheet({ onTable: { offset: 0.005 } });
  run(world, state, L, 0.7);
  const P = world.paperSim;
  const y0 = P.y[15], z0 = P.z[15];
  const id = world.grabPaper([P.x[15 + 30 * 20], P.y[15 + 30 * 20], P.z[15 + 30 * 20]]);
  // Push the sheet down the table with a big displacement.
  world.moveGrab(id, [P.x[15 + 30 * 20], P.y[15 + 30 * 20] - 0.05, P.z[15 + 30 * 20] + 0.04]);
  run(world, state, L, 0.5);
  world.release(id);
  assert.ok(Math.hypot(P.y[15] - y0, P.z[15] - z0) < 0.0035, 'pushing the sheet must not force the edge through the closed nip');
  const nip = world.readouts().patches.filter((q) => q.kind === 'roll' && q.count > 0);
  assert.ok(nip.length > 0 && nip.every((q) => q.wedge), 'patch should be in wedge state');
});

test('pulling a corner with the nip closed skews the sheet by a nonzero, friction-limited angle', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  loadedSheet(world, state, L, m);
  const P = world.paperSim;
  const r0 = world.readouts();
  const skew0 = r0.skewDeg;
  const corner = 0;
  const t = [P.x[corner], P.y[corner], P.z[corner]];
  const id = world.grabPaper(t);
  assert.ok(id > 0, 'grab');
  // Tug the top left corner upward and left along the sheet; hold it, then let go.
  const dir = [0, 0.8, -0.6];
  const pull = 0.06;
  let t2 = [t[0], t[1], t[2]];
  let slipSeen = 0;
  run(world, state, L, 0.6, (k) => {
    const f = Math.min(1, k / 20);
    t2 = [t[0], t[1] + dir[1] * pull * f, t[2] + dir[2] * pull * f];
    world.moveGrab(id, t2);
    for (const q of world.readouts().patches) if (q.count > 0) slipSeen = Math.max(slipSeen, q.slip);
  });
  run(world, state, L, 0.2);
  world.release(id);
  run(world, state, L, 0.3);
  const r1 = world.readouts();
  const dSkew = Math.abs(r1.skewDeg - skew0);
  assert.ok(dSkew > 0.15, `skew changed by ${dSkew.toFixed(3)} deg`);
  assert.ok(dSkew < 25, `skew limited, got ${dSkew.toFixed(3)} deg`);
  assert.ok(slipSeen > 1e-4, 'some nip patches must slip under the tug');
});

test('a gentle tug below the friction limit leaves the sheet unskewed', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  loadedSheet(world, state, L, m);
  const P = world.paperSim;
  const skew0 = world.readouts().skewDeg;
  const t = [P.x[0], P.y[0], P.z[0]];
  const id = world.grabPaper(t);
  run(world, state, L, 0.5, (k) => { const f = Math.min(1, k / 20); world.moveGrab(id, [t[0], t[1] + 0.0012 * f, t[2] - 0.0009 * f]); });
  world.release(id);
  run(world, state, L, 0.2);
  const dSkew = Math.abs(world.readouts().skewDeg - skew0);
  assert.ok(dSkew < 0.05, `skew changed by ${dSkew.toFixed(4)} deg under a small tug`);
});

test('opening the paper release lets the sheet be repositioned freely', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  loadedSheet(world, state, L, m);
  const P = world.paperSim;
  state[L.paperRelease] = 1; state[L.bail] = 0.3;
  run(world, state, L, 0.15);
  const before = world.readouts();
  assert.ok(before.patches.every((q) => q.N < 0.5), 'with the release open only the sheet\'s own light contact remains');
  const mid = Math.floor(P.nx / 2) + 20 * P.nx;
  const t = [P.x[mid], P.y[mid], P.z[mid]];
  const id = world.grabPaper(t);
  const start = [...t];
  // Slide the sheet sideways 12 mm and rotate it a bit by dragging.
  run(world, state, L, 0.5, (k) => { const f = Math.min(1, k / 25); world.moveGrab(id, [start[0] + 0.012 * f, start[1], start[2]]); });
  world.release(id);
  run(world, state, L, 0.3);
  const after = world.readouts();
  assert.ok(Math.abs(after.lateralMm - before.lateralMm) > 6, `lateral moved ${(after.lateralMm - before.lateralMm).toFixed(2)} mm`);
  state[L.paperRelease] = 0; state[L.bail] = 0;
});

test('a lift-off strike takes the character back off the paper and leaves its dent', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const bar = barFor(g, 'm');
  const sum = (ch) => { let t = 0; const d = world.inkTexture.data; for (let i = ch; i < d.length; i += 2) t += d[i]; return t; };
  world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 60 }, world));
  const inked = sum(0), dented = sum(1);
  assert.ok(inked > 0, 'the strike printed');
  world.applyStrike({ ...strikeEvent(g, L, state, bar, { peakForce: 60 }, world), erase: true });
  assert.ok(sum(0) < inked * 0.25, `ink left ${(sum(0) / inked).toFixed(3)}`);
  assert.ok(sum(1) >= dented, 'the emboss stays');
});

test('a lightly hit glyph prints fainter than a heavy one', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const bar = barFor(g, 'e');
  const r = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 14 }, world));
  assert.ok(r && r.inked > 0, 'light strike inks something');
  const light = r.sumInk;
  state[L.carriageX] -= 0.00254; run(world, state, L, 0.05);
  const r2 = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 72 }, world));
  const heavy = r2.sumInk;
  assert.ok(heavy > light * 1.15, `heavy ${heavy.toFixed(1)} vs light ${light.toFixed(1)}`);
  assert.ok(r2.inked >= r.inked, 'a heavier hit covers at least as many pixels');
});

test('ink depletes on repeated strikes at the same ribbon spot', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const bar = barFor(g, 'o');
  const sums = [];
  const inkBefore = world.readouts().inkAtPoint;
  for (let i = 0; i < 18; i++) {
    const r = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
    sums.push(r.sumInk);
  }
  run(world, state, L, 0.02);
  const inkAfter = world.readouts().inkAtPoint;
  assert.ok(sums[0] > sums[17] * 1.05, `first ${sums[0].toFixed(1)} last ${sums[17].toFixed(1)}`);
  assert.ok(inkAfter < inkBefore, `ribbon ink ${inkBefore} -> ${inkAfter}`);
});

test('a slack ribbon sags out of the print window and reduces coverage', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const bar = barFor(g, 'n');
  const tight = world.env();
  assert.ok(tight.ribbonInGap > 0.5, `tight ribbon coverage ${tight.ribbonInGap}`);
  const rTight = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  assert.ok(rTight.covered > 20, 'tight ribbon covers the face');

  // Let the supply spool unwind by hand: 60 mm of slack, ribbon sags.
  const sp = world.grabSpool('L');
  world.moveGrab(sp, -6);
  state[L.vibratorLift] = 0;
  run(world, state, L, 1.2);
  world.release(sp);
  run(world, state, L, 0.4);
  const ro = world.readouts();
  assert.ok(ro.ribbonSlackMm > 15, `slack ${ro.ribbonSlackMm} mm`);
  const slack = world.env();
  assert.ok(slack.ribbonInGap < tight.ribbonInGap, `coverage ${tight.ribbonInGap} -> ${slack.ribbonInGap}`);
  state[L.vibratorLift] = 0.72 * m.ribbon.vibrator.fullLift;
  run(world, state, L, 0.05);
  const rSlack = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  assert.ok(rSlack.covered < rTight.covered, `covered px ${rTight.covered} -> ${rSlack.covered}`);
});

test('line spacing and skew carry through to where glyphs land', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const bar = barFor(g, 'h');
  const a = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  state[L.platenPsi] += 15 * (Math.PI / 180);  // one 24-tooth ratchet space, 4.32 mm
  run(world, state, L, 0.12);
  const b = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  const dV = b.v - a.v;
  assert.ok(Math.abs(dV - m.platen.radius * 15 * Math.PI / 180) < 0.0009, `line advance ${dV.toFixed(5)} m`);
  assert.ok(Math.abs(b.u - a.u) < 0.0015, 'no lateral drift when feeding');

  // Now move the carriage by ten escapement pitches and strike: u must advance by that distance.
  state[L.carriageX] -= 10 * 0.00254;
  run(world, state, L, 0.1);
  const c = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  assert.ok(Math.abs((c.u - b.u) - 0.0254) < 0.0015, `u advance ${(c.u - b.u).toFixed(5)}`);

  // Skew the sheet by a corner tug, then typing across must follow the sheet: v changes along the line.
  state[L.carriageX] += 10 * 0.00254; run(world, state, L, 0.1);  // back to centre
  const P = world.paperSim;
  const id = world.grabPaper([P.x[0], P.y[0], P.z[0]]);
  const t = [P.x[0], P.y[0], P.z[0]];
  run(world, state, L, 0.5, (k) => { const f = Math.min(1, k / 20); world.moveGrab(id, [t[0], t[1] + 0.03 * f, t[2] - 0.022 * f]); });
  run(world, state, L, 0.2);
  world.release(id);
  run(world, state, L, 0.4);
  const skew = world.readouts().skewDeg;
  assert.ok(Math.abs(skew) > 0.05, `sheet skew ${skew}`);
  const p1 = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  assert.ok(p1.u !== null, 'strike must land on the sheet');
  state[L.carriageX] -= 12 * 0.00254; run(world, state, L, 0.1);
  const p2 = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  assert.ok(p2.u !== null, 'strike must land on the sheet');
  const dv = p2.v - p1.v, du = p2.u - p1.u;
  const expectDv = Math.tan((skew * Math.PI) / 180) * (12 * 0.00254);
  assert.ok(Math.abs(dv) > 3e-5, `dv ${dv.toExponential(3)} du ${du.toExponential(3)} skew ${skew}`);
  assert.ok(Math.abs(Math.abs(dv) - Math.abs(expectDv)) < 0.0008, `dv ${dv.toExponential(3)} expected ${expectDv.toExponential(3)}`);
});

test('no sheet: ink goes to the platen texture, and env reports no paper', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  world.spawnSheet({ center: [0.42, 0.001, 0.1] });
  const lift = 0.72 * m.ribbon.vibrator.fullLift;
  run(world, state, L, 0.2, (k, t) => { state[L.vibratorLift] = lift * Math.min(1, t / 0.1); });
  const e = world.env();
  assert.equal(e.paperPresent, 0, 'paperPresent is geometric');
  assert.equal(e.paperCaliperM, 0);
  const sumBefore = world.platenInkTexture.data.reduce((a, b) => a + b, 0);
  const r = world.applyStrike(strikeEvent(g, L, state, barFor(g, 'd'), { peakForce: 42 }, world));
  assert.ok(r, 'strike should still print');
  assert.equal(r.onPaper, false);
  const sumAfter = world.platenInkTexture.data.reduce((a, b) => a + b, 0);
  assert.ok(sumAfter > sumBefore, 'bare platen inked');
});

test('perforation only from concentrated pressure', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const period = world.applyStrike(strikeEvent(g, L, state, barFor(g, '.'), { peakForce: 1000, maxIndent: 5.2e-4 }, world));
  assert.ok(period.perforations > 0, 'a heavy period perforates');
  state[L.carriageX] -= 0.00254; run(world, state, L, 0.04);
  const wide = world.applyStrike(strikeEvent(g, L, state, barFor(g, 'm'), { peakForce: 40 }, world));
  assert.equal(wide.perforations, 0, `normal strike on a wide face ${wide.perforations}`);
});

test('env is derived from real geometry when the sheet is on the platen', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  loadedSheet(world, state, L, m);
  const e = world.env();
  assert.equal(e.paperPresent, 1);
  assert.ok(e.paperCaliperM > 0);
  assert.ok(e.ribbonInGap > 0.3, `ribbon coverage ${e.ribbonInGap}`);
});

test('typing with decreasing carriageX runs left to right, starting near the left edge at startX', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const bar = barFor(g, 'n');
  // Ride the carriage to the start of a line without disturbing the sheet.
  const steps = 60;
  for (let k = 1; k <= steps; k++) { state[L.carriageX] = (m.carriage.startX * k) / steps; world.step(STEP, state, L); }
  run(world, state, L, 0.1);
  const first = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  assert.ok(first.u !== null, 'lands on the sheet');
  assert.ok(first.u > 0 && first.u < 0.03, `first glyph at u = ${(first.u * 1000).toFixed(1)} mm from the left edge`);
  let prev = first;
  for (let n = 0; n < 5; n++) {
    state[L.carriageX] -= m.escapement.pitch;
    run(world, state, L, 0.05);
    const next = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
    assert.ok(Math.abs(next.u - prev.u - m.escapement.pitch) < 2e-4, `pitch ${((next.u - prev.u) * 1000).toFixed(3)} mm`);
    prev = next;
  }
});

test('unlimited typing lands several strikes from one frame at their own columns', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const bar = barFor(g, 'n');
  const steps = 60;
  for (let k = 1; k <= steps; k++) { state[L.carriageX] = (m.carriage.startX * k) / steps; world.step(STEP, state, L); }
  run(world, state, L, 0.1);
  const base = state[L.carriageX];
  let prev = null;
  for (let n = 0; n < 5; n++) {       // the carriage state and the world are not stepped between these strikes
    const evt = strikeEvent(g, L, state, bar, { peakForce: 42 }, world);
    evt.unlimited = true; evt.carriageX = base - n * m.escapement.pitch;
    const hit = world.applyStrike(evt);
    if (prev) assert.ok(Math.abs(hit.u - prev.u - m.escapement.pitch) < 2e-4, `pitch ${((hit.u - prev.u) * 1000).toFixed(3)} mm`);
    prev = hit;
  }
});

test('unlimited typing feeds the ribbon once per letter though the pawl never cycles', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const R = world.ribbonSim, side = R.takeUpSide, before = R.Lon[side];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const evt = strikeEvent(g, L, state, barFor(g, 'n'), { peakForce: 42 }, world);
    evt.unlimited = true;
    world.applyStrike(evt);
  }
  assert.ok(Math.abs(R.Lon[side] - before - n * m.ribbon.feedPerKey) < 1e-6, `fed ${((R.Lon[side] - before) * 1000).toFixed(3)} mm`);
});

function dragTo(world, state, L, id, from, to, seconds) {
  run(world, state, L, seconds, (k, t) => {
    const f = Math.min(1, t / seconds);
    world.moveGrab(id, [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f]);
  });
}

test('with the release open a sheet pulls all the way out; against the closed nip the fingers slip off instead', async () => {
  for (const release of [1, 0]) {
    const { world, state, layout: L, machine: m } = await makeWorld();
    loadedSheet(world, state, L, m);
    state[L.paperRelease] = release; state[L.bail] = release ? 0.3 : 0;
    run(world, state, L, 0.1);
    assert.equal(world.env().paperPresent, 1, 'sheet starts at the print point');
    const P = world.paperSim, c = 15;
    const from = [P.x[c], P.y[c], P.z[c]];
    const v0 = world.readouts().printV;
    const id = world.grabPaper(from);
    dragTo(world, state, L, id, from, [from[0], from[1] + 0.45, from[2] - 0.05], 2.5);
    run(world, state, L, 0.3);
    if (release) {
      assert.equal(world.env().paperPresent, 0, 'pulled out through the open release');
    } else {
      assert.ok(world.readouts().handSlips > 0, 'the hand comes off rather than deforming the sheet');
      assert.equal(world.env().paperPresent, 1, 'the closed nip keeps the sheet');
      assert.ok(Math.abs(world.readouts().printV - v0) < 0.02, `sheet barely moved: ${v0} -> ${world.readouts().printV}`);
      const s = strainStats(P);
      assert.ok(s.rms < 0.05, `the sheet is not deformed, rms ${s.rms.toFixed(3)}`);
    }
    world.release(id);
  }
});

test('a sheet on the desk can be dragged behind the platen, stops at the nip, and is fed when the platen turns', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  const P = world.paperSim;
  run(world, state, L, 0.3);
  assert.equal(world.env().paperPresent, 0, 'starts on the desk');
  // Pick the sheet up by the middle, carry it over the machine so the leading edge hangs behind the
  // platen, then lay it back onto the table, the way a hand does it.
  const row = 36, c = 15 + row * P.nx;
  const from = [P.x[c], P.y[c], P.z[c]];
  const id = world.grabPaper(from);
  assert.ok(id > 0, 'sheet grabbed on the desk');
  const a = row * P.dv, tipY = m.platen.center[1] + P.tableTip[0], tipZ = m.platen.center[2] + P.tableTip[1];
  const lifted = [from[0], 0.52, from[2]], over = [0, 0.52, -0.09];   // high enough to carry the hanging sheet over the paper table
  const onTable = [0, tipY + P.tableS[0] * a + P.tableN[0] * 0.004, tipZ + P.tableS[1] * a + P.tableN[1] * 0.004];
  dragTo(world, state, L, id, from, lifted, 0.8);
  dragTo(world, state, L, id, lifted, over, 0.8);
  run(world, state, L, 0.5);
  dragTo(world, state, L, id, over, onTable, 1.2);
  run(world, state, L, 0.3);
  world.release(id);
  run(world, state, L, 1.2);
  const nips = world.readouts().patches.filter((q) => q.kind === 'roll' && q.count > 0);
  assert.ok(nips.length > 0, 'leading edge reached a nip');
  assert.equal(world.env().paperPresent, 0, 'held back at the rolls: nothing reaches the print point until the platen turns');
  assert.equal(world.env().paperPresent, 0, 'not at the print point yet');
  feedSheet(world, state, L, m, 3.6);
  run(world, state, L, 0.3);
  assert.equal(world.env().paperPresent, 1, 'fed to the print point by turning the platen');
});

test('the ribbon advances with the pawl, and can be pulled and wound by hand', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  run(world, state, L, 0.2);
  const s0 = world.readouts().ribbonS;
  // The mechanism's pawl reciprocates; only forward travel winds the take-up spool.
  for (let n = 0; n < 40; n++) {
    run(world, state, L, 0.05, (k) => { state[L.ribbonPawlTravel] = m.ribbon.feedPerKey * Math.min(1, k / 2); });
    run(world, state, L, 0.05, () => { state[L.ribbonPawlTravel] = 0; });
  }
  const r1 = world.readouts();
  const advanced = Math.abs(r1.ribbonS - s0);
  assert.ok(Math.abs(advanced - 40 * m.ribbon.feedPerKey) < 0.006, `advanced ${(advanced * 1000).toFixed(2)} mm`);
  assert.ok(world.ribbon.spoolR.angle > 0.3, 'take-up spool turned');

  const R = world.ribbonSim, i = 20;
  const from = [R.xr[i], R.yr[i], R.zr[i]];
  const id = world.grabRibbon(from);
  const L0 = R.Lf;
  run(world, state, L, 0.6, (k) => world.moveGrab(id, [from[0], from[1], from[2] + Math.min(1, k / 30) * 0.05]));
  assert.ok(world.readouts().ribbonTensionN > 0.05, `tension ${world.readouts().ribbonTensionN}`);
  assert.ok(R.Lf > L0 + 0.01, 'pulling the span draws ribbon off the supply spool');
  world.release(id);

  const sp = world.grabSpool('R');
  const phi0 = R.phi[1];
  world.moveGrab(sp, phi0 + 2);
  run(world, state, L, 0.5);
  world.release(sp);
  assert.ok(R.phi[1] > phi0 + 0.5, 'spool turns by hand');
  assert.ok(R.tension >= 0);
});

// ---- regressions from hands-on runs

function strainStats(P) {
  const { x, y, z, n, nx, ny, du, dv } = P;
  let finite = true, reach = 0, worst = 0, sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) { if (!Number.isFinite(x[i] + y[i] + z[i])) finite = false; reach = Math.max(reach, Math.hypot(x[i], y[i], z[i])); }
  const edge = (a, b, rest) => { const e = Math.hypot(x[a] - x[b], y[a] - y[b], z[a] - z[b]) / rest - 1; worst = Math.max(worst, e); sum += e * e; cnt++; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = i + j * nx;
    if (i < nx - 1) edge(a, a + 1, du);
    if (j < ny - 1) edge(a, a + nx, dv);
  }
  return { finite, reach, worst, rms: Math.sqrt(sum / cnt) };
}

for (const [rate, label] of [[20, 'hand'], [150, 'violent'], [1000, 'absurd']]) {
  test(`platen abuse (${label}, ${rate} rad/s): spins, reversals and grabs leave the sheet intact`, async () => {
    for (const grabbing of [false, true]) {
      const { world, state, layout: L, machine: m } = await makeWorld();
      loadedSheet(world, state, L, m);
      const P = world.paperSim;
      let id = -1;
      if (grabbing) { const k = P.nx - 1 + P.nx * (P.ny - 1); id = world.grabPaper([P.x[k], P.y[k], P.z[k]]); }
      let dir = 1, peak = 0;
      for (let f = 0; f < 90; f++) {
        if (f % 5 === 4) dir = -dir;
        state[L.platenPsi] += dir * rate * STEP;
        if (id > 0) { const a = f * 0.2; world.moveGrab(id, [0.2 * Math.sin(a), 0.25 + 0.1 * Math.cos(a * 1.3), 0.1 + 0.2 * Math.sin(a * 0.7)]); }
        world.step(STEP, state, L);
        const s = strainStats(P);
        assert.ok(s.finite, 'positions stay finite');
        assert.ok(s.reach < 1.6, `sheet stays near the machine, reached ${s.reach.toFixed(2)} m`);
        peak = Math.max(peak, s.worst);
      }
      if (id > 0) world.release(id);
      run(world, state, L, 1.2);
      const end = strainStats(P);
      assert.ok(end.finite, 'finite after settling');
      assert.ok(peak < 40, `peak stretch stays bounded, was ${peak.toFixed(1)}`);
      assert.ok(end.rms < 0.45, `sheet recovers its shape, rms strain ${end.rms.toFixed(3)}`);
    }
  });
}

test('feeding the same angle gives the same sheet position at any frame rate', async () => {
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const timings = { 30: () => 1 / 30, 60: () => 1 / 60, 144: () => 1 / 144, jitter: () => 1 / 60 + (rnd() - 0.5) * 0.016, jank: () => (rnd() < 0.1 ? 0.05 : 1 / 60) };
  const results = {};
  for (const [name, dtFn] of Object.entries(timings)) {
    const { world, state, layout: L, machine: m } = await makeWorld();
    world.step(1 / 240, state, L);
    world.spawnSheet({ onTable: { offset: 0.002 } });
    const stepAll = (seconds, fn) => { let t = 0; while (t < seconds) { const dt = dtFn(); if (fn) fn(dt); world.step(dt, state, L); t += dt; } };
    stepAll(0.4);
    const total = (0.058 + 0.05) / m.platen.radius;
    let psi = 0;
    while (psi < total) {
      const dt = dtFn();
      state[L.bail] = Math.min(m.paper.bailTravel * 1.2, state[L.bail] + dt * 4);
      psi = Math.min(total, psi + 3.5 * dt);
      state[L.platenPsi] = psi;
      world.step(dt, state, L);
    }
    stepAll(0.4, (dt) => { state[L.bail] = Math.max(0, state[L.bail] - dt * 4); });
    stepAll(0.3);
    results[name] = world.readouts().printV;
  }
  const vals = Object.values(results);
  assert.ok(vals.every((v) => v !== null), `sheet reached the print point: ${JSON.stringify(results)}`);
  assert.ok(Math.max(...vals) - Math.min(...vals) < 0.001, `frame timing changes the feed: ${JSON.stringify(results)}`);
});

test('a whole sheet feeds through on the front of the table, and running out at the end retires it once', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  const P = world.paperSim;
  let ejected = 0;
  P.onEjected = () => { ejected++; };
  loadedSheet(world, state, L, m);
  const f = () => world.frame;
  const behind = () => {
    let worst = 0;
    const tip = P.tableTip, N = P.tableN, S = P.tableS;
    for (let i = 0; i < P.n; i++) {
      const ty = P.y[i] - f().cy - tip[0], tz = P.z[i] - f().cz - tip[1], a = ty * S[0] + tz * S[1];
      if (a < 0.01 || a > m.paper.tableLength) continue;
      const gd = ty * N[0] + tz * N[1];
      if (gd < worst) worst = gd;
    }
    return worst;
  };
  const r = m.platen.radius ?? P.r;
  for (let turned = 0; turned < m.paper.height / r + 4; turned += 0.5) {
    feedSheet(world, state, L, m, 0.5);
    assert.ok(behind() > -0.0015, `sheet went through the table: ${(behind() * 1000).toFixed(1)} mm behind at ${turned.toFixed(1)} rad`);
    if (turned < m.paper.height / r - 3) assert.equal(ejected, 0, `reported finished too early, at ${turned.toFixed(1)} rad`);
  }
  run(world, state, L, 0.3);
  assert.equal(ejected, 1, 'finished sheet reported exactly once');
});

test('winding a sheet backwards out of the rolls does not count as finishing it', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  let ejected = 0;
  world.paperSim.onEjected = () => { ejected++; };
  loadedSheet(world, state, L, m);
  feedSheet(world, state, L, m, -8);
  run(world, state, L, 0.3);
  assert.equal(ejected, 0);
});

test('a loose flap lying over the print line neither smears the glyph nor steals the strike', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m, 9);              // far enough down that the leading rows are clear of the rollers
  const clean = world.applyStrike(strikeEvent(g, L, state, barFor(g, 'h'), { peakForce: 42 }, world));
  assert.ok(clean.depositH > 10 && clean.depositH < 90, `clean deposit ${clean.depositH} texels tall`);
  const P = world.paperSim, f = world.frame, o = g.printPoint, n = g.printNormal;
  // Lay rows from the free leading end of the sheet over the print line, 0.1 mm proud of the typing layer.
  for (let j = 0; j < 12; j++) for (let i = 0; i < P.nx; i++) {
    const k = i + j * P.nx, dj = j - 6;
    const up = P.t + 0.0001 + 0.00005 * dj;
    P.x[k] = f.cx + P.uMat[k] - m.paper.width / 2;
    P.y[k] = o[1] + n[1] * up + dj * P.dv * -n[2];
    P.z[k] = o[2] + n[2] * up + dj * P.dv * n[1];
  }
  state[L.carriageX] -= 0.0127;
  world.step(STEP, state, L);
  const r = world.applyStrike(strikeEvent(g, L, state, barFor(g, 'h'), { peakForce: 42 }, world));
  assert.ok(r.depositH > 10 && r.depositH < 90, `deposit stays glyph sized, was ${r.depositH} texels tall`);
  assert.ok(r.depositW > 10 && r.depositW < 90, `deposit stays glyph sized, was ${r.depositW} texels wide`);
  assert.ok(Math.abs(r.v - clean.v) < 0.002, `strike stays on the typing layer: ${r.v} vs ${clean.v}`);
});

test('a shifted capital is covered by the ribbon as fully as a lower-case letter', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const bar = barFor(g, 'q');
  const lower = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42 }, world));
  state[L.shiftY] = m.slug.caseOffset;
  run(world, state, L, 0.2);
  const upper = world.applyStrike(strikeEvent(g, L, state, bar, { peakForce: 42, caseIndex: 1 }, world));
  assert.ok(lower.covered / lower.pressed > 0.95, `lower ${lower.covered}/${lower.pressed}`);
  assert.ok(upper.covered / upper.pressed > 0.95, `upper ${upper.covered}/${upper.pressed}`);
  assert.ok(upper.inked > 0.5 * lower.inked, `capital printed ${upper.inked} texels`);
  assert.ok(Math.abs(upper.v - lower.v) < 0.0012, `capital on the same line: ${upper.v} vs ${lower.v}`);
  // With the vibrator lifted only at the instant of impact, as the mechanism does it.
  const full = state[L.vibratorLift];
  state[L.vibratorLift] = 0;
  run(world, state, L, 0.2);
  state[L.carriageX] -= 0.0254; run(world, state, L, 0.1);
  const evt = strikeEvent(g, L, state, bar, { peakForce: 42, caseIndex: 1 }, world);
  evt.vibratorLift = full;
  const impact = world.applyStrike(evt);
  assert.ok(impact.covered / impact.pressed > 0.95, `capital at impact lift ${impact.covered}/${impact.pressed}`);
});

test('the ribbon starts taut and threaded, with no slack until something causes it', async () => {
  const { world, state, layout: L } = await makeWorld();
  run(world, state, L, 0.5);
  const r = world.readouts();
  assert.ok(r.ribbonTensionN > 0, `tension ${r.ribbonTensionN} N`);
  assert.ok(r.ribbonSlackMm < 0.5, `slack ${r.ribbonSlackMm} mm`);
  assert.ok(world.env().ribbonInGap >= 0, 'env readable');
});

test('clicking the ribbon or a spool without dragging leaves the ribbon undisturbed', async () => {
  const { world, state, layout: L } = await makeWorld();
  run(world, state, L, 0.5);
  const R = world.ribbonSim;
  const snapshot = () => ({ Lf: R.Lf, T: R.tension, y: Float64Array.from(R.yr), z: Float64Array.from(R.zr) });
  const clicks = [
    () => { const i = 20; return world.grabRibbon([R.xr[i], R.yr[i], R.zr[i]]); },
    () => world.grabRibbon([R.xr[36], R.yr[36], R.zr[36]]),
    () => world.grabSpool('L'),
    () => world.grabSpool('R'),
  ];
  for (const click of clicks) {
    const before = snapshot();
    const id = click();
    assert.ok(id > 0, 'grabbed');
    run(world, state, L, 0.25);
    world.release(id);
    run(world, state, L, 0.5);
    const after = snapshot();
    assert.ok(Math.abs(after.Lf - before.Lf) < 1e-4, `free length moved ${(after.Lf - before.Lf) * 1000} mm`);
    assert.ok(Math.abs(after.T - before.T) < 0.02, `tension ${before.T} -> ${after.T}`);
    let drop = 0;
    for (let i = 0; i < R.N; i++) drop = Math.max(drop, Math.hypot(after.y[i] - before.y[i], after.z[i] - before.z[i]));
    assert.ok(drop < 0.001, `rope moved ${(drop * 1000).toFixed(2)} mm after a click`);
  }
});

test('the ribbon selector reaches the red band and the stencil position', async () => {
  const strikeAt = async (sel, lift) => {
    const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
    loadedSheet(world, state, L, m);
    state[L.ribbonSelector] = sel;
    state[L.vibratorLift] = 0;
    run(world, state, L, 0.3, (k, t) => { state[L.vibratorLift] = lift(m) * Math.min(1, t / 0.2); });
    const r = world.applyStrike(strikeEvent(g, L, state, barFor(g, 'h'), { peakForce: 42 }, world));
    return { r, red: world.colorMask.data.reduce((a, b) => a + b, 0) };
  };
  const black = await strikeAt(0, (m) => 0.72 * m.ribbon.vibrator.fullLift);
  const red = await strikeAt(0.35, (m) => m.ribbon.vibrator.fullLift);
  const stencil = await strikeAt(0.7, () => 0);
  assert.ok(black.r.inked > 50 && black.red === 0, `upper band prints black: ${black.r.inked} texels, red ${black.red}`);
  assert.ok(red.r.inked > 50 && red.red > 0, `lower band prints red: ${red.r.inked} texels, red ${red.red}`);
  assert.ok(stencil.r.inked < 0.1 * black.r.inked, `stencil leaves the ribbon out: ${stencil.r.inked}`);
});

// ---- paper feel, machine collision, resets, ink darkness

test('a cantilever of paper droops as beam theory says, at the real bending stiffness', async () => {
  const { PaperSim } = await import('../src/soft/paper.js');
  const base = (await import('../src/machine/frontstrike1926.js')).default;
  const L = 0.06, held = 0.012, width = 0.2;
  const machine = { ...base, paper: { ...base.paper, width, height: L + held } };
  const ny = 25, nx = 9;
  const P = new PaperSim(machine, { nx, ny, pose: { center: [0.6, 0.5, 0], yaw: 0 } });
  const h = 1 / 480;
  const heldRows = Math.round(held / P.dv);
  const frame = { cx: 5, cy: 5, cz: 5, psi: 0, omega: 0, dcx: 0, dcy: 0, nipFactor: 1, bailFactor: 1 };
  const y0 = Float64Array.from(P.y);
  // Clamp the first rows by pinning a grip every column, each only as wide as its own particle.
  const ids = [];
  for (let j = 0; j <= heldRows; j++) for (let i = 0; i < nx; i++) {
    const k = i + j * nx;
    const id = P.nextGrab++;
    P.grabs.set(id, { ids: Int32Array.from([k]), ox: Float64Array.from([0]), oy: Float64Array.from([0]), oz: Float64Array.from([0]), tx: P.x[k], ty: P.y[k], tz: P.z[k], overX: 0, overY: 0, overZ: 0, fMag: 0, slipT: 0 });
    ids.push(id);
  }
  for (let s = 0; s < 480 * 2.5; s++) P.substep(h, frame);
  const tip = Math.floor(nx / 2) + (ny - 1) * nx;
  const droop = y0[tip] - P.y[tip];
  const w = base.paper.grammage * 9.81, D = base.paper.bendingStiffness;
  const free = (ny - 1 - heldRows) * P.dv;
  const theory = (w * free ** 4) / (8 * D);
  assert.ok(droop > 0.5 * theory && droop < 1.6 * theory, `tip droop ${(droop * 1000).toFixed(2)} mm, beam theory ${(theory * 1000).toFixed(2)} mm`);
});

test('the free part of a loaded sheet stands up instead of draping, and no row ripples', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  loadedSheet(world, state, L, m);
  feedSheet(world, state, L, m, 3);
  run(world, state, L, 0.5);
  const P = world.paperSim, { x, y, z, nx, ny, dv } = P;
  assert.ok(y[15] > m.platen.center[1] + m.platen.radius + 0.005, `the leading edge stands above the platen, y=${y[15].toFixed(3)}`);
  // Grid-scale ripple: a row's second difference must stay small compared with the platen's curvature.
  let worst = 0;
  for (let j = 1; j < 12; j++) for (let i = 1; i < nx - 1; i++) {
    const c = i + j * nx;
    worst = Math.max(worst, Math.hypot(x[c - 1] - 2 * x[c] + x[c + 1], y[c - 1] - 2 * y[c] + y[c + 1], z[c - 1] - 2 * z[c] + z[c + 1]) / (P.du * P.du));
  }
  assert.ok(worst < 1 / m.platen.radius, `row curvature ${worst.toFixed(1)} /m`);
  void dv;
});

test('a dropped sheet comes to rest on the machine or the desk, never inside the body', async () => {
  const { bodyTop } = await import('../src/soft/proxies.js');
  for (const center of [[0.02, 0.32, 0.08], [0.05, 0.3, -0.1], [-0.1, 0.28, 0.2]]) {
    const { world, state, layout: L } = await makeWorld();
    world.spawnSheet({ center, yaw: 0.2 });
    run(world, state, L, 2.5);
    const P = world.paperSim;
    let below = 0, inside = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.y[i] < -1e-6) below++;
      const top = bodyTop(P.x[i], P.z[i]);
      if (top > 0 && P.y[i] < top - 0.003) inside++;
    }
    assert.equal(below, 0, 'not below the desk');
    assert.equal(inside, 0, `${inside} particles inside the machine body, dropped at ${center}`);
  }
});

test('reset buttons recover a totally tangled sheet and ribbon', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const P = world.paperSim, R = world.ribbonSim;
  world.applyStrike(strikeEvent(g, L, state, barFor(g, 'h'), { peakForce: 42 }, world));
  const wearS = world.readouts().ribbonS;
  // Tangle both: scramble positions, grab everything, pull the ribbon around.
  for (let i = 0; i < P.n; i++) { P.x[i] += Math.sin(i * 13) * 0.05; P.y[i] += Math.cos(i * 7) * 0.05; P.z[i] += Math.sin(i * 3.1) * 0.05; }
  const pg = world.grabPaper([P.x[900], P.y[900], P.z[900]]);
  const rg = world.grabRibbon([R.xr[20], R.yr[20], R.zr[20]]);
  world.moveGrab(rg, [R.xr[20], R.yr[20] - 0.1, R.zr[20] + 0.1]);
  run(world, state, L, 0.4);
  void pg; void wearS;
  const inkBefore = R.ink.reduce((a, b) => a + b, 0);
  world.resetPaper();
  world.resetRibbon();
  assert.equal(world.inkTexture.data.reduce((a, b) => a + b, 0), 0, 'ink cleared with the sheet');
  run(world, state, L, 0.5);
  const s = strainStats(P);
  assert.ok(s.finite && s.rms < 0.05, `clean sheet, rms ${s.rms.toFixed(3)}`);
  assert.equal(world.readouts().ribbonSlackMm < 0.5, true, 'ribbon taut again');
  assert.ok(world.readouts().ribbonTensionN > 0, 'ribbon under tension');
  assert.equal(R.ink.reduce((a, b) => a + b, 0), inkBefore, 'wear is kept');
  feedSheet(world, state, L, m, 3.4);
  run(world, state, L, 0.3);
  assert.equal(world.env().paperPresent, 1, 'the new sheet feeds');
  world.resetRibbon({ fresh: true });
  assert.ok(R.ink.every((v) => v === 255), 'fresh ribbon');
});

test('with the bail closed the sheet feeds under it, on the platen at the rollers and leaving from there', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  world.spawnSheet({ onTable: { offset: 0.005 } });
  run(world, state, L, 0.7);
  const P = world.paper, c = m.platen.center, R = m.platen.radius, beta0 = m.printPoint.beta, tb = m.paper.bailAngle;
  const rBar = R + m.paper.bailRollerRadius + 0.00018;
  const check = () => {
    const X = P.positions, cx = c[0] + state[L.carriageX], cy = c[1] + state[L.shiftY];
    let onLine = 0, worstHigh = -Infinity, overBar = 0;
    for (let i = 0; i < P.positions.length / 3; i++) {
      const xt = X[i * 3] - cx, dy = X[i * 3 + 1] - cy, dz = X[i * 3 + 2] - c[2];
      if (Math.abs(xt) > m.platen.length / 2) continue;
      const rho = Math.hypot(dy, dz), th = Math.atan2(dy, dz) - beta0;
      const a = th - tb;
      if (a > -0.26 && a < 0.03 && rho < rBar + m.paper.bailRodRadius) { onLine++; worstHigh = Math.max(worstHigh, rho - R); }
      if (a > -0.26 && a < 0.03 && rho >= rBar) overBar++;
    }
    return { onLine, worstHigh, overBar };
  };
  let reached = 0;
  for (let k = 0; k < 14; k++) {
    feedSheet(world, state, L, m, 0.5);
    const s = check();
    assert.equal(s.overBar, 0, `sheet nodes above the bail bar at step ${k}`);
    if (s.onLine) { reached++; assert.ok(s.worstHigh < 0.0006, `sheet stays on the platen at the bail, ${(s.worstHigh * 1e3).toFixed(2)} mm`); }
  }
  assert.ok(reached > 3, `the sheet reached the bail (${reached} checks)`);
  // Above the bail it is free of the platen: it has left along the tangent.
  run(world, state, L, 0.3);
  const X = P.positions, cx = c[0] + state[L.carriageX], cy = c[1] + state[L.shiftY];
  let above = 0, off = 0;
  for (let i = 0; i < P.positions.length / 3; i++) {
    if (Math.abs(X[i * 3] - cx) > 0.06) continue;
    const dy = X[i * 3 + 1] - cy, dz = X[i * 3 + 2] - c[2], th = Math.atan2(dy, dz) - beta0;
    if (th > tb + 0.2 && th < tb + 0.5) { above++; if (Math.hypot(dy, dz) - R > 0.0004) off++; }
  }
  assert.ok(above > 0 && off / above > 0.7, `past the bail the sheet is off the platen (${off}/${above})`);
});

test('opening the bail frees the sheet and closing it presses the sheet back down', async () => {
  const { world, state, layout: L, machine: m } = await makeWorld();
  loadedSheet(world, state, L, m);
  const P = world.paper, c = m.platen.center, R = m.platen.radius, beta0 = m.printPoint.beta, tb = m.paper.bailAngle;
  const high = () => {
    const X = P.positions, cx = c[0] + state[L.carriageX]; let w = -Infinity, n = 0;
    for (let i = 0; i < P.positions.length / 3; i++) {
      if (Math.abs(X[i * 3] - cx) > m.platen.length / 2) continue;
      const dy = X[i * 3 + 1] - c[1], dz = X[i * 3 + 2] - c[2];
      const a = Math.atan2(dy, dz) - beta0 - tb;
      if (a > -0.26 && a < 0.03 && Math.hypot(dy, dz) < R + 0.012) { n++; w = Math.max(w, Math.hypot(dy, dz) - R); }
    }
    return { w, n };
  };
  const closed = high();
  assert.ok(closed.n > 0 && closed.w < 0.0006, `closed: on the platen, ${(closed.w * 1e3).toFixed(2)} mm`);
  state[L.bail] = m.paper.bailTravel;
  run(world, state, L, 0.5, () => { state[L.bail] = m.paper.bailTravel; });
  state[L.bail] = 0;
  run(world, state, L, 0.3, () => { state[L.bail] = 0; });
  const after = high();
  assert.ok(after.n > 0 && after.w < 0.0006, `closing presses it back, ${(after.w * 1e3).toFixed(2)} mm`);
});

test('the rising ribbon stays on the typist\'s side of the sheet at every lift, carriage position and shift', async () => {
  const { world, state, layout: L, machine: m, geometry: g } = await makeWorld();
  loadedSheet(world, state, L, m);
  const n = g.printNormal, o = g.printPoint, along = (px, py, pz) => (px - o[0]) * n[0] + (py - o[1]) * n[1] + (pz - o[2]) * n[2];
  const P = world.paper, Rb = world.ribbon, hw = m.ribbon.width / 2;
  for (const bail of [0, m.paper.bailTravel]) for (const carX of [m.carriage.marginLeftX, 0, m.carriage.marginRightX]) for (const shift of [0, m.carriage.shiftTravel]) {
    for (const lift of [0, 0.5, 0.72, 1].map((f) => f * m.ribbon.vibrator.fullLift)) {
      run(world, state, L, 0.12, () => { state[L.carriageX] = carX; state[L.shiftY] = shift; state[L.vibratorLift] = lift; state[L.bail] = bail; });
      let worst = Infinity;
      for (let r = 0; r < Rb.count; r++) for (const e of [-1, 0, 1]) {
        const x = Rb.positions[r * 3] + Rb.up[r * 3] * hw * e, y = Rb.positions[r * 3 + 1] + Rb.up[r * 3 + 1] * hw * e, z = Rb.positions[r * 3 + 2] + Rb.up[r * 3 + 2] * hw * e;
        for (let i = 0; i < P.positions.length / 3; i++) {
          const X = P.positions, sx = X[i * 3], sy = X[i * 3 + 1], sz = X[i * 3 + 2];
          if (Math.abs(sx - x) > 0.003 || Math.hypot(sy - y, sz - z) > 0.012) continue;
          worst = Math.min(worst, along(x, y, z) - along(sx, sy, sz));
        }
      }
      assert.ok(worst > 0, `ribbon in front of the sheet: ${(worst * 1e3).toFixed(2)} mm at carriage ${carX}, shift ${shift}, lift ${lift}, bail ${bail}`);
    }
  }
});

test('a parked sheet is not simulated, and the next one fed in starts from a clean reset', async () => {
  const { world, state, layout: L } = await makeWorld();
  world.parkSheet();
  const sim = world.paperSim;
  let substeps = 0;
  const real = sim.substep.bind(sim);
  sim.substep = (h, f) => { substeps++; real(h, f); };
  const y0 = sim.y.slice(), count0 = sim.substepCount;
  run(world, state, L, 0.3);
  assert.equal(substeps, 0, 'no paper substeps while parked');
  assert.ok(sim.substepCount > count0, 'its substep clock still runs');
  assert.ok(sim.y.every((v, i) => v === y0[i]), 'it does not fall or settle while parked');
  world.spawnSheet({ onTable: { offset: 0.005 } });
  assert.equal(world.sheetParked, false);
  assert.equal(sim.asleep, false);
  assert.equal(sim.grabs.size, 0);
  run(world, state, L, 0.3);
  assert.ok(substeps > 0, 'a fed sheet is simulated again');
});
