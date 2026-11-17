// Runs one of a team's OpModes headless, from Node: the supported way for another repo, or its
// CI, to use the bench's Java VM. Import this file, not tests/load.mjs: this one keeps its
// options and its result when the engine underneath is rearranged.
//
//   node tools/run-opmode.mjs <folder or .java files…> --opmode MainTeleOp.java [--seconds 5]
//                             [--gamepad script.json] [--init 0.4] [--compact]
//
//   import { runOpMode } from '<this checkout>/tools/run-opmode.mjs';
//   const r = runOpMode({ code: 'TeamCode/src/main/java', opmode: 'MainTeleOp.java', seconds: 5,
//     gamepad: [{ t: 0, gamepad1: { left_stick_y: -1 } }, { t: 2, gamepad1: { a: true } }] });
//   if (!r.ok) …            // r.compile, r.error, r.devices, r.peaks, r.telemetry
//
// The OpMode is read the way the app reads it: every other file that isn't an OpMode is a
// helper class, and the OpModes it extends or names come with it (jvSiblings). It then runs
// INIT, START and one pass every 20 ms on a stand-in robot that does what it is told (motors
// turn at their commanded speed, servos are where they were sent) and stands still on the
// field. A caller with a robot of its own passes `host` and the hooks; see docs/code-support.md.
// Needs nothing installed: only Node and this checkout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../tests/load.mjs';

/** One pass of the OpMode's loop: the app's fixed 50 Hz step, in seconds. */
export const DT = 0.02;

let ENGINE = null;
/** The bench's engine, loaded once for the process. */
export function engine() { return ENGINE || (ENGINE = loadEngine()); }

/* The app's own rule for "this file is an OpMode" (isOpModeSource in src/app.js). */
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
export const isOpModeSource = (src) => /@(TeleOp|Autonomous)\b/.test(noComments(src)) || /\bextends\s+(LinearOpMode|OpMode)\b/.test(src);

/**
 * The team's .java files. `code` is a folder (read to the bottom), a file, or a list of
 * folders, files and ready {file, src} entries (a source changed for one run goes in that way).
 * Returns [{file, path, src}], folders in name order.
 */
export function readJava(code) {
  const out = [];
  const add = (p) => {
    if (p && typeof p === 'object') {
      if (typeof p.src !== 'string') throw new Error('a code entry needs {file, src}');
      const name = String(p.file || p.path || 'Helper.java');
      out.push({ file: path.basename(name), path: String(p.path || name), src: p.src });
      return;
    }
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'build' && !e.name.startsWith('.')) add(path.join(p, e.name)); }
        else if (/\.java$/i.test(e.name)) add(path.join(p, e.name));
      }
    } else out.push({ file: path.basename(p), path: p, src: fs.readFileSync(p, 'utf8') });
  };
  if (code == null) throw new Error('no code given: a folder of .java files, or a list of them');
  for (const c of Array.isArray(code) ? code : [code]) add(c);
  return out;
}

const slashes = (p) => String(p).replace(/\\/g, '/');
/* The file an OpMode name means: "Main.java", "Main", or the end of its path. */
function pickOpMode(files, name) {
  if (!name) throw new Error('no OpMode named: opmode is its file name, like MainTeleOp.java');
  const want = slashes(name), java = /\.java$/i.test(want) ? want : want + '.java';
  let hit = files.filter((f) => f.file === java);
  if (!hit.length || hit.length > 1) { const byPath = files.filter((f) => ('/' + slashes(f.path)).endsWith('/' + java)); if (byPath.length) hit = byPath; }
  if (!hit.length) throw new Error(`no file named ${java} among the ${files.length} .java file${files.length === 1 ? '' : 's'} given`);
  if (hit.length > 1) throw new Error(`${hit.length} files are named ${java}: give more of its path (${hit.map((f) => slashes(f.path)).join(', ')})`);
  return hit[0];
}

/**
 * What an OpMode is read with, as the app picks it (libsFor in src/app.js): the files that
 * aren't OpModes, plus the other OpModes this one extends or names.
 */
export function libsFor(E, files, main) {
  const rest = files.filter((f) => f !== main);
  const helpers = rest.filter((f) => !isOpModeSource(f.src)).map((f) => ({ file: f.file, src: f.src }));
  const others = rest.filter((f) => isOpModeSource(f.src)).map((f) => ({ file: f.file, src: f.src }));
  const siblings = E.jvSiblings(main.src, others);
  return { libs: helpers.concat(siblings), helpers, siblings };
}

