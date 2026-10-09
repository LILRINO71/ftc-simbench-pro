// Fixes found reviewing the CAD import path against the robot-package design
// (docs/robot-package.md): masses the CAD carries reach the physics, a saved
// workspace keeps where its joints came from, onshape-to-robot's mate names
// are read, and what a person should check comes back as data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');
const payload = () => JSON.parse(JSON.stringify({ name: 'Mated Robot', asm: R.onshape.assembly, features: R.onshape.features, geom: R.onshape.geom }));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// every mate feature, in the root and in each subassembly
const mateFeatures = (asm) => [asm.rootAssembly, ...(asm.subAssemblies || [])].flatMap((a) => a.features || []);

test('mass: the physics weighs a robot by the masses Onshape sent, not by hull estimates', () => {
  const cad = E.cadFromOnshape(payload());
  const props = E.massProps(cad);
  // before the fix every part was re-estimated from its convex hull and a fill factor
  assert.ok(Math.abs(props.kg - R.truth.massKg) < 1e-3, 'massProps ' + props.kg + ' vs Onshape ' + R.truth.massKg);
  const one = cad.solids.find((s) => s.kg > 0);
  const pm = E.partMass(one);
  assert.equal(pm.how, 'cad');
  assert.equal(pm.kg, one.kg);
  // and an estimate is still what a part with no mass of its own gets
  assert.notEqual(E.partMass({ name: 'plate', kind: 'metal', pts: one.pts }).how, 'cad');
});

test('session: a robot whose joints came from a joint spec reloads as a joint spec, not as exact Onshape mates', () => {
  const cad = E.cadFromOnshape(payload());
  const spec = E.specFromCad(cad, cad.solids.map((s) => s.mech || 'chassis'), {});
  spec.auto = true;                                // drafted by the automatic finder
  E.applyJointSpec(cad, spec);
  assert.equal(cad.mates.source, 'spec');
  const text = E.packSession(E.sessionFromBench({ cad }));
  const back = E.unpackSession(text);
  assert.ok(back.ok, back.error);
  const m = back.session.cad.mates;
  assert.equal(m.source, 'spec', 'the source survives the round trip');
  assert.equal(m.auto, true, 'a drafted robot stays a draft');
  assert.equal(back.session.cad.source, 'onshape', 'the robot still says where its parts came from');
});

test('joint spec: a mate joint flipped with the rig panel\'s ± stays flipped when its spec is written', () => {
  const cad = E.cadFromOnshape(payload());
  const arm = cad.mechs.find((m) => m.id === 'Arm Pivot'), lift = cad.mechs.find((m) => m.id === 'Lift Stage');
  arm.dir = -1; lift.dir = -1;                   // the rig panel's ± on both
  const spec = E.specFromCad(cad, cad.solids.map((s) => s.mech || 'chassis'), {});
  const again = E.cadFromOnshape(payload());
  E.applyJointSpec(again, spec);
  const by = (id) => again.mechs.find((m) => m.id === id);
  for (const revs of [0.05, -0.05, 0.6, -0.6]) {
    const s = { kind: 'motor', revs, ticks: revs * 537.7, tpr: 537.7, act: 0, restPos: 0 };
    assert.ok(Math.abs(E.mateJointQ(by('Arm Pivot'), s) - E.mateJointQ(arm, s)) < 1e-5,   // a written spec rounds its limits
      'arm at ' + revs + ' turns: ' + E.mateJointQ(by('Arm Pivot'), s) + ' vs ' + E.mateJointQ(arm, s));
    assert.ok(Math.abs(E.mateJointQ(by('Lift Stage'), s) - E.mateJointQ(lift, s)) < 1e-5, 'lift at ' + revs + ' turns');
  }
  // and an unflipped joint writes no dir at all
  assert.equal(spec.joints.find((j) => j.id === 'Claw').dir, undefined);
});

test('session: part masses and colours from the CAD survive a save', () => {
  const cad = E.cadFromOnshape(payload());
  const back = E.unpackSession(E.packSession(E.sessionFromBench({ cad }))).session.cad;
  const withKg = cad.solids.filter((s) => s.kg > 0).length;
  assert.ok(withKg > 0);
  assert.equal(back.solids.filter((s) => s.kg > 0).length, withKg);
  assert.ok(Math.abs(E.massProps(back).kg - R.truth.massKg) < 1e-3, 'the reloaded robot weighs the same');
  assert.ok(back.solids.every((s, i) => !cad.solids[i].color || (s.color && s.color.length === 3)));
});

