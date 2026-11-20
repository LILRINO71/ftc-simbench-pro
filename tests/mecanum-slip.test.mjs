// The mecanum strafe loss: real rollers scrub and slip, so a real base strafes at about 0.75-0.9 of
// its forward speed and its wheel encoders over-read a strafe (the reason Road Runner has
// lateralInPerTick and Pedro a lateral multiplier). The sim models the rollers as acting at an
// EFFECTIVE angle (src/dynamics.js dynWheels): one row per wheel, [1, -k/s, -(y + k x/s)], for its
// speed and for its force alike, s = strafeEff. That is an ordinary constraint, so it can neither
// make nor lose energy; a strafe tops out at s of forward speed, the encoders over-read it by 1/s,
// the force along the effective roller axis never passes mu N, and calibration (src/calibrate.js)
// fits s from a measured strafe speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
/* The reviewer's robot (12 kg, 96 mm wheels), for the ease-off and the P controller. */
function rig12(extra = {}) {
  const hx = 0.168, hy = 0.18, r = 0.048;
  const wheels = [{ x: hx, y: hy, r, roller: 1 }, { x: hx, y: -hy, r, roller: -1 }, { x: -hx, y: hy, r, roller: -1 }, { x: -hx, y: -hy, r, roller: 1 }];
  return Object.assign({
    props: { kg: 12, com: { x: 0, y: 0, z: 0.08 }, comHeight: 0.08, Izz: 12 * (0.336 ** 2 + 0.36 ** 2) / 12 },
    drive: { kind: 'mecanum', wheels }, motors: wheels.map(() => ({ stallNm: 2.38, rpm: 312 })), gear: 1,
  }, extra);
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

test('mecanum: one row per wheel, [1, -k/s, -(y + k x/s)], and the force a wheel puts on the chassis is that row times one number', () => {
  for (const withIk of [false, true]) for (const s of [0.3, 0.6, 0.85, 1]) {
    const R = rig({ strafeEff: s }, withIk);
    const rows = E.Dyn.rimRows(R);
    R.drive.wheels.forEach((w, i) => {
      const k = w.roller, want = [1, -k / s, -(w.y + k * w.x / s)];
      for (let j = 0; j < 3; j++) assert.ok(Math.abs(rows[i][j] - want[j]) < 1e-12, `s = ${s}, wheel ${i}: row ${rows[i]} vs ${want}`);
    });
    // strafing, turning, a diagonal, easing off, braking, coasting: every step, the chassis wrench is
    // the sum of each wheel's force times the same row its speed is measured with
    const plan = [[LEFT, 40], [[-1, 1, -1, 1], 20], [[1, 0, 0, 1], 20], [LEFT.map(c => c / 2), 20], [[0, 0, 0, 0], 20]];
    let st = E.Dyn.reset(R);
    for (const [cmd, n] of plan) for (let k = 0; k < n; k++) {
      st = E.Dyn.step(st, cmd, R, 0.02, k % 2 ? [true, true, true, true] : null);
      const sum = [0, 0, 0];
      st.force.forEach((F, i) => { for (let j = 0; j < 3; j++) sum[j] += F * rows[i][j]; });
      const got = [st.wrench.fx, st.wrench.fy, st.wrench.tz];
      for (let j = 0; j < 3; j++) assert.ok(Math.abs(got[j] - sum[j]) <= 1e-9 * (1 + Math.abs(sum[j])), `s = ${s}: wrench ${got} vs rows x forces ${sum}`);
      // and each wheel's slip is its rim against the ground speed through that same row
      st.wheelOmega.forEach((o, i) => {
        const r = rows[i], vn = r[0] * st.v.x + r[1] * st.v.y + r[2] * st.omega, w = R.drive.wheels[i];
        const want = Math.max(-10, Math.min(10, (o * w.r - vn) / Math.max(Math.abs(vn), 0.05)));
        assert.ok(Math.abs(st.slip[i] - want) < 1e-9, `s = ${s}, wheel ${i}: slip ${st.slip[i]} vs ${want}`);
      });
      assert.equal(st.rimShare, undefined, 'there is no second row to choose between');
    }
  }
});

/* Kinetic energy of the chassis and the four wheels, J. The wheel inertia is the whole turning
   inertia the dynamics carries per wheel (wheel, gearbox and rotor reflected), DYN_DEFAULTS.wheelInertia. */
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
const STARTS = [['sliding sideways at 1 m/s', { x: 0, y: 1 }, 0], ['sliding forward at 1.5 m/s', { x: 1.5, y: 0 }, 0], ['sliding along a diagonal', { x: 1, y: -1 }, 0],
  ['sliding and spinning', { x: 0.5, y: 1 }, 2]];

test('mecanum: with the motors off and no rolling or viscous loss, the rollers never add energy on any step', () => {
  for (const mode of ['FLOAT', 'BRAKE']) for (const [label, v, w] of STARTS) for (const s of SHARES) for (const wheels of ['still', 'rolling with the ground']) {
    const R = rig(Object.assign({ strafeEff: s }, NO_LOSS));
    const st = E.Dyn.reset(R); st.v = v; st.omega = w;
    if (wheels !== 'still') {
      const rows = E.Dyn.rimRows(R);
      st.wheelOmega = rows.map((r, i) => (r[0] * v.x + r[1] * v.y + r[2] * w) / R.drive.wheels[i].r);
    }
    const { es } = coast(R, st, mode, 300);
    for (let k = 1; k < es.length; k++)
      assert.ok(es[k] <= es[k - 1] + 1e-9, `${mode}, ${label}, wheels ${wheels}, s = ${s}: ${es[k - 1].toFixed(4)} J -> ${es[k].toFixed(4)} J at step ${k}`);
  }
});

test('mecanum: a powered strafe tops out at s of forward speed, and the encoders over-read it by 1/s', () => {
  // with the default rolling and viscous drag (which load a slow strafe's motors a little less than
  // forward's, so a low share strafes a hair faster than s), and with them off, where it is exact
  for (const [losses, shares] of [[{}, [0.85, 0.95, 1]], [NO_LOSS, [0.3, 0.6, 0.85, 1]]]) for (const s of shares) {
    const R = rig(Object.assign({ strafeEff: s }, losses));
    const vf = last(drive(R, FWD, 3)).vx, sl = last(drive(R, LEFT, 4));
    assert.ok(Math.abs(sl.vy / vf / s - 1) < 0.01, `s = ${s}${losses === NO_LOSS ? ', no drag' : ''}: strafe ${(sl.vy / vf).toFixed(4)} of forward`);
    const over = sl.enc / sl.y;
    assert.ok(Math.abs(over * s - 1) < 0.02, `s = ${s}: encoders read ${over.toFixed(4)} x the strafe, 1/s = ${(1 / s).toFixed(4)}`);
  }
});

/* Full power for 2 s, then `lo` of it: how long until the speed is within 2% of where it settles,
   and on how many steps a loaded wheel of a robot still moving carries no force at all. */
function easeOff(R, dir, lo, axis) {
  let st = E.Dyn.reset(R);
  for (let k = 0; k < 100; k++) st = E.Dyn.step(st, dir, R, 0.02);
  const v0 = st.v[axis], tr = [];
  let idle = 0;
  for (let k = 0; k < 300; k++) {
    st = E.Dyn.step(st, dir.map(c => c * lo), R, 0.02);
    tr.push(st.v[axis]);
    if (Math.hypot(st.v.x, st.v.y) > 1e-3) st.force.forEach((F, i) => { if (st.loads[i] > 0 && F === 0) idle++; });
  }
  const vEnd = tr[tr.length - 1];
  return { t: (tr.findIndex(v => Math.abs(v - vEnd) <= 0.02 * Math.abs(v0 - vEnd)) + 1) * 0.02, idle, vEnd };
}

test('mecanum: a strafe eased from full to half power settles about as fast as forward, every wheel gripping all the way', () => {
  for (const s of [0.6, 0.85, 1]) for (const lo of [0.5, 0.8]) {
    const R = rig12({ strafeEff: s });
    const f = easeOff(R, FWD, lo, 'x'), st = easeOff(R, LEFT, lo, 'y');
    assert.ok(st.t <= 1.3 * f.t, `s = ${s}, full -> ${lo}: strafe settles in ${st.t.toFixed(2)} s, forward in ${f.t.toFixed(2)} s`);
    assert.equal(st.idle, 0, `s = ${s}, full -> ${lo}: ${st.idle} wheel-steps with no force while the robot slid`);
  }
});

test('mecanum: a P-controlled strafe to 1 m overshoots no more than 1.3 times the same controller driving forward', () => {
  const go = (R, dir, axis, kP) => {
    let st = E.Dyn.reset(R), p = 0, peak = 0;
    for (let k = 0; k < 300; k++) {
      const u = Math.max(-1, Math.min(1, kP * (1 - p)));
      st = E.Dyn.step(st, dir.map(c => c * u), R, 0.02);
      p += st.v[axis] * 0.02; peak = Math.max(peak, p);
    }
    return { over: Math.max(0, peak - 1), end: p };
  };
  for (const kP of [1.5, 3, 6]) for (const s of [0.6, 0.85, 1]) {
    const R = rig12({ strafeEff: s });
    const f = go(R, FWD, 'x', kP), st = go(R, LEFT, 'y', kP);
    assert.ok(st.over <= 1.3 * f.over + 1e-4, `kP ${kP}, s = ${s}: strafe overshoots ${(st.over * 1000).toFixed(1)} mm, forward ${(f.over * 1000).toFixed(1)} mm`);
    assert.ok(Math.abs(st.end - 1) < 0.02, `kP ${kP}, s = ${s}: strafe ends at ${st.end.toFixed(3)} m`);
  }
});

test('mecanum: no launch puts more than mu N along the effective roller axis, and a full-power launch reaches it', () => {
  for (const s of [0.3, 0.6, 0.85, 1]) for (const [label, cmd] of [['strafe', LEFT], ['forward', FWD], ['turn', [-1, 1, -1, 1]], ['diagonal', [1, 0, 0, 1]]]) {
    const R = rig({ strafeEff: s }), mu = E.Dyn.defaults.mu;
    const rows = E.Dyn.rimRows(R);
    let st = E.Dyn.reset(R), peak = 0;
    for (let k = 0; k < 50; k++) {
      st = E.Dyn.step(st, cmd, R, 0.02);
      st.force.forEach((F, i) => {
        const ground = Math.abs(F) * Math.hypot(rows[i][0], rows[i][1]);
        assert.ok(ground <= mu * st.loads[i] * (1 + 1e-9), `${label}, s = ${s}, step ${k}, wheel ${i}: ${ground.toFixed(3)} N along the roller, mu N = ${(mu * st.loads[i]).toFixed(3)}`);
        peak = Math.max(peak, ground / (mu * st.loads[i]));
      });
    }
    if (label === 'strafe' || label === 'forward') assert.ok(peak > 0.999, `${label}, s = ${s}: the launch uses ${peak.toFixed(3)} of the grip`);
  }
});

test('mecanum: forward driving keeps its speed at every roller share, and other bases never see it', () => {
  // inside the grip a forward launch is the same at every share, s = 1 being the ideal rollers the
  // sim had before the strafe loss: to the solver's convergence at the default 6 sweeps, to rounding
  // at 32 (the rows' sideways parts cancel between the wheels)
  for (const [s, sweeps] of [[0.3, 32], [0.6, 32], [0.85, 32], [0.85, undefined], [0.95, undefined]]) {
    const tol = sweeps ? 1e-12 : 1e-6;
    const c = 0.2, cmd = [c, c, c, c];
    const R = rig({ strafeEff: s, sweeps });
    const a = drive(R, cmd, 2), b = drive(rig({ strafeEff: 1, sweeps }), cmd, 2);
    const rows = E.Dyn.rimRows(R);
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a[i].vx - b[i].vx) <= tol && Math.abs(a[i].vy - b[i].vy) <= tol, `s = ${s}, sweeps ${sweeps || 6}: ${a[i].vx} vs ${b[i].vx} at ${a[i].t} s`);
      assert.ok(Math.abs(a[i].st.omega - b[i].st.omega) <= tol, `s = ${s}: turning ${a[i].st.omega}`);
      a[i].st.force.forEach((F, j) => assert.ok(Math.abs(F) * Math.hypot(rows[j][0], rows[j][1]) < E.Dyn.defaults.mu * a[i].st.loads[j], 'inside the grip'));
    }
  }
  // at full power the top speed is the same at every share
  const top = last(drive(rig({ strafeEff: 1 }), FWD, 3)).vx;
  for (const s of [0.3, 0.6, 0.85]) {
    const v = last(drive(rig({ strafeEff: s }), FWD, 3)).vx;
    assert.ok(Math.abs(v - top) < 1e-6, `s = ${s}: forward top speed ${v} vs ${top}`);
  }
  // at s = 1 the rows are the ideal mecanum rows the kinematics uses
  const R1 = rig({ strafeEff: 1 }), ik = E.ikMatrix('mecanum', R1.drive.wheels);
  assert.deepEqual(E.Dyn.rimRows(R1), ik);
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

