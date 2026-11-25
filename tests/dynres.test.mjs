// Dynamic resolution (src/tier.js dynResStep) and the frame budget it is held to
// (refreshMs), plus the look budgets each tier gets and the post chain's bloom levels
// (src/postfx.js postBloomLevels). Pure logic, no GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('dynres: frames over budget for a while drop the scale a step, never below the floor', () => {
  const s = E.dynResInit({ min: 0.6 });
  let changed = 0;
  for (let i = 0; i < 19; i++) changed += E.dynResStep(s, 20, 16.7);
  assert.equal(changed, 0, 'one bad stretch shorter than downAfter frames changes nothing');
  assert.equal(E.dynResStep(s, 20, 16.7), true);
  assert.equal(s.scale, 0.9);
  for (let i = 0; i < 400; i++) E.dynResStep(s, 40, 16.7);
  assert.equal(s.scale, 0.6, 'the floor holds');
});

test('dynres: a single slow frame among good ones does not drop it (no see-saw)', () => {
  const s = E.dynResInit();
  for (let i = 0; i < 1000; i++) E.dynResStep(s, i % 4 === 0 ? 30 : 12, 16.7);
  assert.equal(s.scale, 1);
});

test('dynres: it comes back only with room for the pixels a step adds, after ~3 s of it', () => {
  const s = E.dynResInit({ scale: 0.7 });
  // at 0.7, 11 ms would be 11 * (0.8/0.7)^2 = 14.4 ms at 0.8: over 75% of 16.7 ms, so it stays
  for (let i = 0; i < 1000; i++) E.dynResStep(s, 11, 16.7);
  assert.equal(s.scale, 0.7);
  // 8 ms -> 10.4 ms at 0.8: fits; it takes upAfter frames
  let n = 0; while (!E.dynResStep(s, 8, 16.7)) n++;
  assert.equal(s.scale, 0.8); assert.equal(n + 1, s.upAfter);
  assert.equal(E.dynResStep(Object.assign(E.dynResInit(), { scale: 1 }), 1, 16.7), false, 'never above max');
});

test('dynres: bad input changes nothing', () => {
  const s = E.dynResInit();
  for (const [ms, b] of [[NaN, 16], [20, 0], [-1, 16], [undefined, 16]]) assert.equal(E.dynResStep(s, ms, b), false);
  assert.equal(s.hot, 0);
});

test('refreshMs: the display interval from frame times, snapped to a real refresh rate', () => {
  const jitter = (base, n) => Array.from({ length: n }, (_, i) => base + ((i * 7) % 5 - 2) * 0.15);
  assert.ok(Math.abs(E.refreshMs(jitter(16.7, 60)) - 1000 / 60) < 1e-9);
  assert.ok(Math.abs(E.refreshMs(jitter(6.94, 60)) - 1000 / 144) < 1e-9);
  // a few long frames (a hitch, a load) don't make it think the screen is slow
  const mix = jitter(8.33, 60).concat([40, 50, 33, 33, 60]);
  assert.ok(Math.abs(E.refreshMs(mix) - 1000 / 120) < 1e-9);
  assert.ok(Math.abs(E.refreshMs([16]) - 1000 / 60) < 1e-9, 'too few samples: 60 Hz');
});

test('tiers: the look extras follow the design (no passes on tier 0, AO full-size only on tier 2)', () => {
  const [b0, b1, b2] = E.TIER_BUDGETS;
  assert.deepEqual([b0.msaa, b0.bloom, b0.grade, b0.crowd], [0, false, false, false]);
  assert.ok(b1.msaa >= 4 && b1.bloom && b1.aoHalf, 'tier 1: MSAA, bloom, AO at half size');
  assert.ok(b2.msaa >= 4 && b2.bloom && !b2.aoHalf && b2.vignette);
  for (const b of E.TIER_BUDGETS) assert.ok(b.minScale > 0.5 && b.minScale <= 1, 'dynamic resolution floor');
});

test('postfx: bloom levels shrink to about 16 px, 2 to 6 of them', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'postfx.js'), 'utf8');
  const { postBloomLevels } = new Function(src + '\nreturn { postBloomLevels };')();
  assert.equal(postBloomLevels(1920, 1080), 5);
  assert.equal(postBloomLevels(800, 450), 4);
  assert.equal(postBloomLevels(64, 64), 2);
  assert.equal(postBloomLevels(1, 1), 2);
});
