// The .ftcsim bundle: does a saved workspace come back, and does a hostile
// file get turned away instead of crashing the bench?
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadEngine, sampleBench, fixture } from './load.mjs';

const E = loadEngine();

// A bench with everything filled in: real solids, a real map, an odd pose.
function bench() {
  const b = sampleBench(E);
  b.cad.solids = E.sampleSolids();
  b.cad.placements = [{ nauo: '#12', parent: 'Robot', child: 'Arm', loc: [0.1323, 0.2244, 0.1958], axis: [0, 0, 1] }];
  b.java = E.SAMPLE_JAVA;
  b.opts = { payloadKg: 0.225, duty: 0.42, trust: 'cad', front: '-y', baseModel: 'show', shooterModel: 'hide',
             turretScale: 0.61, startPose: { x: -1.5, y: 0.25, h: Math.PI / 2 }, robotConfig: { devices: [] } };
  b.chassis = { x: 0.7623145678901, y: -0.3048000000001, h: -1.2345678901234 };
  b.alliance = 'blue';
  b.shots = { seed: 11, spreadScale: 1.25, fired: 9, scored: 4,
              cfg: { shooter: 'flywheel', feeder: 'kicker', motorId: '6000', hoodDeg: 72, h0In: 16.5,
                     wheelMm: 96, gear: 1.5, mountDeg: -3, ball: 'pollen', type: 'single', precision: 'good' } };
  b.notes = 'left off mid-auto\nshooter runs hot';
  b.savedISO = '2026-09-19T14:03:05.000Z';   // the caller's clock, never ours
  return b;
}

test('round trip: the whole bench comes back, byte for byte', () => {
  const b = bench();
  const s = E.sessionFromBench(b);
  const text = E.packSession(s);
  assert.equal(typeof text, 'string');
  assert.ok(text.startsWith('{"magic":"' + E.FTCSIM_MAGIC + '"'), 'the magic is the first thing in the file');
  assert.ok(!/\n/.test(text), 'compact by default');

  const r = E.unpackSession(text);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.session, s, 'unpack(pack(x)) is x');

  // the fields that must survive untouched
  assert.deepEqual(r.session.map, b.map);
  assert.deepEqual(r.session.chassis, b.chassis);
  assert.equal(r.session.chassis.h, -1.2345678901234, 'heading keeps every digit and its sign');
  assert.equal(r.session.alliance, 'blue');
  assert.equal(r.session.opts.trust, 'cad');
  assert.equal(r.session.opts.front, '-y');
  assert.deepEqual(r.session.opts.startPose, b.opts.startPose);
  assert.equal(r.session.opts.robotConfig, undefined, 'unknown/unsupported option keys are dropped');
  assert.equal(r.session.savedISO, b.savedISO);
  assert.equal(r.session.notes, b.notes);
  assert.deepEqual(r.session.shots.cfg, b.shots.cfg);
  assert.equal(r.session.shots.seed, 11);

  // the CAD: same parts, same mechanisms, same solids
  assert.equal(r.session.cad.solids.length, b.cad.solids.length);
  assert.equal(r.session.cad.parts.length, b.cad.parts.length);
  assert.equal(r.session.cad.mechs.length, b.cad.mechs.length);
  assert.deepEqual(r.session.cad.mechs.map((m) => m.id), b.cad.mechs.map((m) => m.id));
  assert.deepEqual(r.session.cad.mechs.map((m) => m.parent), b.cad.mechs.map((m) => m.parent));
  assert.equal(r.session.cad.placements[0].child, 'Arm');
  assert.equal(r.session.cad.points, null, 'the raw cloud is dropped once there are solids');

  // the code: carried as a summary plus the source text
  assert.deepEqual(r.session.code.devices, b.code.devices.map((d) => ({
    name: d.name, type: d.type, cfg: d.cfg, intent: d.intent, declaredRole: d.declaredRole })));
  assert.deepEqual(r.session.code.consts, b.code.consts);
  assert.equal(r.session.code.opmode, b.code.opmode);
  assert.equal(r.session.code.kind, b.code.kind);
});

test('the Java rides along as text, verbatim, and is never run', () => {
  const b = bench();
  b.java = 'public class Evil {\n  // "}{" \\ not json\n  int x = 1; /* while(true){} */\n}\n';
  const r = E.unpackSession(E.packSession(E.sessionFromBench(b)));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.session.java, b.java, 'every character, including the ones that would break a parser');

  // a file whose "java" is a Java call to exit is still just a string
  const hostile = E.packSession(E.sessionFromBench({ java: 'System.exit(1);' }));
  assert.equal(E.unpackSession(hostile).session.java, 'System.exit(1);');
});

