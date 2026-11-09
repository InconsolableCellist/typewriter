// Contact-force ports: the mechanism accumulates each contact's force here every substep and the
// acoustic model (src/audio) reads the block average. Port -> bank couplings live in the audio side.
export const PORT = {
  SLUG: 0,       // slug against platen (platen reaction)
  FELT: 1,       // key felt stops (top and bottom)
  PAD: 2,        // typebar rest pad and return
  GUIDE: 3,      // type guide and bar shank
  BARBAR: 4,     // typebar against typebar
  DOG: 5,        // dog against rack teeth, dog stops
  UBAR: 6,       // universal bar and rocker pickup
  STOP: 7,       // carriage end stops and margin stops
  BELL: 8,       // bell hammer against bell
  PAWL: 9,       // platen pawl, detent, line-space lever stop
  RAIL: 10,      // carriage rail friction (rumble source)
  COUNT: 11,
};

// Acoustic events: contact onsets the audio side needs at their true moment (a, b meanings per event).
export const AC = {
  STRIKE: 1,     // a bar, b peak slug force (N), at the end of contact
  KEY_BOTTOM: 2, // a key, b speed (m/s), key reaches its bottom felt
  PAD: 3,        // a bar, b angular speed (rad/s), bar lands on its rest pad
  SHIFT_DOWN: 4, // b speed, shift reaches the top of its travel
  SHIFT_UP: 5,   // b speed, shift lands back on its rest
  LS_PICK: 6,    // b lever speed, line-space pawl picks up the platen ratchet
  STOP: 7,       // b carriage speed (m/s), carriage or margin stop contact begins
  BELL: 8,       // b peak force (N), bell hammer leaves the bell
  KEY_TOP: 9,    // a key, b speed (m/s), key lands back on its top felt
  CLUTCH: 10,    // single-element machine: a 0 cycle trip, 1 op trip, 2 shift trip, 3 latch catches, 4 return/tab unlatch, 5 return trip; b level
  SETTLE: 11,    // a 0 cycle end, 1 detent seats the ball, 2 shift end; b carrier speed (rad/s)
};
