// The size rules swept across every joint's travel (src/robotcheck.js robotSize) and goBILDA/REV
// part numbers (src/partsdb.js), on synthetic robots whose answers are known by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const IN = 0.0254;

// ---------------- the size rules ----------------
const box = (x0, x1, y0, y1, z0, z1) => { const p = []; for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) p.push([x, y, z]); return p; };
const solid = (name, pts, mech) => ({ name, kind: 'struct', pts, mech });
// a 15 x 15 in frame, 12 in tall, and a slide stage (a bar 0.4 m tall standing on it) that goes up by `travel` m
function slideRobot(travel, extra = {}) {
  const solids = [
    solid('frame', box(-0.19, 0.19, -0.19, 0.19, 0, 0.30)),
    solid('stage', box(-0.03, 0.03, -0.03, 0.03, 0.30, 0.70), 'slide'),
  ];
  const mechs = [Object.assign({ id: 'slide', label: 'Lift', kind: 'linear', axis: [0, 0, 1], pivot: [0, 0, 0.3], limits: [0, travel], fromMate: true, parent: null }, extra)];
  return { solids, mechs, bbox: { min: [-0.19, -0.19, 0], max: [0.19, 0.19, 0.70] }, parts: [] };
}

test('size: a slide that only breaks the 29 in height at full travel is caught, with the joint value', () => {
  // 29 in = 0.7366 m. The stage top is at 0.70 m at the start: 27.6 in. Travel 0.05 m: 0.75 m = 29.5 in, 0.5 in over; halfway (0.725) fits
  const R = E.checkRobot(slideRobot(0.05), null, {}, { swing: false });
  const env = R.items.find((i) => i.key === 'size:env');
  assert.equal(env.size.axis, 'height');
  assert.ok(Math.abs(env.size.over - (0.75 - 29 * IN) / IN) < 0.01, 'over by ' + env.size.over);
  assert.ok(Math.abs(env.size.at[0].value - 0.05) < 1e-9, 'at full travel, 50 mm');
  assert.match(env.text, /height reaches 29\.5 in, 0\.5 in over the 29 in limit, with "Lift" at 50 mm \(its full travel\)/);
  assert.match(env.text, /check the current manual/i);
  const Z = E.robotSize(slideRobot(0.05), { fresh: true });
  assert.ok(Math.abs(Z.joints[0].worstValue - 0.05) < 1e-9 && Math.abs(Z.max.z - 0.75) < 1e-9);
  // the same slide with less travel fits, and says it swept the joint
  const ok = E.checkRobot(slideRobot(0.03), null, {}, { swing: false }).items.find((i) => i.key === 'size:env');
  assert.equal(ok.sev, 'ok'); assert.match(ok.text, /1 joint swept/);
});

test('size: the 18 in starting cube is judged as drawn and with every joint at its start position', () => {
  // a drawn-pose fix: the arm was drawn standing up (18.1 in tall) and starts folded forward by q0 = +90 degrees
  const solids = [solid('frame', box(-0.10, 0.10, -0.10, 0.10, 0, 0.10)), solid('arm', box(-0.10, -0.06, -0.02, 0.02, 0.10, 0.46), 'arm')];
  const cad = { solids, mechs: [{ id: 'arm', label: 'Arm', kind: 'revolute-lift', axis: [0, 1, 0], pivot: [-0.08, 0, 0.10], limits: [-1.6, 0.2], q0: Math.PI / 2, fromMate: true }],
    bbox: { min: [-0.10, -0.10, 0], max: [0.10, 0.10, 0.46] }, parts: [] };
  const Z = E.robotSize(cad, { fresh: true });
  assert.ok(Z.drawn.z > 0.457 && Z.startDiffers);
  assert.ok(Z.start.z < 0.13, 'folded at the start: ' + Z.start.z);
  const c = E.checkRobot(cad, null, {}, { swing: false }).items.find((i) => i.key === 'size:cube');
  assert.equal(c.sev, 'note'); assert.match(c.text, /As drawn the robot is .*over the 18 in starting cube, but with every joint at its start position .* fits/);
  // a robot over the cube at its start position says so
  const wide = { solids: [solid('frame', box(-0.25, 0.25, -0.2, 0.2, 0, 0.2))], mechs: [], bbox: { min: [-0.25, -0.2, 0], max: [0.25, 0.2, 0.2] }, parts: [] };
  const w = E.checkRobot(wide, null, {}, { swing: false }).items.find((i) => i.key === 'size:cube');
  assert.equal(w.size.axis, 'x'); assert.ok(Math.abs(w.size.over - (0.5 - 18 * IN) / IN) < 0.01);
});

