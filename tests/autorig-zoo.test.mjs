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
const KNOWN = new Set(['arm-corehex (no names)']);

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
