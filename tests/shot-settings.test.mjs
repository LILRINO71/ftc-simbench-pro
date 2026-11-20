// The Shot tab's settings that come from the team's code: which device is the shooter, which the
// feeder, which motor model the flywheel is, which devices are the intakes and the transfer.
// What the user chose (Shots.cfg.pick) and what is in effect (cfg.shooter, cfg.motorId, ...) are two
// things, and only the first is kept: Shots.adopt works out every value in effect for each OpMode,
// the user's choice where it applies, else the code's. A value filled once used to be kept for good,
// so the next OpMode was flown with the last one's motor and a 98 % shot read as 0 % ("WON'T WORK").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadWithField } from './load.mjs';

const E = loadWithField();
const S = E.Shots;
// the sample shooter OpMode with another rpm in its motor comment, and maybe another name for its flywheel
const java = (rpm, name = 'flywheel') => {
  let s = E.SHOOTER_JAVA.replace(/\/\/ 6000 rpm goBILDA, 1:1 to the flywheel/, `// ${rpm} rpm goBILDA, 1:1 to the flywheel`);
  if (name !== 'flywheel') s = s.replace(/"flywheel"/g, `"${name}"`).replace(/\bflywheel\b(?=\s*[=;.,)])/g, name);
  return s;
};
const bench = (src) => {
  const cad = JSON.parse(JSON.stringify(E.SAMPLE_CAD)); cad.solids = E.sampleSolids(); E.classifyMechs(cad.mechs);
  const code = E.parseJava(src), map = E.autoMap(code.devices, cad.mechs);
  return { code, cad, map, opts: { payloadKg: 0.18, duty: 0.3, trust: 'code' } };
};
// what the page does when an OpMode is picked (selectOpMode in src/app.js)
const select = (b) => { S.reset(); E.Sim.load(b.code, b.cad, b.map, b.opts); E.Sim.init(); S.adopt(b.code); };
// what a Shot tab select does when the user changes it (pickChanged in src/app.js)
const userPicks = (key, value, b) => S.choose(key, value, b.code);
const FROM_CODE = '@code';
const A = bench(java(1620)), B = bench(java(6000)), C = bench(java(6000, 'launcher'));
const now = () => ({ shooter: S.cfg.shooter, feeder: S.cfg.feeder, motorId: S.cfg.motorId });
const pose = { x: -40 * E.IN, y: -30 * E.IN, h: 0 };

/* A function from src/app.js, run as the page runs it, with the rest of the page stood in for (env). */
const APP = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
function appFn(name, env) {
  const a = APP.indexOf(`function ${name}(`), z = APP.indexOf('\n}\n', a);
  assert.ok(a >= 0 && z > a, name + ' is in src/app.js');
  const names = Object.keys(env);
  return new Function(...names, `${APP.slice(a, z + 3)}\nreturn ${name};`)(...names.map((n) => env[n]));
}
/* applyRig: what the per-robot settings kept in the browser (saveRig: {shot: Shots.cfg, ...} as JSON) put back. */
const applyRigFromApp = (code) => appFn('applyRig', { CAD: { mechs: [] }, OPTS: {}, View: {}, FRONTS: { '+x': 0, '-x': 1, '+y': 2, '-y': 3 }, Shots: S, CODE: code,
  cleanDriveSpec: (x) => x, SETUP: { done: {} }, normJointKind: (k) => k, RIG_DEVICES: {}, HW_USER: {},
  Ignores: { fromRig() {} }, IGNORED: {}, ignoreRobot: () => null, saveIgnored() {}, recomputeChain() {}, syncOptionControls() {} });
/* reloadSim (every rebuild(): another robot, a Map rebind, a trust change) and initNow (INIT) on bench b. */
const pageBits = { Shots: S, Payload: E.Payload, Physics: { sync() {} }, applyConfigOverrides() {}, ShotUI: {}, resetMatch() {},
  renderPad() {}, renderLegend3D() {}, updateDS() {}, renderShotSetup() {}, Online: { inMatch: () => false }, Field: { reset() {} }, Graph: { reset() {} } };
