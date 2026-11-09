// Settings panel: telemetry and parameters. All values come from the snapshot, the last strike and soft.readouts.
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

const ROWS = [
  ['speed', 'impact speed', 'm/s'], ['peak', 'peak force', 'N'],
  ['contact', 'contact time', 'µs'], ['rest', 'restitution', ''],
  ['indent', 'indent', 'µm'], ['cx', 'carriage x', 'mm'],
  ['cv', 'carriage speed', 'mm/s'], ['ms', 'mainspring', 'N'],
  ['psi', 'platen angle', '°'], ['rten', 'ribbon tension', 'N'],
  ['rslk', 'ribbon slack', 'mm'], ['ink', 'ink at point', ''],
  ['skew', 'paper skew', '°'], ['lat', 'paper lateral', 'mm'],
  ['dsp', 'DSP load', '%'], ['fps', 'frame', 'ms'],
];

const PARAMS = [
  { id: 'force', label: 'strike force', unit: 'N', min: 10, max: 60, step: 0.5, value: 34 },
  { id: 'hardness', label: 'platen hardness', unit: '×', min: 0.5, max: 3, step: 0.05, value: 1, from: (m) => m.slug.foundationKPerM2 / 4.0e11, param: 'slug.foundationKPerM2', scale: 4.0e11 },
  { id: 'cmass', label: 'carriage mass', unit: 'kg', min: 0.3, max: 4, step: 0.01, value: 2.05, from: (m) => m.carriage.mass, param: 'carriage.mass' },
  { id: 'spring', label: 'mainspring', unit: 'N', min: 1, max: 12, step: 0.1, value: 4.6, from: (m) => m.carriage.drawbandPreload, param: 'carriage.drawbandPreload' },
  { id: 'wear', label: 'slug wear', unit: 'mm', min: 0, max: 0.3, step: 0.005, value: 0, scale: -1e-3, baseline: 0.00035, from: (m) => (0.00035 - m.slug.reliefDepth) / 1e-3, param: 'slug.reliefDepth' },
  { id: 'ribink', label: 'ribbon ink', unit: '', min: 0, max: 1, step: 0.01, value: 1, param: 'ribbon.ink' },
  { id: 'time', label: 'time scale', unit: '', min: -3, max: 0, step: 0.01, value: 0, log: true },
];

