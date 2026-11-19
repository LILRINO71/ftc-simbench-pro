// The shared leaderboard (functions/leaderboard): a fake KV namespace (get, put, list; expiry
// ignored, so the rate limit keeps its own clock) and fake requests. Submitting, keeping only
// the best per name+robot+mode, the bounds on a score, the name filter, the rate limit, the top
// 50, same-origin only, and the answer when no KV is bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, LIMITS, TOP, RATE, cleanName, cleanLabel, rude } from '../functions/leaderboard/[[path]].js';

const SITE = 'https://ftc-simbench-pro.pages.dev';
function fakeKV() {
  const m = new Map(), log = { puts: [], ttls: [] };
  return {
    m, log,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { m.set(k, String(v)); log.puts.push(k); log.ttls.push(o && o.expirationTtl); },
    async list(o) { const p = (o && o.prefix) || ''; return { keys: [...m.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; },
    async delete(k) { m.delete(k); },
  };
}
const post = (body, o = {}) => new Request(SITE + '/leaderboard', { method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': '203.0.113.9' }, o.headers), body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = (p = '', o = {}) => new Request(SITE + '/leaderboard' + p, { headers: o.headers || {} });
const score = (over = {}) => Object.assign({ name: 'Team 7831', score: 120, mode: 'teleop', robot: 'Meet 0.step', opmode: 'MyTeleOp' }, over);
/* a clock the test moves */
const clock = (t = Date.UTC(2026, 10, 19, 12, 0, 0)) => { const c = { t, now: () => c.t }; return c; };
const call = async (req, env, ctx) => { const r = await handle(req, env, fetch, ctx); return { r, j: await r.json() }; };

test('leaderboard: a score is posted, kept, and read back with the server\'s date', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  const { r, j } = await call(post(score()), env, c);
  assert.equal(r.status, 200);
  assert.equal(j.ok, true); assert.equal(j.improved, true); assert.equal(j.rank, 1);
  assert.deepEqual(j.entry, { name: 'Team 7831', score: 120, mode: 'teleop', robot: 'Meet 0', opmode: 'MyTeleOp', date: '2026-11-19' });
  const g = await call(get('/teleop'), env, c);
  assert.equal(g.r.status, 200);
  assert.deepEqual(g.j.entries, [j.entry]);
  const all = await call(get(), env, c);
  assert.deepEqual(Object.keys(all.j.boards), ['teleop', 'auto']);
  assert.equal(all.j.boards.auto.length, 0);
  assert.deepEqual(all.j.limits, LIMITS);
  assert.equal((await call(get('/nope'), env, c)).r.status, 404);
});

test('leaderboard: one entry per name, robot and mode, keeping the best', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  await call(post(score({ score: 100 })), env, c);
  let x = await call(post(score({ score: 80 })), env, c);
  assert.equal(x.j.improved, false, 'a lower score changes nothing');
  assert.equal(x.j.entries.length, 1);
  assert.equal(x.j.entries[0].score, 100);
  assert.equal(x.j.rank, 1);
  c.t += 86400000;
  x = await call(post(score({ score: 140, opmode: 'Better TeleOp', name: 'TEAM 7831', robot: 'meet 0' })), env, c);
  assert.equal(x.j.improved, true, 'the same name and robot in other capitals is the same entry');
  assert.equal(x.j.entries.length, 1);
  assert.deepEqual([x.j.entries[0].score, x.j.entries[0].opmode, x.j.entries[0].date], [140, 'Better TeleOp', '2026-11-20']);
  // another robot, another mode, another name: separate entries
  await call(post(score({ robot: 'Other.step', score: 50 })), env, c);
  await call(post(score({ name: 'Team 99', score: 60 })), env, c);
  x = await call(post(score({ mode: 'Autonomous', score: 30 })), env, c);
  assert.equal(x.j.entries.length, 1, 'Auto has its own board');
  const g = await call(get('/teleop'), env, c);
  assert.deepEqual(g.j.entries.map((e) => [e.name, e.robot, e.score]), [['TEAM 7831', 'meet 0', 140], ['Team 99', 'Meet 0', 60], ['Team 7831', 'Other', 50]], 'best first, shown as last posted');
});

test('leaderboard: a score is a whole number from 1 up to the most the game gives', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  for (const s of [0, -5, 1.5, NaN, null, '120', 501, 1e9, [], {}]) {
    const x = await call(post(score({ score: s })), env, c);
    assert.equal(x.r.status, 400, 'score ' + JSON.stringify(s));
    assert.equal(x.j.error, 'score');
    c.t += RATE.windowMs;                                           // a new window, so the limit isn't what is tested
  }
  assert.equal((await call(post(score({ score: LIMITS.teleop })), env, c)).r.status, 200, 'the top of the range is allowed');
  c.t += RATE.windowMs;
  assert.equal((await call(post(score({ mode: 'auto', score: LIMITS.auto + 1 })), env, c)).r.status, 400, 'Auto has a lower top');
  c.t += RATE.windowMs;
  assert.equal((await call(post(score({ mode: 'auto', score: LIMITS.auto })), env, c)).r.status, 200);
  c.t += RATE.windowMs;
  assert.equal((await call(post(score({ mode: 'practice' })), env, c)).j.error, 'mode');
  assert.equal((await env.LEADERBOARD.get('board:teleop')).includes('1000000000'), false);
});

test('leaderboard: names are 1-24 letters and numbers, not rude, not an address or a phone number', async () => {
  const okNames = ['7831', 'Team 7831', 'GearGurus 7832', 'Ana-Maria', 'O\'Neil', 'Dickson Robotics', 'Hancock High', 'Scunthorpe Bots', 'Éclair', '机器人 2', 'A', 'x'.repeat(24), 'Team 455', 'Class 2 Bots', 'Glasses 4U'];
  for (const n of okNames) assert.deepEqual(cleanName(n), { name: n }, n);
  const badNames = ['', '   ', 'x'.repeat(25), 'fuck', 'F u C k', 'sh1t', 'fuuuuck', 'b!tch', 'Team nazi', 'nazi', 'dick', 'www.example.com', 'visit foo.com', 'http://x', 'call 5551234567', '<b>hi</b>', 'me@mail', '_name', null, 5, {}];
  for (const n of badNames) assert.ok(cleanName(n).error, 'refused: ' + JSON.stringify(n));
  assert.equal(cleanName('  Team \n  7831 ').name, 'Team 7831', 'spaces and line breaks tidied');
  assert.equal(cleanName('Team\u0007 9').name, 'Team 9', 'control characters out');
  assert.equal(rude('455'), false);
  assert.equal(rude('Hello there'), false);
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  const x = await call(post(score({ name: 'fuck' })), env, c);
  assert.equal(x.r.status, 400); assert.equal(x.j.error, 'name');
  assert.equal(env.LEADERBOARD.m.has('board:teleop'), false, 'nothing was stored');
});

test('leaderboard: the robot and OpMode names are tidied, and a rude or empty one shows as a dash', async () => {
  assert.equal(cleanLabel('REVIVER (Current Bot).step', true), 'REVIVER (Current Bot)');
  assert.equal(cleanLabel('<script>alert(1)</script>'), 'scriptalert(1)/script');
  assert.equal(cleanLabel('x'.repeat(60)).length, 40);
  assert.equal(cleanLabel(''), '—');
  assert.equal(cleanLabel('shit bot'), '—');
  assert.equal(cleanLabel(42), '—');
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  const x = await call(post(score({ robot: 'fuck bot.step', opmode: undefined })), env, c);
  assert.deepEqual([x.j.entry.robot, x.j.entry.opmode], ['—', '—']);
});

test('leaderboard: the same address may post 8 times in 10 minutes, then waits; only a hash of it is kept', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  for (let i = 0; i < RATE.max; i++) {
    const x = await call(post(score({ name: 'Team ' + i, score: 10 + i })), env, c);
    assert.equal(x.r.status, 200, 'post ' + i);
    c.t += 1000;
  }
  const x = await call(post(score({ name: 'Team 9', score: 99 })), env, c);
  assert.equal(x.r.status, 429);
  assert.equal(x.j.error, 'rate');
  assert.ok(+x.r.headers.get('Retry-After') > 0 && +x.r.headers.get('Retry-After') <= 600);
  assert.equal(JSON.parse(await env.LEADERBOARD.get('board:teleop')).length, RATE.max, 'the refused one is not on the board');
  // another address is not held up
  const y = await call(post(score({ name: 'Elsewhere' }), { headers: { 'CF-Connecting-IP': '198.51.100.4' } }), env, c);
  assert.equal(y.r.status, 200);
  // after the window the first address may post again
  c.t += RATE.windowMs;
  assert.equal((await call(post(score({ name: 'Team 9', score: 99 })), env, c)).r.status, 200);
  // what was stored about the address: a key with a hash, never the address
  const keys = [...env.LEADERBOARD.m.keys()].filter((k) => k.startsWith('rl:'));
  assert.equal(keys.length, 2);
  for (const k of keys) { assert.match(k, /^rl:[0-9a-f]{24}$/); assert.ok(!k.includes('203') && !k.includes('198')); }
  for (const v of env.LEADERBOARD.m.values()) assert.ok(!v.includes('203.0.113.9') && !v.includes('198.51.100.4'), 'no address anywhere in the store');
  assert.ok(env.LEADERBOARD.log.ttls.filter(Boolean).every((t) => t >= 60 && t <= 600), 'rate keys expire (KV needs 60 s at least)');
});

