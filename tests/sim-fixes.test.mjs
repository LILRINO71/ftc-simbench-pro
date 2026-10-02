// Bugs found in a hunt through the simulator, one test each. Each one failed
// before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, sampleBench, run } from './load.mjs';

const E = loadEngine();

// a plain four-motor autonomous: drive forward at half power for 1.5 s
const VM_AUTO = `
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
@Autonomous(name = "DriveAuto")
public class DriveAuto extends LinearOpMode {
    DcMotor frontLeft, frontRight, backLeft, backRight;
    void drive(double p, long ms) {
        frontLeft.setPower(p); backLeft.setPower(p); frontRight.setPower(p); backRight.setPower(p);
        sleep(ms);
        frontLeft.setPower(0); backLeft.setPower(0); frontRight.setPower(0); backRight.setPower(0);
    }
    @Override
    public void runOpMode() {
        frontLeft = hardwareMap.get(DcMotor.class, "frontLeft");
        frontRight = hardwareMap.get(DcMotor.class, "frontRight");
        backLeft = hardwareMap.get(DcMotor.class, "backLeft");
        backRight = hardwareMap.get(DcMotor.class, "backRight");
        frontLeft.setDirection(DcMotor.Direction.REVERSE);
        backLeft.setDirection(DcMotor.Direction.REVERSE);
        waitForStart();
        drive(0.5, 1500);
    }
}`;

test('an autonomous on the Java VM drives the robot, with no Road Runner', () => {
  const b = sampleBench(E, VM_AUTO);
  assert.ok(b.code.vm, 'runs on the VM');
  assert.equal(b.code.hasLoop, false, 'an autonomous');
  const dt = E.detectDrivetrain(b.code);
  assert.ok(dt && dt.ok, 'drive motors found by name');
  assert.deepEqual(dt.wheels.map((w) => w.dev).sort(), ['backLeft', 'backRight', 'frontLeft', 'frontRight']);
  for (const physics of ['rigid', 'kinematic']) {
    E.Sim.reset(b.code, b.cad, b.map, { ...b.opts, physics });
    run(E, 1);
    assert.ok(E.Sim.chassis.x > 0.2, `${physics}: drove forward, x=${E.Sim.chassis.x.toFixed(3)}`);
    assert.ok(Math.abs(E.Sim.chassis.h) < 0.1, `${physics}: straight, h=${E.Sim.chassis.h.toFixed(3)}`);
  }
});

test('a VM TeleOp whose sticks drive nothing still has no drivetrain', () => {
  const java = VM_AUTO.replace('@Autonomous(name = "DriveAuto")', '@TeleOp(name = "DriveAuto")')
    .replace('drive(0.5, 1500);', 'while (opModeIsActive()) { if (gamepad1.a) drive(0.5, 100); }');
  const code = E.parseJava(java, { engine: 'vm' });
  assert.ok(code.vm && code.hasLoop);
  assert.equal(E.detectDrivetrain(code), null, 'buttons, not sticks: the name rule is for autos only');
});

test('getYaw(AngleUnit.DEGREES) and getYaw() read degrees on the line reader, as on the robot', () => {
  const java = `
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.DcMotor;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
@Autonomous(name = "Turn90")
public class Turn90 extends LinearOpMode {
    DcMotor leftDrive, rightDrive;
    IMU imu;
    @Override
    public void runOpMode() {
        leftDrive = hardwareMap.get(DcMotor.class, "leftDrive");
        rightDrive = hardwareMap.get(DcMotor.class, "rightDrive");
        imu = hardwareMap.get(IMU.class, "imu");
        leftDrive.setDirection(DcMotor.Direction.REVERSE);
        waitForStart();
        while (opModeIsActive() && imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES) < 90) {
            leftDrive.setPower(-0.3);
            rightDrive.setPower(0.3);
        }
        leftDrive.setPower(0);
        rightDrive.setPower(0);
    }
}`;
  const b = sampleBench(E, java);
  assert.ok(!b.code.vm, 'the line reader');
  E.Sim.reset(b.code, b.cad, b.map, { ...b.opts, physics: 'kinematic' });
  run(E, 6);
  const deg = E.Sim.chassis.h * 180 / Math.PI;
  assert.ok(deg > 85 && deg < 110, 'stopped near 90 degrees, at ' + deg.toFixed(1));
  assert.ok(Math.abs(E.Sim.dev.rightDrive.act) < 0.01, 'and stopped turning');
  assert.equal(E.normalizeExpr('imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS)'), '__imuYaw');
});

const LIFT = `
@TeleOp(name = "t")
public class T extends LinearOpMode {
    DcMotorEx lift;
    @Override
    public void runOpMode() {
        lift = hardwareMap.get(DcMotorEx.class, "lift");
        waitForStart();
        while (opModeIsActive()) {
            if (gamepad1.a) { lift.setPower(1); } else if (gamepad1.b) { lift.setPower(-1); } else { lift.setPower(0); }
        }
    }
}`;
test('a slide flipped with its direction button stops where the view draws it', () => {
  for (const btn of ['a', 'b']) {
    const b = sampleBench(E, LIFT);
    const m = b.cad.mechs[0];
    Object.assign(m, { kind: 'linear', axis: [0, 0, 1], limits: [0, 0.30], dir: -1, fromMate: { type: 'SLIDER' } });
    b.map.lift = m.id;
    E.Sim.reset(b.code, b.cad, b.map, b.opts);
    E.Sim.pad = { 1: { [btn]: true }, 2: {} };
    run(E, 3);
    const q = E.mateJointQ(m, E.Sim.dev.lift, 0.5);
    assert.ok(q >= -1e-6 && q <= 0.30 + 1e-6, `press ${btn}: the slide stays inside its stops, at ${q.toFixed(3)} m`);
    if (btn === 'b') assert.ok(q > 0.29, 'with the direction flipped, b runs it to the top stop: ' + q.toFixed(3));
  }
});

