// The Java VM (src/jvm.js, jvmlib.js, jvmprelude.js, jvmrun.js): real team
// code shapes the line reader in java.js couldn't run. Each OpMode here ran
// nothing before the VM: hardware in a Robot class, FTCLib commands, Road
// Runner's setDrivePowers, Pedro's TeleOp drive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

// a headless run: INIT, START, then `secs` with gamepad1 held as given
function run(code, pad1, secs, onTick) {
  const H = { t: 0, clock: 0, h: 0, pads: { 1: {}, 2: {} } };
  const devs = new Map();
  const host = {
    dev(name, type, kind) { let s = devs.get(name); if (!s) { s = { name, type, kind, cmd: kind === 'servo' ? null : 0, act: 0, ticks: 0, offset: 0, vel: 0, target: 0, reversed: false, mode: 'run', tpr: 537.7, spec: { rpm: 312 } }; devs.set(name, s); } return s; },
    pad(i) { return H.pads[i] || {}; }, now() { return H.clock; }, runtime() { return H.t; }, heading() { return H.h; }, omega() { return 0; },
    pose() { return { x: 0, y: 0, h: H.h }; }, vel() { return { x: 0, y: 0 }; }, ray() { return 8.19; }, color() { return [0, 0, 0]; }, volts() { return 12.6; }, touch() { return false; },
    telemetry(l) { H.tel = l; }, rumble() {},
  };
  const comp = E.jvCompile(code.main, code.libs || []);
  assert.ok(comp.ok, comp.err);
  const P = new E.JvProgram(comp, host);
  P.init();
  H.pads[1] = pad1 || {};
  P.start();
  for (let k = 0; k < Math.round(secs / 0.02); k++) { H.clock += 0.02; H.t += 0.02; P.tick(); for (const [, s] of devs) s.ticks += (s.cmd || 0) * 8; if (onTick) onTick(devs, k); }
  return { P, devs, H };
}

const ROBOT = `package org.firstinspires.ftc.teamcode.hw;
import com.qualcomm.robotcore.hardware.*;
public class Robot {
  public DcMotorEx lf, lb, rf, rb; public Servo claw;
  private final HardwareMap hw;
  public Robot(HardwareMap hw) { this.hw = hw; }
  public void init() {
    lf = hw.get(DcMotorEx.class, "leftFront"); lb = hw.get(DcMotorEx.class, "leftBack");
    rf = hw.get(DcMotorEx.class, "rightFront"); rb = hw.get(DcMotorEx.class, "rightBack");
    lf.setDirection(DcMotorSimple.Direction.REVERSE); lb.setDirection(DcMotorSimple.Direction.REVERSE);
    claw = hw.get(Servo.class, "claw");
  }
  public void drive(double y, double x, double r) {
    double d = Math.max(Math.abs(y) + Math.abs(x) + Math.abs(r), 1);
    double[] p = { (y + x + r) / d, (y - x + r) / d, (y - x - r) / d, (y + x - r) / d };
    DcMotorEx[] m = { lf, lb, rf, rb };
    for (int i = 0; i < 4; i++) m[i].setPower(p[i]);
  }
}`;

test('vm: a TeleOp whose hardware lives in a Robot class drives', () => {
  const main = `package org.firstinspires.ftc.teamcode;
import org.firstinspires.ftc.teamcode.hw.Robot;
import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp(name="Main") public class Main extends LinearOpMode {
  Robot robot;
  public void runOpMode() {
    robot = new Robot(hardwareMap); robot.init();
    waitForStart();
    while (opModeIsActive()) {
      robot.drive(-gamepad1.left_stick_y, gamepad1.left_stick_x, gamepad1.right_stick_x);
      if (gamepad1.a) robot.claw.setPosition(0.8); else if (gamepad1.b) robot.claw.setPosition(0.2);
    }
  }
}`;
  const fwd = run({ main, libs: [{ file: 'Robot.java', src: ROBOT }] }, { left_stick_y: -1 }, 0.2);
  for (const n of ['leftFront', 'leftBack', 'rightFront', 'rightBack']) assert.ok(Math.abs(fwd.devs.get(n).cmd - 1) < 1e-9, n + ' full power');
  assert.equal(fwd.devs.get('leftFront').reversed, true);
  const a = run({ main, libs: [{ file: 'Robot.java', src: ROBOT }] }, { a: true }, 0.1);
  assert.equal(a.devs.get('claw').cmd, 0.8);
  // parseJava picks the VM, finds the four drive wheels from what the sticks do, and their corners
  const code = E.parseJava(main, { libs: [{ file: 'Robot.java', src: ROBOT }] });
  assert.equal(code.engine, 'vm');
  const dt = E.detectDrivetrain(code);
  assert.equal(dt.style, 'mecanum');
  const w = Object.fromEntries(dt.wheels.map((x) => [x.dev, x]));
  assert.ok(w.leftFront.left && w.leftFront.front && w.rightBack.right && w.rightBack.back, 'corners from turn and strafe');
  assert.ok(E.isCommanded(code, 'claw'), 'the claw is found by pressing A');
});

