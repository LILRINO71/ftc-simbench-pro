// Match rooms on the app's own origin (workers/room/room.js, functions/room,
// src/netrelay.js): the room relays and refuses what it should, the Pages
// Function routes and guards it, and a whole online match plays over it,
// by WebSocket and by Server-Sent Events, with the real match protocol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadWithField } from './load.mjs';
import { RoomCore, packBin, unpackBin } from '../workers/room/room.js';
import { handle } from '../functions/room/[[path]].js';

const E = loadEngine();
/* a connection the room can talk to, that records what it heard */
const conn = (kind = 'ws') => { const heard = []; return { kind, heard, send: (d) => heard.push(typeof d === 'string' ? JSON.parse(d) : unpackBin(d)), close() {} }; };

test('room: arrivals learn who is there, everyone hears arrivals and departures', () => {
  const R = new RoomCore('m-ABCDE'), a = conn(), b = conn();
  assert.equal(R.join('alice', a), null);
  assert.equal(R.join('bobby', b), null);
  assert.deepEqual(a.heard[0].peers, []);
  assert.deepEqual(b.heard[0].peers, ['alice']);
  assert.deepEqual(a.heard[1], { t: 'join', id: 'bobby' });
  R.leave('bobby');
  assert.deepEqual(a.heard.at(-1), { t: 'leave', id: 'bobby' });
});

test('room: messages go to everyone else, or to the players named, from who really sent them', () => {
  const R = new RoomCore('r'), a = conn(), b = conn(), c = conn();
  R.join('aaaa', a); R.join('bbbb', b); R.join('cccc', c);
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
  assert.equal(R.join('aaaa', a), null);
  assert.equal(R.join('aaaa', conn()), 'taken');
  assert.equal(R.join('x', conn()), 'bad-id');
  assert.equal(R.join('bbbb', b), null);
  assert.equal(R.join('cccc', conn()), 'full');
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
  R.join('aaaa', a); R.join('bbbb', b);
  R.text('aaaa', JSON.stringify({ t: 'time', echo: 42 }));
  assert.deepEqual(a.heard.at(-1), { t: 'time', now: 5000, echo: 42 });
  for (let k = 0; k < 5; k++) { R.text('aaaa', JSON.stringify({ t: 'cmd', tick: k, d: 'A' + k })); R.text('bbbb', JSON.stringify({ t: 'cmd', tick: k, d: 'B' + k })); }
  R.text('aaaa', JSON.stringify({ t: 'cmd', tick: 2, d: 'changed my mind' }));
  assert.equal(b.heard.filter((m) => m.t === 'cmd').length, 5, 'a tick is said once');
  R.leave('bbbb'); const b2 = conn(); R.join('bbbb', b2);
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
  const parse = (u) => { const x = new URL(u); const m = /^\/room\/([^/]+)\/(ws|sse|send)$/.exec(x.pathname); return { name: decodeURIComponent(m[1]), id: x.searchParams.get('id') }; };
  class FakeWS {
    constructor(url) {
      this.readyState = 0; const { name, id } = parse(url.replace(/^ws/, 'http')); this.name = name; this.id = id;
      if (opts.blockWs) { queue.push(() => { this.readyState = 3; this.onclose && this.onclose({}); }); return; }
      queue.push(() => { this.readyState = 1; const why = room(name).join(id, { kind: 'ws', send: (d) => queue.push(() => this.onmessage && this.onmessage({ data: typeof d === 'string' ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) })) });
        if (why) { this.readyState = 3; this.onclose && this.onclose({}); } });
    }
    send(d) { queue.push(() => { const R = room(this.name); if (typeof d === 'string') R.text(this.id, d); else R.bin(this.id, d); }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; queue.push(() => room(this.name).leave(this.id)); }
  }
  class FakeES {
    constructor(url) { const { name, id } = parse(url); this.name = name; this.id = id;
      queue.push(() => room(name).join(id, { kind: 'sse', send: (s) => queue.push(() => this.onmessage && this.onmessage({ data: s })) })); }
    close() { queue.push(() => room(this.name).leave(this.id)); }
  }
  const fetch = async (u, init) => { const { name, id } = parse(u); queue.push(() => room(name).text(id, init.body)); return { ok: true, json: async () => ({}) }; };
  const setTimeout = (f, ms) => { const t = { f, ms, alive: true }; timers.push(t); return t; };
  const clearTimeout = (t) => { if (t) t.alive = false; };
  return {
    rooms, queue,
    endpoint(id) { return E.netRelay({ base: 'https://sb.example', self: id, WebSocket: FakeWS, EventSource: FakeES, fetch, setTimeout, clearTimeout, sse: opts.sse }); },
    // deliver everything, firing timers that are due as if their time had come
    flush() { for (let g = 0; g < 1000; g++) { if (queue.length) { queue.shift()(); continue; } const t = timers.find((x) => x.alive); if (!t) break; t.alive = false; t.f(); } },
  };
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
