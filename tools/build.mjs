// Builds FTC SimBench Pro from src/ into dist/:
//   dist/index.html      the deployable app (this is what goes on app.ftc-simbench.com)
//   dist/fragment.html   the same app as an embeddable fragment
//   dist/CNAME           the custom domain, for GitHub Pages / static hosts that read it
//
//   node tools/build.mjs           readable build, for developing
//   node tools/build.mjs --min     ship build: comments and layout stripped
//   node tools/build.mjs --min --strings   ship build with the string table as well
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { minifyJS, minifyCSS, minifyHTML } from './minify.mjs';
import { buildRobot } from './stepgen.mjs';
import { serviceWorker } from './sw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const pkg = JSON.parse(rd('package.json'));

export const DOMAIN = 'app.ftc-simbench.com';
// where the app really lives: link previews (Discord, iMessage, Slack) point here
export const SITE = 'https://ftc-simbench-pro.pages.dev';

// Concatenation order matters: later files use functions and constants the
// earlier ones define. The engine never touches the DOM; only view3d and app do.
export const ORDER = ['hardware', 'samples', 'step', 'hull', 'inertia', 'expr', 'jvm', 'jvmlib', 'jvmprelude', 'jvmrun', 'java', 'roadrunner', 'mapping', 'robotconfig',
  'compare', 'analyze', 'drivetrain', 'frame', 'mates', 'onshapelink', 'onshapecad', 'urdf', 'mjcf', 'jointspec', 'simbot', 'zipin', 'autorig-lib', 'autorig', 'robotcheck', 'dynamics', 'joltmech', 'field', 'shots', 'match', 'robotlite', 'net', 'netrelay', 'lockstep', 'controllers', 'session', 'mathdoc',
  'gitimport', 'onboarding', 'sim', 'tier', 'tessellate', 'view3d', 'cadview', 'app'];

const argv = process.argv.slice(2);
const MIN = argv.includes('--min');
const STRINGS = argv.includes('--strings');

// An inline script must never contain a literal closing script tag.
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

// A dev build tolerates a module that isn't written yet; a ship build never does.
const missing = ORDER.filter((n) => !fs.existsSync(path.join(ROOT, 'src', n + '.js')));
if (missing.length && MIN) { console.error(`ship build refused: src/${missing.join('.js, src/')}.js missing`); process.exit(1); }
if (missing.length) console.warn(`  ! dev build without: ${missing.join(', ')}`);
const engine = ORDER.filter((n) => !missing.includes(n)).map((n) => `// ---- src/${n}.js ----\n${rd('src', n + '.js')}`).join('\n');
const build = crypto.createHash('sha256').update(engine).digest('hex').slice(0, 8);
const banner = `/*! FTC SimBench Pro ${pkg.version} (${build}) — Copyright (c) 2026 LILRINO71. All rights reserved.\n` +
  `    Proprietary. Not open source. Includes the BIOBUZZ Shot Sim (MIT, (c) 2026 LILRINO71). */\n`;

let js = '"use strict";\n' + engine + `\nvar SIMBENCH_BUILD=${JSON.stringify({ v: pkg.version, build })};\n`;
let css = rd('src', 'styles.css');
let markup = rd('src', 'markup.html');
if (MIN) { js = banner + minifyJS(js, { strings: STRINGS }); css = minifyCSS(css); markup = minifyHTML(markup); }
else js = banner + js;

// The BIOBUZZ Shot Sim engine and its measured field, vendored by tools/sync-shot-sim.mjs.
// Its own script tag: it's a UMD module that sets window.ShotEngine.
const SHOT = path.join('vendor', 'biobuzz-shot-sim');
const shotData = { field: JSON.parse(rd(SHOT, 'data', 'field.json')), motors: JSON.parse(rd(SHOT, 'data', 'motors.json')), shooter: JSON.parse(rd(SHOT, 'data', 'shooter.json')) };
let shotJs = `window.SHOT_DATA = ${JSON.stringify(shotData)};\n${rd(SHOT, 'engine.js')}`;
if (MIN) shotJs = minifyJS(shotJs);

