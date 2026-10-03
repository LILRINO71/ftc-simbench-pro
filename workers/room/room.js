/* ============================================================
   THE MATCH ROOM — one Durable Object per room, on the app's own origin
   ------------------------------------------------------------
   School networks drop UDP (so WebRTC can't connect) and drop WebSockets to
   hosts they don't know (so public relays can't be reached). The one path a
   school can't block without blocking SimBench itself is HTTPS to SimBench.
   This room sits there:

     - who is in the room: each player gets the others' ids on arrival, and
       hears every arrival and departure after that
     - relaying: a message to everyone, or to a list of players, JSON or
       binary, exactly as the browsers' own WebRTC channel would carry it
     - the clock: {t:"time"} answers with the room's time, so every player
       counts down to the same start whoever hosts (and whoever leaves)
     - the command ledger for lockstep matches: each player's commands for
       each tick, kept so a player who arrives late or reconnects replays to
       the present (src/lockstep.js)

   It runs no physics: a Durable Object is billed while it runs, and every
   browser runs the match itself. Between messages it hibernates.

   RoomCore is the room without Cloudflare: it takes connections that have
   a send(), so tests run it in Node. RoomDO wraps it in WebSocket
   hibernation, plus Server-Sent Events and POST for networks that strip
   WebSocket upgrades.
   ============================================================ */
export const ROOM_LIMITS = {
  peers: 16,                 // a match is 4 drivers and some watchers
  textBytes: 64 * 1024,      // one JSON message
  binBytes: 900 * 1024,      // one binary message (a robot's light copy); a WebSocket frame tops out at 1 MiB
  ratePerSec: 300, burst: 600,
  bytesPerSec: 3e6,
  ledgerTicks: 30000,        // 10 minutes at 50 Hz
  idLen: 40,
};
const ID = /^[A-Za-z0-9_-]{4,40}$/;
const ROOM = /^[A-Za-z0-9_-]{1,64}$/;
export const roomNameOk = (n) => ROOM.test(String(n || ''));
export const peerIdOk = (n) => ID.test(String(n || ''));

const enc = new TextEncoder(), dec = new TextDecoder();
/* binary frames: [u32 header length][header JSON][payload] */
export function packBin(header, payload) {
  const h = enc.encode(JSON.stringify(header)), p = payload instanceof Uint8Array ? payload : new Uint8Array(payload || 0);
  const out = new Uint8Array(4 + h.length + p.length);
  new DataView(out.buffer).setUint32(0, h.length, true); out.set(h, 4); out.set(p, 4 + h.length);
  return out;
}
export function unpackBin(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u.length < 4) return null;
  const n = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(0, true);
  if (n > 4096 || 4 + n > u.length) return null;
  let header; try { header = JSON.parse(dec.decode(u.subarray(4, 4 + n))); } catch (e) { return null; }
  if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
  return { header, payload: u.slice(4 + n) };
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

