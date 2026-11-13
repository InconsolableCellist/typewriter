// Every deploy's unhashed files under /assets/ (models, textures, sounds, glyphs, word list) are fetched with the build's
// id as a query, so a browser that cached the previous deploy's copies (public/_headers caches them a day) never mixes
// them with this deploy's code. Vite's own hashed chunks already change name; the query does them no harm.
/* global __BUILD_ID__ */
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';

export function versioned(url) {
  if (!BUILD || typeof url !== 'string') return url;
  const u = new URL(url, location.href);
  if (u.origin !== location.origin || !u.pathname.startsWith('/assets/') || u.searchParams.has('v')) return url;
  u.searchParams.set('v', BUILD);
  return u.href;
}

if (BUILD && typeof window !== 'undefined' && window.fetch) {
  const fetch0 = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string') return fetch0(versioned(input), init);
    if (input instanceof URL) return fetch0(versioned(input.href), init);
    if (input instanceof Request) { const v = versioned(input.url); return fetch0(v === input.url ? input : new Request(v, input), init); }
    return fetch0(input, init);
  };
}
