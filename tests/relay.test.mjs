// Match rooms on the app's own origin (workers/room/room.js, functions/room,
// src/netrelay.js): the room relays and refuses what it should, the Pages
// Function routes and guards it, and a whole online match plays over it,
// by WebSocket and by Server-Sent Events, with the real match protocol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField } from './load.mjs';
import { RoomCore, RoomDO, packBin, unpackBin } from '../workers/room/room.js';
import { handle } from '../functions/room/[[path]].js';

const E = loadEngine();
/* a connection the room can talk to, that records what it heard */
const T = (id) => (id + 'secret-token-0123456789').slice(0, 24);
const conn = (kind = 'ws') => { const heard = []; return { kind, heard, send: (d) => heard.push(typeof d === 'string' ? JSON.parse(d) : unpackBin(d)), close() {} }; };

test('room: arrivals learn who is there, everyone hears arrivals and departures', () => {
  const R = new RoomCore('m-ABCDE'), a = conn(), b = conn();
  assert.equal(R.join('alice', a, T('alice')), null);
  assert.equal(R.join('bobby', b, T('bobby')), null);
  assert.deepEqual(a.heard[0].peers, []);
  assert.deepEqual(b.heard[0].peers, ['alice']);
  assert.deepEqual(a.heard[1], { t: 'join', id: 'bobby' });
  R.leave('bobby');
  assert.deepEqual(a.heard.at(-1), { t: 'leave', id: 'bobby' });
});

test('room: messages go to everyone else, or to the players named, from who really sent them', () => {
  const R = new RoomCore('r'), a = conn(), b = conn(), c = conn();
  R.join('aaaa', a, T('aaaa')); R.join('bbbb', b, T('bbbb')); R.join('cccc', c, T('cccc'));
  R.text('aaaa', JSON.stringify({ t: 'm', d: { k: 'hi' }, from: 'cccc' }));
  assert.deepEqual(b.heard.at(-1), { t: 'm', from: 'aaaa', d: { k: 'hi' } }, 'a sender can\'t pretend to be someone else');
  assert.deepEqual(c.heard.at(-1), { t: 'm', from: 'aaaa', d: { k: 'hi' } });
  assert.ok(!a.heard.some((m) => m.t === 'm'), 'not echoed');
  R.text('bbbb', JSON.stringify({ t: 'm', to: ['cccc'], d: 1 }));
  assert.equal(c.heard.at(-1).d, 1);
  assert.notEqual(a.heard.at(-1).from, 'bbbb');
  R.bin('aaaa', packBin({ to: ['bbbb'], meta: { k: 'mdl' } }, new Uint8Array([9, 8, 7])));
  const got = b.heard.at(-1);
  assert.deepEqual(got.header, { t: 'b', from: 'aaaa', meta: { k: 'mdl' } });
  assert.deepEqual([...got.payload], [9, 8, 7]);
});

test('room: a taken id, a full room, a bad id, oversize, junk and floods are refused', () => {
  const R = new RoomCore('r', { limits: { peers: 2, burst: 5, ratePerSec: 1, textBytes: 100 } });
  const a = conn(), b = conn();
  assert.equal(R.join('aaaa', a, T('aaaa')), null);
  assert.equal(R.join('aaaa', conn(), 'someone-elses-secret-000'), 'taken', 'an id is its secret holder\'s');
  assert.equal(R.join('dddd', conn(), 'short'), 'bad-token');
  assert.equal(R.join('x', conn(), T('x')), 'bad-id');
  assert.equal(R.join('bbbb', b, T('bbbb')), null);
  assert.equal(R.join('cccc', conn(), T('cccc')), 'full');
  R.text('aaaa', JSON.stringify({ t: 'm', d: 'x'.repeat(200) }));
  assert.equal(a.heard.at(-1).why, 'too-big');
  R.text('aaaa', '{nope');
  assert.equal(a.heard.at(-1).why, 'bad-json');
  for (let i = 0; i < 10; i++) R.text('aaaa', JSON.stringify({ t: 'm', d: i }));
  assert.equal(a.heard.at(-1).why, 'slow-down');
  assert.ok(b.heard.filter((m) => m.t === 'm').length <= 5, 'a flood is cut off at the burst');
  R.bin('aaaa', new Uint8Array([255, 255, 255, 255, 1]));
  assert.ok(['bad-frame', 'slow-down'].includes(a.heard.at(-1).why));
});

