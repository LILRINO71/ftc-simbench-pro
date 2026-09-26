// False-positive checks for the carry step: phantom joints seeded on frame parts should carry
// (almost) nothing; the synthetic corpus with no joints should put nothing on a joint; and the
// synthetic `mated` robot (Onshape mates = truth) should come out right.
import { loadITD, loadCorpus, E, centroid, REPO } from '../lib.mjs';
import { inferCarry, contactGraph, railness } from './carry.mjs';
import { jointsOf, seedsOf, score, print, pct } from './evallib.mjs';
import { buildRobot } from '../../../tools/stepgen.mjs';
import fs from 'node:fs';
const tolArg = process.argv.includes('--tol') ? +process.argv[process.argv.indexOf('--tol') + 1] : 0.001;
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function pcaAxes(pts) {
  const c = pts.reduce((a, p) => a.map((v, k) => v + p[k] / pts.length), [0, 0, 0]);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of pts) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (p[a] - c[a]) * (p[b] - c[b]);
  const A = C.map((r) => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sw = 0; sw < 40; sw++) for (let p = 0; p < 3; p++) for (let r = p + 1; r < 3; r++) { if (Math.abs(A[p][r]) < 1e-18) continue; const th = 0.5 * Math.atan2(2 * A[p][r], A[r][r] - A[p][p]), co = Math.cos(th), si = Math.sin(th); for (let k = 0; k < 3; k++) { const x = A[k][p], y = A[k][r]; A[k][p] = co * x - si * y; A[k][r] = si * x + co * y; } for (let k = 0; k < 3; k++) { const x = A[p][k], y = A[r][k]; A[p][k] = co * x - si * y; A[r][k] = si * x + co * y; } for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][r]; V[k][p] = co * x - si * y; V[k][r] = si * x + co * y; } }
  return { c, axes: [0, 1, 2].map((i) => ({ val: A[i][i], vec: [V[0][i], V[1][i], V[2][i]] })).sort((a, b) => b.val - a.val).map((e) => e.vec) };
}

// ---- 1. phantom joints on Into The Deep frame parts (real joints kept)
{
  const { cad, truth } = loadITD();
  const J0 = jointsOf(truth), S0 = seedsOf(truth, J0), T = truth.solids.map((s) => s.mech ?? null);
  const G = contactGraph(cad, { tol: tolArg });
  const base = inferCarry(cad, J0, S0, { method: 'combined', graph: G, tol: tolArg });
  const baseAcc = score(cad, T, base.label, J0, S0, '').all.acc;
  const frameParts = cad.solids.map((s, i) => i).filter((i) => T[i] == null && cad.solids[i].kind !== 'wheel' && cad.solids[i].kind !== 'fastener');
  for (const kind of ['revolute', 'linear']) {
    const extra = [], dAcc = [], worst = [];
    for (let t = 0; t < 80; t++) {
      const p = frameParts[Math.floor(rnd() * frameParts.length)];
      const { c, axes } = pcaAxes(cad.solids[p].pts);
      const axis = kind === 'linear' ? axes[0] : axes[Math.floor(rnd() * 3)];
      const J = J0.concat([{ id: 'PHANTOM', kind: kind === 'linear' ? 'linear' : 'revolute-lift', axis, pivot: c, parent: 'chassis', couple: null }]);
      const S = { ...S0, PHANTOM: [p] };
      const o = inferCarry(cad, J, S, { method: 'combined', graph: G, tol: tolArg });
      const got = o.members.PHANTOM.length - 1; extra.push(got);
      const lab = o.label.map((l) => (l === 'PHANTOM' ? null : l));
      dAcc.push(baseAcc - score(cad, T, lab, J0, S0, '').all.acc);
      worst.push([got, p, cad.solids[p].name.slice(0, 30)]);
    }
    worst.sort((a, b) => b[0] - a[0]);
    console.log(`ITD phantom ${kind} joint on a random frame part (80 trials): extra parts carried median ${q(extra, 0.5)}, p90 ${q(extra, 0.9)}, max ${Math.max(...extra)}, zero in ${extra.filter((x) => x === 0).length}/80; real-joint accuracy change mean ${(100 * dAcc.reduce((a, b) => a + b, 0) / dAcc.length).toFixed(2)} pts`);
    console.log('   worst:', worst.slice(0, 4).map((w) => `${w[0]} from #${w[1]} ${w[2]}`).join(' | '));
  }
}

// ---- 2. corpus robots: no joints -> nothing moves; phantom joints on each structural part
const names = fs.readdirSync(REPO + 'tests/fixtures/robots').map((f) => f.replace('.json', ''));
for (const nm of names) {
  const cad = loadCorpus(nm);
  const t0 = performance.now();
  const none = inferCarry(cad, [], {}, { method: 'combined', tol: tolArg, returnGraph: true });
  const ms = performance.now() - t0;
  const moved = none.label.filter((l) => l != null).length;
  const G = none.graph;
  const extra = [];
  const struct = cad.solids.map((s, i) => i).filter((i) => cad.solids[i].kind !== 'fastener' && cad.solids[i].kind !== 'wheel');
  for (const p of struct.slice(0, 60)) for (const kind of ['revolute', 'linear']) {
    const { c, axes } = pcaAxes(cad.solids[p].pts);
    const J = [{ id: 'P', kind: kind === 'linear' ? 'linear' : 'revolute-lift', axis: kind === 'linear' ? axes[0] : axes[2], pivot: c, parent: 'chassis', couple: null }];
    const o = inferCarry(cad, J, { P: [p] }, { method: 'combined', graph: G, tol: tolArg });
    extra.push(o.members.P.length - 1);
  }
  console.log(`corpus ${nm.padEnd(16)} ${String(cad.solids.length).padStart(5)} parts, ${String(G.edges.length).padStart(5)} contacts, ${ms.toFixed(0).padStart(4)} ms; no joints -> ${moved} parts moved; phantom joint on each structural part: extra carried mean ${(extra.reduce((a, b) => a + b, 0) / Math.max(1, extra.length)).toFixed(2)}, max ${Math.max(0, ...extra)} (of ${extra.length} phantoms)`);
}

// ---- 3. the synthetic `mated` robot: Onshape mates give the truth
{
  const R = buildRobot('mated');
  const cad = E.parseSTEP(R.text), truth = E.parseSTEP(R.text);
  E.applyOnshapeMates(truth, R.onshape.assembly, { features: R.onshape.features });
  const J = jointsOf(truth), S = seedsOf(truth, J), T = truth.solids.map((s) => s.mech ?? null);
  console.log('\nmated robot joints:', J.map((j) => `${j.id}(${j.kind}, parent ${j.parent})`).join('; '));
  console.log('seeds:', Object.entries(S).map(([k, v]) => `${k}:[${v.map((i) => cad.solids[i].name).join(',')}]`).join('  '));
  for (const m of ['subasm', 'nearest', 'contact', 'combined']) {
    const o = inferCarry(cad, J, S, { method: m, tol: tolArg });
    const r = score(cad, T, o.label, J, S, `mated robot, ${cad.solids.length} parts [${m}]`); print(r, m === 'combined');
    if (m === 'combined') cad.solids.forEach((s, i) => { if ((T[i] ?? null) !== (o.label[i] ?? null)) console.log(`   wrong: ${s.name} ${T[i] ?? 'frame'} -> ${o.label[i] ?? 'frame'}`); });
  }
}
