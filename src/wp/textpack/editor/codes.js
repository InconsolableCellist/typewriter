// Every stored control code (SR 5, ORG p.558 to 562): its status-line name, its symbol, how it lays out on a line,
// and whether BKSP may delete it (ORG p.258). Width: 'char' takes a column like a character; 'tab' moves to a tab
// stop; 'end' ends a line and takes the column the cursor stands on; 'zero' takes no column unless Display Codes is
// Yes; 'back' moves one position left (required backspace).
import { SYM } from '../../charset.js';
import { changeName } from './format.js';

export const C = {
  CR: 0x100, RCR: 0x101, TAB: 0x102, RTAB: 0x103, RSP: 0x104, RHY: 0x105, SHY: 0x106, RBS: 0x107,
  PE: 0x108, RPE: 0x109, IDX: 0x10a, IDXR: 0x10b, ZICR: 0x10c, HUP: 0x10d, HDN: 0x10e, CTR: 0x10f,
  BUND: 0x110, EUND: 0x111, WUND: 0x112, CUND: 0x113, STOP: 0x114, SWITCH: 0x115, SUB: 0x116,
};
export const OBJ = 0x8000;

const INFO = {
  [C.CR]: { name: 'Carrier Return', sym: SYM.CR, width: 'end' },
  [C.RCR]: { name: "Req'd Carrier Ret", sym: SYM.REQ_CR, width: 'end', bksp: false },
  [C.TAB]: { name: 'Tab', sym: SYM.TAB, width: 'tab' },
  [C.RTAB]: { name: "Req'd Tab", sym: SYM.REQ_TAB, width: 'tab' },
  [C.RSP]: { name: 'Required Space', sym: SYM.REQ_SPACE, width: 'char', shows: ' ' },
  [C.RHY]: { name: 'Required Hyphen', sym: SYM.REQ_HYPHEN, width: 'char', shows: '-' },
  [C.SHY]: { name: 'Syllable Hyphen', sym: SYM.SYL_HYPHEN, width: 'zero' },
  [C.RBS]: { name: "Req'd BKSP", sym: SYM.REQ_BKSP, width: 'back' },
  [C.PE]: { name: 'Page End', sym: SYM.PAGE_END, width: 'end', bksp: false },
  [C.RPE]: { name: 'Required Page End', sym: SYM.REQ_PAGE_END, width: 'end', bksp: false },
  [C.IDX]: { name: 'Index', sym: SYM.INDEX, width: 'end', bksp: false },
  [C.IDXR]: { name: 'Index Return', sym: SYM.INDEX_RET, width: 'end', bksp: false },
  [C.ZICR]: { name: 'Zero Index RET', sym: SYM.ZICR, width: 'end' },
  [C.HUP]: { name: 'Half Index Up', sym: SYM.HALF_UP, width: 'zero' },
  [C.HDN]: { name: 'Half Index Down', sym: SYM.HALF_DOWN, width: 'zero' },
  [C.CTR]: { name: 'Ctr', sym: SYM.CTR, width: 'zero' },
  [C.BUND]: { name: 'Begin Und', sym: SYM.BEGIN_UND, width: 'zero', bksp: false },
  [C.EUND]: { name: 'End Und', sym: SYM.END_UND, width: 'zero', bksp: false },
  [C.WUND]: { name: 'Word Und', sym: SYM.WORD_UND, width: 'zero' },
  [C.CUND]: { name: 'Und', sym: SYM.CHAR_UND, width: 'zero' },
  [C.STOP]: { name: 'Stop', sym: SYM.SQUARE, width: 'zero' },
  [C.SWITCH]: { name: 'Switch', sym: SYM.SQUARE, width: 'zero' },
  [C.SUB]: { name: 'Substitute', sym: SYM.SUBSTITUTE, width: 'char', shows: SYM.SUBSTITUTE },
};

// Objects: the codes that carry parameters, kept in the page's object table (architecture 7.3).
const OBJ_INFO = {
  fmt: (o) => (o.kind === 'set' ? changeName(o.values) : {
    retAll: 'Page Format Return', retLine: 'Line Format Return', retType: 'Typestyle Return',
    docFmt: 'Start Document Fmt', altFmt: 'Start Alternate Fmt',
  }[o.kind]),
  keep: (o) => (o.begin ? 'Begin Keep' : 'End Keep'),
  spell: (o) => (o.begin ? 'Begin Spelling' : 'End Spelling'),
  ovs: (o) => (o.begin ? 'Begin Overstrike' : 'End Overstrike'),
};
const OBJ_SYM = {
  fmt: (o) => (o.kind.startsWith('ret') ? SYM.FMT_RETURN : o.kind === 'altFmt' ? SYM.ALT_FMT : SYM.FMT_CHANGE),
  keep: () => SYM.KEEP, spell: () => SYM.INSTR, ovs: (o) => (o.begin ? SYM.OVS_BEGIN : SYM.OVS_END),
};

export const isChar = (u) => u < 0x100;
export const isObj = (u) => (u & OBJ) !== 0;
export const objIndex = (u) => u & 0x7fff;
export const LINE_ENDS = new Set([C.CR, C.RCR, C.IDX, C.IDXR, C.ZICR, C.PE, C.RPE]);
/** Line ends that adjusting never moves: everything but the regular carrier return. */
export const HARD_ENDS = new Set([C.RCR, C.IDX, C.IDXR, C.ZICR, C.PE, C.RPE]);
export const isEnd = (u) => LINE_ENDS.has(u);
export const isBlank = (u) => u === 0x20;

/** Layout and display facts of a unit; objects resolve through the page's object table. */
export function info(u, objects) {
  if (isChar(u)) return { width: 'char' };
  if (isObj(u)) {
    const o = objects[objIndex(u)];
    return { name: OBJ_INFO[o.type]?.(o) ?? 'Unassigned Code', sym: OBJ_SYM[o.type]?.(o) ?? SYM.SQUARE, width: 'zero', bksp: false, obj: o };
  }
  return INFO[u] ?? { name: 'Unassigned Code', sym: SYM.SQUARE, width: 'zero' };
}
