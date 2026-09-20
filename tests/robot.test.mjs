// The realistic robot (part solids, the drawn drive base) and real controllers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField, sampleBench, fixture } from './load.mjs';

const E = loadEngine();

function outside(hull, P, pts) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let worst = 0;
  for (const [a, b, c] of hull.faces) {
    const n = cr(sub(P[b], P[a]), sub(P[c], P[a])), L = Math.hypot(...n);
    for (const p of pts) { const d = (n[0] * (p[0] - P[a][0]) + n[1] * (p[1] - P[a][1]) + n[2] * (p[2] - P[a][2])) / L; worst = Math.max(worst, d); }
  }
  return worst;
}
const euler = (h) => { const V = new Set(); h.faces.forEach((f) => f.forEach((i) => V.add(i))); return V.size - h.faces.length / 2; };

test('hull: a cube of points is 12 outward triangles with everything inside', () => {
  const pts = [];
  for (let i = 0; i < 8; i++) pts.push([i & 1, i & 2 ? 1 : 0, i & 4 ? 1 : 0]);
  for (let i = 0; i < 100; i++) pts.push([((i * 37) % 97) / 97, ((i * 53) % 89) / 89, ((i * 71) % 83) / 83]);
  const h = E.convexHull(pts);
  assert.equal(h.faces.length, 12);
  assert.equal(euler(h), 2);
  assert.ok(outside(h, pts, pts) < 1e-12);
});

test('hull: a cylinder stays round, and a flat sheet falls back to a thin box', () => {
  const cyl = [];
  for (let i = 0; i < 40; i++) { const t = i / 40 * Math.PI * 2; cyl.push([Math.cos(t), Math.sin(t), 0], [Math.cos(t), Math.sin(t), 2]); }
  const h = E.convexHull(cyl);
  assert.equal(euler(h), 2);
  assert.ok(h.faces.length > 60, 'the round side is kept, not boxed');
  const flat = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0.5, 0.5, 0]];
  assert.equal(E.convexHull(flat), null);
  assert.equal(E.solidTriangles(flat).pos.length / 9, 12, 'drawn as a box instead');
});

test('solids: every leaf part of a STEP assembly comes out placed, with a material', () => {
  const cad = E.parseSTEP(fixture('assembly.step'));
  assert.ok(cad.solids.length >= 2);
  for (const s of cad.solids) {
    assert.ok(s.pts.length >= 4);
    assert.ok(['metal', 'servo', 'motor', 'wheel', 'electronics', 'clear', 'printed', 'fastener', 'belt'].includes(s.kind));
  }
  assert.ok(cad.solids.some((s) => s.kind === 'servo'), 'the goBILDA servo is recognised');
  assert.equal(E.solidKind('5203 Series Yellow Jacket', '5203-2402-0019'), 'motor');
  assert.equal(E.solidKind('M4 x 12 mm SHCS', null), 'fastener');
  assert.equal(E.solidKind('Intake roller (printed)', null), 'wheel');
});

test('solids: the sample robot is built from real part shapes', () => {
  const s = E.sampleSolids();
  assert.ok(s.length >= 10);
  assert.ok(s.some((x) => x.kind === 'servo') && s.some((x) => x.kind === 'printed') && s.some((x) => x.kind === 'metal'));
  for (const x of s) assert.ok(E.solidTriangles(x.pts).pos.length >= 36, x.name);
});

test('drive base: drawn when the code drives and the CAD has no wheels, never over a real one', () => {
  const Ef = loadWithField();
  const { cad } = sampleBench(Ef, Ef.DRIVE_JAVA);
  const code = Ef.parseJava(Ef.DRIVE_JAVA);
  const dt = Ef.detectDrivetrain(code);
  const base = Ef.robotBase(cad, dt, 'auto', '+x');
  assert.ok(base && base.L >= 0.38 && base.L <= 0.457 && base.W >= 0.34 && base.W <= 0.457);
  assert.equal(Ef.robotBase(cad, Ef.detectDrivetrain(Ef.parseJava(Ef.SAMPLE_JAVA)), 'auto', '+x'), null, 'no drivetrain, no base');
  const wheeled = { ...cad, parts: cad.parts.concat([{ name: 'goBILDA 104mm Mecanum Wheel', n: 4 }]) };
  assert.equal(Ef.robotBase(wheeled, dt, 'auto', '+x'), null, 'the CAD brings its own wheels');
  assert.ok(Ef.robotBase(wheeled, dt, 'show', '+x'), 'unless you ask for it');
  const fp = Ef.footprintOf(cad, '+x', base);
  assert.ok(fp.hx >= base.L / 2 && fp.hy >= base.W / 2 && fp.h > Ef.footprintOf(cad, '+x', null).h);
});

test('controller: a standard-mapping gamepad reads as the FTC SDK gamepad', () => {
  const b = (pressed, value) => ({ pressed, value: value == null ? (pressed ? 1 : 0) : value });
  const buttons = Array.from({ length: 17 }, () => b(false));
  buttons[0] = b(true); buttons[5] = b(true); buttons[7] = b(true, 0.6); buttons[12] = b(true);
  const pad = E.padFromGamepad({ buttons, axes: [0.03, -0.9, 0.5, 0] }, 0.08);
  assert.equal(pad.a, true); assert.equal(pad.cross, true, 'PlayStation name too');
  assert.equal(pad.right_bumper, true);
  assert.equal(pad.right_trigger, 0.6, 'triggers stay analog');
  assert.equal(pad.dpad_up, true);
  assert.equal(pad.left_stick_x, 0, 'inside the deadzone');
  assert.equal(pad.left_stick_y, -0.9, 'stick up is negative, as on the robot');
  assert.equal(pad.right_stick_x, 0.5);
  assert.equal(E.padName('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'Xbox 360 Controller');
  assert.equal(E.padName('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'), 'Wireless Controller');
});

test('keyboard: each key presses the gamepad the OpMode actually reads', () => {
  const shooter = E.parseJava(E.SHOOTER_JAVA);
  assert.equal(E.padFor(shooter, 'left_stick_y', 2), 1, 'driving is on gamepad1');
  assert.equal(E.padFor(shooter, 'right_bumper', 1), 2, 'the kicker is on gamepad2');
  assert.equal(E.padFor(shooter, 'a', 2), 2, 'unused controls go to the pad on screen');
  const claw = E.parseJava(E.SAMPLE_JAVA);
  assert.equal(E.busiestPad(claw), 2);
  assert.equal(E.busiestPad(shooter), 1);
});
