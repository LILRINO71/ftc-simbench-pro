// tools/stepgen.mjs — writes STEP assemblies the way Onshape exports them, with
// REAL B-rep solids, so the bench can be tested on geometry it will actually meet.
//
// Usage
//   node tools/stepgen.mjs                  write every robot in the corpus to tests/fixtures/robots/
//   node tools/stepgen.mjs mecanum-zup big  write only these
//   node tools/stepgen.mjs --check          ...and tessellate each file with OpenCascade (occt-import-js)
//   node tools/stepgen.mjs --out <dir>      write somewhere else
//   OCCT_IMPORT_JS=<path to occt-import-js> overrides where --check looks for the module
//   npm run corpus                          same as `node tools/stepgen.mjs --check`
//
// Each robot <name>.step comes with <name>.json: the ground truth the acceptance
// suite (tests/anyrobot.test.mjs) holds the engine to — up axis, front axis, the
// wheel centroid in CAD coordinates, the floor height along up, the drive kind,
// wheel count and radius, the true mass and the true extent of the solids.
//
// What gets written is what Onshape's AP242/AP214 export contains:
//   PRODUCT / PRODUCT_DEFINITION_FORMATION / PRODUCT_DEFINITION per part and subassembly,
//   NEXT_ASSEMBLY_USAGE_OCCURRENCE for the tree, ITEM_DEFINED_TRANSFORMATION +
//   REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION + CONTEXT_DEPENDENT_SHAPE_REPRESENTATION
//   for placement, and every body a MANIFOLD_SOLID_BREP / CLOSED_SHELL of ADVANCED_FACEs
//   on PLANEs and CYLINDRICAL_SURFACEs bounded by EDGE_LOOPs of EDGE_CURVEs (LINE, CIRCLE)
//   between VERTEX_POINTs. Cylinders come split into two half faces the way Parasolid
//   writes them (or as one face with a seam). Units ride on the representation context:
//   SI metres, MILLI metres, or CONVERSION_BASED_UNIT('INCH'). Colours ride on
//   STYLED_ITEM -> ... -> COLOUR_RGB under a MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION.
//
// No dependencies. Everything below is metres internally.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = path.join(ROOT, 'tests', 'fixtures', 'robots');
export const OCCT_DEFAULT = 'C:\\Users\\hiheo\\AppData\\Local\\Temp\\claude\\C--Users-hiheo-Claude\\4b805a14-c01f-4a62-a002-ee14af4baa67\\scratchpad\\occt\\node_modules\\occt-import-js';

/* ---------------- small vector kit ---------------- */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

/* A frame: origin o, axes x, y, z (orthonormal, right handed). */
export function frame(o = [0, 0, 0], z = [0, 0, 1], x = null) {
  z = norm(z);
  if (!x) x = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = dot(x, z); x = norm(sub(x, mul(z, d)));
  return { o: o.slice(), x, y: cross(z, x), z };
}
const IDF = frame();
const fPt = (F, p) => add(F.o, add(mul(F.x, p[0]), add(mul(F.y, p[1]), mul(F.z, p[2]))));
const fDir = (F, v) => add(mul(F.x, v[0]), add(mul(F.y, v[1]), mul(F.z, v[2])));
/* parent∘child: a child frame given in the parent's coordinates, to world */
export const compose = (P, C) => ({ o: fPt(P, C.o), x: fDir(P, C.x), y: fDir(P, C.y), z: fDir(P, C.z) });
const rotZ = (deg) => { const a = deg * Math.PI / 180; return frame([0, 0, 0], [0, 0, 1], [Math.cos(a), Math.sin(a), 0]); };

/* ---------------- primitives (all in a part's own coordinates) ----------------
   prism: a planar profile (CCW in the frame's xy) extruded along the frame's z.
   cyl:   radius r, height h from the frame origin along its z; the seam and the
          split vertices sit on the frame's +x / -x. */
export const prism = (F, profile, h) => ({ type: 'prism', F, profile, h });
export const box = (c, s) => prism(frame([c[0], c[1], c[2] - s[2] / 2]), [[-s[0] / 2, -s[1] / 2], [s[0] / 2, -s[1] / 2], [s[0] / 2, s[1] / 2], [-s[0] / 2, s[1] / 2]], s[2]);
export const cyl = (F, r, h, split = 2) => ({ type: 'cyl', F, r, h, split });
const ngon = (n, R, rot = 0) => Array.from({ length: n }, (_, i) => { const a = rot + 2 * Math.PI * i / n; return [R * Math.cos(a), R * Math.sin(a)]; });

/* Surface samples of a primitive, for the TRUE extent (not the vertices). */
function primSamples(p) {
  const out = [];
  if (p.type === 'prism') {
    for (const q of p.profile) { out.push(fPt(p.F, [q[0], q[1], 0])); out.push(fPt(p.F, [q[0], q[1], p.h])); }
  } else {
    for (let i = 0; i < 180; i++) {
      const a = 2 * Math.PI * i / 180, c = Math.cos(a) * p.r, s = Math.sin(a) * p.r;
      out.push(fPt(p.F, [c, s, 0])); out.push(fPt(p.F, [c, s, p.h]));
    }
  }
  return out;
}

/* ---------------- products ---------------- */
let PID = 0;
/* part: {name, bodies:[prim], color:[r,g,b], kg} */
export const part = (name, bodies, color, kg, extra = {}) => Object.assign({ uid: ++PID, name, kind: 'part', bodies, color, kg }, extra);
/* asm: {name, children:[{p:product, F:frame}]} */
export const asm = (name, children = []) => ({ uid: ++PID, name, kind: 'asm', children });
export const inst = (p, F) => ({ p, F });

/* Walk the tree; cb(product, worldFrame, depth, pathNames). */
export function walk(root, cb, F = IDF, depth = 0) {
  cb(root, F, depth);
  if (root.kind === 'asm') for (const c of root.children) walk(c.p, cb, compose(F, c.F), depth + 1);
}

/* ---------------- the STEP writer ---------------- */
function fmt(v) {
  if (!Number.isFinite(v)) throw new Error('non-finite coordinate');
  if (Math.abs(v) < 5e-11) return '0.';
  let s = String(+v.toFixed(9));
  if (/e/i.test(s)) { const [m, e] = v.toExponential(8).split('e'); s = (m.includes('.') ? m.replace(/0+$/, '') : m + '.') + 'E' + e; }
  else if (!s.includes('.')) s += '.';
  return s;
}
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

class Writer {
  constructor(unitM) { this.n = 0; this.out = []; this.unit = unitM; this.dirs = new Map(); }
  add(txt) { const id = ++this.n; this.out.push('#' + id + '=' + txt + ';'); return id; }
  L(v) { return fmt(v / this.unit); }
  cp(p) { return this.add('CARTESIAN_POINT(\'\',(' + p.map((v) => this.L(v)).join(',') + '))'); }
  dir(v) {
    const k = v.map((x) => fmt(Math.abs(x) < 1e-12 ? 0 : +x.toFixed(12))).join(',');
    if (!this.dirs.has(k)) this.dirs.set(k, this.add('DIRECTION(\'\',(' + k + '))'));
    return this.dirs.get(k);
  }
  axis(F) { return this.add('AXIS2_PLACEMENT_3D(\'\',#' + this.cp(F.o) + ',#' + this.dir(F.z) + ',#' + this.dir(F.x) + ')'); }
}

