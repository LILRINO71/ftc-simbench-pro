// Review fixes for 25f54d3 in the physics area: the drop-centre wheel loads,
// how a motor-driven joint or slide is drawn, and the joint-kind aliases.
// Each test failed on 25f54d3 and passes with the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineBundle } from './load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// view3d.js is a DOM-side file, but its top level is pure: THREE is only
// touched inside View's methods, so mechPose loads here like the engine does.
const E = new Function('"use strict";\n' + engineBundle().replace(/^"use strict";\n/, '') + '\n' +
  fs.readFileSync(path.join(ROOT, 'src', 'view3d.js'), 'utf8') +
  '\nreturn { wheelLoads, Dyn, JOINT_KINDS,' +
  ' normJointKind: typeof normJointKind === "undefined" ? undefined : normJointKind,' +
  ' mechPose: typeof mechPose === "undefined" ? undefined : mechPose };')();

const G = 9.80665, KG = 15, W = KG * G;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const props = (cx = 0, cy = 0) => ({ kg: KG, com: { x: cx, y: cy, z: 0 }, comHeight: 0 });
const wheels = (pts) => pts.map(([x, y]) => ({ x, y, z: 0, r: 0.048 }));
/* The loads must add up to the weight and put the resultant under the COM. */
function balanced(loads, ws, cx, cy, what) {
  assert.ok(loads.every((n) => n > 0), what + ': every wheel on the ground ' + loads.map((n) => n.toFixed(2)));
  assert.ok(Math.abs(sum(loads) - W) < 1e-9, what + ': total ' + sum(loads) + ' vs ' + W);
  const px = sum(loads.map((n, i) => n * ws[i].x)) / W, py = sum(loads.map((n, i) => n * ws[i].y)) / W;
  assert.ok(Math.abs(px - cx) < 1e-9, what + ': centre of pressure x ' + (px * 1000).toFixed(3) + ' mm, COM ' + cx * 1000);
  assert.ok(Math.abs(py - cy) < 1e-9, what + ': centre of pressure y ' + (py * 1000).toFixed(3) + ' mm, COM ' + cy * 1000);
}

// ---- 1. drop-centre weighting: tank only, 3+ rows a side, and an exact fit

test('wheelLoads: a tank drop-centre six puts twice the load on its centre wheels', () => {
  const ws = wheels([[0.2, 0.18], [0, 0.18], [-0.2, 0.18], [0.2, -0.18], [0, -0.18], [-0.2, -0.18]]);
  const L = E.wheelLoads(props(), { x: 0, y: 0 }, ws, { kind: 'tank' });
  balanced(L, ws, 0, 0, 'symmetric 6WD');
  [0, 2, 3, 5].forEach((i) => assert.ok(Math.abs(L[i] - W / 8) < 1e-9, 'end wheel ' + i + ' carries 12.5%'));
  [1, 4].forEach((i) => assert.ok(Math.abs(L[i] - W / 4) < 1e-9, 'centre wheel ' + i + ' carries 25%'));
  const off = E.wheelLoads(props(), { x: 0, y: 0 }, ws, { kind: 'tank', dropCentre: false });
  off.forEach((n) => assert.ok(Math.abs(n - W / 6) < 1e-9, 'dropCentre:false shares evenly'));
});

test('wheelLoads: an asymmetric drop-centre six still balances to the COM', () => {
  // centre rows off the midpoint, and the two sides not mirror images
  const ws = wheels([[0.20, 0.18], [0.06, 0.18], [-0.18, 0.18], [0.19, -0.17], [0.02, -0.17], [-0.20, -0.17]]);
  for (const [cx, cy] of [[0, 0], [0.01, 0.005], [-0.03, -0.01]]) {
    const L = E.wheelLoads(props(cx, cy), { x: 0, y: 0 }, ws, { kind: 'tank' });
    balanced(L, ws, cx, cy, `asymmetric 6WD, COM (${cx}, ${cy})`);
    assert.ok(L[1] > L[0] && L[1] > L[2] && L[4] > L[3] && L[4] > L[5], 'the centre wheels still carry the most');
  }
});

test('wheelLoads: four mecanum plus two more wheels share evenly, never drop-centre', () => {
  // 4 mecanum drive wheels plus a pair at x=0 each side (passive, or lift
  // motors detectDrivetrain counted as wheels): nothing about that is a drop centre
  const ws = wheels([[0.2, 0.18], [0.2, -0.18], [-0.2, 0.18], [-0.2, -0.18], [0, 0.18], [0, -0.18]]);
  for (const opts of [{ kind: 'mecanum' }, {}, undefined]) {
    const L = E.wheelLoads(props(), { x: 0, y: 0 }, ws, opts);
    balanced(L, ws, 0, 0, 'mecanum + 2, opts ' + JSON.stringify(opts));
    L.forEach((n, i) => assert.ok(Math.abs(n - W / 6) < 1e-9, `wheel ${i}: ${(n / W * 100).toFixed(1)}% of the weight, want 16.7%`));
  }
  // a hex holonomic has only two rows a side, so even a "tank" label can't make it drop-centre
  const hex = wheels([0, 60, 120, 180, 240, 300].map((a) => [0.2 * Math.cos(a * Math.PI / 180), 0.2 * Math.sin(a * Math.PI / 180)]));
  E.wheelLoads(props(), { x: 0, y: 0 }, hex, { kind: 'tank' }).forEach((n) => assert.ok(Math.abs(n - W / 6) < 1e-9, 'hex: even'));
});

test('Dyn.step: the rig\'s own drive kind decides the drop-centre weighting', () => {
  const spec = { rpm: 312, stallNm: 2.4 };
  const pts = [[0.2, 0.18], [0.2, -0.18], [-0.2, 0.18], [-0.2, -0.18], [0, 0.18], [0, -0.18]];
  const rig = (kind) => ({
    props: { kg: KG, com: { x: 0, y: 0, z: 0 }, comHeight: 0, Izz: 0.45 },
    drive: { kind, wheels: pts.map(([x, y], i) => ({ x, y, z: 0, r: 0.048, roller: kind === 'mecanum' ? (i === 0 || i === 3 ? 1 : -1) : 0 })) },
    motors: pts.map(() => spec), mu: 1.2,
  });
  const mec = E.Dyn.step(E.Dyn.reset(rig('mecanum')), 0, rig('mecanum'), 0.02).loads;
  mec.forEach((n, i) => assert.ok(Math.abs(n - W / 6) < 1e-9, `mecanum wheel ${i}: ${(n / W * 100).toFixed(1)}%`));
  const tank = E.Dyn.step(E.Dyn.reset(rig('tank')), 0, rig('tank'), 0.02).loads;
  [4, 5].forEach((i) => assert.ok(Math.abs(tank[i] - W / 4) < 1e-9, `tank centre wheel ${i} carries 25%`));
});
