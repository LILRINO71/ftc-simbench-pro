/* ============================================================
   SIGN IN WITH ONSHAPE (Cloudflare Pages Function, /onshape/*)
   The import route: the team signs in to Onshape through Onshape's own
   OAuth page, pastes their assembly's address, and the page (in its engine
   worker) reads the assembly from Onshape's API through here.

   Why a server at all: Onshape's API doesn't answer cross-site calls from
   a browser (no CORS), and trading the sign-in code for a token needs the
   app's secret, which can't live in the page.

     GET  /onshape/status    {ready, signedIn}
     GET  /onshape/login     to Onshape's "Allow" page
     GET  /onshape/callback  back from it: keeps the token, closes the window
     POST /onshape/logout
     GET  /onshape/api/...   read-only pass-through to cad.onshape.com/api/...

   The token stays in an encrypted, HttpOnly cookie that only /onshape/*
   ever sees; the page never holds it. Only GETs on the paths the robot
   reader uses are passed on, and only to cad.onshape.com.

   Set up once (DEPLOY.md, "Sign in with Onshape"): register an OAuth app
   at dev-portal.onshape.com with permission "Application can read your
   documents" and redirect URL https://<site>/onshape/callback, then give
   the Pages project two secrets: ONSHAPE_CLIENT_ID and
   ONSHAPE_CLIENT_SECRET. Without them, /onshape/status says ready:false
   and the import card offers the export zip instead.
   ============================================================ */
const OAUTH = "https://oauth.onshape.com/oauth";
const API = "https://cad.onshape.com/api/";
const COOKIE = "sb_os", STATE = "sb_os_state";
// what the robot reader calls (src/onshapelink.js onshapeRead), and nothing else; a query (configuration,
// tolerances, massAsGroup) rides along
const ALLOWED = /^(?:v\d+\/)?(?:assemblies\/d\/[0-9a-f]{24}\/[wvm]\/[0-9a-f]{24}\/e\/[0-9a-f]{24}(?:\/features)?|partstudios\/d\/[0-9a-f]{24}\/[wvm]\/[0-9a-f]{24}\/e\/[0-9a-f]{24}\/(?:tessellatedfaces|massproperties)|documents\/[0-9a-f]{24})$/i;
// what may be kept at the edge: a Part Studio's shapes or masses at a version (v) or microversion (m); a workspace (w) moves
const CACHEABLE = /^(?:v\d+\/)?partstudios\/d\/[0-9a-f]{24}\/[vm]\/[0-9a-f]{24}\/e\/[0-9a-f]{24}\/(?:tessellatedfaces|massproperties)$/i;

const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };

async function cookieKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("simbench-onshape-cookie|" + (env.SESSION_SECRET || env.ONSHAPE_CLIENT_SECRET)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cookieKey(env), enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64u(out);
}
async function unseal(env, s) {
  try {
    const u = unb64u(s);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, await cookieKey(env), u.slice(12));
    return JSON.parse(dec.decode(pt));
  } catch (e) { return null; }
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.get("Cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("="); if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/onshape; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

/* the token from Onshape, by code or by refresh token */
async function token(env, fetchImpl, form) {
  const r = await fetchImpl(OAUTH + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...form, client_id: env.ONSHAPE_CLIENT_ID, client_secret: env.ONSHAPE_CLIENT_SECRET }).toString(),
  });
  if (!r.ok) return null;
  const t = await r.json().catch(() => null);
  if (!t || !t.access_token) return null;
  return { a: t.access_token, r: t.refresh_token || form.refresh_token || null, e: Date.now() + (Number(t.expires_in) > 0 ? t.expires_in : 3600) * 1000 };
}

