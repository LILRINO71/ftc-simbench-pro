// Device-to-mechanism mapping (issue #1). On GearGurus 7832's Into The Deep
// robot the old mapper put all four mecanum motors on the linear slides and
// the arm motor on a slide too: the drive-word synonyms (left, front, motor)
// matched any mechanism with "Left" in its name, and the config name
// ("Arm") was never read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

test('mapping: drive motors and the IMU never take a mechanism; the config name counts (issue #1)', () => {
  const devices = [
    { name: 'motor', type: 'DcMotorEx', cfg: 'Arm' },
    { name: 'uppies', type: 'DcMotorEx', cfg: 'uppies' },
    { name: 'frontLeftMotor', type: 'DcMotor', cfg: 'fL' },
    { name: 'backLeftMotor', type: 'DcMotor', cfg: 'bL' },
    { name: 'frontRightMotor', type: 'DcMotor', cfg: 'fR' },
    { name: 'backRightMotor', type: 'DcMotor', cfg: 'bR' },
    { name: 'inClaw', type: 'Servo', cfg: 'inClaw' },
    { name: 'outClaw', type: 'Servo', cfg: 'outClaw' },
    { name: 'imu', type: 'IMU', cfg: 'imu' },
  ];
  // the mechanism names the Into The Deep STEP produces
  const mechs = ['2106-4008-0800 assembly', 'Assembly 2', '2 stage Left SAR 230', 'Left SAR 230', '2 stage Right SAR 230',
    'Current Outtake Claw + Arm', 'Right SAR 230', 'REV Control Hub / Expansion Hub', 'Current Intake',
    '96mm Mecanum Wheel (Right Slant, 70A Duromet', '96mm Mecanum Wheel (Left Slant, 70A Duromete']
    .map((id) => ({ id, kind: /Arm/.test(id) ? 'revolute-lift' : /Intake/.test(id) ? 'effector' : 'fixed' }));
  const map = E.autoMap(devices, mechs);
  for (const n of ['frontLeftMotor', 'backLeftMotor', 'frontRightMotor', 'backRightMotor', 'imu']) assert.equal(map[n], null, n + ' -> ' + map[n]);
  assert.equal(map.motor, 'Current Outtake Claw + Arm', 'config name "Arm" finds the arm');
  assert.equal(map.inClaw, 'Current Intake', 'the intake claw drives the intake');
  assert.notEqual(map.outClaw, 'Current Intake', 'and the outtake claw does not');
});
