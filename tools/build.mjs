// Builds FTC SimBench Pro from src/ into dist/:
//   dist/index.html      the deployable app (this is what goes on app.ftc-simbench.com)
//   dist/fragment.html   the same app as an embeddable fragment
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
import { threeLoaderScript, ADDONS, VENDOR_THREE, VENDOR_TRYSTERO } from './threeloader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const pkg = JSON.parse(rd('package.json'));

// where the app really lives: link previews (Discord, iMessage, Slack) point here
export const SITE = 'https://ftc-simbench-pro.pages.dev';

// Concatenation order matters: later files use functions and constants the
// earlier ones define. The engine never touches the DOM; only view3d and app do.
export const ORDER = ['hardware', 'samples', 'step', 'hull', 'inertia', 'expr', 'jvm', 'jvmlib', 'jvmprelude', 'jvmrun', 'java', 'roadrunner', 'mapping', 'robotconfig',
  'compare', 'analyze', 'drivetrain', 'frame', 'mates', 'onshapelink', 'onshapecad', 'meshfiles', 'urdf', 'jointspec', 'jointsheet', 'pedrogen', 'partsdb', 'grader', 'autorig-lib', 'autorig', 'robotcheck', 'bind', 'dynamics', 'joltmech', 'field', 'shots', 'match', 'robotlite', 'net', 'netrelay', 'controllers', 'session', 'mathdoc',
  'gitimport', 'onboarding', 'sim', 'calibrate', 'montecarlo', 'tier', 'tessellate', 'view3d', 'cadview', 'engineworker', 'importflow', 'recorder', 'sounds', 'leaderboard', 'results', 'minimap', 'pathedit', 'keybinds', 'mcui', 'app'];
// The browser-side files: everything before them is the engine, which also ships on
// its own as dist/engine.js for the background worker (src/engineworker.js).
export const BROWSER = ['tessellate', 'view3d', 'cadview', 'engineworker', 'importflow', 'recorder', 'sounds', 'leaderboard', 'results', 'minimap', 'pathedit', 'keybinds', 'mcui', 'app'];
// three.js, as ES modules from a CDN, with a second one (tools/threeloader.mjs). The
// page puts it on window.THREE with the add-ons the view uses, and only then boots
// the app (src/app.js waits for "three-ready").
export const THREE_VERSION = '0.186.1';
// The libraries the page also serves from its own dist/vendor/ (copied from node_modules below),
// with the CDN as the fallback. src/net.js, src/joltmech.js and src/tessellate.js name the same versions.
export const TRYSTERO_VERSION = '0.25.4';
export const JOLT_VERSION = '1.1.0';
export const OCCT_VERSION = '0.0.23';

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
const engineOnly = ORDER.filter((n) => !missing.includes(n) && !BROWSER.includes(n)).map((n) => `// ---- src/${n}.js ----\n${rd('src', n + '.js')}`).join('\n');
const build = crypto.createHash('sha256').update(engine).digest('hex').slice(0, 8);
const banner = `/*! FTC SimBench Pro ${pkg.version} (${build}) — Copyright (c) 2026 LILRINO71. All rights reserved.\n` +
  `    Proprietary. Not open source. Includes the BIOBUZZ Shot Sim (MIT, (c) 2026 LILRINO71). */\n`;

// the engine alone, for the worker that parses CAD off the page's thread. Its name
// carries the build hash so a new deploy never runs an old worker from the cache.
const ENGINE_FILE = `engine-${build}.js`;
// the Shot Sim and its field data once more, as a file a worker can load (the Monte Carlo runner, src/mcui.js)
const SHOT_FILE = `shotsim-${crypto.createHash('sha256').update(rd('vendor', 'biobuzz-shot-sim', 'engine.js')).update(rd('vendor', 'biobuzz-shot-sim', 'data', 'field.json')).digest('hex').slice(0, 8)}.js`;
let js = '"use strict";\n' + `var SIMBENCH_ENGINE_URL=${JSON.stringify(ENGINE_FILE)};\nvar SIMBENCH_SHOT_URL=${JSON.stringify(SHOT_FILE)};\n` + engine + `\nvar SIMBENCH_BUILD=${JSON.stringify({ v: pkg.version, build })};\n`;
let engineJs = '"use strict";\n' + engineOnly + `\nvar SIMBENCH_BUILD=${JSON.stringify({ v: pkg.version, build })};\n`;
let css = rd('src', 'styles.css');
let markup = rd('src', 'markup.html');
if (MIN) { js = banner + minifyJS(js, { strings: STRINGS }); engineJs = banner + minifyJS(engineJs, { strings: STRINGS }); css = minifyCSS(css); markup = minifyHTML(markup); }
else { js = banner + js; engineJs = banner + engineJs; }

