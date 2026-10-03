// MJCF (src/mjcf.js): MuJoCo's model format, as onshape-to-robot and
// ACDC4Robot write it, becomes the same robot an Onshape import gives:
// bodies are parts, joints are joints with their limits, a joint equality
// is a coupling, a connect closes a loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// a binary STL of one triangle, 10 mm on a side
const stl = (() => { const b = new ArrayBuffer(84 + 50), dv = new DataView(b); dv.setUint32(80, 1, true);
  [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0].forEach((v, i) => dv.setFloat32(84 + 12 + 4 * i, v, true)); return b; })();
const MJCF = `<mujoco model="mjbot">
  <compiler angle="degree" eulerseq="xyz"/>
  <default>
    <joint damping="0.1"/>
    <default class="arm"><joint axis="0 1 0" range="-90 60"/></default>
  </default>
  <asset><mesh name="plate" file="meshes/plate.stl"/><mesh name="gone" file="nothere.stl"/><material name="orange" rgba="1 0.5 0 1"/></asset>
  <worldbody>
    <geom type="plane" size="5 5 0.1"/>
    <body name="base" pos="0 0 0.05">
      <freejoint/>
      <inertial pos="0 0 0" mass="8" diaginertia="0.1 0.1 0.1"/>
      <geom type="box" size="0.2 0.18 0.025" material="orange"/>
      <geom type="mesh" mesh="plate" pos="0 0 0.03"/>
      <geom type="mesh" mesh="gone"/>
      <body name="lift" pos="-0.1 0 0.025">
        <joint name="lift" type="slide" axis="0 0 1" range="0 0.6"/>
        <inertial pos="0 0 0.2" mass="1"/>
        <geom type="box" size="0.02 0.15 0.2" pos="0 0 0.2"/>
        <body name="arm" pos="0 0 0.38" childclass="arm">
          <joint name="arm"/>
          <inertial pos="0.12 0 0" mass="0.5"/>
          <geom type="cylinder" fromto="0 0 0 0.24 0 0" size="0.02"/>
          <body name="claw" pos="0.25 0 0" euler="0 0 90">
            <joint name="claw" axis="0 0 1" range="0 57.2958"/>
            <geom type="box" size="0.02 0.03 0.01" rgba="0.2 0.2 0.2 1"/>
          </body>
        </body>
        <body name="link" pos="0 0 0.3">
          <joint name="link" type="hinge" axis="0 1 0"/>
          <geom type="box" size="0.12 0.01 0.01" pos="0.12 0 0"/>
        </body>
      </body>
    </body>
  </worldbody>
  <equality>
    <joint joint1="claw" joint2="arm" polycoef="0 -0.5 0 0 0"/>
    <connect body1="link" body2="arm" anchor="0.24 0 0"/>
  </equality>
</mujoco>`;

test('mjcf: bodies are parts with shapes, colours and masses; the world\'s floor is scenery', () => {
  const cad = E.cadFromMjcf(MJCF, { 'meshes/plate.stl': stl });
  assert.equal(cad.source, 'mjcf');
  assert.deepEqual(cad.solids.map((s) => s.name).sort(), ['arm', 'base', 'claw', 'lift', 'link']);
  const base = cad.solids.find((s) => s.name === 'base');
  assert.equal(base.kg, 8);
  assert.deepEqual(base.color.map((v) => Math.round(v * 255)), [255, 128, 0], 'the material\'s colour');
  assert.ok(base.tri.pos.length >= 9 * 12 + 9, 'the box and the STL triangle');
  assert.ok(cad.onshape.why.some((w) => /nothere\.stl/.test(w)), 'a missing mesh is named');
  assert.ok(Math.abs(cad.bbox.min[2]) < 0.002, 'on the floor');
});

test('mjcf: joints come through with their kind, axis, limits in radians, and what each carries', () => {
  const cad = E.cadFromMjcf(MJCF, { 'meshes/plate.stl': stl });
  const m = (id) => cad.mechs.find((x) => x.id === id);
  assert.equal(m('lift').kind, 'linear');
  assert.ok(Math.abs(dot(m('lift').axis, [0, 0, 1])) > 0.9999);
  assert.deepEqual(m('lift').limits.map((v) => +v.toFixed(4)), [0, 0.6]);
  assert.equal(m('arm').kind, 'revolute-lift', 'the default class gave it its axis');
  assert.deepEqual(m('arm').limits.map((v) => +v.toFixed(4)), [+(-Math.PI / 2).toFixed(4), +(Math.PI / 3).toFixed(4)], 'degrees, MuJoCo\'s default unit');
  assert.equal(m('arm').parent, 'lift');
  assert.deepEqual(cad.solids.filter((s) => s.mech === 'arm').map((s) => s.name), ['arm']);
  assert.ok(Math.abs(m('claw').limits[1] - 1) < 1e-4, '57.2958 degrees is a radian');
});

test('mjcf: a joint equality is a coupling, and a connect closes a loop', () => {
  const cad = E.cadFromMjcf(MJCF, { 'meshes/plate.stl': stl });
  const claw = cad.mechs.find((x) => x.id === 'claw');
  assert.equal(claw.couple.to, 'arm');
  assert.ok(Math.abs(claw.couple.ratio + 0.5) < 1e-9);
  assert.equal(cad.loops.length, 1);
  assert.deepEqual([cad.loops[0].a, cad.loops[0].b].sort(), ['arm', 'link']);
});

test('mjcf: angles in radians, quaternions, and a file that isn\'t MJCF', () => {
  const rad = `<mujoco><compiler angle="radian"/><worldbody><body name="b"><geom type="sphere" size="0.05"/>
    <body name="a" pos="0 0 0.2" quat="0.7071068 0 0.7071068 0"><joint name="a" range="-1 1"/><geom type="box" size="0.1 0.01 0.01"/></body></body></worldbody></mujoco>`;
  const cad = E.cadFromMjcf(rad, {});
  const a = cad.mechs.find((x) => x.id === 'a');
  assert.deepEqual(a.limits.map((v) => +v.toFixed(6)), [-1, 1]);
  // a quarter turn about y takes the body's z axis (the joint's default axis) onto x
  assert.ok(Math.abs(Math.abs(a.axis[0]) - 1) < 1e-4 || Math.abs(Math.abs(a.axis[1]) - 1) < 1e-4, 'axis ' + a.axis);
  assert.throws(() => E.cadFromMjcf('<robot name="x"/>', {}), /isn't an MJCF/);
});