// what a shared link says under its title
const SHARE = 'Load your team\'s CAD and Java OpModes and drive them on the 2026-27 BIOBUZZ field: real physics, AI alliance partners, and online matches with other teams. Free, in the browser.';
const DESC = 'Drop in a STEP assembly and a Java OpMode. FTC SimBench Pro resolves the kinematics, works out the robot’s real mass and traction, runs the code at 50 Hz, and shows you the math behind it.';

/* ---- libraries served from this site, not a CDN a school filter may block ----
   three.js is committed in vendor/; OpenCascade and Jolt come from node_modules
   when the build has them (npm ci), else the page falls back to jsDelivr. */
const VENDOR = [
  { key: 'three', from: ['vendor', 'three'], to: 'vendor/three/', files: ['three.min.js', 'LICENSE'] },
  { key: 'occt', from: ['node_modules', 'occt-import-js', 'dist'], to: 'vendor/occt/', files: ['occt-import-js.js', 'occt-import-js.wasm', 'license.occt-import-js.txt', 'license.occt.txt'] },
  { key: 'jolt', from: ['node_modules', 'jolt-physics', 'dist'], to: 'vendor/jolt/', files: ['jolt-physics.wasm-compat.js'], entry: 'jolt-physics.wasm-compat.js' },
];
const VENDOR_SEEN = {};
for (const v of VENDOR) if (v.files.every((f) => fs.existsSync(path.join(ROOT, ...v.from, f)))) VENDOR_SEEN[v.key] = v.to + (v.entry || '');

const fragment = [
  '<title>FTC SimBench Pro</title>',
  `<meta name="description" content="${DESC}">`,
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">',
  // set the saved theme before anything paints, so there's no light flash
  `<script>try{document.documentElement.setAttribute("data-theme",localStorage.getItem("ftcbench.theme")==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}</script>`,
  // three.js from this site (vendor/, served beside the page), the CDN only if that's missing
  '<script src="vendor/three/three.min.js"></script>',
  '<script>window.THREE||document.write(' + JSON.stringify('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><' + '/script>').replace(/<\//g, '<\\/') + ')</script>',
  `<style>\n${css}</style>`,
  markup,
  `<script>\n${safe(shotJs)}</script>`,
  `<script>\n${safe(js)}</script>`,
].join('\n');

const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });
for (const v of VENDOR) if (VENDOR_SEEN[v.key]) {
  fs.mkdirSync(path.join(DIST, v.to), { recursive: true });
  for (const f of v.files) fs.copyFileSync(path.join(ROOT, ...v.from, f), path.join(DIST, v.to, f));
}
fs.writeFileSync(path.join(DIST, 'fragment.html'), fragment, 'utf8');

const favicon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<path d="M16 2.6 27.6 9.3v13.4L16 29.4 4.4 22.7V9.3Z" fill="#F2B230"/>' +
  '<path d="M9.3 21c2-6.4 8.2-9.8 14-8" fill="none" stroke="#231A0E" stroke-width="2.4" stroke-linecap="round"/>' +
  '<circle cx="23.4" cy="13" r="2.4" fill="#231A0E"/></svg>');
const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<meta name="color-scheme" content="dark light">\n` +
  `<meta name="theme-color" content="#0F1012">\n` +
  `<meta property="og:type" content="website">\n` +
  `<meta property="og:site_name" content="FTC SimBench Pro">\n` +
  `<meta property="og:title" content="FTC SimBench Pro: drive your real robot before it's built">\n` +
  `<meta property="og:description" content="${SHARE}">\n` +
  `<meta property="og:url" content="${SITE}/">\n` +
  `<meta property="og:image" content="${SITE}/og.png">\n` +
  `<meta property="og:image:width" content="1440">\n<meta property="og:image:height" content="900">\n` +
  `<meta property="og:image:alt" content="A team's own FTC robot, from its Onshape CAD, running its own TeleOp on the BIOBUZZ field">\n` +
  `<meta name="twitter:card" content="summary_large_image">\n` +
  `<link rel="icon" href="${favicon}">\n` +
  `<link rel="manifest" href="manifest.webmanifest">\n` +
  // which libraries this site serves itself (the build copies them when it has them); only the
  // full page says so: a page that embeds the fragment has no vendor/ beside it, and uses the CDNs
  `<script>window.SIMBENCH_VENDOR=${JSON.stringify(VENDOR_SEEN)};for(var k in SIMBENCH_VENDOR)SIMBENCH_VENDOR[k]=new URL(SIMBENCH_VENDOR[k],location.href).href;</script>\n` +
  `</head>\n<body>\n${fragment}\n` +
  // installable, and it opens from cache on a venue's bad Wi-Fi (dist/sw.js); only the full page registers it
  `<script>if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost"))addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){})})</script>\n` +
  `</body>\n</html>\n`;