const reloadSim = (b, opts) => appFn('reloadSim', { ...pageBits, CODE: b.code, CAD: b.cad, MAP: b.map, Sim: E.Sim, withPose: () => opts || b.opts })();
const initNow = (b, opts) => appFn('initNow', { ...pageBits, CODE: b.code, CAD: b.cad, MAP: b.map, Sim: E.Sim, withPose: () => opts || b.opts })();
/* What each Shot tab select marks as selected is what is in effect, on the sim that is loaded now. */
function agrees(code) {
  const e = S.effective(code, S.cfg.pick), slots = e.slots;
  const now = { shooter: S.cfg.shooter, feeder: S.cfg.feeder, motor: S.cfg.motorId, intake1: slots[0], intake2: slots[1], transfer: S.cfg.payload.transfer || null };
  for (const key of Object.keys(now)) {
    const sel = S.choices(key, code).options.filter((o) => o.selected).map((o) => o.value);
    assert.equal(sel.length, 1, key + ': one option selected');
    const shown = sel[0] === FROM_CODE ? e.code[key] : sel[0] === '' ? null : sel[0];
    assert.equal(now[key], shown, `${key}: the select shows ${JSON.stringify(shown)} (${sel[0]}), in effect is ${JSON.stringify(now[key])}`);
  }
  assert.equal(S.cfg.motorId, e.motorId, 'the motor in effect is the one worked out on this sim');
}
// the sample shooter OpMode with no rpm in its comment: the flywheel's motor comes from the CAD part it is bound to
const noRpm = E.SHOOTER_JAVA.replace(/\/\/ 6000 rpm goBILDA, 1:1 to the flywheel/, '// the flywheel');
const robotWith = (part) => { const b = bench(noRpm), m = b.cad.mechs[b.cad.mechs.length - 1];
  m.part = part; m.partName = 'goBILDA 5203 motor'; b.map = Object.assign({}, b.map, { flywheel: m.id }); return b; };

test('shot settings: the samples change as the tests expect (a guard on the fixtures)', () => {
  assert.notEqual(java(1620), E.SHOOTER_JAVA, 'the rpm comment is where the test replaces it');
  assert.deepEqual(S.detect(C.code).shooter, ['launcher'], 'OpMode C names its flywheel "launcher"');
  assert.deepEqual(S.detect(B.code).shooter, ['flywheel']);
});

// origin/main: B keeps A's yj1620 (adopt filled the motor once and kept it).
test('shot settings: each OpMode gets the motor its own code declares', () => {
  S.cfg = null;
  select(A);
  assert.equal(E.Sim.dev.flywheel.spec.rpm, 1620);
  assert.deepEqual(now(), { shooter: 'flywheel', feeder: 'kicker', motorId: E.nearestMotorId(1620) });
  select(B);
  assert.equal(S.cfg.motorId, 'yj6000', 'not the 1620 rpm motor of the OpMode before');
  select(C);
  assert.deepEqual(now(), { shooter: 'launcher', feeder: 'kicker', motorId: 'yj6000' });
  select(A);
  assert.equal(S.cfg.motorId, E.nearestMotorId(1620), 'and back again');
  assert.deepEqual(S.cfg.pick, {}, 'nothing chosen: everything was the code\'s');
});

// b27f068 (its own way to pick: cfg.motorId + byHand): C keeps yj1150 and its 98 % shot reads 0 %
// (the reviewer's case 1). origin/main: the same.
test('shot settings: a motor chosen for one shooter does not follow to another, and is back with that shooter', () => {
  S.cfg = null;
  select(A);
  userPicks('motor', 'yj1150', A);
  assert.deepEqual(S.cfg.pick, { motor: { id: 'yj1150', for: 'flywheel' } }, 'tied to the flywheel it was chosen for');
  assert.equal(S.cfg.motorId, 'yj1150');
  select(C);
  assert.equal(S.cfg.shooter, 'launcher');
  assert.equal(S.cfg.motorId, 'yj6000', 'launcher is 6000 rpm in its own code; the yj1150 was chosen for flywheel');
  assert.ok(E.Field.E.evaluate(S.params(pose), 'coarse').hitRate > 0.9, 'so its shot is the good one it is, not 0 %');
  assert.deepEqual(S.cfg.pick, { motor: { id: 'yj1150', for: 'flywheel' } }, 'the choice is kept');
  select(A);
  assert.equal(S.cfg.motorId, 'yj1150', 'back with its own shooter');
  // the choice is for the device by name: another OpMode's "flywheel" is the same one to the user
  select(B);
  assert.equal(S.cfg.motorId, 'yj1150');
  // choosing another flywheel in the Shot tab: that one's motor comes from the code
  userPicks('shooter', '', B);
  assert.equal(S.cfg.shooter, null);
  userPicks('shooter', FROM_CODE, B);
  assert.deepEqual(now(), { shooter: 'flywheel', feeder: 'kicker', motorId: 'yj1150' });
});