test('leaderboard: a bad post still counts against the address, so junk can\'t be hammered in', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  for (let i = 0; i < RATE.max; i++) assert.equal((await call(post('{nope'), env, c)).r.status, 400);
  assert.equal((await call(post(score()), env, c)).r.status, 429);
});

test('leaderboard: the top 50 only; a score below the 50th doesn\'t get on', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  const seed = []; for (let i = 0; i < TOP; i++) seed.push({ name: 'P' + i, score: 100 + i, mode: 'teleop', robot: 'r', opmode: 'o', date: '2026-11-01' });
  await env.LEADERBOARD.put('board:teleop', JSON.stringify(seed));
  let x = await call(post(score({ score: 50 })), env, c);
  assert.equal(x.j.rank, null, 'too low for the 50');
  assert.equal(x.j.improved, false);
  assert.equal(x.j.entries.length, TOP);
  c.t += RATE.windowMs;
  x = await call(post(score({ score: 101 })), env, c);
  assert.equal(x.j.rank, TOP, 'level with the 49th, which was there first, so last; the old 50th falls off');
  assert.equal(x.j.entries.length, TOP);
  assert.ok(!x.j.entries.some((e) => e.name === 'P0'));
  assert.equal(x.j.entries[0].score, 149);
  // equal scores: the older one is ahead
  c.t += RATE.windowMs;
  x = await call(post(score({ name: 'Late', score: 149 })), env, c);
  assert.equal(x.j.entries[0].name, 'P49'); assert.equal(x.j.entries[1].name, 'Late');
});

