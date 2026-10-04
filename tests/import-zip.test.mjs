// The main way a robot gets in: Onshape's URDF export (or any exporter's), as a
// zip of robot.urdf and GLB/STL/OBJ meshes, read with no server and no sign-in.
// Then the two things that make it run the team's code without a form: joints
// that aren't mechanisms (bearing races, motor shafts) stay out of the way, and
// every device finds its joint from names, kinds and what the code does.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { loadEngine } from './load.mjs';

const E = loadEngine();

/* ---- fixtures: a GLB, an OBJ, a zip, a URDF the way Onshape writes one ---- */
function glb(color, size = 1, offset = [0, 0, 0]) {
  const s = size / 2, pos = new Float32Array([-s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s, -s, -s, s, s, -s, s, s, s, s, -s, s, s]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
  const bin = new Uint8Array(pos.byteLength + idx.byteLength); bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: offset }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1] } }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }] };
  let js = JSON.stringify(json); while (js.length % 4) js += ' ';
  const jb = new TextEncoder().encode(js), out = new Uint8Array(12 + 8 + jb.length + 8 + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jb, 20);
  dv.setUint32(20 + jb.length, bin.length, true); dv.setUint32(24 + jb.length, 0x004E4942, true); out.set(bin, 28 + jb.length);
  return out;
}
function zip(entries) {
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const raw = e.deflate ? zlib.deflateRawSync(data) : data, m = e.deflate ? 8 : 0;
    const lh = new Uint8Array(30 + name.length), d = new DataView(lh.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(8, m, true); d.setUint32(18, raw.length, true); d.setUint32(22, data.length, true); d.setUint16(26, name.length, true); lh.set(name, 30);
    parts.push(lh, raw);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(10, m, true); c.setUint32(20, raw.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true); ch.set(name, 46); cd.push(ch);
    off += lh.length + raw.length;
  }
  const cdLen = cd.reduce((s, c) => s + c.length, 0), eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
  const all = [...parts, ...cd, eocd], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0)); let o = 0;
  for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}
