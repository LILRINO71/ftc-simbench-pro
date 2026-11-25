// src/calibrate.js: fitting the sim's drive parameters to a few measured numbers. The fit is pure,
// so the tests here make up a "real robot" from known parameters, measure it the way the team would
// (full power for 2 s from rest), and ask the fit to find numbers that reproduce what it measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, sampleBench } from './load.mjs';

const E = loadEngine();

/* Wheels FL, FR, BL, BR in the standard X, GoBILDA 5203 312 rpm motors (537.7 ticks) on 96 mm wheels. */
function mecRig(opts = {}) {
  const L = 0.40, W = 0.36;
  const corners = [['FL', L / 2, W / 2, 1], ['FR', L / 2, -W / 2, -1], ['BL', -L / 2, W / 2, -1], ['BR', -L / 2, -W / 2, 1]];
  const spec = { rpm: 312, stallNm: 2.38, tpr: 537.7 };
  const R = {
    props: { kg: opts.kg || 11, com: { x: 0, y: 0, z: 0.1 }, Izz: 0.4, I: { xx: 0.3, yy: 0.35, zz: 0.4 }, comHeight: 0.1 },
    drive: { kind: opts.kind || 'mecanum', wheels: corners.map(([corner, x, y, roller]) => ({ corner, x, y, z: 0, r: 0.048, roller })) },
    motors: [spec, spec, spec, spec], gear: 1, mu: 0.9,
  };
  R.drive.ik = E.ikMatrix(R.drive.kind, R.drive.wheels);
  return R;
}
const near = (a, b, pct, what) => assert.ok(Math.abs(a - b) <= Math.abs(b) * pct / 100, `${what}: ${a} vs ${b} (${pct} %)`);

test('calibrate: the sim measures itself the way the team does, and the numbers are those of a real mecanum base', () => {
  const m = E.calMeasure(mecRig());
  assert.ok(m.fwd > 0.8 && m.fwd < 1.6, 'forward ' + m.fwd + ' m/s');
  assert.ok(m.strafe > 0.3 && m.strafe <= m.fwd * 1.05, 'strafe ' + m.strafe);
  assert.ok(m.turn > 100 && m.turn < 330, 'turn ' + m.turn + ' deg/s');
  assert.equal(m.massKg, 11);
  // 537.7 ticks over a 96 mm wheel's rim
  near(m.ticksPerIn, 537.7 / (2 * Math.PI * 0.048) * 0.0254, 0.01, 'ticks per inch');
});

test('calibrate: numbers measured on a robot with other parameters are reproduced by the fit within 1 %', () => {
  const base = mecRig();
  // a robot that is slower, heavier, strafes badly and turns with scrub
  const truth = E.calApplyToRig(base, { massKg: 13.5, gear: 1.32, strafeEff: 0.31, yawViscous: 1.4 });
  const m = E.calMeasure(truth);
  const fit = E.calFit(base, { fwd: m.fwd, strafe: m.strafe, turn: m.turn, massKg: 13.5 });
  assert.ok(fit.ok, JSON.stringify(fit.rows));
  for (const r of fit.rows) assert.ok(Math.abs(r.errAfter) < 1, r.label + ' ' + r.errAfter.toFixed(2) + ' % off');
  // the fitted rig, built from the fitted parameters alone, measures the same
  const again = E.calMeasure(E.calApplyToRig(base, fit.params));
  near(again.fwd, m.fwd, 1, 'forward'); near(again.strafe, m.strafe, 1, 'strafe'); near(again.turn, m.turn, 1, 'turn');
  assert.equal(again.massKg, 13.5);
  // what it changed is in the table: before is the uncalibrated sim, after is the fit
  const fwd = fit.rows.find((r) => r.key === 'fwd');
  assert.ok(Math.abs(fwd.errBefore) > 10 && Math.abs(fwd.errAfter) < 1);
  near(fwd.before, E.calMeasure(base).fwd, 0.01, 'before');
});

