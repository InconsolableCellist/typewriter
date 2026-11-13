// Entry: chooses the machine and mounts the kit for its family (src/kits/). Switching machines reloads the page.
import './asset-version.js';
import './ui/loader.js';
import { MACHINES, DEFAULT_MACHINE, UNLISTED, KITS } from './machine/index.js';
import { loadGlyphs } from './machine/glyphs.js';

const params = new URLSearchParams(location.search);

function chooseMachine() {
  let saved = null;
  try { saved = localStorage.getItem('machine'); } catch { /* storage can be blocked; the default machine is fine */ }
  const listed = (id) => (id && MACHINES[id] && !UNLISTED.has(id) ? MACHINES[id] : null);
  return MACHINES[params.get('machine')] ?? listed(saved) ?? MACHINES[DEFAULT_MACHINE];
}

function pick(id) {
  if (!UNLISTED.has(id)) { try { localStorage.setItem('machine', id); } catch { /* the URL below still selects it */ } }
  const url = new URL(location.href);
  url.searchParams.set('machine', id);
  location.href = url;
}

async function main() {
  const machine = chooseMachine();
  const canvas = document.getElementById('c');
  canvas.addEventListener('webglcontextlost', () => console.warn('webgl context lost'));
  const machines = Object.values(MACHINES).filter((m) => !UNLISTED.has(m.id) || params.has('wp') || m.id === machine.id);
  // The glyph faces are needed before the first frame by every kit: fetched while the kit's chunks load.
  const glyphs = loadGlyphs(machine.glyphs);
  glyphs.catch(() => {});   // the kit awaits it and reports a failure
  const kit = await KITS[machine.action.type]();
  await kit.mount({ canvas, params, machine, machines, onPick: pick, glyphs });
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#f88;padding:20px">${e?.stack ?? e}</pre>`;
});
