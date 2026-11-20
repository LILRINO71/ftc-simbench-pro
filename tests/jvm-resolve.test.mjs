// Which class a simple name means. The bench's own sample OpModes, and code pasted from a forum
// post, often come without their imports; a name must then find the SDK's top-level class, never
// a helper nested in another one (HardwareMap.DeviceMapping.DcMotor is not DcMotor).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpMode } from '../tools/run-opmode.mjs';

test('with no imports, DcMotor is the SDK interface: its Direction and RunMode resolve', () => {
  const src = `@TeleOp(name = "t")
public class T extends LinearOpMode {
    DcMotorEx lift;
    @Override public void runOpMode() {
        lift = hardwareMap.get(DcMotorEx.class, "lift");
        lift.setDirection(DcMotor.Direction.REVERSE);
        lift.setTargetPosition(500); lift.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        System.out.println(lift.getDirection() + " " + lift.getMode());
        waitForStart();
    }
}`;
  const r = runOpMode({ code: [{ file: 'T.java', src }], opmode: 'T.java', seconds: 0.1 });
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.deepEqual(r.prints, ['REVERSE RUN_TO_POSITION']);
  assert.deepEqual(r.stubs, []);
});
