// The leaderboard on the page (src/leaderboard.js): personal bests per robot, OpMode and
// mode, merging the shared board with this player's own score, the card's HTML (with
// hostile names), and Board run against a fake fetch, store and card: silent when the
// site has no shared board, posting when it has, and agreeing with the server's limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, TOP } from '../functions/leaderboard/[[path]].js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'leaderboard.js'), 'utf8');
const NAMES = ['LB_MAX', 'LB_TOP', 'lbMode', 'lbName', 'lbNorm', 'lbId', 'lbEsc', 'lbPbRead', 'lbPbUpdate', 'lbPbList', 'lbRank', 'lbMerge', 'lbCardHtml', 'Board'];
const load = (env = {}) => new Function('store', 'fetch', 'location', SRC + `\nreturn { ${NAMES.join(', ')} };`)(env.store, env.fetch, env.location);
const L = load({ store: { get: () => null, set() {} } });

test('leaderboard: the client\'s limits are the server\'s', () => {
  assert.deepEqual(L.LB_MAX, LIMITS);
  assert.equal(L.LB_TOP, TOP);
});

test('personal best: one per robot, OpMode and mode; beaten only by more; a name written two ways is one', () => {
  let m = {};
  let u = L.lbPbUpdate(m, { robot: 'Meet 0.step', opmode: 'MyTeleOp', mode: 'teleop', score: 80, when: '2026-11-01' });
  assert.equal(u.isNew, true); assert.equal(u.prev, null); m = u.map;
  u = L.lbPbUpdate(m, { robot: 'meet 0', opmode: 'myteleop', mode: 'TeleOp', score: 60, when: '2026-11-02' });
  assert.equal(u.isNew, false, 'lower: not a best'); assert.equal(u.best.score, 80); m = u.map;
  u = L.lbPbUpdate(m, { robot: 'Meet 0.step', opmode: 'MyTeleOp', mode: 'teleop', score: 80, when: '2026-11-03' });
  assert.equal(u.isNew, false, 'a tie is not a new best'); assert.equal(u.best.when, '2026-11-01');
  u = L.lbPbUpdate(m, { robot: 'Meet 0.step', opmode: 'MyTeleOp', mode: 'teleop', score: 95, when: '2026-11-04' });
  assert.equal(u.isNew, true); assert.equal(u.prev.score, 80); assert.equal(u.best.score, 95); m = u.map;
  assert.equal(Object.keys(m).length, 1);
  // another OpMode, another robot, another mode: each its own
  for (const o of [{ opmode: 'Other' }, { robot: 'Revived' }, { mode: 'auto' }]) {
    u = L.lbPbUpdate(m, Object.assign({ robot: 'Meet 0', opmode: 'MyTeleOp', mode: 'teleop', score: 10, when: '2026-11-05' }, o));
    assert.equal(u.isNew, true); m = u.map;
  }
  assert.equal(Object.keys(m).length, 4);
  // nothing scored is no best, and the input isn't changed
  const before = JSON.stringify(m);
  u = L.lbPbUpdate(m, { robot: 'Zero', opmode: 'z', mode: 'teleop', score: 0 });
  assert.equal(u.isNew, false); assert.equal(JSON.stringify(m), before); assert.equal(Object.keys(u.map).length, 4);
  assert.equal(L.lbMode('Autonomous'), 'auto'); assert.equal(L.lbMode('TeleOp'), 'teleop'); assert.equal(L.lbMode(undefined), 'teleop');
});

