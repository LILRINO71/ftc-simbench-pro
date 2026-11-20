// One table of vendor part weights: src/partsdb.js PARTS_G, each row read off the vendor's page.
// src/inertia.js weighs a numbered part by it, and its stand-in rows (a ratio or servo the table
// can't name exactly, a "104 mm mecanum" with no number) point at a part in it rather than carry a
// figure of their own. They used to disagree: a 312 rpm Yellow Jacket weighed 0.310 kg in the mass
// model and 0.437 kg on goBILDA's page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const box = (L, W, H) => {
  const out = [];
  for (const x of [-L / 2, L / 2]) for (const y of [-W / 2, W / 2]) for (const z of [-H / 2, H / 2]) out.push([x, y, z]);
  return out;
};
const cyl = (r, h) => {
  const out = [];
  for (let i = 0; i < 32; i++) { const t = i / 32 * 2 * Math.PI; out.push([r * Math.cos(t), r * Math.sin(t), -h / 2], [r * Math.cos(t), r * Math.sin(t), h / 2]); }
  return out;
};
const MOTOR = box(0.043, 0.043, 0.11), SERVO = box(0.041, 0.020, 0.040);

test('mass: a numbered part weighs what its vendor page says, from the one table', () => {
  const parts = [];
  for (const s of ['5202', '5203', '5204']) for (const c of ['0003', '0014', '0019', '0027', '0051', '0071', '0139', '0188']) parts.push([s + '-' + (s === '5204' ? '8002' : '2402') + '-' + c, 'motor', MOTOR]);
  parts.push(['5203-2402-0001', 'motor', MOTOR], ['REV-41-1291', 'motor', MOTOR]);
  parts.push(['2000-0025-0002', 'servo', SERVO], ['2000-0025-0003', 'servo', SERVO]);
  parts.push(['3625-0202-0104', 'wheel', cyl(0.052, 0.0475)], ['3614-0014-0096', 'wheel', cyl(0.048, 0.030)]);
  for (const [pn, kind, pts] of parts) {
    const want = E.partsLookup(pn);
    assert.ok(want && want.massKnown && want.massKg > 0, pn + ' has a page weight');
    const m = E.partMass({ name: pn + ' part', part: pn, kind, pts });
    assert.equal(m.how, 'vendor', pn + ' weighed as a known part');
    assert.equal(m.kg, want.massKg, pn + ' weighs its page weight');
    // the number only in the name, as a STEP export often has it
    assert.equal(E.partMass({ name: 'Drive ' + pn, kind, pts }).kg, want.massKg, pn + ' by name');
  }
  // goBILDA's own figures: 437 g for the 19.2:1, 60 g for the 25-2 Torque servo
  assert.equal(E.partMass({ part: '5203-2402-0019', kind: 'motor', pts: MOTOR }).kg, 0.437);
  assert.equal(E.partMass({ part: '2000-0025-0002', kind: 'servo', pts: SERVO }).kg, 0.060);
});

test('mass: a part the table cannot name exactly weighs as the catalogue part its row points at', () => {
  const like = (pn) => E.partsLookup(pn).massKg;
  assert.equal(E.partMass({ part: '5203-2402-0999', kind: 'motor', pts: MOTOR }).kg, like('5203-2402-0019'), 'a ratio the table lacks');
  assert.equal(E.partMass({ part: '2000-0025-0004', kind: 'servo', pts: SERVO }).kg, like('2000-0025-0002'), 'a servo with no page weight');
  assert.equal(E.partMass({ name: '104mm mecanum wheel', kind: 'wheel', pts: cyl(0.052, 0.0475) }).kg, like('3625-0202-0104'), 'a 104 mm mecanum by name');
  // and no goBILDA weight is written twice: the stand-in rows carry a part number, not a figure
  const src = fs.readFileSync(path.join(ROOT, 'src', 'inertia.js'), 'utf8');
  const rows = /const VENDOR_MASS = \[([\s\S]*?)\n\];/.exec(src)[1].split('\n').filter((l) => /\{re:/.test(l));
  for (const r of rows.filter((l) => /520|2000-0025|mecanum/.test(l))) assert.match(r, /like:"[\dA-Z-]+"/, 'a stand-in row: ' + r.trim());
  for (const r of rows.filter((l) => /like:/.test(l))) assert.doesNotMatch(r, /\bkg:/, 'a row with its own figure: ' + r.trim());
});

test('parts: the parts table reads the Yellow Jacket ratios, speeds and counts from the actuator table', () => {
  for (const c of ['0001', '0003', '0005', '0014', '0019', '0027', '0051', '0071', '0100', '0139', '0188']) {
    const p = E.partsLookup('5203-2402-' + c), h = E.hwFromPart('5203-2402-' + c, '');
    assert.equal(p.ratio, h.ratio, c + ' ratio'); assert.equal(p.rpm, h.rpm, c + ' rpm'); assert.equal(p.tpr, h.tpr, c + ' counts');
  }
  const s = E.partsLookup('2000-0025-0003');
  assert.equal(s.kind, 'servo'); assert.match(s.name, /25-3 Speed/);
});
