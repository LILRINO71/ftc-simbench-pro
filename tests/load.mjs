// Loads the browser engine (everything except the DOM/three.js layers) into
// Node so it can be unit tested exactly as it ships — no transpile, no mocks.
//
// The loader is deliberately tolerant: a module file that doesn't exist yet is
// skipped, and an export the loaded files don't define comes back undefined.
// That way each engine module can be written and tested on its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRobot } from '../tools/stepgen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = ['hardware', 'samples', 'step', 'hull', 'inertia', 'expr', 'jvm', 'jvmlib', 'jvmprelude', 'jvmrun', 'java', 'roadrunner', 'mapping', 'robotconfig', 'compare', 'analyze', 'drivetrain', 'frame', 'mates', 'onshapelink', 'onshapecad', 'meshfiles', 'urdf', 'jointspec', 'jointsheet', 'autorig-lib', 'autorig', 'robotcheck', 'bind', 'dynamics', 'joltmech', 'field', 'shots', 'match', 'robotlite', 'net', 'netrelay', 'controllers', 'session', 'mathdoc', 'gitimport', 'onboarding', 'sim', 'tier'];
const EXPORTS = [
  'Field', 'Shots', 'IN', 'TIP_GRAMS', 'FRONTS', 'footprintOf', 'capsulePush', 'nearestMotorId', 'SHOOTER_JAVA',
  'convexHull', 'boxCorners', 'solidTriangles', 'thinPoints', 'solidKind', 'sampleSolids', 'robotBase', 'makeRng',
  'padFromGamepad', 'padName', 'padFor', 'busiestPad', 'PAD_BUTTONS',
  'HW_PARTS', 'GENERIC', 'hwFromPart', 'specFor', 'ticksPerRev',
  'SAMPLE_JAVA', 'DRIVE_JAVA', 'SAMPLE_CAD', 'synthGeometry',
  'splitStepRecords', 'parseSTEP', 'stepShapeUnits', 'classifyMechs', 'recomputeChain', 'rigCarries', 'rigRoots', 'mlabel',
  'JOINT_KINDS', 'leverOf', 'holdTorque', 'armAngleDeg',
  'jvParse', 'jvLex', 'JVM', 'JvProgram', 'jvCompile', 'jvAnalyze', 'jvProbeRun', 'jvProbeHost', 'netTrystero', 'NET_RELAYS', 'jvCodeFor', 'jvMaybe', 'jvPrelude',
  'parseExpr', 'evalNode', 'parseJava', 'deriveBindings', 'travelRange', 'isCommanded',
  'Match', 'MATCH_SKILL', 'MATCH_PTS', 'boxPush', 'Online', 'netRelay', 'netConnect', 'netPackBin', 'netUnpackBin', 'netRandomId', 'netLoopback', 'netGzip', 'netGunzip', 'netHash', 'netSample', 'netAB', 'netKeep', 'dtWheelGeom', 'dtCompositeWheels', 'dtWheelOfParts', 'dtRollerHand', 'dtFrame', 'dtBaseSet', 'dtSymmetricSet', 'dtDriveComposites', 'driveFromSpec', 'liteCluster', 'liteBuild', 'liteEncode', 'liteDecode', 'LITE_FORMAT', 'netCode', 'netSlotPose', 'netSlotY', 'netEl', 'netEls', 'NET_SLOTS', 'NET_PROTO', 'autoMap', 'wheelCorner', 'detectDrivetrain', 'analyze', 'checkRobot', 'setupAuto', 'isDriveDevice', 'Sim', 'driveProbe', 'driveVerdict', 'motorTpr', 'normalizeExpr',
  'AUTO_JAVA', 'coverage', 'lineAt', 'collectStaticFields',
  'parseRobotConfig', 'checkRobotConfig', 'configKind', 'codeKind', 'diffOpModes',
  // Pro
  'MATERIALS', 'hullVolume', 'partMass', 'massProps', 'inertiaOf',
  'driveFromCAD', 'DRIVE_KINDS', 'ikMatrix', 'fkFromIk', 'wheelSpeeds', 'chassisFromWheels',
  'Dyn', 'tractionLimit', 'motorTorque', 'wheelLoads', 'JoltMech', 'JOLT_LIB',
  'onshapeRead', 'onshapeGeomCache', 'onshapeRef', 'onshapeFromLink', 'onshapeSignInState', 'checkOnshapePayload', 'onshapeLinks', 'ONSHAPE_FORMAT', 'parseOnshapeAssembly', 'applyMateLimits', 'matchOnshapeParts', 'applyOnshapeMates', 'mateQty',
  'cadFromOnshape', 'urdfStl', 'urdfXml', 'urdfRobot', 'urdfRobotFromZip', 'urdfExact', 'urdfApplyHints', 'meshReduce', 'meshDecimate', 'stlTriangles', 'zipEntries', 'zipRead', 'gltfRead', 'objRead', 'meshRead', 'bindDevices', 'classifyJoints', 'BIND_RULES', 'onshapeGeomKey', 'osColor', 'osCompactTess', 'osCompactMass',
  'rrDetect', 'rrParseHelpers', 'rrAttach', 'rrBuildPlan', 'rrSample', 'RRRuntime',
  'autoRig', 'ARActuators', 'ARSlides', 'ARCarry',
  'JOINT_SHEET_FORMAT', 'jointTag', 'jointNameKey', 'onshapeMateName', 'sheetFromTags', 'applyJointSheet', 'clearJointSheet', 'mergeJointSheets', 'sheetBindings', 'checkJointSheet', 'tagFor', 'isExact',
  'JOINT_SPEC_FORMAT', 'applyJointSpec', 'jointSpecSelect', 'followQ', 'linkPin', 'sliderCrank', 'rodAngle', 'fourBarPin', 'jointValues', 'mateJointQ', 'specFromCad', 'suggestJoint',
  'robotFrame', 'frameUp', 'applyFrame', 'canonicalizeCAD', 'frontToRobot', 'robotToWorld', 'frontFromWheels', 'frontAcrossWheels', 'frameMatrix', 'FRAME_UP_ROWS', 'buildRig', 'ASSUMED_KG', 'findingHTML',
  'FTCSIM_MAGIC', 'packSession', 'unpackSession', 'sessionFromBench',
  'mathReport', 'mathText', 'mathMarkdown',
  'parseRepoRef', 'rawUrlsFor', 'pickOpModes', 'javaLooksLikeOpMode',
  'TOUR', 'statusOf', 'STATUS_RANK', 'deviceTier', 'TIER_BUDGETS',
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

// corpus STEPs are gitignored with the rest of *.step; a fresh clone regenerates them
export const fixture = (name) => {
  const f = path.join(ROOT, 'tests', 'fixtures', name), m = /^robots\/([\w-]+)\.step$/.exec(name);
  return m && !fs.existsSync(f) ? buildRobot(m[1]).text : fs.readFileSync(f, 'utf8');
};

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
