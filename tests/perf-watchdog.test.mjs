// The frame-rate watchdog (Perf in src/app.js). On a computer that can't keep up it
// gives up the post-processing passes first (ambient occlusion is the most expensive
// thing drawn, and the least missed), then pixels, then the robot's full copy.
// It used to blur the picture step by step for up to ten seconds while the passes
// kept running.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
const PERF = /\nconst Perf=\{[\s\S]*?\n\};\n/.exec(APP)[0];

function bench(dpr, post = true) {
  const View = { post: post ? {} : null, postOn: post, lowGfx: false, applied: 0, applyQuality() { this.applied++; }, ren: null };
  const ctx = { View, devicePixelRatio: dpr, performance: { now: () => 0 }, Math };
  vm.createContext(ctx);
  vm.runInContext(PERF + 'this.Perf=Perf;', ctx);
  const P = ctx.Perf, log = [];
  let now = 1000;
  /* frames of `ms` each for `secs`, noting each thing the watchdog gave up */
  P.run = (ms, secs) => {
    for (let t = 0; t < secs * 1000; t += ms) {
      const before = [View.postOn, P.pr, View.lowGfx].join();
      now += ms; P.frame(ms, now);
      const after = [View.postOn, P.pr, View.lowGfx].join();
      if (after !== before) log.push({ at: (now - 1000) / 1000, post: View.postOn, pr: P.pr, low: View.lowGfx });
    }
  };
  return { P, View, log };
}

test('perf watchdog: too slow, the passes go first, at full sharpness', () => {
  const { P, View, log } = bench(2);
  P.run(40, 4);                                   // 25 fps for four seconds
  assert.equal(View.postOn, false);
  assert.deepEqual({ post: log[0].post, pr: log[0].pr }, { post: false, pr: 2 }, JSON.stringify(log));
  assert.ok(log[0].at <= 3, 'within the first check: ' + log[0].at);
});

test('perf watchdog: still too slow without them, then fewer pixels, then the light copy', () => {
  const { P, View, log } = bench(2);
  P.run(40, 40);
  assert.equal(View.lowGfx, true);
  assert.equal(P.pr, 0.75);
  const firstPixels = log.findIndex((e) => e.pr < 2), lowAt = log.findIndex((e) => e.low);
  assert.ok(firstPixels > 0 && lowAt > firstPixels, JSON.stringify(log));
});

test('perf watchdog: with no passes loaded (add-ons failed), pixels go first as before', () => {
  const { P, View, log } = bench(2, false);
  P.run(40, 4);
  assert.ok(P.pr < 2, JSON.stringify(log));
  assert.equal(View.lowGfx, false);
});