/* A gamepad script as a function of the time since START. */
function padScript(script) {
  if (script == null) return null;
  const both = (v) => (v ? { 1: v[1] || v.gamepad1 || {}, 2: v[2] || v.gamepad2 || {} } : null);
  if (typeof script === 'function') return (t, run) => both(script(t, run));
  let steps = script;
  if (!Array.isArray(steps)) steps = Object.keys(steps).map((k) => Object.assign({ t: +k }, steps[k]));
  steps = steps.map((s) => ({ t: +s.t || 0, pads: both(s) })).sort((a, b) => a.t - b.t);
  return (t) => {
    let now = null;
    for (const s of steps) { if (s.t <= t + 1e-9) now = s; else break; }
    return now ? now.pads : { 1: {}, 2: {} };
  };
}

/* The stand-in robot: whatever the engine's own probe robot answers (src/jvmrun.js
   jvProbeHost), on this run's clock and sticks, with devices that do as they are told. */
function standIn(E, run, pose) {
  const devs = new Map();
  const host = Object.assign({}, E.jvProbeHost().host, {
    dev(name, type, kind) {
      let s = devs.get(name);
      if (!s) { s = { name, type, kind, cmd: kind === 'servo' ? null : 0, act: 0, ticks: 0, offset: 0, vel: 0, target: 0, reversed: false, mode: 'run', tpr: 537.7, spec: { rpm: 312 } }; devs.set(name, s); }
      return s;
    },
    pad(i) { return run.pads[i] || {}; },
    now() { return run.clock; },
    // the OpMode's own runtime: from START, or from its last resetRuntime()
    runtime() { return run.t - run.rt0; }, resetRuntime() { run.rt0 = run.t; },
    heading() { return pose.h; }, pose() { return { x: pose.x, y: pose.y, h: pose.h }; },
    telemetry(lines) { run.telemetry = lines; },
    log(text) { if (run.log.length < 200) run.log.push(String(text)); },
    advance(dt) { run.clock += dt; },
    world(dt) { run.clock += dt; move(dt); },
    cmd() {},
  });
  function move(dt) {
    for (const s of devs.values()) {
      if (s.kind === 'servo') { if (s.cmd != null) s.act = s.cmd; continue; }
      if (s.kind !== 'motor' && s.kind !== 'crservo') continue;
      const free = ((s.spec && s.spec.rpm) || 312) / 60 * (s.tpr || 537.7);            // ticks a second at full power
      if (s.mode === 'reset') { s.vel = 0; continue; }
      if (s.mode === 'rtp') {
        const err = (s.target || 0) - (s.ticks - (s.offset || 0)), reach = free * Math.abs(s.cmd || 0) * dt;
        const go = Math.sign(err) * Math.min(Math.abs(err), reach);
        s.ticks += go; s.vel = dt > 0 ? go / dt : 0;
      } else { s.vel = (s.cmd || 0) * free; s.ticks += s.vel * dt; }
      s.act = s.cmd || 0;
    }
  }
  return { host, move };
}

/**
 * Run one OpMode: INIT, START, then a pass every 20 ms for `seconds`.
 *
 * opts.code         a folder, a file, or a list of them and {file, src} entries (see readJava)
 * opts.opmode       the OpMode's file name ("MainTeleOp.java"), or the end of its path
 * opts.seconds      seconds to run after START (default 5)
 * opts.gamepad      the sticks over time: [{t, gamepad1, gamepad2}, …] (each step holds from
 *                   its time, in seconds after START, until the next; a negative time is
 *                   during INIT), or a function (t, run) => {gamepad1, gamepad2}
 * opts.initSeconds  how long the driver waits in INIT before START (default 0.4)
 * opts.startPose    where the stand-in robot stands: {x, y, h}, metres and radians
 * opts.host         the caller's own robot: an object (or run => object) with any of the
 *                   methods the VM asks of a robot; the stand-in answers the ones left out
 * opts.onStart      (run) just before START
 * opts.beforeTick   (run) before each pass, INIT's included (run.phase says which)
 * opts.afterTick    (run) after each pass: where a caller's robot moves by run.dt
 * opts.engine       an engine already loaded (tests/load.mjs loadEngine), else this file's own
 *
 * Returns plain data, ready for JSON.stringify. `ok` means: it compiled, every file was read,
 * and the OpMode ran to the end of the time (or to its own end) without stopping on an error.
 */
