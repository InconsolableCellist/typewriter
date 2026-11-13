// What the first sound after a gesture waits for, fetched ahead at idle once the first frame is up (perf review, small
// things): the audio worklet's chunk and the machine's sound sprites. They land in the browser's HTTP cache, so the
// first gesture's unlockAudio (src/sim/client.js: addModule, then loadSamples) and the word processor's key sampler
// find them there instead of starting their downloads only then. Nothing is decoded or installed here.

const AUDIO = '/assets/audio/';

/** The sprite directories a machine's sound loads: as src/audio/samples.js loadSamples, and the key sampler's. */
export function spriteDirs(machine) {
  const a = machine.audio ?? {};
  const dirs = [];
  if (a.samples !== false) {
    if (!(a.alone && a.samples)) dirs.push('samples');
    if (a.samples) dirs.push(a.samples);
  }
  if (a.keys) dirs.push(a.keys);
  return dirs;
}

/**
 * Starts the prefetch after the next frame, when the browser is idle. `worklet: false` where the mechanism never moves
 * to the audio thread (a mock or ?localsim). Never throws; a failed prefetch only means the gesture fetches as before.
 */
export function prefetchAudioWhenIdle(machine, { worklet = true } = {}) {
  if (typeof window === 'undefined') return;
  const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 4000 }) : (fn) => setTimeout(fn, 1500);
  requestAnimationFrame(() => idle(() => { prefetchAudio(machine, { worklet }).catch(() => {}); }));
}

export async function prefetchAudio(machine, { worklet = true } = {}) {
  const jobs = spriteDirs(machine).map(async (dir) => {
    // Through fetch, as the loaders do, so the request (and the build's ?v= query on it) is the one they will make.
    const manifest = await (await fetch(`${AUDIO}${dir}/manifest.json`)).json();
    await (await fetch(`${AUDIO}${dir}/${manifest.sprite}`)).arrayBuffer();
  });
  // The worklet chunk by a prefetch link: addModule requests the bare URL, which fetch() would version (asset-version.js).
  // This must name the same entry as unlockAudio's addModule (follow it if the worklet is split per family).
  if (worklet) {
    jobs.push(import('../audio/worklet.js?worker&url').then(({ default: url }) => {
      const link = document.createElement('link');
      link.rel = 'prefetch'; link.href = url;
      document.head.appendChild(link);
    }));
  }
  await Promise.allSettled(jobs);
}