test('personal best: reading what is stored survives junk, and the list puts this run first then newest', () => {
  assert.deepEqual(L.lbPbRead('{nope'), {});
  assert.deepEqual(L.lbPbRead('[1,2]'), {});
  assert.deepEqual(L.lbPbRead(null), {});
  const r = L.lbPbRead(JSON.stringify({ a: { robot: 'R', opmode: 'O', mode: 'auto', score: 12, when: '2026-01-01T00:00:00Z' }, b: { score: 'x' }, c: null, d: { score: 0 }, e: { score: 7.5 } }));
  assert.deepEqual(Object.keys(r), ['a']);
  assert.equal(r.a.when, '2026-01-01'); assert.equal(r.a.posted, 0);
  const map = { x: { robot: 'A', opmode: 'o', mode: 'teleop', score: 50, when: '2026-01-05' }, y: { robot: 'B', opmode: 'o', mode: 'teleop', score: 90, when: '2026-01-01' },
    z: { robot: 'C', opmode: 'o', mode: 'auto', score: 20, when: '2026-01-09' } };
  assert.deepEqual(L.lbPbList(map, 'y').map((b) => b.id), ['y', 'z', 'x'], 'this run, then newest');
  assert.equal(L.lbPbList(map, null, 2).length, 2);
  // at most 200 are kept, the oldest go, the one just set never
  let m = {}; for (let i = 0; i < 205; i++) m = L.lbPbUpdate(m, { robot: 'R' + i, opmode: 'o', mode: 'teleop', score: 5, when: '2026-01-' + String(1 + (i % 28)).padStart(2, '0') }).map;
  assert.equal(Object.keys(m).length, 200);
});

test('shared board: rank among the entries, level scores behind the ones already there, nothing past the top 50', () => {
  const e = (n, s) => ({ name: n, score: s, robot: 'R', opmode: 'o', date: '2026-11-01' });
  const E = [e('a', 90), e('b', 70), e('c', 70), e('d', 10)];
  assert.equal(L.lbRank(E, 100), 1);
  assert.equal(L.lbRank(E, 70), 4, 'behind both 70s');
  assert.equal(L.lbRank(E, 5), 5);
  assert.equal(L.lbRank([], 5), 1);
  const full = Array.from({ length: 50 }, (_, i) => e('p' + i, 100 - i));
  assert.equal(L.lbRank(full, 40), null, 'not in the top 50');
  assert.equal(L.lbRank(full, 52), 50);
  assert.equal(L.lbRank(full, 51), null, 'level with the 50th, which was there first');
});

test('shared board: this player\'s own row is marked, and a better score than the board holds says where it would go', () => {
  const E = [{ name: 'Team 7831', score: 90, robot: 'Meet 0', opmode: 'o', date: 'd' }, { name: 'Other', score: 70, robot: 'Meet 0', opmode: 'o', date: 'd' }, { name: 'Team 7831', score: 60, robot: 'Revived', opmode: 'o', date: 'd' }];
  let g = L.lbMerge(E, { name: ' team 7831 ', robot: 'Meet 0.step', score: 90 });
  assert.deepEqual(g.rows.map((r) => r.me), [true, false, false], 'same name and robot, in any capitals, with or without the file ending');
  assert.deepEqual(g.mine, { rank: 1, posted: true, better: 0 });
  g = L.lbMerge(E, { name: 'Team 7831', robot: 'Meet 0', score: 75 });
  assert.equal(g.mine.posted, true, 'the board already has more');
  g = L.lbMerge(E, { name: 'Team 7831', robot: 'Revived', score: 80 });
  assert.deepEqual(g.mine, { rank: 2, posted: false, better: 60 }, 'it would go second, replacing its 60');
  assert.equal(g.rows[2].me, true);
  g = L.lbMerge(E, { name: 'New team', robot: 'X', score: 80 });
  assert.deepEqual(g.mine, { rank: 2, posted: false, better: 0 });
  assert.equal(g.rows.some((r) => r.me), false);
  assert.equal(L.lbMerge(E, null).mine, null);
  assert.equal(L.lbMerge(E, { name: '', robot: 'X', score: 1 }).mine, null, 'no name yet: nothing to match');
  assert.equal(L.lbMerge([], { name: 'a', robot: 'b', score: 5 }).mine.rank, 1);
  assert.deepEqual(L.lbMerge(undefined, null), { rows: [], mine: null });
});

