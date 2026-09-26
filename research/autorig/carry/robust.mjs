// Robustness of carry.mjs on Into The Deep: weaker seeds, noisy joints, parameters, ablations.
import { loadITD, centroid } from '../lib.mjs';
import { inferCarry, contactGraph, railness } from './carry.mjs';
import { jointsOf, seedsOf, score, pct } from './evallib.mjs';
const { cad, truth } = loadITD();
const J0 = jointsOf(truth), S0 = seedsOf(truth, J0);
const T = truth.solids.map((s) => s.mech ?? null);
const S = cad.solids, n = S.length;
const norm = (a) => Math.hypot(...a), sub = (a, b) => a.map((v, k) => v - b[k]);
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const G1 = contactGraph(cad, {});
const line = (name, r) => console.log(`${name.padEnd(46)} acc ${pct(r.all.acc)}  non-seed struct ${pct(r.nonSeedStructural.acc)}  fasteners ${pct(r.fastener.acc)}  micro P ${pct(r.micro.prec)} R ${pct(r.micro.rec)}  false-moving ${r.falseMoving.all}`);
const run = (name, joints, seeds, opts = {}, G = G1, methods = ['contact', 'combined']) => {
  const out = {};
  for (const m of methods) { const o = inferCarry(cad, joints, seeds, { ...opts, method: m, graph: G }); out[m] = score(cad, T, o.label, joints, seeds, name); line(`${name} [${m}]`, out[m]); }
  return out;
};
const members = (id) => S.map((s, i) => i).filter((i) => T[i] === id);
const avg = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
const agg = (name, rs) => console.log(`${name.padEnd(46)} acc ${pct(avg(rs, (r) => r.all.acc))}  non-seed struct ${pct(avg(rs, (r) => r.nonSeedStructural.acc))} (min ${pct(Math.min(...rs.map((r) => r.nonSeedStructural.acc)))})  micro P ${pct(avg(rs, (r) => r.micro.prec))} R ${pct(avg(rs, (r) => r.micro.rec))} (min R ${pct(Math.min(...rs.map((r) => r.micro.rec)))})`);

console.log('--- seeds');
run('default seeds', J0, S0);
{ // one rail per slide stage
  const s1 = { ...S0 }; for (const j of J0) if (j.kind === 'linear') s1[j.id] = [S0[j.id].reduce((a, b) => (norm(sub(centroid(S[a]), j.pivot)) <= norm(sub(centroid(S[b]), j.pivot)) ? a : b))];
  run('one rail per slide stage', J0, s1);
}
{ // farthest structural member from the pivot
  const s2 = {}; for (const j of J0) { const m = members(j.id).filter((i) => S[i].kind !== 'fastener'); s2[j.id] = [m.reduce((a, b) => (norm(sub(centroid(S[a]), j.pivot)) >= norm(sub(centroid(S[b]), j.pivot)) ? a : b))]; }
  run('one seed: farthest member', J0, s2);
}
for (const m of ['contact', 'combined']) { // random single member
  const rs = [];
  for (let t = 0; t < 30; t++) { const s3 = {}; for (const j of J0) { const mm = members(j.id).filter((i) => S[i].kind !== 'fastener'); s3[j.id] = [mm[Math.floor(rnd() * mm.length)]]; } const o = inferCarry(cad, J0, s3, { method: m, graph: G1 }); rs.push(score(cad, T, o.label, J0, s3, '')); }
  agg(`one seed: random member x30 [${m}]`, rs);
}
for (const m of ['contact', 'combined']) { // random single member, but slides keep rails
  const rs = [];
  for (let t = 0; t < 30; t++) { const s3 = {}; for (const j of J0) { if (j.kind === 'linear') { s3[j.id] = S0[j.id]; continue; } const mm = members(j.id).filter((i) => S[i].kind !== 'fastener'); s3[j.id] = [mm[Math.floor(rnd() * mm.length)]]; } const o = inferCarry(cad, J0, s3, { method: m, graph: G1 }); rs.push(score(cad, T, o.label, J0, s3, '')); }
  agg(`revolute seed random member x30 [${m}]`, rs);
}

