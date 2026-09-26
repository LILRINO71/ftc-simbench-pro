// Measures findActuators against the hand-written Into The Deep joint spec and the synthetic corpus.
//   node --max-old-space-size=8192 eval.mjs [--list] [--quiet-corpus]
import fs from 'node:fs';
import { loadITD, loadCorpus, E, REPO } from '../lib.mjs';
import { findActuators } from './actuators.mjs';

const LIST = process.argv.includes('--list');
const f1 = (x) => (x == null || !Number.isFinite(x) ? '  -  ' : x.toFixed(1));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return a.map((v) => v / n); };
const angDeg = (a, b) => Math.acos(Math.min(1, Math.abs(dot(unit(a), unit(b))))) * 180 / Math.PI;
const perpMM = (p, o, a) => { const v = sub(p, o), u = unit(a); const t = dot(v, u); return norm(sub(v, u.map((x) => x * t))); };

const t0 = Date.now();
const { cad, truth } = loadITD();
const tLoad = Date.now() - t0;
const t1 = Date.now();
const res = findActuators(cad, { driveFromCAD: E.driveFromCAD, hwFromPart: E.hwFromPart });
const tRun = Date.now() - t1;
const A = res.actuators, S = cad.solids;
const nm = (i) => i + ':' + S[i].name.slice(0, 28);

console.log(`Into The Deep: ${S.length} parts, load ${tLoad} ms, findActuators ${tRun} ms, ${A.length} actuators found\n`);
if (LIST) for (const a of A) {
  console.log(`${a.id.padEnd(16)} role=${String(a.role).padEnd(12)} axis=[${a.axis.map((v) => v.toFixed(3))}] pivot=[${a.pivot}] part=${a.part || a.family || '-'}${a.spec ? ' (' + a.spec.fam + ')' : ''}`);
  console.log('   body   ', a.body.map(nm).join(' | '));
  console.log('   mounts ', a.mounts.map(nm).join(' | '));
  console.log('   output ', a.output.map(nm).join(' | '));
  console.log('   attach ', a.attached.map(nm).join(' | '));
  if (a.meshes.length) console.log('   meshes ', a.meshes.map((m) => nm(m.gear) + ' <-> ' + nm(m.with) + ' ratio ' + m.ratio.toFixed(2)).join('; '));
  console.log('   why    ', a.why.join('; '));
}

/* ---- ground truth labels for evaluation only (hand-read from the CAD tree) ----
   every real actuator body in this CAD: 8 "Servo Case" solids, 7 "Motor Part" cans */
const REAL = S.map((s, i) => [i, s.name]).filter(([, n]) => n === 'Servo Case' || n === 'Motor Part').map(([i]) => i);
const hit = new Map();          // real body -> detections
for (const a of A) for (const i of a.body) if (REAL.includes(i)) { if (!hit.has(i)) hit.set(i, []); hit.get(i).push(a); }
const fp = A.filter((a) => !a.body.some((i) => REAL.includes(i)));
const dups = [...hit.values()].filter((v) => v.length > 1).length;
console.log(`Detection: real actuators ${REAL.length} (${REAL.filter((i) => S[i].name === 'Servo Case').length} servos, ${REAL.filter((i) => S[i].name === 'Motor Part').length} motors); found ${hit.size}; missed ${REAL.length - hit.size} [${REAL.filter((i) => !hit.has(i)).map(nm)}]; false positives ${fp.length} [${fp.map((a) => a.id + ' ' + a.body.map(nm))}]; duplicates ${dups}`);

// descendants via parent chain
const M = truth.mechs.filter((m) => !m.drive);
const byId = new Map(M.map((m) => [m.id, m]));
const under = (id, root) => { let g = 0; while (id && g++ < 20) { if (id === root) return true; const m = byId.get(id); id = m ? m.parent : null; } return false; };
const mechOf = (i) => truth.solids[i].mech;
const isFast = (i) => S[i].kind === 'fastener' || /screw|bolt|nut|washer|standoff|spacer/i.test(S[i].name) || S[i].size < 0.012;

