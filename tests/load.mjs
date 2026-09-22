// Loads the browser engine (everything except the DOM/three.js layers) into
// Node so it can be unit tested exactly as it ships — no transpile, no mocks.
//
// The loader is deliberately tolerant: a module file that doesn't exist yet is
// skipped, and an export the loaded files don't define comes back undefined.
// That way each engine module can be written and tested on its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = ['hardware', 'samples', 'step', 'hull', 'inertia', 'expr', 'java', 'mapping', 'robotconfig', 'compare', 'analyze', 'drivetrain', 'frame', 'dynamics', 'field', 'shots', 'controllers', 'session', 'mathdoc', 'gitimport', 'onboarding', 'sim'];
const EXPORTS = [
  'Field', 'Shots', 'IN', 'TIP_GRAMS', 'FRONTS', 'footprintOf', 'capsulePush', 'nearestMotorId', 'SHOOTER_JAVA',
  'convexHull', 'boxCorners', 'solidTriangles', 'thinPoints', 'solidKind', 'sampleSolids', 'robotBase', 'makeRng',
  'padFromGamepad', 'padName', 'padFor', 'busiestPad', 'PAD_BUTTONS',
  'HW_PARTS', 'GENERIC', 'hwFromPart', 'specFor',
  'SAMPLE_JAVA', 'DRIVE_JAVA', 'SAMPLE_CAD', 'synthGeometry',
  'splitStepRecords', 'parseSTEP', 'classifyMechs', 'recomputeChain', 'rigCarries', 'rigRoots', 'mlabel',
  'JOINT_KINDS', 'leverOf', 'holdTorque', 'armAngleDeg',
  'parseExpr', 'evalNode', 'parseJava', 'deriveBindings', 'travelRange', 'isCommanded',
  'autoMap', 'wheelCorner', 'detectDrivetrain', 'analyze', 'Sim',
  'AUTO_JAVA', 'coverage', 'lineAt', 'collectStaticFields',
  'parseRobotConfig', 'checkRobotConfig', 'configKind', 'codeKind', 'diffOpModes',
  // Pro
  'MATERIALS', 'hullVolume', 'partMass', 'massProps', 'inertiaOf',
  'driveFromCAD', 'DRIVE_KINDS', 'ikMatrix', 'fkFromIk', 'wheelSpeeds', 'chassisFromWheels',
  'Dyn', 'tractionLimit', 'motorTorque', 'wheelLoads',
  'robotFrame', 'frameUp', 'applyFrame', 'canonicalizeCAD', 'frontToRobot', 'robotToWorld', 'frontFromWheels', 'frontAcrossWheels', 'frameMatrix', 'FRAME_UP_ROWS', 'buildRig', 'ASSUMED_KG',
  'FTCSIM_MAGIC', 'packSession', 'unpackSession', 'sessionFromBench',
  'mathReport', 'mathText', 'mathMarkdown',
  'parseRepoRef', 'rawUrlsFor', 'pickOpModes', 'javaLooksLikeOpMode',
  'TOUR', 'statusOf', 'STATUS_RANK',
];

function engineSource() {
  const parts = [];
  for (const n of ENGINE) {
    const f = path.join(ROOT, 'src', n + '.js');
    if (fs.existsSync(f)) parts.push(`// ---- src/${n}.js ----\n` + fs.readFileSync(f, 'utf8'));
  }
  return parts.join('\n');
}

/** Every engine file concatenated the way the build does it. */
export function engineBundle() {
  return '"use strict";\n' + engineSource();
}

export function loadEngine(src = engineSource()) {
  // Function body: top-level const/let stay private, the return exposes the API.
  const api = EXPORTS.map((n) => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(', ');
  return new Function(`"use strict";\n${src}\nreturn { ${api} };`)();
}

export const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name), 'utf8');

/** The vendored BIOBUZZ Shot Sim engine and its data, as the page loads them. */
export function loadShotEngine() {
  const dir = path.join(ROOT, 'vendor', 'biobuzz-shot-sim');
  const mod = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(path.join(dir, 'engine.js'), 'utf8'))(mod, mod.exports);
  const json = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'data', f), 'utf8'));
  return { engine: mod.exports, data: { field: json('field.json'), motors: json('motors.json'), shooter: json('shooter.json') } };
}

/** Engine with the BIOBUZZ field switched on. */
export function loadWithField(src) {
  const E = loadEngine(src);
  const { engine, data } = loadShotEngine();
  E.Field.init(engine, data);
  return E;
}

/** Fresh sample rig + parsed sample code, the way the app boots. */
export function sampleBench(E, java = E.SAMPLE_JAVA, trust = 'code') {
  const cad = JSON.parse(JSON.stringify(E.SAMPLE_CAD));
  E.classifyMechs(cad.mechs);
  const code = E.parseJava(java);
  const map = E.autoMap(code.devices, cad.mechs);
  const opts = { payloadKg: 0.18, duty: 0.30, trust };
  return { cad, code, map, opts };
}

/** Run the simulator for `seconds` at the app's fixed 50 Hz step. */
export function run(E, seconds) {
  const steps = Math.round(seconds / 0.02);
  for (let i = 0; i < steps; i++) E.Sim.tick(0.02);
}
