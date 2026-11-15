// A minimal TIFF writer for one fax page: a single strip of T.4 (Compression 3) or T.6 (Compression 4) data, as
// TIFF 6.0 Section 11 lays out, so that a page this module coded opens in any TIFF viewer and in libtiff.
// PhotometricInterpretation 0 (WhiteIsZero): a 1 in the bitmap and a black run in the code are both black.
// Pure module.

const TYPE = { SHORT: 3, LONG: 4, RATIONAL: 5 };

/**
 * @param {Uint8Array} strip the coded page
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {'mh'|'mr'|'mmr'} o.coding
 * @param {boolean} [o.alignEol] T4Options bit 2 (EOLs byte-aligned)
 * @param {'lsb'|'msb'} [o.bitOrder] FillOrder 2 or 1
 * @param {number} [o.xdpi] 204 for Group 3
 * @param {number} [o.ydpi] 98 (standard) or 196 (fine)
 * @returns {Uint8Array}
 */
export function wrapTiff(strip, { width, height, coding, alignEol = false, bitOrder = 'lsb', xdpi = 204, ydpi = 98 }) {
  const entries = [
    [256, TYPE.LONG, width],
    [257, TYPE.LONG, height],
    [258, TYPE.SHORT, 1],
    [259, TYPE.SHORT, coding === 'mmr' ? 4 : 3],
    [262, TYPE.SHORT, 0],
    [266, TYPE.SHORT, bitOrder === 'lsb' ? 2 : 1],
    [273, TYPE.LONG, 0], // strip offset, patched below
    [277, TYPE.SHORT, 1],
    [278, TYPE.LONG, height],
    [279, TYPE.LONG, strip.length],
    [282, TYPE.RATIONAL, xdpi],
    [283, TYPE.RATIONAL, ydpi],
    [coding === 'mmr' ? 293 : 292, TYPE.LONG, coding === 'mr' ? 1 | (alignEol ? 4 : 0) : alignEol ? 4 : 0],
    [296, TYPE.SHORT, 2],
  ];
  const ifdOff = 8;
  const ifdLen = 2 + entries.length * 12 + 4;
  const ratOff = ifdOff + ifdLen;
  const nRat = entries.filter((e) => e[1] === TYPE.RATIONAL).length;
  const stripOff = ratOff + nRat * 8;
  const out = new Uint8Array(stripOff + strip.length);
  const dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; // 'II'
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, entries.length, true);
  let p = ifdOff + 2;
  let r = ratOff;
  for (const [tag, type, value] of entries) {
    dv.setUint16(p, tag, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, 1, true);
    if (type === TYPE.SHORT) dv.setUint16(p + 8, value, true);
    else if (type === TYPE.LONG) dv.setUint32(p + 8, tag === 273 ? stripOff : value, true);
    else {
      dv.setUint32(p + 8, r, true);
      dv.setUint32(r, value, true);
      dv.setUint32(r + 4, 1, true);
      r += 8;
    }
    p += 12;
  }
  dv.setUint32(p, 0, true); // no next IFD
  out.set(strip, stripOff);
  return out;
}