const JOINTS = ['arm', 'outRot', 'outClaw', 'crank R', 'crank L', 'inY', 'inPiv', 'inX', 'inClaw'];
// the device body that drives each joint (hand-read: the servo case / motor can)
const DEVICE = { arm: 91, outRot: 121, outClaw: 102, 'crank R': 132, 'crank L': 131, inY: 133, inPiv: 112, inX: 110, inClaw: 117 };
console.log('\nPer joint (best detected actuator by perpendicular distance + 0.5 x angle):');
console.log('joint     | device ok | axis err deg | pivot->axis mm | driven parts ok/all | attached ok/all | body+mount ok/all | gear on output | pick');
const rows = [];
let sumAng = 0, sumD = 0, nOk = 0;
const agg = { out: [0, 0], att: [0, 0], body: [0, 0], outF: [0, 0] };
for (const id of JOINTS) {
  const m = byId.get(id); if (!m) { console.log(id, 'not in truth'); continue; }
  const P = m.pivot, ax = m.axis;
  let best = null;
  for (const a of A) {
    const ang = angDeg(a.axis, ax), d = perpMM(P.map((v) => v * 1000), a.pivot, a.axis);
    const sc = d + 0.5 * ang;
    if (!best || sc < best.sc) best = { a, ang, d, sc };
  }
  const a = best.a, devOk = a.body.includes(DEVICE[id]);
  if (devOk) nOk++;
  const riding = (i) => under(mechOf(i), id);
  const cnt = (list, good, filt) => { const L = list.filter(filt); return [L.filter(good).length, L.length]; };
  const member = (i) => /spline|shaft/i.test(S[i].name);        // the actuator's own output member
  const out = cnt(a.output, riding, (i) => !isFast(i) && !member(i)), outF = cnt(a.output, riding, isFast);
  const mem = cnt(a.output, riding, member);
  agg.mem = agg.mem || [0, 0]; agg.mem[0] += mem[0]; agg.mem[1] += mem[1];
  const att = cnt(a.attached, riding, (i) => !isFast(i));
  const body = cnt(a.body.concat(a.mounts), (i) => !riding(i), (i) => !isFast(i));
  for (const [k, v] of [['out', out], ['att', att], ['body', body], ['outF', outF]]) { agg[k][0] += v[0]; agg[k][1] += v[1]; }
  // the part the joint is centred on (for the claws: the driven gear)
  const gearTruth = S.map((s, i) => i).filter((i) => mechOf(i) === id && /gear/i.test(S[i].name));
  const gearOn = gearTruth.length ? (gearTruth.some((g) => a.output.includes(g)) ? 'yes ' + gearTruth.filter((g) => a.output.includes(g)).join(',') : 'NO') : 'n/a';
  sumAng += best.ang; sumD += best.d;
  rows.push({ id, ang: best.ang, d: best.d });
  console.log(`${id.padEnd(9)} | ${devOk ? 'yes' : 'NO '}       | ${f1(best.ang).padStart(12)} | ${f1(best.d).padStart(14)} | ${(out[0] + '/' + out[1]).padStart(19)} | ${(att[0] + '/' + att[1]).padStart(15)} | ${(body[0] + '/' + body[1]).padStart(17)} | ${gearOn.padEnd(14)} | ${a.id}${a.meshes.length ? ' meshes ' + a.meshes.map((x) => x.with).join(',') : ''}`);
}
console.log(`mean axis error ${f1(sumAng / JOINTS.length)} deg, mean pivot distance ${f1(sumD / JOINTS.length)} mm, max ${f1(Math.max(...rows.map((r) => r.d)))} mm; right device ${nOk}/${JOINTS.length}`);
console.log(`driven parts (hub/horn/gear, structural) that ride the joint: ${agg.out[0]}/${agg.out[1]}; parts bolted to them: ${agg.att[0]}/${agg.att[1]}; body+mounts that do NOT ride it: ${agg.body[0]}/${agg.body[1]}; fasteners on the output: ${agg.outF[0]}/${agg.outF[1]}`);
console.log(`own output member (spline/shaft) riding the joint in the truth: ${agg.mem[0]}/${agg.mem[1]} (the truth file puts a gearmotor's shaft with its body)`);

// geared followers: the gear each output gear meshes with, against the truth's follower joints
for (const id of ['outClaw finger', 'inClaw finger']) {
  const m = byId.get(id); if (!m) continue;
  let best = null;
  for (const a of A) for (const x of a.meshes || []) {
    const d = perpMM(m.pivot.map((v) => v * 1000), x.withCentre, x.withAxis), ang = angDeg(x.withAxis, m.axis);
    if (!best || d + ang < best.d + best.ang) best = { a, x, d, ang };
  }
  const tr = m.couple ? m.couple.ratio : null;
  console.log(best ? `  follower ${id.padEnd(15)}: meshing gear ${best.x.with} (${S[best.x.with].name.slice(0, 30)}) off ${best.a.id}: axis err ${f1(best.ang)} deg, pivot->axis ${f1(best.d)} mm, ratio ${best.x.ratio} (truth ${tr}), gear rides truth '${mechOf(best.x.with)}'` : `  follower ${id}: no meshing gear found`);
}
const amb = A.filter((a) => a.ambiguous);
console.log(`  flagged ambiguous (output end not settled): ${amb.length}${amb.length ? ' [' + amb.map((a) => a.id) + ']' : ''}`);