const svg = (body) => `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const CLOUD = '<path d="M4.4 9.6a2.4 2.4 0 0 1 .3-4.8 3.3 3.3 0 0 1 6.3.6 2.1 2.1 0 0 1 .4 4.2z"/>';
const WEATHER_ICONS = {
  clear: svg('<circle cx="8" cy="8" r="2.9"/><path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1"/>'),
  rain: svg(`${CLOUD}<path d="M5.4 12l-.7 1.8M8.2 12l-.7 1.8M11 12l-.7 1.8"/>`),
  storm: svg(`${CLOUD}<path d="M8.6 10.2l-1.9 2.6h2.3l-1.5 2.2"/>`),
};

// The horizon strip: sky keyed to the same time line as the environment.
const SKY_PAD = 7;
const SKY_KEYS = [
  [0, [9, 14, 34], [26, 36, 68]], [0.2, [57, 56, 95], [232, 160, 112]], [0.45, [95, 149, 198], [207, 224, 238]],
  [0.65, [127, 160, 184], [240, 210, 160]], [0.82, [58, 42, 85], [232, 122, 82]], [1, [9, 14, 34], [26, 36, 68]],
];

function drawSky(c, t, weather) {
  const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let i = 0;
  while (i < SKY_KEYS.length - 2 && t > SKY_KEYS[i + 1][0]) i++;
  const [t0, top0, hor0] = SKY_KEYS[i], [t1, top1, hor1] = SKY_KEYS[i + 1], f = (t - t0) / (t1 - t0);
  const mix = (a, b) => a.map((v, k) => v + (b[k] - v) * f);
  const dim = weather === 'storm' ? 0.5 : weather === 'rain' ? 0.72 : 1;
  const css = (rgb) => `rgb(${rgb.map((v) => Math.round(v * dim)).join(',')})`;
  const ground = H - 5;
  const g = ctx.createLinearGradient(0, 0, 0, ground);
  g.addColorStop(0, css(mix(top0, top1))); g.addColorStop(1, css(mix(hor0, hor1)));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // The sun's day runs dawn to dusk; the moon takes the rest, across midnight at the strip's ends.
  const isSun = t >= 0.2 && t <= 0.82;
  const alt = (v) => (v >= 0.2 && v <= 0.82 ? Math.sin(Math.PI * (v - 0.2) / 0.62) : 0.75 * Math.sin(Math.PI * (((v - 0.82 + 1) % 1) / 0.38)));
  const X = (v) => SKY_PAD + v * (W - 2 * SKY_PAD), Y = (v) => ground - 3.5 - alt(v) * (ground - 9);
  if (!isSun) {
    ctx.fillStyle = 'rgba(235,238,255,.75)';
    for (const [sx, sy] of [[0.08, 0.3], [0.18, 0.62], [0.33, 0.2], [0.47, 0.5], [0.61, 0.28], [0.74, 0.58], [0.9, 0.22]]) ctx.fillRect(sx * W, sy * ground, 1, 1);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.setLineDash([1.5, 3]); ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = 0.2; v <= 0.82; v += 0.02) { if (v === 0.2) ctx.moveTo(X(v), Y(v)); else ctx.lineTo(X(v), Y(v)); }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#17150f'; ctx.fillRect(0, ground, W, H - ground);
  ctx.fillStyle = 'rgba(255,255,255,.34)';
  for (const p of [0.2, 0.45, 0.65, 0.82]) ctx.fillRect(Math.round(X(p)), ground + 1, 1, 3);
  const x = X(t), y = Y(t);
  if (isSun) {
    ctx.fillStyle = 'rgba(255,214,140,.28)'; ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffdf9e'; ctx.beginPath(); ctx.arc(x, y, 3.8, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = '#e8ecff'; ctx.beginPath(); ctx.arc(x, y, 3.8, 0, 7); ctx.fill();
    ctx.fillStyle = css(mix(top0, top1)); ctx.beginPath(); ctx.arc(x + 1.7, y - 0.8, 3.4, 0, 7); ctx.fill();
  }
}

export class Panel {
  constructor({ sim, soft, machine, onFreeBars, onResetPaper, onResetAll, onAshtray }) {
    // Sliders are live and push their value at start-up, so each starts from the selected machine's own number.
    this.paramDefs = PARAMS.map((p) => ({ ...p, value: machine && p.from ? p.from(machine) : p.value }));
    this.sim = sim; this.soft = soft;
    this.el = document.getElementById('panel');
    this.el.innerHTML = this.html();
    this.values = {};
    for (const [id] of ROWS) this.values[id] = this.el.querySelector(`#v-${id}`);
    this.prev = {};
    this.scope = this.el.querySelector('#scope');
    this.scopeCtx = this.scope.getContext('2d');
    this.strike = null;
    this.params = {};
    this.sent = new Map();
    this.flick = 0.035;
    this.frameMs = 16;
    for (const p of this.paramDefs) this.bindParam(p);
    this.tip = document.getElementById('forceTip');
    this.labelTip = document.getElementById('labelTip');
    this.labelsOn = true;
    this.el.querySelector('#wxs').addEventListener('change', (e) => { this.onWeatherSound?.(e.target.checked); e.target.blur(); });
    this.el.querySelector('#lbl').addEventListener('change', (e) => { this.labelsOn = e.target.checked; if (!this.labelsOn) this.showLabel(0, 0, null); });
    const act = (id, fn) => this.el.querySelector(id).addEventListener('click', (e) => { fn(e); e.currentTarget.blur(); });   // typing must not land on a button
    act('#a-paper', () => onResetPaper?.());
    act('#a-ribbon', () => this.soft.resetRibbon?.());
    act('#a-free', () => onFreeBars?.());
    act('#a-all', () => onResetAll?.());
    const unlimited = this.el.querySelector('#a-unlimited');
    act('#a-unlimited', () => {
      const on = unlimited.getAttribute('aria-pressed') !== 'true';
      unlimited.setAttribute('aria-pressed', String(on));
      this.send('typing.unlimited', on);
    });
    const ashtray = this.el.querySelector('#a-ashtray');
    act('#a-ashtray', () => {
      const on = ashtray.getAttribute('aria-pressed') !== 'true';
      ashtray.setAttribute('aria-pressed', String(on));
      onAshtray?.(on);
    });
    this.el.querySelector('#a-paper').disabled = !this.soft.resetPaper;
    this.el.querySelector('#a-ribbon').disabled = !this.soft.resetRibbon;
    this.el.classList.add('collapsed');           // the live readouts and sliders stay out of the way until asked for
    this.el.querySelector('#collapse').addEventListener('click', () => this.el.classList.toggle('collapsed'));
    this.drawScope();
  }

  html() {
    return `
      <div class="panel-head">
        <span class="title">SETTINGS</span>
        <label class="toggle" title="rain and thunder"><input type="checkbox" id="wxs" checked><span>WEATHER SOUND</span></label><label class="toggle"><input type="checkbox" id="lbl" checked><span>LABELS</span></label>
        <button id="collapse" title="collapse">▾</button>
      </div>
      <canvas id="scope"></canvas>
      <div class="grid">
        ${ROWS.map(([id, label, unit]) => `<div class="row"><span class="k">${label}</span><span class="v"><span id="v-${id}">—</span><span class="u">${unit}</span></span></div>`).join('')}
      </div>
      <div class="actions"><button id="a-paper">reset paper</button><button id="a-ribbon">reset ribbon</button><button id="a-free">free bars</button><button id="a-all">reset all</button></div>
      <div class="actions"><button id="a-unlimited" aria-pressed="false" title="no speed limit and no typebar collisions; not realistic">unlimited typing</button><button id="a-ashtray" aria-pressed="true" title="the ashtray, cigarette and lighter on the desk">ashtray</button></div>
      <div class="actions"><select id="a-machine" title="machine" aria-label="machine"></select></div>
      <div class="env-row">
        <canvas id="env-sky" role="slider" aria-label="time of day" title="drag to set the time of day"></canvas>
        <div class="env-wx" role="group" aria-label="weather">${Object.entries(WEATHER_ICONS).map(([n, icon]) => `<button data-w="${n}" aria-pressed="false" title="${n}" aria-label="${n}">${icon}</button>`).join('')}</div>
      </div>
      <details class="params" open>
        <summary>parameters</summary>
        <div class="note" id="slowNote" hidden>acoustics are nearly silent at slow time scales</div>
        ${this.paramDefs.map((p) => `<div class="p"><span class="k">${p.label}</span><input type="range" id="p-${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}"><span class="v"><span id="pv-${p.id}"></span><span class="u">${p.unit}</span></span></div>`).join('')}
      </details>`;
  }

  /** The horizon strip and weather buttons; they follow the environment if it changes from elsewhere. */
  bindEnvironment(env) {
    const sky = this.el.querySelector('#env-sky'), buttons = [...this.el.querySelectorAll('.env-wx button')];
    const draw = () => {
      drawSky(sky, env.timeValue, env.weather);
      sky.setAttribute('aria-valuetext', env.time);
      sky.title = `${env.time}: drag to set the time of day`;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.w === env.weather));
    };
    // Settles on a preset when close to one, so "day" is reachable exactly.
    const at = (e) => {
      const r = sky.getBoundingClientRect();
      let t = Math.min(1, Math.max(0, (e.clientX - r.left - SKY_PAD) / (r.width - 2 * SKY_PAD)));
      for (const p of Object.values(env.presets)) if (Math.abs(t - p) < 0.018) t = p;
      env.setTime(t);
    };
    let held = false;
    sky.addEventListener('pointerdown', (e) => { e.preventDefault(); held = true; sky.setPointerCapture(e.pointerId); at(e); });
    sky.addEventListener('pointermove', (e) => { if (held) at(e); });
    const release = () => { held = false; };
    sky.addEventListener('pointerup', release); sky.addEventListener('pointercancel', release);
    for (const b of buttons) b.addEventListener('click', () => { env.setWeather(b.dataset.w); b.blur(); });   // typing must not land on a button
    env.onChange(draw);
    new ResizeObserver(draw).observe(sky);
    draw();
  }

  send(path, value) { this.sent.set(path, value); this.sim.setParam(path, value); }

  /** The sim moves to the audio thread on the first gesture and starts from the machine definition: set everything again. */
  resendParams() { for (const [path, value] of this.sent) this.sim.setParam(path, value); }

  bindParam(p) {
    const input = this.el.querySelector(`#p-${p.id}`), v = this.el.querySelector(`#pv-${p.id}`);
    this.params[p.id] = input;
    const apply = () => {
      const val = parseFloat(input.value);
      if (p.log) {
        const scale = Math.pow(10, val);
        v.textContent = scale >= 0.01 ? scale.toFixed(3) : `1/${Math.round(1 / scale)}`;
        this.sim.setTimeScale(scale);
        this.el.querySelector('#slowNote').hidden = scale >= 0.5;
      } else {
        v.textContent = val.toFixed(p.step < 0.05 ? 2 : p.step < 1 ? 2 : 0);
        if (p.param) { const v2 = p.scale ? (p.baseline ?? 0) + val * p.scale : val; this.send(p.param, v2); this.soft.setParam?.(p.param, v2); }
      }
    };
    input.addEventListener('input', apply);
    apply();
  }


  /** Live finger force while a key is held under the pointer. */
  showForce(x, y, N) {
    const t = this.tip;
    t.style.display = 'block';
    t.style.left = `${x + 16}px`; t.style.top = `${y - 34}px`;
    t.firstChild.textContent = `${N.toFixed(1)} N`;
    t.lastChild.style.width = `${Math.min(100, (N / 45) * 100)}%`;
    t.style.minWidth = '64px';
  }

  /** Hover name of the part under the pointer; null clears it. */
  showLabel(x, y, text) {
    const t = this.labelTip;
    if (!text || !this.labelsOn) { t.style.display = 'none'; return; }
    t.textContent = text; t.style.display = 'block';
    t.style.left = `${Math.min(x + 14, window.innerWidth - t.offsetWidth - 8)}px`; t.style.top = `${y + 18}px`;
  }

  hideForce() { this.tip.style.display = 'none'; }

  strikeForce() { return parseFloat(this.params.force.value); }
  flickGain() { return this.flick; }

  setStrike(evt) { this.strike = evt; this.drawScope(); }

  drawScope() {
    const c = this.scope, ctx = this.scopeCtx;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(170,180,195,0.13)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) { const y = (i / 5) * h; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    const e = this.strike;
    ctx.font = '9.5px "IBM Plex Mono", "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(190,195,205,0.55)';
    if (!e) { ctx.fillText('awaiting strike', 8, 14); return; }
    const t = e.trace; const n = t.force.length;
    const fMax = e.peakForce || 1, xMax = e.maxIndent || 1;
    const X = (i) => (i / Math.max(1, n - 1)) * w;
    const line = (arr, max, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const y = h - 6 - (arr[i] / max) * (h - 14); if (i) ctx.lineTo(X(i), y); else ctx.moveTo(X(i), y); }
      ctx.stroke();
    };
    line(t.force, fMax, '#f2b56b');
    line(t.indent, xMax, '#7fbcd8');
    ctx.fillStyle = '#f2b56b'; ctx.fillText(`F ${fMax.toFixed(1)} N`, 8, 13);
    ctx.fillStyle = '#7fbcd8'; ctx.fillText(`δ ${(xMax * 1e6).toFixed(1)} µm`, 70, 13);
    ctx.fillStyle = 'rgba(190,195,205,0.55)';
    ctx.textAlign = 'right';
    ctx.fillText(`${(n * t.dt * 1e6).toFixed(0)} µs`, w - 6, 13);
    ctx.textAlign = 'left';
  }

  set(id, text) {
    if (this.prev[id] === text) return;
    this.prev[id] = text;
    if (this.values[id]) this.values[id].textContent = text;
  }

  update(state, L, frameMs) {
    const e = this.strike;
    if (e) {
      this.set('speed', fmt(e.vImpact, 2)); this.set('peak', fmt(e.peakForce, 1));
      this.set('contact', fmt(e.duration * 1e6, 0)); this.set('rest', fmt(e.restitution, 2));
      this.set('indent', fmt(e.maxIndent * 1e6, 1));
    }
    this.set('cx', fmt(state[L.carriageX] * 1000, 2));
    this.set('cv', fmt(state[L.carriageV] * 1000, 1));
    this.set('ms', fmt(state[L.mainspringN], 2));
    this.set('psi', fmt((state[L.platenPsi] * 180) / Math.PI, 1));
    const r = this.soft.readouts();
    this.set('rten', fmt(r.ribbonTensionN, 2)); this.set('rslk', fmt(r.ribbonSlackMm, 1));
    this.set('ink', fmt(r.inkAtPoint, 2));
    this.set('skew', fmt(r.skewDeg, 2)); this.set('lat', fmt(r.lateralMm, 2));
    this.set('dsp', fmt(state[L.dspLoad] * 100, 1));
    this.set('fps', fmt(frameMs, 1));
  }
}