test('vm: Java semantics teams rely on (int division, casts, strings, switch on an enum, lambdas, exceptions)', () => {
  const main = `import com.qualcomm.robotcore.eventloop.opmode.*; import com.qualcomm.robotcore.hardware.*; import java.util.*;
@TeleOp public class T extends LinearOpMode {
  enum Mode { IDLE, UP, DOWN }
  interface Op { double apply(double v); }
  public void runOpMode() {
    DcMotor m = hardwareMap.get(DcMotor.class, "m");
    int a = 7 / 2; double b = 7 / 2.0; int c = (int) 3.9; long d = Math.round(2.5);
    String s = "a" + a + b + 'x';
    Mode mode = Mode.UP;
    double out = 0;
    switch (mode) { case IDLE: out = 0; break; case UP: out = 0.5; break; default: out = -1; }
    List<Integer> l = new ArrayList<>(); for (int i = 0; i < 4; i++) l.add(i * i);
    int sum = 0; for (int v : l) sum += v;
    Op twice = v -> v * 2;
    try { throw new IllegalStateException("x"); } catch (IllegalStateException e) { out += 0.1; } finally { out += 0.01; }
    telemetry.addData("s", s); telemetry.addData("n", a + "," + c + "," + d + "," + sum); telemetry.update();
    waitForStart();
    while (opModeIsActive()) { m.setPower(twice.apply(out) / 4); }
  }
}`;
  const r = run({ main }, {}, 0.06);
  assert.deepEqual(r.H.tel, ['s : a33.5x', 'n : 3,3,3,14']);
  assert.ok(Math.abs(r.devs.get('m').cmd - (0.61 * 2) / 4) < 1e-9);
});

test('vm: FTCLib command-based OpMode: subsystems, default command, button binding', () => {
  const sub = `package org.firstinspires.ftc.teamcode;
import com.arcrobotics.ftclib.command.SubsystemBase;
import com.qualcomm.robotcore.hardware.*;
public class Claw extends SubsystemBase { private final Servo s; public Claw(HardwareMap h){ s = h.get(Servo.class, "claw"); } public void open(){ s.setPosition(1); } public void close(){ s.setPosition(0); } }`;
  const main = `package org.firstinspires.ftc.teamcode;
import com.arcrobotics.ftclib.command.*; import com.arcrobotics.ftclib.gamepad.*; import com.arcrobotics.ftclib.drivebase.MecanumDrive; import com.arcrobotics.ftclib.hardware.motors.MotorEx;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
@TeleOp public class Cmd extends CommandOpMode {
  public void initialize() {
    GamepadEx g = new GamepadEx(gamepad1);
    Claw claw = new Claw(hardwareMap);
    MecanumDrive dr = new MecanumDrive(new MotorEx(hardwareMap, "fl"), new MotorEx(hardwareMap, "fr"), new MotorEx(hardwareMap, "bl"), new MotorEx(hardwareMap, "br"));
    schedule(new RunCommand(() -> dr.driveRobotCentric(g.getLeftX(), g.getLeftY(), g.getRightX())));
    g.getGamepadButton(GamepadKeys.Button.A).whenPressed(new InstantCommand(claw::open, claw));
    g.getGamepadButton(GamepadKeys.Button.B).whenPressed(claw::close);
  }
}`;
  const r = run({ main, libs: [{ file: 'Claw.java', src: sub }] }, { left_stick_y: -1, a: true }, 0.1);
  assert.equal(r.P.error, null);
  assert.equal(r.devs.get('claw').cmd, 1, 'A opened the claw through a command');
  // FTCLib inverts the right side itself: forward is +left, -right in the motors' own frame
  assert.ok(r.devs.get('fl').cmd > 0.99 && r.devs.get('fr').cmd < -0.99, 'stick up drives');
});

