// A deep copy for mechanism state. structuredClone is not in an AudioWorkletGlobalScope (it belongs to windows and
// workers), and the mechanism's state is imported there when the page hands it to the audio thread; JSON would lose
// Infinity (an idle controller's next event time) and typed arrays. Plain objects, arrays, typed arrays, numbers
// including Infinity and NaN, strings, booleans and null.
export function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return v.slice();
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = clone(v[k]);
  return out;
}
