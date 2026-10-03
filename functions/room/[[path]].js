/* ============================================================
   MATCH ROOMS ON THE APP'S OWN ORIGIN (Cloudflare Pages Function, /room/*)
   A school network that drops UDP and WebSockets to unknown hosts still lets
   a browser reach SimBench itself, over HTTPS on port 443. Online matches
   meet here when the players' browsers can't reach each other directly.

     GET  /room/health              {ready, turn}: is the room service switched on
     GET  /room/turn                short-lived TURN credentials (Cloudflare
                                    Realtime), so WebRTC can still go over 443
     GET  /room/<name>/ws?id=…      the room, as a WebSocket
     GET  /room/<name>/sse?id=…     the room, as Server-Sent Events
     POST /room/<name>/send?id=…    what an SSE client says

   Each room is one Durable Object (workers/room/room.js, deployed as its own
   Worker and bound here as ROOMS). Without that binding, /room/health says
   ready:false and the page keeps using direct WebRTC as before. Set up once:
   DEPLOY.md, "Online rooms".
   ============================================================ */
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const ID = /^[A-Za-z0-9_-]{4,40}$/;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function handle(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/room\/?/, '');
  // only this site's own pages may use its rooms: another site can't borrow them
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'origin' }, 403);

  if (route === 'health') return json({ ready: !!env.ROOMS, turn: !!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) });
  if (route === 'turn') {
    if (!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN)) return json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }], turn: false });
    const r = await fetchImpl('https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(env.TURN_KEY_ID) + '/credentials/generate-ice-servers', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.TURN_KEY_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 4 * 3600 }) });
    if (!r.ok) return json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }], turn: false, why: 'turn-' + r.status }, 200);
    const t = await r.json().catch(() => null);
    const servers = (t && Array.isArray(t.iceServers) ? t.iceServers : []).map((s) => Object.assign({}, s, {
      // port 53 is blocked by browsers (Cloudflare's own advice): leave it out
      urls: [].concat(s.urls || []).filter((u) => typeof u === 'string' && !/:53\b/.test(u)) })).filter((s) => s.urls.length);
    return json({ iceServers: servers, turn: true });
  }
  const m = /^([^/]+)\/(ws|sse|send)$/.exec(route);
  if (!m) return json({ error: 'not-found' }, 404);
  if (!NAME.test(m[1]) || !ID.test(url.searchParams.get('id') || '')) return json({ error: 'bad-name' }, 400);
  if (!env.ROOMS) return json({ error: 'not-set-up', message: 'Online rooms aren\'t switched on for this site.' }, 501);
  if (m[2] === 'send' && request.method !== 'POST') return json({ error: 'method' }, 405);
  if (m[2] !== 'send' && request.method !== 'GET') return json({ error: 'method' }, 405);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
  return stub.fetch(request);
}

export const onRequest = (context) => handle(context.request, context.env);
