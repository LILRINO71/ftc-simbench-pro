// Shot effects (src/shotfx.js): the plain functions under the pooled three.js effects.
// The drawing needs a GPU; what is checked here is the logic that decides what is drawn.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

describe('pools', () => {
  test('a pool hands out each thing once, refuses when empty, and gets it back', () => {
    const made = [];
    const pool = E.fxPool(3, (i) => { const o = { i }; made.push(o); return o; });
    assert.equal(made.length, 3, 'everything is made up front');
    const a = pool.acquire(), b = pool.acquire(), c = pool.acquire();
    assert.equal(new Set([a, b, c]).size, 3);
    assert.equal(pool.acquire(), null, 'a pool never grows');
    assert.equal(pool.used(), 3);
    pool.release(b);
    assert.equal(pool.acquire(), b, 'the released one is the next one out');
    assert.equal(made.length, 3, 'and nothing new was made');
  });
  test('releasing too much never grows a pool past its size', () => {
    const pool = E.fxPool(2, (i) => ({ i }));
    const a = pool.acquire(); pool.release(a); pool.release(a); pool.release(a);
    assert.ok(pool.free() <= 2);
    assert.equal(pool.items.length, 2);
  });
  test('shots in a row reuse the same slots', () => {
    const pool = E.fxPool(4, (i) => ({ i }));
    const seen = new Set();
    for (let shot = 0; shot < 200; shot++) { const x = pool.acquire(); seen.add(x); pool.release(x); }
    assert.ok(seen.size <= 4);
  });
});

describe('trail', () => {
  test('a ribbon is brightest at the ball and dark at its tail', () => {
    const n = 20; let last = -1;
    for (let i = 0; i < n; i++) { const v = E.trailFade(i, n, 0, 0); assert.ok(v >= last); last = v; }
    assert.equal(E.trailFade(0, n, 0, 0), 0);
    assert.equal(E.trailFade(n - 1, n, 0, 0), 1);
  });
  test('after the ball lands the whole ribbon fades to nothing by the end of its fade', () => {
    const n = 12;
    assert.ok(E.trailFade(n - 1, n, 0.1, 0.25) < 1);
    assert.ok(E.trailFade(n - 1, n, 0.1, 0.25) > E.trailFade(n - 1, n, 0.2, 0.25));
    assert.equal(E.trailFade(n - 1, n, 0.25, 0.25), 0);
    assert.equal(E.trailFade(n - 1, n, 5, 0.25), 0);
  });
  test('the ribbon tapers from the ball\'s width to a point', () => {
    const n = 16;
    assert.ok(Math.abs(E.trailWidth(n - 1, n, 0.04) - 0.04) < 1e-9);
    assert.ok(E.trailWidth(0, n, 0.04) < 0.005);
    let last = 0; for (let i = 0; i < n; i++) { const w = E.trailWidth(i, n, 0.04); assert.ok(w >= last); last = w; }
  });
  test('a path is sampled by time, held at its ends', () => {
    const path = [[0, 0, 0], [10, 0, 20], [20, 0, 0]], out = [0, 0, 0];
    E.fxPathAt(path, 0.5, 0.25, out); assert.deepEqual(out.map((v) => +v.toFixed(6)), [5, 0, 10]);
    E.fxPathAt(path, 0.5, -1, out); assert.deepEqual(out, [0, 0, 0]);
    E.fxPathAt(path, 0.5, 99, out); assert.deepEqual(out, [20, 0, 0]);
    E.fxPathAt(path, 0.5, 0.75, out); assert.deepEqual(out.map((v) => +v.toFixed(6)), [15, 0, 10]);
  });
});

describe('score popup', () => {
  const st = { y: 0, a: 1, s: 1 };
  test('it floats up, stays solid, then fades out by the end', () => {
    E.popupState(0, 1, true, st); assert.equal(st.y, 0); assert.equal(st.a, 1);
    E.popupState(0.3, 1, true, st); assert.ok(st.y > 0 && st.a === 1);
    const mid = E.popupState(0.75, 1, true, st).a; assert.ok(mid < 1 && mid > 0);
    E.popupState(1, 1, true, st); assert.equal(st.a, 0); assert.ok(Math.abs(st.y - 0.2) < 1e-9);
    E.popupState(7, 1, true, st); assert.equal(st.a, 0);
  });
  test('it pops in past full size and settles; with pop off it never changes size', () => {
    E.popupState(0, 1, true, st); assert.ok(st.s < 0.7);
    let peak = 0; for (let t = 0; t <= 0.2; t += 0.01) { E.popupState(t, 1, true, st); peak = Math.max(peak, st.s); }
    assert.ok(peak > 1.1 && peak <= 1.21);
    E.popupState(0.5, 1, true, st); assert.equal(st.s, 1);
    for (let t = 0; t < 1; t += 0.05) { E.popupState(t, 1, false, st); assert.equal(st.s, 1); }
  });
});