/* One primitive as a MANIFOLD_SOLID_BREP. Returns the brep id. */
function writeBody(W, prim, name, bake) {
  const P = (p) => (bake ? fPt(bake, p) : p);
  const D = (v) => (bake ? fDir(bake, v) : v);
  const F0 = bake ? compose(bake, prim.F) : prim.F;
  const faces = [];
  const vp = (p) => W.add('VERTEX_POINT(\'\',#' + W.cp(p) + ')');
  const line = (a, b) => { const d = sub(b, a), L = Math.hypot(...d);
    const vec = W.add('VECTOR(\'\',#' + W.dir(norm(d)) + ',' + W.L(L) + ')');
    return W.add('LINE(\'\',#' + W.cp(a) + ',#' + vec + ')'); };
  const oe = (e, s) => W.add('ORIENTED_EDGE(\'\',*,*,#' + e + ',' + (s ? '.T.' : '.F.') + ')');
  const face = (surf, loops, same = true) => {
    const b = loops.map((lp, i) => W.add((i ? 'FACE_BOUND' : 'FACE_OUTER_BOUND') + '(\'\',#' + W.add('EDGE_LOOP(\'\',(' + lp.map((x) => '#' + x).join(',') + '))') + ',.T.)'));
    faces.push(W.add('ADVANCED_FACE(\'\',(' + b.map((x) => '#' + x).join(',') + '),#' + surf + ',' + (same ? '.T.' : '.F.') + ')'));
  };

  if (prim.type === 'prism') {
    const n = prim.profile.length;
    const pts = [];
    for (const qq of prim.profile) pts.push(fPt(F0, [qq[0], qq[1], 0]));
    for (const qq of prim.profile) pts.push(fPt(F0, [qq[0], qq[1], prim.h]));
    const V = pts.map(vp);
    const loops = [];
    loops.push(Array.from({ length: n }, (_, i) => n - 1 - i));               // bottom, seen from below
    loops.push(Array.from({ length: n }, (_, i) => n + i));                   // top
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; loops.push([i, j, n + j, n + i]); }
    const edges = new Map();
    for (const lp of loops) {
      const oes = [];
      for (let k = 0; k < lp.length; k++) {
        const a = lp[k], b = lp[(k + 1) % lp.length], key = Math.min(a, b) + '|' + Math.max(a, b);
        if (!edges.has(key)) edges.set(key, { id: W.add('EDGE_CURVE(\'\',#' + V[a] + ',#' + V[b] + ',#' + line(pts[a], pts[b]) + ',.T.)'), s: a });
        const e = edges.get(key); oes.push(oe(e.id, e.s === a));
      }
      // Newell normal, origin at the first vertex, x along the first edge
      let nn = [0, 0, 0];
      for (let k = 0; k < lp.length; k++) { const a = pts[lp[k]], b = pts[lp[(k + 1) % lp.length]];
        nn = add(nn, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]); }
      const pl = W.add('PLANE(\'\',#' + W.axis(frame(pts[lp[0]], norm(nn), sub(pts[lp[1]], pts[lp[0]]))) + ')');
      face(pl, [oes]);
    }
  } else {
    const { r, h } = prim, F = F0, a = F.z;
    const c0 = F.o, c1 = add(F.o, mul(a, h));
    const Fb = frame(c0, a, F.x), Ft = frame(c1, a, F.x);
    const circ = (Fc) => W.add('CIRCLE(\'\',#' + W.axis(Fc) + ',' + W.L(r) + ')');
    const cb = circ(Fb), ct = circ(Ft);
    const cylS = W.add('CYLINDRICAL_SURFACE(\'\',#' + W.axis(Fb) + ',' + W.L(r) + ')');
    const planeB = W.add('PLANE(\'\',#' + W.axis(frame(c0, mul(a, -1), F.x)) + ')');
    const planeT = W.add('PLANE(\'\',#' + W.axis(frame(c1, a, F.x)) + ')');
    const ec = (v1, v2, c) => W.add('EDGE_CURVE(\'\',#' + v1 + ',#' + v2 + ',#' + c + ',.T.)');
    const p0 = add(c0, mul(F.x, r)), p2 = add(c1, mul(F.x, r));
    const V0 = vp(p0), V2 = vp(p2);
    if (prim.split === 1) {
      const Eb = ec(V0, V0, cb), Et = ec(V2, V2, ct), L0 = ec(V0, V2, line(p0, p2));
      face(planeB, [[oe(Eb, false)]]);
      face(planeT, [[oe(Et, true)]]);
      face(cylS, [[oe(Eb, true), oe(L0, true), oe(Et, false), oe(L0, false)]]);
    } else {
      const p1 = add(c0, mul(F.x, -r)), p3 = add(c1, mul(F.x, -r));
      const V1 = vp(p1), V3 = vp(p3);
      const Eb1 = ec(V0, V1, cb), Eb2 = ec(V1, V0, cb), Et1 = ec(V2, V3, ct), Et2 = ec(V3, V2, ct);
      const L0 = ec(V0, V2, line(p0, p2)), L1 = ec(V1, V3, line(p1, p3));
      face(planeB, [[oe(Eb2, false), oe(Eb1, false)]]);
      face(planeT, [[oe(Et1, true), oe(Et2, true)]]);
      face(cylS, [[oe(Eb1, true), oe(L1, true), oe(Et1, false), oe(L0, false)]]);
      face(cylS, [[oe(Eb2, true), oe(L0, true), oe(Et2, false), oe(L1, false)]]);
    }
  }
  const shell = W.add('CLOSED_SHELL(\'\',(' + faces.map((x) => '#' + x).join(',') + '))');
  return W.add('MANIFOLD_SOLID_BREP(' + q(name) + ',#' + shell + ')');
}

