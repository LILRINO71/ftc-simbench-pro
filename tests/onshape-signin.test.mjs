// Sign in with Onshape (functions/onshape/[[path]].js and onshapeFromLink in
// src/onshapelink.js): the import route. Onshape's API answers no cross-site
// call from a browser and the sign-in needs the app's secret, so a small Pages
// Function does OAuth with Onshape and passes the robot reader's calls through.
// Here Onshape (its OAuth server and its API) is a stand-in serving the
// `mated` robot; the page side and the function run for real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FN = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(ROOT, 'functions', 'onshape', '[[path]].js'), 'utf8')));
const E = loadEngine();
const SITE = 'https://sb.test';
const ENV = { ONSHAPE_CLIENT_ID: 'client-id', ONSHAPE_CLIENT_SECRET: 'sec=ret+/' };
const D = 'a'.repeat(24), W = 'b'.repeat(24), EL = 'c'.repeat(24);
const LINK = `https://cad.onshape.com/documents/${D}/w/${W}/e/${EL}`;
// the `mated` robot, with ids shaped like Onshape's (24 hex digits): the pass-through allows no others
const MV = 'e'.repeat(24), hexId = (n) => (+n).toString(16).padStart(24, '0');
const R = (() => {
  const r = buildRobot('mated'), o = r.onshape;
  const ids = (t) => t.replace(/"DOC"/g, `"${D}"`).replace(/"MV"/g, `"${MV}"`).replace(/"E(\d+)"/g, (_, n) => `"${hexId(n)}"`);
  o.assembly = JSON.parse(ids(JSON.stringify(o.assembly)));
  o.features = JSON.parse(ids(JSON.stringify(o.features)));
  o.geom = Object.fromEntries(Object.entries(o.geom).map(([k, v]) => [k.replace(/^DOC\/m\/MV\/e\/E(\d+)/, (_, n) => `${D}/m/${MV}/e/${hexId(n)}`), v]));
  return r;
})();

