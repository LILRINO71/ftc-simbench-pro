// The robot package (src/simbot.js): one .simbot file carries a robot's
// geometry, joints, constraints, device bindings and mass, comes back as the
// same robot, and never trusts what it is handed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, fixture } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');
const payload = () => JSON.parse(JSON.stringify({ name: 'Mated Robot', asm: R.onshape.assembly, features: R.onshape.features, geom: R.onshape.geom }));
const onshapeCad = () => E.cadFromOnshape(payload());
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const enc = (s) => new TextEncoder().encode(s);
const roundTrip = async (cad, opts) => {
  const pkg = E.simbotFromCad(cad, Object.assign({ created: '2026-10-03T00:00:00Z' }, opts));
  const bytes = await E.simbotPack(pkg);
  const back = await E.simbotUnpack(bytes);
  assert.ok(back.ok, back.error);
  return { pkg, bytes, back, robot: E.cadFromSimbot(back.pkg) };
};

test('zip: the CRC is the standard one', () => {
  assert.equal(E.sbCrc32(enc('123456789')), 0xCBF43926);
});

test('zip: files come back byte for byte, compressed or stored, and the same input zips to the same bytes', async () => {
  const big = enc('lift '.repeat(5000)), small = new Uint8Array([1, 2, 3, 250]);
  const files = [{ name: 'a/big.txt', data: big }, { name: 'small.bin', data: small }];
  const z1 = await E.zipWrite(files), z2 = await E.zipWrite(files);
  assert.deepEqual(z1, z2, 'deterministic');
  assert.ok(z1.length < big.length / 10, 'the text was deflated: ' + z1.length);
  const back = await E.zipRead(z1);
  assert.deepEqual(back.get('a/big.txt'), big);
  assert.deepEqual(back.get('small.bin'), small);
  const stored = await E.zipRead(await E.zipWrite(files, { deflate: false }));
  assert.deepEqual(stored.get('a/big.txt'), big);
});

