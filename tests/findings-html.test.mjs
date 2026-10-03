// A finding's title, body and fix go into the Checks tab as HTML. The names in
// them are the team's text: hardwareMap names from the Java, joint names from
// the CAD, device and module names from the Robot Controller's .xml. A device
// asked for as hardwareMap.get(DcMotor.class, "<img src=x onerror=alert(1)>")
// used to put that tag in the page and run its script. Every such name has to
// come out escaped, while the findings' own markup (<code>, <b>) stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

const HOSTILE_JAVA = `
package org.firstinspires.ftc.teamcode;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Servo;

@TeleOp(name = "Hostile")
public class Hostile extends LinearOpMode {
  @Override
  public void runOpMode() {
    DcMotor idle = hardwareMap.get(DcMotor.class, "<img src=x onerror=alert(1)>");
    DcMotor near = hardwareMap.get(DcMotor.class, "<svg onload=alert(2) ");
    Servo arm = hardwareMap.get(Servo.class, "arm");
    DcMotor gone = hardwareMap.get(DcMotor.class, "<script>alert(3)</script>");
    waitForStart();
    while (opModeIsActive()) {
      near.setPower(gamepad1.left_stick_y);
      gone.setPower(gamepad1.right_stick_y);
      arm.setPosition(gamepad1.a ? 1 : 0);
    }
  }
}`;

// the config: "near" differs only in case, "arm" is a motor, the module name is hostile too
const HOSTILE_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<Robot type="FirstInspires-FTC">
  <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">
    <LynxModule name="Hub <img src=y onerror=alert(4) " port="173">
      <goBILDA5202SeriesMotor name="arm" port="0" />
      <goBILDA5202SeriesMotor name="<SVG ONLOAD=ALERT(2) " port="1" />
      <Servo name="<b onclick=alert(5)" port="0" />
    </LynxModule>
  </LynxUsbDevice>
</Robot>`;

const TAG = /<\s*(img|svg|script|b\s+onclick)\b/i;

function findings() {
  const code = E.parseJava(HOSTILE_JAVA);
  const cad = JSON.parse(JSON.stringify(E.SAMPLE_CAD));
  cad.solids = E.sampleSolids();
  E.classifyMechs(cad.mechs);
  // a joint from the team's mates, named by them, that nothing drives
  cad.mechs[0].label = '<img src=z onerror=alert(6)>';
  cad.mechs[0].fromMate = true;
  if (cad.mechs[0].kind === 'fixed') cad.mechs[0].kind = 'revolute';
  const map = {};
  const F = E.analyze(code, cad, map, { payloadKg: 0.18, duty: 0.3, trust: 'code', robotConfig: E.parseRobotConfig(HOSTILE_XML) });
  return { code, F };
}

test('findings: a hostile hardwareMap, joint or config name comes out escaped', () => {
  const { code, F } = findings();
  assert.ok(code.devices.some((d) => /<img/.test(d.name) || /<img/.test(d.cfg || '')), 'the parser kept the hostile name');
  const keys = F.map((f) => f.key.replace(/:.*/, ''));
  for (const k of ['idle', 'cfgcase', 'cfgtype', 'cfgmiss', 'unmapped']) assert.ok(keys.includes(k), `a ${k} finding to check (got ${keys.join(', ')})`);
  for (const f of F) for (const part of ['title', 'body', 'fix']) {
    const html = f[part] || '';
    assert.ok(!TAG.test(html), `${f.key} ${part} carries a live tag: ${html}`);
  }
  const all = F.map((f) => [f.title, f.body, f.fix].join(' ')).join(' ');
  for (const shown of ['&lt;img src=x onerror=alert(1)&gt;', '&lt;svg onload=alert(2) ', '&lt;SVG ONLOAD=ALERT(2) ', '&lt;script&gt;alert(3)&lt;/script&gt;',
    'Hub &lt;img src=y onerror=alert(4) ', '&lt;img src=z onerror=alert(6)&gt;']) assert.ok(all.includes(shown), `the name is still shown, escaped: ${shown}`);
  assert.ok(F.some((f) => /<code>/.test(f.title)), 'the findings keep their own markup');
});

test('findings: the status light reads the escaped names back as plain text', () => {
  const { F } = findings();
  const s = E.statusOf(F, {});
  const texts = s.items.map((i) => i.text);
  assert.ok(texts.some((t) => t.includes('"<img src=x onerror=alert(1)>"') || t.includes('<img src=x onerror=alert(1)>')), texts.join(' | '));
  assert.ok(!texts.some((t) => /&lt;|&gt;|&quot;|&amp;/.test(t)), 'no entities left for the light to escape twice: ' + texts.join(' | '));
});
