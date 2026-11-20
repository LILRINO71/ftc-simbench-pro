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

/* Kinetic energy of the chassis and the four wheels, J. */
const J_WHEEL = 4.6e-4;
function energy(R, st) {
  let e = 0.5 * R.props.kg * (st.v.x ** 2 + st.v.y ** 2) + 0.5 * R.props.Izz * st.omega ** 2;
  for (const o of st.wheelOmega) e += 0.5 * J_WHEEL * o * o;
  return e;
}
const SHARES = [0.3, 0.6, 0.85, 1];
const NO_LOSS = { rolling: 0, viscous: 0, yawViscous: 0 };
/* The motors off: FLOAT (only the gearmotor's own friction, the 5203's currents) or BRAKE. */
function coast(R, st, mode, steps) {
  const es = [energy(R, st)];
  for (let k = 0; k < steps; k++) {
    st = E.Dyn.step(st, [0, 0, 0, 0], R, 0.02, mode === 'FLOAT' ? [true, true, true, true] : null);
    es.push(energy(R, st));
  }
  return { st, es };
}
const STARTS = [['sliding sideways at 1 m/s', { x: 0, y: 1 }, 0], ['spinning at 3 rad/s', { x: 0, y: 0 }, 3], ['sliding and spinning', { x: 0.5, y: 1 }, 2]];

test('mecanum: with the motors off and no rolling or viscous loss, the rollers never add energy on any step', () => {
  for (const mode of ['FLOAT', 'BRAKE']) for (const [label, v, w] of STARTS) for (const s of SHARES) {
    const R = rig(Object.assign({ strafeEff: s }, NO_LOSS));
    const st = E.Dyn.reset(R); st.v = v; st.omega = w;
    const { es } = coast(R, st, mode, 300);
    for (let k = 1; k < es.length; k++)
      assert.ok(es[k] <= es[k - 1] + 1e-9, `${mode}, ${label}, s = ${s}: ${es[k - 1].toFixed(4)} J -> ${es[k].toFixed(4)} J at step ${k}`);
  }
});

test('mecanum: with the motors off, no roller share leaves more energy at the end of the stop than ideal rollers', () => {
  for (const mode of ['FLOAT', 'BRAKE']) for (const [label, v, w] of STARTS) {
    const left = SHARES.map(s => {
      const R = rig(Object.assign({ strafeEff: s }, NO_LOSS));
      const st = E.Dyn.reset(R); st.v = v; st.omega = w;
      const { es } = coast(R, st, mode, 300);
      return es[es.length - 1];
    });
    const ideal = left[SHARES.indexOf(1)];
    SHARES.forEach((s, i) => assert.ok(left[i] <= ideal + 1e-6, `${mode}, ${label}: s = ${s} leaves ${left[i].toFixed(4)} J after 6 s, ideal rollers ${ideal.toFixed(4)} J`));
  }
});

test('mecanum: a BRAKE stop from a full strafe is no shorter with slipping rollers than with ideal ones', () => {
  // the same moment for every share: the ideal-roller robot at its full strafe (chassis and wheels)
  const R1 = rig({ strafeEff: 1 });
  let full = E.Dyn.reset(R1);
  for (let k = 0; k < 150; k++) full = E.Dyn.step(full, LEFT, R1, 0.02);
  const stop = (s) => {
    const R = rig({ strafeEff: s });
    let st = { v: { ...full.v }, omega: full.omega, wheelOmega: full.wheelOmega.slice() }, y = 0;
    for (let k = 0; k < 300; k++) { st = E.Dyn.step(st, [0, 0, 0, 0], R, 0.02); y += st.v.y * 0.02; }
    assert.ok(Math.abs(st.v.y) < 1e-6, `s = ${s} has stopped`);
    return y;
  };
  const ideal = stop(1);
  for (const s of [0.3, 0.6, 0.85]) {
    const d = stop(s);
    assert.ok(d >= ideal - 1e-9, `s = ${s} stops in ${d.toFixed(4)} m, ideal rollers in ${ideal.toFixed(4)} m`);
  }
});

