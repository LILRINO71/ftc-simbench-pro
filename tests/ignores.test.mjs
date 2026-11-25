// "Ignore" on a finding in the Checks tab (Ignores and renderFindings in src/app.js). A finding's
// key names the check (drive:feel), not the robot or OpMode it was judged on. The ignore list was
// one global set of keys, so ignoring a check on one OpMode hid the same check FAILING on another
// OpMode, or on a robot loaded later (audit F2). app.js needs a DOM, so the two pieces are read out
// of its source and run against stand-ins, with real findings from analyze().
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWithField } from './load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
const E = loadWithField();

const slice = (from, to, what) => {
  const a = APP.indexOf(from); assert.ok(a >= 0, `${what} is still in src/app.js`);
  const z = APP.indexOf(to, a); assert.ok(z > a, `${what} ends where expected`);
  return APP.slice(a, z + to.length);
};
// the ignore store, its two scope helpers, and the Checks tab's renderer
const IGNORE_SRC = slice('const Ignores={', '\nfunction ignoreOp(){', 'Ignores') + APP.slice(APP.indexOf('\nfunction ignoreOp(){') + 21).split('\n')[0] + '\n';
const RENDER_SRC = slice('function renderFindings(){', '\n}\n', 'renderFindings');

/* The page, stood in for: $ hands out one fake element per selector; $$("[data-ig]") gives the
   buttons the last render wrote, each with the listener the page put on it. */