test('calibrate: robots across a range of speeds and weights all fit', () => {
  const base = mecRig();
  for (const [kg, gear, eff, yaw] of [[8, 0.9, 0.5, 0.2], [15, 1.6, 0.2, 3], [10, 1.1, 0.8, 0.08], [17, 2.2, 0.4, 6]]) {
    const m = E.calMeasure(E.calApplyToRig(base, { massKg: kg, gear, strafeEff: eff, yawViscous: yaw }));
    const fit = E.calFit(base, { fwd: m.fwd, strafe: m.strafe, turn: m.turn, massKg: kg });
    for (const r of fit.rows) assert.ok(Math.abs(r.errAfter) < 2, `${kg} kg: ${r.label} ${r.errAfter.toFixed(2)} % off`);
  }
});

test('calibrate: with encoder ticks per inch the gearing comes from the encoders and drag takes the speed down', () => {
  const base = mecRig();
  const truth = E.calApplyToRig(base, { gear: 1.15, viscous: 30 });
  const m = E.calMeasure(truth);
  const fit = E.calFit(base, { fwd: m.fwd, ticksPerIn: m.ticksPerIn });
  const ticks = fit.rows.find((r) => r.key === 'ticks');
  assert.ok(Math.abs(ticks.errAfter) < 0.5, 'encoders ' + ticks.errAfter);
  near(fit.params.gear, 1.15, 0.5, 'gearing');
  assert.ok(fit.params.viscous > 5, 'drag ' + fit.params.viscous);
  assert.ok(Math.abs(fit.rows.find((r) => r.key === 'fwd').errAfter) < 1.5);
  // the same speed without the encoders is matched with gearing alone, leaving drag at its default
  const alone = E.calFit(base, { fwd: m.fwd });
  assert.ok(alone.params.gear > 0 && alone.params.viscous === undefined);
  assert.ok(Math.abs(alone.rows[0].errAfter) < 1);
});

test('calibrate: what the model cannot reach is left alone and said so', () => {
  const base = mecRig();
  // a turn rate above what the wheels can spin the robot at, and a speed no gearing in range gives
  const fit = E.calFit(base, { turn: 900, fwd: 40 });
  assert.equal(fit.ok, false);
  assert.ok(fit.notes.some((n) => /turn/i.test(n)) && fit.notes.some((n) => /forward/i.test(n)), fit.notes.join(' | '));
  for (const k of Object.keys(fit.params)) assert.ok(Number.isFinite(fit.params[k]) && fit.params[k] > 0, k);
  assert.ok(fit.params.gear >= E.CAL_BOUNDS.gear[0] && fit.params.gear <= E.CAL_BOUNDS.gear[1]);
  // a tank cannot strafe: that row is dropped, with a note, and the rest still fits
  const tank = mecRig({ kind: 'tank' });
  const t = E.calFit(tank, { fwd: 1.0, strafe: 0.8 });
  assert.ok(!t.rows.some((r) => r.key === 'strafe') && t.notes.some((n) => /strafe/.test(n)));
  assert.ok(Math.abs(t.rows[0].errAfter) < 1);
});

test('calibrate: the fit is pure and ignores junk', () => {
  const base = mecRig(), snap = JSON.stringify(base);
  E.calFit(base, { fwd: 1.0, strafe: 0.7, turn: 150, massKg: 9 });
  assert.equal(JSON.stringify(base), snap, 'the rig it was given is untouched');
  assert.deepEqual(E.calSanitize({ fwd: -1, strafe: 'x', turn: NaN, massKg: '10.5', ticksPerIn: 0 }), { fwd: 0, strafe: 0, turn: 0, massKg: 10.5, ticksPerIn: 0 });
  const none = E.calFit(base, {});
  assert.deepEqual(none.rows, []); assert.deepEqual(none.params, {});
  assert.equal(E.calOpts({ params: { massKg: 10, gear: 1.2, junk: 3, viscous: -1 } }).massKg, 10);
  assert.equal(E.calOpts(null), null);
  assert.deepEqual(Object.keys(E.calOpts({ params: { massKg: 10, gear: 1.2, junk: 3, viscous: -1 } })).sort(), ['gear', 'massKg']);
});

