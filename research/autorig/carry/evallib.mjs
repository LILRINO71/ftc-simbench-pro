// Shared scoring helpers for the carry study.
import { centroid } from '../lib.mjs';
import { railness } from './carry.mjs';
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/* joints as the task gives them: id, kind, axis, pivot, parent, couple */
export function jointsOf(truth) {
  return truth.mechs.filter((m) => !m.drive).map((m) => ({ id: m.id, kind: m.kind, axis: m.axis, pivot: m.pivot, parent: m.parent || 'chassis', couple: m.couple ? { to: m.couple.to, ratio: m.couple.ratio } : null }));
}
/* seeds: the single truth part nearest the pivot; for a slide, its moving rails */
export function seedsOf(truth, joints) {
  const S = truth.solids, seeds = {};
  for (const j of joints) {
    const mem = S.map((s, i) => i).filter((i) => S[i].mech === j.id);
    if (!mem.length) { seeds[j.id] = []; continue; }
    if (j.kind === 'linear') {
      const R = mem.map((i) => ({ i, ...railness(S[i].pts, j.axis) }));
      const L = Math.max(...R.map((r) => r.len));
      const rails = R.filter((r) => r.len >= 0.05 && r.ratio >= 3 && r.len >= 0.8 * L).map((r) => r.i);
      if (rails.length) { seeds[j.id] = rails; continue; }
    }
    seeds[j.id] = [mem.reduce((a, b) => (norm(sub(centroid(S[a]), j.pivot)) <= norm(sub(centroid(S[b]), j.pivot)) ? a : b))];
  }
  return seeds;
}

export function score(cad, truthLabel, pred, joints, seeds, name) {
  const n = cad.solids.length, seedSet = new Set(Object.values(seeds).flat());
  const kindOf = (i) => (cad.solids[i].kind === 'fastener' ? 'fastener' : cad.solids[i].kind === 'wheel' ? 'wheel' : 'structural');
  const per = {};
  for (const j of joints) {
    const T = new Set(), P = new Set();
    for (let i = 0; i < n; i++) { if (truthLabel[i] === j.id) T.add(i); if (pred[i] === j.id) P.add(i); }
    let tp = 0; for (const i of P) if (T.has(i)) tp++;
    // the same without seeds and without fasteners
    const Ts = [...T].filter((i) => !seedSet.has(i) && kindOf(i) === 'structural'), Ps = [...P].filter((i) => !seedSet.has(i) && kindOf(i) === 'structural');
    const tps = Ps.filter((i) => T.has(i)).length;
    const Tf = [...T].filter((i) => kindOf(i) === 'fastener'), Pf = [...P].filter((i) => kindOf(i) === 'fastener'), tpf = Pf.filter((i) => T.has(i)).length;
    per[j.id] = { T: T.size, P: P.size, tp, prec: P.size ? tp / P.size : 1, rec: T.size ? tp / T.size : 1, seeds: (seeds[j.id] || []).length,
      Ts: Ts.length, Ps: Ps.length, tps, Tf: Tf.length, Pf: Pf.length, tpf };
  }
  const acc = (filter) => { let ok = 0, all = 0; for (let i = 0; i < n; i++) { if (!filter(i)) continue; all++; if ((truthLabel[i] ?? null) === (pred[i] ?? null)) ok++; } return { ok, all, acc: all ? ok / all : 1 }; };
  const moving = (i) => truthLabel[i] != null;
  const res = {
    name,
    all: acc(() => true),
    structural: acc((i) => kindOf(i) === 'structural'),
    fastener: acc((i) => kindOf(i) === 'fastener'),
    nonSeedStructural: acc((i) => kindOf(i) === 'structural' && !seedSet.has(i)),
    movingStructural: acc((i) => kindOf(i) === 'structural' && moving(i) && !seedSet.has(i)),
    falseMoving: (() => { let c = 0, cs = 0; for (let i = 0; i < n; i++) if (truthLabel[i] == null && pred[i] != null) { c++; if (kindOf(i) === 'structural') cs++; } return { all: c, structural: cs }; })(),
    per,
  };
  // micro precision/recall over moving assignments, excluding seeds
  let tp = 0, pp = 0, tt = 0;
  for (let i = 0; i < n; i++) { if (seedSet.has(i)) continue; if (pred[i] != null) pp++; if (truthLabel[i] != null) tt++; if (pred[i] != null && pred[i] === truthLabel[i]) tp++; }
  res.micro = { prec: pp ? tp / pp : 1, rec: tt ? tp / tt : 1, tp, pp, tt };
  return res;
}
export const pct = (x) => (100 * x).toFixed(1).padStart(5) + '%';
export function print(r, detail = true) {
  console.log(`\n=== ${r.name}`);
  console.log(`  label accuracy  all ${pct(r.all.acc)} (${r.all.ok}/${r.all.all})  structural ${pct(r.structural.acc)} (${r.structural.ok}/${r.structural.all})  fasteners ${pct(r.fastener.acc)} (${r.fastener.ok}/${r.fastener.all})`);
  console.log(`  non-seed structural ${pct(r.nonSeedStructural.acc)} (${r.nonSeedStructural.ok}/${r.nonSeedStructural.all})   moving non-seed structural (recall of label) ${pct(r.movingStructural.acc)} (${r.movingStructural.ok}/${r.movingStructural.all})   frame parts put on a joint: ${r.falseMoving.all} (${r.falseMoving.structural} structural)`);
  console.log(`  micro (non-seed, all kinds) prec ${pct(r.micro.prec)} rec ${pct(r.micro.rec)}  [tp ${r.micro.tp}, predicted ${r.micro.pp}, truth ${r.micro.tt}]`);
  if (!detail) return;
  console.log('  joint             truth pred  prec   rec  | structural non-seed tp/truth/pred | fasteners tp/truth/pred');
  for (const [id, p] of Object.entries(r.per)) console.log(`  ${id.padEnd(16)} ${String(p.T).padStart(5)} ${String(p.P).padStart(4)} ${pct(p.prec)} ${pct(p.rec)} | ${p.tps}/${p.Ts}/${p.Ps}`.padEnd(95) + `| ${p.tpf}/${p.Tf}/${p.Pf}`);
}

