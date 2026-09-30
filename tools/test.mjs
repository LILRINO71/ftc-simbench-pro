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
// a test that never finishes fails by name after 3 minutes instead of stalling the run
const args = ['--test', '--test-timeout=180000'];
if (process.env.CI) args.push('--test-reporter=spec', '--test-concurrency=2');
const r = spawnSync(process.execPath, [...args, ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
