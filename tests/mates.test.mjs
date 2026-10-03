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

test('mate limits are read by the names Onshape gives them: limitZ along a slider, limitAxialZ about a revolute', () => {
  // the features list as GET …/assemblies/…/features returns it (and onshape-to-robot reads it)
  const qty = (id, expression) => ({ typeName: 'BTMParameterNullableQuantity', message: { parameterId: id, expression, isNull: false } });
  const mate = (featureId, name, params) => ({ typeName: 'BTMMate', message: { featureType: 'mate', featureId, name,
    parameters: [{ typeName: 'BTMParameterBoolean', message: { parameterId: 'limitsEnabled', value: true } }, ...params] } });
  const features = { features: [
    mate('F1', 'Lift Stage', [qty('limitZMin', '0 mm'), qty('limitZMax', '280 mm')]),
    mate('F3', 'Arm Pivot', [qty('limitAxialZMin', '-90 deg'), qty('limitAxialZMax', '120 deg')]),
    // a slider with only its top set: the other end is open
    mate('F2', 'Lift Carriage', [{ typeName: 'BTMParameterNullableQuantity', message: { parameterId: 'limitZMin', isNull: true, expression: '', value: 0 } }, qty('limitZMax', '10 in')])
  ] };
  const cad = fresh();
  E.applyOnshapeMates(cad, R.onshape.assembly, { features });
  const by = (id) => cad.mechs.find((m) => m.id === id);
  assert.ok(by('Lift Stage').limits, 'a slider\'s limitZMin/limitZMax are its travel');
  assert.deepEqual(by('Lift Stage').limits.map((v) => +v.toFixed(6)), [0, 0.28]);
  assert.ok(Math.abs(by('Arm Pivot').limits[0] + Math.PI / 2) < 1e-9 && Math.abs(by('Arm Pivot').limits[1] - 120 * Math.PI / 180) < 1e-9);
  assert.deepEqual(by('Lift Carriage').limits.map((v) => v == null ? v : +v.toFixed(6)), [null, 0.254], 'a limit Onshape leaves empty stays open');
  // the corpus writes them the same way
  const names = R.onshape.features.features.flatMap((f) => f.message.parameters.map((p) => p.message.parameterId));
  assert.ok(names.includes('limitZMin') && names.includes('limitAxialZMax'), names.join());
  assert.ok(!names.includes('limitRotationMin'), 'no names Onshape never writes');
  // the names older SimBench fixtures used still read
  const old = { features: [mate('F1', 'Lift Stage', [qty('limitAxialZMin', '0 mm'), qty('limitAxialZMax', '0.2 m')]), mate('F3', 'Arm Pivot', [qty('limitRotationMin', '-1 rad'), qty('limitRotationMax', '1 rad')])] };
  const c2 = fresh();
  E.applyOnshapeMates(c2, R.onshape.assembly, { features: old });
  assert.deepEqual(c2.mechs.find((m) => m.id === 'Lift Stage').limits.map((v) => +v.toFixed(6)), [0, 0.2]);
  assert.deepEqual(c2.mechs.find((m) => m.id === 'Arm Pivot').limits, [-1, 1]);
});

test('a mate drawn away from its zero: its limits count from where the connectors meet, not from where it was drawn', () => {
  const A = clone(R.onshape.assembly);
  const feats = [A.rootAssembly, ...A.subAssemblies].flatMap((a) => a.features || []);
  const named = (n) => feats.find((f) => f.featureData && f.featureData.name === n).featureData;
  // the stage drawn 100 mm up its rail: its connector sits 100 mm above the rail's
  const stage = named('Lift Stage').matedEntities[1].matedCS;
  stage.origin[2] += 0.100;
  // the arm drawn turned 0.5 rad about its pivot: its connector's x turned that much
  const arm = named('Arm Pivot').matedEntities[1].matedCS, t = 0.5;
  const x = arm.xAxis, y = arm.yAxis;
  arm.xAxis = x.map((v, k) => v * Math.cos(t) + y[k] * Math.sin(t));
  arm.yAxis = y.map((v, k) => v * Math.cos(t) - x[k] * Math.sin(t));
  const cad = fresh();
  E.applyOnshapeMates(cad, A, { features: R.onshape.features });
  const by = (id) => cad.mechs.find((m) => m.id === id);
  // Onshape says 0 to 280 mm: from the drawn pose that is 100 mm down to 180 mm up
  assert.deepEqual(by('Lift Stage').limits.map((v) => +v.toFixed(6)), [-0.1, 0.18]);
  const L = by('Arm Pivot').limits;
  assert.ok(Math.abs(L[0] - (-Math.PI / 2 - t)) < 1e-9 && Math.abs(L[1] - (2.1 - t)) < 1e-9, 'arm limits ' + L);
  // driven all the way up, the stage stops at 280 mm from the mate's zero, not 380
  const up = E.mateJointQ(by('Lift Stage'), { kind: 'motor', ticks: 1e6, tpr: 537.7, act: 0, restPos: 0 });
  assert.ok(Math.abs(up - 0.18) < 1e-9, 'stops 180 mm above where it was drawn: ' + up);
  // and a mate drawn at its zero keeps its limits as they are
  assert.deepEqual(by('Lift Carriage').limits.map((v) => +v.toFixed(6)), [0, 0.27]);
});

