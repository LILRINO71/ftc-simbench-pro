// The robot setup's engine side: a drive base set by hand (cad.driveSpec) works
// for any CAD, even one with no wheels in it, and the drive base's centre can be
// moved (shift) when the CAD can't say where it is. What a team sets once in
// the setup is what every later load of that robot uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const box = (c, h) => { const p = []; for (let i = 0; i < 8; i++) p.push([c[0] + (i & 1 ? h[0] : -h[0]), c[1] + (i & 2 ? h[1] : -h[1]), c[2] + (i & 4 ? h[2] : -h[2])]); return p; };
/* A robot with no wheels at all: a chassis and a tower, the way a subsystem-heavy CAD can come. */
const noWheels = () => ({ solids: [{ name: 'Chassis', kind: 'metal', pts: box([0.05, 0, 0.06], [0.2, 0.18, 0.02]) }, { name: 'Tower', kind: 'metal', pts: box([0, 0, 0.3], [0.03, 0.03, 0.25]) }], parts: [], mechs: [] });

test('setup: a mecanum base set by numbers drives as mecanum, X pattern, where the numbers say', () => {
  const cad = noWheels();
  assert.equal(E.driveFromCAD(cad, { front: '+x' }).kind, 'unknown', 'nothing to find on its own');
  cad.driveSpec = { kind: 'mecanum', d: 0.104, track: 0.39, base: 0.336, pattern: 'X' };
  const d = E.driveFromCAD(cad, { front: '+x' });
  assert.equal(d.kind, 'mecanum'); assert.equal(d.confidence, 1); assert.equal(d.wheels.length, 4);
  const byC = Object.fromEntries(d.wheels.map((w) => [w.corner, w]));
  assert.ok(Math.abs(byC.FL.y - byC.FR.y - 0.39) < 1e-9 && Math.abs(byC.FL.x - byC.BL.x - 0.336) < 1e-9);
  assert.ok(Math.abs(byC.FL.r - 0.052) < 1e-9);
  assert.deepEqual(['FL', 'FR', 'BL', 'BR'].map((c) => byC[c].roller), [1, -1, -1, 1]);
  // the same robot facing +y in the CAD: the wheels turn with the front
  const dy = E.driveFromCAD(cad, { front: '+y' });
  assert.ok(dy.wheels.every((w) => Math.abs(Math.abs(w.axis[0]) - 1) < 1e-9), 'axles along x when the front is +y');
});

test('setup: tank with 2, 4 or 6 wheels, and an X-drive at 45 degrees', () => {
  const cad = noWheels();
  for (const n of [2, 4, 6]) { cad.driveSpec = { kind: 'tank', n, d: 0.096, track: 0.36, base: 0.3 }; const d = E.driveFromCAD(cad, {}); assert.equal(d.kind, 'tank'); assert.equal(d.wheels.length, n); }
  cad.driveSpec = { kind: 'x', d: 0.096, track: 0.36, base: 0.36 };
  const x = E.driveFromCAD(cad, {});
  assert.equal(x.kind, 'x');
  for (const w of x.wheels) assert.ok(Math.abs(Math.abs(Math.cos(w.alpha)) - Math.SQRT1_2) < 1e-6, 'each wheel at 45 degrees');
});

test('setup: an O pattern set by hand is kept, and nonsense numbers are clamped', () => {
  const cad = noWheels();
  cad.driveSpec = { kind: 'mecanum', d: 'big', track: -5, base: 99, pattern: 'O' };
  const d = E.driveFromCAD(cad, {});
  const byC = Object.fromEntries(d.wheels.map((w) => [w.corner, w]));
  assert.deepEqual(['FL', 'FR', 'BL', 'BR'].map((c) => byC[c].roller), [-1, 1, 1, -1]);
  assert.ok(d.track >= 0.1 && d.base <= 0.6 && d.wheels.every((w) => w.r > 0.02 && w.r <= 0.1));
});

test('setup: the drive centre moves where the team says (shift), and up stays as found', () => {
  const cad = noWheels(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of cad.solids) for (const p of s.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const F0 = E.robotFrame({ solids: cad.solids, bbox: { min: lo, max: hi } }, {});
  const F1 = E.robotFrame({ solids: cad.solids, bbox: { min: lo, max: hi } }, { shift: [0.05, -0.02] });
  assert.ok(Math.abs(F1.origin[0] - F0.origin[0] - 0.05) < 1e-9 && Math.abs(F1.origin[1] - F0.origin[1] + 0.02) < 1e-9);
  assert.deepEqual(F1.shift, [0.05, -0.02]);
  assert.equal(F1.up, F0.up);
  // and through canonicalizeCAD, the way a saved setup is applied to a loaded robot
  const c = noWheels(); E.canonicalizeCAD(c, { shift: [0.05, 0] });
  assert.deepEqual(c.frame.shift, [0.05, 0]);
});
