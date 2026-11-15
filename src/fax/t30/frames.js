// T.30 frames: the facsimile control field (FCF) codes and the information fields (FIF) of the frames the Group 3
// base procedure uses. Pure data and functions; no DOM, timers or clock.
//
// SOURCES. The Recommendation could not be fetched in the session that wrote this (docs/fax/research.md section 1).
// Every code and bit position below is marked [M]: from memory of T.30, the 1993 to 1996 editions (plan.md P5; the
// base procedure is the 1988 one, the extended DIS bits 25 to 48 are from the later texts), believed right, to be
// checked against the text in milestone M0.
//
// Non-standard frames (NSF, NSS, NSC) are decoded as frames and their content kept as opaque octets; nothing reads
// them. The FO-70 never sends one (plan.md P4); a virtual far end may, to test that they are skipped.
//
// BIT ORDER. T.30 writes an FCF as eight bits in transmission order, first bit on the left, e.g. DIS = 0000 0001.
// HDLC sends each octet least significant bit first, so the octet value is the written pattern reversed:
// DIS = 0x80. In command and response frames the first bit is "X": 1 in frames from the station that received a
// valid DIS (the calling station, normally), 0 in frames from the other one [M]; X is the octet's bit 0 (0x01).
// The six initial-identification frames (DIS, CSI, NSF, DTC, CIG, NSC) have no X bit: their first bit is part of
// the code.
//
// FIF bit n (the Recommendation's "bit n" of DIS/DTC/DCS) is octet (n - 1) >> 3, mask 1 << ((n - 1) & 7): bit 1
// is the first bit on the line.

import { ADDRESS, CONTROL, CONTROL_FINAL } from '../hdlc.js';

/** FCF octet values with X = 0 [M]. Written form (line order) in the comment. */
export const FCF = Object.freeze({
  // Initial identification, from the called station (or the polling station for DTC/CIG/NSC). No X bit.
  DIS: 0x80,      // 0000 0001  digital identification signal
  CSI: 0x40,      // 0000 0010  called subscriber identification
  NSF: 0x20,      // 0000 0100  non-standard facilities
  DTC: 0x81,      // 1000 0001  digital transmit command (polling)
  CIG: 0x41,      // 1000 0010  calling subscriber identification
  NSC: 0x21,      // 1000 0100  non-standard facilities command
  // Commands to send.
  DCS: 0x82,      // X100 0001  digital command signal
  TSI: 0x42,      // X100 0010  transmitting subscriber identification
  NSS: 0x22,      // X100 0100  non-standard set-up
  // Pre-message responses.
  CFR: 0x84,      // X010 0001  confirmation to receive
  FTT: 0x44,      // X010 0010  failure to train
  // Post-message commands.
  EOM: 0x8e,      // X111 0001  end of message (back to phase B)
  MPS: 0x4e,      // X111 0010  multi-page signal (next page, same mode)
  EOP: 0x2e,      // X111 0100  end of procedure
  'PRI-EOM': 0x9e, // X111 1001  procedure interrupt variants: as EOM/MPS/EOP, operator wanted
  'PRI-MPS': 0x5e, // X111 1010
  'PRI-EOP': 0x3e, // X111 1100
  // Post-message responses.
  MCF: 0x8c,      // X011 0001  message confirmation
  RTP: 0xcc,      // X011 0011  retrain positive (page good, retrain before the next)
  RTN: 0x4c,      // X011 0010  retrain negative (page not good enough)
  PIP: 0xac,      // X011 0101  procedure interrupt positive (encoded only)
  PIN: 0x2c,      // X011 0100  procedure interrupt negative (encoded only)
  // Other line control.
  DCN: 0xfa,      // X101 1111  disconnect
  CRP: 0x1a,      // X101 1000  command repeat
});

const NO_X = new Set(['DIS', 'CSI', 'NSF', 'DTC', 'CIG', 'NSC']);
const BY_CODE = new Map();
for (const [name, code] of Object.entries(FCF)) BY_CODE.set(code, name);

/** Frames that carry the 20-character subscriber identification. */
export const IDENT_FRAMES = new Set(['CSI', 'TSI', 'CIG']);
/** Frames whose FIF is the DIS/DTC/DCS bit map. */
export const CAPS_FRAMES = new Set(['DIS', 'DTC', 'DCS']);
export const POST_MESSAGE_COMMANDS = new Set(['EOM', 'MPS', 'EOP', 'PRI-EOM', 'PRI-MPS', 'PRI-EOP']);