test('mecanum: a strafe cut from full to half power slows smoothly to the half-power speed', () => {
  const R = rig(), HALF = LEFT.map(c => c / 2);
  const fromRest = last(drive(R, HALF, 8)).vy;
  let st = E.Dyn.reset(R);
  const vs = [];
  for (let k = 0; k < 550; k++) { st = E.Dyn.step(st, k < 150 ? LEFT : HALF, R, 0.02); vs.push(st.v.y); }
  for (let k = 151; k < vs.length; k++) assert.ok(vs[k] <= vs[k - 1] + 1e-9, `the strafe sped up again at ${((k + 1) * 0.02).toFixed(2)} s: ${vs[k - 1]} -> ${vs[k]}`);
  assert.ok(Math.abs(vs[vs.length - 1] - fromRest) < 1e-4, `settles at ${vs[vs.length - 1].toFixed(4)} m/s, a half-power strafe from rest at ${fromRest.toFixed(4)}`);
});

test('sim: a wall that stops a full-speed strafe stops the wheels with it, through the rows the dynamics turns them with', () => {
  for (const s of [0.6, 0.85, 1]) {
    const R = rig({ strafeEff: s });
    let st = E.Dyn.reset(R);
    for (let k = 0; k < 150; k++) st = E.Dyn.step(st, LEFT, R, 0.02);
    const before = st.wheelOmega.map(o => Math.abs(o * R.drive.wheels[0].r));
    // Sim.stopAgainst on a bare sim: robot facing +x, a wall on its left pushed it back by 1 cm
    const sim = { dstate: st, rig: R, chassis: { x: 0, y: 0, h: 0 } };
    E.Sim.stopAgainst.call(sim, 0, -0.01);
    assert.equal(sim.dstate.v.y, 0);
    const rim = sim.dstate.wheelOmega.map(o => Math.abs(o * R.drive.wheels[0].r));
    // a pure strafe has no forward part, so every rim is left (almost) still: what is left is the tyres' own slip
    for (let i = 0; i < 4; i++) assert.ok(rim[i] < 0.03 * before[i], `s = ${s}: wheel ${i} still turns at ${rim[i].toFixed(3)} m/s after the wall (was ${before[i].toFixed(3)})`);
    // power off (FLOAT): the robot sits against the wall
    let y = 0, st2 = sim.dstate;
    for (let k = 0; k < 25; k++) { st2 = E.Dyn.step(st2, [0, 0, 0, 0], R, 0.02, [true, true, true, true]); y += st2.v.y * 0.02; }
    assert.ok(Math.abs(y) < 1e-4, `s = ${s}: crept ${(y * 1000).toFixed(2)} mm along after the wall`);
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

test('calibrate: a mecanum fit made before roller slip hands the sim neither its turn drag nor its strafe loss, and says to fit it again', () => {
  // the fit origin/main made for a robot measured at 0.95 forward, 0.8 strafe and 0.8 turn of its default
  // (12 kg, 96 mm wheels, 312 rpm): its turn drag was fitted to a mecanum base that turned without slip
  const old = { params: { gear: 1.0611821667187353, strafeEff: 0.32447282207827155, yawViscous: 0.9508904363609516 },
    measured: { fwd: 1.3433, strafe: 1.0869, turn: 197.547 } };
  const c = E.calCheck(old);
  assert.deepEqual(c.opts, { gear: old.params.gear }, 'only the gearing, which sets the forward speed, still holds');
  assert.deepEqual(c.dropped.sort(), ['strafeEff', 'yawViscous']);
  assert.match(c.refit, /fit/i);
  assert.deepEqual(E.calOpts(old), c.opts);
  // the drive kind decides when it is known: a tank's turn drag holds, a mecanum fit without a strafe does not
  assert.deepEqual(E.calCheck(old, 'tank').opts, { gear: old.params.gear, yawViscous: old.params.yawViscous });
  assert.equal(E.calCheck(old, 'tank').refit, null);
  const turnOnly = { params: { yawViscous: 0.9 }, measured: { turn: 197 } };
  assert.deepEqual(E.calCheck(turnOnly).opts, { yawViscous: 0.9 }, 'no kind and nothing strafed: nothing says it was mecanum');
  assert.equal(E.calCheck(turnOnly, 'mecanum').opts, null);
  assert.match(E.calCheck(turnOnly, 'mecanum').refit, /turn drag/);
  assert.match(E.calCheck(Object.assign({ kind: 'mecanum' }, turnOnly)).refit, /turn drag/, 'the kind a fit saved counts too');
  // a fit made now carries the model it was made against, whatever it fitted, and is handed over whole
  const R = rig({}, false), truth = E.calMeasure(rig({ yawViscous: 0.6 }));
  const fit = E.calFit(R, { turn: truth.turn });
  assert.equal(fit.params.strafeModel, 2);
  assert.equal(fit.kind, 'mecanum');
  assert.deepEqual(E.calOpts({ params: fit.params }, 'mecanum'), { yawViscous: fit.params.yawViscous });
  assert.equal(E.calCheck({ params: fit.params }, 'mecanum').refit, null);
  const turn = E.calMeasure(E.calApplyToRig(R, E.calOpts({ params: fit.params }, 'mecanum'))).turn;
  assert.ok(Math.abs(turn / truth.turn - 1) < 0.01, `the refit robot turns at ${turn.toFixed(1)} deg/s, measured ${truth.turn.toFixed(1)}`);
});

test('calibrate: the Tune panel says what the sim really takes from a fit, and that the strafe is measured with a tape', () => {
  const old = { params: { gear: 1.0612, strafeEff: 0.3245, yawViscous: 0.9509 }, measured: { fwd: 1.3433, strafe: 1.0869, turn: 197.547 } };
  const a = E.calApplied(old);
  assert.deepEqual(a.bits, ['gearing 1.06 motor turns per wheel turn'], 'nothing it no longer applies');
  assert.match(a.refit, /fit the sim again/i);
  const now = E.calApplied({ params: { gear: 1.0612, strafeEff: 0.8, yawViscous: 0.45, strafeModel: 2 } }, 'mecanum');
  assert.deepEqual(now.bits, ['gearing 1.06 motor turns per wheel turn', 'strafe efficiency 0.80', 'turn drag 0.45 N·m per rad/s']);
  assert.equal(now.refit, null);
  // the panel (src/mcui.js) builds its text and its pill from calApplied, never from the saved params
  const ui = fs.readFileSync(new URL('../src/mcui.js', import.meta.url), 'utf8');
  assert.match(ui, /calApplied\(c,this\.kind\(\)\)/);
  assert.doesNotMatch(ui, /p\.strafeEff/);
  // the strafe box asks for a tape measure, as the measuring OpMode does
  const html = fs.readFileSync(new URL('../src/markup.html', import.meta.url), 'utf8');
  const sec = html.slice(html.indexOf('data-sec="calib"'), html.indexOf('data-sec="mc"'));
  assert.match(sec, /strafe with a tape measure, not the encoders/);
  assert.match(sec, /id="calStrafe"[^\n]*tape measure/);
  assert.match(E.calJava(), /measure how far it went sideways with the tape/);
});

test('calibrate: a strafeEff fitted when it was a force loss is not handed to the sim', () => {
  assert.equal(E.calOpts({ params: { strafeEff: 0.35 } }), null);
  assert.deepEqual(E.calOpts({ params: { gear: 1.2, strafeEff: 0.35 } }), { gear: 1.2 });
  assert.deepEqual(E.calOpts({ params: { strafeEff: 0.82, strafeModel: 2 } }), { strafeEff: 0.82 });
});