test('room: the clock, and the lockstep ledger replayed to a player who comes back', () => {
  let t = 5000; const R = new RoomCore('r', { now: () => t }), a = conn(), b = conn();
  R.join('aaaa', a, T('aaaa')); R.join('bbbb', b, T('bbbb'));
  R.text('aaaa', JSON.stringify({ t: 'time', echo: 42 }));
  assert.deepEqual(a.heard.at(-1), { t: 'time', now: 5000, echo: 42 });
  for (let k = 0; k < 5; k++) { R.text('aaaa', JSON.stringify({ t: 'cmd', tick: k, d: 'A' + k })); R.text('bbbb', JSON.stringify({ t: 'cmd', tick: k, d: 'B' + k })); }
  R.text('aaaa', JSON.stringify({ t: 'cmd', tick: 2, d: 'changed my mind' }));
  assert.equal(b.heard.filter((m) => m.t === 'cmd').length, 5, 'a tick is said once');
  R.leave('bbbb'); const b2 = conn(); R.join('bbbb', b2, T('bbbb'));
  R.text('bbbb', JSON.stringify({ t: 'replay', from: 3 }));
  const rep = b2.heard.find((m) => m.t === 'replay');
  assert.deepEqual(rep.rows, [[3, [['aaaa', 'A3'], ['bbbb', 'B3']]], [4, [['aaaa', 'A4'], ['bbbb', 'B4']]]]);
  assert.equal(rep.done, true);
});

test('pages function: health, TURN, routing, and another site can\'t borrow the rooms', async () => {
  const req = (path, init) => new Request('https://sb.example' + path, init);
  let r = await handle(req('/room/health'), {});
  assert.deepEqual(await r.json(), { ready: false, turn: false });
  r = await handle(req('/room/m-AAAAA/ws?id=abcd1234'), {});
  assert.equal(r.status, 501, 'no rooms bound: the page keeps using WebRTC');
  const seen = [];
  const ROOMS = { idFromName: (n) => 'id:' + n, get: (id) => ({ fetch: (q) => { seen.push([id, new URL(q.url).pathname]); return new Response('ok'); } }) };
  r = await handle(req('/room/m-AAAAA/ws?id=abcd1234'), { ROOMS });
  assert.deepEqual(seen, [['id:m-AAAAA', '/room/m-AAAAA/ws']]);
  r = await handle(req('/room/m-AAAAA/ws?id=abcd1234', { headers: { Origin: 'https://evil.example' } }), { ROOMS });
  assert.equal(r.status, 403);
  r = await handle(req('/room/..%2Fx/ws?id=abcd1234'), { ROOMS });
  assert.equal(r.status, 400);
  r = await handle(req('/room/turn'), {});
  assert.equal((await r.json()).turn, false);
  const fetchImpl = async (u, init) => { assert.match(u, /keys\/KEY\/credentials\/generate-ice-servers$/); assert.equal(init.headers.Authorization, 'Bearer TOK');
    return new Response(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }, { urls: ['turns:turn.cloudflare.com:443?transport=tcp', 'turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' }] }), { status: 201 }); };
  r = await handle(req('/room/turn'), { TURN_KEY_ID: 'KEY', TURN_KEY_API_TOKEN: 'TOK' }, fetchImpl);
  const j = await r.json();
  assert.equal(j.turn, true);
  assert.deepEqual(j.iceServers[1].urls, ['turns:turn.cloudflare.com:443?transport=tcp'], 'port 53 dropped, TURN over 443 kept');
});

