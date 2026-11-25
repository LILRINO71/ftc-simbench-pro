// A whole FTC robot the way Onshape's URDF export writes one, built from boxes and
// cylinders (no mesh files), with the joints known. The reader is checked against
// the file's own kinematics: drive a joint, and every part has to end up where the
// URDF's joint tree puts it (./export-kinematics.test.mjs).
//
// What it has, each the way a real export has it:
//   - the frame as one link of many parts; four wheels, each on a bearing race's joint
//   - a two-stage lift (two slider joints, no relation: the export drops those)
//   - an arm on the top stage, a two-finger claw on the arm
//   - a turret carrying a hood and a flywheel
//   - a spindexer: three plates, each mated to the frame on the same axis
//   - an intake roller; a motor shaft with its own joint; a planar mate in three pieces
// opt: raceChain  the arm's pivot as a library bearing writes it: race, shaft, arm, one axis
//      rot        the arm's joint frame turned, its axis pointing the other way
//      smallClaw  35 mm fingers
//      intakeArm  a second arm on the frame, carrying a compliant wheel on its own joint
//      liftDown   both slider mates pointing down;  liftMixed  only the second one
export function exportRobot(opt = {}) {
  const links = [], joints = [];
  const vis = (v) => `<visual><origin xyz="${(v.xyz || [0, 0, 0]).join(' ')}" rpy="${(v.rpy || [0, 0, 0]).join(' ')}"/><geometry>` +
    (v.box ? `<box size="${v.box.join(' ')}"/>` : `<cylinder radius="${v.cyl[0]}" length="${v.cyl[1]}"/>`) + '</geometry></visual>';
  const link = (name, visuals, mass = 0.1) => { links.push({ name, visuals, mass }); };
  const joint = (name, type, parent, child, xyz, axis, lo, hi, rpy) => { joints.push({ name, type, parent, child, xyz, axis: axis || [0, 0, 1], lo, hi, rpy: rpy || [0, 0, 0] }); };
  const Y = [Math.PI / 2, 0, 0];                 // a cylinder lies along z; turned about x it lies along y
  link('chassis_1', [
    { box: [0.40, 0.04, 0.04], xyz: [0, 0.15, 0.06] }, { box: [0.40, 0.04, 0.04], xyz: [0, -0.15, 0.06] },
    { box: [0.04, 0.30, 0.04], xyz: [0.16, 0, 0.06] }, { box: [0.04, 0.30, 0.04], xyz: [-0.16, 0, 0.06] },
    { box: [0.30, 0.26, 0.004], xyz: [0, 0, 0.085] },
  ], 4);
  for (const [n, x, y] of [['fl', 0.15, 0.19], ['fr', 0.15, -0.19], ['bl', -0.15, 0.19], ['br', -0.15, -0.19]]) {
    link(`bearing_inner_race_${n}`, [{ cyl: [0.007, 0.006], rpy: Y }], 0.005);
    joint(`revolute_race_${n}`, 'continuous', 'chassis_1', `bearing_inner_race_${n}`, [x, y * 0.9, 0.048], [0, 1, 0]);
    link(`mecanum_wheel_${n}`, [{ cyl: [0.048, 0.038], rpy: Y }], 0.3);
    joint(`revolute_wheel_${n}`, 'continuous', `bearing_inner_race_${n}`, `mecanum_wheel_${n}`, [0, y * 0.1, 0], [0, 1, 0]);
  }
  // the lift
  const d1 = opt.liftDown ? -1 : 1, d2 = opt.liftMixed ? -d1 : d1, lim = (d) => (d > 0 ? [0, 0.25] : [-0.25, 0]);
  link('slide_fixed', [{ box: [0.02, 0.02, 0.30], xyz: [0, 0, 0.15] }], 0.2);
  joint('fastened_slide', 'fixed', 'chassis_1', 'slide_fixed', [-0.12, 0, 0.09]);
  link('slide_stage_1', [{ box: [0.016, 0.016, 0.30], xyz: [0, 0, 0.15] }], 0.15);
  joint('slider_1', 'prismatic', 'slide_fixed', 'slide_stage_1', [0.02, 0, 0], [0, 0, d1], ...lim(d1));
  link('slide_stage_2', [{ box: [0.012, 0.012, 0.30], xyz: [0, 0, 0.15] }, { box: [0.06, 0.08, 0.004], xyz: [0.02, 0, 0.29] }], 0.15);
  joint('slider_2', 'prismatic', 'slide_stage_1', 'slide_stage_2', [0.02, 0, 0], [0, 0, d2], ...lim(d2));
  // the arm
  if (opt.raceChain) {
    link('arm_bearing_race', [{ cyl: [0.007, 0.006], rpy: Y }], 0.005);
    joint('revolute_arm_race', 'continuous', 'slide_stage_2', 'arm_bearing_race', [0.04, 0, 0.29], [0, 1, 0]);
    link('arm_shaft', [{ cyl: [0.004, 0.05], rpy: Y }], 0.01);
    joint('revolute_arm_shaft', 'continuous', 'arm_bearing_race', 'arm_shaft', [0, 0, 0], [0, 1, 0]);
    link('arm_plates', [{ box: [0.20, 0.004, 0.03], xyz: [0.10, 0.02, 0] }, { box: [0.20, 0.004, 0.03], xyz: [0.10, -0.02, 0] }], 0.2);
    joint('revolute_arm', 'revolute', 'arm_shaft', 'arm_plates', [0, 0, 0], [0, 1, 0], -1.2, 1.5);
  } else if (opt.rot) {
    link('arm_shaft', [{ cyl: [0.004, 0.05] }], 0.01);
    joint('revolute_arm', 'revolute', 'slide_stage_2', 'arm_shaft', [0.04, 0, 0.29], [0, 0, -1], -1.2, 1.5, [Math.PI / 2, 0.3, 0]);
    link('arm_plates', [{ box: [0.20, 0.03, 0.004], xyz: [0.10, 0, 0.02] }, { box: [0.20, 0.03, 0.004], xyz: [0.10, 0, -0.02] }], 0.2);
    joint('fastened_arm', 'fixed', 'arm_shaft', 'arm_plates', [0, 0, 0]);
  } else {
    link('arm_shaft', [{ cyl: [0.004, 0.05], rpy: Y }], 0.01);
    joint('revolute_arm', 'revolute', 'slide_stage_2', 'arm_shaft', [0.04, 0, 0.29], [0, 1, 0], -1.2, 1.5);
    link('arm_plates', [{ box: [0.20, 0.004, 0.03], xyz: [0.10, 0.02, 0] }, { box: [0.20, 0.004, 0.03], xyz: [0.10, -0.02, 0] }], 0.2);
    joint('fastened_arm', 'fixed', 'arm_shaft', 'arm_plates', [0, 0, 0]);
  }
  // the claw: two limited turns, parallel, 30 mm apart
  const fl = opt.smallClaw ? 0.035 : 0.07;
  for (const [n, y, s] of [['left', 0.015, 1], ['right', -0.015, -1]]) {
    link(`claw_finger_${n}`, [{ box: [fl, 0.006, 0.02], xyz: [fl / 2, 0, 0] }], 0.02);
    joint(`revolute_claw_${n}`, 'revolute', 'arm_plates', `claw_finger_${n}`, [0.20, y, 0], [0, 0, 1], s > 0 ? 0 : -0.6, s > 0 ? 0.6 : 0);
  }
  // the turret, its flywheel (off the turret's own axis) and its hood
  link('turret_plate', [{ cyl: [0.09, 0.006] }, { box: [0.10, 0.004, 0.10], xyz: [0, 0.05, 0.05] }, { box: [0.10, 0.004, 0.10], xyz: [0, -0.05, 0.05] }], 0.5);
  joint('revolute_turret', 'continuous', 'chassis_1', 'turret_plate', [0.08, 0, 0.095], [0, 0, 1]);
  link('shooter_flywheel', [{ cyl: [0.036, 0.03], rpy: Y }], 0.15);
  joint('revolute_flywheel', 'continuous', 'turret_plate', 'shooter_flywheel', [0.03, 0, 0.06], [0, 1, 0]);
  link('hood', [{ box: [0.06, 0.09, 0.004], xyz: [0.03, 0, 0] }], 0.05);
  joint('revolute_hood', 'revolute', 'turret_plate', 'hood', [0.04, 0, 0.10], [0, 1, 0], -0.4, 0.4);
  // the spindexer
  for (let k = 0; k < 3; k++) {
    const a = k * 2 * Math.PI / 3;
    link(`spindexer_plate_${k + 1}`, [{ box: [0.10, 0.03, 0.004], xyz: [0.05 * Math.cos(a), 0.05 * Math.sin(a), 0], rpy: [0, 0, a] }], 0.05);
    joint(`revolute_spindexer_${k + 1}`, 'continuous', 'chassis_1', `spindexer_plate_${k + 1}`, [-0.03, 0, 0.10 + 0.012 * k], [0, 0, 1]);
  }
  link('intake_roller', [{ cyl: [0.004, 0.28], rpy: Y }, { cyl: [0.024, 0.02], rpy: Y, xyz: [0, 0.08, 0] }, { cyl: [0.024, 0.02], rpy: Y, xyz: [0, -0.08, 0] }], 0.1);
  joint('revolute_intake', 'continuous', 'chassis_1', 'intake_roller', [0.23, 0, 0.04], [0, 1, 0]);
  if (opt.intakeArm) {
    link('intake_arm', [{ box: [0.15, 0.004, 0.03], xyz: [0.075, 0.12, 0] }, { box: [0.15, 0.004, 0.03], xyz: [0.075, -0.12, 0] }], 0.2);
    joint('revolute_intake_arm', 'revolute', 'chassis_1', 'intake_arm', [-0.20, 0, 0.12], [0, 1, 0], -0.2, 1.4);
    link('compliant_wheel_1', [{ cyl: [0.03, 0.03], rpy: Y }], 0.05);
    joint('revolute_compliant_wheel', 'continuous', 'intake_arm', 'compliant_wheel_1', [0.15, 0, 0], [0, 1, 0]);
    link('wheel_guard', [{ box: [0.02, 0.05, 0.004], xyz: [0, 0, 0.034] }], 0.01);
    joint('fastened_guard', 'fixed', 'compliant_wheel_1', 'wheel_guard', [0, 0, 0]);
  }
  link('motor_shaft_1', [{ cyl: [0.003, 0.02], rpy: Y }], 0.005);
  joint('revolute_motor_shaft', 'continuous', 'chassis_1', 'motor_shaft_1', [0.10, 0.10, 0.06], [0, 1, 0]);
  link('mate_connector_a', []); link('mate_connector_b', []);
  link('guide_plate', [{ box: [0.05, 0.05, 0.004] }], 0.02);
  joint('planar_1_x', 'prismatic', 'chassis_1', 'mate_connector_a', [0, 0.10, 0.09], [1, 0, 0], -10000, 10000);
  joint('planar_1_y', 'prismatic', 'mate_connector_a', 'mate_connector_b', [0, 0, 0], [0, 1, 0], -10000, 10000);
  joint('planar_1_rz', 'continuous', 'mate_connector_b', 'guide_plate', [0, 0, 0], [0, 0, 1]);

  const xml = ['<?xml version="1.0"?>', '<robot name="export_robot">'];
  for (const l of links) xml.push(`<link name="${l.name}">${l.visuals.map(vis).join('')}<inertial><mass value="${l.mass}"/></inertial></link>`);
  for (const j of joints) xml.push(`<joint name="${j.name}" type="${j.type}"><parent link="${j.parent}"/><child link="${j.child}"/><origin xyz="${j.xyz.join(' ')}" rpy="${j.rpy.join(' ')}"/><axis xyz="${j.axis.join(' ')}"/>` +
    (j.lo != null ? `<limit lower="${j.lo}" upper="${j.hi}" effort="1" velocity="1"/>` : '') + '</joint>');
  xml.push('</robot>');
  return { xml: xml.join('\n'), links, joints };
}

