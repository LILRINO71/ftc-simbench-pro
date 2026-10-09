// The engine worker (src/engineworker.js): a robot is read off the page's thread,
// and anywhere the worker can't run, on the page instead. A zip's bytes are handed
// to the worker, not copied, so they must only be handed to a worker whose engine
// actually loaded: one that never did (an old page after a deploy, a blocked file)
// used to take the bytes, die, and report "the browser ran out of memory".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'engineworker.js'), 'utf8');

/* EngineWorker on a page whose Worker is a stand-in: `engine` says whether
   importScripts of the engine works in it. */
function page({ engine }) {
  const seen = { local: [], posted: [] };
  class FakeWorker {
    constructor() {
      setTimeout(() => {
        if (!engine) { this.onerror && this.onerror({ message: 'NetworkError: importScripts failed', preventDefault() {} }); return; }
        this.onmessage && this.onmessage({ data: { ready: true } });
      }, 5);
    }
    postMessage(msg, transfer) {
      // a real transfer: the page's copy of the bytes is gone
      const got = structuredClone(msg, { transfer: transfer || [] });
      seen.posted.push(got);
      setTimeout(() => this.onmessage && this.onmessage({ data: { id: got.id, ok: true, cad: { name: 'from the worker' }, notes: [], name: 'from the worker' } }), 5);
    }
    terminate() {}
  }
  const ctx = {
    Worker: FakeWorker, Blob: class { constructor(p) { this.p = p; } }, URL: Object.assign(URL, { createObjectURL: () => 'blob:x' }),
    location: { href: 'https://sb.test/', protocol: 'https:' }, SIMBENCH_ENGINE_URL: 'engine-abc.js',
    setTimeout, Promise, Error, Object, Uint8Array, structuredClone,
    urdfRobotFromZip: async (bytes, name) => { seen.local.push({ name, size: bytes.byteLength }); return { cad: { name: 'on the page', onshape: { why: [] } } }; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.EngineWorker = EngineWorker;', ctx);
  return { EW: ctx.EngineWorker, seen };
}

test('engine worker: a worker whose engine never loaded gets no bytes; the zip is read on the page', async () => {
  const { EW, seen } = page({ engine: false });
  const zip = new Uint8Array(1000).fill(7);
  const r = await EW.urdfZip(zip, 'robot.zip', {});
  assert.equal(r.cad.name, 'on the page');
  assert.deepEqual(seen.local, [{ name: 'robot.zip', size: 1000 }], 'the page read the whole zip');
  assert.equal(seen.posted.length, 0, 'nothing was handed to the dead worker');
});

test('engine worker: a worker whose engine loaded takes the job, bytes handed over', async () => {
  const { EW, seen } = page({ engine: true });
  const zip = new Uint8Array(1000).fill(7);
  const r = await EW.urdfZip(zip, 'robot.zip', {});
  assert.equal(r.cad.name, 'from the worker');
  assert.equal(seen.local.length, 0);
  assert.equal(seen.posted[0].op, 'urdfzip');
  assert.equal(zip.byteLength, 0, 'handed over, not copied');
});
