// Motor direction, the way a real robot has it. The FTC SDK turns a motor's
// output shaft clockwise (seen from the shaft end) for positive power under
// Direction.FORWARD. On a robot whose drive motors sit inboard with their
// shafts pointing out at the wheels — nearly every FTC chassis — that drives
// the right wheels forward and the left wheels backward, so a program reverses
// the LEFT side (the SDK's own samples do). The bench used to ignore
// setDirection and treat every wheel as "positive is forward", so code that
// works on a real robot drove backwards, turned the wrong way, or spun.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, fixture, run } from './load.mjs';

// no field: nothing to bump into, so every motion is the drive's own
const E = loadEngine();
const START = { x: 0, y: 0, h: 0 };

// mecanum drive, the SDK way: left side reversed, y = -stick
const SDK_JAVA = `
@TeleOp(name = "SDK mecanum")
public class SdkMecanum extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor leftFront = hardwareMap.get(DcMotor.class, "leftFront");
        DcMotor leftBack = hardwareMap.get(DcMotor.class, "leftBack");
        DcMotor rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        DcMotor rightBack = hardwareMap.get(DcMotor.class, "rightBack");
        leftFront.setDirection(DcMotor.Direction.REVERSE);
        leftBack.setDirection(DcMotor.Direction.REVERSE);
        waitForStart();
        while (opModeIsActive()) {
            double y = -gamepad1.left_stick_y;
            double x = gamepad1.left_stick_x;
            double rx = gamepad1.right_stick_x;
            leftFront.setPower(y + x + rx);
            leftBack.setPower(y - x + rx);
            rightFront.setPower(y - x - rx);
            rightBack.setPower(y + x - rx);
        }
    }
}`;

// GearGurus 7832's field-centric TeleOp (BAL.java, 2024-25), drive part as
// written: RIGHT side reversed and every stick negated. Equivalent to the SDK
// way, and it drove a world-level robot, so the bench has to drive it too.
const BAL_JAVA = `
@TeleOp(name = "balanced")
public class BAL extends LinearOpMode {
    @Override
    public void runOpMode() throws InterruptedException {
        DcMotor frontLeftMotor = hardwareMap.dcMotor.get("fL");
        DcMotor backLeftMotor = hardwareMap.dcMotor.get("bL");
        DcMotor frontRightMotor = hardwareMap.dcMotor.get("fR");
        DcMotor backRightMotor = hardwareMap.dcMotor.get("bR");
        frontRightMotor.setDirection(DcMotorSimple.Direction.REVERSE);
        backRightMotor.setDirection(DcMotorSimple.Direction.REVERSE);
        IMU imu = hardwareMap.get(IMU.class, "imu");
        waitForStart();
        if (isStopRequested()) return;
        while (opModeIsActive()) {
            if (gamepad1.options) {
                imu.resetYaw();
            }
            double botHeading = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS);
            double y = gamepad1.left_stick_y * 1;
            double x = -gamepad1.left_stick_x * 1;
            double rx = -gamepad1.right_stick_x * 1;
            double rotX = x * Math.cos(-botHeading) - y * Math.sin(-botHeading);
            double rotY = x * Math.sin(-botHeading) + y * Math.cos(-botHeading);
            rotX = rotX * 1.1;
            double denominator = Math.max(Math.abs(rotY) + Math.abs(rotX) + Math.abs(rx), 1);
            double frontLeftPower = (rotY + rotX + rx) / denominator;
            double backLeftPower = (rotY - rotX + rx) / denominator;
            double frontRightPower = (rotY - rotX - rx) / denominator;
            double backRightPower = (rotY + rotX - rx) / denominator;
            frontLeftMotor.setPower(frontLeftPower);
            backLeftMotor.setPower(backLeftPower);
            frontRightMotor.setPower(frontRightPower);
            backRightMotor.setPower(backRightPower);
        }
    }
}`;

