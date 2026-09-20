// Rigid-body chassis: motor curves, wheel loads, traction limits, and the
// simulator actually driving on them. Numbers are hand-computed where the
// model is simple enough to do by hand, and pinned by invariants where it
// isn't (double the mass, halve the acceleration).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField, sampleBench, run } from './load.mjs';

const E = loadEngine();
const G = 9.80665;

/* A four-wheel rig: 0.40 x 0.36 m, wheels at the corners. */
function rig(opts = {}) {
  const L = opts.L || 0.40, W = opts.W || 0.36, r = opts.r || 0.048;
  const kind = opts.kind || 'tank';
  const corners = [['FL', L / 2, W / 2, 1], ['FR', L / 2, -W / 2, -1], ['BL', -L / 2, W / 2, -1], ['BR', -L / 2, -W / 2, 1]];
  const spec = { rpm: opts.rpm || 312, stallNm: opts.stallNm || 0.6 };
  return {
    props: {
      kg: opts.kg || 15, com: { x: opts.comX || 0, y: 0, z: opts.comZ || 0.12 },
      I: { xx: 0.3, yy: 0.3, zz: opts.Izz || 0.45 }, Izz: opts.Izz || 0.45, comHeight: opts.comZ || 0.12,
    },
    drive: { kind, wheels: corners.map(([corner, x, y, roll]) => ({ corner, x, y, z: 0, r, roller: kind === 'mecanum' ? roll : 0 })) },
    motors: [spec, spec, spec, spec],
    devs: ['lf', 'rf', 'lb', 'rb'],
    gear: 1,
    mu: opts.mu == null ? 1.2 : opts.mu,
  };
}
/* Drive a rig for `secs` at a fixed command and report what it did. */
function drive(R, cmd, secs, dt = 0.02) {
  let st = E.Dyn.reset(R);
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) st = E.Dyn.step(st, cmd, R, dt);
  return st;
}
const fwd = [1, 1, 1, 1];

test('motorTorque: the DC line, at the output shaft, both directions', () => {
  const spec = { rpm: 312, stallNm: 2.4 };                 // goBILDA 5203 19.2:1
  const wFree = 312 * Math.PI / 30;
  assert.ok(Math.abs(E.motorTorque(spec, 0, 1) - 2.4) < 1e-12, 'stalled at full command is stall torque');
  assert.ok(Math.abs(E.motorTorque(spec, wFree, 1)) < 1e-12, 'no torque at free speed');
  assert.ok(Math.abs(E.motorTorque(spec, wFree / 2, 1) - 1.2) < 1e-9, 'half free speed, half torque');
  assert.ok(Math.abs(E.motorTorque(spec, 0, -1) + 2.4) < 1e-12, 'reverse is symmetric');
  assert.ok(Math.abs(E.motorTorque(spec, wFree, 0) + 2.4) < 1e-9, 'a shaft driven past its command brakes');
  assert.equal(E.motorTorque(spec, -wFree, 1), 2.4, 'clipped at stall, not twice stall');
  assert.equal(E.motorTorque({ rpm: 0, stallNm: 0 }, 0, 1), 0, 'a motor with no spec makes no torque');
  const limited = E.motorTorque(spec, 0, 1, { currentLimit: 5, stallAmps: 9.2, freeAmps: 0.3 });
  assert.ok(limited > 0 && limited < 2.4, `a current limit caps the torque: ${limited}`);
});

