// Joint specs (src/jointspec.js): joints written down by hand, for a robot
// with no Onshape mates. The linkage maths on its own, then the part picks
// on a corpus robot. tests/into-the-deep.test.mjs runs a whole real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, fixture } from './load.mjs';

const E = loadEngine();
const DEG = Math.PI / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('slider-crank: the slide sits where it was drawn, moves smoothly, and the rod keeps its length', () => {
  // a crank 150 mm long on a +y axis, a 272 mm rod, a slide running along -x
  const L = { crankPivot: [0.144, 0, 0.114], crankAxis: [0, 1, 0], crankPin: [0.1765, 0, 0.259], pin: [-0.0459, 0, 0.1027], slideAxis: [-1, 0, 0] };
  L.rod = dist(L.crankPin, L.pin);
  assert.ok(Math.abs(E.sliderCrank(L, 0)) < 1e-12, 'no turn, no travel');
  let prev = 0;
  for (let d = 5; d <= 95; d += 5) {
    const q = -d * DEG, e = E.sliderCrank(L, q);
    assert.ok(e > prev, `turning the crank further pushes the slide further (${d}°: ${(e * 1000).toFixed(1)} mm)`);
    prev = e;
    const P = [L.pin[0] - e, L.pin[1], L.pin[2]];
    assert.ok(Math.abs(dist(E.linkPin(L, q), P) - L.rod) < 1e-9, 'the rod is still 272 mm');
    // the rod turns about its slide pin to reach the crank
    const a = E.rodAngle(L, q, e, [0, 1, 0]), u = [L.crankPin[0] - L.pin[0], L.crankPin[2] - L.pin[2]];
    const c = Math.cos(a), s = Math.sin(a), w = [u[0] * c + u[1] * s, -u[0] * s + u[1] * c];     // right-handed about +y
    const B = E.linkPin(L, q);
    assert.ok(Math.hypot(P[0] + w[0] - B[0], P[2] + w[1] - B[2]) < 1e-9, 'the turned rod ends on the crank pin');
  }
  assert.ok(prev > 0.2 && prev < 0.26, 'about 226 mm out at 93° (' + (prev * 1000).toFixed(0) + ' mm)');
  // a rod too short to reach the slide from where the crank has turned
  const S = { crankPivot: [0, 0, 0.3], crankAxis: [0, 1, 0], crankPin: [0, 0, 0.2], pin: [-0.2, 0, 0], slideAxis: [-1, 0, 0] };
  S.rod = dist(S.crankPin, S.pin);
  assert.equal(E.sliderCrank(S, Math.PI), null, 'a crank past where the rod reaches holds instead of jumping');
});

test('a follower gets its value from its leader: a ratio, a slider-crank, a rod', () => {
  const link = { crankPivot: [0, 0, 0], crankAxis: [0, 1, 0], crankPin: [0.1, 0, 0], pin: [-0.2, 0, 0], slideAxis: [-1, 0, 0], rod: 0.3 };
  const mechs = [
    { id: 'lead', kind: 'linear' },
    { id: 'stage', kind: 'linear', couple: { to: 'lead', ratio: 0.5 } },
    { id: 'crank', kind: 'revolute-lift', axis: [0, 1, 0] },
    { id: 'slide', kind: 'linear', axis: [-1, 0, 0], couple: { to: 'crank', via: 'slider-crank', link } },
    { id: 'rod', kind: 'revolute-lift', axis: [0, 1, 0], couple: { to: 'crank', via: 'rod', link: Object.assign({ slider: 'slide' }, link) } },
    { id: 'loopA', kind: 'linear', couple: { to: 'loopB', ratio: 1 } }, { id: 'loopB', kind: 'linear', couple: { to: 'loopA', ratio: 1 } },
  ];
  const v = E.jointValues(mechs, (m) => ({ lead: 0.4, crank: -30 * DEG })[m.id] ?? null);
  assert.equal(v.get('stage'), 0.2);
  assert.ok(v.get('slide') > 0, 'the crank turning pushes the slide out');
  assert.ok(Number.isFinite(v.get('rod')));
  assert.equal(v.get('loopA'), null, 'a loop of followers is held, not recursed forever');
});

test('part picks: path, name, box; a later joint takes parts from an earlier one', () => {
  const cad = E.parseSTEP(fixture('robots/nested.step'));
  const n = cad.solids.length;
  const spec = {
    format: 'ftc-sim-bench.joints', robot: 'test',
    joints: [
      { id: 'all', kind: 'slider', axis: [0, 0, 1], parts: [{ z: [-1e6, 1e6] }], device: 'lift' },
      { id: 'high', kind: 'revolute', axis: [0, 1, 0], parent: 'all', parts: [{ z: [150, 1e6] }], device: ['armMotor', 'Arm'] },
      { id: 'stage', kind: 'slider', axis: [0, 0, 1], follows: { joint: 'all', ratio: 0.5 }, parts: [{ in: 'no such part' }] },
      { id: 'orphan', kind: 'revolute', parent: 'nobody', parts: [] },
    ],
  };
  const R = E.applyJointSpec(cad, spec);
  const on = (id) => cad.solids.filter((s) => s.mech === id).length;
  assert.equal(on('all') + on('high'), n, 'every part is picked by one joint');
  assert.ok(on('high') > 0 && on('all') > 0, 'the later pick took the high parts');
  assert.ok(cad.solids.filter((s) => s.mech === 'high').every((s) => s.pts.reduce((a, p) => a + p[2], 0) / s.pts.length >= 0.15));
  assert.equal(cad.mates.source, 'spec');
  assert.deepEqual(R.devices, { lift: 'all', armMotor: 'high', Arm: 'high' });
  const byId = Object.fromEntries(cad.mechs.map((m) => [m.id, m]));
  assert.equal(byId.high.parent, 'all');
  assert.equal(byId.orphan.parent, 'chassis');
  assert.deepEqual(byId.stage.couple, { to: 'all', ratio: 0.5, via: 'ratio' });
  assert.ok(R.report.why.some((w) => /matched nothing/.test(w)), 'a pick that finds nothing is reported');
  assert.ok(R.report.why.some((w) => /nobody/.test(w)), 'so is a parent that is not a joint');
  assert.throws(() => E.applyJointSpec(cad, { format: 'x' }), /not a joint spec/);
  assert.throws(() => E.applyJointSpec(cad, { format: 'ftc-sim-bench.joints', joints: [{ id: 'a' }, { id: 'a' }] }), /two joints/);
});

