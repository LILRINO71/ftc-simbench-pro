// CPU ratchet: the simulator may not get more than ~2x slower than tests/cpu-baseline.json says.
// It runs 2,000 ticks of the default robot's real TeleOp on the Java VM, on the field with the AI
// robots (tools/bench-cpu.mjs), and divides the time per tick by the time of a fixed piece of plain
// JavaScript run beside it. That ratio, not wall-clock time, is what is held, so a slow or busy CI
// machine does not flake it; a change that really makes the sim slower does.
//
// A slowdown that is on purpose (a more careful physics step, say), or a faster sim that should
// stay fast: look at what changed, then re-measure and commit tests/cpu-baseline.json saying why:
//   UPDATE_CPU_BASELINE=1 node --test tests/cpu-bench.test.mjs        (PowerShell: $env:UPDATE_CPU_BASELINE=1)
// To look for what is slow: node --cpu-prof tools/bench-cpu.mjs, then open the .cpuprofile in Chrome DevTools.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from '../tools/bench-cpu.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'tests', 'cpu-baseline.json');
const MAX_SLOWDOWN = 2;

test('cpu ratchet: a sim tick is not more than 2x slower than the stored baseline', () => {
  const now = measure(3, 2000);
  const line = `${now.ticksPerSec.toFixed(0)} ticks/s, ${now.msPerTick.toFixed(3)} ms per tick, ratio ${now.ratio.toExponential(3)}`;
  if (process.env.UPDATE_CPU_BASELINE) {
    fs.writeFileSync(FILE, JSON.stringify({
      note: 'Time of one sim tick (default robot, its TeleOp on the Java VM, field, AI robots) divided by the time of a fixed JavaScript reference loop. tests/cpu-bench.test.mjs fails when it is more than maxSlowdown times this. Re-measure: UPDATE_CPU_BASELINE=1 node --test tests/cpu-bench.test.mjs',
      ratio: +now.ratio.toPrecision(4),
      maxSlowdown: MAX_SLOWDOWN,
      measured: { ticksPerSec: Math.round(now.ticksPerSec), msPerTick: +now.msPerTick.toFixed(3), referenceMs: +now.referenceMs.toFixed(2), node: process.version },
    }, null, 2) + '\n');
    return;
  }
  const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const limit = base.ratio * (base.maxSlowdown || MAX_SLOWDOWN);
  assert.ok(now.ratio <= limit,
    `a sim tick is ${(now.ratio / base.ratio).toFixed(2)}x the baseline (${line}; the baseline ratio is ${base.ratio}, it fails past ${(base.maxSlowdown || MAX_SLOWDOWN)}x).\n` +
    'If the slowdown is on purpose, re-measure: UPDATE_CPU_BASELINE=1 node --test tests/cpu-bench.test.mjs (PowerShell: $env:UPDATE_CPU_BASELINE=1 first), and commit tests/cpu-baseline.json saying why.');
});