test('mate quantities in every unit Onshape writes, and the number behind an expression it can\'t read', () => {
  const near = (e, v) => assert.ok(Math.abs(E.mateQty(e) - v) < 1e-12, JSON.stringify(e) + ' -> ' + E.mateQty(e) + ', not ' + v);
  near('3 yd', 3 * 0.9144); near('2 yards', 2 * 0.9144); near('1 yard', 0.9144);
  near('10 centimeters', 0.1); near('10 centimetre', 0.1); near('1 centimeter', 0.01);
  near('25 millimetres', 0.025); near('25 millimetre', 0.025); near('25 millimeters', 0.025);
  near('1 foot', 0.3048); near('2 feet', 0.6096); near('3 inches', 3 * 0.0254); near('2 metres', 2);
  near('90 degrees', Math.PI / 2); near('2 radians', 2);
  near('+5 mm', 0.005); near('1e+2 mm', 0.1); near('1.5E-1 m', 0.15); near('.5 in', 0.0127);
  // a variable or a formula: the parameter's own number (metres or radians), when it has one
  near({ expression: '#liftTop', value: 0.3 }, 0.3);
  near({ expression: '2 * #reach', value: 12, units: 'inch' }, 12 * 0.0254);
  assert.ok(Number.isNaN(E.mateQty({ expression: '#liftTop' })), 'no number at all: unread');
  assert.ok(Number.isNaN(E.mateQty('12 furlongs')));
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

/* ---- what Onshape's URDF export and a part bolted to a moving part taught the body builder ---- */
const jointsOf = (cad) => Object.fromEntries(cad.mechs.filter((j) => j.fromMate).map((j) => [j.id, j]));
test('mates: Onshape\'s exported joint names (revolute_3, cylindrical_1_2) are default names, so the joint takes its body\'s name', () => {
  for (const n of ['Revolute 3', 'revolute_3', 'cylindrical_1_2', 'Fastened 12', 'slider_4', 'Pin slot 1', 'pin_slot_2']) assert.ok(E.MATE_DEFAULT_NAME.test(n), n);
  for (const n of ['lift', 'dof_arm', 'revolute arm', 'closing_revolute_5']) assert.ok(!E.MATE_DEFAULT_NAME.test(n), n);
});

test('mates: a part fastened to a moving part at the root rides it, it doesn\'t drag that part into the frame', () => {
  // a camera bolted to the arm: in a URDF every link is a root-level occurrence, and the
  // camera is the moving end of no mate. It must ride the arm, not pin the arm to the base.
  const u = `<robot name="cam"><link name="base"><visual><geometry><box size="0.4 0.4 0.05"/></geometry></visual><inertial><mass value="5"/></inertial></link>
    <link name="arm"><visual><origin xyz="0.15 0 0"/><geometry><box size="0.3 0.04 0.04"/></geometry></visual><inertial><mass value="0.5"/></inertial></link>
    <link name="camera"><visual><geometry><box size="0.03 0.03 0.03"/></geometry></visual><inertial><mass value="0.05"/></inertial></link>
    <joint name="arm" type="revolute"><parent link="base"/><child link="arm"/><origin xyz="0 0 0.1"/><axis xyz="0 1 0"/><limit lower="-1" upper="1"/></joint>
    <joint name="cam_mount" type="fixed"><parent link="arm"/><child link="camera"/><origin xyz="0.3 0 0.03"/></joint></robot>`;
  const cad = E.cadFromUrdf(u, {});
  const J = jointsOf(cad);
  assert.ok(J.arm, 'the arm turns: ' + cad.onshape.why.filter((w) => /ignored/.test(w)).join(' | '));
  assert.deepEqual(cad.solids.filter((s) => s.mech === 'arm').map((s) => s.name).sort(), ['arm', 'camera']);
});

/* ---- the chassis when nothing is fixed, and still parts a path reaches late (review findings) ---- */
const boxTri = (s) => { const [x, y, z] = s.map((v) => v / 2), V = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], T = [];
  for (const [a, b, c, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) T.push(...V[a], ...V[b], ...V[c], ...V[a], ...V[c], ...V[d]); return T; };
// an Onshape payload by hand: parts as boxes placed by translation, mates with a pivot and an axis in the world
const asmPayload = (parts, mates) => {
  const instances = [], occurrences = [], geom = {}, at = {};
  parts.forEach((p, i) => {
    const eid = 'E' + i; at[p.id] = p.at;
    geom['T/m/MV/e/' + eid + '|default'] = { parts: { ['P' + i]: { name: p.name, tri: boxTri(p.size), color: null } }, mass: {} };
    instances.push({ id: p.id, name: p.name, type: 'Part', suppressed: false, documentId: 'T', elementId: eid, configuration: 'default', documentMicroversion: 'MV', partId: 'P' + i });
    occurrences.push({ path: [p.id], transform: [1, 0, 0, p.at[0], 0, 1, 0, p.at[1], 0, 0, 1, p.at[2], 0, 0, 0, 1], fixed: !!p.fixed, hidden: false });
  });
  const cs = (id, pivot, axis) => { const z = axis, x0 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], d = dot(x0, z), x = x0.map((v, k) => v - d * z[k]), L = Math.hypot(...x);
    const xn = x.map((v) => v / L), y = [z[1] * xn[2] - z[2] * xn[1], z[2] * xn[0] - z[0] * xn[2], z[0] * xn[1] - z[1] * xn[0]];
    return { origin: pivot.map((v, k) => v - at[id][k]), xAxis: xn, yAxis: y, zAxis: z }; };
  const features = mates.map((m, i) => ({ id: 'M' + i, suppressed: false, featureType: 'mate', featureData: { name: m.name, mateType: m.type,
    matedEntities: [{ matedOccurrence: [m.a], matedCS: cs(m.a, m.pivot || [0, 0, 0], m.axis || [0, 0, 1]) }, { matedOccurrence: [m.b], matedCS: cs(m.b, m.pivot || [0, 0, 0], m.axis || [0, 0, 1]) }] } }));
  return { format: E.ONSHAPE_FORMAT, name: 'test', url: '', geom, notes: [], features: { features: [] },
    asm: { rootAssembly: { documentId: 'T', elementId: 'EROOT', configuration: 'default', fullConfiguration: 'default', documentMicroversion: 'MV', instances, occurrences, features, patterns: [] }, subAssemblies: [], parts: [] } };
};
const solidsOf = (cad) => Object.fromEntries(cad.solids.map((s) => [s.name, s]));

test('mates: a lift whose mount was never mated to the chassis still hangs off the chassis (still parts fold in one at a time)', () => {
  const cad = E.cadFromOnshape(asmPayload([
    { id: 'B', name: 'base', size: [0.4, 0.4, 0.05], at: [0, 0, 0], fixed: true },
    { id: 'RM', name: 'railmount', size: [0.05, 0.05, 0.05], at: [0.3, 0, 0.05] },
    { id: 'R', name: 'rail', size: [0.03, 0.03, 0.4], at: [0.3, 0, 0.25] },
    { id: 'C', name: 'carriage', size: [0.06, 0.06, 0.06], at: [0.33, 0, 0.2] },
    { id: 'K', name: 'bracket', size: [0.04, 0.04, 0.04], at: [0.38, 0, 0.2] }],
  [{ name: 'Fastened 1', type: 'FASTENED', a: 'RM', b: 'R' }, { name: 'lift', type: 'SLIDER', a: 'R', b: 'C', pivot: [0.3, 0, 0.2], axis: [0, 0, 1] }, { name: 'Fastened 2', type: 'FASTENED', a: 'C', b: 'K' }]));
  const J = jointsOf(cad), S = solidsOf(cad);
  assert.ok(J.lift, 'the lift is a joint: ' + cad.onshape.why.filter((w) => /ignored|no mate path/.test(w)).join(' | '));
  assert.equal(J.lift.kind, 'linear');
  assert.equal(S.bracket.mech, 'lift');
  assert.ok(!S.rail.mech && !S.railmount.mech, 'the rail and its mount are frame');
});

test('mates: with nothing fixed, the biggest body a mate touches is the chassis, so a camera on the arm does not make the arm the ground', () => {
  const cad = E.cadFromOnshape(asmPayload([
    { id: 'CH', name: 'chassis plate', size: [0.4, 0.4, 0.05], at: [0, 0, 0] },
    { id: 'A', name: 'arm', size: [0.3, 0.04, 0.04], at: [0.15, 0, 0.1] },
    { id: 'CAM', name: 'camera', size: [0.03, 0.03, 0.03], at: [0.3, 0, 0.14] }],
  [{ name: 'arm', type: 'REVOLUTE', a: 'CH', b: 'A', pivot: [0, 0, 0.1], axis: [0, 1, 0] }, { name: 'Fastened 1', type: 'FASTENED', a: 'A', b: 'CAM' }]));
  const J = jointsOf(cad), S = solidsOf(cad);
  assert.ok(J.arm, Object.keys(J).join(','));
  assert.equal(J.arm.parent, 'chassis');
  assert.equal(S.camera.mech, 'arm');
  assert.ok(!S['chassis plate'].mech);
});
