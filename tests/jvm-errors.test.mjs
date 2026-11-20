// What the robot would do when something goes wrong, and what the bench can't tell. An exception
// the robot throws has to be thrown here too, and end the run the same way; a part of the FTC SDK
// the bench doesn't model has to be listed, not quietly read as false. Each test failed before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpMode, engine } from '../tools/run-opmode.mjs';

const HEAD = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
import com.qualcomm.robotcore.hardware.*;
import com.qualcomm.robotcore.util.*;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import java.util.*;
`;
const linear = (pre, body = '') => HEAD + `@TeleOp(name="T") public class T extends LinearOpMode {
  @Override public void runOpMode() throws InterruptedException {
${pre}
    waitForStart();
${body}
  }
}`;
const run = (src, opts = {}) => runOpMode(Object.assign({ code: [{ file: 'T.java', src }], opmode: 'T.java', seconds: 0.5 }, opts));
/* the same program, its JvProgram kept: for what the result of runOpMode doesn't carry yet */
function program(src, opts = {}) {
  let P = null;
  const r = run(src, Object.assign({ onStart: (rn) => { P = rn.program; } }, opts));
  return { r, P };
}

test('SDK 11 gamepad: right_trigger_pressed and left_trigger_pressed follow the triggers past trigger_threshold', () => {
  const { r, P } = program(linear(`    DcMotor shooter = hardwareMap.get(DcMotor.class, "shooter");
    DcMotor intake = hardwareMap.get(DcMotor.class, "intake");`, `    int edges = 0;
    while (opModeIsActive()) {
      shooter.setPower(gamepad2.right_trigger_pressed ? 0.75 : 0);
      intake.setPower(gamepad2.left_trigger_pressed ? 0 : 1);
      if (gamepad2.rightTriggerWasPressed()) edges++;
      telemetry.addData("t", gamepad1.trigger_threshold + " " + gamepad2.getTriggerThreshold() + " " + edges);
      gamepad1.setTriggerThreshold(0.9);
      telemetry.addData("p", gamepad1.right_trigger_pressed);
      telemetry.update();
    }`), { seconds: 0.4, gamepad: [{ t: 0, gamepad1: { right_trigger: 0.7 }, gamepad2: { right_trigger: 0.6, left_trigger: 1 } }] });
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.equal(r.peaks.shooter.last, 0.75);
  assert.equal(r.peaks.intake.last, 0);
  // 0.7 is past the default 0.5 but not past 0.9; one press edge while the trigger stays held
  assert.deepEqual(r.telemetry, ['t : 0.9 0.5 1', 'p : false']);
  assert.deepEqual(r.stubs, []);
  assert.deepEqual(P.unmodelled(), []);
});

test('a trigger at exactly trigger_threshold reads as pressed (SDK 11.1 Gamepad.java compares with >=)', () => {
  const r = run(linear('', `    gamepad2.setTriggerThreshold(0.8);
    System.out.println(gamepad1.left_trigger_pressed + " " + gamepad1.right_trigger_pressed + " " + gamepad2.left_trigger_pressed);`),
  { seconds: 0.1, gamepad: [{ t: 0, gamepad1: { left_trigger: 0.5, right_trigger: 0.49 }, gamepad2: { left_trigger: 0.8 } }] });
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.deepEqual(r.prints, ['true false true']);
});

test('an SDK member the bench does not model is listed as such, apart from third-party stubs', () => {
  const { r, P } = program(linear(`    DistanceSensor d = hardwareMap.get(DistanceSensor.class, "d");
    String c = d.getConnectionInfo();
    com.pedropathing.follower.Follower f = null;`));
  assert.equal(r.error, null);
  assert.equal(r.ok, true);
  const u = P.unmodelled();
  assert.equal(u.length, 1, JSON.stringify(u));
  assert.equal(u[0].call, 'Rev2mDistanceSensor.getConnectionInfo');
  assert.equal(u[0].sdk, 'com.qualcomm.hardware.rev.Rev2mDistanceSensor');
  assert.equal(u[0].line, 10);
});

test('an exception nothing catches in a team thread ends the run as the Robot Controller app does', () => {
  const r = run(linear('', `    new Thread(() -> { int[] a = new int[1]; a[5] = 1; }).start();
    sleep(200); System.out.println("main still running");`));
  assert.equal(r.ok, false);
  assert.equal(r.error.cls, 'ArrayIndexOutOfBoundsException');
  assert.match(r.error.in, /in a thread the OpMode started/);
  assert.equal(r.error.line, 11);
  assert.deepEqual(r.prints, []);
  // one the thread catches itself is its own business
  const ok = run(linear('', `    new Thread(() -> { try { int[] a = new int[1]; a[5] = 1; } catch (ArrayIndexOutOfBoundsException e) { } }).start();
    sleep(100); System.out.println("fine");`));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.prints, ['fine']);
});

test('a crash that ends the run ends every thread of it: nothing commands the robot afterwards', () => {
  const E = engine();
  // the crash in one thread, another thread and the main loop still driving the lift; then the
  // crash in the main thread while a thread drives it
  const crashIn = (where) => linear(`    DcMotor lift = hardwareMap.get(DcMotor.class, "lift");`, `
    new Thread(() -> { int[] a = new int[2]; int k = 0; while (opModeIsActive()) { k++; if (${where === 'thread' ? 'k == 10' : 'false'}) a[5] = 1; idle(); } }).start();
    new Thread(() -> { double p = 0.1; while (opModeIsActive()) { lift.setPower(p); p += 0.01; idle(); } }).start();
    int n = 0; while (opModeIsActive()) { n++; ${where === 'main' ? 'if (n == 10) { int[] b = new int[1]; b[3] = 1; }' : ''} lift.setPower(-n / 100.0); idle(); }`);
  for (const where of ['thread', 'main']) {
    const comp = E.jvCompile(crashIn(where), []);
    const H = E.jvProbeHost(), P = new E.JvProgram(comp, H.host);
    P.init(); P.start();
    let at = null, cmd = null;
    for (let k = 0; k < 40; k++) {
      H.clock += 0.02; H.t += 0.02;
      P.tick();
      if (P.error && at == null) { at = k; H.cmds.length = 0; cmd = H.devs.get('lift').cmd; }
    }
    assert.equal(P.error && P.error.cls, 'ArrayIndexOutOfBoundsException', where);
    assert.equal(!!P.error.thread, where === 'thread');
    assert.ok(at != null && at < 30, where + ' crashed at ' + at);
    assert.deepEqual(H.cmds, [], where + ': commands after the crash');
    assert.equal(H.devs.get('lift').cmd, cmd, where);
  }
});

test('INIT throws what the SDK throws: RUN_TO_POSITION before a target, an impossible hub orientation', () => {
  const rtp = run(linear(`    DcMotor m = hardwareMap.get(DcMotor.class, "m");
    m.setMode(DcMotor.RunMode.RUN_TO_POSITION);`));
  assert.equal(rtp.ok, false);
  assert.equal(rtp.error.cls, 'TargetPositionNotSetException');
  assert.equal(rtp.error.phase, 'init');
  assert.match(rtp.error.msg, /You must set a target position before switching to RUN_TO_POSITION/);
  const fine = run(linear(`    DcMotor m = hardwareMap.get(DcMotor.class, "m");
    m.setTargetPosition(100); m.setMode(DcMotor.RunMode.RUN_TO_POSITION); m.setPower(0.5);
    try { DcMotor n = hardwareMap.get(DcMotor.class, "n"); n.setMode(DcMotor.RunMode.RUN_TO_POSITION); }
    catch (RuntimeException e) { System.out.println(e.getClass().getSimpleName()); }`));
  assert.equal(fine.ok, true, JSON.stringify(fine.error));
  assert.deepEqual(fine.prints, ['TargetPositionNotSetException']);
  const hub = (logo, usb) => run(linear(`    IMU imu = hardwareMap.get(IMU.class, "imu");
    imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.${logo}, RevHubOrientationOnRobot.UsbFacingDirection.${usb})));`));
  for (const [l, u] of [['UP', 'UP'], ['UP', 'DOWN'], ['LEFT', 'RIGHT']]) {
    const r = hub(l, u);
    assert.equal(r.error && r.error.cls, 'IllegalArgumentException', l + '/' + u);
    assert.match(r.error.msg, /physically impossible/);
  }
  assert.equal(hub('UP', 'FORWARD').ok, true);
  assert.equal(hub('LEFT', 'UP').ok, true);
});

test('with the robot configuration known, hardwareMap.get of a name it lacks throws in INIT', () => {
  const E = engine();
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173">
    <goBILDA5202SeriesMotor name="lift" port="0" /><Servo name="claw" port="0" /><ControlHubImuBHI260AP name="imu" port="0" bus="0" />
  </LynxModule></LynxUsbDevice></Robot>`;
  const host = { robotConfig: () => E.parseRobotConfig(xml) };
  const good = run(linear(`    DcMotor lift = hardwareMap.get(DcMotor.class, "lift"); Servo claw = hardwareMap.get(Servo.class, "claw");
    IMU imu = hardwareMap.get(IMU.class, "imu"); VoltageSensor v = hardwareMap.voltageSensor.iterator().next();`), { host });
  assert.equal(good.ok, true, JSON.stringify(good.error));
  const missing = run(linear('    DcMotor m = hardwareMap.get(DcMotor.class, "Lift");'), { host });
  assert.equal(missing.error.cls, 'IllegalArgumentException');
  assert.equal(missing.error.msg, 'Unable to find a hardware device with name "Lift" and type DcMotor');
  assert.equal(missing.error.phase, 'init');
  const wrongKind = run(linear('    Servo s = hardwareMap.get(Servo.class, "lift");'), { host });
  assert.equal(wrongKind.error.cls, 'IllegalArgumentException');
  // no configuration: any name is taken, as before
  assert.equal(run(linear('    DcMotor m = hardwareMap.get(DcMotor.class, "anything");')).ok, true);
});