/* model -> STEP text. opts.units: 'm' | 'mm' | 'in'. */
export function writeStep(root, opts = {}) {
  const units = opts.units || 'mm';
  const unitM = units === 'in' ? 0.0254 : units === 'mm' ? 0.001 : 1;
  const W = new Writer(unitM);
  W.add('APPLICATION_CONTEXT(\'core data for automotive mechanical design processes\')');
  const appCtx = 1;
  W.add('APPLICATION_PROTOCOL_DEFINITION(\'international standard\',\'automotive_design\',2010,#' + appCtx + ')');
  const pdc = W.add('PRODUCT_DEFINITION_CONTEXT(\'part definition\',#' + appCtx + ',\'design\')');
  const pc = W.add('PRODUCT_CONTEXT(\'\',#' + appCtx + ',\'mechanical\')');
  let lu;
  if (units === 'in') {
    const mm = W.add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
    const lmwu = W.add('LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#' + mm + ')');
    const dim = W.add('DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)');
    lu = W.add('(CONVERSION_BASED_UNIT(\'INCH\',#' + lmwu + ')LENGTH_UNIT()NAMED_UNIT(#' + dim + '))');
  } else lu = W.add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(' + (units === 'mm' ? '.MILLI.' : '$') + ',.METRE.))');
  const au = W.add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const su = W.add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = W.add('UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(' + fmt(1e-6 / unitM) + '),#' + lu + ',\'distance_accuracy_value\',\'confusion accuracy\')');
  const ctx = W.add('(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#' + unc + '))GLOBAL_UNIT_ASSIGNED_CONTEXT((#' + lu + ',#' + au + ',#' + su + '))REPRESENTATION_CONTEXT(\'Context #1\',\'3D Context with UNIT and UNCERTAINTY\'))');

  const done = new Map();     // product uid -> {pd, sr, origin}
  const styled = [];
  const colours = new Map();
  const colourStyle = (rgb) => {
    const k = rgb.join(',');
    if (!colours.has(k)) {
      const col = W.add('COLOUR_RGB(\'\',' + rgb.map(fmt).join(',') + ')');
      const fasc = W.add('FILL_AREA_STYLE_COLOUR(\'\',#' + col + ')');
      const fas = W.add('FILL_AREA_STYLE(\'\',(#' + fasc + '))');
      const ssfa = W.add('SURFACE_STYLE_FILL_AREA(#' + fas + ')');
      const ssr = W.add('SURFACE_STYLE_RENDERING(.NORMAL_SHADING.,#' + col + ')');
      const sss = W.add('SURFACE_SIDE_STYLE(\'\',(#' + ssfa + ',#' + ssr + '))');
      const ssu = W.add('SURFACE_STYLE_USAGE(.BOTH.,#' + sss + ')');
      colours.set(k, W.add('PRESENTATION_STYLE_ASSIGNMENT((#' + ssu + '))'));
    }
    return colours.get(k);
  };

  function emit(p) {
    if (done.has(p.uid)) return done.get(p.uid);
    // children first, so the parent's representation can list their placements
    const kids = p.kind === 'asm' ? p.children.map((c) => ({ c, d: emit(c.p) })) : [];
    const prod = W.add('PRODUCT(' + q(p.name) + ',' + q(p.name) + ',\'\',(#' + pc + '))');
    W.add('PRODUCT_RELATED_PRODUCT_CATEGORY(\'part\',$,(#' + prod + '))');
    const pdf = W.add('PRODUCT_DEFINITION_FORMATION(\'\',\'\',#' + prod + ')');
    const pd = W.add('PRODUCT_DEFINITION(\'design\',\'\',#' + pdf + ',#' + pdc + ')');
    const pds = W.add('PRODUCT_DEFINITION_SHAPE(\'\',\'\',#' + pd + ')');
    const origin = W.axis(IDF);
    const placeAx = kids.map((k) => W.axis(k.c.F));
    const sr = W.add('SHAPE_REPRESENTATION(' + q(p.name) + ',(' + [origin].concat(placeAx).map((x) => '#' + x).join(',') + '),#' + ctx + ')');
    W.add('SHAPE_DEFINITION_REPRESENTATION(#' + pds + ',#' + sr + ')');
    if (p.kind === 'part') {
      const breps = p.bodies.map((b, i) => writeBody(W, b, p.bodies.length > 1 ? p.name + ' body ' + (i + 1) : p.name, p.bake || null));
      const absr = W.add('ADVANCED_BREP_SHAPE_REPRESENTATION(' + q(p.name) + ',(' + breps.map((x) => '#' + x).join(',') + ',#' + W.axis(IDF) + '),#' + ctx + ')');
      W.add('SHAPE_REPRESENTATION_RELATIONSHIP(\'\',\'\',#' + sr + ',#' + absr + ')');
      if (p.color) { const psa = colourStyle(p.color); for (const b of breps) styled.push(W.add('STYLED_ITEM(\'color\',(#' + psa + '),#' + b + ')')); }
    }
    kids.forEach((k, i) => {
      const nauo = W.add('NEXT_ASSEMBLY_USAGE_OCCURRENCE(' + q('NAUO' + W.n) + ',' + q(k.c.p.name) + ',\'\',#' + pd + ',#' + k.d.pd + ',$)');
      const npds = W.add('PRODUCT_DEFINITION_SHAPE(\'Placement\',\'Placement of an item\',#' + nauo + ')');
      const idt = W.add('ITEM_DEFINED_TRANSFORMATION(\'\',\'\',#' + k.d.origin + ',#' + placeAx[i] + ')');
      const rr = W.add('(REPRESENTATION_RELATIONSHIP(\'\',\'\',#' + k.d.sr + ',#' + sr + ')REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#' + idt + ')SHAPE_REPRESENTATION_RELATIONSHIP())');
      W.add('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#' + rr + ',#' + npds + ')');
    });
    const d = { pd, sr, origin };
    done.set(p.uid, d);
    return d;
  }
  emit(root);
  if (styled.length) W.add('MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION(\'\',(' + styled.map((x) => '#' + x).join(',') + '),#' + ctx + ')');

  const stamp = opts.stamp || '2026-09-20T00:00:00';
  return ['ISO-10303-21;', 'HEADER;',
    "FILE_DESCRIPTION(('Onshape style assembly export, generated by ftc-simbench-pro tools/stepgen.mjs'),'2;1');",
    'FILE_NAME(' + q(opts.name || root.name) + ",'" + stamp + "',(''),(''),'stepgen 1.0','stepgen','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }'));", 'ENDSEC;', 'DATA;']
    .concat(W.out, ['ENDSEC;', 'END-ISO-10303-21;', '']).join('\n');
}

/* ---------------- goBILDA-ish parts library (metres) ---------------- */
const COL = { alu: [0.78, 0.8, 0.82], yellow: [0.95, 0.77, 0.1], black: [0.1, 0.1, 0.1], grey: [0.35, 0.36, 0.38],
  rubber: [0.15, 0.15, 0.15], orange: [0.95, 0.45, 0.1], clear: [0.8, 0.9, 1], steel: [0.6, 0.6, 0.62], blue: [0.1, 0.3, 0.8] };

/* goBILDA 1120 U-channel, 48 x 48 mm, 2.5 mm wall, open side toward local +y; length along local z from 0. */
function uProfile() {
  const o = 0.024, i = 0.0215;
  return [[-o, -o], [o, -o], [o, o], [i, o], [i, -i], [-i, -i], [-i, o], [-o, o]];
}
const uChannel = (len, name) => part(name || ('1120 Series U-Channel ' + Math.round(len * 1000) + 'mm'), [prism(IDF, uProfile(), len)], COL.alu, 0.45 * len);
const plate = (sx, sy, t, name, kg) => part(name, [box([0, 0, t / 2], [sx, sy, t])], COL.alu, kg != null ? kg : sx * sy * t * 2700 * 0.6);

/* 5203 Yellow Jacket: output face at z=0 pointing +z; hex shaft out, gearbox and can behind. */
function motor5203(name, split = 2) {
  return part(name || 'goBILDA 5203 Series Yellow Jacket Planetary Gear Motor 5203-2402-0019', [
    prism(frame([0, 0, -0.040]), ngon(4, 0.0304, Math.PI / 4), 0.040),                // 43 x 43 gearbox
    cyl(frame([0, 0, -0.100]), 0.0185, 0.060, split),                                  // 37 mm can
    prism(frame([0, 0, 0]), ngon(6, 0.0046), 0.025)                                    // 8 mm hex output shaft
  ], COL.yellow, 0.310);
}