// b27f068: a picked shooter falls back to the code in an OpMode without it and is lost for good
// (the reviewer's case 4: "back to the first OpMode" gives "shooter", not "launcher"). origin/main: the same.
test('shot settings: a chosen shooter or feeder survives an OpMode without that device', () => {
  const two = { code: { devices: [['shooter', 'DcMotorEx'], ['launcher', 'DcMotorEx'], ['kicker', 'Servo'], ['gate', 'Servo']].map(([name, type]) => ({ name, type })) } };
  const other = { code: { devices: [{ name: 'flywheel', type: 'DcMotorEx' }, { name: 'pusher', type: 'Servo' }] } };
  S.cfg = null;
  S.adopt(two.code);
  assert.deepEqual([S.cfg.shooter, S.cfg.feeder], ['shooter', 'kicker'], 'from the code');
  userPicks('shooter', 'launcher', two); userPicks('feeder', 'gate', two);
  assert.deepEqual([S.cfg.shooter, S.cfg.feeder], ['launcher', 'gate']);
  S.adopt(other.code);
  assert.deepEqual([S.cfg.shooter, S.cfg.feeder], ['flywheel', 'pusher'], 'an OpMode without them: the code\'s');
  assert.deepEqual(S.cfg.pick, { shooter: 'launcher', feeder: 'gate' }, 'and the choices wait');
  S.adopt(two.code);
  assert.deepEqual([S.cfg.shooter, S.cfg.feeder], ['launcher', 'gate'], 'back with the devices');
});

// origin/main and b27f068: "— none —" for the flywheel is filled again by the next select (the
// reviewer's case 4); a transfer set to none was filled again from the names.
test('shot settings: an explicit none sticks until changed', () => {
  const P = { code: { devices: [{ name: 'intake', type: 'DcMotorEx' }, { name: 'shooter', type: 'DcMotorEx' }, { name: 'belt', type: 'CRServo' }, { name: 'kicker', type: 'Servo' }] } };
  S.cfg = null;
  select(B);
  userPicks('shooter', '', B);
  userPicks('feeder', '', B);
  assert.deepEqual([S.cfg.shooter, S.cfg.feeder], [null, null]);
  select(A); select(B);
  assert.deepEqual([S.cfg.shooter, S.cfg.feeder], [null, null], 'for every OpMode');
  assert.deepEqual(S.cfg.pick, { shooter: null, feeder: null });
  userPicks('shooter', 'flywheel', B);
  assert.equal(S.cfg.shooter, 'flywheel', 'until the user picks again');
  S.cfg = null;
  S.adopt(P.code);
  assert.equal(S.cfg.payload.transfer, 'belt');
  userPicks('transfer', '', P);
  S.adopt(P.code);
  assert.equal(S.cfg.payload.transfer, '', 'no transfer, as chosen');
});

