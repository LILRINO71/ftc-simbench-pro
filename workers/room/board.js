/* ============================================================
   THE SHARED LEADERBOARD AS A DURABLE OBJECT (bound to the site as BOARDS)
   Workers KV has no transactions and is eventually consistent, so the board
   (one value per mode) and each address's post counter, both read, changed
   and written back, lost scores and skipped the rate limit when posts
   overlapped (audit F6). Here one object holds both: every request to the
   board goes to the one instance named "leaderboard", which answers them one
   at a time against its own storage, read and written in order.

   The rules are functions/leaderboard's handle(), run unchanged against this
   object's storage, so the KV board and this one can never disagree on what a
   valid post is. Lives in the rooms Worker (workers/room/index.js) so the site
   needs no second Worker; DEPLOY.md, "Shared leaderboard".
   ============================================================ */
import { handle, RATE } from '../../functions/leaderboard/[[path]].js';

/* one at a time: each call waits for the one before it to finish, failed or not */
export function serial() {
  let tail = Promise.resolve();
  return (fn) => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run; };
}

/* the object's storage as the small part of a KV namespace handle() uses. An address
   counter's expiry is its own t0 + window; sweepRates() deletes the ones past it. */
export function storageKV(storage) {
  return {
    async get(k) { const v = await storage.get(k); return v === undefined ? null : v; },
    async put(k, v) { await storage.put(k, String(v)); },
  };
}
export async function sweepRates(storage, now) {
  const old = [];
  for (const [k, v] of await storage.list({ prefix: 'rl:' })) {
    let t0 = NaN; try { t0 = JSON.parse(v).t0; } catch (e) {}
    if (!(now - t0 < RATE.windowMs)) old.push(k);
  }
  for (const k of old) await storage.delete(k);
  return old.length;
}

export class BoardDO {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env || {};
    this.one = serial();
    this.kv = storageKV(ctx.storage);
    this.posts = 0;
  }
  fetch(request) {
    return this.one(async () => {
      const r = await handle(request, { LEADERBOARD: this.kv, LEADERBOARD_SALT: this.env.LEADERBOARD_SALT }, null, null);
      // counters of addresses that stopped posting would pile up: clear them now and then
      if (request.method === 'POST' && ++this.posts % 50 === 0) await sweepRates(this.ctx.storage, Date.now());
      return r;
    });
  }
}