/** The octets of a frame without FCS: address, control, FCF, FIF. */
export function encodeFrame({ name, x = 0, final = true, fif = null }) {
  const code = FCF[name];
  if (code === undefined) throw new Error(`unknown T.30 frame ${name}`);
  const n = fif ? fif.length : 0;
  const out = new Uint8Array(3 + n);
  out[0] = ADDRESS;
  out[1] = final ? CONTROL_FINAL : CONTROL;
  out[2] = NO_X.has(name) ? code : code | (x ? 1 : 0);
  if (n) out.set(fif, 3);
  return out;
}

/**
 * Parse address .. FIF octets (FCS already removed). Returns { name, x, final, fif, valid } where name is null for
 * an unknown FCF and valid is false when the address or control octet is not T.30's.
 */
export function decodeFrame(bytes) {
  if (!bytes || bytes.length < 3) return { name: null, x: 0, final: false, fif: new Uint8Array(0), valid: false };
  const address = bytes[0], control = bytes[1], fcf = bytes[2];
  let name = null, x = 0;
  const exact = BY_CODE.get(fcf);
  if (exact && NO_X.has(exact)) name = exact;
  else {
    const n = BY_CODE.get(fcf & 0xfe);
    if (n && !NO_X.has(n)) { name = n; x = fcf & 1; }
  }
  const valid = address === ADDRESS && (control === CONTROL || control === CONTROL_FINAL);
  return { name, x, final: control === CONTROL_FINAL, fif: bytes.slice(3), valid, fcf };
}

// ---------------------------------------------------------------------------------------------------------------
// Subscriber identification (CSI, TSI, CIG): 20 octets of ITU T.50 (ASCII) digits, '+' and space. The number is
// sent last character first, padded with spaces, so the FIF read backwards is the number followed by spaces [M].

export const IDENT_LENGTH = 20;

export function encodeIdent(ident) {
  const s = String(ident ?? '').slice(0, IDENT_LENGTH).padEnd(IDENT_LENGTH, ' ');
  const out = new Uint8Array(IDENT_LENGTH);
  for (let i = 0; i < IDENT_LENGTH; i++) out[IDENT_LENGTH - 1 - i] = s.charCodeAt(i) & 0x7f;
  return out;
}

export function decodeIdent(fif) {
  let s = '';
  for (let i = fif.length - 1; i >= 0; i--) s += String.fromCharCode(fif[i]);
  return s.trimEnd();
}

// ---------------------------------------------------------------------------------------------------------------
// DIS / DTC / DCS information field. One table of bit positions; a multi-bit field's code is written as the
// Recommendation writes it, bit with the lowest number first (rates "bits 11, 12, 13, 14 = 1 0 0 0" means bit 11 set).
// All [M].

/**
 * Bit positions and meanings, 1-based as in the Recommendation. `len` > 1 is a code field. Bits 1 to 24 are the
 * 1988 base; 25 to 48 are as the 1993 to 1996 editions give them (plan.md, "Changes for the protocol work", P2 and
 * P5). Every octet after the third is present only when the previous octet's last bit (24, 32, 40, ...) is set.
 * Bits past 48 are kept as raw octets and never interpreted. All [M].
 */
