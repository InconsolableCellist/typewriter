// The audio-thread bundle for a machine's family. Each family has its own worklet entry, so a visit loads only its own
// mechanism and engine; unlockAudio (client.js) and the idle prefetch (src/kits/audio-prefetch.js) must name the same one.
// The import strings stay literal so Vite bundles each entry as its own worklet chunk.

/** True for the machines whose mechanism is the word processor's (src/sim/host-factory.js HOSTS). */
export const isWordprocFamily = (machine) => machine?.action?.type === 'printwheel-system';

/** Resolves to the URL of the worklet module for this machine's family. */
export async function workletUrl(machine) {
  const m = isWordprocFamily(machine)
    ? await import('../audio/worklet-wordproc.js?worker&url')
    : await import('../audio/worklet-typewriter.js?worker&url');
  return m.default;
}
