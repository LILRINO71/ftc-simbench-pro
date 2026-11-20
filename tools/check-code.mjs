// Every OpMode in a team's code, run headless on the bench's Java VM: the check a team puts in its
// own repository's CI so a push that breaks an OpMode is caught before it reaches the robot.
//
//   node tools/check-code.mjs <folder or .java files…> [--seconds 3] [--skip Tuning.java,Old.java]
//                             [--only Main.java] [--json] [--summary file.md]
//
//   import { checkCode } from '<this checkout>/tools/check-code.mjs';
//   const r = checkCode({ code: 'TeamCode/src/main/java' });   // r.ok, r.opmodes[…], r.passed, r.failed
//
// Each OpMode the Driver Station would list (@TeleOp or @Autonomous, not @Disabled, not abstract)
// is run twice on the stand-in robot of tools/run-opmode.mjs: once with the sticks at rest, and
// once with every stick, trigger and button of both gamepads worked in turn, which reaches the
// code behind a button (a missing hardware name, a null, a divide by zero that only happens when
// the driver presses something). It says what the bench saw, never more: a pass means the code
// was read and ran without stopping on an error, not that the robot does what the team wants.
// Exit code 1 when an OpMode fails, 2 for a wrong command line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOpMode, readJava, isOpModeSource } from './run-opmode.mjs';

