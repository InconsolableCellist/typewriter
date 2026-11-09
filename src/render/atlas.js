// Key legends and slug face atlases, drawn from the baked glyph height fields so that what is printed on
// a key is the same type as the type on its slug.
import * as THREE from 'three';

function glyphSlice(glyphs, ch) {
  const i = glyphs.chars.indexOf(ch);
  return i < 0 ? null : glyphs.data.subarray(i * glyphs.N * glyphs.N, (i + 1) * glyphs.N * glyphs.N);
}

function drawGlyph(ctx, glyphs, ch, x, y, w, h, color) {
  const hf = glyphSlice(glyphs, ch);
  if (!hf) return;
  const N = glyphs.N;
  const tmp = (drawGlyph._c ||= document.createElement('canvas'));
  tmp.width = N; tmp.height = N;
  const tc = tmp.getContext('2d');
  const img = tc.createImageData(N, N);
  const c = new THREE.Color(color);
  for (let i = 0; i < N * N; i++) {
    img.data[i * 4] = c.r * 255; img.data[i * 4 + 1] = c.g * 255; img.data[i * 4 + 2] = c.b * 255;
    img.data[i * 4 + 3] = hf[i];
  }
  tc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, x, y, w, h);
}

export function createAtlases(glyphs, geometry) {
  // Key caps: one 128px cell per key.
  const cell = 128, cols = 8;
  const rows = Math.ceil(geometry.nKeys / cols);
  const can = document.createElement('canvas');
  can.width = cols * cell; can.height = rows * cell;
  const ctx = can.getContext('2d');
  ctx.fillStyle = '#0a0a0b'; ctx.fillRect(0, 0, can.width, can.height);
  const cells = new Map();
  geometry.keys.forEach((k, i) => {
    const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell;
    cells.set(k.id, { x: cx / can.width, y: 1 - (cy + cell) / can.height, w: cell / can.width, h: cell / can.height });
    const fg = '#e9e3d2';
    if (k.kind === 'print') {
      const isLetter = /[a-z]/.test(k.lower);
      if (isLetter) {
        drawGlyph(ctx, glyphs, k.upper, cx + 26, cy + 24, 76, 76, fg);
      } else {
        drawGlyph(ctx, glyphs, k.upper, cx + 34, cy + 10, 60, 60, fg);
        drawGlyph(ctx, glyphs, k.lower, cx + 34, cy + 58, 60, 60, fg);
      }
    } else {
      const label = { shiftL: 'SHIFT', shiftR: 'SHIFT', shiftLock: 'LOCK', backspace: 'BACK', marginRelease: 'MAR\nREL' }[k.id] ?? k.id;
      ctx.fillStyle = fg; ctx.font = '700 28px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      label.split('\n').forEach((line, n, a) => ctx.fillText(line, cx + cell / 2, cy + cell / 2 + (n - (a.length - 1) / 2) * 30));
    }
  });
  const keys = new THREE.CanvasTexture(can);
  keys.colorSpace = THREE.SRGBColorSpace; keys.anisotropy = 8; keys.generateMipmaps = true;

  // Slug faces at true scale. A cell is the face: 8.8 mm along the bar (the atlas's horizontal axis, which is the face
  // mesh's u) by 3.2 mm across, with the glyph tiles at their real size and case offset.
  const pxPerMm = 40, faceL = 8.8, faceW = 3.2;
  const sw = Math.round(faceL * pxPerMm), sh = Math.round(faceW * pxPerMm), scols = 8, srows = Math.ceil(geometry.nPrint / scols);
  const tile = glyphs.N * glyphs.texelMm * pxPerMm;
  const can2 = document.createElement('canvas');
  can2.width = scols * sw; can2.height = srows * sh;
  const c2 = can2.getContext('2d');
  c2.fillStyle = '#1c1d1f'; c2.fillRect(0, 0, can2.width, can2.height);
  const slugCells = [];
  const caseOffPx = 4.2 * pxPerMm;
  geometry.bars.forEach((b, i) => {
    const cx = (i % scols) * sw, cy = Math.floor(i / scols) * sh;
    slugCells[b.index] = [cx / can2.width, 1 - (cy + sh) / can2.height, sw / can2.width, sh / can2.height];
    c2.save();
    c2.beginPath(); c2.rect(cx, cy, sw, sh); c2.clip();
    // Cell left is the tip of the bar, which is the top of the glyph in the print; the transpose is what mirrors the type.
    const across = Math.sign(b.axis[0]) || 1;
    const stamp = (ch, centreX) => {
      c2.setTransform(0, across, 1, 0, centreX, cy + sh / 2);
      drawGlyph(c2, glyphs, ch, -tile / 2, -tile / 2, tile, tile, '#f0f1f3');
    };
    stamp(b.lower, cx + sw / 2 + caseOffPx / 2);   // the lower-case glyph is the one nearer the pivot
    stamp(b.upper, cx + sw / 2 - caseOffPx / 2);
    c2.restore();
  });
  const slugs = new THREE.CanvasTexture(can2);
  slugs.colorSpace = THREE.SRGBColorSpace; slugs.anisotropy = 4;

  return {
    keys, slugs,
    keyCell: (k) => cells.get(k.id),
    slugCell: (b) => slugCells[b.index],
  };
}
