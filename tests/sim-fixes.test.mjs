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