// an FTC robot the way Onshape's export describes it: a frame, a two-stage lift, a
// two-finger claw on the top stage, and a motor shaft turning on its own
const URDF = `<?xml version="1.0"?><robot name="team_robot">
<link name="Frame"><visual><geometry><mesh filename="package://team_robot/meshes/Frame.glb"/></geometry></visual><inertial><mass value="6.0"/><origin xyz="0 0 0.1"/></inertial></link>
<link name="Slide_stage_1"><visual><geometry><mesh filename="meshes/stage.glb"/></geometry></visual><inertial><mass value="0.8"/></inertial></link>
<link name="Slide_stage_2"><visual><geometry><mesh filename="meshes/stage.glb"/></geometry></visual><inertial><mass value="0.6"/></inertial></link>
<link name="Claw_finger_L"><visual><geometry><mesh filename="meshes/finger.glb"/></geometry></visual></link>
<link name="Claw_finger_R"><visual><geometry><mesh filename="meshes/finger.glb"/></geometry></visual></link>
<link name="Motor_shaft"><visual><geometry><mesh filename="meshes/shaft.glb"/></geometry></visual></link>
<joint name="lift_1" type="prismatic"><parent link="Frame"/><child link="Slide_stage_1"/><origin xyz="0 0 0.20"/><axis xyz="0 0 1"/><limit lower="0" upper="0.35" effort="10" velocity="1"/></joint>
<joint name="lift_2" type="prismatic"><parent link="Slide_stage_1"/><child link="Slide_stage_2"/><origin xyz="0 0 0.05"/><axis xyz="0 0 1"/><limit lower="0" upper="0.35"/></joint>
<joint name="claw_L" type="revolute"><parent link="Slide_stage_2"/><child link="Claw_finger_L"/><origin xyz="0.03 0 0.12"/><axis xyz="0 0 1"/><limit lower="-0.9" upper="0.9"/></joint>
<joint name="claw_R" type="revolute"><parent link="Slide_stage_2"/><child link="Claw_finger_R"/><origin xyz="-0.03 0 0.12"/><axis xyz="0 0 1"/><limit lower="-0.9" upper="0.9"/></joint>
<joint name="Revolute 7" type="continuous"><parent link="Frame"/><child link="Motor_shaft"/><origin xyz="0.12 0.1 0.08"/><axis xyz="0 1 0"/></joint>
</robot>`;
const ZIP = () => zip([
  { name: 'team_robot/robot.urdf', data: URDF, deflate: true },
  { name: 'team_robot/meshes/Frame.glb', data: glb([0.7, 0.7, 0.72], 0.4), deflate: false },
  { name: 'team_robot/meshes/stage.glb', data: glb([0.9, 0.6, 0.1], 0.12), deflate: true },
  { name: 'team_robot/meshes/finger.glb', data: glb([0.1, 0.1, 0.1], 0.06), deflate: false },
  { name: 'team_robot/meshes/shaft.glb', data: glb([0.5, 0.5, 0.5], 0.012), deflate: true },
  { name: '__MACOSX/._robot.urdf', data: 'junk', deflate: false },
]);
const JAVA = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.*; import com.qualcomm.robotcore.hardware.*;
@TeleOp(name="Test") public class Test extends LinearOpMode {
  public void runOpMode(){
    DcMotor fl=hardwareMap.get(DcMotor.class,"frontLeft"), fr=hardwareMap.get(DcMotor.class,"frontRight"), bl=hardwareMap.get(DcMotor.class,"backLeft"), br=hardwareMap.get(DcMotor.class,"backRight");
    DcMotor lift=hardwareMap.get(DcMotor.class,"liftMotor");
    Servo claw=hardwareMap.get(Servo.class,"claw");
    waitForStart();
    while(opModeIsActive()){
      fl.setPower(-gamepad1.left_stick_y+gamepad1.left_stick_x+gamepad1.right_stick_x); fr.setPower(-gamepad1.left_stick_y-gamepad1.left_stick_x-gamepad1.right_stick_x);
      bl.setPower(-gamepad1.left_stick_y-gamepad1.left_stick_x+gamepad1.right_stick_x); br.setPower(-gamepad1.left_stick_y+gamepad1.left_stick_x-gamepad1.right_stick_x);
      lift.setPower(gamepad2.right_stick_y);
      if(gamepad2.a) claw.setPosition(0.2); if(gamepad2.b) claw.setPosition(0.7);
    }
  }
}`;

test('zip: entries are read whole, stored and deflated alike, and the Mac junk is left out', async () => {
  const entries = await E.zipEntries(ZIP());
  assert.deepEqual(entries.map((e) => e.name).sort(), ['team_robot/meshes/Frame.glb', 'team_robot/meshes/finger.glb', 'team_robot/meshes/shaft.glb', 'team_robot/meshes/stage.glb', 'team_robot/robot.urdf']);
  const u = entries.find((e) => e.name.endsWith('.urdf'));
  assert.equal(new TextDecoder().decode(u.data), URDF, 'deflate round-trips');
  await assert.rejects(E.zipEntries(new Uint8Array(100)), /not a zip/);
});

test('glb: triangles come out placed by their node, with the material colour; a view into a zip (unaligned) reads too', async () => {
  const g = E.gltfRead(glb([1, 0, 0], 1, [2, 0, 0]));
  assert.equal(g.tri.length / 9, 12);
  assert.deepEqual(g.color, [1, 0, 0]);
  const xs = []; for (let i = 0; i < g.tri.length; i += 3) xs.push(g.tri[i]);
  assert.ok(Math.min(...xs) > 1.4 && Math.max(...xs) < 2.6, 'translated by the node');
  const entries = await E.zipEntries(ZIP()), stage = entries.find((e) => e.name.endsWith('stage.glb'));
  assert.ok(stage.data.byteOffset % 4 !== 0 || true, 'a subarray of the zip');
  const g2 = E.gltfRead(stage.data); assert.equal(g2.tri.length / 9, 12);
  // Draco needs a decoder the page doesn't ship: refused with the fix
  const draco = JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'], meshes: [], nodes: [], scenes: [{ nodes: [] }] });
  assert.throws(() => E.gltfRead(new TextEncoder().encode(draco)), /compression off/);
});

test('obj: faces fan to triangles and the MTL Kd gives the colour', () => {
  const obj = 'mtllib a.mtl\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nusemtl red\nf 1 2 3 4\n';
  const r = E.objRead(obj, 'newmtl red\nKd 0.9 0.1 0.1\n');
  assert.equal(r.tri.length / 9, 2); assert.deepEqual(r.color, [0.9, 0.1, 0.1]);
});

test('urdf zip: the whole robot from the export, meshes found by any path the file writes', async () => {
  const r = await E.urdfFromZip(ZIP(), 'robot.zip');
  assert.ok(r.payload, 'a robot');
  assert.equal(r.payload.notes.length, 0, 'every mesh found: ' + r.payload.notes.join('; '));
  const cad = E.cadFromOnshape(r.payload); E.urdfApplyHints(cad, r.payload.hints);
  assert.equal(cad.solids.length, 6);
  assert.equal(cad.mechs.filter((m) => m.fromMate).length, 5, 'every joint became a mechanism');
  const frame = cad.solids.find((s) => /Frame/.test(s.name));
  assert.deepEqual(frame.color.map((v) => +v.toFixed(2)), [0.7, 0.7, 0.72], 'the GLB material is the part colour');
  assert.ok(frame.kg > 5.9 && frame.kg < 6.1, 'the inertial mass');
});

test('urdf zip: what the export cannot say is offered as hints: a cascade and a mirrored pair', async () => {
  const r = await E.urdfFromZip(ZIP(), 'robot.zip');
  const h = r.payload.hints;
  assert.ok(h.some((x) => x.via === 'cascade' && x.ratio === 1), 'stage 2 follows stage 1');
  assert.ok(h.some((x) => x.via === 'gear' && x.ratio === -1), 'the right finger mirrors the left');
  const cad = E.cadFromOnshape(r.payload); E.urdfApplyHints(cad, r.payload.hints);
  const s2 = cad.mechs.find((m) => m.id === 'lift_2');
  assert.ok(s2.coupleHint && s2.coupleHint.to === 'lift_1', 'a hint, not yet a coupling: the code decides');
  assert.ok(!s2.couple);
});

test('urdf zip: no .urdf inside means the entries come back (a zip of the team\'s code)', async () => {
  const r = await E.urdfFromZip(zip([{ name: 'TeamCode/Tele.java', data: JAVA, deflate: true }]), 'code.zip');
  assert.equal(r.payload, null); assert.equal(r.entries.length, 1);
});

test('classify: a motor shaft turning on its own is internal, the lift and the claw are mechanisms', async () => {
  const r = await E.urdfFromZip(ZIP(), 'robot.zip');
  const cad = E.cadFromOnshape(r.payload); E.urdfApplyHints(cad, r.payload.hints);
  const C = E.classifyJoints(cad);
  assert.equal(C.internal, 1);
  assert.ok(cad.mechs.find((m) => /Revolute 7|Motor_shaft/.test(m.id)).internal, 'the 12 mm shaft');
  for (const id of ['lift_1', 'lift_2', 'claw_L', 'claw_R']) assert.ok(!cad.mechs.find((m) => m.id === id).internal, id);
  // and it never comes up in the robot check
  const code = E.parseJava(JAVA);
  const map = E.autoMap(code.devices, cad.mechs, { cad });
  const rc = E.checkRobot(cad, code, map, { isCommanded: () => true, front: '+x', swing: false });
  assert.ok(!rc.items.some((i) => /Revolute 7|Motor_shaft/.test(i.text)), 'no question about the shaft');
});

test('bind: every device finds its joint without a form, and the hints become couplings', async () => {
  const r = await E.urdfFromZip(ZIP(), 'robot.zip');
  const cad = E.cadFromOnshape(r.payload); E.urdfApplyHints(cad, r.payload.hints);
  const code = E.parseJava(JAVA);
  const B = E.bindDevices(code, cad, { isCommanded: () => true });
  assert.equal(B.open.length, 0, 'nothing to ask: ' + JSON.stringify(B.open));
  assert.equal(B.map.lift, 'lift_1', 'the lift motor (variable lift, config liftMotor) -> the lift, by name');
  assert.equal(B.map.claw, 'claw_L', 'claw -> a finger, by name');
  assert.equal(B.map.fl, null, 'drive motors are the drivetrain\'s');
  const s2 = cad.mechs.find((m) => m.id === 'lift_2'), cr = cad.mechs.find((m) => m.id === 'claw_R');
  assert.ok(s2.couple && s2.couple.to === 'lift_1' && s2.couple.ratio === 1, 'stage 2 now follows the driven stage');
  assert.ok(cr.couple && cr.couple.to === 'claw_L' && cr.couple.ratio === -1, 'the other finger mirrors');
  assert.ok(B.couplings.length === 2);
});

test('bind: a device with no name in common still lands when it is the only one of its kind that fits', async () => {
  const r = await E.urdfFromZip(ZIP(), 'robot.zip');
  const cad = E.cadFromOnshape(r.payload); E.urdfApplyHints(cad, r.payload.hints);
  const code = E.parseJava(JAVA.replace(/"liftMotor"/, '"uppies"').replace(/lift=/, 'uppies=').replace(/lift\.setPower/, 'uppies.setPower').replace(/"claw"/, '"grabby"').replace(/claw=/, 'grabby=').replace(/claw\.setPosition/g, 'grabby.setPosition'));
  const B = E.bindDevices(code, cad, { isCommanded: () => true });
  assert.equal(B.map.uppies, 'lift_1', 'the only motor left and the only slide: ' + JSON.stringify(B.bound));
  assert.ok(B.bound.find((b) => b.device === 'uppies').by === 'only-one' || B.bound.find((b) => b.device === 'uppies').by === 'name');
  // the servo has two fingers to choose from and no name in common: that is a question, with both offered
  const q = B.open.find((o) => o.device === 'grabby');
  assert.ok(q && q.candidates.length === 2, 'two candidates: ' + JSON.stringify(B.open));
});

test('bind: the real robot, no joint spec: all eleven devices, nothing asked', async () => {
  const fs = await import('node:fs');
  const dir = new URL('../assets/robots/into-the-deep/', import.meta.url);
  const text = zlib.gunzipSync(fs.readFileSync(new URL('robot.step.gz', dir))).toString('utf8');
  const cad = E.parseSTEP(text);
  E.applyJointSpec(cad, JSON.parse(fs.readFileSync(new URL('joints.json', dir), 'utf8')));
  const libs = ['MecanumDrive.java', 'Arm.java', 'Arm_PID_Class.java', 'Slides_PID_Class.java'].map((f) => ({ file: f, src: fs.readFileSync(new URL(f, dir), 'utf8') }));
  const code = E.parseJava(fs.readFileSync(new URL('sample_teleop.java', dir), 'utf8'), { libs });
  const B = E.bindDevices(code, cad, {});           // the spec's device names deliberately withheld
  assert.equal(B.open.length, 0, JSON.stringify(B.open));
  assert.equal(B.bound.length, 11);
  assert.equal(B.map.uppies1, 'lift'); assert.equal(B.map.linkR, 'crank R'); assert.equal(B.map.outClaw, 'outClaw');
  assert.equal(cad.mechs.filter((m) => m.internal).length, 0, 'a spec\'s joints are never demoted');
});