test('coordinates land on the 0.1 mm grid — hand-checked, sign included', () => {
  // 0.123456789 m = 1234.56789 tenths of a mm -> 1235 -> 0.1235 m exactly.
  // Rounding to whole millimetres instead would give 0.123, and a lost sign 0.1235.
  const cad = { name: 'grid.step', units: 'METRE', pointCount: 4,
    bbox: { min: [-0.123456789, 0, 0], max: [0.123456789, 0.00005, 0.00004999] },
    parts: [], placements: [],
    mechs: [{ id: 'j', kind: 'fixed', parent: 'chassis', axis: [0, 0, 1], pivot: [0.123456789, -0.123456789, 0.00005] }],
    solids: [{ name: 'blk', kind: 'metal', size: 0.5,
      pts: [[0.123456789, -0.123456789, 0], [0.00004999, -0.00005, 1.00005], [0, 0, 0], [1, 1, 1]] }] };
  const r = E.unpackSession(E.packSession(E.sessionFromBench({ cad })));
  assert.equal(r.ok, true, r.error);
  const g = r.session.cad;
  assert.deepEqual(g.mechs[0].pivot, [0.1235, -0.1235, 0.0001]);
  assert.deepEqual(g.solids[0].pts[0], [0.1235, -0.1235, 0]);
  // 1.00005 m is 10000.5 grid steps: an exact half rounds up. 0.04999 mm is just
  // under half a step and disappears, and -0.05 mm rounds to +0, not -0.
  assert.deepEqual(g.solids[0].pts[1], [0, 0, 1.0001], 'half a step up, just under half gone');
  assert.deepEqual(g.solids[0].pts[3], [1, 1, 1], 'a metre is still a metre');
  assert.deepEqual(g.bbox.min, [-0.1235, 0, 0]);
  assert.deepEqual(g.bbox.max, [0.1235, 0.0001, 0]);
  assert.equal(Object.is(g.solids[0].pts[2][0], 0), true, 'no negative zero comes back');
});

test('a real STEP assembly survives within the documented 0.1 mm', () => {
  // a corpus robot with real B-rep (tests/fixtures/robots), not the hand-written
  // skeleton: the parser now keeps only geometry that is actually on a solid
  const cad = E.parseSTEP(fixture('robots/mecanum-zup.step'));
  const r = E.unpackSession(E.packSession(E.sessionFromBench({ cad })));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.session.cad.solids.length, cad.solids.length);
  let worst = 0, n = 0;
  for (let i = 0; i < cad.solids.length; i++) {
    const a = cad.solids[i].pts, c = r.session.cad.solids[i].pts;
    assert.equal(c.length, a.length, 'no points lost');
    for (let k = 0; k < a.length; k++) for (let j = 0; j < 3; j++) { worst = Math.max(worst, Math.abs(a[k][j] - c[k][j])); n++; }
  }
  assert.ok(n >= 30 && cad.solids.length >= 2, 'there is real geometry in here');
  assert.ok(worst <= 5e-5 + 1e-12, 'every coordinate within half a grid step, got ' + worst);
  for (let j = 0; j < 3; j++) assert.ok(Math.abs(cad.bbox.min[j] - r.session.cad.bbox.min[j]) <= 5e-5 + 1e-12);
});

test('a session from a newer build is refused, readably', () => {
  const good = E.packSession(E.sessionFromBench(bench()));
  const raw = JSON.parse(good);
  raw.version = 99;
  const r = E.unpackSession(JSON.stringify(raw));
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'future-version');
  assert.match(r.error, /newer version/i);
  assert.match(r.error, /99/, 'it says which version it saw');
  assert.equal(r.session, undefined);

  raw.version = 0;
  assert.equal(E.unpackSession(JSON.stringify(raw)).detail, 'bad-version');
  raw.version = 1; raw.magic = 'NOPE';
  assert.equal(E.unpackSession(JSON.stringify(raw)).detail, 'bad-magic');
  raw.magic = E.FTCSIM_MAGIC; raw.app = 'ftc-sim-bench';
  const other = E.unpackSession(JSON.stringify(raw));
  assert.equal(other.detail, 'wrong-app');
  assert.match(other.error, /ftc-sim-bench/);
});

