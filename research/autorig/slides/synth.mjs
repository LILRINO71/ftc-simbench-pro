// Synthetic slides of other designs bolted onto a corpus chassis (mecanum-zup),
// each with its own ground truth, to check the finder beyond Into The Deep:
//   V: Viper-style vertical 3-stage (side-by-side bars, bearing blocks at the
//      junctions, a payload on the carriage, a mirror copy on the other side)
//   H: horizontal 2-stage stacked vertically, extending to the FRONT (+x),
//      intake across both copies at the front end
//   D: drawer-slide chain, vertical: 2 two-member ball slides (outer C + inner
//      member nested in it), inner of one bolted to outer of the next by
//      joiner blocks at both ends
//   T: telescoping square tubes (3 nested tubes), horizontal, extending to -x
// Parts are boxes (the finder only sees hull points anyway). Units: mm.
//   node --max-old-space-size=8192 synth.mjs
import { loadCorpus } from '../lib.mjs';
import { findSlides } from './slides.mjs';
const MODE = process.argv.includes('--rigid') ? 'rigid' : null;
const OPTS = process.env.SLIDE_OPTS ? JSON.parse(process.env.SLIDE_OPTS) : {};
let PASS = 0, RUN = 0;
process.on('exit', () => console.log(`PASS ${PASS}/${RUN}`));

const box = (lo, hi) => { const o = []; for (let i = 0; i < 8; i++) o.push([(i & 1 ? hi[0] : lo[0]) / 1000, (i & 2 ? hi[1] : lo[1]) / 1000, (i & 4 ? hi[2] : lo[2]) / 1000]); return o; };
const mirrorY = (lo, hi) => [[lo[0], -hi[1], lo[2]], [hi[0], -lo[1], hi[2]]];

function scenario(name, parts, dirWant, mode) {
  const c = loadCorpus('mecanum-zup');
  const base = c.solids.length;
  const solids = c.solids.concat(parts.map((p) => ({ name: p.name, part: null, kind: p.kind || 'metal', size: 0.3, pts: box(p.lo, p.hi) })));
  const cad = { ...c, solids };
  const R = findSlides(cad, { ...OPTS, ...((mode || MODE) ? { nested: mode || MODE } : {}) });
  RUN++;
  const res = [];
  if (R.mechanisms.length !== 1) res.push(`found ${R.mechanisms.length} mechanisms`);
  const m = R.mechanisms[0];
  if (!m) { console.log(`${name}: NOT FOUND`); return; }
  const got = new Map(); m.stages.forEach((g, k) => [...g.rails, ...(g.blocks || []), ...g.hw].forEach((i) => got.set(i, k)));
  let rOK = 0, rN = 0, hOK = 0, hN = 0; const wrong = [];
  parts.forEach((p, j) => {
    const i = base + j;
    if (p.stage == null) { if (got.has(i)) wrong.push(`${p.name} (not slide) -> stage ${got.get(i)}`); return; }
    if (p.rail || p.block) { rN++; if (got.get(i) === p.stage) rOK++; else wrong.push(`${p.name} want ${p.stage} got ${got.get(i)}`); }
    else if (p.hw) { hN++; if (got.get(i) === p.stage) hOK++; else wrong.push(`${p.name} want ${p.stage} got ${got.get(i)}`); }
  });
  const dirOK = m.dir.every((v, k) => Math.abs(v - dirWant[k]) < 1e-6);
  const nst = Math.max(...parts.filter((p) => p.stage != null).map((p) => p.stage)) + 1;
  const carriage = parts.map((p, j) => [p, base + j]).filter(([p]) => p.payload).map(([, i]) => i);
  const payOK = carriage.every((i) => m.carriageAttachments.includes(i));
  console.log(`${name.padEnd(40)} ${m.stacks.length} copies, ${m.stages.length}/${nst} stages, dir ${dirOK ? 'ok' : 'WRONG ' + m.dir}, rails ${rOK}/${rN}, end hw ${hOK}/${hN}, payload on carriage ${payOK ? 'yes' : 'NO'}, travel ${m.travel.map((v) => (v * 1000).toFixed(0)).join('+')} mm ${res.join(' ')}`);
  if (!wrong.length && dirOK && payOK && R.mechanisms.length === 1 && m.stages.length === nst) PASS++;
  for (const w of wrong) console.log('     wrong: ' + w);
  for (const j of m.stacks) for (const w of R.stacks[j].why) console.log('     why: ' + w);
}

