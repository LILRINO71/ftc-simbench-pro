// Finds code nothing uses: top-level functions, constants and classes in src/*.js, methods of the
// top-level objects, and CSS classes and ids. A name counts as used when it appears anywhere else
// in src/, tests/, tools/, site/, functions/ or workers/ as a whole word. It is a screen, not a
// proof: a name built at run time ("on" + kind) or reached through a string will look unused, and a
// name shared by two things will look used. Read each hit before deleting it.
//
//   node tools/unused.mjs               everything
//   node tools/unused.mjs --css         only the style sheets
//   node tools/unused.mjs --js          only the scripts
//   node tools/unused.mjs --tests       also count a name only tests/load.mjs lists (its EXPORTS) as unused
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const walk = (d, ext, out = []) => {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, ext, out); else if (ext.test(e.name)) out.push(f);
  }
  return out;
};
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

const SRC = walk(path.join(ROOT, 'src'), /\.js$/).filter((f) => !/autorig-lib\.js$/.test(f));   // generated: never hand-edited
const ALL = [...walk(path.join(ROOT, 'src'), /\.(js|html|css)$/), ...walk(path.join(ROOT, 'tests'), /\.(mjs|js|json)$/), ...walk(path.join(ROOT, 'tools'), /\.(mjs|js|py)$/),
  ...walk(path.join(ROOT, 'site'), /\.(html|js|css)$/), ...walk(path.join(ROOT, 'functions'), /\.(js|mjs)$/), ...walk(path.join(ROOT, 'workers'), /\.(js|mjs)$/)];
const text = new Map(ALL.map((f) => [f, read(f)]));
const LOADER = path.join(ROOT, 'tests', 'load.mjs');
const wordCount = (s, w) => { let n = 0; const re = new RegExp('(?<![\\w$])' + w.replace(/\$/g, '\\$') + '(?![\\w$])', 'g'); while (re.exec(s)) n++; return n; };
const countIn = (w, skip) => { let n = 0; for (const [f, s] of text) if (!skip || !skip(f)) n += wordCount(s, w); return n; };

/* strip comments and strings so a name in a comment is not a use (keeps offsets and newlines) */
function blank(s) {
  let out = '', i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { while (i < n && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') { while (i < n && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === '"' || c === "'") { out += c; i++; while (i < n && s[i] !== c && s[i] !== '\n') { if (s[i] === '\\') { out += ' '; i++; } out += ' '; i++; } out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

const hits = [];
if (!argv.includes('--css')) {
  const testsToo = argv.includes('--tests');
  for (const f of SRC) {
    const code = blank(read(f));
    const names = new Map();   // name -> kind
    for (const m of code.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) names.set(m[1], 'function');
    for (const m of code.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) names.set(m[1], 'const');
    for (const m of code.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) names.set(m[1], 'class');
    // the methods of a top-level object: `const Foo={` ... `  name(args){` at two spaces
    for (const o of code.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*$/gm)) {
      const end = code.indexOf('\n};', o.index);
      const body = code.slice(o.index, end < 0 ? code.length : end);
      for (const m of body.matchAll(/^  (?:async\s+)?\*?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) names.set(o[1] + '.' + m[1], 'method');
    }
    for (const [name, kind] of names) {
      const bare = kind === 'method' ? name.split('.')[1] : name;
      if (/^(constructor|if|for|while|switch|catch|function|return)$/.test(bare)) continue;
      const total = countIn(bare);
      if (total > 1) {
        if (!testsToo) continue;
        // used only by the test loader's export list and its own declaration
        const other = countIn(bare, (g) => g === LOADER);
        if (other > 1) continue;
      }
      hits.push(`${rel(f)}  ${kind}  ${name}`);
    }
  }
}

const cssHits = [];
if (!argv.includes('--js')) {
  const sheets = walk(path.join(ROOT, 'src'), /\.css$/);
  const other = ALL.filter((f) => !/\.css$/.test(f));
  const blob = other.map((f) => text.get(f)).join('\n');
  for (const f of sheets) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    const seen = new Set();
    // only what is in a selector (before a "{"): a class in a value like content or url() is not one
    for (const sel of css.matchAll(/([^{}]+)\{/g)) {
      if (/^\s*@(media|supports|keyframes|font-face|layer)/.test(sel[1])) continue;
      for (const m of sel[1].matchAll(/([.#])([A-Za-z_][\w-]*)/g)) {
        const key = m[1] + m[2];
        if (seen.has(key)) continue; seen.add(key);
        const used = new RegExp('(?<![\\w-])' + m[2].replace(/[-]/g, '\\-') + '(?![\\w-])').test(blob);
        // classes built at run time ("st-" + state) leave their stem in the source: ask for the stem too
        const stem = m[2].replace(/[-_][\w-]*$/, '');
        const built = stem.length > 2 && new RegExp('["\'`]' + stem.replace(/[-]/g, '\\-') + '[-_]').test(blob);
        if (!used && !built) cssHits.push(`${rel(f)}  ${key}`);
      }
    }
  }
}

if (hits.length) console.log(`JS (${hits.length}):\n` + hits.join('\n'));
if (cssHits.length) console.log(`\nCSS (${cssHits.length}):\n` + cssHits.join('\n'));
if (!hits.length && !cssHits.length) console.log('nothing unused');