/* ---- the URDF's own kinematics: where each link sits with the joints at Q (by joint name) ---- */
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const rpyM = ([a, b, c]) => { const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [[cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa], [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa], [-sb, cb * sa, cb * ca]]; };
const rotM = ([x, y, z], q) => { const c = Math.cos(q), s = Math.sin(q), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]]; };
const mul = (A, B) => ({ r: A.r.map((row) => [0, 1, 2].map((j) => row[0] * B.r[0][j] + row[1] * B.r[1][j] + row[2] * B.r[2][j])), t: [0, 1, 2].map((i) => A.r[i][0] * B.t[0] + A.r[i][1] * B.t[1] + A.r[i][2] * B.t[2] + A.t[i]) });
const at = (A, p) => [0, 1, 2].map((i) => A.r[i][0] * p[0] + A.r[i][1] * p[1] + A.r[i][2] * p[2] + A.t[i]);
const inv = (A) => { const r = [0, 1, 2].map((i) => [0, 1, 2].map((j) => A.r[j][i])); return { r, t: [0, 1, 2].map((i) => -(r[i][0] * A.t[0] + r[i][1] * A.t[1] + r[i][2] * A.t[2])) }; };
export function urdfFk(R, Q = {}) {
  const W = new Map(), child = new Set(R.joints.map((j) => j.child));
  for (const l of R.links) if (!child.has(l.name)) W.set(l.name, { r: I3, t: [0, 0, 0] });
  for (let pass = 0; pass < R.links.length + 2; pass++) for (const j of R.joints) {
    if (!W.has(j.parent) || W.has(j.child)) continue;
    const q = Q[j.name] || 0;
    const move = j.type === 'prismatic' ? { r: I3, t: j.axis.map((v) => v * q) } : j.type === 'fixed' ? { r: I3, t: [0, 0, 0] } : { r: rotM(j.axis, q), t: [0, 0, 0] };
    W.set(j.child, mul(mul(W.get(j.parent), { r: rpyM(j.rpy), t: j.xyz }), move));
  }
  return W;
}

