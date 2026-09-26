/* ============================================================
   ACTUATOR OUTPUTS — every servo output and motor shaft in a parsed CAD
   findActuators(cad, opts) -> { actuators:[...], notes:[...] }

   Works on the bench's parsed STEP (cad.solids[i] = {name, part, kind, pts},
   cad.occs[j] = {path:[{k,n}], solid}), robot frame, metres. No robot-specific
   names or coordinates: names are only used for generic vendor vocabulary
   (servo / motor / gearbox / spline / Yellow Jacket / part-number shapes),
   and everything positional comes from the parts' own geometry:
     - a motor is a stack of coaxial round pieces (can, sleeve, gearbox, and a
       thin shaft that sticks out of one end); the shaft end is the output
     - a servo is a ~20 x 40 x 37 mm box (54 mm with its mounting ears); its
       output axis is square to one 40 x 20 face, about half a body-width from
       one end. Which face and which end: a separate spline part if there is
       one, else a boss on the case, the side the mounting ears sit nearer,
       and the part (hub, horn, gear) sitting on the face at one end
   For each: axis (unit), pivot (mm, a point on the axis at the output face),
   output-side parts (spline/shaft, hub/horn/gear/wheel/pulley on it, and
   parts bolted to those), body-side parts (case, can, gearbox, bracket,
   mount), the part number/spec if known, and a role: drive / steer /
   joint (something turns with it) / unloaded (nothing modelled on it).
   ============================================================ */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return n > 1e-12 ? mul(a, 1 / n) : [0, 0, 1]; };
const MM = 0.001;

/* ---------------- geometry: hull, oriented box ---------------- */

// Incremental 3D convex hull. Returns [{n, d}] outward planes (n·p <= d inside), or null.
function hull3(P) {
  const n = P.length; if (n < 4) return null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]); if (!(diag > 0)) return null;
  const eps = diag * 1e-7;
  let a = 0, b = 0;
  for (let i = 1; i < n; i++) { if (P[i][0] < P[a][0]) a = i; if (P[i][0] > P[b][0]) b = i; }
  if (a === b) { for (let i = 0; i < n; i++) if (norm(sub(P[i], P[a])) > norm(sub(P[b], P[a]))) b = i; }
  const ab = sub(P[b], P[a]);
  let c = -1, best = 0;
  for (let i = 0; i < n; i++) { const L = norm(cross(ab, sub(P[i], P[a]))); if (L > best) { best = L; c = i; } }
  if (c < 0 || best < eps * diag) return null;
  const n0 = cross(ab, sub(P[c], P[a]));
  let d = -1; best = 0;
  for (let i = 0; i < n; i++) { const L = Math.abs(dot(n0, sub(P[i], P[a]))) / norm(n0); if (L > best) { best = L; d = i; } }
  if (d < 0 || best < eps) return null;
  const inside = mul(add(add(P[a], P[b]), add(P[c], P[d])), 0.25);
  let faces = [];
  const mk = (i, j, k) => {
    let nn = cross(sub(P[j], P[i]), sub(P[k], P[i])); const L = norm(nn); if (L < 1e-18) return;
    nn = mul(nn, 1 / L); let dd = dot(nn, P[i]);
    if (dot(nn, inside) - dd > 0) { const t = j; j = k; k = t; nn = mul(nn, -1); dd = -dd; }
    faces.push({ v: [i, j, k], n: nn, d: dd, alive: true });
  };
  mk(a, b, c); mk(a, b, d); mk(a, c, d); mk(b, c, d);
  const used = new Set([a, b, c, d]);
  for (let i = 0; i < n; i++) {
    if (used.has(i)) continue;
    const p = P[i], vis = faces.filter((f) => f.alive && dot(f.n, p) - f.d > eps);
    if (!vis.length) continue;
    const edges = new Map();
    for (const f of vis) {
      f.alive = false;
      for (let e = 0; e < 3; e++) {
        const u = f.v[e], w = f.v[(e + 1) % 3], key = u + ',' + w, rev = w + ',' + u;
        if (edges.has(rev)) edges.delete(rev); else edges.set(key, [u, w]);
      }
    }
    for (const [u, w] of edges.values()) mk(u, w, i);
    if (faces.length > 4000) faces = faces.filter((f) => f.alive);
  }
  return faces.filter((f) => f.alive).map((f) => ({ n: f.n, d: f.d }));
}
// signed distance of p outside the hull (<=0 inside); coarse (max plane distance)
const hullOut = (H, p) => { let m = -Infinity; for (const f of H) { const v = dot(f.n, p) - f.d; if (v > m) m = v; } return m; };

// 2D convex hull (monotone chain)
function hull2(Q) {
  const P = Q.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
function basisOf(n) {
  const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(n, t)); return [u, cross(n, u)];
}
/* Minimum-volume oriented box: one box face on a hull face direction (or a
   robot axis), the other two from the best rectangle round the projection. */
function obbOf(P, H) {
  const normals = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const f of H || []) if (!normals.some((m) => Math.abs(dot(m, f.n)) > 0.9995)) normals.push(f.n);
  let best = null;
  for (const nrm of normals) {
    const [u, v] = basisOf(nrm);
    let h0 = Infinity, h1 = -Infinity;
    const Q = P.map((p) => { const h = dot(p, nrm); if (h < h0) h0 = h; if (h > h1) h1 = h; return [dot(p, u), dot(p, v)]; });
    const C = hull2(Q);
    for (let i = 0; i < C.length; i++) {
      const e = sub([...C[(i + 1) % C.length], 0], [...C[i], 0]); const L = Math.hypot(e[0], e[1]); if (L < 1e-12) continue;
      const ex = [e[0] / L, e[1] / L], ey = [-ex[1], ex[0]];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const q of C) { const s = q[0] * ex[0] + q[1] * ex[1], t = q[0] * ey[0] + q[1] * ey[1]; if (s < a0) a0 = s; if (s > a1) a1 = s; if (t < b0) b0 = t; if (t > b1) b1 = t; }
      const vol = (a1 - a0) * (b1 - b0) * (h1 - h0);
      if (!best || vol < best.vol - 1e-15) {
        const X = add(mul(u, ex[0]), mul(v, ex[1])), Y = add(mul(u, ey[0]), mul(v, ey[1]));
        const cs = (a0 + a1) / 2, ct = (b0 + b1) / 2, ch = (h0 + h1) / 2;
        best = { vol, ax: [unit(X), unit(Y), nrm], ext: [a1 - a0, b1 - b0, h1 - h0],
          c: add(add(add(mul(u, cs * ex[0] + ct * ey[0]), mul(v, cs * ex[1] + ct * ey[1])), [0, 0, 0]), mul(nrm, ch)) };
      }
    }
  }
  return best;
}

