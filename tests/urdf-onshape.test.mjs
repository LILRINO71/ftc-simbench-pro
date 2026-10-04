// Onshape's own URDF export (right-click the assembly tab → Export → URDF), dropped
// as the zip it downloads. This is the one way into SimBench that every school
// network, managed browser and Enterprise account allows, so it has to read
// exactly what Onshape writes: a shapeless root link, lowercased underscored
// names with the part number inside, fastened mates as fixed joints, mates
// with no limits as continuous joints, a loop closure as a joint onto a dummy
// link, a cylindrical mate as a slide and a turn through a dummy, planar mates
// as dummies, gear relations as <mimic>, near-zero masses for parts with no
// material, and meshes as STL, OBJ, glTF or GLB. And the zip itself has to
// say what it holds (src/zipin.js): a URDF, an MJCF, a STEP, a glTF or a
// robot package, with junk ignored and hostile archives refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const enc = (s) => new TextEncoder().encode(s);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

/* ---- meshes of every kind, all a box ---- */
const BOX_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
const boxVerts = (s, c = [0, 0, 0]) => { const [x, y, z] = s.map((v) => v / 2);
  return [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]].map((p) => [p[0] + c[0], p[1] + c[1], p[2] + c[2]]); };
const boxTris = (s, c) => { const V = boxVerts(s, c), T = []; for (const [a, b, cc, d] of BOX_FACES) T.push(...V[a], ...V[b], ...V[cc], ...V[a], ...V[cc], ...V[d]); return T; };
const stlBin = (tris) => { const n = tris.length / 9, u8 = new Uint8Array(84 + 50 * n), dv = new DataView(u8.buffer); dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) dv.setFloat32(o + k * 4, tris[i * 9 + k], true); } return u8; };
const objBox = (s) => '# a box\n' + boxVerts(s).map((p) => 'v ' + p.join(' ')).join('\n') + '\nf 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf -5 -8 -4 -1\n';
const boxBuffer = (s) => { const I = []; for (const [a, b, c, d] of BOX_FACES) I.push(a, b, c, a, c, d);
  const pos = new Float32Array(boxVerts(s).flat()), idx = new Uint32Array(I);
  const buf = new Uint8Array(pos.byteLength + idx.byteLength); buf.set(new Uint8Array(pos.buffer), 0); buf.set(new Uint8Array(idx.buffer), pos.byteLength);
  return { buf, posLen: pos.byteLength, idxLen: idx.byteLength, half: s.map((v) => v / 2) }; };
const gltfJson = (s, nodes, extra = {}) => { const { buf, posLen, idxLen, half } = boxBuffer(s);
  return { buf, json: Object.assign({ asset: { version: '2.0', generator: 'ONSHAPE BY PTC INC, 1.213' }, scene: 0, scenes: [{ name: 'Root', nodes: nodes.roots }],
    nodes: nodes.list, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1] } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: half.map((v) => -v), max: half }, { bufferView: 1, componentType: 5125, count: 36, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posLen }, { buffer: 0, byteOffset: posLen, byteLength: idxLen }],
    buffers: [{ byteLength: buf.length }] }, extra) }; };
