// URDF (src/urdf.js): what Fusion, SolidWorks and FreeCAD exporters write. The
// links become parts, the joints mates, and the same builder as an Onshape
// import makes the robot: joints with their axes, limits and what they carry.
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

test('urdf: links are parts with shapes, colours and masses, in the robot frame', () => {
  const cad = E.cadFromUrdf(URDF, {});
  assert.equal(cad.source, 'urdf');
  assert.equal(cad.solids.length, 5);
  const base = cad.solids.find((s) => s.name === 'base_link');
  assert.deepEqual(base.color, [1, 0.5, 0]);
  assert.ok(Math.abs(cad.onshape.kg - 9.5) < 1e-9);
  assert.ok(Math.abs(cad.bbox.min[2]) < 0.002, 'stands on the floor');
});

test('urdf: the joints come through: kind, axis, limits, what each carries, a mimic as a coupling', () => {
  const cad = E.cadFromUrdf(URDF, {});
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

test('urdf: STL meshes dropped with it, binary and ASCII; a missing one is named', () => {
  const tri = [[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0]];
  const bin = new Uint8Array(84 + 50); const dv = new DataView(bin.buffer); dv.setUint32(80, 1, true);
  tri.flat().forEach((v, k) => dv.setFloat32(84 + 12 + k * 4, v, true));
  const ascii = new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 0.1 0 0\nvertex 0 0.1 0\nendloop\nendfacet\nendsolid x\n');
  assert.deepEqual(E.urdfStl(bin.buffer).map((v) => +v.toFixed(6)), tri.flat());
  assert.deepEqual(E.urdfStl(ascii), tri.flat());
  const u = URDF.replace('<box size="0.04 0.06 0.02"/>', '<mesh filename="package://bot/meshes/Claw.STL" scale="0.001 0.001 0.001"/>')
    .replace('<box size="0.40 0.36 0.05"/>', '<mesh filename="package://bot/meshes/base.stl"/>');
  const cad = E.cadFromUrdf(u, { 'Claw.STL': bin.buffer });
  assert.ok(cad.solids.some((s) => s.name === 'claw'), 'the claw mesh (scaled) is used');
  assert.ok(cad.onshape.why.some((w) => /base\.stl/.test(w)), 'the missing base mesh is named');
});

test('urdf: a mimic\'s offset is kept and a multiplier of 0 is 0, through the spec, the package and a saved session', async () => {
  // the claw held at 0.3 rad whatever the arm does: multiplier 0, offset 0.3
  const u = URDF.replace('<mimic joint="arm" multiplier="-0.5"/>', '<mimic joint="arm" multiplier="0" offset="0.3"/>');
  const cad = E.cadFromUrdf(u, {});
  const claw = (c) => c.mechs.find((m) => m.id === 'claw');
  const at = (c, q) => E.followQ(claw(c), (id) => (id === 'arm' ? q : null));
  const check = (c, how) => {
    assert.equal(claw(c).couple.ratio, 0, how + ': a multiplier of 0 stays 0');
    assert.ok(Math.abs(claw(c).couple.offset - 0.3) < 1e-7, how + ': the offset is kept (' + claw(c).couple.offset + ')');
    for (const q of [-1, 0, 0.7]) assert.ok(Math.abs(at(c, q) - 0.3) < 1e-7, how + ': at arm ' + q + ' the claw is at ' + at(c, q));
  };
  check(cad, 'from the URDF');
  // a plain mimic (the -0.5 one) has no offset to carry
  assert.equal(claw(E.cadFromUrdf(URDF, {})).couple.offset, undefined);
  // written as a joint spec, applied again
  const spec = E.specFromCad(cad, cad.solids.map((s) => s.mech || 'chassis'), {});
  const again = E.cadFromUrdf(u, {});
  E.applyJointSpec(again, spec);
  check(again, 'through the spec');
  // a robot package (constraints in joints.json v2)
  const pkg = E.simbotFromCad(cad, { created: '2026-10-03T00:00:00Z' });
  const back = await E.simbotUnpack(await E.simbotPack(pkg));
  assert.ok(back.ok, back.error);
  check(E.cadFromSimbot(back.pkg).cad, 'through the package');
  // a saved session
  const r = E.unpackSession(E.packSession(E.sessionFromBench({ cad })));
  assert.ok(r.ok, r.error);
  check(r.session.cad, 'through a session');
  // a spec constraint written by hand: ratio 0 and an offset in degrees
  const s2 = { format: 'ftc-sim-bench.joints', joints: [{ id: 'a', kind: 'revolute', axis: [0, 1, 0] }, { id: 'b', kind: 'slider', axis: [0, 0, 1] }],
    constraints: [{ type: 'mimic', leader: 'a', follower: 'b', ratio: 0, offset: 50 }] };
  const c2 = E.cadFromUrdf(URDF, {}); E.applyJointSpec(c2, s2);
  const b = c2.mechs.find((m) => m.id === 'b');
  assert.equal(b.couple.ratio, 0);
  assert.ok(Math.abs(E.followQ(b, () => 1) - 0.05) < 1e-12, 'a slide\'s offset is in mm on file');
});

test('urdf: a xacro file is refused with what to do', () => {
  assert.throws(() => E.cadFromUrdf('<robot xmlns:xacro="x"><xacro:macro name="m"/></robot>', {}), /xacro/);
});
