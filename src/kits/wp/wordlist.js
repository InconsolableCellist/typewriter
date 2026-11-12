// The spelling dictionary's word list (architecture 12.3, docs/assets.md): fetched when Spelling Tasks first loads,
// behind the program-load wait, and handed to the software unpacked. Served as `.gz.bin` so no server adds a
// Content-Encoding; DecompressionStream unpacks it in the browser, zlib in Node. Bytes that arrive already unpacked
// (a server or proxy that did decode them) are taken as they are.
import { readAsset, gunzip } from '../../machine/glyphs.js';

export const WORD_LIST = 'wordlist_en.gz.bin';

/** @returns {Promise<Uint8Array>} the unpacked word list */
export async function loadWordList() {
  return gunzip(await readAsset(WORD_LIST));
}
