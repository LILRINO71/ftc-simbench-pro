// Onshape mates -> joints (src/mates.js). The corpus generator writes the
// `mated` robot twice from one tree: as a STEP, and as the assembly
// definition Onshape's API returns (instances, occurrences with world
// transforms, mate features with each end's connector in its occurrence's own
// frame, a LINEAR relation, and the mate limits from the features endpoint).
// The importer has to rebuild exactly the joints the robot was built with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, run } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');
const fresh = () => E.parseSTEP(R.text);
const clone = (o) => JSON.parse(JSON.stringify(o));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('every Onshape part is matched to its STEP part by placement', () => {
  const cad = fresh();
  assert.ok(cad.solids.every((s) => s.occT), 'the parser records each part\'s placement');
  const rep = E.applyOnshapeMates(cad, R.onshape.assembly, { features: R.onshape.features });
  assert.equal(rep.matched, R.truth.leafParts);
  assert.equal(rep.parts, R.truth.leafParts);
});

test('the joints are the ones the robot was built with: kind, axis, parent, carried parts', () => {
  const cad = fresh();
  E.applyOnshapeMates(cad, R.onshape.assembly, { features: R.onshape.features });
  const joints = cad.mechs.filter((m) => m.fromMate);
  assert.deepEqual(joints.map((m) => m.id).sort(), R.truth.joints.map((j) => j.name).sort());
  for (const t of R.truth.joints) {
    const m = joints.find((x) => x.id === t.name);
    assert.equal(m.kind, t.kind, t.name + ' kind');
    assert.ok(Math.abs(dot(m.axis, t.axis)) > 0.9999, t.name + ' axis ' + m.axis);
    assert.equal(m.parent, t.parent, t.name + ' parent');
    const carried = cad.solids.filter((s) => s.mech === m.id).map((s) => s.name).sort();
    assert.deepEqual(carried, t.carries.slice().sort(), t.name + ' carries');
    if (t.couple) assert.equal(m.couple && m.couple.to, t.couple, t.name + ' follows ' + t.couple);
  }
  // the drive motors' "mechanisms" (drive hardware) are still there, still fixed
  assert.ok(cad.mechs.filter((m) => m.drive).every((m) => m.kind === 'fixed'));
});

test('mate limits come through in metres and radians', () => {
  const cad = fresh();
  E.applyOnshapeMates(cad, R.onshape.assembly, { features: R.onshape.features });
  const by = (id) => cad.mechs.find((m) => m.id === id);
  assert.deepEqual(by('Lift Stage').limits.map((v) => +v.toFixed(6)), [0, 0.28]);
  assert.ok(Math.abs(by('Arm Pivot').limits[0] + Math.PI / 2) < 1e-9 && Math.abs(by('Arm Pivot').limits[1] - 2.1) < 1e-9);
  assert.equal(E.mateQty('18 in'), 18 * 0.0254);
  assert.equal(E.mateQty('-90 deg'), -Math.PI / 2);
  assert.ok(Number.isNaN(E.mateQty('banana')));
});

test('a STEP exported under another placement still lines up (the global offset is found)', () => {
  const cad = fresh();
  const A = clone(R.onshape.assembly);
  // the API describes the same robot turned 90 degrees and moved half a metre
  const c = 0, s = 1;
  for (const o of A.rootAssembly.occurrences) {
    const T = o.transform, r = (i, j) => T[i * 4 + j];
    const n = [
      c * r(0, 0) - s * r(1, 0), c * r(0, 1) - s * r(1, 1), c * r(0, 2) - s * r(1, 2), c * r(0, 3) - s * r(1, 3) + 0.5,
      s * r(0, 0) + c * r(1, 0), s * r(0, 1) + c * r(1, 1), s * r(0, 2) + c * r(1, 2), s * r(0, 3) + c * r(1, 3),
      r(2, 0), r(2, 1), r(2, 2), r(2, 3), 0, 0, 0, 1];
    o.transform = n;
  }
  const rep = E.applyOnshapeMates(cad, A, { features: R.onshape.features });
  assert.equal(rep.matched, R.truth.leafParts);
  const arm = cad.mechs.find((m) => m.id === 'Arm Pivot');
  assert.ok(Math.abs(dot(arm.axis, [0, 1, 0])) > 0.9999, 'the axis comes back in the STEP\'s frame: ' + arm.axis);
});

test('devices map onto the joints by name; a cascade stage is driven through its leader', () => {
  const cad = fresh();
  E.applyOnshapeMates(cad, R.onshape.assembly, { features: R.onshape.features });
  const map = E.autoMap([
    { name: 'lift', type: 'DcMotorEx', cfg: 'lift' },
    { name: 'arm', type: 'DcMotorEx', cfg: 'arm' },
    { name: 'claw', type: 'Servo', cfg: 'claw' },
    { name: 'leftFront', type: 'DcMotor', cfg: 'leftFront' },
  ], cad.mechs);
  assert.equal(map.lift, 'Lift Stage');
  assert.equal(map.arm, 'Arm Pivot');
  assert.equal(map.claw, 'Claw');
  assert.equal(map.leftFront, null);
});

