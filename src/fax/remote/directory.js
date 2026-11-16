// The card index beside the machine: fictitious numbers in the reserved 555-01xx range, each a party on the
// in-browser exchange that shows the machine doing something real (plan section 3.2). Each card has a number, a name,
// the words written on it, and a party: a far-end fax (virtual-fax.js) with its behaviour, a person, or a line
// that is busy, dead or never answered.
//
//   555-0142  Records Room (the office down the hall): receives your page and, a minute later, calls back and
//             sends it to you as received, with its RECEIVED stamp
//   555-0167  Town Information Line: polling; gives the day's weather (with a halftone map) and the canteen menu
//   555-0188  M. Okafor (a correspondent): receives, and a few minutes later sends a short handwritten reply chosen
//             by what you sent
//   555-0123  Front Desk: a person, who answers by voice ("hello?") and hangs up on fax tones
//   555-0151  Lending Library: always busy
//   555-0119  Taxi Office: busy twice, then answers (automatic redial)
//   555-0133  Overseas Agent: a fax behind a noisy long-distance line; training fails at 9600 and 7200 and the call
//             steps down to 4800
//   555-0155  Print Shop: answers, but its machine is out of paper and cannot receive
//   555-0177  Night Office: rings and rings; nobody answers (T1)
//   555-0199  a number no longer in service (the exchange's reorder)
//   555-0100  the desk's own number (busy, as it would be)

import { VirtualFax } from './virtual-fax.js';
import { stampPage, infoSheet, replyNote } from './documents/index.js';
import { voiceSamples } from './voice.js';
import { inkOf } from '../firmware/page.js';

export const OWN_NUMBER = '555-0100';
export const OWN_NAME = 'THE DESK';
const key = (n) => String(n).replace(/[^0-9]/g, '').slice(-7);

export const CARDS = Object.freeze([
  { number: '555-0142', name: 'RECORDS ROOM', kind: 'echo', speed: 1, card: 'Records Room, Rm 14, down the hall. Sends back what it gets, stamped.' },
  { number: '555-0167', name: 'TOWN INFO LINE', kind: 'poll', speed: 2, card: 'Town Information Line. Weather and the canteen menu. POLL, no document.' },
  { number: '555-0188', name: 'M. OKAFOR', kind: 'reply', speed: 3, card: 'Margaret Okafor (collector). Answers in her own hand, sooner or later.' },
  { number: '555-0123', name: 'FRONT DESK', kind: 'voice', speed: 4, card: 'Front desk - voice only. Use the handset.' },
  { number: '555-0133', name: 'OVERSEAS AGENT', kind: 'noisy', speed: 5, card: 'Overseas agent. Bad line - be patient.' },
  { number: '555-0151', name: 'LENDING LIBRARY', kind: 'busy', speed: 6, card: 'Lending library. Always engaged.' },
  { number: '555-0119', name: 'TAXI OFFICE', kind: 'flaky', speed: 7, card: 'Taxi office. Usually engaged; keep trying.' },
  { number: '555-0155', name: 'PRINT SHOP', kind: 'nopaper', speed: 8, card: 'Print shop. Their machine is always out of paper.' },
  { number: '555-0177', name: 'NIGHT OFFICE', kind: 'noanswer', speed: 9, card: 'Night office. Staffed after 10 p.m. only.' },
  { number: '555-0199', name: 'OLD WAREHOUSE', kind: 'dead', speed: 10, card: 'Old warehouse - number crossed out.' },
]);

/** The desk's own machine as a warm start programs it (main.js's options.desk). */
export function deskProgramming() {
  const speed = [];
  for (const c of CARDS) speed[c.speed - 1] = { number: c.number, name: c.name };
  return { ownNumber: '+1 555 0100', ownName: OWN_NAME, speed };
}

const CALLBACK_S = 60;       // the Records Room calls back a minute later [A]
const REPLY_S = 180;         // the correspondent writes back three minutes later [A]
const RETRY_S = 60;
const MAX_TRIES = 5;

/** A party that is a fax machine, with what it does after a call. */
class FaxParty {
  constructor(dir, card, { answerRings = 2, line = {}, outOfPaper = false, pollDocument = null } = {}) {
    this.dir = dir;
    this.card = card;
    this.number = card.number;
    this.name = card.name;
    this.kind = card.kind;
    this.answerRings = answerRings;
    this.line = line;
    this.fax = new VirtualFax({ ident: `+1 ${card.number.replace('-', ' ')}`, outOfPaper, pollDocument });
    this.outbox = [];        // jobs to send to the desk: { pages, tries }
    this.attempts = 0;
    this.sent = [];          // records of calls it made
  }

  busy() { return false; }

  onConnect(call) {
    if (call.direction === 'in') this.fax.answer(call, (rec) => this.afterAnswer(rec));
    else {
      const job = this.outbox[0];
      this.fax.send(call, job.pages, (rec) => {
        this.sent.push(rec);
        if (rec.result?.ok) this.outbox.shift();
        else this.retry();
      });
    }
  }

  onRelease() { this.fax.release(); }
  onNoAnswer() { this.retry(); }

  afterAnswer() {}