// The BIOBUZZ Shot Sim engine and its measured field, vendored by tools/sync-shot-sim.mjs.
// Its own script tag: it's a UMD module that sets window.ShotEngine.
const SHOT = path.join('vendor', 'biobuzz-shot-sim');
const shotData = { field: JSON.parse(rd(SHOT, 'data', 'field.json')), motors: JSON.parse(rd(SHOT, 'data', 'motors.json')), shooter: JSON.parse(rd(SHOT, 'data', 'shooter.json')) };
let shotJs = `window.SHOT_DATA = ${JSON.stringify(shotData)};\n${rd(SHOT, 'engine.js')}`;
if (MIN) shotJs = minifyJS(shotJs);
let shotWorkerJs = `self.SHOT_DATA = ${JSON.stringify(shotData)};\n${rd(SHOT, 'engine.js')}`;
if (MIN) shotWorkerJs = minifyJS(shotWorkerJs);

// what a shared link says under its title
const SHARE = 'Load your team\'s CAD and Java OpModes and drive them on the 2026-27 BIOBUZZ field: real physics, AI alliance partners, and online matches with other teams. Free, in the browser.';
const DESC = 'Drop in a STEP assembly and a Java OpMode. FTC SimBench Pro resolves the kinematics, works out the robot’s real mass and traction, runs the code at 50 Hz, and shows you the math behind it.';

const fragment = [
  '<title>FTC SimBench Pro</title>',
  `<meta name="description" content="${DESC}">`,
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">',
  // the saved theme before anything paints, so there's no flash; light is the default
  `<script>try{var t=localStorage.getItem("ftcbench.theme");document.documentElement.setAttribute("data-theme",t==="dark"?"dark":t==="light"?"light":(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))}catch(e){document.documentElement.setAttribute("data-theme","light")}</script>`,
  // three.js and the add-ons the view uses, with a second CDN (tools/threeloader.mjs); the app boots on "three-ready"
  threeLoaderScript(THREE_VERSION, TRYSTERO_VERSION),
  `<style>\n${css}</style>`,
  markup,
  `<script>\n${safe(shotJs)}</script>`,
  `<script>\n${safe(js)}</script>`,
].join('\n');

