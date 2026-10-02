// Copy and paste from Onshape: the way that works on school computers and
// school (Enterprise) Onshape accounts, with no app, no bookmark and no API
// limit. The team opens their assembly's own pages of text in a signed-in
// tab and pastes them; the joints go onto the STEP they exported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';
import { buildRobot } from '../tools/stepgen.mjs';

const E = loadEngine();
const R = buildRobot('mated');
const LINK = 'https://puhsd.onshape.com/documents/' + 'a'.repeat(24) + '/w/' + 'b'.repeat(24) + '/e/' + 'c'.repeat(24);
// what Chrome's JSON viewer gives for Ctrl+A, Ctrl+C: its "Pretty-print" line, then the text
const copied = (json) => 'Pretty-print\n' + JSON.stringify(json, null, 2) + '\n';

test('a pasted page is read as Chrome copies it, and a wrong paste says what to do', () => {
  const a = E.readOnshapePaste(copied(R.onshape.assembly));
  assert.equal(a.kind, 'assembly');
  assert.equal(a.mates, [R.onshape.assembly.rootAssembly].concat(R.onshape.assembly.subAssemblies).reduce((n, d) => n + d.features.filter((f) => f.featureType === 'mate').length, 0));
  assert.equal(E.readOnshapePaste(copied(R.onshape.featuresSplit.root)).kind, 'features');
  assert.throws(() => E.readOnshapePaste(''), /nothing was pasted/);
  assert.throws(() => E.readOnshapePaste('<!doctype html><html><body>Sign in</body></html>'), /Sign in to Onshape/);
  assert.throws(() => E.readOnshapePaste(copied(R.onshape.assembly).slice(0, 500)), /only part of the page/);
  assert.throws(() => E.readOnshapePaste(copied({ message: 'Resource does not exist, or you do not have permission to access it.', status: 403 })), /Sign in to Onshape in this browser/);
  assert.throws(() => E.readOnshapePaste(copied({ message: 'Not found', status: 404 })), /Assembly tab, not a Part Studio/);
  assert.throws(() => E.readOnshapePaste('just some words'), /isn't the page of text/);
});

test('the limits pages: the main assembly and each subassembly with mates, on the team\'s own Onshape host', () => {
  const L = E.onshapeLimitLinks(R.onshape.assembly, LINK);
  assert.equal(L[0].key, '');
  assert.ok(L[0].url.startsWith('https://puhsd.onshape.com/api/assemblies/d/' + 'a'.repeat(24) + '/w/'));
  const subs = L.slice(1);
  assert.deepEqual(subs.map((x) => x.key).sort(), Object.keys(R.onshape.featuresSplit.by).sort());
  for (const x of subs) {
    assert.match(x.url, /^https:\/\/puhsd\.onshape\.com\/api\/assemblies\/d\/DOC\/m\/MV\/e\/E\d+\/features\?configuration=default&linkDocumentId=a{24}$/);
    assert.ok(x.name && !/<\d+>/.test(x.name), x.name);
  }
  assert.deepEqual(E.onshapeLimitLinks(R.onshape.assembly, 'not a link'), []);
});

test('pasted joints and each page of limits go onto the exported STEP: every joint, every stop', () => {
  const cad = E.parseSTEP(R.text);
  const asm = E.readOnshapePaste(copied(R.onshape.assembly)).json;
  const featuresBy = {};
  for (const x of E.onshapeLimitLinks(asm, LINK).slice(1)) featuresBy[x.key] = E.readOnshapePaste(copied(R.onshape.featuresSplit.by[x.key])).json;
  const rep = E.applyOnshapeMates(cad, asm, { features: E.readOnshapePaste(copied(R.onshape.featuresSplit.root)).json, featuresBy });
  assert.equal(rep.joints, R.truth.joints.length);
  // each joint's stops, from the page its mate lives on: the main assembly's (Arm Pivot) and each subassembly's
  for (const [id, lo, hi] of [['Lift Stage', 0, 0.28], ['Lift Carriage', 0, 0.27], ['Arm Pivot', -Math.PI / 2, 2.1], ['Claw', 0, 1.2]]) {
    const m = cad.mechs.find((x) => x.id === id);
    assert.ok(m && m.limits, id + ' has its limits');
    assert.ok(Math.abs(m.limits[0] - lo) < 1e-6 && Math.abs(m.limits[1] - hi) < 1e-6, id + ' ' + JSON.stringify(m.limits));
  }
});
