// ZeroPowerBehavior.FLOAT opens the windings: no motor torque, no back-EMF braking. The gearmotor's
// own friction is still there; the free-running current is that friction made visible (all of a free
// motor's current goes into it). goBILDA 5203 312 rpm: 2.383 N.m stall, 9.2 A stall, 0.25 A free at
// 12 V, so about 0.065 N.m at the output, 1.25 N at a 104 mm wheel's rim, 5 N on four wheels.
// Without it an 11 kg robot coasted 5.6 m from full speed; with it, about 2 m.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const COAST = [true, true, true, true];

function rig(spec) {
  const hx = 0.168, hy = 0.18, r = 0.052;
  const wheels = [{ x: hx, y: hy, r, roller: 1 }, { x: hx, y: -hy, r, roller: -1 }, { x: -hx, y: hy, r, roller: -1 }, { x: -hx, y: -hy, r, roller: 1 }];
  return {
    props: { kg: 11, com: { x: 0, y: 0, z: 0.08 }, comHeight: 0.08, Izz: 11 * (0.336 ** 2 + 0.36 ** 2) / 12 },
    drive: { kind: 'mecanum', wheels }, motors: wheels.map(() => spec), gear: 1,
  };
}
const YJ312 = () => E.hwFromPart('5203-2402-0019', '');
/* 2 s of full forward, then T s at zero power, FLOAT or BRAKE */
function coast(R, float, T = 6) {
  let st = E.Dyn.reset(R);
  for (let k = 0; k < 100; k++) st = E.Dyn.step(st, [1, 1, 1, 1], R, 0.02);
  const v0 = st.v.x;
  let x = 0, stopAt = null;
  const tr = [];
  for (let k = 0; k < Math.round(T / 0.02); k++) {
    st = E.Dyn.step(st, [0, 0, 0, 0], R, 0.02, float ? COAST : undefined);
    x += st.v.x * 0.02;
    if (stopAt == null && st.v.x < 0.005) stopAt = (k + 1) * 0.02;
    tr.push(st);
  }
  return { v0, x, stopAt, tr };
}

test('FLOAT: the gearmotor\'s own friction stops a coasting robot in about 2 m, not 5.6', () => {
  const c = coast(rig(YJ312()), true);
  assert.ok(c.v0 > 1.6, 'full speed ' + c.v0);
  assert.ok(c.x >= 1.2 && c.x <= 2.5, `FLOAT from ${c.v0.toFixed(2)} m/s coasts ${c.x.toFixed(2)} m`);
  assert.ok(c.stopAt != null && c.stopAt < 3.5, `stopped after ${c.stopAt} s`);
});

test('FLOAT: friction brings the robot and its wheels to rest and never turns them round', () => {
  const c = coast(rig(YJ312()), true);
  for (const st of c.tr) {
    assert.ok(st.v.x >= 0, 'the robot never rolls backwards: ' + st.v.x);
    for (const o of st.wheelOmega) assert.ok(o >= -1e-6, 'a wheel never spins backwards: ' + o);   // solver noise is 1e-8
  }
  const end = c.tr[c.tr.length - 1];
  assert.ok(Math.abs(end.v.x) < 1e-9 && Math.abs(end.omega) < 1e-9, `at rest: ${end.v.x}, ${end.omega}`);
  for (const o of end.wheelOmega) assert.ok(Math.abs(o) < 1e-6, 'wheel at rest: ' + o);
});

test('FLOAT: the friction comes from the spec\'s own currents; BRAKE does not see it', () => {
  const base = YJ312();
  const loose = coast(rig(Object.assign({}, base, { freeA: 0.1 })), true).x;
  const stiff = coast(rig(Object.assign({}, base, { freeA: 0.5 })), true).x;
  assert.ok(loose > coast(rig(base), true).x && stiff < coast(rig(base), true).x, `freeA 0.1: ${loose.toFixed(2)} m, 0.5: ${stiff.toFixed(2)} m`);
  // a spec with no currents is taken for the 5203 motor
  const bare = coast(rig({ stallNm: base.stallNm, rpm: base.rpm }), true).x;
  assert.ok(Math.abs(bare - coast(rig(base), true).x) < 1e-9, 'no currents: the 5203 figures');
  // BRAKE: back-EMF braking, the same with or without currents in the spec
  const b1 = coast(rig(base), false), b2 = coast(rig({ stallNm: base.stallNm, rpm: base.rpm }), false);
  assert.equal(b1.x, b2.x);
  assert.ok(b1.x < 0.3, 'BRAKE stops in ' + b1.x.toFixed(3) + ' m');
});
