// Every actuator in src/hardware.js against the vendor's own product page.
// The table below was read off those pages on 2026-11-19 (goBILDA product pages,
// REV docs); each row says the voltage the vendor quotes it at. Torques are
// published in kg.cm (goBILDA, REV servo) or N.m (REV motors); 1 kg.cm = 0.0980665 N.m.
// A part the sim knows must match its row within 2%; a row the sim lacks fails too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const KGCM = 0.0980665;

// goBILDA 5203 Yellow Jacket, all at 12 V: 9.2 A stall, 0.25 A no-load on every ratio
const YJ = {
  '0001': [1, 6000, 1.47, 28], '0003': [3.7, 1620, 5.4, 103.8], '0005': [5.2, 1150, 7.9, 145.1],
  '0014': [13.7, 435, 18.7, 384.5], '0019': [19.2, 312, 24.3, 537.7], '0027': [26.9, 223, 38.0, 751.8],
  '0051': [50.9, 117, 68.4, 1425.1], '0071': [71.2, 84, 93.6, 1993.6], '0100': [99.5, 60, 133.2, 2786.2],
  '0139': [139, 43, 185, 3895.9], '0188': [188, 30, 250, 5281.1],
};
const MOTORS = {
  'REV-41-1291': { rpm: 6000, stallNm: 0.105, stallA: 8.5, freeA: 0.4, ratedV: 12, tpr: 28 },   // HD Hex, bare
  'REV-41-1300': { rpm: 125, stallNm: 3.2, stallA: 4.4, ratedV: 12, tpr: 288 },                 // Core Hex: REV publishes no free current
};
for (const [code, [ratio, rpm, kgcm, tpr]] of Object.entries(YJ)) {
  MOTORS['5203-2402-' + code] = { ratio, rpm, stallNm: kgcm * KGCM, stallA: 9.2, freeA: 0.25, ratedV: 12, tpr };
}
// servos: stall torque and seconds per 60 degrees at 6 V (the column every one of these vendors publishes)
const SERVOS = {
  '2000-0025-0002': { role: 'Torque', stallNm: 21.6 * KGCM, sec60: 0.20, travelDeg: 300, stallA: 2.5, freeA: 0.16 },
  '2000-0025-0003': { role: 'Speed', stallNm: 9.3 * KGCM, sec60: 0.09, travelDeg: 300, stallA: 2.5, freeA: 0.2 },
  '2000-0025-0004': { role: 'Speed', stallNm: 4.7 * KGCM, sec60: 0.043, travelDeg: 300, stallA: 2.5, freeA: 0.2 },
  '2000-0025-0502': { role: 'Torque', stallNm: 21.6 * KGCM, sec60: 0.20, travelDeg: 1800 },
  '2000-0025-0503': { role: 'Speed', stallNm: 9.3 * KGCM, sec60: 0.09, travelDeg: 1800 },
  '2000-0025-0504': { role: 'Speed', stallNm: 4.7 * KGCM, sec60: 0.043, travelDeg: 1800 },
  'REV-41-1097': { stallNm: 13.5 * KGCM, sec60: 0.13, travelDeg: 270, stallA: 2.0 },          // Smart Robot Servo
};
// goBILDA's 4.8 V column, for whoever runs a servo off a 5 V hub port
const SERVO_4V8 = {
  '2000-0025-0002': { stallNm: 17.2 * KGCM, sec60: 0.25 }, '2000-0025-0003': { stallNm: 7.9 * KGCM, sec60: 0.11 },
  '2000-0025-0004': { stallNm: 4.0 * KGCM, sec60: 0.055 },
};

const within = (got, want, tol, what) =>
  assert.ok(Number.isFinite(got) && Math.abs(got - want) <= tol * Math.abs(want), `${what}: ${got}, the vendor says ${want}`);