test('the card: names from the board are escaped, the post form shows only when there is something to post', () => {
  const rows = [{ rank: 1, name: '<img src=x onerror=alert(1)>', score: 9, robot: '"><script>', opmode: 'o', date: 'd', me: false }];
  const h = L.lbCardHtml({ mode: 'teleop', runScore: 40, isNew: true, bests: [{ id: 'a', now: true, robot: '<b>R</b>', opmode: "o'", mode: 'teleop', score: 40 }],
    shared: { rows, mine: { rank: 1, posted: false, better: 0 } }, name: '"><x', msg: '<i>hi</i>' });
  assert.ok(!/<img|<script|<b>R|<x|<i>hi/.test(h), 'no tag from a name got through: ' + h);
  assert.match(h, /&lt;img/);
  assert.match(h, /Post 40/);
  assert.match(h, /It would be #1/);
  assert.match(h, /<i>new<\/i>/);
  const none = L.lbCardHtml({ mode: 'auto', runScore: 0, isNew: false, bests: [], shared: { rows: [], mine: null }, name: '' });
  assert.match(none, /Nobody has posted a Auto score yet/);
  assert.ok(!/lbForm/.test(none), 'a zero score has nothing to post');
  const noBoard = L.lbCardHtml({ mode: 'teleop', runScore: 40, isNew: false, bests: [{ id: 'a', now: true, robot: 'R', opmode: 'O', mode: 'teleop', score: 40 }], shared: null, name: '' });
  assert.ok(!/Shared board|lbForm/.test(noBoard), 'no shared board, no mention of one');
  assert.match(noBoard, /Your best scores/);
  const posted = L.lbCardHtml({ mode: 'teleop', runScore: 40, bests: [], shared: { rows: [{ rank: 3, name: 'me', score: 40, robot: 'R', me: true }], mine: { rank: 3, posted: true, better: 0 } }, name: 'me' });
  assert.match(posted, /You are #3/); assert.ok(!/lbForm/.test(posted));
  // a player far down the board still sees their own row
  const many = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, name: 'p' + i, score: 100 - i, robot: 'R', me: i === 14 }));
  const far = L.lbCardHtml({ mode: 'teleop', runScore: 5, bests: [], shared: { rows: many, mine: { rank: 15, posted: true, better: 0 } }, name: 'p14' });
  assert.match(far, /class="gap"/); assert.match(far, /class="me"/);
});

/* a card, a store and a fetch that answers as a site would */
function page({ board = 'ready', post = null } = {}) {
  const mem = new Map(), calls = [], store = { get: (k, d) => mem.has(k) ? mem.get(k) : d, set: (k, v) => mem.set(k, v) };
  const el = { innerHTML: '', handlers: {}, addEventListener(t, f) { this.handlers[t] = f; },
    querySelector(q) { return q === '#lbName' ? { value: el.typed } : null; }, typed: '' };
  const boards = { teleop: [{ name: 'Other', score: 70, mode: 'teleop', robot: 'R', opmode: 'o', date: '2026-11-18' }], auto: [] };
  const fetch = async (u, o) => {
    calls.push({ u, method: o && o.method || 'GET', body: o && o.body });
    if (board === 'off') return { ok: false, status: 501, headers: { get: () => 'application/json' }, json: async () => ({ error: 'not set up' }) };
    if (board === 'down') throw new Error('offline');
    if (board === 'html') return { ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new Error('not json'); } };
    if (o && o.method === 'POST') return post ? post(JSON.parse(o.body)) : { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, improved: true, rank: 1, entries: [{ name: JSON.parse(o.body).name, score: JSON.parse(o.body).score, mode: 'teleop', robot: JSON.parse(o.body).robot.replace(/[.]step$/, ''), opmode: 'o', date: 'd' }].concat(boards.teleop) }) };
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ boards }) };
  };
  return { mem, calls, store, el, fetch, B: load({ store, fetch }).Board };
}
const settle = () => new Promise((r) => setTimeout(r, 5));
const META = { robot: 'Meet 0.step', opmode: 'MyTeleOp', period: 'TeleOp' };

test('Board: with no shared board (501, offline, or a page that isn\'t JSON) the card shows personal bests and says nothing about a board', async () => {
  for (const board of ['off', 'down', 'html']) {
    const P = page({ board }), rec = P.B.record(META, 55);
    assert.equal(rec.isNew, true);
    P.B.show(P.el, rec); await settle();
    assert.equal(P.B.state, 'off', board);
    assert.match(P.el.innerHTML, /Your best scores/);
    assert.match(P.el.innerHTML, /<b>55<\/b>/);
    assert.ok(!/Shared board|Post |lbForm/.test(P.el.innerHTML), board + ': no mention of a shared board');
    assert.equal(P.calls.filter((c) => c.method === 'POST').length, 0);
  }
});

