# Deploying FTC SimBench Pro

The app is one static folder plus one small server function (the Onshape sign-in relay). It is
built and hosted on **Cloudflare Pages** from this repo; every push to `main` rebuilds the live
site at <https://ftc-simbench-pro.pages.dev>. This file is the owner's checklist: what ships, how
the Pages project is set up, and the one thing only the owner can do (register the Onshape app).

## What ships

```bash
npm test && npm run build:ship
```

That writes `dist/`:

| file | what it is |
|---|---|
| `index.html` | the app, one file; three.js r186 and its add-ons load from jsDelivr as ES modules |
| `engine-<hash>.js` | the engine alone, run in a Web Worker to read CAD (and an Onshape assembly) off the page's thread; immutable, cached for a year |
| `fragment.html` | the same app without `<html>`/`<head>`, for embedding |
| `_headers` | cache and security headers, read by Cloudflare Pages |
| `robots/`, `demo/`, `og.png` | the default robot, the demo STEP and the link-preview image |

`functions/onshape/[[path]].js` is not in `dist/`: Cloudflare Pages picks up `functions/` by
itself and serves it at `/onshape/*`.

Three external requests remain at runtime: Google Fonts, the three.js CDN (jsDelivr) and
OpenCascade (jsDelivr, the first time a STEP is dropped). `dist/` is build output and is never
committed (AGENTS.md).

## The Pages project

1. Sign in at <https://dash.cloudflare.com> (a free account is enough).
2. **Compute (Workers & Pages) → Create → Pages → Connect to Git.**
3. Authorise GitHub and give it **LILRINO71/ftc-simbench-pro**. The repo can stay private;
   Cloudflare only reads it.
4. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build:ship`
   - **Build output directory:** `dist`
   - Nothing else. `.node-version` pins Node 22; `npm install` is only the one dev dependency.
5. **Save and Deploy.** The first build takes about a minute, and the link appears at the top of
   the page. Every push to `main` rebuilds it.

What Cloudflare runs is exactly what runs locally (`npm install && npm run build:ship`), so there
are no surprises.

## Sign in with Onshape (the main import route needs this)

A team imports its robot by pasting its Onshape assembly's address. SimBench reads the assembly
from Onshape's API, signed in as the team. Onshape's API answers no cross-site call from a browser
and the sign-in needs an app secret, so the read goes through `functions/onshape/[[path]].js`:
Onshape's OAuth page, then a read-only pass-through of exactly the calls the robot reader makes
(`ALLOWED` in that file), with the team's token in an encrypted HttpOnly cookie that only
`/onshape/*` ever sees. Part Studio shapes and masses pinned to a version or microversion are kept
in the edge cache (`CACHEABLE`), so a goBILDA part read by one team is served to the next from the
cache and the app's API quota goes further.

Until it is set up, `/onshape/status` answers `ready:false`, the import card hides the link box
and offers the URDF export zip instead. Nothing else breaks.

### Register the Onshape app (owner, once)

1. Go to <https://dev-portal.onshape.com>, sign in with your Onshape account, and open
   **OAuth applications → Create new OAuth application**.
   - **Name:** `FTC SimBench` (teams see this on Onshape's Allow page)
   - **Primary format:** `com.ftcsimbench.app` (any unique reverse-domain name; it can't change later)
   - **Summary:** `Reads your robot's assembly so SimBench can simulate it.`
   - **Redirect URLs:** `https://ftc-simbench-pro.pages.dev/onshape/callback`
     (add every other hostname the site is served from, one per line)
   - **OAuth URL:** `https://ftc-simbench-pro.pages.dev/`
   - **Permissions:** tick only **Application can read your documents**.
2. Click **Create application**. Copy the **Client ID** and the **Client secret** right away;
   Onshape shows the secret only once.
3. In Cloudflare: **Workers & Pages → ftc-simbench-pro → Settings → Variables and Secrets → Add**,
   for **Production** (and Preview if you want preview deploys to work too):
   - `ONSHAPE_CLIENT_ID`: the Client ID (type Text)
   - `ONSHAPE_CLIENT_SECRET`: the Client secret (type **Secret**)
4. **Deployments → the latest one → Retry deployment**, so the function sees them.
5. Open the site. The import card now shows the link box. Paste an assembly's address, click
   **Get my robot**, click **Allow** on Onshape's page, and the robot arrives.
6. Try it with a teammate's Onshape account too. A private OAuth app can be authorised by any
   Onshape user, but if Onshape shows them an error instead of the Allow page, open the app in
   the dev portal and add a **store entry** (it can stay unlisted).

### Quota

Onshape meters API calls per app. A private app has a yearly allowance that counts against the
app owner's plan; every import costs one call for the assembly, one for its features, and two per
Part Studio the robot uses (one for shapes, one for masses). The edge cache absorbs the Part Studio
calls for library parts after the first team reads them. If the allowance runs low, publishing the
app in Onshape's App Store lifts the limit; teams can always fall back to the export zip meanwhile.

## Online rooms (do this once, so matches work on school networks)

School networks drop UDP and WebSockets to unknown hosts, so the browsers' direct WebRTC
connections and the public relays they meet through often fail there. The site can run its own
match rooms instead, reached over HTTPS on SimBench's own address, which a school can't block
without blocking SimBench (`docs/online.md`, "The network"). Each room is a Cloudflare Durable
Object; the class lives in `workers/room/`, deployed as its own small Worker, and the Pages
Function `functions/room/` routes `/room/*` to it.

1. Deploy the Worker that holds the rooms (once, and again whenever `workers/room/` changes):
   ```bash
   npx wrangler login
   npx wrangler deploy --config workers/room/wrangler.toml
   ```
   It's called `ftc-simbench-rooms`. Durable Objects with SQLite storage are on the free plan.
2. In Cloudflare: **Workers & Pages → ftc-simbench-pro → Settings → Bindings → Add → Durable
   Object namespace**: variable name `ROOMS`, Worker `ftc-simbench-rooms`, class `RoomDO`.
   Add it for Production (and Preview if you test there).
3. **Deployments → the latest one → Retry deployment.**
4. Check: `https://<site>/room/health` says `{"ready":true,...}`. Players going online now meet
   in the site's own rooms.

Without the binding, `/room/health` says `ready:false` and the page uses direct WebRTC as before.

**Cost.** A room sleeps between messages (WebSocket hibernation). Incoming WebSocket messages are
billed at 20 to a request: a four-player match sends about 100 poses and states a second, so an
hour of one match is about 18,000 billed requests. The free plan's 100,000 a day covers a few
match-hours a day; past that it's the Workers Paid plan.

### TURN (optional)

For sites without rooms, or as WebRTC's fallback: Cloudflare Realtime TURN relays WebRTC through
TCP port 443 when UDP is blocked. Create a TURN key in **Realtime → TURN**, then add two secrets
to the Pages project: `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. `/room/turn` hands browsers
short-lived credentials; the key never reaches the page. 1,000 GB a month is free.

## About "protecting" the code

The ship build strips every comment and collapses layout, and `tests/ship.test.mjs` runs the whole
engine suite against the minified bundle, so it is proven to behave like the readable one. That
raises the effort of lifting the physics model. It is not security, and nothing that runs in a
browser can be: anything in the page is readable by anyone who opens it. Nothing secret belongs in
the bundle. The one secret this project has (the Onshape client secret) lives in Cloudflare, read
only by the function.

## Checklist before announcing it

- [ ] `npm test` green, `npm run build:ship` clean
- [ ] Sign in with Onshape set up (above), tried with the owner's robot and with a teammate's account
- [ ] Tried on a school Chromebook: the pasted link, then INIT and START
- [ ] A `.ftcsim` saved on one machine opens on another
- [ ] Tested on the laptop the team actually brings to competition
