// Exact joints (src/jointsheet.js): the team says which joints are mechanisms and
// what drives each, in the mates' names in Onshape or in a joint sheet on the page,
// and from then on nothing is guessed. The robot here is exported the way Onshape
// writes a renamed mate: lower case, every other character an underscore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { glb, zip } from './exportzip.mjs';

const E = loadEngine();

// mates renamed in Onshape: "Motor armMotor", "Motor armMotor" again in the mirrored copy
// of the arm subassembly, "Servo claw rev", "Follow claw rev", "Motor liftL liftR",
// "Follow liftL x2"; two mates left with their default names: a 150 mm flap (big
// enough that the bench would call it a mechanism) and a motor shaft
const TAGGED = `<?xml version="1.0"?><robot name="tagged">
<link name="Frame"><visual><geometry><mesh filename="package://tagged/meshes/Frame.glb"/></geometry></visual><inertial><mass value="6.0"/></inertial></link>
<link name="Arm"><visual><geometry><mesh filename="package://tagged/meshes/arm.glb"/></geometry></visual></link>
<link name="Arm_R"><visual><geometry><mesh filename="package://tagged/meshes/arm.glb"/></geometry></visual></link>
<link name="Claw"><visual><geometry><mesh filename="package://tagged/meshes/finger.glb"/></geometry></visual></link>
<link name="Claw_2"><visual><geometry><mesh filename="package://tagged/meshes/finger.glb"/></geometry></visual></link>
<link name="Lift_1"><visual><geometry><mesh filename="package://tagged/meshes/stage.glb"/></geometry></visual></link>
<link name="Lift_2"><visual><geometry><mesh filename="package://tagged/meshes/stage.glb"/></geometry></visual></link>
<link name="Flap"><visual><geometry><mesh filename="package://tagged/meshes/flap.glb"/></geometry></visual></link>
<link name="Shaft"><visual><geometry><mesh filename="package://tagged/meshes/shaft.glb"/></geometry></visual></link>
<joint name="motor_armmotor" type="revolute"><parent link="Frame"/><child link="Arm"/><origin xyz="0 0.15 0.25"/><axis xyz="1 0 0"/><limit lower="-0.2" upper="2.0" effort="1" velocity="1"/></joint>
<joint name="motor_armmotor_1" type="revolute"><parent link="Frame"/><child link="Arm_R"/><origin xyz="0 -0.15 0.25"/><axis xyz="-1 0 0"/><limit lower="-2.0" upper="0.2" effort="1" velocity="1"/></joint>
<joint name="servo_claw_rev" type="revolute"><parent link="Arm"/><child link="Claw"/><origin xyz="0.03 0 0.12"/><axis xyz="0 0 1"/><limit lower="-0.9" upper="0.9" effort="1" velocity="1"/></joint>
<joint name="follow_claw_rev" type="revolute"><parent link="Arm"/><child link="Claw_2"/><origin xyz="-0.03 0 0.12"/><axis xyz="0 0 1"/><limit lower="-0.9" upper="0.9" effort="1" velocity="1"/></joint>
<joint name="motor_liftl_liftr" type="prismatic"><parent link="Frame"/><child link="Lift_1"/><origin xyz="-0.15 0 0.2"/><axis xyz="0 0 1"/><limit lower="0" upper="0.6" effort="1" velocity="1"/></joint>
<joint name="follow_liftl_x2" type="prismatic"><parent link="Lift_1"/><child link="Lift_2"/><origin xyz="0 0 0.05"/><axis xyz="0 0 1"/><limit lower="0" upper="0.6" effort="1" velocity="1"/></joint>
<joint name="revolute_3" type="continuous"><parent link="Frame"/><child link="Flap"/><origin xyz="0.2 0 0.1"/><axis xyz="0 1 0"/></joint>
<joint name="revolute_7" type="continuous"><parent link="Frame"/><child link="Shaft"/><origin xyz="0.12 0.1 0.08"/><axis xyz="0 1 0"/></joint>
</robot>`;
// the same robot as it comes out when nobody renamed anything
const PLAIN = TAGGED.replace(/"motor_armmotor"/g, '"revolute_1"').replace(/"motor_armmotor_1"/g, '"revolute_1_1"').replace(/"servo_claw_rev"/g, '"revolute_2"')
  .replace(/"follow_claw_rev"/g, '"revolute_4"').replace(/"motor_liftl_liftr"/g, '"slider_1"').replace(/"follow_liftl_x2"/g, '"slider_2"');