export const CAPS_BITS = Object.freeze([
  { bit: 1, len: 8, name: 'reserved1to8', dis: 'reserved in the base procedure (later editions use some: T.37, T.38, V.8)', dcs: 'reserved', memory: true },
  { bit: 9, len: 1, name: 'readyToTransmit', dis: 'transmitter has a document ready to be polled', dcs: 'set to 0', memory: true },
  { bit: 10, len: 1, name: 'canReceive', dis: 'receiver fax operation (T.4) available', dcs: 'receiver fax operation (set to 1)', memory: true },
  { bit: 11, len: 4, name: 'rate', dis: 'data signalling rates the receiver can take (DIS_RATE_CODES)', dcs: 'the rate chosen (DCS_RATE_CODES)', memory: true },
  { bit: 15, len: 1, name: 'fine', dis: 'can receive 7.7 lines/mm', dcs: '7.7 lines/mm in use (0: 3.85)', memory: true },
  { bit: 16, len: 1, name: 'twoD', dis: 'two-dimensional coding (Modified READ) capable', dcs: 'two-dimensional coding in use', memory: true },
  { bit: 17, len: 2, name: 'width', dis: 'recording widths (DIS_WIDTH_CODES)', dcs: 'width in use (DCS_WIDTH_CODES)', memory: true },
  { bit: 19, len: 2, name: 'length', dis: 'maximum recording length (DIS_LENGTH_CODES)', dcs: 'length in use (DCS_LENGTH_CODES)', memory: true },
  { bit: 21, len: 3, name: 'scan', dis: 'minimum scan line time of the receiver (DIS_SCAN_CODES)', dcs: 'minimum scan line time in use (DCS_SCAN_CODES)', memory: true },
  { bit: 24, len: 1, name: 'extend24', dis: 'extend field: octet 4 follows', dcs: 'extend field', memory: true },
  { bit: 25, len: 1, name: 'reserved25', dis: 'reserved (2400 bit/s handshaking)', dcs: 'reserved', memory: true },
  { bit: 26, len: 1, name: 'uncompressed', dis: 'uncompressed mode capable', dcs: 'uncompressed mode', memory: true },
  { bit: 27, len: 1, name: 'ecm', dis: 'error correction mode capable (T.30 Annex A)', dcs: 'error correction mode', memory: true },
  { bit: 28, len: 1, name: 'frame64', dis: 'set to 0', dcs: 'ECM frame size: 0 = 256 octets, 1 = 64 octets', memory: true },
  { bit: 29, len: 1, name: 'reserved29', dis: 'reserved (error limiting mode)', dcs: 'reserved', memory: true },
  { bit: 30, len: 1, name: 'reserved30', dis: 'reserved (Group 4 facilities)', dcs: 'reserved', memory: true },
  { bit: 31, len: 1, name: 't6', dis: 'T.6 (MMR) coding capable', dcs: 'T.6 coding in use', memory: true },
  { bit: 32, len: 1, name: 'extend32', dis: 'extend field: octet 5 follows', dcs: 'extend field', memory: true },
  { bit: 33, len: 1, name: 'widthValidity', dis: 'validity of bits 17 and 18', dcs: 'recording width indicated by bits 17 and 18', memory: true },
  { bit: 34, len: 1, name: 'width1216', dis: 'recording width 1216 pels in 151 mm', dcs: 'the same, in use', memory: true },
  { bit: 35, len: 1, name: 'width864', dis: 'recording width 864 pels in 107 mm', dcs: 'the same, in use', memory: true },
  { bit: 36, len: 1, name: 'width1728in151', dis: 'recording width 1728 pels in 151 mm', dcs: 'the same, in use', memory: true },
  { bit: 37, len: 1, name: 'width1728in107', dis: 'recording width 1728 pels in 107 mm', dcs: 'the same, in use', memory: true },
  { bit: 38, len: 1, name: 'reserved38', dis: 'reserved', dcs: 'reserved', memory: true },
  { bit: 39, len: 1, name: 'reserved39', dis: 'reserved', dcs: 'reserved', memory: true },
  { bit: 40, len: 1, name: 'extend40', dis: 'extend field: octet 6 follows', dcs: 'extend field', memory: true },
  { bit: 41, len: 1, name: 'superFine', dis: 'can receive R8 x 15.4 lines/mm (super fine)', dcs: 'R8 x 15.4 lines/mm in use', memory: true },
  { bit: 42, len: 1, name: 'res300', dis: '300 x 300 pels/25.4 mm', dcs: 'the same, in use', memory: true },
  { bit: 43, len: 1, name: 'res400', dis: 'R16 x 15.4 lines/mm and/or 400 x 400 pels/25.4 mm', dcs: 'the same, in use', memory: true },
  { bit: 44, len: 1, name: 'inchPreferred', dis: 'inch-based resolution preferred', dcs: 'resolution type: inch-based', memory: true },
  { bit: 45, len: 1, name: 'metricPreferred', dis: 'metric-based resolution preferred', dcs: 'reserved', memory: true },
  { bit: 46, len: 1, name: 'scanHalfAtHigher', dis: 'minimum scan line time at the higher resolutions: 0 = as at 7.7 lines/mm, 1 = half that', dcs: 'reserved', memory: true },
  { bit: 47, len: 1, name: 'selectivePolling', dis: 'selective polling capable', dcs: 'reserved', memory: true },
  { bit: 48, len: 1, name: 'extend48', dis: 'extend field: octet 7 follows', dcs: 'extend field', memory: true },
]);
const BIT = Object.fromEntries(CAPS_BITS.map((b) => [b.name, b]));
/** The one-bit fields after the third octet that build and parse by name (extend bits are managed, not set). */
const OPTION_BITS = CAPS_BITS.filter((b) => b.bit > 24 && b.len === 1 && !b.name.startsWith('extend') && !b.name.startsWith('reserved'));
const DECODED_OCTETS = 6;   // bits 1 to 48

