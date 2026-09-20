// Mass properties off the CAD: hull volume, per-part mass, the assembled
// inertia tensor. Every number below is hand-computed with a stated tolerance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

/* Corners of an axis-aligned box of side s (or [sx,sy,sz]) centred on c. */
function boxPts(s, c = [0, 0, 0]) {
  const d = Array.isArray(s) ? s : [s, s, s], out = [];
  for (let i = 0; i < 8; i++) out.push([c[0] + (i & 1 ? .5 : -.5) * d[0], c[1] + (i & 2 ? .5 : -.5) * d[1], c[2] + (i & 4 ? .5 : -.5) * d[2]]);
  return out;
}
const scalePts = (pts, k) => pts.map((p) => [p[0] * k, p[1] * k, p[2] * k]);
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

test('hullVolume: a unit cube is exactly 1 m^3', () => {
  const v = E.hullVolume(boxPts(1, [0.5, 0.5, 0.5]));
  assert.ok(Math.abs(v - 1) <= 1e-12, `unit cube hull volume ${v}`);
  // off the origin too — the divergence sum must not depend on where it sits
  const v2 = E.hullVolume(boxPts(1, [-7, 3, 11]));
  assert.ok(Math.abs(v2 - 1) <= 1e-12, `translated unit cube ${v2}`);
});

test('hullVolume: a 64-sided prism is within 2% of pi r^2 h', () => {
  const r = 0.05, h = 0.2, n = 64, pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    for (const z of [-h / 2, h / 2]) pts.push([Math.cos(t) * r, Math.sin(t) * r, z]);
  }
  const want = Math.PI * r * r * h;               // 1.5708e-3 m^3
  const got = E.hullVolume(pts);
  assert.ok(rel(got, want) < 0.02, `prism ${got} vs cylinder ${want}`);
  // an inscribed polygon can only under-read, never over-read
  assert.ok(got < want, `hull of an inscribed prism must be under the cylinder (${got})`);
});

test('partMass: metres in, kilograms out — a 100 mm aluminium cube', () => {
  // 0.1^3 m^3 = 1e-3 m^3 x 2700 kg/m^3 x 0.18 fill = 0.486 kg.
  // A millimetre/metre mix-up anywhere lands a billion times off.
  const m = E.partMass({ name: 'frame block', kind: 'metal', pts: boxPts(0.1) });
  assert.equal(m.how, 'density');
  assert.ok(Math.abs(m.volume - 1e-3) < 1e-12, `volume ${m.volume}`);
  assert.ok(Math.abs(m.kg - 0.486) < 1e-9, `kg ${m.kg}`);
  assert.ok(m.kg > 0.05 && m.kg < 5, 'a 100 mm cube of FTC structure is kilograms, not grams or tonnes');
});

test('partMass: a known part number uses its published mass, and can be switched off', () => {
  const motor = { name: '5203-2402-0019 Yellow Jacket', part: '5203-2402-0019', kind: 'motor', pts: boxPts([0.043, 0.043, 0.11]) };
  const v = E.partMass(motor);
  assert.equal(v.how, 'vendor');
  assert.equal(v.kg, 0.310);
  assert.ok(/published/.test(v.why));

  const d = E.partMass(motor, { vendor: false });
  assert.equal(d.how, 'density');
  // 0.043*0.043*0.11 = 2.034e-4 m^3 x 3200 x 0.85 = 0.5532 kg
  assert.ok(Math.abs(d.kg - 0.55323) < 1e-4, `density motor ${d.kg}`);
  // the density fallback must at least be the right order of magnitude
  assert.ok(d.kg > 0.5 * v.kg && d.kg < 2.5 * v.kg, `density ${d.kg} vs vendor ${v.kg}`);
});

test('massProps: the COM of a symmetric pair is the midpoint', () => {
  const a = { name: 'left rail', kind: 'metal', pts: boxPts([0.04, 0.3, 0.05], [-0.2, 0.1, 0.06]) };
  const b = { name: 'right rail', kind: 'metal', pts: boxPts([0.04, 0.3, 0.05], [0.6, 0.1, 0.06]) };
  const r = E.massProps({ solids: [a, b] });
  assert.ok(Math.abs(r.com.x - 0.2) < 1e-12, `com.x ${r.com.x}`);
  assert.ok(Math.abs(r.com.y - 0.1) < 1e-12, `com.y ${r.com.y}`);
  assert.ok(Math.abs(r.com.z - 0.06) < 1e-12, `com.z ${r.com.z}`);
  assert.ok(Math.abs(r.comHeight - r.com.z) < 1e-15);
  // and a lopsided pair is pulled toward the heavy end, not the light one
  const heavy = { name: 'right rail', kind: 'metal', pts: boxPts([0.12, 0.3, 0.05], [0.6, 0.1, 0.06]) };
  const r2 = E.massProps({ solids: [a, heavy] });
  assert.ok(r2.com.x > 0.2 && r2.com.x < 0.6, `lopsided com.x ${r2.com.x}`);
});

