// Hyphen points for dictionary hyphenation (SR 4.19, 7.9; ORG p.167). The public-domain word list carries no
// hyphenation, so the points come from rules applied to the words the dictionary knows: syllables are found from
// their vowels, the consonants between two vowels are shared out so that the second syllable starts with a cluster
// English words start with, and a few endings keep their own syllable. At least two letters stay before a break and
// three after it, as in most printed dictionaries. The rules are a reasonable guess, not a hyphenation dictionary:
// prompted hyphenation lets the operator move the point.

const VOWEL = new Set('aeiouàáâãäåæèéêëìíîïòóôõöøùúûü');
const DIGRAPH = new Set(['th', 'sh', 'ch', 'ph', 'wh', 'gh', 'qu']);
// Clusters a syllable may start with (besides one consonant or a digraph).
const ONSET = new Set([
  'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'wr', 'sl', 'sm', 'sn', 'sw', 'tw', 'dw',
  'chr', 'phr', 'thr', 'shr', 'scr', 'spr', 'str', 'spl', 'squ',
]);
const BREAK_AFTER = new Set(['x', 'w', 'y']);   // ex-am-ple, pow-er, play-er
const MIN_LEFT = 2, MIN_RIGHT = 3;
const SUFFIX = /(ment|ness|less|ful)s?$/;

/** Which letters of a lower-case word are vowels (a syllable's nucleus). */
function vowels(w) {
  const n = w.length;
  const v = Array.from(w, (c, i) => VOWEL.has(c) || (c === 'y' && i > 0 && !VOWEL.has(w[i - 1])));
  for (let i = 1; i < n; i++) if (w[i] === 'u' && w[i - 1] === 'q') v[i] = false;     // qu is a consonant
  // A silent final e (make, assumes, purchased), but not the e of a consonant + le (ex-am-ple) or of -ted, -ded,
  // -ses, -zes, -ches ... (want-ed, box-es).
  const silent = (i) => {
    if (i < 2 || v[i - 1]) return false;
    const before = w.slice(0, i);
    const end = w.slice(i);
    if (end === 'e') return !(w[i - 1] === 'l' && !v[i - 2]);
    if (end === 'ed') return !/[td]$/.test(before);
    if (end === 'es') return !/(s|x|z|ch|sh|ge|ce)$/.test(before);
    return false;
  };
  for (const end of ['e', 'ed', 'es']) {
    const i = n - end.length;
    if (w.endsWith(end) && silent(i)) v[i] = false;
  }
  // ... and the e before a suffix that makes its own syllable (state-ment, care-less).
  const suf = SUFFIX.exec(w);
  if (suf && w[suf.index - 1] === 'e' && !v[suf.index - 2]) v[suf.index - 1] = false;
  return v;
}

/** Vowel pairs said as two syllables (ma-te-ri-als, ac-tu-al), unless softened (spe-cial, na-tion). */
function hiatus(w, i) {
  const pair = w[i] + w[i + 1];
  if (!['ia', 'io', 'iu', 'ua', 'uo', 'eo', 'ie'].includes(pair)) return false;
  if (pair[0] === 'i' && /[ctsgx]/.test(w[i - 1] ?? '')) return false;
  if (pair === 'ie' && /^(s|d|r|st)?$/.test(w.slice(i + 2))) return false;     // tried, pies, pier
  return true;
}

/** Where a run of consonants between two vowels is split: the index the second syllable starts at. */
function splitCluster(w, a, b) {
  // a..b-1 are the consonants.
  const c = w.slice(a, b);
  if (c.length === 1) return BREAK_AFTER.has(c) ? b : a;
  if (c.length === 2) {
    if (c === 'ck') return b;
    if (DIGRAPH.has(c) || ONSET.has(c)) return a;
    if (c[0] === c[1]) return a + 1;
    return a + 1;
  }
  // Three or more: the longest onset at the end that English allows.
  for (let k = Math.min(3, c.length - 1); k >= 2; k--) {
    const tail = c.slice(-k);
    if (ONSET.has(tail) || DIGRAPH.has(tail)) return b - k;
  }
  return b - 1;
}

/**
 * Hyphen points of a word: indices i (into the word as given) where a hyphen may go before word[i]. A part after an
 * apostrophe (company's, isn't) is never split but counts toward the letters after a break.
 */
export function hyphenPoints(word) {
  const apo = word.indexOf("'");
  const core = (apo < 0 ? word : word.slice(0, apo)).toLowerCase();
  const letters = (s) => s.replace(/[^a-zà-ÿ]/gi, '').length;
  if (!/^[a-zà-öø-ÿ]+$/.test(core) || letters(word) < MIN_LEFT + MIN_RIGHT) return [];
  const v = vowels(core);
  const nuclei = [];
  for (let i = 0; i < core.length; i++) {
    if (!v[i]) continue;
    if (i > 0 && v[i - 1] && !hiatus(core, i - 1)) continue;   // the same vowel group
    nuclei.push(i);
  }
  const points = new Set();
  for (let k = 1; k < nuclei.length; k++) {
    let a = nuclei[k - 1];
    while (v[a + 1] && a + 1 < nuclei[k]) a++;                   // end of the previous vowel group
    const b = nuclei[k];
    points.add(a + 1 === b ? b : splitCluster(core, a + 1, b));
  }
  // -ing keeps its own syllable (cost-ing, mak-ing); a doubled consonant before it is split (run-ning).
  const ing = /ings?$/.exec(core);
  if (ing && ing.index >= 3) {
    for (const p of [...points]) if (p > ing.index - 3 && p <= ing.index + 1) points.delete(p);
    const s = ing.index;
    points.add(core[s - 1] === core[s - 2] && !VOWEL.has(core[s - 1]) ? s - 1 : s);
  }
  const suf = SUFFIX.exec(core);
  if (suf && suf.index >= 3) {
    for (const p of [...points]) if (p > suf.index - 2 && p < suf.index) points.delete(p);
    points.add(suf.index);
  }
  const right = (p) => letters(word.slice(p));
  return [...points].filter((p) => p >= MIN_LEFT && right(p) >= MIN_RIGHT).sort((x, y) => x - y);
}

/** The word with its hyphen points shown, for tests and the dictionary's own checks: "ma-te-ri-als". */
export function hyphenated(word, points = hyphenPoints(word)) {
  let out = '', last = 0;
  for (const p of points) { out += `${word.slice(last, p)}-`; last = p; }
  return out + word.slice(last);
}