/* Onshape: the token endpoint and the API, answering only with the right bearer token */
// rotate: a refresh token works once, as Onshape's do. tokenDown: the token
// endpoint answers renewals with that status, or 'network' for no answer at all.
function onshape({ expiresIn = 3600, rotate = false } = {}) {
  const o = { calls: [], tokenForms: [], issued: 0, live: new Set(), usedRt: new Set(), tokenDown: null };
  const issue = () => { const a = 'at-' + (++o.issued); o.live.add(a); return { access_token: a, refresh_token: 'rt-' + o.issued, expires_in: expiresIn, token_type: 'Bearer' }; };
  o.fetch = async (u, init = {}) => {
    u = String(u);
    if (u === 'https://oauth.onshape.com/oauth/token') {
      const f = Object.fromEntries(new URLSearchParams(init.body));
      o.tokenForms.push(f);
      if (f.client_id !== ENV.ONSHAPE_CLIENT_ID || f.client_secret !== ENV.ONSHAPE_CLIENT_SECRET) return new Response('{}', { status: 401 });
      if (f.grant_type === 'authorization_code' && f.code === 'good-code' && f.redirect_uri === SITE + '/onshape/callback') return Response.json(issue());
      if (f.grant_type === 'refresh_token' && o.tokenDown === 'network') throw new TypeError('fetch failed');
      if (f.grant_type === 'refresh_token' && o.tokenDown) return new Response('<html>busy</html>', { status: o.tokenDown });
      if (f.grant_type === 'refresh_token' && rotate && o.usedRt.has(f.refresh_token)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (f.grant_type === 'refresh_token' && /^rt-/.test(f.refresh_token)) { o.usedRt.add(f.refresh_token); return Response.json(issue()); }
      return new Response('{}', { status: 400 });
    }
    assert.ok(u.startsWith('https://cad.onshape.com/api/'), 'only Onshape\'s API: ' + u);
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    o.calls.push({ u, auth });
    if (!o.live.has(auth.replace(/^Bearer /, ''))) return new Response('{"message":"Unauthenticated"}', { status: 401 });
    const body = apiAnswer(u.slice('https://cad.onshape.com'.length));
    return body == null ? new Response('{}', { status: 404 }) : Response.json(body);
  };
  return o;
}
function apiAnswer(u) {
  if (u.startsWith(`/api/documents/${D}`)) return { name: 'Robot 2026' };
  const m = /\/partstudios\/d\/(\w+)\/(v|m)\/(\w+)\/e\/(\w+)\/(tessellatedfaces|massproperties)\?configuration=([^&]*)/.exec(u);
  if (m) {
    const g = R.onshape.geom[m[1] + '/' + m[2] + '/' + m[3] + '/e/' + m[4] + '|' + decodeURIComponent(m[6])];
    if (!g) return null;
    if (m[5] === 'massproperties') return { bodies: Object.fromEntries(Object.entries(g.mass).map(([k, v]) => [k, { mass: [v.kg, v.kg, v.kg], centroid: [0, 0, 0] }])) };
    return Object.entries(g.parts).map(([id, b]) => {
      const facets = []; for (let i = 0; i < b.tri.length; i += 9) facets.push({ vertices: [0, 3, 6].map((k) => ({ x: b.tri[i + k], y: b.tri[i + k + 1], z: b.tri[i + k + 2] })) });
      return { id, name: b.name, faces: [{ appearance: b.color ? { color: b.color.map((v) => String(Math.round(v * 255))) } : null, facets }] };
    });
  }
  const asm = `/api/assemblies/d/${D}/w/${W}/e/${EL}`, at = u.split('?')[0];
  if (at === asm + '/features') return R.onshape.features;
  if (at === asm) return R.onshape.assembly;
  return null;
}
/* a browser on SimBench: same-origin cookies kept the way a browser keeps them (Path=/onshape) */
function browser(os, env = ENV) {
  const jar = {};
  const keep = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [nv, ...attrs] = c.split(/;\s*/); const i = nv.indexOf('=');
      assert.ok(attrs.includes('HttpOnly') && attrs.includes('Secure') && attrs.includes('Path=/onshape'), c);
      const age = attrs.find((a) => /^Max-Age=/.test(a));
      if (age === 'Max-Age=0') delete jar[nv.slice(0, i)]; else jar[nv.slice(0, i)] = nv.slice(i + 1);
    }
    return res;
  };
  const b = { jar, os };
  b.go = async (u, init = {}) => {
    const url = new URL(u, SITE + '/');
    const headers = new Headers(init.headers || {});
    if (url.origin === SITE && url.pathname.startsWith('/onshape')) headers.set('Cookie', Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '));
    return keep(await FN.handle(new Request(url, { method: init.method || 'GET', headers }), env, os.fetch));
  };
  /* sign in the way the pop-up does: /onshape/login, Onshape's Allow page, back to /onshape/callback */
  b.signIn = async ({ state } = {}) => {
    const login = await b.go('/onshape/login');
    assert.equal(login.status, 302);
    const to = new URL(login.headers.get('Location'));
    return b.go(`/onshape/callback?code=good-code&state=${encodeURIComponent(state || to.searchParams.get('state'))}`);
  };
  return b;
}
/* run page code (onshapeFromLink, onshapeSignInState) in that browser */
async function onPage(b, f) {
  const g = globalThis, was = { fetch: g.fetch, location: g.location };
  g.fetch = (u, init) => b.go(u, init);
  Object.defineProperty(g, 'location', { value: { href: SITE + '/', origin: SITE }, configurable: true, writable: true });
  try { return await f(); } finally { g.fetch = was.fetch; Object.defineProperty(g, 'location', { value: was.location, configurable: true, writable: true }); }
}

