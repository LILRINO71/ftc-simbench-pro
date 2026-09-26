// The generator's 'mated' robot (mecanum base, a lift with its motor, an arm with a servo), built in memory.
import { E } from '../lib.mjs';
import { buildRobot } from '../../../tools/stepgen.mjs';
import { findActuators } from './actuators.mjs';
const { text, truth } = buildRobot('mated');
const cad = E.parseSTEP(text);
const r = findActuators(cad, { driveFromCAD: E.driveFromCAD, hwFromPart: E.hwFromPart });
const S = cad.solids;
console.log('mated robot:', S.length, 'solids; truth joints', truth.joints.map((j) => j.name + ' ' + j.kind + ' axis ' + j.axis).join('; '));
for (const a of r.actuators) console.log(' ', a.id.padEnd(14), String(a.role).padEnd(9), 'axis', a.axis.map((v) => v.toFixed(2)).join(','), 'pivot', a.pivot.join(','), 'body', a.body.map((i) => S[i].name.slice(0, 34)), 'out', a.output.map((i) => S[i].name.slice(0, 20)), 'att', a.attached.map((i) => S[i].name.slice(0, 24)));
