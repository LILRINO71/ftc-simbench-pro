// Field.startPose: every start the app offers (centre, left, right, both alliances) has to be a
// legal one under G304: against the alliance wall, on its own side, clear of the LOADING ZONE and
// of the FLOWER on that wall. "left" and "right" were a whole tile along the wall, which is
// exactly where the LOADING ZONE and the FLOWER are: an 18 in robot started 8.6 in inside one or
// 4.8 in inside the other, while the auto grader (src/grader.js) called the same pose a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithField } from './load.mjs';

const E = loadWithField();
const IN = 0.0254;
const D = E.Field.data.field;
const CLEAR_IN = 0.25;                                  // START_CLEAR_IN in src/field.js
const ROBOTS = {
  '18 in square': { hx: 9 * IN, hy: 9 * IN, ox: 0, oy: 0, h: 0.4 },
  '14 x 17 in': { hx: 7 * IN, hy: 8.5 * IN, ox: 0, oy: 0, h: 0.4 },
  'box off the drive centre': { hx: 9 * IN, hy: 8 * IN, ox: 0.05, oy: -0.03, h: 0.4 },
};
// the box a pose puts on the field: its centre and half extents (the starts face +x or -x)
const boxOf = (p, fp) => { const c = Math.cos(p.h), s = Math.sin(p.h); return { x: p.x + fp.ox * c - fp.oy * s, y: p.y + fp.ox * s + fp.oy * c, ex: fp.hx, ey: fp.hy }; };
const overlap = (b, x0, x1, y0, y1) => b.x + b.ex > x0 && b.x - b.ex < x1 && b.y + b.ey > y0 && b.y - b.ey < y1;
const flowerBox = (fl) => { const alongX = fl.wall === '+y' || fl.wall === '-y', ex = (alongX ? fl.alongWall : fl.depth) / 2 * IN, ey = (alongX ? fl.depth : fl.alongWall) / 2 * IN;
  return [fl.x * IN - ex, fl.x * IN + ex, fl.y * IN - ey, fl.y * IN + ey]; };

for (const [name, fp] of Object.entries(ROBOTS)) for (const al of ['red', 'blue']) for (const slot of ['centre', 'left', 'right']) {
  test(`start pose: ${al} ${slot}, ${name}: against the wall, own side, clear of the LOADING ZONE and the FLOWERs`, () => {
    const p = E.Field.startPose(al, fp, slot), b = boxOf(p, fp), H = E.Field.half(), s = al === 'blue' ? 1 : -1;
    assert.ok(Math.abs(Math.abs(b.x) + b.ex - H) < 1e-9, 'touches the alliance wall');
    assert.equal(Math.sign(b.x), s, 'on its own side');
    assert.ok(Math.abs(b.y) + b.ey <= H, 'inside the field');
    const z = D.loadingZones[al];
    assert.ok(!overlap(b, z.x0 * IN, z.x1 * IN, z.y0 * IN, z.y1 * IN), `in the LOADING ZONE: box y ${((b.y - b.ey) / IN).toFixed(1)}..${((b.y + b.ey) / IN).toFixed(1)} in, zone ${z.y0}..${z.y1}`);
    for (const fl of D.flowers) assert.ok(!overlap(b, ...flowerBox(fl)), `touches the FLOWER at ${fl.x}, ${fl.y}: box y ${((b.y - b.ey) / IN).toFixed(1)}..${((b.y + b.ey) / IN).toFixed(1)} in`);
    // and no robot standing there is pushed by the field's own obstacles
    assert.equal(E.Field.collide({ x: p.x, y: p.y, h: p.h }, fp, E.Field.obstacles(fp.h)), null, 'the field pushes it: it started inside something');
  });
}

test('start pose: left and right are still different places, on the side their name says', () => {
  const fp = ROBOTS['18 in square'];
  for (const al of ['red', 'blue']) {
    const c = E.Field.startPose(al, fp, 'centre'), l = E.Field.startPose(al, fp, 'left'), r = E.Field.startPose(al, fp, 'right');
    const left = al === 'red' ? 1 : -1;                    // red's drivers face +x: their left is +y
    assert.equal(c.y, 0);
    assert.ok((l.y - c.y) * left > 8 * IN, `${al} left is at least 8 in to the left (${(l.y / IN).toFixed(2)} in)`);
    assert.ok((r.y - c.y) * left < -8 * IN, `${al} right is at least 8 in to the right (${(r.y / IN).toFixed(2)} in)`);
  }
});

test('start pose: the auto grader agrees every offered start is legal', () => {
  const fp = ROBOTS['18 in square'], obs = E.Field.obstacles(fp.h);
  for (const al of ['red', 'blue']) for (const slot of ['centre', 'left', 'right']) {
    const p = E.Field.startPose(al, fp, slot), P = E.fieldToPedro(p), ahead = al === 'red' ? 12 : -12;
    // one short leg straight off the wall: the grader wants a path to grade
    const g = E.gradePath({ start: { x: P.x, y: P.y, h: P.h }, legs: [{ to: { x: P.x + ahead, y: P.y, h: P.h }, ctrl: [], heading: 'linear', reversed: false, wait: 0 }] }, { fp, field: D, obs });
    const start = g.items.find((i) => i.key === 'start');
    assert.ok(start, 'the grader checks the start');
    assert.equal(start.sev, 'pass', `${al} ${slot}: ${start.text}`);
  }
});

test('start pose: left goes as far toward the LOADING ZONE as stays legal, and no farther', () => {
  const fp = ROBOTS['18 in square'], z = D.loadingZones.red;
  const l = E.Field.startPose('red', fp, 'left');
  const edge = l.y + fp.hy, room = z.y0 * IN - edge;           // from the box's far edge to the zone
  assert.ok(room >= CLEAR_IN * IN - 1e-9, `keeps ${CLEAR_IN} in clear: ${(room / IN).toFixed(2)} in`);
  assert.ok(room < (CLEAR_IN + 0.25) * IN + 1e-9, `and stops within a quarter inch of that: ${(room / IN).toFixed(2)} in`);
});