export class RoomCore {
  constructor(name, opts) {
    this.name = name;
    this.L = Object.assign({}, ROOM_LIMITS, (opts && opts.limits) || {});
    this.now = (opts && opts.now) || (() => Date.now());
    this.peers = new Map();                // id -> {conn, kind, tokens, bytes, at}
    this.ledger = new Map();               // tick -> Map(id -> data)
    this.ledgerMin = Infinity;
  }
  /* a connection arrives: conn = {send(textOrBytes), close(code, why), kind:"ws"|"sse"} */
  join(id, conn) {
    if (!peerIdOk(id)) return 'bad-id';
    if (this.peers.has(id)) return 'taken';
    if (this.peers.size >= this.L.peers) return 'full';
    const others = [...this.peers.keys()];
    this.peers.set(id, { conn, ws: conn.ws || null, kind: conn.kind || 'ws', tokens: this.L.burst, bytes: this.L.bytesPerSec, at: this.now() });
    this.out(id, { t: 'hello', self: id, peers: others, now: this.now(), room: this.name });
    for (const o of others) this.out(o, { t: 'join', id });
    return null;
  }
  leave(id) {
    if (!this.peers.delete(id)) return;
    for (const o of this.peers.keys()) this.out(o, { t: 'leave', id });
  }
  /* rate: a token per message and a byte budget, refilled by the clock */
  allow(p, bytes) {
    const t = this.now(), dt = Math.max(0, (t - p.at) / 1000); p.at = t;
    p.tokens = Math.min(this.L.burst, p.tokens + dt * this.L.ratePerSec);
    p.bytes = Math.min(2 * this.L.bytesPerSec, p.bytes + dt * this.L.bytesPerSec);
    if (p.tokens < 1 || p.bytes < bytes) return false;
    p.tokens -= 1; p.bytes -= bytes; return true;
  }
  out(id, msg) {
    const p = this.peers.get(id); if (!p) return;
    try { p.conn.send(JSON.stringify(msg)); } catch (e) { this.leave(id); }
  }
  outBin(id, header, payload) {
    const p = this.peers.get(id); if (!p) return;
    try {
      // a stream of text (SSE) carries bytes as base64
      if (p.kind === 'sse') p.conn.send(JSON.stringify(Object.assign({}, header, { b64: b64(payload) })));
      else p.conn.send(packBin(header, payload));
    } catch (e) { this.leave(id); }
  }
  targets(from, to) {
    const all = [...this.peers.keys()].filter((x) => x !== from);
    if (to == null) return all;
    const want = new Set([].concat(to).filter((x) => typeof x === 'string').slice(0, this.L.peers));
    return all.filter((x) => want.has(x));
  }
  /* a JSON message from a player, or a batch of them (SSE clients POST several) */
  text(from, raw) {
    const p = this.peers.get(from); if (!p) return;
    const size = typeof raw === 'string' ? raw.length : 0;
    if (size > this.L.textBytes) { this.out(from, { t: 'err', why: 'too-big' }); return; }
    let m; try { m = JSON.parse(raw); } catch (e) { this.out(from, { t: 'err', why: 'bad-json' }); return; }
    const list = Array.isArray(m) ? m.slice(0, 64) : [m];
    for (const x of list) {
      if (!this.allow(p, size / list.length)) { this.out(from, { t: 'err', why: 'slow-down' }); return; }
      this.one(from, x);
    }
  }
  one(from, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'm') { for (const id of this.targets(from, m.to)) this.out(id, { t: 'm', from, d: m.d }); }
    else if (m.t === 'time') this.out(from, { t: 'time', now: this.now(), echo: typeof m.echo === 'number' ? m.echo : null });
    else if (m.t === 'b64') {                // binary sent by a POST-only client
      let u8; try { u8 = Uint8Array.from(atob(String(m.b64 || '')), (c) => c.charCodeAt(0)); } catch (e) { return; }
      if (u8.length > this.L.binBytes) { this.out(from, { t: 'err', why: 'too-big' }); return; }
      for (const id of this.targets(from, m.to)) this.outBin(id, { t: 'b', from, meta: m.meta || {} }, u8);
    }
    else if (m.t === 'cmd') this.command(from, m);
    else if (m.t === 'replay') this.replay(from, m.from);
    else if (m.t === 'ping') this.out(from, { t: 'pong' });
  }
  bin(from, buf) {
    const p = this.peers.get(from); if (!p) return;
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u.length > this.L.binBytes + 4100) { this.out(from, { t: 'err', why: 'too-big' }); return; }
    if (!this.allow(p, u.length)) { this.out(from, { t: 'err', why: 'slow-down' }); return; }
    const f = unpackBin(u); if (!f) { this.out(from, { t: 'err', why: 'bad-frame' }); return; }
    for (const id of this.targets(from, f.header.to)) this.outBin(id, { t: 'b', from, meta: f.header.meta || {} }, f.payload);
  }
  /* ---- lockstep: each player's commands, by tick ---- */
  command(from, m) {
    const tick = m.tick;
    if (!Number.isInteger(tick) || tick < 0 || typeof m.d !== 'string' || m.d.length > 2048) return;
    let row = this.ledger.get(tick);
    if (!row) { row = new Map(); this.ledger.set(tick, row); if (tick < this.ledgerMin) this.ledgerMin = tick; }
    if (row.has(from)) return;               // a tick's command is said once
    row.set(from, m.d);
    while (this.ledger.size > this.L.ledgerTicks) { const k = Math.min(...this.ledger.keys()); this.ledger.delete(k); this.ledgerMin = k + 1; }
    for (const id of this.targets(from, null)) this.out(id, { t: 'cmd', from, tick, d: m.d });
  }
  replay(to, fromTick) {
    const start = Number.isInteger(fromTick) ? fromTick : 0;
    const ticks = [...this.ledger.keys()].filter((k) => k >= start).sort((a, b) => a - b);
    for (let i = 0; i < ticks.length; i += 200) {
      const rows = ticks.slice(i, i + 200).map((k) => [k, [...this.ledger.get(k)]]);
      this.out(to, { t: 'replay', rows, done: i + 200 >= ticks.length });
    }
    if (!ticks.length) this.out(to, { t: 'replay', rows: [], done: true });
  }
}

