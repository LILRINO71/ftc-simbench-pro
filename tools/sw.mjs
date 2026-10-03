// The offline cache tools/build.mjs writes as dist/sw.js.
//
// The page itself is network-first, so a deploy shows up at once, with the
// cached copy when the network is slow (4 s) or gone. This site's libraries,
// robots and icons are cache-first: fetched once, then from the machine. Fonts
// and CDN copies are kept as they arrive. Sign-in (/onshape/) and match rooms
// (/room/) are live and never cached. Old builds' caches are deleted when a new
// one takes over.
export function serviceWorker(version) {
  const body = function () {
    const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'vendor/three/three.min.js'];
    self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
    self.addEventListener('activate', (e) => {
      e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('sb-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
    });
    const put = (req, res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; };
    const CDN = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh)$/;
    self.addEventListener('fetch', (e) => {
      const req = e.request; if (req.method !== 'GET') return;
      const url = new URL(req.url), same = url.origin === location.origin;
      if (same && /^\/(room|onshape)\//.test(url.pathname)) return;
      if (req.mode === 'navigate' || (same && /\/(index\.html)?$/.test(url.pathname))) {
        e.respondWith(new Promise((resolve) => {
          let done = false;
          const fallback = () => caches.match(req).then((r) => r || caches.match('index.html')).then((r) => { if (!done && r) { done = true; resolve(r); } return r; });
          const t = setTimeout(fallback, 4000);
          fetch(req).then((res) => { clearTimeout(t); put(req, res); if (!done) { done = true; resolve(res); } })
            .catch(() => { clearTimeout(t); fallback().then((r) => { if (!done && !r) { done = true; resolve(Response.error()); } }); });
        }));
        return;
      }
      const cacheFirst = same ? (/^\/(vendor|robots|demo)\//.test(url.pathname) || /\.(png|svg|webmanifest)$/.test(url.pathname)) : CDN.test(url.hostname);
      if (!cacheFirst) return;
      e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
    });
  };
  return `/* FTC SimBench Pro offline cache, build ${version} */\nconst VERSION = ${JSON.stringify('sb-' + version)};\n(${body.toString()})();\n`;
}
