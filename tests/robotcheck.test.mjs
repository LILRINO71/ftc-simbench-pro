// The robot check (src/robotcheck.js) on GearGurus 7832's robot and their own
// TeleOp: the hand-made joints check out with nothing to ask; the joints the
// finder guesses become questions in the team's device names, with the likely
// answers; an answer (a device on a joint) closes its question; a frame part
// put on the arm is caught, by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const ITD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'robots', 'into-the-deep');
const text = zlib.gunzipSync(fs.readFileSync(path.join(ITD, 'robot.step.gz'))).toString('utf8');
const code = E.parseJava(fs.readFileSync(path.join(ITD, 'BAL.java'), 'utf8'));
const hand = JSON.parse(fs.readFileSync(path.join(ITD, 'joints.json'), 'utf8'));
const auto = E.autoRig(E.parseSTEP(text), { front: '-x' }).spec;

function check(spec, tweak) {
  const cad = E.parseSTEP(text), r = E.applyJointSpec(cad, spec);
  if (tweak) tweak(cad);
  const map = E.autoMap(code.devices, cad.mechs);
  for (const d of code.devices) { const j = r.devices[d.name] || r.devices[d.cfg]; if (j) map[d.name] = j; }
  return E.checkRobot(cad, code, map, { isCommanded: (n) => E.isCommanded(code, n) });
}

test('robot check: the hand-made joints and the team TeleOp check out, nothing to ask', () => {
  const R = check(hand);
  assert.equal(R.need, 0); assert.equal(R.warn, 0); assert.ok(R.ready);
  for (const d of ['motor', 'uppies', 'linkL', 'linkR', 'inY', 'inX', 'inClaw', 'inPiv', 'outRot', 'outClaw'])
    assert.ok(R.items.some((i) => i.device === d && i.sev === 'ok'), d + ' drives a joint');
});

test('robot check: guessed joints become questions in the team device names, with likely answers', () => {
  const R = check(auto);
  const q = R.items.filter((i) => i.ask === 'pick-parts');
  assert.ok(q.length >= 8, 'each servo the code moves is asked about');
  const up = q.find((i) => i.device === 'uppies');
  assert.ok(up && /slide/i.test(up.candidates[0].label), 'the lift motor is offered the slides first');
  const claw = q.find((i) => i.device === 'outClaw');
  assert.ok(claw.candidates.every((c) => /servo/i.test(c.label)), 'a servo is offered servo joints');
  assert.ok(R.items.some((i) => i.key === 'source' && i.ask === 'mates'), 'and it says mates would make them exact');
});

test('robot check: an answer closes its question', () => {
  const spec = JSON.parse(JSON.stringify(auto));
  const before = check(spec), up = before.items.find((i) => i.device === 'uppies');
  spec.joints.find((j) => j.id === up.candidates[0].joint).device = 'uppies';
  const after = check(spec);
  assert.ok(!after.items.some((i) => i.device === 'uppies' && i.sev === 'fail'));
  assert.equal(after.need, before.need - 1);
});

test('robot check: a frame rail put on the arm is caught, by name', () => {
  const R = check(hand, (cad) => {
    const i = cad.solids.findIndex((s) => !s.mech && /U-Channel/.test(s.name) && Math.abs(s.pts[0][2]) < 0.1);
    cad.solids[i].mech = 'arm';
  });
  const s = R.items.find((i) => i.key === 'swing:arm');
  assert.ok(s && s.sev !== 'ok' && /U-Channel/.test(s.text), 'the arm swing names the rail it hits');
});

test('robot check: a joint that moves nothing is a question, not a silent joint', () => {
  const spec = JSON.parse(JSON.stringify(hand));
  spec.joints.push({ id: 'ghost', kind: 'revolute', axis: [0, 0, 1], pivot: [0, 0, 0], parts: [] });
  const R = check(spec);
  const g = R.items.find((i) => i.joint === 'ghost');
  assert.equal(g.sev, 'fail'); assert.equal(g.ask, 'drop-joint');
});
