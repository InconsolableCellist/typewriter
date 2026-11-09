// Page capture and composition. Pure typed-array code with no DOM, shared by the main thread and the encode worker.
//
// Ink row order: printer row y is sheet v (0 at the leading, top edge) and column x is sheet u (world +x, the typist's
// right), so row 0, column 0 is the top-left of the page as read. The image needs no flip or mirror.

// Bytes are R,G,R,G... (ink, emboss). Testing one 32-bit word covers two texels; 0xF0 in R is ink of 16/255 or more.
const WORD_HAS_INK = 0x00f000f0;

/**
 * Copies the rows of the sheet that carry ink. The scan stops at the first inked word from each end, and only those
 * rows are copied, so a typical page costs a few milliseconds even at full size.
 * @returns a snapshot with owned, transferable buffers, or null if the sheet has no real ink.
 */
export function captureSheet(ink, mask) {
  const { data, width, height } = ink;
  const rowBytes = width * 2;
  const words = new Uint32Array(data.buffer, data.byteOffset, data.length >>> 2);
  let first = -1;
  for (let i = 0; i < words.length; i++) if (words[i] & WORD_HAS_INK) { first = i; break; }
  if (first < 0) return null;
  let last = first;
  for (let i = words.length - 1; i > first; i--) if (words[i] & WORD_HAS_INK) { last = i; break; }
  const rowStart = Math.floor((first * 4) / rowBytes);
  const rowEnd = Math.min(height - 1, Math.floor((last * 4 + 3) / rowBytes));
  const snapshot = {
    width, height, rowStart, rowCount: rowEnd - rowStart + 1,
    ink: data.slice(rowStart * rowBytes, (rowEnd + 1) * rowBytes),
    mask: null,
  };
  if (mask) {
    const ds = mask.downsample, m0 = Math.floor(rowStart / ds), m1 = Math.min(mask.height - 1, Math.floor(rowEnd / ds));
    snapshot.mask = { width: mask.width, height: mask.height, downsample: ds, rowStart: m0, data: mask.data.slice(m0 * mask.width, (m1 + 1) * mask.width) };
  }
  return snapshot;
}

export const PAPER_RGB = [255, 255, 255];
export const INK_RGB = [26, 25, 29];
export const RED_RGB = [168, 32, 32];

/** Ink coverage of a texel, as the sheet's own shader draws it (paper-view.js: smoothstep(0.02, 0.6, ink)). */
function coverage(v) {
  const t = Math.min(1, Math.max(0, (v / 255 - 0.02) / 0.58));
  return t * t * (3 - 2 * t);
}

/** Per-ink-value RGBA words (little-endian, the byte order of ImageData), over paper. */
function makeLut(rgb) {
  const lut = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    const a = coverage(v);
    const c = (i) => Math.round(PAPER_RGB[i] + (rgb[i] - PAPER_RGB[i]) * a);
    lut[v] = (0xff000000 | (c(2) << 16) | (c(1) << 8) | c(0)) >>> 0;
  }
  return lut;
}

const DARK_LUT = makeLut(INK_RGB), RED_LUT = makeLut(RED_RGB);

/** The whole page as RGBA, row 0 at the top. Paper white, ink dark, red-band ink red. */
export function composePage(snapshot) {
  const { width, height, rowStart, rowCount, ink, mask } = snapshot;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const px = new Uint32Array(rgba.buffer);
  px.fill(DARK_LUT[0]);
  const ds = mask?.downsample ?? 1;
  for (let r = 0, k = 0; r < rowCount; r++) {
    const y = rowStart + r;
    const my = mask ? (y / ds | 0) - mask.rowStart : 0;
    let o = y * width;
    for (let x = 0; x < width; x++, k += 2, o++) {
      const v = ink[k];
      if (v === 0) continue;
      const red = mask !== null && mask.data[(x / ds | 0) + my * mask.width] > 0;
      px[o] = red ? RED_LUT[v] : DARK_LUT[v];
    }
  }
  return { rgba, width, height };
}
