// node --test tests/tess-workers.test.mjs
//
// The exact surfaces are meshed by OpenCascade in a few Web Workers. One worker
// stopping (a part too big for its memory, a hiccup loading OpenCascade) used to
// mark workers unavailable for good, so every remaining part was meshed on the
// page's own thread, freezing the page for seconds at a time: the lag teams saw
// after loading a robot. Here a fake Worker stops once; the rest must still be
// meshed in workers, and nothing on the page thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineBundle } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load(WorkerImpl, urls = { made: 0, revoked: 0 }) {
  const URL = { createObjectURL: () => 'blob:x' + (++urls.made), revokeObjectURL: () => { urls.revoked++; } };
  const g = { Worker: WorkerImpl, URL, Blob: class {}, navigator: { hardwareConcurrency: 4 } };
  const names = Object.keys(g);
  return new Function(...names, '"use strict";\n' + engineBundle().replace(/^"use strict";\n/, '') + '\n' +
    fs.readFileSync(path.join(ROOT, 'src', 'tessellate.js'), 'utf8') + '\nreturn { parseSTEP, Tess };')(...names.map((k) => g[k]));
}

// a worker that answers each shape with one triangle; the n-th job overall makes its worker stop
function fakeWorkers(stopAt) {
  let jobs = 0;
  return class FakeWorker {
    constructor() { this.onmessage = null; this.onerror = null; }
    postMessage(d) {
      const n = ++jobs;
      setTimeout(() => {
        if (n === stopAt) { this.onerror && this.onerror({ message: 'out of memory', preventDefault() {} }); return; }
        const m = { attributes: { position: { array: new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]) } }, index: { array: new Uint32Array([0, 1, 2]) } };
        this.onmessage && this.onmessage({ data: { id: d.id, ok: true, res: { success: true, meshes: [m] } } });
      }, 1);
    }
    terminate() {}
  };
}

// a worker that can never start: importScripts fails (offline, a CSP), so every job errors
class DeadWorker {
  constructor() { this.onmessage = null; this.onerror = null; }
  postMessage() { setTimeout(() => this.onerror && this.onerror({ message: 'importScripts failed', preventDefault() {} }), 1); }
  terminate() {}
}

/* Tess.run (the whole-file path) never told its worker which job it had, so
   the worker's onerror couldn't fail that job: it hung until the 120 s
   timeout and never fell back to the page thread. */
test('exact geometry: a worker that fails to start fails its whole-file job at once, and it falls back', async () => {
  const M = load(DeadWorker);
  let onPage = 0;
  M.Tess.mainThread = () => { onPage++; return Promise.resolve({ success: true, meshes: [], from: 'page' }); };
  const t0 = Date.now();
  const res = await M.Tess.run('ISO-10303-21;', 3000);
  assert.equal(res.from, 'page', 'meshed by the fallback');
  assert.equal(onPage, 1);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms: the job waited for the timeout`);
});

/* With no workers at all, perShape refuses to mesh a robot of many shapes on
   the page thread and throws. exact() caught that and called run(text), which
   then meshed the whole file on the page thread: the freeze it was avoiding. */
test('exact geometry: with no workers, a many-shape robot is not meshed whole on the page thread', async () => {
  const M = load(DeadWorker);
  const text = buildRobot('mecanum-zup').text;
  const cad = M.parseSTEP(text);
  let onPage = 0;
  M.Tess.mainThread = () => { onPage++; return Promise.resolve({ success: true, meshes: [] }); };
  await assert.rejects(M.Tess.exact(cad, text), /background/);
  assert.equal(M.Tess.noWorker, true, 'the workers are marked unavailable');
  assert.equal(onPage, 0, 'nothing meshed on the page thread');
});

test('exact geometry: one worker stopping costs one part, and nothing is meshed on the page thread', async () => {
  const M = load(fakeWorkers(3));
  const text = buildRobot('mecanum-zup').text;
  const cad = M.parseSTEP(text);
  assert.ok(cad.occs && cad.occs.length > 3, 'the fixture has several shapes');
  let onPage = 0;
  M.Tess.mainThread = () => { onPage++; return Promise.reject(new Error('page thread')); };
  const res = await M.Tess.perShape(cad, text);
  assert.equal(onPage, 0, 'no part meshed on the page thread');
  assert.equal(M.Tess.noWorker, undefined, 'workers are still in use');
  assert.equal(res.failedShapes, 1, 'only the stopped worker\'s part is missing');
});

/* Every worker made its own blob URL for the same script and none was ever
   revoked, so each robot's three or four workers (and every replacement for a
   stalled one) kept a blob alive for the life of the page. */
test('exact geometry: the workers share one blob URL, however many are started', async () => {
  const urls = { made: 0, revoked: 0 };
  const M = load(fakeWorkers(3), urls);
  const text = buildRobot('mecanum-zup').text;
  const cad = M.parseSTEP(text);
  M.Tess.mainThread = () => Promise.reject(new Error('page thread'));
  await M.Tess.perShape(cad, text);
  await M.Tess.perShape(cad, text);               // a second robot: a fresh pool
  assert.ok(urls.made - urls.revoked <= 1, `${urls.made} blob URLs made, ${urls.revoked} revoked`);
});
