// findSlides(cad, opts) — find telescoping linear-slide stacks in a parsed
// robot CAD (FTC SimBench Pro's parseSTEP output, canonical robot frame:
// metres, +z up, origin at the drivetrain centre on the floor), from geometry.
// toJointSpec(result) — the same as a joints.json the engine's
// applyJointSpec() takes (millimetres, parts picked by solid index).
//
// findSlides returns plain data:
//   { stacks:     one per physical slide: axis, extension dir, stages from the
//                 fixed one outward (rails + end hardware), junctions, travel,
//                 the parts touching the fixed and the moving end, and `why`
//     mechanisms: mirror/linked stacks that move together, stages merged
//     joints:     one linear joint per moving stage (carriage driven, the
//                 stages between follow it k/(n-1)), parent 'chassis'
//     partMech:   { solidIndex: jointId } for rails and end hardware only }
// Nothing about any one robot (names, coordinates, subassemblies) is used.
// Names are read in two places only, both as vetoes: a side-by-side pack
// whose rails are all named as structural stock (channel/beam/plate/tube,
// goBILDA 1101-1129 structure numbers) and none as a slide is dropped, and an
// outermost rail so named (while the rest are not) is taken as the frame
// member the slide is bolted to. `kind` (the engine's name-based class) skips
// wheels/motors/servos as rails and finds the floor wheels; with every name
// and kind stripped the result on Into The Deep is unchanged.
//
// Algorithm:
//  1. rails: long (>=100 mm), thin (aspect >= 6), chunky-section (<= 4:1,
//     >= 5 mm) parts, from each part's principal axes
//  2. contact graph: GJK distance between parts' point hulls (<= 1.5 mm)
//  3. packs: parallel rails overlapping along their length, side by side
//     (<= 5 mm apart) and of like section (area within 3x) or nested; packs
//     up to 20 mm apart join when a small part touches both (a member missing
//     from the CAD, or a 15 mm extrusion / printed spacer joining two slides). An outer rail with 3x the pack's section is a frame mount.
//  4. stages: walk the rails across the stack; each neighbour pair is NESTED
//     (sections overlap) or a GAP. opts.nested = 'slide' (default, physical):
//     nested = sliding interface; in a stack with nested pairs a gap between
//     different profiles is a rigid join (drawer-slide chain), same profile
//     = sliding (a member missing); no nesting = every rail its own stage.
//     opts.nested = 'rigid': nested pair = one stage, gap = sliding (the
//     reading of the hand-written Into The Deep spec)
//  5. fixed stage: of the two outer stages, the one whose outside
//     attachments are fewer contact hops from the floor wheels (paths that
//     avoid every slide); ties: bigger attached part of the robot, then lower
//  5b. carriage block: a short part (<= 35% of the rail) cut into the
//     outermost moving rail's section from outside the stack (>= 2 mm and
//     15% of its thickness, section <= 4x the rail's) rides it: one more stage
//  6. extension direction: |axis.z| > 0.7 extends up; otherwise toward the
//     end the moving stage's payload sits at, else toward the nearer robot edge
//  7. mechanisms: parallel stacks, same stage count, length and axial place,
//     that are mirror images across x=0 / y=0 or share a payload part
//  8. end hardware: small parts (<= 100 mm, not motors/servos/electronics)
//     inside the stack envelope; near a rail end each goes to the nearest
//     junction: a rigid join's fitting rides that stage; a sliding
//     interface's fitting rides the INNER stage at its retracted end and the
//     OUTER stage at its extended end
//  9. travel per stage: a nested (ball-bearing drawer) interface strokes 0.6 x
//     the shorter rail (MISUMI SAR2 datasheet: 180 of 300 mm); side-by-side
//     stages keep a 20% overlap; a carriage block runs its stage's length
//     minus its own. The whole slide's travel is the sum.

// ---------------- geometry ----------------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return n > 1e-12 ? mul(a, 1 / n) : [0, 0, 1]; };
const centroidOf = (pts) => { const c = [0, 0, 0]; for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return mul(c, 1 / (pts.length || 1)); };
const span = (pts, d) => { let lo = Infinity, hi = -Infinity; for (const p of pts) { const t = dot(p, d); if (t < lo) lo = t; if (t > hi) hi = t; } return [lo, hi]; };
const ovl = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
const gap1 = (a, b) => Math.max(0, Math.max(a[0], b[0]) - Math.min(a[1], b[1]));
const mid = (r) => (r[0] + r[1]) / 2;
const len = (r) => r[1] - r[0];
const hull = (rs) => [Math.min(...rs.map((r) => r[0])), Math.max(...rs.map((r) => r[1]))];

function eigSym3(A) {
  const a = A.map((r) => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    if (Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]) < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return idx.map((i) => [V[0][i], V[1][i], V[2][i]]);
}
// principal axes of a point set; axes within ~0.6 deg of a robot axis are snapped to it
function principalAxes(pts) {
  const c = centroidOf(pts), C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  const snap = (v) => { for (let k = 0; k < 3; k++) if (Math.abs(v[k]) > 0.99995) { const w = [0, 0, 0]; w[k] = Math.sign(v[k]); return w; } return v; };
  return { c, axes: eigSym3(C).map(snap) };
}

