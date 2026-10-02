// The regression bench: real teams' code and real teams' CAD through the engine exactly as it ships
// (tests/load.mjs), measured the way a team would judge it. Every change that claims to fix "it never
// works" is measured against this.
//
//   node --max-old-space-size=8192 research/fullrobots/bench.mjs [options]
//     --code-only | --cad-only     one half
//     --only=<id>[,<id>...]        teams or CADs whose id contains one of these
//     --primary-only               each team's main TeleOp only (default: every TeleOp in the corpus too)
//     --corpus=<dir>               default ../ftc-cad-corpus next to the repo (code/, realcad/, fullrobots/)
//     --owner=<a.step>[;<b.step>]  the owner's robots (default: the two in ~/Downloads; missing ones are skipped)
//     --out=<file.json>            default research/fullrobots/last-run.json
//     --compare=<file.json>        default baseline.json here, when it exists; --no-compare to skip
//     --strict                     exit 1 when anything got worse than the comparison
//     --workers=<n>                code workers (default min(6, cores-2))
//     --timeout=<s>                per-OpMode limit (default 120 s; a CAD gets 600 s): a hang costs its row, not the run
//
// A. CODE: every TeleOp in <corpus>/code (see corpus.mjs) runs on ONE standard robot, the generated
//    goBILDA mecanum base tests/fixtures/robots/mecanum-zup, so only the code varies. All of the team's
//    other .java files go in as helpers ({file, src}, as src/app.js passes helper classes to parseJava).
//    Drive probe: gamepad1 left stick up 1 s, left stick right 1 s, right stick right 1 s, each from a
//    fresh INIT + START (tank, POV and arcade codes get their own sticks; see LAYOUTS). Each push runs on
//    the robot as built and on the same robot mounted the way the code's setDirection calls say, and
//    passes only if the robot moves the right way AND the wheels were commanded that way (INTENT).
//    Mechanism probe: every other control the OpMode reads (gamepad1/2 fields, Gamepad copies, FTCLib
//    GamepadEx), held 1 s from a fresh start, against an unpressed run of the same length: which non-drive
//    motors and servos got a different power, position or target.
// B. CAD: every STEP in <corpus>/realcad, the owner's robots, the default robot (GearGurus 7832, gunzipped
//    in memory), and <corpus>/fullrobots/<team>/robot.step with that team's own code. Each goes through the
//    app's own path for a new robot (parse, frame, front from the wheels, the joint finder) and is then
//    checked with no code, with the default robot's sample_teleop.java, and with its own code when it has
//    some. "Questions" counts what the page puts in front of a team: robot-check items it labels
//    ANSWER/CONFIRM, setup steps not done, and status-light rows.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { loadEngine, fixture } from '../../tests/load.mjs';
import { CORPUS, walkJava, classify, stripComments, scanTeam } from './corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ITD = path.join(ROOT, 'assets', 'robots', 'into-the-deep');
const ITD_HELPERS = ['MecanumDrive.java', 'Arm.java', 'Arm_PID_Class.java', 'Slides_PID_Class.java'];
const STD_ROBOT = 'mecanum-zup';
const DT = 0.02;

/* ============================================================
   What counts. Changing these changes every number: say so in the commit.
   ============================================================ */
// Cross-talk is relative for the two translations: the sim's own mecanum strafe drifts ~15 % forward
// and ~10 deg over a metre with the FTC SDK's BasicOmniOpMode_Linear, which is correct code.
export const PASS = {
  fwd: (r) => r.fwd > 0.3 && Math.abs(r.right) < 0.25 * r.fwd && Math.abs(r.cw) < 15,     // stick up: forward, straight
  strafe: (r) => r.right > 0.2 && Math.abs(r.fwd) < 0.25 * r.right && Math.abs(r.cw) < 15, // left stick right: right, square
  turn: (r) => r.cw > 20 && Math.hypot(r.fwd, r.right) < 0.1,                              // right stick right: clockwise, in place
  moved: (r) => Math.hypot(r.fwd, r.right) > 0.1 || Math.abs(r.cw) > 10,
};
// ...and the wheels must be TOLD to do it: the no-slip motion of the commanded wheel speeds (the engine's own
// ikMatrix/fkFromIk, per unit of full power), so a robot whose wheels fight each other can't pass on physics drift.
export const INTENT = {
  fwd: (i) => i.fwd > 0.25 && Math.abs(i.right) < 0.35 * i.fwd && Math.abs(i.cw) < 0.5,
  strafe: (i) => i.right > 0.25 && Math.abs(i.fwd) < 0.35 * i.right && Math.abs(i.cw) < 0.5,
  turn: (i) => i.cw > 0.5 && Math.hypot(i.fwd, i.right) < 0.25,
};
// Which sticks drive, read off gamepad1's controls in the source. mecanum is the standard layout
// (left stick drives and strafes, right stick x turns); the others can't strafe, so S is n/a.
export const LAYOUTS = {
  mecanum: { fwd: { left_stick_y: -1 }, strafe: { left_stick_x: 1 }, turn: { right_stick_x: 1 } },
  pov: { fwd: { left_stick_y: -1 }, turn: { right_stick_x: 1 } },                           // left stick y drives, right stick x turns
  arcade: { fwd: { left_stick_y: -1 }, turn: { left_stick_x: 1 } },                         // one stick
  tank: { fwd: { left_stick_y: -1, right_stick_y: -1 }, turn: { left_stick_y: -1, right_stick_y: 1 } },
};
export function layoutOf(controls) {
  const has = (c) => controls.includes('1:' + c) || controls.includes('0:' + c);
  if (has('left_stick_x') && has('left_stick_y') && has('right_stick_x')) return 'mecanum';
  if (has('left_stick_y') && has('right_stick_y') && !has('left_stick_x') && !has('right_stick_x')) return 'tank';
  if (has('left_stick_y') && has('right_stick_x')) return 'pov';
  if (has('left_stick_y') && has('left_stick_x')) return 'arcade';
  return 'mecanum';
}
const layoutAxes = (L) => [...new Set(Object.values(LAYOUTS[L]).flatMap((p) => Object.keys(p)))];
const MECH_EPS = { cmd: 0.02, target: 5 };    // a power/position change, or a RUN_TO_POSITION target change in ticks

/* ============================================================
   Gamepad controls an OpMode reads, from its source text (so the probe list doesn't depend on
   what the parser understands). pad 0 = a gamepad object we can't tie to gamepad1 or gamepad2.
   ============================================================ */
const SDK_CTL = ['a', 'b', 'x', 'y', 'left_bumper', 'right_bumper', 'left_trigger', 'right_trigger', 'back', 'start', 'guide',
  'left_stick_button', 'right_stick_button', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right',
  'left_stick_x', 'left_stick_y', 'right_stick_x', 'right_stick_y'];
const PS_ALIAS = { cross: 'a', circle: 'b', square: 'x', triangle: 'y', share: 'back', options: 'start', ps: 'guide' };
function ctlName(raw) {
  let s = String(raw);
  const m = /^(\w+?)(?:WasPressed|WasReleased)$/.exec(s); if (m) s = m[1];   // SDK 10: gamepad1.aWasPressed()
  for (const c of [s, s.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase()), s.toLowerCase()]) {
    const v = PS_ALIAS[c] || c; if (SDK_CTL.includes(v)) return v;
  }
  return null;
}
export function controlsRead(text) {
  const t = stripComments(text).replace(/^\s*import\s+[^;]*;/gm, '');
  const out = new Set(), add = (pad, c) => { const n = ctlName(c); if (n) out.add(pad + ':' + n); };
  let m;
  for (const re = /\b(?:this\s*\.\s*)?gamepad([12])\s*\.\s*([A-Za-z_]+)/g; (m = re.exec(t));) add(+m[1], m[2]);
  // gamepad objects: FTCLib GamepadEx, Gamepad copies, plain aliases
  const padOf = new Map();
  for (const re = /\b(\w+)\s*=\s*new\s+GamepadEx\s*\(\s*(?:this\s*\.\s*)?gamepad([12])\s*\)/g; (m = re.exec(t));) padOf.set(m[1], +m[2]);
  for (const re = /\b(\w+)\s*\.\s*copy\s*\(\s*(?:this\s*\.\s*)?gamepad([12])\s*\)/g; (m = re.exec(t));) padOf.set(m[1], +m[2]);
  for (const re = /\b(\w+)\s*=\s*(?:this\s*\.\s*)?gamepad([12])\s*;/g; (m = re.exec(t));) padOf.set(m[1], +m[2]);
  for (const re = /\b(?:Gamepad|GamepadEx)\s+(\w+)\s*[;,)=]/g; (m = re.exec(t));) if (!padOf.has(m[1])) padOf.set(m[1], 0);
  const pad = (v) => (padOf.has(v) ? padOf.get(v) : 0);
  for (const [v, p] of padOf) {
    if (/^gamepad[12]$/.test(v)) continue;
    for (const re = new RegExp('\\b' + v + '\\s*\\.\\s*([A-Za-z_]+)\\b(?!\\s*\\()', 'g'); (m = re.exec(t));) add(p, m[1]);
    for (const re = new RegExp('\\b' + v + '\\s*\\.\\s*([a-z]\\w*(?:WasPressed|WasReleased))\\s*\\(', 'g'); (m = re.exec(t));) add(p, m[1]);
  }
  const STICK = { getLeftX: 'left_stick_x', getLeftY: 'left_stick_y', getRightX: 'right_stick_x', getRightY: 'right_stick_y' };
  for (const re = /\b(\w+)\s*(?:\.|::)\s*(getLeftX|getLeftY|getRightX|getRightY)\b/g; (m = re.exec(t));) add(pad(m[1]), STICK[m[2]]);
  const KEY = '(?:GamepadKeys\\s*\\.\\s*(?:Button|Trigger)\\s*\\.\\s*)?([A-Z][A-Z_]+)';
  for (const re = new RegExp('\\b(\\w+)\\s*\\.\\s*(?:getButton|wasJustPressed|wasJustReleased|isDown|stateJustChanged|getGamepadButton|getTrigger|readValue)\\s*\\(\\s*' + KEY, 'g'); (m = re.exec(t));) add(pad(m[1]), m[2]);
  for (const re = new RegExp('new\\s+(?:GamepadButton|TriggerReader|ButtonReader|ToggleButtonReader)\\s*\\(\\s*(\\w+)\\s*,\\s*' + KEY, 'g'); (m = re.exec(t));) add(pad(m[1]), m[2]);
  for (const re = /GamepadKeys\s*\.\s*(?:Button|Trigger)\s*\.\s*([A-Z_]+)/g; (m = re.exec(t));) if (![1, 2].some((p) => out.has(p + ':' + ctlName(m[1])))) add(0, m[1]);
  return [...out].sort();
}

