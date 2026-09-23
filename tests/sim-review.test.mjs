// Regression tests for the review of 25f54d3 ("universal robot support"):
// motors, encoders, linear slides, the moving centre of mass, sensors, and
// the device-to-mechanism mapping. Each one failed before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField, sampleBench, fixture, run } from './load.mjs';

const E = loadEngine();

// a one-motor OpMode on the sample robot, with `lift` driving whatever mech we say
function oneMotor(loop, { init = '', mech = null, kind = null, cadHook = null, EE = E } = {}) {
  const java = `
@TeleOp(name = "t")
public class T extends LinearOpMode {
    DcMotorEx lift;
    @Override
    public void runOpMode() {
        lift = hardwareMap.get(DcMotorEx.class, "lift");
        ${init}
        waitForStart();
        while (opModeIsActive()) {
            ${loop}
        }
    }
}`;
  const b = sampleBench(EE, java);
  if (cadHook) cadHook(b.cad);
  if (mech) {
    const m = b.cad.mechs.find((x) => x.id === mech) || b.cad.mechs[0];
    if (kind) m.kind = kind;
    b.map.lift = m.id;
  }
  EE.Sim.reset(b.code, b.cad, b.map, b.opts);
  EE.Sim.pad = { 1: {}, 2: {} };
  return EE.Sim.dev.lift;
}
const read = (meth, args) => E.Sim.env().device('lift', meth, args);

test('a reversed motor under a P loop on its own encoder settles, like on a real hub', () => {
  // the SDK flips power AND encoder for REVERSE, so this loop is stable either way
  oneMotor('lift.setPower(0.004 * (600 - lift.getCurrentPosition()));', { init: 'lift.setDirection(DcMotor.Direction.REVERSE);' });
  run(E, 4);
  const p = read('getCurrentPosition');
  assert.ok(Math.abs(p - 600) < 60, `settles near 600 ticks, read ${p}`);
});

test('RUN_TO_POSITION on a reversed motor reaches its target and isBusy clears', () => {
  oneMotor('', { init: 'lift.setDirection(DcMotor.Direction.REVERSE); lift.setTargetPosition(500); lift.setMode(DcMotor.RunMode.RUN_TO_POSITION); lift.setPower(0.8);' });
  run(E, 3);
  assert.ok(Math.abs(read('getCurrentPosition') - 500) <= 12, `at ${read('getCurrentPosition')}`);
  assert.equal(read('isBusy'), 0);
});

test('STOP_AND_RESET_ENCODER zeroes the reading without moving anything or spiking getVelocity', () => {
  const s = oneMotor('if (gamepad1.a) { lift.setPower(0.6); } else { lift.setPower(0); } if (gamepad1.b) { lift.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER); lift.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER); }');
  E.Sim.pad[1].a = true; run(E, 1); E.Sim.pad[1].a = false; run(E, 1);
  const physical = s.revs;
  assert.ok(read('getCurrentPosition') > 200);
  E.Sim.pad[1].b = true; run(E, 0.02); E.Sim.pad[1].b = false; run(E, 0.02);
  assert.ok(Math.abs(read('getCurrentPosition')) < 5, 'reading back at zero');
  assert.ok(Math.abs(s.revs - physical) < 0.01, 'the motor did not turn back');
  assert.ok(Math.abs(read('getVelocity')) < 50, `no velocity spike: ${read('getVelocity')}`);
});