test('sign in with Onshape: pasting the assembly\'s address brings the whole robot', async () => {
  const os = onshape(), b = browser(os);
  assert.deepEqual(await onPage(b, () => E.onshapeSignInState()), { ready: true, signedIn: false });
  const back = await b.signIn();
  assert.equal(back.status, 200);
  assert.match(await back.text(), /simbench-onshape-signin/);
  assert.ok(b.jar.sb_os, 'signed in');
  assert.ok(!b.jar.sb_os.includes('at-1') && !b.jar.sb_os.includes('rt-1'), 'the token is sealed, not readable in the cookie');
  assert.equal(os.tokenForms[0].client_secret, ENV.ONSHAPE_CLIENT_SECRET, 'the secret stays on the server and goes only to Onshape');
  assert.deepEqual(await onPage(b, () => E.onshapeSignInState()), { ready: true, signedIn: true });

  const said = [];
  const p = E.checkOnshapePayload(await onPage(b, () => E.onshapeFromLink('  ' + LINK + '  ', (t) => said.push(t))));
  assert.equal(p.name, 'Robot 2026');
  assert.equal(p.url, LINK);
  assert.deepEqual(p.asm, R.onshape.assembly);
  assert.ok(os.calls.every((c) => c.auth === 'Bearer at-1'));
  assert.ok(said.some((t) => /part studios/.test(t)), 'progress for the pop-up');
  // the whole robot: every part with its colour, every joint from a mate
  const cad = E.cadFromOnshape(p);
  assert.equal(cad.solids.length, R.truth.leafParts);
  assert.equal(cad.mechs.filter((m) => m.fromMate).length, R.truth.joints.length);
  assert.ok(Math.abs(cad.onshape.kg - R.truth.massKg) < 1e-3);
  for (const s of cad.solids) assert.ok(Array.isArray(s.color), s.name + ' has its colour');
});

test('sign in with Onshape: a forged or stale sign-in is refused, and nothing is traded for a token', async () => {
  const os = onshape(), b = browser(os);
  const res = await b.signIn({ state: 'not-the-one-we-sent' });
  assert.equal(res.status, 400);
  assert.equal(os.tokenForms.length, 0);
  assert.equal(b.jar.sb_os, undefined);
  // and a cookie someone else sealed (or edited) doesn't open anything
  b.jar.sb_os = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal((await b.go(`/onshape/api/documents/${D}`)).status, 401);
  assert.equal(os.calls.length, 0);
});

test('sign in with Onshape: the pass-through only reads, only the robot, only from Onshape', async () => {
  const os = onshape(), b = browser(os);
  await b.signIn();
  assert.equal((await b.go(`/onshape/api/documents/${D}`, { method: 'POST' })).status, 405);
  for (const p of ['users/sessioninfo', `documents/${D}/w/${W}/elements`, `documents/d/${D}/w/${W}/e/${EL}/delete`, `../../evil.example/x`, `assemblies/d/${D}/w/${W}/e/${EL}/../../../../users`, 'documents?q=all'])
    assert.ok([403, 404].includes((await b.go('/onshape/api/' + p)).status), p);
  assert.equal(os.calls.length, 0);
  const ok = await b.go(`/onshape/api/assemblies/d/${D}/w/${W}/e/${EL}?includeMateFeatures=true`);
  assert.equal(ok.status, 200);
  assert.equal(os.calls[0].u, `https://cad.onshape.com/api/assemblies/d/${D}/w/${W}/e/${EL}?includeMateFeatures=true`);
});