// gm0's sample reverses the RIGHT side with ordinary stick signs. On an
// inboard-motor chassis that runs every axis backwards — which is why teams
// like 7832 negated all three sticks. The bench should say so, not hide it.
const GM0_JAVA = SDK_JAVA
  .replace('leftFront.setDirection', 'rightFront.setDirection')
  .replace('leftBack.setDirection', 'rightBack.setDirection');

function bench(java, cadName, opts = {}) {
  const cad = opts.cad || E.parseSTEP(fixture('robots/' + cadName + '.step'));
  const code = E.parseJava(java);
  const map = E.autoMap(code.devices, cad.mechs);
  E.Sim.reset(code, cad, map, { payloadKg: 0, duty: 0.3, trust: 'code', physics: opts.physics || 'rigid', startPose: { ...START }, front: opts.front });
  return cad;
}

// drive for `s` seconds with one gamepad1 input; report motion in the robot's
// own starting frame: fwd along the front, left to its left, turn CCW positive
function drive(pad, s = 0.8) {
  const h0 = E.Sim.chassis.h, x0 = E.Sim.chassis.x, y0 = E.Sim.chassis.y;
  E.Sim.pad = { 1: pad, 2: {} };
  run(E, s);
  const dx = E.Sim.chassis.x - x0, dy = E.Sim.chassis.y - y0;
  const out = { fwd: dx * Math.cos(h0) + dy * Math.sin(h0), left: -dx * Math.sin(h0) + dy * Math.cos(h0), turn: E.Sim.chassis.h - h0 };
  E.Sim.pad = { 1: {}, 2: {} };
  run(E, 0.6);                                    // coast to a stop between moves
  return out;
}

function expectDriverFeel(java, cadName, label, opts) {
  for (const physics of ['rigid', 'kinematic']) {
    // a fresh robot for every move, so one can't leak into the next
    const fresh = () => bench(java, cadName, { ...opts, cad: opts && opts.cad ? structuredClone(opts.cad) : undefined, physics });
    fresh();
    const up = drive({ left_stick_y: -1 });
    assert.ok(up.fwd > 0.25 && Math.abs(up.turn) < 0.2, `${label} ${physics}: stick up must drive forward (fwd ${up.fwd.toFixed(3)} m, turn ${up.turn.toFixed(2)} rad)`);
    fresh();
    const right = drive({ right_stick_x: 1 });
    assert.ok(right.turn < -0.4, `${label} ${physics}: right stick right must turn clockwise (turn ${right.turn.toFixed(2)} rad)`);
    fresh();
    const strafe = drive({ left_stick_x: 1 });
    assert.ok(strafe.left < -0.15 && Math.abs(strafe.turn) < 0.3, `${label} ${physics}: left stick right must strafe right (left ${strafe.left.toFixed(3)} m, turn ${strafe.turn.toFixed(2)})`);
  }
}

test('the CAD says which way each drive motor faces: inboard motors, shafts out', () => {
  const cad = E.parseSTEP(fixture('robots/mecanum-zup.step'));
  const g = E.driveFromCAD(cad, { front: '+x' });
  assert.equal(g.kind, 'mecanum');
  for (const w of g.wheels) {
    assert.equal(w.mountHow, 'direct', `${w.corner}: motor found on the axle`);
    // the shaft points out, away from the robot's centre line
    assert.ok(Math.sign(w.shaft[1]) === Math.sign(w.y), `${w.corner}: shaft points outward (${w.shaft.map((v) => v.toFixed(2))})`);
    assert.equal(w.mount, w.y > 0 ? -1 : 1, `${w.corner}: positive power drives ${w.y > 0 ? 'left wheels backward' : 'right wheels forward'}`);
  }
  assert.ok(g.why.some((s) => /reverse/i.test(s) && /left/i.test(s)), 'the explanation names the side to reverse: ' + g.why.join(' | '));
});

test('SDK-convention mecanum code drives, turns and strafes the way the driver pushes', () => {
  expectDriverFeel(SDK_JAVA, 'mecanum-zup', 'SDK');
});

