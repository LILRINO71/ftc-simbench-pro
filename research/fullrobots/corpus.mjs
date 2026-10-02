// The code corpus for the benchmark: real teams' OpModes and every other .java file in their repos,
// kept OUTSIDE the repo (AGENTS.md rule 6: no team code or CAD in the repo).
//
//   node research/fullrobots/corpus.mjs                    rewrite <corpus>/code/manifest.json from what's there
//   node research/fullrobots/corpus.mjs --fetch            clone any team in code-sources.json that's missing (git, sparse)
//   node research/fullrobots/corpus.mjs --from=<dir>       one-off: copy <dir>/java/<team>/ and <dir>/repos/<repo>/ in,
//                                                          and write code-sources.json (how the corpus was first made)
//   --corpus=<dir>   default: ../ftc-cad-corpus next to the repo (the same folder research/realcad/fetch.mjs uses)
//
// Layout of <corpus>/code/<team>/:
//   <Primary>.java        the team's main TeleOp, picked by hand when the corpus was made
//   repo/...              every .java file of the team's repo at the recorded commit (TeamCode only)
//   source.json           { repo, url, sha, primary: path of <Primary>.java inside repo/ }
// The manifest lists, per team: the OpModes (by @TeleOp/@Autonomous, or by extending
// OpMode/LinearOpMode/CommandOpMode directly or through the team's own base classes) and the helpers
// (every other .java file).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
export const CORPUS = path.resolve(args.corpus || process.env.SIMBENCH_CORPUS || path.join(HERE, '..', '..', '..', 'ftc-cad-corpus'));
const CODE = path.join(CORPUS, 'code');
const SOURCES = path.join(HERE, 'code-sources.json');

// the folders the accuracy audit drove (scratchpad accuracy/java/<team>), and the repo each came from.
// sdk and rr1 are reference code (the FTC SDK samples, the Road Runner 1.0 quickstart), not teams.
const REPOMAP = {
  t7198: 'AnacortesRobotics_2024-2025-INTOTHEDEEP-7198', t10158: 'AnyiLin_10158-Centerstage', t27570: 'BlueDarkUP_FTC-27570-INTOTHEDEEP-WRC',
  t25832: 'FTC-Ripples-25832_ripples-25832-IntoTheDeep', t8535: 'FTC8535-SharkBytes_2024_2025_FTC8535_IntoTheDeep', t18244: 'Hestia18244_FTC-IntoTheDeep-18244',
  t18763: 'KookyBotz_CenterStage', t25609: 'LOAD-Robotics-Team-25609_Decode-Robot-Code', tLaSalle: 'LaSalleRobots_PowerPlay', tOakGrove: 'OakGroveRobotics_2023-2024',
  tEverybot: 'Robonauts-Everybot_FTC-Everybot-Code-2025-DECODE', t13115: 'Saketh-Ayyagari_FTC13115-IntoTheDeep', t21337: 'TeamDinobyte21337_FTC-Centerstage-21337',
  tTechTurtles: 'Tech-Turtles_Decode', tTechTurb: 'Technical-Turbulence-FTC_IntoTheDeepFTC', t21836: 'arshadanas_21836-IntoTheDeep', t16072: 'ftc16072_IntoTheDeep24-25',
  t24791: 'ftc24791_2025-2026-Decode', t19922: 'rh-robotics_19922-CSRC', tRocket: 'rocketbooster1000_PowerPlay', tRyali: 'ryalisuchir_CenterStage',
  t11691: 'scrippsdragons11691_FtcRobotController-11691-CenterStage', tKleongf: 'kleongf_FTC_Decode', pedro: 'MrWansBoxes_BananaBox16169Decode', rr05: 'rocketbooster1000_PowerPlay',
  rr1team: 'chsbacon_FTC-CENTERSTAGE-7080', tTechTigers: 'techtigers-ftc_intothedeep', tCyberRaptors: 'CyberRaptors_Decode',
};
const REFERENCE = new Set(['sdk', 'rr1', 'ftclib']);

