// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, fixture, sampleBench, run } from './load.mjs';

const E = loadEngine();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ±${tol}, got ${a}`);
const freshPads = () => { E.Sim.pad = { 1: {}, 2: {} }; };
const env = (vars = {}, pads = {}) => ({
  get: (n) => (n in vars ? vars[n] : 0),
  pad: (r) => { const m = /^gamepad(\d)\.(\w+)$/.exec(r); return m ? +((pads[m[1]] || {})[m[2]] || 0) : 0; },
  device: () => 0, pid: () => 0,
});
const evalStr = (s, vars, pads) => E.evalNode(E.parseExpr(s), env(vars, pads));

// ---------------------------------------------------------------- expressions
test('expressions: precedence, ternary and booleans', () => {
  assert.equal(evalStr('2 + 3 * 4'), 14);
  assert.equal(evalStr('(2 + 3) * 4'), 20);
  assert.equal(evalStr('slow ? 0.35 : 1.0', { slow: 0 }), 1.0);
  assert.equal(evalStr('slow ? 0.35 : 1.0', { slow: 1 }), 0.35);
  assert.equal(evalStr('gamepad2.right_bumper && !last', { last: 0 }, { 2: { right_bumper: 1 } }), 1);
  assert.equal(evalStr('gamepad2.right_bumper && !last', { last: 1 }, { 2: { right_bumper: 1 } }), 0);
});

test('expressions: Math functions actually compute (field-centric drive depends on it)', () => {
  near(evalStr('Math.cos(0)'), 1, 1e-12);
  near(evalStr('Math.sin(Math.toRadians(90))'), 1, 1e-12);
  assert.equal(evalStr('Math.max(Math.abs(-2), 1)'), 2);
  assert.equal(evalStr('Range.clip(1.7, -1, 1)'), 1);
});

test('expressions: IMU yaw idiom resolves to a readable heading', () => {
  const ast = E.parseExpr('imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS)');
  assert.ok(ast, 'parses');
  assert.equal(E.evalNode(ast, env({ __imuYaw: 0.5 })), 0.5);
});

// ---------------------------------------------------------------- java parser
test('java: every consecutive declaration is captured', () => {
  const code = E.parseJava(E.SAMPLE_JAVA);
  assert.deepEqual(code.devices.map((d) => d.name).sort(), ['arm', 'claw', 'rotate']);
  for (const d of code.devices) assert.equal(d.type, 'Servo', `${d.name} typed`);
  assert.equal(code.consts.CLAW_CLOSE, 0.5);
  assert.equal(code.consts.ARM_UP, 0.4);
  assert.equal(code.consts.ROTATE_MAX, 0.9);
  assert.equal(code.vars.rotatePosition, 0.5);
});

test('java: comments above a declaration become design intent', () => {
  const code = E.parseJava(E.SAMPLE_JAVA);
  const role = (n) => code.devices.find((d) => d.name === n).declaredRole;
  assert.equal(role('claw'), 'Speed');
  assert.equal(role('arm'), 'Torque');
  assert.equal(role('rotate'), 'Torque');
});

test('java: competition constructs — multi-name fields, bare fields, expression initializers', () => {
  const code = E.parseJava(fixture('CompetitionTeleOp.java'));
  assert.equal(code.kind, 'TeleOp');
  assert.equal(code.vars.kP, 0.004);
  assert.equal(code.vars.kD, 0.0002);
  assert.equal(code.vars.liftTarget, 0);
  near(code.consts.ticksPerDeg, 537.7 / 360, 1e-9, 'ticksPerDeg');
  const cfg = Object.fromEntries(code.devices.map((d) => [d.name, d.cfg]));
  assert.equal(cfg.lift, 'lift');
  assert.equal(cfg.fl, 'frontLeft');
  assert.equal(code.devices.find((d) => d.name === 'imu').type, 'IMU');
});

test('java: drive powers are traced back to the sticks through local variables', () => {
  const code = E.parseJava(fixture('CompetitionTeleOp.java'));
  const analog = code.bindings.filter((b) => b.analog).map((b) => b.dev).sort();
  assert.deepEqual(analog, ['bl', 'br', 'fl', 'fr']);
  const dt = E.detectDrivetrain(code);
  assert.equal(dt.style, 'mecanum');
  assert.equal(dt.wheels.length, 4, 'the PID lift is not a drive motor');
});

test('mapping: drive-motor corners read from every common naming style', () => {
  const corner = (n) => { const c = E.wheelCorner(n); return (c.front ? 'F' : c.back ? 'B' : '?') + (c.left ? 'L' : c.right ? 'R' : '?'); };
  const cases = {
    frontLeft: 'FL', leftFront: 'FL', left_front: 'FL', frontLeftMotor: 'FL', motorFL: 'FL', fl: 'FL', lf: 'FL',
    frontRight: 'FR', rightFront: 'FR', fr: 'FR', rf: 'FR', motorFR: 'FR',
    backLeft: 'BL', rearLeft: 'BL', bl: 'BL', lb: 'BL', rl: 'BL',
    backRight: 'BR', rearRight: 'BR', br: 'BR', rb: 'BR', rr: 'BR',
  };
  for (const [name, want] of Object.entries(cases)) assert.equal(corner(name), want, name);
});

// ---------------------------------------------------------------- simulation
test('sim: a rising-edge bumper steps the accumulator once per press', () => {
  const b = sampleBench(E);
  E.Sim.reset(b.code, b.cad, b.map, b.opts); freshPads();
  for (let k = 0; k < 3; k++) {
    E.Sim.pad[2].right_bumper = true; E.Sim.tick(0.02);
    E.Sim.pad[2].right_bumper = false; E.Sim.tick(0.02);
  }
  run(E, 2);
  near(E.Sim.vars.rotatePosition, 0.8, 1e-9, 'rotatePosition');
  near(E.Sim.dev.rotate.act, 0.8, 1e-6, 'servo follows the variable');
});

test('sim: with CAD specs the speed servo stalls before reaching ARM_UP', () => {
  const b = sampleBench(E, E.SAMPLE_JAVA, 'cad');
  E.Sim.reset(b.code, b.cad, b.map, b.opts); freshPads();
  E.Sim.pad[2].x = true;
  run(E, 2);
  assert.equal(E.Sim.dev.arm.stalled, true);
  assert.ok(E.Sim.dev.arm.act < 0.3, `arm stuck low, got ${E.Sim.dev.arm.act}`);
});

test('sim: with the code-declared torque servo the arm reaches ARM_UP', () => {
  const b = sampleBench(E, E.SAMPLE_JAVA, 'code');
  E.Sim.reset(b.code, b.cad, b.map, b.opts); freshPads();
  E.Sim.pad[2].x = true;
  run(E, 2);
  assert.equal(E.Sim.dev.arm.stalled, false);
  near(E.Sim.dev.arm.act, 0.4, 1e-6, 'arm');
});

test('sim: forward stick drives straight even with right motors reversed', () => {
  const b = sampleBench(E, fixture('CompetitionTeleOp.java'));
  E.Sim.reset(b.code, b.cad, b.map, b.opts); freshPads();
  E.Sim.pad[1].left_stick_y = -1;                       // forward is negative on a pad
  run(E, 1);
  const p = ['fl', 'fr', 'bl', 'br'].map((n) => E.Sim.dev[n].act);
  for (const v of p) near(v, p[0], 1e-9, 'equal wheel powers');
  near(E.Sim.chassis.h, 0, 1e-9, 'heading');
  assert.ok(Math.abs(E.Sim.chassis.x) > 0.5, 'robot moved');
});

test('sim: the PID lift chases its target from the encoder it reads', () => {
  const b = sampleBench(E, fixture('CompetitionTeleOp.java'));
  E.Sim.reset(b.code, b.cad, b.map, b.opts); freshPads();
  E.Sim.pad[2].a = true; E.Sim.tick(0.02); E.Sim.pad[2].a = false;
  assert.equal(E.Sim.vars.liftTarget, 1200);
  run(E, 8);
  near(E.Sim.dev.lift.ticks, 1200, 60, 'lift ticks');
});

test('sim: STOP_AND_RESET_ENCODER zeroes the encoder', () => {
  const b = sampleBench(E, fixture('CompetitionTeleOp.java'));
  E.Sim.reset(b.code, b.cad, b.map, b.opts); freshPads();
  E.Sim.pad[2].a = true; run(E, 2); E.Sim.pad[2].a = false;
  assert.ok(Math.abs(E.Sim.dev.lift.ticks) > 100);
  E.Sim.pad[2].back = true; E.Sim.tick(0.02);
  assert.ok(Math.abs(E.Sim.dev.lift.ticks) < 40, `reset, got ${E.Sim.dev.lift.ticks}`);
});

// ---------------------------------------------------------------- analysis
const titles = (F) => F.map((f) => `${f.sev}:${f.title.replace(/<[^>]+>/g, '')}`);

test('analysis: CAD trust reports the stalled arm and the swapped servos', () => {
  const b = sampleBench(E, E.SAMPLE_JAVA, 'cad');
  const F = E.analyze(b.code, b.cad, b.map, b.opts);
  assert.ok(F.some((f) => f.key === 'torque:arm' && f.sev === 'fail'), titles(F).join('\n'));
  assert.ok(F.some((f) => f.key === 'swap' && f.sev === 'fail'));
});

test('analysis: code trust demotes the CAD disagreement to a note', () => {
  const b = sampleBench(E, E.SAMPLE_JAVA, 'code');
  const F = E.analyze(b.code, b.cad, b.map, b.opts);
  assert.ok(!F.some((f) => f.key === 'torque:arm' && f.sev === 'fail'));
  assert.equal(F.find((f) => f.key === 'swap').sev, 'info');
});

test('analysis: competition code — blocking sleep, empty binding, mirrored pair, PID', () => {
  const b = sampleBench(E, fixture('CompetitionTeleOp.java'));
  const F = E.analyze(b.code, b.cad, b.map, b.opts);
  const sev = (k) => (F.find((f) => f.key === k) || {}).sev;
  assert.equal(sev('sleep'), 'fail');
  assert.equal(sev('empty:2y'), 'warn');
  assert.equal(sev('mirror'), 'pass');
  assert.equal(sev('pid'), 'info');
  assert.ok(!F.some((f) => f.key === 'idle:imu'), 'sensors are read, not commanded');
});

// ---------------------------------------------------------------- STEP
test('step: records survive semicolons in strings and comments between entities', () => {
  const recs = E.splitStepRecords("#1=PRODUCT('Frame; welded','x','',(#2));\n/* note; with ; */\n#2=A('it''s;ok');");
  assert.equal(recs.length, 2);
  assert.match(recs[0], /Frame; welded/);
  assert.match(recs[1], /^\s*#2=A\('it''s;ok'\)$/);
});

test('step: assembly transforms place local geometry, and mechanisms are found', () => {
  const cad = E.parseSTEP(fixture('assembly.step'));
  assert.equal(cad.units, 'METRE');
  assert.ok(cad.parts.some((p) => p.name === 'Frame; welded'), 'semicolon part name intact');
  assert.equal(cad.mechs.length, 1, 'only the Arm holds an actuator; the loose Frame is not a mechanism');
  const arm = cad.mechs[0];
  assert.equal(arm.id, 'Arm');
  assert.equal(arm.part, '2000-0025-0002');
  assert.equal(arm.kind, 'revolute-lift');
  near(arm.pivot[0], 0.10, 1e-9, 'pivot x'); near(arm.pivot[2], 0.30, 1e-9, 'pivot z');
  // the Frame's geometry is stored at z 0..0.05 and placed at z = 0.20
  const frame = cad.points.filter((p) => p[2] > 0.19 && p[2] < 0.26 && p[0] >= -1e-9 && p[0] <= 0.051);
  assert.ok(frame.length >= 4, `frame geometry translated, found ${frame.length}`);
});

// ---------------------------------------------------------------- rig
test('rig: default chain — turret carries the arm, the arm carries the claw', () => {
  const { cad } = sampleBench(E);
  const by = Object.fromEntries(cad.mechs.map((m) => [m.id, m]));
  assert.equal(by.Base.kind, 'revolute-yaw');
  assert.equal(by.Base.parent, 'chassis');
  assert.equal(by.Arm.parent, 'Base');
  assert.equal(by.Claw.parent, 'Arm');
  assert.deepEqual(E.rigCarries(cad.mechs, 'Base').sort(), ['Arm', 'Claw']);
});

test('rig: a parent loop is broken instead of hanging', () => {
  const { cad } = sampleBench(E);
  cad.mechs.find((m) => m.id === 'Base').parent = 'Claw';   // Claw → Arm → Base → Claw
  E.recomputeChain(cad.mechs);
  assert.ok(E.rigRoots(cad.mechs).length >= 1, 'something is rooted on the chassis');
  for (const m of cad.mechs) assert.ok(E.rigCarries(cad.mechs, m.id).length < cad.mechs.length);
});

test('rig: a typed lever overrides the measured one in the torque check', () => {
  const b = sampleBench(E, E.SAMPLE_JAVA, 'cad');
  const arm = b.cad.mechs.find((m) => m.id === 'Arm');
  const before = E.analyze(b.code, b.cad, b.map, b.opts).find((f) => f.key === 'torque:arm').sev;
  arm.leverOverride = 0.06;
  const after = E.analyze(b.code, b.cad, b.map, b.opts).find((f) => f.key === 'torque:arm').sev;
  assert.equal(before, 'fail');
  assert.notEqual(after, 'fail', 'a 60 mm lever is well within the servo');
});