// GJK distance between the convex hulls of two point sets (0 when they overlap)
function support(P, d) { let bi = 0, bv = -Infinity; for (let i = 0; i < P.length; i++) { const v = P[i][0] * d[0] + P[i][1] * d[1] + P[i][2] * d[2]; if (v > bv) { bv = v; bi = i; } } return P[bi]; }
function solveLin(G, b) {
  const n = b.length, M = G.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-24) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function affineClosest(S) {
  if (S.length === 1) return { p: S[0], lam: [1] };
  const E = S.slice(1).map((q) => sub(q, S[0]));
  const mu = solveLin(E.map((a) => E.map((b) => dot(a, b))), E.map((a) => -dot(a, S[0]))); if (!mu) return null;
  let p = S[0].slice(); mu.forEach((m, i) => { p = add(p, mul(E[i], m)); });
  return { p, lam: [1 - mu.reduce((a, b) => a + b, 0), ...mu] };
}
function closestOnSimplex(W) {
  let best = null;
  for (let mask = 1; mask < (1 << W.length); mask++) {
    const S = W.filter((_, i) => mask & (1 << i)), r = affineClosest(S);
    if (!r || r.lam.some((l) => l < -1e-12)) continue;
    const d2 = dot(r.p, r.p);
    if (!best || d2 < best.d2 - 1e-20) best = { d2, p: r.p, S };
  }
  return best;
}
function gjkDistance(A, B) {
  let v = sub(A[0], B[0]), W = [];
  for (let it = 0; it < 64; it++) {
    const vv = dot(v, v); if (vv < 1e-14) return 0;
    const w = sub(support(A, mul(v, -1)), support(B, v));
    if (vv - dot(v, w) <= 1e-10 + 1e-12 * vv) return Math.sqrt(vv);
    if (W.some((q) => q[0] === w[0] && q[1] === w[1] && q[2] === w[2])) return Math.sqrt(vv);
    W.push(w);
    const r = closestOnSimplex(W); if (!r) return Math.sqrt(vv);
    W = r.S; v = r.p;
    if (W.length === 4) return 0;
  }
  return norm(v);
}

// ---------------- tunables (all in metres) ----------------
export const SLIDE_DEFAULTS = {
  rail: { minL: 0.10, minAspect: 6, maxSectionRatio: 4, minSection: 0.005 },
  notRail: ['wheel', 'motor', 'servo', 'electronics', 'fastener', 'belt'],
  parallelDeg: 3,
  minAxialOverlap: 0.5,     // of the shorter rail
  minLengthRatio: 0.5,
  packGap: 0.005,           // rails this close side by side are one stack
  bridgeGap: 0.020,         // a lone stage this close joins a stack if a fitting touches both
  nestOverlap: 0.25,        // section overlap (of the thinner) that makes two neighbours NESTED
  nested: 'slide',          // 'slide': nested members slide (physical); 'rigid': nested = one stage (the ITD hand spec)
  profileTol: 0.0015,       // two rail sections within this (or 15%) are the same profile
  maxStages: 8,
  touch: 0.0015,            // contact tolerance (thinned hull points sit a little inside the real surface)
  seedGap: 0.006,           // parts this close to a floor wheel count as the drivetrain
  hwMaxSize: 0.10, hwMaxFrac: 0.35, // end hardware: at most this big (and this share of the rail length)
  hwMarginS: 0.001, hwMarginW: 0.015, hwMarginT: 0, endZone: 0.3,
  overlapFrac: 0.2,         // side-by-side stages: overlap kept when extended
  drawerStroke: 0.6,        // a nested (ball-bearing drawer) pair: stroke / length (MISUMI SAR2 datasheet: 60/100, 180/300)
  carriageBlocks: true,     // a short block riding the outermost stage (cut into its section) is one more stage
  carriageMaxFrac: 0.35,    // ... at most this share of the rail length long
  carriagePen: 0.002, carriagePenFrac: 0.15, // ... and cut at least this deep (and this share of the rail's thickness) into it
  carriageMaxSection: 4,    // ... and no more than this many times the rail's section across (a plate the rail runs through is not one)
  notCarriage: ['wheel', 'motor', 'servo', 'electronics', 'fastener', 'belt'],
  notHardware: ['motor', 'servo', 'electronics'],
  slideWords: /slide|rail|viper|linear|telescop|drawer|misumi|\bsar ?\d|stage/i,
  structureWords: /channel|beam|plate|bracket|gusset|standoff|spacer|shaft|axle|tube|pipe|extrusion|\b11(0[1-9]|1\d|2[0-9])-\d{4}-\d{4}\b/i,
  verticalCos: 0.7,         // |axis.z| above this: a lift, extends up
  mountAreaRatio: 3,        // an outer side-by-side rail with this many times the pack's median section is a frame mount
  mirrorTol: 0.02,          // mirror copies: section centres this close after reflecting across x=0 or y=0
  payloadEndFrac: 0.15,     // payload this far (of the rail length) from the middle marks the extending end
};

