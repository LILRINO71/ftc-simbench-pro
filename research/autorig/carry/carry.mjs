/* ============================================================
   CARRY — which parts ride each joint, from geometry and assembly structure.

   Input: a parsed cad (cad.solids[i].pts, cad.occs[j].path), the joints
   (id, kind 'linear' | 'revolute-*', unit axis, pivot in metres, parent id or
   'chassis', optional couple {to, ratio}) and, per joint, a few SEED parts known
   to ride it. Output: label[i] = the joint part i rides, or null (the frame).

   Nothing here knows a robot: no part names, positions or subassembly names.
   The rules are physical:
     - Parts that touch (sampled convex hulls within tol) and are not separated
       by a joint move together.
     - A revolute joint can only separate two touching parts where they touch
       ON its axis (a spline in its servo, a shaft in its bore, a horn on a
       spline). A slide can only separate parts where one of them is a rail of
       that slide. Every other contact is rigid for that joint.
     - For joint J, everything rigidly reachable from outside J's subtree (the
       frame, and the seeds of every other joint) is NOT carried by J; J
       carries whatever else its seeds reach. ("Largest child": a coaxial part
       that could be on either side goes with the child unless the parent
       holds it by an off-axis contact.)
     - Multi-stage slides: a part between two stages' rails rides the outer
       stage at the extension end and the inner stage at the retract end
       (where cascade/continuous rigging puts pulleys). The fixed rails are the
       long parallel parts beside a seeded rail that overlap it along the slide,
       which holds at any extension (the CAD may be drawn extended).
     - A ring on a joint's axis (a flanged bearing, a bushing) reached only
       across that axis, sitting mostly inside a part the outside holds, is
       housed in it and rides the outside.
     - Every revolute joint turns a link: if a joint's seeds hold nothing, what
       its child reaches only across the child's axis is that link.
     - Frame anchors: parts on the floor plus the biggest low part; if none of
       those touches anything, the biggest part in the lower half.
   Methods: 'subasm' (subassembly-first baseline), 'nearest' (contact graph,
   nearest seed wins, no cuts), 'contact' (contact graph with joint cuts),
   'combined' (contact + subassembly constraints).

   inferCarry(cad, joints, seeds, opts) -> {label[i]: joint id | null, members{id: [i]},
     ms{graph, assign}, info{claims, crossCut, anchors, groups}}; pass opts.graph (from
   contactGraph(cad)) to reuse the contact graph across calls. */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const mean = (P) => { const c = [0, 0, 0]; for (const p of P) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } const n = P.length || 1; return [c[0] / n, c[1] / n, c[2] / n]; };

/* ---------- convex hull as planes (incremental, like src/hull.js) ---------- */
function hullFaces(pts) {
  const n = pts.length; if (n < 4) return null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
  const diag = norm(sub(mx, mn)); if (!(diag > 0)) return null;
  const eps = diag * 1e-9;
  let i0 = 0, i1 = 0, best = -1; const ext = [];
  for (let k = 0; k < 3; k++) { let a = 0, b = 0; for (let i = 1; i < n; i++) { if (pts[i][k] < pts[a][k]) a = i; if (pts[i][k] > pts[b][k]) b = i; } ext.push(a, b); }
  for (const a of ext) for (const b of ext) { const d = sub(pts[a], pts[b]), L = dot(d, d); if (L > best) { best = L; i0 = a; i1 = b; } }
  const u = sub(pts[i1], pts[i0]); let i2 = -1; best = 0;
  for (let i = 0; i < n; i++) { const c = cross(u, sub(pts[i], pts[i0])), L = dot(c, c); if (L > best) { best = L; i2 = i; } }
  if (i2 < 0 || Math.sqrt(best) <= diag * diag * 1e-7) return null;
  const nr = cross(u, sub(pts[i2], pts[i0])), nl = norm(nr); let i3 = -1; best = 0;
  for (let i = 0; i < n; i++) { const d = Math.abs(dot(nr, sub(pts[i], pts[i0]))) / nl; if (d > best) { best = d; i3 = i; } }
  if (i3 < 0 || best <= diag * 1e-6) return null;
  const inside = mean([pts[i0], pts[i1], pts[i2], pts[i3]]);
  const faces = [];
  const face = (a, b, c) => {
    let nn = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a])); const L = norm(nn) || 1; nn = mul(nn, 1 / L);
    let d = dot(nn, pts[a]);
    if (dot(nn, inside) - d > 0) { const t = b; b = c; c = t; nn = mul(nn, -1); d = -d; }
    faces.push({ a, b, c, n: nn, d, alive: true });
  };
  face(i0, i1, i2); face(i0, i1, i3); face(i0, i2, i3); face(i1, i2, i3);
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2 || i === i3) continue;
    const p = pts[i], seen = [];
    for (const f of faces) if (f.alive && dot(f.n, p) - f.d > eps) seen.push(f);
    if (!seen.length) continue;
    const edges = new Map();
    for (const f of seen) { f.alive = false; edges.set(f.a + ',' + f.b, [f.a, f.b]); edges.set(f.b + ',' + f.c, [f.b, f.c]); edges.set(f.c + ',' + f.a, [f.c, f.a]); }
    for (const [, e] of edges) if (!edges.has(e[1] + ',' + e[0])) face(e[0], e[1], i);
  }
  const out = faces.filter((f) => f.alive).map((f) => ({ n: f.n, d: f.d }));
  return out.length >= 4 ? out : null;
}
function boxCorners(pts, t = 0.0015) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
  for (let k = 0; k < 3; k++) if (mx[k] - mn[k] < t) { const c = (mx[k] + mn[k]) / 2; mn[k] = c - t / 2; mx[k] = c + t / 2; }
  const out = []; for (let i = 0; i < 8; i++) out.push([i & 1 ? mx[0] : mn[0], i & 2 ? mx[1] : mn[1], i & 4 ? mx[2] : mn[2]]); return out;
}
function partHull(pts) {
  let P = pts, F = hullFaces(P);
  if (!F) { P = boxCorners(pts.length ? pts : [[0, 0, 0]]); F = hullFaces(P); }
  return { P, planes: F || [] };
}
const hullSD = (H, x) => { let m = -Infinity; for (const f of H.planes) { const v = f.n[0] * x[0] + f.n[1] * x[1] + f.n[2] * x[2] - f.d; if (v > m) m = v; } return m; };

