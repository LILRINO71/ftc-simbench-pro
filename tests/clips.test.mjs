// Match clips, match sounds and the results screen (src/recorder.js, src/sounds.js,
// src/results.js): the parts that decide something, run in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file, names) => new Function(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8') + `\nreturn { ${names.join(', ')} };`)();
const R = load('recorder.js', ['recPickType', 'recSize', 'recFileName', 'recHud', 'REC_TYPES']);
const S = load('sounds.js', ['soundCues', 'SOUND_CUES']);
const X = load('results.js', ['resultRows', 'resultWinner', 'bestKey', 'bestUpdate']);

test('clip: the first video type the browser records, WebM before MP4, none when it records nothing', () => {
  assert.equal(R.recPickType((t) => true), 'video/webm;codecs=vp9');
  assert.equal(R.recPickType((t) => /mp4/.test(t)), 'video/mp4;codecs=avc1', 'Safari records MP4');
  assert.equal(R.recPickType(() => false), null);
  assert.equal(R.recPickType(() => { throw new Error('no'); }), null);
});

test('clip: the size is the view\'s, at most 1280 on its long side, both sides even', () => {
  assert.deepEqual(R.recSize(1920, 1080), { w: 1280, h: 720 });
  assert.deepEqual(R.recSize(801, 451), { w: 802, h: 452 });
  assert.deepEqual(R.recSize(0, 0), { w: 2, h: 2 });
  const s = R.recSize(3000, 1234);
  assert.ok(s.w <= 1280 && s.w % 2 === 0 && s.h % 2 === 0);
});

test('clip: the file name says the robot and when, with the right extension', () => {
  const when = new Date(2026, 9, 21, 9, 5);
  assert.equal(R.recFileName('REVIVER (Current Bot).step', when, 'video/webm;codecs=vp9'), 'simbench-reviver-current-bot-2026-10-21-0905.webm');
  assert.equal(R.recFileName('', when, 'video/mp4'), 'simbench-robot-2026-10-21-0905.mp4');
  assert.match(R.recFileName('../../etc/passwd', when, ''), /^simbench-etc-passwd-[\d-]+\.webm$/, 'nothing but letters, digits and dashes');
});

test('clip: on top of the field, the score in a match, the clock, the robot, and where it was made', () => {
  const h = R.recHud({ match: true, red: 34, blue: 21, period: 'TeleOp', clock: '1:23', robot: 'Into The Deep.step', opmode: 'sample tele' });
  assert.deepEqual([h.red, h.blue, h.mid], ['34', '21', 'TELEOP 1:23']);
  assert.equal(h.left, 'Into The Deep.step · sample tele');
  assert.match(h.mark, /ftc-simbench-pro\.pages\.dev/);
  const solo = R.recHud({ match: false, period: 'Autonomous', clock: '0:12' });
  assert.equal(solo.red, null, 'no AI robots: no score bar');
  assert.equal(solo.mid, 'AUTO 0:12');
  assert.equal(R.recHud({ match: true, final: true }).mid, 'FINAL');
});

test('sounds: start leaving 0, a tick at each of the last ten seconds, the buzzer at the end, each once', () => {
  assert.deepEqual(S.soundCues(0, 0.05, 120), ['start']);
  assert.deepEqual(S.soundCues(5, 6, 120), []);
  assert.deepEqual(S.soundCues(110.9, 111.05, 120), ['tick']);
  assert.deepEqual(S.soundCues(119.95, 120.02, 120), ['end']);
  // a whole period in one jump (a slow tab): every cue once, in order
  const all = S.soundCues(0, 120, 120);
  assert.equal(all[0], 'start'); assert.equal(all.at(-1), 'end');
  assert.equal(all.filter((c) => c === 'tick').length, 10, 'at 10, 9 ... 1 second left');
  // no clock (practice), or the clock going back (a new run): nothing
  assert.deepEqual(S.soundCues(0, 10, 0), []);
  assert.deepEqual(S.soundCues(50, 0, 120), []);
  for (const k of Object.keys(S.SOUND_CUES)) for (const n of S.SOUND_CUES[k]) assert.ok(n.f > 20 && n.f < 20000 && n.d > 0 && n.t >= 0, k);
});