// ---------------- the finder ----------------
export function findSlides(cad, opts = {}) {
  const O = { ...SLIDE_DEFAULTS, ...opts };
  const S = cad.solids || [];
  const N = S.length;
  const cosPar = Math.cos(O.parallelDeg * Math.PI / 180);

  // 1. part features
  const F = S.map((s, i) => {
    if (!s.pts || s.pts.length < 4) return null;
    const { c, axes } = principalAxes(s.pts);
    const [a, b, w] = axes, ta = span(s.pts, a), tb = span(s.pts, b), tw = span(s.pts, w);
    const sec = [len(tb), len(tw)].sort((x, y) => y - x);
    return { i, c, a, b, w, L: len(ta), sec };
  });
  const BB = S.map((s) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const p of s.pts || []) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; } return [lo, hi]; });
  const isRail = (f) => f && !O.notRail.includes(S[f.i].kind) && f.L >= O.rail.minL && f.L / f.sec[0] >= O.rail.minAspect &&
    f.sec[1] >= O.rail.minSection && f.sec[0] / f.sec[1] <= O.rail.maxSectionRatio;
  const rails = F.filter(isRail);

  // 2. contact graph
  const adj = S.map(() => new Set());
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const [a0, a1] = BB[i], [b0, b1] = BB[j];
    if (a0[0] > b1[0] + O.touch || b0[0] > a1[0] + O.touch || a0[1] > b1[1] + O.touch || b0[1] > a1[1] + O.touch || a0[2] > b1[2] + O.touch || b0[2] > a1[2] + O.touch) continue;
    if (gjkDistance(S[i].pts, S[j].pts) <= O.touch) { adj[i].add(j); adj[j].add(i); }
  }
  const small = (i) => { const [lo, hi] = BB[i]; return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) <= O.hwMaxSize; };

  // 3. stacks
  const pairInfo = (A, B) => {
    if (Math.abs(dot(A.a, B.a)) < cosPar) return null;
    const a = A.a, e1 = A.b, e2 = unit(cross(a, e1)), PA = S[A.i].pts, PB = S[B.i].pts;
    const ta = span(PA, a), tb = span(PB, a);
    if (ovl(ta, tb) / Math.min(len(ta), len(tb)) < O.minAxialOverlap) return null;
    if (Math.min(A.L, B.L) / Math.max(A.L, B.L) < O.minLengthRatio) return null;
    return Math.hypot(gap1(span(PA, e1), span(PB, e1)), gap1(span(PA, e2), span(PB, e2)));
  };
  // Stages of one slide have like sections (within mountAreaRatio in area),
  // or one sits inside the other (a telescope); a much bigger member packed
  // against a slide is the frame it is bolted to.
  const likeSection = (A, B) => { const u = A.sec[0] * A.sec[1], v = B.sec[0] * B.sec[1]; return Math.max(u, v) <= O.mountAreaRatio * Math.min(u, v); };
  const nestedPair = (A, B) => { const a = A.a, e1 = A.b, e2 = unit(cross(a, e1)), PA = S[A.i].pts, PB = S[B.i].pts;
    const o = ovl(span(PA, e1), span(PB, e1)) * ovl(span(PA, e2), span(PB, e2));
    return o >= 0.5 * Math.min(len(span(PA, e1)) * len(span(PA, e2)), len(span(PB, e1)) * len(span(PB, e2))); };
  const par = new Map(rails.map((f) => [f.i, f.i]));
  const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (let x = 0; x < rails.length; x++) for (let y = x + 1; y < rails.length; y++) {
    const g = pairInfo(rails[x], rails[y]);
    if (g != null && g <= O.packGap && (likeSection(rails[x], rails[y]) || nestedPair(rails[x], rails[y]))) par.set(find(rails[x].i), find(rails[y].i));
  }
  const groupsM = new Map();
  for (const f of rails) { const r = find(f.i); if (!groupsM.has(r)) groupsM.set(r, []); groupsM.get(r).push(f); }
  let groups = [...groupsM.values()];
  // two packs a little further apart (a rail missing from the CAD leaves a
  // wider gap) are one stack when a small fitting touches both
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let x = 0; x < groups.length; x++) for (let y = x + 1; y < groups.length; y++) {
      let d = Infinity;
      // only between rails of like section (a missing member leaves a gap
      // between two of the same kind; a frame channel nearby is not one)
      for (const A of groups[x]) for (const B of groups[y]) { const q = likeSection(A, B) ? pairInfo(A, B) : null; if (q != null) d = Math.min(d, q); }
      if (d > O.bridgeGap) continue;
      const hy = new Set(groups[y].map((f) => f.i));
      let bridged = false;
      for (const A of groups[x]) for (const j of adj[A.i]) if (!hy.has(j) && small(j) && [...adj[j]].some((k) => hy.has(k))) bridged = true;
      if (!bridged) continue;
      groups[x] = groups[x].concat(groups[y]); groups.splice(y, 1); merged = true; break outer;
    }
  }
  // Vendor vocabulary as a veto only: a side-by-side pack (nothing nested)
  // whose rails are mostly named as structural stock (U-channel, flat beam,
  // plate, tube, goBILDA 1101-1129 structure part numbers ...) and none as a
  // slide (slide, rail, viper, linear, drawer ...) is a doubled frame member.
  // Nested packs are never vetoed: one member inside another is a telescope.
  const vetoed = (st) => {
    if (st.hasNest) return false;
    const nm = st.rails.map((f) => String(S[f.i].name || '') + ' ' + String(S[f.i].part || ''));
    if (nm.some((n) => O.slideWords.test(n))) return false;
    return nm.filter((n) => O.structureWords.test(n)).length * 2 >= nm.length;
  };
  const stacks = groups.map(layout).filter((g) => g.stages.length >= 2 && g.stages.length <= O.maxStages && !vetoed(g));

  /* The stack frame (a = rail axis, s = stacking direction, w = a x s) and its
     stages. Rails are walked in order across the stack; between two
     neighbours is a junction, either NESTED (their sections overlap: one sits
     in the other's channel, or they interlock) or a GAP (side by side).
     O.nested = 'slide' (default): a nested pair is a sliding interface (a
       drawer slide's outer and inner member, or interlocking extrusions). In a
       stack that has such pairs, a gap between two DIFFERENT profiles is a
       rigid join (one slide's inner member bolted to the next one's outer
       member); a gap between two same-profile rails is still a sliding
       interface (a member is missing between them). In a stack with no nested
       pairs every rail is its own stage (Viper-style, side by side).
     O.nested = 'rigid': the reading of the hand-written Into The Deep spec,
       a nested pair is one stage and every gap is a sliding interface. */
  function layout(g) {
    let a = g[0].a; const aa = [0, 0, 0];
    for (const f of g) { const sg = Math.sign(dot(f.a, a)) || 1; for (let k = 0; k < 3; k++) aa[k] += f.a[k] * sg; }
    a = unit(aa);
    for (let k = 0; k < 3; k++) if (Math.abs(a[k]) > 0.99995) { a = [0, 0, 0]; a[k] = 1; }
    const cc = centroidOf(g.map((f) => f.c));
    const proj = g.map((f) => { const d = sub(f.c, cc); return sub(d, mul(a, dot(d, a))); });
    let s;
    if (g.length >= 2 && Math.max(...proj.map(norm)) > 0.002) s = principalAxes(proj.concat(proj.map((p) => mul(p, -1)))).axes[0];
    else s = g[0].b;
    s = unit(sub(s, mul(a, dot(s, a))));
    for (let k = 0; k < 3; k++) if (Math.abs(s[k]) > 0.9995) { s = [0, 0, 0]; s[k] = 1; }
    const w = unit(cross(a, s));
    let R = g.map((f) => ({ i: f.i, f, t: span(S[f.i].pts, a), s: span(S[f.i].pts, s), w: span(S[f.i].pts, w) }));
    R.sort((x, y) => mid(x.s) - mid(y.s));
    // The frame member a slide is bolted flat against (a U-channel upright, a
    // tube) is long, thin and parallel too. An outermost rail that sits beside
    // its neighbour (not nested in it) and has a much bigger section than the
    // rest of the pack, or is named as structural stock while the rest is not,
    // is that mount, not a stage.
    const area = (r) => len(r.s) * len(r.w);
    const nameOf = (r) => String(S[r.i].name || '') + ' ' + String(S[r.i].part || '');
    const structural = (r) => O.structureWords.test(nameOf(r)) && !O.slideWords.test(nameOf(r));
    const trimmed = [];
    for (let again = true; again && R.length > 2;) {
      again = false;
      for (const end of [0, R.length - 1]) {
        const nb = R[end === 0 ? 1 : R.length - 2];
        if (ovl(R[end].s, nb.s) / Math.min(len(R[end].s), len(nb.s)) >= O.nestOverlap) continue;
        const others = R.filter((_, q) => q !== end).map(area).sort((x, y) => x - y);
        const med = others[others.length >> 1];
        if (area(R[end]) > O.mountAreaRatio * med || (structural(R[end]) && R.some((r, q) => q !== end && !structural(r)))) {
          trimmed.push(R[end].i); R = R.filter((_, q) => q !== end); again = true; break;
        }
      }
    }
    if (trimmed.length) g = g.filter((f) => !trimmed.includes(f.i));
    const J = [];
    for (let j = 0; j + 1 < R.length; j++) {
      const A = R[j], B = R[j + 1], o = ovl(A.s, B.s);
      const nested = o / Math.min(len(A.s), len(B.s)) >= O.nestOverlap;
      J.push({ nested, pos: nested ? (Math.max(A.s[0], B.s[0]) + Math.min(A.s[1], B.s[1])) / 2 : (A.s[1] + B.s[0]) / 2 });
    }
    const hasNest = J.some((x) => x.nested);
    const tol = (u, v) => Math.max(O.profileTol, 0.15 * Math.max(u, v));
    const sameProfile = (A, B) => Math.abs(len(A.s) - len(B.s)) <= tol(len(A.s), len(B.s)) && Math.abs(len(A.w) - len(B.w)) <= tol(len(A.w), len(B.w));
    J.forEach((x, j) => {
      if (O.nested === 'rigid') x.rigid = x.nested;
      else x.rigid = !x.nested && hasNest && !sameProfile(R[j], R[j + 1]);
    });
    const stages = [{ rails: [R[0].i], s: R[0].s.slice(), t: R[0].t.slice(), w: R[0].w.slice() }];
    R.forEach((r, j) => {
      if (!j) return;
      const cur = stages[stages.length - 1];
      if (J[j - 1].rigid) { cur.rails.push(r.i); cur.s = hull([cur.s, r.s]); cur.t = hull([cur.t, r.t]); cur.w = hull([cur.w, r.w]); }
      else stages.push({ rails: [r.i], s: r.s.slice(), t: r.t.slice(), w: r.w.slice() });
    });
    const walk = new Map(); stages.forEach((x, k) => x.rails.forEach((i) => walk.set(i, k)));
    J.forEach((x, j) => { x.a = walk.get(R[j].i); x.b = walk.get(R[j + 1].i); });
    // in a drawer-slide chain every member has one nested (sliding) neighbour
    // and one rigid join; a same-profile gap means the member between is
    // missing, and the fittings there hold the neighbour that already has its
    // sliding partner on the other side
    if (O.nested !== 'rigid' && hasNest) J.forEach((x, j) => {
      if (x.nested || x.rigid) return;
      const pre = J[j - 1], post = J[j + 1];
      if (pre && pre.nested && !(post && post.nested)) x.missing = x.a;
      else if (post && post.nested && !(pre && pre.nested)) x.missing = x.b;
    });
    // the kind of each sliding interface, between walk stages k and k+1
    const iface = []; J.forEach((x) => { if (!x.rigid) iface[Math.min(x.a, x.b)] = { nested: x.nested, missing: x.missing != null }; });
    return { rails: g, R, J, a, s, w, stages, walk, hasNest, trimmed, iface };
  }


  // 4. end-hardware candidates: small parts inside the stack's envelope
  const railOf = new Map(); stacks.forEach((st, k) => st.rails.forEach((f) => railOf.set(f.i, k)));
  for (const st of stacks) {
    st.L = Math.max(...st.stages.map((x) => len(x.t)));
    st.env = { t: hull(st.stages.map((x) => x.t)), s: [st.R[0].s[0], st.R[st.R.length - 1].s[1]], w: hull(st.stages.map((x) => x.w)) };
    st.hw = [];
    for (let i = 0; i < N; i++) {
      if (railOf.has(i) || !S[i].pts || !S[i].pts.length || O.notHardware.includes(S[i].kind)) continue;
      const [lo, hi] = BB[i], size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      if (size > Math.min(O.hwMaxSize, O.hwMaxFrac * st.L)) continue;
      const c = centroidOf(S[i].pts), ct = dot(c, st.a), cs = dot(c, st.s), cw = dot(c, st.w);
      if (cs < st.env.s[0] - O.hwMarginS || cs > st.env.s[1] + O.hwMarginS) continue;
      if (cw < st.env.w[0] - O.hwMarginW || cw > st.env.w[1] + O.hwMarginW) continue;
      if (ct < st.env.t[0] - O.hwMarginT || ct > st.env.t[1] + O.hwMarginT) continue;
      st.hw.push({ i, t: ct, s: cs, w: cw });
    }
  }
  const inStack = new Set(); for (const st of stacks) { st.rails.forEach((f) => inStack.add(f.i)); st.hw.forEach((h) => inStack.add(h.i)); }

  // 5. the fixed stage. Floor wheels (and whatever sits within seedGap of one:
  // CAD often leaves a few mm between a wheel and its hub or frame) seed the
  // drivetrain; hops are counted over contacts that avoid every slide. Of a
  // stack's two outer stages, the one whose outside attachments are fewer hops
  // from the wheels is bolted to the frame; the other carries the payload.
  let seeds = []; for (let i = 0; i < N; i++) if (S[i].kind === 'wheel' && BB[i][0][2] < 0.02) seeds.push(i);
  if (!seeds.length) for (let i = 0; i < N; i++) if (BB[i][0][2] < 0.01) seeds.push(i);
  { const base = new Set(seeds), more = [];
    for (let i = 0; i < N; i++) if (!base.has(i) && S[i].kind !== 'wheel') for (const j of base) {
      const [a0, a1] = BB[i], [b0, b1] = BB[j], g = O.seedGap;
      if (a0[0] > b1[0] + g || b0[0] > a1[0] + g || a0[1] > b1[1] + g || b0[1] > a1[1] + g || a0[2] > b1[2] + g || b0[2] > a1[2] + g) continue;
      if (gjkDistance(S[i].pts, S[j].pts) <= g) { more.push(i); break; } }
    seeds = seeds.concat(more); }
  const hop = new Array(N).fill(Infinity), q = [];
  for (const i of seeds) if (!inStack.has(i)) { hop[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) { const i = q[h]; for (const j of adj[i]) if (hop[j] === Infinity && !inStack.has(j)) { hop[j] = hop[i] + 1; q.push(j); } }
  const reach = (start) => { const seen = new Set(start.filter((j) => !inStack.has(j))), qq = [...seen];
    for (let h = 0; h < qq.length; h++) for (const j of adj[qq[h]]) if (!seen.has(j) && !inStack.has(j)) { seen.add(j); qq.push(j); }
    return seen.size; };
  for (const st of stacks) {
    const n = st.stages.length, own = new Set([...st.rails.map((f) => f.i), ...st.hw.map((h) => h.i)]);
    const outside = (k) => { const out = new Set(); for (const i of st.stages[k].rails) for (const j of adj[i]) if (!own.has(j) && !railOf.has(j)) out.add(j); return [...out]; };
    const ends = [0, n - 1].map((k) => { const att = outside(k); return { k, att, hop: Math.min(Infinity, ...att.map((j) => hop[j])) }; });
    st.why = [];
    let fixedK;
    if (ends[0].hop !== ends[1].hop) {
      fixedK = ends[0].hop < ends[1].hop ? 0 : n - 1;
      st.why.push('fixed: outer stages\' outside attachments are ' + ends.map((e) => e.hop).join(' vs ') + ' contact hops from the wheels');
    } else {
      const r = ends.map((e) => reach(e.att));
      if (r[0] !== r[1]) { fixedK = r[0] > r[1] ? 0 : n - 1; st.why.push('fixed: tie on hops, took the outer stage attached to the bigger part of the robot (' + r.join(' vs ') + ' parts)'); }
      else {
        const zc = (k) => mid(st.stages[k].s) * st.s[2] + mid(st.stages[k].w) * st.w[2];
        fixedK = zc(0) <= zc(n - 1) ? 0 : n - 1;
        st.why.push('fixed: no attachment evidence, took the lower outer stage (a guess)');
        st.weak = true;
      }
    }
    st.flipped = fixedK !== 0;
    if (st.flipped) st.stages.reverse();
    st.nRail = n;
    st.ifaceFO = []; for (let k = 0; k + 1 < n; k++) st.ifaceFO.push(st.iface[st.flipped ? n - 2 - k : k] || { nested: false });
    st.fixedAtt = ends.find((e) => e.k === fixedK).att;
    st.carAtt = ends.find((e) => e.k !== fixedK).att;
  }

  // 5b. a carriage block: a short part riding the outermost moving stage (a
  // bearing block or carriage plate drawn cut into the rail's section from
  // the outside of the stack) is one more stage. A mount bolted to the rail
  // sits flush against it (no cut) or runs most of its length.
  for (const st of stacks) {
    st.blocks = [];
    if (!O.carriageBlocks) continue;
    const last = st.stages[st.stages.length - 1], Lr = len(last.t);
    const outerHi = st.flipped ? false : true;   // the last stage is at the high-s end of the walk unless flipped
    const blocks = [];
    for (const j of st.carAtt) {
      if (railOf.has(j) || O.notCarriage.includes(S[j].kind) || !S[j].pts || S[j].pts.length < 4) continue;
      const P = S[j].pts, ps = span(P, st.s), pw = span(P, st.w), pt = span(P, st.a);
      if (len(pt) > O.carriageMaxFrac * Lr || mid(pt) < last.t[0] || mid(pt) > last.t[1]) continue;
      if (outerHi ? ps[1] <= last.s[1] + O.touch : ps[0] >= last.s[0] - O.touch) continue;   // must reach out past the stack
      let ok = false;
      for (const r of last.rails) {
        const rs = span(S[r].pts, st.s), rw = span(S[r].pts, st.w);
        const pen = ovl(rs, ps);
        if (Math.max(len(ps), len(pw)) > O.carriageMaxSection * Math.max(len(rs), len(rw))) continue;
        if (pen >= Math.max(O.carriagePen, O.carriagePenFrac * len(rs)) && ovl(rw, pw) >= 0.5 * len(rw)) ok = true;
      }
      if (ok) blocks.push(j);
    }
    if (!blocks.length) continue;
    const P = blocks.flatMap((j) => S[j].pts);
    st.blocks = blocks;
    st.stages.push({ rails: [], blocks, s: span(P, st.s), t: span(P, st.a), w: span(P, st.w), block: true });
    st.ifaceFO.push({ nested: false, block: true });
    const own = new Set([...st.rails.map((f) => f.i), ...st.hw.map((h) => h.i), ...blocks]);
    const att = new Set(); for (const j of blocks) for (const k of adj[j]) if (!own.has(k) && !railOf.has(k)) att.add(k);
    st.railCarAtt = st.carAtt.filter((j) => !blocks.includes(j));
    st.carAtt = [...att];
    st.why.push('carriage: ' + blocks.length + ' short part(s) cut ' + 'into the outermost stage ride it as one more stage');
  }

  // 6. extension direction along the rails: vertical stacks extend up; others
  // toward the end the moving stage's payload sits at, else toward the nearer
  // edge of the robot
  const all = []; for (let i = 0; i < N; i++) all.push(BB[i][0], BB[i][1]);
  for (const st of stacks) {
    const a = st.a, tm = mid(st.env.t);
    let sign;
    if (Math.abs(a[2]) > O.verticalCos) { sign = Math.sign(a[2]); st.why.push('direction: vertical, extends up'); }
    else {
      const pay = st.carAtt;
      const tp = pay.length ? pay.reduce((acc, j) => acc + dot(centroidOf(S[j].pts), a) - tm, 0) / pay.length : 0;
      if (Math.abs(tp) > O.payloadEndFrac * st.L) { sign = Math.sign(tp); st.why.push('direction: toward the moving stage\'s payload (' + (tp * 1000).toFixed(0) + ' mm from the rail middle)'); }
      else {
        let hiA = -Infinity, loA = Infinity; for (const p of all) { const t = dot(p, a); if (t > hiA) hiA = t; if (t < loA) loA = t; }
        const mPlus = hiA - st.env.t[1], mMinus = st.env.t[0] - loA;
        sign = mPlus <= mMinus ? 1 : -1;
        st.why.push('direction: toward the nearer robot edge (' + (mPlus * 1000).toFixed(0) + ' vs ' + (mMinus * 1000).toFixed(0) + ' mm to spare)');
        st.weakDir = true;
      }
    }
    st.dir = mul(a, sign);
  }

  // 7. mechanisms: parallel stacks with the same stage count, length and
  // place along the rails are copies (mirror images) that move together
  const sectionCentre = (st) => add(mul(st.s, mid(st.env.s)), mul(st.w, mid(st.env.w)));
  const used = new Set(), mechanisms = [];
  stacks.forEach((st, k) => {
    if (used.has(k)) return;
    const members = [k]; used.add(k);
    stacks.forEach((o, j) => {
      if (used.has(j)) return;
      if (Math.abs(dot(o.a, st.a)) < cosPar || o.stages.length !== st.stages.length) return;
      if (Math.min(o.L, st.L) / Math.max(o.L, st.L) < 0.8) return;
      const ta = st.env.t, tb = dot(o.a, st.a) > 0 ? o.env.t : [-o.env.t[1], -o.env.t[0]];
      if (ovl(ta, tb) / Math.min(len(ta), len(tb)) < 0.7) return;
      // and either mirror images across the robot's centre plane, or one
      // payload: a part touching both carriages (or what they carry)
      const ca = sectionCentre(st), cb = sectionCentre(o);
      const mirror = [0, 1].some((k) => { const r = cb.slice(); r[k] = -r[k]; return norm(sub(r, ca)) <= O.mirrorTol; });
      const carA = new Set([...st.stages[st.stages.length - 1].rails, ...(st.blocks || []), ...st.carAtt]);
      const carB = new Set([...o.stages[o.stages.length - 1].rails, ...(o.blocks || []), ...o.carAtt]);
      let bridge = false;
      for (let i = 0; i < N && !bridge; i++) {
        if (railOf.has(i)) continue;
        const nb = [...adj[i]];
        if ((carA.has(i) || nb.some((x) => carA.has(x))) && (carB.has(i) || nb.some((x) => carB.has(x)))) bridge = true;
      }
      if (!mirror && !bridge) return;
      members.push(j); used.add(j);
    });
    // the copies agree on a direction: a strong cue beats a weak one, then a vote
    const strong = members.filter((j) => !stacks[j].weakDir);
    const pool = strong.length ? strong : members;
    const votes = pool.reduce((acc, j) => acc + Math.sign(dot(stacks[j].dir, st.dir)), 0);
    const dir = votes >= 0 ? st.dir : mul(st.dir, -1);
    for (const j of members) if (dot(stacks[j].dir, dir) < 0) { stacks[j].why.push('direction flipped to agree with its copies'); stacks[j].dir = mul(stacks[j].dir, -1); }
    mechanisms.push({ stacks: members, dir });
  });

  // 8. end hardware -> stages. Each fitting goes to the junction nearest it
  // across the stack: a rigid join's fitting rides that stage; a sliding
  // interface's fitting rides the INNER stage at the inner stage's retracted
  // end and the OUTER stage at the outer stage's extended end.
  for (const st of stacks) {
    const n = st.stages.length, sd = dot(st.dir, st.a) >= 0 ? 1 : -1;
    st.stages.forEach((g) => { g.hw = []; g.tr = sd > 0 ? g.t[0] : g.t[1]; g.te = sd > 0 ? g.t[1] : g.t[0]; g.L = len(g.t); });
    st.retractedT = st.stages[0].tr;
    const kOf = (wk) => (st.flipped ? st.nRail - 1 - wk : wk);   // walk order -> fixed-outward order
    const lo = st.R[0].s[0], hi = st.R[st.R.length - 1].s[1];
    for (const h of st.hw) {
      // near an end of some stage (stages drawn part-way out have their ends at different places)
      const nearEnd = st.stages.some((g) => !g.block && Math.min(Math.abs(h.t - g.t[0]), Math.abs(h.t - g.t[1])) <= O.endZone * g.L);
      let k, why;
      let nr = null, dr = Infinity; for (const r of st.R) { const d = Math.abs(mid(r.s) - h.s); if (d < dr) { dr = d; nr = r; } }
      let nj = null, dj = Infinity; for (const x of st.J) { const d = Math.abs(x.pos - h.s); if (d < dj) { dj = d; nj = x; } }
      if (h.s < lo || h.s > hi) { k = kOf(h.s < lo ? 0 : st.walk.get(st.R[st.R.length - 1].i)); why = 'beside the stack: that outer stage'; }
      else if (!nearEnd || !nj) { k = kOf(st.walk.get(nr.i)); why = 'mid-length: nearest rail'; }
      else if (nj.rigid) { k = kOf(nj.a); why = 'fitting at a rigid join: that stage'; }
      else if (nj.missing != null) { k = kOf(nj.missing); why = 'fitting at a join whose partner member is missing from the CAD: the member it holds'; }
      else {
        const ka = kOf(nj.a), kb = kOf(nj.b), outerK = Math.min(ka, kb), innerK = Math.max(ka, kb);
        const dRet = Math.abs(h.t - st.stages[innerK].tr), dExt = Math.abs(h.t - st.stages[outerK].te);
        if (dRet <= dExt) { k = innerK; why = 'fitting between stages at the retracted end: inner stage'; }
        else { k = outerK; why = 'fitting between stages at the extended end: outer stage'; }
      }
      st.stages[k].hw.push(h.i);
      h.stage = k; h.why = why;
    }
    // 9. travel: rail length minus the overlap kept at full extension; the pose
    // the CAD was drawn in, per stage, from the stage before it
    st.travel = [];
    // a nested pair is a ball-bearing drawer slide (stroke drawerStroke x L);
    // side-by-side stages keep overlapFrac of the shorter rail; a carriage
    // block runs the length of its stage
    for (let k = 1; k < n; k++) {
      const f = st.ifaceFO[k - 1] || {};
      st.travel.push(f.block ? Math.max(0, st.stages[k - 1].L - st.stages[k].L)
        : Math.min(st.stages[k - 1].L, st.stages[k].L) * (f.nested || f.missing ? O.drawerStroke : 1 - O.overlapFrac));
    }
    st.stages.forEach((g, k) => { g.drawnOffset = k ? (g.tr - st.stages[k - 1].tr) * sd : 0; });
  }

  // joints: one per moving stage. The outermost moving stage (the carriage) is
  // the driven joint; the stages between follow it at k/(n-1) of its travel,
  // as cascade and continuous rigging both do at steady state.
  const joints = [], partMech = {};
  mechanisms.forEach((m, mi) => {
    const st0 = stacks[m.stacks[0]], n = st0.stages.length, base = 'slide' + (mi + 1);
    const ids = []; for (let k = 1; k < n; k++) ids.push(k === n - 1 ? base : base + ' stage ' + k);
    const piv = centroidOf(m.stacks.map((j) => { const st = stacks[j]; return add(add(mul(st.a, st.retractedT), mul(st.s, mid(st.env.s))), mul(st.w, mid(st.env.w))); }));
    m.id = base; m.jointIds = ids; m.pivot = piv;
    m.stages = []; for (let k = 0; k < n; k++) m.stages.push({ rails: [], hw: [], blocks: [] });
    for (const j of m.stacks) stacks[j].stages.forEach((g, k) => { m.stages[k].rails.push(...g.rails); m.stages[k].hw.push(...g.hw); m.stages[k].blocks.push(...(g.blocks || [])); });
    m.travel = st0.travel.map((_, k) => m.stacks.reduce((a, j) => a + stacks[j].travel[k], 0) / m.stacks.length);
    const total = m.travel.reduce((a, b) => a + b, 0);
    const drawn = (k) => m.stacks.reduce((a, j) => a + stacks[j].stages.slice(1, k + 1).reduce((b, g) => b + g.drawnOffset, 0), 0) / m.stacks.length;
    for (let k = 1; k < n; k++) {
      const id = ids[k - 1];
      joints.push({ id, kind: 'linear', axis: m.dir.slice(), pivot: piv.slice(), parent: 'chassis',
        limits: [0, k === n - 1 ? total : total * k / (n - 1)],
        couple: k === n - 1 ? null : { to: base, ratio: +(k / (n - 1)).toFixed(4) },
        drawn: drawn(k), stage: k, stages: n, copies: m.stacks.length,
        parts: [...m.stages[k].rails, ...m.stages[k].blocks, ...m.stages[k].hw] });
      for (const i of m.stages[k].rails.concat(m.stages[k].blocks, m.stages[k].hw)) partMech[i] = id;
    }
    m.carriageAttachments = [...new Set(m.stacks.flatMap((j) => stacks[j].carAtt))];
    m.fixedAttachments = [...new Set(m.stacks.flatMap((j) => stacks[j].fixedAtt))];
  });

  return {
    stacks: stacks.map((st) => ({
      axis: st.a, dir: st.dir, stackDir: st.s, length: st.L, retractedT: st.retractedT, drawerSlide: st.hasNest,
      stages: st.stages.map((g) => ({ rails: g.rails, blocks: g.blocks || [], hardware: g.hw, s: g.s, t: g.t, drawnOffset: g.drawnOffset })),
      interfaces: st.ifaceFO.map((f) => (f.block ? 'carriage block' : f.nested ? 'nested (drawer slide)' : 'side by side')),
      junctions: st.J.map((x) => ({ nested: x.nested, rigid: x.rigid, pos: x.pos })),
      travel: st.travel, why: st.why, weak: !!st.weak || !!st.weakDir,
      hardware: st.hw.map((h) => ({ i: h.i, stage: h.stage, why: h.why })),
      fixedAttachments: st.fixedAtt, carriageAttachments: st.carAtt,
    })),
    mechanisms: mechanisms.map((m) => ({ id: m.id, stacks: m.stacks, dir: m.dir, pivot: m.pivot, jointIds: m.jointIds, travel: m.travel,
      stages: m.stages, carriageAttachments: m.carriageAttachments, fixedAttachments: m.fixedAttachments })),
    joints, partMech,
  };
}

