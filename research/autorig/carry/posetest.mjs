// Pose invariance: re-pose Into The Deep by its truth joints and run the carry step again.
//   node --max-old-space-size=8192 posetest.mjs [--errors]
import { loadITD } from '../lib.mjs';
import { inferCarry, contactGraph } from './carry.mjs';
import { jointsOf, seedsOf, score, pct } from './evallib.mjs';
import { poseRobot } from './pose.mjs';
const { cad, truth } = loadITD();
const J0 = jointsOf(truth), S0 = seedsOf(truth, J0), T = truth.solids.map((s) => s.mech ?? null);
const D = Math.PI / 180;
const intake = { 'crank R': -50 * D, 'crank L': -50 * D, inY: 25 * D, inPiv: -25 * D, inX: 30 * D, inClaw: -20 * D };
const outtake = { lift: 0.35, arm: -60 * D, outRot: 30 * D, outClaw: 15 * D };
const poses = [
  ['drawn (as the CAD is)', null],
  ['drawn-pose fixes only (crank L unfolded)', {}],
  ['lift up 0.15 m', { lift: 0.15 }],
  ['lift up 0.5 m', { lift: 0.5 }],
  ['outtake: lift 0.35, arm -60, wrist 30, claw 15 deg', outtake],
  ['intake out: cranks -50 deg, wrist/twist/claw moved', intake],
  ['everything moved', { ...outtake, ...intake }],
];
let seed = 99; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
for (let k = 0; k < 6; k++) { const cr = -(20 + 60 * rnd()) * D; poses.push([`random #${k + 1}`, { lift: 0.6 * rnd(), arm: -(90 * rnd()) * D, outRot: (rnd() - 0.5) * 90 * D, outClaw: 25 * rnd() * D, 'crank R': cr, 'crank L': cr, inY: (rnd() - 0.5) * 60 * D, inPiv: (rnd() - 0.5) * 60 * D, inX: (rnd() - 0.5) * 90 * D, inClaw: -40 * rnd() * D }]); }
const G0 = contactGraph(cad, {}), key = (e) => e.a + ',' + e.b, drawnEdges = new Set(G0.edges.map(key));
const agg = { contact: [], combined: [], subasm: [], nearest: [] };
for (const [name, drv] of poses) {
  const P = drv ? poseRobot(cad, truth, J0, drv) : { cad, joints: J0 };
  const t0 = performance.now(); const G = drv ? contactGraph(P.cad, {}) : G0; const tg = performance.now() - t0;
  const fresh = G.edges.filter((e) => !drawnEdges.has(key(e)) && T[e.a] !== T[e.b] && e.strong).length;
  const row = [];
  for (const m of ['combined', 'contact', 'subasm', 'nearest']) {
    const o = inferCarry(P.cad, P.joints, S0, { method: m, graph: G });
    const r = score(P.cad, T, o.label, P.joints, S0, name); agg[m].push(r);
    row.push(`${m} ${pct(r.all.acc)} nsS ${pct(r.nonSeedStructural.acc)} P/R ${pct(r.micro.prec)}/${pct(r.micro.rec)}`);
    if (m === 'combined' && process.argv.includes('--errors')) P.cad.solids.forEach((s, i) => { if ((T[i] ?? null) !== (o.label[i] ?? null)) console.log(`      ${i} ${s.kind.padEnd(9)} ${s.name.slice(0, 30).padEnd(30)} ${String(T[i] ?? 'frame').padEnd(14)} -> ${o.label[i] ?? 'frame'}`); });
  }
  console.log(`${name.padEnd(52)} graph ${tg.toFixed(0).padStart(4)} ms, ${String(fresh).padStart(3)} new strong cross-joint contacts | ${row.join(' | ')}`);
}
console.log('\nmean over the ' + poses.length + ' poses (non-seed structural accuracy; micro P/R over non-seed parts):');
for (const [m, rs] of Object.entries(agg)) { const a = (f) => rs.reduce((s, r) => s + f(r), 0) / rs.length; console.log(`  ${m.padEnd(9)} all ${pct(a((r) => r.all.acc))}  non-seed structural ${pct(a((r) => r.nonSeedStructural.acc))} (min ${pct(Math.min(...rs.map((r) => r.nonSeedStructural.acc)))})  fasteners ${pct(a((r) => r.fastener.acc))}  micro P ${pct(a((r) => r.micro.prec))} R ${pct(a((r) => r.micro.rec))}`); }
