// The fax's views (docs/fax/architecture.md 6): its graph as data run by the shared navigation code
// (src/interact/wp-views.js), the stations along the desk, the focus items at the machine, every box a view frames
// present in the fallback boxes, and the framing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import faxfo70 from '../src/machine/faxfo70.js';
import { geometryFor } from '../src/machine/index.js';
import { FAX_GRAPH, FAX_STATIONS, FAX_FOCUS, FAX_CAMERAS, faxBoxes } from '../src/machine/fax-views.js';
import { ViewNav, viewSpec, poseOf, unionBox, WP_GRAPH, STATIONS } from '../src/interact/wp-views.js';

const g = geometryFor(faxfo70);
const boxes = faxBoxes(g, faxfo70);
const FOV = 29;

function makeNav(start = 'desk', aspect = 1.6) {
  const glides = [];
  let cam = poseOf(start, boxes, aspect, FOV, FAX_GRAPH);
  const nav = new ViewNav({
    start, graph: FAX_GRAPH, poseOf: (id) => poseOf(id, boxes, aspect, FOV, FAX_GRAPH),
    glide: (pose, id) => { glides.push(id); cam = pose; }, cameraPose: () => cam,
  });
  return { nav, glides };
}

test('the graph: stations and focus items as the plan names them, every box present', () => {
  assert.deepEqual(FAX_GRAPH.order, ['desk', 'numbers', 'fax', 'received', 'documents']);
  assert.deepEqual(Object.keys(FAX_STATIONS).sort(), [...FAX_GRAPH.order].sort());
  assert.deepEqual(FAX_STATIONS.fax.items, ['panel', 'display', 'feeder', 'paper', 'handset', 'rear']);
  for (const [s, st] of Object.entries(FAX_STATIONS)) {
    for (const b of st.boxes) assert.ok(boxes[b], `${s}: box ${b}`);
    for (const f of st.items) {
      assert.ok(FAX_FOCUS[f], f);
      for (const b of FAX_FOCUS[f].boxes) assert.ok(boxes[b], `${f}: box ${b}`);
    }
  }
  for (const v of Object.values(FAX_CAMERAS)) assert.ok(viewSpec(v, FAX_GRAPH), v);
  // The word processor's graph is untouched and still the default.
  assert.equal(viewSpec('fax'), null);
  assert.equal(viewSpec('printer')?.id, 'printer');
  assert.equal(WP_GRAPH.stations, STATIONS);
});

test('the arrows walk the stations along the desk and undo each other; Back goes up to the desk', () => {
  const row = FAX_GRAPH.order.slice(1);
  const x = (s) => { const b = unionBox(FAX_STATIONS[s].boxes.map((n) => boxes[n])); return (b.min[0] + b.max[0]) / 2; };
  for (let i = 1; i < row.length; i++) assert.ok(x(row[i]) > x(row[i - 1]), `${row[i]} right of ${row[i - 1]}`);
  for (const s of row) {
    const { left, right } = FAX_STATIONS[s];
    if (left) assert.equal(FAX_STATIONS[left].right, s);
    if (right) assert.equal(FAX_STATIONS[right].left, s);
  }
  const { nav } = makeNav('desk');
  assert.ok(nav.left());
  assert.equal(nav.station, 'numbers');
  assert.equal(nav.left(), false);
  for (const s of row.slice(1)) { assert.ok(nav.right()); assert.equal(nav.station, s); }
  assert.equal(nav.right(), false);
  nav.back();
  assert.equal(nav.station, 'desk');
  assert.equal(nav.back(), false);
  assert.deepEqual(nav.where().stations.map((s) => s.id), FAX_GRAPH.order);
});

test('focus items: each opens from its station and Back returns to it; from the desk the markers offer the stations', () => {
  for (const [s, st] of Object.entries(FAX_STATIONS)) {
    for (const f of st.items) {
      const { nav, glides } = makeNav(s);
      assert.ok(nav.focus(f));
      assert.equal(nav.id, `${s}/${f}`);
      assert.ok(nav.where().label.includes(FAX_FOCUS[f].label));
      nav.back();
      assert.equal(nav.id, s);
      assert.deepEqual(glides, [`${s}/${f}`, s]);
    }
  }
  const { nav } = makeNav('desk');
  assert.deepEqual(nav.targets().filter((t) => t.kind === 'station').map((t) => t.id), ['numbers', 'fax', 'received', 'documents']);
  assert.equal(viewSpec('numbers/panel', FAX_GRAPH), null, 'a focus item belongs to its station');
  // The paper's note asks for the panel to be lifted while it is shut.
  const ctx = { coverOpen: () => false };
  const n2 = new ViewNav({ start: 'fax', graph: FAX_GRAPH, poseOf: (id) => poseOf(id, boxes, 1.6, FOV, FAX_GRAPH), glide: () => {}, cameraPose: () => poseOf('fax', boxes, 1.6, FOV, FAX_GRAPH), context: ctx });
  assert.match(n2.where().items.find((i) => i.id === 'paper').note, /lift the panel/);
});

test('framing: every view sees its whole box, close views come nearer than the station', () => {
  const dist = (p) => Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);
  for (const aspect of [1.7, 0.6]) {
    const ids = [...FAX_GRAPH.order, ...Object.entries(FAX_STATIONS).flatMap(([s, st]) => st.items.map((f) => `${s}/${f}`))];
    for (const id of ids) {
      const p = poseOf(id, boxes, aspect, FOV, FAX_GRAPH);
      assert.ok(p.position.every(Number.isFinite), id);
      assert.ok(p.position[1] > 0, `${id}: the camera is above the desk`);
    }
    assert.ok(dist(poseOf('fax/display', boxes, aspect, FOV, FAX_GRAPH)) < dist(poseOf('fax', boxes, aspect, FOV, FAX_GRAPH)));
    assert.ok(dist(poseOf('fax', boxes, aspect, FOV, FAX_GRAPH)) < dist(poseOf('desk', boxes, aspect, FOV, FAX_GRAPH)));
  }
});