test('wheelLoads: the weight always adds up, and braking moves it forward', () => {
  const R = rig();
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const still = E.wheelLoads(R.props, { x: 0, y: 0 }, R.drive.wheels);
  assert.ok(Math.abs(sum(still) - 15 * G) < 1e-9, `static total ${sum(still)} vs ${15 * G}`);
  for (const n of still) assert.ok(Math.abs(n - 15 * G / 4) < 1e-6, 'a centred COM shares it evenly');

  const braking = E.wheelLoads(R.props, { x: -4, y: 0 }, R.drive.wheels);
  assert.ok(Math.abs(sum(braking) - 15 * G) < 1e-9, 'load transfer never invents weight');
  const front = braking[0] + braking[1], back = braking[2] + braking[3];
  assert.ok(front > back * 1.2, `braking loads the front: ${front.toFixed(1)} vs ${back.toFixed(1)} N`);
  // m*a*h/L per axle: 15*4*0.12/0.40 = 18 N moved, so front gains 18, back loses 18
  assert.ok(Math.abs((front - back) / 2 - 15 * 4 * 0.12 / 0.40) < 0.5, `transfer ${(front - back) / 2} N`);

  const flipping = E.wheelLoads({ ...R.props, comHeight: 0.6, com: { x: 0, y: 0, z: 0.6 } }, { x: -9, y: 0 }, R.drive.wheels);
  assert.ok(Math.min(...flipping) >= 0, 'a lifted wheel carries nothing, never negative');
  assert.ok(Math.abs(sum(flipping) - 15 * G) < 1e-9, 'and the rest take the slack');
});

test('traction: the tile sets the limit, in proportion to load and grip', () => {
  const a = E.tractionLimit(40, 0.9, 'tank', 0), b = E.tractionLimit(80, 0.9, 'tank', 0);
  assert.ok(Math.abs(b - 2 * a) < 1e-9, 'twice the load, twice the grip');
  assert.ok(Math.abs(E.tractionLimit(40, 1.8, 'tank', 0) - 2 * a) < 1e-9, 'twice the mu, twice the grip');
  assert.equal(E.tractionLimit(0, 0.9, 'tank', 0), 0, 'a lifted wheel pushes on nothing');
  assert.ok(E.tractionLimit(40, 0.9, 'tank', 0) > 0);
});

test('straight line: acceleration is torque-limited and follows F = ma', () => {
  // By hand, with grip to spare so the motors are what limits it:
  //   F(v) = 4 * 0.6 N.m * 0.9 / 0.048 m * (1 - v/1.568) = 45 (1 - v/1.568) N
  //   effective mass = 15 kg + 4J/r^2 = 15.8 kg
  //   drag = rolling 0.015*15*9.81 = 2.21 N, plus viscous 1.2 v
  //   terminal v = 42.79/29.9 = 1.43 m/s, time constant 15.8/29.9 = 0.528 s
  //   v(0.5 s) = 1.43 (1 - e^-0.947) = 0.877 m/s
  const R = rig({ kg: 15, stallNm: 0.6, mu: 1.2 });
  const v1 = drive(R, fwd, 0.5).v.x;
  assert.ok(Math.abs(v1 - 0.877) < 0.09, `half a second of full power gives ${v1.toFixed(3)} m/s, hand calc says 0.877`);
  // the invariant that cannot lie: twice the mass, half the acceleration
  const heavy = drive(rig({ kg: 30, stallNm: 0.6, mu: 1.2 }), fwd, 0.5).v.x;
  assert.ok(Math.abs(heavy - v1 / 2) < 0.12, `15 kg: ${v1.toFixed(2)}, 30 kg: ${heavy.toFixed(2)} m/s`);
  assert.ok(Math.abs(drive(R, [-1, -1, -1, -1], 0.5).v.x + 0.877) < 0.09, 'and it goes backwards the same way');
});

test('traction: on a slippery floor the tiles set the acceleration, not the motors', () => {
  const grippy = drive(rig({ stallNm: 2.4, mu: 1.2 }), fwd, 0.4).v.x;
  const slick = drive(rig({ stallNm: 2.4, mu: 0.05 }), fwd, 0.4).v.x;
  assert.ok(slick < grippy * 0.35, `mu 0.05 gives ${slick.toFixed(2)} m/s vs ${grippy.toFixed(2)} on mu 1.2`);
  // mu*g = 0.49 m/s^2, less rolling resistance; over 0.4 s that is ~0.14 m/s
  assert.ok(slick > 0.04 && slick < 0.49 * 0.4 * 1.1, `slippery run reached ${slick.toFixed(3)} m/s`);
  const st = drive(rig({ stallNm: 2.4, mu: 0.05 }), fwd, 0.4);
  assert.ok(Math.max(...st.slip.map(Math.abs)) > 0.1, 'and the wheels are reported as slipping');
});

