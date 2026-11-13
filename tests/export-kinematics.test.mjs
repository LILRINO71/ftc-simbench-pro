// An export zip's joints, checked against the file itself. A URDF says exactly how
// its parts move, so the reader is right when, with a joint driven, every part ends
// up where the file's own joint tree puts it (./exportrobot.mjs: a generated robot
// the way Onshape exports one, and its kinematics). No robot is special here: each
// case below is a way any export is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, run } from './load.mjs';
import { exportRobot, misplaced, EXPORT_JAVA } from './exportrobot.mjs';

const E = loadEngine();
const read = async (opt, bindOpts) => {
  const R = exportRobot(opt), cad = await E.urdfRobot(R.xml, {}, 'export robot', {});
  const code = E.parseJava(EXPORT_JAVA), B = E.bindDevices(code, cad, bindOpts || {});
  return { R, cad, code, B };
};
const joint = (cad, mate) => cad.mechs.find((m) => m.fromMate && m.fromMate.name === mate);
// each mechanism driven a little: the lead joint, and the file's joints with it
const MOVES = [
  ['revolute_turret', { revolute_turret: 0.7 }],
  ['slider_1', { slider_1: 0.2, slider_2: 0.2 }],
  ['revolute_arm', { revolute_arm: 0.8 }],
  ['revolute_claw_left', { revolute_claw_left: 0.4, revolute_claw_right: -0.4 }],
  ['revolute_hood', { revolute_hood: 0.3 }],
  ['revolute_spindexer_1', { revolute_spindexer_1: 0.9, revolute_spindexer_2: 0.9, revolute_spindexer_3: 0.9 }],
  ['revolute_intake', { revolute_intake: 1.0 }],
];
const wrong = (X, moves = MOVES) => moves.flatMap(([lead, Q]) => misplaced(E, X.R, X.cad, lead, Q).map((w) => lead + ': ' + w));

test('export: with each mechanism driven, every part is where the file\'s own joints put it', async () => {
  assert.deepEqual(wrong(await read({})), []);
  assert.deepEqual(wrong(await read({ rot: true })), [], 'and with a joint frame turned, its axis pointing the other way');
});

test('export: the limits are the file\'s, and every device but the flywheel\'s finds its joint', async () => {
  const X = await read({});
  for (const j of X.R.joints) {
    if (j.lo == null || Math.abs(j.lo) > 999) continue;
    const m = joint(X.cad, j.name);
    assert.ok(m && m.limits, j.name + ' has limits');
    assert.ok(Math.abs(m.limits[0] - j.lo) < 1e-9 && Math.abs(m.limits[1] - j.hi) < 1e-9, j.name + ': ' + m.limits);
  }
  assert.deepEqual(X.B.open.map((o) => o.device), ['shooter'], 'a flywheel is a wheel on its axle: its motor runs as a gauge');
  assert.equal(E.driveFromCAD(X.cad, {}).wheels.length, 4, 'the four drive wheels are still the drive');
});

test('mates: a wheel with its own joint rides whatever carries it, not the frame', async () => {
  // the flywheel on the turret, and a compliant wheel (with its guard) on an intake arm
  const X = await read({ intakeArm: true });
  const rides = (link) => X.cad.solids.find((s) => s.link === link).mech;
  assert.equal(rides('shooter_flywheel'), joint(X.cad, 'revolute_turret').id);
  assert.equal(rides('compliant_wheel_1'), joint(X.cad, 'revolute_intake_arm').id);
  assert.equal(rides('wheel_guard'), joint(X.cad, 'revolute_intake_arm').id, 'and what is fastened to the wheel goes with it');
  assert.deepEqual(wrong(X, [['revolute_turret', { revolute_turret: 0.7 }], ['revolute_intake_arm', { revolute_intake_arm: 0.9 }]]), []);
});

test('classify: plates on one shaft, each mated to the frame, turn together; the one the code drives leads', async () => {
  const X = await read({});
  const [p1, p2, p3] = [1, 2, 3].map((k) => joint(X.cad, 'revolute_spindexer_' + k));
  assert.ok(!p1.internal && !p2.internal && !p3.internal, 'none is held as drawn');
  assert.deepEqual([p2.couple && p2.couple.to, p3.couple && p3.couple.to], [p1.id, p1.id]);
  assert.ok(X.B.couplings.some((c) => c.via === 'coaxial' && c.joint === p2.id), 'and the import says so');
  // the code's device on the second plate: that one leads, the first and third follow it
  const code = X.code;
  E.bindDevices(code, X.cad, { explicit: { spindexer: p2.id } });
  assert.ok(!p2.couple && p1.couple.to === p2.id && p3.couple.to === p2.id);
  assert.deepEqual(misplaced(E, X.R, X.cad, 'revolute_spindexer_2', MOVES[5][1]), []);
  // two of them driven (two mechanisms that happen to share a centre line): each its own
  E.bindDevices(code, X.cad, { explicit: { spindexer: p1.id, shooter: p3.id } });
  assert.ok(!p1.couple && !p3.couple && p2.couple.to === p1.id);
  // and back: nothing is remembered from the last binding
  E.bindDevices(code, X.cad, {});
  assert.deepEqual([p2.couple.to, p3.couple.to], [p1.id, p1.id]);
});