/* The finder's result as a joint spec in the bench's own file format
   (src/jointspec.js: millimetres, parts picked by solid index), so it can go
   straight through applyJointSpec(). One slider per moving stage; the stages
   between follow the carriage at k/(n-1). The fixed stage is left on the
   frame (parent chassis); a later step that knows about pivots may re-parent. */
export function toJointSpec(result, robot = 'auto-detected slides') {
  const mm = (v) => v.map((x) => +(x * 1000).toFixed(1));
  const joints = [];
  for (const m of result.mechanisms) {
    const n = m.stages.length, carriage = m.jointIds[m.jointIds.length - 1];
    const total = m.travel.reduce((a, b) => a + b, 0);
    for (let k = 1; k < n; k++) {
      const id = m.jointIds[k - 1];
      const j = { id, label: k === n - 1 ? `Slide ${m.id.slice(5)} (carriage)` : `Slide ${m.id.slice(5)}, stage ${k}`,
        kind: 'slider', axis: m.dir.map((v) => +v.toFixed(4)), pivot: mm(m.pivot),
        parts: [{ solid: [...m.stages[k].rails, ...m.stages[k].blocks, ...m.stages[k].hw] }] };
      if (k === n - 1) j.limits = [0, +(total * 1000).toFixed(0)];
      else j.follows = { joint: carriage, ratio: +(k / (n - 1)).toFixed(4) };
      joints.push(j);
    }
  }
  return { format: 'ftc-sim-bench.joints', version: 1, robot, about: 'Generated by findSlides(): geometry only, check before trusting.', joints };
}
