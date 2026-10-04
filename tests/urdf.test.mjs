// URDF (src/urdf.js): what Fusion, SolidWorks and FreeCAD exporters write. The
// links become parts, the joints mates, and the robot comes out the way an
// Onshape import does: joints with their axes, limits and what they carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const URDF = `<?xml version="1.0"?>
<!-- a chassis, a lift on a slider, an arm on the lift, a claw that mimics the arm, a drive wheel -->
<robot name="urdfbot">
  <material name="orange"><color rgba="1 0.5 0 1"/></material>
  <link name="base_link">
    <visual><origin xyz="0 0 0.05"/><geometry><box size="0.40 0.36 0.05"/></geometry><material name="orange"/></visual>
    <inertial><mass value="8.0"/></inertial>
  </link>
  <link name="lift">
    <visual><origin xyz="0 0 0.2"/><geometry><box size="0.04 0.30 0.40"/></geometry></visual>
    <inertial><mass value="1.0"/></inertial>
  </link>
  <link name="arm">
    <visual><origin xyz="0.12 0 0" rpy="0 1.5707963 0"/><geometry><cylinder radius="0.02" length="0.24"/></geometry><material name="grey"><color rgba="0.4 0.4 0.4 1"/></material></visual>
    <inertial><mass value="0.5"/></inertial>
  </link>
  <link name="claw"><visual><geometry><box size="0.04 0.06 0.02"/></geometry></visual></link>
  <link name="wheel_fl"><visual><origin rpy="1.5707963 0 0"/><geometry><cylinder radius="0.048" length="0.04"/></geometry></visual></link>
  <joint name="lift" type="prismatic">
    <parent link="base_link"/><child link="lift"/><origin xyz="-0.1 0 0.075"/><axis xyz="0 0 1"/>
    <limit lower="0" upper="0.6" effort="10" velocity="1"/>
  </joint>
  <joint name="arm" type="revolute">
    <parent link="lift"/><child link="arm"/><origin xyz="0 0 0.38"/><axis xyz="0 1 0"/>
    <limit lower="-1.57" upper="1.2" effort="5" velocity="2"/>
  </joint>
  <joint name="claw" type="revolute">
    <parent link="arm"/><child link="claw"/><origin xyz="0.25 0 0"/><axis xyz="0 0 1"/>
    <limit lower="0" upper="1" effort="1" velocity="1"/><mimic joint="arm" multiplier="-0.5"/>
  </joint>
  <joint name="fl_wheel" type="continuous">
    <parent link="base_link"/><child link="wheel_fl"/><origin xyz="0.15 0.2 0.048"/><axis xyz="0 1 0"/>
  </joint>
</robot>`;

test('urdf: links are parts with shapes, colours and masses, in the robot frame', async () => {
  const cad = await E.urdfRobot(URDF, {}, 'urdfbot');
  assert.equal(cad.source, 'urdf');
  assert.equal(cad.solids.length, 5);
  const base = cad.solids.find((s) => /^base/.test(s.name));
  assert.deepEqual(base.color.map((v) => +v.toFixed(6)), [1, 0.5, 0]);
  assert.ok(Math.abs(cad.onshape.kg - 9.5) < 1e-9);
  assert.ok(Math.abs(cad.bbox.min[2]) < 0.002, 'stands on the floor');
});

test('urdf: the joints come through: kind, axis, limits, what each carries, a mimic as a coupling', async () => {
  const cad = await E.urdfRobot(URDF, {}, 'urdfbot');
  const j = Object.fromEntries(cad.mechs.filter((m) => m.fromMate).map((m) => [m.id, m]));
  assert.ok(j.lift && j.arm && j.claw, Object.keys(j).join(','));
  assert.equal(j.lift.kind, 'linear');
  assert.ok(Math.abs(Math.abs(dot(j.lift.axis, [0, 0, 1])) - 1) < 1e-6);
  assert.deepEqual(j.lift.limits.map((v) => +v.toFixed(6)), [0, 0.6]);
  assert.equal(j.arm.kind, 'revolute-lift');
  assert.equal(j.arm.parent, 'lift');
  assert.ok(Math.abs(j.arm.limits[0] + 1.57) < 1e-9 && Math.abs(j.arm.limits[1] - 1.2) < 1e-9);
  assert.equal(j.claw.parent, 'arm');
  assert.deepEqual(j.claw.couple && [j.claw.couple.to, j.claw.couple.ratio], ['arm', -0.5]);
  assert.deepEqual(cad.solids.filter((s) => s.mech === 'arm').map((s) => s.name), ['arm']);
  // a wheel spinning on its axle is a wheel, not a joint the code drives
  assert.ok(!j.fl_wheel);
});

test('urdf: STL meshes dropped with it, binary and ASCII; a missing one is named', async () => {
  const tri = [[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0]];
  const bin = new Uint8Array(84 + 50); const dv = new DataView(bin.buffer); dv.setUint32(80, 1, true);
  tri.flat().forEach((v, k) => dv.setFloat32(84 + 12 + k * 4, v, true));
  const ascii = new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 0.1 0 0\nvertex 0 0.1 0\nendloop\nendfacet\nendsolid x\n');
  assert.deepEqual(E.urdfStl(bin.buffer).map((v) => +v.toFixed(6)), tri.flat());
  assert.deepEqual(E.urdfStl(ascii), tri.flat());
  const u = URDF.replace('<box size="0.04 0.06 0.02"/>', '<mesh filename="package://bot/meshes/Claw.STL" scale="0.001 0.001 0.001"/>')
    .replace('<box size="0.40 0.36 0.05"/>', '<mesh filename="package://bot/meshes/base.stl"/>');
  const cad = await E.urdfRobot(u, { 'Claw.STL': bin.buffer }, 'urdfbot');
  assert.ok(cad.solids.some((s) => s.name === 'claw'), 'the claw mesh (scaled) is used');
  assert.ok(cad.onshape.why.some((w) => /base\.stl/.test(w)), 'the missing base mesh is named');
});

test('urdf: a xacro file is refused with what to do', async () => {
  await assert.rejects(E.urdfRobot('<robot xmlns:xacro="x"><xacro:macro name="m"/></robot>', {}, 'x'), /xacro/);
});