test('results: the lines anyone scored in, then the total; who won', () => {
  const S2 = { red: { leave: 0, park: 10, tipPts: 30, cell: 12, flower: 0, bottom: 0, garden: 3, total: 55 },
               blue: { leave: 0, park: 5, tipPts: 20, cell: 0, flower: 8, bottom: 2, garden: 0, total: 35 } };
  const rows = X.resultRows(S2);
  assert.deepEqual(rows.map((r) => r.label), ['PARK', 'TIPS', 'CELL', 'FLOWER', 'FLOWER base', 'GARDEN', 'Total']);
  assert.deepEqual(rows.at(-1), { label: 'Total', red: 55, blue: 35, total: true });
  assert.equal(X.resultWinner(S2), 'red');
  assert.equal(X.resultWinner({ red: { total: 4 }, blue: { total: 4 } }), 'tie');
  assert.deepEqual(X.resultRows(null), [{ label: 'Total', red: 0, blue: 0, total: true }]);
});

test('results: one personal best per robot, OpMode, period and opponents; beaten only by more', () => {
  const k = X.bestKey({ robot: 'Into The Deep.step', opmode: 'sample tele', period: 'TeleOp', skill: 'typical' });
  assert.equal(k, 'ftcbench.best.into_the_deep.step|sample_tele|teleop|typical');
  assert.notEqual(k, X.bestKey({ robot: 'Into The Deep.step', opmode: 'sample tele', period: 'TeleOp', skill: 'elite' }));
  const first = X.bestUpdate(null, 40, '2026-10-21');
  assert.deepEqual(first, { best: { score: 40, when: '2026-10-21' }, prev: null, isNew: true });
  const stored = JSON.stringify(first.best);
  assert.equal(X.bestUpdate(stored, 39).isNew, false);
  assert.equal(X.bestUpdate(stored, 40).isNew, false, 'a tie is not a new best');
  const beat = X.bestUpdate(stored, 52, '2026-10-22');
  assert.equal(beat.isNew, true); assert.equal(beat.prev.score, 40); assert.equal(beat.best.score, 52);
  assert.equal(X.bestUpdate('{not json', 5).isNew, true, 'a broken entry is no best');
});

const V = new Function(fs.readFileSync(path.join(ROOT, 'src', 'view3d.js'), 'utf8').match(/function followCamPose[\s\S]*?\n}\n/)[0] + '\nreturn { followCamPose };')();
const M = load('minimap.js', ['mapPoint', 'mapHeading', 'minimapItems']);

test('cameras: Chase sits behind and above the robot, Robot cam on its front edge, both looking where it faces', () => {
  for (const h of [0, Math.PI / 2, 2.5]) {
    const ch = { x: 0.4, y: -0.3, h }, f = [Math.cos(h), -Math.sin(h)];        // forward, in the scene's (x, -y)
    const C = V.followCamPose('chase', ch, { hx: 0.23, size: 0.45, top: 0.3 });
    const along = (p) => (p[0] - ch.x) * f[0] + (p[2] + ch.y) * f[1];
    assert.ok(along(C.pos) < -1 && C.pos[1] > 0.7, 'behind and above: ' + C.pos);
    assert.ok(along(C.look) > 0, 'looking ahead of it');
    const P = V.followCamPose('pov', ch, { hx: 0.23, size: 0.45, top: 0.3 });
    assert.ok(Math.abs(along(P.pos) - 0.26) < 1e-9 && Math.abs(P.pos[1] - 0.35) < 1e-9, 'on the front edge at the frame: ' + P.pos);
    assert.ok(along(P.look) > 3 && P.look[1] < P.pos[1], 'ahead and a little down');
  }
});

