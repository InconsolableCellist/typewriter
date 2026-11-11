// Contact-force ports and acoustic events of the word processor's mechanism host. Like src/sim/ports.js, the
// mechanism accumulates each contact's force in a port every substep and the audio engine reads the block average;
// acoustic events mark onsets the audio side needs at their true moment. Each body appends its own entries.
export const WP_PORT = {
  HAMMER: 0,      // petal face on ribbon, paper and platen (N)
  ARMATURE: 1,    // hammer armature on its backstop and on the petal (N)
  FOLLOWER: 2,    // leadscrew follower force on the carrier (N)
  CARRIER_STOP: 3,// carrier against its end stops (N)
  WHEEL: 4,       // selection motor torque magnitude (N m)
  INDEX: 5,       // timing belt torque at the platen (N m)
  RIBBON: 6,      // ribbon lift follower on its cam (N)
  CAM: 7,         // paper-handling cam followers (N m)
  COVER: 8,       // access cover on its seat and latch (N m)
  PANEL: 9,       // panel keys on their stops (N)
  COUNT: 10,
};

export const WAC = {
  STRIKE: 1,      // a petal, b peak face force (N), at the end of contact
  BACKSTOP: 2,    // b armature speed (m/s) as it lands on its backstop
  CARRIER_STOP: 3,// b carrier speed (m/s) as it meets an end stop
  COVER: 4,       // a 0 closes on its seat, 1 leaves it; b angular speed (rad/s)
  PANEL_KEY: 5,   // a key, b speed (m/s), key reaches its bottom
};