/* ---- Cloudflare: the Durable Object ----
   GET  /room/<name>/ws?id=<peer>     WebSocket (hibernating)
   GET  /room/<name>/sse?id=<peer>    Server-Sent Events, for proxies that strip upgrades
   POST /room/<name>/send?id=<peer>   what an SSE client says (JSON, or a JSON array) */
export class RoomDO {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.core = null; this.sse = new Map();
  }
  room(name) {
    if (!this.core) this.core = new RoomCore(name);
    // after hibernation the sockets are still there; the room around them is rebuilt
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment && ws.deserializeAttachment();
      if (a && a.id && !a.refused && !this.core.peers.has(a.id)) this.core.peers.set(a.id, { conn: wsConn(ws), ws, kind: 'ws', tokens: this.core.L.burst, bytes: this.core.L.bytesPerSec, at: Date.now() });
    }
    return this.core;
  }
  async fetch(request) {
    const url = new URL(request.url);
    const m = /^\/room\/([^/]+)\/(ws|sse|send)$/.exec(url.pathname);
    if (!m || !roomNameOk(m[1])) return new Response('not found', { status: 404 });
    const name = m[1], id = url.searchParams.get('id') || '', core = this.room(name);
    if (m[2] === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [id]);
      server.serializeAttachment({ id, room: name });
      const why = core.join(id, wsConn(server));
      // a refused socket must never take the id it was refused for out of the room when it closes
      if (why) { server.serializeAttachment({ id, room: name, refused: true }); server.send(JSON.stringify({ t: 'err', why })); server.close(4009, why); }
      return new Response(null, { status: 101, webSocket: client });
    }
    if (m[2] === 'sse') {
      const ts = new TransformStream(), w = ts.writable.getWriter();
      const conn = { kind: 'sse', send: (s) => { w.write(enc.encode('data: ' + s + '\n\n')).catch(() => core.leave(id)); }, close: () => { try { w.close(); } catch (e) {} } };
      const why = core.join(id, conn);
      if (why) return new Response(JSON.stringify({ t: 'err', why }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      this.sse.set(id, conn);
      // a comment every 20 s keeps proxies from timing the stream out; a dead stream leaves the room
      const beat = setInterval(() => { w.write(enc.encode(': .\n\n')).catch(() => { clearInterval(beat); core.leave(id); this.sse.delete(id); }); }, 20000);
      return new Response(ts.readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
    }
    if (request.method !== 'POST') return new Response('method', { status: 405 });
    if (!core.peers.has(id) || !this.sse.has(id)) return new Response(JSON.stringify({ t: 'err', why: 'not-in-room' }), { status: 409 });
    const body = await request.text();
    core.text(id, body);
    return new Response('{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  webSocketMessage(ws, msg) {
    const a = ws.deserializeAttachment(); if (!a || a.refused) return;
    const core = this.room(a.room);
    if (typeof msg === 'string') core.text(a.id, msg); else core.bin(a.id, msg);
  }
  webSocketClose(ws) { const a = ws.deserializeAttachment(); if (a && !a.refused) { const core = this.room(a.room), p = core.peers.get(a.id); if (p && p.ws === ws) core.leave(a.id); } }
  webSocketError(ws) { this.webSocketClose(ws); }
}
const wsConn = (ws) => ({ kind: 'ws', ws, send: (d) => ws.send(d), close: (c, w) => ws.close(c, w) });