/* ---- the client, against rooms running in this process ----
   FakeWS and FakeES stand in for the browser's WebSocket and EventSource;
   everything they send goes through a queue the test flushes. */
function relayHub(opts = {}) {
  const rooms = new Map(), queue = [], timers = [];
  const room = (n) => rooms.get(n) || rooms.set(n, new RoomCore(n)).get(n);
  const parse = (u) => { const x = new URL(u); const m = /^\/room\/([^/]+)\/(ws|sse|send)$/.exec(x.pathname); return { name: decodeURIComponent(m[1]), id: x.searchParams.get('id'), tok: x.searchParams.get('tok') }; };
  class FakeWS {
    constructor(url) {
      this.readyState = 0; const { name, id } = parse(url.replace(/^ws/, 'http')); this.name = name; this.id = id;
      if (opts.blockWs) { queue.push(() => { this.readyState = 3; this.onclose && this.onclose({}); }); return; }
      const { tok } = parse(url.replace(/^ws/, 'http'));
      if (opts.stallWs) return;                  // a proxy that holds the upgrade: never opens, never closes
      queue.push(() => { this.readyState = 1; const why = room(name).join(id, this.conn = { kind: 'ws', close: () => {}, send: (d) => queue.push(() => this.onmessage && this.onmessage({ data: typeof d === 'string' ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) })) }, tok);
        if (why) { this.readyState = 3; this.onclose && this.onclose({}); } });
    }
    send(d) { queue.push(() => { const R = room(this.name); if (typeof d === 'string') R.text(this.id, d); else R.bin(this.id, d); }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; hub.closed.push('ws'); queue.push(() => { this.onclose && this.onclose({}); room(this.name).leave(this.id, this.conn); }); }
  }
  class FakeES {
    constructor(url) { const { name, id, tok } = parse(url); this.name = name; this.id = id; hub.streams++;
      queue.push(() => { const why = room(name).join(id, this.conn = { kind: 'sse', close: () => {}, send: (s) => queue.push(() => this.onmessage && this.onmessage({ data: s })) }, tok); if (why) queue.push(() => this.onerror && this.onerror({})); }); }
    close() { queue.push(() => room(this.name).leave(this.id, this.conn)); }
  }
  const fetch = async (u, init) => { const { name, id, tok } = parse(u); hub.posts.push(init.headers['Content-Type']);
    if (!room(name).owns(id, tok)) return { ok: false, status: 403, json: async () => ({}) };
    queue.push(() => { if (/octet-stream/.test(init.headers['Content-Type'])) room(name).bin(id, init.body); else room(name).text(id, init.body); });
    return { ok: true, json: async () => ({}) }; };
  const setTimeout = (f, ms) => { const t = { f, ms, alive: true }; timers.push(t); return t; };
  const clearTimeout = (t) => { if (t) t.alive = false; };
  const hub = {
    rooms, queue, streams: 0, posts: [], closed: [],
    endpoint(id, tok) { return E.netRelay({ base: 'https://sb.example', self: id, tok, WebSocket: FakeWS, EventSource: FakeES, fetch, setTimeout, clearTimeout, sse: opts.sse }); },
    // deliver everything, firing timers that are due as if their time had come
    flush() { for (let g = 0; g < 2000; g++) { if (queue.length) { queue.shift()(); continue; } const t = timers.find((x) => x.alive); if (!t) break; t.alive = false; t.f(); } },
  };
  return hub;
}

