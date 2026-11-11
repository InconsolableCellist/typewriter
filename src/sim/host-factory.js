// Builds the mechanism and its audio engine for a machine. LocalHost, the AudioWorklet and Node tests all construct
// through here, so a machine family with its own mechanism host (the word processor, architecture.md 4) plugs in
// without touching the transport. The typewriters' MechanicalSim and AudioEngine are unchanged.
import { MechanicalSim } from './mechanics.js';
import { AudioEngine } from '../audio/engine.js';

// Every typewriter action (front strike, upstrike, single element) runs in MechanicalSim, which dispatches on
// action.type itself. Families with their own host are listed here by action.type.
const TYPEWRITER = { sim: (o) => new MechanicalSim(o), engine: (sim, rate) => new AudioEngine(sim, rate) };
const HOSTS = {
  'printwheel-system': null,   // the word processor's WordprocSim arrives with milestone M4/M5
};

function hostFor(machine) {
  const type = machine.action?.type;
  if (!(type in HOSTS)) return TYPEWRITER;
  const h = HOSTS[type];
  if (!h) throw new Error(`No mechanism host for action type '${type}' yet: add it to src/sim/host-factory.js`);
  return h;
}

/** The mechanism for a machine: { machine, geometry, glyphs } as MechanicalSim takes them. */
export function createMechanism(opts) { return hostFor(opts.machine).sim(opts); }

/** The audio engine that voices a mechanism built by createMechanism. */
export function createAudioEngine(sim, sampleRate) { return hostFor(sim.m).engine(sim, sampleRate); }

/** True when this machine has a mechanism host. */
export function hasMechanism(machine) { try { hostFor(machine); return true; } catch { return false; } }