// origin/main and b27f068: there is no way back to the code once a value was set.
test('shot settings: "From the code" removes a choice', () => {
  const P = { code: { devices: [{ name: 'intake', type: 'DcMotorEx' }, { name: 'frontRoller', type: 'DcMotorEx' }, { name: 'shooter', type: 'DcMotorEx' }] } };
  S.cfg = null;
  select(A);
  userPicks('motor', 'yj1150', A); userPicks('feeder', '', A);
  userPicks('motor', FROM_CODE, A); userPicks('feeder', FROM_CODE, A);
  assert.deepEqual(S.cfg.pick, {});
  assert.deepEqual(now(), { shooter: 'flywheel', feeder: 'kicker', motorId: E.nearestMotorId(1620) });
  S.cfg = null; S.adopt(P.code);
  userPicks('intake2', '', P);
  assert.deepEqual(S.cfg.payload.intakes, ['intake']);
  userPicks('intake2', FROM_CODE, P);
  assert.deepEqual(S.cfg.payload.intakes, ['intake', 'frontRoller']);
  assert.deepEqual(S.cfg.pick, {});
});

// origin/main and b27f068: the stale yj1620 the old build saved stays for every OpMode (b27f068
// counts it as the user's: the reviewer's case 2).
test('shot settings: settings saved by the old build get the code\'s values, and the rest stays as saved', () => {
  S.cfg = null; select(B);
  // what the old build's saveRig wrote: Shots.cfg as it stood, every value adopt had filled, no choices
  const old = JSON.stringify({ format: 'ftc-sim-bench.rig', version: 1, shot: {
    shooter: 'flywheel', feeder: 'kicker', motorId: 'yj1620', hoodDeg: 70, h0In: 14.5, wheelMm: 72, wheelId: 'gecko72', gear: 1.5,
    mountDeg: 180, ball: 'nectar', type: 'dual', precision: 'rough',
    payload: { intakes: ['flywheel'], transfer: 'kicker', supply: 'real', preload: 2, rollerMm: 60, edges: { intake: 'back' }, dirs: {} } } });
  // loadCAD: the rig is applied, then the robot's sim is rebuilt (reloadSim), and what is in effect worked out on it
  assert.equal(applyRigFromApp(B.code)(JSON.parse(old)), true);
  reloadSim(B);
  assert.equal(S.cfg.motorId, 'yj6000', 'B\'s own 6000 rpm motor, not the saved 1620');
  agrees(B.code);
  select(B);
  assert.deepEqual(now(), { shooter: 'flywheel', feeder: 'kicker', motorId: 'yj6000' }, 'and on the next select');
  assert.deepEqual(S.cfg.pick, {}, 'nothing in an old save counts as chosen');
  assert.deepEqual([S.cfg.payload.intakes, S.cfg.payload.transfer], [[], ''], 'B\'s code has no intake and no transfer');
  const kept = ({ hoodDeg, h0In, wheelMm, wheelId, gear, mountDeg, ball, type, precision }) => ({ hoodDeg, h0In, wheelMm, wheelId, gear, mountDeg, ball, type, precision });
  assert.deepEqual(kept(S.cfg), { hoodDeg: 70, h0In: 14.5, wheelMm: 72, wheelId: 'gecko72', gear: 1.5, mountDeg: 180, ball: 'nectar', type: 'dual', precision: 'rough' },
    'what adopt never fills stays exactly as saved');
  assert.deepEqual([S.cfg.payload.supply, S.cfg.payload.preload, S.cfg.payload.rollerMm, S.cfg.payload.edges], ['real', 2, 60, { intake: 'back' }]);
  // this build's save keeps the choices (validated on the way back in)
  userPicks('motor', 'yj1150', B);
  const mine = JSON.parse(JSON.stringify({ format: 'ftc-sim-bench.rig', shot: S.cfg }));
  S.cfg = null;
  applyRigFromApp(A.code)(mine);
  assert.deepEqual(S.cfg.pick, { motor: { id: 'yj1150', for: 'flywheel' } });
  select(C); assert.equal(S.cfg.motorId, 'yj6000');
  select(A); assert.equal(S.cfg.motorId, 'yj1150');
  mine.shot.pick = { shooter: 42, feeder: 'x'.repeat(500), motor: { id: 'yj1150' }, intake1: null, transfer: ['belt'], evil: 'y' };
  applyRigFromApp(A.code)(mine);
  assert.deepEqual(S.cfg.pick, { intake1: null }, 'malformed choices are dropped without an error');
});