test('size: two joints that only break the box together are a note saying so; a follower moves with its leader', () => {
  // frame 0.3 m tall; two telescoping bars, each 0.15 m of travel on its own fits 29 in (0.7366 m); both together do not
  const solids = [solid('frame', box(-0.19, 0.19, -0.19, 0.19, 0, 0.30)), solid('a', box(-0.03, 0.03, -0.03, 0.03, 0.30, 0.50), 'a'), solid('b', box(0.05, 0.09, -0.03, 0.03, 0.30, 0.50), 'b')];
  const lin = (id) => ({ id, label: id, kind: 'linear', axis: [0, 0, 1], pivot: [0, 0, 0.3], limits: [0, 0.2], fromMate: true });
  const cad = { solids, mechs: [lin('a'), lin('b')], bbox: { min: [-0.19, -0.19, 0], max: [0.19, 0.19, 0.5] }, parts: [] };
  // each alone: 0.5 + 0.2 = 0.70 m < 0.7366. Together the heights add only if they stack; here they don't, so it fits
  const fit = E.checkRobot(cad, null, {}, { swing: false }).items.find((i) => i.key === 'size:env');
  assert.equal(fit.sev, 'ok'); assert.match(fit.text, /every combination of their ends/);
  // a follower (a cascade stage riding the first slide at 1:1) adds its travel to the leader's: 0.5 + 0.2 + 0.2 on the one part
  const casc = { solids: [solid('frame', box(-0.19, 0.19, -0.19, 0.19, 0, 0.30)), solid('s2', box(-0.03, 0.03, -0.03, 0.03, 0.30, 0.50), 's2')],
    mechs: [lin('s1'), Object.assign(lin('s2'), { limits: [0, 0.2], couple: { to: 's1', ratio: 1 }, parent: 's1' })], bbox: cad.bbox, parts: [] };
  const Z = E.robotSize(casc, { fresh: true });
  assert.ok(Math.abs(Z.max.z - 0.9) < 1e-9, 'leader 0.2 + follower 0.2 on top of 0.5: ' + Z.max.z);
  assert.equal(Z.worst.axis, 'height');
});

// ---------------- parts by number ----------------
test('parts: goBILDA and REV numbers are read out of part names, and only whole numbers count', () => {
  assert.equal(E.partsParse('5203-2402-0019 Yellow Jacket'), '5203-2402-0019');
  assert.equal(E.partsParse('goBILDA 3614-0014-0096, 96mm wheel'), '3614-0014-0096');
  assert.equal(E.partsParse('REV-41-1291 HD Hex'), 'REV-41-1291');
  assert.equal(E.partsParse('rev-45-1655'), 'REV-45-1655');
  assert.equal(E.partsParse('Part 7'), null); assert.equal(E.partsParse(null), null);
  assert.equal(E.partsParse('12345-2402-0019'), null, 'a longer number is another number');
  assert.equal(E.partsParse('5203-2402-00191'), null);
});

