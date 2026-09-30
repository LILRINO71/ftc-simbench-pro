// Is the robot check enough? Start from GearGurus 7832's robot set up right
// (its hand-made joints and the team's own TeleOp), which must come back with
// nothing to ask, then break it the ways a robot really gets set up wrong, one
// at a time. Each mistake has to be caught, by the check that names it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const ITD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'robots', 'into-the-deep');
const text = zlib.gunzipSync(fs.readFileSync(path.join(ITD, 'robot.step.gz'))).toString('utf8');
const BAL = fs.readFileSync(path.join(ITD, 'BAL.java'), 'utf8');
const HAND = JSON.parse(fs.readFileSync(path.join(ITD, 'joints.json'), 'utf8'));
const copy = (o) => JSON.parse(JSON.stringify(o));
const j = (spec, id) => spec.joints.find((x) => x.id === id);

// a lift OpMode with RUN_TO_POSITION targets, the team's high basket (2650 ticks)
const LIFT = `package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
@TeleOp(name = "lift test")
public class LiftTest extends LinearOpMode {
    private DcMotorEx uppies;
    @Override
    public void runOpMode() {
        uppies = hardwareMap.get(DcMotorEx.class, "uppies");
        waitForStart();
        while (opModeIsActive()) {
            if (gamepad1.y) { uppies.setTargetPosition(2650); uppies.setMode(DcMotor.RunMode.RUN_TO_POSITION); uppies.setPower(1); }
            if (gamepad1.a) { uppies.setTargetPosition(0); uppies.setMode(DcMotor.RunMode.RUN_TO_POSITION); uppies.setPower(1); }
        }
    }
}`;

/* The check on the robot built from `spec`, with `cadFix` and `codeFix` applied. */
// parsed once; each check works on its own copy
const PARSED = E.parseSTEP(text);
function check({ spec = HAND, cadFix, java = BAL, codeFix } = {}) {
  const cad = structuredClone(PARSED), r = E.applyJointSpec(cad, spec);
  if (cadFix) cadFix(cad);
  const code = E.parseJava(java);
  if (codeFix) codeFix(code);
  const map = E.autoMap(code.devices, cad.mechs);
  for (const d of code.devices) { const k = r.devices[d.name] || r.devices[d.cfg]; if (k) map[d.name] = k; }
  return E.checkRobot(cad, code, map, { isCommanded: (n) => E.isCommanded(code, n) });
}
const flagged = (R, key) => R.items.find((i) => i.sev !== 'ok' && (i.key === key || i.key.startsWith(key)));

test('robot check, set up right: the team robot and TeleOp come back with nothing to ask', () => {
  const R = check();
  assert.deepEqual(R.items.filter((i) => i.sev !== 'ok').map((i) => i.key), []);
});

test('robot check, set up right: the lift OpMode\'s targets fit the lift', () => {
  const R = check({ java: LIFT });
  assert.equal(flagged(R, 'targets:'), undefined);
});

/* Each: how it goes wrong, what to break, the check that must name it. */
const MISTAKES = [
  ['a joint left out of the spec (the outtake wrist)', { spec: (s) => { s.joints = s.joints.filter((x) => x.id !== 'outRot'); for (const x of s.joints) if (x.parent === 'outRot') x.parent = 'arm'; } }, 'dev:outRot'],
  ['a joint whose parts all stayed on the frame', { cadFix: (cad) => { for (const s of cad.solids) if (s.mech === 'outClaw finger') s.mech = null; } }, 'empty:outClaw finger'],
  ['a frame rail put on the arm', { cadFix: (cad) => { const i = cad.solids.findIndex((s) => !s.mech && /U-Channel/.test(s.name) && Math.abs(s.pts[0][2]) < 0.1); cad.solids[i].mech = 'arm'; } }, 'swing:arm'],
  ['the arm turning about the wrong axis (90° off)', { spec: (s) => { j(s, 'arm').axis = [1, 0, 0]; } }, 'axis:arm'],
  ['the arm\'s pivot 8 cm from its motor', { spec: (s) => { j(s, 'arm').pivot = [-49.5, 0, 432]; } }, 'axis:arm'],
  ['two servos swapped between joints (inPiv and outClaw)', { spec: (s) => { j(s, 'inPiv').device = 'outClaw'; j(s, 'outClaw').device = 'inPiv'; } }, 'range:outClaw'],
  ['a servo joint drawn at the wrong position (outClaw restPos 0.95)', { spec: (s) => { j(s, 'outClaw').restPos = 0.95; } }, 'range:outClaw'],
  ['a motor put on a servo\'s joint', { spec: (s) => { j(s, 'outRot').device = 'motor'; j(s, 'arm').device = 'outRot'; } }, 'kind:outRot'],
  ['a follower of a joint that isn\'t there', { cadFix: (cad) => { const m = cad.mechs.find((x) => x.id === 'outClaw finger'); m.couple = Object.assign({}, m.couple, { to: 'gone' }); } }, 'follow:outClaw finger'],
  ['the STEP read in the wrong units (inches as millimetres)', { cadFix: (cad) => { const k = 25.4; for (const s of cad.solids) s.pts = s.pts.map((p) => p.map((v) => v * k)); cad.bbox = { min: cad.bbox.min.map((v) => v * k), max: cad.bbox.max.map((v) => v * k) }; } }, 'scale'],
  ['the code drives more wheels than the CAD has', { codeFix: (code) => { for (const n of ['midLeftDrive', 'midRightDrive']) code.devices.push({ name: n, type: 'DcMotor', cfg: n }); } }, 'drive'],
  ['the lift\'s spool three times too big (mm per tick)', { java: LIFT, spec: (s) => { j(s, 'lift').mmPerTick = 0.78; } }, 'targets:lift'],
];

for (const [what, how, key] of MISTAKES) {
  test('robot check catches: ' + what, () => {
    const spec = copy(HAND); if (how.spec) how.spec(spec);
    const R = check({ spec, cadFix: how.cadFix, java: how.java, codeFix: how.codeFix });
    const hit = flagged(R, key);
    assert.ok(hit, `nothing flagged "${key}"; it said: ` + R.items.filter((i) => i.sev !== 'ok').map((i) => i.key).join(', '));
  });
}