/** DIS/DTC bits 11-14: what the receiver can demodulate [M]. V.17 codes are decoded but reserved for later. */
export const DIS_RATE_CODES = Object.freeze({
  '0000': { modems: ['V.27ter fall-back'], rates: [2400] },
  '0100': { modems: ['V.27ter'], rates: [4800, 2400] },
  '1000': { modems: ['V.29'], rates: [9600, 7200] },
  '1100': { modems: ['V.27ter', 'V.29'], rates: [9600, 7200, 4800, 2400] },
  '1101': { modems: ['V.27ter', 'V.29', 'V.17'], rates: [9600, 7200, 4800, 2400], v17: [14400, 12000, 9600, 7200], reservedForLater: true },
});
/** DCS bits 11-14: the rate the transmitter will use [M]. */
export const DCS_RATE_CODES = Object.freeze({
  '0000': { rate: 2400, modem: 'V.27ter' },
  '0100': { rate: 4800, modem: 'V.27ter' },
  '1000': { rate: 9600, modem: 'V.29' },
  '1100': { rate: 7200, modem: 'V.29' },
  '0001': { rate: 14400, modem: 'V.17', reservedForLater: true },
  '0101': { rate: 12000, modem: 'V.17', reservedForLater: true },
  '1001': { rate: 9600, modem: 'V.17', reservedForLater: true },
  '1101': { rate: 7200, modem: 'V.17', reservedForLater: true },
});
/** Bits 17-18 [M]. Widths in mm: 215 = 1728 pels, 255 = 2048, 303 = 2432. */
export const DIS_WIDTH_CODES = Object.freeze({ '00': [215], '01': [215, 255], '10': [215, 255, 303] });
export const DCS_WIDTH_CODES = Object.freeze({ '00': 215, '01': 303, '10': 255 });
/** Bits 19-20 [M]. */
export const DIS_LENGTH_CODES = Object.freeze({ '00': ['A4'], '01': ['A4', 'B4', 'unlimited'], '10': ['A4', 'B4'] });
export const DCS_LENGTH_CODES = Object.freeze({ '00': 'A4', '01': 'unlimited', '10': 'B4' });
/** Bits 21-23, minimum scan line time in ms at 3.85 lines/mm and at 7.7 lines/mm [M]. */
export const DIS_SCAN_CODES = Object.freeze({
  '000': { standard: 20, fine: 20 },
  '001': { standard: 40, fine: 40 },
  '010': { standard: 10, fine: 10 },
  '100': { standard: 5, fine: 5 },
  '011': { standard: 10, fine: 5 },
  '110': { standard: 20, fine: 10 },
  '101': { standard: 40, fine: 20 },
  '111': { standard: 0, fine: 0 },
});
export const DCS_SCAN_CODES = Object.freeze({ '000': 20, '001': 40, '010': 10, '100': 5, '111': 0 });

const getBit = (fif, n) => ((fif[(n - 1) >> 3] ?? 0) >>> ((n - 1) & 7)) & 1;
const setBit = (fif, n, v) => { if (v) fif[(n - 1) >> 3] |= 1 << ((n - 1) & 7); };
const getCode = (fif, { bit, len }) => { let s = ''; for (let i = 0; i < len; i++) s += getBit(fif, bit + i); return s; };
const setCode = (fif, { bit, len }, code) => { for (let i = 0; i < len; i++) setBit(fif, bit + i, code[i] === '1'); };
const keyOf = (table, pred) => { for (const [k, v] of Object.entries(table)) if (pred(v)) return k; return undefined; };
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** The rates a DIS/DTC rate code offers, highest first. */
export function ratesOfDisCode(code) { return DIS_RATE_CODES[code]?.rates ?? []; }

/** The DIS rate code for a set of receivable rates (the smallest standard set covering them). */
export function disRateCode(rates) {
  const want = [...new Set(rates)];
  const k = keyOf(DIS_RATE_CODES, (v) => !v.reservedForLater && sameSet(v.rates, want))
    ?? keyOf(DIS_RATE_CODES, (v) => !v.reservedForLater && want.every((r) => v.rates.includes(r)));
  if (k === undefined) throw new Error(`no DIS rate code for ${rates}`);
  return k;
}