test('junk of every shape is rejected without throwing', () => {
  const good = E.packSession(E.sessionFromBench(bench()));
  const cases = [
    ['', 'empty'],
    [good.slice(0, 120), 'bad-json'],                       // truncated mid-object
    ['null', 'not-a-session'],
    ['[]', 'not-a-session'],
    ['[1,2,3]', 'not-a-session'],
    ['"a string"', 'not-a-session'],
    ['{}', 'bad-magic'],
    ['x'.repeat(200000), 'bad-json'],                       // a large junk blob
    ['{"magic":"FTCSIMBENCH","app":"ftc-simbench-pro","version":1,"cad":' + '['.repeat(400) + ']'.repeat(400) + '}', 'too-deep'],
    ['['.repeat(20000) + ']'.repeat(20000), 'too-deep'],     // nesting bomb: never parsed
    [undefined, 'not-text'], [null, 'not-text'], [42, 'not-text'], [{ magic: 'FTCSIMBENCH' }, 'not-text'],
  ];
  for (const [input, detail] of cases) {
    const r = E.unpackSession(input);
    assert.equal(r.ok, false, 'should have been refused: ' + String(input).slice(0, 24));
    assert.equal(r.detail, detail, 'for ' + String(input).slice(0, 24));
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 8, 'the message says something: ' + r.error);
  }
});

test('NaN and Infinity in a file are rejected, not swallowed', () => {
  // JSON.stringify would turn Infinity into null, so it goes in as text: the
  // literal 1e999 is legal JSON and parses back as Infinity.
  const good = E.packSession(E.sessionFromBench(bench()));
  const r = E.unpackSession(good.replace('"x":0.7623145678901', '"x":1e999'));
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'bad-number');
  assert.match(r.error, /pose\.x/);

  const r2 = E.unpackSession(good.replace(/"pts":\[(-?\d+)/, '"pts":[-1e999'));
  assert.equal(r2.ok, false);
  assert.equal(r2.detail, 'bad-number');
  assert.match(r2.error, /finite/);
});

test('a hostile __proto__ never reaches Object.prototype', () => {
  const evil = '{"__proto__":{"polluted":1},"constructor":{"polluted":1},'
    + '"magic":"FTCSIMBENCH","app":"ftc-simbench-pro","version":1,'
    + '"map":{"__proto__":{"polluted":1},"constructor":{"polluted":1},"prototype":{"polluted":1},"armMotor":"Arm"},'
    + '"code":{"consts":{"__proto__":{"polluted":1},"TICKS":537.7}},'
    + '"cad":{"mechs":[{"id":"Arm","__proto__":{"polluted":1},"pivot":[10,20,30]}]},'
    + '"chassis":{"x":1,"y":2,"h":3},"notes":"__proto__"}';
  const r = E.unpackSession(evil);
  assert.equal(r.ok, true, r.error);

  assert.equal(({}).polluted, undefined, 'Object.prototype was not touched');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal([].polluted, undefined);
  assert.equal('polluted' in r.session.map, false, 'not through the map either');
  assert.equal('polluted' in r.session.code.consts, false);
  assert.equal(Object.getPrototypeOf(r.session.map), Object.prototype, 'still an ordinary object');

  // the real content beside the poison is kept
  assert.equal(r.session.map.armMotor, 'Arm');
  assert.equal(r.session.code.consts.TICKS, 537.7);
  assert.deepEqual(r.session.cad.mechs[0].pivot, [0.001, 0.002, 0.003]);
  assert.equal(r.session.notes, '__proto__', 'a value that merely says __proto__ is just text');

  // and it survives being written back out
  const again = E.unpackSession(E.packSession(r.session));
  assert.equal(again.ok, true);
  assert.equal(({}).polluted, undefined);
});

test('the size caps trip before anything expensive happens', () => {
  const good = E.packSession(E.sessionFromBench(bench()));
  const cap = (opts) => E.unpackSession(good, opts);

  const big = cap({ maxChars: 100 });
  assert.equal(big.ok, false); assert.equal(big.detail, 'too-big');
  assert.match(big.error, /characters/);

  const deep = cap({ maxDepth: 2 });
  assert.equal(deep.ok, false); assert.equal(deep.detail, 'too-deep');

  const solids = cap({ maxSolids: 1 });
  assert.equal(solids.ok, false); assert.equal(solids.detail, 'too-big');
  assert.match(solids.error, /cad\.solids/);

  const pts = cap({ maxPointsPerSolid: 2 });
  assert.equal(pts.ok, false); assert.equal(pts.detail, 'too-big');

  for (const o of [{ maxMechs: 0 }, { maxParts: 0 }, { maxDevices: 0 }, { maxJava: 4 }, { maxNotes: 2 }, { maxKeys: 0 }])
    assert.equal(cap(o).ok, false, 'cap ignored: ' + JSON.stringify(o));

  assert.equal(cap({ maxSolids: 1000 }).ok, true, 'a generous cap still loads');
  assert.equal(cap({}).ok, true);
  assert.equal(cap('not an options object').ok, true, 'bad opts fall back to the defaults');
});

