// The sim with solved mechanisms (src/sim.js + src/joltmech.js): the team's
// Java runs, its motors and servos command Jolt, and what the code reads
// back (encoders, positions) is where the solver put each joint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, run } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const J = await (await import('jolt-physics/wasm-compat')).default();
const R = buildRobot('mated');
const JAVA = `
@TeleOp(name = "lift and arm")
public class T extends LinearOpMode {
    DcMotorEx lift; Servo arm;
    @Override
    public void runOpMode() {
        lift = hardwareMap.get(DcMotorEx.class, "lift");
        arm = hardwareMap.get(Servo.class, "arm");
        waitForStart();
        while (opModeIsActive()) {
            lift.setPower(1.0);
            arm.setPosition(0.7);
            telemetry.addData("ticks", lift.getCurrentPosition());
        }
    }
}`;
function bench(mechanisms) {
  const cad = E.cadFromOnshape(JSON.parse(JSON.stringify({ name: 'Mated Robot', asm: R.onshape.assembly, features: R.onshape.features, geom: R.onshape.geom })));
  const code = E.parseJava(JAVA);
  const map = { lift: 'Lift Stage', arm: 'Arm Pivot' };
  E.Sim.reset(code, cad, map, { payloadKg: 0.18, duty: 0.3, trust: 'code', physics: 'kinematic', mechanisms, jolt: J, substeps: 4 });
  E.Sim.pad = { 1: {}, 2: {} };
  return cad;
}
const q = (cad, id, dev) => { const m = cad.mechs.find((x) => x.id === id); return E.mateJointQ(m, E.Sim.dev[dev]); };

test('sim + jolt: the lift climbs to its top stop and the cascade stage follows; the encoder says so', () => {
  const cad = bench('jolt');
  assert.ok(E.Sim.mechWorld, 'a Jolt world for the robot: ' + E.Sim.mechNote);
  assert.ok(E.Sim.mechWorld.joints.has('Lift Stage') && E.Sim.mechWorld.joints.has('Lift Carriage'));
  run(E, 3);
  const lift = cad.mechs.find((m) => m.id === 'Lift Stage');
  assert.ok(Math.abs(E.Sim.mechWorld.q('Lift Stage') - lift.limits[1]) < 0.005, 'at the top: ' + E.Sim.mechWorld.q('Lift Stage'));
  assert.ok(Math.abs(q(cad, 'Lift Stage', 'lift') - E.Sim.mechWorld.q('Lift Stage')) < 1e-3, 'the encoder reads where the solver put it, within the stop\'s give');
  const carriage = cad.mechs.find((m) => m.id === 'Lift Carriage');
  // the stage follows its leader, and waits at its own stop when the leader overreaches it
  const want = Math.min(carriage.limits[1], E.followQ(carriage, (id) => E.Sim.mechWorld.q(id)));
  assert.ok(Math.abs(E.Sim.mechWorld.q('Lift Carriage') - want) < 0.01, 'the carriage follows: ' + E.Sim.mechWorld.q('Lift Carriage') + ' vs ' + want);
  assert.ok(E.Sim.env().device('lift', 'getCurrentPosition') > 0);
});

test('sim + jolt: a servo arm goes where its position puts it, as the posed bench does', () => {
  const posed = bench('posed'); run(E, 2); const qPosed = q(posed, 'Arm Pivot', 'arm');
  assert.equal(E.Sim.mechWorld, null, 'posed: no solver');
  const solved = bench('jolt'); run(E, 2);
  const qSolved = E.Sim.mechWorld.q('Arm Pivot');
  assert.ok(Math.abs(qSolved - qPosed) < 0.05, 'solved ' + qSolved + ' vs posed ' + qPosed);
  void solved;
});

test('sim + jolt: a probe of the drive never builds or tears down the live sim\'s world', () => {
  bench('jolt');
  const W = E.Sim.mechWorld;
  const probe = Object.create(E.Sim);
  probe.load(E.Sim.code, E.Sim.cad, E.Sim.map, Object.assign({}, E.Sim.opts, { jolt: null }));
  assert.equal(probe.mechWorld, null);
  assert.equal(E.Sim.mechWorld, W, 'the live world is untouched');
  run(E, 0.2);
  assert.ok(Number.isFinite(W.q('Lift Stage')));
});
