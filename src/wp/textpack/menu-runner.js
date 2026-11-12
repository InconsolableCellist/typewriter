// Menus (SR 3.1 to 3.3, ORG p.64 to 67). The cursor stays on the prompt line and only typing and BKSP move it; the
// cursor keys do nothing there (ORG p.32). Long form: ID, ENTER, value, ENTER. Short form: ID, space, value, ENTER.
// A changed choice is highlighted; ENTER on an empty prompt accepts the whole menu. CANCL removes one level at a time:
// the typed answer, the YOUR CHOICE prompt, every changed choice, then the menu itself (SR 3.2).
import { ROW, ATTR } from '../screen.js';
import { fmt } from './messages.js';
import { getKey, drawPrompt, isCancel, isEnter, isChar } from './input.js';

/** Menu state that outlives one call: the values, and the ones the menu opened with (for highlighting and CANCL). */
export function menuState(values) { return { values: { ...values }, initial: { ...values } }; }

const show = (v) => (v == null ? '' : String(v));

export function drawMenu(sys, def, st, opts = {}) {
  const s = sys.screen;
  s.clearRows(ROW.SCALE, ROW.PROMPT);
  const c = def.cols;
  s.put(def.at[0], def.at[1], def.title);
  for (const [r, col, t] of def.head ?? []) s.put(r, col, t);
  for (const [r, col, t] of def.text ?? []) s.put(r, col, t);
  for (const it of def.items) {
    s.put(it.row, c.id, it.id);
    s.put(it.row, c.item, it.item);
    (it.sub ?? []).forEach((t, k) => s.put(it.row + 1 + k, c.item + 1, t));
    if (opts.highlight === it.id) s.attr(it.row, c.item, it.item.length, ATTR.REVERSE);
    const vr = it.choiceRow ?? it.row;          // an item named on two rows has its choice on the second
    (it.possible ?? []).forEach((t, k) => s.put(vr + k, c.possible, t.replace(/\{(\w+)\}/g, (_, n) => show(opts.vars?.[n]))));
    if (it.key && st) {
      const v = show(st.values[it.key]);
      s.put(vr, c.choice, v, st.values[it.key] !== st.initial[it.key] ? ATTR.REVERSE : 0);
    }
  }
  if (def.finished) s.put(22, 1, fmt('finished'));
}

/** Check a typed value for an item; returns { ok, value }. */
export function validate(it, text, opts = {}) {
  const t = text.trim();
  const int = /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
  switch (it.kind) {
    case 'enum': return { ok: it.values.includes(int), value: int };
    case 'int': {
      const max = it.key === 'from' && opts.vars?.pages ? opts.vars.pages : it.max;
      return { ok: int >= it.min && int <= max, value: int };
    }
    case 'typestyle': return { ok: pitchOf(int) !== null && (!opts.samePitch || pitchOf(int) === opts.samePitch), value: int };
    case 'text': return { ok: text.length <= it.max, value: text };
    case 'name': return { ok: /^[A-Za-z0-9]{1,6}$/.test(t), value: t };
    case 'page': return { ok: t === '0' || /^\d{1,4}(\.\d){0,2}$/.test(t), value: t };
    case 'pages': {
      const list = t === '' ? [] : t.split(/\s+/);
      return { ok: list.length <= (it.max ?? 99) && list.every((p) => /^\d{1,4}(\.\d){0,2}$/.test(p)), value: t };
    }
    default: return { ok: false };
  }
}

/** Pitch of a typestyle number (LINE FORMAT, ORG p.179): 10, 12, 11 for proportional, 15; null if no such style. */
export function pitchOf(n) {
  if (n >= 1 && n <= 31) return 10;
  if (n >= 80 && n <= 111) return 12;
  if (n >= 154 && n <= 175) return 11;
  if (n >= 215 && n <= 230) return 15;
  return null;
}

/**
 * Run a menu until the operator leaves it. Returns
 *   { go, item }   an item that leads somewhere was chosen
 *   { done }       ENTER on an empty prompt (the values are in st.values)
 *   { cancel }     the fourth CANCL
 *   { end }        END, when opts.allowEnd
 * opts: highlight (the item ENTER alone picks), status (field A), root (nothing to cancel back to), vars (for
 * POSSIBLE CHOICES text), onKey(ev) for keys the caller handles (REQST, Menu Bypass); it returns true if it took them.
 */
export function* runMenu(sys, def, st = null, opts = {}) {
  const hasChoices = def.items.some((it) => it.key);
  let answer = '';
  let item = null;                 // the item whose YOUR CHOICE is being typed (long form)
  const redraw = () => {
    sys.drawStatus({ A: opts.status ?? '', B: opts.docName });
    drawMenu(sys, def, st, opts);
  };
  redraw();
  for (;;) {
    drawPrompt(sys, fmt(item ? 'choicePrompt' : 'idPrompt'), answer);
    const ev = yield* getKey(sys, (e) => isChar(e) || isEnter(e) || isCancel(e) || e.name === 'BKSP'
      || (e.name === 'END' && opts.allowEnd) || (opts.accepts?.(e) ?? false));
    if (opts.onKey && !isChar(ev) && !isEnter(ev) && !isCancel(ev) && ev.name !== 'BKSP' && ev.name !== 'END') {
      const r = yield* opts.onKey(ev);
      if (r) return r;
      redraw();
      continue;
    }
    if (ev.name === 'END') return { end: true };
    if (ev.name === 'BKSP') { answer = answer.slice(0, -1); continue; }
    if (isChar(ev)) { if (answer.length < 70) answer += ev.ch; continue; }
    if (isCancel(ev)) {
      sys.messages.clear();
      if (answer) answer = '';
      else if (item) item = null;
      else if (st && Object.keys(st.values).some((k) => st.values[k] !== st.initial[k])) {
        Object.assign(st.values, st.initial);
        drawMenu(sys, def, st, opts);
      } else if (!opts.root) return { cancel: true };
      continue;
    }
    // ENTER
    if (item) {
      const v = validate(item, answer, opts);
      if (!v.ok) { sys.messages.show('choiceInvalid'); continue; }
      st.values[item.key] = v.value;
      sys.messages.clear();
      item = null; answer = '';
      drawMenu(sys, def, st, opts);
      continue;
    }
    const typed = answer;
    answer = '';
    if (typed.trim() === '') {
      if (hasChoices || def.finished) { sys.messages.clear(); return { done: true }; }
      const e = opts.onEmpty?.();
      if (e) return e;
      if (opts.highlight) return { go: def.items.find((it) => it.id === opts.highlight).go, item: opts.highlight };
      continue;
    }
    const id = typed[0].toLowerCase(), rest = typed.slice(1);
    const it = def.items.find((x) => x.id === id);
    if (!it || (rest && rest[0] !== ' ')) { sys.messages.show('idInvalid'); continue; }
    if (it.na) { sys.messages.show('notAvailable', { what: it.item.replace(/:$/, '') }); continue; }
    if (it.go) {
      if (rest.trim()) { sys.messages.show('idInvalid'); continue; }
      sys.messages.clear();
      return { go: it.go, item: it.id };
    }
    if (rest) {
      const v = validate(it, rest.slice(1), opts);
      if (!v.ok) { sys.messages.show('choiceInvalid'); continue; }
      st.values[it.key] = v.value;
      sys.messages.clear();
      drawMenu(sys, def, st, opts);
    } else {
      sys.messages.clear();
      item = it;
    }
  }
}