// ---- V: Viper-style vertical 3-stage at y = +-100 ----
const V = [];
for (const sgn of [1, -1]) {
  const P = (name, lo, hi, extra) => { const [a, b] = sgn > 0 ? [lo, hi] : mirrorY(lo, hi); V.push({ name: name + (sgn > 0 ? ' L' : ' R'), lo: a, hi: b, ...extra }); };
  P('V fixed rail', [100, 88, 81], [112, 112, 481], { rail: true, stage: 0 });
  P('V stage 1', [86.5, 88, 84], [98.5, 112, 484], { rail: true, stage: 1 });
  P('V carriage', [73, 88, 87], [85, 112, 487], { rail: true, stage: 2 });
  P('V frame bracket', [112, 88, 81], [130, 112, 160], { stage: null });
  P('V bearing top fixed|1', [96, 92, 455], [102, 108, 475], { hw: true, stage: 0 });
  P('V bearing bottom fixed|1', [96, 92, 90], [102, 108, 110], { hw: true, stage: 1 });
  P('V bearing top 1|2', [82.5, 92, 458], [88.5, 108, 478], { hw: true, stage: 1 });
  P('V bearing bottom 1|2', [82.5, 92, 93], [88.5, 108, 113], { hw: true, stage: 2 });
  P('V motor', [130, 88, 85], [165, 112, 130], { kind: 'motor', stage: null });
}
V.push({ name: 'V claw across carriages', lo: [40, -112, 440], hi: [73, 112, 480], stage: null, payload: true });
scenario('V: Viper-style vertical 3-stage', V, [0, 0, 1]);

// ---- H: horizontal 2-stage, stacked vertically, extends to +x ----
const H = [];
for (const sgn of [1, -1]) {
  const P = (name, lo, hi, extra) => { const [a, b] = sgn > 0 ? [lo, hi] : mirrorY(lo, hi); H.push({ name: name + (sgn > 0 ? ' L' : ' R'), lo: a, hi: b, ...extra }); };
  P('H fixed rail', [-100, 95, 81], [150, 119, 93], { rail: true, stage: 0 });
  P('H moving rail', [-100, 95, 94.5], [150, 119, 106.5], { rail: true, stage: 1 });
  P('H block retracted end', [-95, 98, 90], [-80, 116, 98], { hw: true, stage: 1 });
  P('H block extended end', [135, 98, 90], [150, 116, 98], { hw: true, stage: 0 });
}
H.push({ name: 'H intake across both', lo: [110, -119, 106.5], hi: [150, 119, 140], stage: null, payload: true });
scenario('H: horizontal 2-stage to the front', H, [1, 0, 0]);

// ---- D: drawer-slide chain, vertical, 2 two-member units -> 3 bodies ----
const D = [];
for (const sgn of [1, -1]) {
  const P = (name, lo, hi, extra) => { const [a, b] = sgn > 0 ? [lo, hi] : mirrorY(lo, hi); D.push({ name: name + (sgn > 0 ? ' L' : ' R'), lo: a, hi: b, ...extra }); };
  // unit A (frame side): outer C 8 x 20, inner 12 x 12 nested, protruding 4 mm to -x
  P('D A outer', [22, 57, 81], [30, 77, 381], { rail: true, stage: 0 });
  P('D A inner', [18, 61, 81.5], [30, 73, 381.5], { rail: true, stage: 1 });
  // unit B, 14 mm further -x
  P('D B outer', [8, 57, 82], [16, 77, 382], { rail: true, stage: 1 });
  P('D B inner', [4, 61, 82.5], [16, 73, 382.5], { rail: true, stage: 2 });
  P('D joiner bottom', [12, 55, 90], [22, 79, 140], { hw: true, stage: 1 });
  P('D joiner top', [12, 55, 320], [22, 79, 370], { hw: true, stage: 1 });
  P('D frame bracket', [30, 57, 81], [50, 77, 200], { stage: null });
}
D.push({ name: 'D payload across inners', lo: [-30, -73, 330], hi: [4, 73, 380], stage: null, payload: true });
scenario('D: drawer-slide chain (default mode)', D, [0, 0, 1]);

// ---- T: telescoping square tubes, horizontal, extends to -x ----
const T = [
  { name: 'T outer tube', lo: [-60, -15, 81], hi: [190, 15, 111], rail: true, stage: 0 },
  { name: 'T middle tube', lo: [-70, -11, 85], hi: [180, 11, 107], rail: true, stage: 1 },
  { name: 'T inner tube', lo: [-80, -7, 89], hi: [170, 7, 103], rail: true, stage: 2 },
  { name: 'T gripper on inner', lo: [-120, -20, 85], hi: [-80, 20, 125], stage: null, payload: true },
];
scenario('T: telescoping tubes to the back (-x)', T, [-1, 0, 0]);

// ---- M: V again, but each fixed rail is bolted flat against a 48x48 U-channel upright ----
const M = V.map((p) => ({ ...p }));
M.push({ name: '1120 Series U-Channel 400mm upright L', lo: [112, 76, 81], hi: [160, 124, 481], stage: null });
M.push({ name: '1120 Series U-Channel 400mm upright R', lo: [112, -124, 81], hi: [160, -76, 481], stage: null });
scenario('M: Viper on a U-channel upright', M, [0, 0, 1]);
const Mn = M.map((p) => ({ ...p, name: 'Part' }));
scenario('M: same, all parts unnamed', Mn, [0, 0, 1]);

