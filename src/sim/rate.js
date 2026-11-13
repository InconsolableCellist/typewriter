// The mechanism's substep rate, shared by both families' hosts. A module of its own so the word processor's worklet
// bundle does not pull in the typewriters' MechanicalSim for one constant.
export const SUBSTEP_HZ = 384000;
