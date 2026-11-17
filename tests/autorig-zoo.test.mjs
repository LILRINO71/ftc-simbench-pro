// The automatic joint finder on the mechanism zoo (tools/mechgen.mjs): a
// mecanum base plus one kind of mechanism each, with its true joints. Every
// mechanism, with its part names and with every part renamed "Part N", has to
// come out with each joint on the right axis, every moving part on the right
// joint, and nothing of the frame moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { MECHS, buildMech } from '../tools/mechgen.mjs';
import { score } from '../research/autorig/zoo/eval.mjs';

const E = loadEngine();
// what shape alone can't tell yet: an unnamed through-bore motor is a box with a shaft through it,
// like any bearing block on an axle
const KNOWN = new Set(['arm-corehex (no names)',
  // a pulley at the far end of a belt turns alone: the roller shaft it sits on, run through both
  // side plates, joins it to the frame
  'intake-spacers', 'intake-spacers (no names)']);

for (const name of Object.keys(MECHS)) for (const strip of [false, true]) {
  const label = name + (strip ? ' (no names)' : '');
  if (KNOWN.has(label)) continue;
  test('zoo: ' + label, () => {
    const { text, truth } = buildMech(name, { strip });
    const cad = E.parseSTEP(text), s = score(cad, E.autoRig(cad, {}), truth);
    assert.deepEqual(s.missing, [], 'every joint found');
    assert.equal(s.falseMove, 0, 'no frame part moved');
    assert.equal(s.wrongJoint, 0, 'no part on the wrong joint');
    assert.equal(s.right, s.moving, 'every moving part found');
  });
}

test('zoo: an unnamed Core Hex is still missed (so this test notices when it is found)', () => {
  const { text, truth } = buildMech('arm-corehex', { strip: true });
  const cad = E.parseSTEP(text), s = score(cad, E.autoRig(cad, {}), truth);
  assert.equal(s.falseMove, 0);
  assert.deepEqual(s.missing, ['arm']);
});

test('zoo: every found spec loads, with each joint named once (a pinion driving two gears gave both "motor 1 gear")', () => {
  for (const name of Object.keys(MECHS)) for (const strip of [false, true]) {
    const { text } = buildMech(name, { strip });
    const R = E.autoRig(E.parseSTEP(text), {});
    if (!R || !R.spec) continue;
    const ids = R.spec.joints.map((j) => j.id);
    assert.equal(new Set(ids).size, ids.length, name + ': ' + ids.join(', '));
    assert.doesNotThrow(() => E.applyJointSpec(E.parseSTEP(text), R.spec), name);
  }
});

test('zoo: a rack on a servo gear slides with it, the way the gear pushes it, while the gear is on it', () => {
  for (const strip of [false, true]) {
    const { text } = buildMech('rack-servo', { strip });
    const J = E.autoRig(E.parseSTEP(text), {}).spec.joints;
    const rack = J.find((j) => j.kind === 'slider'), gear = J.find((j) => rack && j.id === rack.follows.joint);
    assert.ok(rack && gear && gear.kind === 'revolute', 'a slider following a turning joint: ' + J.map((j) => j.id + ' ' + j.kind).join(', '));
    // the gear (radius 10.5 mm, teeth 1.6 mm deep into the rack's) moves the rack its pitch radius for each radian
    assert.ok(Math.abs(rack.follows.ratio - 0.0097) < 0.0005, 'ratio ' + rack.follows.ratio);
    // a turn about the gear's axis carries its bottom tooth along axis x down; the rack goes that way
    const a = gear.axis, push = [-a[1], a[0], 0];                       // axis x [0,0,-1]
    assert.ok(push[0] * rack.axis[0] + push[1] * rack.axis[1] + push[2] * rack.axis[2] > 0.99, 'rack axis ' + rack.axis + ', gear axis ' + a);
    // drawn from x 86 to 194 mm under a gear at x 110: it can go 84 mm toward -x and 24 toward +x
    const dx = rack.limits.map((v) => v * rack.axis[0]).sort((p, q) => p - q);
    assert.ok(Math.abs(dx[0] + 84) <= 2 && Math.abs(dx[1] - 24) <= 2, 'limits ' + rack.limits + ' along ' + rack.axis);
  }
});

test('zoo: a roller shaft with spacers clamped on it turns with its motor; it is not a rail with carriage blocks', () => {
  for (const strip of [false, true]) {
    const { text } = buildMech('intake-spacers', { strip });
    const R = E.autoRig(E.parseSTEP(text), {});
    assert.equal(R.slides, 0, 'no slide stack');
    assert.deepEqual(R.spec.joints.filter((j) => j.kind === 'slider').map((j) => j.id), []);
    assert.ok(R.spec.joints.some((j) => j.follows && j.kind === 'revolute'), 'the belt still turns the roller');
  }
});