test('packing is deterministic — same session, same bytes', () => {
  const b = bench();
  const a1 = E.packSession(E.sessionFromBench(b));
  const a2 = E.packSession(E.sessionFromBench(bench()));
  assert.equal(a1, a2, 'two runs of the same input');

  const back = E.unpackSession(a1);
  assert.equal(E.packSession(back.session), a1, 'pack(unpack(t)) === t');
  assert.equal(E.packSession(back.session), E.packSession(E.unpackSession(E.packSession(back.session)).session));

  // key insertion order in the caller's objects must not leak into the file
  const m1 = {}; m1.zMotor = 'Arm'; m1.aServo = 'Claw';
  const m2 = {}; m2.aServo = 'Claw'; m2.zMotor = 'Arm';
  assert.equal(E.packSession(E.sessionFromBench({ map: m1 })), E.packSession(E.sessionFromBench({ map: m2 })));

  // pretty printing changes the bytes but not the session
  const pretty = E.packSession(E.sessionFromBench(b), { pretty: true });
  assert.ok(pretty.length > a1.length && /\n/.test(pretty));
  assert.deepEqual(E.unpackSession(pretty).session, back.session);
});

test('an empty or missing bench still makes a legal, loadable file', () => {
  for (const b of [undefined, null, {}, { cad: null, code: null }, { map: 'nope', opts: 7, chassis: 'x' }]) {
    const s = E.sessionFromBench(b);
    assert.equal(s.magic, E.FTCSIM_MAGIC);
    assert.equal(s.savedISO, '', 'nothing here reads the clock');
    const r = E.unpackSession(E.packSession(s));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.session, s);
    assert.deepEqual(r.session.chassis, { x: 0, y: 0, h: 0 });
    assert.equal(r.session.opts.trust, 'code');
    assert.equal(r.session.alliance, 'red');
  }
});

test('a CAD with no solids keeps its point cloud instead', () => {
  const cad = { name: 'cloud.step', bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
    points: [[0.0625, 0.125, 0.25], [-0.0625, -0.125, -0.25]], solids: [], mechs: [], parts: [] };
  const r = E.unpackSession(E.packSession(E.sessionFromBench({ cad })));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.session.cad.points, cad.points);
  assert.match(E.packSession(E.sessionFromBench({ cad })), /"points":\[625,1250,2500,-625,-1250,-2500\]/,
    'flat integers in tenths of a millimetre');
});

test('numbers out of any physical range are clamped: no 1e9 kg payload, no robot off the field', () => {
  const raw = JSON.parse(E.packSession(E.sessionFromBench(bench())));
  Object.assign(raw.opts, { payloadKg: 1e9, duty: -3, mu: 50, startPose: { x: -40, y: 7, h: 100 } });
  raw.chassis = { x: 1e6, y: -1e6, h: -7 };
  Object.assign(raw.shots, { spreadScale: 1e9 });
  Object.assign(raw.shots.cfg, { wheelMm: 1e5, gear: 0, hoodDeg: 400, h0In: -2 });
  const s = E.unpackSession(JSON.stringify(raw)).session;
  assert.equal(s.opts.payloadKg, 20); assert.equal(s.opts.duty, 0); assert.equal(s.opts.mu, 2);
  assert.deepEqual([s.chassis.x, s.chassis.y], [1.83, -1.83], 'on the field (half of 12 ft)');
  assert.deepEqual([s.opts.startPose.x, s.opts.startPose.y], [-1.83, 1.83]);
  const wrapped = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  assert.ok(Math.abs(s.opts.startPose.h - wrapped(100)) < 1e-12 && Math.abs(s.chassis.h - wrapped(-7)) < 1e-12, 'headings into -pi..pi');
  assert.equal(s.shots.spreadScale, 5);
  assert.deepEqual([s.shots.cfg.wheelMm, s.shots.cfg.gear, s.shots.cfg.hoodDeg, s.shots.cfg.h0In], [200, 0.1, 90, 4]);
  const low = JSON.parse(JSON.stringify(raw));
  Object.assign(low.opts, { mu: 0 }); Object.assign(low.shots.cfg, { wheelMm: 1, gear: 99, hoodDeg: -5, h0In: 99 });
  const t = E.unpackSession(JSON.stringify(low)).session;
  assert.equal(t.opts.mu, 0.05);
  assert.deepEqual([t.shots.cfg.wheelMm, t.shots.cfg.gear, t.shots.cfg.hoodDeg, t.shots.cfg.h0In], [30, 10, 0, 30]);
  // and values in range come back exactly as they were
  const b = bench(), back = E.unpackSession(E.packSession(E.sessionFromBench(b))).session;
  assert.deepEqual(back.chassis, b.chassis); assert.deepEqual(back.opts.startPose, b.opts.startPose); assert.deepEqual(back.shots.cfg, b.shots.cfg);
});

