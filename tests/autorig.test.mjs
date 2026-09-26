// The automatic joint finder (src/autorig.js, built from research/autorig):
// on GearGurus 7832's real robot it has to find what the hand-written spec
// says moves, without being told anything about the robot; on 14 generated
// robots with no mechanisms it must move nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadEngine, fixture } from './load.mjs';

const E = loadEngine();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITD = path.join(ROOT, 'assets', 'robots', 'into-the-deep');

test('Into The Deep: every driven joint, both slides, the gears, and the moving parts, found from geometry alone', () => {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(ITD, 'robot.step.gz'))).toString('utf8');
  const cad = E.parseSTEP(text), truth = E.parseSTEP(text);
  E.applyJointSpec(truth, JSON.parse(fs.readFileSync(path.join(ITD, 'joints.json'), 'utf8')));
  const R = E.autoRig(cad, { front: '-x' });
  const J = R.spec.joints;
  // each actuated turn in the hand spec has a found joint on the same axis line
  const T = truth.mechs.filter((m) => /^(arm|outRot|outClaw|crank R|crank L|inY|inPiv|inX|inClaw)$/.test(m.id));
  for (const t of T) {
    const hit = J.filter((j) => j.kind === 'revolute').find((j) => {
      const a = j.axis, p = j.pivot.map((v) => v / 1000), d = [0, 1, 2].map((k) => t.pivot[k] - p[k]);
      const along = d[0] * a[0] + d[1] * a[1] + d[2] * a[2], off = Math.hypot(d[0] - a[0] * along, d[1] - a[1] * along, d[2] - a[2] * along);
      return Math.abs(a[0] * t.axis[0] + a[1] * t.axis[1] + a[2] * t.axis[2]) > Math.cos(3 * Math.PI / 180) && off < 0.005;
    });
    assert.ok(hit, t.id + ' found');
  }
  assert.equal(J.filter((j) => j.follows && j.follows.ratio < -0.99 && j.follows.ratio > -1.01).length, 2, 'both claw gear followers, ratio -1');
  assert.equal(R.slides, 2, 'the lift and the intake extension');
  // parts: what it moves really moves, and most of what moves is found
  const pred = new Array(cad.solids.length).fill(null);
  for (const j of J) for (const i of j.parts[0].solid) pred[i] = j.id;
  const moving = truth.solids.filter((s) => s.mech).length;
  const found = truth.solids.filter((s, i) => s.mech && pred[i]).length, wrong = truth.solids.filter((s, i) => !s.mech && pred[i]).length;
  assert.equal(wrong, 0, 'no frame part put on a joint');
  assert.ok(found / moving > 0.9, `found ${found} of ${moving} moving parts`);
  // and it's a spec the bench runs
  const c2 = E.parseSTEP(text), rep = E.applyJointSpec(c2, R.spec).report;
  assert.equal(rep.joints, J.length);
});

test('robots with no mechanisms get no joints that move anything', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'tests', 'fixtures', 'robots')).filter((x) => x.endsWith('.json'))) {
    const cad = E.parseSTEP(fixture('robots/' + f.replace('.json', '.step')));
    const R = E.autoRig(cad, {});
    assert.equal(R.spec, null, f + ': ' + (R.spec ? R.spec.joints.map((j) => j.id).join(', ') : ''));
    assert.ok(R.review.length, 'and it says why');
  }
});