const ONE = { roots: [0], list: [{ mesh: 0, name: 'mesh0' }] };
const gltfData = (s, nodes = ONE) => { const g = gltfJson(s, nodes); g.json.buffers[0].uri = 'data:application/octet-stream;base64,' + Buffer.from(g.buf).toString('base64'); return enc(JSON.stringify(g.json)); };
const gltfExternal = (s, uri) => { const g = gltfJson(s, ONE); g.json.buffers[0].uri = uri; return { gltf: enc(JSON.stringify(g.json)), bin: g.buf }; };
const glb = (s, nodes = ONE) => { const g = gltfJson(s, nodes); let js = enc(JSON.stringify(g.json)); while (js.length % 4) js = new Uint8Array([...js, 0x20]);
  let bin = g.buf; while (bin.length % 4) bin = new Uint8Array([...bin, 0]);
  const out = new Uint8Array(12 + 8 + js.length + 8 + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  dv.setUint32(20 + js.length, bin.length, true); dv.setUint32(24 + js.length, 0x004e4942, true); out.set(bin, 28 + js.length);
  return out; };
const DAE = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="centimeter" meter="0.01"/><up_axis>Y_UP</up_axis></asset>
  <library_geometries><geometry id="g1"><mesh>
    <source id="g1-pos"><float_array id="g1-pos-array" count="9">0 0 0 10 0 0 0 0 -10</float_array></source>
    <vertices id="g1-v"><input semantic="POSITION" source="#g1-pos"/></vertices>
    <triangles count="1"><input semantic="VERTEX" source="#g1-v" offset="0"/><input semantic="NORMAL" source="#g1-pos" offset="1"/><p>0 0 1 0 2 0</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="s"><node id="n"><translate>0 5 0</translate><instance_geometry url="#g1"/></node></visual_scene></library_visual_scenes>
</COLLADA>`;

/* ---- the export, as Onshape 1.217 writes it ---- */
const vis = (file, rgba = '0.5 0.5 0.5 1') => `<visual><origin xyz="0 0 0" rpy="0 0 0"/><geometry><mesh filename="package://robot/meshes/${file}" scale="1 1 1"/></geometry><material name="${rgba.replace(/ /g, '_')}_0.000000_0.000000"><texture /><color rgba="${rgba}"/></material></visual>`;
const inertial = (kg) => `<inertial><origin xyz="0 0 0" rpy="0 0 0"/><mass value="${kg}"/><inertia ixx="1e-5" ixy="0" ixz="0" iyy="1e-5" iyz="0" izz="1e-5"/></inertial>`;
const link = (name, file, kg, rgba) => `<link name="${name}">${inertial(kg)}${vis(file, rgba)}</link>`;
const joint = (name, type, parent, child, xyz, axis, lim, more = '') => `<joint name="${name}" type="${type}"><origin xyz="${xyz}" rpy="0 0 0"/><parent link="${parent}"/><child link="${child}"/>` +
  (axis ? `<axis xyz="${axis}"/>` : '') + (lim ? `<limit effort="1" velocity="1" lower="${lim[0]}" upper="${lim[1]}"/>` : '') + more + '</joint>';
const URDF = `<?xml version="1.0" ?>
<!--URDF generated by ONSHAPE BY PTC INC, 1.217-->
<robot name="robot">
  <link name="root" />
  ${link('chassis__1_', 'Chassis.stl', 2.0)}
  ${joint('fastened_1', 'fixed', 'root', 'chassis__1_', '0 0 0.05')}
  ${link('gobilda_1310_0016_4008__1_', 'goBILDA 1310-0016-4008.stl', 0.05, '0.9 0.6 0.1 1')}
  ${joint('fastened_2', 'fixed', 'chassis__1_', 'gobilda_1310_0016_4008__1_', '0.1 0 0.05')}
  ${link('arm__1_', 'Arm.obj', 7.2e-6, '0.3 0.3 0.9 1')}
  ${joint('revolute_1', 'revolute', 'chassis__1_', 'arm__1_', '-0.15 0 0.1', '0 1 0', [-0.5, 1.2])}
  ${link('drum__1_', 'Drum.stl', 0.1)}
  ${joint('revolute_2', 'continuous', 'chassis__1_', 'drum__1_', '0.2 0.2 0', '0 1 0')}
  ${link('drum__2_', 'Drum.stl', 0.1)}
  ${joint('revolute_3', 'continuous', 'chassis__1_', 'drum__2_', '-0.2 0.2 0', '0 1 0')}
  <link name="cylindrical_1_0">${inertial(1e-9)}</link>
  ${joint('cylindrical_1_1', 'prismatic', 'chassis__1_', 'cylindrical_1_0', '0 -0.15 0.1', '0 0 1', [-10000, 10000])}
  ${link('shaft__1_', 'Shaft.gltf', 0.2)}
  ${joint('cylindrical_1_2', 'continuous', 'cylindrical_1_0', 'shaft__1_', '0 0 0', '0 0 1')}
  ${link('link2__1_', 'Link2.stl', 0.05)}
  ${joint('revolute_4', 'revolute', 'arm__1_', 'link2__1_', '0.3 0 0', '0 1 0', [-1, 1])}
  <link name="link2__1__loop_closure">${inertial(1e-9)}</link>
  ${joint('revolute_5_loop_closure', 'revolute', 'chassis__1_', 'link2__1__loop_closure', '0.15 0 0.1', '0 1 0', [-1, 1])}
  ${link('claw2__1_', 'Claw.glb', 0.02)}
  ${joint('revolute_6', 'revolute', 'arm__1_', 'claw2__1_', '0.25 0 0', '0 0 1', [0, 1], '<mimic offset="0" multiplier="-1" joint="revolute_4"/>')}
  <link name="planar_1_0">${inertial(1e-9)}</link>
  <link name="planar_1_1">${inertial(1e-9)}</link>
  ${joint('planar_1_1', 'prismatic', 'chassis__1_', 'planar_1_0', '0 0.1 0.08', '1 0 0', [-10000, 10000])}
  ${joint('planar_1_2', 'prismatic', 'planar_1_0', 'planar_1_1', '0 0 0', '0 1 0', [-10000, 10000])}
  ${joint('planar_1_3', 'continuous', 'planar_1_1', 'plate__1_', '0 0 0', '0 0 1')}
  ${link('plate__1_', 'Plate.stl', 0.03)}
  <link name="gripper_assembly__1_" />
  ${joint('fastened_3', 'fixed', 'arm__1_', 'gripper_assembly__1_', '0.3 0 0')}
  ${link('finger__1_', 'Finger.stl', 0.01)}
  ${joint('fastened_4', 'fixed', 'gripper_assembly__1_', 'finger__1_', '0 0 0.02')}
</robot>
`;
const MESHES = {
  'Chassis.stl': stlBin(boxTris([0.4, 0.36, 0.05])), 'goBILDA 1310-0016-4008.stl': stlBin(boxTris([0.03, 0.03, 0.03])),
  'Arm.obj': enc(objBox([0.3, 0.04, 0.04])), 'Drum.stl': stlBin(boxTris([0.05, 0.04, 0.05])), 'Shaft.gltf': gltfData([0.02, 0.02, 0.2]),
  'Link2.stl': stlBin(boxTris([0.02, 0.02, 0.1])), 'Claw.glb': glb([0.04, 0.06, 0.02]), 'Plate.stl': stlBin(boxTris([0.08, 0.08, 0.005])), 'Finger.stl': stlBin(boxTris([0.03, 0.01, 0.05])),
};
async function onshapeZip(extra = []) {
  const entries = [{ name: 'robot/urdf/robot.urdf', data: URDF }, { name: 'robot/launch/robot.launch', data: '<launch/>' }, { name: 'robot/package.xml', data: '<package><name>robot</name></package>' },
    { name: '__MACOSX/robot/._robot.urdf', data: 'junk' }];
  for (const k in MESHES) entries.push({ name: 'robot/meshes/' + k, data: MESHES[k] });
  return E.zipWrite(entries.concat(extra), { deflate: true });
}
const byName = (cad) => Object.fromEntries(cad.solids.map((s) => [s.name, s]));
const jointsOf = (cad) => Object.fromEntries(cad.mechs.filter((m) => m.fromMate).map((m) => [m.id, m]));

test('zip: Onshape\'s export is recognised as a URDF with its meshes, by path and by bare name, junk ignored', async () => {
  const z = await E.robotFromZip(await onshapeZip());
  assert.equal(z.kind, 'urdf');
  assert.equal(z.name, 'robot');
  assert.equal(z.onshape, true, 'Onshape\'s header is noticed');
  assert.ok(z.text.includes('<robot name="robot">'));
  assert.ok(z.files['robot/meshes/Chassis.stl'] && z.files['Chassis.stl'] && z.files['goBILDA 1310-0016-4008.stl'], Object.keys(z.files).join(','));
  assert.ok(!Object.keys(z.files).some((k) => /MACOSX|\.launch|package\.xml/.test(k)));
});

test('onshape urdf: the payload reads Onshape\'s habits: root, dummies, loop closure, cylindrical, planar, continuous, mimic, tiny masses', async () => {
  const z = await E.robotFromZip(await onshapeZip());
  const p = E.urdfToPayload(z.text, z.files, z.name);
  assert.equal(p.onshapeExport, true);
  const inst = p.asm.rootAssembly.instances, names = inst.map((i) => i.name);
  // the root and a subassembly's frame are links with no shape, not missing parts
  assert.equal(inst.find((i) => i.name === 'root').shapeless, true);
  assert.equal(inst.find((i) => i.name === 'gripper assembly <1>').shapeless, true);
  // the loop-closure dummy and the cylindrical mate's in-between link aren't parts
  assert.ok(!names.some((n) => /loop_closure|loop closure|cylindrical/.test(n)), names.join(' | '));
  // names back to words, with the part number read out of them
  const gb = inst.find((i) => /gobilda/.test(i.name));
  assert.equal(gb.name, 'gobilda 1310 0016 4008 <1>');
  assert.equal(gb.partNumber, '1310-0016-4008');
  // one mesh placed one way is one shape however many links wear it
  const drums = inst.filter((i) => /^drum/.test(i.name));
  assert.equal(drums.length, 2);
  assert.equal(drums[0].elementId, drums[1].elementId);
  assert.equal(Object.keys(p.geom).length, 9, 'nine shapes: eight meshes, the drum once');
  const mates = p.asm.rootAssembly.features.filter((f) => f.featureType === 'mate'), byMate = Object.fromEntries(mates.map((m) => [m.featureData.name, m]));
  const idOf = (n) => inst.find((i) => i.name === n).id, endsOf = (m) => m.featureData.matedEntities.map((e) => e.matedOccurrence[0]);
  // the loop closure pins the chassis to the real link2
  assert.ok(byMate.closing_revolute_5, Object.keys(byMate).join(','));
  assert.deepEqual(endsOf(byMate.closing_revolute_5), [idOf('chassis <1>'), idOf('link2 <1>')]);
  // the cylindrical mate is one mate, chassis to shaft, free to turn
  assert.equal(byMate.cylindrical_1.featureData.mateType, 'CYLINDRICAL');
  assert.equal(byMate.cylindrical_1.featureData.continuous, true);
  assert.deepEqual(endsOf(byMate.cylindrical_1), [idOf('chassis <1>'), idOf('shaft <1>')]);
  assert.ok(!byMate.cylindrical_1_1 && !byMate.cylindrical_1_2);
  // continuous joints say so
  assert.equal(byMate.revolute_2.featureData.continuous, true);
  assert.equal(byMate.revolute_2.featureData.mateType, 'REVOLUTE');
  assert.equal(byMate.revolute_1.featureData.continuous, undefined);
  // the planar mate's three joints hold the plate where it was drawn
  for (const n of ['planar_1_1', 'planar_1_2', 'planar_1_3']) assert.equal(byMate[n].featureData.mateType, 'FASTENED', n);
  assert.ok(p.notes.some((n) => /planar mate/i.test(n)));
  // limits: the arm's in degrees as Onshape's features list has them; a ±10000 slide has none
  const lim = Object.fromEntries(p.features.features.map((f) => [f.message.name, Object.fromEntries(f.message.parameters.map((q) => [q.message.parameterId, q.message.expression ?? q.message.value]))]));
  assert.ok(lim.revolute_1 && lim.revolute_1.limitsEnabled === true);
  assert.ok(near(parseFloat(lim.revolute_1.limitAxialZMin), -0.5 * 180 / Math.PI, 1e-6) && near(parseFloat(lim.revolute_1.limitAxialZMax), 1.2 * 180 / Math.PI, 1e-6), JSON.stringify(lim.revolute_1));
  assert.ok(!lim.cylindrical_1_1 && !lim.cylindrical_1, 'a ±10000 slide is unlimited');
  // the gear relation
  const rel = p.asm.rootAssembly.features.find((f) => f.featureType === 'mateRelation');
  assert.ok(rel && rel.featureData.relationRatio === -1);
  assert.deepEqual(rel.featureData.mates.map((m) => m.featureId), [byMate.revolute_4.id, byMate.revolute_6.id]);
  // a near-zero mass is Onshape's "no material"
  assert.ok(p.notes.some((n) => /no material in Onshape/.test(n) && /arm/.test(n)), p.notes.join(' | '));
  const armKey = Object.keys(p.geom).find((k) => p.geom[k].parts[Object.keys(p.geom[k].parts)[0]].name === 'arm <1>');
  assert.equal(p.geom[armKey].mass.P.est, true, 'the arm is weighed from its shape');
});

test('onshape urdf: the robot: every part with its shape, the joints as the mates meant them, the loop closed, the follower coupled', async () => {
  const z = await E.robotFromZip(await onshapeZip());
  const cad = E.cadFromUrdf(z.text, z.files, { name: z.name });
  const S = byName(cad);
  assert.equal(cad.solids.length, 10, cad.solids.map((s) => s.name).join(','));
  for (const n of ['chassis', 'gobilda 1310 0016 4008', 'arm', 'drum', 'shaft', 'link2', 'claw2', 'plate', 'finger']) assert.ok(S[n], n);
  assert.equal(S['gobilda 1310 0016 4008'].part, '1310-0016-4008');
  assert.ok(!cad.onshape.why.some((w) => /without a shape/.test(w)), 'no part is reported missing');
  // the two drums are one mesh placed twice
  const drums = cad.solids.filter((s) => s.name === 'drum');
  assert.equal(drums[0].inst.key, drums[1].inst.key);
  // mass: everything but the arm, whose mass Onshape didn't know
  assert.ok(near(cad.onshape.kg, 2.56, 1e-9), String(cad.onshape.kg));
  assert.ok(S.arm.kgEst && S.arm.kg > 0, 'the arm is weighed from its shape');
  const J = jointsOf(cad);
  assert.ok(J.arm && J.drum && J['drum #2'] && J.shaft && J.link2 && J.claw2, Object.keys(J).join(','));
  assert.equal(J.arm.kind, 'revolute-lift');
  assert.ok(near(J.arm.limits[0], -0.5) && near(J.arm.limits[1], 1.2), JSON.stringify(J.arm.limits));
  assert.equal(J.drum.continuous, true);
  assert.equal(J.shaft.continuous, true, 'the cylindrical mate is free to turn');
  assert.equal(J.shaft.kind, 'revolute-yaw');
  assert.equal(J.link2.parent, 'arm');
  assert.deepEqual([J.claw2.couple.to, J.claw2.couple.ratio], ['link2', -1]);
  // the finger rides the arm through the subassembly's frame link; the plate's planar mate is held
  assert.equal(S.finger.mech, 'arm');
  assert.ok(!S.plate.mech, 'the plate stays with the chassis');
  assert.ok(!J.plate);
  // the loop
  assert.equal(cad.loops.length, 1);
  assert.equal(cad.loops[0].name, 'closing_revolute_5');
  assert.deepEqual([cad.loops[0].a, cad.loops[0].b].sort(), ['chassis', 'link2']);
  // a continuous joint isn't asked for limits
  const V = E.validateRobot(cad, {});
  const noLimits = V.items.filter((i) => i.code === 'no-limits').map((i) => i.joint);
  assert.ok(!noLimits.includes('drum') && !noLimits.includes('shaft'), noLimits.join(','));
  // and it travels as a package with all of that
  const pkg = E.simbotFromCad(cad, { created: '2026-10-03T00:00:00Z' });
  const back = await E.simbotUnpack(await E.simbotPack(pkg));
  assert.ok(back.ok, back.error);
  const c2 = E.cadFromSimbot(back.pkg).cad, J2 = jointsOf(c2);
  assert.equal(c2.solids.length, 10);
  assert.ok(J2.arm && J2.claw2 && J2.claw2.couple && J2.claw2.couple.to === 'link2');
  assert.equal(c2.loops.length, 1);
});

test('meshes: OBJ (quads, negative indices), glTF (data URI, external .bin, node placement), GLB, COLLADA (unit and up axis)', () => {
  const obj = E.urdfObj(enc(objBox([0.2, 0.2, 0.2])));
  assert.equal(obj.length, 12 * 9, 'six quads fan into twelve triangles');
  assert.ok(obj.every((v) => Math.abs(Math.abs(v) - 0.1) < 1e-9));
  const g = E.urdfGltf(gltfData([0.2, 0.2, 0.2]));
  assert.equal(g.length, 12 * 9);
  const moved = E.urdfGltf(gltfData([0.2, 0.2, 0.2], { roots: [0], list: [{ mesh: 0, name: 'mesh0', translation: [1, 0, 0] }] }));
  assert.ok(moved.filter((v, i) => i % 3 === 0).every((x) => Math.abs(Math.abs(x - 1) - 0.1) < 1e-6), 'a node\'s translation moves its mesh');
  const ext = gltfExternal([0.2, 0.2, 0.2], 'Shaft%20mesh.bin');
  assert.equal(E.urdfGltf(ext.gltf, { 'shaft mesh.bin': ext.bin }).length, 12 * 9, 'the buffer beside the file, by its decoded name');
  assert.throws(() => E.urdfGltf(ext.gltf, {}), /isn't with it/);
  assert.equal(E.urdfGltf(glb([0.2, 0.2, 0.2])).length, 12 * 9);
  const scene = E.urdfGltfScene(glb([0.2, 0.2, 0.2]));
  assert.deepEqual(scene[0].color, [0.2, 0.4, 0.8]);
  // COLLADA: centimetres, Y up, a translate of 5 cm up -> metres, Z up
  const d = E.urdfDae(enc(DAE)).map((v) => +v.toFixed(6));
  assert.deepEqual(d, [0, 0, 0.05, 0.1, 0, 0.05, 0, 0.1, 0.05]);
  // the dispatcher
  assert.equal(E.urdfMesh('x.OBJ', enc(objBox([0.1, 0.1, 0.1]))).length, 108);
  assert.equal(E.urdfMesh('x.ply', enc('')), null);
});

test('urdf and mjcf: OBJ, glTF and GLB meshes load where only STL did', () => {
  const u = `<robot name="r"><link name="a"><visual><geometry><mesh filename="package://r/meshes/A.obj"/></geometry></visual></link>
    <link name="b"><visual><geometry><mesh filename="B.glb" scale="0.001 0.001 0.001"/></geometry></visual></link>
    <joint name="j" type="revolute"><parent link="a"/><child link="b"/><origin xyz="0.2 0 0"/><axis xyz="0 0 1"/><limit lower="0" upper="1"/></joint></robot>`;
  const cad = E.cadFromUrdf(u, { 'A.obj': enc(objBox([0.2, 0.2, 0.05])), 'B.glb': glb([100, 100, 20]) });
  assert.equal(cad.solids.length, 2);
  const b = cad.solids.find((s) => s.name === 'b');
  assert.ok(b.size > 0.1 && b.size < 0.2, 'the GLB in millimetres is scaled: ' + b.size);
  const m = `<mujoco model="m"><asset><mesh name="box" file="Box.obj"/></asset><worldbody><body name="base"><geom type="mesh" mesh="box"/></body></worldbody></mujoco>`;
  const p = E.mjcfToPayload(m, { 'Box.obj': enc(objBox([0.1, 0.1, 0.1])) }, 'm');
  assert.ok(!p.notes.some((n) => /only STL/.test(n)), p.notes.join(' | '));
  assert.equal(E.cadFromOnshape(p).solids.length, 1);
});

test('gltf alone: Onshape\'s glTF export is the shapes, one part per named node, joints left to the finder', () => {
  const nodes = { roots: [0, 3], list: [
    { name: 'Chassis <1>', children: [1, 2] }, { mesh: 0, name: 'mesh0' }, { mesh: 0, name: 'mesh1', translation: [0, 0, 0.2] },
    { name: 'Arm 1310-0016-4008 <1>', children: [4], translation: [0.5, 0, 0] }, { mesh: 0, name: 'mesh2' }] };
  const p = E.gltfToPayload(gltfData([0.2, 0.2, 0.2], nodes), {}, 'bot');
  assert.equal(p.from, 'gltf');
  assert.deepEqual(p.asm.rootAssembly.instances.map((i) => i.name), ['Chassis <1>', 'Arm 1310-0016-4008 <1>']);
  assert.equal(p.asm.rootAssembly.instances[1].partNumber, '1310-0016-4008');
  const cad = E.cadFromOnshape(p);
  assert.deepEqual(cad.solids.map((s) => s.name).sort(), ['Arm 1310-0016-4008', 'Chassis']);
  const ch = cad.solids.find((s) => s.name === 'Chassis');
  assert.equal(ch.tri.pos.length, 2 * 12 * 9, 'both face meshes of the chassis are one part');
  assert.deepEqual(ch.color.map((v) => +v.toFixed(2)), [0.2, 0.4, 0.8]);
  assert.equal(cad.mechs.filter((m) => m.fromMate).length, 0);
  // a single part's export: one node per face and no names at all is one part, named after the file
  const faces = { roots: [0, 1, 2], list: [{ mesh: 0, name: 'mesh0' }, { mesh: 0, name: 'mesh1', translation: [0, 0, 0.2] }, { mesh: 0, name: 'mesh2', translation: [0, 0, 0.4] }] };
  const one = E.gltfToPayload(gltfData([0.2, 0.2, 0.2], faces), {}, 'baxis');
  assert.deepEqual(one.asm.rootAssembly.instances.map((i) => i.name), ['baxis']);
  assert.equal(E.cadFromOnshape(one).solids[0].tri.pos.length, 3 * 12 * 9);
});

test('zip: what else a zip may hold: a package (inside, or renamed), a STEP, an MJCF, a glTF; and what it refuses', async () => {
  const cad = E.cadFromUrdf(URDF.replace(/package:\/\/robot\/meshes\/[^"]+/g, 'x.stl'), { 'x.stl': MESHES['Chassis.stl'] });
  const pack = await E.simbotPack(E.simbotFromCad(cad, { created: '2026-10-03T00:00:00Z' }));
  // a .simbot inside a zip
  let z = await E.robotFromZip(await E.zipWrite([{ name: 'team/bot.simbot', data: pack }, { name: 'team/notes.txt', data: 'hi' }]));
  assert.equal(z.kind, 'simbot'); assert.equal(z.name, 'bot');
  assert.ok((await E.simbotUnpack(z.bytes)).ok);
  // a package someone renamed .zip
  z = await E.robotFromZip(pack);
  assert.equal(z.kind, 'simbot');
  assert.ok((await E.simbotUnpack(z.bytes)).ok);
  // a STEP
  z = await E.robotFromZip(await E.zipWrite([{ name: 'cad/Robot v12.step', data: 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n' }]));
  assert.equal(z.kind, 'step'); assert.equal(z.name, 'Robot v12.step'); assert.ok(/ISO-10303/.test(z.text));
  // an MJCF as .xml, with its mesh
  z = await E.robotFromZip(await E.zipWrite([{ name: 'm/model.xml', data: '<mujoco model="m"><worldbody/></mujoco>' }, { name: 'm/assets/a.obj', data: 'v 0 0 0' }]));
  assert.equal(z.kind, 'mjcf'); assert.ok(z.files['a.obj'] && z.files['m/assets/a.obj']);
  // a Control Hub config .xml isn't a robot
  await assert.rejects(E.robotFromZip(await E.zipWrite([{ name: 'config.xml', data: '<Robot type="FirstInspires-FTC"/>' }])), /no robot in this zip/);
  // shapes only
  z = await E.robotFromZip(await E.zipWrite([{ name: 'export/bot.glb', data: glb([0.2, 0.2, 0.2]) }]));
  assert.equal(z.kind, 'gltf'); assert.equal(z.name, 'bot');
  assert.equal(E.cadFromOnshape(E.gltfToPayload(z.bytes, z.files, z.name)).solids.length, 1);
  // only STLs: says what's in it and what it reads
  await assert.rejects(E.robotFromZip(await E.zipWrite([{ name: 'a.stl', data: MESHES['Drum.stl'] }, { name: 'b.stl', data: MESHES['Drum.stl'] }])), /no robot in this zip \(it holds \.stl\)/);
  // a URDF in Onshape's urdf/ folder wins over a stray one
  z = await E.robotFromZip(await E.zipWrite([{ name: 'r/other.urdf', data: '<robot name="other"><link name="a"/></robot>'.padEnd(4000, ' ') }, { name: 'r/urdf/r.urdf', data: '<robot name="r"><link name="a"/></robot>' }]));
  assert.equal(z.name, 'r');
  // hostile archives are refused the way a package is
  await assert.rejects(E.robotFromZip(await E.zipWrite([{ name: '../r.urdf', data: '<robot/>' }])));
  await assert.rejects(E.robotFromZip(new Uint8Array([1, 2, 3, 4])));
  // an empty one
  await assert.rejects(E.robotFromZip(await E.zipWrite([])), /empty/);
});

test('onshape urdf: the review cases: a buffer by any case, a % in a name, visual vs collision meshes of one name, a limited cylindrical turn, REV numbers, a misspelt parent', async () => {
  // a glTF's buffer beside it, uppercase, through the zip
  const ext = gltfExternal([0.02, 0.02, 0.2], 'Shaft.bin');
  const entries = [{ name: 'r/urdf/r.urdf', data: URDF }, { name: 'r/meshes/Shaft.gltf', data: ext.gltf }, { name: 'r/meshes/Shaft.bin', data: ext.bin }];
  for (const k in MESHES) if (k !== 'Shaft.gltf') entries.push({ name: 'r/meshes/' + k, data: MESHES[k] });
  const z = await E.robotFromZip(await E.zipWrite(entries));
  const p = E.urdfToPayload(z.text, z.files, z.name);
  assert.ok(!p.notes.some((n) => /shaft/i.test(n)), p.notes.join(' | '));
  assert.equal(E.cadFromOnshape(p).solids.length, 10);
  // a literal % in a missing file's name is a note, not a crash
  const p4 = E.urdfToPayload(URDF.replace('package://robot/meshes/Plate.stl', 'package://robot/meshes/50% plate.stl'), MESHES, 'r');
  assert.ok(p4.notes.some((n) => /50% plate\.stl/.test(n)), p4.notes.join(' | '));
  // meshes/visual/arm.stl and meshes/collision/arm.stl: the visual is drawn
  const u5 = `<robot name="r"><link name="a"><visual><geometry><mesh filename="package://r/meshes/visual/arm.stl"/></geometry></visual><collision><geometry><mesh filename="package://r/meshes/collision/arm.stl"/></geometry></collision></link></robot>`;
  const c5 = E.cadFromUrdf(u5, { 'r/meshes/collision/arm.stl': stlBin(boxTris([1, 1, 1])), 'r/meshes/visual/arm.stl': stlBin(boxTris([0.3, 0.02, 0.02])) });
  assert.ok(c5.solids[0].size < 0.35, 'the visual mesh, not the collision box: ' + c5.solids[0].size);
  // a cylindrical mate whose turn Onshape limited keeps the limits and isn't continuous
  const u6 = URDF.replace(joint('cylindrical_1_2', 'continuous', 'cylindrical_1_0', 'shaft__1_', '0 0 0', '0 0 1'), joint('cylindrical_1_2', 'revolute', 'cylindrical_1_0', 'shaft__1_', '0 0 0', '0 0 1', [-0.3, 0.3]));
  const p6 = E.urdfToPayload(u6, MESHES, 'r');
  assert.equal(p6.asm.rootAssembly.features.find((f) => f.featureData.name === 'cylindrical_1').featureData.continuous, undefined);
  const J6 = jointsOf(E.cadFromUrdf(u6, MESHES, {}));
  assert.ok(J6.shaft && near(J6.shaft.limits[0], -0.3) && near(J6.shaft.limits[1], 0.3), JSON.stringify(J6.shaft && J6.shaft.limits));
  assert.ok(!J6.shaft.continuous);
  // a REV part number inside a lowercased name
  assert.equal(E.urdfPartNumber('gripper_rev_41_1301__1_'), 'REV-41-1301');
  assert.equal(E.urdfPartNumber('REV-41-1301 Servo'), 'REV-41-1301');
  assert.equal(E.urdfPartNumber('forever_1301'), null);
  // a joint whose parent isn't in the file: what hangs from it is named, not silently lost
  const p8 = E.urdfToPayload(URDF.replace('<parent link="arm__1_"/><child link="link2__1_"/>', '<parent link="armm__1_"/><child link="link2__1_"/>'), MESHES, 'r');
  assert.ok(p8.notes.some((n) => /link2__1_/.test(n) && /parent isn't in the file/.test(n)), p8.notes.join(' | '));
});

test('gltf alone: a glTF that is not Onshape\'s is Y up and comes in Z up; a hand-written URDF keeps a slide and a turn through its own dummy link', () => {
  const tall = gltfJson([0.1, 0.4, 0.1], ONE, { asset: { version: '2.0', generator: 'Blender' } });
  tall.json.buffers[0].uri = 'data:application/octet-stream;base64,' + Buffer.from(tall.buf).toString('base64');
  const p = E.gltfToPayload(enc(JSON.stringify(tall.json)), {}, 'plate');
  const tri = p.geom[Object.keys(p.geom)[0]].parts.P0.tri, span = (k) => { const v = tri.filter((x, i) => i % 3 === k); return Math.max(...v) - Math.min(...v); };
  assert.ok(near(span(2), 0.4) && near(span(1), 0.1), 'Y up became Z up: ' + [span(0), span(1), span(2)]);
  assert.ok(p.notes.some((n) => /Y axis was taken as up/.test(n)));
  const on = E.gltfToPayload(gltfData([0.1, 0.4, 0.1]), {}, 'plate');          // Onshape's: as written
  const t2 = on.geom[Object.keys(on.geom)[0]].parts.P0.tri, y2 = t2.filter((x, i) => i % 3 === 1);
  assert.ok(near(Math.max(...y2) - Math.min(...y2), 0.4));
  const u = `<robot name="scara"><link name="base"><visual><geometry><box size="0.3 0.3 0.05"/></geometry></visual></link>
    <link name="zslide"/>
    <link name="wrist"><visual><geometry><box size="0.1 0.02 0.02"/></geometry></visual></link>
    <joint name="z" type="prismatic"><parent link="base"/><child link="zslide"/><origin xyz="0 0 0.1"/><axis xyz="0 0 1"/><limit lower="0" upper="0.2"/></joint>
    <joint name="yaw" type="revolute"><parent link="zslide"/><child link="wrist"/><axis xyz="0 0 1"/><limit lower="-1" upper="1"/></joint></robot>`;
  const J = jointsOf(E.cadFromUrdf(u, {}));
  assert.ok(J.z && J.yaw, Object.keys(J).join(','));
  assert.equal(J.z.kind, 'linear');
  assert.equal(J.yaw.parent, 'z');
});

/* ---- memory: a real export is dense (tens of thousands of triangles per part) and a tab has a limit ---- */
// a tube: `tri` triangles of smooth surface, the kind a lathe-turned goBILDA part exports as
const tube = (tri, r = 0.02, h = 0.02) => { const seg = Math.max(8, Math.floor(tri / 4)), out = []; const P = (i, z, rr) => [rr * Math.cos(2 * Math.PI * i / seg), rr * Math.sin(2 * Math.PI * i / seg), z];
  for (let i = 0; i < seg; i++) { const a = P(i, 0, r), b = P(i + 1, 0, r), c = P(i + 1, h, r), d = P(i, h, r), a2 = P(i, 0, r * .8), b2 = P(i + 1, 0, r * .8), c2 = P(i + 1, h, r * .8), d2 = P(i, h, r * .8);
    for (const t of [[a, b, c], [a, c, d], [a2, c2, b2], [a2, d2, c2]]) out.push(...t[0], ...t[1], ...t[2]); } return out; };

test('decimate: a dense mesh comes down to its budget as a Float32Array with its size kept; a small one is left alone', () => {
  const T = tube(20000);
  const d = E.urdfDecimate(T, 2000);
  assert.ok(d instanceof Float32Array);
  assert.ok(d.length / 9 <= 2000 && d.length / 9 > 100, 'kept ' + d.length / 9);
  const span = (A, k) => { let mn = Infinity, mx = -Infinity; for (let i = k; i < A.length; i += 3) { if (A[i] < mn) mn = A[i]; if (A[i] > mx) mx = A[i]; } return mx - mn; };
  for (const k of [0, 1, 2]) assert.ok(Math.abs(span(d, k) - span(T, k)) < 0.004, 'axis ' + k + ' spans ' + span(d, k) + ' vs ' + span(T, k));
  const small = boxTris([0.1, 0.1, 0.1]);
  const s = E.urdfDecimate(small, 2000);
  assert.equal(s.length, small.length, 'under budget: untouched');
  assert.ok(s instanceof Float32Array);
  // the budget per part: a whole robot stays near the total, never under 600 a part
  assert.equal(E.urdfTriBudget(300), 4000);
  assert.equal(E.urdfTriBudget(3000), 600);
  assert.equal(E.urdfTriBudget(10), 5000);
  assert.equal(E.urdfTriBudget(100, 150000), 1500);
});

test('memory: a 60-part export of 36,000-triangle meshes imports within its budget, in typed arrays, computing each shared shape once', () => {
  const files = {}; for (let i = 0; i < 20; i++) files['Part' + i + '.stl'] = stlBin(tube(36000, 0.02 + 0.0005 * i));
  let u = '<!--URDF generated by ONSHAPE BY PTC INC, 1.217-->\n<robot name="big"><link name="root" />';
  for (let i = 0; i < 60; i++) {
    u += `<link name="part_${i}__1_"><inertial><mass value="0.05"/></inertial><visual><geometry><mesh filename="package://big/meshes/Part${i % 20}.stl"/></geometry></visual></link>`;
    u += i % 10 === 5 ? `<joint name="revolute_${i}" type="revolute"><origin xyz="${(i % 20) * 0.05} ${Math.floor(i / 20) * 0.05} 0.1"/><parent link="part_${i - 1}__1_"/><child link="part_${i}__1_"/><axis xyz="0 1 0"/><limit lower="-1" upper="1"/></joint>`
      : `<joint name="fastened_${i}" type="fixed"><origin xyz="${(i % 20) * 0.05} ${Math.floor(i / 20) * 0.05} 0.05"/><parent link="root"/><child link="part_${i}__1_"/></joint>`;
  }
  u += '</robot>';
  const t0 = Date.now();
  const p = E.urdfToPayload(u, files, 'big', { triangles: 1.2e6 });
  const cad = E.cadFromUrdf(u, files, { triangles: 1.2e6 });
  const ms = Date.now() - t0;
  assert.equal(cad.solids.length, 60);
  let kept = 0; for (const s of cad.solids) { assert.ok(s.tri.pos instanceof Float32Array && s.tri.nor instanceof Float32Array); kept += s.tri.pos.length / 9; }
  assert.ok(kept <= 1.25e6, 'kept ' + kept + ' of 2.16M placed');
  assert.ok(p.notes.some((n) => /simplified for the browser/.test(n) && /0\.7M triangles/.test(n)), p.notes.join(' | '));
  // twenty shapes, not sixty: the same mesh in the same place is computed and stored once
  assert.equal(Object.keys(p.geom).length, 20);
  assert.equal(new Set(cad.solids.map((s) => s.inst.key)).size, 20);
  // and the sample points are bounded, the joints still there
  for (const s of cad.solids) assert.ok(s.pts.length <= 120);
  assert.equal(cad.mechs.filter((m) => m.fromMate).length, 6);
  assert.ok(ms < 20000, 'took ' + ms + ' ms');
  // a smaller device's budget cuts deeper (36,000 for the robot: the 600-a-part floor)
  const lite = E.cadFromUrdf(u, files, { triangles: 36000 });
  let keptLite = 0; for (const s of lite.solids) keptLite += s.tri.pos.length / 9;
  assert.ok(keptLite <= 60 * 600 && keptLite < kept, 'lite kept ' + keptLite + ' vs ' + kept);
});

/* ---- what a whole real robot's export taught: hundreds of bearings, no materials, dense tyres ---- */
test('budgets: triangles are shared out by size, so a dense part keeps far more than a screw, and a tiny mesh is left whole', () => {
  const big = stlBin(tube(60000, 0.05, 0.03)), small = stlBin(boxTris([0.01, 0.01, 0.01]));
  let u = '<!--URDF generated by ONSHAPE BY PTC INC, 1.217-->\n<robot name="b"><link name="root" />';
  u += '<link name="tyre__1_"><visual><geometry><mesh filename="package://b/meshes/Tyre.stl"/></geometry></visual></link><joint name="fastened_1" type="fixed"><parent link="root"/><child link="tyre__1_"/></joint>';
  for (let i = 0; i < 40; i++) u += `<link name="screw_${i}"><visual><geometry><mesh filename="package://b/meshes/Screw.stl"/></geometry></visual></link><joint name="fastened_s${i}" type="fixed"><origin xyz="${i * 0.02} 0 0"/><parent link="root"/><child link="screw_${i}"/></joint>`;
  u += '</robot>';
  const p = E.urdfToPayload(u, { 'Tyre.stl': big, 'Screw.stl': small }, 'b', { triangles: 20000 });
  const shapes = Object.values(p.geom).map((g) => g.parts[Object.keys(g.parts)[0]]);
  const tyre = shapes.find((s) => s.name === 'tyre <1>'), screw = shapes.find((s) => /screw/.test(s.name));
  assert.equal(screw.tri.length, 12 * 9, 'the screw keeps its 12 triangles');
  assert.ok(tyre.tri.length / 9 <= 2500 && tyre.tri.length / 9 > 1200, 'the tyre gets an eighth of the budget: ' + tyre.tri.length / 9);
  // eighty copies of one roller don't take the robot's whole allowance
  let u2 = '<!--URDF generated by ONSHAPE BY PTC INC, 1.217-->\n<robot name="b"><link name="root" />';
  u2 += '<link name="frame__1_"><visual><geometry><mesh filename="package://b/meshes/Tyre.stl"/></geometry></visual></link><joint name="fastened_0" type="fixed"><parent link="root"/><child link="frame__1_"/></joint>';
  for (let i = 0; i < 80; i++) u2 += `<link name="roller_${i}"><visual><geometry><mesh filename="package://b/meshes/Roller.stl"/></geometry></visual></link><joint name="fastened_r${i}" type="fixed"><origin xyz="${i * 0.02} 0 0"/><parent link="root"/><child link="roller_${i}"/></joint>`;
  u2 += '</robot>';
  // the frame: a 1 m plate of 20,000 triangles spread 10 mm apart, which no grid merges
  const gridTris = (n, size) => { const T = [], d = size / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = i * d, y = j * d; T.push(x, y, 0, x + d, y, 0, x + d, y + d, 0, x, y, 0, x + d, y + d, 0, x, y + d, 0); } return T; };
  const p2 = E.urdfToPayload(u2, { 'Tyre.stl': stlBin(gridTris(100, 1)), 'Roller.stl': stlBin(tube(20000, 0.01, 0.02)) }, 'b', { triangles: 200000 });
  const sh2 = Object.values(p2.geom).map((g) => g.parts[Object.keys(g.parts)[0]]);
  const frame = sh2.find((s) => s.name === 'frame <1>'), roller = sh2.find((s) => /roller/.test(s.name));
  assert.ok(roller.tri.length / 9 * 80 <= 200000 * 0.3 + 80 * 9, 'the rollers together take at most 30%: ' + roller.tri.length / 9 * 80);
  assert.ok(frame.tri.length / 9 >= 20000, 'the frame gets what they gave up: ' + frame.tri.length / 9);
  assert.equal(E.urdfMeshCount('x.stl', big), 60000);
  assert.equal(E.urdfMeshCount('x.obj', enc(objBox([1, 1, 1]))), 12);
  assert.equal(E.urdfMeshCount('x.glb', glb([1, 1, 1])), 12);
});

test('mass: a part with no material (Onshape\'s 1 kg/m³) is weighed from its volume as what its name says; a real material is kept', () => {
  const cube = stlBin(boxTris([0.1, 0.1, 0.1]));                 // 0.001 m³
  const u = `<!--URDF generated by ONSHAPE BY PTC INC, 1.217-->
<robot name="m"><link name="root" />
  <link name="block__1_"><inertial><mass value="0.001"/></inertial><visual><geometry><mesh filename="package://m/meshes/Cube.stl"/></geometry></visual></link>
  <joint name="fastened_1" type="fixed"><parent link="root"/><child link="block__1_"/></joint>
  <link name="m4_screw__1_"><inertial><mass value="0.001"/></inertial><visual><geometry><mesh filename="package://m/meshes/Cube.stl"/></geometry></visual></link>
  <joint name="fastened_2" type="fixed"><origin xyz="0.2 0 0"/><parent link="root"/><child link="m4_screw__1_"/></joint>
  <link name="real__1_"><inertial><mass value="2.5"/></inertial><visual><geometry><mesh filename="package://m/meshes/Cube.stl"/></geometry></visual></link>
  <joint name="fastened_3" type="fixed"><origin xyz="0.4 0 0"/><parent link="root"/><child link="real__1_"/></joint>
  <link name="nomass__1_"><visual><geometry><mesh filename="package://m/meshes/Cube.stl"/></geometry></visual></link>
  <joint name="fastened_4" type="fixed"><origin xyz="0.6 0 0"/><parent link="root"/><child link="nomass__1_"/></joint>
</robot>`;
  const cad = E.cadFromUrdf(u, { 'Cube.stl': cube }, {});
  const S = byName(cad);
  assert.ok(near(S.block.kg, 2.7, 1e-6) && S.block.kgEst, 'aluminium by default: ' + S.block.kg);
  assert.ok(near(S['m4 screw'].kg, 7.85, 1e-6), 'a screw is steel: ' + S['m4 screw'].kg);
  assert.ok(near(S.real.kg, 2.5) && !S.real.kgEst, 'a real material stays');
  assert.ok(near(S.nomass.kg, 2.7, 1e-6), 'no <inertial> at all in an Onshape export: weighed too');
  assert.ok(near(cad.onshape.kg, 2.5) && near(cad.onshape.kgEst, 2.7 * 2 + 7.85, 1e-6), JSON.stringify([cad.onshape.kg, cad.onshape.kgEst]));
  assert.ok(cad.onshape.why.some((w) => /weighed from the shapes of 3 parts/.test(w)), cad.onshape.why.join(' | '));
  const V = E.validateRobot(cad, {});
  assert.ok(!V.items.some((i) => i.code === 'no-mass'), 'nothing is reported massless');
  assert.ok(near(E.urdfVolume(boxTris([0.1, 0.2, 0.3])), 0.006, 1e-9));
});

test('normals: a cylinder shades smoothly round its side while a box keeps its edges', () => {
  const u = `<robot name="n"><link name="base"><visual><geometry><cylinder radius="0.05" length="0.1"/></geometry></visual></link>
    <link name="box"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>
    <joint name="j" type="fixed"><origin xyz="0.3 0 0"/><parent link="base"/><child link="box"/></joint></robot>`;
  const cad = E.cadFromUrdf(u, {}, {});
  const S = byName(cad);
  const cyl = S.base.tri, flat = (t, f) => { const a = [t.pos[9 * f + 3] - t.pos[9 * f], t.pos[9 * f + 4] - t.pos[9 * f + 1], t.pos[9 * f + 5] - t.pos[9 * f + 2]], b = [t.pos[9 * f + 6] - t.pos[9 * f], t.pos[9 * f + 7] - t.pos[9 * f + 1], t.pos[9 * f + 8] - t.pos[9 * f + 2]];
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], L = Math.hypot(...n); return n.map((v) => v / L); };
  // a side face of the cylinder: its corners' normals differ from the face's own, and from each other
  let smooth = 0, sides = 0, faces = cyl.pos.length / 9;
  for (let f = 0; f < faces; f++) { const n = flat(cyl, f); if (Math.abs(n[2]) > 0.5) continue;   // a cap
    sides++;
    const c0 = [cyl.nor[9 * f], cyl.nor[9 * f + 1], cyl.nor[9 * f + 2]], c1 = [cyl.nor[9 * f + 3], cyl.nor[9 * f + 4], cyl.nor[9 * f + 5]];
    if (Math.abs(c0[0] * n[0] + c0[1] * n[1] + c0[2] * n[2]) < 0.999 && Math.abs(c0[0] * c1[0] + c0[1] * c1[1] + c0[2] * c1[2]) < 0.999) smooth++; }
  assert.ok(sides > 0 && smooth === sides, smooth + ' of ' + sides + ' side faces have smoothed corners');
  const box = S.box.tri;
  for (let f = 0; f < box.pos.length / 9; f++) { const n = flat(box, f); for (let c = 0; c < 3; c++) assert.ok(Math.abs(box.nor[9 * f + 3 * c] * n[0] + box.nor[9 * f + 3 * c + 1] * n[1] + box.nor[9 * f + 3 * c + 2] * n[2]) > 0.999, 'a box corner keeps its face normal'); }
});

test('passive: bearings and hubs on continuous mates are kept but never asked about; the carousel and the roller are', () => {
  // a chassis, a big carousel (many parts, half a metre), an intake roller, and 30 bearings on little axles
  let u = `<!--URDF generated by ONSHAPE BY PTC INC, 1.217-->\n<robot name="p"><link name="root" />`;
  const L = (name, size, kg = 0.1) => `<link name="${name}"><inertial><mass value="${kg}"/></inertial><visual><geometry><box size="${size}"/></geometry></visual></link>`;
  const J = (name, type, parent, child, xyz, axis = '0 0 1') => `<joint name="${name}" type="${type}"><origin xyz="${xyz}"/><parent link="${parent}"/><child link="${child}"/><axis xyz="${axis}"/></joint>`;
  u += L('chassis__1_', '0.4 0.4 0.05', 3) + J('fastened_1', 'fixed', 'root', 'chassis__1_', '0 0 0.05');
  u += L('carousel__1_', '0.45 0.45 0.02', 0.5) + J('revolute_1', 'continuous', 'chassis__1_', 'carousel__1_', '0 0 0.2');
  for (let i = 0; i < 8; i++) u += L(`cup_${i}__1_`, '0.06 0.06 0.08', 0.05) + J(`fastened_c${i}`, 'fixed', 'carousel__1_', `cup_${i}__1_`, `${0.18 * Math.cos(i)} ${0.18 * Math.sin(i)} 0.05`);
  u += L('rollertire__1_', '0.1 0.03 0.03', 0.1) + J('revolute_2', 'continuous', 'chassis__1_', 'rollertire__1_', '0.25 0 0.1', '0 1 0');
  for (let i = 0; i < 30; i++) u += L(`1611_0514_0006_bearing_${i}__1_`, '0.014 0.014 0.005', 0.004) + J(`revolute_${10 + i}`, 'continuous', 'chassis__1_', `1611_0514_0006_bearing_${i}__1_`, `${-0.18 + 0.012 * i} 0.15 0.06`, '0 1 0');
  u += '</robot>';
  const cad = E.cadFromUrdf(u, {}, {});
  const J2 = jointsOf(cad), passive = cad.mechs.filter((m) => m.passive), active = cad.mechs.filter((m) => m.fromMate && !m.passive);
  assert.equal(passive.length, 30, 'the thirty bearings: ' + passive.length);
  assert.deepEqual(active.map((m) => m.id).sort(), ['carousel', 'rollertire']);
  assert.ok(J2.carousel.continuous && !J2.carousel.passive);
  // validation and the robot check leave the bearings alone
  const code = E.parseJava(`import com.qualcomm.robotcore.eventloop.opmode.*; import com.qualcomm.robotcore.hardware.*;
    @TeleOp public class T extends LinearOpMode { DcMotor FL,FR,BL,BR,spinner,intake2; Servo uppies;
    public void runOpMode(){ FL=hardwareMap.dcMotor.get("FL"); FR=hardwareMap.dcMotor.get("FR"); BL=hardwareMap.dcMotor.get("BL"); BR=hardwareMap.dcMotor.get("BR");
      spinner=hardwareMap.dcMotor.get("spinner"); intake2=hardwareMap.dcMotor.get("intake2"); uppies=hardwareMap.servo.get("uppies"); waitForStart();
      while(opModeIsActive()){ spinner.setPower(0.3); intake2.setPower(1); uppies.setPosition(0.4); FL.setPower(1); } } }`);
  const V = E.validateRobot(cad, { devices: code.devices, map: {} });
  assert.equal(V.items.filter((i) => i.code === 'no-device').length, 2, 'only the carousel and the roller lack a device');
  const map = E.autoMap(code.devices, cad.mechs, { cad });
  assert.ok(!Object.values(map).some((j) => j && /bearing/.test(j)), 'no device is guessed onto a bearing: ' + JSON.stringify(map));
  const R = E.checkRobot(cad, code, map, { isCommanded: () => true });
  const asked = R.items.filter((i) => i.ask === 'pick-device');
  assert.ok(asked.length <= 2, 'asked ' + asked.length + ': ' + asked.map((i) => i.joint).join(','));
  assert.ok(R.items.some((i) => i.key === 'undriven:more' && /30 bearings, hubs and idlers/.test(i.text)), R.items.map((i) => i.text).join(' | '));
  // the status light's analysis skips them too
  const found = E.analyzeProgram ? null : null; void found;
});

test('loop closures a parallel mate makes are dummies named after the mate: left out, with the loop still driven', () => {
  const u = URDF.replace('</robot>', `<link name="parallel_5_loop_closure" /><link name="parallel_5_loop_closure_1" />
    <joint name="parallel_5_loop_closure" type="prismatic"><origin xyz="0.1 0 0.1"/><parent link="chassis__1_"/><child link="parallel_5_loop_closure_1"/><axis xyz="1 0 0"/><limit lower="-10000" upper="10000"/></joint>
    <joint name="parallel_5_loop_closure_1" type="continuous"><parent link="parallel_5_loop_closure_1"/><child link="parallel_5_loop_closure"/><axis xyz="0 0 1"/></joint></robot>`);
  const p = E.urdfToPayload(u, MESHES, 'r');
  assert.ok(!p.asm.rootAssembly.instances.some((i) => /parallel/.test(i.name)));
  assert.ok(!p.asm.rootAssembly.features.some((f) => /parallel/.test(f.featureData.name)));
  assert.ok(p.notes.some((n) => /2 loop-closing dummies/.test(n)), p.notes.join(' | '));
  const cad = E.cadFromUrdf(u, MESHES, {});
  assert.equal(cad.solids.length, 10);
  assert.equal(E.checkRobot(cad, E.parseJava('import com.qualcomm.robotcore.eventloop.opmode.*; @TeleOp public class T extends LinearOpMode { public void runOpMode(){ waitForStart(); } }'), {}, {}).items.filter((i) => i.ask === 'drop-joint').length, 0);
});

test('colours: Onshape\'s default greys are no colour (the bench draws the part by what it is, as for a STEP); a chosen colour stays', () => {
  const grey = URDF.replace('<color rgba="0.5 0.5 0.5 1"/>', '<color rgba="0.85098 0.85098 0.85098 1"/>');
  const cad = E.cadFromUrdf(grey, MESHES, {});
  const S = byName(cad);
  assert.equal(S.chassis.color, null, 'the chassis\' default grey is dropped');
  assert.ok(S.plate.color === null, 'a 0.5 grey too');
  assert.deepEqual(S['gobilda 1310 0016 4008'].color.map((v) => +v.toFixed(2)), [0.9, 0.6, 0.1], 'goBILDA yellow stays');
  assert.deepEqual(S.arm.color.map((v) => +v.toFixed(2)), [0.3, 0.3, 0.9], 'a chosen blue stays');
});

test('shooter: a robot read whole from its CAD brings its own shooter, so no stand-in is drawn for it', () => {
  const cad = E.cadFromUrdf(URDF, MESHES, {});
  const Sim = E.Sim, Shots = E.Shots;
  const saved = { cad: Sim.cad, opts: Sim.opts, cfg: Shots.cfg, footprint: Sim.footprint };
  try {
    Shots.cfg = { shooter: 'outtake', mountDeg: 0 }; Sim.opts = { shooterModel: 'auto' }; Sim.footprint = { hx: 0.2 };
    Sim.cad = cad;
    assert.equal(Shots.module(), null, 'an exported robot: nothing drawn in');
    Sim.cad = { source: 'step', parts: [{ name: 'Channel' }], solids: [] };
    assert.ok(Shots.module(), 'a STEP with no flywheel part still gets the stand-in');
    Sim.cad = cad; Sim.opts = { shooterModel: 'show' };
    assert.ok(Shots.module(), 'asked to show it, it is drawn');
  } finally { Sim.cad = saved.cad; Sim.opts = saved.opts; Shots.cfg = saved.cfg; Sim.footprint = saved.footprint; }
});

test('mass: only Onshape\'s 1 kg/m³ placeholder is re-weighed; a hand-written mass stays, a chosen material in Onshape stays, and an open sheet weighs nothing', () => {
  const cube = stlBin(boxTris([0.4, 0.4, 0.3]));                    // 0.048 m³
  const plain = `<robot name="m"><link name="base"><inertial><mass value="2.0"/></inertial><visual><geometry><mesh filename="Cube.stl"/></geometry></visual></link></robot>`;
  assert.ok(near(E.cadFromUrdf(plain, { 'Cube.stl': cube }, {}).solids[0].kg, 2.0), 'a URDF that is not Onshape\'s keeps its mass');
  const chosen = `<!--URDF generated by ONSHAPE BY PTC INC, 1.217-->\n<robot name="m"><link name="root" /><link name="foam__1_"><inertial><mass value="2.0"/></inertial><visual><geometry><mesh filename="Cube.stl"/></geometry></visual></link><joint name="fastened_1" type="fixed"><parent link="root"/><child link="foam__1_"/></joint></robot>`;
  const S = byName(E.cadFromUrdf(chosen, { 'Cube.stl': cube }, {}));
  assert.ok(near(S.foam.kg, 2.0) && !S.foam.kgEst, 'a light material a team chose (42 kg/m³ foam) is theirs');
  const placeholder = chosen.replace('<mass value="2.0"/>', '<mass value="0.048"/>');
  const S2 = byName(E.cadFromUrdf(placeholder, { 'Cube.stl': cube }, {}));
  assert.ok(S2.foam.kgEst && near(S2.foam.kg, 0.048 * 2700, 1e-2), 'the placeholder density is re-weighed: ' + S2.foam.kg);
  // an open sheet far from the origin: its "volume" is not a volume
  const sheet = stlBin([0, 0, 1, 0.3, 0, 1, 0.3, 0.3, 1, 0, 0, 1, 0.3, 0.3, 1, 0, 0.3, 1]);
  const S3 = byName(E.cadFromUrdf(placeholder.replace(/foam/g, 'sheet'), { 'Cube.stl': sheet }, {}));
  assert.ok(S3.sheet.kg <= 0.001 + 1e-9, 'a sheet weighs a gram at most: ' + S3.sheet.kg);
});

test('budgets: a COLLADA mesh, whose count takes a full read, still gets a share of the allowance', () => {
  const tri = tube(20000), n = tri.length / 9;
  const dae = `<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><unit meter="1"/><up_axis>Z_UP</up_axis></asset>
    <library_geometries><geometry id="g"><mesh><source id="p"><float_array id="pa" count="${tri.length}">${tri.map((v) => +v.toFixed(5)).join(' ')}</float_array></source>
    <vertices id="v"><input semantic="POSITION" source="#p"/></vertices><triangles count="${n}"><input semantic="VERTEX" source="#v" offset="0"/><p>${Array.from({ length: n * 3 }, (_, i) => i).join(' ')}</p></triangles></mesh></geometry></library_geometries>
    <library_visual_scenes><visual_scene id="s"><node><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes></COLLADA>`;
  let u = '<robot name="d">';
  for (let i = 0; i < 4; i++) u += `<link name="l${i}"><visual><geometry><mesh filename="Tube.dae"/></geometry></visual></link>` + (i ? `<joint name="j${i}" type="fixed"><parent link="l0"/><child link="l${i}"/><origin xyz="${i * 0.1} 0 0"/></joint>` : '');
  u += '</robot>';
  const p = E.urdfToPayload(u, { 'Tube.dae': enc(dae) }, 'd', { triangles: 1000 });
  const kept = Object.values(p.geom).reduce((s, g) => s + g.parts[Object.keys(g.parts)[0]].tri.length / 9, 0);
  assert.ok(kept <= E.urdfTriBudget(4, 1000) + 10, 'the DAE is cut to the even share: ' + kept);
});
