// Robustness of findActuators on Into The Deep: take evidence away, or turn the whole robot.
//   node --max-old-space-size=8192 robust.mjs
import { loadITD, E } from '../lib.mjs';
import { findActuators } from './actuators.mjs';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return a.map((v) => v / n); };
const angDeg = (a, b) => Math.acos(Math.min(1, Math.abs(dot(unit(a), unit(b))))) * 180 / Math.PI;
const perp = (p, o, a) => { const v = sub(p, o), u = unit(a), t = dot(v, u); return norm(sub(v, u.map((x) => x * t))); };

const { cad, truth } = loadITD();
const S = cad.solids;
const wheels = E.driveFromCAD(cad).wheels;
const M = new Map(truth.mechs.map((m) => [m.id, m]));
const JOINTS = ['arm', 'outRot', 'outClaw', 'crank R', 'crank L', 'inY', 'inPiv', 'inX', 'inClaw'];
const DEVICE = { arm: 91, outRot: 121, outClaw: 102, 'crank R': 132, 'crank L': 131, inY: 133, inPiv: 112, inX: 110, inClaw: 117 };

function measure(label, res, xf = (p) => p, xd = (d) => d) {
  const A = res.actuators;
  const rows = JOINTS.map((id) => {
    const m = M.get(id), P = xf(m.pivot).map((v) => v * 1000), ax = xd(m.axis);
    const a = A.find((x) => x.body.includes(DEVICE[id]));
    if (!a) return { id, miss: true };
    return { id, ang: angDeg(a.axis, ax), d: perp(P, a.pivot, a.axis), role: a.role };
  });
  const ok = rows.filter((r) => !r.miss);
  const good = ok.filter((r) => r.ang < 3 && r.d < 5).length;
  const drive = A.filter((a) => a.drive).length, lift = A.filter((a) => a.kind === 'motor' && !a.drive && a.role !== 'joint').length;
  const REAL = S.map((s, i) => i).filter((i) => S[i].name === 'Servo Case' || S[i].name === 'Motor Part');
  const fp = A.filter((a) => !a.body.some((i) => REAL.includes(i))).length, amb = A.filter((a) => a.ambiguous).length;
  console.log(`${label.padEnd(44)} found ${String(A.length).padStart(2)} | joints right (<3 deg, <5 mm) ${good}/9 | ` +
    rows.map((r) => r.miss ? r.id + ':MISSED' : `${r.id}:${r.ang.toFixed(1)}deg/${r.d.toFixed(1)}mm`).join(' ') + ` | FP ${fp} | ambiguous ${amb} | drive ${drive} | non-joint motors ${lift}`);
  return rows;
}

const base = { driveFromCAD: E.driveFromCAD, hwFromPart: E.hwFromPart };
measure('as modelled', findActuators(cad, base));
const splines = S.map((s, i) => i).filter((i) => /spline/i.test(S[i].name));
const hubs = S.map((s, i) => i).filter((i) => /1908-0025/.test(S[i].name));   // goBILDA servo hubs (eval-side label)
measure('no spline parts (all 8 servos case-only)', findActuators(cad, { ...base, ignore: splines }));
measure('no splines, no servo hubs', findActuators(cad, { ...base, ignore: [...splines, ...hubs] }));
measure('no splines, ears+boss only (no neighbours)', findActuators(cad, { ...base, ignore: splines, noNeighbours: true }));
measure('no splines, no hubs, no neighbours', findActuators(cad, { ...base, ignore: [...splines, ...hubs], noNeighbours: true }));
measure('  same, cable-exit cue off too', findActuators(cad, { ...base, ignore: [...splines, ...hubs], noNeighbours: true, noCableCue: true }));

// the whole robot turned about an arbitrary axis: nothing may depend on parts being square to the frame
function rotation(axis, deg) {
  const [x, y, z] = unit(axis), t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
for (const [ax, deg] of [[[1, 2, 3], 37], [[-2, 1, 0.5], 71], [[0, 0, 1], 45]]) {
  const R = rotation(ax, deg), r = (p) => [dot(R[0], p), dot(R[1], p), dot(R[2], p)];
  const cad2 = { solids: S.map((s) => ({ ...s, pts: s.pts.map(r) })), occs: cad.occs };
  const w2 = wheels.map((w) => ({ c: r(w.c), axis: r(w.axis), r: w.r }));
  measure(`robot turned ${deg} deg about [${ax}]`, findActuators(cad2, { hwFromPart: E.hwFromPart, wheels: w2, up: r([0, 0, 1]) }), r, r);
}

// names stripped: no vendor words, no part numbers, no assembly tree
const blind = { solids: S.map((s, i) => ({ ...s, name: 'Part ' + i, part: null, kind: 'metal' })), occs: cad.occs.map((o) => ({ ...o, path: [] })) };
measure('all names and the assembly tree stripped', findActuators(blind, base));
measure('  same, and no wheel list', findActuators(blind, { hwFromPart: E.hwFromPart }));
