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
