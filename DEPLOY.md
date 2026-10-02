# Deploying to app.ftc-simbench.com

The whole app is one static folder, so any static host works. What follows is the short path,
the caveats that actually bite, and what you have to do yourself (I can't buy a domain or sign
into a host for you).

## What ships

```bash
npm test && npm run build:ship
```

That writes `dist/`:

| file | what it is |
|---|---|
| `index.html` | the app, one self-contained file |
| `fragment.html` | the same app without `<html>`/`<head>`, for embedding |
| `CNAME` | `app.ftc-simbench.com` — read by GitHub Pages; Cloudflare ignores it harmlessly |
| `_headers` | cache and security headers, read by Cloudflare Pages and Netlify |
| `.nojekyll` | stops Jekyll eating files that start with `_` |

Two external requests remain at runtime: Google Fonts and the three.js CDN. To be fully
self-hosted, download `three.min.js` into `vendor/` and inline the fonts — see "Going
dependency-free" below.

## Hosting: pick one

**Cloudflare Pages — this is the one to use.** Free, builds straight from the *private* repo, and it
hands you a working `https://<project>.pages.dev` link before you own any domain. GitHub Pages
cannot do this: it refuses Pages on a private repo unless you pay
(`422: Your current plan does not support GitHub Pages for this repository`).

1. Sign in at <https://dash.cloudflare.com> (a free account is enough).
2. **Compute (Workers & Pages) → Create → Pages → Connect to Git.**
3. Authorise GitHub, and when it asks which repositories, give it
   **LILRINO71/ftc-simbench-pro**. It stays private; Cloudflare just reads it.
4. Set up the build:
   - **Framework preset:** None
   - **Build command:** `npm run build:ship`
   - **Build output directory:** `dist`
   - Nothing else. (`.node-version` in the repo pins Node 22, and there are no dependencies to
     install.) Cloudflare also picks up `functions/` by itself: that's **Sign in with Onshape**,
     which needs two secrets; see the next section.
5. **Save and Deploy.** The first build takes about a minute. The link appears at the top of the
   page as `https://ftc-simbench-pro.pages.dev` — that is your shareable link, and every push to
   `main` rebuilds it automatically.

Later, when you own the domain: **Custom domains → Set up a domain → `app.ftc-simbench.com`**.
If the domain's DNS is on Cloudflare the record is made for you; otherwise add the CNAME they show
you at your registrar. TLS is automatic either way.

What Cloudflare runs is exactly what you can run locally, so there are no surprises:

```bash
npm install
npm run build:ship
```

**Netlify.** Same shape: build `npm run build:ship`, publish `dist`, then Domain settings → add
`app.ftc-simbench.com`.

**GitHub Pages — read this first.** Pages from a *private* repository needs a paid GitHub plan. On
the free plan, publishing this repo to Pages would mean making it public, which defeats the point.
Use Cloudflare or Netlify instead, or publish only the built `dist/` to a separate public repo and
accept that the bundle is readable (it is anyway — see below).

## Sign in with Onshape (do this once)

Optional: SimBench's main way into Onshape (copy and paste, see the pop-up)
needs no setup and works on school accounts. Sign in with Onshape is a
faster extra for personal accounts. It doesn't work for a school's
Enterprise account, and a private app only gets about 2,500 Onshape API
calls a year, shared by everyone who uses it.

School computers block the "Send to SimBench" bookmark: their admins list `javascript:` URLs as
blocked, so clicking it does nothing and dragging it shows `about:blank#blocked`. **Sign in with
Onshape** works there instead. The team signs in through Onshape's own page, pastes their
assembly's address, and gets the whole robot. It runs in `functions/onshape/[[path]].js`, a
Cloudflare Pages Function that ships with the site, and it needs an Onshape app of yours:

1. Go to <https://dev-portal.onshape.com>, sign in with your Onshape account, and open
   **OAuth applications → Create new OAuth application**.
   - **Name:** `FTC SimBench` (teams see this on Onshape's Allow page)
   - **Primary format:** `com.ftcsimbench.app` (any unique name; it can't change later)
   - **Summary:** `Reads your robot's assembly so SimBench can simulate it.`
   - **Redirect URLs:** `https://ftc-simbench-pro.pages.dev/onshape/callback`
     (add `https://app.ftc-simbench.com/onshape/callback` too once the domain is live)
   - **OAuth URL:** `https://ftc-simbench-pro.pages.dev/`
   - **Permissions:** tick only **Application can read your documents**.
2. Click **Create application**. Copy the **Client ID** and the **Client secret** right away;
   Onshape shows the secret only once.
3. In Cloudflare: **Workers & Pages → ftc-simbench-pro → Settings → Variables and Secrets → Add**,
   for **Production**:
   - `ONSHAPE_CLIENT_ID`: the Client ID
   - `ONSHAPE_CLIENT_SECRET`: the Client secret (type **Secret**)
4. **Deployments → the latest one → Retry deployment**, so the function sees them.
5. Open the site, click **Get my robot from Onshape → Sign in with Onshape**, click **Allow**, and
   paste an assembly's address. Then try it with a teammate's Onshape account too. If Onshape
   shows them an error instead of the Allow page, the app needs a store entry before others can use
   it: open the app in the dev portal and create one.

Until the secrets are set, the pop-up says Sign in with Onshape isn't switched on and offers the
bookmark and STEP files instead. The secret never reaches the page. Each team's Onshape token is
kept in an encrypted, HttpOnly cookie that only `/onshape/*` sees. The function only reads, and only
the calls the robot reader makes, and only from `cad.onshape.com`.

## The domain

`ftc-simbench.com` has to be registered and paid for by you; I can't do that. Once it is:
- point `app` at your host (Cloudflare Pages and Netlify both show you the exact record),
- let the host issue the TLS certificate (both do it automatically),
- keep `dist/CNAME` in sync if you also use GitHub Pages anywhere.

## Donations

The **Support** button in the header is a plain link. Set your real checkout URL once, in
`src/markup.html`:

```html
<a class="hdr-btn support" id="supportBtn" href="https://buymeacoffee.com/YOURNAME" ...>
```

Buy Me a Coffee or Ko-fi needs nothing but that link. Stripe Payment Links are the same idea:
create the link in the Stripe dashboard and paste it in. Do not put API keys or secrets in this
app — it is client-side code, and anything in it is public to anyone who opens the page. A
checkout link is safe; a secret key never is.

## About "protecting" the code

The ship build strips every comment, collapses layout, and can move string literals into an
encoded table (`--strings`). `tests/ship.test.mjs` runs the entire engine test suite against the
minified bundle, so the ship build is proven to behave identically to the readable one.

Measured on this build:

| build | page | JS |
|---|---|---|
| `npm run build` (dev) | 615 KB | 435 KB |
| `npm run build:ship` (`--min`) | 468 KB | 320 KB |
| `--min --strings` | 547 KB | 400 KB |

Note the last row: base64 costs a third on top of the strings it hides, so the obfuscated build is
**80 KB bigger**, not smaller. Take it only if hiding strings is worth the download.

That raises the effort of lifting the physics model. It is not security, and nothing that runs in
a browser can be. If a part of this ever has to be genuinely unavailable to users, it has to move
behind an API you control, with the browser sending inputs and receiving results.

## Going dependency-free (optional)

1. `curl -o vendor/three.min.js https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`
2. In `tools/build.mjs`, replace the three.js `<script src=...>` with an inline
   `<script>${rd('vendor','three.min.js')}</script>`.
3. Replace the Google Fonts `<link>` with locally hosted `@font-face` rules, or drop it — the app
   falls back to system fonts.

The bundle grows by roughly 600 KB and the app then works with no network at all, which is worth
it for a competition venue with bad wifi.

## Checklist before you announce it

- [ ] `npm test` green, `npm run build:ship` clean
- [ ] Sign in with Onshape set up (above), and tried on a school computer
- [ ] Opened `dist/index.html` from the filesystem and driven a robot
- [ ] Support link points at your real checkout
- [ ] Tested on the laptop the team actually brings to competition
- [ ] A `.ftcsim` saved on one machine opens on another
