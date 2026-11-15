// A stand-in for T.4 page data while src/fax/t4/ is being written: a stream with the shape of a Group 3 page (an EOL
// before every line, fill bits padding each line to the negotiated minimum scan line time, RTC at the end) and a
// self-checking payload, so a receiver can count bad lines after bit errors. It is NOT Modified Huffman; the T.30
// layer only needs "some bits, so many lines, which lines were damaged". M3/M4 replace it with the real codec
// behind the same two calls:
//
//   source.pageBits(index, params) -> Uint8Array of 0/1      params: { rate, fine, twoD, scanMs, width }
//   checker(bits, params) -> { lines, badLines, maxConsecutiveBad }
//
// Line format: EOL (eleven 0s and a 1, as T.4), then the payload with every bit b written as the pair 1 b (so the
// payload never holds two 0s in a row and cannot imitate an EOL), then 0s of fill. Payload: a 12-bit line number,
// `dataBits` bits of pseudo-random picture, an 8-bit check (sum of the picture's octets, mod 256).

export const EOL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
export const RTC_EOLS = 6;
/** Lines of an A4 page: 1145 at 3.85 lines/mm and 2290 at 7.7 [S WP-FAX; fine is twice]. */
export const A4_LINES = Object.freeze({ standard: 1145, fine: 2290 });

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

const pushPayloadBit = (out, b) => { out.push(1, b); };

/** Bits of one stub line's payload (without EOL or fill). */
function linePayload(lineNo, dataBits, rand) {
  const out = [];
  for (let k = 11; k >= 0; k--) pushPayloadBit(out, (lineNo >>> k) & 1);
  let sum = 0, octet = 0;
  for (let i = 0; i < dataBits; i++) {
    const b = rand() < 0.5 ? 1 : 0;
    pushPayloadBit(out, b);
    octet |= b << (i & 7);
    if ((i & 7) === 7) { sum = (sum + octet) & 0xff; octet = 0; }
  }
  sum = (sum + octet) & 0xff;
  for (let k = 7; k >= 0; k--) pushPayloadBit(out, (sum >>> k) & 1);
  return out;
}

/**
 * A page source of `pages` stub pages. `lines` defaults to A4 at the negotiated vertical resolution; `dataBits`
 * sets how much "picture" a line carries (80 gives 200 payload bits a line, a little over the 192 bits that 20 ms
 * takes at 9600 bit/s, so fill appears at the lower minimum times).
 */
export function stubSource({ pages = 1, lines = null, dataBits = 80, seed = 1 } = {}) {
  return {
    pageCount: pages,
    pageBits(index, params = {}) {
      const rate = params.rate ?? 9600;
      const n = lines ?? (params.fine ? A4_LINES.fine : A4_LINES.standard);
      const minBits = Math.ceil((rate * (params.scanMs ?? 20)) / 1000);
      const rand = rng(seed * 7919 + index * 104729 + 1);
      const out = [];
      for (let ln = 0; ln < n; ln++) {
        const start = out.length;
        out.push(...EOL_BITS);
        const p = linePayload(ln & 0xfff, dataBits, rand);
        for (let i = 0; i < p.length; i++) out.push(p[i]);
        // Fill goes before the next EOL; the line's time is counted from its EOL to the next.
        while (out.length - start < minBits) out.push(0);
      }
      for (let i = 0; i < RTC_EOLS; i++) out.push(...EOL_BITS);
      return Uint8Array.from(out);
    },
  };
}

/** The checker for stubSource pages. A line is bad if its payload is malformed, its check fails or it is out of order. */
export function stubChecker({ dataBits = 80 } = {}) {
  const payloadLen = 2 * (12 + dataBits + 8);
  return function check(bits) {
    // Split on EOLs: a 1 preceded by at least eleven 0s.
    const segs = [];
    let zeros = 0, segStart = -1;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i]) {
        if (zeros >= 11) {
          if (segStart >= 0) segs.push([segStart, i - 11]);
          segStart = i + 1;
        }
        zeros = 0;
      } else zeros++;
    }
    if (segStart >= 0 && segStart < bits.length) segs.push([segStart, bits.length]);
    let lines = 0, bad = 0, run = 0, maxRun = 0, expect = 0, empties = 0;
    const markBad = () => { bad++; run++; if (run > maxRun) maxRun = run; };
    for (const [s, e] of segs) {
      if (e - s <= 0) { if (++empties >= RTC_EOLS - 1) break; continue; } // RTC
      empties = 0;
      lines++;
      const r = readLine(bits, s, e, payloadLen, dataBits);
      if (!r) { markBad(); expect++; continue; }
      if (r.lineNo !== (expect & 0xfff)) {
        // Lines lost in between (an EOL destroyed by an error) count as bad.
        const missed = (r.lineNo - expect) & 0xfff;
        if (missed > 0 && missed < 64) { for (let k = 0; k < missed; k++) markBad(); lines += missed; expect += missed; }
        else { markBad(); expect++; continue; }
      }
      expect++;
      run = 0;
    }
    return { lines, badLines: bad, maxConsecutiveBad: maxRun };
  };
}

function readLine(bits, s, e, payloadLen, dataBits) {
  if (e - s < payloadLen) return null;
  for (let i = s + payloadLen; i < e; i++) if (bits[i]) return null; // fill must be zeros
  const v = [];
  for (let i = 0; i < payloadLen; i += 2) { if (bits[s + i] !== 1) return null; v.push(bits[s + i + 1]); }
  let lineNo = 0;
  for (let k = 0; k < 12; k++) lineNo = (lineNo << 1) | v[k];
  let sum = 0, octet = 0;
  for (let i = 0; i < dataBits; i++) {
    octet |= v[12 + i] << (i & 7);
    if ((i & 7) === 7) { sum = (sum + octet) & 0xff; octet = 0; }
  }
  sum = (sum + octet) & 0xff;
  let got = 0;
  for (let k = 0; k < 8; k++) got = (got << 1) | v[12 + dataBits + k];
  return got === sum ? { lineNo } : null;
}
