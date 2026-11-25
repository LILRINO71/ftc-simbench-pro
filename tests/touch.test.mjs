// Touch controls (src/touch.js): the stick maths, which finger holds which control, and the write
// onto the same gamepad state the keyboard writes (and the team's Java reads).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, loadWithField, sampleBench, run } from './load.mjs';

const E = loadEngine();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = new Function(fs.readFileSync(path.join(ROOT, 'src', 'keybinds.js'), 'utf8') + '\nreturn { KEY_CONTROLS };')();
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const L = { cx: 100, cy: 300, r: 60 };          // a stick on the screen: centre and reach in pixels
const R = { cx: 700, cy: 300, r: 60 };

test('stick: inside the dead zone it reads zero, past it the push ramps from 0 to 1', () => {
  assert.deepEqual(E.touchStick(0, 0, 60), { x: 0, y: 0 });
  assert.deepEqual(E.touchStick(5, -4, 60), { x: 0, y: 0 }, 'a resting thumb is centre');
  const d = E.TOUCH_DEAD * 60;
  assert.deepEqual(E.touchStick(d, 0, 60), { x: 0, y: 0 }, 'exactly at the edge of the dead zone is still zero');
  const half = E.touchStick(d + (60 - d) / 2, 0, 60);
  assert.ok(near(half.x, 0.5) && half.y === 0, 'half way between the dead zone and the rim is half a push: ' + half.x);
  assert.ok(near(E.touchStick(60, 0, 60).x, 1), 'the rim is full');
});

test('stick: down and right are positive, as the SDK has them (up is -1)', () => {
  const up = E.touchStick(0, -50, 60), down = E.touchStick(0, 50, 60), left = E.touchStick(-50, 0, 60), right = E.touchStick(50, 0, 60);
  assert.ok(up.y < 0 && up.x === 0);
  assert.ok(down.y > 0);
  assert.ok(left.x < 0);
  assert.ok(right.x > 0);
  assert.ok(near(up.y, -down.y) && near(left.x, -right.x), 'symmetric');
});

test('stick: clamped at the rim however far the thumb slides, and a diagonal is no stronger than a straight push', () => {
  const far = E.touchStick(400, 0, 60);
  assert.ok(near(far.x, 1) && far.y === 0, 'a long way past the rim is still 1');
  const diag = E.touchStick(300, -300, 60);
  assert.ok(near(Math.hypot(diag.x, diag.y), 1), 'the whole stick is a disc of radius 1: ' + Math.hypot(diag.x, diag.y));
  assert.ok(near(diag.x, -diag.y), 'at 45 degrees');
  for (const [dx, dy] of [[1e6, 1e6], [-1e6, 3], [0.001, 0], [60, 60]]) { const v = E.touchStick(dx, dy, 60); assert.ok(Math.hypot(v.x, v.y) <= 1 + 1e-9, 'never past 1'); }
});

test('stick: bad input reads as centre, never NaN', () => {
  for (const args of [[NaN, 5, 60], [5, NaN, 60], [10, 10, 0], [10, 10, -3], [10, 10, undefined], [Infinity, 0, 60]]) {
    const v = E.touchStick(...args);
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y), JSON.stringify(args));
  }
  assert.equal(E.touchStick(0, -50, 60, 0).y < 0, true, 'a dead zone of 0 is allowed');
});

test('phone: a touch screen under 600 px on its short side', () => {
  assert.equal(E.touchPhone(true, 844, 390), true);
  assert.equal(E.touchPhone(true, 390, 844), true, 'portrait too');
  assert.equal(E.touchPhone(true, 1024, 768), false, 'a tablet has room for the panels');
  assert.equal(E.touchPhone(false, 390, 844), false, 'a narrow desktop window is not a phone');
  assert.equal(E.touchPhone(true, 0, 0), false);
});