/* ---------- GJK distance between two convex point sets, with witness points ---------- */
function support(P, d) { let b = -Infinity, bi = 0; for (let i = 0; i < P.length; i++) { const p = P[i], v = p[0] * d[0] + p[1] * d[1] + p[2] * d[2]; if (v > b) { b = v; bi = i; } } return P[bi]; }
const SUBSETS = [];
for (let n = 1; n <= 4; n++) { SUBSETS[n] = []; for (let m = 1; m < 16; m++) { const idx = [0, 1, 2, 3].filter((i) => m & (1 << i)); if (idx.every((i) => i < n)) SUBSETS[n].push(idx); } }
function affineClosest(W) {
  const k = W.length, s0 = W[0];
  if (k === 1) return { p: s0, lam: [1] };
  const E = []; for (let j = 1; j < k; j++) E.push(sub(W[j], s0));
  const m = k - 1, A = [];
  for (let i = 0; i < m; i++) { const r = []; for (let j = 0; j < m; j++) r.push(dot(E[i], E[j])); r.push(-dot(E[i], s0)); A.push(r); }
  for (let c = 0; c < m; c++) {
    let pv = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r;
    if (Math.abs(A[pv][c]) < 1e-30) return null;
    [A[c], A[pv]] = [A[pv], A[c]];
    for (let r = 0; r < m; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q <= m; q++) A[r][q] -= f * A[c][q]; }
  }
  const mu = A.map((r, i) => r[m] / r[i]); let l0 = 1; for (const u of mu) l0 -= u;
  let p = s0.slice(); for (let j = 0; j < m; j++) p = add(p, mul(E[j], mu[j]));
  return { p, lam: [l0, ...mu] };
}
function gjk(P, Q) {
  let S = [{ w: sub(P[0], Q[0]), a: P[0], b: Q[0] }], lam = [1], v = S[0].w;
  const wit = () => { let a = [0, 0, 0], b = [0, 0, 0]; S.forEach((s, i) => { a = add(a, mul(s.a, lam[i])); b = add(b, mul(s.b, lam[i])); }); return { a, b }; };
  for (let it = 0; it < 64; it++) {
    const vv = dot(v, v);
    if (vv < 1e-18) return { d: 0, ...wit() };
    const a = support(P, mul(v, -1)), b = support(Q, v), w = sub(a, b);
    if (vv - dot(v, w) <= 1e-12 + 1e-10 * vv || S.some((s) => Math.abs(s.w[0] - w[0]) + Math.abs(s.w[1] - w[1]) + Math.abs(s.w[2] - w[2]) < 1e-15)) return { d: Math.sqrt(vv), ...wit() };
    const T = S.concat([{ w, a, b }]);
    let bestR = null;
    for (const idx of SUBSETS[T.length]) {
      const r = affineClosest(idx.map((i) => T[i].w));
      if (!r || r.lam.some((l) => l < -1e-9)) continue;
      const d = dot(r.p, r.p);
      if (!bestR || d < bestR.d - 1e-18 || (Math.abs(d - bestR.d) <= 1e-18 && idx.length < bestR.idx.length)) bestR = { d, p: r.p, lam: r.lam, idx };
    }
    if (!bestR) return { d: Math.sqrt(vv), ...wit() };
    S = bestR.idx.map((i) => T[i]); lam = bestR.lam; v = bestR.p;
    if (S.length === 4) return { d: 0, ...wit() };
  }
  return { d: Math.sqrt(dot(v, v)), ...wit() };
}

/* ---------- the contact graph ----------
   Edge {a, b, d, inA, inB, c, cp}: d = hull distance (0: overlap), inA = how many
   of a's sample points lie in b's hull (+tol) and inB the reverse, cp = those
   points (or the GJK witness points when there are none), c = their centroid.
   strong = both parts reach into each other (a bolted face, a spline in its
   servo) or one is mostly buried in the other (a screw in a plate); weak =
   hulls merely graze, which is what over-reaching hulls of concave parts do. */
export function contactGraph(cad, opts = {}) {
  const tol = opts.tol ?? 0.001, embed = opts.embed ?? 0.1;
  const S = cad.solids, n = S.length;
  const box = S.map((s) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of s.pts) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } return { mn, mx }; });
  const H = S.map((s) => partHull(s.pts));
  const edges = [], adj = Array.from({ length: n }, () => []);
  const order = [...Array(n).keys()].sort((a, b) => box[a].mn[0] - box[b].mn[0]);
  for (let ii = 0; ii < n; ii++) {
    const i = order[ii], bi = box[i];
    for (let jj = ii + 1; jj < n; jj++) {
      const j = order[jj], bj = box[j];
      if (bj.mn[0] > bi.mx[0] + tol) break;
      if (bj.mn[1] > bi.mx[1] + tol || bi.mn[1] > bj.mx[1] + tol || bj.mn[2] > bi.mx[2] + tol || bi.mn[2] > bj.mx[2] + tol) continue;
      const a = Math.min(i, j), b = Math.max(i, j);
      const g = gjk(H[a].P, H[b].P);
      if (g.d > tol) continue;
      const cpA = S[a].pts.filter((p) => hullSD(H[b], p) <= tol), cpB = S[b].pts.filter((p) => hullSD(H[a], p) <= tol);
      const inA = cpA.length, inB = cpB.length;
      const cp = inA + inB ? cpA.concat(cpB) : [g.a, g.b];
      const strong = (inA > 0 && inB > 0) || inA >= embed * S[a].pts.length || inB >= embed * S[b].pts.length;
      const e = { a, b, d: g.d, inA, inB, cp, c: mean(cp), strong, w: 1 + Math.min(inA, inB) + 0.25 * Math.max(inA, inB) };
      adj[a].push(edges.length); adj[b].push(edges.length); edges.push(e);
    }
  }
  return { edges, adj, box, H, tol };
}

