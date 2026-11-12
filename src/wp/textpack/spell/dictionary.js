// The spelling dictionary (SR 4.26, 7.9; architecture 12.3): the word list unpacked once into a set, with the
// operator's supplement beside it. The list comes from public/assets/wordlist_en.gz.bin (tools/wp/build_wordlist.py):
// Latin-1 text, a header line, then the words in code-unit order, front-coded (one character, 0x30 + n, for the n
// characters shared with the previous word, then the rest). The bytes arrive already unpacked; the kit gunzips them.
//
// On the machine the dictionary lives on the program diskette and is read as a document is checked. `blockOf` says
// which of its sectors holds a word, so a check can read the sectors its words need (tasks/spell.js).
import { hyphenPoints } from './hyphen.js';

export const LANGUAGE = 'U.S. English';     // status line field E while checking (ORG p.110)
export const SUPPLEMENT_WORDS = 500;        // a language supplement's words (ORG p.521)
export const SUPPLEMENT_CHARS = 4500;       // the supplement's room on the program diskette (ORG p.425)

/** Unpack the word list. */
export function decodeWordList(bytes) {
  let i = 0;
  const line = () => {
    let s = '';
    for (; i < bytes.length && bytes[i] !== 0x0a; i++) s += String.fromCharCode(bytes[i]);
    i++;
    return s;
  };
  const head = line().split(' ');
  if (head[0] !== 'wordlist') throw new Error('not a word list');
  const words = new Array(+head[1]);
  let prev = '';
  for (let k = 0; k < words.length; k++) {
    const l = line();
    prev = prev.slice(0, l.charCodeAt(0) - 0x30) + l.slice(1);
    words[k] = prev;
  }
  return words;
}

const isUpper = (c) => c !== c.toLowerCase() && c === c.toUpperCase();

export class Dictionary {
  /** `words` sorted in code-unit order; `blocks` the sectors the dictionary takes on the program diskette. */
  constructor(words, { blocks = 512 } = {}) {
    this.words = words;
    this.set = new Set(words);
    this.blocks = blocks;
    this.supplement = [];
    this.extra = new Set();
  }

  static fromBytes(bytes, opts) { return new Dictionary(decodeWordList(bytes), opts); }

  /**
   * Whether a word as typed is spelt right. Case follows the list: a lower-case entry also matches the word with a
   * capital first letter or in capitals, a capitalised entry (Monday) only with its capital or in capitals. A
   * possessive is right when the word without 's (or the plural without ') is.
   */
  has(word) {
    if (this.known(word)) return true;
    if (/'s$/i.test(word) && word.length > 2) return this.known(word.slice(0, -2));
    if (/s'$/i.test(word)) return this.known(word.slice(0, -1));
    return false;
  }

  known(w) {
    if (!w) return false;
    if (this.set.has(w) || this.extra.has(w)) return true;
    const lower = w.toLowerCase();
    const cap = lower[0].toUpperCase() + lower.slice(1);
    const look = (x) => this.set.has(x) || this.extra.has(x);
    if (w.length > 1 && w === w.toUpperCase()) return look(lower) || look(cap);
    if (isUpper(w[0]) && w.slice(1) === w.slice(1).toLowerCase()) return look(lower);
    return false;
  }

  /** Hyphen points of a word the dictionary knows: indices i where a break may go before word[i]. */
  hyphenate(word) {
    if (!this.has(word)) return [];
    return hyphenPoints(word);
  }

  /** The dictionary sector (0 to blocks - 1) a word is looked up in. */
  blockOf(word) {
    const w = word.toLowerCase();
    let lo = 0, hi = this.words.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.words[m].toLowerCase() < w) lo = m + 1; else hi = m; }
    return Math.min(this.blocks - 1, Math.floor((lo * this.blocks) / Math.max(1, this.words.length)));
  }

  // ---- the supplement (ORG p.425, p.521) ---------------------------------------------------------------------------

  get supplementChars() { return this.supplement.reduce((a, w) => a + w.length + 1, 0); }

  /** Add words to the supplement, up to its limits; returns how many went in. */
  addSupplement(words) {
    let n = 0;
    for (const w of words) {
      if (!w || this.has(w)) continue;
      if (this.supplement.length >= SUPPLEMENT_WORDS || this.supplementChars + w.length + 1 > SUPPLEMENT_CHARS) break;
      this.supplement.push(w);
      this.extra.add(w);
      n++;
    }
    return n;
  }

  clearSupplement() { this.supplement = []; this.extra = new Set(); }
}