test('calibrate: the sim builds its rig from a saved calibration, and without one nothing changes', () => {
  const rigWith = (extra) => {
    const b = sampleBench(E, E.DRIVE_JAVA);
    E.Sim.reset(b.code, b.cad, b.map, Object.assign({ payloadKg: 0, duty: 0.3, trust: 'code' }, extra || {}));
    return E.Sim.rig;
  };
  const plain = rigWith();
  assert.ok(plain && plain.props.kg > 0);
  for (const k of ['strafeEff', 'viscous', 'yawViscous', 'vScale']) assert.equal(plain[k], undefined, k + ' stays unset without a calibration');
  const kg = plain.props.kg;
  const fitted = rigWith({ calib: { massKg: kg * 1.5, gear: 1.4, strafeEff: 0.4, viscous: 12, yawViscous: 2 } });
  near(fitted.props.kg, kg * 1.5, 0.01, 'mass');
  near(fitted.props.Izz, plain.props.Izz * 1.5, 0.01, 'yaw inertia goes with it');
  assert.equal(fitted.gear, 1.4); assert.equal(fitted.strafeEff, 0.4); assert.equal(fitted.viscous, 12); assert.equal(fitted.yawViscous, 2);
  // Monte Carlo's own factors
  const heavy = rigWith({ massScale: 1.04, muScale: 0.9, volts: 13.5 });
  near(heavy.props.kg, kg * 1.04, 0.01, 'mass spread');
  near(heavy.mu, E.Dyn.defaults.mu * 0.9, 0.01, 'friction spread');
  near(heavy.vScale, 13.5 / 12.6, 0.01, 'battery');
  assert.equal(rigWith({ volts: 12.6 }).vScale, undefined, 'a nominal battery changes nothing');
});

test('calibrate: a fitted robot drives away at the speed it was fitted to, through the real sim', () => {
  const b = sampleBench(E, E.DRIVE_JAVA);
  const make = (extra) => { E.Sim.reset(b.code, b.cad, b.map, Object.assign({ payloadKg: 0, duty: 0.3, trust: 'code' }, extra || {})); E.Sim.obstacles = []; return E.Sim.rig; };
  const base = make();
  const before = E.calMeasure(base).fwd;
  const fit = E.calFit(base, { fwd: before * 0.7 });
  const rig = make({ calib: E.calOpts(fit) });
  near(E.calMeasure(rig).fwd, before * 0.7, 1.5, 'forward speed of the rig the sim built');
});

test('sim: battery volts scale the drive, and control latency delays it', () => {
  const rig = mecRig();
  const fast = E.calRun(Object.assign({}, rig, { vScale: 13.5 / 12.6 }), 'fwd'), slow = E.calRun(Object.assign({}, rig, { vScale: 12 / 12.6 }), 'fwd');
  assert.ok(fast > E.calRun(rig, 'fwd') && E.calRun(rig, 'fwd') > slow, `${slow} < ${E.calRun(rig, 'fwd')} < ${fast}`);
  // latency: the same full-power command, the wheels act on it 40 ms late
  const b = sampleBench(E, E.DRIVE_JAVA);
  const dist = (lat) => {
    E.Sim.reset(b.code, b.cad, b.map, { payloadKg: 0, duty: 0.3, trust: 'code', latencyMs: lat });
    E.Sim.obstacles = []; E.Sim.pad = { 1: { left_stick_y: -1 }, 2: { left_stick_y: -1 } };
    for (let i = 0; i < 25; i++) E.Sim.tick(0.02);
    return Math.hypot(E.Sim.chassis.x, E.Sim.chassis.y);
  };
  const d0 = dist(0), d40 = dist(40), d20 = dist(20);
  assert.ok(d0 > 0.05, 'it moves ' + d0);
  assert.ok(d40 < d20 && d20 < d0, `${d40} < ${d20} < ${d0}`);
});

test('calibrate: the measuring OpMode is plain FTC SDK Java with the places to fill in marked', () => {
  const j = E.calJava();
  assert.match(j, /public class CalibrateSimBench extends LinearOpMode/);
  assert.match(j, /@Autonomous/);
  for (const sdk of ['DcMotorEx', 'IMU', 'RevHubOrientationOnRobot', 'getRobotYawPitchRollAngles', 'getCurrentPosition', 'STOP_AND_RESET_ENCODER', 'waitForStart']) assert.ok(j.includes(sdk), sdk);
  assert.ok((j.match(/FILL IN/g) || []).length >= 5, 'the motor names, the IMU and its orientation are marked');
  assert.ok(!j.includes('${') && !j.includes('`'), 'no template leftovers');
  assert.match(j, /RUN_SECONDS = 2\.0/);
  // the bench's own Java VM reads it
  const c = E.jvCompile(j, []);
  assert.ok(c.ok, c.err);
});