test('a linear slide on a reversed motor extends under RUN_TO_POSITION and stops at its known limit', () => {
  const s = oneMotor('', {
    mech: null, kind: 'linear',
    init: 'lift.setDirection(DcMotor.Direction.REVERSE); lift.setTargetPosition(800); lift.setMode(DcMotor.RunMode.RUN_TO_POSITION); lift.setPower(1);',
    cadHook: (cad) => { const m = cad.mechs[0]; m.kind = 'linear'; m.axis = [0, 0, 1]; m.limits = [0, 0.10]; },
  });
  E.Sim.dev.lift.mech = E.Sim.cad.mechs[0];
  run(E, 3);
  const k = 120 / 1000 / s.tpr, q = s.ticks * k;
  assert.ok(q > 0.099 && q <= 0.1000001, `pinned at the 0.10 m limit, at ${q.toFixed(4)} m`);
  assert.equal(read('isBusy'), 1, 'still short of 800 ticks, so still busy');
  assert.equal(s.stalled, true, 'shows stalled while pressed against the stop');
  // back off the stop: the flag clears
  E.Sim.dev.lift.target = 0; run(E, 1);
  assert.equal(s.stalled, false, 'stalled clears once it moves off the stop');
});

test('an unknown slide has no invented stop at zero: it runs both ways', () => {
  const s = oneMotor('lift.setPower(-0.5);', { cadHook: (cad) => { const m = cad.mechs[0]; m.kind = 'linear'; m.axis = [1, 0, 0]; } });
  E.Sim.dev.lift.mech = E.Sim.cad.mechs[0];
  run(E, 1);
  assert.ok(read('getCurrentPosition') < -100, `moved negative: ${read('getCurrentPosition')}`);
  assert.equal(s.stalled, false);
});

test('a slide moves the centre of mass by carried mass over the RUNNING mass, in the robot frame', () => {
  const b = sampleBench(E, E.DRIVE_JAVA);
  const m = b.cad.mechs[0]; m.kind = 'linear'; m.axis = [1, 0, 0];
  E.Sim.reset(b.code, b.cad, b.map, { ...b.opts, front: '+y' });
  E.Sim.dev.lift.mech = m;
  const kg = E.Sim.rig.props.kg;
  E.Sim.dev.lift.act = E.Sim.dev.lift.restPos + 1;      // one unit of travel = lever metres
  E.Sim.updateCOM();
  const c = E.Sim.rig.props.com, c0 = E.Sim.rig.props.baseCom;
  const expect = (m.lever || 0.3) * (E.Sim.opts.payloadKg + 0.10) / kg;
  const shift = Math.hypot(c.x - c0.x, c.y - c0.y, c.z - c0.z);
  assert.ok(Math.abs(shift - expect) < 1e-9, `shift ${shift} vs ${expect} (kg ${kg})`);
  // CAD +x with the front along +y is the robot's right, -y in the robot frame
  assert.ok(c.y - c0.y < 0 && Math.abs(c.x - c0.x) < 1e-12, `moves along robot -y: ${JSON.stringify([c.x - c0.x, c.y - c0.y])}`);
});

test('distance sensor: exact ray to the wall from the front edge, in the unit asked for', () => {
  const F = loadWithField();
  const java = `
@TeleOp(name = "d")
public class D extends LinearOpMode {
    @Override
    public void runOpMode() {
        DistanceSensor dist = hardwareMap.get(DistanceSensor.class, "dist");
        waitForStart();
        while (opModeIsActive()) { }
    }
}`;
  const b = sampleBench(F, java);
  F.Sim.reset(b.code, b.cad, b.map, { ...b.opts, startPose: { x: 1.0, y: 1.0, h: 0 } });
  const fp = F.Sim.footprint, H = F.Field.half();
  const want = H - (1.0 + fp.hx + (fp.ox || 0));
  const dev = (u) => F.Sim.env().device('dist', 'getDistance', u ? [{ o: 'id', v: 'DistanceUnit.' + u }] : undefined);
  assert.ok(Math.abs(dev('METER') - want) < 1e-6, `metres ${dev('METER')} vs ${want}`);
  assert.ok(Math.abs(dev('CM') / dev('INCH') - 2.54) < 1e-9, 'CM / INCH = 2.54');
  assert.ok(Math.abs(dev('MM') / dev('CM') - 10) < 1e-9, 'MM / CM = 10');
  assert.equal(F.Sim.dev.dist.kind, 'sensor');
});