const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/** What the Driver Station would show for a file: {kind, name, group, disabled, abstract}, or null. */
export function opModeEntry(src) {
  const s = noComments(src);
  const m = /@(TeleOp|Autonomous)\b\s*(\(([^)]*)\))?/.exec(s);
  if (!m) return null;
  const arg = (k) => { const a = new RegExp('\\b' + k + '\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(m[3] || ''); return a ? a[1] : null; };
  const cls = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(s);
  return { kind: m[1], name: arg('name') || (cls && cls[1]) || null, group: arg('group'), class: cls ? cls[1] : null,
    disabled: /@Disabled\b/.test(s), abstract: /\babstract\s+class\b/.test(s) };
}

const BUTTONS = ['a', 'b', 'x', 'y', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'left_bumper', 'right_bumper',
  'left_stick_button', 'right_stick_button', 'back', 'start'];
/** Every control of both gamepads in turn: a stick or a trigger for `hold` seconds, then the next. */
export function everyControl(hold = 0.12) {
  const moves = [
    { left_stick_y: -1 }, { left_stick_y: 1 }, { left_stick_x: 1 }, { left_stick_x: -1 },
    { right_stick_x: 1 }, { right_stick_x: -1 }, { right_stick_y: -1 }, { right_stick_y: 1 },
    { left_trigger: 1 }, { right_trigger: 1 },
    ...BUTTONS.map((b) => ({ [b]: true })),
    // the pairs drivers hold together most: a bumper or trigger with a face button
    { right_bumper: true, a: true }, { left_bumper: true, right_bumper: true }, { right_trigger: 1, right_bumper: true }, { left_trigger: 1, a: true },
  ];
  const steps = [];
  let t = 0.2;
  for (const pad of ['gamepad1', 'gamepad2', 'both']) for (const mv of moves) {
    steps.push(pad === 'both' ? { t, gamepad1: mv, gamepad2: mv } : { t, [pad]: mv });
    t += hold;
    steps.push({ t });                                    // let go: an edge-detected press needs the release
    t += hold / 3;
  }
  return { steps, seconds: +(t + 0.3).toFixed(2) };
}

const where = (e) => (e.file ? e.file + (e.line != null ? ':' + e.line : '') : '');
function verdict(r, how) {
  if (!r.compile.ok) return { ok: false, how, why: 'the bench could not read it: ' + r.compile.error + (r.compile.line ? ' (line ' + r.compile.line + ')' : '') };
  if (r.compile.parseErrors.length) return { ok: false, how, why: 'a file it needs could not be read: ' + r.compile.parseErrors.map((p) => (p.file || '?') + ' (' + p.error + ')').join('; ') };
  // all of the OpMode is in a library class the bench has no copy of (src/jvmrun.js says so in these
  // words; a team's own missing file reads "isn't loaded" and is a failure): nothing to judge
  if (r.error && r.error.cls === 'MissingClass' && /that the bench doesn't have/.test(r.error.msg || '')) return { ok: true, how, unmodelled: true, why: r.error.msg };
  if (r.error) return { ok: false, how, why: (r.error.phase === 'init' ? 'in INIT' : 'at ' + r.error.at + ' s') + ': ' + r.error.cls + (r.error.msg ? ' ' + r.error.msg : '') + (where(r.error) ? ' at ' + where(r.error) : '') };
  return { ok: true, how };
}

/**
 * Run every OpMode found in opts.code (see readJava in run-opmode.mjs).
 * opts.seconds  seconds each quiet run lasts after START (default 3)
 * opts.skip     file names not to run (a library's OpMode the bench does not model)
 * opts.only     run just these file names
 * Returns {ok, passed, failed, skipped, opmodes:[{file, name, kind, group, ok, why, runs, devices, stubs}], notRun:[…]}.
 */
export function checkCode(opts = {}) {
  const files = readJava(opts.code);
  const seconds = Number.isFinite(+opts.seconds) && +opts.seconds > 0 ? +opts.seconds : 3;
  const skip = new Set((opts.skip || []).map((s) => path.basename(String(s)))), only = opts.only && opts.only.length ? new Set(opts.only.map((s) => path.basename(String(s)))) : null;
  const wiggle = everyControl();
  const out = { ok: true, files: files.length, passed: 0, failed: 0, skipped: 0, unmodelled: 0, opmodes: [], notRun: [] };
  for (const f of files) {
    const e = opModeEntry(f.src);
    if (!e) { if (isOpModeSource(f.src)) out.notRun.push({ file: f.file, why: 'extends an OpMode but has no @TeleOp or @Autonomous: a base class' }); continue; }
    if (e.abstract) { out.notRun.push({ file: f.file, why: 'abstract' }); continue; }
    if (e.disabled) { out.notRun.push({ file: f.file, why: '@Disabled' }); continue; }
    if (only && !only.has(f.file)) continue;
    const row = { file: f.file, path: f.path, name: e.name, kind: e.kind, group: e.group, ok: true, why: null, runs: [], devices: 0, stubs: [] };
    if (skip.has(f.file)) { row.skipped = true; row.why = 'skipped by --skip'; out.skipped++; out.opmodes.push(row); continue; }
    const base = { code: files, opmode: f.path || f.file, engine: opts.engine };
    for (const [how, more] of [['sticks at rest', { seconds }], ['every control worked', { seconds: wiggle.seconds, gamepad: wiggle.steps }]]) {
      let v;
      try { const r = runOpMode(Object.assign({}, base, more)); v = verdict(r, how); row.devices = Math.max(row.devices, r.devices.length); if (r.stubs.length > row.stubs.length) row.stubs = r.stubs; }
      catch (err) { v = { ok: false, how, why: 'the bench itself failed: ' + (err && err.message || err) }; }
      row.runs.push(v);
      if (v.unmodelled) { row.unmodelled = true; row.why = v.why; break; }
      if (!v.ok) { row.ok = false; row.why = v.why + ' (' + how + ')'; break; }
    }
    out.opmodes.push(row);
    if (row.unmodelled) out.unmodelled++; else if (row.ok) out.passed++; else { out.failed++; out.ok = false; }
  }
  return out;
}
const mark = (o) => (o.skipped ? 'skip' : o.unmodelled ? 'n/a ' : o.ok ? 'pass' : 'FAIL');

/** The result as lines of plain text, or Markdown for a CI summary. */
export function report(r, md) {
  const L = [], n = r.opmodes.length;
  const head = n + ' OpMode' + (n === 1 ? '' : 's') + ' in ' + r.files + ' .java file' + (r.files === 1 ? '' : 's') + ': ' + r.passed + ' pass, ' + r.failed + ' fail' +
    (r.unmodelled ? ', ' + r.unmodelled + ' the bench cannot run' : '') + (r.skipped ? ', ' + r.skipped + ' skipped' : '');
  if (md) {
    L.push('### FTC SimBench code check', '', '**' + head + '**', '', '| | OpMode | File | Kind | Result |', '|---|---|---|---|---|');
    for (const o of r.opmodes) L.push('| ' + (o.ok && !o.skipped && !o.unmodelled ? 'pass' : o.ok ? mark(o).trim() : '**FAIL**') + ' | ' + (o.name || '') + ' | `' + o.file + '` | ' + o.kind + ' | ' + String(o.why || (o.devices + ' devices' + (o.stubs.length ? ', ' + o.stubs.length + ' calls the bench does not model' : ''))).replace(/\|/g, '/') + ' |');
    if (r.notRun.length) L.push('', 'Not run: ' + r.notRun.map((x) => '`' + x.file + '` (' + x.why + ')').join(', '));
    L.push('', 'A pass means the code was read and ran on the bench without stopping on an error, with the sticks at rest and with every control worked in turn. It does not mean the robot does what you want.');
    return L.join('\n') + '\n';
  }
  const w = Math.max(8, ...r.opmodes.map((o) => o.file.length));
  for (const o of r.opmodes) {
    L.push(mark(o) + '  ' + o.file.padEnd(w) + '  ' + o.kind.padEnd(10) + ' ' + (o.name ? '"' + o.name + '"' : ''));
    if (o.why) L.push('      ' + o.why);
    else if (o.stubs.length) L.push('      ' + o.stubs.length + ' call' + (o.stubs.length === 1 ? '' : 's') + ' the bench does not model: ' + o.stubs.slice(0, 4).map((s) => s.call).join(', ') + (o.stubs.length > 4 ? ', ...' : ''));
  }
  for (const x of r.notRun) L.push('  -   ' + x.file.padEnd(w) + '  not run: ' + x.why);
  L.push('', head);
  return L.join('\n');
}

function cli(argv) {
  const o = { code: [], skip: [], only: [] };
  let json = false, summary = null;
  const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => (i + 1 < argv.length ? argv[++i] : null);
    if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') return usage(0);
    else if (a === '--seconds') { o.seconds = +next(); if (!(o.seconds > 0)) return usage(2, '--seconds is a number of seconds above 0'); }
    else if (a === '--skip') { const v = next(); if (v == null) return usage(2, '--skip needs file names'); o.skip.push(...list(v)); }
    else if (a === '--only') { const v = next(); if (v == null) return usage(2, '--only needs file names'); o.only.push(...list(v)); }
    else if (a === '--summary') { summary = next(); if (summary == null) return usage(2, '--summary needs a file'); }
    else if (a.startsWith('--')) return usage(2, 'unknown option ' + a);
    else o.code.push(a);
  }
  if (!o.code.length) return usage(2, 'no folder or .java files given');
  let r;
  try { r = checkCode(o); } catch (e) { console.error('check-code: ' + (e && e.message || e)); return 2; }
  if (!r.opmodes.length) { console.error('check-code: no @TeleOp or @Autonomous OpMode found in what was given'); return 2; }
  console.log(json ? JSON.stringify(r, null, 2) : report(r, false));
  if (summary) fs.appendFileSync(summary, report(r, true));
  return r.ok ? 0 : 1;
}
function usage(code, why) {
  const say = code ? console.error : console.log;
  if (why) say('check-code: ' + why);
  say(`usage: node tools/check-code.mjs <folder or .java files…> [--seconds 3] [--skip A.java,B.java] [--only A.java] [--json] [--summary file.md]
  runs every @TeleOp and @Autonomous OpMode found (not @Disabled, not abstract) on the bench's Java VM,
  once with the sticks at rest and once with every control worked in turn; exit 1 when one fails
  --seconds   seconds the quiet run lasts after START (default 3)
  --skip      file names to leave out (an OpMode from a library the bench does not model)
  --only      run just these
  --json      the whole result as JSON
  --summary   append a Markdown table to this file (in GitHub Actions: "$GITHUB_STEP_SUMMARY")`);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = cli(process.argv.slice(2));
