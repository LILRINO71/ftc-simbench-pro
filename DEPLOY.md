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
| `CNAME` | `app.ftc-simbench.com` — GitHub Pages and some hosts read this |
| `.nojekyll` | stops Jekyll eating files that start with `_` |

Two external requests remain at runtime: Google Fonts and the three.js CDN. To be fully
self-hosted, download `three.min.js` into `vendor/` and inline the fonts — see "Going
dependency-free" below.

## Hosting: pick one

**Cloudflare Pages (recommended).** Free, serves from a private repo, custom domains and HTTPS
included, and the build can run on their side.
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick
   `LILRINO71/ftc-simbench-pro` (authorise the private repo).
2. Build command `npm run build:ship`, output directory `dist`.
3. Custom domains → `app.ftc-simbench.com`. If the domain is already on Cloudflare DNS the record
   is created for you; otherwise add the `CNAME` they show you at your registrar.

**Netlify.** Same shape: build `npm run build:ship`, publish `dist`, then Domain settings → add
`app.ftc-simbench.com`.

**GitHub Pages — read this first.** Pages from a *private* repository needs a paid GitHub plan. On
the free plan, publishing this repo to Pages would mean making it public, which defeats the point.
Use Cloudflare or Netlify instead, or publish only the built `dist/` to a separate public repo and
accept that the bundle is readable (it is anyway — see below).

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
- [ ] Opened `dist/index.html` from the filesystem and driven a robot
- [ ] Support link points at your real checkout
- [ ] Tested on the laptop the team actually brings to competition
- [ ] A `.ftcsim` saved on one machine opens on another