/* Wheels: axle along local z, centred on the origin. */
function mecanumWheel(hand) {            // hand 'L' -> rollers run front-left/back-right at the contact patch when the axle points +y
  const s = hand === 'L' ? -1 : 1, bodies = [cyl(frame([0, 0, -0.023]), 0.030, 0.046)];
  const N = 10, rc = 0.0415, rr = 0.0105, L = 0.030;
  for (let i = 0; i < N; i++) {
    const phi = 2 * Math.PI * (i + 0.5) / N;
    const c = [rc * Math.cos(phi), rc * Math.sin(phi), 0], t = [-Math.sin(phi), Math.cos(phi), 0];
    const ax = norm(add(t, [0, 0, s]));
    bodies.push(cyl(frame(sub(c, mul(ax, L / 2)), ax, [Math.cos(phi), Math.sin(phi), 0]), rr, L));
  }
  return part('goBILDA 104mm Mecanum Wheel (' + (hand === 'L' ? 'Left' : 'Right') + ') 3213-0001-' + (hand === 'L' ? '0001' : '0002'), bodies, COL.black, 0.335);
}
function omniWheel(name) {
  const bodies = [cyl(frame([0, 0, -0.019]), 0.028, 0.038)];
  const N = 8, rc = 0.040, rr = 0.0078, L = 0.014;
  for (const zz of [-0.009, 0.009]) for (let i = 0; i < N; i++) {
    const phi = 2 * Math.PI * (i + (zz > 0 ? 0.5 : 0)) / N;
    const c = [rc * Math.cos(phi), rc * Math.sin(phi), zz], t = [-Math.sin(phi), Math.cos(phi), 0];
    bodies.push(cyl(frame(sub(c, mul(t, L / 2)), t, [Math.cos(phi), Math.sin(phi), 0]), rr, L));
  }
  return part(name || 'goBILDA 96mm Omni Wheel 3606-0014-0096', bodies, COL.grey, 0.170);
}
function tractionWheel(name) {
  const bodies = [cyl(frame([0, 0, -0.015]), 0.048, 0.030), cyl(frame([0, 0, -0.020]), 0.020, 0.040)];
  for (let i = 0; i < 12; i++) {                 // tread blocks, just inside the tyre
    const phi = 2 * Math.PI * i / 12, u = [Math.cos(phi), Math.sin(phi), 0];
    bodies.push(prism(frame([0, 0, -0.015], [0, 0, 1], [1, 0, 0]),
      [[0.042, -0.003], [0.047, -0.003], [0.047, 0.003], [0.042, 0.003]].map(([a, b]) => [a * u[0] - b * u[1], a * u[1] + b * u[0]]), 0.030));
  }
  return part(name || 'goBILDA 96mm Traction Wheel 3614-0001-0096', bodies, COL.rubber, 0.120);
}
const battery = () => part('REV Slim Battery 12V', [box([0, 0, 0.0235], [0.135, 0.080, 0.047])], COL.black, 0.570);
const controlHub = () => part('REV Control Hub REV-31-1595', [box([0, 0, 0.015], [0.143, 0.103, 0.030])], COL.black, 0.270);
const servo = () => part('2000 Series Dual Mode Servo (25-2) 2000-0025-0002', [box([0, 0, 0], [0.040, 0.020, 0.037]), cyl(frame([0.010, 0, 0.0185]), 0.006, 0.006)], COL.black, 0.084);
const screw = () => part('M4 x 10mm Socket Head Cap Screw 2802-0004-0010', [cyl(frame([0, 0, -0.010]), 0.002, 0.010), cyl(frame([0, 0, 0]), 0.0035, 0.004)], COL.steel, 0.002);
const nut = () => part('M4 Nyloc Nut 2811-0004-0001', [prism(frame([0, 0, 0]), ngon(6, 0.004), 0.0032)], COL.steel, 0.0008);

/* Placements that turn a part's local z (its axle / its length) into a robot axis. */
const axleY = (c, outward) => frame(c, [0, outward, 0], [1, 0, 0]);   // wheel axle along +-y

/* ---------------- robots ----------------
   Every robot is described in ROBOT coordinates (x forward, y left, z up, origin at
   the drivetrain centre on the floor), then placed into CAD coordinates by the
   variant's frame V. `truth` is filled in robot coordinates and converted. */

const WR = 0.052;                       // 104 mm mecanum
function mecanumBase(opts = {}) {
  const kids = [], wheels = [];
  const WX = 0.168, WY = 0.200;
  const corners = [['FL', WX, WY, 'L'], ['FR', WX, -WY, 'R'], ['BL', -WX, WY, 'R'], ['BR', -WX, -WY, 'L']];
  const wL = mecanumWheel('L'), wRt = mecanumWheel('R'), mot = motor5203();
  const modules = [];
  for (const [cn, x, y, hand] of corners) {
    const out = Math.sign(y);
    const wF = axleY([x, y, WR], out), mF = axleY([x, out * 0.126, WR], out);
    const w = hand === 'L' ? wL : wRt;
    modules.push({ cn, wheel: inst(w, wF), motor: inst(mot, mF) });
    wheels.push({ corner: cn, c: [x, y, WR], axle: [0, out, 0], r: WR });
  }
  const railL = uChannel(0.448, '1120 Series U-Channel 448mm Left Rail'), railR = uChannel(0.448, '1120 Series U-Channel 448mm Right Rail');
  const crossF = uChannel(0.252, '1120 Series U-Channel 252mm Front'), crossB = uChannel(0.252, '1120 Series U-Channel 252mm Back');
  const frameKids = [
    inst(railL, frame([-0.224, 0.150, WR], [1, 0, 0], [0, 1, 0])),
    inst(railR, frame([-0.224, -0.150, WR], [1, 0, 0], [0, 1, 0])),
    inst(crossF, frame([0.200, -0.126, WR], [0, 1, 0], [1, 0, 0])),
    inst(crossB, frame([-0.200, -0.126, WR], [0, 1, 0], [1, 0, 0])),
    inst(plate(0.300, 0.250, 0.004, 'Pattern Plate 300x250'), frame([0, 0, WR + 0.024])),
    inst(battery(), frame([-0.070, 0, WR + 0.028])),
    inst(controlHub(), frame([0.070, 0, WR + 0.028]))
  ];
  const sc = screw();
  for (const [x, y] of [[0.14, 0.115], [0.14, -0.115], [-0.14, 0.115], [-0.14, -0.115], [0.0, 0.115], [0.0, -0.115]])
    frameKids.push(inst(sc, frame([x, y, WR + 0.028 + 0.0])));
  // a lift: two vertical slides and a crossbar, so the robot has height
  const slide = uChannel(0.350, '1120 Series U-Channel 350mm Slide');
  const superKids = [
    inst(slide, frame([-0.150, 0.080, WR + 0.028], [0, 0, 1], [1, 0, 0])),
    inst(slide, frame([-0.150, -0.080, WR + 0.028], [0, 0, 1], [1, 0, 0])),
    inst(uChannel(0.208, '1120 Series U-Channel 208mm Crossbar'), frame([-0.150, -0.104, WR + 0.028 + 0.350 + 0.024], [0, 1, 0], [1, 0, 0])),
    inst(servo(), frame([-0.120, 0, WR + 0.300]))
  ];
  return { modules, frameKids, superKids, wheels, kind: 'mecanum', r: WR };
}

function intakeKids() {
  // a long intake out the front: two polycarb side plates to x = 0.474, a roller
  // shaft and four compliant wheels near the floor
  const side = part('Intake Side Plate Polycarbonate', [box([0, 0, 0], [0.270, 0.006, 0.090])], COL.clear, 0.075);
  const shaft = part('Intake Roller Shaft', [prism(frame([0, 0, 0]), ngon(6, 0.0046), 0.300)], COL.steel, 0.060);
  const cw = part('Compliant Wheel 60A 48mm', [cyl(frame([0, 0, -0.010]), 0.024, 0.020)], COL.orange, 0.020);
  const k = [
    inst(side, frame([0.339, 0.140, 0.080])), inst(side, frame([0.339, -0.140, 0.080])),
    inst(shaft, frame([0.440, -0.150, 0.060], [0, 1, 0], [1, 0, 0]))
  ];
  for (const y of [-0.105, -0.035, 0.035, 0.105]) k.push(inst(cw, frame([0.440, y, 0.060], [0, 1, 0], [1, 0, 0])));
  return k;
}

function flatten(b) {
  const out = b.frameKids.concat(b.superKids);
  for (const m of b.modules) out.push(m.wheel, m.motor);
  return out;
}

/* Variant frames: robot coordinates -> CAD coordinates. */
const V_ZUP = IDF;
const V_YUP = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };      // robot z (up) -> CAD +y, robot y (left) -> CAD -z
const V_FRONT_Y = rotZ(90);                                                     // robot x (front) -> CAD +y

function renameAll(root) {
  let n = 0, a = 0; const seen = new Set();
  walk(root, (p) => { if (seen.has(p.uid)) return; seen.add(p.uid); p.name = p.kind === 'asm' ? 'Assembly ' + (++a) : 'Part ' + (++n); });
}

