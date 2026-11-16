// AudioWorklet entry for the fax (docs/fax/architecture.md 5): FaxSim and FaxAudioEngine only. The firmware and the
// protocol stack join this bundle in M6 and M7. Loaded through the `?worker&url` import in src/sim/worklet-url.js.
import { FaxSim } from '../sim/fax/index.js';
import { FaxAudioEngine } from './fax-engine.js';
import { registerSimProcessor } from './worklet-processor.js';

registerSimProcessor((o) => new FaxSim(o), (sim, rate) => new FaxAudioEngine(sim, rate));
