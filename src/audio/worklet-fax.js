// AudioWorklet entry for the fax (docs/fax/architecture.md 5): the whole machine (FaxStation: the mechanism, its
// firmware, the scanner and head models and the exchange with real modem audio) and FaxAudioEngine.
// Loaded through the `?worker&url` import in src/sim/worklet-url.js.
import { FaxStation } from '../sim/fax/station.js';
import { FaxAudioEngine } from './fax-engine.js';
import { registerSimProcessor } from './worklet-processor.js';

registerSimProcessor((o) => new FaxStation(o), (sim, rate) => new FaxAudioEngine(sim, rate));
