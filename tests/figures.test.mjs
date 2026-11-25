// The AI robots' and HUMAN PLAYERS' motion (src/figures.js): the throw's pose at each
// moment of an entry, where the NECTAR is, and how far each mecanum wheel turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('figures: figTrack passes through its keys and rests at a turning point', () => {
  const keys = [[0, 0], [0.4, -1], [0.6, 1], [1, 0]];
  for (const [k, v] of keys) assert.ok(near(E.figTrack(keys, k), v), `key ${k}`);
  // -1 at 0.4 is a low point: nothing on either side of it dips below
  for (let k = 0; k <= 1.0001; k += 0.01) assert.ok(E.figTrack(keys, k) >= -1 - 1e-9 && E.figTrack(keys, k) <= 1 + 1e-9, `k=${k.toFixed(2)}`);
  assert.equal(E.figTrack(keys, -1), 0);
  assert.equal(E.figTrack(keys, 2), 0);
});

test('figures: a HUMAN PLAYER at rest stands in FIG_IDLE, breathing and shifting a little', () => {
  const P = E.humanPose(1.3, null, 0, 0.7);
  for (const c of ['shRz', 'shLz', 'sz', 'nod']) assert.ok(Math.abs(P[c] - E.FIG_IDLE[c]) < 0.05, c);
  assert.ok(near(P.shRx, E.FIG_IDLE.shRx) && near(P.elR, E.FIG_IDLE.elR), 'the arms hang');
  assert.ok(Math.abs(P.breath) <= 0.012 + 1e-12);
  // over a few seconds the chest really moves and the hips really shift
  const B = [], S = [];
  for (let t = 0; t < 12; t += 0.1) { const Q = E.humanPose(t, null, 0, 0.7); B.push(Q.breath); S.push(Q.sz); }
  assert.ok(Math.max(...B) - Math.min(...B) > 0.015, 'breathes');
  assert.ok(Math.max(...S) - Math.min(...S) > 0.01, 'shifts weight');
  // and two players don't breathe as one
  assert.notEqual(E.humanPose(2, null, 0, 0.7).breath, E.humanPose(2, null, 0, 2.9).breath);
});

test('figures: the head turns to what they watch, the chest helps past a neck\'s turn', () => {
  const ahead = E.humanPose(0, null, 0, 0), left = E.humanPose(0, null, 0.8, 0), far = E.humanPose(0, null, 1.5, 0);
  assert.ok(Math.abs(ahead.head) < 0.01);
  assert.ok(left.head > 0.4, 'turns left to look left');
  assert.ok(far.yaw > 0.3 && far.head <= 1.2, 'the chest turns too, the neck stays in reach');
  assert.ok(near(far.yaw + far.head, 1.5, 0.05), 'together they face it');
  assert.ok(E.humanPose(0, null, -0.8, 0).head < -0.4, 'and right');
});

test('figures: the lob reaches for the tray, winds back, lets go swinging forward, follows through', () => {
  const at = (k) => E.humanPose(0, k, 0, 0);
  const reach = at(E.FIG_GRAB), wind = at(0.47), rel = at(E.FIG_RELEASE), follow = at(0.7), end = at(1);
  assert.ok(reach.shRx < E.FIG_IDLE.shRx - 0.3 && reach.lean < -0.2 && reach.knee > 0.3, 'bends and reaches out right to the tray');
  assert.ok(reach.yaw + reach.head < -0.4 && reach.nod < -0.3, 'looks down and right at the tray');
  assert.ok(wind.shRz < -0.8, 'the arm back');
  assert.ok(rel.shRz > 0.8, 'swinging forward at the release');
  assert.ok(follow.shRz > rel.shRz, 'and still rising after it');
  assert.ok(follow.sx > 0 && wind.sx < 0, 'the weight goes from the back foot to the front');
  for (const c of Object.keys(E.FIG_IDLE)) assert.ok(near(end[c], at(null)[c] ?? E.FIG_IDLE[c], 0.05) || c === 'sz', `${c} back to rest`);
  // no jumps: a 60 Hz frame never moves a joint more than a fast human arm would
  const dk = 1 / 60 / 1.3;
  for (let k = 0; k < 1; k += dk) {
    const a = at(k), b = at(Math.min(1, k + dk));
    for (const c of Object.keys(E.FIG_IDLE)) assert.ok(Math.abs(a[c] - b[c]) < 0.45, `${c} at k=${k.toFixed(3)}`);
  }
});

test('figures: the NECTAR is on the tray, in the hand, then flying', () => {
  assert.equal(E.throwBallPhase(null).at, 'tray');
  assert.equal(E.throwBallPhase(0.1).at, 'tray');
  assert.equal(E.throwBallPhase(E.FIG_GRAB).at, 'hand');
  assert.equal(E.throwBallPhase(0.5).at, 'hand');
  const a = E.throwBallPhase(E.FIG_RELEASE), b = E.throwBallPhase(1);
  assert.equal(a.at, 'air'); assert.equal(a.u, 0);
  assert.equal(b.at, 'air'); assert.equal(b.u, 1);
  assert.ok(E.FIG_GRAB < E.FIG_RELEASE && E.FIG_RELEASE === 0.55, 'let go when the match does (k = 0.55)');
});

test('figures: mecanum wheels turn as a mecanum drive does', () => {
  const r = 0.048, hx = 0.149, hy = 0.205;
  const fwd = E.mecanumTurns(0.1, 0, 0, hx, hy, r);
  for (const w of fwd) assert.ok(near(w, 0.1 / r), 'ahead: all four roll forward the distance over the radius');
  const [fl, fr, bl, br] = E.mecanumTurns(0, 0.1, 0, hx, hy, r);
  assert.ok(fl < 0 && br < 0 && fr > 0 && bl > 0, 'strafing left: the diagonals turn against each other');
  assert.ok(near(fl, -fr) && near(bl, -br));
  const T = E.mecanumTurns(0, 0, 0.5, hx, hy, r);
  assert.ok(T[0] < 0 && T[2] < 0 && T[1] > 0 && T[3] > 0, 'turning left: the left side back, the right forward');
  assert.ok(near(T[1], (hx + hy) * 0.5 / r));
});
