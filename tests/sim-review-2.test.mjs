// Regression tests for the second review of the simulator: encoder counts,
// what the drive encoders read, slide stops, the drive probe, the VM's yaw
// rate and zero-power behaviour. Each one failed before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField, sampleBench, run } from './load.mjs';

const E = loadEngine();

// a one-motor OpMode on the sample robot, `lift` driving the mech we say
function oneMotor(loop, { init = '', mech = null, cadHook = null, EE = E, decl = '' } = {}) {
  const java = `
@TeleOp(name = "t")
public class T extends LinearOpMode {
    ${decl}
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
  if (mech) b.map.lift = mech;
  EE.Sim.reset(b.code, b.cad, b.map, b.opts);
  EE.Sim.pad = { 1: {}, 2: {} };
  return EE.Sim.dev.lift;
}
const read = (meth, args, EE = E) => EE.Sim.env().device('lift', meth, args);

/* ---- encoder counts per output revolution ---- */

test('a REV Core Hex counts 288 a turn: RUN_TO_POSITION 288 turns the output once', () => {
  // the sim took 28 x 72 = 2016, seven times too many: 4 counts on the motor
  const s = oneMotor('', {
    mech: 'Base',
    cadHook: (cad) => { const m = cad.mechs.find((x) => x.id === 'Base'); m.part = 'REV-41-1300'; m.partName = 'REV Core Hex Motor'; },
    init: 'lift.setTargetPosition(288); lift.setMode(DcMotor.RunMode.RUN_TO_POSITION); lift.setPower(0.8);',
  });
  assert.equal(s.spec.part, 'REV-41-1300', 'the Core Hex from the CAD part');
  assert.equal(s.tpr, 288);
  run(E, 3);
  assert.ok(Math.abs(read('getCurrentPosition') - 288) <= 12, `at ${read('getCurrentPosition')} ticks`);
  assert.ok(Math.abs(s.revs - 1) < 0.05, `the output turned ${s.revs.toFixed(3)} rev`);
});

test('goBILDA Yellow Jackets count what goBILDA publishes, not 28 x the nominal ratio', () => {
  const want = { 1: 28, 3: 103.8, 5: 145.1, 13: 384.5, 19: 537.7, 26: 751.8, 50: 1425.1, 71: 1993.6, 100: 2786.2, 139: 3895.9, 188: 5281.1 };
  for (const k in want) {
    const pn = '5203-2402-' + String(k).padStart(4, '0');
    const spec = E.hwFromPart(pn);
    assert.equal(spec.tpr, want[k], pn + ' (' + spec.ratio + ':1)');
  }
  assert.equal(E.hwFromPart('REV-41-1291').tpr, 28, 'a bare HD Hex: 28 on the motor');
  assert.equal(E.GENERIC.Motor.tpr, 537.7, 'the unspecified motor is the 312 rpm Yellow Jacket');
  // the sim uses it: a declared 312 rpm motor reads 537.7 a turn
  const s = oneMotor('lift.setPower(0.5);', { decl: '' });
  assert.equal(s.tpr, 537.7);
  run(E, 1);
  assert.ok(Math.abs(read('getCurrentPosition') - Math.round(s.revs * 537.7)) <= 1, 'ticks are output turns x 537.7');
});

test('ticksPerRev: the published count first, else 28 counts on the motor through its box', () => {
  // an HD Hex through a 40:1 box is 28 x 40 = 1120 a turn, as REV publishes it
  const spec = { kind: 'motor', ratio: 40, rpm: 150, stallNm: 4.2 };
  assert.equal(E.ticksPerRev(spec), 1120);
  assert.equal(E.ticksPerRev({ ratio: 20 }), 560);
  assert.equal(E.ticksPerRev(E.hwFromPart('REV-41-1300')), 288);
  assert.equal(E.ticksPerRev(null), 537.7, 'nothing known: the unspecified motor');
});

/* ---- in rigid physics a drive encoder counts what its wheel turned ---- */

const TANK = `
@TeleOp(name = "Tank")
public class T extends LinearOpMode {
    DcMotor leftDrive, rightDrive;
    @Override
    public void runOpMode() {
        leftDrive = hardwareMap.get(DcMotor.class, "leftDrive");
        rightDrive = hardwareMap.get(DcMotor.class, "rightDrive");
        leftDrive.setDirection(DcMotor.Direction.REVERSE);
        waitForStart();
        while (opModeIsActive()) {
            leftDrive.setPower(-gamepad1.left_stick_y);
            rightDrive.setPower(-gamepad1.left_stick_y);
        }
    }
}`;
function tankOnField() {
  const F = loadWithField();
  const b = sampleBench(F, TANK);
  F.Sim.reset(b.code, b.cad, b.map, { ...b.opts, physics: 'rigid', startPose: F.Field.startPose('red', F.footprintOf(b.cad, '+x')) });
  return F;
}
const pos = (F, n) => F.Sim.env().device(n, 'getCurrentPosition');

test('rigid physics: free driving, the drive encoders read the distance actually covered', () => {
  // they integrated free speed x commanded power, so they ran ahead of a
  // robot that was still getting up to speed
  const F = tankOnField(), x0 = F.Sim.chassis.x;
  F.Sim.pad[1].left_stick_y = -1;
  run(F, 0.5);
  assert.equal(F.Sim.bump, null, 'nothing in the way yet');
  const d = F.Sim.chassis.x - x0, r = F.Sim.rig.drive.wheels[0].r, tpr = F.Sim.dev.leftDrive.tpr;
  assert.ok(d > 0.2, `it drove ${d.toFixed(3)} m`);
  for (const n of ['leftDrive', 'rightDrive']) {
    const m = pos(F, n) / tpr * 2 * Math.PI * r;
    assert.ok(m > 0, `${n} counts up under positive power, REVERSE or not: ${pos(F, n)}`);
    assert.ok(Math.abs(m - d) < 0.03 * d, `${n}: ${pos(F, n)} ticks is ${m.toFixed(3)} m, the robot covered ${d.toFixed(3)} m`);
  }
});

test('rigid physics: pinned on a wall, the drive encoders stop counting', () => {
  const F = tankOnField();
  F.Sim.pad[1].left_stick_y = -1;                         // full power, the whole way in
  run(F, 5);
  assert.ok(F.Sim.bump, 'against something');
  const a = [pos(F, 'leftDrive'), pos(F, 'rightDrive')], x = F.Sim.chassis.x;
  run(F, 1);
  assert.ok(Math.abs(F.Sim.chassis.x - x) < 0.002, 'and not moving');
  const b = [pos(F, 'leftDrive'), pos(F, 'rightDrive')];
  // the tiles hold a 12 kg two-wheel base against two motors at stall: no
  // wheelspin. Free speed is 2796 ticks/s; what's left is the tyre's creep
  // under the full stall force, a few mm/s (its stiffness at rest is finite)
  assert.ok(Math.abs(b[0] - a[0]) <= 15 && Math.abs(b[1] - a[1]) <= 15, `a second on the wall counted ${b[0] - a[0]} and ${b[1] - a[1]} ticks`);
  assert.ok(Math.abs(F.Sim.env().device('leftDrive', 'getVelocity')) < 15, 'and getVelocity reads still');
});

/* ---- a slide's hard stops are in the joint's own direction ---- */

test('a slide whose motor runs it backwards (dir -1) travels to its limit and stops there', () => {
  // the stop compared ticks x m/tick without the joint's dir, while the joint's
  // value (mateJointQ, the view, the centre of mass) multiplies by it: with
  // limits [0, 0.10] and dir -1 the slide could never visibly move
  const slide = (cad) => Object.assign(cad.mechs.find((x) => x.id === 'Arm'),
    { kind: 'linear', axis: [0, 0, 1], limits: [0, 0.10], dir: -1, mmPerTick: 0.1 });
  const s = oneMotor('lift.setPower(gamepad1.a ? -0.5 : (gamepad1.b ? 0.5 : 0));', { mech: 'Arm', cadHook: slide });
  const m = s.mech, q = () => E.mateJointQ(m, s);
  E.Sim.pad[1].a = true;                                  // negative power: out along the joint
  run(E, 0.3);
  assert.ok(q() > 0.01, `it moves out: ${(q() * 1000).toFixed(1)} mm`);
  run(E, 3);
  assert.ok(Math.abs(q() - 0.10) < 1e-6, `and stops at the 100 mm limit: ${(q() * 1000).toFixed(2)} mm`);
  assert.ok(Math.abs(s.ticks * 0.1 / 1000 * -1 - 0.10) < 1e-6, 'the motor stopped there too, not past it');
  assert.ok(s.stalled, 'held against the stop');
  E.Sim.pad[1].a = false; E.Sim.pad[1].b = true;          // and back in, to the other stop
  run(E, 3);
  assert.ok(Math.abs(q()) < 1e-6 && Math.abs(s.ticks) < 1e-6, `back at 0: ${(q() * 1000).toFixed(2)} mm, ${s.ticks} ticks`);
});