test('sign in with Onshape: a token that ran out is renewed without signing in again', async () => {
  const os = onshape({ expiresIn: 30 }), b = browser(os);   // expires inside the minute's margin
  await b.signIn();
  const first = b.jar.sb_os;
  const r = await b.go(`/onshape/api/documents/${D}`);
  assert.equal(r.status, 200);
  assert.equal(os.tokenForms.at(-1).grant_type, 'refresh_token');
  assert.notEqual(b.jar.sb_os, first, 'the renewed token is kept');
  assert.equal(os.calls.at(-1).auth, 'Bearer at-2');
  // Onshape refusing a token that should still be good: renewed once and retried
  const os2 = onshape(), b2 = browser(os2);
  await b2.signIn();
  os2.live.clear();
  assert.equal((await b2.go(`/onshape/api/documents/${D}`)).status, 200);
  assert.deepEqual(os2.calls.map((c) => c.auth), ['Bearer at-1', 'Bearer at-2']);
});

test('sign in with Onshape: calls side by side with a token about to run out: one renews it, the rest still go through, and the team stays signed in', async () => {
  const os = onshape({ expiresIn: 30, rotate: true }), b = browser(os);
  await b.signIn();
  const paths = [`documents/${D}`, `assemblies/d/${D}/w/${W}/e/${EL}`, `assemblies/d/${D}/w/${W}/e/${EL}/features`];
  // the page reads four part studios at once, every one carrying the same cookie
  const res = await Promise.all(paths.map((p) => b.go('/onshape/api/' + p)));
  assert.deepEqual(res.map((r) => r.status), [200, 200, 200], 'no call is refused because another one renewed the token first');
  assert.equal(os.tokenForms.filter((f) => f.grant_type === 'refresh_token').length, 3, 'each tried to renew');
  assert.equal(os.usedRt.size, 1, 'one renewal worked; Onshape refused the reused refresh token');
  assert.ok(b.jar.sb_os, 'still signed in');
  assert.equal((await b.go(`/onshape/api/documents/${D}`)).status, 200, 'and the next call works');
  // the whole robot, read the way the page reads it, with a token that keeps running out
  const p = E.checkOnshapePayload(await onPage(b, () => E.onshapeFromLink(LINK, () => {})));
  assert.equal(E.cadFromOnshape(p).solids.length, R.truth.leafParts);
  assert.ok(b.jar.sb_os);
});

test('sign in with Onshape: Onshape\'s token server down or unreachable never signs the team out', async () => {
  for (const down of [503, 'network']) {
    const os = onshape({ expiresIn: 30 }), b = browser(os);
    await b.signIn();
    const cookie = b.jar.sb_os;
    os.tokenDown = down;
    // the token hasn't run out yet: the call goes through with it
    const r1 = await b.go(`/onshape/api/documents/${D}`);
    assert.equal(r1.status, 200, down + ': the token still works');
    assert.equal(b.jar.sb_os, cookie, down + ': the sign-in is kept');
    // Onshape refuses it and it can't be renewed: try again later, still signed in
    os.live.clear();
    const r2 = await b.go(`/onshape/api/documents/${D}`);
    assert.equal(r2.status, 503, down + ': the page is told to try again, not to sign in again');
    assert.ok(+r2.headers.get('Retry-After') > 0);
    assert.equal(b.jar.sb_os, cookie, down + ': the sign-in is kept');
    // back up: renewed, and on with the new token
    os.tokenDown = null;
    assert.equal((await b.go(`/onshape/api/documents/${D}`)).status, 200);
    assert.notEqual(b.jar.sb_os, cookie);
  }
});

test('sign in with Onshape: a renewal refused while the token is refused too: the page asks to sign in again, but a sign-in another call just renewed is not wiped', async () => {
  const os = onshape({ rotate: true }), b = browser(os);
  await b.signIn();
  const cookie = b.jar.sb_os;
  os.live.clear(); os.usedRt.add('rt-1');      // the token and its refresh token both refused
  const r = await b.go(`/onshape/api/documents/${D}`);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'signed-out');
  assert.equal(b.jar.sb_os, cookie, 'no Max-Age=0 that could land after, and wipe, a cookie another call just renewed');
});

