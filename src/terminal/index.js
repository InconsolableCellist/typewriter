// Terminal mode: the machine as a paper teletype on a real local shell. The keyboard goes to the PTY; what comes back
// is printed by working the mechanism through PrintDriver. Started with `npm run term` plus the URL it prints, or the
// TTY button in the panel. Nothing here runs until the user asks for it.
import { TeletypeParser } from './parser.js';
import { buildCharMap } from './charmap.js';
import { PrintDriver } from './driver.js';
import { TermBridge, bridgeUrl } from './bridge.js';
import { keyEventToBytes, pasteToBytes, stringToBytes } from './keys.js';

const HIGH_WATER = 3000, LOW_WATER = 800;   // queued ops: pause and resume the shell's output (the PTY's own flow control)
const STYLE = `
#termStrip{position:fixed;left:50%;transform:translateX(-50%);top:14px;display:flex;align-items:center;gap:10px;z-index:30;
  font:11px "IBM Plex Mono","SF Mono",Menlo,Consolas,monospace;color:#d8d4c8;background:rgba(14,15,18,.86);border:1px solid rgba(255,255,255,.12);
  border-radius:6px;padding:5px 10px;max-width:92vw}
#termStrip[hidden]{display:none}
#termStrip .msg{color:#f2b56b}#termStrip .state{white-space:nowrap}
#termStrip button,#termStrip input{font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:4px;padding:2px 7px}
#termStrip button[aria-pressed=true]{background:rgba(242,181,107,.28)}
#termStrip input{width:34ch}
#termBtn[aria-pressed=true]{background:rgba(242,181,107,.28)}`;

export function installTerminal(deps) {
  if (deps.sim.isMock) return null;
  const mode = new TerminalMode(deps);
  const params = new URLSearchParams(location.search);
  if (params.has('terminal')) mode.enter({ token: params.get('terminal'), port: params.get('termport') ?? 5318 });
  return mode;
}

export class TerminalMode {
  constructor({ sim, soft, machine, geometry, hands, unlockAudio }) {
    Object.assign(this, { sim, soft, machine, geometry, hands, unlockAudio });
    this.on = false;
    this.charMap = buildCharMap(geometry);
    this.cols = Math.floor((sim.state[sim.layout.marginL] - sim.state[sim.layout.marginR]) / machine.escapement.pitch + 1e-6);
    this.parser = new TeletypeParser({ cols: this.cols });
    this.paper = {
      needsNewSheet: () => {
        const v = soft.readouts().printV;
        return v === null || v === undefined || v > machine.paper.height - 0.025;
      },
      newSheet: () => { hands.loadPaper(); return this.whenPaperLoaded(); },
    };
    this.driver = new PrintDriver({ sim, geometry, machine, hands, charMap: this.charMap, paper: this.paper });
    this.driver.onScreen = () => this.say('This is a paper teletype: full-screen programs cannot run here.');
    this.bridge = new TermBridge();
    this.lastByteT = 0;
    this.paused = false;
    this.timer = null;
    this.buildUi();
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onPaste = this.onPaste.bind(this);
  }

