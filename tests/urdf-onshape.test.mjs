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
  assert.ok(p.notes.some((n) => /almost no mass/.test(n) && /arm/.test(n)), p.notes.join(' | '));
  const armKey = Object.keys(p.geom).find((k) => p.geom[k].parts[Object.keys(p.geom[k].parts)[0]].name === 'arm <1>');
  assert.deepEqual(p.geom[armKey].mass, {});
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
  assert.equal(S.arm.kg, undefined);
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