test('sign in with Onshape: signed out, the page is told so (401) and the pop-up asks to sign in again', async () => {
  const os = onshape(), b = browser(os);
  await assert.rejects(onPage(b, () => E.onshapeFromLink(LINK, () => {})), (e) => e.status === 401);
  await b.signIn();
  assert.equal((await b.go('/onshape/logout', { method: 'POST' })).status, 200);
  assert.equal(b.jar.sb_os, undefined);
  assert.equal((await b.go(`/onshape/api/documents/${D}`)).status, 401);
});

test('sign in with Onshape: a Part Studio link or a link that isn\'t Onshape\'s says what to copy instead', async () => {
  const os = onshape(), b = browser(os);
  await b.signIn();
  await assert.rejects(onPage(b, () => E.onshapeFromLink('https://example.com/documents/x', () => {})), /isn't an Onshape document link/);
  const studio = `https://cad.onshape.com/documents/${D}/w/${W}/e/${'d'.repeat(24)}`;
  await assert.rejects(onPage(b, () => E.onshapeFromLink(studio, () => {})), /isn't an assembly/);
  assert.equal(E.onshapeRef('https://myteam.onshape.com/documents/' + D + '/v/' + W + '/e/' + EL + '?renderMode=0').host, 'https://myteam.onshape.com');
  assert.equal(E.onshapeRef('https://cad.onshape.com.evil.example/documents/' + D + '/w/' + W + '/e/' + EL), null);
});

test('sign in with Onshape: not switched on (no app secrets), the page says so and offers the export', async () => {
  const os = onshape(), b = browser(os, {});
  assert.deepEqual(await onPage(b, () => E.onshapeSignInState()), { ready: false, signedIn: false });
  assert.equal((await b.go('/onshape/login')).status, 501);
  assert.equal((await b.go(`/onshape/api/documents/${D}`)).status, 501);
  // a plain host or a file with no function at all: also not ready, never an error
  const g = globalThis, was = g.fetch;
  g.fetch = async () => new Response('<!doctype html>', { status: 404 });
  try { assert.deepEqual(await E.onshapeSignInState(), { ready: false, signedIn: false }); } finally { g.fetch = was; }
});

test('sign in with Onshape: a kept copy of a Part Studio is only for a team that can open its document', async () => {
  // the edge cache, as Cloudflare's caches.default
  const kept = new Map(), was = globalThis.caches;
  globalThis.caches = { default: { match: async (k) => { const r = kept.get(k.url); return r ? r.clone() : undefined; }, put: async (k, r) => { kept.set(k.url, r); } } };
  try {
    const [gk] = Object.keys(R.onshape.geom), [ps, config] = gk.split('|');
    const shapes = `/onshape/api/partstudios/d/${ps.replace(/\/m\//, '/m/')}/tessellatedfaces?configuration=${encodeURIComponent(config)}`;
    // team A owns the document: read from Onshape, and kept
    const osA = onshape(), a = browser(osA);
    await a.signIn();
    const first = await a.go(shapes);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('X-SimBench-Cache'), 'miss');
    assert.equal(kept.size, 1);
    // team B's account can't open it (a private document): Onshape says 403, and the kept copy stays kept
    const osB = onshape(), b = browser(osB);
    await b.signIn();
    const inner = osB.fetch;
    osB.fetch = async (u, init) => (String(u).includes('/api/documents/' + D) ? new Response('{}', { status: 403 }) : inner(u, init));
    const denied = await b.go(shapes);
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('X-SimBench-Cache'), null);
    assert.doesNotMatch(await denied.text(), /facets/);
    // team C can open it: served from the copy, after one small check, never the shapes again
    const osC = onshape(), c = browser(osC);
    await c.signIn();
    const hit = await c.go(shapes);
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get('X-SimBench-Cache'), 'hit');
    assert.equal(hit.headers.get('Cache-Control'), 'no-store');
    assert.match(await hit.text(), /facets/);
    assert.deepEqual(osC.calls.map((x) => x.u), [`https://cad.onshape.com/api/documents/${D}`]);
  } finally { globalThis.caches = was; }
});