test('session: a colour that is not three numbers is refused, not drawn as garbage', () => {
  const cad = E.cadFromOnshape(payload());
  const raw = JSON.parse(E.packSession(E.sessionFromBench({ cad })));
  raw.cad.solids[0].color = ['red', 0, 0];
  const r = E.unpackSession(JSON.stringify(raw));
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'bad-number');
});

test('mates: onshape-to-robot names: dof_<name> names the joint, _inv turns its axis and its travel round', () => {
  const p = payload();
  const lift = mateFeatures(p.asm).find((f) => f.featureData && f.featureData.name === 'Lift Stage');
  lift.featureData.name = 'dof_lift_inv';
  const plain = E.cadFromOnshape(payload()).mechs.find((m) => m.id === 'Lift Stage');
  const cad = E.cadFromOnshape(p);
  const m = cad.mechs.find((x) => x.id === 'lift');
  assert.ok(m, 'the joint is called lift: ' + cad.mechs.map((x) => x.id).join(', '));
  assert.ok(dot(m.axis, plain.axis) < -0.9999, 'axis turned round');
  assert.deepEqual(m.limits.map((v) => +v.toFixed(4)), plain.limits.slice().reverse().map((v) => +(-v).toFixed(4) || 0));
  assert.equal(m.alias, 'dof_lift_inv', 'the mate keeps its own name for matching');
});

test('mates: an _inv mate in a relation: the follower still moves the way Onshape moves it', () => {
  const plain = E.cadFromOnshape(payload());
  const by = (cad, name) => cad.mechs.find((m) => m.fromMate && m.fromMate.name === name);
  // the physical motion of the carriage per metre of the stage: its axis times its ratio, along the stage's axis
  const along = (cad, stage, car) => { const s = by(cad, stage), c = by(cad, car); return dot(c.axis, s.axis) * c.couple.ratio; };
  const want = along(plain, 'Lift Stage', 'Lift Carriage');
  assert.ok(Math.abs(want - 1) < 1e-9, 'plain: the carriage rides up with the stage');
  for (const [stage, car] of [['Lift Stage', 'dof_carriage_inv'], ['dof_lift_inv', 'Lift Carriage'], ['dof_lift_inv', 'dof_carriage_inv']]) {
    const p = payload();
    for (const f of mateFeatures(p.asm)) {
      if (f.featureData && f.featureData.name === 'Lift Stage') f.featureData.name = stage;
      if (f.featureData && f.featureData.name === 'Lift Carriage') f.featureData.name = car;
    }
    const cad = E.cadFromOnshape(p);
    assert.ok(by(cad, car).couple, car + ' follows ' + stage);
    assert.ok(Math.abs(along(cad, stage, car) - want) < 1e-9, stage + ' / ' + car + ': ratio ' + by(cad, car).couple.ratio);
  }
});

test('mapping: a device named exactly as its mate wins over a looser match', () => {
  const cad = E.cadFromOnshape(payload());
  const devs = [
    { name: 'liftMotor', type: 'DcMotorEx', cfg: 'liftMotor' },
    { name: 'lift_stage', type: 'DcMotorEx', cfg: 'lift_stage' },
  ];
  const map = E.autoMap(devs, cad.mechs.filter((m) => !m.drive), { cad });
  assert.equal(map.lift_stage, 'Lift Stage', 'the exact name, not the first device with "lift" in it');
});

test('mates: a relation that names a mate the bench does not simulate is reported, not silently dropped', () => {
  const p = payload();
  p.asm.rootAssembly.features.push({ id: 'R9', suppressed: false, featureType: 'mateRelation',
    featureData: { name: 'Gear 9', relationType: 'GEAR', mates: [{ featureId: 'F3' }, { featureId: 'NOPE' }], relationRatio: 2, reverseDirection: false } });
  const cad = E.cadFromOnshape(p);
  const issue = cad.mates.issues.find((i) => i.code === 'relation-dangling');
  assert.ok(issue, JSON.stringify(cad.mates.issues));
  assert.match(issue.text, /Gear 9/);
});