for (const mode of ['WebSocket', 'SSE', 'SSE after a stripped WebSocket']) {
  test('relay (' + mode + '): a host and a guest meet in the lobby, take places, start, and see each other drive', () => {
    const hub = relayHub({ sse: mode === 'SSE', blockWs: mode === 'SSE after a stripped WebSocket' });
    const mk = (id) => { const X = loadWithField(), clock = { t: 1_000_000 }; X.Online.now = () => clock.t; X.Online.use(hub.endpoint(id));
      const sim = { chassis: { x: 0, y: 0, h: 0 }, footprint: { hx: 0.2286, hy: 0.2286, ox: 0, oy: 0 }, obstacles: X.Field.obstacles(0.4), vel: { x: 0, y: 0 } };
      return { E: X, O: X.Online, clock, sim, id }; };
    const H = mk('host1'), G = mk('guest1');
    G.O.browse();
    H.O.host({ name: 'Team 111', pub: true, period: 'TeleOp' });
    hub.flush();
    const open = G.O.openMatches();
    assert.equal(open.length, 1, 'the lobby works over the relay');
    assert.ok(G.O.join(open[0].code, { name: 'Team 222', hid: open[0].hid }));
    hub.flush();
    assert.equal(G.O.state, 'room');
    G.O.pick('blue1'); hub.flush();
    H.O.setReady(true, 'TeleOp'); G.O.setReady(true, 'TeleOp'); hub.flush();
    assert.ok(H.O.start(), H.O.waitingFor().join('; '));
    hub.flush();
    for (const pc of [H, G]) { const s = pc.O.mySlot(), p = pc.E.netSlotPose(s, pc.sim.footprint); pc.sim.chassis = { x: p.x, y: p.y, h: p.h }; }
    for (let i = 0; i < 250; i++) { for (const pc of [H, G]) { pc.clock.t += 20; pc.O.step(0.02, pc.sim); } G.sim.chassis.x += 0.002; hub.flush(); }
    assert.equal(H.O.state, 'playing');
    const buf = H.O.remote[G.id] && H.O.remote[G.id].buf, seen = buf && buf[buf.length - 1];
    assert.ok(seen && Math.abs(seen.x - G.sim.chassis.x) < 0.05, 'the host hears the guest where the guest is: ' + (seen && seen.x) + ' vs ' + G.sim.chassis.x);
  });
}

test('relay: the room\'s clock and the command ledger reach the page', async () => {
  const hub = relayHub();
  const A = hub.endpoint('aaaa1').join('r1'), B = hub.endpoint('bbbb1').join('r1');
  const cmds = [];
  B.onCommand((from, tick, d) => cmds.push([from, tick, d]));
  hub.flush();
  const t = A.time(); hub.flush();
  const got = await t;
  assert.ok(Number.isFinite(got.now) && got.rtt >= 0);
  A.command(0, 'x'); A.command(1, 'y'); hub.flush();
  assert.deepEqual(cmds, [['aaaa1', 0, 'x'], ['aaaa1', 1, 'y']]);
  assert.equal(A.via(), 'ws');
});

