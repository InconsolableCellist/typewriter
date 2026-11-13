// The loading screen (index.html #loader): progress by the assets fetched, until the scene has drawn its first frames.
// It counts the same-origin /assets/ fetches (models, textures, sounds, glyphs), weighting the large ones, and shows the
// file in hand. The word processor's screen counts up its power-on test stages as it goes: 05, 06, 09, then *11*.
const el = document.getElementById('loader');
if (el && typeof window !== 'undefined' && window.fetch) {
  const fill = document.getElementById('loaderFill'), pct = document.getElementById('loaderPct');
  const file = document.getElementById('loaderFile'), code = document.getElementById('loaderCode');
  const wp = el.classList.contains('wp');
  const weight = (url) => (/\.(glb|exr)/.test(url) ? 4 : /\.(avif|ogg|bin)/.test(url) ? 2 : 1);
  let started = 0, finished = 0, shown = 0, done = false;
  const fetch0 = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (done || !/\/assets\//.test(url)) return fetch0(input, init);
    const w = weight(url);
    started += w;
    file.textContent = decodeURIComponent(url.split('?')[0].split('/assets/')[1] ?? url);
    const end = () => { finished += w; };
    return fetch0(input, init).then((r) => { end(); return r; }, (e) => { end(); throw e; });
  };
  const STAGES = [[0.25, '05'], [0.5, '06'], [0.75, '09'], [0.97, '*11*']];
  const tick = () => {
    if (done) return;
    // Never backwards, and short of the end until the scene is up: more files are found as earlier ones load.
    const target = started ? Math.min(0.95, finished / started) : 0.02;
    shown = Math.max(shown, shown + (target - shown) * 0.2);
    const frames = window.__frameCount ?? 0;
    if (frames > 2) shown = 1;
    fill.style.width = `${(shown * 100).toFixed(1)}%`;
    pct.textContent = `${Math.round(shown * 100)}%`;
    if (wp) {
      const s = STAGES.filter(([at]) => shown >= at).pop();
      code.innerHTML = `${s ? s[1] : ''}<span class="cursor">_</span>`;
    }
    if (frames > 2) {
      done = true;
      file.textContent = 'ready';
      setTimeout(() => { el.classList.add('done'); setTimeout(() => el.remove(), 700); }, 250);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