console.log('--- joint noise (pivot moved off the axis, axis tilted), 20 trials each');
const perp = (a) => { const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = [a[1] * t[2] - a[2] * t[1], a[2] * t[0] - a[0] * t[2], a[0] * t[1] - a[1] * t[0]]; const L = norm(u); return u.map((v) => v / L); };
const rot = (v, a, th) => { const c = Math.cos(th), s = Math.sin(th), d = v[0] * a[0] + v[1] * a[1] + v[2] * a[2], x = [a[1] * v[2] - a[2] * v[1], a[2] * v[0] - a[0] * v[2], a[0] * v[1] - a[1] * v[0]]; return v.map((q, k) => q * c + x[k] * s + a[k] * d * (1 - c)); };
for (const [dmm, deg] of [[1, 0], [2, 0], [3, 0], [5, 0], [8, 0], [0, 1], [0, 2], [0, 5], [2, 2]]) {
  for (const m of ['combined']) {
    const rs = [];
    for (let t = 0; t < 20; t++) {
      const J = J0.map((j) => { const u = perp(j.axis), w = rot(u, j.axis, rnd() * 2 * Math.PI); const pv = j.pivot.map((v, k) => v + w[k] * dmm / 1000); const tiltAxis = rot(perp(j.axis), j.axis, rnd() * 2 * Math.PI); const ax = rot(j.axis, tiltAxis, deg * Math.PI / 180); return { ...j, pivot: pv, axis: ax }; });
      const o = inferCarry(cad, J, S0, { method: m, graph: G1 }); rs.push(score(cad, T, o.label, J, S0, ''));
    }
    agg(`pivot off ${dmm} mm, axis tilt ${deg} deg [${m}]`, rs);
  }
}

console.log('--- parameters');
for (const tol of [0.0005, 0.002, 0.003]) { const G = contactGraph(cad, { tol }); run(`tol ${tol * 1000} mm (${G.edges.length} edges)`, J0, S0, { tol }, G, ['combined']); }
for (const embed of [0.05, 0.2, 0.3, 1.01]) { const G = contactGraph(cad, { embed }); run(`embed ${embed} (strong ${G.edges.filter((e) => e.strong).length})`, J0, S0, {}, G, ['combined']); }
for (const rAxis of [0.002, 0.003, 0.008, 0.012, 0.02]) run(`rAxis ${rAxis * 1000} mm`, J0, S0, { rAxis }, G1, ['combined']);
run('spreadMax 17.5 mm', J0, S0, { spreadMax: 0.0175 }, G1, ['combined']);
run('inWeak off (In grows on strong edges only)', J0, S0, { inWeak: false }, G1, ['combined']);
console.log('--- ablations');
run('no gearmotor rule', J0, S0, { motorUnits: false }, G1, ['combined']);
run('no slide end rule', J0, S0, { railRule: false }, G1, ['combined']);
run('no fixed-rail detection', J0, S0, { fixedRails: false }, G1, ['combined']);
{ const G = contactGraph(cad, { embed: 0 }); for (const e of G.edges) e.strong = true; run('every contact strong (no weak edges)', J0, S0, {}, G, ['combined']); }
run('no housed-ring rule', J0, S0, { housedRings: false }, G1, ['combined']);
run('no empty-parent rule', J0, S0, { emptyParent: false }, G1, ['combined']);
run('rail rule on strong contacts only', J0, S0, { railStrong: true }, G1, ['combined']);
console.log('--- CAD metadata removed');
{ // a flattened STEP export: no subassembly paths at all
  const flat = { ...cad, occs: cad.occs.map((o) => ({ ...o, path: o.path.slice(0, 1) })) };
  for (const m of ['subasm', 'contact', 'combined']) { const r = score(cad, T, inferCarry(flat, J0, S0, { method: m, graph: G1 }).label, J0, S0, ''); line(`flattened STEP (no subassemblies) [${m}]`, r); }
}
{ // no part names and no kinds: geometry only
  const anon = { ...cad, solids: cad.solids.map((s) => ({ ...s, name: '', part: '', kind: 'metal' })) };
  const occs = cad.occs.map((o) => ({ ...o, name: '', path: o.path.map((p) => ({ ...p, n: 'asm' + (p.n || '').length })) }));
  for (const m of ['contact', 'combined']) { const r = score(cad, T, inferCarry({ ...anon, occs }, J0, S0, { method: m, graph: G1 }).label, J0, S0, ''); line(`no names, no kinds [${m}]`, r); }
}
console.log('--- robot frame turned about +z (canonical frame with the intake at -y, +x, +y)');
for (const deg of [90, 180, 270]) {
  const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180), R = (p) => [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
  const cadR = { ...cad, solids: cad.solids.map((x) => ({ ...x, pts: x.pts.map(R) })) };
  const JR = J0.map((j) => ({ ...j, axis: R(j.axis), pivot: R(j.pivot) }));
  const GR = contactGraph(cadR, {});
  for (const m of ['combined']) { const r = score(cadR, T, inferCarry(cadR, JR, S0, { method: m, graph: GR }).label, JR, S0, ''); line(`yaw ${deg} deg [${m}]`, r); }
}
