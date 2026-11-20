// The chassis velocity is kept in the body frame (src/dynamics.js Dyn.step), so every step turns it
// back by the angle the body turned. Done as dt (omega x v) added on, that grew the speed by
// (dt omega)^2 of itself every step: a robot coasting round a curve gained energy from nothing
// (63,497 of 599,250 motors-off steps rose in an independent review, the worst by 2.72 J). An
// exact rotation keeps the speed's length.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

const hx = 0.168, hy = 0.18, r = 0.048, a45 = Math.PI / 4;
const BASES = {
  mecanum: [{ x: hx, y: hy, r, roller: 1 }, { x: hx, y: -hy, r, roller: -1 }, { x: -hx, y: hy, r, roller: -1 }, { x: -hx, y: -hy, r, roller: 1 }],
  tank: [{ x: hx, y: hy, r }, { x: hx, y: -hy, r }, { x: -hx, y: hy, r }, { x: -hx, y: -hy, r }],
  x: [{ x: hx, y: hy, r, alpha: -a45 }, { x: hx, y: -hy, r, alpha: a45 }, { x: -hx, y: hy, r, alpha: a45 }, { x: -hx, y: -hy, r, alpha: -a45 }],
};
function rig(kind, extra = {}) {
  const wheels = BASES[kind];
  return Object.assign({
    props: { kg: 12, com: { x: 0, y: 0, z: 0.08 }, comHeight: 0.08, Izz: 12 * (0.336 ** 2 + 0.36 ** 2) / 12 },
    drive: { kind, wheels }, motors: wheels.map(() => ({ stallNm: 2.38, rpm: 312 })), gear: 1,
  }, extra);
}
const OFF = { mu: 0, rolling: 0, viscous: 0, yawViscous: 0 };
const KE = (R, st) => 0.5 * R.props.kg * (st.v.x ** 2 + st.v.y ** 2) + 0.5 * R.props.Izz * st.omega ** 2;

test('Dyn: a robot spinning and sliding with everything off keeps its energy, to rounding', () => {
  // no grip, no drag, no motors: nothing acts on the chassis, so its speed, its spin and its
  // kinetic energy stay what they were, however far it turns
  for (const kind of Object.keys(BASES)) for (const [v, w] of [[{ x: 1, y: 0.5 }, 3], [{ x: -0.4, y: 1.6 }, -7], [{ x: 2, y: 0 }, 12]]) for (const dt of [0.02, 0.005]) {
    const R = rig(kind, OFF);
    let st = E.Dyn.reset(R); st.v = { ...v }; st.omega = w;
    const e0 = KE(R, st), sp0 = Math.hypot(v.x, v.y);
    let heading = 0;
    for (let k = 0; k < Math.round(4 / dt); k++) {
      st = E.Dyn.step(st, [0, 0, 0, 0], R, dt, [true, true, true, true]);
      heading += st.omega * dt;
      assert.ok(Math.abs(KE(R, st) - e0) <= 1e-12 * e0, `${kind}, dt ${dt}, step ${k}: ${KE(R, st)} J, started with ${e0} J`);
    }
    assert.ok(Math.abs(Math.hypot(st.v.x, st.v.y) - sp0) <= 1e-12 * sp0, `${kind}: speed ${Math.hypot(st.v.x, st.v.y)} vs ${sp0}`);
    assert.equal(st.omega, w);
    // and in the world frame it goes straight on: the body-frame velocity turned back by exactly the heading
    const c = Math.cos(heading), s = Math.sin(heading);
    const wx = st.v.x * c - st.v.y * s, wy = st.v.x * s + st.v.y * c;
    assert.ok(Math.hypot(wx - v.x, wy - v.y) < 1e-9, `${kind}: world velocity ${wx}, ${wy} vs ${v.x}, ${v.y}`);
  }
});

test('Dyn: a mecanum robot coasting with the motors off never gains energy on a curved path', () => {
  // grip on, drag off: the wheels can only take energy out (motors, tyre slip)
  for (const s of [0.6, 0.85, 1]) for (const mode of ['FLOAT', 'BRAKE']) for (const [v, w] of [[{ x: 1.5, y: 0.3 }, 4], [{ x: 0.2, y: -1.2 }, -6], [{ x: 1, y: 1 }, 9]]) {
    const R = rig('mecanum', { strafeEff: s, rolling: 0, viscous: 0, yawViscous: 0 });
    let st = E.Dyn.reset(R); st.v = { ...v }; st.omega = w;
    const rows = E.Dyn.rimRows(R);
    st.wheelOmega = rows.map((q, i) => (q[0] * v.x + q[1] * v.y + q[2] * w) / R.drive.wheels[i].r);
    const ke = (st) => KE(R, st) + st.wheelOmega.reduce((a, o) => a + 0.5 * E.Dyn.defaults.wheelInertia * o * o, 0);
    let e = ke(st);
    for (let k = 0; k < 200; k++) {
      st = E.Dyn.step(st, [0, 0, 0, 0], R, 0.02, mode === 'FLOAT' ? [true, true, true, true] : null);
      const e2 = ke(st);
      assert.ok(e2 <= e + 1e-9, `s = ${s}, ${mode}, step ${k}: ${e} J -> ${e2} J`);
      e = e2;
    }
  }
});