test('the joint editor: any robot\'s joints become an editable spec, and hand fixes win', () => {
  const cad = E.parseSTEP(fixture('robots/nested.step'));
  // a robot with guessed joints: written down with its exact parts
  const n = cad.solids.length, mechs = cad.mechs.filter((m) => !m.drive && m.kind !== 'fixed');
  assert.ok(mechs.length >= 2, 'nested has guessed joints to write down');
  const group = cad.solids.map((s, i) => (mechs.length && i % 3 === 0 ? mechs[0].id : 'chassis'));
  const spec = E.specFromCad(cad, group, mechs.length ? { lift: mechs[0].id } : {});
  assert.equal(spec.format, 'ftc-sim-bench.joints');
  assert.equal(spec.solids, n);
  assert.equal(spec.joints.length, mechs.length);
  const fresh = E.parseSTEP(fixture('robots/nested.step'));
  E.applyJointSpec(fresh, spec);
  if (mechs.length) assert.deepEqual(fresh.solids.map((s) => s.mech || 'chassis'), group, 'round trip: every part where it was');
  // hand fixes: these parts ride that joint, or the frame, whatever the picks said
  const s2 = { format: 'ftc-sim-bench.joints', solids: n, joints: [{ id: 'arm', kind: 'revolute', axis: [0, 1, 0], pivot: [0, 0, 100], parts: [{ z: [-1e6, 1e6] }] }],
    assign: [{ joint: 'chassis', parts: [{ solid: [0, 1] }] }, { joint: 'nope', parts: [{ solid: [2] }] }] };
  const c2 = E.parseSTEP(fixture('robots/nested.step')), R = E.applyJointSpec(c2, s2);
  assert.equal(c2.solids[0].mech, undefined); assert.equal(c2.solids[1].mech, undefined);
  assert.equal(c2.solids[3].mech, 'arm');
  assert.ok(R.report.why.some((w) => /nope/.test(w)), 'a fix naming no joint is reported');
  const R3 = E.applyJointSpec(E.parseSTEP(fixture('robots/nested.step')), Object.assign({}, s2, { solids: n + 5 }));
  assert.ok(R3.report.why.some((w) => /written for a STEP with/.test(w)), 'a spec from another version of the file says so');
});

test('the joint editor suggests an axis from what is selected: a spline turns about its length, a gear about its thin side, a rail slides', () => {
  const cyl = (c, axis, len, r, n = 60) => { const pts = []; const [u, v] = axis[0] ? [[0, 1, 0], [0, 0, 1]] : axis[1] ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
    for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI, h = ((i % 5) / 4 - 0.5) * len;
      pts.push([0, 1, 2].map((k) => c[k] + axis[k] * h + r * (Math.cos(t) * u[k] + Math.sin(t) * v[k]))); } return pts; };
  const cad = { solids: [
    { name: 'Servo Spline', pts: cyl([0.1, 0.2, 0.3], [0, 1, 0], 0.012, 0.003) },
    { name: '2302 Series Hub Mount Gear', pts: cyl([0, 0, 0.1], [0, 0, 1], 0.004, 0.024) },
    { name: 'Viper-Slide rail', pts: cyl([0, 0, 0.2], [1, 0, 0], 0.4, 0.01) },
    { name: 'Part 7', pts: cyl([0, 0, 0], [0, 0, 1], 0.002, 0.03) },
  ] };
  const a = E.suggestJoint(cad, [0]), b = E.suggestJoint(cad, [1]), c = E.suggestJoint(cad, [2]), d = E.suggestJoint(cad, [3]);
  assert.deepEqual([a.kind, a.axis], ['revolute', [0, 1, 0]]);
  assert.ok(Math.hypot(a.pivot[0] - 0.1, a.pivot[1] - 0.2, a.pivot[2] - 0.3) < 1e-3, 'through the spline');
  assert.deepEqual([b.kind, b.axis], ['revolute', [0, 0, 1]]);
  assert.deepEqual([c.kind, c.axis], ['slider', [1, 0, 0]]);
  assert.deepEqual([d.kind, d.axis], ['revolute', [0, 0, 1]], 'an unnamed disc: its thin side, from its shape');
  assert.equal(E.suggestJoint(cad, []), null);
});
