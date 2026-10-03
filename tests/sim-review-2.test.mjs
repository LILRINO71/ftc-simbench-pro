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