test('hardware: every motor matches its vendor page (torque, speed, counts, stall and free current)', () => {
  for (const [pn, v] of Object.entries(MOTORS)) {
    const s = E.hwFromPart(pn, '');
    assert.ok(s && s.kind === 'motor', pn + ' is a known motor');
    within(s.stallNm, v.stallNm, 0.02, pn + ' stallNm');
    assert.equal(s.rpm, v.rpm, pn + ' rpm');
    assert.equal(s.tpr, v.tpr, pn + ' tpr');
    within(s.stallA, v.stallA, 0.02, pn + ' stallA');
    if (v.freeA != null) within(s.freeA, v.freeA, 0.02, pn + ' freeA');
    assert.equal(s.ratedV, v.ratedV, pn + ' rated voltage');
    assert.match(String(s.source || ''), /^https:\/\//, pn + ' names its page');
  }
});

test('hardware: every servo matches its vendor page, with its role the right way round', () => {
  for (const [pn, v] of Object.entries(SERVOS)) {
    const s = E.hwFromPart(pn, '');
    assert.ok(s && s.kind === 'servo', pn + ' is a known servo');
    within(s.stallNm, v.stallNm, 0.02, pn + ' stallNm');
    within(s.sec60, v.sec60, 0.02, pn + ' sec60');
    assert.equal(s.travelDeg, v.travelDeg, pn + ' travel');
    if (v.role) assert.equal(s.role, v.role, pn + ' role');
    if (v.stallA != null) within(s.stallA, v.stallA, 0.02, pn + ' stallA');
    if (v.freeA != null) within(s.freeA, v.freeA, 0.02, pn + ' freeA');
    assert.equal(s.ratedV, 6, pn + ' quoted at 6 V');
    assert.match(String(s.source || ''), /^https:\/\//, pn + ' names its page');
  }
  for (const [pn, v] of Object.entries(SERVO_4V8)) {
    const s = E.hwFromPart(pn, '');
    assert.ok(s.at4v8, pn + ' carries the 4.8 V column');
    within(s.at4v8.stallNm, v.stallNm, 0.02, pn + ' stallNm at 4.8 V');
    within(s.at4v8.sec60, v.sec60, 0.02, pn + ' sec60 at 4.8 V');
  }
  // goBILDA makes no 25-1 or 25-5 in this line
  for (const pn of ['2000-0025-0001', '2000-0025-0005']) assert.equal(E.HW_PARTS[pn], undefined, pn + ' is not a goBILDA part');
});

test('hardware: every motor spec the sim can be handed carries stallA and freeA', () => {
  const motors = [];
  for (const pn in E.HW_PARTS) if (E.HW_PARTS[pn].kind === 'motor') motors.push([pn, E.hwFromPart(pn, '')]);
  for (const code of Object.keys(YJ)) for (const series of ['5202', '5203', '5204']) {
    const pn = series + '-' + (series === '5204' ? '8002' : '2402') + '-' + code;
    motors.push([pn, E.hwFromPart(pn, '')]);
  }
  motors.push(['GENERIC.Motor', E.GENERIC.Motor]);
  motors.push(['an unknown Yellow Jacket ratio', E.hwFromPart('5203-2402-0999', '')]);
  motors.push(['a motor named in the CAD', E.hwFromPart(null, 'Drive Motor')]);
  const dev = (type, intent) => ({ name: 'm', type, intent });
  motors.push(['a declared DcMotor', E.specFor(dev('DcMotorEx'), null, 'code')]);
  motors.push(['// 435 rpm', E.specFor(dev('DcMotor', '// 435 rpm goBILDA'), null, 'code')]);
  motors.push(['// 500 rpm (no such Yellow Jacket)', E.specFor(dev('DcMotor', '// 500 rpm'), null, 'code')]);
  for (const [what, s] of motors) {
    assert.ok(s, what + ' resolves');
    assert.ok(s.stallA > 0 && Number.isFinite(s.stallA), `${what}: stallA ${s.stallA}`);
    assert.ok(s.freeA > 0 && s.freeA < s.stallA, `${what}: freeA ${s.freeA}`);
    assert.ok(s.ratedV > 0, `${what}: ratedV ${s.ratedV}`);
  }
  // the CAD's part through specFor keeps the vendor's figures
  const cad = E.specFor(dev('DcMotorEx'), { part: '5203-2402-0019' }, 'cad');
  assert.equal(cad.stallA, 9.2); assert.equal(cad.freeA, 0.25);
});

test('hardware: a motor named only by its speed keeps the 5203 motor\'s power, not the 312 rpm torque', () => {
  const s = E.specFor({ name: 'm', type: 'DcMotor', intent: '// 500 rpm' }, null, 'code');
  assert.equal(s.rpm, 500);
  const yj312 = E.hwFromPart('5203-2402-0019', '');
  within(s.stallNm * s.rpm, yj312.stallNm * yj312.rpm, 0.01, 'stall torque x free speed');
});

test('hardware: a declared Torque or Speed servo picks that goBILDA variant', () => {
  const pick = (role) => E.specFor({ name: 's', type: 'Servo', declaredRole: role }, { part: '2000-0025-0002' }, 'code');
  assert.equal(pick('Torque').part, '2000-0025-0002');
  assert.equal(pick('Speed').part, '2000-0025-0003');
  // the generic servos are real parts' figures
  within(E.GENERIC.Torque.stallNm, SERVOS['2000-0025-0002'].stallNm, 0.02, 'GENERIC.Torque');
  within(E.GENERIC.Speed.sec60, SERVOS['2000-0025-0003'].sec60, 0.02, 'GENERIC.Speed');
});

test('hardware: a 5-turn servo in the CAD stays a 5-turn servo whichever flavour the code declares', () => {
  const pick = (part, role) => E.specFor({ name: 'arm', type: 'Servo', declaredRole: role }, { part, partName: '' }, 'code');
  // the 5-turn 2000s share their first ten characters (2000-0025-) with the standard ones
  for (const [part, role, want] of [
    ['2000-0025-0502', 'Torque', '2000-0025-0502'], ['2000-0025-0502', 'Speed', '2000-0025-0503'],
    ['2000-0025-0503', 'Torque', '2000-0025-0502'], ['2000-0025-0503', 'Speed', '2000-0025-0503'],
    ['2000-0025-0504', 'Torque', '2000-0025-0502'],
    ['2000-0025-0002', 'Speed', '2000-0025-0003'], ['2000-0025-0003', 'Torque', '2000-0025-0002'],
  ]) {
    const s = pick(part, role);
    assert.equal(s.part, want, `CAD ${part}, code says ${role}: got ${s.part} (${s.fam})`);
    assert.equal(s.travelDeg, E.HW_PARTS[part].travelDeg, `CAD ${part}, code says ${role}: travel ${s.travelDeg} deg`);
  }
  // a part with no variant of that role and travel falls back to the generic servo of the role, as before
  const rev = pick('REV-41-1097', 'Speed');
  assert.equal(rev.fam, 'generic speed servo');
});
