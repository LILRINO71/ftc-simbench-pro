// Four-bar linkages (src/jointspec.js, found by src/autorig.js): the pin the
// coupler and the rocker share stays on both links whatever the crank does,
// a parallel four-bar keeps its payload level, and a session keeps the link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { buildMech } from '../tools/mechgen.mjs';

const E = loadEngine();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('four-bar: the coupler-rocker pin keeps both link lengths, and sits where drawn at q = 0', () => {
  // not parallel: crank 50 mm, coupler 158 mm, rocker 112 mm, frame pins 224 mm apart
  const L = { crankPivot: [0, 0, 0], crankAxis: [0, 1, 0], crankPin: [0.05, 0, 0], pin: [0.10, 0, 0.15], ground: [0.2, 0, 0.1] };
  L.rod = dist(L.crankPin, L.pin); L.rocker = dist(L.ground, L.pin);
  const C0 = E.fourBarPin(L, 0);
  assert.ok(dist(C0, L.pin) < 1e-9, 'as drawn at q = 0');
  let last = C0;
  for (let q = -1; q <= 1; q += 0.05) {
    const C = E.fourBarPin(L, q), B = E.linkPin(L, q);
    assert.ok(C, 'closes at ' + q.toFixed(2));
    assert.ok(Math.abs(dist(C, B) - L.rod) < 1e-9 && Math.abs(dist(C, L.ground) - L.rocker) < 1e-9);
    if (Math.abs(q) < 0.051) assert.ok(dist(C, last) < 0.02, 'stays on the branch it was drawn on');
    last = C;
  }
  assert.equal(E.fourBarPin({ ...L, rocker: 0.001 }, 0), null, "a linkage that can't close gives null");
});

test('four-bar: found on the zoo arm, the rocker turns with the crank and the coupler stays level', () => {
  const { text } = buildMech('four-bar');
  const R = E.autoRig(E.parseSTEP(text), {});
  const cad = E.parseSTEP(text); E.applyJointSpec(cad, R.spec);
  const m = (id) => cad.mechs.find((x) => x.id === id);
  assert.equal(m('motor 1 coupler').parent, 'motor 1');
  for (const q of [-0.6, 0.25, 0.9]) {
    const get = (id) => (id === 'motor 1' ? q : null);
    assert.ok(Math.abs(E.followQ(m('motor 1 rocker'), get) - q) < 1e-9);
    assert.ok(Math.abs(E.followQ(m('motor 1 coupler'), get) + q) < 1e-9);
  }
  // the spec round-trips through the editor's format
  const back = E.specFromCad(cad, cad.solids.map((s) => s.mech || 'chassis'), {});
  const f = back.joints.find((j) => j.id === 'motor 1 rocker').follows;
  assert.equal(f.linkage, 'four-bar'); assert.equal(f.role, 'rocker'); assert.equal(f.ground.length, 3);
});

test('four-bar: pins set apart along the axis (a coupler beside the crank) don\'t make the linkage jump at rest', () => {
  // the coupler rides 30 mm to the side of the crank and the rocker 20 mm the other way:
  // the link lengths that matter are the ones square to the axis
  const follows = (role) => ({ joint: 'crank', linkage: 'four-bar', crankPin: [50, 0, 0], pin: [100, 30, 150], ground: [200, -20, 100], role });
  const spec = { format: 'ftc-sim-bench.joints', joints: [
    { id: 'crank', kind: 'revolute', axis: [0, 1, 0], pivot: [0, 0, 0] },
    { id: 'rocker', kind: 'revolute', axis: [0, 1, 0], pivot: [200, -20, 100], follows: follows('rocker') },
    { id: 'coupler', kind: 'revolute', axis: [0, 1, 0], pivot: [50, 0, 0], parent: 'crank', follows: follows('coupler') }] };
  const cad = { solids: [], mechs: [] };
  E.applyJointSpec(cad, spec);
  const m = (id) => cad.mechs.find((x) => x.id === id);
  const L = m('rocker').couple.link;
  assert.ok(dist(E.fourBarPin(L, 0), L.pin) < 1e-9, 'the shared pin sits where it was drawn: ' + E.fourBarPin(L, 0));
  const rest = (id) => E.followQ(m(id), (j) => (j === 'crank' ? 0 : null));
  assert.ok(Math.abs(rest('rocker')) < 1e-9, 'rocker at rest: ' + rest('rocker'));
  assert.ok(Math.abs(rest('coupler')) < 1e-9, 'coupler at rest: ' + rest('coupler'));
  // turning the crank keeps both links' lengths, measured square to the axis
  const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  for (const q of [-0.3, 0.2]) {
    const C = E.fourBarPin(L, q);
    assert.ok(Math.abs(flat(C, E.linkPin(L, q)) - flat(L.pin, L.crankPin)) < 1e-9 && Math.abs(flat(C, L.ground) - flat(L.pin, L.ground)) < 1e-9);
  }
});

test('four-bar: a saved session keeps the linkage', () => {
  const { text } = buildMech('four-bar');
  const cad = E.parseSTEP(text); E.applyJointSpec(cad, E.autoRig(E.parseSTEP(text), {}).spec);
  const r = E.unpackSession(E.packSession(E.sessionFromBench({ cad })));
  assert.ok(r.ok);
  const L = r.session.cad.mechs.find((m) => m.id === 'motor 1 rocker').couple.link;
  assert.equal(L.role, 'rocker'); assert.ok(Math.abs(L.rocker - 0.15) < 0.001 && Math.abs(L.rod - 0.08) < 0.001); assert.equal(L.ground.length, 3);
});
