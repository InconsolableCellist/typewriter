// Print: turns a strike event into ink and embossing using the real 3D state of the sheet and ribbon.
// The pressure field comes from the slug's height field (relief, face curvature mismatch, skew) and the
// measured indentation. Where it lands is found by intersecting the strike with the actual sheet.

const INK_PX_PER_MM = 14;
const COLOR_DOWNSAMPLE = 4;
const PLATEN_PX_PER_MM = 6;
const LN2 = Math.log(2);

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Winkler indentation that gives force F for a glyph face, with the same gap model used to print.
 * Exposed so the strike event's maxIndent can be cross-checked and so tests can synthesize events.
 */
export function solveIndent(machine, glyphs, gi, force, skewRad = 0) {
  const N = glyphs.N, tex = glyphs.texelMm / 1000, data = glyphs.face(gi);
  const k = machine.slug.foundationKPerM2, area = tex * tex;
  const z = faceGap(machine, glyphs, data, skewRad);
  const F = (d) => { let f = 0; for (let i = 0; i < N * N; i++) { const dl = d - z[i]; if (dl > 0) f += k * dl * area; } return f; };
  let lo = 0, hi = 0.002;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (F(mid) < force) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Gap of each face texel behind the first point of contact. Same model as src/sim/faces.js. */
function faceGap(machine, glyphs, data, skewRad, out) {
  const N = glyphs.N, tex = glyphs.texelMm / 1000;
  const relief = machine.slug.reliefDepth;
  const curv = 1 / machine.platen.radius - 1 / machine.slug.faceRadius;
  const tanSkew = Math.tan(skewRad);
  const z = out ?? new Float64Array(N * N);
  let zmin = Infinity;
  for (let j = 0, k = 0; j < N; j++) {
    const v = (j - (N - 1) / 2) * tex;
    const zc = 0.5 * v * v * curv;
    for (let i = 0; i < N; i++, k++) {
      const u = (i - (N - 1) / 2) * tex;
      const zz = relief * (1 - data[k] / 255) + zc + tanSkew * u;
      z[k] = zz;
      if (data[k] > 0 && zz < zmin) zmin = zz;
    }
  }
  if (!isFinite(zmin)) zmin = 0;
  for (let k = 0; k < N * N; k++) z[k] -= zmin;
  return z;
}

export class Printer {
  constructor(machine, geo, glyphs, paper, ribbon) {
    this.m = machine; this.geo = geo; this.glyphs = glyphs; this.paper = paper; this.ribbon = ribbon;
    const W = Math.round((machine.paper.width * 1000) * INK_PX_PER_MM);
    const H = Math.round((machine.paper.height * 1000) * INK_PX_PER_MM);
    this.texW = W; this.texH = H;
    this.inkTexture = { data: new Uint8Array(W * H * 2), width: W, height: H, dirty: [] };
    this.colorMask = { data: new Uint8Array(Math.ceil(W / COLOR_DOWNSAMPLE) * Math.ceil(H / COLOR_DOWNSAMPLE)), width: Math.ceil(W / COLOR_DOWNSAMPLE), height: Math.ceil(H / COLOR_DOWNSAMPLE), downsample: COLOR_DOWNSAMPLE, dirty: [] };
    this.pxPerM = INK_PX_PER_MM * 1000;

    const circ = 2 * Math.PI * machine.platen.radius * 1000;
    const pW = Math.round(circ * PLATEN_PX_PER_MM), pH = Math.round(machine.platen.length * 1000 * PLATEN_PX_PER_MM);
    this.platenInk = { data: new Uint8Array(pW * pH), width: pW, height: pH, dirty: [], pxPerM: PLATEN_PX_PER_MM * 1000 };

    // Glyph scratch space: pressure and ribbon availability on the slug's own grid.
    const N = glyphs.N;
    this.N = N;
    this.texelM = glyphs.texelMm / 1000;
    this.P = new Float32Array(N * N);
    this.R = new Float32Array(N * N);
    this.Col = new Float32Array(N * N);
    this.Tup = [0, -geo.strikeDown[1], -geo.strikeDown[2]];
    this.perforations = 0;
    this.lastStrike = null;
  }

  clear() {
    this.inkTexture.data.fill(0);
    this.colorMask.data.fill(0);
    this.inkTexture.dirty.length = 0;
    this.inkTexture.dirty.push({ x: 0, y: 0, w: this.inkTexture.width, h: this.inkTexture.height });
    this.colorMask.dirty.length = 0;
    this.colorMask.dirty.push({ x: 0, y: 0, w: this.colorMask.width, h: this.colorMask.height });
    this.perforations = 0;
  }

  /**
   * Find (u, v, normal offset) of the sheet under a world point by intersecting the strike ray with
   * the sheet mesh. Returns null when no sheet is there.
   */
  raycast(px, py, pz, dirX, dirY, dirZ) {
    // Scan every cell: a loose flap can be near the ray, so the nearest particle may belong to the wrong layer.
    // The layer the nip holds is the one being typed on; without self-collision the depth order of loose layers
    // means little, so the gripped layer wins and otherwise the first surface along the ray does.
    const paper = this.paper;
    const { x, y, z, nx, ny, uMat, vMat, inBand } = paper;
    const margin = 0.006;
    let hit = null, hitT = Infinity, hitBand = false;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = i + j * nx, b = a + 1, c = a + nx, d = c + 1;
        // Quick reject: the cell's corner must be within a band around the ray.
        const ex = x[a] - px, ey = y[a] - py, ez = z[a] - pz;
        const along = ex * dirX + ey * dirY + ez * dirZ;
        const ox = ex - along * dirX, oy = ey - along * dirY, oz = ez - along * dirZ;
        if (ox * ox + oy * oy + oz * oz > margin * margin * 25) continue;
        for (let t = 0; t < 2; t++) {
          const i0 = t === 0 ? a : b, i1 = c, i2 = t === 0 ? b : d;
          const r = rayTri(px, py, pz, dirX, dirY, dirZ, x[i0], y[i0], z[i0], x[i1], y[i1], z[i1], x[i2], y[i2], z[i2]);
          if (!r || r.t <= -0.012 || r.t >= 0.03) continue;
          const band = !!inBand && inBand[i0] === 1 && inBand[i1] === 1 && inBand[i2] === 1;
          if (hit && (hitBand && !band)) continue;
          if (hit && band === hitBand && r.t >= hitT) continue;
          hitT = r.t; hitBand = band;
          const w = 1 - r.b1 - r.b2;
          hit = { u: uMat[i0] * w + uMat[i1] * r.b1 + uMat[i2] * r.b2, v: vMat[i0] * w + vMat[i1] * r.b1 + vMat[i2] * r.b2, t: r.t, tri: [i0, i1, i2] };
        }
      }
    }
    return hit;
  }

  /**
   * Paper location for a strike point in the print window, as an affine map (dX, dY) -> (u, v) taken from the one
   * triangle under the strike. Separate rays for each axis could land on different layers and smear a glyph.
   */
  locateOnSheet(o, n, xHat, tUp) {
    const up = 0.006;
    const a = this.raycast(o[0] + n[0] * up, o[1] + n[1] * up, o[2] + n[2] * up, -n[0], -n[1], -n[2]);
    if (!a) return null;
    const flat = { u0: a.u, v0: a.v, axU: 1, axV: 0, ayU: 0, ayV: -1, center: a };
    const { x, y, z, uMat, vMat } = this.paper;
    const [i0, i1, i2] = a.tri;
    const e1 = [x[i1] - x[i0], y[i1] - y[i0], z[i1] - z[i0]], e2 = [x[i2] - x[i0], y[i2] - y[i0], z[i2] - z[i0]];
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const X1 = dot(e1, xHat), X2 = dot(e2, xHat), Y1 = dot(e1, tUp), Y2 = dot(e2, tUp);
    const det = X1 * Y2 - X2 * Y1;
    if (Math.abs(det) < 1e-9) return flat;
    const U1 = uMat[i1] - uMat[i0], U2 = uMat[i2] - uMat[i0], V1 = vMat[i1] - vMat[i0], V2 = vMat[i2] - vMat[i0];
    const axU = (U1 * Y2 - U2 * Y1) / det, ayU = (X1 * U2 - X2 * U1) / det;
    const axV = (V1 * Y2 - V2 * Y1) / det, ayV = (X1 * V2 - X2 * V1) / det;
    // A crushed or folded cell has no usable local map: print square to the page rather than smear.
    const area = Math.abs(axU * ayV - axV * ayU);
    if (area < 0.4 || area > 2.5 || Math.max(Math.abs(axU), Math.abs(axV), Math.abs(ayU), Math.abs(ayV)) > 3) return flat;
    return { u0: a.u, v0: a.v, axU, axV, ayU, ayV, center: a };
  }

  apply(evt, F) {
    const { m, geo, glyphs, paper, ribbon } = this;
    const N = this.N, tex = this.texelM;
    const bar = geo.bars[evt.bar];
    // A strike can carry its own character (a donor bar in terminal mode); ordinary strikes print the bar's slug.
    let gi = evt.char ? glyphs.indexOf(evt.char) : -1;
    if (gi < 0 && bar) {
      const ch = evt.caseIndex ? bar.upper : bar.lower;
      gi = glyphs.indexOf(ch);
    }
    if (gi < 0) return null;
    const faceData = glyphs.face(gi);
    const baselineRow = glyphs.baselineV * N;
    const centreRowUp = 0.0012;       // the slug is struck about mid x-height, 1.2 mm above the baseline

    const slug = m.slug, platen = m.platen;
    const skew = evt.skewRad || 0;
    const maxIndent = evt.maxIndent > 0 ? evt.maxIndent : (evt.peakForce > 0 ? solveIndent(m, glyphs, gi, evt.peakForce, skew) : 0);

    // World strike frame: the bar always strikes the same fixed point on the frame, offset by case
    // (the slug's upper glyph sits one caseOffset higher) and by the bar's own alignment errors.
    const nHat = geo.printNormal;
    const xHat = [1, 0, 0];
    const tUp = this.Tup;
    const caseUp = (evt.caseIndex ? slug.caseOffset : 0);
    const lateral = evt.lateral || 0;
    const offX = bar ? bar.offsetX : 0, offY = bar ? bar.offsetY : 0;
    const o = [
      geo.printPoint[0] + lateral + offX,
      geo.printPoint[1] + caseUp + offY * tUp[1],
      geo.printPoint[2] + offY * tUp[2],
    ];

    // Pressure on the slug's own grid. The relief floor carries force once the indent exceeds the
    // relief (it is in the mechanism's F(delta) too), but it has no type face, so it never prints.
    const P = this.P, R = this.R, Col = this.Col;
    const gap = this.gap = faceGap(m, glyphs, faceData, skew, this.gap);
    let maxP = 0;
    for (let k = 0; k < N * N; k++) {
      const d = maxIndent - gap[k];
      if (d <= 0) { P[k] = 0; continue; }
      const p = slug.foundationKPerM2 * d;
      P[k] = faceData[k] > 0 ? p : 0;
    }
    for (let k = 0; k < N * N; k++) if (P[k] > maxP) maxP = P[k];

    // Ribbon availability on the slug's grid, from the real rope at the moment of the strike.
    const colorOffset = m.ribbon.width / 4;
    const rope = ribbon.queryAt(o[0], [o[0], o[1], o[2]]);
    const cs = Math.cos(skew), sn = Math.sin(skew);
    const halfW = ribbon.W / 2;
    let ribbonPresent = false;
    let rc = 0, rs = 0;
    if (rope) {
      rc = rope.up;
      rs = rope.s;
      if (F && evt.vibratorLift !== undefined && Math.abs(rope.nOff) < 0.008) {
        // Use the vibrator position at impact if the fork actually holds the ribbon.
        const atFork = F.forkOffsetAt(evt.vibratorLift);
        // rope.up is measured from the active glyph; the fork offsets from the home print point.
        const fromHome = rope.up + caseUp * tUp[1];
        if (Math.abs(fromHome - F.forkOffsetNow) < 0.002) rc += atFork - F.forkOffsetNow;
      }
      ribbonPresent = Math.abs(rope.nOff) < 0.01;
    }
    let covered = 0, pressed = 0;
    const inkHalf = m.paper.inkHalfPressure;
    for (let gy = 0; gy < N; gy++) {
      const bM = (baselineRow - gy) * tex - centreRowUp;
      for (let gx = 0; gx < N; gx++) {
        const k = gx + gy * N;
        if (P[k] <= 0) { R[k] = 0; Col[k] = 0; continue; }
        pressed++;
        if (!ribbonPresent) { R[k] = 0; continue; }
        const aM = (gx - (N - 1) / 2) * tex;
        const dX = aM * cs - bM * sn;
        const dY = aM * sn + bM * cs;
        const w = dY - rc;
        const s = rs + dX;
        if (Math.abs(w) > halfW) { R[k] = 0; continue; }
        const ink = ribbon.inkAt(s, w);
        const weave = ribbon.weave(s, w);
        R[k] = Math.max(0, ink * weave);
        Col[k] = w < 0 ? 1 : 0;       // red band is the lower half of the ribbon
        covered++;
      }
    }

    // Deposit on the sheet.
    // The frame's carriage can differ from the strike's (always in unlimited typing): find each strike on the sheet as it stood then.
    const locOrigin = F ? [o[0] + F.cx - (m.platen.center[0] + evt.carriageX), o[1], o[2]] : o;
    const loc = this.locateOnSheet(locOrigin, nHat, xHat, tUp);
    const inkQ = m.paper.inkPressureExponent;
    // Pressure plateaus once the relief floor bears, so cutting the paper also takes the blow's force behind it.
    const punches = (evt.peakForce ?? 0) > m.paper.perforationForce;
    const halfPressure = inkHalf, embossHalf = m.paper.embossHalfPressure, perfP = m.paper.perforationPressure;
    const fibre = m.paper.fibreScale;
    const W = this.texW, H = this.texH, ink = this.inkTexture.data;
    const colorMask = this.colorMask;
    const paperW = m.paper.width, paperH = m.paper.height;
    let inked = 0, sumInk = 0, perfThis = 0, depositW = 0, depositH = 0;
    const NN = N - 1;
    if (loc) {
      // Bounding box of the glyph image on the sheet in texture pixels.
      let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
      for (const cx of [0, NN]) for (const cy of [0, NN]) {
        const aM = (cx - NN / 2) * tex, bM = (baselineRow - cy) * tex - centreRowUp;
        const dX = aM * cs - bM * sn, dY = aM * sn + bM * cs;
        const u = loc.u0 + loc.axU * dX + loc.ayU * dY;
        const v = loc.v0 + loc.axV * dX + loc.ayV * dY;
        if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
      const toPx = this.pxPerM;
      const x0 = Math.max(0, Math.floor(minU * toPx) - 1), x1 = Math.min(W - 1, Math.ceil(maxU * toPx) + 1);
      const y0 = Math.max(0, Math.floor(minV * toPx) - 1), y1 = Math.min(H - 1, Math.ceil(maxV * toPx) + 1);
      const det = loc.axU * loc.ayV - loc.axV * loc.ayU;
      if (Math.abs(det) > 1e-9 && x1 >= x0 && y1 >= y0) {
        const invXU = loc.ayV / det, invXV = -loc.ayU / det, invYU = -loc.axV / det, invYV = loc.axU / det;
        for (let py = y0; py <= y1; py++) {
          for (let px = x0; px <= x1; px++) {
            const u = (px + 0.5) / toPx, v = (py + 0.5) / toPx;
            if (u < 0 || v < 0 || u > paperW || v > paperH) continue;
            const du = u - loc.u0, dv = v - loc.v0;
            const dX = du * invXU + dv * invXV;
            const dY = du * invYU + dv * invYV;
            const aM = dX * cs + dY * sn;
            const bM = -dX * sn + dY * cs;
            const gx = aM / tex + NN / 2;
            const gy = baselineRow - (bM + centreRowUp) / tex;
            if (gx < 0 || gy < 0 || gx >= NN || gy >= NN) continue;
            const ix = Math.floor(gx), iy = Math.floor(gy);
            const fx = gx - ix, fy = gy - iy;
            const a = ix + iy * N, b = a + 1, c = a + N, d = c + 1;
            const p = lerp4(P[a], P[b], P[c], P[d], fx, fy);
            if (p <= 0) continue;
            const r = lerp4(R[a], R[b], R[c], R[d], fx, fy);
            const col = lerp4(Col[a], Col[b], Col[c], Col[d], fx, fy);
            const fibreN = 1 - fibre + fibre * (0.6 * valueNoise(px * 0.33, py * 0.33) + 0.4 * hash2(px, py));
            const transfer = inkCurve(p, halfPressure, inkQ, r * fibreN);
            const k = (px + py * W) * 2;
            if (transfer > 0) {
              const nv = ink[k] + transfer * 255;
              ink[k] = nv > 255 ? 255 : nv;
              if (col > 0.5) {
                const cx2 = (px / COLOR_DOWNSAMPLE) | 0, cy2 = (py / COLOR_DOWNSAMPLE) | 0;
                colorMask.data[cx2 + cy2 * colorMask.width] = 255;
              }
              inked++; sumInk += transfer;
            }
            const emb = (1 - Math.exp(-LN2 * p / embossHalf)) * 200;
            if (ink[k + 1] !== 255) {
              if (punches && p > perfP * (0.95 + 0.1 * valueNoise(px * 0.21, py * 0.21))) { ink[k + 1] = 255; perfThis++; }
              else { const ne = ink[k + 1] + emb; ink[k + 1] = ne > 254 ? 254 : ne; }
            }
          }
        }
        this.inkTexture.dirty.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
        depositW = x1 - x0 + 1; depositH = y1 - y0 + 1;
        colorMask.dirty.push({ x: 0, y: 0, w: colorMask.width, h: colorMask.height });
      }
    }

    // Pressure-texels that did not fall on the sheet ink the bare platen.
    const pLen = m.platen.length;
    const pInk = this.platenInk;
    const platenRes = pInk.pxPerM;
    const beta0 = m.printPoint.beta;
    const psi = (F ? F.psi : evt.platenPsi) ?? 0;
    const cxWorld = m.platen.center[0] + evt.carriageX;
    let platenWrites = 0;
    let dirtyMin = pInk.width, dirtyMax = 0, dyMin = pInk.height, dyMax = 0;
    for (let gy = 0; gy < N; gy++) {
      const bM = (baselineRow - gy) * tex - centreRowUp;
      for (let gx = 0; gx < N; gx++) {
        const k = gx + gy * N;
        const p = P[k];
        if (p <= 0) continue;
        const aM = (gx - NN / 2) * tex;
        const dX = aM * cs - bM * sn, dY = aM * sn + bM * cs;
        if (loc) {
          const u = loc.u0 + loc.axU * dX + loc.ayU * dY, v = loc.v0 + loc.axV * dX + loc.ayV * dY;
          if (u >= 0 && v >= 0 && u <= paperW && v <= paperH) continue;
        }
        if (R[k] <= 0) continue;
        const wx = o[0] + xHat[0] * dX - cxWorld;
        const beta = beta0 + dY / platen.radius;
        const phi = ((beta - psi) / (2 * Math.PI)) % 1;
        const col = Math.floor((phi < 0 ? phi + 1 : phi) * pInk.width) % pInk.width;
        const row = Math.floor((wx + pLen / 2) * platenRes);
        if (row < 0 || row >= pInk.height) continue;
        const idx = col + row * pInk.width;
        const nv = pInk.data[idx] + (1 - Math.exp(-LN2 * p / halfPressure)) * R[k] * 200;
        pInk.data[idx] = nv > 255 ? 255 : nv;
        platenWrites++;
        if (col < dirtyMin) dirtyMin = col; if (col > dirtyMax) dirtyMax = col;
        if (row < dyMin) dyMin = row; if (row > dyMax) dyMax = row;
      }
    }
    if (platenWrites > 0) pInk.dirty.push({ x: dirtyMin, y: dyMin, w: dirtyMax - dirtyMin + 1, h: dyMax - dyMin + 1 });

    // Ribbon wear: remove ink only for texels the slug actually pressed.
    if (ribbonPresent) {
      const dep = m.ribbon.depletionPerStrike;
      const areaFactor = (tex * ribbon.pxPerM) * (tex * ribbon.pxPerM);
      for (let gy = 0; gy < N; gy++) {
        const bM = (baselineRow - gy) * tex - centreRowUp;
        for (let gx = 0; gx < N; gx++) {
          const k = gx + gy * N;
          if (P[k] <= 0 || R[k] <= 0) continue;
          const aM = (gx - (N - 1) / 2) * tex;
          const dX = aM * cs - bM * sn, dY = aM * sn + bM * cs;
          const w = dY - rc, s = rs + dX;
          const relP = 1 - Math.exp(-LN2 * P[k] / inkHalf);
          ribbon.deplete(s, w, dep * relP * areaFactor);
        }
      }
      ribbon.markDirty?.();
    }

    this.perforations += perfThis;
    capDirty(this.inkTexture); capDirty(colorMask); capDirty(pInk);
    const meanInk = inked > 0 ? sumInk / inked : 0;
    this.lastStrike = { glyph: gi, u: loc ? loc.u0 : null, v: loc ? loc.v0 : null, inked, meanInk, sumInk, maxPressure: maxP, covered, pressed, perforations: perfThis, onPaper: !!loc, ribbonCovered: covered > 0, depositW, depositH };
    return this.lastStrike;
  }
}

/** Dirty rects accumulate until the renderer drains them; collapse if nobody is listening. */
function capDirty(t) {
  if (t.dirty.length > 256) { t.dirty.length = 0; t.dirty.push({ x: 0, y: 0, w: t.width, h: t.height }); }
}

/**
 * Ink transferred vs pressure and the ink available at that texel (ribbon, weave, fibre). Under a firm strike the
 * exponential saturates, so the letter is solid and weave only shows where pressure or the ribbon is weak.
 */
function inkCurve(p, half, q, supply) { return 1 - Math.exp(-LN2 * Math.pow(p / half, q) * supply); }

function lerp4(a, b, c, d, fx, fy) {
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
  return ab + (cd - ab) * fy;
}

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Moller-Trumbore
function rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -0.001 || u > 1.001) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -0.001 || u + v > 1.002) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return { t, b1: u, b2: v };
}
