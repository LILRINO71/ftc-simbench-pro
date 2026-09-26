// Geometry helpers for the carry study: convex-hull distance (GJK) between parts'
// sampled points, hull planes for point-in-hull tests, and a contact graph.
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);

function support(P, d) {
  let best = -Infinity, bi = 0;
  for (let i = 0; i < P.length; i++) { const p = P[i], v = p[0] * d[0] + p[1] * d[1] + p[2] * d[2]; if (v > best) { best = v; bi = i; } }
  return P[bi];
}
// closest point to the origin on the affine hull of pts, with barycentrics
function affineClosest(S) {
  const k = S.length, s0 = S[0];
  if (k === 1) return { p: s0, lam: [1] };
  const E = []; for (let j = 1; j < k; j++) E.push(sub(S[j], s0));
  const m = k - 1, G = [], b = [];
  for (let i = 0; i < m; i++) { G.push([]); for (let j = 0; j < m; j++) G[i].push(dot(E[i], E[j])); b.push(-dot(E[i], s0)); }
  // solve G mu = b (m <= 3) by Gaussian elimination
  const A = G.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < m; c++) {
    let piv = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-30) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < m; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q <= m; q++) A[r][q] -= f * A[c][q]; }
  }
  const mu = A.map((r, i) => r[m] / r[i]);
  let lam0 = 1; for (const u of mu) lam0 -= u;
  let p = s0.slice(); for (let j = 0; j < m; j++) p = add(p, mul(E[j], mu[j]));
  return { p, lam: [lam0, ...mu] };
}
const SUBSETS = [];
for (let n = 1; n <= 4; n++) { const L = []; for (let mask = 1; mask < 16; mask++) { const idx = [0, 1, 2, 3].filter((i) => mask & (1 << i)); if (idx.every((i) => i < n)) L.push(idx); } SUBSETS[n] = L; }
function closestOnSimplex(S) {
  let best = null;
  for (const idx of SUBSETS[S.length]) {
    const T = idx.map((i) => S[i]), r = affineClosest(T);
    if (!r || r.lam.some((l) => l < -1e-9)) continue;
    const d = dot(r.p, r.p);
    if (!best || d < best.d - 1e-18 || (Math.abs(d - best.d) <= 1e-18 && T.length < best.S.length)) best = { d, p: r.p, S: T };
  }
  return best;
}
/** Distance between the convex hulls of two point sets (0 when they overlap), plus the witness points' midpoint. */
export function gjk(P, Q) {
  let v = sub(P[0], Q[0]), S = [];
  let pa = P[0], qb = Q[0];
  for (let it = 0; it < 60; it++) {
    const vv = dot(v, v);
    if (vv < 1e-18) return { d: 0, it };
    const a = support(P, mul(v, -1)), b = support(Q, v), w = sub(a, b);
    if (vv - dot(v, w) <= 1e-12 + 1e-10 * vv) return { d: Math.sqrt(vv), it };
    if (S.some((s) => Math.abs(s[0] - w[0]) + Math.abs(s[1] - w[1]) + Math.abs(s[2] - w[2]) < 1e-15)) return { d: Math.sqrt(vv), it };
    S.push(w);
    const r = closestOnSimplex(S);
    if (!r) return { d: Math.sqrt(vv), it };
    if (r.S.length === 4) return { d: 0, it };
    S = r.S; v = r.p;
  }
  return { d: Math.sqrt(dot(v, v)), it: 60 };
}

/** Convex hull as outward planes {n, d}; flat or tiny parts fall back to a thickened box. */
export function hullPlanes(E, pts) {
  let P = pts, h = pts.length >= 4 ? E.convexHull(P) : null;
  if (!h) { P = E.boxCorners(pts); h = E.convexHull(P); }
  if (!h) return { planes: [], P };
  const planes = [];
  for (const [a, b, c] of h.faces) {
    let n = cross(sub(P[b], P[a]), sub(P[c], P[a])); const L = norm(n); if (!(L > 0)) continue;
    n = mul(n, 1 / L); planes.push({ n, d: dot(n, P[a]) });
  }
  return { planes, P };
}
/** Signed distance-ish of x to a hull: >0 outside (a lower bound), <0 inside (minus the depth). */
export function hullSD(H, x) {
  let m = -Infinity; for (const f of H.planes) { const v = dot(f.n, x) - f.d; if (v > m) m = v; }
  return m;
}

/* The contact graph. Parts are joined when their sampled convex hulls come within
   tol of each other. Each edge keeps what a joint test needs:
     d      hull distance (0 = hulls overlap)
     ptsIn  sample points of either part inside the other's hull (+tol): a rough contact size
     cpts   those points themselves (where the parts meet), capped
   Hulls of concave parts (U-channels, brackets) over-reach, so edges are "maybe touching". */
export function contactGraph(E, cad, opts = {}) {
  const tol = opts.tol ?? 0.001;
  const S = cad.solids, n = S.length;
  const box = S.map((s) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of s.pts) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } return { mn, mx }; });
  const H = S.map((s) => hullPlanes(E, s.pts));
  const edges = [], adj = Array.from({ length: n }, () => []);
  // sweep on x
  const order = [...Array(n).keys()].sort((a, b) => box[a].mn[0] - box[b].mn[0]);
  for (let ii = 0; ii < n; ii++) {
    const i = order[ii], bi = box[i];
    for (let jj = ii + 1; jj < n; jj++) {
      const j = order[jj], bj = box[j];
      if (bj.mn[0] > bi.mx[0] + tol) break;
      if (bj.mn[1] > bi.mx[1] + tol || bi.mn[1] > bj.mx[1] + tol || bj.mn[2] > bi.mx[2] + tol || bi.mn[2] > bj.mx[2] + tol) continue;
      const g = gjk(H[i].P, H[j].P);
      if (g.d > tol) continue;
      const cp = [];
      for (const p of S[i].pts) if (hullSD(H[j], p) <= tol) cp.push(p);
      const nI = cp.length;
      for (const p of S[j].pts) if (hullSD(H[i], p) <= tol) cp.push(p);
      const e = { a: Math.min(i, j), b: Math.max(i, j), d: g.d, ptsIn: cp.length, inA: i < j ? nI : cp.length - nI, inB: i < j ? cp.length - nI : nI, cpts: cp };
      const k = edges.length; edges.push(e); adj[e.a].push(k); adj[e.b].push(k);
    }
  }
  return { edges, adj, box, H };
}