/* ---------- joints: subtree, groups of slides, rails, cut tests ---------- */
const extentAlong = (pts, a) => { let lo = Infinity, hi = -Infinity; for (const p of pts) { const v = dot(p, a); if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
function perpBasis(a) { const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = cross(a, t); const un = mul(u, 1 / norm(u)); return [un, cross(a, un)]; }
/** How rail-like a part is along axis a: its length along a, and that over its widest cross dimension. */
export function railness(pts, a) {
  const [lo, hi] = extentAlong(pts, a), [u, v] = perpBasis(a);
  const eu = extentAlong(pts, u), ev = extentAlong(pts, v);
  const w = Math.max(eu[1] - eu[0], ev[1] - ev[0], 1e-4);
  return { len: hi - lo, ratio: (hi - lo) / w, lo, hi };
}

function prepJoints(cad, joints, seeds, G, opts) {
  const S = cad.solids;
  const byId = new Map(joints.map((j) => [j.id, j]));
  const parentOf = (id) => { const j = byId.get(id); return j && j.parent && byId.has(j.parent) ? j.parent : null; };
  const depth = new Map(); const dep = (id) => { if (id == null) return 0; if (depth.has(id)) return depth.get(id); depth.set(id, 0); const d = 1 + dep(parentOf(id)); depth.set(id, d); return d; };
  joints.forEach((j) => dep(j.id));
  const ancestors = (id) => { const out = []; let p = parentOf(id); let g = 0; while (p != null && g++ < 64) { out.push(p); p = parentOf(p); } return out; };
  const subtree = new Map(joints.map((j) => [j.id, new Set([j.id])]));
  for (const j of joints) for (const a of ancestors(j.id)) subtree.get(a).add(j.id);
  const isAnc = (a, b) => a !== b && ancestors(b).includes(a); // a strict ancestor of b

  // slide groups: parallel linear joints tied by parent, couple, or seeds that touch through one part
  const lin = joints.filter((j) => j.kind === 'linear');
  const gid = new Map(lin.map((j) => [j.id, j.id]));
  const find = (x) => { while (gid.get(x) !== x) x = gid.get(x); return x; };
  const union = (a, b) => gid.set(find(a), find(b));
  const nbr = (i) => new Set(G.adj[i].map((k) => (G.edges[k].a === i ? G.edges[k].b : G.edges[k].a)));
  const reach2 = (list) => { const s = new Set(list); for (const i of list) for (const j of nbr(i)) s.add(j); return s; };
  for (let x = 0; x < lin.length; x++) for (let y = x + 1; y < lin.length; y++) {
    const A = lin[x], B = lin[y];
    if (Math.abs(dot(A.axis, B.axis)) < 0.99) continue;
    const tied = parentOf(A.id) === B.id || parentOf(B.id) === A.id || (A.couple && A.couple.to === B.id) || (B.couple && B.couple.to === A.id);
    let touch = false;
    if (!tied) { const ra = reach2(seeds[A.id] || []), rb = reach2(seeds[B.id] || []); for (const i of ra) if (rb.has(i)) { touch = true; break; } }
    if (tied || touch) union(A.id, B.id);
  }
  const groups = new Map();
  for (const j of lin) { const r = find(j.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(j.id); }
  const groupOf = new Map(), grp = [];
  for (const [, ids] of groups) {
    const axis = byId.get(ids[0]).axis;
    const outer = ids.filter((id) => !ids.includes(parentOf(id)));
    const gp = outer.length ? parentOf(outer[0]) : null; // what the fixed rails belong to
    // rails: seeds long along the axis
    const rails = new Map(), cands = [];
    const seedRails = [];
    for (const id of ids) for (const i of seeds[id] || []) { const r = railness(S[i].pts, axis); if (r.len >= (opts.railMin ?? 0.05) && r.ratio >= (opts.railRatio ?? 3)) { rails.set(i, id); seedRails.push({ i, ...r }); } }
    // the fixed rails nobody seeded: long parallel parts right beside the seed rails
    if (seedRails.length && opts.fixedRails !== false) {
      const L = seedRails.map((r) => r.len).sort((a, b) => a - b)[seedRails.length >> 1];
      const seedSet = new Set(Object.values(seeds).flat());
      const pool = [], span = new Map(seedRails.map((r) => [r.i, [r.lo, r.hi]]));
      for (let i = 0; i < S.length; i++) {
        if (seedSet.has(i) || rails.has(i)) continue;
        const r = railness(S[i].pts, axis);
        if (r.len < 0.75 * L || r.ratio < (opts.railRatio ?? 3)) continue;
        pool.push(i); span.set(i, [r.lo, r.hi]);
      }
      /* beside a seed rail, or beside a rail already found (the fixed stage may sit two stages
         out), and overlapping that rail along the slide: nested stages always overlap, at any
         extension, so this holds whatever pose the CAD was drawn in */
      const overlaps = (i, k) => { const a = span.get(i), b = span.get(k); return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) >= (opts.railOverlap ?? 0.1) * Math.min(a[1] - a[0], b[1] - b[0]); };
      const near = seedRails.map((r) => r.i), symAx = opts.mirrorRails === false ? -1 : lateralAxis(cad);
      for (let grew = true; grew;) {
        grew = false;
        for (let x = pool.length - 1; x >= 0; x--) {
          const i = pool[x];
          if (near.some((k) => (overlaps(i, k) && gjk(G.H[i].P, G.H[k].P).d <= (opts.fixedRailGap ?? 0.03)) || (symAx >= 0 && mirrorTwin(S[i].pts, S[k].pts, axis, symAx, opts)))) { cands.push(i); near.push(i); pool.splice(x, 1); grew = true; }
        }
      }
    }
    // outer-to-inner order: nesting depth, then share of the driver's travel
    const ratio = (id) => { const j = byId.get(id); return j.couple && ids.includes(j.couple.to) && Number.isFinite(j.couple.ratio) ? Math.abs(j.couple.ratio) : 1; };
    const rank = new Map(ids.map((id) => [id, dep(id) * 10 + ratio(id)]));
    rank.set(gp ?? null, -1);
    const g = { ids, axis, gp, rails, rank, cands };
    grp.push(g); for (const id of ids) groupOf.set(id, g);
  }
  return { byId, parentOf, depth, dep, ancestors, subtree, isAnc, groupOf, grp };
}

const FLOAT = 'float-rail';
/* contact edge e is one joint J can separate */
function cuttable(J, e, JP, G, opts) {
  if (J.kind !== 'linear' && JP.units && opts.motorUnits !== false) {
    const U = JP.units, ua = U.unit[e.a], ub = U.unit[e.b];
    if (ua >= 0 && ua === ub) return false;                 // inside one gearmotor
    if ((ua >= 0 && !U.out[e.a]) || (ub >= 0 && !U.out[e.b])) return false; // a gearmotor's body is bolted to its mount
  }
  if (J.kind === 'linear') {
    const g = JP.groupOf.get(J.id);
    return !!g && (g.rails.has(e.a) || g.rails.has(e.b));
  }
  const r = sub(e.c, J.pivot), al = dot(r, J.axis), pe = norm(sub(r, mul(J.axis, al)));
  if (pe > (opts.rAxis ?? 0.005) || Math.abs(al) > (opts.alongMax ?? 0.15)) return false;
  if (opts.spreadMax) { let m = 0; for (const p of e.cp) { const q = sub(p, J.pivot), t = dot(q, J.axis); m = Math.max(m, norm(sub(q, mul(J.axis, t)))); } if (m > opts.spreadMax) return false; }
  return true;
}

/* Gearmotors: a motor is coaxial with what it drives, so its can, gearbox and
   sleeve touch their mount ON the joint axis, just like a shaft in a bore. A
   motor is one rigid body up to its output: the parts of a motor subassembly
   (named like a motor, holding no seed) or a lone motor part never turn
   against what they touch, except through the output (shaft, axle, hub). */
const MOTOR_RE = /yellow ?jacket|gearmotor|\bmotor\b|(^|\D)520[234]-\d{4}/i;
const OUTPUT_RE = /shaft|axle|spline|horn|\bhub\b|output|pinion/i;
function motorUnits(cad, seedSet) {
  const n = cad.solids.length, unit = new Int32Array(n).fill(-1), out = new Uint8Array(n);
  const occ = new Map(); for (const o of cad.occs || []) if (o.solid != null && o.solid >= 0 && !occ.has(o.solid)) occ.set(o.solid, o);
  const keysOf = (i) => { const o = occ.get(i); if (!o) return []; const k = []; let acc = ''; o.path.forEach((p, d) => { acc += '/' + (p.k ?? '') + ':' + p.n; if (d > 0) k.push({ key: acc, name: p.n }); }); return k; };
  const seededKeys = new Set(); for (const i of seedSet) for (const k of keysOf(i)) seededKeys.add(k.key);
  const ids = new Map();
  for (let i = 0; i < n; i++) {
    const s = cad.solids[i]; if (seedSet.has(i)) continue;
    if (!(s.kind === 'motor' || MOTOR_RE.test(s.name || ''))) continue;
    const ch = keysOf(i); let key = null;
    for (const k of ch) if (MOTOR_RE.test(k.name) && !seededKeys.has(k.key)) { key = k.key; break; } // outermost motor subassembly
    key = key || 'solid:' + i;
    if (!ids.has(key)) ids.set(key, ids.size);
  }
  for (let i = 0; i < n; i++) {
    if (seedSet.has(i)) continue;
    const ks = keysOf(i).map((k) => k.key); let id = ids.get('solid:' + i);
    for (const k of ks) if (ids.has(k)) { id = ids.get(k); break; }
    if (id != null) { unit[i] = id; out[i] = OUTPUT_RE.test(cad.solids[i].name || '') ? 1 : 0; }
  }
  return { unit, out, count: ids.size };
}

/* The robot's left-right mirror plane in the canonical frame (x=0 or y=0): the one
   more parts have a mirror twin across (same size, centroid within 3 mm). */
const LATERAL = new WeakMap();
function lateralAxis(cad) {
  if (LATERAL.has(cad)) return LATERAL.get(cad);
  const C = cad.solids.map((s) => mean(s.pts)), cell = 0.006, grid = new Map();
  const key = (c) => c.map((v) => Math.floor(v / cell)).join(',');
  C.forEach((c, i) => { const k = key(c); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const twins = (ax) => { let m = 0; C.forEach((c, i) => { if (Math.abs(c[ax]) < 0.003) return; const q = c.slice(); q[ax] = -q[ax]; const b = q.map((v) => Math.floor(v / cell));
    let hit = false; for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) for (let dz = -1; dz <= 1 && !hit; dz++) for (const j of grid.get([b[0] + dx, b[1] + dy, b[2] + dz].join(',')) || []) if (j !== i && norm(sub(C[j], q)) < 0.003 && Math.abs((cad.solids[j].size || 0) - (cad.solids[i].size || 0)) < 0.003) { hit = true; break; }
    if (hit) m++; }); return m; };
  const tx = twins(0), ty = twins(1);
  const ax = ty >= tx ? 1 : 0; LATERAL.set(cad, ax); return ax;
}

/* Two rails are left/right twins: mirrored across the lateral plane, their
   cross-sections (box centres square to the slide axis) land within 1.5 mm and
   they span the same stretch of the axis. */
function mirrorTwin(P, Q, axis, symAx, opts) {
  const bc = (pts) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const p of pts) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } return mn.map((v, k) => (v + mx[k]) / 2); };
  const a = bc(P), b = bc(Q); a[symAx] = -a[symAx];
  const d = sub(a, b), nrm = [0, 0, 0]; nrm[symAx] = 1;
  // the mirror plane itself may sit a mm or two off the origin: looser across it, tight within it
  const inPlane = cross(axis, nrm), L = norm(inPlane);
  if (Math.abs(d[symAx]) > (opts.mirrorTolN ?? 0.003)) return false;
  if (L > 1e-6 && Math.abs(dot(d, inPlane)) / L > (opts.mirrorTol ?? 0.0015)) return false;
  const [lo1, hi1] = extentAlong(P, axis), [lo2, hi2] = extentAlong(Q, axis);
  const m = Math.abs(axis[symAx]) > 0.5; // a slide square to the mirror plane: its span mirrors too
  return m ? Math.abs(lo1 + hi2) <= 0.006 && Math.abs(hi1 + lo2) <= 0.006 : Math.abs(lo1 - lo2) <= 0.006 && Math.abs(hi1 - hi2) <= 0.006;
}

