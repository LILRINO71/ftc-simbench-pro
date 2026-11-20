// A servo's figures are quoted at 6 V (src/hardware.js), but a REV hub's servo port gives 5 V. The
// sim, the Checks tab's torque check and the Math tab take a servo at the volts it runs at: 5 V, or
// 6 V when a Servo Power Module feeds it (opts.servoVolts), with torque and speed taken between the
// vendor's 4.8 V and 6 V columns in proportion. goBILDA 25-2 Torque: 17.2 / 21.6 kg.cm and
// 0.25 / 0.20 s per 60 deg at 4.8 / 6 V, so at 5 V 17.2 + 4.4 x 0.2/1.2 = 17.9333 kg.cm and
// 60/0.25 + (60/0.20 - 60/0.25) x 0.2/1.2 = 250 deg/s (0.24 s per 60 deg).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const KGCM = 0.0980665;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('servo volts: 5 V by default, between the vendor\'s 4.8 V and 6 V columns, 6 V on a Servo Power Module', () => {
  assert.equal(E.servoVolts({}), 5);
  assert.equal(E.servoVolts(null), 5);
  assert.equal(E.servoVolts({ servoVolts: 6 }), 6);
  assert.equal(E.servoVolts({ servoVolts: 0 }), 5, 'a volts that is not positive is the hub port');
  const t = E.HW_PARTS['2000-0025-0002'];
  const at = (v) => E.servoScale(t, v);
  near(at(6).torque, 1, 1e-12, 'torque at 6 V'); near(at(6).speed, 1, 1e-12, 'speed at 6 V');
  near(at(4.8).torque * t.stallNm, 17.2 * KGCM, 1e-9, 'torque at 4.8 V is the 4.8 V column');
  near(t.sec60 / at(4.8).speed, 0.25, 1e-12, 'speed at 4.8 V is the 4.8 V column');
  near(at(5).torque * t.stallNm, 17.933333333 * KGCM, 1e-8, 'torque at 5 V');
  near(60 / t.sec60 * at(5).speed, 250, 1e-9, 'deg/s at 5 V');
  near(at(7.4).torque, 1, 1e-12, 'above 6 V: the 6 V column, nothing extrapolated');
  // REV's Smart Robot Servo is quoted at 6 V only: in proportion to the voltage
  const rev = E.servoScale(E.HW_PARTS['REV-41-1097'], 5);
  near(rev.torque, 5 / 6, 1e-12, 'REV torque at 5 V'); near(rev.speed, 5 / 6, 1e-12, 'REV speed at 5 V');
});

/* One servo on a bare sim, stepped by Sim.stepDevices: how far it turns in 0.1 s from 0 towards 1. */
function slew(opts) {
  const spec = E.specFor({ name: 'arm', type: 'Servo', declaredRole: 'Torque' }, null, 'code');
  const S = Object.create(E.Sim);
  Object.assign(S, { rig: null, drivetrain: null, mechWorld: null, physics: 'rigid', opts: Object.assign({ duty: 0.3, payloadKg: 0 }, opts),
    dev: { arm: { kind: 'servo', spec, mech: null, cmd: 1, act: 0, restPos: 0, sec60: spec.sec60, travelDeg: 300, stalled: false } } });
  for (let k = 0; k < 5; k++) S.stepDevices(0.02);
  return S.dev.arm.act * 300;                                   // degrees turned
}

test('servo volts: the sim slews a servo at the speed its port gives it', () => {
  near(slew({}), 250 * 0.1, 1e-9, 'degrees in 0.1 s on the hub\'s 5 V port');
  near(slew({ servoVolts: 6 }), 300 * 0.1, 1e-9, 'degrees in 0.1 s on a 6 V Servo Power Module');
});

test('servo volts: the Checks tab\'s holding check uses the torque at 5 V, or 6 V when told', () => {
  const java = `@TeleOp(name="A") public class A extends LinearOpMode {
    private Servo arm;
    @Override public void runOpMode() { arm = hardwareMap.get(Servo.class, "arm"); arm.setPosition(0.5); waitForStart();
      while (opModeIsActive()) { arm.setPosition(0.6); } } }`;
  const mech = { id: 'm1', kind: 'revolute-lift', label: 'Test arm', parent: 'chassis', pivot: [0, 0, 0],
    distalTo: [0.2 * Math.cos(Math.PI / 6), 0, 0.2 * Math.sin(Math.PI / 6)], lever: 0.2, restAngleDeg: 30 };
  const run = (extra) => E.analyze(E.parseJava(java), { mechs: [mech] }, { arm: 'm1' }, Object.assign({ payloadKg: 0.18, duty: 0.3, trust: 'code' }, extra))
    .find(f => /^torque:arm$/.test(f.key));
  const usable = (f) => +/usable\s+([\d.]+) N·m/.exec(f.math)[1];
  const hub = run({}), spm = run({ servoVolts: 6 });
  near(usable(hub), 17.933333 * KGCM * 0.3, 1e-3, 'usable torque on the hub port');
  near(usable(spm), 21.6 * KGCM * 0.3, 1e-3, 'usable torque on a Servo Power Module');
  assert.match(hub.math, /stall at 5 V/);
  assert.match(spm.math, /stall at 6 V/);
});