test('model: two thumbs at once, a stick on each (drive and turn together)', () => {
  const m = E.touchModel();
  assert.equal(m.down(1, 'left', 100, 240, L), true);          // pushed straight up: 60 px
  assert.equal(m.down(2, 'right', 760, 300, R), true);         // pushed straight right
  const s = m.state();
  assert.ok(s.left_stick_y < -0.9 && s.left_stick_x === 0);
  assert.ok(s.right_stick_x > 0.9 && s.right_stick_y === 0);
  m.move(1, 140, 270);                                         // the first thumb slides on: the second is not disturbed
  const t = m.state();
  assert.ok(t.left_stick_x > 0 && t.left_stick_y < 0);
  assert.equal(t.right_stick_x, s.right_stick_x);
  m.up(1);
  const u = m.state();
  assert.equal(u.left_stick_x, 0); assert.equal(u.left_stick_y, 0);
  assert.ok(u.right_stick_x > 0.9, 'the other thumb is still on');
  m.up(2);
  assert.equal(m.count(), 0);
});

test('model: a stick and buttons together, and a stick holds one finger at a time', () => {
  const m = E.touchModel();
  m.down(1, 'left', 100, 250, L);
  assert.equal(m.down(2, 'a'), true);
  assert.equal(m.down(3, 'right_trigger'), true);
  assert.equal(m.down(4, 'left', 90, 300, L), false, 'the left stick already has a finger');
  const s = m.state();
  assert.equal(s.a, true); assert.equal(s.right_trigger, 1, 'a trigger is pulled to 1'); assert.equal(s.b, false);
  assert.ok(s.left_stick_y < 0);
  assert.equal(m.count(), 3);
  m.up(4);                                                     // the refused finger never counted
  assert.equal(m.count(), 3);
});

test('model: a button two fingers are on stays down until the last lifts', () => {
  const m = E.touchModel();
  m.down(1, 'x'); m.down(2, 'x');
  m.up(1);
  assert.equal(m.state().x, true);
  m.up(2);
  assert.equal(m.state().x, false);
});

test('model: a cancelled finger (a call, a swipe from the edge) lets go the same way, and clear() drops everything', () => {
  const m = E.touchModel();
  m.down(7, 'left', 100, 250, L); m.down(8, 'y'); m.down(9, 'dpad_up');
  assert.equal(m.up(7), true);
  assert.equal(m.up(7), false, 'a second pointerup for the same finger does nothing');
  m.clear();
  const s = m.state();
  for (const k in s) assert.ok(s[k] === 0 || s[k] === false, k + ' is released');
});

test('model: a finger that lands on a new control drops the one it had, and unknown controls are refused', () => {
  const m = E.touchModel();
  m.down(1, 'a'); m.down(1, 'b');
  const s = m.state();
  assert.equal(s.a, false); assert.equal(s.b, true);
  assert.equal(m.down(2, 'left_stick_button'), false);
  assert.equal(m.down(3, 'left'), false, 'a stick needs its geometry');
});

test('model: the knob is drawn at the thumb, held inside the rim', () => {
  const m = E.touchModel();
  m.down(1, 'left', 100, 300 - 30, L);
  assert.deepEqual(m.knob('left'), { x: 0, y: -30 });
  m.move(1, 100 + 300, 300);
  const k = m.knob('left');
  assert.ok(near(k.x, 60) && near(k.y, 0), 'stops at the rim');
  assert.deepEqual(m.knob('right'), { x: 0, y: 0 });
});

test('model: the state names every control the keyboard has, so a key and a finger are the same press', () => {
  const s = E.touchModel().state();
  const fromKeys = new Set(K.KEY_CONTROLS.map(([c]) => c.replace(/[+-]$/, '')));
  for (const c of Object.keys(s)) assert.ok(fromKeys.has(c), c + ' is a control the keyboard can press');
  for (const b of E.TOUCH_BUTTONS) assert.ok(b in s);
  for (const a of ['left_stick_x', 'left_stick_y', 'right_stick_x', 'right_stick_y']) assert.ok(a in s);
  // and the names a real controller would put in the same fields
  for (const c of Object.keys(s)) assert.ok(E.PAD_BUTTONS.includes(c) || /_stick_[xy]$/.test(c), c + ' is a gamepad field');
});