test('vm: Road Runner 1.0 setDrivePowers through the team\'s own MecanumDrive', () => {
  const drive = `package org.firstinspires.ftc.teamcode;
import com.acmerobotics.roadrunner.*; import com.qualcomm.robotcore.hardware.*;
public final class MecanumDrive {
  public final DcMotorEx leftFront, leftBack, rightBack, rightFront; public Pose2d pose;
  public MecanumDrive(HardwareMap hardwareMap, Pose2d pose) { this.pose = pose;
    leftFront = hardwareMap.get(DcMotorEx.class, "leftFront"); leftBack = hardwareMap.get(DcMotorEx.class, "leftBack");
    rightBack = hardwareMap.get(DcMotorEx.class, "rightBack"); rightFront = hardwareMap.get(DcMotorEx.class, "rightFront");
    leftFront.setDirection(DcMotorSimple.Direction.REVERSE); leftBack.setDirection(DcMotorSimple.Direction.REVERSE); }
  public void setDrivePowers(PoseVelocity2d powers) {
    MecanumKinematics.WheelVelocities<Time> wheelVels = new MecanumKinematics(1).inverse(PoseVelocity2dDual.constant(powers, 1));
    double maxPowerMag = 1;
    for (DualNum<Time> power : wheelVels.all()) maxPowerMag = Math.max(maxPowerMag, power.value());
    leftFront.setPower(wheelVels.leftFront.get(0) / maxPowerMag); leftBack.setPower(wheelVels.leftBack.get(0) / maxPowerMag);
    rightBack.setPower(wheelVels.rightBack.get(0) / maxPowerMag); rightFront.setPower(wheelVels.rightFront.get(0) / maxPowerMag);
  }
}`;
  const main = `package org.firstinspires.ftc.teamcode;
import com.acmerobotics.roadrunner.*; import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp public class RR extends LinearOpMode { public void runOpMode() {
  MecanumDrive d = new MecanumDrive(hardwareMap, new Pose2d(0, 0, 0)); waitForStart();
  while (opModeIsActive()) d.setDrivePowers(new PoseVelocity2d(new Vector2d(-gamepad1.left_stick_y, -gamepad1.left_stick_x), -gamepad1.right_stick_x));
} }`;
  const r = run({ main, libs: [{ file: 'MecanumDrive.java', src: drive }] }, { right_stick_x: 1 }, 0.06);
  // turning right: left wheels forward, right wheels back (in the wheels' own sense)
  assert.equal(Math.sign(r.devs.get('leftFront').cmd), 1);
  assert.equal(Math.sign(r.devs.get('rightFront').cmd), -1);
});

test('vm: Pedro 2.x TeleOp drive from MecanumConstants names and directions', () => {
  const consts = `package org.firstinspires.ftc.teamcode.pedro;
import com.pedropathing.follower.*; import com.pedropathing.ftc.FollowerBuilder; import com.pedropathing.ftc.drivetrains.MecanumConstants;
import com.qualcomm.robotcore.hardware.*;
public class Constants {
  public static FollowerConstants followerConstants = new FollowerConstants().mass(10);
  public static MecanumConstants driveConstants = new MecanumConstants().leftFrontMotorName("FL").leftRearMotorName("BL").rightFrontMotorName("FR").rightRearMotorName("BR")
    .leftFrontMotorDirection(DcMotorSimple.Direction.REVERSE).leftRearMotorDirection(DcMotorSimple.Direction.REVERSE).xVelocity(80);
  public static Follower createFollower(HardwareMap hardwareMap) { return new FollowerBuilder(followerConstants, hardwareMap).mecanumDrivetrain(driveConstants).pinpointLocalizer(null).build(); }
}`;
  const main = `package org.firstinspires.ftc.teamcode;
import com.pedropathing.follower.Follower; import com.qualcomm.robotcore.eventloop.opmode.*; import org.firstinspires.ftc.teamcode.pedro.Constants;
@TeleOp public class P extends OpMode { Follower f;
  public void init() { f = Constants.createFollower(hardwareMap); }
  public void start() { f.startTeleopDrive(); }
  public void loop() { f.setTeleOpDrive(-gamepad1.left_stick_y, -gamepad1.left_stick_x, -gamepad1.right_stick_x, true); f.update(); }
}`;
  const r = run({ main, libs: [{ file: 'Constants.java', src: consts }] }, { left_stick_y: -1 }, 0.06);
  assert.equal(r.P.error, null);
  for (const n of ['FL', 'BL', 'FR', 'BR']) assert.equal(r.devs.get(n).cmd, 1, n);
  assert.equal(r.devs.get('FL').reversed, true);
});