/* ---------------- vocabulary (generic vendor words only) ---------------- */
const PN_RE = /(\d{4}-\d{4}-\d{1,4}|REV-\d{2}-\d{4}|am-\d{4})/i;
const SERVO_PN = /^(2000-00\d\d-\d{4}|REV-41-1097|REV-41-1356)$/i;           // goBILDA 2000 series, REV Smart Robot Servo
const MOTOR_PN = /^(520[234]-\d{4}-\d{1,4}|REV-41-(1291|1300|1600|1610)|am-(2964|3104|3461|3637|4255))$/i;
const NOT_ACT = /\b(port|ports|controller|driver|bracket|mount|mounting|clamp|frame|block|plate|cable|wire|connector|extension|programmer|tester|power|module|saver|board|label|sticker)\b/i;
const SERVO_WORD = /\bservos?\b|\baxon\b/i;
const MOTOR_WORD = /\b(motor|gear ?motor|gear ?box|planetary|yellow ?jacket|ultra ?planetary|hd ?hex|core ?hex|neverest|encoder)\b/i;
const SPLINE_WORD = /\b(spline|output ?shaft)\b/i;
const HORN_WORD = /\b(horn|servo ?hub|servo ?arm)\b/i;
const GEARISH = /\b(gear|sprocket|pulley|spool|winch|capstan)\b/i;
const WHEELISH = /\b(wheel|mecanum|omni|traction|tire|tyre)\b/i;
const FASTENER = /\b(screw|bolt|nut|washer|rivet|shcs|bhcs|fhcs|standoff|spacer|shim|collar|e-?clip)\b/i;

const pnOf = (s) => { if (!s) return null; const m = PN_RE.exec(s); return m ? m[1] : null; };
// a servo-sized box: 8-32 mm thick, the rest 18-80 mm (micro to large-scale, ears included)
/* The mounting ears of a servo box, from its points in box coordinates (L[i][k]):
   the tips at each end of the long side l, as a band in height k. The tidier end
   (narrowest band) is the ears alone. Returns {h: band centre in k, band} or null. */
function earBand(L, k, l, ext) {
  let best = null;
  for (const sg of [1, -1]) {
    const tips = L.filter((q) => q[l] * sg > ext[l] / 2 - 0.002);
    if (tips.length < 2) return null;                       // ears come in pairs
    const hs = tips.map((q) => q[k]), band = Math.max(...hs) - Math.min(...hs);
    if (!best || band < best.band) best = { h: hs.reduce((a, b) => a + b, 0) / hs.length, band };
  }
  const mid = L.filter((q) => Math.abs(q[l]) < ext[l] / 2 - 0.008).map((q) => q[k]);
  if (mid.length < 3 || Math.max(...mid) - Math.min(...mid) < 0.8 * ext[k]) return null;
  return best.band < 0.2 * ext[k] ? best : null;
}
const servoSized = (ext) => { const e = ext.slice().sort((a, b) => a - b); return e[0] >= 0.008 && e[0] <= 0.032 && e[1] >= 0.018 && e[2] <= 0.080 && e[1] / e[0] >= 1.3; };
// an assembly-tree node that IS an actuator model (the vendor's servo / gearmotor), not a subsystem
function actNode(n) {
  const pn = pnOf(n);
  if (pn && SERVO_PN.test(pn)) return 'servo';
  if (pn && MOTOR_PN.test(pn)) return 'motor';
  if (NOT_ACT.test(n)) return null;
  if (SERVO_WORD.test(n) && /(series|dual ?mode|smart|axon|digital|torque|speed|standard|micro|mini|max|\d)/i.test(n)) return 'servo';
  if (/(yellow ?jacket|gear ?motor|planetary gear ?motor|hd ?hex motor|core ?hex motor|ultra ?planetary|neverest|\b12 ?v ?dc motor)/i.test(n)) return 'motor';
  return null;
}

