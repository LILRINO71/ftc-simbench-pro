// Parser fixes from the review of 25f54d3. Each construct here either ran
// wrong while coverage called it understood, or dropped code without a word.
// Behaviour is checked end to end in Sim, not just by the shape of the parse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, sampleBench, run } from './load.mjs';

const E = loadEngine();
const boot = (java) => {
  const code = E.parseJava(java), b = sampleBench(E);
  E.Sim.reset(code, b.cad, {}, b.opts); E.Sim.pad = { 1: {}, 2: {} };
  return code;
};
const cmd = (n) => E.Sim.dev[n].cmd;
const skippedText = (code) => E.coverage(code).skipped.map((s) => s.text);
const tele = (fields, loop, init = '') => `@TeleOp(name="t") public class T extends LinearOpMode {
  ${fields}
  public void runOpMode(){
    ${init}
    waitForStart();
    while (opModeIsActive()) {
${loop}
    }
  } }`;
const auto = (fields, body, init = '') => `@Autonomous(name="a") public class A extends LinearOpMode {
  ${fields}
  public void runOpMode(){
    ${init}
    waitForStart();
${body}
  } }`;
const SERVOS = 'Servo claw; Servo arm; Servo rotate; Servo lift; Servo catcher; DcMotor slide; DcMotor leftFront;';

// ---------------------------------------------------------------- for loops
test('autonomous for loop: init and update run, the loop ends, what follows runs', () => {
  const code = boot(auto(SERVOS + ' public static int n = 0; public static int m = 0;', `
    for (int i = 0; i < 3; i++) { lift.setPosition(0.3); n++; }
    for (int j = 0, k = 10; j < k; j += 2, k--) m++;
    lift.setPosition(0.9);
    leftFront.setPower(0.5);`));
  run(E, 1);
  assert.equal(E.Sim.autoDone, true, 'sequence finished');
  assert.equal(E.Sim.vars.n, 3, 'three passes');
  assert.equal(E.Sim.vars.i, 3);
  assert.equal(E.Sim.vars.m, 4, 'two-variable header');
  assert.equal(cmd('lift'), 0.9);
  assert.equal(cmd('leftFront'), 0.5);
  assert.deepEqual(E.coverage(code).skipped, []);
});

test('autonomous for loop: a loop that never ends is cut off by its own guard', () => {
  boot(auto(SERVOS + ' public static int n = 0;', `
    for (int i = 0; i < 5; i--) { n++; }
    lift.setPosition(0.9);`));
  run(E, 25);
  assert.equal(E.Sim.autoDone, true, 'the rest of the autonomous still runs');
  assert.equal(E.Sim.vars.n, 1000);
  assert.equal(cmd('lift'), 0.9);
});

test('autonomous for-each and for(;;) are reported, not run as a loop that never enters', () => {
  const code = boot(auto(SERVOS, `
    for (Servo s : servos) { s.setPosition(0.2); }
    for (;;) { claw.setPosition(0.1); break; }
    lift.setPosition(0.9);`));
  run(E, 0.2);
  assert.equal(E.Sim.autoDone, true);
  assert.equal(cmd('lift'), 0.9);
  const sk = skippedText(code);
  assert.ok(sk.some((t) => /for \(Servo s : servos\)/.test(t)), JSON.stringify(sk));
  assert.ok(sk.some((t) => /for \(;;\)/.test(t)), JSON.stringify(sk));
});

test('autonomous for loop with sleep() inside is flagged: the sleep does not pause', () => {
  const code = E.parseJava(auto(SERVOS, `
    for (int i = 0; i < 3; i++) { claw.setPosition(1); sleep(300); claw.setPosition(0); }`));
  const s = E.coverage(code).skipped;
  assert.ok(s.some((x) => /sleep/.test(x.text) && /loop/.test(x.why)), JSON.stringify(s));
});

