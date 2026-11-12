// Fetches and decodes the sample sprite off the audio thread, then hands the PCM to the worklet.
// Never blocks startup: if anything fails the modal body keeps sounding on its own.
const BASE = '/assets/audio/';

async function fetchSprite(audioContext, dir) {
  const manifest = await (await fetch(`${BASE}${dir}/manifest.json`)).json();
  const data = await (await fetch(`${BASE}${dir}/${manifest.sprite}`)).arrayBuffer();
  const audio = await audioContext.decodeAudioData(data);
  return { manifest, pcm: audio.getChannelData(0).slice(), rate: audio.sampleRate };
}

/**
 * `extraDir` names a second sprite for this machine, appended to the shared one so both sets are available; with `alone`
 * it is the machine's only sprite (the word processor's) and the typewriters' is not fetched. A machine whose
 * `audio.samples` is false loads none.
 */
export async function loadSamples(audioContext, install, extraDir = null, alone = false) {
  if (extraDir === false) return;
  try {
    if (alone && extraDir) { const own = await fetchSprite(audioContext, extraDir); install(own.pcm, own.manifest); return; }
    const main = await fetchSprite(audioContext, 'samples');
    if (!extraDir) { install(main.pcm, main.manifest); return; }
    const extra = await fetchSprite(audioContext, extraDir);
    const pcm = new Float32Array(main.pcm.length + extra.pcm.length);
    pcm.set(main.pcm); pcm.set(extra.pcm, main.pcm.length);
    const shift = main.pcm.length / main.rate;
    install(pcm, { ...main.manifest, items: [...main.manifest.items, ...extra.manifest.items.map((it) => ({ ...it, o: it.o + shift }))] });
  } catch (e) {
    console.warn('typewriter samples not loaded, staying on the modal body:', e);
  }
}