/**
 * A FIF long enough for every option set in `f` plus `f.extra` (raw octets after octet 6), with the extend bits
 * (24, 32, 40, 48) chained to reach the last octet used.
 */
function allocCaps(f) {
  let octets = 3;
  for (const b of OPTION_BITS) if (f[b.name]) octets = Math.max(octets, ((b.bit - 1) >> 3) + 1);
  if (f.extra?.length) octets = DECODED_OCTETS + f.extra.length;
  const fif = new Uint8Array(octets);
  if (f.extra?.length) fif.set(f.extra, DECODED_OCTETS);
  for (let o = 3; o < octets; o++) setBit(fif, o * 8, 1);   // bit 24 says octet 4 follows, and so on
  for (const b of OPTION_BITS) setBit(fif, b.bit, f[b.name]);
  return fif;
}

/**
 * Build a DIS or DTC FIF. Fields: readyToTransmit, canReceive (default true), rates (receivable, e.g. [9600, 7200,
 * 4800, 2400]) or rateCode, fine, twoD, widths (default [215]), lengths (default ['A4']), scan ({ standard, fine }
 * in ms, default 20/20) or scanCode; any one-bit option of CAPS_BITS past bit 24 by name (ecm, t6, superFine,
 * scanHalfAtHigher, ...); extra (raw octets after octet 6, their own extend bits included).
 */
export function buildDIS(f = {}) {
  const fif = allocCaps(f);
  setBit(fif, BIT.readyToTransmit.bit, f.readyToTransmit);
  setBit(fif, BIT.canReceive.bit, f.canReceive ?? true);
  setCode(fif, BIT.rate, f.rateCode ?? disRateCode(f.rates ?? [9600, 7200, 4800, 2400]));
  setBit(fif, BIT.fine.bit, f.fine);
  setBit(fif, BIT.twoD.bit, f.twoD);
  setCode(fif, BIT.width, keyOf(DIS_WIDTH_CODES, (v) => sameSet(v, f.widths ?? [215])) ?? '00');
  setCode(fif, BIT.length, keyOf(DIS_LENGTH_CODES, (v) => sameSet(v, f.lengths ?? ['A4'])) ?? '00');
  const scan = f.scan ?? { standard: 20, fine: 20 };
  const sc = f.scanCode ?? keyOf(DIS_SCAN_CODES, (v) => v.standard === scan.standard && v.fine === scan.fine);
  if (sc === undefined) throw new Error(`no DIS scan code for ${JSON.stringify(scan)}`);
  setCode(fif, BIT.scan, sc);
  return fif;
}
export const buildDTC = buildDIS;

/**
 * Build a DCS FIF. Fields: rate, fine, twoD, width (mm, default 215), length ('A4'), scanMs (20), and the one-bit
 * options by name (superFine for 15.4 lines/mm, ecm, frame64, t6, ...).
 */
export function buildDCS(f = {}) {
  const fif = allocCaps(f);
  setBit(fif, BIT.canReceive.bit, 1);
  const rc = f.rateCode ?? keyOf(DCS_RATE_CODES, (v) => v.rate === (f.rate ?? 9600) && !v.reservedForLater);
  if (rc === undefined) throw new Error(`no DCS rate code for ${f.rate}`);
  setCode(fif, BIT.rate, rc);
  setBit(fif, BIT.fine.bit, f.fine);
  setBit(fif, BIT.twoD.bit, f.twoD);
  setCode(fif, BIT.width, keyOf(DCS_WIDTH_CODES, (v) => v === (f.width ?? 215)) ?? '00');
  setCode(fif, BIT.length, keyOf(DCS_LENGTH_CODES, (v) => v === (f.length ?? 'A4')) ?? '00');
  const sc = keyOf(DCS_SCAN_CODES, (v) => v === (f.scanMs ?? 20));
  if (sc === undefined) throw new Error(`no DCS scan code for ${f.scanMs} ms`);
  setCode(fif, BIT.scan, sc);
  return fif;
}

/** How many octets the extend chain says are present (never more than the FIF holds). */
function chainedOctets(fif) {
  let n = Math.min(3, fif.length);
  while (n >= 3 && n < fif.length && getBit(fif, n * 8)) n++;
  return n;
}