test('parts: motors give their reduction and speed; wheels their kind and diameter; channels their length', () => {
  const m = E.partsLookup('5203-2402-0019');
  assert.equal(m.kind, 'motor'); assert.equal(m.ratio, 19.2); assert.equal(m.rpm, 312); assert.equal(m.tpr, 537.7);
  // goBILDA's page names it "188:1 Ratio" (5281.1 counts); the table's 188.1 was nobody's figure
  assert.equal(E.partsLookup('5202-2402-0188').ratio, 188);
  assert.equal(E.partsLookup('5202-2402-0188').ratio, E.hwFromPart('5202-2402-0188', '').ratio, 'one Yellow Jacket table');
  assert.equal(E.partsLookup('5203-2402-0001').rpm, 6000);
  assert.equal(E.partsLookup('5203-2402-0999'), null, 'a reduction no page lists');
  assert.equal(E.partsLookup('5203-9999-0019'), null, 'the wrong middle group for that series');
  const w = E.partsLookup('3614-0014-0096');
  assert.equal(w.kind, 'wheel'); assert.equal(w.dMm, 96); assert.equal(w.wheelKind, 'traction');
  assert.equal(E.partsLookup('3624-0014-0072').wheelKind, 'omni');
  assert.equal(E.partsWheel('3213-3606-0003').dMm, 140); assert.equal(E.partsWheel('3213-3606-0003').kind, 'mecanum');
  assert.equal(E.partsWheel('3607-0014-0096'), null, 'a disc is not a drive wheel');
  assert.equal(E.partsWheel('1120-0003-0096'), null);
  assert.equal(E.partsWheel('REV-45-1655').dMm, null); assert.deepEqual(E.partsWheel('REV-45-1655').dRange, [75, 78]);
  const ch = E.partsLookup('1120-0009-0240');
  assert.equal(ch.kind, 'channel'); assert.equal(ch.lengthMm, 240);
  assert.equal(E.partsLookup('1120-0009-0999'), null, 'length and holes must agree');
});

test('parts: a mass is given only where the vendor\'s page gives one', () => {
  const g = (pn) => Math.round(E.partsLookup(pn).massKg * 1000);
  assert.equal(g('5203-2402-0019'), 437); assert.equal(g('3213-3606-0002'), 207); assert.equal(g('1120-0003-0096'), 66);
  assert.equal(g('REV-41-1291'), 234); assert.equal(g('REV-41-1300'), 198);
  // recognised, but no page weight in the table: no mass at all, never a guess
  for (const pn of ['5204-8002-0100', '1120-0011-0288', '3213-3606-0001', '3614-0014-0120']) {
    const p = E.partsLookup(pn);
    if (p) { assert.equal(p.massKg, null, pn); assert.equal(p.massKnown, false, pn); }
  }
  assert.equal(E.partsLookup('5204-8002-0100').massKg, null, 'its page gives a number with no unit');
});

test('parts: a CAD\'s parts are listed once per number with how many; wheel part numbers make a part a wheel candidate', () => {
  const cad = { parts: [{ name: 'Yellow Jacket A', part: '5203-2402-0019', n: 2 }, { name: 'YJ B 5203-2402-0019', part: null, n: 2 }, { name: 'Part 4', part: null, n: 6 },
    { name: 'Rhino 3614-0014-0096', part: '3614-0014-0096', n: 4 }] };
  const P = E.partsOfCad(cad);
  assert.deepEqual(P.map((p) => [p.part, p.count]), [['3614-0014-0096', 4], ['5203-2402-0019', 4]].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
  // a solid called "Part 7" with a wheel's number in its part field is a wheel candidate; a 32 mm omni (an intake roller) is not
  assert.equal(E.dtIsWheel({ name: 'Part 7', part: '3614-0014-0096', kind: 'struct' }), true);
  assert.equal(E.dtIsWheel({ name: 'Part 7', part: '3624-4008-0032', kind: 'struct' }), false);
  assert.equal(E.dtIsWheel({ name: 'Part 7', part: '5203-2402-0019', kind: 'motor' }), false);
  assert.equal(E.dtIsWheel({ name: 'Part 7', part: null, kind: 'struct' }), false);
});