/* The corpus. Each entry returns {root, units, V, truth:{...robot frame}}. */
export const ROBOTS = {
  'mecanum-zup': () => { const b = mecanumBase(); return { root: asm('Robot', flatten(b)), units: 'mm', V: V_ZUP, b, front: '+x', up: '+z', note: 'goBILDA mecanum, Z up, origin at the drivetrain centre on the floor, mm' }; },
  'mecanum-offset': () => {
    const b = mecanumBase(); const kids = flatten(b).concat(intakeKids());
    return { root: asm('Robot', kids), units: 'm', V: frame([0.6, 0.4, 0]), b, front: '+x', up: '+z', bakeStruct: true,
      note: 'same robot, assembly origin 0.6 m / 0.4 m off, structure modelled in place in a part studio (identity instances), long intake with compliant wheels 0.25 m out the front, metres' };
  },
  'mecanum-yup': () => { const b = mecanumBase(); return { root: asm('Robot', flatten(b)), units: 'mm', V: V_YUP, b, front: '+x', up: '+y', note: 'same robot modelled Y up (Front plane as the ground)' }; },
  'mecanum-inch': () => { const b = mecanumBase(); return { root: asm('Robot', flatten(b)), units: 'in', V: V_ZUP, b, front: '+x', up: '+z', note: 'same robot, CONVERSION_BASED_UNIT INCH' }; },
  'mecanum-front-y': () => { const b = mecanumBase(); return { root: asm('Robot', flatten(b)), units: 'mm', V: V_FRONT_Y, b, front: '+y', up: '+z', note: 'same robot, front along CAD +y' }; },
  'tank-traction': () => {
    const tw = tractionWheel('goBILDA 96mm Traction Wheel 3614-0001-0096'), mot = motor5203(), kids = [], wheels = [];
    for (const [x, y] of [[0.15, 0.2], [0.15, -0.2], [-0.15, 0.2], [-0.15, -0.2]]) {
      kids.push(inst(tw, axleY([x, y, 0.048], Math.sign(y)))); wheels.push({ c: [x, y, 0.048], axle: [0, Math.sign(y), 0], r: 0.048 });
    }
    kids.push(inst(mot, axleY([-0.15, 0.126, 0.048], 1)), inst(mot, axleY([-0.15, -0.126, 0.048], -1)));
    kids.push(inst(uChannel(0.448, '1120 Series U-Channel 448mm'), frame([-0.224, 0.150, 0.048], [1, 0, 0], [0, 1, 0])));
    kids.push(inst(uChannel(0.448, '1120 Series U-Channel 448mm'), frame([-0.224, -0.150, 0.048], [1, 0, 0], [0, 1, 0])));
    kids.push(inst(uChannel(0.252, '1120 Series U-Channel 252mm'), frame([0.2, -0.126, 0.048], [0, 1, 0], [1, 0, 0])));
    kids.push(inst(uChannel(0.252, '1120 Series U-Channel 252mm'), frame([-0.2, -0.126, 0.048], [0, 1, 0], [1, 0, 0])));
    kids.push(inst(plate(0.3, 0.25, 0.004, 'Pattern Plate 300x250'), frame([0, 0, 0.072])));
    kids.push(inst(battery(), frame([-0.07, 0, 0.076])), inst(controlHub(), frame([0.07, 0, 0.076])));
    kids.push(inst(part('#25 Roller Chain Loop', [box([0, 0, 0], [0.30, 0.006, 0.012])], COL.black, 0.05), frame([0, 0.185, 0.048])));
    kids.push(inst(part('#25 Roller Chain Loop', [box([0, 0, 0], [0.30, 0.006, 0.012])], COL.black, 0.05), frame([0, -0.185, 0.048])));
    return { root: asm('Tank Robot', kids), units: 'mm', V: V_ZUP, b: { wheels, kind: 'tank', r: 0.048 }, front: '+x', up: '+z', motors: 2, note: 'four traction wheels, two chained per side, two motors' };
  },
  'tank-6wd': () => {
    const tr = tractionWheel(), om = omniWheel(), mot = motor5203(), kids = [], wheels = [];
    for (const x of [0.16, 0, -0.16]) for (const y of [0.2, -0.2]) {
      const zc = x === 0 ? 0.048 : 0.051;           // drop centre: the middle pair sits 3 mm lower
      kids.push(inst(x === 0 ? tr : om, axleY([x, y, zc], Math.sign(y)))); wheels.push({ c: [x, y, zc], axle: [0, Math.sign(y), 0], r: 0.048 });
    }
    kids.push(inst(mot, axleY([0, 0.126, 0.048], 1)), inst(mot, axleY([0, -0.126, 0.048], -1)));
    kids.push(inst(uChannel(0.448), frame([-0.224, 0.150, 0.050], [1, 0, 0], [0, 1, 0])), inst(uChannel(0.448), frame([-0.224, -0.150, 0.050], [1, 0, 0], [0, 1, 0])));
    kids.push(inst(uChannel(0.252), frame([0.2, -0.126, 0.05], [0, 1, 0], [1, 0, 0])), inst(uChannel(0.252), frame([-0.2, -0.126, 0.05], [0, 1, 0], [1, 0, 0])));
    kids.push(inst(plate(0.3, 0.25, 0.004, 'Pattern Plate 300x250'), frame([0, 0, 0.074])), inst(battery(), frame([-0.07, 0, 0.078])), inst(controlHub(), frame([0.07, 0, 0.078])));
    return { root: asm('6WD Robot', kids), units: 'mm', V: V_ZUP, b: { wheels, kind: 'tank', r: 0.048 }, front: '+x', up: '+z', motors: 2,
      note: 'six wheels, drop centre: traction in the middle (3 mm lower), omnis at the ends, the classic 6WD pattern' };
  },
  xdrive: () => {
    const om = omniWheel(), mot = motor5203(), kids = [], wheels = [];
    for (const [x, y] of [[0.16, 0.16], [0.16, -0.16], [-0.16, 0.16], [-0.16, -0.16]]) {
      const ax = norm([x, y, 0]);
      kids.push(inst(om, frame([x, y, 0.048], ax, [0, 0, 1])));
      kids.push(inst(mot, frame([x - ax[0] * 0.045, y - ax[1] * 0.045, 0.048], ax, [0, 0, 1])));
      wheels.push({ c: [x, y, 0.048], axle: ax, r: 0.048 });
    }
    kids.push(inst(plate(0.34, 0.34, 0.006, 'X Base Plate'), frame([0, 0, 0.074])), inst(battery(), frame([-0.05, 0, 0.080])), inst(controlHub(), frame([0.07, 0, 0.080])));
    kids.push(inst(plate(0.24, 0.24, 0.006, 'X Lower Plate'), frame([0, 0, 0.018])));
    return { root: asm('X-Drive Robot', kids), units: 'mm', V: V_ZUP, b: { wheels, kind: 'x', r: 0.048 }, front: '+x', up: '+z', note: 'four omni wheels at the corners, axles at 45 degrees' };
  },
  kiwi: () => {
    const om = omniWheel(), mot = motor5203(), kids = [], wheels = [];
    for (const deg of [60, 180, 300]) {
      const a = deg * Math.PI / 180, ax = [Math.cos(a), Math.sin(a), 0], c = [0.17 * ax[0], 0.17 * ax[1], 0.048];
      kids.push(inst(om, frame(c, ax, [0, 0, 1])), inst(mot, frame(sub(c, mul(ax, 0.045)), ax, [0, 0, 1])));
      wheels.push({ c, axle: ax, r: 0.048 });
    }
    kids.push(inst(part('Kiwi Triangle Plate', [prism(frame([0, 0, 0.074]), ngon(3, 0.26, 0), 0.006)], COL.alu, 0.45), IDF));
    kids.push(inst(battery(), frame([0, 0, 0.080])), inst(controlHub(), frame([0.02, 0.09, 0.080], [0, 0, 1], [0, 1, 0])));
    return { root: asm('Kiwi Robot', kids), units: 'mm', V: V_ZUP, b: { wheels, kind: 'omni', r: 0.048 }, front: '+x', up: '+z', motors: 3, note: 'three omni wheels 120 degrees apart, axles radial' };
  },
  swerve: () => {
    const tw = tractionWheel('goBILDA 96mm Grip Wheel 3614-0001-0096'), mot = motor5203(), sv = servo(), kids = [], wheels = [];
    const plateM = part('Module Top Plate', [box([0, 0, 0.002], [0.09, 0.09, 0.004])], COL.alu, 0.05);
    for (const [x, y] of [[0.15, 0.15], [0.15, -0.15], [-0.15, 0.15], [-0.15, -0.15]]) {
      kids.push(inst(tw, axleY([x, y, 0.048], 1))); wheels.push({ c: [x, y, 0.048], axle: [0, 1, 0], r: 0.048 });
      kids.push(inst(sv, frame([x, y, 0.048 + 0.075])));                                 // steering servo, coaxial, above the wheel
      kids.push(inst(plateM, frame([x, y, 0.048 + 0.052])));
      kids.push(inst(mot, frame([x - 0.040 * Math.sign(x), y, 0.146], [0, 0, -1], [1, 0, 0])));   // drive motor above the plate, beside the steering axis
    }
    kids.push(inst(plate(0.40, 0.40, 0.006, 'Swerve Chassis Plate'), frame([0, 0, 0.140])), inst(battery(), frame([0, 0, 0.146])), inst(controlHub(), frame([0.0, 0.08, 0.146])));
    return { root: asm('Swerve Robot', kids), units: 'mm', V: V_ZUP, b: { wheels, kind: 'swerve', r: 0.048 }, front: '+x', up: '+z', note: 'four wheels, each under a coaxial steering servo; nothing is named swerve' };
  },
  'unnamed-wheels': () => { const b = mecanumBase(); const root = asm('Robot', flatten(b)); renameAll(root); return { root, units: 'mm', V: V_ZUP, b, front: '+x', up: '+z', note: 'mecanum-zup with every product renamed Part N / Assembly N' }; },
  nested: () => {
    const b = mecanumBase();
    const mods = b.modules.map((m) => {
      // a module subassembly whose own origin sits at the wheel centre
      const o = m.wheel.F.o, rel = (F) => ({ o: sub(F.o, o), x: F.x, y: F.y, z: F.z });
      return inst(asm('Drive Module ' + m.cn, [inst(m.wheel.p, rel(m.wheel.F)), inst(m.motor.p, rel(m.motor.F))]), frame(o));
    });
    const dt = asm('Drivetrain', b.frameKids.concat(mods));
    const top = asm('Robot', [inst(dt, IDF), inst(asm('Lift', b.superKids), IDF)]);
    return { root: asm('Competition Robot Wrapper', [inst(top, IDF)]), units: 'mm', V: V_ZUP, b, front: '+x', up: '+z', note: 'wrapper > robot > drivetrain > drive module > wheel: wheels four levels below the root' };
  },
  big: () => {
    const b = mecanumBase(), kids = flatten(b);
    const gus = part('Gusset 30x30', [box([0, 0, 0.0015], [0.030, 0.030, 0.003])], COL.alu, 0.006);
    const sc = screw(), nt = nut();
    const kitKids = [inst(gus, IDF)];
    for (const [x, y] of [[-0.009, -0.009], [0.009, -0.009], [0.009, 0.009], [-0.009, 0.009]]) {
      kitKids.push(inst(sc, frame([x, y, 0.003 + 0.0])), inst(nt, frame([x, y, -0.0072])));
    }
    const kit = asm('Gusset Kit', kitKids);
    // 165 kits on the plate top and the slide faces: 9 leaves each, 1485 parts
    let n = 0;
    for (let i = 0; i < 11 && n < 165; i++) for (let j = 0; j < 8 && n < 165; j++, n++) kids.push(inst(kit, frame([-0.135 + i * 0.027, -0.105 + j * 0.030, WR + 0.028])));
    for (let k = 0; n < 165; k++, n++) {
      const side = k % 2 ? 1 : -1, zz = WR + 0.06 + Math.floor(k / 2) * 0.008;
      kids.push(inst(kit, frame([-0.126, side * 0.080, zz], [1, 0, 0], [0, 0, 1])));
    }
    return { root: asm('Big Robot', kids), units: 'mm', V: V_ZUP, b, front: '+x', up: '+z', note: 'mecanum-zup plus 165 gusset kits (gusset + 4 screws + 4 nuts): ~1500 leaf parts' };
  },
  'arm-only': () => {
    const kids = [
      inst(plate(0.30, 0.30, 0.006, 'Base Plate'), IDF),
      inst(part('Arm Tower', [box([0, 0, 0.06], [0.05, 0.05, 0.12])], COL.alu, 0.15), frame([-0.05, 0, 0.006])),
      inst(servo(), frame([-0.05, 0, 0.140])),
      inst(uChannel(0.300, '1120 Series U-Channel 300mm Arm'), frame([-0.05, -0.024, 0.170], [1, 0, 0], [0, 0, 1])),
      inst(part('Claw Block', [box([0, 0, 0], [0.06, 0.08, 0.05])], COL.orange, 0.12), frame([0.26, 0, 0.170]))
    ];
    return { root: asm('Arm Test Stand', kids), units: 'mm', V: V_ZUP, b: { wheels: [], kind: 'none', r: 0 }, front: '+x', up: '+z', note: 'no drivetrain: an arm on a plate; the bench must draw a base under it' };
  },
  /* A robot with its Onshape mates: mecanum base, a two-stage slide whose
     carriage follows stage 1 through a LINEAR relation, an arm on a
     revolute at the carriage, and a claw finger on a revolute at the arm's
     end. Mates live both in the root and inside the subassemblies, as they do
     in a real Onshape document. buildRobot writes the matching assembly
     definition (what GET /assemblies/.../e/... returns) alongside the STEP. */
  mated: () => {
    const b = mecanumBase();
    const kids = flatten(b);
    const tag = (i, t) => Object.assign(i, { tag: t });
    const rail = part('Slide Rail', [box([0, 0, 0.15], [0.030, 0.030, 0.300])], COL.alu, 0.12);
    const st1 = part('Slide Stage 1', [box([0, 0, 0.15], [0.024, 0.024, 0.300])], COL.alu, 0.10);
    const car = part('Slide Carriage', [box([0, 0, 0.03], [0.050, 0.050, 0.060])], COL.alu, 0.08);
    const lift = asm('Lift', [
      tag(inst(rail, IDF), 'rail'),
      tag(inst(st1, frame([0.030, 0, 0.020])), 'stage1'),
      tag(inst(car, frame([0.060, 0, 0.030])), 'carriage'),
      tag(inst(motor5203('goBILDA 5203 Lift Motor 5203-2402-0019'), frame([-0.035, 0, 0.060], [0, 0, -1])), 'liftMotor')
    ]);
    const link = uChannel(0.250, '1120 Series U-Channel Arm 250mm');
    const armAsm = asm('Arm', [
      tag(inst(link, frame([0, -0.024, 0], [1, 0, 0], [0, 0, 1])), 'link'),
      tag(inst(servo(), frame([0.020, 0.040, 0])), 'armServo'),
      tag(inst(part('Claw Body', [box([0, 0, 0], [0.040, 0.060, 0.040])], COL.orange, 0.09), frame([0.270, 0, 0])), 'clawBody'),
      tag(inst(part('Claw Finger', [box([0.020, 0, 0], [0.040, 0.010, 0.030])], COL.orange, 0.02), frame([0.290, 0.020, 0])), 'finger')
    ]);
    kids.push(tag(inst(lift, frame([-0.100, 0, 0.080])), 'Lift'), tag(inst(armAsm, frame([0.010, 0, 0.170])), 'Arm'));
    // mate frames in robot coordinates: origin, z axis (the joint axis), x axis
    const mates = [
      { name: 'Fastened 1', type: 'FASTENED', a: ['Lift', 'rail'], b: ['1120 Series U-Channel 448mm Left Rail'], o: [-0.100, 0, 0.080], z: [0, 0, 1] },
      { name: 'Lift Stage', type: 'SLIDER', in: 'Lift', a: ['rail'], b: ['stage1'], o: [-0.085, 0, 0.100], z: [0, 0, 1], limits: [0, 0.28] },
      { name: 'Lift Carriage', type: 'SLIDER', in: 'Lift', a: ['stage1'], b: ['carriage'], o: [-0.040, 0, 0.110], z: [0, 0, 1], limits: [0, 0.27] },
      { name: 'Arm Pivot', type: 'REVOLUTE', a: ['Lift', 'carriage'], b: ['Arm', 'link'], o: [0.010, 0, 0.170], z: [0, 1, 0], x: [1, 0, 0], limits: [-Math.PI / 2, 2.1] },
      { name: 'Fastened 2', type: 'FASTENED', in: 'Arm', a: ['link'], b: ['armServo'], o: [0.030, 0.040, 0.170], z: [0, 0, 1] },
      { name: 'Fastened 3', type: 'FASTENED', in: 'Arm', a: ['link'], b: ['clawBody'], o: [0.280, 0, 0.170], z: [0, 0, 1] },
      { name: 'Claw', type: 'REVOLUTE', in: 'Arm', a: ['clawBody'], b: ['finger'], o: [0.300, 0.020, 0.170], z: [0, 0, 1], limits: [0, 1.2] }
    ];
    const relations = [{ name: 'Cascade', type: 'LINEAR', mates: ['Lift Stage', 'Lift Carriage'], ratio: 1 }];
    const joints = [
      { name: 'Lift Stage', kind: 'linear', axis: [0, 0, 1], parent: 'chassis', carries: ['Slide Stage 1'] },
      { name: 'Lift Carriage', kind: 'linear', axis: [0, 0, 1], parent: 'Lift Stage', carries: ['Slide Carriage'], couple: 'Lift Stage' },
      { name: 'Arm Pivot', kind: 'revolute-lift', axis: [0, 1, 0], parent: 'Lift Carriage', carries: ['1120 Series U-Channel Arm 250mm', '2000 Series Dual Mode Servo (25-2) 2000-0025-0002', 'Claw Body'] },
      { name: 'Claw', kind: 'revolute-yaw', axis: [0, 0, 1], parent: 'Arm Pivot', carries: ['Claw Finger'] }
    ];
    return { root: asm('Mated Robot', kids), units: 'mm', V: V_ZUP, b, front: '+x', up: '+z', mates, relations, joints,
      note: 'mecanum base + two-stage slide + arm + claw, with the Onshape mates (sliders, revolutes, fastened, a linear relation) as the API returns them' };
  }
};