// The rig panel's own document, shaped as exportRig() in src/app.js writes it.
function rigOf(b) {
  return { format: 'ftc-sim-bench.rig', version: 1, cad: 'sample', opmode: 'WORKSHOP', trust: 'cad', payloadKg: 0.3, duty: 0.4,
    turretScale: 0.6, front: '-y', baseModel: 'show', shooterModel: 'auto', shot: { ...b.shots.cfg },
    joints: [{ id: 'Arm', label: 'Arm', kind: 'revolute', parent: 'chassis', dir: -1, pivotMm: [10.5, -20, 130.2], axis: [0, 1, 0],
      leverMm: 250, part: 'REV-41-1300', manual: false, inferred: true }],
    devices: { armMotor: 'Arm', clawServo: null }, hardware: { armMotor: { role: 'Motor', kind: 'motor', stallNm: 3.2 } },
    ignored: ['finding-1'], up: '+y', shift: [0.01, -0.02, 0],
    drive: { kind: 'mecanum', n: 4, d: 0.104, track: 0.38, base: 0.3, pattern: 'X' }, setup: { up: true, front: true } };
}

test('the OpMode file name, the rig panel, tile grip and the physics mode come back, each one checked', () => {
  const b = bench();
  b.opName = 'TeleOpMain.java';
  b.opts.mu = 0.7; b.opts.physics = 'kinematic';
  b.rig = rigOf(b);
  const text = E.packSession(E.sessionFromBench(b));
  const s = E.unpackSession(text).session;
  assert.equal(s.opName, 'TeleOpMain.java');
  assert.equal(s.opts.mu, 0.7);
  assert.equal(s.opts.physics, 'kinematic');
  assert.deepEqual(s.rig, b.rig);
  assert.equal(E.packSession(s), text, 'and they pack back to the same bytes');
  // a workspace that doesn't say keeps the bench's own grip and physics
  const plain = E.unpackSession(E.packSession(E.sessionFromBench(bench()))).session;
  assert.equal(plain.opts.mu, null); assert.equal(plain.opts.physics, null); assert.equal(plain.rig, null);
  // a hostile one is clamped and cleaned, not believed
  const raw = JSON.parse(text);
  raw.opName = '../../TeamCode/\u0000Evil.java';
  raw.opts.mu = 50; raw.opts.physics = 'warp';
  Object.assign(raw.rig, { payloadKg: 1e6, duty: -2, up: 'sideways', shift: [9, -9, 0],
    drive: { kind: 'hover', n: 7, d: 9, track: 0, base: 1, pattern: 'Z' },
    hardware: { armMotor: { role: 'Motor', stallNm: 3, deeper: { a: 1 } } }, devices: { armMotor: 7 } });
  raw.rig.joints[0].pivotMm = [1e9, 0, 0];
  const h = E.unpackSession(JSON.stringify(raw)).session;
  assert.equal(h.opName, '....TeamCodeEvil.java', 'a file name, never a path');
  assert.equal(h.opts.mu, 2); assert.equal(h.opts.physics, null);
  assert.equal(h.rig.payloadKg, 20); assert.equal(h.rig.duty, 0);
  assert.equal(h.rig.up, null); assert.deepEqual(h.rig.shift, [0.4, -0.4, 0]);
  assert.deepEqual(h.rig.drive, { kind: 'mecanum', n: 4, d: 0.2, track: 0.1, base: 0.6, pattern: 'X' });
  assert.deepEqual(h.rig.hardware, { armMotor: { role: 'Motor', stallNm: 3 } });
  assert.deepEqual(h.rig.devices, {});
  assert.deepEqual(h.rig.joints[0].pivotMm, [5000, 0, 0]);
  raw.rig.joints = Array.from({ length: 401 }, (_, i) => ({ id: 'j' + i }));
  assert.equal(E.unpackSession(JSON.stringify(raw)).detail, 'too-big', 'a rig with more joints than a CAD may have');
  raw.rig = { format: 'something else', payloadKg: 1 };
  assert.equal(E.unpackSession(JSON.stringify(raw)).session.rig, null, 'only a rig document is a rig');
});

