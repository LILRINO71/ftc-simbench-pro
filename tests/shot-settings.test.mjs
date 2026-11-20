// Shots.adopt fills the Shot tab's settings from the code: which device is the shooter, which the
// feeder, which motor. It used to fill each once and keep it, so switching OpMode left the second
// one running with the first one's shooter motor: a flywheel the code declares as 6000 rpm was
// flown as the 1620 rpm one before it, and a 98 % shot read as 0 % ("WON'T WORK"). What adopt
// filled is now marked (cfg.auto) and worked out again for every OpMode; what the user picked in
// the Shot tab stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithField } from './load.mjs';

const E = loadWithField();
const java = (rpm) => E.SHOOTER_JAVA.replace(/\/\/ 6000 rpm goBILDA, 1:1 to the flywheel/, `// ${rpm} rpm goBILDA, 1:1 to the flywheel`);
const bench = (src) => {
  const cad = JSON.parse(JSON.stringify(E.SAMPLE_CAD)); cad.solids = E.sampleSolids(); E.classifyMechs(cad.mechs);
  const code = E.parseJava(src), map = E.autoMap(code.devices, cad.mechs);
  return { code, cad, map, opts: { payloadKg: 0.18, duty: 0.3, trust: 'code' } };
};
// what the page does when an OpMode is picked (selectOpMode in src/app.js)
const select = (b) => { E.Shots.reset(); E.Sim.load(b.code, b.cad, b.map, b.opts); E.Sim.init(); E.Shots.adopt(b.code); };
const A = bench(java(1620)), B = bench(java(6000));

test('shot settings: the sample changes as the test expects (a guard on the fixture)', () => {
  assert.notEqual(java(1620), E.SHOOTER_JAVA, 'the rpm comment is where the test replaces it');
});

test('shot settings: each OpMode gets the motor its own code declares', () => {
  E.Shots.cfg = null;
  select(A);
  assert.equal(E.Sim.dev.flywheel.spec.rpm, 1620);
  assert.equal(E.Shots.cfg.motorId, E.nearestMotorId(1620));
  assert.deepEqual(E.Shots.cfg.auto, { shooter: true, feeder: true, motorId: true }, 'all three were filled by the bench');
  select(B);
  assert.equal(E.Sim.dev.flywheel.spec.rpm, 6000);
  assert.equal(E.Shots.cfg.motorId, 'yj6000', 'not the 1620 rpm motor of the OpMode before');
  select(A);
  assert.equal(E.Shots.cfg.motorId, E.nearestMotorId(1620), 'and back again');
});

test('shot settings: a motor the user picked in the Shot tab survives the switch', () => {
  E.Shots.cfg = null;
  select(A);
  E.Shots.cfg.motorId = 'yj1150'; E.Shots.byHand('motorId');          // what #motorSel does
  select(B);
  assert.equal(E.Shots.cfg.motorId, 'yj1150');
  assert.deepEqual(E.Shots.cfg.auto, { shooter: true, feeder: true });
});

test('shot settings: a shooter or feeder the user picked stays while the device exists; a filled one follows the code', () => {
  const two = (first) => ({ devices: [[first, 'DcMotorEx'], ['launcher', 'DcMotorEx'], ['kicker', 'Servo'], ['gate', 'Servo']].map(([name, type]) => ({ name, type })) });
  E.Shots.cfg = null;
  E.Shots.adopt(two('shooter'));
  assert.deepEqual([E.Shots.cfg.shooter, E.Shots.cfg.feeder], ['shooter', 'kicker']);
  E.Shots.cfg.shooter = 'launcher'; E.Shots.byHand('shooter');
  E.Shots.cfg.feeder = 'gate'; E.Shots.byHand('feeder');
  E.Shots.adopt(two('shooter'));
  assert.deepEqual([E.Shots.cfg.shooter, E.Shots.cfg.feeder], ['launcher', 'gate'], 'picked by hand: kept');
  // another OpMode with no such devices: the picks cannot stand, so they are worked out again and marked
  E.Shots.adopt({ devices: [{ name: 'flywheel', type: 'DcMotorEx' }, { name: 'pusher', type: 'Servo' }] });
  assert.deepEqual([E.Shots.cfg.shooter, E.Shots.cfg.feeder], ['flywheel', 'pusher']);
  assert.equal(E.Shots.cfg.auto.shooter, true); assert.equal(E.Shots.cfg.auto.feeder, true);
  // a filled shooter follows the next OpMode's own names
  E.Shots.cfg = null;
  E.Shots.adopt({ devices: [{ name: 'shooterA', type: 'DcMotorEx' }, { name: 'shooterB', type: 'DcMotorEx' }] });
  assert.equal(E.Shots.cfg.shooter, 'shooterA');
  E.Shots.adopt({ devices: [{ name: 'shooterB', type: 'DcMotorEx' }, { name: 'shooterA', type: 'DcMotorEx' }] });
  assert.equal(E.Shots.cfg.shooter, 'shooterB', 'the first shooter this OpMode declares');
});

test('shot settings: a setting saved before the marks existed counts as the user\'s', () => {
  // a rig kept in the browser from an older build: a motor with no mark beside it
  E.Shots.cfg = Object.assign(E.Shots.defaults(), { shooter: 'flywheel', motorId: 'yj1150' });
  select(B);
  assert.equal(E.Shots.cfg.motorId, 'yj1150', 'never overwritten: it may have been picked by hand');
  assert.equal(E.Shots.cfg.shooter, 'flywheel');
});

test('shot settings: the workspace file keeps the marks and drops anything that is not a plain true', () => {
  E.Shots.cfg = null; select(A);
  E.Shots.cfg.motorId = 'yj1150'; E.Shots.byHand('motorId');
  const file = E.packSession(E.sessionFromBench({ code: A.code, cad: A.cad, map: A.map, opts: A.opts, shots: { seed: 7, spreadScale: 1, fired: 0, scored: 0, cfg: E.Shots.cfg } }));
  const back = E.unpackSession(file);
  const cfg = (back.shots && back.shots.cfg) || (back.session && back.session.shots && back.session.shots.cfg);
  assert.ok(cfg, 'the shot settings came back: ' + Object.keys(back).join(','));
  assert.deepEqual(cfg.auto, { shooter: true, feeder: true });
  assert.equal(cfg.motorId, 'yj1150');
});
