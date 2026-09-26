// The finder's output through the engine's own applyJointSpec(), scored the
// way the bench would see it (each solid's .mech), in both nesting modes.
//   node --max-old-space-size=8192 apply.mjs
import { loadITD, E } from '../lib.mjs';
import { findSlides, toJointSpec } from './slides.mjs';
const { cad, truth } = loadITD();
for (const mode of ['rigid', 'slide']) {
  const spec = toJointSpec(findSlides(cad, { nested: mode }), 'Into The Deep');
  const { cad: c2 } = loadITD();
  E.applyJointSpec(c2, spec);
  const mechs = c2.mechs.filter((m) => !m.drive);
  console.log(`[${mode}] applyJointSpec made ${mechs.length} joints: ${mechs.map((m) => `${m.id} (${m.kind}, axis ${m.axis.map((v) => v.toFixed(2))}, ${c2.solids.filter((s) => s.mech === m.id).length} parts${m.couple ? ', follows ' + m.couple.to + ' x' + m.couple.ratio : ''}${m.limits ? ', limits ' + m.limits.map((v) => (v * 1000).toFixed(0)).join('..') + ' mm' : ''})`).join('; ')}`);
  if (mode === 'rigid') {
    // label my joints with the truth joint most of their parts ride
    const map = {};
    for (const m of mechs) { const cnt = {}; c2.solids.forEach((s, i) => { if (s.mech === m.id) { const t = truth.solids[i].mech || 'FRAME'; cnt[t] = (cnt[t] || 0) + 1; } }); map[m.id] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]; }
    console.log('   my joint -> truth joint: ' + JSON.stringify(map));
    const ratio = mechs.filter((m) => m.couple).map((m) => `${map[m.id]} follows ${map[m.couple.to]} x${m.couple.ratio} (truth x${truth.mechs.find((t) => t.id === map[m.id]).couple?.ratio})`);
    console.log('   ' + ratio.join('; '));
  }
}
