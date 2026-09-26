// Robustness checks: the same Into The Deep robot perturbed in ways a
// different team's CAD would differ, scored against the (equally perturbed)
// truth. Also false-positive traps on corpus robots.
//   node --max-old-space-size=8192 stress.mjs
import { loadITD, loadCorpus } from '../lib.mjs';
import { findSlides } from './slides.mjs';

const { cad: base, truth } = loadITD();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cen = (s) => [0, 1, 2].map((k) => s.pts.reduce((a, p) => a + p[k], 0) / s.pts.length);
const occ = new Map(); for (const o of base.occs) if (o.solid >= 0 && !occ.has(o.solid)) occ.set(o.solid, o);
const path = (i) => { const o = occ.get(i); return o ? o.path.map((p) => p.n).concat(o.name || '').join('/') : base.solids[i].name; };
const hand = (i) => truth.solids[i].mech || 'FRAME';
const SLIDES = [
  { name: 'lift', uni: /(^|\/)(Left|Right) SAR 230\//, not: /2 stage/, order: ['FRAME', 'lift stage 2', 'lift stage 3', 'lift'], axis: [0, 0, 1] },
  { name: 'extend', uni: /(^|\/)2 stage (Left|Right) SAR 230\//, not: null, order: ['FRAME', 'extend'], axis: [-1, 0, 0] },
];
for (const SL of SLIDES) {
  SL.U = []; for (let i = 0; i < base.solids.length; i++) { const p = path(i); if (SL.uni.test(p) && !(SL.not && SL.not.test(p))) SL.U.push(i); }
  SL.rail = new Set(SL.U.filter((i) => /\/SAR2XX\//.test(path(i))));
  const tmid = SL.U.reduce((a, i) => a + dot(cen(base.solids[i]), SL.axis), 0) / SL.U.length;
  SL.phys = new Map();
  for (const i of SL.U) { const u = SL.order.indexOf(hand(i));
    SL.phys.set(i, SL.rail.has(i) ? (/inslide$/.test(path(i)) ? u + 1 : u) : (dot(cen(base.solids[i]), SL.axis) < tmid ? u : u + 1)); }
  SL.hand = new Map(SL.U.map((i) => [i, SL.order.indexOf(hand(i))]));
}
const clone = (cad, f) => ({ ...cad, solids: cad.solids.map((s, i) => ({ ...s, pts: s.pts.map((p) => f(p, i)) })) });
const rotZ = (deg) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return (p) => [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]; };

// score: for each slide, fraction of its parts whose stage index (fixed outward) matches
function check(cad, label, mode, axisOf = (a) => a, keep = null) {
  const R = findSlides(cad, { nested: mode });
  const parts = [];
  for (const SL of SLIDES) {
    const T = mode === 'rigid' ? SL.hand : SL.phys;
    const U = keep ? SL.U.filter(keep) : SL.U;
    let best = -1, bn = 0;
    R.mechanisms.forEach((m, k) => { const n = m.stages.flatMap((g) => g.rails).filter((i) => SL.rail.has(i)).length; if (n > bn) { bn = n; best = k; } });
    if (best < 0) { parts.push(`${SL.name}: NOT FOUND`); continue; }
    const m = R.mechanisms[best], st = new Map();
    m.stages.forEach((g, k) => g.rails.concat(g.hw).forEach((i) => st.set(i, k)));
    const rails = U.filter((i) => SL.rail.has(i)), hw = U.filter((i) => !SL.rail.has(i));
    const ok = (arr) => arr.filter((i) => st.get(i) === T.get(i)).length;
    const extra = [...st.keys()].filter((i) => !SL.U.includes(i)).length;
    const want = axisOf(SL.axis), dirOK = dot(m.dir, want) > 0.99;
    parts.push(`${SL.name}: ${m.stacks.length} copies, ${m.stages.length} stages, dir ${dirOK ? 'ok' : 'WRONG ' + m.dir.map((v) => v.toFixed(2))}, rails ${ok(rails)}/${rails.length}, hw ${ok(hw)}/${hw.length}, +${extra} other parts`);
  }
  const fp = R.mechanisms.length - SLIDES.filter((SL) => R.mechanisms.some((m) => m.stages.some((g) => g.rails.some((i) => SL.rail.has(i))))).length;
  console.log(`${label.padEnd(44)} [${mode}] ${parts.join(' | ')} | FP ${fp}`);
  return R;
}

for (const mode of ['rigid', 'slide']) {
  console.log(`\n--- mode ${mode} ---`);
  check(base, 'as drawn', mode);
  // turned about the vertical: slides no longer square to the robot axes
  for (const deg of [30, 90, 137]) {
    const f = rotZ(deg);
    check(clone(base, f), `whole robot turned ${deg} deg about z`, mode, (a) => f(a));
  }
  // drawn extended: stage u of the lift up by u*60 mm, the extend moving stage out 120 mm, with
  // everything riding them (payload joints follow their parents)
  {
    const parentOf = new Map(truth.mechs.map((m) => [m.id, m.parent]));
    const rides = (i, id) => { let j = truth.solids[i].mech; while (j && j !== 'chassis') { if (j === id) return true; j = parentOf.get(j); } return false; };
    const shift = (mode === 'rigid')
      ? (i) => {
        if (SLIDES[0].U.includes(i)) return [0, 0, 0.06 * SLIDES[0].hand.get(i)];
        if (SLIDES[1].U.includes(i)) return [-0.12 * SLIDES[1].hand.get(i), 0, 0];
        if (rides(i, 'lift')) return [0, 0, 0.18];
        if (rides(i, 'extend')) return [-0.12, 0, 0];
        return [0, 0, 0];
      }
      : (i) => {
        if (SLIDES[0].U.includes(i)) return [0, 0, 0.05 * SLIDES[0].phys.get(i)];
        if (SLIDES[1].U.includes(i)) return [-0.06 * SLIDES[1].phys.get(i), 0, 0];
        if (rides(i, 'lift')) return [0, 0, 0.20];
        if (rides(i, 'extend')) return [-0.12, 0, 0];
        return [0, 0, 0];
      };
    check(clone(base, (p, i) => { const d = shift(i); return [p[0] + d[0], p[1] + d[1], p[2] + d[2]]; }), 'drawn part-way extended', mode);
  }
  // no names: every part is plain 'metal' with no part number (kind comes from names)
  check({ ...base, solids: base.solids.map((s, i) => ({ ...s, name: 'Part ' + i, part: null, kind: 'metal' })) }, 'names stripped (every kind = metal)', mode);
  // one side of each slide deleted (a single slide, no mirror copy)
  {
    const gone = new Set(); for (const SL of SLIDES) for (const i of SL.U) if (cen(base.solids[i])[1] < 0) gone.add(i);
    check({ ...base, solids: base.solids.map((s, i) => (gone.has(i) ? { ...s, pts: [[50, 50, 50], [50.01, 50, 50], [50, 50.01, 50], [50, 50, 50.01]] } : s)) }, 'right-hand slides removed', mode, (a) => a, (i) => !gone.has(i));
  }
}

// false-positive traps on a corpus robot
console.log('\n--- false-positive traps (mecanum-zup + added parts) ---');
const box = (c, h) => { const o = []; for (let i = 0; i < 8; i++) o.push([c[0] + (i & 1 ? h[0] : -h[0]), c[1] + (i & 2 ? h[1] : -h[1]), c[2] + (i & 4 ? h[2] : -h[2])]); return o; };
const trap = (label, extra) => {
  const c = loadCorpus('mecanum-zup');
  const cad = { ...c, solids: c.solids.concat(extra.map((e) => ({ name: e.name, part: null, kind: e.kind || 'metal', size: 0.4, pts: e.pts }))) };
  const R = findSlides(cad);
  console.log(`${label.padEnd(58)} -> ${R.mechanisms.length} slide mechanisms ${R.mechanisms.map((m) => '[' + m.stages.map((g) => g.rails.map((i) => cad.solids[i].name).join('+')).join(' | ') + ']').join(' ')}`);
};
trap('two U-channels bolted face to face (doubled frame rail)', [
  { name: 'U-Channel A', pts: box([0, 0.08, 0.10], [0.20, 0.024, 0.024]) },
  { name: 'U-Channel B', pts: box([0, 0.08, 0.148], [0.20, 0.024, 0.024]) }]);
trap('two flat beams 11 mm apart (a two-bar arm)', [
  { name: 'Beam A', pts: box([0, 0, 0.30], [0.12, 0.004, 0.003]) },
  { name: 'Beam B', pts: box([0, 0.011, 0.30], [0.12, 0.004, 0.003]) }]);
trap('square tube inside a bigger tube (telescoping, 2 mm clearance)', [
  { name: 'Tube outer', pts: box([0.05, 0, 0.25], [0.012, 0.012, 0.15]) },
  { name: 'Tube inner', pts: box([0.05, 0, 0.27], [0.008, 0.008, 0.15]) }]);
trap('three bars side by side, 2 mm gaps (Viper-style 3-stage)', [
  { name: 'Bar 1', pts: box([-0.10, 0.00, 0.25], [0.008, 0.012, 0.18]) },
  { name: 'Bar 2', pts: box([-0.082, 0.00, 0.25], [0.008, 0.012, 0.18]) },
  { name: 'Bar 3', pts: box([-0.064, 0.00, 0.25], [0.008, 0.012, 0.18]) }]);