// ---------------------------------------------------------------- enums + switch
test('enum state machine: switch picks the case for the current state, and state changes stick', () => {
  const code = boot(tele(`enum State { IDLE, LIFT, DROP }
  State state = State.IDLE; ` + SERVOS, `
      switch (state) {
        case IDLE: claw.setPosition(0.1); if (gamepad1.a) state = State.LIFT; break;
        case LIFT: claw.setPosition(0.9); if (gamepad1.b) state = State.DROP; break;
        case DROP: claw.setPosition(0.4); break;
      }
      if (state == LIFT) { arm.setPosition(0.7); } else { arm.setPosition(0.2); }`));
  assert.deepEqual([code.consts['State.IDLE'], code.consts['State.LIFT'], code.consts['State.DROP']], [0, 1, 2]);
  assert.deepEqual([code.consts.IDLE, code.consts.LIFT, code.consts.DROP], [0, 1, 2]);
  E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.1); assert.equal(cmd('arm'), 0.2);
  E.Sim.pad[1].a = true; E.Sim.tick(0.02);
  assert.equal(E.Sim.vars.state, 1, 'state = State.LIFT');
  assert.equal(cmd('arm'), 0.7, 'state == LIFT');
  E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.9, 'LIFT case ran');
  E.Sim.pad[1].a = false; E.Sim.pad[1].b = true; E.Sim.tick(0.02); E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.4, 'DROP case ran');
  assert.equal(cmd('arm'), 0.2);
  assert.deepEqual(E.coverage(code).skipped, []);
});

test('enum declared after the class, with constructor args, starting on its second constant', () => {
  const code = boot(tele('Mode mode = Mode.SCORE; ' + SERVOS, `
      switch (mode) { case INTAKE: claw.setPosition(0.1); break; case SCORE: claw.setPosition(0.8); break; }
      Mode other = Mode.INTAKE;
      if (other == Mode.INTAKE) { arm.setPosition(0.3); }`) +
    '\nenum Mode { INTAKE(0.1), SCORE(0.8); final double pos; Mode(double p) { pos = p; } }');
  assert.equal(code.vars.mode, 1);
  E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.8);
  assert.equal(cmd('arm'), 0.3, 'local enum variable');
  assert.deepEqual(E.coverage(code).skipped, []);
});

test('switch on an enum variable reads bare labels as that enum, even when the name is taken', () => {
  const code = boot(tele(`static final double LIFT = 0.8;
  enum Arm { STOW, LIFT } enum Claw { OPEN, LIFT }
  Arm arm1 = Arm.LIFT; Claw claw1 = Claw.OPEN; ` + SERVOS, `
      switch (arm1) { case STOW: arm.setPosition(0.1); break; case LIFT: arm.setPosition(LIFT); break; }
      switch (claw1) { case OPEN: claw.setPosition(0.3); break; case LIFT: claw.setPosition(0.9); break; }`));
  assert.equal(code.consts.LIFT, 0.8, 'the numeric constant keeps its name');
  E.Sim.tick(0.02);
  assert.equal(cmd('arm'), 0.8, 'Arm.LIFT matched, and LIFT the double still reads 0.8');
  assert.equal(cmd('claw'), 0.3);
  E.Sim.vars.claw1 = code.consts['Claw.LIFT']; E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.9);
  assert.deepEqual(E.coverage(code).skipped, []);
});

test('a statement holding an anonymous class or a ";" in a string stays one statement', () => {
  const code = boot(tele(SERVOS, `
      telemetry.addData("Mode", "drive; then score");
      relativeLayout.post(new Runnable() { public void run() { relativeLayout.setBackgroundColor(Color.WHITE); } });
      claw.setPosition(0.3);`));
  E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.3);
  assert.deepEqual(skippedText(code), ['relativeLayout.post(…)']);
});

test('switch on an enum this file does not declare is reported, not run as case 0', () => {
  const code = boot(tele(SERVOS, `
      switch (robotState) { case IDLE: claw.setPosition(0.1); break; case LIFT: claw.setPosition(0.9); break; }`));
  E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.5);
  assert.ok(skippedText(code).some((t) => /switch \(robotState\)/.test(t)));
});