// --out <dir> builds somewhere else (the size test builds into a temp folder, so it never races a test reading dist/)
const outArg = argv.indexOf('--out');
const DIST = outArg >= 0 && argv[outArg + 1] ? path.resolve(argv[outArg + 1]) : path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'fragment.html'), fragment, 'utf8');
// the engine for the worker; old hashes are left behind by each deploy's clean build
for (const f of fs.readdirSync(DIST)) if (/^engine-[0-9a-f]{8}\.js$/.test(f) && f !== ENGINE_FILE) fs.unlinkSync(path.join(DIST, f));
fs.writeFileSync(path.join(DIST, ENGINE_FILE), engineJs, 'utf8');
for (const f of fs.readdirSync(DIST)) if (/^shotsim-[0-9a-f]{8}\.js$/.test(f) && f !== SHOT_FILE) fs.unlinkSync(path.join(DIST, f));
fs.writeFileSync(path.join(DIST, SHOT_FILE), shotWorkerJs, 'utf8');

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
  `</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(DIST, 'index.html'), page, 'utf8');
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
// the support, privacy and terms pages (an Onshape App Store listing links to them), served at /support, /privacy, /terms
if (fs.existsSync(path.join(ROOT, 'site'))) copyDir(path.join(ROOT, 'site'), DIST);

// The libraries, served from the site itself (the page tries these first and the CDNs
// second, so a school network that blocks CDNs still works). Each folder carries its
// version, so the files can be cached for good. Only what the page really loads is copied.
{
  const NM = path.join(ROOT, 'node_modules');
  const need = (rel) => {
    const f = path.join(NM, rel);
    if (!fs.existsSync(f)) throw new Error(`${rel} is not installed (run npm ci)`);
    return f;
  };
  const put = (from, toRel) => {
    const to = path.join(DIST, toRel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  };
  const version = (pkgDir) => JSON.parse(fs.readFileSync(path.join(need(pkgDir), 'package.json'), 'utf8')).version;
  try {
    fs.rmSync(path.join(DIST, 'vendor'), { recursive: true, force: true });
    // three.js: the module build, plus the add-ons the view uses and whatever they import
    for (const [n, v] of [['three', THREE_VERSION], ['trystero', TRYSTERO_VERSION], ['occt-import-js', OCCT_VERSION], ['jolt-physics', JOLT_VERSION]]) {
      const have = version(n);
      if (have !== v) throw new Error(`node_modules has ${n} ${have} but the build names ${v}`);
    }
    const t3 = VENDOR_THREE(THREE_VERSION);
    for (const f of ['three.module.js', 'three.core.js']) put(need('three/build/' + f), t3 + 'build/' + f);
    const seen = new Set();
    const addon = (rel) => {   // rel: path under examples/jsm/
      if (seen.has(rel)) return;
      seen.add(rel);
      const file = need('three/examples/jsm/' + rel);
      put(file, t3 + 'examples/jsm/' + rel);
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) addon(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    };
    for (const [, p] of ADDONS) addon(p);
    // Trystero 0.25.4: the nostr strategy, its core and one signing library, all plain ES modules
    // with bare imports that the page's import map points at these files (tools/threeloader.mjs importMap)
    const tt = VENDOR_TRYSTERO(TRYSTERO_VERSION);
    put(need('trystero/dist/index.mjs'), tt + 'index.mjs');
    put(need('@trystero-p2p/nostr/dist/index.mjs'), tt + 'nostr.mjs');
    put(need('@noble/secp256k1/index.js'), tt + 'secp256k1.mjs');
    for (const f of fs.readdirSync(need('@trystero-p2p/core/dist'))) if (f.endsWith('.mjs')) put(path.join(NM, '@trystero-p2p/core/dist', f), tt + 'core/' + f);
    // Jolt Physics (the WebAssembly is inside this build) and OpenCascade (script + wasm)
    put(need('jolt-physics/dist/jolt-physics.wasm-compat.js'), `vendor/jolt-physics-${JOLT_VERSION}/jolt-physics.wasm-compat.js`);
    for (const f of ['occt-import-js.js', 'occt-import-js.wasm']) put(need('occt-import-js/dist/' + f), `vendor/occt-import-js-${OCCT_VERSION}/${f}`);
  } catch (e) {
    // a ship build never goes out without them; a dev build falls back to the CDNs
    if (MIN) { console.error('ship build refused: ' + e.message); process.exit(1); }
    console.warn('  ! no vendor/ (' + e.message + '); the page will use the CDNs');
  }
}

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
  `  Cache-Control: public, max-age=0, must-revalidate\n` +
  `/engine-*.js\n` +
  `  Cache-Control: public, max-age=31536000, immutable\n` +
  // the folder names carry the version, so a file at one of these paths never changes
  `/vendor/*\n` +
  `  Cache-Control: public, max-age=31536000, immutable\n` +
  `/shotsim-*.js\n` +
  `  Cache-Control: public, max-age=31536000, immutable\n`, 'utf8');

const kb = (s) => (s.length / 1024).toFixed(0) + ' KB';
console.log(`FTC SimBench Pro ${pkg.version} build ${build}${MIN ? (STRINGS ? ' [ship +strings]' : ' [ship]') : ' [dev]'}`);
console.log(`  dist/index.html    ${kb(page)}   (js ${kb(js)}, css ${kb(css)})`);
console.log(`  dist/${ENGINE_FILE}  ${kb(engineJs)}   (the engine, for the worker)`);
console.log(`  dist/fragment.html ${kb(fragment)}`);