/* the little page Onshape sends the team back to: tell the SimBench tab, then close */
function backPage(ok, msg) {
  const data = JSON.stringify({ type: "simbench-onshape-signin", ok, msg: msg || "" }).replace(/</g, "\\u003c");
  const text = ok ? "Signed in to Onshape. You can close this window." : "Onshape sign-in didn't finish: " + msg.replace(/[<&]/g, "");
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SimBench · Onshape</title>
<body style="font:16px system-ui;margin:40px;color:#1d2433">${text}<script>
var d=${data};
try{ if(window.opener&&!window.opener.closed){ window.opener.postMessage(d,location.origin); window.close(); } }catch(e){}
setTimeout(function(){ location.replace("/#onshape-"+(d.ok?"signed-in":"signin-failed")); },400);
</script>`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function handle(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/onshape\/?/, "");
  const ready = !!(env.ONSHAPE_CLIENT_ID && env.ONSHAPE_CLIENT_SECRET);
  const jar = cookies(request);

  if (route === "status") {
    const s = ready && jar[COOKIE] ? await unseal(env, jar[COOKIE]) : null;
    return json({ ready, signedIn: !!s });
  }
  if (!ready) return json({ error: "not-set-up", message: "Sign in with Onshape isn't switched on for this site yet." }, 501);

  if (route === "login") {
    const state = b64u(crypto.getRandomValues(new Uint8Array(18)));
    const to = new URL(OAUTH + "/authorize");
    to.searchParams.set("response_type", "code");
    to.searchParams.set("client_id", env.ONSHAPE_CLIENT_ID);
    to.searchParams.set("redirect_uri", url.origin + "/onshape/callback");
    to.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { Location: to.toString(), "Set-Cookie": setCookie(STATE, state, 600), "Cache-Control": "no-store" } });
  }

  if (route === "callback") {
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (url.searchParams.get("error")) return backPage(false, "you chose not to allow it (" + url.searchParams.get("error").slice(0, 60) + ")");
    if (!code || !state || state !== jar[STATE]) return backPage(false, "the sign-in link was stale. Click Sign in with Onshape again");
    const t = await token(env, fetchImpl, { grant_type: "authorization_code", code, redirect_uri: url.origin + "/onshape/callback" });
    if (!t) return backPage(false, "Onshape didn't hand over the sign-in. Click Sign in with Onshape again");
    const res = backPage(true);
    res.headers.append("Set-Cookie", setCookie(COOKIE, await seal(env, t), 60 * 60 * 24 * 30));
    res.headers.append("Set-Cookie", setCookie(STATE, "", 0));
    return res;
  }

  if (route === "logout") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    return json({ ok: true }, 200, { "Set-Cookie": setCookie(COOKIE, "", 0) });
  }

  if (route.startsWith("api/")) {
    if (request.method !== "GET") return json({ error: "method", message: "SimBench only reads from Onshape." }, 405);
    const path = route.slice(4);
    if (!ALLOWED.test(path)) return json({ error: "path", message: "SimBench doesn't read that from Onshape." }, 403);
    let t = jar[COOKIE] ? await unseal(env, jar[COOKIE]) : null;
    const signedOut = () => json({ error: "signed-out", message: "Sign in with Onshape again." }, 401, { "Set-Cookie": setCookie(COOKIE, "", 0) });
    if (!t) return signedOut();
    let fresh = false;
    const refresh = async () => { if (!t.r) return false; const n = await token(env, fetchImpl, { grant_type: "refresh_token", refresh_token: t.r }); if (!n) return false; t = n; fresh = true; return true; };
    if (t.e < Date.now() + 60000 && !(await refresh())) return signedOut();
    // Part Studio shapes and masses pinned to a version or a microversion never change,
    // so they are kept at the edge and served to the next team that reads the same
    // goBILDA or REV part: fewer calls against the quota, and a faster second import.
    // The assembly definition (a workspace, which moves) is never cached.
    const cacheable = CACHEABLE.test(path);
    const key = cacheable ? new Request("https://simbench-onshape-cache/" + path + url.search) : null;
    const store = cacheable && typeof caches !== "undefined" ? caches.default : null;
    if (store) { const hit = await store.match(key).catch(() => null); if (hit) { const h = new Headers(hit.headers); h.set("X-SimBench-Cache", "hit"); return new Response(hit.body, { status: hit.status, headers: h }); } }
    const call = () => fetchImpl(API + path + url.search, { headers: { Authorization: "Bearer " + t.a, Accept: "application/json" } });
    let r = await call();
    if (r.status === 401 && !fresh) { if (!(await refresh())) return signedOut(); r = await call(); }
    const headers = new Headers({ "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" });
    const ra = r.headers.get("Retry-After"); if (ra) headers.set("Retry-After", ra);
    if (fresh) headers.append("Set-Cookie", setCookie(COOKIE, await seal(env, t), 60 * 60 * 24 * 30));
    if (store && r.ok) {
      const body = await r.arrayBuffer();
      const keep = new Response(body, { status: 200, headers: { "Content-Type": headers.get("Content-Type"), "Cache-Control": "public, max-age=" + (/\/v\//.test(path) ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7) } });
      try { await store.put(key, keep); } catch (e) { /* too big for the edge cache: served, not kept */ }
      headers.set("X-SimBench-Cache", "miss");
      return new Response(body, { status: 200, headers });
    }
    return new Response(r.body, { status: r.status, headers });
  }
  return json({ error: "not-found" }, 404);
}

export const onRequest = (context) => handle(context.request, context.env);