  // ---- ui ----------------------------------------------------------------------------
  buildUi() {
    const style = document.createElement('style'); style.textContent = STYLE; document.head.append(style);
    const strip = document.createElement('div'); strip.id = 'termStrip'; strip.hidden = true;
    strip.innerHTML = `<span class="state" id="termState"></span><span class="msg" id="termMsg"></span>
      <input id="termUrl" placeholder="paste the URL printed by npm run term" hidden>
      <button id="termSpeed" title="fast mode removes bar collisions and the speed limit; not realistic" aria-pressed="false">fast</button>
      <button id="termExit">exit</button>`;
    document.body.append(strip);
    this.strip = strip;
    this.elState = strip.querySelector('#termState'); this.elMsg = strip.querySelector('#termMsg');
    this.elUrl = strip.querySelector('#termUrl'); this.elSpeed = strip.querySelector('#termSpeed');
    strip.querySelector('#termExit').addEventListener('click', () => this.exit());
    this.elSpeed.addEventListener('click', () => this.setFast(this.elSpeed.getAttribute('aria-pressed') !== 'true'));
    this.elUrl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const parsed = parseBridgeUrl(this.elUrl.value);
      if (!parsed) { this.say('that does not look like the URL from npm run term'); return; }
      this.elUrl.hidden = true;
      this.enter(parsed);
    });
    // The compact control lives in the panel's action row (the header toggles there are being retired).
    const actions = document.querySelector('#panel .actions');
    if (actions) {
      const btn = document.createElement('button'); btn.id = 'termBtn'; btn.textContent = 'TTY';
      btn.title = 'use the machine as a paper teletype on a local shell (needs npm run term)';
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => (this.on ? this.exit() : this.prompt()));
      actions.append(btn);
      this.btn = btn;
    }
  }

  prompt() { this.strip.hidden = false; this.elUrl.hidden = false; this.elState.textContent = 'TTY'; this.elMsg.textContent = ''; this.elUrl.focus(); }

  say(text, ms = 7000) {
    this.elMsg.textContent = text;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => { this.elMsg.textContent = ''; }, ms);
  }

  setFast(on) {
    this.elSpeed.setAttribute('aria-pressed', String(on));
    this.driver.setSpeed(on ? 'fast' : 'standard');
    this.applyUnlimited(on);
  }

  /** typing.unlimited is on only while fast mode is, and otherwise follows the panel's own toggle. */
  applyUnlimited(on) { this.sim.setParam('typing.unlimited', on || document.querySelector('#a-unlimited')?.getAttribute('aria-pressed') === 'true'); }

  // ---- lifecycle -----------------------------------------------------------------------
  async enter({ token, port }) {
    if (this.on) return;
    this.on = true;
    this.btn?.setAttribute('aria-pressed', 'true');
    this.strip.hidden = false; this.elUrl.hidden = true;
    this.elState.textContent = 'TTY: loading paper';
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('paste', this.onPaste, true);
    this.hands.freeBars();
    this.parser = new TeletypeParser({ cols: this.cols });
    try {
      await this.loadPaper();
      if (!this.on) return;
      this.elState.textContent = 'TTY: connecting';
      this.bridge.onBytes = (b) => this.onBytes(b);
      this.bridge.onClose = (why) => { this.say(`shell closed: ${why}`); this.exit(); };
      await this.bridge.connect(bridgeUrl({ token, port, cols: this.cols }));
    } catch (e) {
      this.say(`terminal: ${e.message}. Run npm run term and use the URL it prints.`, 12000);
      this.elState.textContent = 'TTY: not connected';
      this.teardown();
      return;
    }
    this.timer = setInterval(() => this.tick(), 8);
  }

  /** Called by the panel button or by the shell ending. */
  exit() {
    this.teardown();
    this.strip.hidden = true;
  }

  teardown() {
    this.on = false;
    this.btn?.setAttribute('aria-pressed', 'false');
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('paste', this.onPaste, true);
    clearInterval(this.timer); this.timer = null;
    this.bridge.close();
    this.driver.shutdown();
    if (this.elSpeed.getAttribute('aria-pressed') === 'true') this.setFast(false);
  }

  /** A clean sheet to the top margin, then the carriage to the left margin. */
  async loadPaper() {
    // hands.loadPaper is the shared paper routine (src/interact/hands.js); it measures the sheet's real position.
    this.hands.loadPaper();
    await this.whenPaperLoaded();
    // The carriage goes home by the bare return (release lever and a hand), so no line is spaced before the first one.
    this.driver.enqueue([{ t: 'cr' }]);
    while (!this.driver.idle && this.on) { this.driver.tick(); await sleep(8); }
  }

  async whenPaperLoaded() { await sleep(50); while (this.hands.cancelLoad) await sleep(30); }

  // ---- data paths ------------------------------------------------------------------------
  onBytes(bytes) {
    this.lastByteT = performance.now();
    this.driver.enqueue(this.parser.feed(bytes));
  }

  tick() {
    // A CR held in case an LF followed is resolved once the line has gone quiet, at either pace.
    if (performance.now() - this.lastByteT > 60) this.driver.enqueue(this.parser.flush());
    this.driver.tick();
    const q = this.driver.queued;
    if (!this.paused && q > HIGH_WATER) { this.paused = true; this.bridge.control('pause'); }
    else if (this.paused && q < LOW_WATER) { this.paused = false; this.bridge.control('resume'); }
    this.elState.textContent = `TTY ${this.cols}col  queue ${q}${this.paused ? ' (paused)' : ''}`;
  }

  onKeyDown(e) {
    const tag = e.target?.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'range')) return;
    if (!this.bridge.open) return;
    this.unlockAudio?.(); this.unlockAudio = null;
    const bytes = keyEventToBytes(e);
    if (bytes === null) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (bytes === '\x03') { this.driver.clear(); this.bridge.control('flush'); this.paused = false; }
    this.bridge.send(stringToBytes(bytes));
  }

  onPaste(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const text = e.clipboardData?.getData('text');
    if (text && this.bridge.open) { e.preventDefault(); e.stopImmediatePropagation(); this.bridge.send(stringToBytes(pasteToBytes(text))); }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseBridgeUrl(text) {
  try {
    const u = new URL(text.trim());
    const token = u.searchParams.get('terminal'), port = u.searchParams.get('termport');
    return token && port ? { token, port } : null;
  } catch { return null; }
}
