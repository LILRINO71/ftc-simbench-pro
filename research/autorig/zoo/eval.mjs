// The joint finder (src/autorig.js, the one the app runs) on the mechanism
// zoo (tools/mechgen.mjs): every kind of mechanism, named and name-stripped.
//   node research/autorig/zoo/eval.mjs [names...] [--strip-only|--named-only] [--verbose]
import { loadEngine } from '../../../tests/load.mjs';
import { MECHS, buildMech } from '../../../tools/mechgen.mjs';

const E = loadEngine();
const argv = process.argv.slice(2), verbose = argv.includes('--verbose');
const names = argv.filter((a) => !a.startsWith('--')).length ? argv.filter((a) => !a.startsWith('--')) : Object.keys(MECHS);
const modes = argv.includes('--strip-only') ? [true] : argv.includes('--named-only') ? [false] : [false, true];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function score(cad, R, truth) {
  const found = R && R.spec ? R.spec.joints : [];
  // match each truth joint to a found joint on the same axis line
  const match = {}, used = new Set();
  for (const t of truth.joints) {
    let best = null, bd = Infinity;
    for (const j of found) {
      if (used.has(j.id)) continue;
      const lin = j.kind === 'slider';
      if (lin !== (t.kind === 'linear')) continue;
      if (Math.abs(dot(j.axis, t.axis)) < Math.cos(3 * Math.PI / 180)) continue;
      let d = 0;
      if (!lin) { const p = j.pivot.map((v) => v / 1000), q = [0, 1, 2].map((k) => t.pivot[k] - p[k]), a = dot(q, j.axis);
        d = Math.hypot(q[0] - j.axis[0] * a, q[1] - j.axis[1] * a, q[2] - j.axis[2] * a); if (d > 0.005) continue; }
      if (d < bd) { bd = d; best = j; }
    }
    if (best) { match[t.id] = best.id; used.add(best.id); }
  }
  const back = {}; for (const t in match) back[match[t]] = t;
  const pred = new Map(); for (const j of found) for (const i of j.parts[0].solid) pred.set(i, j.id);
  const ign = new Set(truth.ignore);
  let right = 0, wrongJoint = 0, missed = 0, falseMove = 0, moving = 0;
  cad.solids.forEach((s, i) => {
    if (ign.has(s.name)) return;
    const t = truth.label[s.name] || null, p = pred.has(i) ? pred.get(i) : null, pt = p ? (back[p] || '?' + p) : null;
    if (t) { moving++; if (pt === t) right++; else if (pt) wrongJoint++; else missed++; }
    else if (p) falseMove++;
  });
  const extra = found.filter((j) => !back[j.id]).map((j) => j.id + '(' + j.parts[0].solid.length + ')');
  // a joint on a joint: the found parent has to be the true parent's match
  const badParent = truth.joints.filter((t) => match[t.id] && t.parent && (found.find((j) => j.id === match[t.id]).parent || null) !== (match[t.parent] || '?')).map((t) => t.id);
  return { found: Object.keys(match).length, of: truth.joints.length, missing: truth.joints.filter((t) => !match[t.id]).map((t) => t.id),
    moving, right, wrongJoint, missed, falseMove, extra, badParent, review: R ? R.review : [] };
}

if (import.meta.url === 'file:///' + process.argv[1].replace(/\\/g, '/') || process.argv[1].endsWith('eval.mjs')) {
  const rows = [];
  for (const nm of names) for (const strip of modes) {
    const { text, truth } = buildMech(nm, { strip });
    const cad = E.parseSTEP(text), R = E.autoRig(cad, {});
    const s = score(cad, R, truth);
    rows.push(s);
    console.log(`${(nm + (strip ? ' (no names)' : '')).padEnd(28)} joints ${s.found}/${s.of}${s.missing.length ? ' missing ' + s.missing.join(',') : ''}` +
      ` | parts ${s.right}/${s.moving} right, ${s.wrongJoint} wrong joint, ${s.missed} missed, ${s.falseMove} frame moved` +
      (s.extra.length ? ` | extra joints ${s.extra.join(' ')}` : '') + (s.badParent.length ? ` | wrong parent ${s.badParent.join(',')}` : ''));
    if (verbose) { for (const r of s.review) console.log('     check: ' + r); if (R && R.spec) for (const j of R.spec.joints) console.log('     ' + j.id + ' ' + j.kind + ' axis ' + j.axis + ' pivot ' + j.pivot + ' parent ' + (j.parent || 'chassis') + ' parts ' + j.parts[0].solid.map((i) => cad.solids[i].name).join(', ')); }
  }
  const tot = (k) => rows.reduce((a, r) => a + r[k], 0);
  console.log(`\nTOTAL joints ${tot('found')}/${tot('of')} | moving parts right ${tot('right')}/${tot('moving')} | wrong joint ${tot('wrongJoint')} | missed ${tot('missed')} | frame moved ${tot('falseMove')}`);
}
