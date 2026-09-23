// Issue #2. A goBILDA 96 mm mecanum wheel in an Onshape STEP is a 53 mm hub
// ("Wheel Core") with ten rollers round it, each its own part. The rollers
// are too slim to pass as wheels, so the bench took the hub for the wheel:
// the floor sat at the hub's bottom (the robot sank 22 mm into it) and the
// wheel radius came out 26.5 mm instead of 48 (every speed ~45% low).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

// points on a cylinder: centre c, unit axis a, radius r, length L
function cyl(c, a, r, L, n = 24) {
  const u = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  const xl = Math.hypot(...x); for (let k = 0; k < 3; k++) x[k] /= xl;
  const y = [a[1] * x[2] - a[2] * x[1], a[2] * x[0] - a[0] * x[2], a[0] * x[1] - a[1] * x[0]];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * i / n, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    for (const s of [-L / 2, L / 2]) out.push([0, 1, 2].map((k) => c[k] + x[k] * cs + y[k] * sn + a[k] * s));
  }
  return out;
}
// one 96 mm mecanum wheel as goBILDA models it: hub + 10 rollers at 45 degrees
function mecanumWheel(c, side) {
  const axle = [0, side, 0], parts = [{ name: 'Wheel Core', kind: 'wheel', pts: cyl(c, axle, 0.0265, 0.030) }];
  for (let i = 0; i < 10; i++) {
    const t = 2 * Math.PI * i / 10, rc = 0.037;
    const at = [c[0] + rc * Math.cos(t), c[1], c[2] + rc * Math.sin(t)];
    // roller axis: tangent to the wheel, tilted 45 degrees toward the axle
    const tan = [-Math.sin(t), 0, Math.cos(t)], ax = [tan[0] * Math.SQRT1_2, side * Math.SQRT1_2, tan[2] * Math.SQRT1_2];
    parts.push({ name: 'Roller Cover', kind: 'wheel', pts: cyl(at, ax, 0.011, 0.030, 12) });
  }
  parts.push({ name: 'Left Slant Plate Fixed', kind: 'metal', pts: cyl([c[0], c[1] + side * 0.02, c[2]], axle, 0.04, 0.003) });
  return parts;
}

function robot() {
  const solids = [];
  for (const [x, y] of [[0.17, 0.19], [0.17, -0.19], [-0.17, 0.19], [-0.17, -0.19]]) solids.push(...mecanumWheel([x, y, 0.048], Math.sign(y)));
  // a chassis plate and a motor inboard of each wheel
  solids.push({ name: 'Pattern Plate', kind: 'metal', pts: cyl([0, 0, 0.09], [0, 0, 1], 0.2, 0.006) });
  for (const [x, y] of [[0.17, 0.12], [0.17, -0.12], [-0.17, 0.12], [-0.17, -0.12]]) solids.push({ name: 'Motor Part', kind: 'motor', pts: cyl([x, y, 0.048], [0, 1, 0], 0.018, 0.08) });
  const pts = solids.flatMap((s) => s.pts);
  const mn = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), mx = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
  return { solids, bbox: { min: mn, max: mx }, mechs: [], placements: [], points: [] };
}

test('the wheel is the hub plus its rollers: 96 mm, not the 53 mm hub', () => {
  const g = E.driveFromCAD(robot(), { front: '+x' });
  assert.equal(g.wheels.length, 4, 'four wheels, not the rollers as extra ones');
  for (const w of g.wheels) assert.ok(Math.abs(w.r - 0.048) < 0.0015, `wheel radius ${(w.r * 1000).toFixed(1)} mm, expected 48`);
  assert.ok(g.why.some((s) => /built from several parts/.test(s)), 'and says so: ' + g.why.join(' | '));
});

test('the robot stands on its rollers: the floor is 48 mm under the axles, not 26.5', () => {
  const cad = robot();
  E.canonicalizeCAD(cad);
  let low = Infinity;
  for (const s of cad.solids) if (/Roller/.test(s.name)) for (const p of s.pts) low = Math.min(low, p[2]);
  assert.ok(Math.abs(low) < 0.0015, `the roller bottoms sit on the floor (z=0), lowest roller point ${(low * 1000).toFixed(1)} mm`);
});

test('a hub and a tread that are both wheel parts count as one wheel', () => {
  const cad = robot();
  // a traction tyre around each hub, a separate part named like a wheel
  for (const [x, y] of [[0.17, 0.19], [0.17, -0.19], [-0.17, 0.19], [-0.17, -0.19]])
    cad.solids.push({ name: 'Traction Wheel Tread', kind: 'wheel', pts: cyl([x, y, 0.048], [0, Math.sign(y), 0], 0.048, 0.038) });
  const g = E.driveFromCAD(cad, { front: '+x' });
  assert.equal(g.wheels.length, 4, g.wheels.map((w) => w.name + ' ' + w.r.toFixed(3)).join(', '));
});
