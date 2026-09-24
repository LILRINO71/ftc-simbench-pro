// FTCLib's PIDController adds each error times the loop period into a sum and
// keeps that sum inside its integration bounds, -1..1 unless the code calls
// setIntegrationBounds. Without the bound, a big move winds the I term up and
// an arm on kI = 0.03 sails 20 degrees past its target, which the real one
// doesn't. Other PID classes (hand-rolled, RoadRunner's) keep an open sum.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

test('FTCLib PID controllers keep the summed error inside -1..1, as the library does', () => {
  const src = (lib) => `package x;\nimport ${lib}.PIDController;\n@TeleOp(name="p")\npublic class P extends LinearOpMode {\n PIDController c; DcMotorEx m;\n public void runOpMode(){\n  m = hardwareMap.get(DcMotorEx.class, "m");\n  c = new PIDController(0, 1, 0);\n  waitForStart();\n  while(opModeIsActive()){ m.setPower(c.calculate(0, 1000)); }\n }\n}`;
  for (const [lib, lim] of [['com.arcrobotics.ftclib.controller', 1], ['org.firstinspires.ftc.teamcode.util', 1e7]]) {
    const code = E.parseJava(src(lib));
    E.Sim.reset(code, { mechs: [], points: [], bbox: { min: [0, 0, 0], max: [0.1, 0.1, 0.1] } }, {}, { payloadKg: 0, duty: 0.3, trust: 'code' });
    for (let i = 0; i < 50; i++) E.Sim.pidOp('c', 'calculate', [0, 1000]);
    assert.equal(E.Sim.pids.c.sum, Math.min(lim, 50 * 1000 * 0.02), lib);
  }
});