/* ---------------- the Onshape assembly definition ----------------
   What GET /api/v10/assemblies/d/{did}/w/{wid}/e/{eid}?includeMateFeatures=true
   returns for this tree: instances per assembly definition (ids belong to the
   definition, so every instance of a subassembly shares them), every
   occurrence with its world transform (4x4 row-major, metres), and the mate
   features, each in the assembly that owns it, with each end's mate
   connector given in that occurrence's own coordinates. */
function onshapeAssembly(top, R) {
  const defs = new Map(), idsOf = new Map();
  const labels = (list) => { const seen = {}; return list.map((c) => { const n = c.p.name; seen[n] = (seen[n] || 0) + 1; return n + ' <' + seen[n] + '>'; }); };
  const instList = (a) => {
    if (!idsOf.has(a.uid)) idsOf.set(a.uid, a.children.map((c, i) => 'I' + a.uid.toString(36) + 'x' + i));
    const ids = idsOf.get(a.uid), names = labels(a.children);
    return a.children.map((c, i) => Object.assign({ id: ids[i], name: names[i], type: c.p.kind === 'asm' ? 'Assembly' : 'Part', suppressed: false,
      documentId: 'DOC', elementId: 'E' + c.p.uid, configuration: 'default', fullConfiguration: 'default', documentMicroversion: 'MV', isStandardContent: false },
      c.p.kind === 'asm' ? {} : { partId: 'P' + c.p.uid }));
  };
  const occurrences = [], tagPath = new Map(), world = new Map();
  const T16 = (F) => [F.x[0], F.y[0], F.z[0], F.o[0], F.x[1], F.y[1], F.z[1], F.o[1], F.x[2], F.y[2], F.z[2], F.o[2], 0, 0, 0, 1];
  const visit = (a, F, path, tags) => {
    instList(a);
    const ids = idsOf.get(a.uid);
    a.children.forEach((c, i) => {
      const Fw = compose(F, c.F), p = path.concat([ids[i]]), t = tags.concat([c.tag || c.p.name]);
      occurrences.push({ path: p, transform: T16(Fw), fixed: false, hidden: false });
      world.set(p.join('/'), Fw); tagPath.set(t.join('/'), p);
      if (c.p.kind === 'asm') { if (!defs.has(c.p.uid)) defs.set(c.p.uid, c.p); visit(c.p, Fw, p, t); }
    });
  };
  visit(top, IDF, [], []);
  const features = new Map([[top.uid, []]]);
  for (const uid of defs.keys()) features.set(uid, []);
  const local = (Fw, M) => {                     // a world frame in an occurrence's own coordinates
    const inv = (v) => [dot(v, Fw.x), dot(v, Fw.y), dot(v, Fw.z)];
    return { origin: inv(sub(M.o, Fw.o)), xAxis: inv(M.x), yAxis: inv(M.y), zAxis: inv(M.z) };
  };
  const idOf = new Map();
  R.mates.forEach((m, k) => {
    const prefix = m.in ? m.in + '/' : '', owner = m.in ? tagPath.get(m.in) : [];
    const ownerUid = m.in ? top.children.find((c) => c.tag === m.in).p.uid : top.uid;
    const M = frame(m.o, m.z, m.x || null);
    const ends = [m.a, m.b].map((e) => {
      const full = tagPath.get(prefix + e.join('/'));
      if (!full) throw new Error('mate ' + m.name + ': no occurrence ' + prefix + e.join('/'));
      return { matedOccurrence: full.slice(owner.length), matedCS: local(world.get(full.join('/')), M) };
    });
    const id = 'F' + k;
    idOf.set(m.name, { id, ownerUid });
    features.get(ownerUid).push({ id, suppressed: false, featureType: 'mate', featureData: { name: m.name, mateType: m.type, matedEntities: ends } });
  });
  for (const r of R.relations || []) {
    const [a, b] = r.mates.map((n) => idOf.get(n));
    features.get(a.ownerUid).push({ id: 'R' + a.id + b.id, suppressed: false, featureType: 'mateRelation',
      featureData: { name: r.name, relationType: r.type, mates: [{ featureId: a.id }, { featureId: b.id }], relationRatio: r.ratio, reverseDirection: false } });
  }
  const assembly = {
    rootAssembly: { documentId: 'DOC', elementId: 'E' + top.uid, configuration: 'default', fullConfiguration: 'default', documentMicroversion: 'MV',
      instances: instList(top), occurrences, features: features.get(top.uid), patterns: [] },
    subAssemblies: [...defs.values()].map((a) => ({ documentId: 'DOC', elementId: 'E' + a.uid, configuration: 'default', fullConfiguration: 'default',
      documentMicroversion: 'MV', instances: instList(a), features: features.get(a.uid), patterns: [] })),
    parts: []
  };
  // mate limits, the way the features endpoint gives them
  const q = (m, v) => m.type === 'SLIDER' ? (v * 1000) + ' mm' : (v * 180 / Math.PI) + ' deg';
  const features2 = { features: R.mates.filter((m) => m.limits).map((m) => ({ message: { featureId: idOf.get(m.name).id, name: m.name, parameters: [
    { message: { parameterId: 'limitsEnabled', value: true } },
    { message: { parameterId: m.type === 'SLIDER' ? 'limitAxialZMin' : 'limitRotationMin', expression: q(m, m.limits[0]) } },
    { message: { parameterId: m.type === 'SLIDER' ? 'limitAxialZMax' : 'limitRotationMax', expression: q(m, m.limits[1]) } }
  ] } })) };
  return { assembly, features: features2 };
}