/* frame anchors: parts on the floor (drive wheels) that are nobody's seed, and the
   biggest low part (the chassis): wheels are often drawn with a gap to their hub, so the
   floor alone may anchor nothing. */
function frameAnchors(cad, seedSet, opts, G) {
  const z0 = opts.floorZ ?? 0.005, out = [];
  let top = -Infinity; for (const s of cad.solids) for (const p of s.pts) if (p[2] > top) top = p[2];
  const low = Math.min(opts.chassisZ ?? 0.1, 0.25 * Math.max(top, 1e-3));
  let bi = -1, bv = -1;
  cad.solids.forEach((s, i) => {
    if (seedSet.has(i)) return; let m = Infinity; for (const p of s.pts) if (p[2] < m) m = p[2];
    if (m <= z0) out.push(i);
    if (opts.chassisAnchor !== false && s.kind !== 'wheel' && m <= low && (s.size || 0) > bv) { bv = s.size || 0; bi = i; }
  });
  if (bi >= 0 && !out.includes(bi)) out.push(bi);
  /* nothing anchored touches anything (floating wheels and a chassis drawn high, as in a
     sparse CAD): the largest part in the lower half of the robot is the frame */
  if (G && opts.anchorFallback !== false && !out.some((i) => G.adj[i].some((k) => G.edges[k].strong))) {
    let fi = -1, fv = -1;
    cad.solids.forEach((s, i) => {
      if (seedSet.has(i) || s.kind === 'wheel' || !G.adj[i].length) return;
      let m = Infinity; for (const p of s.pts) if (p[2] < m) m = p[2];
      if (m <= 0.5 * top && (s.size || 0) > fv) { fv = s.size || 0; fi = i; }
    });
    if (fi >= 0 && !out.includes(fi)) out.push(fi);
  }
  return out;
}