test('minimap: your alliance wall at the bottom, up the field is up, headings turn with it', () => {
  // red drives from -x: the red wall at the bottom, +x up, -y to the right
  assert.deepEqual(M.mapPoint(0, 0, 'red', 72, 144, 144), [72, 72]);
  assert.deepEqual(M.mapPoint(-72, 0, 'red', 72, 144, 144), [72, 144]);
  assert.deepEqual(M.mapPoint(0, -72, 'red', 72, 144, 144), [144, 72]);
  // blue drives from +x: the blue wall at the bottom
  assert.deepEqual(M.mapPoint(72, 0, 'blue', 72, 144, 144), [72, 144]);
  assert.deepEqual(M.mapPoint(0, 72, 'blue', 72, 144, 144), [144, 72]);
  // a robot facing away from its own drivers points up the map (-pi/2: screen up), for either alliance
  assert.ok(Math.abs(M.mapHeading(0, 'red') + Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(M.mapHeading(Math.PI, 'blue') + Math.PI / 2) < 1e-12);
});

test('minimap: zones, HIVEs, FLOWERs, balls and robots, all in field inches; yours marked', () => {
  const items = M.minimapItems({ zones: { red: { x0: -70, x1: -60, y0: 24, y1: 46 } }, hives: { red: -12.75, blue: 12.75 }, flowers: [{ x: -23.5, y: 68.2 }],
    balls: [{ x: 0.0254, y: 0, kind: 'pollen' }, { x: NaN, y: 0 }], robots: [{ x: 0.0254 * 10, y: 0, h: 1, hx: 0.2, hy: 0.2, al: 'blue', me: true }] });
  const by = (t) => items.filter((i) => i.t === t);
  assert.equal(by('zone').length, 1); assert.equal(by('hive').length, 2); assert.equal(by('flower').length, 1);
  assert.deepEqual(by('ball').map((b) => Math.round(b.x)), [1], 'a ball with no place is left out');
  const r = by('robot')[0];
  assert.ok(Math.abs(r.x - 10) < 1e-9 && r.me && r.al === 'blue' && Math.abs(r.hx - 0.2 / 0.0254) < 1e-9);
});

test('starts: centre, a tile left and a tile right along the wall, as each alliance\'s drivers see them', async () => {
  const { loadWithField } = await import('./load.mjs');
  const F = loadWithField().Field, fp = { hx: 0.2286, ox: 0, oy: 0 }, tile = 23.5 * 0.0254;
  const c = F.startPose('red', fp), l = F.startPose('red', fp, 'left'), r = F.startPose('red', fp, 'right');
  assert.equal(c.x, l.x); assert.equal(c.h, 0);
  assert.ok(Math.abs(l.y - tile) < 1e-9 && Math.abs(r.y + tile) < 1e-9, 'red faces +x: its left is +y');
  const bl = F.startPose('blue', fp, 'left');
  assert.ok(Math.abs(bl.y + tile) < 1e-9 && bl.x > 0 && Math.abs(bl.h - Math.PI) < 1e-12, 'blue faces -x: its left is -y');
  assert.deepEqual(F.startPose('red', fp, 'nonsense'), c, 'anything else is the centre');
});

const G = load('results.js', ['ghostRecord', 'ghostAt', 'ghostRead', 'GHOST_MAX']);
test('ghost: ten samples a second, the pose between them, the heading the short way round, nothing off the ends', () => {
  const tr = [];
  for (let t = 0; t <= 1.0001; t += 0.02) G.ghostRecord(tr, t, { x: t, y: 2 * t, h: 0 });
  assert.equal(tr.length, 11, 'one every tenth of a second');
  const p = G.ghostAt(tr, 0.45);
  assert.ok(Math.abs(p.x - 0.45) < 1e-9 && Math.abs(p.y - 0.9) < 1e-9);
  assert.equal(G.ghostAt(tr, 1.5), null); assert.equal(G.ghostAt(tr, -1), null); assert.equal(G.ghostAt([], 0), null);
  // across +-pi: 3.1 to -3.1 is 0.08 rad through pi, not 6.2 back round
  const h = G.ghostAt([[0, 0, 0, 3.1], [1, 0, 0, -3.1]], 0.5).h;
  assert.ok(Math.abs(Math.cos(h) + 1) < 0.01, 'halfway is pi: ' + h);
  assert.deepEqual(G.ghostRead(JSON.stringify(tr)), tr);
  assert.equal(G.ghostRead('[[0,1,2]]'), null); assert.equal(G.ghostRead('nope'), null);
  const long = []; for (let t = 0; t < 200; t += 0.1) G.ghostRecord(long, t, { x: 0, y: 0, h: 0 });
  assert.equal(long.length, G.GHOST_MAX, 'capped at a match and a bit');
});

const RR = load('results.js', ['runReport']);
test('run report: distance, top speed, time standing still, when it last moved, and what it hit', () => {
  // 1 m/s for 2 s along x, then 3 s still
  const tr = [];
  for (let i = 0; i <= 50; i++) { const t = i / 10; tr.push([t, Math.min(t, 2), 0, 0]); }
  const R = RR.runReport(tr, [{ t: 2.1, what: 'the red wall' }, { t: 2.4, what: 'the red wall' }, { t: 1.2, what: 'HIVE leg' }], 30);
  assert.ok(Math.abs(R.dist - 2) < 1e-9 && Math.abs(R.top - 1) < 1e-9);
  assert.ok(Math.abs(R.still - 3) < 1e-6, 'still ' + R.still);
  assert.ok(Math.abs(R.lastMove - 2) < 1e-9);
  assert.deepEqual(R.hits.map((h) => [h.what, h.n, h.t]), [['HIVE leg', 1, 1.2], ['the red wall', 2, 2.1]], 'each thing once, in order of first hit');
  // turning in place is moving
  const spin = [[0, 0, 0, 0], [0.1, 0, 0, 0.3], [0.2, 0, 0, 0.6]];
  assert.equal(RR.runReport(spin, [], 30).still, 0);
  assert.deepEqual(RR.runReport(null, null, 0), { dist: 0, top: 0, still: 0, lastMove: 0, hits: [], len: 0 });
});