// origin/main and b27f068: OpMode 1 then OpMode 2 leaves ["intake"] (the reviewer's case 5).
test('shot settings: the intakes and the transfer follow the OpMode', () => {
  const dev = (list) => ({ code: { devices: list.map(([name, type]) => ({ name, type })) } });
  const P1 = dev([['intake', 'DcMotorEx'], ['shooter', 'DcMotorEx']]);
  const P2 = dev([['intake', 'DcMotorEx'], ['frontRoller', 'DcMotorEx'], ['shooter', 'DcMotorEx'], ['belt', 'CRServo']]);
  S.cfg = null; S.adopt(P2.code);
  const fresh = JSON.parse(JSON.stringify(S.cfg.payload));
  assert.deepEqual(fresh, { intakes: ['intake', 'frontRoller'], transfer: 'belt' });
  S.cfg = null; S.adopt(P1.code); S.adopt(P2.code);
  assert.deepEqual(S.cfg.payload, fresh, 'OpMode 1 then OpMode 2 is OpMode 2');
  S.adopt(P1.code);
  assert.deepEqual(S.cfg.payload, { intakes: ['intake'], transfer: '' }, 'and back');
  // chosen slot by slot: the first intake is frontRoller, so the code's other one is the second
  S.adopt(P2.code);
  userPicks('intake1', 'frontRoller', P2);
  assert.deepEqual(S.cfg.payload.intakes, ['frontRoller', 'intake']);
  S.adopt(P1.code);
  assert.deepEqual(S.cfg.payload.intakes, ['intake'], 'an OpMode without frontRoller: the code\'s');
  S.adopt(P2.code);
  assert.deepEqual(S.cfg.payload.intakes, ['frontRoller', 'intake'], 'and the choice is back with it');
});

// origin/main and b27f068: the workspace file has no choices to keep (b27f068 kept cfg.auto marks).
test('shot settings: the workspace file keeps the choices and drops malformed ones', () => {
  S.cfg = null; select(A);
  userPicks('motor', 'yj1150', A); userPicks('feeder', '', A); userPicks('intake2', 'leftFront', A);
  const shots = (cfg) => ({ seed: 7, spreadScale: 1, fired: 0, scored: 0, cfg });
  const file = E.packSession(E.sessionFromBench({ code: A.code, cad: A.cad, map: A.map, opts: A.opts, shots: shots(S.cfg) }));
  const back = E.unpackSession(file);
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.session.shots.cfg.pick, { feeder: null, intake2: 'leftFront', motor: { id: 'yj1150', for: 'flywheel' } });
  // a hostile or broken file: unknown keys, wrong types, a name far too long; the file still opens
  const raw = JSON.parse(file);
  raw.shots.cfg.pick = { shooter: 42, feeder: 'x'.repeat(129), motor: { id: 'yj1150', for: 7 }, transfer: null, intake1: 'intake', __proto__x: 1, extra: 'z' };
  const bad = E.unpackSession(JSON.stringify(raw));
  assert.equal(bad.ok, true, bad.error);
  assert.deepEqual(bad.session.shots.cfg.pick, { transfer: null, intake1: 'intake' });
  // a file from before the choices: none, and the code decides
  delete raw.shots.cfg.pick; raw.shots.cfg.motorId = 'yj1620';
  const old = E.unpackSession(JSON.stringify(raw));
  assert.equal(old.ok, true, old.error);
  assert.equal('pick' in old.session.shots.cfg, false);
  select(B); S.cfg = S.restore(old.session.shots.cfg); S.adopt(B.code);
  assert.equal(S.cfg.motorId, 'yj6000');
});

