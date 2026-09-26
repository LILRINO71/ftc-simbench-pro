// Measures findSlides() on Into The Deep against the hand-written joint spec
// (truth.solids[i].mech), and on the synthetic corpus robots.
//   node --max-old-space-size=8192 eval.mjs [--verbose]
//
// EVALUATION ONLY (never the algorithm) reads the CAD's assembly paths to say
// which parts make up each slide: rails = the SAR2XX extrusions
// (outslide/inslide), end hardware = every other part of that slide's
// subassembly; end hardware is split by the engine's name-based kind into
// fasteners (screws, locknuts) and fittings (printed inserts, V-bearing
// races, TSARA pins).
//
// Two truths are scored:
//  HAND = joints.json as written: each SAR unit (outslide + inslide) is one
//         rigid stage; lift = frame + 3 moving stages, extend = frame + 1.
//  PHYS = my physical reading of the same CAD: each SAR unit is a MISUMI SAR2
//         two-piece ball-bearing slide (outslide and inslide slide on each
//         other) and the printed inserts join unit u's inslide to unit u+1's
//         outslide; moving bodies = {inslide u, inserts, outslide u+1}. Built
//         from HAND + the rail names; it is a construction, not independent.
import fs from 'node:fs';
import { loadITD, loadCorpus, REPO } from '../lib.mjs';
import { findSlides } from './slides.mjs';
import { buildRobot } from '../../../tools/stepgen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const pc = (a, b) => (b ? `${(100 * a / b).toFixed(1)}% (${a}/${b})` : 'n/a');
const fmt = (v) => v.map((x) => (+x).toFixed(3)).join(',');
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cen = (s) => [0, 1, 2].map((k) => s.pts.reduce((a, p) => a + p[k], 0) / s.pts.length);

const t0 = Date.now();
const { cad, truth } = loadITD();
const tLoad = Date.now() - t0;
const occ = new Map(); for (const o of cad.occs) if (o.solid >= 0 && !occ.has(o.solid)) occ.set(o.solid, o);
const path = (i) => { const o = occ.get(i); return o ? o.path.map((p) => p.n).concat(o.name || '').join('/') : cad.solids[i].name; };
const hand = (i) => truth.solids[i].mech || 'FRAME';
const isFast = (i) => cad.solids[i].kind === 'fastener';

