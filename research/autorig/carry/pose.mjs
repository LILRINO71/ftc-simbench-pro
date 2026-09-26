// Re-pose a robot by its TRUTH joints (test-data generation only; the carry step never sees
// truth labels). Every part moves with the joint chain truth puts it on; joint pivots and
// axes move with their parents. Followers (cascade stages, gear-coupled claws, the crank
// linkage) come from the engine's own E.jointValues, so a pose is kinematically consistent.
import { E } from '../lib.mjs';
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// rigid transform {R (row-major 3x3), t}
const I = () => ({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
const apply = (T, p) => [T.R[0] * p[0] + T.R[1] * p[1] + T.R[2] * p[2] + T.t[0], T.R[3] * p[0] + T.R[4] * p[1] + T.R[5] * p[2] + T.t[1], T.R[6] * p[0] + T.R[7] * p[1] + T.R[8] * p[2] + T.t[2]];
const rotv = (T, v) => [T.R[0] * v[0] + T.R[1] * v[1] + T.R[2] * v[2], T.R[3] * v[0] + T.R[4] * v[1] + T.R[5] * v[2], T.R[6] * v[0] + T.R[7] * v[1] + T.R[8] * v[2]];
const compose = (A, B) => { // A after B
  const R = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) R[r * 3 + c] += A.R[r * 3 + k] * B.R[k * 3 + c];
  return { R, t: apply(A, B.t) };
};
function rotAbout(axis, pivot, q) {
  const [x, y, z] = axis, c = Math.cos(q), s = Math.sin(q), C = 1 - c;
  const R = [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  const Rp = rotv({ R, t: [0, 0, 0] }, pivot);
  return { R, t: [pivot[0] - Rp[0], pivot[1] - Rp[1], pivot[2] - Rp[2]] };
}
/** drivers: {jointId: value relative to the drawn pose (rad | m)}; undriven joints take their
    drawn-pose fix q0 (added to any driver value). Returns {cad, joints, values, world}. */
export function poseRobot(cad, truth, joints, drivers) {
  const mechs = truth.mechs.filter((m) => !m.drive);
  const vals = E.jointValues(mechs, (m) => {
    if (m.couple) return null;
    const d = drivers[m.id] ?? 0, q0 = Number.isFinite(m.q0) ? m.q0 : 0;
    return d + q0;
  });
  const byId = new Map(mechs.map((m) => [m.id, m])), W = new Map();
  const world = (id) => {
    if (!byId.has(id)) return I();
    if (W.has(id)) return W.get(id);
    const m = byId.get(id), q = vals.get(id) ?? 0;
    const local = m.kind === 'linear' ? { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: m.axis.map((v) => v * q) } : rotAbout(m.axis, m.pivot, q);
    const T = compose(world(m.parent), local); W.set(id, T); return T;
  };
  const solids = cad.solids.map((s, i) => {
    const id = truth.solids[i].mech; if (!id || !byId.has(id)) return s;
    const T = world(id); return { ...s, pts: s.pts.map((p) => apply(T, p)) };
  });
  const posedJoints = joints.map((j) => { const P = world(byId.get(j.id)?.parent); return { ...j, pivot: apply(P, j.pivot), axis: rotv(P, j.axis) }; });
  return { cad: { ...cad, solids }, joints: posedJoints, values: vals, world };
}