test('vm: a crash is reported with its file and line, like the Driver Station would stop', () => {
  const main = `import com.qualcomm.robotcore.eventloop.opmode.*; import com.qualcomm.robotcore.hardware.*;
@TeleOp public class C extends LinearOpMode { DcMotor m;
  public void runOpMode() {
    waitForStart();
    while (opModeIsActive()) {
      m.setPower(1);
    }
  } }`;
  const r = run({ main }, {}, 0.06);
  assert.equal(r.P.error.cls, 'NullPointerException');
  assert.equal(r.P.error.line, 6);
});

// ---- from the code review of the VM work ----
const ROBOT_DIR = (rev) => `package org.firstinspires.ftc.teamcode.hw;
import com.qualcomm.robotcore.hardware.*;
public class Robot {
  public DcMotorEx lf, lb, rf, rb, spare;
  public Robot(HardwareMap hw) {
    lf = hw.get(DcMotorEx.class, "leftFront"); lb = hw.get(DcMotorEx.class, "leftBack");
    rf = hw.get(DcMotorEx.class, "rightFront"); rb = hw.get(DcMotorEx.class, "rightBack");
    spare = hw.get(DcMotorEx.class, "spare");
    ${rev.map((n) => n + '.setDirection(DcMotorSimple.Direction.REVERSE);').join(' ')}
    spare.setDirection(DcMotorSimple.Direction.REVERSE);
  }
  public void drive(double y, double x, double r) { lf.setPower(y + x + r); lb.setPower(y - x + r); rf.setPower(y - x - r); rb.setPower(y + x - r); }
}`;
const MAIN_DIR = `package org.firstinspires.ftc.teamcode;
import org.firstinspires.ftc.teamcode.hw.Robot;
import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp(name="Dir") public class Dir extends LinearOpMode { public void runOpMode() { Robot r = new Robot(hardwareMap); waitForStart();
  while (opModeIsActive()) r.drive(-gamepad1.left_stick_y, gamepad1.left_stick_x, gamepad1.right_stick_x); } }`;

test('vm: two programs sharing an OpMode file never see each other\'s classes (parsed code is cached, so nothing per-run may live on it)', () => {
  const senses = (rev) => {
    const comp = E.jvCompile(MAIN_DIR, [{ file: 'Robot.java', src: ROBOT_DIR(rev) }]);
    return E.jvAnalyze(comp, false).drive.wheels.map((w) => w.dev + ':' + w.sense).join(' ');
  };
  const a1 = senses(['lf', 'lb']), b1 = senses(['rf', 'lb']);
  assert.notEqual(a1, b1, 'a different Robot class gives a different drive');
  assert.equal(senses(['lf', 'lb']), a1); assert.equal(senses(['rf', 'lb']), b1);
});

test('vm: a wrong setDirection still shows on a robot whose CAD has its drive motors (mounting from the CAD, not the code)', async () => {
  const { buildRobot } = await import('../tools/stepgen.mjs');
  const cad = E.parseSTEP(buildRobot('mecanum-zup').text);
  const verdict = (rev) => {
    const code = E.parseJava(MAIN_DIR, { libs: [{ file: 'Robot.java', src: ROBOT_DIR(rev) }] });
    assert.equal(code.engine, 'vm');
    const pr = E.driveProbe(code, cad, {}, { front: E.frontFromWheels(cad) || '+x' });
    let out = null; E.driveVerdict(pr, (k, sev, title, how) => { out = { sev, title, how }; });
    return out;
  };
  const right = verdict(['lf', 'lb']), wrong = verdict(['rf', 'lb']);
  assert.equal(right.sev, 'pass', right.title);
  assert.equal(wrong.sev, 'fail', 'reversing the wrong motor is caught: ' + wrong.title);
  assert.ok(/from the CAD/.test(right.how));
});