/* Build one robot: place in CAD by V, bake structure if asked, compute truth. */
export function buildRobot(name) {
  PID = 0;
  const R = ROBOTS[name]();
  const V = R.V;
  // the top assembly's own children get V; a baked part studio part gets V∘placement in its geometry
  const top = R.root;
  top.children = top.children.map((c) => {
    const F = compose(V, c.F);
    if (R.bakeStruct && c.p.kind === 'part' && !/Wheel|Motor|Servo|Hub|Battery|Screw/i.test(c.p.name)) {
      const p = Object.assign({}, c.p, { uid: ++PID + 100000, bake: F });
      return inst(p, IDF);
    }
    return Object.assign(inst(c.p, F), c.tag ? { tag: c.tag } : {});
  });

  // truth: extent of every solid, mass, leaf count, all in CAD coordinates
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  let kg = 0, leaves = 0, nauo = 0, bodies = 0; const products = new Set(), partNames = new Set();
  walk(top, (p, F, depth) => {
    if (depth > 0) nauo++;
    products.add(p.uid);
    if (p.kind !== 'part') return;
    leaves++; kg += p.kg; bodies += p.bodies.length; partNames.add(p.name);
    const G = p.bake ? compose(F, p.bake) : F;
    for (const b of p.bodies) for (const s of primSamples(b)) { const w = fPt(G, s); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } }
  });
  const upV = { '+z': [0, 0, 1], '+y': [0, 1, 0] }[R.up];
  const wheels = R.b.wheels.map((w) => ({ corner: w.corner || null, c: fPt(V, w.c), axle: fDir(V, w.axle), r: w.r }));
  // true wheel radius: furthest surface sample of the wheel part from its axle
  let rTrue = 0;
  if (wheels.length) {
    const wp = []; walk(top, (p) => { if (p.kind === 'part' && /Wheel/i.test(p.name) && !/Compliant/i.test(p.name) && !wp.includes(p)) wp.push(p); });
    rTrue = Math.max(...(wp.length ? wp : [mecanumWheel('L')]).map((p) => Math.max(...p.bodies.flatMap(primSamples).map((s) => Math.hypot(s[0], s[1])))));
  }
  const cen = wheels.length ? mul(wheels.reduce((a, w) => add(a, w.c), [0, 0, 0]), 1 / wheels.length) : null;
  // the floor is the lowest point of the solids along up (wheel bottoms, or the plate)
  const lowest = R.up === '+z' ? mn[2] : mn[1];
  const cls = kg < 7.5 ? 'light' : kg < 14 ? 'typical' : 'heavy';
  const truth = {
    name, note: R.note, units: R.units, up: R.up, front: R.front,
    wheelCentroid: cen, floorZ: +lowest.toFixed(6),
    drive: { kind: R.b.kind, wheels: wheels.length, radius: +rTrue.toFixed(5), motors: R.motors || (wheels.length ? 4 : 0) },
    wheels,
    massKg: +kg.toFixed(3), massClass: cls,
    bbox: { min: mn.map((v) => +v.toFixed(6)), max: mx.map((v) => +v.toFixed(6)) },
    leafParts: leaves, occurrences: nauo, products: products.size,
    bodies, partNames: [...partNames].sort()
  };
  const text = writeStep(top, { units: R.units, name });
  if (R.joints) truth.joints = R.joints;
  return { text, truth, onshape: R.mates ? onshapeAssembly(top, R) : null };
}

