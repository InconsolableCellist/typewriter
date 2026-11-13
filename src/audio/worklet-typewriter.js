// AudioWorklet entry for the typewriters (front strike, upstrike, single element): MechanicalSim and AudioEngine only.
// Loaded through the `?worker&url` import in src/sim/worklet-url.js.
import { MechanicalSim } from '../sim/mechanics.js';
import { AudioEngine } from './engine.js';
import { registerSimProcessor } from './worklet-processor.js';

registerSimProcessor((o) => new MechanicalSim(o), (sim, rate) => new AudioEngine(sim, rate));
