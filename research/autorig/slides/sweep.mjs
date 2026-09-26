// One-at-a-time threshold sweep: how far can each tunable move before the
// Into The Deep scores, the corpus false-positive count or the synthetic
// designs break?   node --max-old-space-size=8192 sweep.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadITD, loadCorpus, REPO } from '../lib.mjs';
import { findSlides, SLIDE_DEFAULTS } from './slides.mjs';

const { cad, truth } = loadITD();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cen = (s) => [0, 1, 2].map((k) => s.pts.reduce((a, p) => a + p[k], 0) / s.pts.length);
const occ = new Map(); for (const o of cad.occs) if (o.solid >= 0 && !occ.has(o.solid)) occ.set(o.solid, o);
const path = (i) => { const o = occ.get(i); return o ? o.path.map((p) => p.n).concat(o.name || '').join('/') : cad.solids[i].name; };
const hand = (i) => truth.solids[i].mech || 'FRAME';
const SLIDES = [
  { uni: /(^|\/)(Left|Right) SAR 230\//, not: /2 stage/, order: ['FRAME', 'lift stage 2', 'lift stage 3', 'lift'], axis: [0, 0, 1] },
  { uni: /(^|\/)2 stage (Left|Right) SAR 230\//, not: null, order: ['FRAME', 'extend'], axis: [-1, 0, 0] },
];
for (const SL of SLIDES) {
  SL.U = []; for (let i = 0; i < cad.solids.length; i++) { const p = path(i); if (SL.uni.test(p) && !(SL.not && SL.not.test(p))) SL.U.push(i); }
  SL.rail = new Set(SL.U.filter((i) => /\/SAR2XX\//.test(path(i))));
  const tmid = SL.U.reduce((a, i) => a + dot(cen(cad.solids[i]), SL.axis), 0) / SL.U.length;
  SL.hand = new Map(SL.U.map((i) => [i, SL.order.indexOf(hand(i))]));
  SL.phys = new Map(SL.U.map((i) => { const u = SL.order.indexOf(hand(i));
    return [i, SL.rail.has(i) ? (/inslide$/.test(path(i)) ? u + 1 : u) : (dot(cen(cad.solids[i]), SL.axis) < tmid ? u : u + 1)]; }));
}
const itdScore = (o) => {
  let ok = 0, n = 0, fp = 0, dir = 0;
  for (const mode of ['rigid', 'slide']) {
    const R = findSlides(cad, { ...o, nested: mode });
    let claimed = 0;
    for (const SL of SLIDES) {
      const T = mode === 'rigid' ? SL.hand : SL.phys;
      const m = R.mechanisms.find((mm) => mm.stages.some((g) => g.rails.some((i) => SL.rail.has(i))));
      n += SL.U.length; if (!m) continue; claimed++;
      const st = new Map(); m.stages.forEach((g, k) => g.rails.concat(g.hw).forEach((i) => st.set(i, k)));
      ok += SL.U.filter((i) => st.get(i) === T.get(i)).length;
      if (dot(m.dir, SL.axis) > 0.99 && m.stages.length === SL.order.length + (mode === 'rigid' ? 0 : 1)) dir++;
    }
    fp += R.mechanisms.length - claimed;
  }
  return { acc: ok / n, fp, dir };
};
const corpus = fs.readdirSync(REPO + 'tests/fixtures/robots').filter((f) => f.endsWith('.json')).map((f) => loadCorpus(f.slice(0, -5)));
const mated = loadCorpus('mated');
const corpusFP = (o) => corpus.reduce((a, c) => a + findSlides(c, o).mechanisms.length, 0);
const matedOK = (o) => { const r = findSlides(mated, o); const m = r.mechanisms[0]; return r.mechanisms.length === 1 && m.stages.length === 3 && /Slide Rail/.test(mated.solids[m.stages[0].rails[0]].name) && /Slide Stage 1/.test(mated.solids[m.stages[1].rails[0]].name) && /Slide Carriage/.test(mated.solids[m.stages[2].blocks[0]]?.name || '') && m.dir[2] > 0.99; };
const synth = (o) => execFileSync(process.execPath, ['--max-old-space-size=8192', 'synth.mjs'], { env: { ...process.env, SLIDE_OPTS: JSON.stringify(o) }, encoding: 'utf8' }).trim().split(/\r?\n/).pop().replace('PASS ', '');

const SWEEP = {
  packGap: [0.002, 0.003, 0.004, 0.005, 0.006, 0.008, 0.010],
  bridgeGap: [0.007, 0.012, 0.016, 0.020, 0.025, 0.030],
  nestOverlap: [0.05, 0.1, 0.25, 0.4, 0.6, 0.8],
  touch: [0.0005, 0.001, 0.0015, 0.002, 0.003, 0.005],
  seedGap: [0, 0.002, 0.004, 0.006, 0.010, 0.020],
  hwMaxSize: [0.03, 0.05, 0.06, 0.08, 0.10, 0.15],
  hwMarginW: [0.005, 0.01, 0.015, 0.02, 0.03],
  endZone: [0.1, 0.15, 0.2, 0.3, 0.4, 0.5],
  'rail.minAspect': [3, 4, 5, 6, 8, 10, 12, 14],
  'rail.maxSectionRatio': [2, 3, 4, 6, 10],
  mountAreaRatio: [1.5, 2, 3, 5, 10],
  carriageMaxFrac: [0.1, 0.2, 0.35, 0.5, 0.6],
  carriagePenFrac: [0.05, 0.1, 0.15, 0.3, 0.6],
  carriageMaxSection: [1.5, 2, 4, 8, 20],
};
console.log('parameter            value    ITD part acc (both modes)  ITD FP  dir+stage count ok/4  corpus FP  mated ok  synthetic pass');
for (const [k, vals] of Object.entries(SWEEP)) {
  for (const v of vals) {
    const o = k.startsWith('rail.') ? { rail: { ...SLIDE_DEFAULTS.rail, [k.slice(5)]: v } } : { [k]: v };
    const s = itdScore(o);
    const def = k.startsWith('rail.') ? SLIDE_DEFAULTS.rail[k.slice(5)] === v : SLIDE_DEFAULTS[k] === v;
    console.log(`${k.padEnd(20)} ${String(v).padEnd(8)} ${(s.acc * 100).toFixed(1).padStart(6)}%${def ? ' (default)' : '          '}          ${s.fp}       ${s.dir}         ${corpusFP(o)}          ${matedOK(o) ? 'yes' : 'NO '}       ${synth(o)}`);
  }
}