export const walkJava = (d, o = [], base = d) => {
  if (!fs.existsSync(d)) return o;
  for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== '.git') walkJava(p, o, base); } else if (f.name.endsWith('.java')) o.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return o;
};
export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"])\/\/[^\n]*/g, '$1');
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/** What a .java file declares: its top-level class, what it extends, and its OpMode annotations. */
export function classify(src) {
  const t = stripComments(src);
  const m = /\b(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)(?:\s*<[^{]*?>)?(?:\s+extends\s+([\w.]+))?/.exec(t);
  // annotations may be written fully qualified: @com.qualcomm.robotcore.eventloop.opmode.TeleOp
  const name = /@(?:[\w.]+\.)?(?:TeleOp|Autonomous)\s*\(\s*(?:name\s*=\s*)?"([^"]*)"/.exec(t);
  return {
    cls: m ? m[1] : null, ext: m && m[2] ? m[2].replace(/^.*\./, '') : null,
    abstract: !!(m && new RegExp('\\babstract\\s+(?:\\w+\\s+)*class\\s+' + m[1] + '\\b').test(t)),
    teleop: /@(?:[\w.]+\.)?TeleOp\b/.test(t), auto: /@(?:[\w.]+\.)?Autonomous\b/.test(t), disabled: /@(?:[\w.]+\.)?Disabled\b/.test(t),
    name: name ? name[1] : null, pads: /\bgamepad[12]\b/.test(t),
  };
}
const SDK_BASES = new Set(['OpMode', 'LinearOpMode', 'CommandOpMode', 'OpModeEx', 'IterativeOpMode']);

/** One team folder -> its manifest entry. */
export function scanTeam(id) {
  const dir = path.join(CODE, id);
  const files = walkJava(dir);
  const src = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const info = files.map((f) => Object.assign({ file: f, hash: sha1(src(f)) }, classify(src(f))));
  const byCls = new Map(); for (const i of info) if (i.cls && !byCls.has(i.cls)) byCls.set(i.cls, i);
  const isOp = (i, depth = 0) => !!i && depth < 8 && (SDK_BASES.has(i.ext) || (!!i.ext && isOp(byCls.get(i.ext), depth + 1)));
  let source = null; try { source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8')); } catch (e) { source = null; }
  const top = files.filter((f) => !f.includes('/'));
  const primary = REFERENCE.has(id) ? null : (top.find((f) => { const i = info.find((x) => x.file === f); return i && (i.teleop || isOp(i)); }) || null);
  const opmodes = [], helpers = [];
  for (const i of info) {
    if (i.teleop || i.auto || isOp(i)) opmodes.push({ file: i.file, cls: i.cls, kind: i.teleop ? 'teleop' : i.auto ? 'auto' : 'opmode', name: i.name, extends: i.ext,
      disabled: i.disabled || undefined, abstract: i.abstract || undefined, readsGamepad: i.pads || undefined, hash: i.hash, copyOfPrimary: (primary && i.file !== primary && i.hash === info.find((x) => x.file === primary).hash) || undefined });
    else helpers.push(i.file);
  }
  return { id, group: !files.length ? 'empty' : REFERENCE.has(id) ? 'reference' : 'team', source, primary, opmodes, helpers, files: files.length };
}

export function writeManifest() {
  const teams = fs.readdirSync(CODE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().map(scanTeam);
  const out = { format: 'ftc-simbench.code-corpus', version: 1, generated: new Date().toISOString(), root: CODE,
    about: 'Real FTC teams\' code from public GitHub repos (see code-sources.json in research/fullrobots for each repo and commit), for the SimBench regression bench. Outside the repo; never commit it.',
    teams };
  fs.writeFileSync(path.join(CODE, 'manifest.json'), JSON.stringify(out, null, 1));
  const n = (g) => teams.filter((t) => t.group === g).length;
  console.log(`manifest: ${teams.length} folders (${n('team')} teams, ${n('reference')} reference, ${n('empty')} empty), ` +
    `${teams.reduce((s, t) => s + t.opmodes.length, 0)} OpModes, ${teams.reduce((s, t) => s + t.helpers.length, 0)} helpers -> ${path.join(CODE, 'manifest.json')}`);
  return out;
}

function copyFrom(src) {
  const sources = {};
  fs.mkdirSync(CODE, { recursive: true });
  for (const id of fs.readdirSync(path.join(src, 'java')).sort()) {
    const from = path.join(src, 'java', id), to = path.join(CODE, id);
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from).filter((x) => x.endsWith('.java'))) fs.copyFileSync(path.join(from, f), path.join(to, f));
    const repo = REPOMAP[id];
    if (!repo) { sources[id] = { group: REFERENCE.has(id) ? 'reference' : 'team', files: fs.readdirSync(from).filter((x) => x.endsWith('.java')) }; continue; }
    const rdir = path.join(src, 'repos', repo);
    const git = (...a) => execFileSync('git', ['-C', rdir, ...a], { encoding: 'utf8' }).trim();
    const url = git('config', '--get', 'remote.origin.url'), sha = git('rev-parse', 'HEAD');
    const all = walkJava(rdir);
    for (const f of all) { const d = path.join(to, 'repo', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(rdir, f), d); }
    const top = fs.readdirSync(from).filter((x) => x.endsWith('.java'))[0];
    const prim = all.find((f) => path.basename(f) === top && fs.readFileSync(path.join(rdir, f), 'utf8') === fs.readFileSync(path.join(from, top), 'utf8')) || null;
    const s = { repo: url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''), url, sha, primary: prim ? 'repo/' + prim : null };
    fs.writeFileSync(path.join(to, 'source.json'), JSON.stringify(s, null, 1));
    sources[id] = { group: 'team', repo: s.repo, sha, primary: prim };
    console.log(`copied ${id.padEnd(14)} ${all.length} .java from ${s.repo}@${sha.slice(0, 7)}`);
  }
  fs.writeFileSync(SOURCES, JSON.stringify({ about: 'Where each team folder of the code corpus came from: a public GitHub repo at a fixed commit, TeamCode .java only. corpus.mjs --fetch rebuilds a missing folder from this. The code stays under its owners\' terms and out of this repo; we only read it.', teams: sources }, null, 1) + '\n');
}

