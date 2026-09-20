// Driver Station lifecycle, autonomous, coverage, config variables,
// robot configuration checks and OpMode comparison.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, fixture, sampleBench, run } from './load.mjs';

const E = loadEngine();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ±${tol}, got ${a}`);
const freshPads = () => { E.Sim.pad = { 1: {}, 2: {} }; };
const COMP = fixture('CompetitionTeleOp.java');

// ---------------------------------------------------------------- coverage
test('coverage: a clean competition OpMode runs nearly everything', () => {
  const cov = E.coverage(E.parseJava(COMP));
  assert.ok(cov.total > 30, `total ${cov.total}`);
  assert.equal(cov.skipped.length, 0, JSON.stringify(cov.skipped, null, 1));
});

test('coverage: unsupported lines are reported with the right line number, not dropped', () => {
  const src = COMP.replace('liftPid.setPID(kP, kI, kD);',
    'liftPid.setPID(kP, kI, kD);\n            for (int k = 0; k < 3; k++) { grip.setPosition(0.1); }\n            follower.update();\n            clicks++;');
  const code = E.parseJava(src);
  const cov = E.coverage(code);
  const lines = src.split('\n');
  const lineOf = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
  const loop = cov.skipped.find((s) => /loops inside/.test(s.why));
  const call = cov.skipped.find((s) => /follower\.update/.test(s.text));
  assert.ok(loop, 'for loop reported'); assert.equal(loop.line, lineOf('for (int k'));
  assert.ok(call, 'call into another class reported'); assert.equal(call.line, lineOf('follower.update'));
  assert.ok(!cov.skipped.some((s) => /clicks/.test(s.text)), 'clicks++ is simulated, not skipped');
});

test('coverage: x++ and x-- are simulated', () => {
  const code = E.parseJava(`@TeleOp(name="c") public class C extends LinearOpMode {
    public static int clicks = 0;
    public void runOpMode(){ waitForStart(); while (opModeIsActive()) { if (gamepad1.a) { clicks++; } if (gamepad1.b) { --clicks; } } } }`);
  const b = sampleBench(E);
  E.Sim.reset(code, b.cad, {}, b.opts); freshPads();
  E.Sim.pad[1].a = true; run(E, 0.1);
  assert.equal(E.Sim.vars.clicks, 5);
  E.Sim.pad[1].a = false; E.Sim.pad[1].b = true; E.Sim.tick(0.02);
  assert.equal(E.Sim.vars.clicks, 4);
});

// ---------------------------------------------------------------- config variables
test('config variables: static non-final fields, as FTC Dashboard exposes them', () => {
  const code = E.parseJava(COMP);
  assert.deepEqual(code.config.map((f) => f.name).sort(), ['kD', 'kF', 'kI', 'kP', 'liftTarget']);
  assert.equal(code.hasConfigAnnotation, false, 'no @Config on the class');
  assert.equal(E.parseJava('@Config ' + COMP).hasConfigAnnotation, true);
});

// ---------------------------------------------------------------- lifecycle
test('lifecycle: nothing runs before START; INIT applies setup; STOP drops motor power', () => {
  const b = sampleBench(E, COMP);
  E.Sim.load(b.code, b.cad, b.map, b.opts); freshPads();
  assert.equal(E.Sim.phase, 'loaded');
  E.Sim.pad[2].a = true; run(E, 0.2);
  assert.equal(E.Sim.vars.liftTarget, 0, 'loop must not run while loaded');
  E.Sim.init();
  assert.equal(E.Sim.phase, 'init');
  assert.equal(E.Sim.dev.wristR.reversed, true, 'setDirection ran during INIT');
  run(E, 0.2);
  assert.equal(E.Sim.vars.liftTarget, 0, 'loop must not run during INIT');
  E.Sim.start(); E.Sim.tick(0.02);
  assert.equal(E.Sim.vars.liftTarget, 1200, 'loop runs after START');
  run(E, 1);
  assert.ok(E.Sim.dev.lift.ticks > 600, `lift moved toward its target, ticks=${E.Sim.dev.lift.ticks}`);
  E.Sim.stop();
  assert.equal(E.Sim.phase, 'stopped');
  assert.equal(E.Sim.dev.lift.cmd, 0);
});

// ---------------------------------------------------------------- autonomous
test('autonomous: sleep() and wait loops hold the sequence while time passes', () => {
  const code = E.parseJava(E.AUTO_JAVA);
  assert.equal(code.kind, 'Autonomous');
  assert.equal(code.hasLoop, false);
  assert.ok(code.auto.length > 10, `auto steps ${code.auto.length}`);
  const b = sampleBench(E, E.AUTO_JAVA);
  E.Sim.reset(code, b.cad, b.map, b.opts); freshPads();
  assert.ok(E.Sim.drivetrain && E.Sim.drivetrain.ok, 'drive motors found by name in an autonomous');

  run(E, 1.1);                                           // still inside the first sleep(1200)
  assert.ok(E.Sim.chassis.x > 0.5, `drove forward, x=${E.Sim.chassis.x}`);
  near(E.Sim.chassis.h, 0, 1e-6, 'straight');

  run(E, 0.8);                                           // into the 700 ms turn
  assert.ok(E.Sim.chassis.h < -0.3, `turned right, h=${E.Sim.chassis.h}`);

  run(E, 1.2);                                           // lift raised during sleep(800)
  near(E.Sim.dev.lift.cmd, 0.75, 1e-9, 'lift commanded');

  run(E, 2.5);                                           // wait loop ends at runtime 5 s
  assert.equal(E.Sim.autoDone, true, 'sequence finished');
  for (const n of ['leftFront', 'rightFront', 'leftBack', 'rightBack']) assert.equal(E.Sim.dev[n].cmd, 0, n);
});

test('autonomous: RUN_TO_POSITION drives to the target and isBusy() releases the wait', () => {
  const code = E.parseJava(`@Autonomous(name="rtp") public class R extends LinearOpMode {
    public void runOpMode(){
      DcMotor arm = hardwareMap.get(DcMotor.class, "arm");
      arm.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
      waitForStart();
      arm.setTargetPosition(900);
      arm.setMode(DcMotor.RunMode.RUN_TO_POSITION);
      arm.setPower(0.8);
      while (opModeIsActive() && arm.isBusy()) { idle(); }
      arm.setPower(0);
    } }`);
  const b = sampleBench(E);
  E.Sim.reset(code, b.cad, {}, b.opts); freshPads();
  run(E, 6);
  assert.equal(E.Sim.autoDone, true, 'isBusy() went false');
  near(E.Sim.dev.arm.ticks, 900, 15, 'arm ticks');
});

// ---------------------------------------------------------------- robot configuration
test('robot config: parses devices, ports, hubs — and ignores commented-out devices', () => {
  const xml = fixture('robot-config.xml').replace('</LynxModule>', '<!-- <Servo name="ghost" port="4" /> --></LynxModule>');
  const cfg = E.parseRobotConfig(xml);
  assert.equal(cfg.modules.length, 2);
  assert.equal(cfg.devices.length, 11);
  assert.ok(!cfg.devices.some((d) => d.name === 'ghost'));
  const lift = cfg.devices.find((d) => d.name === 'lift');
  assert.equal(lift.kind, 'motor'); assert.equal(lift.module, 'Expansion Hub 2'); assert.equal(lift.port, 0);
  assert.equal(cfg.devices.find((d) => d.name === 'imu').kind, 'imu');
  assert.throws(() => E.parseRobotConfig('<html></html>'));
});

test('robot config: wrong type, wrong capitalisation and missing names each fail', () => {
  const code = E.parseJava(COMP);
  const keys = (F) => Object.fromEntries(F.map((f) => [f.key, f.sev]));
  let F = keys(E.checkRobotConfig(code, E.parseRobotConfig(fixture('robot-config.xml'))));
  assert.equal(F['cfgtype:wristR'], 'fail');
  assert.equal(F['cfgcase:fr'], 'fail');
  assert.equal(F.cfgunused, 'info');
  assert.equal(F.cfgok, undefined);

  const fixed = fixture('robot-config.xml')
    .replace('<ContinuousRotationServo name="wristR"', '<Servo name="wristR"')
    .replace('name="FrontRight"', 'name="frontRight"');
  F = keys(E.checkRobotConfig(code, E.parseRobotConfig(fixed)));
  assert.equal(F.cfgok, 'pass');

  const missing = fixed.replace(/<goBILDA5202SeriesMotor name="lift"[^>]*\/>/, '');
  F = keys(E.checkRobotConfig(code, E.parseRobotConfig(missing)));
  assert.equal(F['cfgmiss:lift'], 'fail');
});

test('robot config: analysis uses it instead of asking you to check names by hand', () => {
  const b = sampleBench(E, COMP);
  const without = E.analyze(b.code, b.cad, b.map, b.opts).map((f) => f.key);
  const withCfg = E.analyze(b.code, b.cad, b.map,
    { ...b.opts, robotConfig: E.parseRobotConfig(fixture('robot-config.xml')) }).map((f) => f.key);
  assert.ok(without.includes('cfg'));
  assert.ok(!withCfg.includes('cfg'));
  assert.ok(withCfg.includes('cfgtype:wristR'));
});

// ---------------------------------------------------------------- compare
test('compare: control-by-control differences between two versions of a TeleOp', () => {
  const A = E.parseJava(COMP);
  const B = E.parseJava(COMP
    .replace('liftTarget = 1200;', 'liftTarget = 1500;')                       // gamepad2.a changed
    .replace('if (gamepad2.y) {\n            }', 'if (gamepad2.y) {\n                grip.setPosition(0.9);\n            }')  // y: empty → action
    .replace(/if \(gamepad2\.back\) \{[\s\S]*?\n            \}/, '')             // back removed
    .replace('public static double kP = 0.004', 'public static double kP = 0.005')
    .replace('Servo grip = hardwareMap.servo.get("grip");',
             'Servo grip = hardwareMap.servo.get("grip");\n        Servo flag = hardwareMap.servo.get("flag");'));
  const d = E.diffOpModes(A, B);
  const st = Object.fromEntries(d.controls.map((c) => [c.control, c.status]));
  assert.equal(st['gamepad2.a'], 'changed');
  assert.equal(st['gamepad2.b'], 'same');
  assert.equal(st['gamepad2.y'], 'added');
  assert.equal(st['gamepad2.back'], 'removed');
  assert.deepEqual(d.devices.added, ['flag']);
  assert.deepEqual(d.values.find((v) => v.name === 'kP'), { name: 'kP', a: 0.004, b: 0.005 });
});

test('compare: a named constant and its literal value count as the same action', () => {
  const A = E.parseJava(E.SAMPLE_JAVA);
  const B = E.parseJava(E.SAMPLE_JAVA.replace('claw.setPosition(CLAW_CLOSE);', 'claw.setPosition(0.50);'));
  const a = E.diffOpModes(A, B).controls.find((c) => c.control === 'gamepad2.a');
  assert.equal(a.status, 'same');
});
