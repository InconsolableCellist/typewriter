// Layout of the parts the machine definition leaves to the renderer: where rails, rack, dogs and
// brackets sit. Everything is derived from the definition and deriveGeometry so that a new machine
// definition moves the drawing with it. Values are metres, world coordinates (x right, y up, z to typist).
import { vec3 as v } from '../machine/geometry.js';


export function deriveRig(m, g) {
  const c = m.platen.center;
  const R = m.platen.radius;
  const halfL = m.platen.length / 2;
  const ppt = g.printPoint;
  const n = g.printNormal;
  const w = g.strikeDown;

  // Carriage rails sit behind the platen so the typebars have clear air in front of it.
  // These match the frame casting (frame_rails in public/assets/models/frame.glb).
  const railY = c[1] - 0.034;
  const railRadius = 0.0038;
  const railFrontZ = c[2] - 0.022;
  const railRearZ = c[2] - 0.062;
  const railHalf = 0.178;
  const endPlateX = halfL + 0.006;
  const knobX = halfL + m.platen.knobOffset;

  // Escapement behind the rear rail; the rack rides on the carriage, the dogs on the frame.
  const rack = {
    y: railY - 0.010, z: railRearZ - 0.008,
    halfLength: m.carriage.travel / 2 + 0.03,
    pitch: m.escapement.pitch, depth: m.escapement.toothDepth,
  };

  // Universal bar sits under the rear of the key levers; a link carries it to the rocker.
  const ubarY = g.bars[0] ? m.keys.leverPivot[1] + 0.026 : 0.084;
  const ubar = { y: ubarY, z: m.keys.leverPivot[2] + 0.018, halfWidth: 0.094, travel: 0.0045 };
  const rocker = { pivot: [0, rack.y - 0.022, rack.z + 0.012], arm: 0.022 };

  // Line-space lever swings on the left end of the carriage, sweeping toward +x (to the right).
  const lsPivot = [-(endPlateX + 0.012), c[1] + 0.022, c[2] + 0.010];
  const lsAxis = v.norm([0.05, 0.86, 0.22]);
  const lsRest = v.norm([-0.42, 0.18, 0.88]);

  // Bail swings on arms pivoted at the rear top of the end plates.
  const a = m.printPoint.beta + m.paper.bailAngle;
  const bailDir = [0, Math.sin(a), Math.cos(a)];
  const bailRadius = m.paper.bailRodRadius;
  const bailPivot = [0, c[1] + 0.012, c[2] - 0.022];   // behind and below the bar, so opening swings it up and off the sheet
  const bailBar = v.add(c, v.mul(bailDir, R + m.paper.bailRollerRadius + 0.00018));  // rollers ride on the sheet, the bar clears it

  // Feed rolls: angle measured from the print point around the platen.
  const feedRolls = m.paper.feedRollAngle.map((da) => {
    const ang = m.printPoint.beta + da;
    return { angle: ang, radius: 0.0052, center: v.add(c, v.mul([0, Math.sin(ang), Math.cos(ang)], R + 0.0052 + 0.00018)) };
  });

  // Type guide fork, straddling the slug path just below the print line.
  const guidePos = v.add(v.add(ppt, v.mul(w, 0.0078)), v.mul(n, 0.0036));

  // Bars rest on a felt arc under about 70 % of their length.
  const restPadFrac = 0.72;

  const bellC = [0.086, railY - 0.044, railRearZ + 0.005];
  const bell = { center: bellC, radius: 0.021, hammerPivot: [0.058, bellC[1] - 0.0124, railRearZ + 0.005] };
  const marginRail = { y: c[1] + 0.008, z: railRearZ - 0.014, halfLength: m.carriage.travel / 2 + 0.018 };

  return {
    c, R, halfL, railY, railRadius, railFrontZ, railRearZ, railHalf, endPlateX, knobX, rack, ubar, rocker,
    ls: { pivot: lsPivot, axis: lsAxis, rest: lsRest, length: m.lineSpace.leverLength },
    bail: { dirRest: bailDir, bar: bailBar, pivot: bailPivot, radius: bailRadius, lift: 0.5 },
    feedRolls, guidePos, restPadFrac, bell, marginRail,
    tableTilt: 0.9, tableLength: 0.12,
    panClear: m.paper.panClearance,
    carriageRelease: { pos: [endPlateX + 0.012, c[1] + 0.024, c[2] + 0.018] },
    paperRelease: { pos: [endPlateX + 0.008, c[1] + 0.032, c[2] - 0.018] },
    ribbonSelector: { pos: [m.ribbon.spoolX + 0.015, m.ribbon.spoolY - 0.017, m.ribbon.spoolZ + 0.052] },
  };
}

/**
 * World x of the carriage for the snapshot's carriageX: a line starts with the carriage right of centre
 * (x = +startX, the print point near the sheet's left edge) and typing decreases x, moving it left.
 */
export function carriageWorldX(carriageX) { return carriageX; }
