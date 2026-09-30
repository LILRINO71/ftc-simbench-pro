// tools/mechgen.mjs — the MECHANISM ZOO: robots with every kind of FTC
// mechanism, each with its true joints, to measure the automatic joint finder
// (src/autorig.js) on designs the one real robot in the repo doesn't have.
//
// Every robot is the corpus's mecanum base (tools/stepgen.mjs) plus one
// mechanism, written as an Onshape-style STEP with real B-rep solids. Each
// moving part is tagged with the joint it rides; its name is made unique, so
// the truth maps onto the parser's solids by name.
//
//   import { MECHS, buildMech } from './mechgen.mjs'
//   buildMech('arm-5203') -> { text, truth:{ joints:[...], label:{partName: jointId}, ignore:[names] } }
//   buildMech('arm-5203', { strip:true })   every part renamed "Part N", the tree flattened
import { frame, box, cyl, prism, part, asm, inst, walk, writeStep, IDF, COL, ngon,
  motor5203, uChannel, plate, servo, screw, mecanumBase, flatten } from './stepgen.mjs';

const TOP = 0.080;                      // the base's pattern plate top (stepgen: WR + 0.024 + 0.004)
const Y = [0, 1, 0], Z = [0, 0, 1], X = [1, 0, 0];

// a part placed so its local z runs along `axis` from `o`
const along = (o, axis, x) => frame(o, axis, x || (Math.abs(axis[2]) > 0.9 ? X : [0, 0, 1]));
const hub = (name, r = 0.012, h = 0.012) => part(name, [cyl(IDF, r, h)], COL.steel, 0.03);
const bar = (name, s, kg = 0.05) => part(name, [box([0, 0, 0], s)], COL.alu, kg);
const hexShaft = (name, len) => part(name, [prism(IDF, ngon(6, 0.0046), len)], COL.steel, 0.04);
const post = (name, c, s) => inst(bar(name, s), frame(c));

/* goBILDA 2000-style servo (case with its mounting ears) and its spline as its own part, output along local +z at x = +10 mm */
const servoCase = (name) => part(name, [box([0, 0, 0], [0.040, 0.020, 0.037]), box([0, 0, 0.009], [0.0545, 0.020, 0.0025])], COL.black, 0.07);
const spline = (name) => part(name, [cyl(IDF, 0.003, 0.006)], COL.steel, 0.002);
/* REV Core Hex: a boxy gearbox with a hex through-bore along local z, the motor can off one side */
const coreHex = () => part('REV Core Hex Motor REV-41-1300', [box([0, 0, 0], [0.045, 0.045, 0.030]), cyl(frame([0.0225, 0, 0], X, [0, 0, 1]), 0.018, 0.040)], COL.black, 0.28);
/* REV UltraPlanetary: square cartridges on a round can, 5 mm hex output along +z */
const ultra = () => part('REV UltraPlanetary Gearbox HD Hex Motor REV-41-1600', [box([0, 0, -0.030], [0.040, 0.040, 0.060]), cyl(frame([0, 0, -0.110]), 0.018, 0.050)], COL.black, 0.35);
const ultraShaft = () => hexShaft('UltraPlanetary Output Shaft', 0.024);

