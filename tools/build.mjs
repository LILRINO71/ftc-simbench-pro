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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const pkg = JSON.parse(rd('package.json'));

export const DOMAIN = 'app.ftc-simbench.com';

// Concatenation order matters: later files use functions and constants the
// earlier ones define. The engine never touches the DOM; only view3d and app do.
export const ORDER = ['hardware', 'samples', 'step', 'hull', 'inertia', 'expr', 'java', 'mapping', 'robotconfig',
  'compare', 'analyze', 'drivetrain', 'dynamics', 'field', 'shots', 'controllers', 'session', 'mathdoc',
  'gitimport', 'onboarding', 'sim', 'view3d', 'app'];

const argv = process.argv.slice(2);
const MIN = argv.includes('--min');
const STRINGS = argv.includes('--strings');

// An inline script must never contain a literal closing script tag.
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

const engine = ORDER.map((n) => `// ---- src/${n}.js ----\n${rd('src', n + '.js')}`).join('\n');
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

const DESC = 'Drop in a STEP assembly and a Java OpMode. FTC SimBench Pro resolves the kinematics, works out the robot’s real mass and traction, runs the code at 50 Hz, and shows you the math behind it.';

const fragment = [
  '<title>FTC SimBench Pro</title>',
  `<meta name="description" content="${DESC}">`,
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap">',
  // set the saved theme before anything paints, so there's no light flash
  `<script>try{document.documentElement.setAttribute("data-theme",localStorage.getItem("ftcbench.theme")==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}</script>`,
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
  `<style>\n${css}</style>`,
  markup,
  `<script>\n${safe(shotJs)}</script>`,
  `<script>\n${safe(js)}</script>`,
].join('\n');

const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'fragment.html'), fragment, 'utf8');

const favicon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<path d="M16 2.6 27.6 9.3v13.4L16 29.4 4.4 22.7V9.3Z" fill="#F2B230"/>' +
  '<path d="M9.3 21c2-6.4 8.2-9.8 14-8" fill="none" stroke="#231A0E" stroke-width="2.4" stroke-linecap="round"/>' +
  '<circle cx="23.4" cy="13" r="2.4" fill="#231A0E"/></svg>');
const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<meta name="color-scheme" content="dark light">\n` +
  `<meta property="og:title" content="FTC SimBench Pro">\n` +
  `<meta property="og:description" content="${DESC}">\n` +
  `<meta property="og:url" content="https://${DOMAIN}/">\n` +
  `<link rel="icon" href="${favicon}">\n` +
  `</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(DIST, 'index.html'), page, 'utf8');
fs.writeFileSync(path.join(DIST, 'CNAME'), DOMAIN + '\n', 'utf8');
fs.writeFileSync(path.join(DIST, '.nojekyll'), '', 'utf8');

const kb = (s) => (s.length / 1024).toFixed(0) + ' KB';
console.log(`FTC SimBench Pro ${pkg.version} build ${build}${MIN ? (STRINGS ? ' [ship +strings]' : ' [ship]') : ' [dev]'}`);
console.log(`  dist/index.html    ${kb(page)}   (js ${kb(js)}, css ${kb(css)})`);
console.log(`  dist/fragment.html ${kb(fragment)}`);
console.log(`  dist/CNAME         ${DOMAIN}`);
