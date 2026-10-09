// The bench on real team CAD: parse, drivetrain, joint finder, robot check.
//   node --max-old-space-size=8192 research/realcad/run.mjs [folder] [name filter]
// With no team code for these robots, the robot check here reports the CAD side only
// (joints that carry nothing, the drivetrain, parts that swing through the frame).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../../tests/load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(process.argv[2] || path.join(HERE, '..', '..', '..', 'ftc-cad-corpus'));
const only = process.argv[3];
const E = loadEngine();
if (!fs.existsSync(DIR)) { console.log('No test set at ' + DIR + '. Run research/realcad/fetch.mjs first.'); process.exit(0); }
for (const f of fs.readdirSync(DIR).filter((f) => /\.(step|stp)$/i.test(f) && (!only || f.includes(only))).sort()) {
  const t0 = Date.now();
  let cad;
  try { cad = E.parseSTEP(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { console.log(`\n## ${f}: PARSE FAILED ${e.message}`); continue; }
  const S = cad.solids || [];
  let dt = null; try { dt = E.driveFromCAD(cad, {}); } catch (e) { dt = { err: e.message }; }
  let R = null; try { R = E.autoRig(cad, {}); } catch (e) { R = { err: e.message }; }
  console.log(`\n## ${f}: ${S.length} parts, ${cad.units}, ${Date.now() - t0} ms; ${(dt && dt.wheels || []).length} drive wheels`);
  if (R && R.err) { console.log('   finder stopped: ' + R.err); continue; }
  if (!R || !R.spec) { console.log('   finder: ' + ((R && R.review) || []).join(' | ')); continue; }
  console.log(`   finder: ${R.actuators} actuators, ${R.slides} slides, ${R.spec.joints.length} joints, ${R.moved} parts on joints`);
  try { E.applyJointSpec(cad, R.spec); } catch (e) { console.log("   THE FOUND JOINTS DO NOT LOAD: " + e.message); continue; }
  const C = E.checkRobot(cad, { devices: [] }, {}, {});
  for (const i of C.items.filter((i) => i.sev !== 'ok' && i.key !== 'source')) console.log(`   ${i.sev.padEnd(4)} ${i.text.slice(0, 160)}`);
}
