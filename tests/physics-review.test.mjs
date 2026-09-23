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

// ---- 2. a motor-driven joint is drawn through its reduction, a slide from its spool

const motor = (o) => Object.assign({ kind: 'motor', act: 0, restPos: 0, revs: 0, ticks: 0, offset: 0, tpr: 537.6, travelDeg: 300 }, o);
const deg = (r) => r * 180 / Math.PI;

test('view: a motor arm turns at gearmotor revs / the joint\'s reduction, within its travel', () => {
  assert.equal(typeof E.mechPose, 'function', 'mechPose is the pure pose the view draws');
  const arm = { kind: 'revolute-lift', dir: 1, axis: [0, 1, 0] };
  // RUN_TO_POSITION 1200 on a 19.2:1 is 2.23 output revs: 804 degrees drawn before
  const s = motor({ revs: 1200 / 537.6, ticks: 1200 });
  const a1 = deg(E.mechPose(arm, s, 0.5).ang);
  assert.ok(Math.abs(a1) <= 300 + 1e-9, `no reduction set: clamped to the joint's travel, drew ${a1.toFixed(0)} deg`);
  // a 5:1 reduction divides: 2.232 / 5 turns = 160.7 degrees, lift pivots draw negative
  const a5 = deg(E.mechPose({ ...arm, gear: 5 }, s, 0.5).ang);
  assert.ok(Math.abs(a5 + 1200 / 537.6 / 5 * 360) < 1e-6, `gear 5: ${a5.toFixed(2)} deg`);
  const a10 = deg(E.mechPose({ ...arm, gear: 10 }, s, 0.5).ang);
  assert.ok(Math.abs(a10 - a5 / 2) < 1e-9, 'twice the reduction, half the angle');
  // a turret's yaw is positive and clamps the same way
  const yaw = deg(E.mechPose({ kind: 'revolute-yaw', dir: 1, axis: [0, 0, 1] }, motor({ revs: 10 }), 0.5).ang);
  assert.ok(yaw > 0 && yaw <= 300 + 1e-9, `turret: ${yaw.toFixed(0)} deg`);
});

test('view: the drawn joint follows the physical count, not the reset encoder', () => {
  // STOP_AND_RESET_ENCODER moves what the code reads (offset), not the arm
  const arm = { kind: 'revolute-lift', dir: 1, gear: 4, axis: [0, 1, 0] };
  const a = E.mechPose(arm, motor({ revs: 1, ticks: 537.6, offset: 537.6 }), 0.5).ang;
  assert.ok(Math.abs(deg(a) + 90) < 1e-9, `one output rev through 4:1 is -90 deg, drew ${deg(a)}`);
  const slide = { kind: 'linear', dir: 1, axis: [0, 0, 1], pivot: [0, 0, 0] };
  const d = E.mechPose(slide, motor({ revs: 1, ticks: 537.6, offset: 537.6 }), 0.5).d;
  assert.ok(Math.abs(d - 0.120) < 1e-9, `slide drawn at the physical count: ${d} m`);
});

test('view: a motor slide defaults to a 120 mm spool per output rev, not 1 mm per tick', () => {
  const slide = { kind: 'linear', dir: 1, axis: [0, 0, 1], pivot: [0, 0, 0] };
  // one output revolution of a 19.2:1 (537.6 counts) is 120 mm of string
  const d1 = E.mechPose(slide, motor({ revs: 1, ticks: 537.6 }), 0.5).d;
  assert.ok(Math.abs(d1 - 0.120) < 1e-9, `1 rev: ${d1} m (was 0.5376 m at 1 mm/tick)`);
  const d312 = E.mechPose(slide, motor({ revs: 1, ticks: 28 * 13.7, tpr: 28 * 13.7 }), 0.5).d;
  assert.ok(Math.abs(d312 - 0.120) < 1e-9, 'the default follows the motor\'s own counts per rev');
  // an explicit mmPerTick wins, and dir flips it
  const dm = E.mechPose({ ...slide, mmPerTick: 0.5, dir: -1 }, motor({ revs: 1, ticks: 537.6 }), 0.5).d;
  assert.ok(Math.abs(dm + 0.2688) < 1e-9, `mmPerTick 0.5, dir -1: ${dm}`);
  // a runaway motor doesn't draw a slide across the field
  const far = E.mechPose(slide, motor({ revs: 1000, ticks: 537600 }), 0.5).d;
  assert.ok(far <= 1.0 + 1e-9, `clamped to the slide's travel: ${far} m`);
  // a servo slide is drawn as before, from its position
  const sv = E.mechPose({ ...slide, lever: 0.2 }, { kind: 'servo', act: 1, restPos: 0.5 }, 0.5).d;
  assert.ok(Math.abs(sv - 0.1) < 1e-12, 'servo slide: travel x lever');
});

// ---- 3. the joint-kind aliases resolve to "linear" and leave the dropdown

test('JOINT_KINDS: "linear slide" is offered once; the aliases normalise to linear', () => {
  const keys = Object.keys(E.JOINT_KINDS), labels = keys.map((k) => E.JOINT_KINDS[k].label);
  assert.deepEqual(keys, ['revolute-yaw', 'revolute-lift', 'linear', 'effector', 'fixed']);
  assert.equal(new Set(labels).size, labels.length, 'no duplicate labels in the joint dropdown: ' + labels.join(', '));
  assert.equal(typeof E.normJointKind, 'function');
  assert.equal(E.normJointKind('linear-slide'), 'linear');
  assert.equal(E.normJointKind('prismatic'), 'linear');
  for (const k of keys) assert.equal(E.normJointKind(k), k, k + ' is already canonical');
  assert.equal(E.normJointKind('constructor'), 'constructor', 'no prototype lookups');
  // a session saved with an alias still names its joint instead of throwing
  assert.equal(E.JOINT_KINDS.prismatic.label, 'linear slide');
  // and the view draws an alias exactly like linear
  const s = motor({ revs: 1, ticks: 537.6 });
  for (const kind of ['linear-slide', 'prismatic'])
    assert.equal(E.mechPose({ kind, dir: 1 }, s, 0.5).d, E.mechPose({ kind: 'linear', dir: 1 }, s, 0.5).d, kind);
});