test('inertiaOf: parallel axis theorem against a hand calculation', () => {
  // Two 2 kg 100 mm cubes at x = +/-0.3, nothing else.
  //   own Izz  = m/12 (L^2+W^2) = 2/12 (0.01+0.01) = 0.00333333 each
  //   carried  = m d^2          = 2 * 0.09        = 0.18       each
  //   Izz total= 2 * 0.1833333  = 0.36666667
  //   Ixx total= 2 * 0.00333333 = 0.00666667      (d is along x, so no carry)
  const cube = { kg: 2, box: { L: 0.1, W: 0.1, H: 0.1 } };
  const r = E.inertiaOf([
    Object.assign({ com: { x: -0.3, y: 0, z: 0 } }, cube),
    Object.assign({ com: { x: 0.3, y: 0, z: 0 } }, cube)
  ]);
  assert.ok(Math.abs(r.kg - 4) < 1e-12);
  assert.ok(Math.abs(r.com.x) < 1e-12 && Math.abs(r.com.z) < 1e-12);
  assert.ok(Math.abs(r.I.zz - 0.36666666666666664) < 1e-12, `Izz ${r.I.zz}`);
  assert.ok(Math.abs(r.I.yy - 0.36666666666666664) < 1e-12, `Iyy ${r.I.yy}`);
  assert.ok(Math.abs(r.I.xx - 0.006666666666666667) < 1e-12, `Ixx ${r.I.xx}`);
  // I_cm - m d^2 (the sign flipped) would be 0.0033 - 0.18 < 0: inertia is never negative
  assert.ok(r.I.zz > r.I.xx * 50, 'the carried term must dominate the local one');
});

test('inertiaOf: products of inertia keep their sign', () => {
  // Point masses on the +x+y diagonal give sum(m dx dy) > 0; mirror one axis
  // and it must flip. A sign error here tilts every principal axis the wrong way.
  const pair = (sy) => E.inertiaOf([
    { kg: 1, com: { x: 0.2, y: sy * 0.3, z: 0 } },
    { kg: 1, com: { x: -0.2, y: -sy * 0.3, z: 0 } }
  ]);
  const up = pair(1), down = pair(-1);
  assert.ok(Math.abs(up.I.xy - 0.12) < 1e-12, `+diagonal Ixy ${up.I.xy}`);
  assert.ok(Math.abs(down.I.xy + 0.12) < 1e-12, `-diagonal Ixy ${down.I.xy}`);
  assert.ok(Math.abs(up.I.xz) < 1e-15 && Math.abs(up.I.yz) < 1e-15, 'a planar pair has no xz/yz product');
});

test('massProps: scaling every point by 2 gives 8x the mass and 32x Izz', () => {
  const rig = [
    { name: 'deck', kind: 'metal', pts: boxPts([0.30, 0.20, 0.02], [0, 0, 0.05]) },
    { name: 'tower', kind: 'metal', pts: boxPts([0.06, 0.06, 0.25], [0.11, 0.07, 0.20]) },
    { name: 'claw', kind: 'printed', pts: boxPts([0.05, 0.04, 0.03], [-0.09, 0.06, 0.31]) }
  ];
  const big = rig.map((s) => ({ name: s.name, kind: s.kind, pts: scalePts(s.pts, 2) }));
  const a = E.massProps({ solids: rig }), b = E.massProps({ solids: big });
  assert.ok(rel(b.kg, a.kg * 8) < 1e-12, `mass ${b.kg} vs ${a.kg * 8}`);          // volume goes as L^3
  assert.ok(rel(b.Izz, a.Izz * 32) < 1e-12, `Izz ${b.Izz} vs ${a.Izz * 32}`);     // m L^2 goes as L^5
  assert.ok(rel(b.I.xx, a.I.xx * 32) < 1e-12);
  assert.ok(rel(b.com.z, a.com.z * 2) < 1e-12, 'the COM scales linearly');
  assert.ok(a.kg > 0.1, 'guard: the scaling check is meaningless on a zero rig');
});

