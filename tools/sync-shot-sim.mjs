// Copies the BIOBUZZ Shot Sim engine and its measured field data into vendor/.
// The bench uses the same engine for the field geometry, shot verdicts and
// ball flight, so the two tools can never disagree about the HIVE.
//
//   node tools/sync-shot-sim.mjs [path/to/biobuzz-shot-sim]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(process.argv[2] || path.join(ROOT, '..', 'biobuzz-shot-sim'));
const OUT = path.join(ROOT, 'vendor', 'biobuzz-shot-sim');

const need = (p) => { if (!fs.existsSync(p)) { console.error('missing ' + p); process.exit(1); } return p; };
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.copyFileSync(need(path.join(SRC, 'src', 'engine.js')), path.join(OUT, 'engine.js'));
for (const f of ['field.json', 'motors.json', 'shooter.json']) fs.copyFileSync(need(path.join(SRC, 'data', f)), path.join(OUT, 'data', f));
fs.copyFileSync(need(path.join(SRC, 'LICENSE')), path.join(OUT, 'LICENSE'));

let commit = null;
try { commit = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (e) { /* not a checkout */ }
const source = {
  repo: 'https://github.com/LILRINO71/biobuzz-shot-sim',
  commit,
  files: ['src/engine.js', 'data/field.json', 'data/motors.json', 'data/shooter.json', 'LICENSE'],
};
fs.writeFileSync(path.join(OUT, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n', 'utf8');
console.log(`synced shot sim ${commit ? commit.slice(0, 7) : '(no git)'} → vendor/biobuzz-shot-sim`);