const LIFT_JAVA = `
@TeleOp(name = "lift")
public class Lift extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotorEx lift = hardwareMap.get(DcMotorEx.class, "lift");
        DcMotorEx arm = hardwareMap.get(DcMotorEx.class, "arm");
        Servo claw = hardwareMap.get(Servo.class, "claw");
        DcMotor leftFront = hardwareMap.get(DcMotor.class, "leftFront");
        DcMotor leftBack = hardwareMap.get(DcMotor.class, "leftBack");
        DcMotor rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        DcMotor rightBack = hardwareMap.get(DcMotor.class, "rightBack");
        leftFront.setDirection(DcMotor.Direction.REVERSE);
        leftBack.setDirection(DcMotor.Direction.REVERSE);
        claw.setPosition(0.5);
        waitForStart();
        while (opModeIsActive()) {
            lift.setPower(gamepad1.left_stick_y);
            arm.setPower(gamepad1.right_stick_y);
            if (gamepad1.a) { claw.setPosition(1.0); }
            leftFront.setPower(gamepad2.left_stick_y);
            leftBack.setPower(gamepad2.left_stick_y);
            rightFront.setPower(gamepad2.left_stick_y);
            rightBack.setPower(gamepad2.left_stick_y);
        }
    }
}`;

function bench() {
  const cad = fresh();
  E.applyOnshapeMates(cad, R.onshape.assembly, { features: R.onshape.features });
  E.recomputeChain(cad.mechs);
  const code = E.parseJava(LIFT_JAVA);
  const map = E.autoMap(code.devices, cad.mechs);
  E.Sim.reset(code, cad, map, { payloadKg: 0, duty: 1, trust: 'code', startPose: { x: 0, y: 0, h: 0 } });
  E.Sim.pad = { 1: {}, 2: {} };
  return cad;
}

test('a slide stops at its Onshape limit, and the stage it pulls moves the centre of mass too', () => {
  bench();
  const s = E.Sim.dev.lift;
  E.Sim.pad[1].left_stick_y = 1; run(E, 6);
  const q = s.ticks * 0.12 / s.tpr;
  assert.ok(Math.abs(q - 0.28) < 1e-6, `pinned at the 0.28 m limit: ${q}`);
  E.Sim.updateCOM();
  const c = E.Sim.rig.props.com, c0 = E.Sim.rig.props.baseCom, kg = E.Sim.rig.props.kg;
  // Lift Stage plus the Lift Carriage following it 1:1, each carrying 0.10 kg
  assert.ok(Math.abs((c.z - c0.z) - 2 * 0.28 * 0.10 / kg) < 1e-9, `COM rise ${c.z - c0.z}`);
});

test('a motor on a revolute joint and a servo stop at the mate limits', () => {
  bench();
  E.Sim.pad[1].right_stick_y = 1; run(E, 4);
  const a = E.Sim.dev.arm, q = a.revs * 2 * Math.PI;
  assert.ok(Math.abs(q - 2.1) < 1e-9, `arm stops at 2.1 rad: ${q}`);
  E.Sim.pad[1].right_stick_y = -1; run(E, 6);
  assert.ok(Math.abs(E.Sim.dev.arm.revs * 2 * Math.PI + Math.PI / 2) < 1e-9, 'and at -90 deg the other way');
  E.Sim.pad[1].a = true; run(E, 2);
  const c = E.Sim.dev.claw, deg = (c.act - c.restPos) * (c.travelDeg || 300);
  assert.ok(Math.abs(deg * Math.PI / 180 - 1.2) < 1e-6, `claw opens only to its 1.2 rad limit: ${deg} deg`);
});

test('what is not an Onshape assembly, or not this STEP, says so', () => {
  assert.throws(() => E.applyOnshapeMates(fresh(), { hello: 1 }), /not an Onshape assembly definition/);
  const other = E.parseSTEP(buildRobot('arm-only').text);
  assert.throws(() => E.applyOnshapeMates(other, R.onshape.assembly), /line up/);
});