const ZIP = (urdf) => zip([
  { name: 'tagged/urdf/tagged.urdf', data: urdf, deflate: true },
  { name: 'tagged/meshes/Frame.glb', data: glb([0.7, 0.7, 0.72], 0.4), deflate: true },
  { name: 'tagged/meshes/arm.glb', data: glb([0.9, 0.6, 0.1], 0.15), deflate: true },
  { name: 'tagged/meshes/finger.glb', data: glb([0.1, 0.1, 0.1], 0.06), deflate: false },
  { name: 'tagged/meshes/stage.glb', data: glb([0.9, 0.6, 0.1], 0.12), deflate: true },
  { name: 'tagged/meshes/flap.glb', data: glb([0.2, 0.2, 0.2], 0.15), deflate: true },
  { name: 'tagged/meshes/shaft.glb', data: glb([0.5, 0.5, 0.5], 0.012), deflate: true },
]);
const JAVA = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*; import com.qualcomm.robotcore.hardware.*;
@TeleOp(name="Tele") public class Tele extends LinearOpMode {
  public void runOpMode(){
    DcMotor fl=hardwareMap.get(DcMotor.class,"frontLeft"), fr=hardwareMap.get(DcMotor.class,"frontRight"), bl=hardwareMap.get(DcMotor.class,"backLeft"), br=hardwareMap.get(DcMotor.class,"backRight");
    DcMotor arm=hardwareMap.get(DcMotor.class,"armMotor");
    DcMotor liftL=hardwareMap.get(DcMotor.class,"liftL"), liftR=hardwareMap.get(DcMotor.class,"liftR");
    Servo flap=hardwareMap.get(Servo.class,"flap");
    Servo claw=hardwareMap.get(Servo.class,"claw");
    waitForStart();
    while(opModeIsActive()){
      fl.setPower(-gamepad1.left_stick_y); fr.setPower(-gamepad1.left_stick_y); bl.setPower(-gamepad1.left_stick_y); br.setPower(-gamepad1.left_stick_y);
      arm.setPower(gamepad2.left_stick_y); liftL.setPower(gamepad2.right_stick_y); liftR.setPower(gamepad2.right_stick_y);
      if(gamepad1.x) flap.setPosition(1);
      if(gamepad2.a) claw.setPosition(0.2); if(gamepad2.b) claw.setPosition(0.7);
    }
  }
}`;
const robot = async (urdf) => (await E.urdfRobotFromZip(ZIP(urdf), 'tagged.zip')).cad;
const mech = (cad, id) => cad.mechs.find((m) => m.id === id);

test('jointTag: a mate whose name starts with motor, servo, crservo, follow, free or fixed is a declaration, as typed or as exported', () => {
  assert.deepEqual(E.jointTag('Motor armMotor'), { drive: 'motor', rev: false, devices: ['armMotor'] });
  assert.deepEqual(E.jointTag('motor_armmotor'), { drive: 'motor', rev: false, devices: ['armmotor'] }, 'the export lower-cases it');
  assert.deepEqual(E.jointTag('motor_armmotor_3'), { drive: 'motor', rev: false, devices: ['armmotor'] }, 'the fourth copy of a subassembly');
  assert.deepEqual(E.jointTag('Motor liftL liftR (1)'), { drive: 'motor', rev: false, devices: ['liftL', 'liftR'] }, 'a pasted copy');
  assert.deepEqual(E.jointTag('servo_claw_rev'), { drive: 'servo', rev: true, devices: ['claw'] });
  assert.deepEqual(E.jointTag('CRServo intake'), { drive: 'crservo', rev: false, devices: ['intake'] });
  assert.deepEqual(E.jointTag('follow_liftl_x2'), { drive: 'follow', rev: false, follows: 'liftl', ratio: 2 });
  assert.deepEqual(E.jointTag('Follow liftL x1p5 rev'), { drive: 'follow', rev: true, follows: 'liftL', ratio: 1.5 });
  assert.deepEqual(E.jointTag('free'), { drive: 'free', rev: false });
  assert.deepEqual(E.jointTag('fixed_1'), { drive: 'fixed', rev: false });
  assert.deepEqual(E.jointTag('follow_x_loop_closure'), { drive: 'follow', rev: false, follows: 'x' }, 'the export\'s loop-closure words are not a name');
  // just names
  for (const n of ['Revolute 10 (1)', 'revolute_10__1_', 'Arm pivot', 'Intake motor mount', 'slider_3', 'follow', '']) assert.equal(E.jointTag(n), null, n);
});

test('onshapeMateName: the mate to look for in Onshape, and which copy of it', () => {
  assert.deepEqual(E.onshapeMateName('revolute_10'), { mate: 'Revolute 10', copy: 1, exact: true });
  assert.deepEqual(E.onshapeMateName('revolute_10__1___1_'), { mate: 'Revolute 10 (1) (1)', copy: 1, exact: true });
  assert.deepEqual(E.onshapeMateName('revolute_1_179'), { mate: 'Revolute 1', copy: 180, exact: true }, 'a servo\'s own mate, in its 180th servo');
  assert.deepEqual(E.onshapeMateName('pin_slot_2'), { mate: 'Pin slot 2', copy: 1, exact: true });
  assert.equal(E.onshapeMateName('arm_pivot').mate, 'arm pivot');
});

test('tagFor: what to type as the mate\'s name reads back as the same declaration', () => {
  const cases = [
    { drive: 'motor', devices: ['liftL', 'liftR'], rev: false },
    { drive: 'servo', devices: ['claw'], rev: true },
    { drive: 'crservo', devices: ['intake'], rev: false },
    { drive: 'follow', follows: 'liftL', ratio: 2, rev: false },
    { drive: 'follow', follows: 'claw', ratio: 1.5, rev: true },
  ];
  for (const e of cases) {
    const t = E.jointTag(E.tagFor(e));
    assert.equal(t.drive, e.drive); assert.equal(t.rev, e.rev, E.tagFor(e));
    if (e.devices) assert.deepEqual(t.devices, e.devices);
    if (e.follows) { assert.equal(t.follows, e.follows); assert.equal(t.ratio, e.ratio); }
  }
  assert.equal(E.tagFor({ drive: 'servo', devices: ['claw'], rev: true }), 'servo claw rev');
  assert.equal(E.tagFor({ drive: 'none' }), '');
});

test('exact: with the mates named, the declared joints are the mechanisms and every other joint is held, even a big one', async () => {
  const plain = await robot(PLAIN);
  E.classifyJoints(plain);
  assert.ok(!E.isExact(plain), 'nothing declared: the bench works it out');
  assert.ok(!mech(plain, 'revolute_3').internal, 'and, left to guess, it calls the 150 mm flap a mechanism');

  const cad = await robot(TAGGED);
  assert.ok(E.isExact(cad));
  assert.equal(cad.sheet.from, 'tags');
  assert.equal(cad.sheet.declared, 6); assert.equal(cad.sheet.held, 2);
  assert.ok(cad.onshape.why.some((w) => /6 joints declared \(6 from your mates' names\); the other 2 are held as drawn, so nothing is guessed/.test(w)), cad.onshape.why.join(' | '));
  const C = E.classifyJoints(cad);
  assert.ok(C.exact);
  assert.deepEqual(cad.mechs.filter((m) => !m.drive && !m.internal).map((m) => m.id).sort(),
    ['follow_claw_rev', 'follow_liftl_x2', 'motor_armmotor', 'motor_armmotor_1', 'motor_liftl_liftr', 'servo_claw_rev']);
  assert.equal(mech(cad, 'revolute_3').internalWhy, 'undeclared', 'the flap is held: nobody said it moves');
  assert.equal(mech(cad, 'revolute_7').internalWhy, 'undeclared');
});

test('exact: limits are the mate\'s own, "rev" turns the device\'s way round, follow and a repeated device couple the joints', async () => {
  const cad = await robot(TAGGED);
  const claw = mech(cad, 'servo_claw_rev'), claw2 = mech(cad, 'follow_claw_rev'), lift = mech(cad, 'motor_liftl_liftr'), lift2 = mech(cad, 'follow_liftl_x2');
  assert.deepEqual(claw.limits.map((v) => +v.toFixed(3)), [-0.9, 0.9], 'radians, from the export');
  assert.equal(claw.dir, -1, 'rev');
  assert.equal(mech(cad, 'motor_armmotor').dir, 1);
  assert.deepEqual(claw2.couple, { to: 'servo_claw_rev', ratio: -1, via: 'declared' }, 'the other finger mirrors the servo\'s');
  assert.deepEqual(lift2.couple, { to: 'motor_liftl_liftr', ratio: 2, via: 'declared' }, 'the second stage, twice the first');
  assert.deepEqual(lift.limits.map((v) => +v.toFixed(3)), [0, 0.6]);
  // one motor named on both arms (a subassembly used twice, mirrored): the copy turns with the first, the same way in the world
  assert.deepEqual(mech(cad, 'motor_armmotor_1').couple, { to: 'motor_armmotor', ratio: -1, via: 'same device' });
  assert.equal(claw.label, 'claw');
  assert.equal(lift.label, 'liftl + liftr');
});

test('exact: devices land where the mates\' names say, and a device nobody declared is a question, never a guess', async () => {
  const cad = await robot(TAGGED);
  const code = E.parseJava(JAVA);
  const B = E.bindDevices(code, cad, { isCommanded: () => true });
  assert.ok(B.exact);
  assert.equal(B.map.arm, 'motor_armmotor');
  assert.equal(B.map.liftL, 'motor_liftl_liftr'); assert.equal(B.map.liftR, 'motor_liftl_liftr');
  assert.equal(B.map.claw, 'servo_claw_rev');
  assert.ok(B.bound.every((b) => b.by === 'mate name'), JSON.stringify(B.bound));
  assert.equal(B.map.fl, null, 'drive motors are the drivetrain\'s');
  // "flap" would match the Flap by name; declared robots don't guess
  assert.equal(B.map.flap, null);
  assert.deepEqual(B.open.map((o) => o.device), ['flap']);
  assert.equal(B.couplings.length, 0, 'no hints applied: the declarations already said how things couple');
  // the check names the fix: the mate's new name
  const map = Object.assign({}, B.map);
  const K = E.checkJointSheet(cad, code, map, { isCommanded: () => true });
  const f = K.items.find((i) => i.device === 'flap');
  assert.ok(f && f.sev === 'fail' && f.tag === 'servo flap' && /rename the mate that moves it to "servo flap"/.test(f.text), JSON.stringify(K.items));
  // the robot check says the joints are declared
  const rc = E.checkRobot(cad, code, map, { isCommanded: () => true, front: '+x', swing: false });
  const src = rc.items.find((i) => i.key === 'source');
  assert.equal(src.sev, 'ok'); assert.match(src.text, /declared in your mates' names: 6 mechanisms, the other 2 joints held as drawn\. Nothing is guessed/);
});

test('exact: a declared device the code doesn\'t have, and a servo with no range, are said', async () => {
  const urdf = TAGGED.replace(/"motor_armmotor"/, '"motor_armmotr"').replace(/(<joint name="servo_claw_rev"[\s\S]*?)<limit[^>]*\/>/, '$1');
  const cad = await robot(urdf);
  const code = E.parseJava(JAVA);
  const B = E.bindDevices(code, cad, { isCommanded: () => true });
  const K = E.checkJointSheet(cad, code, B.map, { isCommanded: () => true });
  assert.ok(K.items.some((i) => i.sev === 'warn' && /declared as motor armmotr, but your code has no device by that name \(did you mean armMotor\?\)/.test(i.text)), JSON.stringify(K.items));
  assert.ok(K.items.some((i) => i.sev === 'warn' && /is a servo with no range/.test(i.text)));
});

test('sheet: the same declarations from the page, keyed by the export\'s joint names; applied again or changed, it starts from the mates', async () => {
  const cad = await robot(PLAIN);
  const before = mech(cad, 'revolute_2').limits.slice();
  const sheet = { format: E.JOINT_SHEET_FORMAT, version: 1, joints: [
    { joint: 'revolute_1', drive: 'motor', devices: ['armMotor'] },
    { joint: 'revolute_2', drive: 'servo', devices: ['claw'], limits: [-30, 45], rev: true },
    { joint: 'slider_1', drive: 'motor', devices: ['liftL', 'liftR'] },
    { joint: 'slider_2', drive: 'follow', follows: 'liftL', ratio: 2 },
    { joint: 'Revolute 3', drive: 'servo', devices: ['flap'], limits: [0, 120] }, // as Onshape shows it: the same joint
  ] };
  const S = E.applyJointSheet(cad, sheet);
  assert.ok(S.exact); assert.equal(S.from, 'sheet'); assert.equal(S.declared, 5);
  assert.deepEqual(mech(cad, 'revolute_2').limits.map((v) => +(v * 180 / Math.PI).toFixed(3)), [-30, 45], 'degrees on file, radians on the joint');
  assert.equal(mech(cad, 'revolute_3').declaredRole, 'servo');
  E.classifyJoints(cad);
  assert.ok(mech(cad, 'revolute_4').internal && mech(cad, 'revolute_1_1').internal, 'not on the sheet: held');
  const code = E.parseJava(JAVA);
  const B = E.bindDevices(code, cad, { isCommanded: () => true });
  assert.equal(B.map.flap, 'revolute_3'); assert.equal(B.open.length, 0, JSON.stringify(B.open));
  assert.ok(B.bound.every((b) => b.by === 'sheet'));
  // applied twice: the same; a smaller sheet: the rest go back to what the mates said
  E.applyJointSheet(cad, sheet);
  assert.equal(mech(cad, 'revolute_2').dir, -1);
  E.applyJointSheet(cad, { format: E.JOINT_SHEET_FORMAT, joints: [{ joint: 'revolute_1', drive: 'motor', devices: ['armMotor'] }] });
  assert.deepEqual(mech(cad, 'revolute_2').limits, before, 'the mate\'s limits back');
  assert.equal(mech(cad, 'revolute_2').dir, 1);
  assert.ok(!mech(cad, 'revolute_2').declared && !mech(cad, 'slider_2').couple);
  E.clearJointSheet(cad);
  assert.ok(!E.isExact(cad) && cad.sheet === null);
  assert.throws(() => E.applyJointSheet(cad, { joints: [] }), /not a joint sheet/);
});

test('sheet: the page overrides a mate\'s name, "none" takes a declaration away, and a renumbered joint is found by where it sits', async () => {
  const cad = await robot(TAGGED);
  const page = { format: E.JOINT_SHEET_FORMAT, exact: true, joints: [
    { joint: 'servo_claw_rev', drive: 'servo', devices: ['claw'], limits: [0, 90] },     // the range typed in, and no "rev"
    { joint: 'follow_claw_rev', drive: 'none' },
  ] };
  E.applyJointSheet(cad, E.mergeJointSheets(E.sheetFromTags(cad), page));
  assert.equal(cad.sheet.from, 'tags+sheet');
  assert.equal(mech(cad, 'servo_claw_rev').dir, 1);
  assert.ok(!mech(cad, 'follow_claw_rev').declared, 'taken away');
  E.classifyJoints(cad);
  assert.ok(mech(cad, 'follow_claw_rev').internal);
  // a mate in a subassembly used many times is numbered by copy; adding a copy can renumber them
  const plain = await robot(PLAIN), r1 = mech(plain, 'revolute_1_1');
  const at = r1.pivot.map((v) => v * 1000);
  const S = E.applyJointSheet(plain, { format: E.JOINT_SHEET_FORMAT, joints: [{ joint: 'revolute_1_7', drive: 'motor', devices: ['armMotor'], at }] });
  assert.ok(r1.declared, 'found by its pivot'); assert.equal(S.missing.length, 0);
  assert.ok(S.why.some((w) => /revolute_1_7 → revolute_1_1/.test(w)), S.why.join(' | '));
  const S2 = E.applyJointSheet(plain, { format: E.JOINT_SHEET_FORMAT, joints: [{ joint: 'revolute_1_1', drive: 'motor', devices: ['armMotor'], at: [at[0] + 80, at[1], at[2]] }] });
  assert.deepEqual(S2.missing, ['revolute_1_1'], 'same name, somewhere else: not that joint');
});

test('exact needs a device: a lone "free" or "follow" in a team\'s own mate names declares only itself', async () => {
  const cad = await robot(PLAIN.replace(/"revolute_4"/g, '"free_flap"'));
  assert.ok(cad.sheet && !cad.sheet.exact);
  E.classifyJoints(cad);
  assert.ok(!E.isExact(cad));
  assert.ok(!mech(cad, 'free_flap').internal, 'kept');
  assert.ok(!mech(cad, 'revolute_3').internal, 'the rest still worked out as before');
  const rc = E.checkRobot(cad, E.parseJava(JAVA), {}, { isCommanded: () => true, front: '+x', swing: false });
  const src = rc.items.find((i) => i.key === 'source');
  assert.equal(src.ask, 'declare'); assert.match(src.text, /worked out from what they carry/);
});
