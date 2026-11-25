// Convex hulls of thin parts (src/hull.js convexHull). A URDF export's meshes are
// float32 and placed by turned link transforms, so the points on a plate's face sit
// a few 1e-9 m off their plane. The hull treated that rounding as shape, made
// sliver faces with noise for normals, and came out open: a real 6 mm plate's
// "volume" was 250 times its own box, and it weighed 31 kg (a 14 kg robot read 45).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const T = 0.006, W = 0.114, TRUE_VOL = T * W * W;

/* a 6 x 114 x 114 mm plate with four bolt holes, turned and stored as float32 like a GLB */
function plate(seed) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts = [], o = [-0.113, -0.168, 0.146], c = Math.cos(0.7), sn = Math.sin(0.7), f = Math.fround;
  const at = (x, y, z) => { const X = c * x - sn * y, Y = sn * x + c * y; pts.push([f(o[0] + X), f(o[1] + Y), f(o[2] + z)]); };
  for (const x of [0, T]) {
    for (const [y, z] of [[0, 0], [W, 0], [0, W], [W, W]]) at(x, y, z);
    for (let k = 0; k < 4; k++) { const cy = 0.02 + 0.074 * (k & 1), cz = 0.02 + 0.074 * (k >> 1); for (let a = 0; a < 6; a++) at(x, cy + 0.003 * Math.cos(a), cz + 0.003 * Math.sin(a)); }
    for (let k = 0; k < 20; k++) at(x, rnd() * W, rnd() * W);
    for (let k = 0; k < 30; k++) at(x, rnd() * W, [0, W][k & 1]);
  }
  return pts;
}
/* every edge used once each way */
function closed(faces) {
  const e = new Map();
  for (const [a, b, c] of faces) for (const k of [a + ',' + b, b + ',' + c, c + ',' + a]) e.set(k, (e.get(k) || 0) + 1);
  for (const [k, n] of e) { const [x, y] = k.split(','); if (n !== 1 || !e.has(y + ',' + x)) return false; }
  return true;
}

test('hull: a thin float32 plate, turned, gives a closed hull and its own volume (200 of them)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const P = plate(seed), h = E.convexHull(P);
    assert.ok(h && closed(h.faces), 'closed hull, seed ' + seed);
    const v = E.hullVolume(P);
    assert.ok(v > 0.9 * TRUE_VOL && v < 1.05 * TRUE_VOL, `seed ${seed}: ${(v * 1e6).toFixed(1)} cm^3, the plate is ${(TRUE_VOL * 1e6).toFixed(1)}`);
  }
});

test('hull: such a plate given its export volume weighs what the material says, not tens of kilos', () => {
  const pts = plate(42), vol = TRUE_VOL * 0.8;                     // the export's figure, holes taken out
  const m = E.partMass({ name: 'part 1', kind: 'metal', pts, kg: vol }, {});
  assert.equal(m.how, 'cad');
  assert.ok(m.kg > 0.05 && m.kg < 0.3, m.kg + ' kg');
});

test('game elements: BIOBUZZ POLLEN and NECTAR in the robot weigh nothing; a pollen intake is robot', () => {
  for (const n of ['am 5852 Blue Nectar am 5852 Blue Nectar', 'biobuzz pollen', 'Pollen', 'Red Nectar', 'Blue Nectar 2'])
    assert.equal(E.solidKind(n, ''), 'game', n);
  assert.equal(E.solidKind('ball', 'am-5852'), 'game');
  for (const n of ['Pollen Intake Roller', 'nectar ramp', 'Pollen Hopper', 'Part 1'])
    assert.notEqual(E.solidKind(n, ''), 'game', n);
});