describe('ball in flight', () => {
  test('backspin: the top of a ball moving along +x comes back, so it turns about +z', () => {
    const out = [0, 0, 0];
    E.fxSpinAxis(3, 0, out); assert.deepEqual(out.map((v) => v + 0), [-0, 0, 1].map((v) => v + 0));
    // moving along -z (field +y): the axis is -x... across the path, horizontal
    E.fxSpinAxis(0, -2, out); assert.ok(Math.abs(out[0] - 1) < 1e-9 && out[1] === 0 && Math.abs(out[2]) < 1e-9);
    // across the path: perpendicular to the horizontal motion
    E.fxSpinAxis(2, 3, out); assert.ok(Math.abs(out[0] * 2 + out[2] * 3) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-9);
  });
  test('a ball falling straight down has no horizontal path to spin across', () => {
    assert.equal(E.fxSpinAxis(0, 0, [0, 0, 0]), null);
  });
  test('the spin rate stays where the eye can follow it at 60 fps', () => {
    for (const v of [0, 1, 5, 9, 14, 40]) { const w = E.fxSpinRate(v); assert.ok(w >= 12 && w <= 30); assert.ok(w / 60 < Math.PI / 2, 'under a quarter turn a frame'); }
    assert.ok(E.fxSpinRate(9) > E.fxSpinRate(4));
  });
});

describe('camera nudge and the tiers', () => {
  test('a nudge decays', () => {
    assert.equal(E.fxShakeAmp(0.01, 0, 14), 0.01);
    assert.ok(E.fxShakeAmp(0.01, 0.2, 14) < 0.001);
    assert.ok(E.fxShakeAmp(0.01, 0.1, 14) > E.fxShakeAmp(0.01, 0.2, 14));
  });
  test('a low tier, or a machine the watchdog backed off, draws the cheap level', () => {
    assert.equal(E.fxLevel(0, false), 0); assert.equal(E.fxLevel(1, false), 1); assert.equal(E.fxLevel(2, false), 2);
    assert.equal(E.fxLevel(2, true), 0, 'the frame-rate watchdog says the machine cannot keep up');
    assert.equal(E.fxLevel(undefined, false), 0); assert.equal(E.fxLevel(9, false), 2);
  });
  test('each level costs no more than the next, and level 0 has no ribbons, dust, shake or pop', () => {
    const L = E.FX_LEVELS; assert.equal(L.length, 3);
    for (const k of ['trailN', 'sparks', 'dust', 'popups', 'rings', 'burst', 'flash']) { assert.ok(L[0][k] <= L[1][k] && L[1][k] <= L[2][k], k); }
    assert.equal(L[0].ribbon, false); assert.equal(L[0].dust, 0); assert.equal(L[0].shake, false); assert.equal(L[0].pop, false);
    assert.ok(L[0].sparks <= 32, 'no particles beyond a few on a Chromebook');
    assert.equal(L[1].ribbon && L[2].ribbon, true);
  });
});

describe('the ball that just scored', () => {
  test('only a CELL that grew by exactly one ball animates its newest ball', () => {
    const S = E.ShotFx; S.L = {}; S.opts.on = true; S.counts = null;
    assert.equal(S.cellsGrew('red', 3), false, 'the first look just notes how many are in there');
    assert.equal(S.cellsGrew('red', 4), true);
    assert.equal(S.cellsGrew('red', 4), false, 'a rebuild with the same balls does not');
    assert.equal(S.cellsGrew('red', 7), false, 'many at once (a robot loaded in) does not');
    assert.equal(S.cellsGrew('red', 0), false, 'a tip empties it');
    assert.equal(S.cellsGrew('red', 1), true, 'and the first ball after a tip settles too');
    assert.equal(S.cellsGrew('blue', 1), false, 'each alliance on its own');
  });
});