test('distance sensor: thin HIVE legs are hit exactly, not skipped by a coarse march', () => {
  const F = loadWithField();
  const b = sampleBench(F, `@TeleOp(name="d") public class D extends LinearOpMode { public void runOpMode(){ DistanceSensor dist = hardwareMap.get(DistanceSensor.class, "dist"); waitForStart(); while (opModeIsActive()) { } } }`);
  F.Sim.reset(b.code, b.cad, b.map, { ...b.opts, startPose: { x: 0, y: 0, h: 0 } });
  const leg = F.Sim.obstacles.find((o) => /leg/.test(o.what));
  const fp = F.Sim.footprint;
  // put the sensor 0.40 m short of the leg's foot, pointing straight at it
  F.Sim.chassis = { x: leg.a[0] - 0.40 - fp.hx - (fp.ox || 0), y: leg.a[1] - (fp.oy || 0), h: 0 };
  const d = F.Sim.env().device('dist', 'getDistance', [{ o: 'id', v: 'DistanceUnit.METER' }]);
  // independent check: march 0.1 mm at a time until inside any obstacle's capsule
  const sx = leg.a[0] - 0.40, sy = leg.a[1];
  const inside = (px, py) => F.Sim.obstacles.some((o) => { const ux = o.b[0] - o.a[0], uy = o.b[1] - o.a[1], L2 = ux * ux + uy * uy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - o.a[0]) * ux + (py - o.a[1]) * uy) / L2)) : 0;
    return Math.hypot(px - o.a[0] - t * ux, py - o.a[1] - t * uy) <= o.r; });
  let t = 0; while (!inside(sx + t, sy) && t < 1) t += 1e-4;
  assert.ok(t <= 0.40 - leg.r + 1e-3, 'the HIVE is in the way');
  assert.ok(Math.abs(d - t) < 3e-4, `reads ${d.toFixed(4)} m, brute force ${t.toFixed(4)} m`);
});

test('touch sensor: an unmapped one is a front bumper', () => {
  const F = loadWithField();
  const b = sampleBench(F, `@TeleOp(name="t") public class T extends LinearOpMode { public void runOpMode(){ TouchSensor bump = hardwareMap.get(TouchSensor.class, "bump"); waitForStart(); while (opModeIsActive()) { } } }`);
  F.Sim.reset(b.code, b.cad, b.map, { ...b.opts, startPose: { x: 1.0, y: 1.0, h: 0 } });
  assert.equal(F.Sim.env().device('bump', 'isPressed'), 0, 'open floor ahead');
  const fp = F.Sim.footprint, H = F.Field.half();
  F.Sim.chassis.x = H - fp.hx - (fp.ox || 0) - 0.005;
  assert.equal(F.Sim.env().device('bump', 'isPressed'), 1, 'front against the wall');
  F.Sim.chassis.h = Math.PI;                              // back against the wall instead
  assert.equal(F.Sim.env().device('bump', 'isPressed'), 0, 'the back touching is not the front bumper');
});

test('sensors stay sensors under CAD trust, never get a mechanism, and never tick as servos', () => {
  const b = sampleBench(E, `@TeleOp(name="s") public class S extends LinearOpMode { public void runOpMode(){ DistanceSensor claw = hardwareMap.get(DistanceSensor.class, "claw"); waitForStart(); while (opModeIsActive()) { } } }`, 'cad');
  assert.equal(b.map.claw, null, 'a sensor named claw is not handed the claw mechanism');
  b.map.claw = b.cad.mechs[0].id;                         // even mapped by hand
  E.Sim.reset(b.code, b.cad, b.map, b.opts);
  assert.equal(E.Sim.dev.claw.kind, 'sensor');
  run(E, 0.2);
  assert.ok(Number.isFinite(E.Sim.dev.claw.act), 'no NaN');
});