/* Every part of the robot the bench read (cad) that is NOT where the URDF's joints put it when
   the bench's joint `lead` (by the name of the mate it came from) is set to Q[lead] and the
   URDF's joints to Q. The bench side moves a part the way the view and the sim do: by the joint
   it rides (solid.mech), up through that joint's parents, followers through E.jointValues, and a
   joint set aside as internal held as drawn. Returns ["link off by N mm (rides …)", …]. */
export function misplaced(E, R, cad, lead, Q) {
  const mechs = cad.mechs.filter((m) => !m.drive), byId = new Map(mechs.map((m) => [m.id, m]));
  const L = mechs.find((m) => m.fromMate && m.fromMate.name === lead);
  if (!L) return ['no joint came from "' + lead + '"'];
  const vals = E.jointValues(mechs, (m) => (m.id === L.id ? Q[lead] : (m.couple ? null : 0)));
  const M = cad.frame && cad.frame.M;            // raw -> the robot frame, row-major 4x4
  const toFrame = (p) => (M ? [0, 1, 2].map((i) => M[4 * i] * p[0] + M[4 * i + 1] * p[1] + M[4 * i + 2] * p[2] + M[4 * i + 3]) : p);
  const toRaw = (p) => { if (!M) return p; const d = [p[0] - M[3], p[1] - M[7], p[2] - M[11]]; return [0, 1, 2].map((i) => M[i] * d[0] + M[4 + i] * d[1] + M[8 + i] * d[2]); };
  const W0 = urdfFk(R, {}), W1 = urdfFk(R, Q), bad = [];
  for (const s of cad.solids) {
    const c0 = [0, 0, 0]; for (const p of s.pts) for (let k = 0; k < 3; k++) c0[k] += p[k] / s.pts.length;
    let p = c0.slice(), g = s.mech || 'chassis';
    for (let n = 0; n < 60 && g !== 'chassis'; n++) {
      const m = byId.get(g); if (!m) break;
      const q = m.internal ? 0 : (vals.get(m.id) || 0);
      if (m.kind === 'linear') p = p.map((v, k) => v + m.axis[k] * q);
      else if (m.kind !== 'fixed') { const Rm = rotM(m.axis, q), d = p.map((v, k) => v - m.pivot[k]); p = [0, 1, 2].map((i) => Rm[i][0] * d[0] + Rm[i][1] * d[1] + Rm[i][2] * d[2] + m.pivot[i]); }
      g = m.parent || 'chassis';
    }
    const want = toFrame(at(W1.get(s.link), at(inv(W0.get(s.link)), toRaw(c0))));
    const err = Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]);
    if (err > 0.002) bad.push(`${s.link} off by ${(err * 1000).toFixed(0)} mm (rides ${s.mech || 'the frame'})`);
  }
  return [...new Set(bad)];
}