test('massProps: the sample robot weighs what an FTC arm rig weighs', () => {
  // Four 1120 channels, a column, three 2000-series servos, an arm and a
  // printed claw. Bought as parts that is roughly 0.9-1.1 kg; the hull-based
  // estimate should sit just above it, nowhere near 0.1 kg or 10 kg.
  const solids = E.sampleSolids();
  const r = E.massProps({ solids });
  assert.ok(r.kg > 0.9 && r.kg < 2.0, `sample rig ${r.kg.toFixed(3)} kg is outside the believable range`);
  assert.equal(r.parts.length, solids.length);
  assert.ok(r.parts.filter((p) => p.how === 'vendor').length === 3, 'the three servos are known parts');
  assert.ok(r.confidence > 0.4 && r.confidence <= 0.9);

  // The COM has to land inside the robot, and Izz near m*(0.12 m)^2 for a
  // ~0.25 m square frame. Nothing here may be NaN.
  assert.ok(r.com.x > 0.0 && r.com.x < 0.27 && r.com.y > 0.1 && r.com.y < 0.38, `com ${JSON.stringify(r.com)}`);
  assert.ok(r.comHeight > -0.1 && r.comHeight < 0.2, `com height ${r.comHeight}`);
  const k = Math.sqrt(r.Izz / r.kg);
  assert.ok(k > 0.05 && k < 0.25, `radius of gyration ${k} m is not a 0.25 m frame`);

  // A deliberately wrong density must break the assertion above, in both
  // directions — otherwise the range is just wide enough to pass anything.
  const bend = (f) => {
    const m = {};
    for (const k2 in E.MATERIALS) m[k2] = Object.assign({}, E.MATERIALS[k2], { density: E.MATERIALS[k2].density * f });
    return E.massProps({ solids }, { materials: m, vendor: false }).kg;
  };
  assert.ok(bend(10) > 2.0, `10x density still passed at ${bend(10).toFixed(3)} kg`);
  assert.ok(bend(0.1) < 0.9, `0.1x density still passed at ${bend(0.1).toFixed(3)} kg`);
});

test('massProps: a payload rides on top and raises the COM', () => {
  const solids = E.sampleSolids();
  const dry = E.massProps({ solids });
  const wet = E.massProps({ solids }, { payloadKg: 0.5 });
  assert.ok(Math.abs(wet.kg - (dry.kg + 0.5)) < 1e-12, `payload mass ${wet.kg}`);
  assert.ok(wet.comHeight > dry.comHeight, 'a payload carried high must raise the COM, not lower it');
  assert.ok(wet.comHeight < 0.22, 'and it cannot go above the top of the robot');
  assert.ok(wet.parts.some((p) => p.name === 'payload' && p.how === 'given'));

  // extra point masses land exactly where they are put
  const ball = E.massProps([], { extra: [{ name: 'battery', kg: 2, x: 0.1, y: 0.2, z: 0.3 }] });
  assert.ok(Math.abs(ball.kg - 2) < 1e-12);
  assert.ok(Math.abs(ball.com.x - 0.1) < 1e-12 && Math.abs(ball.com.z - 0.3) < 1e-12);
  assert.ok(ball.Izz < 1e-15, 'a single point mass has no inertia about its own COM');
});

test('degenerate input stays finite', () => {
  const fin = (v, what) => assert.ok(Number.isFinite(v), `${what} is not finite: ${v}`);

  assert.equal(E.hullVolume([]), 0);
  assert.equal(E.hullVolume(null), 0);
  fin(E.hullVolume([[0, 0, 0]]), 'one point');
  fin(E.hullVolume([[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]), 'four identical points');
  fin(E.hullVolume([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]), 'a flat square');
  // a flat sheet gets the 1.5 mm floor, not zero and not something silly
  const sheet = E.hullVolume([[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0], [0.1, 0.1, 0]]);
  assert.ok(Math.abs(sheet - 0.1 * 0.1 * 0.0015) < 1e-9, `sheet volume ${sheet}`);

  for (const bad of [{}, { pts: [] }, { kind: 'nope', pts: [[0, 0, 0]] }, { kind: 'metal', pts: [[NaN, 0, 0]] }]) {
    const m = E.partMass(bad);
    fin(m.kg, 'partMass kg'); fin(m.volume, 'partMass volume');
    assert.ok(m.kg >= 0);
  }

  for (const r of [E.massProps(null), E.massProps({ solids: [] }), E.massProps([{ kind: 'metal', pts: [] }])]) {
    fin(r.kg, 'kg'); fin(r.Izz, 'Izz'); fin(r.comHeight, 'comHeight');
    for (const k of ['x', 'y', 'z']) fin(r.com[k], 'com.' + k);
    for (const k in r.I) fin(r.I[k], 'I.' + k);
  }
  assert.equal(E.massProps({ solids: [] }).confidence, 0);

  const z = E.inertiaOf([]);
  fin(z.kg, 'empty kg'); fin(z.com.x, 'empty com');
  assert.equal(z.kg, 0);
  const massless = E.inertiaOf([{ kg: 0, com: { x: 1, y: 2, z: 3 } }, { kg: NaN, com: { x: 3, y: 4, z: 5 } }]);
  assert.equal(massless.kg, 0);
  assert.ok(Math.abs(massless.com.x - 2) < 1e-12, 'zero mass falls back to the plain centroid');
  for (const k in massless.I) assert.equal(massless.I[k], 0);
});
