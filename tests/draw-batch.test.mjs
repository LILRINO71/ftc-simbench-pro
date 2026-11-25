// Fewer draw calls (src/tessellate.js tessFold, tessBatch) and less repeated
// work on import (src/inertia.js hullVolume, src/autorig.js actuatorsOf). An
// Onshape export of a 1,938-part robot drew as 2,552 meshes, one per part in
// one of 359 joint groups, and weighed and searched every part again on each
// rebuild: 2,600 draw calls a frame and a 20-second import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineBundle, loadEngine, fixture } from './load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = new Function('"use strict";\n' + engineBundle().replace(/^"use strict";\n/, '') + '\n' +
  fs.readFileSync(path.join(ROOT, 'src', 'tessellate.js'), 'utf8') +
  '\nreturn { tessBatch, tessFold };')();
const E = loadEngine();

// column-major 4x4, as three.js Matrix4.elements
const move = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const mirrorX = (x) => [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
const cross = (p, t) => { const a = [0, 1, 2].map((k) => p[9 * t + 3 + k] - p[9 * t + k]), b = [0, 1, 2].map((k) => p[9 * t + 6 + k] - p[9 * t + k]);
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; };

test('merged parts: each copy where its matrix puts it, faces out, mapped back to its part', () => {
  // one triangle facing +z (unindexed), and the same as an indexed shape
  const pos = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), nor = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const R = T.tessBatch([
    { pos, nor, m: move(0, 0, 0), j: 4, start: 0, end: 1 },
    { pos, nor, m: move(2, 0, 0), j: 4, start: 0, end: 1 },          // the same part's next run: one range
    { pos: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), nor, idx: Uint32Array.from([0, 1, 2]), m: mirrorX(5), j: 9, start: 0, end: 1 },
  ]);
  assert.equal(R.pos.length, 27);
  assert.deepEqual(R.ranges, [{ start: 0, j: 4 }, { start: 2, j: 9 }]);
  assert.deepEqual(Array.from(R.pos.slice(9, 12)), [2, 0, 0], 'the second copy moved 2 along x');
  // the mirrored copy sits at x = 5 - x and still winds so its front faces +z, as its normal says
  assert.deepEqual(Array.from(R.pos.slice(18, 21)), [5, 0, 0]);
  assert.ok(cross(R.pos, 2)[2] > 0, 'mirrored copy faces the way its normal points');
  assert.deepEqual(Array.from(R.nor.slice(18, 21)), [0, 0, 1]);
});

test('held joints draw with the group above them; anything that can move keeps its own group', () => {
  const mechs = [
    { id: 'arm', parent: 'chassis', kind: 'revolute-lift' },
    { id: 'shaft', parent: 'arm', kind: 'revolute-lift', internal: true },
    { id: 'label', parent: 'shaft', kind: 'revolute-yaw', internal: true },
    { id: 'mount', parent: 'chassis', kind: 'fixed' },
    { id: 'gearA', parent: 'chassis', kind: 'revolute-yaw', internal: true },
    { id: 'gearB', parent: 'chassis', kind: 'revolute-yaw', couple: { to: 'gearA', ratio: -1 } },
    { id: 'offset', parent: 'chassis', kind: 'revolute-yaw', internal: true, q0: 0.3 },
    { id: 'pin', parent: 'chassis', kind: 'revolute-yaw', internal: true, passive: true },
  ];
  const f = T.tessFold(mechs, new Set());
  assert.equal(f('arm'), 'arm');
  assert.equal(f('shaft'), 'arm');
  assert.equal(f('label'), 'arm', 'held all the way up to the arm');
  assert.equal(f('mount'), 'chassis');
  assert.equal(f('gearA'), 'gearA', 'another joint follows it');
  assert.equal(f('gearB'), 'gearB');
  assert.equal(f('offset'), 'offset', 'held at an angle of its own');
  assert.equal(f('pin'), 'pin', 'swings free');
  assert.equal(f('chassis'), 'chassis');
  const g = T.tessFold(mechs, new Set(['shaft']));
  assert.equal(g('label'), 'shaft', 'a held joint seen moving gets its own group back');
});

test('a part is weighed once: the hull volume is kept with its points', () => {
  const pts = [[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1], [0.1, 0.1, 0.1]];
  const v = E.hullVolume(pts);
  assert.ok(v > 0);
  assert.equal(E.hullVolume(pts), v);
  pts.push([0.3, 0.3, 0.3]);                               // more points: weighed again
  assert.ok(E.hullVolume(pts) > v);
  // timing: a robot's worth of parts weighed again costs a fraction of the first time
  const parts = Array.from({ length: 400 }, (_, i) => Array.from({ length: 120 }, (_, k) => [Math.sin(i + k * 1.7) * 0.05, Math.cos(k * 2.3 + i) * 0.04, ((k * 37) % 11) * 0.004]));
  let t0 = performance.now(); for (const p of parts) E.hullVolume(p); const first = performance.now() - t0;
  t0 = performance.now(); for (const p of parts) E.hullVolume(p); const again = performance.now() - t0;
  assert.ok(again < first / 3, `again ${again.toFixed(1)} ms vs first ${first.toFixed(1)} ms`);
});

test('the actuators are searched for once per robot, by the binder and the robot check alike', () => {
  const cad = E.parseSTEP(fixture('robots/mecanum-zup.step'));
  const a = E.actuatorsOf(cad);
  assert.equal(a.length, 5, 'four drive motors and a servo');
  assert.equal(E.actuatorsOf(cad), a, 'the same list, not a second search');
  assert.deepEqual(E.actuatorsOf(null), []);
});