test('relay: nobody can post as another player, even knowing their id', async () => {
  const D = new RoomDO({ getWebSockets: () => [] }, {});
  const core = D.room('r2'), heard = [];
  core.join('alice1', { kind: 'sse', send() {}, close() {} }, T('alice1'));
  core.join('bobby1', { kind: 'sse', send: (m) => heard.push(JSON.parse(m)), close() {} }, T('bobby1'));
  const post = (tok, body) => D.fetch(new Request('https://sb.example/room/r2/send?id=alice1&tok=' + tok, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
  const forged = await post('guessed-secret-000000000', JSON.stringify({ t: 'cmd', tick: 7, d: 'forged' }));
  assert.equal(forged.status, 403);
  const real = await post(T('alice1'), JSON.stringify({ t: 'cmd', tick: 7, d: 'real' }));
  assert.equal(real.status, 200);
  assert.deepEqual(heard.filter((m) => m.t === 'cmd').map((m) => m.d), ['real'], 'only her own command counts');
  const huge = await D.fetch(new Request('https://sb.example/room/r2/send?id=alice1&tok=' + T('alice1'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '9999999' }, body: '[]' }));
  assert.equal(huge.status, 413, 'an oversize body is refused before it is read');
});

test('relay: a WebSocket a proxy holds open falls back to one SSE stream, and leaving leaves', () => {
  const hub = relayHub({ stallWs: true });
  const A = hub.endpoint('aaaa2').join('r3'), B = hub.endpoint('bbbb2').join('r3');
  hub.flush();
  assert.equal(hub.streams, 2, 'one stream each, not two');
  assert.equal(A.via(), 'sse');
  assert.deepEqual([...hub.rooms.get('r3').peers.keys()].sort(), ['aaaa2', 'bbbb2']);
  A.leave(); hub.flush();
  assert.deepEqual([...hub.rooms.get('r3').peers.keys()], ['bbbb2'], 'really gone');
});

test('relay: a big binary from an SSE client goes up on its own and arrives, and the batch with it', () => {
  const hub = relayHub({ sse: true });
  const A = hub.endpoint('aaaa3').join('r4'), B = hub.endpoint('bbbb3').join('r4');
  const bins = [], msgs = [], cmds = [];
  B.onBin((buf, meta, from) => bins.push([buf.byteLength, meta.k, from])); B.onMessage((m) => msgs.push(m)); B.onCommand((f, t) => cmds.push(t));
  hub.flush();
  A.send({ k: 'state' }); A.sendBin(new Uint8Array(200000).fill(7).buffer, { k: 'mdl' }, ['bbbb3']); A.command(0, 'x');
  hub.flush();
  assert.deepEqual(bins, [[200000, 'mdl', 'aaaa3']]);
  assert.deepEqual(msgs, [{ k: 'state' }]);
  assert.deepEqual(cmds, [0]);
  assert.ok(hub.posts.includes('application/octet-stream'));
});

test('relay: a dropped player comes back with its secret and takes its place, not refused as taken', () => {
  const R = new RoomCore('r5'), a = conn(), a2 = conn(), b = conn();
  R.join('alice', a, T('alice')); R.join('bobby', b, T('bobby'));
  assert.equal(R.join('alice', a2, T('alice')), null, 'the same secret: back in');
  assert.equal(a2.heard[0].t, 'hello'); assert.equal(a2.heard[0].back, true);
  R.leave('alice', a);                               // the old socket's close comes late
  assert.ok(R.peers.has('alice'), 'an old connection closing can\'t take the new one out');
  assert.ok(!b.heard.some((m) => m.t === 'leave'), 'nobody saw her leave');
});

test('room: the ledger takes each player\'s ticks in order and only a little ahead', () => {
  const R = new RoomCore('r6'), a = conn(), b = conn();
  R.join('alice', a, T('alice')); R.join('bobby', b, T('bobby'));
  const cmd = (id, tick) => R.text(id, JSON.stringify({ t: 'cmd', tick, d: 'x' }));
  cmd('alice', 0); cmd('alice', 1); cmd('alice', 1000000);
  assert.equal(R.ledgerMax, 1, 'the far future is refused');
  cmd('alice', 0);
  assert.equal(R.ledger.get(0).size, 1, 'and so is going back');
  for (let t = 2; t < 60; t++) cmd('alice', t);
  assert.equal(R.ledgerMax, 59);
});

test('room: a player\'s commands that arrive out of order (two SSE batches, the later one first) are all kept', () => {
  const R = new RoomCore('r7'), a = conn(), b = conn();
  R.join('alice', a, T('alice')); R.join('bobby', b, T('bobby'));
  const cmd = (tick, d) => R.text('alice', JSON.stringify({ t: 'cmd', tick, d }));
  cmd(0, 'x'); cmd(1, 'y');
  cmd(3, 'w'); cmd(2, 'v');
  assert.deepEqual(b.heard.filter((m) => m.t === 'cmd').map((m) => m.tick), [0, 1, 3, 2], 'tick 2 is not lost for landing after 3');
  cmd(2, 'again');
  assert.equal(R.ledger.get(2).get('alice'), 'v', 'a tick is still said once');
});

test('room: rebuilt after hibernating, a match past tick 120 still has its commands taken', () => {
  // the sockets survive hibernation, with what was kept on them; the room in memory doesn't
  const sock = (att) => { const s = { sent: [], att, deserializeAttachment: () => s.att, serializeAttachment: (v) => { s.att = v; }, send: (d) => s.sent.push(d), close() {} }; return s; };
  const sa = sock({ id: 'alice1', tok: T('alice1'), room: 'r8' }), sb = sock({ id: 'bobby1', tok: T('bobby1'), room: 'r8' });
  const D = new RoomDO({ getWebSockets: () => [sa, sb] }, {});
  for (let k = 0; k < 6000; k++) D.room('r8').command('alice1', { t: 'cmd', tick: k, d: 'a' });
  D.webSocketMessage(sa, JSON.stringify({ t: 'cmd', tick: 6000, d: 'a' }));
  assert.ok(sa.att.lastTick >= 5980, 'the newest tick is kept on the socket: ' + sa.att.lastTick);
  assert.equal(sa.att.tok, T('alice1'), 'and the rest of what was kept stays');
  // hibernation: a new object, the same sockets
  const D2 = new RoomDO({ getWebSockets: () => [sa, sb] }, {});
  sb.sent.length = 0;
  D2.webSocketMessage(sa, JSON.stringify({ t: 'cmd', tick: 6001, d: 'after' }));
  assert.deepEqual(sb.sent.map((s) => JSON.parse(s)).filter((m) => m.t === 'cmd').map((m) => m.tick), [6001]);
});

test('room: a replay sends only the ticks kept, however far apart, and one a second', () => {
  let t = 0; const R = new RoomCore('r9', { now: () => t }), a = conn(), b = conn();
  R.join('alice', a, T('alice')); R.join('bobby', b, T('bobby'));
  for (let k = 0; k <= 30 * 120; k += 120) R.command('alice', { t: 'cmd', tick: k, d: 'j' + k });
  R.replay('bobby', 0);
  const rows = b.heard.filter((m) => m.t === 'replay').flatMap((m) => m.rows);
  assert.equal(rows.length, 31);
  assert.deepEqual(rows.slice(0, 2), [[0, [['alice', 'j0']]], [120, [['alice', 'j120']]]]);
  R.replay('bobby', 0);
  assert.equal(b.heard.at(-1).why, 'slow-down', 'a second replay straight away waits');
  t = 1500; R.replay('bobby', 3000);
  assert.deepEqual(b.heard.at(-1).rows.map((r) => r[0]), [3000, 3120, 3240, 3360, 3480, 3600]);
});

test('relay: a POST with no length is cut off at the cap while it is read, and an oversize binary says 413', async () => {
  const D = new RoomDO({ getWebSockets: () => [] }, {});
  const core = D.room('r10'), heard = [];
  core.join('alice1', { kind: 'sse', send() {}, close() {} }, T('alice1'));
  core.join('bobby1', { kind: 'sse', send: (m) => heard.push(JSON.parse(m)), close() {} }, T('bobby1'));
  let pulled = 0;
  const stream = (chunks, size) => new ReadableStream({ pull(c) { if (pulled >= chunks) { c.close(); return; } pulled++; c.enqueue(new Uint8Array(size).fill(32)); } });
  const post = (type, body) => D.fetch(new Request('https://sb.example/room/r10/send?id=alice1&tok=' + T('alice1'), { method: 'POST', headers: { 'Content-Type': type }, body, duplex: 'half' }));
  const r = await post('application/json', stream(1000, 16384));
  assert.equal(r.status, 413);
  assert.ok(pulled < 20, 'stopped reading at the cap, not after 16 MB: ' + pulled + ' chunks');
  const big = await post('application/octet-stream', new Uint8Array(core.L.binBytes + 5000));
  assert.equal(big.status, 413, 'not a 200 for a frame that was dropped');
  const ok = await post('application/json', JSON.stringify({ t: 'm', d: 'hi' }));
  assert.equal(ok.status, 200);
  assert.deepEqual(heard.filter((m) => m.t === 'm').map((m) => m.d), ['hi']);
});