test('the URL box only ever builds links to onshape.com', () => {
  const L = E.onshapeApiLinks('https://cad.onshape.com/documents/0123456789abcdef01234567/w/89abcdef0123456789abcdef/e/fedcba9876543210fedcba98');
  assert.equal(L.def, 'https://cad.onshape.com/api/assemblies/d/0123456789abcdef01234567/w/89abcdef0123456789abcdef/e/fedcba9876543210fedcba98?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false');
  assert.ok(L.features.endsWith('/e/fedcba9876543210fedcba98/features'));
  assert.ok(E.onshapeApiLinks('https://acme.onshape.com/documents/0123456789abcdef01234567/v/89abcdef0123456789abcdef/e/fedcba9876543210fedcba98'), 'company subdomains work');
  for (const bad of ['https://evil.com/documents/0123456789abcdef01234567/w/89abcdef0123456789abcdef/e/fedcba9876543210fedcba98',
    'https://cad.onshape.com.evil.com/documents/0123456789abcdef01234567/w/89abcdef0123456789abcdef/e/fedcba9876543210fedcba98',
    'http://cad.onshape.com/documents/0123456789abcdef01234567/w/89abcdef0123456789abcdef/e/fedcba9876543210fedcba98',
    'javascript:alert(1)//onshape.com/documents/'])
    assert.equal(E.onshapeApiLinks(bad), null, bad);
});

test('the view draws a mate joint the way the sim stops it, and a cascade stage follows its leader', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const { engineBundle } = await import('./load.mjs');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
  const V = new Function('"use strict";\n' + engineBundle().replace(/^"use strict";\n/, '') + '\n' +
    fs.readFileSync(path.join(root, 'src', 'view3d.js'), 'utf8') + '\nreturn { mechPose, mateClamp };')();
  const cad = fresh();
  E.applyOnshapeMates(cad, R.onshape.assembly, { features: R.onshape.features });
  const arm = cad.mechs.find((m) => m.id === 'Arm Pivot'), lift = cad.mechs.find((m) => m.id === 'Lift Stage');
  // a motor 0.5 output turns up: 3.14 rad, past the 2.1 rad limit
  const pa = V.mechPose(arm, { kind: 'motor', revs: 0.5, act: 0, restPos: 0, tpr: 537.7 }, 0.5);
  assert.ok(Math.abs(pa.ang - 2.1) < 1e-12, 'drawn at the limit, right-handed about the mate axis: ' + pa.ang);
  // no lift-joint sign flip for a mate: a small positive turn draws positive
  assert.ok(V.mechPose(arm, { kind: 'motor', revs: 0.1, act: 0, restPos: 0 }, 0.5).ang > 0);
  const pl = V.mechPose(lift, { kind: 'motor', ticks: 10000, act: 0, restPos: 0, tpr: 537.7 }, 0.5);
  assert.ok(Math.abs(pl.d - 0.28) < 1e-12, 'slide drawn at its 0.28 m limit');
  const car = cad.mechs.find((m) => m.id === 'Lift Carriage');
  assert.equal(car.couple.to, 'Lift Stage');
  assert.equal(V.mateClamp(car, 0.5), 0.27, 'the follower stops at its own limit too');
});

test('a saved session keeps the mate joints: limits, the cascade, and which joint carries each part', () => {
  const cad = fresh();
  E.applyOnshapeMates(cad, R.onshape.assembly, { features: R.onshape.features });
  const r = E.unpackSession(E.packSession(E.sessionFromBench({ cad })));
  assert.equal(r.ok, true, r.error);
  const back = r.session.cad;
  assert.ok(back.mates && back.mates.joints === 4, 'the import summary survives');
  assert.deepEqual(back.solids.map((s) => s.mech || null), cad.solids.map((s) => s.mech || null));
  const by = (c, id) => c.mechs.find((m) => m.id === id);
  assert.deepEqual(by(back, 'Lift Stage').limits.map((v) => +v.toFixed(4)), [0, 0.28]);
  assert.ok(Math.abs(by(back, 'Arm Pivot').limits[1] - 2.1) < 1e-6);
  assert.deepEqual(by(back, 'Lift Carriage').couple, { to: 'Lift Stage', ratio: 1, via: 'linear' });
  assert.equal(by(back, 'Claw').fromMate.type, 'REVOLUTE');
  // and a session with no mates is unchanged in shape
  const plain = E.unpackSession(E.packSession(E.sessionFromBench({ cad: E.parseSTEP(buildRobot('arm-only').text) })));
  assert.equal(plain.session.cad.mates, null);
  assert.ok(plain.session.cad.mechs.every((m) => !('limits' in m) && !('couple' in m)));
});

test('re-typing the mechanisms (as opening a session does) leaves mate joints alone', () => {
  const cad = fresh();
  E.applyOnshapeMates(cad, R.onshape.assembly, { features: R.onshape.features });
  const before = cad.mechs.map((m) => [m.id, m.kind, m.parent]);
  E.classifyMechs(cad.mechs);
  assert.deepEqual(cad.mechs.map((m) => [m.id, m.kind, m.parent]), before);
});