/* ---------- subassembly structure ---------- */
function subasmChains(cad) {
  // chain of subassembly-occurrence keys for each solid (root excluded), outermost first
  const chains = cad.solids.map(() => []);
  for (const o of cad.occs || []) {
    if (o.solid == null || o.solid < 0) continue;
    const keys = []; let acc = '';
    o.path.forEach((p, d) => { acc += '/' + (p.k ?? '') + ':' + p.n; if (d > 0) keys.push(acc); });
    chains[o.solid] = keys;
  }
  return chains;
}

/* ---------- method A: subassembly first ---------- */
function carrySubasm(cad, joints, seeds, G) {
  const n = cad.solids.length, label = new Array(n).fill(null);
  const chains = subasmChains(cad);
  const seedOf = new Map(); for (const j of joints) for (const i of seeds[j.id] || []) seedOf.set(i, j.id);
  const seededIn = new Map(); // subassembly key -> seed parts inside
  for (const [i] of seedOf) for (const k of chains[i]) { if (!seededIn.has(k)) seededIn.set(k, []); seededIn.get(k).push(i); }
  for (let i = 0; i < n; i++) {
    if (seedOf.has(i)) { label[i] = seedOf.get(i); continue; }
    const ch = chains[i]; let key = null;
    for (let d = ch.length - 1; d >= 0; d--) if (seededIn.has(ch[d])) { key = ch[d]; break; }
    if (!key) continue;
    let best = null, bd = Infinity;
    for (const s of seededIn.get(key)) { const d = gjk(G.H[i].P, G.H[s].P).d; if (d < bd) { bd = d; best = s; } }
    label[i] = seedOf.get(best);
  }
  return { label };
}

