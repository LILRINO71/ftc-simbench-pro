// The joint finder's tree on a real robot: GearGurus 7832's, against the joints
// the team made by hand (assets/robots/into-the-deep/joints.json). Each joint
// the finder makes is named after the hand joint whose parts it mostly carries;
// it has to hang from that joint's hand parent. Before, the outtake claw servo
// and the intake pivot servo rode the frame (their cases drawn touching it), and
// the intake slide carried only its rails (its carriage drawn touching the
// frame), so the whole intake stayed put when the slide ran out.
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
const hand = JSON.parse(fs.readFileSync(path.join(ITD, 'joints.json'), 'utf8'));

const H = E.parseSTEP(text); E.applyJointSpec(H, hand);
const R = E.autoRig(E.parseSTEP(text), { front: '-x' });
const handOf = (i) => H.solids[i].mech || 'chassis';
const handJ = new Map(H.mechs.map((m) => [m.id, m]));
// a found joint -> the hand joint most of its own parts ride
const named = new Map(R.spec.joints.map((j) => {
  const n = new Map(); for (const i of j.parts[0].solid) n.set(handOf(i), (n.get(handOf(i)) || 0) + 1);
  return [j.id, [...n].sort((a, b) => b[1] - a[1])[0][0]];
}));

test('autorig tree: every joint the finder makes on 7832 hangs where the hand joints say', () => {
  const wrong = [];
  for (const j of R.spec.joints) {
    const h = named.get(j.id); if (h === 'chassis') continue;
    const want = handJ.get(h).parent || 'chassis', got = j.parent ? named.get(j.parent) : 'chassis';
    if (got !== want && got !== h) wrong.push(`${j.id} (${h}) hangs from ${j.parent || 'chassis'} (${got}), not ${want}`);
  }
  assert.deepEqual(wrong, []);
});

test('autorig tree: the intake slide carries its carriage, and says it was cut free', () => {
  const ext = H.solids.map((s, i) => (s.mech === 'extend' ? i : -1)).filter((i) => i >= 0);
  const slide = R.spec.joints.find((j) => named.get(j.id) === 'extend' && j.kind === 'slider');
  assert.ok(slide, 'a slide carries the intake carriage');
  const own = new Set(slide.parts[0].solid);
  const got = ext.filter((i) => own.has(i)).length;
  assert.ok(got >= 0.9 * ext.length, `the slide carries ${got} of the carriage's ${ext.length} parts`);
  assert.ok(R.review.some((r) => r.includes('"Slide 1" was drawn touching the frame')), 'the review says where it was cut');
});
