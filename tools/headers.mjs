// The site's response headers: dist/_headers, which Cloudflare Pages applies to every
// file it serves (not to the Pages Functions' answers: functions/* set their own).
//
// Enforced on every path:
//   frame-ancestors   only this site and Onshape (the app may run in an Onshape tab) may
//                     frame it: another site can't put the page, which signs in with
//                     Onshape and posts scores, under a decoy (clickjacking)
//   nosniff, Referrer-Policy, Permissions-Policy
// Report-only, on the app's pages (/, /index.html, /fragment.html):
//   the whole script, worker and connection policy. The page is one big inline script, so
//   script-src names each inline script by its SHA-256, computed here from the page the
//   build wrote. Report-only cannot break anything: a browser runs everything as before
//   and prints each violation in the console. It is enforced once a browser shows none
//   (DEPLOY.md, "Security headers").
import crypto from 'node:crypto';

// who may frame the site: itself and Onshape (cad.onshape.com and companies' own *.onshape.com)
export const FRAME_ANCESTORS = "'self' https://*.onshape.com";

/* The text of every inline <script> in a page, as a browser hashes it: the HTML parser turns
   CR LF and lone CR into LF before a script's text exists, so the hash is taken after that. */
export function inlineScripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(m[1] || '')) continue;
    out.push(m[2].replace(/\r\n?/g, '\n'));
  }
  return out;
}
export const scriptHash = (text) => "'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'";

/* The policy the page should hold to. Each line says what needs it:
   script-src   the inline scripts by hash; the site's own files (the engine and the shot
                sim for the workers, vendor/ modules); the CDN fallbacks (tools/threeloader.mjs,
                src/net.js, src/joltmech.js, src/tessellate.js); 'wasm-unsafe-eval' for
                WebAssembly (Jolt, OpenCascade). No 'unsafe-inline', no 'unsafe-eval'.
   worker-src   the CAD, Monte Carlo and timer workers start from blob: URLs, OCCT's from the site
   connect-src  the site (robots, rooms, Onshape relay, leaderboard), GitHub (OpMode import),
                the CDNs (OCCT's wasm), and the matchmaking relays over wss:; blob:/data: for
                files the page made itself
   style-src    'unsafe-inline': the page sets style attributes in the HTML it writes
   img-src, media-src  data:/blob: for the favicon, textures, screenshots and recorded clips */
export function contentSecurityPolicy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')} 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://esm.sh`,
    "worker-src 'self' blob:",
    "connect-src 'self' https: wss: blob: data:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${FRAME_ANCESTORS}`,
  ].join('; ');
}

/* The _headers text for a build whose app page is `pageHtml` (fragment.html is that page's
   body, so the same inline scripts and the same hashes). */
export function pageHeaders(pageHtml) {
  const hashes = [...new Set(inlineScripts(pageHtml).map(scriptHash))];
  const appPolicy = `  Content-Security-Policy-Report-Only: ${contentSecurityPolicy(hashes)}\n`;
  const fresh = '  Cache-Control: public, max-age=0, must-revalidate\n';
  const forever = '  Cache-Control: public, max-age=31536000, immutable\n';
  return `/*\n` +
    `  Content-Security-Policy: frame-ancestors ${FRAME_ANCESTORS}\n` +
    `  X-Content-Type-Options: nosniff\n` +
    `  Referrer-Policy: strict-origin-when-cross-origin\n` +
    `  Permissions-Policy: gamepad=(self), geolocation=(), camera=(), microphone=()\n` +
    `/index.html\n` + fresh + appPolicy +
    `/\n` + fresh + appPolicy +
    `/fragment.html\n` + appPolicy +
    `/engine-*.js\n` + forever +
    // the folder names carry the version, so a file at one of these paths never changes
    `/vendor/*\n` + forever +
    `/shotsim-*.js\n` + forever;
}