test('leaderboard: only this site\'s own pages may use it', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  assert.equal((await call(post(score(), { headers: { Origin: 'https://evil.example' } }), env, c)).r.status, 403);
  assert.equal((await call(post(score(), { headers: { Origin: null } }), env, c)).r.status, 403, 'a post says where it is from');
  const noOrigin = new Request(SITE + '/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(score()) });
  assert.equal((await call(noOrigin, env, c)).r.status, 403);
  assert.equal((await call(get('', { headers: { Origin: 'https://evil.example' } }), env, c)).r.status, 403);
  assert.equal((await call(get('', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), env, c)).r.status, 403);
  assert.equal((await call(get('', { headers: { 'Sec-Fetch-Site': 'same-origin' } }), env, c)).r.status, 200);
  assert.equal((await call(get(), env, c)).r.status, 200, 'a plain same-origin GET sends no Origin');
  assert.equal(env.LEADERBOARD.m.size, 0, 'nothing from the refused ones was written');
  assert.equal((await call(new Request(SITE + '/leaderboard', { method: 'DELETE', headers: { Origin: SITE } }), env, c)).r.status, 405);
});

test('leaderboard: too big or not JSON is refused', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  assert.equal((await call(post('x'.repeat(3000)), env, c)).r.status, 413);
  assert.equal((await call(post('[1,2]'), env, c)).j.error, 'json');
  assert.equal((await call(post('null'), env, c)).j.error, 'json');
});

test('leaderboard: with no KV bound, every route says "not set up" with a 501', async () => {
  for (const env of [{}, { LEADERBOARD: undefined }, undefined]) {
    for (const req of [get(), get('/teleop'), post(score())]) {
      const x = await call(req, env, clock());
      assert.equal(x.r.status, 501);
      assert.deepEqual(x.j, { error: 'not set up' });
    }
  }
});

test('leaderboard: a damaged board in KV reads as empty instead of failing', async () => {
  const env = { LEADERBOARD: fakeKV() }, c = clock();
  await env.LEADERBOARD.put('board:teleop', '{not json');
  assert.deepEqual((await call(get('/teleop'), env, c)).j.entries, []);
  await env.LEADERBOARD.put('board:auto', JSON.stringify([{ name: 5 }, null, { name: 'ok', score: 12, robot: 'r', opmode: 'o', date: '2026-01-01' }]));
  assert.deepEqual((await call(get('/auto'), env, c)).j.entries.map((e) => e.name), ['ok']);
});