test('zip: unsafe names, damage, bombs and oversize archives are refused', async () => {
  const z = async (name, data) => E.zipWrite([{ name, data: data || enc('x') }]);
  await assert.rejects(E.zipRead(await z('../evil.json')), /unsafe name/);
  await assert.rejects(E.zipRead(await z('/abs.json')), /unsafe name/);
  await assert.rejects(E.zipRead(await z('C:\\x.json')), /unsafe name/);
  const ok = await E.zipWrite([{ name: 'a.txt', data: enc('hello hello hello hello hello hello hello hello hello hello hello hello') }]);
  // flip a byte of the compressed data: the checksum (or the inflater) catches it
  const broken = ok.slice(); broken[30 + 'a.txt'.length + 2] ^= 0xff;
  await assert.rejects(E.zipRead(broken));
  // a file that says it unpacks to 10 bytes but holds far more is stopped at 10
  const bomb = await E.zipWrite([{ name: 'b.txt', data: new Uint8Array(100000) }]);
  const dv = new DataView(bomb.buffer);
  const cd = dv.getUint32(bomb.length - 6, true);
  dv.setUint32(22, 10, true); dv.setUint32(cd + 24, 10, true);
  await assert.rejects(E.zipRead(bomb), /bigger than the package says/);
  await assert.rejects(E.zipRead(ok, { zipBytes: 10 }), /limit/);
  await assert.rejects(E.zipRead(enc('not a zip at all, just words')), /isn't a robot package/);
});

test('glb: meshes, indices and node placements survive, and bad indices are refused', () => {
  const glb = E.glbWrite({ meshes: [{ pos: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], idx: [0, 1, 2, 1, 3, 2], material: 0 }],
    materials: [{ color: [1, 0.5, 0] }], nodes: [{ name: 'p', mesh: 0, matrix: [1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7, 0, 0, 0, 1] }], scene: [0] });
  const g = E.glbRead(glb);
  assert.deepEqual(Array.from(g.meshes[0].pos), [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  assert.deepEqual(Array.from(g.meshes[0].idx), [0, 1, 2, 1, 3, 2]);
  assert.deepEqual(g.json.nodes[0].matrix.slice(12, 15), [5, 6, 7], 'glTF matrices are column-major');
  const evil = E.glbWrite({ meshes: [{ pos: [0, 0, 0, 1, 0, 0, 0, 1, 0], idx: [0, 1, 9] }], materials: [], nodes: [{ mesh: 0 }], scene: [0] });
  assert.throws(() => E.glbRead(evil), /indexes past its points/);
});

test('package: an Onshape robot comes back with the same parts, joints, limits, couplings and mass', async () => {
  const cad = onshapeCad();
  const { pkg, robot } = await roundTrip(cad, { map: { liftMotor: 'Lift Stage', armServo: 'Arm Pivot' } });
  const back = robot.cad;
  assert.equal(pkg.manifest.format, 'ftc-simbench.robot');
  assert.equal(back.solids.length, cad.solids.length);
  assert.equal(back.source, 'onshape');
  assert.equal(back.mates.exact, true, 'joints read from mates stay exact');
  for (const m of cad.mechs.filter((x) => !x.drive)) {
    const b = back.mechs.find((x) => x.id === m.id);
    assert.ok(b, m.id + ' came back');
    assert.equal(b.kind, m.kind, m.id);
    assert.ok(near(b.axis, m.axis, 1e-5), m.id + ' axis');
    assert.ok(near(b.pivot, m.pivot, 1e-6), m.id + ' pivot');
    if (m.limits) assert.ok(near(b.limits, m.limits, 1e-6), m.id + ' limits ' + b.limits + ' vs ' + m.limits);
    assert.deepEqual(back.solids.filter((s) => s.mech === m.id).map((s) => s.name).sort(), cad.solids.filter((s) => s.mech === m.id).map((s) => s.name).sort(), m.id + ' carries');
    if (m.couple) { assert.equal(b.couple.to, m.couple.to); assert.equal(b.couple.via, m.couple.via); assert.ok(Math.abs(b.couple.ratio - m.couple.ratio) < 1e-9); }
  }
  assert.ok(Math.abs(E.massProps(back).kg - E.massProps(cad).kg) < 1e-6, 'the CAD masses came along');
  assert.ok(near(back.bbox.min, cad.bbox.min, 1e-5) && near(back.bbox.max, cad.bbox.max, 1e-5), 'same size and place');
  assert.deepEqual(robot.map, { armServo: 'Arm Pivot', liftMotor: 'Lift Stage' }, 'the bindings');
  for (const s of back.solids) assert.ok(s.tri.pos.length >= 9 && s.tri.pos.length === s.tri.nor.length && s.keepTri);
  assert.ok(back.solids.some((s) => s.color), 'colours from the CAD');
});

test('package: copies of one shape are one mesh in the glb', async () => {
  const cad = onshapeCad();
  const { pkg, back } = await roundTrip(cad);
  const shapes = new Set(cad.solids.map((s) => s.inst.key)).size;
  assert.ok(pkg.manifest.meshes <= shapes, pkg.manifest.meshes + ' meshes for ' + shapes + ' shapes');
  assert.equal(back.pkg.gltf.meshes.length, pkg.manifest.meshes);
});

test('package: a loop-closing mate travels as a constraint and comes back pinned at the same point', async () => {
  const p = payload();
  const arm = p.asm.rootAssembly.features.find((f) => f.featureData && f.featureData.name === 'Arm Pivot');
  const twin = JSON.parse(JSON.stringify(arm)); twin.id = 'F3b'; twin.featureData.name = 'Arm Pivot 2';
  p.asm.rootAssembly.features.push(twin);
  const cad = E.cadFromOnshape(p);
  const { pkg, robot } = await roundTrip(cad);
  const loop = pkg.joints.constraints.find((c) => c.type === 'loop');
  assert.ok(loop, JSON.stringify(pkg.joints.constraints));
  assert.equal(robot.cad.loops.length, 1);
  assert.ok(near(robot.cad.loops[0].point, cad.loops[0].point, 1e-6));
  assert.equal(robot.cad.loops[0].a, cad.loops[0].a);
});

test('package: a STEP robot with no joints says so, and still comes back whole', async () => {
  const cad = E.parseSTEP(fixture('robots/mecanum-zup.step'));
  const { pkg, robot } = await roundTrip(cad);
  assert.equal(pkg.joints.auto, true, 'no joints read from the CAD: a draft');
  assert.ok(pkg.manifest.validation.items.some((i) => i.code === 'draft'));
  assert.equal(robot.cad.solids.length, cad.solids.length);
  assert.equal(robot.cad.mates.exact, false);
});

test('package: a URDF robot keeps its mimic as a coupling', async () => {
  const urdf = `<robot name="u"><link name="b"><visual><geometry><box size="0.4 0.36 0.05"/></geometry></visual><inertial><mass value="8"/></inertial></link>
    <link name="arm"><visual><origin xyz="0.12 0 0"/><geometry><box size="0.24 0.02 0.02"/></geometry></visual><inertial><mass value="0.5"/></inertial></link>
    <link name="claw"><visual><geometry><box size="0.04 0.06 0.02"/></geometry></visual></link>
    <joint name="arm" type="revolute"><parent link="b"/><child link="arm"/><origin xyz="0 0 0.3"/><axis xyz="0 1 0"/><limit lower="-1.5" upper="1.2"/></joint>
    <joint name="claw" type="revolute"><parent link="arm"/><child link="claw"/><origin xyz="0.25 0 0"/><axis xyz="0 0 1"/><limit lower="0" upper="1"/><mimic joint="arm" multiplier="-0.5"/></joint></robot>`;
  const cad = E.cadFromUrdf(urdf, {});
  const { robot } = await roundTrip(cad);
  const claw = robot.cad.mechs.find((m) => m.id === 'claw');
  assert.equal(claw.couple.to, 'arm');
  assert.ok(Math.abs(claw.couple.ratio + 0.5) < 1e-9);
  assert.equal(robot.cad.source, 'urdf');
});

test('package: validation names what to check: no limits, no mass, no device', () => {
  const cad = onshapeCad();
  cad.mechs.find((m) => m.id === 'Claw').limits = null;
  cad.solids[0].kg = 0;
  const v = E.validateRobot(cad, { devices: [{ name: 'lift', type: 'DcMotorEx', cfg: 'lift' }], map: { lift: 'Lift Stage' } });
  const codes = v.items.map((i) => i.code);
  assert.ok(codes.includes('no-limits'), codes.join());
  assert.ok(codes.includes('no-mass'));
  assert.ok(v.items.some((i) => i.code === 'no-device' && i.joint === 'Arm Pivot'));
  assert.ok(!v.items.some((i) => i.code === 'no-device' && i.joint === 'Lift Stage'), 'a driven joint is fine');
  assert.ok(!v.items.some((i) => i.code === 'no-device' && i.joint === 'Lift Carriage'), 'a follower is driven through its leader');
});

test('package: hostile packages are refused with a reason, never thrown', async () => {
  const cad = onshapeCad();
  const pkg = E.simbotFromCad(cad, {});
  const repack = (mut) => { const p = JSON.parse(JSON.stringify({ manifest: pkg.manifest, joints: pkg.joints, bindings: pkg.bindings, mass: pkg.mass })); mut(p); return E.simbotPack(Object.assign(p, { glb: pkg.glb })); };
  let r = await E.simbotUnpack(await repack((p) => { p.manifest.version = 99; }));
  assert.equal(r.ok, false); assert.equal(r.detail, 'future-version');
  r = await E.simbotUnpack(await repack((p) => { p.manifest.format = 'something-else'; }));
  assert.equal(r.detail, 'not-simbot');
  r = await E.simbotUnpack(await repack((p) => { p.joints.format = 'nope'; }));
  assert.equal(r.detail, 'bad-joints');
  r = await E.simbotUnpack(await E.zipWrite([{ name: 'manifest.json', data: '{"format":"ftc-simbench.robot","version":1,' + '['.repeat(500) }]));
  assert.equal(r.ok, false);
  r = await E.simbotUnpack(new Uint8Array([1, 2, 3]));
  assert.equal(r.ok, false); assert.equal(r.detail, 'not-zip');
  // a __proto__ key in a binding can't reach Object.prototype
  r = await E.simbotUnpack(await repack((p) => { p.bindings.devices.push({ name: '__proto__', joint: 'Lift Stage' }); }));
  assert.ok(r.ok);
  E.cadFromSimbot(r.pkg);
  assert.equal(({}).joint, undefined);
});

test('package: the same robot always packs to the same bytes', async () => {
  const a = await E.simbotPack(E.simbotFromCad(onshapeCad(), { created: 'x' }));
  const b = await E.simbotPack(E.simbotFromCad(onshapeCad(), { created: 'x' }));
  assert.deepEqual(a, b);
});

test('package: the robot check calls a package made from mates exact, and a drafted one a draft', async () => {
  const exact = (await roundTrip(onshapeCad())).robot.cad;
  const src = (cad) => E.checkRobot(cad, null, {}, {}).items.find((i) => i.key === 'source');
  assert.equal(src(exact).sev, 'ok');
  assert.match(src(exact).text, /robot package/);
  const draft = (await roundTrip(E.parseSTEP(fixture('robots/mecanum-zup.step')))).robot.cad;
  assert.equal(src(draft).sev, 'note', 'a draft is still asked about');
});
