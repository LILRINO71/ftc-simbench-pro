// The page's frame loop (src/app.js) must not redo work nobody can see. Two things used to run on
// the main thread every quarter second while driving and cost 10 ms each (a dropped frame at 120 Hz):
// re-measuring the CAD's wheels for the status light, and the shot verdict with no flywheel in the
// code and the Shot tab shut. app.js needs a DOM, so these read the functions out of its source
// the way perf-watchdog.test.mjs does and run them against stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
const grab = (re, what) => { const m = re.exec(APP); assert.ok(m, `${what} is still in src/app.js`); return m[0]; };

test('status light: the wheels are measured once per robot and front, not on every refresh', () => {
  const src = grab(/\nconst Status=\{[\s\S]*?\n\};\n/, 'Status');
  let calls = 0;
  const ctx = {
    CAD: { solids: [1, 2, 3] }, OPTS: { front: '+x' }, FINDINGS: [], Sim: {},
    frontAcrossWheels: () => { calls++; return true; }, statusOf: (f, rt) => rt,
  };
  vm.createContext(ctx);
  vm.runInContext(src + ';this.Status=Status;', ctx);
  for (let i = 0; i < 20; i++) assert.equal(ctx.Status.compute().frontAcross, true);
  assert.equal(calls, 1, 'twenty refreshes, one measurement');
  ctx.OPTS.front = '+y'; ctx.Status.compute(); ctx.Status.compute();
  assert.equal(calls, 2, 'a new front is measured again');
  ctx.CAD = { solids: [1, 2, 3] }; ctx.Status.compute();
  assert.equal(calls, 3, 'a new robot is measured again');
  ctx.CAD = null;
  assert.equal(ctx.Status.compute().frontAcross, false, 'no robot, nothing across');
});

function shotBench({ shooter, paneOpen }) {
  const src = grab(/\nfunction shotTick\(now\)\{[\s\S]*?\n\}\n/, 'shotTick');
  const log = [];
  const ctx = {
    Field: { ok: true, hive: { red: 0, blue: 0 }, E: { classifyShot: () => ({}) } },
    Shots: { cfg: shooter ? { shooter: 'fly' } : {}, alliance: 'red', spin: () => 0 },
    CAD: {}, IN: 0.0254, Sim: { chassis: { x: 0, y: 0, h: 0 }, vel: { x: 0, y: 0 } },
    ShotUI: { key: null, still: 0, t: 0, dirty: true, full: false, res: null },
    paneVisible: () => paneOpen,
    shotEvaluate: (mode) => { log.push(mode); },
    updateArc() {}, renderShotVerdict() {}, renderShotLive() {}, renderHives() {}, renderShotLog() {},
    $: () => null, VERDICT_CLASS: {},
  };
  vm.createContext(ctx);
  vm.runInContext(src + ';this.shotTick=shotTick;', ctx);
  return { ctx, log };
}

test('shot verdict: not computed while nothing shows it, computed once something does', () => {
  const idle = shotBench({ shooter: false, paneOpen: false });
  for (let t = 0; t < 3000; t += 50) idle.ctx.shotTick(t);
  assert.deepEqual(idle.log, [], 'no flywheel and the Shot tab shut: no evaluation');
  assert.equal(idle.ctx.ShotUI.dirty, true, 'it is still owed, for when the tab opens');

  const tab = shotBench({ shooter: false, paneOpen: true });
  for (let t = 0; t < 3000; t += 50) tab.ctx.shotTick(t);
  assert.deepEqual(tab.log, ['coarse', 'full'], 'the open Shot tab gets the coarse verdict, then the full one once the robot is still');

  const fly = shotBench({ shooter: true, paneOpen: false });
  for (let t = 0; t < 3000; t += 50) fly.ctx.shotTick(t);
  assert.deepEqual(fly.log, ['coarse', 'full'], 'a flywheel in the code is shown on the field: evaluated');

  // the tab opening later pays the debt
  idle.ctx.paneVisible = () => true;
  idle.ctx.shotTick(4000);
  assert.deepEqual(idle.log, ['coarse']);
});