/* ---------- method B/C: contact graph ---------- */
function carryContact(cad, joints, seeds, G, opts, useSubasm) {
  const S = cad.solids, n = S.length;
  const JP = prepJoints(cad, joints, seeds, G, opts);
  const seedOf = new Map(); for (const j of joints) for (const i of seeds[j.id] || []) seedOf.set(i, j.id);
  const seedSet = new Set(seedOf.keys());
  JP.units = motorUnits(cad, seedSet);
  const anchors = frameAnchors(cad, seedSet, opts, G);
  /* Unseeded rails beside the seeded ones: the fixed stage if the frame holds them
     (reachable from the floor over strong contacts without crossing another rail),
     otherwise rails of some moving stage nobody seeded ("floating"). */
  for (const g of JP.grp) {
    const isRail = new Set([...g.rails.keys(), ...g.cands]);
    const seen = new Uint8Array(n), q = [];
    if (g.cands.length) for (const i of anchors) if (!seedSet.has(i)) { seen[i] = 1; q.push(i); }
    while (q.length) {
      const i = q.pop();
      if (isRail.has(i)) continue;                       // enter a rail, never leave through it
      for (const k of G.adj[i]) { const e = G.edges[k], j = e.a === i ? e.b : e.a; if (seen[j] || !e.strong || seedSet.has(j)) continue; seen[j] = 1; q.push(j); }
    }
    for (const i of g.cands) g.rails.set(i, seen[i] || opts.floatRails === false ? (g.gp ?? null) : FLOAT);
    /* a floating rail that mirrors a labelled rail across the robot's mid-plane
       (left and right slides) rides the same stage */
    const symAx = opts.mirrorRails === false ? -1 : lateralAxis(cad);
    for (let changed = true; changed;) {
      changed = false;
      for (const [i, l] of g.rails) {
        if (l !== FLOAT) continue;
        let got;
        if (symAx >= 0) for (const [k, lk] of g.rails) if (lk !== FLOAT && k !== i && mirrorTwin(S[i].pts, S[k].pts, g.axis, symAx, opts)) { got = lk; break; }
        if (got === undefined && opts.touchRails !== false) { // the other half of a seeded rail: touches rails of one stage only
          const ls = new Set(); for (const k of G.adj[i]) { const e = G.edges[k], j = e.a === i ? e.b : e.a; if (e.strong && g.rails.has(j) && g.rails.get(j) !== FLOAT) ls.add(g.rails.get(j)); }
          if (ls.size === 1) got = [...ls][0];
        }
        if (got !== undefined) { g.rails.set(i, got); changed = true; }
      }
    }
    // a slide needs a fixed side: if the frame reaches none of the spare rails, the ones
    // no moving stage claimed are it (a frame drawn with gaps, or anchored off the floor)
    if (![...g.rails.values()].some((l) => l === (g.gp ?? null))) for (const [i, l] of g.rails) if (l === FLOAT) g.rails.set(i, g.gp ?? null);
    /* stage order when the joints don't say (no nesting, no travel ratios): side-by-side
       stages step away from the fixed rails, so the nearer a stage's rails sit to them
       across the slide, the further out it is */
    const rk = g.ids.map((id) => g.rank.get(id));
    if (opts.geomOrder === true || new Set(rk).size < rk.length) {
      const bc = (i) => { const P = S[i].pts, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const p of P) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } return mn.map((v, k) => (v + mx[k]) / 2); };
      const across = (a, b) => { const d = sub(a, b); return norm(sub(d, mul(g.axis, dot(d, g.axis)))); };
      const fixed = [...g.rails].filter(([, l]) => l === (g.gp ?? null)).map(([i]) => bc(i));
      if (fixed.length) {
        const D = new Map(g.ids.map((id) => { const R = [...g.rails].filter(([, l]) => l === id).map(([i]) => bc(i)); return [id, R.length ? R.reduce((a, c) => a + Math.min(...fixed.map((f) => across(c, f))), 0) / R.length : Infinity]; }));
        g.rank = new Map([...g.ids].sort((a, b) => D.get(a) - D.get(b)).map((id, k) => [id, k]));
        g.rank.set(g.gp ?? null, -1);
      }
    }
    /* which way the slide extends: the joint's axis sign, unless what the slide carries
       (the pivots of the joints riding it) sits clearly toward the other end of the rails */
    g.dir = 1;
    if (opts.inferSlideDir !== false) {
      const riders = joints.filter((j) => !g.ids.includes(j.id) && g.ids.some((id) => JP.isAnc(id, j.id)));
      let lo = Infinity, hi = -Infinity; for (const [i] of g.rails) { const [a, b] = extentAlong(S[i].pts, g.axis); lo = Math.min(lo, a); hi = Math.max(hi, b); }
      if (riders.length && hi > lo) {
        const pm = riders.reduce((a, j) => a + dot(j.pivot, g.axis), 0) / riders.length, rel = (pm - (lo + hi) / 2) / (hi - lo);
        if (rel < -0.1) g.dir = -1;
      }
    }
  }
  // terminals: seed parts, frame anchors, fixed rails (labelled with their group's parent)
  const term = new Map(); for (const [i, id] of seedOf) term.set(i, id);
  for (const i of anchors) if (!term.has(i)) term.set(i, null);
  for (const g of JP.grp) for (const [i, id] of g.rails) if (!term.has(i) && id !== FLOAT) term.set(i, id);
  const nb = (i, k) => (G.edges[k].a === i ? G.edges[k].b : G.edges[k].a);
  const useWeakIn = opts.inWeak ?? true;

  // subassembly constraint (combined): the parts of a subassembly holding seeds all ride
  // at least the parent of those seeds' common ancestor joint
  let floorOf = null;
  if (useSubasm) {
    const chains = subasmChains(cad), inside = new Map();
    for (const [i, id] of seedOf) for (const k of chains[i]) { if (!inside.has(k)) inside.set(k, new Set()); inside.get(k).add(id); }
    const lca = (ids) => { let common = null; for (const id of ids) { const line = [id, ...JP.ancestors(id)]; common = common ? common.filter((x) => line.includes(x)) : line; } return common && common.length ? common[0] : null; };
    floorOf = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      let best = null;
      for (const k of chains[i]) { const ids = inside.get(k); if (!ids) continue; const l = lca([...ids]); const f = l ? JP.parentOf(l) : null; if (f && (!best || JP.dep(f) > JP.dep(best))) best = f; }
      floorOf[i] = best;
    }
  }

  /* ring-shaped (no longer along J's axis than across it) and at least housedFrac of
     its sample points inside the hull of a part the outside holds */
  const housedIn = (i, J, out) => {
    const P = S[i].pts, [lo, hi] = extentAlong(P, J.axis), [u, v] = perpBasis(J.axis);
    const eu = extentAlong(P, u), ev = extentAlong(P, v), across = Math.max(eu[1] - eu[0], ev[1] - ev[0]);
    if (hi - lo > across) return false;
    for (const k of G.adj[i]) {
      const e = G.edges[k], j = nb(i, k); if (!out[j] || !e.strong) continue;
      const mine = e.a === i ? e.inA : e.inB;
      if (mine >= (opts.housedFrac ?? 0.5) * P.length) return true;
    }
    return false;
  };

  // per joint: what the outside holds rigidly, and what J's seeds reach otherwise
  const claims = Array.from({ length: n }, () => []), crossCut = Array.from({ length: n }, () => []);
  for (const J of joints) {
    const sub_ = JP.subtree.get(J.id);
    const inT = [], outT = [];
    for (const [i, id] of term) (id != null && sub_.has(id) ? inT : outT).push(i);
    const inSet = new Set(inT);
    const out = new Uint8Array(n), q = [];
    for (const i of outT) { out[i] = 1; q.push(i); }
    if (floorOf) for (let i = 0; i < n; i++) {
      const f = floorOf[i]; if (!f || out[i] || inSet.has(i)) continue;
      if (sub_.has(f)) { inT.push(i); inSet.add(i); }                                   // rides f, so rides J
      else if (!JP.isAnc(f, J.id)) { out[i] = 1; q.push(i); }                          // rides another branch
    }
    const spreadOut = () => {
      while (q.length) {
        const i = q.pop();
        for (const k of G.adj[i]) {
          const e = G.edges[k], j = nb(i, k);
          if (out[j] || inSet.has(j) || !e.strong || cuttable(J, e, JP, G, opts)) continue;
          out[j] = 1; q.push(j);
        }
      }
    };
    spreadOut();
    // what J's seeds reach (strict: without crossing J's own cuttable contacts)
    const grow = (strict) => {
      const got = new Uint8Array(n), q2 = [];
      for (const i of inT) { got[i] = 1; q2.push(i); }
      while (q2.length) {
        const i = q2.pop();
        for (const k of G.adj[i]) {
          const e = G.edges[k], j = nb(i, k);
          if (got[j] || out[j] || (!e.strong && !useWeakIn) || (strict && cuttable(J, e, JP, G, opts))) continue;
          got[j] = 1; q2.push(j);
        }
      }
      return got;
    };
    let got = grow(false), st = J.kind !== 'linear' ? grow(true) : got;
    /* A ring on J's axis reached only across J's axis (a bearing, a bushing) that sits
       mostly inside a part the outside holds is housed in it: it rides the housing. */
    if (J.kind !== 'linear' && opts.housedRings !== false) {
      const housed = [];   // judged against the outside as it stood, so the order doesn't matter
      for (let i = 0; i < n; i++) if (got[i] && !st[i] && !seedSet.has(i) && housedIn(i, J, out)) housed.push(i);
      if (housed.length) { for (const i of housed) { out[i] = 1; q.push(i); } spreadOut(); got = grow(false); st = grow(true); }
    }
    for (let i = 0; i < n; i++) if (got[i] && !seedSet.has(i)) claims[i].push(J.id);
    if (J.kind !== 'linear') for (let i = 0; i < n; i++) if (got[i] && !st[i] && !seedSet.has(i)) crossCut[i].push(J.id);
  }

  // resolve: seeds fixed; else the deepest claim; slide groups by the rail rule
  const label = new Array(n).fill(undefined);
  for (const [i, id] of term) label[i] = id;
  const cand = new Array(n).fill(null), deferred = [];
  for (let i = 0; i < n; i++) {
    if (label[i] !== undefined) continue;
    let C = claims[i].filter((a) => !claims[i].some((b) => JP.isAnc(a, b)));
    if (floorOf && floorOf[i]) C = C.filter((a) => a === floorOf[i] || JP.isAnc(floorOf[i], a));
    if (!C.length) { label[i] = floorOf && floorOf[i] ? floorOf[i] : null; continue; }
    const gs = new Set(C.map((id) => JP.groupOf.get(id)).filter(Boolean));
    if (C.length === 1 && !gs.size) { label[i] = C[0]; continue; }
    // candidates: the claims, plus each claiming slide group's fixed side
    const cs = new Set(C); for (const g of gs) { for (const id of g.ids) if (C.includes(id)) cs.add(id); cs.add(g.gp ?? null); }
    cand[i] = [...cs];
    // rail rule: the rails this part touches, of the claiming groups
    let decided = false;
    for (const g of (opts.railRule === false ? [] : gs)) {
      const touch = new Map();
      // (opts.railStrong: ignore rails the hull merely grazes; off, it lost 11 pulley-stack fasteners on ITD)
      for (const k of G.adj[i]) { const j = nb(i, k); if (!g.rails.has(j) || g.rails.get(j) === FLOAT || (opts.railStrong === true && !G.edges[k].strong)) continue; const l = g.rails.get(j) ?? null; touch.set(l, (touch.get(l) || 0) + G.edges[k].w); }
      if (!touch.size) continue;
      const tl = [...touch].sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
      if (tl.length === 1) { label[i] = tl[0]; decided = true; break; }
      // outer = lower rank; extension end (+axis) rides the outer stage
      const [o, inn] = (g.rank.get(tl[0]) ?? 0) <= (g.rank.get(tl[1]) ?? 0) ? tl : [tl[1], tl[0]];
      let lo = Infinity, hi = -Infinity;
      for (const [ri, rl] of g.rails) if (rl !== FLOAT && (rl === tl[0] || rl === tl[1])) { const [a, b] = extentAlong(S[ri].pts, g.axis); lo = Math.min(lo, a); hi = Math.max(hi, b); }
      let t = (dot(mean(S[i].pts), g.axis) - lo) / Math.max(1e-6, hi - lo);
      if (g.dir < 0) t = 1 - t;
      label[i] = t >= 0.5 ? o : inn; decided = true; break;
    }
    if (!decided) deferred.push(i);
  }
  // deferred parts take the label their neighbours settled on (strongest contact), else the deepest claim
  for (let pass = 0; pass < 20 && deferred.length; pass++) {
    let changed = false;
    for (let x = deferred.length - 1; x >= 0; x--) {
      const i = deferred[x], vote = new Map();
      for (const k of G.adj[i]) { const j = nb(i, k); if (label[j] === undefined) continue; const l = label[j]; if (!cand[i].includes(l)) continue; vote.set(l, (vote.get(l) || 0) + G.edges[k].w * (G.edges[k].strong ? 1 : 0.2)); }
      if (!vote.size) continue;
      label[i] = [...vote].sort((a, b) => b[1] - a[1])[0][0]; deferred.splice(x, 1); changed = true;
    }
    if (!changed) break;
  }
  for (const i of deferred) { const C = cand[i].filter((c) => c != null); label[i] = C.sort((a, b) => JP.dep(b) - JP.dep(a))[0] ?? null; }
  /* Every revolute joint turns a link. If a joint's seeds hold nothing (its link drawn with
     a gap to the actuator), the parts its child reaches only across the child's own axis,
     and that it claims too, are that link: in a joint tree the child wins those ties only
     because the parent's link normally holds the child's actuator body rigidly. */
  if (opts.emptyParent !== false) {
    const own = new Map(joints.map((j) => [j.id, 0]));
    for (let i = 0; i < n; i++) if (!seedSet.has(i) && own.has(label[i])) own.set(label[i], own.get(label[i]) + 1);
    for (const P of joints) {
      if (P.kind === 'linear' || own.get(P.id) > 0) continue;
      const kids = new Set(joints.filter((c) => JP.parentOf(c.id) === P.id).map((c) => c.id));
      for (let i = 0; i < n; i++) if (kids.has(label[i]) && !seedSet.has(i) && crossCut[i].includes(label[i]) && claims[i].includes(P.id)) label[i] = P.id;
    }
  }
  return { label: label.map((l) => (l === undefined ? null : l)), claims, crossCut, anchors, groups: JP.grp.map((g) => ({ ids: g.ids, rails: [...g.rails].map(([i, l]) => ({ i, label: l })) })) };
}