/* Each mechanism: kids (instances, moving ones tagged j), joints (truth), ignore (names not scored). */
export const MECHS = {
  /* a goBILDA gearmotor straight onto an arm: motor on the tower's back, hub on its shaft, arm on the hub */
  'arm-5203': () => {
    const kids = [post('Tower Plate', [0.10, 0.030, TOP + 0.100], [0.060, 0.006, 0.200]),
      inst(motor5203('goBILDA 5203 Arm Motor 5203-2402-0051'), along([0.10, 0.027, 0.250], Y)),
      tag(inst(hub('1310 Series Hyper Hub'), along([0.10, 0.036, 0.250], Y)), 'arm'),
      tag(inst(bar('Arm Channel', [0.300, 0.012, 0.024]), frame([0.240, 0.054, 0.250])), 'arm'),
      tag(inst(bar('Arm End Plate', [0.012, 0.040, 0.050], 0.03), frame([0.396, 0.054, 0.250])), 'arm')];
    return { kids, joints: [{ id: 'arm', kind: 'revolute', axis: Y, pivot: [0.10, 0.027, 0.250], actuator: 'motor' }] };
  },
  /* a servo on a bracket, a horn on its spline, an arm on the horn */
  'arm-servo': () => {
    const kids = [post('Bracket Post', [0.10, 0, TOP + 0.052], [0.020, 0.020, 0.104]),
      post('Servo Bracket', [0.10, 0, 0.187], [0.050, 0.030, 0.006]),
      inst(servoCase('Servo Case 2000-0025-0002'), frame([0.10, 0, 0.200], Y, X)),
      tag(inst(spline('Servo Spline'), along([0.110, 0.0185, 0.200], Y)), 'arm'),
      tag(inst(hub('Servo Horn', 0.012, 0.003), along([0.110, 0.0245, 0.200], Y)), 'arm'),
      tag(inst(bar('Servo Arm', [0.200, 0.004, 0.020]), frame([0.200, 0.0295, 0.200])), 'arm')];
    return { kids, joints: [{ id: 'arm', kind: 'revolute', axis: Y, pivot: [0.110, 0.0185, 0.200], actuator: 'servo' }] };
  },
  /* a REV Core Hex: the hex shaft runs right through the motor; no shaft sticks out of a gearbox face */
  'arm-corehex': () => {
    const kids = [post('Core Hex Mount', [0.10, 0, TOP + 0.03875], [0.050, 0.030, 0.0775]),
      inst(coreHex(), frame([0.10, 0, 0.1575 + 0.0225], Y, X)),
      tag(inst(hexShaft('REV 5mm Hex Shaft', 0.090), along([0.10, -0.045, 0.180], Y)), 'arm'),
      tag(inst(hub('REV Hex Hub', 0.010, 0.010), along([0.10, 0.015, 0.180], Y)), 'arm'),
      tag(inst(bar('Core Hex Arm', [0.220, 0.008, 0.020]), frame([0.200, 0.029, 0.180])), 'arm')];
    return { kids, joints: [{ id: 'arm', kind: 'revolute', axis: Y, pivot: [0.10, 0.015, 0.180], actuator: 'motor' }], ignore: ['REV 5mm Hex Shaft'] };
  },
  /* a turret: a vertical gearmotor turning a platform with a mast on it */
  turret: () => {
    const kids = [post('Turret Base Plate', [0, 0, TOP + 0.003], [0.100, 0.100, 0.006]),
      inst(motor5203('goBILDA 5203 Turret Motor 5203-2402-0027'), along([0, 0, TOP + 0.106], Z)),
      tag(inst(hub('1310 Series Hyper Hub'), along([0, 0, TOP + 0.110], Z)), 'turret'),
      tag(inst(bar('Turntable Plate', [0.200, 0.200, 0.006]), frame([0, 0, TOP + 0.125])), 'turret'),
      tag(inst(bar('Turret Mast', [0.030, 0.030, 0.100]), frame([0, 0, TOP + 0.178])), 'turret')];
    return { kids, joints: [{ id: 'turret', kind: 'revolute', axis: Z, pivot: [0, 0, TOP + 0.106], actuator: 'motor' }] };
  },
  /* a gear train: a pinion on the motor meshes a 3x gear on the arm's own shaft */
  'arm-geared': () => {
    const kids = [post('Gear Tower Plate', [0.10, 0.030, TOP + 0.110], [0.080, 0.006, 0.220]),
      inst(motor5203('goBILDA 5203 Arm Motor 5203-2402-0019'), along([0.10, 0.027, 0.200], Y)),
      tag(inst(hub('Pinion Gear 20T', 0.010, 0.008), along([0.10, 0.036, 0.200], Y)), 'pinion'),
      tag(inst(hexShaft('Arm Axle 8mm REX', 0.040), along([0.10, 0.020, 0.240], Y)), 'arm'),
      tag(inst(hub('Arm Gear 60T', 0.030, 0.008), along([0.10, 0.036, 0.240], Y)), 'arm'),
      tag(inst(bar('Geared Arm', [0.250, 0.010, 0.024]), frame([0.215, 0.049, 0.240])), 'arm')];
    return { kids, ignore: ['Arm Axle 8mm REX'], joints: [
      { id: 'pinion', kind: 'revolute', axis: Y, pivot: [0.10, 0.027, 0.200], actuator: 'motor' },
      { id: 'arm', kind: 'revolute', axis: Y, pivot: [0.10, 0.036, 0.240], follows: 'pinion', ratio: -1 / 3 }] };
  },
  /* one pinion driving two gears, above and below it, each with its own arm (FTC 8375's 2016 robot has this) */
  'twin-gears': () => {
    const kids = [post('Gear Tower Plate', [0.10, 0.030, TOP + 0.110], [0.080, 0.006, 0.220]),
      inst(motor5203('goBILDA 5203 Arm Motor 5203-2402-0019'), along([0.10, 0.027, 0.200], Y)),
      tag(inst(hub('Pinion Gear 20T', 0.010, 0.008), along([0.10, 0.036, 0.200], Y)), 'pinion')];
    for (const [k, z, sx] of [['upper', 0.240, 1], ['lower', 0.160, -1]]) kids.push(
      tag(inst(hexShaft('Axle ' + k, 0.040), along([0.10, 0.020, z], Y)), k),
      tag(inst(hub('Gear 60T ' + k, 0.030, 0.008), along([0.10, 0.036, z], Y)), k),
      tag(inst(bar('Arm ' + k, [0.200, 0.010, 0.020]), frame([0.10 + sx * 0.130, 0.049, z])), k));
    return { kids, ignore: ['Axle upper', 'Axle lower'], joints: [
      { id: 'pinion', kind: 'revolute', axis: Y, pivot: [0.10, 0.027, 0.200], actuator: 'motor' },
      { id: 'upper', kind: 'revolute', axis: Y, pivot: [0.10, 0.036, 0.240], follows: 'pinion', ratio: -1 / 3 },
      { id: 'lower', kind: 'revolute', axis: Y, pivot: [0.10, 0.036, 0.160], follows: 'pinion', ratio: -1 / 3 }] };
  },
  /* a belt: a small pulley on the motor, a big one on the arm's shaft up the tower */
  'arm-belt': () => {
    // the belt's two straight runs, each riding both pulley rims (6 mm wide, 1.5 mm thick)
    const run = (sg) => { const a = [0.10 + sg * 0.008, 0.041, 0.150], b = [0.10 + sg * 0.024, 0.041, 0.300];
      const d = [b[0] - a[0], 0, b[2] - a[2]], L = Math.hypot(d[0], d[2]);
      return prism(frame(a, [d[0] / L, 0, d[2] / L], Y), [[-0.003, -0.00075], [0.003, -0.00075], [0.003, 0.00075], [-0.003, 0.00075]], L); };
    const belt = part('GT2 Timing Belt', [run(1), run(-1)], COL.black, 0.01);
    const kids = [post('Belt Tower Plate', [0.10, 0.030, TOP + 0.150], [0.080, 0.006, 0.300]),
      inst(motor5203('goBILDA 5203 Arm Motor 5203-2402-0019'), along([0.10, 0.027, 0.150], Y)),
      tag(inst(hub('GT2 Pulley 20T', 0.008, 0.010), along([0.10, 0.036, 0.150], Y)), 'motor'),
      tag(inst(hexShaft('Belt Arm Axle', 0.030), along([0.10, 0.020, 0.300], Y)), 'arm'),
      tag(inst(hub('GT2 Pulley 60T', 0.024, 0.010), along([0.10, 0.036, 0.300], Y)), 'arm'),
      tag(inst(bar('Belt Arm', [0.250, 0.010, 0.024]), frame([0.215, 0.051, 0.300])), 'arm'),
      inst(belt, frame([0, 0, 0]))];
    return { kids, ignore: ['GT2 Timing Belt', 'Belt Arm Axle'], joints: [
      { id: 'motor', kind: 'revolute', axis: Y, pivot: [0.10, 0.027, 0.150], actuator: 'motor' },
      { id: 'arm', kind: 'revolute', axis: Y, pivot: [0.10, 0.036, 0.300], follows: 'motor', ratio: 1 / 3 }] };
  },
  /* goBILDA Viper-style: three bars side by side, each stage sliding on the last, a carriage on top */
  'viper-slide': () => {
    const kids = [], L = 0.300;
    for (let k = 0; k < 3; k++) {
      const s = inst(bar('Viper-Slide Stage ' + (k + 1), [0.012, 0.030, L], 0.08), frame([-0.020 + 0.012 * k, 0.100, TOP + L / 2 + 0.010 * k]));
      kids.push(k === 0 ? s : tag(s, k === 1 ? 'stage' : 'carriage'));
    }
    kids.push(post('Viper Mount Block', [-0.020, 0.100, TOP + 0.005], [0.030, 0.040, 0.010]));
    kids.push(tag(inst(bar('Viper Carriage Plate', [0.012, 0.060, 0.050], 0.04), frame([0.016, 0.100, TOP + 0.270])), 'carriage'));
    return { kids, joints: [
      { id: 'stage', kind: 'linear', axis: Z, follows: 'carriage', ratio: 0.5 },
      { id: 'carriage', kind: 'linear', axis: Z }] };
  },
  /* a linear rail with a carriage block straddling it (MGN12H), a plate on the block */
  'rail-carriage': () => {
    const kids = [post('Rail Riser', [0, -0.100, TOP + 0.010], [0.300, 0.020, 0.020]),
      post('MGN12 Linear Rail', [0, -0.100, TOP + 0.024], [0.300, 0.012, 0.008]),
      tag(inst(bar('MGN12H Carriage Block', [0.045, 0.027, 0.013], 0.04), frame([0, -0.100, TOP + 0.0285])), 'carriage'),
      tag(inst(bar('Carriage Payload Plate', [0.080, 0.060, 0.004], 0.03), frame([0, -0.100, TOP + 0.037])), 'carriage')];
    return { kids, joints: [{ id: 'carriage', kind: 'linear', axis: X }] };
  },
  /* an intake roller: a motor outside one side plate, a coupler, a long shaft to the other plate, compliant wheels on it */
  'intake-roller': () => {
    const kids = [post('Intake Side Plate L', [0.110, 0.120, TOP + 0.040], [0.080, 0.006, 0.080]),
      post('Intake Side Plate R', [0.110, -0.120, TOP + 0.040], [0.080, 0.006, 0.080]),
      inst(motor5203('goBILDA 5203 Intake Motor 5203-2402-0003'), along([0.110, -0.123, TOP + 0.070], Y)),
      tag(inst(hub('Shaft Coupler', 0.010, 0.020), along([0.110, -0.117, TOP + 0.070], Y)), 'roller'),
      tag(inst(hexShaft('Intake Roller Shaft', 0.240), along([0.110, -0.107, TOP + 0.070], Y)), 'roller')];
    for (const y of [-0.070, 0, 0.070]) kids.push(tag(inst(hub('Compliant Wheel 60A', 0.024, 0.020), along([0.110, y - 0.010, TOP + 0.070], Y)), 'roller'));
    return { kids, joints: [{ id: 'roller', kind: 'revolute', axis: Y, pivot: [0.110, -0.123, TOP + 0.070], actuator: 'motor' }] };
  },
  /* a parallel four-bar: the motor turns the lower link; the upper link swings on a pin in the
     tower; the coupler joins their ends on two more pins and carries the payload */
  'four-bar': () => {
    const pin = (name, c) => inst(part(name, [cyl(IDF, 0.004, 0.036)], COL.steel, 0.01), along(c, Y));
    const kids = [post('Four-Bar Tower Plate', [0.10, 0.030, TOP + 0.130], [0.080, 0.006, 0.260]),
      inst(motor5203('goBILDA 5203 Four-Bar Motor 5203-2402-0051'), along([0.10, 0.027, 0.200], Y)),
      tag(inst(hub('1310 Series Hyper Hub'), along([0.10, 0.036, 0.200], Y)), 'crank'),
      tag(inst(bar('Lower Four-Bar Link', [0.170, 0.008, 0.024]), frame([0.175, 0.052, 0.200])), 'crank'),
      tag(inst(bar('Upper Four-Bar Link', [0.170, 0.008, 0.024]), frame([0.175, 0.052, 0.280])), 'rocker'),
      tag(inst(bar('Four-Bar Coupler', [0.024, 0.008, 0.100]), frame([0.250, 0.060, 0.240])), 'coupler'),
      tag(inst(bar('Four-Bar End Plate', [0.060, 0.008, 0.060], 0.04), frame([0.270, 0.068, 0.240])), 'coupler'),
      pin('Pivot Pin Tower', [0.10, 0.030, 0.280]), pin('Pivot Pin Lower', [0.25, 0.048, 0.200]), pin('Pivot Pin Upper', [0.25, 0.048, 0.280])];
    return { kids, ignore: ['Pivot Pin Tower', 'Pivot Pin Lower', 'Pivot Pin Upper'], joints: [
      { id: 'crank', kind: 'revolute', axis: Y, pivot: [0.10, 0.027, 0.200], actuator: 'motor' },
      { id: 'rocker', kind: 'revolute', axis: Y, pivot: [0.10, 0.052, 0.280], follows: 'crank', linkage: 'four-bar' },
      { id: 'coupler', kind: 'revolute', axis: Y, pivot: [0.25, 0.052, 0.200], follows: 'crank', linkage: 'four-bar', parent: 'crank' }] };
  },
  /* a joint on a joint: a servo wrist on the end of a gearmotor arm, a claw plate on its horn */
  'wrist-on-arm': () => {
    const kids = [post('Tower Plate', [0.10, 0.030, TOP + 0.100], [0.060, 0.006, 0.200]),
      inst(motor5203('goBILDA 5203 Arm Motor 5203-2402-0051'), along([0.10, 0.027, 0.250], Y)),
      tag(inst(hub('1310 Series Hyper Hub'), along([0.10, 0.036, 0.250], Y)), 'arm'),
      tag(inst(bar('Arm Channel', [0.300, 0.012, 0.024]), frame([0.240, 0.054, 0.250])), 'arm'),
      tag(inst(bar('Arm End Plate', [0.012, 0.040, 0.050], 0.03), frame([0.396, 0.054, 0.250])), 'arm'),
      tag(inst(servoCase('Wrist Servo 2000-0025-0002'), frame([0.4205, 0.054, 0.250], X, Y)), 'arm'),
      tag(inst(spline('Wrist Spline'), along([0.439, 0.064, 0.250], X)), 'wrist'),
      tag(inst(hub('Wrist Horn', 0.012, 0.003), along([0.445, 0.064, 0.250], X)), 'wrist'),
      tag(inst(bar('Claw Plate', [0.004, 0.040, 0.060]), frame([0.450, 0.064, 0.250])), 'wrist')];
    return { kids, joints: [
      { id: 'arm', kind: 'revolute', axis: Y, pivot: [0.10, 0.027, 0.250], actuator: 'motor' },
      { id: 'wrist', kind: 'revolute', axis: X, pivot: [0.439, 0.064, 0.250], actuator: 'servo', parent: 'arm' }] };
  },
};
function tag(i, j) { i.j = j; return i; }

