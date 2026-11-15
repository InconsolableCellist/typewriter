// V.21 channel 2: 300 bit/s binary FSK, mark (1) 1650 Hz, space (0) 1850 Hz [M; the T.30 control channel].
//
// Transmitter: continuous-phase FSK at the line rate, bits from source.nextBit() (0, 1, or -1 to stop), the bit clock
// a fractional accumulator (26 2/3 samples a bit at 8 kHz). Carrier edges ramped over 2 ms [A].
//
// Receiver: a quadrature discriminator.
//   mix to complex baseband at the channel's centre, 1750 Hz -> 4th order Butterworth low-pass at 300 Hz on I and Q
//   -> instantaneous frequency from the phase step between samples -> a moving average of half a bit
//   -> bit timing by a digital phase-locked loop that pulls the bit clock toward the discriminator's zero crossings
//   -> a decision at the middle of each bit (frequency below the centre is mark, 1).
//   Carrier detect on the in-band power after the low-pass: on at -43 dBm0, off at -48 dBm0 [M], with 20 ms hold-off
//   [A]; on also needs 70 % of the line's power in the channel (I^2 + Q^2 is half the power of a centred sine) [A], so
//   the high-speed modems' signals do not bring it on, and it goes off when the share falls under 30 % (a high-speed
//   signal followed without a gap, as TCF follows DCS). Bits are delivered only while the carrier is on.

import { LINE_RATE, dbm0ToPeak, dbm0ToRms, MODEM_TX_DBM0 } from '../line/levels.js';
import { butterLowpass } from '../line/filters.js';

export const V21 = Object.freeze({ baud: 300, mark: 1650, space: 1850, centre: 1750 });

export class V21Transmitter {
  constructor({ source, levelDbm0 = MODEM_TX_DBM0, lineRate = LINE_RATE } = {}) {
    this.source = source;
    this.rate = lineRate;
    this.amp = dbm0ToPeak(levelDbm0);
    this.phase = 0; this.clock = 1; this.bit = 1;
    this.ramp = Math.round(0.002 * lineRate); this.rampT = 0;
    this.ending = -1;
    this.done = false;
    this.bits = 0;
  }
  process(out, offset, n) {
    const step = V21.baud / this.rate, w = 2 * Math.PI / this.rate;
    let made = 0;
    for (let i = 0; i < n; i++) {
      if (this.done) { out[offset + i] = 0; continue; }
      if (this.clock >= 1 && this.ending < 0) {
        this.clock -= 1;
        const b = this.source.nextBit();
        if (b < 0) this.ending = this.ramp;
        else { this.bit = b; this.bits++; }
      }
      this.clock += step;
      let g = 1;
      if (this.rampT < this.ramp) g = 0.5 - 0.5 * Math.cos(Math.PI * this.rampT / this.ramp);
      this.rampT++;
      if (this.ending >= 0) {
        g *= 0.5 - 0.5 * Math.cos(Math.PI * this.ending / this.ramp);
        if (this.ending-- === 0) this.done = true;
      }
      out[offset + i] = g * this.amp * Math.sin(this.phase);
      this.phase += w * (this.bit ? V21.mark : V21.space);
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      made++;
    }
    return made;
  }
}

export class V21Receiver {
  constructor({ sink = {}, lineRate = LINE_RATE, onDbm0 = -43, offDbm0 = -48 } = {}) {
    this.sink = sink;
    this.rate = lineRate;
    this.lpI = butterLowpass(300, lineRate, 4); this.lpQ = butterLowpass(300, lineRate, 4);
    this.w = 2 * Math.PI * V21.centre / lineRate; this.ph = 0;
    this.pi = 0; this.pq = 0;
    this.avgN = Math.round(lineRate / V21.baud / 2);
    this.avg = new Float64Array(this.avgN); this.avgPos = 0; this.avgSum = 0;
    this.step = V21.baud / lineRate;
    this.bitPhase = 0; this.lastD = 0;
    this.pw = 0; this.tw = 0; this.pwA = 1 / (0.004 * lineRate);
    // The low-pass passes the whole channel; a 0 dBm0 sine gives I^2 + Q^2 = peak^2 / 4 ... compare like for like.
    this.onLevel = (dbm0ToRms(onDbm0) ** 2) / 2; this.offLevel = (dbm0ToRms(offDbm0) ** 2) / 2;
    this.hold = Math.round(0.02 * lineRate); this.offRun = 0;
    this.cd = false;
    this.stats = { carrier: false, bits: 0, freqHz: 0 };
    this.k = 0.08;      // bit-clock pull per transition
  }
  process(x, offset, n) {
    const scale = this.rate / (2 * Math.PI);
    for (let i = 0; i < n; i++) {
      const v = x[offset + i];
      const I = this.lpI.step(v * Math.cos(this.ph)), Q = this.lpQ.step(-v * Math.sin(this.ph));
      this.ph += this.w; if (this.ph > 2 * Math.PI) this.ph -= 2 * Math.PI;
      const p = I * I + Q * Q;
      this.pw += this.pwA * (p - this.pw);
      this.tw += this.pwA * (v * v - this.tw);
      if (!this.cd) {
        // On needs the level and the shape: most of the line's power inside the channel (a V.21 signal puts nearly
        // all of it there; the high-speed modems and CED far less) [A].
        if (this.pw > this.onLevel && this.pw > 0.35 * this.tw) {
          this.cd = true; this.offRun = 0; this.stats.carrier = true; this.bitPhase = 0;
          if (this.sink.carrier) this.sink.carrier(true);
        }
      } else if (this.pw < this.offLevel || this.pw < 0.15 * this.tw) {
        if (++this.offRun >= this.hold) {
          this.cd = false; this.stats.carrier = false;
          if (this.sink.carrier) this.sink.carrier(false);
        }
      } else this.offRun = 0;
      // Phase step -> frequency offset from the centre (positive toward space, 1850 Hz).
      const cr = I * this.pi + Q * this.pq, ci = Q * this.pi - I * this.pq;
      this.pi = I; this.pq = Q;
      const df = p > 1e-12 ? Math.atan2(ci, cr) * scale : 0;
      this.avgSum += df - this.avg[this.avgPos];
      this.avg[this.avgPos] = df;
      if (++this.avgPos === this.avgN) this.avgPos = 0;
      const d = this.avgSum / this.avgN;
      // Bit clock: transitions should fall at phase 0 (mod 1); decisions at 0.5.
      if (this.cd && (d > 0) !== (this.lastD > 0)) {
        let e = this.bitPhase; if (e > 0.5) e -= 1;
        this.bitPhase -= this.k * e;
        if (this.bitPhase < 0) this.bitPhase += 1;
      }
      this.lastD = d;
      const before = this.bitPhase;
      this.bitPhase += this.step;
      if (this.bitPhase >= 1) this.bitPhase -= 1;
      if (before < 0.5 && this.bitPhase >= 0.5 && this.cd) {
        const bit = d < 0 ? 1 : 0;
        this.stats.bits++; this.stats.freqHz = V21.centre + d;
        if (this.sink.bit) this.sink.bit(bit);
      }
    }
  }
}