test('write: controls land on the gamepad the code reads them from, and release on the same one', () => {
  const pads = { 1: {}, 2: {} }, routes = {};
  const padOf = (c) => (/_stick_/.test(c) ? 1 : 2);            // a drive TeleOp on gamepad1, a claw on gamepad2
  const m = E.touchModel();
  m.down(1, 'left', 100, 250, L); m.down(2, 'a');
  const wrote = E.touchWrite(pads, routes, m.state(), padOf, null);
  assert.ok(pads[1].left_stick_y < 0 && pads[2].a === true);
  assert.equal(pads[2].left_stick_y, undefined, 'the stick never reached gamepad2');
  assert.ok(wrote.includes('left_stick_y') && wrote.includes('a'));
  const was = m.state();
  m.up(1); m.up(2);
  // the OpMode changed while the fingers were down: the release still clears where the press went
  E.touchWrite(pads, routes, m.state(), () => 2, was);
  assert.equal(pads[1].left_stick_y, 0); assert.equal(pads[2].a, false);
  assert.deepEqual(routes, {}, 'nothing is left held');
});

test('write: only what changed is written, and a stick at rest leaves the gamepad alone', () => {
  const pads = { 1: { left_stick_x: 0.5 }, 2: {} }, routes = {};
  const m = E.touchModel();
  let was = null;
  const step = () => { const now = m.state(); const w = E.touchWrite(pads, routes, now, () => 1, was); was = now; return w; };
  assert.deepEqual(step(), [], 'nothing touched, nothing written (a real controller\'s fields are not overwritten)');
  assert.equal(pads[1].left_stick_x, 0.5);
  m.down(1, 'b'); assert.deepEqual(step(), ['b']);
  assert.deepEqual(step(), [], 'the same state again writes nothing');
  m.up(1); assert.deepEqual(step(), ['b']);
});

test('write: a trigger is a number, a button a boolean, and a held stick follows the thumb', () => {
  const pads = { 1: {}, 2: {} }, routes = {};
  const m = E.touchModel();
  m.down(1, 'left_trigger'); m.down(2, 'dpad_left'); m.down(3, 'right', 700, 300 - 30, R);
  E.touchWrite(pads, routes, m.state(), () => 1, null);
  assert.strictEqual(pads[1].left_trigger, 1);
  assert.strictEqual(pads[1].dpad_left, true);
  const y1 = pads[1].right_stick_y;
  m.move(3, 700, 300 - 60);
  E.touchWrite(pads, routes, m.state(), () => 1, { right_stick_y: y1 });
  assert.ok(pads[1].right_stick_y < y1, 'pushed further');
  m.clear();
  E.touchWrite(pads, routes, m.state(), () => 1, null);
  assert.strictEqual(pads[1].left_trigger, 0); assert.strictEqual(pads[1].dpad_left, false); assert.strictEqual(pads[1].right_stick_y, 0);
});

test('drive: thumbs on the stick move the real simulator, the way the keyboard does', () => {
  const Ef = loadWithField();
  const { cad, code, map, opts } = sampleBench(Ef, Ef.DRIVE_JAVA);
  Ef.Sim.reset(code, cad, map, Object.assign({ startPose: { x: -1, y: 0, h: 0 } }, opts));
  const x0 = Ef.Sim.chassis.x;
  const m = Ef.touchModel(), routes = {};
  m.down(1, 'left', 100, 300 - 55, L);                         // the stick pushed up, nearly to the rim
  Ef.touchWrite(Ef.Sim.pad, routes, m.state(), () => 1, null);
  assert.ok(Ef.Sim.pad[1].left_stick_y < -0.8);
  run(Ef, 1.5);
  const moved = Math.hypot(Ef.Sim.chassis.x - x0, Ef.Sim.chassis.y);
  assert.ok(moved > 0.15, 'the robot drove ' + moved.toFixed(2) + ' m');
  const where = { x: Ef.Sim.chassis.x, y: Ef.Sim.chassis.y }, was = m.state();
  m.clear();
  Ef.touchWrite(Ef.Sim.pad, routes, m.state(), () => 1, was);
  assert.equal(Ef.Sim.pad[1].left_stick_y, 0, 'let go, the stick is centre');
  run(Ef, 1.5);
  assert.ok(Math.hypot(Ef.Sim.chassis.x - where.x, Ef.Sim.chassis.y - where.y) < moved, 'and the robot comes to rest');
});
