// Measures carry.mjs against the hand-written Into The Deep joint spec (and the
// synthetic `mated` robot's Onshape mates), and runs phantom-joint leak tests.
//   node --max-old-space-size=8192 eval.mjs [--quiet]
import { loadITD, loadCorpus, E, centroid, REPO } from '../lib.mjs';
import { inferCarry, contactGraph, railness } from './carry.mjs';
import { jointsOf, seedsOf, score, print, pct } from './evallib.mjs';
import { buildRobot } from '../../../tools/stepgen.mjs';
import fs from 'node:fs';

const quiet = process.argv.includes('--quiet');
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// ---------------- Into The Deep ----------------
const { cad, truth } = loadITD();
const joints = jointsOf(truth), seeds = seedsOf(truth, joints);
const truthLabel = truth.solids.map((s) => s.mech ?? null);
if (!quiet) console.log('seeds:', Object.entries(seeds).map(([k, v]) => `${k}:[${v.join(',')}]`).join('  '));

const results = {};
const baseline = (lab, name) => { const r = score(cad, truthLabel, lab, joints, seeds, name); print(r, false); return r; };
baseline(new Array(cad.solids.length).fill(null), 'baseline: everything frame');
{ const lab = new Array(cad.solids.length).fill(null); for (const [id, L] of Object.entries(seeds)) for (const i of L) lab[i] = id; baseline(lab, 'baseline: seeds only'); }

{ // the view's legacy rule (src/tessellate.js mechOwner): nearest link segment pivot -> distal point,
  // with the distal point taken from the seeds (all a spec-less bench would know), wheels kept on the frame
  const mean = (P) => P.reduce((a, p) => a.map((v, k) => v + p[k] / P.length), [0, 0, 0]);
  const kids = (id) => joints.filter((j) => j.parent === id);
  const sub3 = (id) => [id, ...kids(id).flatMap((k) => sub3(k.id))];
  const seg = joints.map((j) => { const pts = sub3(j.id).flatMap((id) => seeds[id].map((i) => centroid(cad.solids[i]))); const d = pts.length ? mean(pts) : j.pivot; return { j, a: j.pivot, b: d, lever: norm(sub(d, j.pivot)) }; });
  const dseg = (p, a, b) => { const ab = sub(b, a), L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; let t = 0; if (L2 > 1e-12) t = Math.max(0, Math.min(1, (sub(p, a)[0] * ab[0] + sub(p, a)[1] * ab[1] + sub(p, a)[2] * ab[2]) / L2)); return norm(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])); };
  const lab = cad.solids.map((s, i) => {
    if (s.kind === 'wheel') return null;
    const c = centroid(s); let best = null, bd = 1e9; for (const g of seg) { const d = dseg(c, g.a, g.b); if (d < bd) { bd = d; best = g; } }
    let id = best.j.id; if (!kids(id).length && best.lever > 0 && bd > best.lever * 0.55 && best.j.parent !== 'chassis') id = best.j.parent;
    return id;
  });
  for (const [id, L] of Object.entries(seeds)) for (const i of L) lab[i] = id;
  baseline(lab, 'baseline: legacy nearest-link rule (every part rides the nearest joint segment)');
}
let t0 = performance.now();
const G = contactGraph(cad, {});
const tGraph = performance.now() - t0;
console.log(`\ncontact graph: ${G.edges.length} edges (${G.edges.filter((e) => e.strong).length} strong) in ${tGraph.toFixed(0)} ms`);
for (const method of ['subasm', 'nearest', 'contact', 'combined']) {
  t0 = performance.now();
  const out = inferCarry(cad, joints, seeds, { method, graph: G });
  const ms = performance.now() - t0;
  const r = score(cad, truthLabel, out.label, joints, seeds, `${method}  (assign ${ms.toFixed(0)} ms + graph ${tGraph.toFixed(0)} ms)`);
  print(r); results[method] = { r, out };
}
export { results, joints, seeds, truthLabel, cad, G };
if (process.argv.includes('--errors')) {
  const m = process.argv[process.argv.indexOf('--errors') + 1] || 'combined';
  const lab = results[m].out.label;
  console.log(`\n--- ${m} errors (truth -> predicted)`);
  cad.solids.forEach((s, i) => { if ((truthLabel[i] ?? null) !== (lab[i] ?? null)) console.log(`  ${i} ${s.kind.padEnd(10)} ${s.name.slice(0, 34).padEnd(34)} ${String(truthLabel[i] ?? 'frame').padEnd(14)} -> ${lab[i] ?? 'frame'}   @${centroid(s).map((v) => (v * 1000).toFixed(0)).join(',')}`); });
}

// ---------------- second truth source and false positives ----------------
{ // the synthetic `mated` robot: Onshape mates are its truth
  const R = buildRobot('mated');
  const mc = E.parseSTEP(R.text), mt = E.parseSTEP(R.text);
  E.applyOnshapeMates(mt, R.onshape.assembly, { features: R.onshape.features });
  const MJ = jointsOf(mt), MS = seedsOf(mt, MJ), MT = mt.solids.map((s) => s.mech ?? null);
  console.log(`\n=== synthetic 'mated' robot (${mc.solids.length} parts, ${MJ.length} joints, truth from its Onshape mates)`);
  for (const m of ['subasm', 'nearest', 'contact', 'combined']) {
    const r = score(mc, MT, inferCarry(mc, MJ, MS, { method: m }).label, MJ, MS, m);
    console.log(`  ${m.padEnd(9)} all ${pct(r.all.acc)} (${r.all.ok}/${r.all.all})  moving non-seed ${r.micro.tp}/${r.micro.tt} right, ${r.micro.pp - r.micro.tp} wrong-moving, frame parts put on a joint ${r.falseMoving.all}`);
  }
}
{ // corpus drivetrains with no mechanism: nothing may move
  const names = fs.readdirSync(REPO + 'tests/fixtures/robots').map((f) => f.replace('.json', ''));
  let moved = 0, parts = 0;
  for (const nm of names) { const c = loadCorpus(nm); parts += c.solids.length; moved += inferCarry(c, [], {}, { method: 'combined' }).label.filter((l) => l != null).length; }
  console.log(`\n=== corpus, ${names.length} robots with no joints (${parts} parts): ${moved} parts put on a joint`);
}
console.log('\nmore: posetest.mjs (13 re-posed configurations), robust.mjs (seeds, noise, parameters, ablations, metadata removed), leak.mjs (phantom joints), timing.mjs, subasm_stats.mjs');