export function runOpMode(opts = {}) {
  const E = opts.engine || engine();
  const files = readJava(opts.code);
  const main = pickOpMode(files, opts.opmode);
  const seconds = Number.isFinite(+opts.seconds) && +opts.seconds >= 0 ? +opts.seconds : 5;
  const picked = libsFor(E, files, main);
  const out = {
    ok: false, opmode: main.file, class: null, style: null, seconds, ran: 0,
    helpers: picked.helpers.map((l) => l.file), siblings: picked.siblings.map((l) => l.file),
    compile: { ok: false, error: null, line: null, parseErrors: [] },
    error: null, ended: false, devices: [], peaks: {}, telemetry: [], prints: [], stubs: [],
  };

  const comp = E.jvCompile(main.src, picked.libs);
  if (!comp.ok) {
    out.compile.error = String(comp.err || 'could not be read');
    if (comp.pos != null) out.compile.line = main.src.slice(0, comp.pos).split('\n').length;
    return out;
  }
  out.compile.ok = true;
  out.compile.parseErrors = (comp.bad || []).map((b) => ({ file: b.file || null, error: String(b.err) }));
  out.class = comp.main;

  const run = { E, dt: DT, phase: 'init', tick: 0, t: 0, clock: 0, rt0: 0, pads: { 1: {}, 2: {} }, telemetry: [], log: [], devices: new Map(), program: null };
  const pose = Object.assign({ x: 0, y: 0, h: 0 }, opts.startPose || {});
  const mine = standIn(E, run, pose);
  const theirs = typeof opts.host === 'function' ? opts.host(run) : opts.host;
  const host = Object.assign({}, mine.host, theirs || {});

  // every device and every command, whoever's robot holds them
  const peaks = new Map();
  const note = (name, v, isTarget) => {
    if (!Number.isFinite(v)) return;
    if (v === 0) v = 0;                                   // -0 (a stick at rest, negated) reads as 0
    let p = peaks.get(name);
    if (!p) peaks.set(name, (p = { peak: null, min: null, max: null, last: null, target: null }));
    if (isTarget) { if (p.target == null || Math.abs(v) > Math.abs(p.target)) p.target = v; return; }
    if (p.peak == null || Math.abs(v) > Math.abs(p.peak)) p.peak = v;
    p.min = p.min == null ? v : Math.min(p.min, v); p.max = p.max == null ? v : Math.max(p.max, v); p.last = v;
  };
  const dev0 = host.dev, cmd0 = host.cmd, tel0 = host.telemetry;
  host.dev = function (name, type, kind) { const s = dev0.call(this, name, type, kind); if (s && !run.devices.has(name)) run.devices.set(name, s); return s; };
  host.cmd = function (name, op, v) {
    if (op === 'setTargetPosition') note(name, v, true); else if (op !== 'setDirection') note(name, v, false);
    if (cmd0) cmd0.call(this, name, op, v);
  };
  host.telemetry = function (lines) { run.telemetry = lines; if (theirs && theirs.telemetry) tel0.call(this, lines); };

  const P = new E.JvProgram(comp, host);
  run.program = P;
  out.style = P.linear ? 'linear' : 'iterative';
  const script = padScript(opts.gamepad);
  const sticks = (t) => { if (!script) return; const p = script(t, run); if (p) run.pads = p; };
  // a command given without going through cmd() (a caller's robot, a library writing the device)
  const driven = (s) => s && (s.kind === 'motor' || s.kind === 'servo' || s.kind === 'crservo') && s.cmd != null;
  const seen = () => { for (const [n, s] of run.devices) if (driven(s)) { const p = peaks.get(n); if (p ? p.last !== s.cmd : s.cmd !== 0) note(n, s.cmd, false); } };
  const failed = () => {
    if (!P.error) return false;
    const e = P.error;
    out.error = { cls: e.cls || 'error', msg: e.msg || '', file: e.file === 'OpMode.java' ? main.file : (e.file || null), line: e.line == null ? null : e.line, in: e.in || null,
      phase: run.phase, at: run.phase === 'run' ? +run.t.toFixed(2) : 0 };
    return true;
  };
  const pass = () => {
    if (opts.beforeTick) opts.beforeTick(run);
    P.tick();
    if (failed()) return false;
    mine.move(DT);
    if (opts.afterTick) opts.afterTick(run);
    seen();
    return true;
  };

  let alive = true;
  P.init();
  if (!failed()) P.settle(8);
  alive = !failed();
  const waits = Math.max(0, Math.round((opts.initSeconds != null ? +opts.initSeconds : 0.4) / DT));
  for (let k = 0; alive && k < waits && !P.done; k++) {
    run.tick = k; run.clock += DT; run.t += DT;
    sticks(-(waits - k) * DT);
    alive = pass();
  }
  if (alive && !P.done) {
    if (opts.onStart) opts.onStart(run);
    run.phase = 'run'; run.t = 0; run.rt0 = 0;
    sticks(0);
    P.start();
    alive = !failed();
    const n = Math.round(seconds / DT);
    for (let k = 0; alive && k < n && !P.done; k++) {
      run.tick = k; run.clock += DT; run.t += DT;
      sticks(run.t);
      alive = pass();
    }
    out.ran = +run.t.toFixed(2);
  }
  failed();
  out.ended = !!P.done && !out.error;

  const asked = P.vm.devices ? Array.from(P.vm.devices.values()) : [];
  out.devices = asked.map((d) => ({ name: d.name, type: d.type || null, kind: d.kind || null }));
  for (const [n, s] of run.devices) if (!asked.some((d) => d.name === n)) out.devices.push({ name: n, type: (s && s.type) || null, kind: (s && s.kind) || null });
  for (const d of out.devices) {
    const p = peaks.get(d.name);
    if (!p) continue;
    out.peaks[d.name] = { kind: d.kind, peak: p.peak, min: p.min, max: p.max, last: p.last };
    if (p.target != null) out.peaks[d.name].target = p.target;
  }
  out.telemetry = (run.telemetry || []).map(String);
  out.prints = run.log.slice();
  out.stubs = P.stubs().slice(0, 40).map(([call, count, file, line]) => ({ call, count, file: file === 'OpMode.java' ? main.file : file, line }));
  out.ok = !out.error && !out.compile.parseErrors.length;
  return out;
}

