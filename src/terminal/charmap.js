// Every printable ASCII character resolved to a physical key press. The machine has 41 printing bars: letters and
// the shifted figures come straight off the keyboard; characters with no slug are struck by a donor bar with a glyph
// override, chosen for a slug of similar visual weight so the strike and its sound are believable.
export const DONORS = {
  '1': 'l', '!': 'i', '@': 'a', '[': 't', ']': 'j', '{': 'c', '}': 'x', '\\': '/', '|': 'l', '~': 'r', '^': 'v', '<': 'z', '>': 'n', '`': ';',
};

/**
 * @param geometry  deriveGeometry() result
 * @returns Map from one-character string to { key, shift, glyph } where `glyph` is set only for a character the bar
 *          does not carry, and { space, backspace, shiftL } key indexes as properties on the map.
 */
export function buildCharMap(geometry) {
  const map = new Map();
  const keyId = (id) => geometry.keys.findIndex((k) => k.id === id);
  geometry.keys.forEach((k, i) => {
    if (k.kind !== 'print') return;
    map.set(k.lower, { key: i, shift: false, glyph: null });
    if (k.upper !== k.lower) map.set(k.upper, { key: i, shift: true, glyph: null });
  });
  for (const [ch, donor] of Object.entries(DONORS)) {
    const entry = map.get(donor);
    if (!entry || entry.shift) throw new Error(`donor '${donor}' for '${ch}' must be an unshifted slug`);
    map.set(ch, { key: entry.key, shift: false, glyph: ch });
  }
  map.space = keyId('space'); map.backspace = keyId('backspace'); map.shiftL = keyId('shiftL');
  return map;
}

/** Characters in printable ASCII with no entry, excluding space (which has its own key). */
export function missingChars(map) {
  const out = [];
  for (let c = 0x21; c <= 0x7e; c++) { const ch = String.fromCharCode(c); if (!map.has(ch)) out.push(ch); }
  return out;
}