test('mecanum: a powered strafe tops out at s of forward speed, and the encoders over-read it by 1/s', () => {
  const ratios = (s) => {
    const R = rig({ strafeEff: s });
    const vf = last(drive(R, FWD, 3)).vx, sl = last(drive(R, LEFT, 3));
    return { speed: sl.vy / vf, over: sl.enc / sl.y };
  };
  const ideal = ratios(1);                                       // the tyres' own slip (about 2%) is in both
  for (const s of [0.6, 0.85]) {
    const r = ratios(s);
    assert.ok(Math.abs(r.speed - s) < 0.01, `s = ${s}: strafe ${r.speed.toFixed(4)} of forward`);
    assert.ok(Math.abs(r.over / ideal.over * s - 1) < 0.01, `s = ${s}: encoders read ${(r.over / ideal.over).toFixed(4)} x the strafe, 1/s = ${(1 / s).toFixed(4)}`);
  }
});

test('mecanum: where power turns round in the rollers nothing chatters: a strafe cut from full to half power slows smoothly to the half-power speed', () => {
  const R = rig(), HALF = LEFT.map(c => c / 2);
  const fromRest = last(drive(R, HALF, 8)).vy;
  let st = E.Dyn.reset(R);
  const vs = [];
  for (let k = 0; k < 550; k++) { st = E.Dyn.step(st, k < 150 ? LEFT : HALF, R, 0.02); vs.push(st.v.y); }
  for (let k = 151; k < vs.length; k++) assert.ok(vs[k] <= vs[k - 1] + 1e-9, `the strafe sped up again at ${((k + 1) * 0.02).toFixed(2)} s: ${vs[k - 1]} -> ${vs[k]}`);
  assert.ok(Math.abs(vs[vs.length - 1] - fromRest) < 1e-4, `settles at ${vs[vs.length - 1].toFixed(4)} m/s, a half-power strafe from rest at ${fromRest.toFixed(4)}`);
});

test('mecanum: forward driving is the same at every roller share, and other bases never see it', () => {
  // the converged solve (32 sweeps) is the same to rounding; the default 6 sweeps to their own residual
  for (const s of [0.3, 0.6, 0.85]) for (const sweeps of [32, undefined]) {
    const tol = sweeps ? 1e-12 : 1e-6;
    const a = drive(rig({ strafeEff: s, sweeps }), FWD, 2), b = drive(rig({ strafeEff: 1, sweeps }), FWD, 2);
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a[i].vx - b[i].vx) <= tol && Math.abs(a[i].vy - b[i].vy) <= tol, `s = ${s}, sweeps ${sweeps || 6}: ${a[i].vx} vs ${b[i].vx} at ${a[i].t} s`);
      assert.ok(Math.abs(a[i].st.omega - b[i].st.omega) <= tol, `s = ${s}: turning ${a[i].st.omega}`);
    }
  }
  const hx = 0.168, hy = 0.18, r = 0.052, a45 = Math.PI / 4;
  const bases = {
    tank: [{ x: hx, y: hy, r }, { x: hx, y: -hy, r }, { x: -hx, y: hy, r }, { x: -hx, y: -hy, r }],
    x: [{ x: hx, y: hy, r, alpha: -a45 }, { x: hx, y: -hy, r, alpha: a45 }, { x: -hx, y: hy, r, alpha: a45 }, { x: -hx, y: -hy, r, alpha: -a45 }],
    kiwi: [0, 2, 4].map(k => { const t = k * Math.PI / 3 + Math.PI / 2; return { x: 0.2 * Math.cos(t), y: 0.2 * Math.sin(t), r, alpha: t + Math.PI / 2 }; }),
    swerve: [{ x: hx, y: hy, r, alpha: 0 }, { x: hx, y: -hy, r, alpha: 0 }, { x: -hx, y: hy, r, alpha: 0 }, { x: -hx, y: -hy, r, alpha: 0 }],
  };
  for (const [kind, wheels] of Object.entries(bases)) {
    const cmd = wheels.map((_, i) => [0.7, -0.4, 0.9, 0.2][i]);
    const run = (s) => drive(rig({ strafeEff: s, drive: { kind, wheels }, motors: wheels.map(() => ({ stallNm: 2.38, rpm: 312 })) }), cmd, 2);
    const a = run(0.3), b = run(1);
    for (let i = 0; i < a.length; i++) assert.deepEqual([a[i].vx, a[i].vy, a[i].st.omega], [b[i].vx, b[i].vy, b[i].st.omega], `${kind} at ${a[i].t} s`);
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
