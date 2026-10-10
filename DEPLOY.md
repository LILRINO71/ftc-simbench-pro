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
in the edge cache (`CACHEABLE`); what that saves against Onshape's yearly allowance is under
**Quota** below.

Until it is set up, `/onshape/status` answers `ready:false`, the import card hides the link box
and offers the URDF export zip instead. Nothing else breaks.

### Register the Onshape app (owner, once)

1. In Onshape: your account icon (top right) → **My account → Developer → OAuth applications →
   Create new OAuth application** (or <https://dev-portal.onshape.com>). Use the account that
   should carry the quota (below): a personal one, not one your school manages, so the app
   doesn't vanish with a graduation.
   - **Name:** `FTC SimBench` (teams see this on Onshape's Allow page)
   - **Primary format:** `com.ftcsimbench.app` (any unique reverse-domain name; it can't change later)
   - **Summary:** `Reads your robot's assembly so SimBench can simulate it.`
   - **Type:** `Connected Cloud App` (a site outside Onshape, not a tab inside it)
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
6. Try it with a teammate's Onshape account too, signed in on their own computer. If Onshape
   shows them an error instead of the Allow page, open the app in the dev portal and add a
   **store entry** (it stays private). Their reads still count against your allowance.

### Quota

Onshape meters API calls per year (<https://onshape-public.github.io/docs/auth/limits/>, checked
2026-10-09):

- An app that isn't publicly listed in the Onshape App Store is a **private** app, and every call it
  makes counts against **the app owner's** allowance, whoever signed in: 2,500 calls a year on a
  Free, Standard or EDU Student account, 5,000 per user on Professional. An app created under a
  school's or company's settings counts against that company. Calls that fail (4xx, 5xx) don't
  count, and neither does anything teams do in Onshape itself.
- When the allowance is spent, Onshape answers **402** to every call until the year renews, and more
  can only be bought from Onshape. SimBench then stops the read and tells the team to drop the
  export zip, which uses no API at all.
- Calls from an app **listed publicly in the App Store** count against nobody. That is the only free
  way to let every team use the link; see below.
- See what's used: **My account → Developer → View your API usage**. Onshape emails at 25, 50, 75
  and 100 %.

What one import costs: one call for the document's name, one for the assembly, one for its
features, one per subassembly that has mates, and two per Part Studio the robot places parts from
(shapes, masses). A robot built from 100 Part Studios is about 200 calls the first time, so 2,500 is
roughly a dozen first reads of a big robot a year. Repeats cost less:

- **The browser** keeps every Part Studio it has read (IndexedDB, up to 400). Reading the same
  robot again on the same computer costs the first three calls plus two per Part Studio that
  changed. Parts inserted from other documents (goBILDA, REV) are pinned to a version and never
  change; the team's own Part Studios in a workspace are keyed by the document's microversion, so
  any edit anywhere in that document makes all of them new. Pasting the address of a **version**
  (Onshape: Versions and history → Create version → open it → copy the address) keeps them
  pinned too.
- **The edge cache** keeps Part Studios at a version or microversion. A kept copy of a private
  document still costs one call (the check that this team may open it, same as reading it), but a
  document Onshape says is public (goBILDA's, REV's, any published library) is remembered for a day
  and its kept copies cost nothing. Cloudflare's cache is per data centre, so this helps teams in the
  same region.

So, on a private app: the link is for your own team and a few testers, and other teams use the
export zip.

### Listing the app in the App Store (free, and no quota)

Onshape's launch checklist (<https://onshape-public.github.io/docs/app-store/checklist/>): OAuth2
(done), a store entry with a description and screenshots, at least five beta testers, Onshape's
developer agreement (ask Developer Relations, <onshape-developer-relations@ptc.com>), their QA pass
(up to a week), and a support contact. The checklist asks for a price; ask Developer Relations to
confirm a free listing, and have an adult (a mentor) sign the agreement if the owner is under 18.
Until it's listed, nothing changes for teams except that the link works within the owner's
allowance.

### School networks and Chromebooks

- The sign-in is first-party: the cookie belongs to the SimBench site and is set when Onshape sends
  the team back, so blocking third-party cookies (common on managed Chromebooks) doesn't affect it.
  A blocked pop-up signs in in the same tab instead.
- The web filter has to let through: the site (`ftc-simbench-pro.pages.dev`; some filters block all
  of `*.pages.dev`, so ask IT for that one name, or put the site on a custom domain),
  `cad.onshape.com` and `oauth.onshape.com` (any school that uses Onshape already allows them),
  `cdn.jsdelivr.net` (three.js and OpenCascade; `esm.sh` is the fallback) and Google Fonts.
- A robot in a school's own Onshape enterprise (an address like `myschool.onshape.com`) is read
  through `cad.onshape.com` and that hasn't been tried; if it fails, use the export zip.
- Online matches over a school network need the rooms below.

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