function page(stored = '{}') {
  const els = {}, buttons = [];
  const el = (sel) => els[sel] || (els[sel] = { innerHTML: '', textContent: '', className: '', addEventListener() {} });
  const $ = (sel) => (sel === '#clearIgnored' ? (/id="clearIgnored"/.test(el('#ignoredWrap').innerHTML) ? button('clear', '') : null) : el(sel));
  const button = (attr, val) => { const b = { dataset: { [attr]: val }, on: null, addEventListener(t, f) { b.on = f; } }; buttons.push(b); return b; };
  const $$ = (sel) => {
    const attr = /^\[data-(\w+)\]$/.exec(sel)[1];
    const html = el('#findings').innerHTML + el('#ignoredWrap').innerHTML;
    return [...html.matchAll(new RegExp(`data-${attr}="([^"]*)"`, 'g'))].map((m) => button(attr, m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')));
  };
  const mem = { 'ftcbench.ignored': stored };
  const store = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const P = new Function('$', '$$', 'esc', 'store', 'saveRig', `
    let CAD=null, CODE=null, FINDINGS=[];
    ${IGNORE_SRC}
    ${RENDER_SRC}
    return { set(cad, code, findings){ CAD=cad; CODE=code; FINDINGS=findings; renderFindings(); }, Ignores, ign: () => IGNORED, setIgn(m){ IGNORED=m; } };`)($, $$, esc, store, () => {});
  const count = (k) => +(/<div class="s-fail"><div class="k">(\d+)<\/div>/.exec(el('#score').innerHTML) || [])[1];
  const click = (attr, key) => { const b = buttons.filter((x) => x.dataset[attr] === key && x.on).pop(); assert.ok(b, `a ${attr} button for ${key}`); b.on(); };
  return { P, el, fails: count, click, mem, hiddenCount: () => (el('#ignoredWrap').innerHTML.match(/class="ign-row"/g) || []).length };
}

// the audit's pair: the sample robot with the shooter TeleOp (drives as it should) and the same
// OpMode with its two REVERSE lines taken out, as a second OpMode (the sticks spin the robot)
function bench(java, cls) {
  const cad = JSON.parse(JSON.stringify(E.SAMPLE_CAD)); cad.solids = E.sampleSolids(); E.classifyMechs(cad.mechs);
  const code = E.parseJava(java); code.cls = cls;
  const map = E.autoMap(code.devices, cad.mechs);
  return { cad, code, findings: E.analyze(code, cad, map, { payloadKg: 0.18, duty: 0.3, trust: 'code' }) };
}
const A = bench(E.SHOOTER_JAVA, 'ShooterTeleOp');
const B = bench(E.SHOOTER_JAVA.replace(/\n\s*left(Front|Back)\.setDirection\(DcMotor\.Direction\.REVERSE\);/g, ''), 'ReversedTeleOp');
const sevOf = (b, key) => (b.findings.find((f) => f.key === key) || {}).sev;

test('the case itself: drive:feel passes on OpMode A and fails on OpMode B', () => {
  assert.equal(sevOf(A, 'drive:feel'), 'pass');
  assert.equal(sevOf(B, 'drive:feel'), 'fail');
  assert.ok(B.findings.filter((f) => f.sev === 'fail').length >= 1);
});

test('an ignore given on OpMode A does not hide the same check failing on OpMode B', () => {
  const p = page();
  p.P.set(A.cad, A.code, A.findings);
  p.click('ig', 'drive:feel');
  assert.equal(p.hiddenCount(), 1, 'hidden on A, where it was ignored');
  const want = B.findings.filter((f) => f.sev === 'fail').length;
  p.P.set(B.cad, B.code, B.findings);
  assert.equal(p.fails(), want, "OpMode B's WON'T WORK count");
  assert.equal(p.hiddenCount(), 0, 'nothing ignored on B');
  // back on A it is still ignored, and it survives a reload of the page
  p.P.set(A.cad, A.code, A.findings);
  assert.equal(p.hiddenCount(), 1);
  const again = page(p.mem['ftcbench.ignored']);
  again.P.set(A.cad, A.code, A.findings);
  assert.equal(again.hiddenCount(), 1, 'kept in the browser');
});

test('an ignore given on one robot does not hide anything on a robot loaded later', () => {
  const p = page();
  p.P.set(B.cad, B.code, B.findings);
  const want = p.fails();
  p.click('ig', 'drive:feel');
  assert.equal(p.fails(), want - 1, 'ignored where it was given');
  const other = { ...B.cad, name: 'another-robot.step' };
  p.P.set(other, B.code, B.findings);
  assert.equal(p.fails(), want, 'the same OpMode on another robot');
});

test('an ignore never hides a worse finding than the one it was given on', () => {
  const { Ignores } = page().P;
  const m = {};
  Ignores.add(m, 'r', 'op', { key: 'k', sev: 'warn' });
  assert.equal(Ignores.hides(m, 'r', 'op', { key: 'k', sev: 'warn' }), true);
  assert.equal(Ignores.hides(m, 'r', 'op', { key: 'k', sev: 'pass' }), true, 'milder: still hidden');
  assert.equal(Ignores.hides(m, 'r', 'op', { key: 'k', sev: 'fail' }), false, "RISKY ignored, now WON'T WORK: shown");
  Ignores.add(m, 'r', 'op', { key: 'k', sev: 'fail' });
  assert.equal(Ignores.hides(m, 'r', 'op', { key: 'k', sev: 'fail' }), true, "an ignored WON'T WORK stays ignored there");
  assert.equal(Ignores.hides(m, 'r', 'op2', { key: 'k', sev: 'pass' }), false, 'another OpMode');
  assert.equal(Ignores.hides(m, 'r2', 'op', { key: 'k', sev: 'pass' }), false, 'another robot');
});

test('old ignores (a bare check name, for no robot or OpMode) are dropped, malformed ones too', () => {
  const p = page(JSON.stringify({ 'drive:feel': 1, 'stall:arm': 1 }));
  p.P.set(B.cad, B.code, B.findings);
  assert.equal(p.fails(), B.findings.filter((f) => f.sev === 'fail').length, 'an old global ignore hides nothing');
  assert.deepEqual(p.P.ign(), {});
  const { Ignores } = p.P;
  const good = Ignores.id('r', 'op', 'k');
  for (const raw of ['not json', '[]', 'null', '"x"', JSON.stringify({ [good]: 'sometimes', '["a","b"]': 'fail', '[1,2,3]': 'fail' })]) assert.deepEqual(Ignores.load(raw), {}, raw);
  assert.deepEqual(Ignores.load(JSON.stringify({ [good]: 'warn' })), { [good]: 'warn' });
});

test("a robot's rig carries its own ignores, scoped, and replaces only that robot's", () => {
  const { Ignores } = page().P;
  const m = {};
  Ignores.add(m, 'R1', 'T/TeleOp', { key: 'drive:feel', sev: 'pass' });
  Ignores.add(m, 'R1', 'A/Auto', { key: 'stall:arm', sev: 'warn' });
  Ignores.add(m, 'R2', 'T/TeleOp', { key: 'drive:feel', sev: 'fail' });
  const rig = Ignores.forRig(m, 'R1');
  assert.equal(rig.length, 2);
  assert.ok(rig.every((s) => typeof s === 'string' && s.length < 512), 'strings, as the .ftcsim reader takes them');
  // the workspace format keeps them as they are
  const sess = E.sessionFromBench({ cad: A.cad, code: A.code, java: E.SHOOTER_JAVA, map: {}, opts: {}, rig: { format: 'ftc-sim-bench.rig', version: 1, ignored: rig }, chassis: { x: 0, y: 0, h: 0 }, savedISO: '2026-01-01T00:00:00.000Z' });
  const back = E.unpackSession(E.packSession(sess));
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.session.rig.ignored, rig);
  // opened on another computer: only R1's are replaced, an old-form string is dropped
  const there = {};
  Ignores.add(there, 'R1', 'T/TeleOp', { key: 'old', sev: 'warn' });
  Ignores.add(there, 'R3', 'X/X', { key: 'keep', sev: 'warn' });
  Ignores.fromRig(there, 'R1', rig.concat(['drive:feel', '["x"]']));
  assert.equal(Ignores.hides(there, 'R1', 'T/TeleOp', { key: 'drive:feel', sev: 'pass' }), true);
  assert.equal(Ignores.hides(there, 'R1', 'A/Auto', { key: 'stall:arm', sev: 'warn' }), true);
  assert.equal(Ignores.hides(there, 'R1', 'T/TeleOp', { key: 'old', sev: 'warn' }), false, "R1's earlier ones are replaced");
  assert.equal(Ignores.hides(there, 'R3', 'X/X', { key: 'keep', sev: 'warn' }), true, 'other robots keep theirs');
  assert.equal(Object.keys(there).length, 3);
});

test('"Restore all" restores this robot and OpMode\'s ignores only', () => {
  const p = page();
  p.P.set(B.cad, B.code, B.findings);
  p.click('ig', 'drive:feel');
  p.P.set(A.cad, A.code, A.findings);
  p.click('ig', 'drive:feel');
  assert.equal(p.hiddenCount(), 1);
  p.click('clear', '');
  assert.equal(p.hiddenCount(), 0);
  p.P.set(B.cad, B.code, B.findings);
  assert.equal(p.hiddenCount(), 1, "B's ignore is still there");
});