fs.writeFileSync(path.join(DIST, 'index.html'), page, 'utf8');
fs.writeFileSync(path.join(DIST, 'CNAME'), DOMAIN + '\n', 'utf8');
// the app as an installable web app, and its offline cache
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0F1012"/>' +
  '<path d="M16 2.6 27.6 9.3v13.4L16 29.4 4.4 22.7V9.3Z" fill="#F2B230"/><path d="M9.3 21c2-6.4 8.2-9.8 14-8" fill="none" stroke="#231A0E" stroke-width="2.4" stroke-linecap="round"/>' +
  '<circle cx="23.4" cy="13" r="2.4" fill="#231A0E"/></svg>';
fs.writeFileSync(path.join(DIST, 'icon.svg'), ICON, 'utf8');
fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), JSON.stringify({
  name: 'FTC SimBench Pro', short_name: 'SimBench', description: SHARE, start_url: './', scope: './', display: 'standalone',
  background_color: '#0F1012', theme_color: '#0F1012', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 1), 'utf8');
fs.writeFileSync(path.join(DIST, 'sw.js'), serviceWorker(build), 'utf8');
// the picture a shared link shows (og:image)
fs.copyFileSync(path.join(ROOT, 'docs', 'into-the-deep.png'), path.join(DIST, 'og.png'));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '', 'utf8');
// a real STEP robot the CAD view can open with one click, served beside the app
fs.mkdirSync(path.join(DIST, 'demo'), { recursive: true });
// generated, not copied: *.step is gitignored, so a clean checkout has no file to copy
fs.writeFileSync(path.join(DIST, 'demo', 'mecanum-demo.step'), buildRobot('mecanum-offset').text, 'utf8');
// the robot the app opens with (src/app.js DEFAULT_ROBOT): its gzipped STEP, joint spec and OpModes
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from, { withFileTypes: true })) {
    if (f.isDirectory()) copyDir(path.join(from, f.name), path.join(to, f.name));
    else fs.copyFileSync(path.join(from, f.name), path.join(to, f.name));
  }
};
if (fs.existsSync(path.join(ROOT, 'assets', 'robots'))) copyDir(path.join(ROOT, 'assets', 'robots'), path.join(DIST, 'robots'));

// Cloudflare Pages / Netlify read this. The page is one file that changes every
// deploy, so it must never be cached hard; everything else here is immutable.
fs.writeFileSync(path.join(DIST, '_headers'),
  `/*\n` +
  `  X-Content-Type-Options: nosniff\n` +
  `  Referrer-Policy: strict-origin-when-cross-origin\n` +
  `  Permissions-Policy: gamepad=(self), geolocation=(), camera=(), microphone=()\n` +
  `/index.html\n` +
  `  Cache-Control: public, max-age=0, must-revalidate\n` +
  `/\n` +
  `  Cache-Control: public, max-age=0, must-revalidate\n`, 'utf8');

const kb = (s) => (s.length / 1024).toFixed(0) + ' KB';
console.log(`FTC SimBench Pro ${pkg.version} build ${build}${MIN ? (STRINGS ? ' [ship +strings]' : ' [ship]') : ' [dev]'}`);
console.log(`  dist/index.html    ${kb(page)}   (js ${kb(js)}, css ${kb(css)})`);
console.log(`  dist/fragment.html ${kb(fragment)}`);
console.log(`  dist/CNAME         ${DOMAIN}`);