// ---- E: MISUMI SAR2-style drawer slides x3 joined through 15 mm extrusion blocks (gm0's
//      'attach the end of one slide to REV extrusion' build): 4 bodies, vertical ----
const Ev = [];
for (const sgn of [1, -1]) {
  const P = (name, lo, hi, extra) => { const [a, b] = sgn > 0 ? [lo, hi] : mirrorY(lo, hi); Ev.push({ name: name + (sgn > 0 ? ' L' : ' R'), lo: a, hi: b, ...extra }); };
  P('E U1 outer', [22, 57, 81], [30, 77, 381], { rail: true, stage: 0 });
  P('E U1 inner', [17.5, 61, 81.5], [30, 73, 381.5], { rail: true, stage: 1 });
  P('E join 1|2 bottom', [2.5, 59, 90], [17.5, 74, 130], { hw: true, stage: 1 });
  P('E join 1|2 top', [2.5, 59, 330], [17.5, 74, 370], { hw: true, stage: 1 });
  P('E U2 outer', [-5.5, 57, 82], [2.5, 77, 382], { rail: true, stage: 1 });
  P('E U2 inner', [-10, 61, 82.5], [2.5, 73, 382.5], { rail: true, stage: 2 });
  P('E join 2|3 bottom', [-25, 59, 90], [-10, 74, 130], { hw: true, stage: 2 });
  P('E join 2|3 top', [-25, 59, 330], [-10, 74, 370], { hw: true, stage: 2 });
  P('E U3 outer', [-33, 57, 83], [-25, 77, 383], { rail: true, stage: 2 });
  P('E U3 inner', [-37.5, 61, 83.5], [-25, 73, 383.5], { rail: true, stage: 3 });
  P('E frame bracket', [30, 57, 81], [50, 77, 200], { stage: null });
}
Ev.push({ name: 'E payload across inners', lo: [-70, -73, 340], hi: [-37.5, 73, 383.5], stage: null, payload: true });
scenario('E: SAR2 x3 via 15 mm extrusion joiners', Ev, [0, 0, 1]);

// ---- W: Viper-style stages that interlock (sections overlap 25-40%), vertical ----
const W = [];
for (const sgn of [1, -1]) {
  const P = (name, lo, hi, extra) => { const [a, b] = sgn > 0 ? [lo, hi] : mirrorY(lo, hi); W.push({ name: name + (sgn > 0 ? ' L' : ' R'), lo: a, hi: b, ...extra }); };
  P('W fixed', [100, 88, 81], [112, 112, 461], { rail: true, stage: 0 });
  P('W stage 1', [92, 90, 84], [104, 110, 464], { rail: true, stage: 1 });
  P('W stage 2', [84, 92, 87], [96, 108, 467], { rail: true, stage: 2 });
  P('W stage 3', [76, 94, 90], [88, 106, 470], { rail: true, stage: 3 });
  P('W frame bracket', [112, 88, 81], [130, 112, 160], { stage: null });
}
W.push({ name: 'W claw across carriages', lo: [40, -106, 440], hi: [76, 106, 470], stage: null, payload: true });
scenario('W: interlocking Viper-style 4-stage', W, [0, 0, 1]);

// ---- C: 2-rail slide, a short carriage block riding the moving stage (cut 3 mm into it) ----
const Cb = [
  { name: 'C fixed rail', lo: [-100, -12, 81], hi: [-76, 12, 381], rail: true, stage: 0 },
  { name: 'C stage 1', lo: [-74, -12, 101], hi: [-50, 12, 401], rail: true, stage: 1 },
  { name: 'C carriage block', lo: [-62, -20, 120], hi: [-10, 20, 170], block: true, stage: 2 },
  { name: 'C arm plate on carriage', lo: [-10, -30, 120], hi: [40, 30, 125], stage: null, payload: true },
];
scenario('C: carriage block riding stage 1', Cb, [0, 0, 1]);
// ---- N: the same, but the part cut into the stage runs 60% of its length: a bolted mount ----
const Nb = [
  { name: 'N fixed rail', lo: [-100, -12, 81], hi: [-76, 12, 381], rail: true, stage: 0 },
  { name: 'N stage 1', lo: [-74, -12, 101], hi: [-50, 12, 401], rail: true, stage: 1 },
  { name: 'N long mount', lo: [-53, -20, 200], hi: [-10, 20, 380], stage: null, payload: true },
];
scenario('N: long mount on stage 1 (no carriage)', Nb, [0, 0, 1]);

// ---- E2: as E, but each joiner is one full-length 15 mm extrusion between the slides ----
const E2 = Ev.filter((p) => !/join/.test(p.name)).map((p) => ({ ...p }));
for (const sgn of [1, -1]) {
  const P = (name, lo, hi, extra) => { const [a, b] = sgn > 0 ? [lo, hi] : mirrorY(lo, hi); E2.push({ name: name + (sgn > 0 ? ' L' : ' R'), lo: a, hi: b, ...extra }); };
  P('E2 extrusion 1|2', [2.5, 59.5, 81.5], [17.5, 74.5, 381.5], { rail: true, stage: 1 });
  P('E2 extrusion 2|3', [-25, 59.5, 82.5], [-10, 74.5, 382.5], { rail: true, stage: 2 });
}
scenario('E2: SAR2 x3 via full-length 15 mm extrusions', E2, [0, 0, 1]);