test('Board: personal bests are stored and come back; a lower score keeps the best', () => {
  const P = page();
  assert.equal(P.B.record(META, 55).isNew, true);
  const again = P.B.record(META, 40);
  assert.equal(again.isNew, false); assert.equal(again.best.score, 55);
  const higher = P.B.record(META, 70);
  assert.equal(higher.isNew, true); assert.equal(higher.prev.score, 55);
  assert.equal(P.B.record(Object.assign({}, META, { period: 'Autonomous' }), 12).isNew, true, 'Auto is its own best');
  const stored = JSON.parse(P.mem.get('ftcbench.lb.pb'));
  assert.deepEqual(Object.values(stored).map((s) => [s.mode, s.score]).sort(), [['auto', 12], ['teleop', 70]]);
});

test('Board: with a shared board the card lists it, posts only when the player presses Post, and shows the rank back', async () => {
  const P = page(), rec = P.B.record(META, 90);
  P.mem.set('ftcbench.netName', 'Team 7831');                       // the name from the online panel is offered
  P.B.show(P.el, rec); await settle();
  assert.equal(P.B.state, 'ready');
  assert.match(P.el.innerHTML, /Shared board · TeleOp/);
  assert.match(P.el.innerHTML, /Other/);
  assert.match(P.el.innerHTML, /value="Team 7831"/);
  assert.match(P.el.innerHTML, /It would be #1/);
  assert.equal(P.calls.filter((c) => c.method === 'POST').length, 0, 'nothing posted by itself');
  assert.equal(typeof P.el.handlers.submit, 'function');
  P.el.typed = '   ';
  await P.B.post();
  assert.match(P.el.innerHTML, /Put a name in first/);
  assert.equal(P.calls.filter((c) => c.method === 'POST').length, 0);
  P.el.typed = '  Team 7831 ';
  await P.B.post();
  const sent = P.calls.find((c) => c.method === 'POST');
  assert.equal(sent.u, '/leaderboard');
  assert.deepEqual(JSON.parse(sent.body), { name: 'Team 7831', score: 90, mode: 'teleop', robot: 'Meet 0.step', opmode: 'MyTeleOp' }, 'exactly these five things');
  assert.match(P.el.innerHTML, /Posted\. You are #1/);
  assert.match(P.el.innerHTML, /You are #1 on the board/, 'the form gives way to the rank');
  assert.equal(P.mem.get('ftcbench.lbName'), 'Team 7831', 'the name is remembered');
  assert.equal(JSON.parse(P.mem.get('ftcbench.lb.pb'))[rec.id].posted, 90, 'and that it was posted');
  // the next time the same score comes up, it is known to be on the board
  const P2 = page(); P2.mem.set('ftcbench.lb.pb', P.mem.get('ftcbench.lb.pb')); P2.mem.set('ftcbench.lbName', 'Team 7831');
  const r2 = P2.B.record(META, 50);
  assert.equal(r2.best.posted, 90);
});

test('Board: a refusal from the board is shown in its words and the card stays usable; a dead network says so', async () => {
  const P = page({ post: () => ({ ok: false, status: 429, headers: { get: () => 'application/json' }, json: async () => ({ error: 'rate', message: 'Too many scores from this connection. Try again in 6 minutes.' }) }) });
  P.B.show(P.el, P.B.record(META, 90)); await settle();
  P.el.typed = 'Me'; await P.B.post();
  assert.match(P.el.innerHTML, /Try again in 6 minutes/);
  assert.match(P.el.innerHTML, /lbForm/, 'the form is still there');
  const Q = page({ post: () => { throw new Error('offline'); } });
  Q.B.show(Q.el, Q.B.record(META, 90)); await settle();
  Q.el.typed = 'Me'; await Q.B.post();
  assert.match(Q.el.innerHTML, /Couldn(&#39;|')t reach the board/);
  assert.equal(Q.B.busy, false);
});