test('sign in with Onshape: the yearly allowance used up mid-read stops the read and says so, instead of leaving parts out', async () => {
  const os = onshape(), b = browser(os);
  await b.signIn();
  // Onshape answers 402 once the app owner's annual API calls are spent; every call after it too
  const inner = os.fetch;
  os.fetch = async (u, init) => (/\/partstudios\//.test(String(u)) ? new Response('{"message":"API limit reached"}', { status: 402 }) : inner(u, init));
  await assert.rejects(onPage(b, () => E.onshapeFromLink(LINK, () => {})), (e) => e.status === 402 && /yearly allowance/.test(e.message));
  // spent before the read starts: the assembly itself says so
  os.fetch = async () => new Response('{}', { status: 402 });
  await assert.rejects(onPage(b, () => E.onshapeFromLink(LINK, () => {})), (e) => e.status === 402);
});

test('sign in with Onshape: kept copies of a public library part cost the next team no call; a linked part and a spent allowance are read as Onshape says', async () => {
  const kept = new Map(), was = globalThis.caches;
  globalThis.caches = { default: { match: async (k) => { const r = kept.get(k.url); return r ? r.clone() : undefined; }, put: async (k, r) => { kept.set(k.url, r); } } };
  const docSays = (os, answer) => { const inner = os.fetch; os.fetch = async (u, init) => (String(u).includes('/api/documents/' + D) ? (os.calls.push({ u: String(u) }), answer()) : inner(u, init)); };
  try {
    const [gk] = Object.keys(R.onshape.geom), [ps, config] = gk.split('|');
    const shapes = `/onshape/api/partstudios/d/${ps}/tessellatedfaces?configuration=${encodeURIComponent(config)}`;
    // a library anyone can open: team A reads it, team B's check hears "public", team C pays nothing
    const osA = onshape(), a = browser(osA); await a.signIn();
    assert.equal((await a.go(shapes)).headers.get('X-SimBench-Cache'), 'miss');
    const osB = onshape(), b = browser(osB); await b.signIn();
    docSays(osB, () => Response.json({ name: 'goBILDA parts', public: true }));
    assert.equal((await b.go(shapes)).headers.get('X-SimBench-Cache'), 'hit');
    assert.equal(osB.calls.length, 1, 'one check');
    const osC = onshape(), c = browser(osC); await c.signIn();
    const hit = await c.go(shapes);
    assert.equal(hit.headers.get('X-SimBench-Cache'), 'hit');
    assert.match(await hit.text(), /facets/);
    assert.deepEqual(osC.calls, [], 'no call at all against the yearly allowance');
    // a private document isn't remembered: every team still shows it can open it
    kept.clear();
    await a.go(shapes);
    const osE = onshape(), e = browser(osE); await e.signIn();
    await e.go(shapes); await e.go(shapes);
    assert.equal(osE.calls.length, 2, 'a check each time');
    // placed from the team's own document: the library itself is refused, but the read through the link is Onshape's to decide
    const L = 'f'.repeat(24), linked = shapes + '&linkDocumentId=' + L;
    await a.go(linked);
    const osF = onshape(), f = browser(osF); await f.signIn();
    docSays(osF, () => new Response('{}', { status: 403 }));
    const viaLink = await f.go(linked);
    assert.equal(viaLink.status, 200, 'not refused by the check that can\'t carry the link');
    assert.match(await viaLink.text(), /facets/);
    assert.ok(osF.calls.at(-1).u.includes('linkDocumentId=' + L), 'read fresh, through the link');
    // the allowance spent: said as 402, not "your account can't open that document"
    const osG = onshape(), g = browser(osG); await g.signIn();
    docSays(osG, () => new Response('{"message":"API limit reached"}', { status: 402 }));
    assert.equal((await g.go(shapes)).status, 402);
  } finally { globalThis.caches = was; }
});