/* Session from src/app.js, run as the page runs it, with the rest of the page
   stood in for: what it saves and what it puts back. */
function appSession(env) {
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const a = src.indexOf('const Session={'), z = src.indexOf('\n};\n', a);
  const names = Object.keys(env).filter((n) => n !== 'MAP');
  return new Function('__map', ...names, `let MAP=__map;\n${src.slice(a, z + 3)}\nreturn { Session, MAP: () => MAP };`)(env.MAP, ...names.map((n) => env[n]));
}
test('saving a workspace and opening it again puts back the shooter, grip, physics, rig and OpMode name', () => {
  const b = bench(), rig = rigOf(b), cfg = { ...b.shots.cfg };
  const defaults = () => ({ shooter: null, feeder: null, motorId: null, hoodDeg: 75, h0In: 16, wheelMm: 96, gear: 1, mountDeg: 0, ball: 'pollen', type: 'single', precision: 'typical' });
  const engine = { packSession: E.packSession, sessionFromBench: E.sessionFromBench, unpackSession: E.unpackSession };
  let file = null;
  const A = appSession({ ...engine, CAD: b.cad, CODE: b.code, MAP: b.map, CURRENT_ID: 'u1',
    entry: () => ({ source: b.java, file: 'TeleOpMain.java' }),
    OPTS: { ...b.opts, mu: 0.7, physics: 'kinematic' }, Sim: { chassis: { ...b.chassis } },
    Shots: { alliance: 'blue', seed: 11, spreadScale: 1.25, fired: 9, scored: 4, cfg, defaults },
    exportRig: () => rig, download: (name, text) => { file = text; }, $: () => null });
  A.Session.save();
  const r = E.unpackSession(file);
  assert.equal(r.ok, true, r.error);
  // a fresh bench opens it
  const got = { rig: null, op: null }, toast = { textContent: '' };
  const Shots = { alliance: 'red', seed: 7, spreadScale: 1, fired: 0, scored: 0, cfg: null, defaults };
  const OPTS = { payloadKg: 0.18, duty: 0.3, trust: 'code', front: '+x', baseModel: 'auto', shooterModel: 'auto', mu: 0.9, physics: 'rigid' };
  const B = appSession({ ...engine, CAD: null, CODE: null, MAP: {}, OPTS, Shots, Sim: { chassis: { x: 0, y: 0, h: 0 } }, Field: { ok: false },
    classifyMechs: E.classifyMechs, loadCAD: () => { Shots.cfg = null; }, applyRig: (x) => { got.rig = x; return true; }, saveRig: () => {},
    // opening a workspace makes its robot the bench's (src/app.js loadSessionCAD), which resets the shooter
    LAST_STEP: null, JOINTS: { spec: null }, loadSessionCAD: (step) => { Shots.cfg = null; return JSON.parse(step.session); },
    addOpModeFromText: (name, text) => { got.op = { name, text }; }, rebuild: () => {}, syncOptionControls: () => {},
    Physics: { sync() {} }, setAlliance: (al) => { Shots.alliance = al; }, shotChanged: () => {}, $: () => toast });
  B.Session.apply(r.session, 'robot.ftcsim');
  assert.deepEqual(Shots.cfg, cfg, 'the shooter setup');
  assert.equal(Shots.seed, 11); assert.equal(Shots.spreadScale, 1.25);
  assert.equal(OPTS.mu, 0.7); assert.equal(OPTS.physics, 'kinematic');
  assert.equal(got.op.name, 'TeleOpMain.java', 'the OpMode under its own file name');
  assert.deepEqual(got.rig.devices, rig.devices, 'the rig panel');
  assert.deepEqual(got.rig.joints, [], 'not its joints: the CAD in the workspace has those');
  assert.match(toast.textContent, /saved \d{4}-\d\d-\d\d/, 'and when it was saved');
});