test('top speed: it converges near free speed x radius and stays there', () => {
  const R = rig({ stallNm: 2.4, mu: 1.2 });               // 312 rpm, 0.048 m -> 1.57 m/s
  const v4 = drive(R, fwd, 4).v.x, v8 = drive(R, fwd, 8).v.x;
  assert.ok(v8 > 1.2 && v8 < 1.57, `settles at ${v8.toFixed(2)} m/s, below the 1.57 free speed`);
  assert.ok(Math.abs(v8 - v4) < 0.05, 'and it has stopped climbing');
});

test('turning: yaw acceleration is the torque divided by the yaw inertia', () => {
  const spin = [1, -1, 1, -1];                            // left forward, right back
  const a = drive(rig({ Izz: 0.45, stallNm: 0.6 }), spin, 0.3);
  const b = drive(rig({ Izz: 0.90, stallNm: 0.6 }), spin, 0.3);
  assert.ok(Math.abs(a.omega) > 0.5, `it turns: ${a.omega.toFixed(2)} rad/s`);
  assert.ok(Math.abs(b.omega - a.omega / 2) < Math.abs(a.omega) * 0.15,
    `twice the inertia, half the yaw rate: ${a.omega.toFixed(2)} -> ${b.omega.toFixed(2)}`);
  assert.ok(Math.abs(a.v.x) < 0.05 && Math.abs(a.v.y) < 0.05, 'a spin in place goes nowhere');
});

test('mecanum: strafing is real, and slower than driving forward', () => {
  const R = rig({ kind: 'mecanum', stallNm: 0.6 });
  const f = drive(R, fwd, 0.6);
  const s = drive(R, [1, -1, -1, 1], 0.6);                // the strafe pattern
  assert.ok(Math.abs(s.v.y) > 0.3, `it strafes: ${s.v.y.toFixed(2)} m/s`);
  assert.ok(Math.abs(s.v.x) < 0.1, 'and barely creeps forward while doing it');
  assert.ok(Math.abs(s.v.y) < Math.abs(f.v.x) * 0.9,
    `strafe ${Math.abs(s.v.y).toFixed(2)} vs forward ${f.v.x.toFixed(2)} m/s`);
});

test('nothing explodes: no command, no mass, no wheels, silly dt', () => {
  const R = rig();
  const idle = drive(R, [0, 0, 0, 0], 2);
  assert.ok(Math.abs(idle.v.x) < 1e-6 && Math.abs(idle.omega) < 1e-6, 'a parked robot stays parked');
  let st = E.Dyn.reset(R);
  for (let i = 0; i < 250; i++) st = E.Dyn.step(st, [1, -0.4, 0.7, -1], R, 0.02);
  for (const v of [st.v.x, st.v.y, st.omega, ...st.wheelOmega, ...st.slip]) assert.ok(Number.isFinite(v), 'five seconds, still finite');
  const dead = { ...R, props: { ...R.props, kg: 0 } };
  assert.equal(E.Dyn.step(E.Dyn.reset(dead), fwd, dead, 0.02).v.x, 0, 'no mass, no motion');
  const bare = { props: R.props, drive: { kind: 'tank', wheels: [] }, motors: [] };
  assert.deepEqual(E.Dyn.step(E.Dyn.reset(bare), [], bare, 0.02).v, { x: 0, y: 0 }, 'no wheels, no motion');
  for (const dt of [0, -1, NaN, 5]) {
    const out = E.Dyn.step(E.Dyn.reset(R), fwd, R, dt);
    for (const v of [out.v.x, out.v.y, out.omega]) assert.ok(Number.isFinite(v), `dt ${dt}`);
  }
});

/* ---- the simulator on top of it ---- */