/* ============================================================
   The engine side (runs in a worker)
   ============================================================ */
let E = null, STD_TEXT = null;
const engine = () => E || (E = loadEngine());
// the standard robot's STEP text (generated by tools/stepgen.mjs when the fixture file isn't there)
const stdText = () => STD_TEXT || (STD_TEXT = fixture('robots/' + STD_ROBOT + '.step'));
const SIM_OPTS = () => ({ payloadKg: 0.18, duty: 0.30, trust: 'code', front: null, baseModel: 'auto', startPose: { x: 0, y: 0, h: 0 } });
const read = (f) => fs.readFileSync(f, 'utf8');
const isAct = (d) => /DcMotor|Servo/i.test(d.type || '') && !/Sensor|IMU|Camera|Webcam|Limelight|Odometry|Pinpoint|OTOS|LED|Voltage/i.test(d.type || '');
const r3 = (v) => (Number.isFinite(v) ? +(+v).toFixed(3) : v);
const errText = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 160);

/** A fresh Driver Station run: load, INIT, START, then [pad1, pad2, seconds] steps; onTick after each tick. */
function run(code, cad, map, opts, steps, onTick) {
  const S = engine().Sim;
  S.load(code, cad, map, Object.assign(SIM_OPTS(), opts || {}));
  S.obstacles = []; S.onRumble = null;
  S.init(); S.start();
  let k = 0;
  for (const [p1, p2, secs] of steps) {
    S.pad = { 1: Object.assign({}, p1), 2: Object.assign({}, p2) };
    for (let i = 0, n = Math.round(secs / DT); i < n; i++, k++) { S.tick(DT); if (onTick) onTick(S, k); }
  }
  return S;
}
/** One drive push: 0.1 s neutral, then 1 s of gamepad1 `pad`; motion in the robot's frame at the push. */
function push(code, cad, map, opts, pad, sigma) {
  // sigma +1/-1: every drive wheel mounted the way the code's setDirection calls say: the same sense for every
  // wheel in the code's own frame (Sim.wheelCmd = sigma * commanded power, no CAD mounting). Which global sense
  // is a free choice (one team's "forward" is +power, another's is -power), so both are tried. Restored after.
  const S0 = engine().Sim, orig = S0.wheelCmd, fromCode = sigma === 1 || sigma === -1;
  if (fromCode) S0.wheelCmd = function (name) { const d = this.dev[name]; return d ? sigma * d.act : 0; };
  try {
    let p0 = null, prevH = 0, turn = 0;
    const S = run(code, cad, map, opts, [[{}, {}, 0.1], [pad, {}, 1.0]], (s, k) => {
      if (k === 4) { p0 = { x: s.chassis.x, y: s.chassis.y, h: s.chassis.h }; prevH = s.chassis.h; }
      else if (k > 4) { const h = s.chassis.h; turn += Math.atan2(Math.sin(h - prevH), Math.cos(h - prevH)); prevH = h; }
    });
    const dx = S.chassis.x - p0.x, dy = S.chassis.y - p0.y, c = Math.cos(p0.h), sn = Math.sin(p0.h);
    const out = { fwd: r3(c * dx + sn * dy), right: r3(-(-sn * dx + c * dy)), cw: +(-turn * 180 / Math.PI).toFixed(1) };
    // what the wheels were told at the end of the push, as an ideal chassis twist (rad/s for cw)
    const rig = S.rig;
    if (rig && rig.drive && rig.drive.wheels && rig.drive.wheels.length) try {
      const En = engine(), W = rig.drive.wheels, fk = En.fkFromIk(En.ikMatrix(rig.drive.kind, W));
      const t = En.chassisFromWheels(fk, rig.devs.map((n, i) => S.wheelCmd(n, W[i] && W[i].mount)));
      out.intent = { fwd: r3(t.vx), right: r3(-t.vy), cw: r3(-t.omega) };
    } catch (e) { out.intent = null; }
    return out;
  } finally { if (fromCode) S0.wheelCmd = orig; }
}
/* The pushes, on the robot as built (its CAD's motor mounting) and on the same robot built the way the
   code's own setDirection calls say (every wheel the same sense in the code's frame, both senses tried).
   Which side a team reverses depends on how ITS motors are mounted, which code can't know about a robot
   it wasn't written for. correctAsBuilt: as built. correctFromCode: mounting from the code. correct: either. */