/* ---------------- OpenCascade check ---------------- */
export async function loadOcct(p = process.env.OCCT_IMPORT_JS || OCCT_DEFAULT) {
  if (!fs.existsSync(p)) return null;
  const req = createRequire(import.meta.url);
  return await req(p)();
}

/* Tessellate a STEP file; returns {ok, meshes, emptyMeshes, leafNodes, leavesWithMesh, bbox, why}. */
export function occtCheck(occt, text) {
  const r = occt.ReadStepFile(new TextEncoder().encode(text), { linearUnit: 'meter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 });
  if (!r || !r.success) return { ok: false, why: 'ReadStepFile failed' };
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  let empty = 0;
  for (const m of r.meshes) {
    const P = (m.attributes && m.attributes.position && m.attributes.position.array) || [];
    const I = (m.index && m.index.array) || [];
    if (!P.length || !I.length) { empty++; continue; }
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  }
  let leaves = 0, withMesh = 0; const named = new Set();
  const full = (i) => { const m = r.meshes[i]; return !!(m && m.index && m.index.array.length > 0); };
  const visit = (n) => {
    const kids = n.children || [];
    if ((n.meshes || []).length && n.meshes.every(full)) named.add(n.name);
    for (const i of n.meshes || []) if (full(i) && r.meshes[i].name) named.add(r.meshes[i].name);
    if (!kids.length) { leaves++; if ((n.meshes || []).some(full)) withMesh++; }
    for (const c of kids) visit(c);
  };
  visit(r.root);
  return { ok: empty === 0 && leaves === withMesh && r.meshes.length > 0, meshes: r.meshes.length, get names() { return [...named]; }, emptyMeshes: empty, leafNodes: leaves, leavesWithMesh: withMesh, bbox: { min: mn, max: mx } };
}

/* ---------------- CLI ---------------- */
async function main() {
  const args = process.argv.slice(2);
  let out = DEFAULT_OUT, check = false; const names = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = path.resolve(args[++i]);
    else if (args[i] === '--check') check = true;
    else names.push(args[i]);
  }
  const list = names.length ? names : Object.keys(ROBOTS);
  fs.mkdirSync(out, { recursive: true });
  const occt = check ? await loadOcct() : null;
  if (check && !occt) { console.error('occt-import-js not found; set OCCT_IMPORT_JS'); process.exitCode = 2; }
  let bad = 0;
  for (const n of list) {
    if (!ROBOTS[n]) { console.error('unknown robot ' + n); bad++; continue; }
    const { text, truth } = buildRobot(n);
    let line = n.padEnd(16) + (text.length / 1024).toFixed(0).padStart(5) + ' KB  ' + truth.leafParts + ' parts';
    if (occt) {
      const c = occtCheck(occt, text);
      const missing = truth.partNames.filter((nm) => !c.names.includes(nm));
      // occt-import-js flattens anything below the second tree level into one node, so a
      // deep subassembly's parts lose their names there; the mesh count still has to match
      if (c.ok && c.meshes !== truth.bodies) { c.ok = false; c.why = c.meshes + ' meshes for ' + truth.bodies + ' bodies'; }
      line += c.ok ? '  occt ok: ' + c.meshes + ' non-empty meshes = ' + truth.bodies + ' bodies' + (missing.length ? ' (' + missing.length + ' part names flattened away by occt-import-js)' : ', every part named') : '  OCCT FAIL ' + (c.why || '') + ' ' + JSON.stringify({ meshes: c.meshes, empty: c.emptyMeshes });
      if (c.ok) {
        const err = Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(c.bbox.min[k] - truth.bbox.min[k]), Math.abs(c.bbox.max[k] - truth.bbox.max[k])]));
        line += ', bbox vs truth ' + (err * 1000).toFixed(2) + ' mm';
        if (err > 0.002) { line += ' (MISMATCH)'; bad++; }
        truth.occt = { meshes: c.meshes };
      } else bad++;
    }
    fs.writeFileSync(path.join(out, n + '.step'), text);
    fs.writeFileSync(path.join(out, n + '.json'), JSON.stringify(truth, null, 2) + '\n');
    console.log(line);
  }
  if (bad) { console.error(bad + ' problem(s)'); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
