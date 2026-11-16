// Contact-force ports and acoustic events of the fax's mechanism host, as src/sim/wp/ports.js: the mechanism adds each
// quantity into its port every substep and the audio engine (src/audio/fax-engine.js) reads the average over a sample;
// acoustic events mark onsets the audio side needs at their true moment.
export const FAX_PORT = {
  MOTOR: 0,         // drive stepper's electromagnetic torque (N m, signed): its reaction rings the chassis
  PLANET: 1,        // swing arm on its end stops (N m)
  SCAN_MESH: 2,     // tooth torque in the scanning train (N m)
  RECORD_MESH: 3,   // tooth torque in the recording train (N m)
  CUTTER_CURRENT: 4,// cutter motor current (A)
  CUTTER_SPEED: 5,  // cutter motor speed (rad/s)
  BLADE: 6,         // the blade shearing the paper (N m at the cam)
  PAPER_SPEED: 7,   // the strip's speed under the head (m/s)
  COUNT: 8,
};

export const FAC = {
  PLANET_STOP: 1,   // a 0 scanning end, 1 recording end; b arm speed (rad/s) as it lands in mesh
  CUT: 2,           // b cam speed (rad/s) as the blade parts the paper
  CAM_HOME: 3,      // b cam speed as the home switch makes
  RELAY: 4,         // a relay (0 CML, 1 TEL), b armature speed (m/s) on a stop; a + 8 when it drops out
  HOOK: 5,          // a 1 the plunger bottoms (handset down), 0 it tops out (lifted); b speed (m/s)
  KEY: 6,           // a key index, b stem speed (m/s) as the dome bottoms
  COVER: 7,         // a 0 closes on its latch, 1 hits its open stop; b angular speed (rad/s)
  SHEET_OUT: 8,     // a document leaves the feed roller; b its speed (m/s)
  PICK: 9,          // the separation roller takes a sheet; b speed
};