test('switch: stacked labels share a body, fall-through runs on, default can sit anywhere', () => {
  const code = boot(tele(SERVOS + ' public static int mode = 1; public static int step = 0; public static int gear = 0; public static int k = 0;', `
      switch (mode) { case 1: case 2: claw.setPosition(0.8); break; case 3: { claw.setPosition(0.6); break; } default: claw.setPosition(0.2); }
      switch (step) { case 0: arm.setPosition(0.9); case 1: rotate.setPosition(0.8); break; default: rotate.setPosition(0.1); }
      switch (gear) { case 0: break; default: lift.setPosition(0.3); }
      switch (k) { default: catcher.setPosition(0.3); case 7: slide.setPower(0.6); break; case 8: slide.setPower(0.2); }`));
  const at = (vars) => { Object.assign(E.Sim.vars, vars); E.Sim.tick(0.02); };
  at({ mode: 1 }); assert.equal(cmd('claw'), 0.8, 'mode 1');
  at({ mode: 3 }); assert.equal(cmd('claw'), 0.6, 'mode 3, braced case body');
  at({ mode: 2 }); assert.equal(cmd('claw'), 0.8, 'mode 2');
  at({ mode: 4 }); assert.equal(cmd('claw'), 0.2, 'default');
  assert.equal(cmd('arm'), 0.9, 'step 0 ran case 0'); assert.equal(cmd('rotate'), 0.8, 'and fell into case 1');
  E.Sim.dev.arm.cmd = 0.5;
  at({ step: 1 }); assert.equal(cmd('arm'), 0.5, 'case 1 alone'); assert.equal(cmd('rotate'), 0.8);
  at({ step: 5 }); assert.equal(cmd('rotate'), 0.1);
  assert.equal(cmd('lift'), 0.5, 'case 0: break does nothing');
  at({ gear: 1 }); assert.equal(cmd('lift'), 0.3);
  assert.equal(cmd('catcher'), 0.3, 'default first'); assert.equal(cmd('slide'), 0.6, 'default fell into case 7');
  E.Sim.dev.catcher.cmd = 0.5;
  at({ k: 7 }); assert.equal(cmd('catcher'), 0.5); assert.equal(cmd('slide'), 0.6);
  at({ k: 8 }); assert.equal(cmd('slide'), 0.2);
  assert.deepEqual(E.coverage(code).skipped, []);
});

test('switch: a nested switch and a string holding "case 9:" do not split the outer one', () => {
  const code = boot(tele(SERVOS + ' public static int a = 1; public static int b = 2;', `
      switch (a) {
        case 1:
          switch (b) { case 1: arm.setPosition(0.1); break; case 2: arm.setPosition(0.7); break; }
          String note = "case 9: default:";
          claw.setPosition(0.9);
          break;
        case 2:
          claw.setPosition(0.2);
          break;
      }`));
  E.Sim.tick(0.02);
  assert.equal(cmd('arm'), 0.7); assert.equal(cmd('claw'), 0.9);
  E.Sim.vars.a = 2; E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.2);
  assert.deepEqual(E.coverage(code).skipped, []);
});

test('switch on a String or char is reported instead of always taking default', () => {
  const code = boot(tele(SERVOS + ' String mode = "SCORE"; char c = \'a\';', `
      switch (mode) { case "SCORE": claw.setPosition(0.9); break; default: claw.setPosition(0.2); }
      switch (c) { case 'a': arm.setPosition(0.9); break; default: arm.setPosition(0.2); }`));
  E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.5); assert.equal(cmd('arm'), 0.5);
  const s = E.coverage(code).skipped;
  assert.ok(s.some((x) => /switch \(mode\)/.test(x.text) && /String/.test(x.why)), JSON.stringify(s));
  assert.ok(s.some((x) => /switch \(c\)/.test(x.text)), JSON.stringify(s));
});

test('switch: statements inside cases report their own line', () => {
  const src = tele('Servo claw; public static int mode = 1;', `
      switch (mode) {
        case 1:
          foo.bar();
          baz.qux();
          break;
        case 2:
          foo.bar();
          break;
        default:
          other.thing();
      }`);
  const lines = src.split('\n');
  const all = (needle) => lines.map((l, i) => (l.includes(needle) ? i + 1 : 0)).filter(Boolean);
  const got = E.coverage(E.parseJava(src)).skipped.map((s) => s.line).sort((x, y) => x - y);
  assert.deepEqual(got, [...all('foo.bar'), ...all('baz.qux'), ...all('other.thing')].sort((x, y) => x - y));
});