  /** Queue pages for the desk and ring it after `delay` seconds. */
  sendLater(pages, delay) {
    this.outbox.push({ pages, tries: 0 });
    this.dir.clock.at(this.dir.clock.now() + delay, () => this.tryCall());
  }

  tryCall() {
    const job = this.outbox[0];
    if (!job || !this.dir.sb) return;
    job.tries++;
    if (!this.dir.sb.callIn(this)) this.retry();
  }

  retry() {
    const job = this.outbox[0];
    if (!job) return;
    if (job.tries >= MAX_TRIES) { this.outbox.shift(); return; }
    this.dir.clock.at(this.dir.clock.now() + RETRY_S, () => this.tryCall());
  }
}

class EchoParty extends FaxParty {
  afterAnswer(rec) {
    if (!rec.result?.ok || !rec.pages.length) return;
    const wall = this.dir.wallMs();
    this.sendLater(rec.pages.map((p) => stampPage(p, wall)), CALLBACK_S);
  }
}

class ReplyParty extends FaxParty {
  afterAnswer(rec) {
    if (!rec.result?.ok || !rec.pages.length) return;
    const ink = rec.pages.reduce((s, p) => s + inkOf(p), 0);
    this.sendLater([replyNote({ pages: rec.pages.length, wallMs: this.dir.wallMs() + REPLY_S * 1000, seed: ink % 997 })], REPLY_S);
  }
}

class FlakyParty extends FaxParty {
  constructor(dir, card, opts) { super(dir, card, opts); this.busyTimes = opts.busyTimes ?? 2; }
  busy() { return this.attempts++ < this.busyTimes; }
}

/** A person at a telephone. Answers "hello?"; on hearing fax tones, gives up and hangs up [A]. */
class VoiceParty {
  constructor(dir, card) {
    this.dir = dir; this.card = card; this.number = card.number; this.name = card.name; this.kind = 'voice';
    this.answerRings = 3;
    this.heard = [];
  }
  busy() { return false; }
  onConnect(call) {
    const clock = call.clock;
    let cng = 0, ced = false, said = 0;
    const nop = () => {};
    call.port.listen({ v21Carrier: nop, v21Bits: nop, hsCarrier: nop, hsBits: nop,
      tone: (t, on) => { if (!on) return; if (t === 'CNG') cng++; if (t === 'CED') ced = true; } });
    const talk = () => {
      if (call.ended) return;
      if (cng >= 2 || ced) { this.heard.push('fax'); call.say('oh - a fax machine.'); clock.at(clock.now() + 1.5, () => call.hangup()); return; }
      const text = said === 0 ? 'hello?' : 'hello? anyone there?';
      call.say(text, voiceSamples(text));
      this.heard.push(text);
      if (++said > 4) { clock.at(clock.now() + 2, () => call.hangup()); return; }
      clock.at(clock.now() + 3.5, talk);
    };
    clock.at(clock.now() + (call.direction === 'in' ? 0.6 : 1.2), talk);
  }
  onRelease() {}
}

class LineParty {
  constructor(card, kind) { this.card = card; this.number = card.number; this.name = card.name; this.kind = kind; this.answerRings = kind === 'noanswer' ? Infinity : 2; }
  busy() { return this.kind === 'busy'; }
  onConnect() {}
  onRelease() {}
}

export class Directory {
  /** clock: the shared clock; wallMs(): the wall-clock time now (for the correspondents' dates). */
  constructor({ clock, wallMs = () => Date.UTC(1999, 5, 1) + clock.now() * 1000 } = {}) {
    this.clock = clock;
    this.wallMs = wallMs;
    this.sb = null;
    this.parties = new Map();
    for (const c of CARDS) this.parties.set(key(c.number), this.make(c));
  }

  make(c) {
    switch (c.kind) {
      case 'echo': return new EchoParty(this, c);
      case 'poll': return new FaxParty(this, c, { pollDocument: () => [infoSheet(this.wallMs())] });
      case 'reply': return new ReplyParty(this, c, { answerRings: 3 });
      case 'voice': return new VoiceParty(this, c);
      case 'noisy': return new FaxParty(this, c, { answerRings: 2, line: { preset: 'bad', tcfErrorRate: (rate) => (rate >= 7200 ? 0.02 : 0) } });
      case 'flaky': return new FlakyParty(this, c, { busyTimes: 2 });
      case 'nopaper': return new FaxParty(this, c, { outOfPaper: true });
      default: return new LineParty(c, c.kind);
    }
  }

  /** Join the exchange (so correspondents can call back). */
  attach(sb) { this.sb = sb; }

  lookup(number) { return this.parties.get(key(number)) ?? null; }
  party(number) { return this.lookup(number); }

  /** A one-off sender for tests and demonstrations: a fax that calls the desk now and sends `pages`. */
  sender(pages, { number = '555-0180', name = 'TEST SENDER', ident } = {}) {
    const p = new FaxParty(this, { number, name, kind: 'sender' });
    if (ident) p.fax.ident = ident;
    p.outbox.push({ pages, tries: 0 });
    return p;
  }

  /** A one-off person who rings the desk (TEL/FAX tests). */
  caller({ number = '555-0181', name = 'A CALLER' } = {}) {
    return new VoiceParty(this, { number, name });
  }
}