/* a TeleOp for it: four drive motors, and one device per mechanism */
export const EXPORT_JAVA = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*; import com.qualcomm.robotcore.hardware.*;
@TeleOp(name="Export") public class Export extends LinearOpMode {
  public void runOpMode(){
    DcMotor fl=hardwareMap.get(DcMotor.class,"frontLeft"), fr=hardwareMap.get(DcMotor.class,"frontRight"), bl=hardwareMap.get(DcMotor.class,"backLeft"), br=hardwareMap.get(DcMotor.class,"backRight");
    DcMotor lift=hardwareMap.get(DcMotor.class,"liftMotor");
    DcMotor turret=hardwareMap.get(DcMotor.class,"turret");
    DcMotor shooter=hardwareMap.get(DcMotor.class,"shooter");
    DcMotor intake=hardwareMap.get(DcMotor.class,"intake");
    Servo arm=hardwareMap.get(Servo.class,"arm");
    Servo claw=hardwareMap.get(Servo.class,"claw");
    Servo hood=hardwareMap.get(Servo.class,"hood");
    CRServo spindexer=hardwareMap.get(CRServo.class,"spindexer");
    waitForStart();
    while(opModeIsActive()){
      fl.setPower(-gamepad1.left_stick_y+gamepad1.left_stick_x+gamepad1.right_stick_x); fr.setPower(-gamepad1.left_stick_y-gamepad1.left_stick_x-gamepad1.right_stick_x);
      bl.setPower(-gamepad1.left_stick_y-gamepad1.left_stick_x+gamepad1.right_stick_x); br.setPower(-gamepad1.left_stick_y+gamepad1.left_stick_x-gamepad1.right_stick_x);
      lift.setPower(-gamepad2.right_stick_y); turret.setPower(gamepad2.left_stick_x);
      shooter.setPower(gamepad2.right_trigger); intake.setPower(gamepad1.right_trigger);
      spindexer.setPower(gamepad2.left_trigger);
      if(gamepad2.a) claw.setPosition(0.2); if(gamepad2.b) claw.setPosition(0.7);
      if(gamepad2.x) arm.setPosition(0.1); if(gamepad2.y) arm.setPosition(0.9);
      if(gamepad2.dpad_up) hood.setPosition(0.8); if(gamepad2.dpad_down) hood.setPosition(0.3);
    }
  }
}`;
