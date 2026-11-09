// Fetches and decodes the sample sprite off the audio thread, then hands the PCM to the worklet.
// Never blocks startup: if anything fails the modal body keeps sounding on its own.
export async function loadSamples(audioContext, install) {
  try {
    const base = '/assets/audio/samples/';
    const manifest = await (await fetch(`${base}manifest.json`)).json();
    const data = await (await fetch(`${base}${manifest.sprite}`)).arrayBuffer();
    const audio = await audioContext.decodeAudioData(data);
    install(audio.getChannelData(0).slice(), manifest);
  } catch (e) {
    console.warn('typewriter samples not loaded, staying on the modal body:', e);
  }
}
