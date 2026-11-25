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
  // what the page showed for the team's "Tool - AprilTag Check (Limelight)": "(unnamed)"
  assert.equal(E.parseJava(op('@TeleOp(name = "Drive (main)")')).opmode, 'Drive (main)', 'it used to stop at the first ")" and fall back to no name');
  const t = (src) => E.javaOpModeTag(src);
  assert.deepEqual(t(op('@Autonomous(name = "Leave (Red) // v2", group = "Meet 0", preselectTeleOp = "Drive (main)")')),
    { kind: 'Autonomous', name: 'Leave (Red) // v2', group: 'Meet 0', preselect: 'Drive (main)', disabled: false, cls: 'DriveCheck' });
  assert.equal(t(op('@TeleOp(name = "Say \\"go\\"")')).name, 'Say "go"');
  // a Java string's escapes are read as Java reads them
  assert.equal(t(op('@TeleOp(name = "Caf\\u00e9 \\\\ tab\\there \\101")')).name, 'Café \\ tab\there A');
  assert.equal(E.javaUnescape('a\\nb\\\'c\\"d\\\\e\\u0041\\uu0042\\60\\s.'), 'a\nb\'c"d\\eAB0 .');
  // a name of nothing but spaces is no name
  assert.equal(t(op('@TeleOp(name = "   ")')).name, null);
  assert.equal(E.parseJava(op('@TeleOp(name = "   ")')).opmode, 'DriveCheck');
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

/* A browser that held a team's project before this fix has the enums saved in its list of OpModes
   (ftcbench.library). They are moved to the helpers when the page starts, and when the file is
   dropped again, or the wrong entries would stay for good. */
test('opmode list: helpers an older page saved as OpModes are moved to the helpers', () => {
  const ENUM = 'package x;\npublic enum Alliance { RED, BLUE }\n';
  const saved = [{ id: 'u1', file: 'Alliance.java', source: ENUM }, { id: 'u2', file: 'Main.java', source: op('@TeleOp(name = "Main")', 'Main') },
    { id: 'u3', file: 'Snippet.java', source: 'motor.setPower(1);' }];
  const S = E.javaSortSaved(saved, [{ file: 'Util.java', src: 'class Util { }' }]);
  assert.deepEqual(S.opmodes.map((e) => e.id), ['u2', 'u3'], 'the OpMode and the pasted fragment stay');
  assert.deepEqual(S.helpers.map((h) => h.file), ['Util.java', 'Alliance.java']);
  assert.equal(S.moved, 1);
  // a helper already kept under that name is not replaced by the older copy from the list
  const S2 = E.javaSortSaved(saved, [{ file: 'Alliance.java', src: '// newer\n' + ENUM }]);
  assert.equal(S2.helpers.length, 1); assert.match(S2.helpers[0].src, /^\/\/ newer/);
  assert.equal(E.javaSortSaved([saved[1]], []).moved, 0, 'nothing to move: nothing is saved again');
  // the page does both (src/app.js cannot run here: no DOM)
  const app = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(app, /const S=javaSortSaved\(saved\.map/, 'initLibrary sorts what was saved');
  assert.match(app, /LIBRARY=LIBRARY\.filter\(x=>x\.builtin\|\|x\.file!==file\)/, 'adding a helper removes the OpMode entry of the same file');
});

test('opmode list: the headless checker names OpModes as the page does', async () => {
  const { opModeEntry } = await import('../tools/check-code.mjs');
  for (const annotation of ['@TeleOp(name = "Tool - AprilTag Check (Limelight)", group = "Tools (bench)")', '@Autonomous(name = "Leave (Red) // v2", preselectTeleOp = "Drive (main)")', '@TeleOp', '@TeleOp(name = "  ")', '@Disabled\n@TeleOp(name = "Old")']) {
    const src = op(annotation), page = E.parseJava(src), e = opModeEntry(src), tag = E.javaOpModeTag(src);
    assert.equal(e.name, page.opmode, annotation);
    assert.equal(e.kind, page.kind, annotation);
    assert.equal(e.group, tag.group, annotation);
    assert.equal(e.disabled, tag.disabled, annotation);
  }
  assert.equal(opModeEntry(op('@TeleOp(name = "Tool - AprilTag Check (Limelight)", group = "Tools (bench)")')).group, 'Tools (bench)', 'it used to cut the name at the first ")" and lose the group');
  assert.equal(opModeEntry('public class Helper { }'), null);
  assert.equal(opModeEntry(HEAD + '@TeleOp\npublic abstract class Base extends LinearOpMode { }\n').abstract, true);
});
