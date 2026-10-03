// Onshape mates the way real assemblies are built: a drivetrain subassembly,
// limits on mates inside subassemblies, a part drawn partway along its slide,
// a mate picked in the other order, a bound left unset, the same subassembly
// used twice. Each test here failed before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');
const copy = (x) => JSON.parse(JSON.stringify(x));
const payload = () => ({ name: 'Mated Robot', asm: copy(R.onshape.assembly), features: copy(R.onshape.features), geom: R.onshape.geom });
const joint = (cad, id) => cad.mechs.find((m) => m.id === id);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

test('a fixed drivetrain subassembly is the chassis, not a wheel', () => {
  // the base parts move into a fixed "Drivetrain" subassembly, its frame
  // fastened together and each wheel on a revolute to its rail
  const p = payload(), A = p.asm, ra = A.rootAssembly;
  const base = ra.instances.filter((i) => i.type === 'Part');
  const cs = () => ({ origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] });
  const mate = (id, name, type, a, b) => ({ id, suppressed: false, featureType: 'mate', featureData: { name, mateType: type, matedEntities: [{ matedOccurrence: [a], matedCS: cs() }, { matedOccurrence: [b], matedCS: cs() }] } });
  const by = (n) => base.find((i) => i.name.startsWith(n)).id;
  const L = by('1120 Series U-Channel 448mm Left'), Rr = by('1120 Series U-Channel 448mm Right');
  const feats = [mate('D1', 'Fastened A', 'FASTENED', L, Rr), mate('D2', 'Fastened B', 'FASTENED', L, by('1120 Series U-Channel 252mm Front')),
    mate('D3', 'Fastened C', 'FASTENED', L, by('1120 Series U-Channel 252mm Back')), mate('D4', 'Fastened D', 'FASTENED', L, by('Pattern Plate'))];
  base.filter((i) => /Wheel/.test(i.name)).forEach((w, k) => feats.push(mate('DW' + k, 'Revolute ' + (k + 1), 'REVOLUTE', /Left/.test(w.name) ? L : Rr, w.id)));
  A.subAssemblies.push({ documentId: 'DOC', elementId: 'EDT', configuration: 'default', fullConfiguration: 'default', documentMicroversion: 'MV', instances: base, features: feats, patterns: [] });
  ra.instances = [{ id: 'IDT', name: 'Drivetrain <1>', type: 'Assembly', suppressed: false, documentId: 'DOC', elementId: 'EDT', configuration: 'default', fullConfiguration: 'default', documentMicroversion: 'MV' }]
    .concat(ra.instances.filter((i) => i.type === 'Assembly'));
  for (const o of ra.occurrences) if (base.some((i) => i.id === o.path[0])) o.path = ['IDT', ...o.path];
  ra.occurrences.push({ path: ['IDT'], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], fixed: true, hidden: false });
  for (const f of ra.features) for (const e of f.featureData.matedEntities || []) if (base.some((i) => i.id === e.matedOccurrence[0])) e.matedOccurrence = ['IDT', ...e.matedOccurrence];
  const cad = E.cadFromOnshape(p);
  const chassis = cad.solids.filter((s) => !s.mech).map((s) => s.name);
  assert.ok(chassis.some((n) => /448mm Left Rail/.test(n)) && chassis.some((n) => /Pattern Plate/.test(n)), 'the frame is the chassis');
  assert.ok(!cad.mechs.some((m) => m.fromMate && /Rail|Wheel|Revolute \d/.test(m.id)), 'no joint pivots the robot on a wheel: ' + cad.mechs.filter((m) => m.fromMate).map((m) => m.id));
  assert.ok(joint(cad, 'Lift Stage') && joint(cad, 'Arm Pivot'), 'the real joints are still there');
});