test('mates: a subassembly used twice: each copy\'s relation couples its own joints, and each copy gets its limits', () => {
  const p = payload(), root = p.asm.rootAssembly;
  // a second lift, 250 mm to the side, bolted to the frame the way the first is
  const lift = root.instances.find((i) => /^Lift/.test(i.name));
  root.instances.push(Object.assign({}, lift, { id: 'ILIFT2', name: 'Lift <2>' }));
  for (const o of root.occurrences.filter((x) => x.path[0] === lift.id)) {
    const c = JSON.parse(JSON.stringify(o)); c.path[0] = 'ILIFT2'; c.transform[7] += 0.25; root.occurrences.push(c);
  }
  const bolt = JSON.parse(JSON.stringify(root.features.find((f) => f.featureData.name === 'Fastened 1')));
  bolt.id = 'F0b'; bolt.featureData.name = 'Fastened 1b';
  for (const e of bolt.featureData.matedEntities) if (e.matedOccurrence[0] === lift.id) e.matedOccurrence[0] = 'ILIFT2';
  root.features.push(bolt);
  const cad = E.cadFromOnshape(p);
  const copyOf = (m) => cad.solids.find((s) => s.mech === m.id).osPath.split('/')[0];
  const stages = cad.mechs.filter((m) => m.fromMate && m.fromMate.name === 'Lift Stage');
  const carriages = cad.mechs.filter((m) => m.fromMate && m.fromMate.name === 'Lift Carriage');
  assert.equal(stages.length, 2); assert.equal(carriages.length, 2);
  assert.deepEqual(new Set(carriages.map(copyOf)), new Set([lift.id, 'ILIFT2']), 'one carriage in each copy');
  for (const c of carriages) {
    assert.ok(c.couple, c.id + ' follows its stage');
    const s = stages.find((x) => x.id === c.couple.to);
    assert.ok(s, c.id + ' follows ' + c.couple.to);
    assert.equal(copyOf(s), copyOf(c), c.id + ' follows the stage in its own copy');
  }
  for (const s of stages) assert.deepEqual(s.limits && s.limits.map((v) => +v.toFixed(6)), [0, 0.28], s.id + ' has its limits');
  assert.ok(!cad.mates.issues.some((i) => i.code === 'relation-dangling'), JSON.stringify(cad.mates.issues));
});

test('onshape: each part\'s placement (occT) holds its axes the way the STEP parser does, so a reader lines parts up by it', () => {
  const p = payload();
  // the robot turned 90 degrees, so no part's turn is its own transpose
  for (const o of p.asm.rootAssembly.occurrences) {
    const T = o.transform;
    o.transform = [-T[4], -T[5], -T[6], -T[7], T[0], T[1], T[2], T[3], T[8], T[9], T[10], T[11], 0, 0, 0, 1];
  }
  const cad = E.cadFromOnshape(p);
  const T = new Map(p.asm.rootAssembly.occurrences.map((o) => [o.path.join('/'), o.transform]));
  for (const s of cad.solids) {
    const M = T.get(s.osPath);
    // r[k] is the part's own k axis in the world: column k of Onshape's row-major 4x4
    const same = (a, b) => a.length === 3 && a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
    for (let k = 0; k < 3; k++) assert.ok(same(s.occT.r[k], [M[k], M[4 + k], M[8 + k]]), s.name + ' axis ' + k + ': ' + s.occT.r[k]);
    assert.ok(same(s.occT.t, [M[3], M[7], M[11]]));
  }
  // matching by placement (what a STEP import does) finds every part
  for (const s of cad.solids) delete s.osPath;
  const A = E.parseOnshapeAssembly(p.asm);
  const { map } = E.matchOnshapeParts(A, cad, []);
  assert.equal(map.size, A.parts.length);
});

test('mates: a mate that closes a loop is kept as a loop closure with the point it pins', () => {
  const p = payload();
  const arm = p.asm.rootAssembly.features.find((f) => f.featureData && f.featureData.name === 'Arm Pivot');
  const twin = JSON.parse(JSON.stringify(arm));
  twin.id = 'F3b'; twin.featureData.name = 'Arm Pivot 2';
  p.asm.rootAssembly.features.push(twin);
  const cad = E.cadFromOnshape(p);
  assert.equal(cad.loops.length, 1);
  const L = cad.loops[0];
  const pivot = cad.mechs.find((m) => m.id === 'Arm Pivot').pivot;
  assert.ok(Math.hypot(L.point[0] - pivot[0], L.point[1] - pivot[1], L.point[2] - pivot[2]) < 1e-6, 'pinned where the mate is');
  assert.ok([L.a, L.b].includes('Arm Pivot'), 'between the arm and what it hangs from: ' + L.a + ' / ' + L.b);
  assert.ok(cad.mates.issues.some((i) => i.code === 'loop'));
});
