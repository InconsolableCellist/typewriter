// Direct thermal paper (docs/fax/plan.md 2, "Thermal paper" and "Fading and age"). Pure module.
//
// Darkening: the coating's leuco dye develops where the surface reaches a temperature, irreversibly, so a point's
// density is a function of the PEAK surface temperature it has seen: nothing below the threshold T0, a smooth rise,
// saturation at T1 [A: 70 and 105 degrees C, in the range data sheets of fax papers give for the dynamic threshold
// and saturation; the shape is a smoothstep with an exponent]. A point heated twice keeps the darker mark.
//
// Density here is normalised: 0 is the fresh ground, 1 the saturated black. The renderer maps it to colour.
//
// The roll the wrong way round: only the coated side marks, and the head then touches the base paper. It prints
// nothing (the plan: "a roll put in backwards prints nothing") [A: a faint mark through the base is ignored].
//
// Fading: ONE rate law for the image, dD/dt = -(kDark + kLight * lux) * D, so D = D0 * exp(-dose), with
//   dose = (kDark + kLight * lux) * seconds. The ground yellows with the same dose, by a fixed ratio [A: the two
//   constants give about 10 % loss in a year in a drawer and half the density after about 3 weeks on a sunny
//   window sill (10 000 lux, 8 h a day); "approximated, one rate law with two constants, no chemistry"].

export const PAPER_CAL = Object.freeze({
  T0: 70,           // degrees C: the coating starts to develop [A]
  T1: 105,          // degrees C: saturated [A]
  shape: 1.3,       // exponent on the smoothstep: a slightly slow toe [A]
  ambient: 25,      // degrees C
  kDark: 3.3e-9,    // per second in the dark: about 10 % a year [A]
  kLight: 1.2e-10,  // per second per lux [A]
  yellowRatio: 0.15,// ground yellowing per unit of dose (as a density) [A]
});

export class ThermalPaper {
  /** `reversed`: the roll was put in with the coated side away from the head. */
  constructor({ reversed = false, ...o } = {}) {
    this.cal = { ...PAPER_CAL, ...o };
    this.reversed = reversed;
  }

  /** Normalised density developed by a peak surface temperature (degrees C). */
  mark(peakC) {
    if (this.reversed) return 0;
    const { T0, T1, shape } = this.cal;
    if (peakC <= T0) return 0;
    if (peakC >= T1) return 1;
    const t = (peakC - T0) / (T1 - T0);
    return Math.pow(t * t * (3 - 2 * t), shape);
  }
}

/** The fading dose for an exposure: seconds at an illuminance in lux (the one rate law). */
export function fadeDose({ seconds = 0, lux = 0 } = {}, cal = PAPER_CAL) {
  return (cal.kDark + cal.kLight * lux) * seconds;
}

/** Density after a dose. Monotonic: never darker, the more dose the lighter. */
export function fadeDensity(d0, dose) {
  return d0 * Math.exp(-dose);
}

/** The ground's yellowing (a density, 0 fresh) after a dose. */
export function groundYellow(dose, cal = PAPER_CAL) {
  return 1 - Math.exp(-cal.yellowRatio * dose);
}

/** Fade a whole density line or image in place. */
export function fadeImage(density, dose) {
  const f = Math.exp(-dose);
  for (let i = 0; i < density.length; i++) density[i] *= f;
  return density;
}