/* ---------- naive contact-graph baseline: each part takes its nearest terminal's label ----------
   Multi-source shortest paths over the contact graph (hop cost 1 on strong edges, 3 on weak),
   from the seeds and the frame anchors, with no notion of where a joint can cut. */
function carryNearest(cad, joints, seeds, G, opts) {
  const n = cad.solids.length, dist = new Float64Array(n).fill(Infinity), label = new Array(n).fill(null);
  const seedOf = new Map(); for (const j of joints) for (const i of seeds[j.id] || []) seedOf.set(i, j.id);
  const heap = [];
  const push = (d, i, l) => { heap.push([d, i, l]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (const [i, id] of seedOf) push(0, i, id);
  for (const i of frameAnchors(cad, new Set(seedOf.keys()), opts, G)) push(0, i, null);
  while (heap.length) {
    const [d, i, l] = pop(); if (d >= dist[i]) continue; dist[i] = d; label[i] = l;
    for (const k of G.adj[i]) { const e = G.edges[k], j = e.a === i ? e.b : e.a; const nd = d + (e.strong ? 1 : 3); if (nd < dist[j]) push(nd, j, l); }
  }
  return { label };
}

/** The main entry point. Returns {label, members, ms, info}. */
export function inferCarry(cad, joints, seeds, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const G = opts.graph || contactGraph(cad, opts);
  const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
  const method = opts.method || 'combined';
  const res = method === 'subasm' ? carrySubasm(cad, joints, seeds, G) : method === 'nearest' ? carryNearest(cad, joints, seeds, G, opts) : carryContact(cad, joints, seeds, G, opts, method === 'combined');
  const t2 = (typeof performance !== 'undefined' ? performance : Date).now();
  const members = {}; for (const j of joints) members[j.id] = [];
  res.label.forEach((l, i) => { if (l != null && members[l]) members[l].push(i); });
  const out = { label: res.label, members, ms: { graph: t1 - t0, assign: t2 - t1 }, info: res };
  if (opts.returnGraph) out.graph = G;
  return out;
}