function parseCommon(fif) {
  const n = chainedOctets(fif);
  const out = {
    fine: !!getBit(fif, BIT.fine.bit),
    twoD: !!getBit(fif, BIT.twoD.bit),
    octets: n,
    extend24: n > 3, extend32: n > 4, extend40: n > 5, extend48: n > 6,
    reserved1to8: fif[0] ?? 0,
    extra: n > DECODED_OCTETS ? fif.slice(DECODED_OCTETS, n) : new Uint8Array(0),
    trailing: fif.length > n ? fif.length - n : 0,   // octets after the chain ended (ignored)
    short: fif.length < 3,
  };
  // An option bit counts only if its octet is part of the extend chain.
  for (const b of OPTION_BITS) out[b.name] = ((b.bit - 1) >> 3) < n ? !!getBit(fif, b.bit) : false;
  return out;
}

/**
 * Parse a DIS or DTC FIF of any length into fields. Unknown codes give null meanings and are never fatal; an
 * unknown rate code falls back to its V.29 (bit 11) and V.27ter (bit 12) bits [A].
 */
export function parseDIS(fif) {
  const rateCode = getCode(fif, BIT.rate), widthCode = getCode(fif, BIT.width);
  const lengthCode = getCode(fif, BIT.length), scanCode = getCode(fif, BIT.scan);
  const rc = DIS_RATE_CODES[rateCode];
  let rates = rc ? rc.rates.slice() : [];
  if (!rc) {
    if (rateCode[0] === '1') rates.push(9600, 7200);
    if (rateCode[1] === '1') rates.push(4800, 2400);
  }
  return {
    readyToTransmit: !!getBit(fif, BIT.readyToTransmit.bit),
    canReceive: !!getBit(fif, BIT.canReceive.bit),
    rateCode,
    modems: rc?.modems ?? null,
    rates,
    v17Reserved: !!rc?.reservedForLater,
    widthCode, widths: DIS_WIDTH_CODES[widthCode]?.slice() ?? null,
    lengthCode, lengths: DIS_LENGTH_CODES[lengthCode]?.slice() ?? null,
    scanCode, scan: DIS_SCAN_CODES[scanCode] ? { ...DIS_SCAN_CODES[scanCode] } : null,
    ...parseCommon(fif),
  };
}
export const parseDTC = parseDIS;

/** Parse a DCS FIF. */
export function parseDCS(fif) {
  const rateCode = getCode(fif, BIT.rate), widthCode = getCode(fif, BIT.width);
  const lengthCode = getCode(fif, BIT.length), scanCode = getCode(fif, BIT.scan);
  const rc = DCS_RATE_CODES[rateCode];
  const common = parseCommon(fif);
  return {
    canReceive: !!getBit(fif, BIT.canReceive.bit),
    rateCode,
    rate: rc?.rate ?? null,
    modem: rc?.modem ?? null,
    v17Reserved: !!rc?.reservedForLater,
    widthCode, width: DCS_WIDTH_CODES[widthCode] ?? null,
    lengthCode, length: DCS_LENGTH_CODES[lengthCode] ?? null,
    scanCode, scanMs: DCS_SCAN_CODES[scanCode] ?? null,
    vres: common.superFine ? 'superfine' : common.fine ? 'fine' : 'standard',
    ...common,
  };
}

/**
 * The minimum scan line time in ms the receiver asks for at a vertical resolution, from its DIS: bits 21-23 give
 * standard and fine; super fine is the fine figure, halved when bit 46 is set [M].
 */
export function scanMsFor(dis, vres) {
  const s = dis.scan ?? { standard: 20, fine: 20 };
  if (vres === 'standard') return s.standard;
  if (vres === 'fine') return s.fine;
  return dis.scanHalfAtHigher ? s.fine / 2 : s.fine;
}

/** The modem family a rate uses in the base procedure. */
export function modemForRate(rate) {
  if (rate === 9600 || rate === 7200) return 'V.29';
  if (rate === 4800 || rate === 2400) return 'V.27ter';
  return null;
}

/** A one-line text form of a decoded frame, for logs and ladders. */
export function describeFrame(fr) {
  if (!fr.name) return `?${fr.fcf?.toString(16)}`;
  if (IDENT_FRAMES.has(fr.name)) return `${fr.name}"${decodeIdent(fr.fif)}"`;
  if (fr.name === 'DCS') { const d = parseDCS(fr.fif); return `DCS(${d.rate},${{ standard: 'S', fine: 'F', superfine: 'SF' }[d.vres]}${d.twoD ? ',2D' : ''},${d.scanMs}ms)`; }
  if (fr.name === 'DIS' || fr.name === 'DTC') { const d = parseDIS(fr.fif); return `${fr.name}(${d.rates.join('/')}${d.readyToTransmit ? ',poll' : ''})`; }
  return fr.name;
}