/* ---------------- main ---------------- */
export function findActuators(cad, opts = {}) {
  const S = cad.solids || [], N = S.length;
  const notes = [];
  // where each solid sits in the assembly tree
  const occOf = new Array(N).fill(null);
  for (const o of cad.occs || []) if (o.solid >= 0 && o.solid < N && !occOf[o.solid]) occOf[o.solid] = o;
  const pathOf = (i) => (occOf[i] && occOf[i].path) || [];

  // lazy per-part geometry
  const G = new Array(N).fill(null);
  const ign = opts.ignore ? new Set(opts.ignore) : null;     // parts to treat as absent (robustness tests)
  const geo = (i) => {
    if (G[i]) return G[i];
    if (ign && ign.has(i)) return (G[i] = { c: [1e3, 1e3, 1e3], r: 0, P: [], H: null, B: null });
    const P = S[i].pts || [];
    const c = [0, 0, 0]; for (const p of P) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    const cc = mul(c, 1 / Math.max(1, P.length));
    let r = 0; for (const p of P) r = Math.max(r, norm(sub(p, cc)));
    const g = { c: cc, r, P, _H: undefined, _B: undefined };
    Object.defineProperty(g, 'H', { get() { if (g._H === undefined) g._H = hull3(P); return g._H; } });
    Object.defineProperty(g, 'B', { get() { if (g._B === undefined) g._B = P.length >= 4 ? obbOf(P, g.H) : null; return g._B; } });
    return (G[i] = g);
  };
  // the box read as a cylinder: the axis is the side unlike the other two
  const cylOf = (i) => {
    const B = geo(i).B; if (!B) return null;
    const e = B.ext; let best = null;
    for (let k = 0; k < 3; k++) {
      const a = e[(k + 1) % 3], b = e[(k + 2) % 3], round = Math.min(a, b) / Math.max(a, b);
      if (!best || round > best.round) best = { k, round, dia: (a + b) / 2, len: e[k], axis: B.ax[k], c: B.c };
    }
    return best;
  };
  const inside = (i, p, tol) => { const H = geo(i).H; if (!H) { const g = geo(i); return norm(sub(p, g.c)) <= tol; } return hullOut(H, p) <= tol; };
  const touches = (i, j, tol) => {
    const gi = geo(i), gj = geo(j);
    if (norm(sub(gi.c, gj.c)) > gi.r + gj.r + tol) return false;
    const Hi = gi.H, Hj = gj.H;
    if (Hj) for (const p of gi.P) if (hullOut(Hj, p) <= tol) return true;
    if (Hi) for (const p of gj.P) if (hullOut(Hi, p) <= tol) return true;
    return false;
  };
  const lineDist = (p, o, a) => { const v = sub(p, o); return norm(sub(v, mul(a, dot(v, a)))); };

  // names
  const nameOf = (i) => String(S[i].name || '');
  const isFastener = (i) => S[i].kind === 'fastener' || FASTENER.test(nameOf(i));
  const actAncestor = (i) => {       // outermost assembly node that is an actuator model
    const p = pathOf(i);
    for (let d = 0; d < p.length; d++) { const t = actNode(p[d].n || ''); if (t) return { type: t, key: p.slice(0, d + 1).map((x) => x.k).join('/'), name: p[d].n }; }
    return null;
  };

  /* ---- 1. evidence per part ---- */
  const role = new Array(N).fill(null);      // 'servoBody' | 'spline' | 'motorPiece'
  const anc = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (ign && ign.has(i)) continue;
    const s = S[i], nm = nameOf(i), pn = s.part || pnOf(nm), A = actAncestor(i);
    anc[i] = A;
    const g = geo(i), size = 2 * g.r;
    if (isFastener(i) && !A) continue;
    const selfServo = (pn && SERVO_PN.test(pn)) || (SERVO_WORD.test(nm) && !NOT_ACT.test(nm) && !SPLINE_WORD.test(nm) && !HORN_WORD.test(nm));
    const selfMotor = (pn && MOTOR_PN.test(pn)) || (MOTOR_WORD.test(nm) && !NOT_ACT.test(nm));
    if (SPLINE_WORD.test(nm) && (A ? A.type === 'servo' : SERVO_WORD.test(nm) || size < 0.02)) { role[i] = 'spline'; continue; }
    // inside a vendor servo model: every piece is the servo (a case may come as several shells)
    if (A && A.type === 'servo') { role[i] = 'servoBody'; continue; }
    if (selfServo) {
      const B = geo(i).B; if (!B) continue;
      if (servoSized(B.ext)) role[i] = 'servoBody';
      continue;
    }
    if (selfMotor || (A && A.type === 'motor')) {
      if (size < 0.012) continue;
      role[i] = 'motorPiece';
    }
  }

  /* ---- 2. units: parts of one actuator ---- */
  const parent = new Map(); const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
  const seeds = []; for (let i = 0; i < N; i++) if (role[i]) { parent.set(i, i); seeds.push(i); }
  // same actuator model in the assembly tree
  const byKey = new Map();
  for (const i of seeds) if (anc[i]) { const k = anc[i].key; if (byKey.has(k)) union(i, byKey.get(k)); else byKey.set(k, i); }
  // loose motor pieces: coaxial and end to end
  const mp = seeds.filter((i) => role[i] === 'motorPiece');
  for (let x = 0; x < mp.length; x++) for (let y = x + 1; y < mp.length; y++) {
    const i = mp[x], j = mp[y];
    if (anc[i] && anc[j] && anc[i].key !== anc[j].key) continue;
    const ci = cylOf(i), cj = cylOf(j); if (!ci || !cj) continue;
    if (Math.abs(dot(ci.axis, cj.axis)) < 0.985) continue;
    if (lineDist(cj.c, ci.c, ci.axis) > 0.004) continue;
    const t = dot(sub(cj.c, ci.c), ci.axis);
    if (Math.abs(t) > (ci.len + cj.len) / 2 + 0.006) continue;
    union(i, j);
  }
  // loose splines: onto the nearest servo body they stick out of
  const bodies = seeds.filter((i) => role[i] === 'servoBody');
  for (const i of seeds.filter((k) => role[k] === 'spline')) {
    if (anc[i] && bodies.some((b) => find(b) === find(i))) continue;
    let best = null;
    for (const b of bodies) {
      if (anc[i] && anc[b] && anc[i].key !== anc[b].key) continue;
      const B = geo(b).B, v = sub(geo(i).B ? geo(i).B.c : geo(i).c, B.c);
      const u = [0, 1, 2].map((k) => Math.abs(dot(v, B.ax[k])) / (B.ext[k] / 2));
      const out = Math.max(...u);                                 // ~1 on the face, <1.6 just past it
      const lat = u.slice().sort((a, b) => b - a)[1];
      if (out < 0.8 || out > 1.7 || lat > 0.8) continue;
      const d = norm(v); if (!best || d < best.d) best = { b, d };
    }
    if (best) union(i, best.b);
  }
  const groups = new Map();
  for (const i of seeds) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }

  // drive wheels, if the caller has them (the bench: driveFromCAD(cad).wheels)
  let wheels = opts.wheels || null;
  if (!wheels && typeof opts.driveFromCAD === 'function') { try { wheels = opts.driveFromCAD(cad).wheels || []; } catch (e) { wheels = []; } }
  wheels = (wheels || []).map((w) => ({ c: w.c, axis: unit(w.axis), r: w.r }));

  const acts = [];
  for (const parts of groups.values()) {
    const servoParts = parts.filter((i) => role[i] === 'servoBody'), splines = parts.filter((i) => role[i] === 'spline');
    const motorParts = parts.filter((i) => role[i] === 'motorPiece');
    let A = null;
    if (servoParts.length) A = servoUnit(servoParts, splines, motorParts);
    else if (motorParts.length) A = motorUnit(motorParts);
    if (A) acts.push(A);
  }

  /* ---- 2b. shape only: actuators no name or part number vouches for ----
     Strict shapes, and each must show its output: a gearmotor is a stack of
     coaxial round pieces 28-48 mm across and 70-200 mm long with a thin shaft
     out of one end; a servo is a 20 mm-thick box of standard size carrying
     either mounting ears (thin tabs off-centre in height) or an output boss. */
  if (opts.shapeOnly !== false) {
    const taken = new Set(); for (const A of acts) for (const i of [...A.body, ...A.output]) taken.add(i);
    const free = (i) => !taken.has(i) && !role[i] && !(ign && ign.has(i)) && !isFastener(i) && S[i].kind !== 'wheel' && !WHEELISH.test(nameOf(i)) && !/electronics/.test(S[i].kind || '');
    const round = [];
    for (let i = 0; i < N; i++) {
      if (!free(i) || geo(i).P.length < 8) continue;
      const c = cylOf(i); if (c && c.round >= 0.85 && c.dia >= 0.028 && c.dia <= 0.048 && c.len >= 0.015 && c.len <= 0.2) round.push(i);
    }
    const P2 = new Map(round.map((i) => [i, i])), f2 = (x) => { while (P2.get(x) !== x) x = P2.get(x); return x; };
    for (let x = 0; x < round.length; x++) for (let y = x + 1; y < round.length; y++) {
      const i = round[x], j = round[y], ci = cylOf(i), cj = cylOf(j);
      if (Math.abs(dot(ci.axis, cj.axis)) < 0.985 || lineDist(cj.c, ci.c, ci.axis) > 0.004) continue;
      if (Math.abs(dot(sub(cj.c, ci.c), ci.axis)) > (ci.len + cj.len) / 2 + 0.006) continue;
      P2.set(f2(i), f2(j));
    }
    const stacks = new Map(); for (const i of round) { const r = f2(i); if (!stacks.has(r)) stacks.set(r, []); stacks.get(r).push(i); }
    for (const st of stacks.values()) {
      const c = cylOf(st[0]); let t0 = Infinity, t1 = -Infinity;
      for (const i of st) for (const p of geo(i).P) { const t = dot(p, c.axis); if (t < t0) t0 = t; if (t > t1) t1 = t; }
      if (t1 - t0 < 0.07 || t1 - t0 > 0.2) continue;
      const A = motorUnit(st, true);
      if (A) { A.why.unshift('found by shape only'); A.shapeOnly = true; acts.push(A); st.forEach((i) => taken.add(i)); A.output.forEach((i) => taken.add(i)); }
    }
    for (let i = 0; i < N; i++) {
      if (!free(i) || taken.has(i) || geo(i).P.length < 8) continue;
      const B = geo(i).B; if (!B) continue;
      const o = [0, 1, 2].sort((x, y) => B.ext[x] - B.ext[y]), e = o.map((k) => B.ext[k]);
      if (e[0] < 0.017 || e[0] > 0.023 || e[1] < 0.034 || e[1] > 0.046 || e[2] > 0.058) continue;
      const loc = geo(i).P.map((p) => { const v = sub(p, B.c); return o.map((k) => dot(v, B.ax[k])); });
      let ok = false;
      if (e[2] >= 0.05) {                                 // ears: a thin band at both ends, off-centre in height
        const eb = earBand(loc, 1, 2, e);
        ok = !!eb && Math.abs(eb.h) > 0.1 * e[1];
      }
      const A = ok || e[2] < 0.05 ? servoUnit([i], [], []) : null;
      if (A && (ok || A.why.join(' ').includes('boss on face'))) { A.why.unshift('found by shape only'); A.shapeOnly = true; acts.push(A); taken.add(i); }
    }
  }

  /* ---- motors ---- */
  function motorUnit(pieces, strict) {
    const cyls = pieces.map((i) => ({ i, c: cylOf(i), vol: geo(i).B ? geo(i).B.vol : 0 })).filter((x) => x.c);
    if (!cyls.length) return null;
    const main = cyls.slice().sort((a, b) => b.vol - a.vol)[0];
    // a round body of motor size: 20-60 mm across
    if (main.c.dia < 0.018 || main.c.dia > 0.07) return null;
    let a = main.c.axis;
    /* The axis line: every round piece (can, sleeve, gearbox, shaft) is centred
       on it, so the line through their box centres is sharper than any one
       piece's box — a can with its wires and encoder cap leans a degree or two. */
    const onAxis = cyls.filter((x) => x.c.round > 0.8 && Math.abs(dot(x.c.axis, a)) > 0.97 && lineDist(x.c.c, main.c.c, a) < 0.004);
    if (!onAxis.length) onAxis.push(main);
    let o = mul(onAxis.reduce((s, x) => add(s, x.c.c), [0, 0, 0]), 1 / onAxis.length);
    if (onAxis.length >= 2) {
      const ts = onAxis.map((x) => dot(sub(x.c.c, o), a));
      if (Math.max(...ts) - Math.min(...ts) > 0.03) {
        // principal direction of the centres (power iteration from the box axis)
        let d = a.slice();
        for (let it = 0; it < 30; it++) {
          let nd = [0, 0, 0];
          for (const x of onAxis) { const v = sub(x.c.c, o); nd = add(nd, mul(v, dot(v, d))); }
          d = unit(nd);
        }
        if (Math.abs(dot(d, a)) > 0.99) a = dot(d, a) < 0 ? mul(d, -1) : d;
      }
    }
    const tOf = (p) => dot(sub(p, o), a);
    const body = new Set(pieces); let shaft = [];
    // thin coaxial parts: a shaft sticking out of an end is the output
    const range = (set) => { let t0 = Infinity, t1 = -Infinity; for (const i of set) for (const p of geo(i).P) { const t = tOf(p); if (t < t0) t0 = t; if (t > t1) t1 = t; } return [t0, t1]; };
    const thinCoax = (i) => { const c = cylOf(i); return c && c.dia <= 0.016 && Math.abs(dot(c.axis, a)) > 0.97 && lineDist(c.c, o, a) < 0.003; };
    if (pieces.length > 1) {
      const fat = pieces.filter((i) => !thinCoax(i));
      if (fat.length) {
        const [f0, f1] = range(fat);
        for (const i of pieces) if (thinCoax(i)) { const [s0, s1] = range([i]); if (s1 > f1 + 0.002 || s0 < f0 - 0.002) { body.delete(i); shaft.push(i); } }
      }
    }
    let [t0, t1] = range(body);
    const R = main.c.dia / 2 + 0.01;
    for (let i = 0; i < N; i++) {
      if (body.has(i) || shaft.includes(i) || role[i]) continue;
      const g = geo(i); if (lineDist(g.c, o, a) > R + g.r) continue;
      if (!thinCoax(i)) continue;
      const [s0, s1] = range([i]);
      if (s1 < t0 - 0.006 || s0 > t1 + 0.006) continue;
      if (s1 > t1 + 0.002 || s0 < t0 - 0.002) shaft.push(i); else body.add(i);   // inside: an internal axle
    }
    // which end is the output
    let end = 0, why = '';
    const sh = shaft.map((i) => ({ i, r: range([i]) }));
    const outPlus = sh.filter((x) => x.r[1] > t1 + 0.002), outMinus = sh.filter((x) => x.r[0] < t0 - 0.002);
    if (outPlus.length && !outMinus.length) { end = 1; why = 'shaft part'; }
    else if (outMinus.length && !outPlus.length) { end = -1; why = 'shaft part'; }
    else {
      // one solid: the end whose tip is thin is the shaft
      const cap = (sgn) => { const tt = sgn > 0 ? t1 : t0; let r = 0; for (const i of body) for (const p of geo(i).P) { const t = tOf(p); if (Math.abs(t - tt) < 0.003) r = Math.max(r, lineDist(p, o, a)); } return r; };
      const cp = cap(1), cm = cap(-1);
      if (Math.min(cp, cm) < 0.008 && Math.max(cp, cm) > 0.012) { end = cp < cm ? 1 : -1; why = 'thin end'; }
      else {
        const gb = strict ? null : pieces.find((i) => /gear ?box|planetary/i.test(nameOf(i)));
        if (gb) { end = tOf(geo(gb).c) > (t0 + t1) / 2 ? 1 : -1; why = 'gearbox end'; }
        else { if (strict) return null; end = 1; why = 'guess'; }
      }
    }
    if (end < 0) { a = mul(a, -1); const tt = t0; t0 = -t1; t1 = -tt; }
    // the output face: where the fat part ends; for one solid, where the radius drops
    let tFace = t1, tTip = t1;
    if (shaft.length) tTip = Math.max(...shaft.map((i) => range([i])[1]));        // tOf follows the flipped axis
    else {
      let fat = -Infinity; for (const i of body) for (const p of geo(i).P) if (lineDist(p, o, a) > 0.009) fat = Math.max(fat, dot(sub(p, o), a));
      if (fat < t1 - 0.004) { tFace = fat; tTip = t1; }
    }
    const pn = pieces.map((i) => S[i].part || pnOf(nameOf(i))).find((x) => x && MOTOR_PN.test(x)) ||
               pieces.map((i) => anc[i] && pnOf(anc[i].name)).find((x) => x && MOTOR_PN.test(x)) || null;
    const fam = pn ? null : (pieces.map(nameOf).find((n) => /520[234]/.test(n)) ? 'goBILDA 5203-style Yellow Jacket (ratio unknown)' : null);
    return { kind: 'motor', axis: a, face: add(o, mul(a, tFace)), tip: add(o, mul(a, tTip)), zone: Math.max(tTip - tFace, 0.004),
      dia: main.c.dia, body: [...body], output: shaft.slice(), part: pn, family: fam, ambiguous: why === 'guess',
      why: ['axis: coaxial round pieces', 'output end: ' + why] };
  }

  /* ---- servos ---- */
  function servoUnit(bodyParts, splines, extra) {
    // the big pieces make the box; a small piece standing proud of a face is an unnamed spline
    let big = bodyParts.filter((i) => 2 * geo(i).r >= 0.015);
    if (!big.length) big = bodyParts.slice();
    const pts = []; for (const i of big) for (const p of geo(i).P) pts.push(p);
    const B = obbOf(pts, hull3(pts)); if (!B || !servoSized(B.ext)) return null;
    splines = splines.slice();
    if (!splines.length) for (const i of bodyParts) {
      if (big.includes(i)) continue;
      const v = sub(geo(i).c, B.c), u = [0, 1, 2].map((k) => Math.abs(dot(v, B.ax[k])) / (B.ext[k] / 2));
      if (Math.max(...u) > 0.9) splines.push(i);
    }
    bodyParts = bodyParts.filter((i) => !splines.includes(i));
    const ext = B.ext, order = [0, 1, 2].sort((x, y) => ext[x] - ext[y]);
    const w = order[0];                                    // the 20 mm side: never the axis
    const cand = [];
    for (const k of [order[1], order[2]]) {
      const l = 3 - w - k;
      for (const sH of [1, -1]) for (const sL of [1, -1]) cand.push({ k, l, sH, sL, score: 0, ev: [] });
    }
    const loc = (p) => { const v = sub(p, B.c); return [dot(v, B.ax[0]), dot(v, B.ax[1]), dot(v, B.ax[2])]; };
    const width = ext[w];
    // spline offset from the body centre: about half the body's width (10 mm on a standard servo)
    const off = 0.5 * width;
    const sp = splines.length ? splines : [];
    if (sp.length) {
      // a spline part: it sits past one face, off-centre toward one end
      const sc = mul(sp.reduce((s, i) => add(s, geo(i).B ? geo(i).B.c : geo(i).c), [0, 0, 0]), 1 / sp.length);
      const q = loc(sc);
      for (const c of cand) {
        const along = q[c.k] * c.sH / (ext[c.k] / 2), lat = q[c.l] * c.sL;
        if (along > 0.8) { c.score += 10 * Math.min(along, 1.4); c.ev.push('spline past face'); }
        if (lat > 0) c.score += 3;
        c.score -= 3 * Math.abs(q[w]) / (width / 2);
      }
    }
    // mounting ears: when the long side is much longer than the other, those are ears; the axis is the other side
    const [e1, e2] = [ext[order[1]], ext[order[2]]];
    if (e2 / e1 > 1.2) {
      const kk = order[1], ll = order[2];
      for (const c of cand) if (c.k === kk) { c.score += 2; c.ev.push('ears set the length'); }
      // ears sit nearer the output face: the tips at the ends of the long side, where they
      // form a thin band (a cable boot can share one end's tips, so take the tidier end)
      const L = pts.map(loc), ears = earBand(L, kk, ll, ext);
      if (ears) {
        const rel = ears.h / ext[kk];                        // >0: ears toward +k
        if (Math.abs(rel) > 0.08) for (const c of cand) if (c.k === kk && Math.sign(rel) === c.sH) { c.score += 2 + 4 * Math.min(Math.abs(rel), 0.5); c.ev.push('ears toward this face'); }
        /* Weak, model-dependent tie-break: a bump just past the body, low on the
           far side from the output, at one end (the cable exit; on the goBILDA
           2000 series it is at the spline end). Only ever outvotes nothing. */
        if (!opts.noCableCue) for (const c of cand) {
          if (c.k !== kk) continue;
          const boot = (sg) => L.filter((q) => Math.sign(q[ll]) === sg && Math.abs(q[ll]) > 0.40 * ext[ll] && Math.abs(q[ll]) < 0.5 * ext[ll] - 0.0015 && q[kk] * c.sH < -0.1 * ext[kk]).length;
          if (boot(c.sL) >= 2 && boot(-c.sL) === 0) { c.score += 1; c.ev.push('cable exit at this end (weak)'); }
        }
      }
    }
    // a boss or spline modelled into the case: the extreme cap is small and off-centre
    {
      const L = pts.map(loc);
      for (const c of cand) {
        const top = Math.max(...L.map((q) => q[c.k] * c.sH));
        const cap = L.filter((q) => q[c.k] * c.sH > top - 0.0025);
        if (cap.length < 2) continue;
        const spanL = Math.max(...cap.map((q) => q[c.l])) - Math.min(...cap.map((q) => q[c.l]));
        const spanW = Math.max(...cap.map((q) => q[w])) - Math.min(...cap.map((q) => q[w]));
        const mL = cap.reduce((s, q) => s + q[c.l], 0) / cap.length;
        // round and narrower than the body (an ear's tip spans the whole width), off-centre toward one end
        if (spanL < 0.45 * ext[c.l] && spanW < 0.75 * width && mL * c.sL > 0.25 * off) { c.score += 6; c.ev.push('boss on face'); }
      }
    }
    // what sits on each candidate output: a hub, horn or gear centred on it scores
    const bodySet = new Set([...bodyParts, ...splines, ...extra]);
    const near = [];
    for (let i = 0; i < N; i++) {
      if (bodySet.has(i) || isFastener(i) || role[i] === 'servoBody') continue;
      const g = geo(i); if (norm(sub(g.c, B.c)) > g.r + norm(ext) / 2 + 0.03) continue;
      near.push(i);
    }
    const axisOf = (c) => ({ a: mul(B.ax[c.k], c.sH), p: add(add(B.c, mul(B.ax[c.k], c.sH * ext[c.k] / 2)), mul(B.ax[c.l], c.sL * off)) });
    if (!opts.noNeighbours) for (const c of cand) {
      const { a, p } = axisOf(c);
      let best = 0;
      for (const i of near) {
        const g = geo(i), bc = g.B ? g.B.c : g.c;
        if (2 * g.r > 0.1) continue;                              // hubs, horns, gears: small
        const t = dot(sub(bc, p), a), d = lineDist(bc, p, a);
        if (t < -0.002 || t > 0.03) continue;
        let hit = 0; for (let s = 0.001; s <= 0.008; s += 0.001) if (inside(i, add(p, mul(a, s)), 0.0005)) hit++;
        if (!hit || inside(i, add(p, mul(a, -0.004)), 0.0005)) continue;      // it reaches into the body: a bracket, not a hub
        const v = d < 0.003 ? 5 : d < 0.006 ? 3 : 0.5;
        if (v > best) best = v;
      }
      if (best) { c.score += best; c.ev.push('hub on it (' + best + ')'); }
    }
    cand.sort((x, y) => y.score - x.score);
    const pick = cand[0], margin = pick.score - cand[1].score;
    let { a, p } = axisOf(pick);
    if (sp.length) {                                         // the spline itself is on the axis
      const sc = mul(sp.reduce((s, i) => add(s, geo(i).B ? geo(i).B.c : geo(i).c), [0, 0, 0]), 1 / sp.length);
      p = add(sc, mul(a, dot(sub(p, sc), a)));
    } else {
      // a hub centred on the chosen output: its centre is on the axis
      let hub = null;
      for (const i of near) {
        const g = geo(i), bc = g.B ? g.B.c : g.c; if (2 * g.r > 0.1) continue;
        const t = dot(sub(bc, p), a), d = lineDist(bc, p, a);
        if (t < -0.002 || t > 0.03 || d > 0.006) continue;
        const c = cylOf(i); if (!c || c.round < 0.85 || Math.abs(dot(c.axis, a)) < 0.9) continue;
        if (!hub || d < hub.d) hub = { i, d, bc };
      }
      if (hub) { const perp = sub(sub(hub.bc, p), mul(a, dot(sub(hub.bc, p), a))); p = add(p, perp); pick.ev.push('centred on hub'); }
    }
    const pn = [...bodyParts, ...splines].map((i) => S[i].part || pnOf(nameOf(i))).find((x) => x && SERVO_PN.test(x)) ||
               [...bodyParts, ...splines].map((i) => anc[i] && pnOf(anc[i].name)).find((x) => x && SERVO_PN.test(x)) || null;
    return { kind: 'servo', axis: a, face: p, tip: add(p, mul(a, 0.004)), zone: 0.004, box: ext.map((v) => +(v * 1000).toFixed(1)),
      body: [...bodyParts, ...extra], output: splines.slice(), part: pn, family: pn ? null : 'standard-size servo',
      why: ['face/end: ' + (pick.ev.join(', ') || 'no evidence'), 'margin ' + margin.toFixed(1)], confidence: margin,
      // no spline and nothing decisive on either end: the output may be at the other end (about one body-width away)
      ambiguous: margin < 1.5 };
  }

  /* ---- 3. what turns with each output, what holds each body ---- */
  for (const A of acts) {
    const a = A.axis, F = A.face, bodySet = new Set(A.body), out = new Set(A.output);
    const zone = Math.max(A.zone + 0.004, 0.012);
    const Rb = Math.max(...A.body.map((i) => norm(sub(geo(i).c, F)) + geo(i).r));
    const mounts = new Set(), attached = new Set(), bigOut = [];
    for (let i = 0; i < N; i++) {
      if (bodySet.has(i) || out.has(i) || role[i] === 'servoBody' || role[i] === 'motorPiece') continue;
      const g = geo(i);
      if (lineDist(g.c, F, a) > g.r + 0.002 && norm(sub(g.c, F)) > g.r + Rb) continue;
      let front = 0, back = 0;
      for (let s = 0.001; s <= zone; s += 0.001) if (inside(i, add(F, mul(a, s)), 0.0003)) front++;
      for (let s = 0.0025; s <= 0.008; s += 0.001) if (inside(i, add(F, mul(a, -s)), 0.0003)) back++;
      const bc = g.B ? g.B.c : g.c, coax = lineDist(bc, F, a) < 0.003;
      if (front && !back && 2 * g.r < 0.06) out.add(i);                       // hub, horn, spline, small gear
      else if (front && !back && coax) bigOut.push(i);                         // wheel, big gear, spool ... or a frame member
      else if (back) mounts.add(i);
    }
    /* A big part centred on the output is on the shaft only if it clears the
       body and what holds it: a channel bolted flat to the motor's mount (and
       merely centred on it) is frame. Hubs are allowed to sit flush. */
    for (const i of bigOut) {
      const held = [...A.body, ...mounts].some((m) => touches(i, m, 0.0003));
      if (held) mounts.add(i); else out.add(i);
    }
    // along a coaxial shaft that came out of the output: the hubs and gears on it
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of [...out]) {
        const c = cylOf(s); if (!c || c.dia > 0.016 || Math.abs(dot(c.axis, a)) < 0.97 || lineDist(c.c, F, a) > 0.003) continue;
        let s1 = -Infinity; for (const p of geo(s).P) s1 = Math.max(s1, dot(sub(p, F), a));
        for (let i = 0; i < N; i++) {
          if (bodySet.has(i) || out.has(i) || mounts.has(i) || role[i]) continue;
          const g = geo(i), bc = g.B ? g.B.c : g.c; if (lineDist(bc, F, a) > 0.003) continue;
          const t = dot(sub(bc, F), a); if (t < 0 || t > s1 + 0.002) continue;
          if (2 * g.r > 0.12) continue;
          out.add(i); grew = true;
        }
      }
    }
    // gears on the output, and the gear each one meshes with (a follower, not part of this output)
    const outL = [...out];
    const disc = (i) => { const c = cylOf(i); return c && c.round > 0.85 && c.dia > 0.012 && c.len < 0.6 * c.dia ? c : null; };
    A.gears = outL.filter((i) => { const c = disc(i); return (GEARISH.test(nameOf(i)) || (c && c.dia > 0.025)) && c && Math.abs(dot(c.axis, a)) > 0.95; });
    A.meshes = [];
    for (const g1 of A.gears) {
      const c1 = disc(g1);
      for (let i = 0; i < N; i++) {
        if (i === g1 || out.has(i) || bodySet.has(i) || role[i]) continue;
        const c2 = disc(i); if (!c2 || Math.abs(dot(c1.axis, c2.axis)) < 0.97) continue;
        const v = sub(c2.c, c1.c), along = dot(v, c1.axis), cd = norm(sub(v, mul(c1.axis, along)));
        if (Math.abs(along) > 0.01 || Math.abs(cd - (c1.dia + c2.dia) / 2) > 0.004) continue;
        A.meshes.push({ gear: g1, with: i, ratio: +(-(c1.dia / c2.dia)).toFixed(3), named: GEARISH.test(nameOf(i)) && GEARISH.test(nameOf(g1)),
          withAxis: c2.axis.map((x) => +x.toFixed(4)), withCentre: c2.c.map((x) => +(x * 1000).toFixed(1)) });
      }
    }
    const partners = new Set(A.meshes.map((m) => m.with));
    // parts bolted to the output hub/horn/gear (and not to the body): the lever it swings
    for (const h of outL) {
      for (let i = 0; i < N; i++) {
        if (bodySet.has(i) || out.has(i) || mounts.has(i) || attached.has(i) || partners.has(i) || role[i] || isFastener(i)) continue;
        if (!touches(i, h, 0.0006)) continue;
        if (A.body.some((b) => touches(i, b, 0.0006))) continue;
        attached.add(i);
      }
    }
    // body side: the actuator's own pieces, the parts wrapping or holding it
    for (const b of A.body) for (let i = 0; i < N; i++) {
      if (bodySet.has(i) || out.has(i) || mounts.has(i) || attached.has(i) || role[i] === 'servoBody' || role[i] === 'motorPiece' || isFastener(i)) continue;
      const g = geo(i); if (norm(sub(g.c, geo(b).c)) > g.r + geo(b).r + 0.002) continue;
      // wraps it: the body's centre is inside the part's hull, or they share a face
      if (inside(i, geo(b).B ? geo(b).B.c : geo(b).c, 0.001)) mounts.add(i);
      else if (touches(i, b, 0.0006)) mounts.add(i);
    }
    A.output = outL; A.attached = [...attached]; A.mounts = [...mounts];
  }

  /* ---- 5. role: drive wheel, swerve steering, a joint, or nothing on it ---- */
  const up = opts.up ? unit(opts.up) : [0, 0, 1];
  // the bench's robot frame has the floor through the origin (src/frame.js); a part drawn
  // through the floor (a mis-folded linkage) must not move it
  const floor = Number.isFinite(opts.floor) ? opts.floor : 0;
  for (const A of acts) {
    A.drive = false; A.role = null; A.wheel = null;
    for (let wi = 0; wi < wheels.length; wi++) {
      const W = wheels[wi], par = Math.abs(dot(A.axis, W.axis));
      const dLine = lineDist(W.c, A.face, A.axis), tW = dot(sub(W.c, A.face), A.axis);
      if (par > 0.95 && dLine < Math.max(0.012, 0.3 * W.r) && tW > -0.01 && tW < 0.2) { A.drive = true; A.role = 'drive'; A.wheel = wi; A.why.push('coaxial with drive wheel ' + wi); break; }
      const pv = sub(A.face, W.c), plan = norm(sub(pv, mul(up, dot(pv, up))));
      if (Math.abs(dot(A.axis, up)) > 0.95 && par < 0.3) {
        const lineplan = plan;
        if (lineplan < 0.6 * W.r) { A.drive = true; A.role = 'steer'; A.wheel = wi; A.why.push('vertical axis through drive wheel ' + wi + ' (steering)'); break; }
        if (A.kind === 'motor' && lineplan < 1.2 * W.r && dot(pv, up) < 3 * W.r) { A.drive = true; A.role = 'drive'; A.wheel = wi; A.why.push('vertical motor in drive wheel ' + wi + '\'s module'); break; }
      }
      if (A.kind === 'motor' && par > 0.95 && plan < Math.min(0.1, 2.2 * W.r) && Math.abs(dot(pv, up)) < W.r) {
        A.drive = true; A.role = 'drive'; A.wheel = wi; A.why.push('beside drive wheel ' + wi + ', axles parallel (chain/belt)'); break;
      }
    }
    if (!A.drive) {
      const wheelOut = A.output.find((i) => S[i].kind === 'wheel' || WHEELISH.test(nameOf(i)));
      if (wheelOut != null) { A.drive = true; A.role = 'drive'; A.why.push('a wheel on the output'); }
    }
    /* No wheel list and no wheel names: a horizontal output whose big coaxial
       part (60 mm+ across), or what is bolted to it, reaches the floor. */
    if (!A.drive && Math.abs(dot(A.axis, up)) < 0.2) {
      const big = A.output.filter((i) => { const c = cylOf(i); return c && c.dia >= 0.06 && Math.abs(dot(c.axis, A.axis)) > 0.9; });
      if (big.length) {
        const low = Math.min(...[...big, ...A.attached].map((i) => Math.min(...geo(i).P.map((p) => dot(p, up)))));
        if (low < floor + 0.006) { A.drive = true; A.role = 'drive'; A.why.push('a round part on the output rolls on the floor'); }
      }
    }
    if (!A.role) {
      const turning = A.output.filter((i) => !(A.kind === 'motor' && (() => { const c = cylOf(i); return c && c.dia <= 0.016; })()) && role[i] !== 'spline');
      if (!turning.length && !A.attached.length) { A.role = 'unloaded'; A.why.push('nothing modelled turns with the output'); }
      else if (A.output.some((i) => /\b(spool|winch|pulley|capstan|sprocket)\b/i.test(nameOf(i)))) { A.role = 'transmission'; A.why.push('a spool/pulley/sprocket on the output'); }
      else A.role = 'joint';
    }
  }

  /* ---- 6. a part number by likeness: an unnumbered actuator whose body has the
     same pieces and size as numbered ones (copies placed outside the vendor's
     subassembly). A guess, kept apart from `part`: the same case or gearmotor
     housing comes in several ratios, so siblings in the same role are preferred
     and all of them must agree. ---- */
  const dims = (A) => A.body.map((i) => (geo(i).B ? geo(i).B.ext : [0, 0, 0]).slice().sort((x, y) => x - y)).sort((x, y) => x[2] - y[2] || x[1] - y[1]);
  const alike = (A, B) => { if (A.kind !== B.kind || A.body.length !== B.body.length) return false;
    const a = dims(A), b = dims(B); return a.every((d, n) => d.every((v, k) => Math.abs(v - b[n][k]) < 0.0015)); };
  for (const A of acts) {
    if (A.part) continue;
    // a gearmotor housing fits several ratios: only a sibling doing the same job is evidence
    const pool = acts.filter((B) => B !== A && B.part && alike(A, B) && (A.kind === 'servo' || B.role === A.role));
    const pns = [...new Set(pool.map((B) => B.part))];
    if (pns.length === 1) { A.partGuess = pns[0]; A.why.push('part number guessed from ' + pool.length + ' identical ' + A.kind + (pool.length > 1 ? 's' : '') + (A.kind === 'motor' ? ' in the same role' : '')); }
  }

  // plain data out
  const r3 = (v) => v.map((x) => +x.toFixed(4));
  const mm3 = (v) => v.map((x) => +(x * 1000).toFixed(1));
  const actuators = acts.map((A, n) => ({
    id: (A.drive ? (A.role === 'steer' ? 'steer ' : 'drive ') : '') + A.kind + ' ' + (n + 1),
    kind: A.kind, role: A.role, drive: A.drive, wheel: A.wheel,
    axis: r3(A.axis), pivot: mm3(A.face), tip: mm3(A.tip),
    output: A.output, attached: A.attached, body: A.body, mounts: A.mounts,
    gears: A.gears, meshes: A.meshes,
    part: A.part, partGuess: A.partGuess || null, family: A.family,
    spec: (A.part || A.partGuess) && typeof opts.hwFromPart === 'function' ? opts.hwFromPart(A.part || A.partGuess, '') : null,
    box: A.box, confidence: A.confidence, ambiguous: !!A.ambiguous, shapeOnly: !!A.shapeOnly, why: A.why
  }));
  return { actuators, notes };
}
