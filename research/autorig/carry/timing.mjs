// Run-time cost of the carry step (Node 24, this machine), median of repeated runs.
import { loadITD, loadCorpus } from '../lib.mjs';
import { inferCarry, contactGraph } from './carry.mjs';
import { jointsOf, seedsOf } from './evallib.mjs';
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const { cad, truth } = loadITD();
const J = jointsOf(truth), S = seedsOf(truth, J);
const npts = cad.solids.reduce((a, s) => a + s.pts.length, 0);
const tg = [], ta = {}, first = [];
{ const t0 = performance.now(); const o = inferCarry(cad, J, S, { method: 'combined' }); first.push(performance.now() - t0); }
for (let r = 0; r < 7; r++) {
  let t0 = performance.now(); const G = contactGraph(cad, {}); tg.push(performance.now() - t0);
  for (const m of ['subasm', 'nearest', 'contact', 'combined']) { t0 = performance.now(); inferCarry(cad, J, S, { method: m, graph: G }); (ta[m] ||= []).push(performance.now() - t0); }
}
console.log(`Into The Deep: ${cad.solids.length} parts, ${npts} hull points, ${J.length} joints`);
console.log(`  cold first call (graph + combined, incl. JIT warm-up): ${first[0].toFixed(0)} ms`);
console.log(`  contact graph: median ${med(tg).toFixed(0)} ms (min ${Math.min(...tg).toFixed(0)}, max ${Math.max(...tg).toFixed(0)})`);
for (const [m, a] of Object.entries(ta)) console.log(`  assign [${m}]: median ${med(a).toFixed(1)} ms`);
const big = loadCorpus('big'); const tb = [];
for (let r = 0; r < 3; r++) { const t0 = performance.now(); inferCarry(big, [], {}, { method: 'combined' }); tb.push(performance.now() - t0); }
console.log(`corpus 'big': ${big.solids.length} parts, graph + assign median ${med(tb).toFixed(0)} ms`);