const SLIDES = [
  { name: 'lift', uni: /(^|\/)(Left|Right) SAR 230\//, not: /2 stage/, order: ['FRAME', 'lift stage 2', 'lift stage 3', 'lift'], id: 'lift' },
  { name: 'extend', uni: /(^|\/)2 stage (Left|Right) SAR 230\//, not: null, order: ['FRAME', 'extend'], id: 'extend' },
];
for (const SL of SLIDES) {
  SL.U = []; for (let i = 0; i < cad.solids.length; i++) { const p = path(i); if (SL.uni.test(p) && !(SL.not && SL.not.test(p))) SL.U.push(i); }
  SL.Uset = new Set(SL.U);
  SL.rail = new Set(SL.U.filter((i) => /\/SAR2XX\//.test(path(i))));
  const tj = truth.mechs.find((m) => m.id === SL.id);
  SL.axis = tj.axis; SL.limit = tj.limits ? tj.limits[1] : null;
  const tmid = SL.U.reduce((a, i) => a + dot(cen(cad.solids[i]), SL.axis), 0) / SL.U.length;
  SL.phys = new Map();
  for (const i of SL.U) {
    const u = SL.order.indexOf(hand(i));
    SL.phys.set(i, 'body ' + (SL.rail.has(i) ? (/inslide$/.test(path(i)) ? u + 1 : u) : (dot(cen(cad.solids[i]), SL.axis) < tmid ? u : u + 1)));
  }
  // parts riding this slide's joints anywhere else on the robot (the payload)
  const ids = new Set(SL.order.filter((x) => x !== 'FRAME'));
  const parentOf = new Map(truth.mechs.map((m) => [m.id, m.parent]));
  const under = (id) => { for (let j = id; j && j !== 'chassis'; j = parentOf.get(j)) if (ids.has(j)) return true; return false; };
  SL.payloadRigid = new Set(); SL.payloadAll = new Set();
  truth.solids.forEach((s, i) => { if (SL.Uset.has(i) || !s.mech) return; if (ids.has(s.mech)) SL.payloadRigid.add(i); if (under(s.mech)) SL.payloadAll.add(i); });
}

const CLS = [['rails', (SL, i) => SL.rail.has(i)], ['fittings', (SL, i) => !SL.rail.has(i) && !isFast(i)], ['fasteners', (SL, i) => !SL.rail.has(i) && isFast(i)]];
function score(R, truthOf, mapStage, title) {
  console.log(`\n##### ${title}`);
  const claimed = new Set();
  const summary = {};
  for (const SL of SLIDES) {
    let best = -1, bn = 0;
    R.mechanisms.forEach((m, k) => { const n = m.stages.flatMap((g) => g.rails).filter((i) => SL.rail.has(i)).length; if (n > bn) { bn = n; best = k; } });
    if (best < 0) { console.log(`  ${SL.name}: NOT FOUND`); summary[SL.name] = null; continue; }
    claimed.add(best);
    const m = R.mechanisms[best];
    const T = (i) => (SL.Uset.has(i) ? truthOf(SL, i) : hand(i));
    const map = mapStage(SL, m);
    const pred = new Map(); m.stages.forEach((g, k) => [...g.rails, ...(g.blocks || []), ...g.hw].forEach((i) => pred.set(i, map[k])));
    const dirOK = dot(m.dir, SL.axis) > 0.99;
    const fixedOK = m.stages[0].rails.every((i) => hand(i) === 'FRAME');
    const travel = m.travel.reduce((a, b) => a + b, 0);
    console.log(`  ${SL.name}: ${m.stacks.length} mirror copies -> 1 mechanism, ${m.stages.length} stages; direction ${fmt(m.dir)} ${dirOK ? 'CORRECT' : 'WRONG'}; ` +
      `fixed stage ${fixedOK ? 'CORRECT' : 'WRONG'}; travel ${m.travel.map((v) => (v * 1000).toFixed(0)).join('+')} = ${(travel * 1000).toFixed(0)} mm (spec limit ${(SL.limit * 1000).toFixed(0)} mm, ${(100 * (travel - SL.limit) / SL.limit).toFixed(0)}%)`);
    const labels = [...new Set(SL.U.map(T))].sort();
    const tot = {}; for (const [c] of CLS) tot[c] = { tp: 0, np: 0, nt: 0 };
    for (const L of labels) {
      const cells = [];
      for (const [c, f] of CLS) {
        const P = [...pred.keys()].filter((i) => pred.get(i) === L && (SL.Uset.has(i) ? f(SL, i) : c === 'rails' ? cad.solids[i].kind !== 'fastener' : isFast(i)));
        const Tt = SL.U.filter((i) => f(SL, i) && T(i) === L);
        const tp = P.filter((i) => T(i) === L).length;
        tot[c].tp += tp; tot[c].np += P.length; tot[c].nt += Tt.length;
        cells.push(`${c} P ${tp}/${P.length} R ${Tt.filter((i) => pred.get(i) === L).length}/${Tt.length}`);
        if (VERBOSE) for (const i of P) if (T(i) !== L) console.log(`      predicted ${L}, truth ${T(i)}: ${i} ${path(i).slice(-70)}`);
      }
      console.log(`    ${L.padEnd(13)} ${cells.join('   ')}`);
    }
    const line = CLS.map(([c]) => `${c} P ${pc(tot[c].tp, tot[c].np)} R ${pc(tot[c].tp, tot[c].nt)}`).join(' | ');
    console.log(`    => ${line}`);
    // payload: parts the finder says touch the moving end, vs what the truth has riding the slide
    const ca = m.carriageAttachments;
    console.log(`    moving-end attachments: ${ca.length}, of which ride this slide in the truth: ${ca.filter((i) => SL.payloadAll.has(i)).length} ` +
      `(truth payload rigid on the slide's joints: ${SL.payloadRigid.size} parts, found among the attachments ${ca.filter((i) => SL.payloadRigid.has(i)).length})`);
    for (const j of m.stacks) for (const w of R.stacks[j].why) if (VERBOSE) console.log('      why: ' + w);
    summary[SL.name] = { dirOK, fixedOK, travel, tot };
  }
  const fp = R.mechanisms.filter((_, k) => !claimed.has(k));
  console.log(`  other slide mechanisms (false positives): ${fp.length}`);
  for (const m of fp) console.log('    FP', m.id, m.stages.map((g) => g.rails.map((i) => i + ':' + path(i).slice(-30)).join('+')).join(' | '));
  return summary;
}

const byOrder = (SL, m) => (m.stages.length === SL.order.length ? SL.order.slice() : m.stages.map((_, k) => '?' + k));
const byMajority = (SL, m) => m.stages.map((g) => { const c = {}; for (const i of g.rails) c[hand(i)] = (c[hand(i)] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; });
const byBody = (SL, m) => m.stages.map((_, k) => 'body ' + k);

let t1 = Date.now(); const Rs = findSlides(cad); const tS = Date.now() - t1;
t1 = Date.now(); const Rr = findSlides(cad, { nested: 'rigid' }); const tR = Date.now() - t1;
console.log(`load ${tLoad} ms; findSlides default ${tS} ms, rigid ${tR} ms; ${cad.solids.length} parts`);
score(Rs, (SL, i) => hand(i), byMajority, "DEFAULT (nested:'slide', physical) vs HAND truth -- my bodies labelled by the hand label most of their rails carry");
score(Rs, (SL, i) => SL.phys.get(i), byBody, "DEFAULT (nested:'slide') vs PHYS reading");
score(Rr, (SL, i) => hand(i), byOrder, "nested:'rigid' (the hand spec's reading) vs HAND truth");

// the end-fitting rule, checked directly on the HAND truth
{
  let n = 0, ok = 0, nf = 0, okf = 0;
  for (const SL of SLIDES) {
    const tmid = SL.U.reduce((a, i) => a + dot(cen(cad.solids[i]), SL.axis), 0) / SL.U.length;
    for (const side of [-1, 1]) {
      const sideRails = [...SL.rail].filter((i) => Math.sign(cen(cad.solids[i])[1]) === side);
      const cs = sideRails.map((i) => cen(cad.solids[i]));
      const sp = (k) => Math.max(...cs.map((c) => c[k])) - Math.min(...cs.map((c) => c[k]));
      const k = sp(0) >= sp(2) ? 0 : 2;
      const unitPos = new Map();
      for (const i of sideRails) { const u = SL.order.indexOf(hand(i)); if (!unitPos.has(u)) unitPos.set(u, []); unitPos.get(u).push(cen(cad.solids[i])[k]); }
      const um = [...unitPos.entries()].map(([u, v]) => [u, v.reduce((x, y) => x + y, 0) / v.length]).sort((x, y) => x[0] - y[0]);
      for (const i of SL.U) {
        if (SL.rail.has(i)) continue;
        const c = cen(cad.solids[i]); if (Math.sign(c[1]) !== side) continue;
        let best = null; for (let q = 0; q + 1 < um.length; q++) { const mm = (um[q][1] + um[q + 1][1]) / 2; const d = Math.abs(c[k] - mm); if (!best || d < best.d) best = { d, outer: um[q][0], inner: um[q + 1][0] }; }
        const want = dot(c, SL.axis) < tmid ? best.inner : best.outer;
        const good = SL.order.indexOf(hand(i)) === want;
        if (isFast(i)) { nf++; if (good) okf++; } else { n++; if (good) ok++; }
      }
    }
  }
  console.log(`\nend-fitting rule on the HAND truth ("a fitting between units u and u+1 rides the inner unit at the retracted end, the outer unit at the extended end"): fittings ${ok}/${n}, fasteners ${okf}/${nf}`);
}

// ---- corpus robots ----
console.log('\n##### corpus robots');
const names = fs.readdirSync(REPO + 'tests/fixtures/robots').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
let fpTotal = 0;
for (const nm of names) {
  const c = loadCorpus(nm);
  const r = findSlides(c), r2 = findSlides(c, { nested: 'rigid' });
  fpTotal += r.mechanisms.length + r2.mechanisms.length;
  console.log(`  ${nm.padEnd(16)} ${String(c.solids.length).padStart(5)} parts -> ${r.mechanisms.length} slides (rigid mode ${r2.mechanisms.length})`);
}
console.log(`  false positives on the ${names.length} corpus robots without slides (both modes): ${fpTotal}`);
{
  const c = loadCorpus('mated');
  const T = buildRobot('mated').truth.joints.filter((j) => j.kind === 'linear');
  console.log(`  mated truth: ${T.map((j) => `${j.name} carries ${j.carries.join('+')} (axis ${j.axis}, parent ${j.parent})`).join('; ')}`);
  for (const mode of ['slide', 'rigid']) {
    const r = findSlides(c, { nested: mode });
    const nm = (i) => c.solids[i].name;
    console.log(`  mated [${mode}] ${r.mechanisms.length} slide(s): ` + r.mechanisms.map((m) => `${m.stages.length} stages, dir ${fmt(m.dir)}, fixed->out [${m.stages.map((g) => [...g.rails, ...(g.blocks || [])].map(nm).join('+')).join(' | ')}], travel ${m.travel.map((v) => (v * 1000).toFixed(0)).join('+')} mm, joints ${r.joints.map((j) => j.id + '=' + j.parts.map(nm).join('+')).join(', ')}`).join(' ; '));
  }
}
