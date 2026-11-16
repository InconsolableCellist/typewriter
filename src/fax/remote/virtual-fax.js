// A far-end fax machine: the same T.30 stack as the FO-70 (src/fax/t30/), with a virtual scanner (a list of page
// bitmaps) and a virtual printer (the pages it received, decoded). Its mechanism is not modelled (plan section 2).
// It answers a call (receiving, or transmitting when polled and it holds a document) or makes one (sending pages,
// or polling). Runs on the call's clock through call.js's CallDriver.

import { CallDriver } from '../firmware/call.js';
import { T30Caller } from '../t30/caller.js';
import { T30Answerer } from '../t30/answerer.js';
import { bitmapSource, pageChecker } from '../firmware/page.js';

export class VirtualFax {
  /**
   * ident: its CSI/TSI (a number, as machines of the period set it); caps / advertise: its capability table and
   * extra DIS bits (a later machine may offer V.17, ECM and MMR, which the FO-70 declines); outOfPaper: answers but
   * cannot receive (DIS without the receive bit); pollDocument: () => pages it gives when polled.
   */
  constructor({ ident = '', caps = undefined, advertise = null, outOfPaper = false, pollDocument = null, vres = 'fine' } = {}) {
    this.ident = ident;
    this.caps = caps;
    this.advertise = advertise;
    this.outOfPaper = outOfPaper;
    this.pollDocument = pollDocument;
    this.vres = vres;
    this.inbox = [];           // every page received: { width, height, vres, rows }
    this.calls = [];           // { direction, result, pagesSent, pagesReceived, remoteIdent, pages }
    this.drv = null;
  }

  _driver(call, station, done) {
    const rec = { direction: call.direction, startedAt: call.clock.now(), result: null, pages: [], station };
    this.calls.push(rec);
    const drv = new CallDriver({
      clock: call.clock, station, port: call.port, name: this.ident,
      onEvent: (a) => {
        if (a.type !== 'hangup') return;
        rec.result = station.result;
        rec.remoteIdent = station.remote.ident;
        // Leave the line a moment after DCN, as a machine does [A].
        call.clock.at(call.clock.now() + 0.3, () => call.hangup());
        done?.(rec);
      },
    });
    this.drv = drv;
    rec.drv = drv;
    rec.done = done;
    return { drv, rec };
  }

  /** Answer: receive (and, when polled, send pollDocument). `done(rec)` when the call ends; rec.pages received. */
  answer(call, done) {
    const pollPages = this.pollDocument?.() ?? null;
    let rec;
    const station = new T30Answerer({
      ident: this.ident, caps: this.caps,
      advertise: this.outOfPaper ? { ...(this.advertise ?? {}), canReceive: false } : this.advertise,
      source: pollPages ? bitmapSource(pollPages) : null,
      vres: this.vres,
      checker: pageChecker((page) => { this.inbox.push(page); rec.pages.push(page); }),
    });
    ({ rec } = this._driver(call, station, done));
    rec.drv.start();
    return rec;
  }

  /** Call out: send `pages` (or poll, `poll: true`). */
  send(call, pages, done, { poll = false } = {}) {
    let rec;
    const station = new T30Caller({
      ident: this.ident, caps: this.caps, advertise: this.advertise, poll, vres: this.vres,
      source: poll ? null : bitmapSource(pages),
      checker: pageChecker((page) => { this.inbox.push(page); rec.pages.push(page); }),
    });
    ({ rec } = this._driver(call, station, done));
    rec.drv.start();
    return rec;
  }

  /** The line has gone (the subscriber hung up): forget the call. */
  release() {
    const drv = this.drv;
    this.drv = null;
    if (!drv) return;
    drv.drop();
    const rec = this.calls.at(-1);
    if (rec && !rec.result) {
      // The line went before DCN was heard: complete if every page had been answered and DCN was all that was due.
      const st = rec.station;
      rec.result = { reason: 'line-released', ok: st.state === 'R.waitDCN', pagesSent: st.pagesSent, pagesReceived: st.pagesReceived };
      rec.remoteIdent = st.remote.ident;
      rec.done?.(rec);
    }
  }
}
