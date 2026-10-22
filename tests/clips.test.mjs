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
