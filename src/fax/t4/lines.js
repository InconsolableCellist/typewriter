// Scan lines as changing elements, the representation both coders work in.
//
// A bitmap row is packed eight pels to a byte, the first pel in the most significant bit, 1 = black (as TIFF with
// PhotometricInterpretation 0, WhiteIsZero). A line's changing elements are the positions where the colour differs
// from the pel before it, the line being taken to start white (T.4 4.2.1.3.1, "imaginary white element"): even
// indices are white-to-black changes, odd ones black-to-white. After the n changes the array holds `width` twice
// more as sentinels, so b1 and b2 always exist. Pure module.

/** Bytes in one packed row. */
export const strideOf = (width) => (width + 7) >>> 3;

/** Allocate a changing-element array for a line of `width` pels (room for every change plus sentinels). */
export const allocChanges = (width) => new Int32Array(width + 4);

/**
 * Fill `out` with the changing elements of the packed row at src[off ...]; returns their number n and writes the
 * sentinels out[n] = out[n + 1] = out[n + 2] = width.
 */
export function rowToChanges(src, off, width, out) {
  let n = 0;
  let color = 0; // colour of the pel before x
  const fullBytes = width >>> 3;
  let x = 0;
  for (let i = 0; i < fullBytes; i++, x += 8) {
    const b = src[off + i];
    if (color === 0 ? b === 0 : b === 0xff) continue;
    for (let k = 0; k < 8; k++) {
      const p = (b >>> (7 - k)) & 1;
      if (p !== color) {
        out[n++] = x + k;
        color = p;
      }
    }
  }
  if (width & 7) {
    const b = src[off + fullBytes];
    for (let k = 0; x + k < width; k++) {
      const p = (b >>> (7 - k)) & 1;
      if (p !== color) {
        out[n++] = x + k;
        color = p;
      }
    }
  }
  out[n] = width;
  out[n + 1] = width;
  out[n + 2] = width;
  return n;
}

/** Set pels [from, to) of the packed row at dst[off ...] to black. */
export function setRun(dst, off, from, to) {
  if (from >= to) return;
  let i = off + (from >>> 3);
  const last = off + ((to - 1) >>> 3);
  const headMask = 0xff >>> (from & 7);
  const tailMask = (0xff << (7 - ((to - 1) & 7))) & 0xff;
  if (i === last) {
    dst[i] |= headMask & tailMask;
    return;
  }
  dst[i++] |= headMask;
  while (i < last) dst[i++] = 0xff;
  dst[last] |= tailMask;
}

/** Write a line given by n changing elements into the packed row at dst[off ...] (clears it first). */
export function changesToRow(changes, n, width, dst, off) {
  dst.fill(0, off, off + strideOf(width));
  for (let i = 0; i < n; i += 2) {
    const to = i + 1 < n ? changes[i + 1] : width;
    setRun(dst, off, changes[i], to);
  }
}