test('autonomous: sleep() inside a switch case holds the sequence; the case taken is fixed at entry', () => {
  const java = (zone) => auto(SERVOS + ` static final double DRIVE = 0.6; public static int zone = ${zone};`, `
    switch (zone) {
      case 0: claw.setPosition(0.1); zone = 1; sleep(200); break;
      case 1: leftFront.setPower(-DRIVE); sleep(500); leftFront.setPower(0); claw.setPosition(0.9); break;
      case 2: leftFront.setPower(DRIVE); sleep(1500); leftFront.setPower(0); break;
      default: leftFront.setPower(0.2); sleep(300); break;
    }
    lift.setPosition(0.9);`);
  let code = boot(java(2));
  run(E, 0.3);
  assert.equal(cmd('leftFront'), 0.6, 'driving'); assert.equal(E.Sim.autoDone, false); assert.equal(cmd('lift'), 0.5);
  run(E, 1.1);
  assert.equal(cmd('leftFront'), 0.6, 'still inside sleep(1500)');
  run(E, 0.3);
  assert.equal(cmd('leftFront'), 0); assert.equal(cmd('lift'), 0.9); assert.equal(E.Sim.autoDone, true);
  assert.deepEqual(E.coverage(code).skipped, []);

  boot(java(1));
  run(E, 0.3); assert.equal(cmd('leftFront'), -0.6);
  run(E, 0.4); assert.equal(cmd('leftFront'), 0); assert.equal(cmd('lift'), 0.9);

  boot(java(0));
  run(E, 0.5);
  assert.equal(E.Sim.autoDone, true);
  assert.equal(cmd('claw'), 0.1, 'zone = 1 inside case 0 must not also run case 1');
  assert.equal(cmd('leftFront'), 0);
});

test('autonomous: sleep() inside an if/else branch holds the sequence', () => {
  boot(auto(SERVOS + ' public static int zone = 2;', `
    if (zone == 2) { lift.setPosition(0.3); sleep(1000); lift.setPosition(0.6); }
    else { sleep(3000); }
    claw.setPosition(0.9);`));
  run(E, 0.5);
  assert.equal(cmd('lift'), 0.3); assert.equal(cmd('claw'), 0.5);
  run(E, 0.6);
  assert.equal(cmd('lift'), 0.6); assert.equal(cmd('claw'), 0.9); assert.equal(E.Sim.autoDone, true);
});

// ---------------------------------------------------------------- try / catch / finally
test('try/catch: code after it runs even when a name starts with catch or finally; finally runs', () => {
  const code = boot(tele(SERVOS + ' public static int finallyDone = 0;', `
      try { claw.setPosition(0.8); } catch (Exception e) { claw.setPosition(0.0); }
      catcher.setPosition(0.9);
      if (gamepad1.a) { arm.setPosition(0.1); } else { arm.setPosition(0.3); }
      try { lift.setPosition(0.7); } catch (IllegalStateException | NullPointerException e) { lift.setPosition(0.0); } finally { rotate.setPosition(0.2); }
      finallyDone = 1;`));
  E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.8, 'try body'); assert.equal(cmd('catcher'), 0.9);
  assert.equal(cmd('arm'), 0.3); assert.equal(cmd('lift'), 0.7);
  assert.equal(cmd('rotate'), 0.2, 'finally'); assert.equal(E.Sim.vars.finallyDone, 1);
  E.Sim.pad[1].a = true; E.Sim.tick(0.02);
  assert.equal(cmd('arm'), 0.1);
  assert.deepEqual(E.coverage(code).skipped, []);
});

// ---------------------------------------------------------------- expressions
test('(int) (long) (short) (byte) casts truncate toward zero; (double) (float) pass through', () => {
  const vals = { gp: 0.95, ticks: 1234, x: -2.7 };
  const env = { get: (k) => vals[k] ?? 0, pad: () => 0, device: () => 0, pid: () => 0 };
  const ev = (s) => E.evalNode(E.parseExpr(s), env);
  assert.equal(ev('(int)(gp * 3)'), 2);
  assert.equal(ev('(int) (ticks / 100) * 100'), 1200);
  assert.equal(ev('(int) x'), -2);
  assert.equal(ev('(long) x'), -2);
  assert.equal(ev('(short)(x * 2)'), -5);
  assert.equal(ev('(byte) 3.9'), 3);
  assert.equal(ev('(double) x'), -2.7);
  assert.equal(ev('(float) gp'), 0.95);

  boot(tele(SERVOS, `
      int zone = (int)(gamepad1.right_trigger * 3);
      if (zone == 2) { claw.setPosition(0.9); } else { claw.setPosition(0.1); }`));
  E.Sim.pad[1].right_trigger = 0.95; E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.9);
});