/* Build one zoo robot. strip: every part called "Part N" and no subassemblies. */
export function buildMech(name, opts = {}) {
  const M = MECHS[name]();
  const base = flatten(mecanumBase());
  const label = {}, ignore = new Set(M.ignore || []);
  let n = 0;
  // a fresh, uniquely named copy of every mechanism part, so the truth maps by name
  const kids = M.kids.map((c) => {
    const p = Object.assign({}, c.p, { uid: 900000 + (++n), name: c.p.name + ' #' + n });
    if (ignore.has(c.p.name)) ignore.add(p.name);
    if (c.j) label[p.name] = c.j;
    return inst(p, c.F);
  });
  const root = asm('Zoo ' + name, base.concat(kids));
  if (opts.strip) {
    let k = 0; const seen = new Map();
    walk(root, (p) => { if (p.kind !== 'part') return; if (!seen.has(p.uid)) seen.set(p.uid, 'Part ' + (++k)); });
    const old = new Map(); walk(root, (p) => { if (p.kind === 'part' && !old.has(p.uid)) old.set(p.uid, p.name); });
    walk(root, (p) => { if (p.kind === 'part') { const nm = seen.get(p.uid); if (label[old.get(p.uid)]) label[nm] = label[old.get(p.uid)]; if (ignore.has(old.get(p.uid))) ignore.add(nm); p.name = nm; } });
  }
  const text = writeStep(root, { units: 'mm', name: 'zoo-' + name });
  return { text, truth: { name, joints: M.joints, label, ignore: [...ignore] } };
}
