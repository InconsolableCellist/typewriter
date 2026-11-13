// Content-addressed /assets/ URLs. The build serves every file under public/assets/ at a name that carries a hash of
// its own bytes and compiles the map from the plain path to that name into the code (vite/assets.js, __ASSET_MAP__).
// Every fetch of an /assets/ URL is rewritten through it here, and so are the requests that do not go through fetch
// (the rain's Audio element, the post-it font) by calling versioned() themselves. An unchanged file keeps its URL
// across deploys and stays cached (public/_headers makes /assets/* immutable); a changed one gets a new URL, and since
// a URL only ever names one content, this code is never handed another deploy's copy. The dev server has no map and
// leaves every URL alone.
/* global __ASSET_MAP__ */
const MAP = typeof __ASSET_MAP__ === 'object' && __ASSET_MAP__ ? __ASSET_MAP__ : null;
const PREFIX = '/assets/';

/** `url` with its /assets/ path replaced by the hashed one in `map`; anything else (another origin, a path the map
 * does not hold, an already hashed name) comes back unchanged. `base` resolves relative URLs. */
export function versionedWith(map, url, base) {
  if (!map || typeof url !== 'string') return url;
  let u;
  try { u = new URL(url, base); } catch { return url; }
  if (u.origin !== new URL(base).origin || !u.pathname.startsWith(PREFIX)) return url;
  const out = map[decodeURIComponent(u.pathname.slice(PREFIX.length))];
  if (!out) return url;
  u.pathname = PREFIX + out;
  return u.href;
}

/** This build's URL for an /assets/ file. */
export function versioned(url) {
  return MAP ? versionedWith(MAP, url, location.href) : url;
}

if (MAP && typeof window !== 'undefined' && window.fetch) {
  const fetch0 = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string') return fetch0(versioned(input), init);
    if (input instanceof URL) return fetch0(versioned(input.href), init);
    if (input instanceof Request) { const v = versioned(input.url); return fetch0(v === input.url ? input : new Request(v, input), init); }
    return fetch0(input, init);
  };
}