test('array reads do not parse, so they are reported instead of reading 0', () => {
  assert.equal(E.parseExpr('powers[0] * 2 + 1'), null);
  const code = boot(tele(SERVOS + ' double[] pos = {0.1, 0.9};', `
      double p = pos[1];
      claw.setPosition(pos[0]);
      if (pos[1] > 0.5) { arm.setPosition(0.7); }`));
  E.Sim.tick(0.02);
  assert.equal(cmd('claw'), 0.5, 'not commanded to a made-up 0');
  const s = skippedText(code);
  assert.ok(s.some((t) => /double p = pos\[1\]/.test(t)), JSON.stringify(s));
  assert.ok(s.some((t) => /claw\.setPosition/.test(t)), JSON.stringify(s));
  assert.ok(s.some((t) => /pos\[1\] > 0\.5/.test(t)), JSON.stringify(s));
});

test('device readback hands the raw argument nodes on, so getDistance can see its unit', () => {
  let seen = null;
  const env = { get: () => 0, pad: () => 0, pid: () => 0, device: (n, m, args) => { seen = { n, m, args }; return 0; } };
  E.evalNode(E.parseExpr('dist.getDistance(DistanceUnit.INCH)'), env);
  assert.equal(seen.n, 'dist'); assert.equal(seen.m, 'getDistance');
  assert.deepEqual(seen.args, [{ o: 'id', v: 'DistanceUnit.INCH' }]);
});

// ---------------------------------------------------------------- coverage honesty
test('coverage: chained calls and calls on undeclared objects are skipped; PIDs and timers are not', () => {
  const code = boot(tele(SERVOS + ' IMU imu; ElapsedTime timer; PIDController pid = new PIDController(0.1, 0, 0); public static double t = 0;', `
      hardwareMap.get(Servo.class, "claw").setPosition(0.9);
      robot.getArm().setPower(1);
      robot.getArm().setMode(DcMotor.RunMode.RUN_TO_POSITION);
      ghost.setPower(1);
      odo.reset();
      claw.setPosition(0.4);
      pid.setPID(0.2, 0, 0);
      imu.resetYaw();
      t = timer.seconds();`, 'timer = new ElapsedTime();'));
  const s = skippedText(code);
  for (const want of ['hardwareMap.get(Servo.class, "claw")', 'robot.getArm().setPower', 'robot.getArm().setMode', 'ghost.setPower', 'odo.reset'])
    assert.ok(s.some((t) => t.includes(want)), want + ' not reported: ' + JSON.stringify(s));
  assert.equal(s.length, 5, JSON.stringify(s));
  run(E, 1);
  assert.ok(E.Sim.vars.t > 0.9, 'ElapsedTime declared then constructed still counts: ' + E.Sim.vars.t);
});

// ---------------------------------------------------------------- if / else chains, do/while
test('if / else if / else keeps its final else, braced or not', () => {
  const code = boot(tele(SERVOS, `
      if (gamepad2.dpad_up) { slide.setPower(1); } else if (gamepad2.dpad_down) { slide.setPower(-1); } else { slide.setPower(0); }
      if (gamepad1.x) claw.setPosition(0.1); else if (gamepad1.y) claw.setPosition(0.5); else if (gamepad1.b) claw.setPosition(0.7); else claw.setPosition(0.9);`));
  assert.ok(code.stmts[0].else[0].else, 'inner if has the final else');
  const p = E.Sim.pad;
  E.Sim.tick(0.02); assert.equal(cmd('slide'), 0); assert.equal(cmd('claw'), 0.9);
  p[2].dpad_up = true; E.Sim.tick(0.02); assert.equal(cmd('slide'), 1);
  p[2].dpad_up = false; E.Sim.tick(0.02); assert.equal(cmd('slide'), 0, 'released: the else stops it');
  p[2].dpad_down = true; E.Sim.tick(0.02); assert.equal(cmd('slide'), -1);
  p[1].b = true; E.Sim.tick(0.02); assert.equal(cmd('claw'), 0.7);
  p[1].y = true; E.Sim.tick(0.02); assert.equal(cmd('claw'), 0.5);
  p[1].x = true; E.Sim.tick(0.02); assert.equal(cmd('claw'), 0.1);
});

test('do/while is reported and the statements after it still run', () => {
  const code = boot(tele(SERVOS, `
      do { claw.setPosition(0.2); } while (false);
      arm.setPosition(0.8);`));
  E.Sim.tick(0.02);
  assert.equal(cmd('arm'), 0.8);
  assert.ok(skippedText(code).some((t) => /^do/.test(t)));
});