test('7832 BAL.java drive code (right reversed, sticks negated) drives right too', () => {
  expectDriverFeel(BAL_JAVA, 'mecanum-zup', 'BAL');
});

test('gm0-style code (right reversed, plain sticks) runs backwards on an inboard chassis, as on a real one', () => {
  bench(GM0_JAVA, 'mecanum-zup');
  const up = drive({ left_stick_y: -1 });
  assert.ok(up.fwd < -0.25, `stick up drives backward (fwd ${up.fwd.toFixed(3)})`);
  const right = drive({ right_stick_x: 1 });
  assert.ok(right.turn > 0.4, `right stick turns counter-clockwise (turn ${right.turn.toFixed(2)})`);
});

test('motors moved outboard flip the side that needs reversing', () => {
  const cad = E.parseSTEP(fixture('robots/mecanum-zup.step'));
  // mirror every motor to the far side of its wheel along the axle
  const g0 = E.driveFromCAD(cad, { front: '+x' });
  const wheelY = g0.wheels.map((w) => w.y);
  const yW = Math.max(...wheelY.map(Math.abs));
  for (const s of cad.solids) if (/motor/i.test(s.name)) s.pts = s.pts.map((p) => [p[0], p[1] + 2 * (Math.sign(p[1]) * yW - p[1]) * 1, p[2]]);
  const g = E.driveFromCAD(cad, { front: '+x' });
  for (const w of g.wheels) assert.equal(w.mount, w.y > 0 ? 1 : -1, `${w.corner}: outboard motor flips the mount`);
  bench(GM0_JAVA, null, { cad });
  const up = drive({ left_stick_y: -1 });
  assert.ok(up.fwd > 0.25, `with outboard motors the right-reversed code drives forward (fwd ${up.fwd.toFixed(3)})`);
});

test('a CAD with no motors is assumed built the standard way, and says so', () => {
  const cad = E.parseSTEP(fixture('robots/mecanum-zup.step'));
  cad.solids = cad.solids.filter((s) => !/motor/i.test(s.name));
  const g = E.driveFromCAD(cad, { front: '+x' });
  for (const w of g.wheels) {
    assert.equal(w.mountHow, 'assumed');
    assert.equal(w.mount, w.y > 0 ? -1 : 1);
  }
  assert.ok(g.why.some((s) => /no drive motor/i.test(s)), g.why.join(' | '));
  expectDriverFeel(SDK_JAVA, null, 'SDK, no motors', { cad });
});

test('chain-driven wheels take the direction of the motor they are chained to', () => {
  const cad = E.parseSTEP(fixture('robots/tank-traction.step'));
  const g = E.driveFromCAD(cad, { front: '+x' });
  const front = g.wheels.filter((w) => w.x > 0), back = g.wheels.filter((w) => w.x < 0);
  assert.ok(back.every((w) => w.mountHow === 'direct'), 'the back wheels carry the motors');
  assert.ok(front.every((w) => w.mountHow === 'chain'), 'the front wheels are chained: ' + front.map((w) => w.mountHow));
  for (const w of g.wheels) assert.equal(w.mount, w.y > 0 ? -1 : 1);
});

test('the IMU reads yaw from where the robot pointed at INIT, and resetYaw does not turn the robot', () => {
  bench(BAL_JAVA, 'mecanum-zup');
  E.Sim.chassis.h = 1.0;                          // placed at an angle on the field
  E.Sim.init(); E.Sim.start();
  const env = E.Sim.env();
  assert.ok(Math.abs(env.get('__imuYaw')) < 1e-9, 'yaw is zero at INIT, whatever the field heading');
  E.Sim.pad = { 1: { right_stick_x: 1 }, 2: {} };
  run(E, 0.5);
  const turned = E.Sim.chassis.h - 1.0;
  assert.ok(Math.abs(E.Sim.env().get('__imuYaw') - turned) < 1e-6, 'yaw follows the turn since INIT');
  E.Sim.pad = { 1: {}, 2: {} };
  run(E, 1.5);                                    // let it stop turning
  const h = E.Sim.chassis.h;
  E.Sim.pad = { 1: { options: true }, 2: {} };
  run(E, 0.02);
  assert.ok(Math.abs(E.Sim.chassis.h - h) < 1e-3, 'resetYaw leaves the robot where it is');
  assert.ok(Math.abs(E.Sim.env().get('__imuYaw')) < 0.01, 'and zeroes the reading');
});