function fetchMissing() {
  const { teams } = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
  for (const [id, s] of Object.entries(teams)) {
    const to = path.join(CODE, id);
    if (fs.existsSync(to) && walkJava(to).length) continue;
    if (!s.repo) { console.log(`skip   ${id}: not from a repo (copy it in by hand)`); continue; }
    const tmp = path.join(CORPUS, '.git-tmp', id);
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', tmp, ...a], { stdio: 'pipe', env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) });
    try {
      git('init', '-q'); git('remote', 'add', 'origin', `https://github.com/${s.repo}.git`);
      git('config', 'core.sparseCheckout', 'true');
      fs.writeFileSync(path.join(tmp, '.git', 'info', 'sparse-checkout'), '/TeamCode/**/*.java\n**/TeamCode/**/*.java\n**/teamcode/**/*.java\n');
      git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', s.sha); git('checkout', '-q', 'FETCH_HEAD');
    } catch (e) { console.log(`FAILED ${id}: ${String(e.stderr || e.message).trim().split('\n').pop()}`); continue; }
    for (const f of walkJava(tmp)) { const d = path.join(to, 'repo', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(tmp, f), d); }
    if (s.primary) fs.copyFileSync(path.join(tmp, s.primary), path.join(to, path.basename(s.primary)));
    fs.writeFileSync(path.join(to, 'source.json'), JSON.stringify({ repo: s.repo, url: `https://github.com/${s.repo}.git`, sha: s.sha, primary: s.primary ? 'repo/' + s.primary : null }, null, 1));
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`got    ${id} from ${s.repo}@${s.sha.slice(0, 7)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.from) copyFrom(path.resolve(args.from));
  if (args.fetch) fetchMissing();
  if (!fs.existsSync(CODE)) { console.log(`No code corpus at ${CODE}. Run with --fetch (or --from=<dir>).`); process.exit(0); }
  writeManifest();
}
