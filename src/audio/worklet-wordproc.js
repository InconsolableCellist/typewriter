// AudioWorklet entry for the word processor (architecture.md 4): WordprocSim and WpAudioEngine only.
// Loaded through the `?worker&url` import in src/sim/worklet-url.js.
import { WordprocSim } from '../sim/wp/index.js';
import { WpAudioEngine } from './wp-engine.js';
import { registerSimProcessor } from './worklet-processor.js';

registerSimProcessor((o) => new WordprocSim(o), (sim, rate) => new WpAudioEngine(sim, rate));
