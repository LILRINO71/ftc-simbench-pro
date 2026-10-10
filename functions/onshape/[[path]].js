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

/* the token from Onshape, by code or by refresh token: {t}, or {why} when
   there is none: "denied" (Onshape refused the code or the refresh token: a
   stale one, or one already used) or "transient" (the token server busy,
   down or unreachable, or an answer that isn't a token) */
async function token(env, fetchImpl, form) {
  let r;
  try {
    r = await fetchImpl(OAUTH + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ ...form, client_id: env.ONSHAPE_CLIENT_ID, client_secret: env.ONSHAPE_CLIENT_SECRET }).toString(),
    });
  } catch (e) { return { why: "transient" }; }
  if (!r.ok) return { why: r.status >= 500 || r.status === 429 ? "transient" : "denied" };
  const t = await r.json().catch(() => null);
  if (!t || !t.access_token) return { why: "transient" };
  return { t: { a: t.access_token, r: t.refresh_token || form.refresh_token || null, e: Date.now() + (Number(t.expires_in) > 0 ? t.expires_in : 3600) * 1000 } };
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
    const got = await token(env, fetchImpl, { grant_type: "authorization_code", code, redirect_uri: url.origin + "/onshape/callback" });
    if (!got.t) return backPage(false, "Onshape didn't hand over the sign-in. Click Sign in with Onshape again");
    const res = backPage(true);
    res.headers.append("Set-Cookie", setCookie(COOKIE, await seal(env, got.t), 60 * 60 * 24 * 30));
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
    const signedOut = (headers) => json({ error: "signed-out", message: "Sign in with Onshape again." }, 401, headers);
    // no cookie, or one that isn't ours (or was edited): signed out, and a bad cookie goes
    if (!t) return signedOut(jar[COOKIE] ? { "Set-Cookie": setCookie(COOKIE, "", 0) } : {});
    /* Renewing the token. The page makes its calls side by side, each with the
       same cookie, so when the token runs out they all renew at once, and
       Onshape takes each refresh token only once: all but the first renewal
       are refused. So a renewal that fails never clears the cookie (the call
       that renewed is setting the new one, and a Max-Age=0 landing after it
       would sign the team out), and the call is still made with the token the
       cookie has, which is often still good. A token server that is down or
       unreachable is "try again", never "sign in again". */
    const fromCookie = t;
    let fresh = false, failed = null;
    const renew = async () => {
      if (!fromCookie.r) { failed = "denied"; return false; }
      const n = await token(env, fetchImpl, { grant_type: "refresh_token", refresh_token: fromCookie.r });
      if (!n.t) { failed = n.why; return false; }
      t = n.t; fresh = true; return true;
    };
    if (t.e < Date.now() + 60000) await renew();              // about to run out
    // Part Studio shapes and masses pinned to a version or a microversion never change,
    // so they are kept at the edge and served to the next team that reads the same
    // goBILDA or REV part: fewer calls against the quota, and a faster second import.
    // The assembly definition (a workspace, which moves) is never cached.
    const cacheable = CACHEABLE.test(path);
    const key = cacheable ? new Request("https://simbench-onshape-cache/" + path + url.search) : null;
    const store = cacheable && typeof caches !== "undefined" ? caches.default : null;
    const call = (p, q) => fetchImpl(API + p + (q || ""), { headers: { Authorization: "Bearer " + t.a, Accept: "application/json" } });
    // one call: refused, renew once and call again, unless a renewal already failed or the token
    // is new. {r}, or {out}: what to answer instead (Onshape's sign-in busy, or signed out)
    const ask = async (p, q) => {
      let r = await call(p, q);
      if (r.status === 401 && !fresh && !failed && await renew()) r = await call(p, q);
      if (r.status === 401 && failed === "transient") return { out: json({ error: "busy", message: "Onshape's sign-in server didn't answer. Trying again." }, 503, { "Retry-After": "2" }) };
      if (r.status === 401 && failed) return { out: signedOut() };
      return { r };
    };
    const keepToken = async (h) => { if (fresh) h.append("Set-Cookie", setCookie(COOKIE, await seal(env, t), 60 * 60 * 24 * 30)); return h; };
    if (store) {
      const hit = await store.match(key).catch(() => null);
      if (hit) {
        // A kept copy was read with someone else's sign-in, and the document may be private:
        // it is only for a team that can open the document itself, which Onshape says with
        // its cheapest call. That call counts against the app's yearly allowance just as the
        // shapes would, so a document Onshape has said is public (goBILDA's, REV's, a
        // published library: anyone can open those) is remembered for a day, and its kept
        // copies then cost no call at all.
        const did = /\/d\/([0-9a-f]{24})\//i.exec(path)[1];
        const open = new Request("https://simbench-onshape-cache/public/" + did);
        let serve = !!(await store.match(open).catch(() => null));
        if (!serve) {
          const c = await ask("documents/" + did);
          if (c.out) return c.out;
          const can = c.r;
          if (can.ok) {
            serve = true;
            const info = await can.json().catch(() => null);
            if (info && info.public === true) try { await store.put(open, new Response("1", { headers: { "Cache-Control": "public, max-age=86400" } })); } catch (e) {}
          } else if (can.status !== 403 && can.status !== 404) {
            // Onshape busy (429, 5xx) or the app's allowance used up (402): said as a fresh read would say it
            const h = await keepToken(new Headers({ "Content-Type": can.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" }));
            const ra = can.headers.get("Retry-After"); if (ra) h.set("Retry-After", ra);
            return new Response(can.body, { status: can.status, headers: h });
          } else if (!url.searchParams.get("linkDocumentId")) {
            return json({ error: "access", message: "Your Onshape account can't open that document." }, can.status === 404 ? 404 : 403, Object.fromEntries(await keepToken(new Headers())));
          }
          // refused, but placed from the team's own document (linkDocumentId): a team can read a
          // library part through the document that uses it without being able to open the library,
          // and only the read itself can carry the link. Onshape decides on a fresh read, below.
        }
        if (serve) {
          const h = await keepToken(new Headers(hit.headers)); h.set("X-SimBench-Cache", "hit"); h.set("Cache-Control", "no-store");
          return new Response(hit.body, { status: hit.status, headers: h });
        }
      }
    }
    const got = await ask(path, url.search);
    if (got.out) return got.out;
    const r = got.r;
    const headers = new Headers({ "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" });
    const ra = r.headers.get("Retry-After"); if (ra) headers.set("Retry-After", ra);
    await keepToken(headers);
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