test('limits on mates inside subassemblies come from each subassembly\'s own features', async () => {
  // Onshape's features call lists one element's own features: serve them that way
  const S = R.onshape.featuresSplit, D = 'DOC', calls = [];
  const was = globalThis.fetch;
  globalThis.fetch = async (u) => {
    calls.push(u);
    const m = /\/api\/(assemblies|partstudios)\/d\/(\w+)\/(\w)\/(\w+)\/e\/(\w+)(\/\w+)?/.exec(u);
    let body = null;
    if (m && m[1] === 'assemblies' && m[6] === '/features') body = m[5] === 'ETOP' ? S.root : S.by[[m[2], m[5], 'default'].join('|')];
    else if (m && m[1] === 'assemblies') body = R.onshape.assembly;
    return body ? { ok: true, status: 200, json: async () => copy(body) } : { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  try {
    const r = await E.onshapeRead('https://cad.onshape.com', { did: D, wvm: 'w', wvmid: 'W', eid: 'ETOP' }, {});
    assert.ok(calls.some((u) => /\/e\/E\d+\/features\?configuration=default/.test(u)), 'asked each subassembly for its features');
    const p = E.checkOnshapePayload({ format: E.ONSHAPE_FORMAT, asm: r.asm, features: r.features, featuresBy: r.featuresBy, geom: R.onshape.geom });
    const cad = E.cadFromOnshape(p);
    for (const [id, lo, hi] of [['Lift Stage', 0, 0.28], ['Lift Carriage', 0, 0.27]]) {
      const j = joint(cad, id);
      assert.ok(j.limits && near(j.limits[0], lo) && near(j.limits[1], hi), id + ' limits ' + JSON.stringify(j.limits));
    }
    assert.ok(joint(cad, 'Claw').limits, 'the claw (in its own subassembly) has its limits');
  } finally { globalThis.fetch = was; }
});

test('a bound left unset is no bound, and expressions Onshape writes are read', () => {
  const p = payload();
  const arm = p.features.features.find((f) => f.message.name === 'Arm Pivot');
  arm.message.parameters = [{ message: { parameterId: 'limitsEnabled', value: true } },
    { message: { parameterId: 'limitRotationMin', isNull: false, nullValue: 'No minimum', expression: '0.0*deg' } },
    { message: { parameterId: 'limitRotationMax', isNull: false, nullValue: '', expression: '90 degrees' } }];
  const j = joint(E.cadFromOnshape(p), 'Arm Pivot');
  assert.ok(j.limits[0] === null && near(j.limits[1], Math.PI / 2), JSON.stringify(j.limits));   // open: null, which survives a saved file (NaN does not)
  assert.ok(near(E.mateQty({ expression: '1/2 in' }), 0.0127));
  assert.ok(near(E.mateQty({ expression: '2 * 25.4 mm' }), 0.0508));
  assert.ok(near(E.mateQty({ expression: '+5 mm' }), 0.005));
  assert.ok(near(E.mateQty({ expression: '12 inches' }), 0.3048));
  assert.ok(Number.isNaN(E.mateQty({ expression: '#armMax' })));
  assert.ok(Number.isNaN(E.mateQty({ expression: '0 deg', isNull: true })));
});

test('limits are travel from where the part is drawn, whichever way round the mate was picked', () => {
  // the stage drawn 0.10 m up its slide: Onshape's limits 0..0.28 m are mate values
  const p = payload();
  const sub = p.asm.subAssemblies.find((s) => s.features.some((f) => f.featureData && f.featureData.name === 'Lift Stage'));
  const m = sub.features.find((f) => f.featureData.name === 'Lift Stage');
  const z = m.featureData.matedEntities[0].matedCS.zAxis;      // the slide's axis, in the first end's part
  const o1 = m.featureData.matedEntities[1].matedCS.origin;   // move the second end's connector down that axis…
  const occ = p.asm.rootAssembly.occurrences.find((o) => o.path.length === 2 && o.path[1] === m.featureData.matedEntities[1].matedOccurrence[0]);
  const T = occ.transform, inv = (v) => [0, 1, 2].map((i) => T[i] * v[0] + T[4 + i] * v[1] + T[8 + i] * v[2]);
  const occ0 = p.asm.rootAssembly.occurrences.find((o) => o.path.length === 2 && o.path[1] === m.featureData.matedEntities[0].matedOccurrence[0]);
  const T0 = occ0.transform, zw = [0, 1, 2].map((i) => T0[4 * i] * z[0] + T0[4 * i + 1] * z[1] + T0[4 * i + 2] * z[2]);
  const d = inv(zw.map((v) => 0.10 * v));                      // …so the drawn stage sits 0.10 m up it
  m.featureData.matedEntities[1].matedCS.origin = o1.map((v, i) => v + d[i]);
  const j = joint(E.cadFromOnshape(p), 'Lift Stage');
  assert.ok(near(j.limits[0], -0.10, 1e-4) && near(j.limits[1], 0.18, 1e-4), 'travel from the drawn pose: ' + JSON.stringify(j.limits));

  // the claw's mate with its ends picked the other way round: Onshape's limits flip, the joint doesn't
  const before = joint(E.cadFromOnshape(payload()), 'Claw');
  const q = payload();
  const s2 = q.asm.subAssemblies.find((s) => s.features.some((f) => f.featureData && f.featureData.name === 'Claw'));
  s2.features.find((f) => f.featureData.name === 'Claw').featureData.matedEntities.reverse();
  for (const prm of q.features.features.find((f) => f.message.name === 'Claw').message.parameters) {
    const pm = prm.message;
    if (/Min$/.test(pm.parameterId)) pm.expression = (-before.limits[1] * 180 / Math.PI) + ' deg';
    else if (/Max$/.test(pm.parameterId)) pm.expression = (-before.limits[0] * 180 / Math.PI) + ' deg';
  }
  const after = joint(E.cadFromOnshape(q), 'Claw');
  const turn = (j, k) => j.limits[k] * Math.sign(j.axis[0] + j.axis[1] + j.axis[2] || 1);
  assert.ok(near(turn(after, 0) + turn(after, 1), turn(before, 0) + turn(before, 1), 1e-6) &&
    near(Math.abs(after.limits[1] - after.limits[0]), Math.abs(before.limits[1] - before.limits[0]), 1e-6),
  'the same stops either way: ' + JSON.stringify([before.axis, before.limits, after.axis, after.limits]));
});

test('a subassembly used twice gets its limits and relations on both copies', () => {
  const p = payload(), ra = p.asm.rootAssembly;
  const lift = ra.instances.find((i) => i.name === 'Lift <1>');
  ra.instances.push(Object.assign({}, lift, { id: 'IpxL2', name: 'Lift <2>' }));
  for (const o of ra.occurrences.filter((o) => o.path[0] === lift.id)) {
    const T = o.transform.slice(); T[7] += 0.25;
    ra.occurrences.push({ ...o, path: ['IpxL2', ...o.path.slice(1)], transform: T });
  }
  const f1 = copy(ra.features.find((f) => f.featureData.name === 'Fastened 1'));
  f1.id = 'F1b'; f1.featureData.name = 'Fastened 1b'; f1.featureData.matedEntities[0].matedOccurrence[0] = 'IpxL2';
  ra.features.push(f1);
  const cad = E.cadFromOnshape(p);
  const stages = cad.mechs.filter((m) => /^Lift (Stage|Carriage)/.test(m.id));
  assert.equal(stages.length, 4, stages.map((m) => m.id).join(', '));
  for (const m of stages) assert.ok(m.limits, m.id + ' has limits');
  for (const m of stages.filter((x) => /Carriage/.test(x.id))) {
    assert.ok(m.couple, m.id + ' follows its stage');
    assert.ok(cad.mechs.find((x) => x.id === m.couple.to && /Stage/.test(x.id)), m.id + ' -> ' + m.couple.to);
  }
  assert.notEqual(stages.filter((x) => /Carriage/.test(x.id))[0].couple.to, stages.filter((x) => /Carriage/.test(x.id))[1].couple.to, 'each carriage follows its own stage');
});
