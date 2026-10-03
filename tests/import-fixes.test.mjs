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
