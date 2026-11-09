// Slug/platen contact law: pre-computed F(delta) and A(delta) for the actual glyph face, by
// integrating a Winkler foundation over the glyph height field. Includes slug skew (tilt about the
// strike axis) and the slug/platen curvature mismatch, per case band, per bar.
export const FACE_TABLE_N = 512;
export const FACE_TABLE_DD = 2.5e-6; // m per table entry

function fallbackGlyph(ch, N, texel) {
  // Used only when no glyph atlas is supplied (tests without assets, future machines).
  const h = new Uint8Array(N * N);
  const c = (N - 1) / 2;
  let outer, inner;
  if (ch === '.' || ch === ',') { outer = 0.42e-3; inner = 0; }
  else if (ch === ':' || ch === ';' || ch === "'" || ch === '-') { outer = 0.55e-3; inner = 0; }
  else if (ch === 'W' || ch === 'M' || ch === 'w' || ch === 'm' || ch === '@' || ch === '%') { outer = 1.9e-3; inner = 1.2e-3; }
  else { outer = 1.4e-3; inner = 0.95e-3; }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r = Math.hypot(i - c, j - c) * texel;
    if (r <= outer && r >= inner) h[j * N + i] = 255;
  }
  return h;
}

function glyphHeights(glyphs, ch) {
  if (glyphs?.data && glyphs.chars) {
    const i = glyphs.chars.indexOf(ch);
    const N = glyphs.N;
    if (i >= 0) return glyphs.data.subarray(i * N * N, (i + 1) * N * N);
  }
  return null;
}

/**
 * @returns {{force:Float32Array, energy:Float32Array, area:Float32Array, stride:number, kf:number}}
 * force[(bar*2+case)*N + j] = F (N) at indentation j*dd of the highest texel, energy = its integral (J), area
 * = contact area (m^2). Glyph data indexes per contract: 80 glyphs, N*N Uint8, 255 = printing face.
 */
export function buildFaceTables(machine, geometry, glyphs) {
  const { slug, platen } = machine;
  const N = glyphs?.N ?? 96;
  const texel = (glyphs?.texelMm ?? 0.05) * 1e-3;
  const dA = texel * texel;
  const tableN = FACE_TABLE_N, dd = FACE_TABLE_DD;
  const nFaces = geometry.nPrint * 2;
  const force = new Float32Array(nFaces * tableN);
  const energy = new Float32Array(nFaces * tableN);
  const area = new Float32Array(nFaces * tableN);
  const kf = slug.foundationKPerM2;
  const relief = slug.reliefDepth;
  const Rp = platen.radius, Rf = slug.faceRadius;
  const hist = new Float64Array(tableN + 2);
  const rawFallback = new Map();
  for (let b = 0; b < geometry.nPrint; b++) {
    const bar = geometry.bars[b];
    const tanSkew = Math.tan(bar.skew);
    for (let c = 0; c < 2; c++) {
      const ch = c === 0 ? bar.lower : bar.upper;
      let h = glyphHeights(glyphs, ch);
      if (!h) { if (!rawFallback.has(ch)) rawFallback.set(ch, fallbackGlyph(ch, N, texel)); h = rawFallback.get(ch); }
      const zs = new Float64Array(h.length);
      let zmin = Infinity;
      for (let j = 0, idx = 0; j < N; j++) {
        const v = (j - (N - 1) / 2) * texel;
        for (let i = 0; i < N; i++, idx++) {
          const u = (i - (N - 1) / 2) * texel;
          // Curvature mismatch relative to the platen, in the plane of the glyph (v) only. The platen is
          // a cylinder with its axis along x (u), so the face is curved only in v, about the band centre.
          const zc = (v * v * (1 / Rp - 1 / Rf)) / 2;
          const z = relief * (1 - h[idx] / 255) + zc + tanSkew * u;
          zs[idx] = z;
          if (h[idx] > 0 && z < zmin) zmin = z;
        }
      }
      if (!isFinite(zmin)) zmin = 0;
      hist.fill(0);
      for (let idx = 0; idx < zs.length; idx++) {
        const z = zs[idx] - zmin;
        // Foundation sees relief floor texels too, only where the face actually exists. Texels with h==0
        // (relief floor) are included: they load the rubber once indentation exceeds the relief.
        let bin = Math.ceil(z / dd);
        if (bin < 0) bin = 0;
        if (bin <= tableN) hist[bin] += dA;
      }
      const base = (b * 2 + c) * tableN;
      let A = 0, F = 0, U = 0;
      for (let j = 0; j < tableN; j++) {
        A += hist[j];
        force[base + j] = F;
        energy[base + j] = U;
        area[base + j] = A;
        const F2 = F + kf * A * dd;
        U += (F + F2) * 0.5 * dd;
        F = F2;
      }
    }
  }
  return { force, energy, area, stride: tableN, kf, n: nFaces, dd };
}