// origin/main and b27f068: the selects had no "From the code" option and never said which value was whose.
test('shot settings: each select the code fills lists "From the code: ..." first and marks the user\'s choice', () => {
  const sel = (key, b) => S.choices(key, b.code);
  const picked = (c) => c.options.filter((o) => o.selected).map((o) => o.value);
  S.cfg = null; select(A);
  for (const key of ['shooter', 'feeder', 'motor', 'intake1', 'intake2', 'transfer']) {
    const c = sel(key, A);
    assert.equal(c.options[0].value, FROM_CODE, key);
    assert.deepEqual(picked(c), [FROM_CODE], key + ': nothing chosen, the code\'s is selected');
    assert.equal(c.mine, false);
  }
  assert.equal(sel('shooter', A).options[0].label, 'From the code: flywheel');
  assert.deepEqual(sel('shooter', A).options.slice(1).map((o) => o.value), ['', 'leftFront', 'rightFront', 'leftBack', 'rightBack', 'flywheel'], 'none, then the motors');
  assert.equal(sel('shooter', A).options[1].label, '— none —');
  assert.equal(sel('feeder', A).options[0].label, 'From the code: kicker');
  assert.equal(sel('feeder', A).options[1].label, '— by hand (F) —');
  assert.ok(!sel('feeder', A).options.some((o) => o.value === 'flywheel'), 'the shooter in effect is no feeder');
  assert.equal(sel('motor', A).options[0].label, 'From the code: 1620 rpm · 3.7:1');
  assert.deepEqual(sel('motor', A).options.slice(1).map((o) => o.value), E.Field.data.motors.motors.map((m) => m.id));
  assert.equal(sel('intake1', A).options[0].label, 'From the code: none');
  assert.equal(sel('transfer', A).options[0].label, 'From the code: none');
  // chosen: that option is selected and the select says so
  userPicks('motor', 'yj1150', A); userPicks('feeder', '', A);
  assert.deepEqual(picked(sel('motor', A)), ['yj1150']); assert.equal(sel('motor', A).mine, true);
  assert.deepEqual(picked(sel('feeder', A)), ['']); assert.equal(sel('feeder', A).mine, true);
  assert.equal(sel('motor', A).options[0].label, 'From the code: 1620 rpm · 3.7:1', 'and still says what the code would give');
  // a choice that doesn't apply in this OpMode is named beside the code's answer
  select(C);
  assert.equal(sel('motor', C).options[0].label, 'From the code: 6000 rpm · 1:1 (your 1150 rpm · 5.2:1 is for flywheel)');
  assert.deepEqual(picked(sel('motor', C)), [FROM_CODE]);
  userPicks('shooter', 'launcher', C);
  select(A);
  assert.equal(sel('shooter', A).options[0].label, 'From the code: flywheel (your launcher isn\'t in this OpMode)');
  assert.deepEqual(picked(sel('shooter', A)), [FROM_CODE]);
  // the second intake's code value, given the first: the one the first would have had
  const P2 = { code: { devices: [['intake', 'DcMotorEx'], ['frontRoller', 'DcMotorEx']].map(([name, type]) => ({ name, type })) } };
  S.cfg = null; S.adopt(P2.code);
  assert.deepEqual([sel('intake1', P2).options[0].label, sel('intake2', P2).options[0].label], ['From the code: intake', 'From the code: frontRoller']);
  userPicks('intake1', 'frontRoller', P2);
  assert.equal(sel('intake2', P2).options[0].label, 'From the code: intake');
  assert.deepEqual(picked(sel('intake1', P2)), ['frontRoller']);
});

// 36d08dd: applyRig worked the motor out on robot X's sim (loadCAD applies the rig before it rebuilds)
// and nothing worked it out again: Y flew with yj1620 (0 %) while its select said "From the code:
// 6000 rpm". origin/main: yj6000 (its applyRig copied the saved value back).
test('shot settings: another robot loaded: what is in effect is worked out on its own sim, and the select agrees', () => {
  const X = robotWith('5203-2402-0003'), Y = robotWith('5203-2402-0001');   // a 1620 and a 6000 rpm Yellow Jacket
  S.cfg = null; select(Y);
  assert.equal(E.Sim.dev.flywheel.spec.rpm, 6000, 'the code names no rpm: the CAD part says');
  assert.equal(S.cfg.motorId, 'yj6000');
  const savedY = JSON.stringify({ format: 'ftc-sim-bench.rig', shot: S.cfg });   // saveRig
  select(X);
  assert.equal(S.cfg.motorId, 'yj1620');
  // loadCAD(Y): Shots.cfg = null; loadSavedRig() -> applyRig; mapDevices(); rebuild() -> reloadSim
  S.cfg = null;
  applyRigFromApp(Y.code)(JSON.parse(savedY));
  reloadSim(Y);
  assert.equal(E.Sim.dev.flywheel.spec.rpm, 6000);
  assert.equal(S.cfg.motorId, 'yj6000', 'Y\'s own motor, not X\'s');
  agrees(Y.code);
  assert.equal(S.choices('motor', Y.code).options[0].label, 'From the code: 6000 rpm · 1:1');
  assert.ok(E.Field.E.evaluate(S.params(pose), 'coarse').hitRate > 0.9, 'Y\'s good shot, not 0 %');
  // a robot loaded with no saved rig at all gets its code's settings on its own sim too
  S.cfg = null; reloadSim(X);
  assert.equal(S.cfg.motorId, 'yj1620'); agrees(X.code);
});

