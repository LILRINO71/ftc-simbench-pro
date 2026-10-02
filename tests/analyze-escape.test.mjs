// Findings are shown as HTML, and their text quotes names from the team's own
// files: joint names from Onshape mates or STEP subassemblies, device names
// from the Java. A name with HTML in it must show as text, never run: the page
// now holds the team's Onshape sign-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const EVIL = '<img src=x onerror=alert(document.domain)>';

test('findings escape joint names from the CAD and device names from the code', () => {
  const java = E.SAMPLE_JAVA.replace(/hardwareMap\.get\(DcMotor\.class,\s*"([^"]+)"\)/, (m, n) => m.replace(n, n + '<b onmouseover=x>'));
  const code = E.parseJava(java);
  const cad = JSON.parse(JSON.stringify(E.SAMPLE_CAD));
  cad.points = E.synthGeometry(); cad.solids = E.sampleSolids();
  E.classifyMechs(cad.mechs);
  cad.mechs.forEach((m) => { m.label = EVIL; });
  const map = E.autoMap(code.devices, cad.mechs, { cad });
  for (const k in map) map[k] = null;   // nothing mapped: "has nothing driving it"
  cad.mechs.forEach((m) => { m.hasActuator = true; if (m.kind === 'fixed') m.kind = 'revolute-lift'; });
  const F = E.analyze(code, cad, map, { payloadKg: 0.18, duty: 0.3, trust: 'code', front: '+x' });
  const named = F.filter((f) => /&lt;img/.test(f.title + f.body));
  assert.ok(named.length, 'a finding quotes the joint name');
  for (const f of F) for (const t of [f.title, f.body, f.fix]) {
    if (t == null) continue;
    assert.ok(!/<img|<b /.test(t), f.key + ': ' + t);
  }
});

test('findings keep their own formatting', () => {
  assert.equal(E.findingHTML('Set <code>left_stick_y</code> &mdash; <b>now</b><br>'), 'Set <code>left_stick_y</code> &mdash; <b>now</b><br>');
  assert.equal(E.findingHTML('<b class=x>a</b> & <script>'), '&lt;b class=x&gt;a</b> &amp; &lt;script&gt;');
  assert.equal(E.findingHTML(null), null);
});
