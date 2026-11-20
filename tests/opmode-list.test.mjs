// What the page lists as an OpMode, and under what name. With a team's real project dropped in
// (twenty OpModes and a folder of helpers), two things were wrong in the list: helper files that
// declare an enum (Alliance.java, Ball.java) were listed as OpModes of their own, because only a
// file with the word "class" counted as a helper; and an OpMode whose annotation gives no name
// (@TeleOp alone) read "(unnamed)", twice, where the Driver Station shows the class's name.
// The annotation is now read in one place (javaOpModeTag, src/java.js), comments and strings
// respected, for the page and for the headless tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';
import { isOpModeSource, readJava, libsFor, engine } from '../tools/run-opmode.mjs';

const E = loadEngine();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEAD = 'package org.firstinspires.ftc.teamcode;\nimport com.qualcomm.robotcore.eventloop.opmode.*;\n';
const op = (annotation, cls = 'DriveCheck', base = 'LinearOpMode') => `${HEAD}${annotation}\npublic class ${cls} extends ${base} {\n  @Override public void runOpMode() { waitForStart(); }\n}\n`;

test('opmode list: an OpMode with no name in its annotation is listed by its class name', () => {
  for (const [annotation, kind] of [['@TeleOp', 'TeleOp'], ['@TeleOp()', 'TeleOp'], ['@TeleOp(group = "Checks")', 'TeleOp'], ['@TeleOp(name = "")', 'TeleOp'],
    ['@Autonomous', 'Autonomous'], ['@Autonomous(group = "Checks", preselectTeleOp = "Main")', 'Autonomous'], ['@TeleOp(name = Names.MAIN)', 'TeleOp']]) {
    const code = E.parseJava(op(annotation));
    assert.equal(code.opmode, 'DriveCheck', `${annotation}: listed as ${code.opmode}`);
    assert.equal(code.kind, kind, annotation);
  }
  // a name is still a name
  assert.equal(E.parseJava(op('@TeleOp(name = "Main TeleOp", group = "A")')).opmode, 'Main TeleOp');
  assert.equal(E.parseJava(op('@Autonomous(name="Leave + Park")')).kind, 'Autonomous');
});

test('opmode list: a name may hold a bracket, a slash or a quote; a comment or a string is not an annotation', () => {
  const t = (src) => E.javaOpModeTag(src);
  assert.deepEqual(t(op('@Autonomous(name = "Leave (Red) // v2", group = "Meet 0", preselectTeleOp = "Drive (main)")')),
    { kind: 'Autonomous', name: 'Leave (Red) // v2', group: 'Meet 0', preselect: 'Drive (main)', disabled: false, cls: 'DriveCheck' });
  assert.equal(E.parseJava(op('@TeleOp(name = "Drive (main)")')).opmode, 'Drive (main)', 'it used to stop at the first ")" and fall back to no name');
  assert.equal(t(op('@TeleOp(name = "Say \\"go\\"")')).name, 'Say "go"');
  assert.equal(t(op('@TeleOp(\n    name = "Two lines",\n    group = "B"\n)')).name, 'Two lines');
  assert.equal(t(op('@Disabled\n@TeleOp(name = "Old")')).disabled, true);
  // only code counts
  assert.equal(t(HEAD + '// @TeleOp(name = "commented out")\n/* @Autonomous */\npublic class Helper { String s = "@TeleOp(name = \\"in a string\\")"; }\n'), null);
  assert.equal(t(HEAD + '// @Autonomous(name = "Old auto")\n@TeleOp(name = "Real")\npublic class Real extends OpMode { public void init() {} public void loop() {} }\n').name, 'Real');
  // the class the annotation is on, not one declared above it
  assert.equal(t(HEAD + 'class Util { }\n@TeleOp\npublic class Second extends LinearOpMode { public void runOpMode() {} }\n').cls, 'Second');
});

test('opmode list: a file that declares any type and is not an OpMode is a helper', () => {
  const helpers = {
    'Alliance.java': 'package x;\npublic enum Alliance { RED(-1), BLUE(1); public final int sign; Alliance(int s) { sign = s; } }\n',
    'Ball.java': 'package x;\npublic enum Ball { POLLEN, NECTAR }\n',
    'Shape.java': 'package x;\npublic interface Shape { double area(); }\n',
    'Pose.java': 'package x;\npublic record Pose(double x, double y) { }\n',
    'Tunable.java': 'package x;\npublic @interface Tunable { }\n',
    'Util.java': 'package x;\n// this helper once extended OpMode; it is not an OpMode\npublic final class Util { static String s = "extends LinearOpMode"; }\n',
  };
  for (const [file, src] of Object.entries(helpers)) {
    assert.equal(E.javaIsOpMode(src), false, file + ' is not an OpMode');
    assert.equal(E.javaDeclaresType(src), true, file + ' declares a type');
    assert.equal(isOpModeSource(src), false, file + ': the headless tools agree');
  }
  // an OpMode, and a parent other OpModes build on
  assert.equal(E.javaIsOpMode(op('@TeleOp')), true);
  assert.equal(E.javaIsOpMode(HEAD + 'public abstract class Base extends LinearOpMode { }\n'), true);
  // a pasted fragment declares nothing: the page still runs it as code
  assert.equal(E.javaDeclaresType('double record = 1; // class of its own\nmotor.setPower(record);'), false);
  // the page's rule is this one (src/app.js cannot run here: no DOM)
  const app = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.ok(/if\(!isOpModeSource\(text\)&&javaDeclaresType\(text\)\)\{/.test(app) && /const isOpModeSource=t=>javaIsOpMode\(t\);/.test(app), 'addOpModeFromText files a non-OpMode that declares a type as a helper');
});

test('opmode list: a project with enums beside its OpModes runs headless as before', () => {
  const files = [
    { file: 'Alliance.java', src: 'package org.firstinspires.ftc.teamcode;\npublic enum Alliance { RED(-1), BLUE(1); public final int sign; Alliance(int s) { sign = s; } }\n' },
    { file: 'Main.java', src: `${HEAD}@TeleOp\npublic class Main extends LinearOpMode {\n  @Override public void runOpMode() { waitForStart(); telemetry.addData("sign", Alliance.BLUE.sign); telemetry.update(); }\n}\n` },
  ];
  const read = readJava(files), main = read.find((f) => f.file === 'Main.java');
  const { libs } = libsFor(engine(), read, main);
  assert.deepEqual(libs.map((l) => l.file), ['Alliance.java'], 'the enum comes along as a helper');
});