test('classify: a bearing\'s race, the shaft in it and the arm on the shaft are one joint, the one with limits', async () => {
  const X = await read({ raceChain: true });
  const arm = joint(X.cad, 'revolute_arm');
  assert.ok(joint(X.cad, 'revolute_arm_race').internal && joint(X.cad, 'revolute_arm_shaft').internal);
  assert.ok(!arm.internal);
  assert.equal(X.B.map.arm, arm.id, 'the arm servo drives the joint that has the arm\'s limits');
  assert.deepEqual(X.B.idle, [], 'and no second "arm" is left over');
  assert.deepEqual(wrong(X), []);
});

test('classify: a joint with travel limits is a mechanism however small it is', async () => {
  const X = await read({ smallClaw: true });
  const L = joint(X.cad, 'revolute_claw_left'), Rt = joint(X.cad, 'revolute_claw_right');
  assert.ok(!L.internal && !Rt.internal, '35 mm fingers are not bearing races');
  assert.equal(X.B.map.claw, L.id);
  assert.deepEqual(wrong(X), []);
});

test('bind: a stage that follows its lift is never "the only joint left" for another motor', async () => {
  // a frame and a two-stage lift; the code has the lift's motor and a shooter's, which has no joint here
  const box = (s) => `<visual><geometry><box size="${s}"/></geometry></visual>`;
  const urdf = `<?xml version="1.0"?><robot name="lift_only">
<link name="Frame">${box('0.4 0.4 0.1')}</link><link name="Slide_stage_1">${box('0.03 0.03 0.3')}</link><link name="Slide_stage_2">${box('0.02 0.02 0.3')}</link>
<joint name="lift_1" type="prismatic"><parent link="Frame"/><child link="Slide_stage_1"/><origin xyz="0 0 0.2"/><axis xyz="0 0 1"/><limit lower="0" upper="0.3"/></joint>
<joint name="lift_2" type="prismatic"><parent link="Slide_stage_1"/><child link="Slide_stage_2"/><origin xyz="0.03 0 0"/><axis xyz="0 0 1"/><limit lower="0" upper="0.3"/></joint>
</robot>`;
  const cad = await E.urdfRobot(urdf, {}, 'lift only', {});
  const code = E.parseJava(`package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*; import com.qualcomm.robotcore.hardware.*;
@TeleOp(name="Lift") public class Lift extends LinearOpMode {
  public void runOpMode(){
    DcMotor lift=hardwareMap.get(DcMotor.class,"liftMotor");
    DcMotor shooter=hardwareMap.get(DcMotor.class,"shooter");
    waitForStart();
    while(opModeIsActive()){ lift.setPower(-gamepad2.right_stick_y); shooter.setPower(gamepad2.right_trigger); }
  }
}`);
  const B = E.bindDevices(code, cad, {});
  const [s1, s2] = ['lift_1', 'lift_2'].map((n) => joint(cad, n));
  assert.equal(B.map.lift, s1.id);
  assert.equal(B.map.shooter, null, 'the shooter is a question, not the lift\'s second stage');
  assert.deepEqual(s2.couple && s2.couple.to, s1.id, 'which follows the first');
  const by = B.bound.find((b) => b.device === 'lift');
  assert.ok(typeof by.score === 'number' && typeof by.why === 'string');
});

test('mates: a slider mate that points down still lifts, and a stage follows the way its leader goes', async () => {
  for (const [opt, Q] of [[{ liftDown: true }, { slider_1: -0.2, slider_2: -0.2 }], [{ liftMixed: true }, { slider_1: 0.2, slider_2: -0.2 }]]) {
    const X = await read(opt), s1 = joint(X.cad, 'slider_1'), s2 = joint(X.cad, 'slider_2');
    assert.deepEqual(misplaced(E, X.R, X.cad, 'slider_1', Q), [], JSON.stringify(opt));
    // the team's stick up (positive power): both stages end up above where they were drawn
    E.Sim.reset(X.code, X.cad, X.B.map, { payloadKg: 0, duty: 1, trust: 'code', startPose: { x: 0, y: 0, h: 0 } });
    E.Sim.pad = { 1: {}, 2: { right_stick_y: -1 } }; run(E, 1.5);
    const own = new Map(); for (const n in E.Sim.dev) { const s = E.Sim.dev[n]; if (s.mech && !own.has(s.mech.id)) own.set(s.mech.id, s); }
    const q = E.jointValues(X.cad.mechs, (m) => { const s = own.get(m.id); return s ? E.mateJointQ(m, s, 0.5) : (m.couple ? null : 0); });
    const up = (m) => m.axis[2] * q.get(m.id);       // metres up, in the robot frame
    assert.ok(up(s1) > 0.2 && up(s2) > 0.2, JSON.stringify(opt) + ': stage 1 ' + up(s1) + ' m, stage 2 ' + up(s2) + ' m');
  }
});