test('vm: setDirection alone isn\'t moving a device; the controls list comes from pressing them', () => {
  const code = E.parseJava(MAIN_DIR, { libs: [{ file: 'Robot.java', src: ROBOT_DIR(['lf', 'lb']) }] });
  assert.equal(E.isCommanded(code, 'spare'), false, 'spare is only reversed, never moved');
  assert.equal(E.isCommanded(code, 'leftFront'), true);
  // the devices are named by their configuration name, the variable kept as an alias
  const lf = code.devices.find((d) => d.name === 'leftFront');
  assert.equal(lf.alias, 'lf');
});

test('mapping: two motors named alike share a lift; two servos named alike stay apart (a mirrored pair)', () => {
  const mechs = [{ id: 'Lift', kind: 'linear' }, { id: 'Arm', kind: 'revolute-lift' }];
  const m = E.autoMap([
    { name: 'liftLeft', type: 'DcMotorEx', cfg: 'liftLeft' }, { name: 'liftRight', type: 'DcMotorEx', cfg: 'liftRight' },
    { name: 'armL', type: 'Servo', cfg: 'armL' }, { name: 'armR', type: 'Servo', cfg: 'armR' }], mechs);
  assert.equal(m.liftLeft, 'Lift'); assert.equal(m.liftRight, 'Lift');
  assert.equal([m.armL, m.armR].filter((x) => x === 'Arm').length, 1);
});

test('vm: DcMotor.Direction and DcMotorEx.Direction are DcMotorSimple.Direction (the SDK interface tree)', () => {
  const senses = (how) => {
    const robot = ROBOT_DIR(['lf', 'lb']).replace(/DcMotorSimple\.Direction/g, how);
    const comp = E.jvCompile(MAIN_DIR, [{ file: 'Robot.java', src: robot }]);
    const an = E.jvAnalyze(comp, false);
    assert.deepEqual(an.stubs.filter((s) => /Direction/.test(s[0])), [], how + ' resolves');
    return an.drive.wheels.map((w) => w.dev + ':' + w.sense).join(' ');
  };
  const want = senses('DcMotorSimple.Direction');
  assert.equal(senses('DcMotor.Direction'), want);
  assert.equal(senses('DcMotorEx.Direction'), want);
});

test('vm: a drive left in STOP_AND_RESET_ENCODER is called out (the SDK keeps it still)', async () => {
  const { buildRobot } = await import('../tools/stepgen.mjs');
  const cad = E.parseSTEP(buildRobot('mecanum-zup').text);
  const robot = ROBOT_DIR(['lf', 'lb']).replace('spare.setDirection(DcMotorSimple.Direction.REVERSE);',
    'spare.setDirection(DcMotorSimple.Direction.REVERSE); lf.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER); rf.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);');
  const code = E.parseJava(MAIN_DIR, { libs: [{ file: 'Robot.java', src: robot }] });
  assert.equal(code.engine, 'vm');
  assert.deepEqual(code.vm.an.heldByReset.sort(), ['leftFront', 'rightFront']);
  const F = E.analyze(code, cad, {}, {});
  const f = F.find((x) => x.key === 'mode:reset');
  assert.ok(f && f.sev === 'fail' && /RUN_WITHOUT_ENCODER/.test(f.fix), 'the fix is named');
});

test('vm: a drive that turns with the triggers, and an extension that half-follows the stick, gives four wheels on the right sides', () => {
  const robot = ROBOT_DIR(['lf', 'lb']).replace('public void drive(', 'public DcMotorEx ext; public void drive(');
  const main = `package org.firstinspires.ftc.teamcode;
import org.firstinspires.ftc.teamcode.hw.Robot;
import com.qualcomm.robotcore.hardware.*;
import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp(name="Trig") public class Trig extends LinearOpMode { public void runOpMode() { Robot r = new Robot(hardwareMap);
  DcMotorEx ext = hardwareMap.get(DcMotorEx.class, "extension"); waitForStart();
  while (opModeIsActive()) { r.drive(-gamepad1.left_stick_y, gamepad1.left_stick_x, gamepad1.right_trigger - gamepad1.left_trigger);
    ext.setPower(0.4 * -gamepad1.left_stick_y); } } }`;
  const an = E.jvAnalyze(E.jvCompile(main, [{ file: 'Robot.java', src: robot }]), false);
  const w = an.drive.wheels.map((x) => x.dev + ':' + (x.left ? 'L' : x.right ? 'R' : '?')).sort();
  assert.deepEqual(w, ['leftBack:L', 'leftFront:L', 'rightBack:R', 'rightFront:R']);
});