// ---- the Checks tab: does the code drive THIS robot the way a driver expects?
const verdict = (java) => {
  const cad = E.parseSTEP(fixture('robots/mecanum-zup.step'));
  const code = E.parseJava(java);
  const map = E.autoMap(code.devices, cad.mechs);
  const F = E.analyze(code, cad, map, { payloadKg: 0, duty: 0.3, trust: 'code' });
  return F.find((f) => f.key === 'drive:feel');
};

test('Checks: SDK-style and BAL-style code pass the drive check; gm0-style fails, saying what goes wrong', () => {
  assert.equal(verdict(SDK_JAVA).sev, 'pass');
  assert.equal(verdict(BAL_JAVA).sev, 'pass', 'BAL.java drives this robot correctly, so no stick-sign warning either');
  const g = verdict(GM0_JAVA);
  assert.equal(g.sev, 'fail');
  assert.match(g.title, /backward/);
  assert.match(g.title, /turns it <b>left<\/b>/);
  assert.match(g.body, /leftFront/, 'names the motors that push backward as mounted');
  const live = E.Sim.phase;
  verdict(SDK_JAVA);
  assert.equal(E.Sim.phase, live, 'the probe never touches the live sim');
});

test('sleep() in the TeleOp loop pauses the loop and motors keep their last power; every-pass sleeps warn', () => {
  const java = `
@TeleOp(name = "s")
public class S extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor leftFront = hardwareMap.get(DcMotor.class, "leftFront");
        DcMotor leftBack = hardwareMap.get(DcMotor.class, "leftBack");
        DcMotor rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        DcMotor rightBack = hardwareMap.get(DcMotor.class, "rightBack");
        Servo claw = hardwareMap.get(Servo.class, "claw");
        leftFront.setDirection(DcMotor.Direction.REVERSE);
        leftBack.setDirection(DcMotor.Direction.REVERSE);
        waitForStart();
        while (opModeIsActive()) {
            double y = -gamepad1.left_stick_y;
            leftFront.setPower(y);
            leftBack.setPower(y);
            rightFront.setPower(y);
            rightBack.setPower(y);
            if (gamepad1.a) {
                claw.setPosition(0.9);
                sleep(500);
                claw.setPosition(0.1);
            }
        }
    }
}`;
  bench(java, 'mecanum-zup', { physics: 'kinematic' });
  E.Sim.pad = { 1: { left_stick_y: -1 }, 2: {} };
  run(E, 0.5);
  E.Sim.pad = { 1: { left_stick_y: -1, a: true }, 2: {} };  // press a while still driving
  run(E, 0.02);
  E.Sim.pad = { 1: {}, 2: {} };                             // then let go of everything
  run(E, 0.1);
  assert.equal(E.Sim.dev.claw.cmd, 0.9, 'first half of the pass ran');
  assert.equal(E.Sim.dev.leftFront.cmd, 1, 'the drive keeps its last power while the loop sleeps');
  run(E, 0.4);
  assert.equal(E.Sim.dev.claw.cmd, 0.1, 'after 500 ms the rest of the pass ran');
  run(E, 0.1);
  assert.equal(Math.abs(E.Sim.dev.leftFront.cmd), 0, 'and the next pass read the released stick');
  const bare = E.analyze(E.parseJava(java.replace('if (gamepad1.a) {', 'if (true) {')), E.parseSTEP(fixture('robots/mecanum-zup.step')), {}, { payloadKg: 0, duty: 0.3, trust: 'code' });
  const f = bare.find((x) => x.key === 'sleep');
  assert.ok(f, 'a sleep outside any button is found');
});
