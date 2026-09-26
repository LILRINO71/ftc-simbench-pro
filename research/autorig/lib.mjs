// Shared loader for the autorig study. Node, run with --max-old-space-size=8192.
//   import { loadITD, loadCorpus, E } from '<this file>';
//   const { cad, truth, spec } = loadITD();
// cad:   the parsed Into The Deep robot (canonical frame: metres, +z up, origin at the
//        drivetrain centre on the floor). cad.solids[i] = {name, part, kind, size, pts:[[x,y,z],...]},
//        cad.occs[j] = {name, path:[{k,n}], solid:i, T}  (path = the subassembly chain).
// truth: the same robot with the hand-written joint spec applied: truth.solids[i].mech is the
//        joint that part rides (undefined = the frame), truth.mechs = the joints (axis, pivot in m,
//        kind linear|revolute-*, parent, couple, restPos ...). Joint ids match joints.json.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadEngine, fixture } from '../../tests/load.mjs';
// the repo root, with a trailing slash, wherever the repo is checked out
export const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/');
export const E = loadEngine();
const D = REPO + 'assets/robots/into-the-deep/';
let text = null;
export function loadITD() {
  text = text || zlib.gunzipSync(fs.readFileSync(D + 'robot.step.gz')).toString('utf8');
  const cad = E.parseSTEP(text), truth = E.parseSTEP(text);
  const spec = JSON.parse(fs.readFileSync(D + 'joints.json', 'utf8'));
  E.applyJointSpec(truth, spec);
  return { cad, truth, spec };
}
// synthetic corpus robots (tests/fixtures/robots/*.json list them); drivetrains, few mechanisms
export function loadCorpus(name) { return E.parseSTEP(fixture('robots/' + name + '.step')); }
export const centroid = (s) => [0, 1, 2].map((k) => s.pts.reduce((a, p) => a + p[k], 0) / s.pts.length);