// 36d08dd and origin/main: a rebuild (Map rebind, trust change) or an INIT reloaded the sim and never
// worked out the motor again: the select said "From the code: 1620 rpm" and the shots flew yj6000.
test('shot settings: after every kind of rebuild the selects show what is in effect', () => {
  const N = bench(noRpm);                                   // nothing in the map: the flywheel's motor is a guess (6000 rpm assumed)
  S.cfg = null; select(N);
  assert.equal(S.cfg.motorId, 'yj6000'); agrees(N.code);
  // the Map tab binds the flywheel to a joint driven by a 1620 rpm Yellow Jacket
  const m = N.cad.mechs[0]; m.part = '5203-2402-0003'; m.partName = 'goBILDA 5203 motor';
  const R = { ...N, map: Object.assign({}, N.map, { flywheel: m.id }) };
  reloadSim(R);
  assert.equal(E.Sim.dev.flywheel.spec.rpm, 1620);
  assert.equal(S.cfg.motorId, 'yj1620', 'the rebind'); agrees(R.code);
  reloadSim(R, { ...R.opts, trust: 'cad' });
  assert.equal(S.cfg.motorId, 'yj1620', 'the trust toggle'); agrees(R.code);
  // back unbound, then INIT alone (initNow loads the sim itself)
  initNow(N);
  assert.equal(S.cfg.motorId, 'yj6000', 'INIT'); agrees(N.code);
  // the user's own choice survives every rebuild, and the select still shows it
  userPicks('motor', 'yj1150', N); userPicks('feeder', '', N);
  reloadSim(R); agrees(R.code); initNow(R); agrees(R.code);
  assert.deepEqual([S.cfg.motorId, S.cfg.feeder], ['yj1150', null]);
});

// 36d08dd: an explicit none was right to stick, but the page and Payload said the code had no
// flywheel, and Payload still charged the launcher for shots.
test('shot settings: an empty role the user chose is said as the user\'s, and no flywheel is charged', () => {
  S.cfg = null; select(B);
  userPicks('shooter', '', B); userPicks('feeder', '', B);
  select(C);
  assert.deepEqual(E.Payload.flywheels(), [], 'no flywheel in effect: none pays for a shot');
  assert.equal(E.Payload.supply().why, 'no intake in the code, and you chose no flywheel; this code has launcher');
  assert.equal(S.chosenNone('shooter', C.code), 'you chose no flywheel; this code has launcher');
  assert.equal(S.chosenNone('feeder', C.code), 'you chose no feeder; this code has kicker');
  S.fire(pose, 'test');
  assert.match(S.log[0].text, /^You chose no flywheel; this code has launcher/);
  // from the code: nothing is the user's, and the words are the code's as before
  userPicks('shooter', FROM_CODE, C); userPicks('feeder', FROM_CODE, C);
  assert.equal(S.chosenNone('shooter', C.code), null);
  assert.deepEqual(E.Payload.flywheels(), ['launcher']);
  const none = { code: { devices: [{ name: 'arm', type: 'DcMotor' }] } };
  S.cfg = null; S.adopt(none.code);
  assert.equal(S.chosenNone('shooter', none.code), null, 'a code with no flywheel: nothing to say about a choice');
});
