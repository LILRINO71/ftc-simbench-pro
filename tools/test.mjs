// Runs every tests/*.test.mjs that exists, so a module being written right now
// doesn't take the whole suite down with it.
//
//   node tools/test.mjs            all of them
//   node tools/test.mjs dynamics   just the ones whose name matches
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pick = process.argv.slice(2);
const files = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !pick.length || pick.some((p) => f.includes(p)))
  .sort()
  .map((f) => path.join('tests', f));

if (!files.length) { console.error('no test files matched'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