test('vm: the Pinpoint\'s Road Runner bridge gives Road Runner poses (field-centric code reads a real heading)', () => {
  const main = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver; import com.acmerobotics.roadrunner.*;
import com.qualcomm.robotcore.hardware.*; import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp(name="Pin") public class Pin extends LinearOpMode { public void runOpMode() {
  GoBildaPinpointDriver pin = hardwareMap.get(GoBildaPinpointDriver.class, "pinpoint");
  DcMotor m = hardwareMap.get(DcMotor.class, "m");
  pin.setPositionRR(new Pose2d(10, 20, Math.PI / 2)); waitForStart();
  while (opModeIsActive()) { Pose2d p = pin.getPositionRR(); PoseVelocity2d v = pin.getVelocityRR();
    telemetry.addData("pose", p.position.x + "," + p.position.y + "," + p.heading.toDouble()); telemetry.addData("w", v.angVel); telemetry.update();
    m.setPower(p.heading.toDouble()); } } }`;
  const an = E.jvAnalyze(E.jvCompile(main, []), false);
  assert.deepEqual(an.stubs.filter((s) => /RR|toDouble/.test(s[0])), []);
  const pose = an.telemetry.find((l) => /^pose/.test(l));
  const [x, y, h] = pose.split(' : ')[1].split(',').map(Number);
  assert.ok(Math.abs(x - 10) < 1e-6 && Math.abs(y - 20) < 1e-6 && Math.abs(h - Math.PI / 2) < 1e-6, pose);
});

test('vm: the IMU reports the robot\'s heading (getRobotYawPitchRollAngles), with a real gyro\'s small noise', () => {
  const src = `package x; import com.qualcomm.robotcore.hardware.*; import com.qualcomm.robotcore.eventloop.opmode.*; import org.firstinspires.ftc.robotcore.external.navigation.*;
@TeleOp public class D extends LinearOpMode { public void runOpMode(){ IMU imu = hardwareMap.get(IMU.class, "imu"); waitForStart();
  while (opModeIsActive()) { telemetry.addData("yaw", imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES)); telemetry.update(); } } }`;
  const H = E.jvProbeHost(), P = new E.JvProgram(E.jvCompile(src, []), H.host);
  P.init(); P.settle(8); P.start();
  H.h = 0.5; for (let k = 0; k < 3; k++) { H.clock += 0.02; P.tick(); }
  const yaw = +H.tel.find((l) => /^yaw/.test(l)).split(' : ')[1];
  assert.ok(Math.abs(yaw - 0.5 * 180 / Math.PI) < 0.05, 'reads the heading: ' + yaw);
  assert.notEqual(yaw, 0.5 * 180 / Math.PI, 'not a perfect gyro');
});

test('vm: a heading hold that only acts when off its target still drives (a real gyro is never exactly on it)', () => {
  const robot = ROBOT_DIR(['lf', 'lb']);
  const main = `package org.firstinspires.ftc.teamcode;
import org.firstinspires.ftc.teamcode.hw.Robot;
import com.qualcomm.robotcore.hardware.*; import com.qualcomm.robotcore.eventloop.opmode.*; import org.firstinspires.ftc.robotcore.external.navigation.*;
@TeleOp(name="Hold") public class Hold extends LinearOpMode { public void runOpMode() { Robot r = new Robot(hardwareMap);
  IMU a = hardwareMap.get(IMU.class, "imu"), b = hardwareMap.get(IMU.class, "imu"); double target = 0; waitForStart();
  while (opModeIsActive()) { if (Math.abs(gamepad1.right_stick_x) < 0.05) { target = a.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
      double err = target - b.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
      if (err > 0) r.drive(-gamepad1.left_stick_y, gamepad1.left_stick_x, 0.01); if (err < 0) r.drive(-gamepad1.left_stick_y, gamepad1.left_stick_x, -0.01); }
    else r.drive(-gamepad1.left_stick_y, gamepad1.left_stick_x, gamepad1.right_stick_x); } } }`;
  const an = E.jvAnalyze(E.jvCompile(main, [{ file: 'Robot.java', src: robot }]), false);
  assert.ok(an.drive && an.drive.wheels.length === 4, 'stick up drives: ' + JSON.stringify(an.drive));
});

test('vm: a Road Runner 1.0 dead-wheel localizer runs (OverflowEncoder, RawEncoder, Twist2dDual)', () => {
  const loc = `package org.firstinspires.ftc.teamcode;
import com.acmerobotics.roadrunner.*; import com.acmerobotics.roadrunner.ftc.*; import com.qualcomm.robotcore.hardware.*;
public class Loc { public final Encoder par; int last; boolean init;
  public Loc(HardwareMap hw){ par = new OverflowEncoder(new RawEncoder(hw.get(DcMotorEx.class, "par"))); par.setDirection(DcMotorSimple.Direction.REVERSE); }
  public Twist2dDual<Time> update(){ PositionVelocityPair p = par.getPositionAndVelocity();
    if (!init) { init = true; last = p.position; return new Twist2dDual<>(Vector2dDual.constant(new Vector2d(0, 0), 2), DualNum.constant(0, 2)); }
    int d = p.position - last; last = p.position;
    return new Twist2dDual<>(new Vector2dDual<>(new DualNum<Time>(new double[]{ d * 0.001, p.velocity * 0.001 }), new DualNum<Time>(new double[]{ 0, 0 })), new DualNum<>(new double[]{ 0, 0 })); } }`;
  const main = `package org.firstinspires.ftc.teamcode;
import com.acmerobotics.roadrunner.*; import com.qualcomm.robotcore.hardware.*; import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp(name="RR") public class RR extends LinearOpMode { public void runOpMode() { Loc l = new Loc(hardwareMap); DcMotorEx m = hardwareMap.get(DcMotorEx.class, "m");
  Pose2d pose = new Pose2d(0, 0, 0); waitForStart();
  while (opModeIsActive()) { Twist2dDual<Time> t = l.update(); pose = pose.plus(t.value()); PoseVelocity2d v = t.velocity().value();
    telemetry.addData("x", pose.position.x); telemetry.update(); m.setPower(-gamepad1.left_stick_y); } } }`;
  const an = E.jvAnalyze(E.jvCompile(main, [{ file: 'Loc.java', src: loc }]), false);
  assert.equal(an.error, null);
  assert.deepEqual(an.stubs.filter((s) => /Encoder|Twist|Dual|PositionVelocity/.test(s[0])), []);
});

test('vm: an INIT that waits for a RUN_TO_POSITION slide finishes (the slide moves meanwhile); an endless one is called out', () => {
  const op = (wait) => `package x; import com.qualcomm.robotcore.hardware.*; import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp public class W extends OpMode { DcMotorEx slide, lf;
  public void init() { slide = hardwareMap.get(DcMotorEx.class, "slide"); lf = hardwareMap.get(DcMotorEx.class, "lf");
    slide.setTargetPosition(300); slide.setMode(DcMotor.RunMode.RUN_TO_POSITION); slide.setPower(1);
    ${wait} }
  public void loop() { lf.setPower(-gamepad1.left_stick_y); } }`;
  const H = E.jvProbeHost(), P = new E.JvProgram(E.jvCompile(op('while (slide.getTargetPosition() != slide.getCurrentPosition()) { }'), []), H.host);
  const t0 = Date.now(); P.init();
  assert.equal(P.error, null, 'INIT returned');
  assert.ok(Date.now() - t0 < 5000);
  const Q = new E.JvProgram(E.jvCompile(op('while (true) { }'), []), E.jvProbeHost().host);
  Q.init();
  assert.equal(Q.error && Q.error.cls, 'Hang', 'an endless INIT says so');
});

test('VM: a StackOverflowError the code catches leaves the call depth where it was, so the next one comes at the same depth', () => {
  const main = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*;
@TeleOp(name="Deep")
public class Deep extends LinearOpMode {
  int d = 0;
  void down() { d++; down(); }
  int once() { d = 0; try { down(); } catch (StackOverflowError e) { } return d; }
  @Override public void runOpMode() {
    waitForStart();
    int a = once(), b = once(), c = once();
    telemetry.addData("depths", a + " " + b + " " + c);
    telemetry.update();
    while (opModeIsActive()) { idle(); }
  }
}`;
  const { P, H } = run({ main }, {}, 0.1);
  assert.equal(P.error, null, JSON.stringify(P.error));
  const line = (H.tel || []).find((l) => /depths/.test(l)) || '';
  const [a, b, c] = line.replace(/^.*: /, '').split(' ').map(Number);
  assert.ok(a > 100, line);
  assert.equal(b, a, line);
  assert.equal(c, a, line);
});
