// The engine tests only load the engine files. The DOM-side files (tessellate,
// view3d, cadview, app) ship in the same bundle but never ran under test, so a
// syntax error there reached the live page as a blank app. Compile the exact
// bundle the build ships, without running it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = fs.readFileSync(path.join(ROOT, 'tools', 'build.mjs'), 'utf8');
const ORDER = JSON.parse('[' + /export const ORDER = \[([\s\S]*?)\];/.exec(build)[1].replace(/'/g, '"') + ']');

test('every file in the shipped bundle compiles, the DOM-side ones included', () => {
  for (const n of ORDER) {
    const src = fs.readFileSync(path.join(ROOT, 'src', n + '.js'), 'utf8');
    assert.doesNotThrow(() => new Function('"use strict";\n' + src), `src/${n}.js`);
  }
  const all = '"use strict";\n' + ORDER.map((n) => fs.readFileSync(path.join(ROOT, 'src', n + '.js'), 'utf8')).join('\n');
  assert.doesNotThrow(() => new Function(all), 'the concatenated bundle (duplicate top-level names, etc.)');
});

test('no method is defined twice in one of the big objects (the later one silently wins)', () => {
  const dup = [];
  for (const n of ORDER) {
    const lines = fs.readFileSync(path.join(ROOT, 'src', n + '.js'), 'utf8').split(/\r?\n/);
    let obj = null, keys = null;
    lines.forEach((l, i) => {
      const open = /^const ([A-Za-z_$][\w$]*)\s*=\s*\{\s*$/.exec(l);
      if (open) { obj = open[1]; keys = new Map(); return; }
      if (obj && /^\};?\s*$/.test(l)) { obj = null; return; }
      if (!obj) return;
      const k = /^  ([A-Za-z_$][\w$]*)\s*(?:\(|:)/.exec(l) || /^  (?:async\s+|\*)([A-Za-z_$][\w$]*)\s*\(/.exec(l);
      if (!k) return;
      if (keys.has(k[1])) dup.push(`src/${n}.js:${i + 1} ${obj}.${k[1]} (first at line ${keys.get(k[1])})`);
      else keys.set(k[1], i + 1);
    });
  }
  assert.deepEqual(dup, []);
});