test('the bench drives on the physics: it accelerates, it does not teleport', () => {
  const Ef = loadWithField();
  const b = sampleBench(Ef, Ef.DRIVE_JAVA);
  b.opts.physics = 'rigid';
  b.opts.startPose = Ef.Field.startPose('red', Ef.footprintOf(b.cad, '+x'));
  Ef.Sim.reset(b.code, b.cad, b.map, b.opts);
  assert.ok(Ef.Sim.rig, 'a rig was built for a CAD with no wheels of its own');
  assert.equal(Ef.Sim.rig.devs.length, 4);
  assert.ok(Ef.Sim.rig.props.kg > 0.5, `rig mass ${Ef.Sim.rig.props.kg}`);

  const x0 = Ef.Sim.chassis.x;
  Ef.Sim.pad[1].left_stick_y = -1;
  run(Ef, 0.1);
  const early = Ef.Sim.chassis.x - x0;
  run(Ef, 0.9);
  const late = Ef.Sim.chassis.x - x0;
  assert.ok(early < late / 4, `it builds speed instead of jumping: ${early.toFixed(3)} m then ${late.toFixed(3)} m`);
  assert.ok(late > 0.15 && late < 1.6, `one second of full stick covers ${late.toFixed(2)} m`);

  Ef.Sim.pad[1].left_stick_y = 0;
  run(Ef, 2.5);
  const stopped = Ef.Sim.chassis.x;
  run(Ef, 1);
  assert.ok(Math.abs(Ef.Sim.chassis.x - stopped) < 0.02, 'and it comes to rest when you let go');
});

test('hitting the HIVE stops the robot — it never bounces back off it', () => {
  const Ef = loadWithField();
  const b = sampleBench(Ef, Ef.DRIVE_JAVA);
  b.opts.physics = 'rigid';
  b.opts.startPose = Ef.Field.startPose('red', Ef.footprintOf(b.cad, '+x'));
  Ef.Sim.reset(b.code, b.cad, b.map, b.opts);
  Ef.Sim.pad[1].left_stick_y = -1;                      // held down the whole way in
  let worst = 0, prev = Ef.Sim.chassis.x;
  for (let i = 0; i < 250; i++) {
    Ef.Sim.tick(0.02);
    worst = Math.min(worst, Ef.Sim.chassis.x - prev);   // the biggest backwards step
    prev = Ef.Sim.chassis.x;
  }
  assert.equal(Ef.Sim.bump, 'HIVE foot bar');
  // the collision push-out used to come back as velocity: the robot hit the
  // bar at 1 m/s and was thrown back a tenth of a metre
  assert.ok(worst > -0.004, `largest backwards step ${(worst * 1000).toFixed(1)} mm — it rebounded off the wall`);
});

test('the physics still respects the field, and kinematic mode still works', () => {
  const Ef = loadWithField();
  const b = sampleBench(Ef, Ef.DRIVE_JAVA);
  b.opts.physics = 'rigid';
  b.opts.startPose = Ef.Field.startPose('red', Ef.footprintOf(b.cad, '+x'));
  Ef.Sim.reset(b.code, b.cad, b.map, b.opts);
  Ef.Sim.pad[1].left_stick_y = -1;
  run(Ef, 6);
  const c = Ef.Sim.chassis, fp = Ef.Sim.footprint;
  assert.ok((c.x + fp.hx) / Ef.IN <= -24 + 0.8, `stopped against the HIVE at ${((c.x + fp.hx) / Ef.IN).toFixed(1)} in`);
  assert.equal(Ef.Sim.bump, 'HIVE foot bar');
  assert.ok(Math.abs(Ef.Sim.dstate.v.x) < 0.25, 'and the wall took its speed away');

  // kinematic mode is the old behaviour: the only thing between the stick and
  // full speed is the motor slew, so over the first fifth of a second it covers
  // far more ground than a robot that has to accelerate its own mass.
  const from = (physics) => {
    b.opts.physics = physics;
    Ef.Sim.reset(b.code, b.cad, b.map, b.opts);
    Ef.Sim.pad[1].left_stick_y = -1;
    run(Ef, 0.2);
    Ef.Sim.pad[1].left_stick_y = 0;
    return Ef.Sim.chassis.x - b.opts.startPose.x;
  };
  const glide = from('kinematic'), real = from('rigid');
  assert.ok(glide > 0.12 && glide < 0.24, `0.2 s of kinematic glide covers ${glide.toFixed(3)} m`);
  assert.ok(glide > real * 1.4, `kinematic ${glide.toFixed(3)} m vs rigid ${real.toFixed(3)} m in the same 0.2 s`);
});
