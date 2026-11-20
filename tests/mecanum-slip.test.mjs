// The mecanum strafe loss is kinematic: rollers scrub and slip, so a real base strafes at about
// 0.75-0.9 of its forward speed and its wheel encoders over-read a strafe (the reason Road Runner
// has lateralInPerTick and Pedro a lateral multiplier). strafeEff (src/dynamics.js dynWheels) is
// that share; it must slow the strafe at steady speed, not only its spin-up, leave forward driving
// alone, and calibration (src/calibrate.js) must fit it from a measured strafe speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

/* 11 kg, 104 mm wheels, goBILDA 312 rpm on each, the standard X (FL and BR roller +1). */
function rig(extra = {}, withIk = false) {
  const hx = 0.168, hy = 0.18, r = 0.052;
  const wheels = [{ x: hx, y: hy, r, roller: 1 }, { x: hx, y: -hy, r, roller: -1 }, { x: -hx, y: hy, r, roller: -1 }, { x: -hx, y: -hy, r, roller: 1 }];
  const spec = { stallNm: 2.38, rpm: 312 };
  const R = Object.assign({
    props: { kg: 11, com: { x: 0, y: 0, z: 0.08 }, comHeight: 0.08, Izz: 11 * (0.336 ** 2 + 0.36 ** 2) / 12 },
    drive: { kind: 'mecanum', wheels }, motors: wheels.map(() => spec), gear: 1,
  }, extra);
  if (withIk) R.drive = Object.assign({}, R.drive, { ik: E.ikMatrix('mecanum', wheels) });
  return R;
}
const FWD = [1, 1, 1, 1], LEFT = [-1, 1, 1, -1];
function drive(R, cmd, T) {
  let st = E.Dyn.reset(R), y = 0, enc = 0;
  const out = [];
  for (let k = 0; k < Math.round(T / 0.02); k++) {
    st = E.Dyn.step(st, cmd, R, 0.02);
    y += st.v.y * 0.02;
    const o = st.wheelOmega, r = R.drive.wheels[0].r;
    enc += (-o[0] + o[1] + o[2] - o[3]) / 4 * r * 0.02;      // the strafe the four encoders imply (ideal FK)
    out.push({ t: (k + 1) * 0.02, vx: st.v.x, vy: st.v.y, y, enc, st });
  }
  return out;
}
const last = (tr) => tr[tr.length - 1];

test('mecanum: by default the robot strafes at 0.75-0.9 of its forward speed, and the encoders over-read it', () => {
  for (const withIk of [false, true]) {
    const R = rig({}, withIk);
    const vf = last(drive(R, FWD, 3)).vx, sl = last(drive(R, LEFT, 3));
    const ratio = sl.vy / vf, enc = sl.y / sl.enc;
    assert.ok(ratio >= 0.75 && ratio <= 0.9, `${withIk ? 'ik' : 'own'} rows: strafe ${sl.vy.toFixed(3)} vs forward ${vf.toFixed(3)} m/s (${ratio.toFixed(3)})`);
    assert.ok(enc >= 0.75 && enc <= 0.9, `${withIk ? 'ik' : 'own'} rows: actual/encoder strafe ${enc.toFixed(3)}`);
  }
});

test('mecanum: strafeEff sets the strafe top speed, and forward driving does not see it at all', () => {
  const ideal = drive(rig({ strafeEff: 1 }), FWD, 2);
  for (const s of [0.6, 0.8, 0.95]) {
    const fwd = drive(rig({ strafeEff: s }), FWD, 2);
    // the same to the solver's own convergence (a few 1e-8 m/s)
    for (let i = 0; i < fwd.length; i++) {
      assert.ok(Math.abs(fwd[i].vx - ideal[i].vx) < 1e-6, `forward at ${fwd[i].t} s: ${fwd[i].vx} vs ${ideal[i].vx}`);
      assert.ok(Math.abs(fwd[i].st.wheelOmega[0] - ideal[i].st.wheelOmega[0]) < 1e-3, `forward wheel speed ${fwd[i].st.wheelOmega[0]} vs ${ideal[i].st.wheelOmega[0]}`);
    }
    const st = last(drive(rig({ strafeEff: s }), LEFT, 3)).vy, full = last(drive(rig({ strafeEff: 1 }), LEFT, 3)).vy;
    assert.ok(Math.abs(st / full - s) < 0.03, `strafeEff ${s}: strafe ${(st / full).toFixed(3)} of the ideal`);
  }
});

test('mecanum: the roller loss never makes power (the strafe needs no more than s^2 of the rim power)', () => {
  const R = rig({ strafeEff: 0.8 });
  const tr = drive(R, LEFT, 2);
  for (const p of tr) {
    const w = p.st.wrench;
    const chassis = w.fy * p.vy;                                // power into the chassis, sideways
    let rim = 0;
    for (let i = 0; i < 4; i++) rim += p.st.force[i] * p.st.wheelOmega[i] * R.drive.wheels[i].r;
    assert.ok(chassis <= rim + 1e-9, `at ${p.t.toFixed(2)} s the chassis took ${chassis.toFixed(2)} W from ${rim.toFixed(2)} W`);
  }
});

test('calibrate: a robot that strafes at 0.8 of forward is fitted by its strafe share, spin-up and top speed alike', () => {
  const base = rig(), truth = rig({ strafeEff: 0.8 });
  const m = E.calMeasure(truth);
  const fit = E.calFit(base, { fwd: m.fwd, strafe: m.strafe });
  assert.ok(Math.abs(fit.params.strafeEff - 0.8) < 0.02, 'fitted strafeEff ' + fit.params.strafeEff);
  const fitted = E.calApplyToRig(base, fit.params);
  const real = drive(truth, LEFT, 4), sim = drive(fitted, LEFT, 4);
  for (const T of [0.25, 0.5, 1, 4]) {
    const a = real[Math.round(T / 0.02) - 1].vy, b = sim[Math.round(T / 0.02) - 1].vy;
    assert.ok(Math.abs(b - a) <= 0.05 * a, `at ${T} s the fitted robot strafes ${b.toFixed(3)} m/s, the real one ${a.toFixed(3)}`);
  }
  // the fit says what its strafeEff means, so the sim takes it
  assert.equal(fit.params.strafeModel, 2);
  assert.equal(E.calOpts({ params: fit.params }).strafeEff, fit.params.strafeEff);
});

test('calibrate: a strafeEff fitted when it was a force loss is not handed to the sim', () => {
  assert.equal(E.calOpts({ params: { strafeEff: 0.35 } }), null);
  assert.deepEqual(E.calOpts({ params: { gear: 1.2, strafeEff: 0.35 } }), { gear: 1.2 });
  assert.deepEqual(E.calOpts({ params: { strafeEff: 0.82, strafeModel: 2 } }), { strafeEff: 0.82 });
});