function driveProbe(code, cad, map, opts, layout) {
  const L = LAYOUTS[layout] || LAYOUTS.mecanum, out = { layout: layout || 'mecanum', strafe: null };
  const variant = (sigma) => {
    const o = { strafe: null, sigma: sigma || undefined };
    for (const k of ['fwd', 'strafe', 'turn']) {
      if (!L[k]) continue;
      try { o[k] = push(code, cad, map, opts, L[k], sigma); } catch (e) { o[k] = { fwd: 0, right: 0, cw: 0, err: errText(e) }; }
    }
    o.ok = okOf(o); return o;
  };
  const pass = (k, r) => PASS[k](r) && (!r.intent || INTENT[k](r.intent));
  const okOf = (o) => ({ fwd: pass('fwd', o.fwd), strafe: o.strafe ? pass('strafe', o.strafe) : null, turn: pass('turn', o.turn) });
  const all = (o) => o.fwd && o.turn && o.strafe !== false;
  const nOk = (o) => ['fwd', 'strafe', 'turn'].filter((k) => o.ok[k]).length;
  Object.assign(out, variant(0)); delete out.sigma;
  const pos = variant(1), neg = variant(-1);
  out.fromCode = all(pos.ok) ? pos : all(neg.ok) ? neg : nOk(neg) > nOk(pos) ? neg : pos;
  out.correctAsBuilt = all(out.ok);
  out.correctFromCode = all(out.fromCode.ok);
  out.correct = out.correctAsBuilt || out.correctFromCode;
  out.atAll = ['fwd', 'strafe', 'turn'].some((k) => (out[k] && PASS.moved(out[k])) || (out.fromCode[k] && PASS.moved(out.fromCode[k])));
  out.err = ['fwd', 'strafe', 'turn'].map((k) => out[k] && out[k].err).filter(Boolean)[0] || null;
  out.fight = ['fwd', 'strafe', 'turn'].filter((k) => out[k] && out[k].intent && PASS[k](out[k]) && !INTENT[k](out[k].intent));
  return out;
}
/* the variant a report line describes: as built, unless only the code's own mounting drives right */
const shown = (d) => (d && !d.correctAsBuilt && d.correctFromCode ? Object.assign({ mine: true }, d.fromCode) : d);
/** Which non-drive motors/servos each control changes, against an unpressed run of the same length. */
function mechProbe(code, cad, map, controls, driveDevs, padOneAxes) {
  const mech = code.devices.filter((d) => isAct(d) && !driveDevs.has(d.name)).map((d) => d.name);
  const snap = (S) => mech.map((n) => { const d = S.dev[n]; return d ? [+d.cmd || 0, +d.target || 0] : [0, 0]; });
  const base = [];
  try { run(code, cad, map, {}, [[{}, {}, 0.2], [{}, {}, 1.0]], (S) => base.push(snap(S))); }
  catch (e) { return { mechDevices: mech, err: 'baseline run threw: ' + errText(e), probes: [] }; }
  const probes = [];
  for (const c of controls) {
    const [pad, ctl] = c.split(':'), v = /trigger/.test(ctl) ? 1 : /_stick_y$/.test(ctl) ? -1 : /_stick_x$/.test(ctl) ? 1 : true;
    const p1 = {}, p2 = {};
    if (pad === '1' || (pad === '0' && !padOneAxes.includes(ctl))) p1[ctl] = v;
    if (pad === '2' || pad === '0') p2[ctl] = v;
    const moved = new Set();
    try {
      run(code, cad, map, {}, [[{}, {}, 0.2], [p1, p2, 1.0]], (S, k) => {
        const now = snap(S), b = base[k];
        for (let i = 0; i < mech.length; i++) if (Math.abs(now[i][0] - b[i][0]) > MECH_EPS.cmd || Math.abs(now[i][1] - b[i][1]) > MECH_EPS.target) moved.add(mech[i]);
      });
      probes.push({ control: c, moved: [...moved].sort() });
    } catch (e) { probes.push({ control: c, moved: [...moved].sort(), err: errText(e) }); }
  }
  return { mechDevices: mech, probes };
}
/* what the OpMode leans on, read off its text: says why a robot doesn't move */
function usesOf(text, chain) {
  const t = stripComments(text), u = [];
  if (/\bsetDrivePowers\s*\(|\bPoseVelocity2d\b/.test(t)) u.push('rr1-drive');
  if (/\bsetWeightedDrivePower\s*\(|\bsetDrivePower\s*\(\s*new\s+Pose2d/.test(t)) u.push('rr05-drive');
  if (/\bsetTeleOpDrive\s*\(|\bstartTeleopDrive\s*\(|\bFollower\b/.test(t)) u.push('pedro');
  if (/\bdrive(?:Robot|Field)Centric\s*\(|ftclib\.drivebase/.test(t)) u.push('ftclib-drive');
  if (chain.includes('CommandOpMode')) u.push('command-based');
  if (/\bGamepadEx\b/.test(t)) u.push('gamepadex');
  if (!/\bhardwareMap\b/.test(t)) u.push('no-hardwareMap-here');
  if (/\bgetVoltage\s*\(/.test(t)) u.push('voltage');
  if (/\bWasPressed\s*\(|\.copy\s*\(\s*gamepad/.test(t)) u.push('edge-detect');
  return u;
}

/** A: one OpMode on the standard robot. */
function probeCode(task) {
  const En = engine(), t0 = Date.now();
  const src = read(task.file);
  const libs = task.helpers.map((f) => ({ file: path.basename(f), src: read(f) }));
  const scanText = [src].concat(task.scan.map(read)).join('\n');
  const res = { id: task.id, team: task.team, file: task.rel, group: task.group, controls: controlsRead(scanText), uses: usesOf(scanText, task.chain), helpers: libs.length };
  let code;
  try { code = En.parseJava(src, { libs }); } catch (e) { res.err = 'parseJava threw: ' + errText(e); res.ms = Date.now() - t0; return res; }
  res.parseMs = Date.now() - t0;
  res.kind = code.kind || null; res.cls = code.cls || null; res.base = code.base || null; res.hasLoop = !!code.hasLoop; res.auto = (code.auto || []).length;
  res.devices = code.devices.map((d) => ({ name: d.name, type: d.type, cfg: d.cfg }));
  try { const c = En.coverage(code), why = {}; for (const s of c.skipped) why[s.why] = (why[s.why] || 0) + 1; res.coverage = { understood: c.understood, total: c.total, why, lines: c.skipped.map((s) => s.line) }; }
  catch (e) { res.coverage = { err: errText(e) }; }
  const dtn = En.detectDrivetrain(code);
  res.drivetrain = dtn ? { wheels: dtn.wheels.map((w) => w.dev), ok: !!dtn.ok, style: dtn.style } : null;
  let cad, map;
  try { cad = En.parseSTEP(stdText()); map = En.autoMap(code.devices, cad.mechs); }
  catch (e) { res.err = 'standard robot failed: ' + errText(e); return res; }
  res.layout = layoutOf(res.controls);
  res.drive = driveProbe(code, cad, map, {}, res.layout);
  const S = En.Sim, simDt = S.drivetrain;
  res.simDrivetrain = simDt ? simDt.wheels.map((w) => w.dev) : null;
  const driveDevs = new Set([].concat(res.simDrivetrain || [], code.devices.filter((d) => En.isDriveDevice(d)).map((d) => d.name)));
  // drive axes: gamepad1's sticks of this layout, and whatever else feeds the drive motors
  const driveAxes = new Set(layoutAxes(res.layout).map((a) => '1:' + a));
  for (const b of code.bindings || []) if (b.analog && driveDevs.has(b.dev)) for (const a of b.axes || []) { const m = /gamepad([12])\.(\w+)/.exec(a); if (m) driveAxes.add(m[1] + ':' + m[2]); }
  const probeCtl = res.controls.filter((c) => !driveAxes.has(c));
  res.driveAxes = [...driveAxes].sort();
  res.mech = mechProbe(code, cad, map, probeCtl, driveDevs, layoutAxes(res.layout));
  const movers = new Set(); let ctlMoving = 0;
  for (const p of res.mech.probes) { if (p.moved.length) ctlMoving++; p.moved.forEach((n) => movers.add(n)); }
  res.mech.controlsMoving = ctlMoving; res.mech.devicesMoved = [...movers].sort();
  res.ms = Date.now() - t0;
  return res;
}

/* ---- B: CAD ------------------------------------------------- */
/* src/app.js SetupUI.render (the four "Robot setup" steps): a step is done only when someone presses it.
   SETUP.done is emptied for every new CAD (loadCAD) and nothing completes a step by itself today, so a
   new robot shows all four. MIRRORED HERE: change this in the same commit that makes a step complete itself. */
function setupOpen(cad, code, D, MAP) {
  // a step is done when the robot itself answers it (src/robotcheck.js setupAuto, as app.js SetupUI.isDone)
  const En = engine(), done = En.setupAuto ? En.setupAuto(cad, code, MAP || {}) : {};
  const steps = ['up', 'front', 'drive', 'joints'].filter((k) => !done[k]);
  return { open: steps.length, steps, driveFormOpens: !(D && D.wheels && D.wheels.length) };
}
/** Everything the page asks a team about this robot with this code (null: no OpMode). Mirrors app.js
    mapDevices + renderRobotCheckNow + Status.compute. */
function questions(cad, code, layout, front, specDevices, D, label) {
  const En = engine(), out = { code: label };
  let MAP = {};
  if (code) {
    MAP = En.autoMap(code.devices, cad.mechs, { cad });
    if (specDevices && cad.mates && cad.mates.source === 'spec') for (const d of code.devices) {
      const own = (k) => (k && Object.prototype.hasOwnProperty.call(specDevices, k) ? specDevices[k] : null);
      const j = own(d.name) || own(d.cfg);
      if (j && cad.mechs.some((m) => m.id === j)) MAP[d.name] = j;
    }
  }
  try {
    const rc = En.checkRobot(cad, code || { devices: [] }, MAP, { isCommanded: code ? (n) => En.isCommanded(code, n) : () => false, front });
    // a question is what the page labels ANSWER or CONFIRM; a NOTE (a live gauge, a suggestion) asks nothing
    const open = rc.items.filter((i) => i.sev === 'fail' || i.sev === 'warn');
    const kinds = {}; for (const i of open) { const k = i.key.split(':')[0] + ':' + i.sev; kinds[k] = (kinds[k] || 0) + 1; }
    out.rc = { fail: rc.need, warn: rc.warn, open: open.length, notes: rc.items.filter((i) => i.sev === 'note').length, withButtons: open.filter((i) => i.ask).length, kinds,
      buttons: open.reduce((s, i) => s + (i.ask === 'pick-parts' ? 2 * (i.candidates || []).length + 1 : i.ask === 'pick-device' ? 2 + (i.candidates || []).length : i.ask ? 1 : 0), 0) };
  } catch (e) { out.rc = { err: errText(e), open: 0 }; }
  out.setup = setupOpen(cad, code, D, MAP);
  let findings = [];
  if (code) try { findings = En.analyze(code, cad, MAP, Object.assign(SIM_OPTS(), { front })); } catch (e) { out.analyzeErr = errText(e); }
  const st = En.statusOf(findings, { stalled: [], missing: [], blocked: false, slipping: false, frontAcross: !!En.frontAcrossWheels(cad, front) });
  out.status = { level: st.level, n: st.items.length, keys: st.items.map((i) => i.key) };
  out.total = (out.rc.open || 0) + out.setup.open + out.status.n;
  if (code) {
    out.drive = driveProbe(code, cad, MAP, { front }, layout);
    const acts = code.devices.filter((d) => isAct(d) && !En.isDriveDevice(d) && En.isCommanded(code, d.name));
    const ids = new Set(cad.mechs.map((m) => m.id));
    out.onJoint = { n: acts.length, k: acts.filter((d) => MAP[d.name] && ids.has(MAP[d.name])).length, missing: acts.filter((d) => !(MAP[d.name] && ids.has(MAP[d.name]))).map((d) => d.name) };
  }
  return out;
}
const CODES = new Map();
function codeFor(spec) {
  if (!spec) return { code: null, layout: null };
  const k = spec.file + '|' + spec.helpers.length;
  if (!CODES.has(k)) CODES.set(k, { code: engine().parseJava(read(spec.file), { libs: spec.helpers.map((f) => ({ file: path.basename(f), src: read(f) })) }), layout: layoutOf(controlsRead(read(spec.file))) });
  return CODES.get(k);
}
function probeCad(task) {
  const En = engine(), res = { id: task.id, group: task.group, file: task.label, mb: null };
  const t0 = Date.now();
  let text;
  try { const buf = fs.readFileSync(task.path); res.mb = +(buf.length / 1048576).toFixed(1); text = (task.gz ? zlib.gunzipSync(buf) : buf).toString('utf8'); if (task.gz) res.mb = +(text.length / 1048576).toFixed(1); }
  catch (e) { res.err = 'read failed: ' + errText(e); return res; }
  let cad;
  const tp = Date.now();
  try { cad = En.parseSTEP(text); } catch (e) { res.parse = { ok: false, err: errText(e), ms: Date.now() - tp }; return res; }
  text = null;
  res.parse = { ok: true, ms: Date.now() - tp };
  const b = cad.bbox;
  res.units = cad.units || null; res.parts = (cad.solids || []).length;
  res.sizeMm = [0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * 1000));
  try { res.kg = +En.massProps(cad).kg.toFixed(2); } catch (e) { res.kg = null; res.massErr = errText(e); }
  res.up = (cad.frame && cad.frame.up) || null;
  const fw = En.frontFromWheels(cad);
  let front = fw || '+x';
  res.frontFromWheels = fw || null;
  let D = null;
  try { D = En.driveFromCAD(cad, { front }); res.drive = { kind: D.kind, wheels: (D.wheels || []).length, confidence: D.confidence != null ? +(+D.confidence).toFixed(2) : null }; }
  catch (e) { res.drive = { err: errText(e) }; }
  // joints the way the page gets them for a new robot: a joint spec if there is one, else the finder
  let spec = null, AR = null;
  try {
    if (task.joints) { spec = JSON.parse(read(task.joints)); res.joints = { source: 'joint spec' }; }
    else {
      const tf = Date.now(), R = En.autoRig(cad, { front });
      spec = R && R.spec;
      res.joints = { source: 'finder', ms: Date.now() - tf, actuators: (R && R.actuators) || 0, slides: (R && R.slides) || 0, moved: (R && R.moved) || 0, review: spec ? (spec.review || []).length : 0, why: spec ? undefined : ((R && R.review) || []).slice(0, 2) };
    }
    if (spec) {
      AR = En.applyJointSpec(cad, spec);
      if (AR.front && En.FRONTS[AR.front] !== undefined) front = AR.front;
      En.recomputeChain(cad.mechs);
    }
    res.joints.n = spec ? spec.joints.length : 0;
  } catch (e) { res.joints = Object.assign(res.joints || {}, { err: errText(e), n: 0 }); }
  res.front = front;
  if (D && front !== (fw || '+x')) try { D = En.driveFromCAD(cad, { front }); } catch (e) { /* keep */ }
  const specDevices = AR && AR.devices;
  res.q = {};
  for (const [k, c] of [['none', null], ['itd', task.itdCode], ['own', task.ownCode]]) {
    if (k !== 'none' && !c) continue;
    try { const P = codeFor(c); res.q[k] = questions(cad, P.code, P.layout, front, specDevices, D, c ? c.label : 'no code'); }
    catch (e) { res.q[k] = { err: errText(e), total: null }; }
  }
  res.ms = Date.now() - t0;
  return res;
}

if (!isMainThread) {
  parentPort.on('message', (task) => {
    let out;
    try { out = task.kind === 'cad' ? probeCad(task) : probeCode(task); }
    catch (e) { out = { id: task.id, team: task.team, group: task.group, file: task.rel || task.label, err: 'bench threw: ' + errText(e) }; }
    parentPort.postMessage(out);
  });
}

/* ============================================================
   Main: the task lists, the worker pools, the report
   ============================================================ */
function opts() {
  const a = {};
  for (const s of process.argv.slice(2)) { const m = /^--([\w-]+)(?:=(.*))?$/.exec(s); if (m) a[m[1]] = m[2] === undefined ? true : m[2]; }
  return a;
}
function pool(tasks, n, wopts, timeoutMs, onDone) {
  return new Promise((resolve) => {
    const results = new Array(tasks.length); let next = 0, done = 0;
    if (!tasks.length) return resolve(results);
    const spawn = () => {
      const w = new Worker(fileURLToPath(import.meta.url), wopts);
      let cur = -1, timer = null, dead = false;
      const fail = (why) => ({ id: tasks[cur].id, team: tasks[cur].team, group: tasks[cur].group, file: tasks[cur].rel || tasks[cur].label, err: why });
      const give = () => {
        if (next >= tasks.length) { w.terminate(); return; }
        cur = next++;
        // a probe that hangs (a parser loop, say) costs its own row, not the run
        timer = setTimeout(() => { dead = true; results[cur] = fail(`timed out after ${timeoutMs / 1000} s`); finish(cur); w.terminate(); spawn(); }, timeoutMs);
        w.postMessage(tasks[cur]);
      };
      const finish = (i) => { done++; if (onDone) onDone(results[i], done, tasks.length); if (done === tasks.length) resolve(results); };
      w.on('message', (r) => { if (dead) return; clearTimeout(timer); results[cur] = r; finish(cur); give(); });
      w.on('error', (e) => { if (dead) return; dead = true; clearTimeout(timer); if (cur >= 0 && !results[cur]) { results[cur] = fail('worker died: ' + errText(e)); finish(cur); } spawn(); });
      give();
    };
    for (let i = 0; i < Math.min(n, tasks.length); i++) spawn();
  });
}
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function codeTasks(A, only) {
  const CODE = path.join(CORPUS, 'code');
  if (!fs.existsSync(CODE)) return { tasks: [], teams: [], missing: `no code corpus at ${CODE} (node research/fullrobots/corpus.mjs --fetch)` };
  let man = null; try { man = JSON.parse(read(path.join(CODE, 'manifest.json'))); } catch (e) { man = null; }
  const teams = man ? man.teams : fs.readdirSync(CODE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => scanTeam(d.name));
  const tasks = [], seen = new Map(), teamFiles = new Map();
  // a team's files once: content hash and what each declares
  const filesOf = (dir) => {
    if (!teamFiles.has(dir)) teamFiles.set(dir, walkJava(dir).map((f) => { const s = read(path.join(dir, f)); return { f, h: sha(s), c: classify(s) }; }));
    return teamFiles.get(dir);
  };
  const make = (team, group, dir, rel, repoKey, primary) => {
    const file = path.join(dir, rel), src = read(file), h = sha(src);
    const key = repoKey + ':' + h;
    if (seen.has(key)) { const t = seen.get(key); if (primary) t.primary = true; t.alsoIn.add(team); return t; }
    // every other .java of the team (one copy of each), as helper classes
    const all = filesOf(dir).filter((x) => x.f !== rel), byHash = new Set([h]), helpers = [];
    for (const x of all) if (!byHash.has(x.h)) { byHash.add(x.h); helpers.push(path.join(dir, x.f)); }
    // the controls it reads: this file, its own base classes, and team classes it names that read a gamepad
    const index = new Map();
    for (const x of all) if (x.c.cls && !index.has(x.c.cls)) index.set(x.c.cls, { f: x.f, c: x.c });
    const chain = [], scan = new Set(); const me = classify(src);
    for (let d = 0, ext = me.ext; ext && d < 8; d++) { chain.push(ext); const p = index.get(ext); if (!p) break; scan.add(path.join(dir, p.f)); ext = p.c.ext; }
    const named = [src].concat([...scan].map(read)).join('\n');
    for (const [cls, p] of index) if (p.c.pads && new RegExp('\\b' + cls + '\\b').test(stripComments(named))) scan.add(path.join(dir, p.f));
    const t = { kind: 'code', id: team + '/' + rel, team, group, rel, file, helpers, scan: [...scan], chain, primary: !!primary, hash: h, alsoIn: new Set([team]) };
    seen.set(key, t); tasks.push(t); return t;
  };
  const list = [];
  for (const T of teams) {
    if (T.group === 'empty') continue;
    if (only && !only.some((o) => T.id.toLowerCase().includes(o))) continue;
    const dir = path.join(CODE, T.id), repoKey = (T.source && T.source.repo) || T.id;
    const mine = [], primaryTask = T.primary ? make(T.id, T.group, dir, T.primary, repoKey, true) : null;
    if (primaryTask) mine.push(primaryTask);
    for (const o of T.opmodes) {
      if (o.copyOfPrimary || o.file === T.primary) continue;
      const runIt = T.group === 'reference' ? (o.kind === 'teleop' || (o.kind === 'opmode' && o.readsGamepad && !o.abstract)) : (!A['primary-only'] && o.kind === 'teleop' && !o.disabled && !o.abstract);
      if (runIt) mine.push(make(T.id, T.group, dir, o.file, repoKey, false));
    }
    list.push({ id: T.id, group: T.group, primary: T.primary, repo: T.source && T.source.repo, primaryTask, tasks: mine });
  }
  // the bench's own known-good code, on the same robot: the default robot's TeleOp and the test fixture's
  const own = [
    { id: 'itd-7832', rel: 'sample_teleop.java', file: path.join(ITD, 'sample_teleop.java'), helpers: ITD_HELPERS.map((f) => path.join(ITD, f)) },
    { id: 'fixture', rel: 'CompetitionTeleOp.java', file: path.join(ROOT, 'tests', 'fixtures', 'CompetitionTeleOp.java'), helpers: [] },
  ];
  for (const o of own) {
    if (only && !only.some((x) => o.id.includes(x))) continue;
    const t = { kind: 'code', id: o.id + '/' + o.rel, team: o.id, group: 'reference', rel: o.rel, file: o.file, helpers: o.helpers, scan: [], chain: ['LinearOpMode'], primary: true, alsoIn: new Set([o.id]) };
    tasks.push(t);
    list.push({ id: o.id, group: 'reference', primary: o.rel, primaryTask: t, tasks: [t] });
  }
  return { tasks, teams: list };
}

function cadTasks(A, only) {
  const out = [];
  const itdCode = { label: 'ITD sample_teleop', file: path.join(ITD, 'sample_teleop.java'), helpers: ITD_HELPERS.map((f) => path.join(ITD, f)) };
  const add = (t) => { if (!only || only.some((o) => t.id.toLowerCase().includes(o))) out.push(Object.assign({ kind: 'cad', itdCode }, t)); };
  // research/realcad/fetch.mjs <corpus>/realcad; with no folder given it leaves them in the corpus root
  const RC = fs.existsSync(path.join(CORPUS, 'realcad')) ? path.join(CORPUS, 'realcad') : CORPUS;
  if (fs.existsSync(RC)) for (const f of fs.readdirSync(RC).filter((x) => /\.(step|stp)$/i.test(x)).sort()) add({ id: f.replace(/\.(step|stp)$/i, ''), group: 'realcad', label: path.basename(RC) + '/' + f, path: path.join(RC, f) });
  const owner = typeof A.owner === 'string' ? A.owner.split(';') : [path.join(os.homedir(), 'Downloads', 'REVIVER (Current Bot).step'), path.join(os.homedir(), 'Downloads', 'V1.1- BASE CURRENT--.step')];
  const skipped = [];
  for (const p of owner) {
    const id = 'owner-' + path.basename(p).replace(/\.(step|stp)$/i, '').replace(/[^A-Za-z0-9.]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    if (fs.existsSync(p)) add({ id, group: 'owner', label: path.basename(p), path: p }); else skipped.push(path.basename(p) + ' (not found)');
  }
  const ownITD = { label: 'own: sample_teleop', file: itdCode.file, helpers: itdCode.helpers };
  add({ id: 'itd-7832', group: 'default', label: 'into-the-deep robot.step.gz (finder)', path: path.join(ITD, 'robot.step.gz'), gz: true, ownCode: null });
  add({ id: 'itd-7832-spec', group: 'default', label: 'into-the-deep + its joints.json', path: path.join(ITD, 'robot.step.gz'), gz: true, joints: path.join(ITD, 'joints.json'), ownCode: null });
  // the repo's own small team robot (no wheels in its CAD) with its OpMode: the question audit's "asm" scenario
  add({ id: 'fixture-assembly', group: 'fixture', label: 'tests/fixtures/assembly.step', path: path.join(ROOT, 'tests', 'fixtures', 'assembly.step'),
    ownCode: { label: 'own: CompetitionTeleOp', file: path.join(ROOT, 'tests', 'fixtures', 'CompetitionTeleOp.java'), helpers: [] } });
  // full robots: a team's CAD with that team's code (<corpus>/fullrobots/<team>/robot.step + java/)
  const FR = path.join(CORPUS, 'fullrobots');
  const itdBytes = (() => { try { return zlib.gunzipSync(fs.readFileSync(path.join(ITD, 'robot.step.gz'))); } catch (e) { return null; } })();
  const itdHash = itdBytes ? crypto.createHash('sha1').update(itdBytes).digest('hex') : null;
  if (fs.existsSync(FR)) for (const d of fs.readdirSync(FR).sort()) {
    const step = path.join(FR, d, 'robot.step'); if (!fs.existsSync(step)) continue;
    if (itdBytes && fs.statSync(step).size === itdBytes.length && crypto.createHash('sha1').update(fs.readFileSync(step)).digest('hex') === itdHash) { skipped.push(path.relative(CORPUS, step).split(path.sep).join('/') + ' (same file as the default robot)'); continue; }
    const jdir = path.join(FR, d, 'java'), files = walkJava(jdir);
    const own = pickPrimary(jdir, files, d);
    add({ id: 'fr-' + d, group: 'fullrobot', label: 'fullrobots/' + d + '/robot.step', path: step,
      ownCode: own ? { label: 'own: ' + path.basename(own), file: path.join(jdir, own), helpers: files.filter((f) => f !== own).map((f) => path.join(jdir, f)) } : null });
  }
  return { tasks: out, skipped };
}
// a full robot's main TeleOp: named here when someone has looked, else the enabled @TeleOp with the most hardware
const FULL_PRIMARY = { bo19280pp: 'opmode/BlackoutTeleop.java', hh9384pp: 'PowerPlay/TeleOp/StatesTeleOp.java' };
function pickPrimary(dir, files, id) {
  const want = FULL_PRIMARY[id]; if (want) { const f = files.find((x) => x.endsWith(want)); if (f) return f; }
  let best = null, n = -1;
  for (const f of files) { const s = read(path.join(dir, f)), c = classify(s); if (!c.teleop || c.disabled) continue; const k = (s.match(/hardwareMap/g) || []).length; if (k > n) { n = k; best = f; } }
  return best;
}

/* ---- report ---- */
const pad = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '~' : s + ' '.repeat(n - s.length); };
const lpad = (s, n) => { s = String(s == null ? '' : s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
const f1 = (v) => (v == null || !Number.isFinite(+v) ? '-' : (+v).toFixed(1));
const f2 = (v) => (v == null || !Number.isFinite(+v) ? '-' : (+v).toFixed(2));
const median = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const flags = (d) => { if (!d) return '---'; const K = ['fwd', 'strafe', 'turn'], v = shown(d);
  return ['F', 'S', 'T'].map((c, i) => (v.ok[K[i]] === null ? '-' : v.ok[K[i]] ? (v.mine ? c.toLowerCase() : c) : '.')).join(''); };
const mechOk = (r) => !!(r && r.mech && r.mech.devicesMoved && r.mech.devicesMoved.length);

/* what a variant of the drive probe got wrong */
function wrongs(v) {
  const w = [];
  if (!v.ok.fwd) w.push(v.fwd.fwd < -0.1 ? `stick up drives BACKWARD ${f2(v.fwd.fwd)} m` : Math.abs(v.fwd.cw) >= 15 ? `stick up SPINS ${v.fwd.cw} deg` : `stick up ${f2(v.fwd.fwd)} m fwd, ${f2(v.fwd.right)} m right`);
  if (v.strafe && !v.ok.strafe) w.push(v.strafe.right < -0.1 ? `strafe goes LEFT ${f2(-v.strafe.right)} m` : Math.abs(v.strafe.cw) >= 15 ? `strafe SPINS ${v.strafe.cw} deg` : `strafe ${f2(v.strafe.right)} m right, ${f2(v.strafe.fwd)} m fwd`);
  if (!v.ok.turn) w.push(v.turn.cw < -10 ? `turn goes LEFT ${-v.turn.cw} deg` : Math.abs(v.turn.cw) <= 10 ? `turn stick moves it ${f2(v.turn.fwd)} m fwd, ${f2(v.turn.right)} m right` : `turn ${v.turn.cw} deg with ${f2(Math.hypot(v.turn.fwd, v.turn.right))} m drift`);
  return w.join(', ') || 'all three right';
}
/** Why a TeleOp doesn't drive (or drives wrong), in one line, from what the bench saw. */
function codeNote(r) {
  if (!r) return 'not run';
  if (r.err) return r.err;
  const u = r.uses || [], d = r.drive, nm = (r.devices || []).filter(isAct).length;
  const lib = u.includes('command-based') ? 'FTCLib CommandOpMode (initialize()/schedule() not run)' : u.includes('pedro') ? 'drives through Pedro Pathing\'s Follower'
    : u.includes('rr1-drive') ? 'drives through Road Runner 1.0 MecanumDrive.setDrivePowers' : u.includes('rr05-drive') ? 'drives through Road Runner 0.5 setWeightedDrivePower'
      : u.includes('ftclib-drive') ? 'drives through FTCLib MecanumDrive' : null;
  const bits = [];
  if (d && d.correctAsBuilt) bits.push('drives correctly');
  else if (d && d.correct) bits.push('drives correctly with its motors mounted the way its setDirection calls say (as built: ' + wrongs(d) + ')');
  else if (d && d.atAll) {
    const a = wrongs(d), b = wrongs(d.fromCode);
    bits.push('drives wrong: ' + a + (b !== a ? ' | mounted as its code says: ' + b : ''));
    if (d.fight && d.fight.length) bits.push(`${d.fight.join('+')} moves only because the sim drifts: the wheels are commanded against each other`);
  } else if (!r.hasLoop && !r.auto) bits.push('no main loop found' + (r.base ? ` (extends ${r.base})` : '') + (lib ? '; ' + lib : ''));
  else if (lib) bits.push(lib + ', which the bench doesn\'t run');
  else if (!nm) bits.push('0 motors/servos found' + (u.includes('no-hardwareMap-here') ? ': hardware lives in another class' : ''));
  else if (!r.drivetrain) bits.push(`${nm} actuators, but none fed straight from a stick (no drivetrain)`);
  else if (!r.drivetrain.ok) bits.push(`drivetrain ${r.drivetrain.wheels.join('/')} has no left/right in its names`);
  else bits.push('drivetrain found, robot did not move');
  if (r.drivetrain && r.drivetrain.wheels.length > 4) bits.push(`${r.drivetrain.wheels.length} "wheels": ${r.drivetrain.wheels.join('/')}`);
  const mp = r.mech || {};
  bits.push(mp.devicesMoved && mp.devicesMoved.length ? `${mp.devicesMoved.length}/${(mp.mechDevices || []).length} mechanism devices move (${mp.controlsMoving}/${(mp.probes || []).length} controls)` : `no mechanism moves (${(mp.probes || []).length} controls tried, ${(mp.mechDevices || []).length} non-drive actuators found)`);
  if (r.coverage && r.coverage.total) { const top = Object.entries(r.coverage.why || {}).sort((a, b) => b[1] - a[1])[0]; if (r.coverage.understood < r.coverage.total) bits.push(`${r.coverage.total - r.coverage.understood} stmts skipped${top ? ' (mostly: ' + top[0] + ')' : ''}`); }
  if (u.includes('voltage')) bits.push('reads battery voltage');
  if (u.includes('edge-detect')) bits.push('gamepad edge detection');
  return bits.join('; ');
}

function report(R, A) {
  const L = [];
  const p = (s = '') => L.push(s);
  const S = {};
  if (R.code) {
    const prim = R.code.teams.filter((t) => t.group === 'team');
    const ref = R.code.teams.filter((t) => t.group === 'reference');
    p(`A. CODE: each team's main TeleOp on one standard robot (${STD_ROBOT}: goBILDA 4-wheel mecanum), all its other .java files as helpers`);
    p(`   probes: gamepad1 held 1 s from a fresh START. F = left stick up goes >0.3 m forward (sideways <25 %, <15 deg); S = left stick right goes >0.2 m right;`);
    p(`   T = right stick right turns >20 deg clockwise in place (<0.1 m). lay = stick layout read off the code: mec(anum) as above; pov/arc(ade)/tnk drive and turn`);
    p(`   with their own sticks and can't strafe (S "-"). Each probe runs twice: on the robot as built (its CAD's motor mounting, left side reversed), and on`);
    p(`   the same robot with each drive motor mounted the way the code's own setDirection calls say (positive power rolls every wheel forward). drv upper case:`);
    p(`   right as built; lower case: right only with the code's mounting (it reverses the other side, say), which also counts as driving correctly. The numbers`);
    p(`   are for the variant drv shows. ctl = controls probed (not drive axes), mov = controls that moved a mechanism,`);
    p(`   mech = non-drive motors/servos whose power/position/target changed while a control was held 1 s (against an unpressed run).`);
    p('');
    const head = (first) => p(`${pad(first, 14)}${pad('TeleOp', 28)}${lpad('dev', 4)}${lpad('act', 4)} ${pad('drivetrain', 26)}${pad('lay', 4)}${lpad('fwd m', 7)}${lpad('right', 7)}${lpad('cw deg', 8)} ${pad('drv', 4)}${lpad('ctl', 4)}${lpad('mov', 4)}${lpad('mech', 5)} ${lpad('coverage', 9)} ${pad('every TeleOp', 14)}`);
    const row = (t, r) => {
      if (!r) { p(`${pad(t.id, 14)}(no TeleOp)`); return; }
      if (r.err && !r.drive) { p(`${pad(t.id, 14)}${pad(r.file.split('/').pop(), 28)}ERROR ${r.err}`); return; }
      const d = r.drive, v = shown(d), dt = r.simDrivetrain || (r.drivetrain && r.drivetrain.wheels) || [];
      const all = t.all ? `${t.all.correct}/${t.all.atAll}/${t.all.mech} of ${t.all.n}` : '';
      p(`${pad(t.id, 14)}${pad(r.file.split('/').pop(), 28)}${lpad((r.devices || []).length, 4)}${lpad((r.devices || []).filter(isAct).length, 4)} ${pad(dt.length ? dt.length + ': ' + dt.join('/') : '-', 25)} ${pad({ mecanum: 'mec', pov: 'pov', arcade: 'arc', tank: 'tnk' }[r.layout] || '', 4)}` +
        `${lpad(f2(v.fwd.fwd), 7)}${lpad(v.strafe ? f2(v.strafe.right) : 'n/a', 7)}${lpad(v.turn.cw, 8)} ${pad(flags(d), 4)}${lpad((r.mech.probes || []).length, 4)}${lpad(r.mech.controlsMoving || 0, 4)}${lpad((r.mech.devicesMoved || []).length, 5)} ` +
        `${lpad(r.coverage && r.coverage.total != null ? r.coverage.understood + '/' + r.coverage.total : '-', 9)} ${pad(all, 14)}`);
    };
    head('team'); for (const t of prim) row(t, t.primaryResult);
    p(`${''.padEnd(14)}("every TeleOp" = drives correctly / drives at all / moves a mechanism, of the team's enabled @TeleOps)`);
    p('');
    p('   reference code on the same robot (the bench\'s own known-good OpModes, the FTC SDK samples, the Road Runner 1.0 quickstart):');
    head('reference'); for (const t of ref) for (const r of t.results) row(Object.assign({}, t, { all: null }), r);
    p('');
    p('   why, per team (main TeleOp):');
    for (const t of prim) p(`   ${pad(t.id, 14)}${codeNote(t.primaryResult)}`);
    p('');
    const n = prim.length;
    S.code = {
      teams: n, drivesCorrectly: prim.filter((t) => t.primaryResult && t.primaryResult.drive && t.primaryResult.drive.correct).length,
      drivesCorrectlyAsBuilt: prim.filter((t) => t.primaryResult && t.primaryResult.drive && t.primaryResult.drive.correctAsBuilt).length,
      drivesAtAll: prim.filter((t) => t.primaryResult && t.primaryResult.drive && t.primaryResult.drive.atAll).length,
      mechanisms: prim.filter((t) => mechOk(t.primaryResult)).length,
      errors: prim.filter((t) => t.primaryResult && t.primaryResult.err).length,
    };
    const uniq = R.code.results.filter((r) => r.group === 'team');
    S.codeAll = { teleops: uniq.length, drivesCorrectly: uniq.filter((r) => r.drive && r.drive.correct).length, drivesAtAll: uniq.filter((r) => r.drive && r.drive.atAll).length, mechanisms: uniq.filter(mechOk).length,
      teamsAnyCorrect: prim.filter((t) => t.all && t.all.correct).length, teamsAnyAtAll: prim.filter((t) => t.all && t.all.atAll).length, teamsAnyMech: prim.filter((t) => t.all && t.all.mech).length };
    const refR = ref.flatMap((t) => t.results);
    S.reference = { opmodes: refR.length, drivesCorrectly: refR.filter((r) => r.drive && r.drive.correct).length, mechanisms: refR.filter(mechOk).length };
  }
  if (R.cad) {
    const C = R.cad.results;
    p('B. CAD: through the page\'s path for a new robot (parse, frame, front from the wheels, the joint finder or a joint spec)');
    p('');
    p(`${pad('cad', 30)}${lpad('MB', 6)}${lpad('parse s', 8)} ${pad('units', 10)}${lpad('parts', 6)} ${pad('size mm', 16)}${lpad('kg', 7)} ${pad('up', 3)} ${pad('front', 9)}${pad('drive', 13)}${lpad('joints', 7)}`);
    for (const c of C) {
      if (!c.parse || !c.parse.ok) { p(`${pad(c.id, 30)}${lpad(c.mb, 6)} PARSE FAILED: ${(c.parse && c.parse.err) || c.err}`); continue; }
      p(`${pad(c.id, 30)}${lpad(f1(c.mb), 6)}${lpad((c.parse.ms / 1000).toFixed(1), 8)} ${pad(c.units, 10)}${lpad(c.parts, 6)} ${pad(c.sizeMm.join('x'), 16)}${lpad(f2(c.kg), 7)} ${pad(c.up, 3)} ` +
        `${pad((c.front || '') + (c.frontFromWheels ? '' : '?'), 9)}${pad(c.drive && c.drive.kind ? c.drive.kind + ' ' + c.drive.wheels : 'err', 13)}${lpad((c.joints && c.joints.n) + (c.joints && c.joints.source === 'joint spec' ? 's' : ''), 7)}`);
    }
    p(`   up: the CAD's own axis the frame turned to +z. front: in the robot frame after that; "?" = the wheels don't give the front axis, so +x`);
    p(`   was used. drive: what driveFromCAD found (0 wheels: the sim drives a drawn base). joints "s": from a joint spec, else from the finder.`);
    p(`   parse s is measured while the code workers run, so it is a rough figure.`);
    p('');
    p('   what a team is asked, and what the robot does. Q = robot-check items (ANSWER+CONFIRM) + setup steps not done + status-light rows.');
    p(`   with code: drv = the probe above on THIS robot (F S T; lower case = right only with the motors mounted as the code says, not as this CAD has them:`);
    p(`   fine for the ITD code on another team's robot, wrong for a team's own code); joint = devices the code moves (not the drive) that have a joint to move.`);
    p('');
    p(`${pad('cad', 30)}${pad('Q no code', 13)}${pad('Q ITD code', 13)}${pad('ITD drv', 8)}${pad('joint', 7)}${pad('Q own code', 13)}${pad('own drv', 8)}${pad('joint', 7)}`);
    const qs = (q) => (q ? (q.err ? 'err' : `${q.total} (${q.rc.open}+${q.setup.open}+${q.status.n})`) : '');
    for (const c of C) {
      if (!c.q) continue;
      const i = c.q.itd, o = c.q.own;
      p(`${pad(c.id, 30)}${pad(qs(c.q.none), 13)}${pad(qs(i), 13)}${pad(i && i.drive ? flags(i.drive) : '', 8)}${pad(i && i.onJoint ? i.onJoint.k + '/' + i.onJoint.n : '', 7)}` +
        `${pad(qs(o), 13)}${pad(o && o.drive ? flags(o.drive) : '', 8)}${pad(o && o.onJoint ? o.onJoint.k + '/' + o.onJoint.n : '', 7)}`);
    }
    p('');
    p('   notes, per CAD:');
    for (const c of C) p(`   ${pad(c.id, 30)}${cadNote(c)}`);
    if (R.cad.skipped.length) p(`   skipped: ${R.cad.skipped.join('; ')}`);
    p('');
    const ok = C.filter((c) => c.parse && c.parse.ok);
    S.cad = { files: C.length, parsed: ok.length, questionsMedianNoCode: median(ok.map((c) => c.q && c.q.none && c.q.none.total)),
      questionsMedianITD: median(ok.map((c) => c.q && c.q.itd && c.q.itd.total)), drivesCorrectlyITD: ok.filter((c) => c.q && c.q.itd && c.q.itd.drive && c.q.itd.drive.correct).length,
      itdDevicesOnJointMedian: median(ok.map((c) => c.q && c.q.itd && c.q.itd.onJoint && c.q.itd.onJoint.k)), itdDevices: (ok.find((c) => c.q && c.q.itd && c.q.itd.onJoint) || { q: { itd: { onJoint: { n: null } } } }).q.itd.onJoint.n,
      withOwnCode: ok.filter((c) => c.q && c.q.own).length, ownDrivesCorrectly: ok.filter((c) => c.q && c.q.own && c.q.own.drive && c.q.own.drive.correctAsBuilt).length };
  }
  p('SUMMARY');
  if (S.code) {
    p(`  CODE (main TeleOp, ${S.code.teams} teams): drives correctly ${S.code.drivesCorrectly}/${S.code.teams} (${S.code.drivesCorrectlyAsBuilt} with the standard robot's motor mounting), drives at all ${S.code.drivesAtAll}/${S.code.teams}, moves a mechanism ${S.code.mechanisms}/${S.code.teams}` + (S.code.errors ? `, ${S.code.errors} errors` : ''));
    if (S.codeAll.teleops > S.code.teams) p(`  CODE (every enabled TeleOp, ${S.codeAll.teleops}): drives correctly ${S.codeAll.drivesCorrectly}, drives at all ${S.codeAll.drivesAtAll}, moves a mechanism ${S.codeAll.mechanisms}; teams with any TeleOp that drives correctly ${S.codeAll.teamsAnyCorrect}/${S.code.teams}`);
    p(`  REFERENCE code: drives correctly ${S.reference.drivesCorrectly}/${S.reference.opmodes}, moves a mechanism ${S.reference.mechanisms}/${S.reference.opmodes}`);
  }
  if (S.cad) {
    p(`  CAD: parse ${S.cad.parsed}/${S.cad.files}; questions median ${S.cad.questionsMedianNoCode} with no code, ${S.cad.questionsMedianITD} with the ITD TeleOp; ITD TeleOp drives correctly on ${S.cad.drivesCorrectlyITD}/${S.cad.parsed}, ` +
      `its ${S.cad.itdDevices} mechanism devices on a joint: median ${S.cad.itdDevicesOnJointMedian}` + (S.cad.withOwnCode ? `; own code drives correctly ${S.cad.ownDrivesCorrectly}/${S.cad.withOwnCode}` : ''));
  }
  const one = [];
  if (S.code) one.push(`CODE drives correctly ${S.code.drivesCorrectly}/${S.code.teams}, drives at all ${S.code.drivesAtAll}/${S.code.teams}, mechanisms ${S.code.mechanisms}/${S.code.teams}`);
  if (S.cad) one.push(`CAD parse ${S.cad.parsed}/${S.cad.files}, questions median ${S.cad.questionsMedianNoCode} (no code) / ${S.cad.questionsMedianITD} (ITD code)`);
  p('  ' + one.join(' | '));
  return { text: L.join('\n'), summary: S };
}
function cadNote(c) {
  if (!c.parse || !c.parse.ok) return 'parse failed: ' + ((c.parse && c.parse.err) || c.err);
  const b = [];
  if (Math.max(...c.sizeMm) > 1400 || Math.max(...c.sizeMm) < 120) b.push(`size ${Math.max(...c.sizeMm)} mm`);
  if (c.kg != null && (c.kg > 30 || c.kg < 2)) b.push(`${c.kg} kg`);
  if (!c.frontFromWheels) b.push('front not from wheels');
  if (c.drive && (!c.drive.wheels || c.drive.kind === 'unknown')) b.push(c.drive.wheels ? `${c.drive.wheels} wheels, kind ${c.drive.kind}` : 'no drive wheels (drawn base)');
  if (c.joints) b.push(c.joints.source === 'finder' ? `finder ${c.joints.n} joints (${c.joints.actuators} actuators, ${c.joints.slides} slides, ${c.joints.review} "Check:" notes)` : `${c.joints.n} joints from its spec`);
  const top = (q) => Object.entries((q && q.rc && q.rc.kinds) || {}).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => v + ' ' + k).join(', ') || 'robot check asks nothing';
  if (c.q && c.q.none && c.q.none.rc && c.q.none.rc.open) b.push('no code: ' + top(c.q.none));
  const i = c.q && c.q.itd;
  if (i && i.rc) b.push(`ITD code: ${top(i)}${i.rc.buttons ? ' (' + i.rc.buttons + ' buttons)' : ''}; status ${i.status.n}${i.drive && !i.drive.correct ? '; drives wrong: ' + wrongs(i.drive) : ''}`);
  const o = c.q && c.q.own;
  if (o && o.rc) b.push(`own code: ${top(o)}; ${o.drive && o.drive.correctAsBuilt ? 'drives correctly' : o.drive && o.drive.atAll ? 'drives wrong: ' + wrongs(o.drive) + (o.drive.correct ? (c.drive && c.drive.wheels ? ' (right only with its motors mounted as its setDirection calls say, not as the CAD has them)' : ' (right with its motors mounted as its setDirection calls say; the CAD has no drive wheels and the drawn base assumes the left side reversed)') : '') : 'does not drive'}; ${o.onJoint ? o.onJoint.k + '/' + o.onJoint.n + ' on a joint' : ''}`);
  return b.join('; ');
}
function compare(cur, base) {
  const L = [], worse = [], better = [];
  const p = (s) => L.push(s);
  const bt = new Map(((base.code && base.code.teams) || []).map((t) => [t.id, t]));
  for (const t of (cur.code && cur.code.teams) || []) {
    const o = bt.get(t.id); if (!o) continue;
    for (const [k, name] of [['correct', 'drives correctly'], ['asBuilt', 'drives correctly as built'], ['atAll', 'drives at all'], ['mech', 'moves a mechanism']]) {
      if (o.score && t.score && o.score[k] !== t.score[k]) (t.score[k] ? better : worse).push(`${t.id}: ${t.score[k] ? 'now ' : 'no longer '}${name}`);
    }
  }
  const bc = new Map(((base.cad && base.cad.results) || []).map((c) => [c.id, c]));
  for (const c of (cur.cad && cur.cad.results) || []) {
    const o = bc.get(c.id); if (!o) continue;
    if (!!(o.parse && o.parse.ok) !== !!(c.parse && c.parse.ok)) ((c.parse && c.parse.ok) ? better : worse).push(`${c.id}: parse ${(c.parse && c.parse.ok) ? 'now ok' : 'now FAILS'}`);
    for (const k of ['none', 'itd', 'own']) {
      const a = o.q && o.q[k] && o.q[k].total, b = c.q && c.q[k] && c.q[k].total;
      if (a != null && b != null && a !== b) (b < a ? better : worse).push(`${c.id}: questions (${k === 'none' ? 'no code' : k === 'itd' ? 'ITD code' : 'own code'}) ${a} -> ${b}`);
      const da = o.q && o.q[k] && o.q[k].drive, db = c.q && c.q[k] && c.q[k].drive;
      if (da && db && da.correct !== db.correct) (db.correct ? better : worse).push(`${c.id}: ${k} code ${db.correct ? 'now drives correctly' : 'no longer drives correctly'}`);
      const ja = o.q && o.q[k] && o.q[k].onJoint, jb = c.q && c.q[k] && c.q[k].onJoint;
      if (ja && jb && ja.k !== jb.k) (jb.k > ja.k ? better : worse).push(`${c.id}: ${k} code devices on a joint ${ja.k} -> ${jb.k}`);
    }
  }
  p(`VS ${base.label || 'baseline'} (${base.when || '?'}, ${(base.git && base.git.head) || '?'}): ${better.length} better, ${worse.length} worse`);
  for (const s of worse) p('  WORSE  ' + s);
  for (const s of better) p('  better ' + s);
  return { text: L.join('\n'), worse: worse.length };
}

/* JSON with one team / result / CAD per line, so a new baseline diffs line by line */
function jsonLines(R) {
  const j = (v) => JSON.stringify(v, (k, x) => (x instanceof Set ? [...x] : x));
  const arr = (a) => '[\n' + a.map(j).join(',\n') + '\n]';
  const top = Object.keys(R).map((k) => {
    if ((k === 'code' || k === 'cad') && R[k]) {
      return j(k) + ': {' + Object.keys(R[k]).map((kk) => { const v = R[k][kk]; return j(kk) + ': ' + (Array.isArray(v) && v.length && typeof v[0] === 'object' ? arr(v) : j(v)); }).join(',\n') + '}';
    }
    return j(k) + ': ' + j(R[k]);
  });
  return '{' + top.join(',\n') + '}\n';
}

async function main() {
  const A = opts(), t0 = Date.now();
  const only = typeof A.only === 'string' ? A.only.toLowerCase().split(',').filter(Boolean) : null;
  const git = (() => { try { return { head: execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'src', 'tests', 'tools'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length }; } catch (e) { return null; } })();
  const R = { format: 'ftc-simbench.fullrobots-bench', version: 1, when: new Date().toISOString(), git, corpus: path.relative(ROOT, CORPUS).split(path.sep).join('/') || '.', robot: STD_ROBOT, options: A };
  const log = (s) => { if (!A.quiet) process.stderr.write(s + '\n'); };
  const nW = +A.workers || Math.max(1, Math.min(6, os.cpus().length - 2));
  const jobs = [];
  if (!A['cad-only']) {
    const { tasks, teams, missing } = codeTasks(A, only);
    if (missing) log('CODE: ' + missing);
    log(`CODE: ${tasks.length} OpModes from ${teams.length} folders, ${nW} workers`);
    jobs.push(pool(tasks.map((t) => Object.assign({}, t, { alsoIn: undefined })), nW, { resourceLimits: { maxOldGenerationSizeMb: 2048 } }, (+A.timeout || 120) * 1000, (r, k, n) => { if (k % 20 === 0 || k === n) log(`  code ${k}/${n}`); }).then((res) => {
      const byId = new Map(res.map((r) => [r.id, r]));
      const results = tasks.map((t) => Object.assign({ team: t.team, group: t.group, primary: t.primary, alsoIn: [...t.alsoIn] }, byId.get(t.id)));
      const byTask = new Map(tasks.map((t, i) => [t, results[i]]));
      for (const T of teams) {
        T.results = T.tasks.map((t) => byTask.get(t));
        T.primaryResult = T.primaryTask ? byTask.get(T.primaryTask) : null;
        const en = T.results.filter(Boolean);
        T.all = { n: en.length, correct: en.filter((r) => r.drive && r.drive.correct).length, atAll: en.filter((r) => r.drive && r.drive.atAll).length, mech: en.filter(mechOk).length };
        const pr = T.primaryResult;
        T.score = pr ? { correct: !!(pr.drive && pr.drive.correct), asBuilt: !!(pr.drive && pr.drive.correctAsBuilt), atAll: !!(pr.drive && pr.drive.atAll), mech: mechOk(pr) } : null;
        delete T.tasks; delete T.primaryTask;
      }
      R.code = { teams, results };
    }));
  }
  if (!A['code-only']) {
    const { tasks, skipped } = cadTasks(A, only);
    log(`CAD: ${tasks.length} files` + (skipped.length ? `, skipped ${skipped.length}` : ''));
    jobs.push(pool(tasks, 1, { resourceLimits: { maxOldGenerationSizeMb: 8192 } }, 600000, (r, k, n) => log(`  cad ${k}/${n} ${r.id} ${r.ms != null ? (r.ms / 1000).toFixed(1) + ' s' : r.err || ''}`)).then((res) => { R.cad = { results: res, skipped }; }));
  }
  await Promise.all(jobs);
  // keep the JSON free of team code: line numbers and reasons only (coverage), no statement text
  const rep = report(R, A);
  R.summary = rep.summary; R.ms = Date.now() - t0;
  let out = rep.text + `\n  (${((Date.now() - t0) / 1000).toFixed(0)} s, engine ${git ? git.head + (git.dirty ? ' + ' + git.dirty + ' changed files' : '') : '?'}, ${new Date().toISOString().slice(0, 10)})`;
  const outFile = path.resolve(typeof A.out === 'string' ? A.out : path.join(HERE, 'last-run.json'));
  const cmpFile = typeof A.compare === 'string' ? path.resolve(A.compare) : path.join(HERE, 'baseline.json');
  let worse = 0;
  if (!A['no-compare'] && fs.existsSync(cmpFile) && path.resolve(cmpFile) !== outFile) {
    try { const c = compare(R, Object.assign({ label: path.basename(cmpFile) }, JSON.parse(read(cmpFile)))); out += '\n\n' + c.text; worse = c.worse; }
    catch (e) { out += '\n\n(compare failed: ' + errText(e) + ')'; }
  }
  console.log(out);
  // the JSON: each result once (teams point at them by id); no statement text from team code, only line numbers
  const slim = Object.assign({}, R);
  if (R.code) slim.code = { teams: R.code.teams.map((T) => ({ id: T.id, group: T.group, repo: T.repo, primary: T.primary, score: T.score, all: T.all,
    primaryResult: T.primaryResult ? T.primaryResult.id : null, results: T.results.map((r) => r && r.id) })), results: R.code.results };
  slim.options = Object.assign({}, A); delete slim.options.out; delete slim.options.compare;
  fs.writeFileSync(outFile, jsonLines(slim));
  log(`wrote ${outFile}`);
  if (A.strict && worse) process.exitCode = 1;
}
if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