test('a REV Core Hex motor counts 288 per output turn', () => {
  const java = `
@TeleOp(name = "t")
public class T extends LinearOpMode {
    DcMotor arm;
    @Override
    public void runOpMode() {
        arm = hardwareMap.get(DcMotor.class, "arm");
        arm.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        arm.setTargetPosition(288);
        arm.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        arm.setPower(0.5);
        waitForStart();
        while (opModeIsActive()) { telemetry.addData("p", arm.getCurrentPosition()); }
    }
}`;
  const b = sampleBench(E, java);
  b.cad.mechs.find((x) => x.id === b.map.arm).part = 'REV-41-1300';
  E.Sim.reset(b.code, b.cad, b.map, b.opts);
  run(E, 5);
  const s = E.Sim.dev.arm;
  assert.equal(s.tpr, 288);
  assert.ok(Math.abs(s.revs - 1) < 0.05, 'one output turn for 288 counts, turned ' + s.revs.toFixed(3));
  assert.equal(E.motorTpr({ ratio: 19.2 }), 28 * 19.2, 'goBILDA: 28 per motor turn through the gearbox');
});

test('resetRuntime() restarts the OpMode\'s runtime, not the match clock', () => {
  const java = `
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.Servo;
@TeleOp(name = "Iter")
public class Iter extends OpMode {
    Servo claw;
    @Override public void init() { claw = hardwareMap.get(Servo.class, "claw"); }
    @Override public void start() { resetRuntime(); }
    @Override public void loop() {
        telemetry.addData("loop ms", getRuntime() * 1000);
        resetRuntime();
        claw.setPosition(gamepad1.a ? 1 : 0);
    }
}`;
  const b = sampleBench(E, java);
  E.Sim.reset(b.code, b.cad, b.map, b.opts);
  run(E, 10);
  assert.ok(E.Sim.t > 9.9, 'the match clock ran: ' + E.Sim.t.toFixed(2));
});

test('the drive check (driveProbe) never moves the live shots', () => {
  const java = `
@TeleOp(name = "t")
public class T extends LinearOpMode {
    DcMotor leftDrive, rightDrive;
    @Override
    public void runOpMode() {
        leftDrive = hardwareMap.get(DcMotor.class, "leftDrive");
        rightDrive = hardwareMap.get(DcMotor.class, "rightDrive");
        leftDrive.setDirection(DcMotor.Direction.REVERSE);
        waitForStart();
        while (opModeIsActive()) {
            leftDrive.setPower(-gamepad1.left_stick_y + gamepad1.right_stick_x);
            rightDrive.setPower(-gamepad1.left_stick_y - gamepad1.right_stick_x);
        }
    }
}`;
  const b = sampleBench(E, java);
  E.Sim.reset(b.code, b.cad, b.map, b.opts);
  run(E, 0.2);
  E.Shots.flying.push({ t: 0, dur: 5, path: [[0, 0, 0], [10, 10, 10]], pos: [0, 0, 0], kind: 'x', color: 'red', al: 'red', hit: false });
  const t0 = E.Shots.t, f0 = E.Shots.flying.at(-1).t;
  assert.ok(E.driveProbe(b.code, b.cad, b.map, b.opts), 'the probe ran');
  assert.equal(E.Shots.t, t0, 'the shot clock');
  assert.equal(E.Shots.flying.at(-1).t, f0, 'the shot in flight');
  E.Shots.flying.pop();
});

test('drive encoders count how far the wheels rolled, so an encoder auto drives the distance it asks for', () => {
  const java = `
@Autonomous(name = "Enc24")
public class Enc24 extends LinearOpMode {
    DcMotor leftDrive, rightDrive;
    @Override
    public void runOpMode() {
        leftDrive = hardwareMap.get(DcMotor.class, "leftDrive");
        rightDrive = hardwareMap.get(DcMotor.class, "rightDrive");
        leftDrive.setDirection(DcMotor.Direction.REVERSE);
        leftDrive.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        rightDrive.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        leftDrive.setTargetPosition(1500);
        rightDrive.setTargetPosition(1500);
        leftDrive.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        rightDrive.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        waitForStart();
        leftDrive.setPower(0.5);
        rightDrive.setPower(0.5);
        while (opModeIsActive() && (leftDrive.isBusy() || rightDrive.isBusy())) {
            idle();
        }
        leftDrive.setPower(0);
        rightDrive.setPower(0);
    }
}`;
  for (const physics of ['rigid', 'kinematic']) {
    const b = sampleBench(E, java);
    E.Sim.reset(b.code, b.cad, b.map, { ...b.opts, physics });
    run(E, 6);
    const s = E.Sim.dev.rightDrive, r = E.Sim.rig.drive.wheels[0].r;
    const rolled = E.Sim.env().device('rightDrive', 'getCurrentPosition') / s.tpr * 2 * Math.PI * r;
    const moved = Math.hypot(E.Sim.chassis.x, E.Sim.chassis.y);
    assert.ok(Math.abs(rolled - 1500 / s.tpr * 2 * Math.PI * r) < 0.03, `${physics}: reached its target`);
    assert.ok(Math.abs(moved - rolled) < 0.03 * rolled + 0.01, `${physics}: the encoders say ${rolled.toFixed(3)} m, the robot moved ${moved.toFixed(3)} m`);
  }
});