// lift motors and drive motors
const lift = byId.get('lift');
const liftMot = A.filter((a) => a.kind === 'motor' && a.body.some((i) => mechOf(i) === undefined) && !a.drive && Math.abs(a.axis[2]) > 0.9);
console.log('\nMotors:');
for (const a of A.filter((x) => x.kind === 'motor')) {
  console.log(`  ${a.id.padEnd(14)} role=${String(a.role).padEnd(12)} axis=[${a.axis.map((v) => v.toFixed(2))}] pivot=[${a.pivot}] part=${a.part || a.family || '-'} output=[${a.output.map(nm)}] body mech=${[...new Set(a.body.map(mechOf))]}`);
}
console.log(`  vertical non-drive motors on the frame (the two lift/spool motors): ${liftMot.length}, roles ${liftMot.map((a) => a.role)} -> ${liftMot.every((a) => a.role !== 'joint') ? 'NOT treated as revolute joints' : 'SOME treated as joints'}`);
const drv = A.filter((a) => a.drive);
console.log(`  drive-flagged: ${drv.length} (${drv.map((a) => a.kind + '@' + a.pivot.map((v) => v.toFixed(0))).join('; ')})`);

// servos: which evidence decided the face/end
console.log('\nServos:');
for (const a of A.filter((x) => x.kind === 'servo')) console.log(`  ${a.id.padEnd(10)} body=${a.body.map(nm).join(',')} spline=${a.output.filter((i) => /spline/i.test(S[i].name)).length ? 'yes' : 'no '} role=${a.role} ${a.why.join('; ')}`);

/* ---- corpus: false positives ---- */
console.log('\nCorpus robots:');
const dir = REPO + 'tests/fixtures/robots/';
let cFP = 0, cMiss = 0, cDriveWrong = 0, cJoint = 0, cTot = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const name = f.slice(0, -5), meta = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
  let c; try { c = loadCorpus(name); } catch (e) { console.log('  ', name, 'load error', e.message); continue; }
  const r = findActuators(c, { driveFromCAD: E.driveFromCAD, hwFromPart: E.hwFromPart });
  // real actuators: named motor/servo solids (the synthetic ones are single solids)
  let real = c.solids.map((s, i) => i).filter((i) => { const h = E.hwFromPart(c.solids[i].part, c.solids[i].name); return h && (h.kind === 'motor' || h.kind === 'servo'); });
  const unnamed = /unnamed/.test(name);
  if (unnamed) {   // same geometry as mecanum-zup, every product renamed "Part N": match its actuators by position
    const z = loadCorpus('mecanum-zup'), cz = (s) => [0, 1, 2].map((k) => s.pts.reduce((a, p) => a + p[k], 0) / s.pts.length);
    const zr = z.solids.filter((s) => { const h = E.hwFromPart(s.part, s.name); return h && (h.kind === 'motor' || h.kind === 'servo'); }).map(cz);
    real = c.solids.map((s, i) => i).filter((i) => zr.some((q) => norm(sub(q, cz(c.solids[i]))) < 0.001));
  }
  const found = new Set(); let fpN = 0;
  for (const a of r.actuators) { const b = a.body.filter((i) => real.includes(i)); if (!b.length) fpN++; b.forEach((i) => found.add(i)); }
  const miss = real.filter((i) => !found.has(i)).length;
  const isSwerve = meta.drive && meta.drive.kind === 'swerve';
  let wrongDrive = 0;
  for (const a of r.actuators) {
    const shouldDrive = a.kind === 'motor' ? (meta.drive && meta.drive.kind !== 'none' && meta.drive.kind !== 'unknown') : isSwerve;
    if (!!a.drive !== !!shouldDrive) wrongDrive++;
  }
  const joints = r.actuators.filter((a) => a.role === 'joint');
  cFP += fpN; cMiss += miss; cDriveWrong += wrongDrive; cJoint += joints.length; cTot += r.actuators.length;
  console.log(`  ${name.padEnd(16)} real ${String(real.length).padStart(2)}${unnamed ? ' (no names)' : ''} found ${String(r.actuators.length).padStart(2)} FP ${fpN} missed ${miss} wrong drive flag ${wrongDrive} | roles ${r.actuators.map((a) => a.kind[0] + ':' + a.role).join(' ')}`);
}
console.log(`  corpus total: ${cTot} found, ${cFP} false positives, ${cMiss} missed, ${cDriveWrong} wrong drive flags, ${cJoint} claimed as 'joint' (outputs something turns)`);