/* ---- the command line ---- */
function cli(argv) {
  const o = { code: [] };
  const flags = { '--opmode': 'opmode', '--seconds': 'seconds', '--gamepad': 'gamepad', '--init': 'initSeconds' };
  let compact = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compact') compact = true;
    else if (a === '-h' || a === '--help') return usage(0);
    else if (flags[a]) { if (i + 1 >= argv.length) return usage(2, a + ' needs a value'); o[flags[a]] = argv[++i]; }
    else if (a.startsWith('--')) return usage(2, 'unknown option ' + a);
    else o.code.push(a);
  }
  if (!o.code.length || !o.opmode) return usage(2, !o.code.length ? 'no folder or .java files given' : 'no --opmode given');
  for (const k of ['seconds', 'initSeconds']) if (o[k] != null) { o[k] = +o[k]; if (!Number.isFinite(o[k]) || o[k] < 0) return usage(2, 'a time must be a number of seconds'); }
  let r;
  try {
    if (o.gamepad != null) o.gamepad = JSON.parse(fs.readFileSync(o.gamepad, 'utf8'));
    r = runOpMode(o);
  } catch (e) { console.error('run-opmode: ' + (e && e.message || e)); return 2; }
  console.log(JSON.stringify(r, null, compact ? 0 : 2));
  return r.ok ? 0 : 1;
}
function usage(code, why) {
  const say = code ? console.error : console.log;
  if (why) say('run-opmode: ' + why);
  say(`usage: node tools/run-opmode.mjs <folder or .java files…> --opmode <File.java> [--seconds 5]
                                [--gamepad script.json] [--init 0.4] [--compact]
  --opmode    the OpMode's file name, or the end of its path when two files share a name
  --seconds   seconds to run after START (default 5)
  --gamepad   a JSON file: [{"t": 0, "gamepad1": {"left_stick_y": -1}}, {"t": 2, "gamepad1": {"a": true}}]
              each step holds from its time (seconds after START) until the next
  --init      seconds the driver waits in INIT before START (default 0.4)
  --compact   the result on one line
Prints the result as JSON. Exit code 0: ran clean; 1: it didn't compile, a file couldn't be
read, or the OpMode stopped on an error; 2: the command itself was wrong.`);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = cli(process.argv.slice(2));
