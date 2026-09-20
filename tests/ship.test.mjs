// The ship build has to behave exactly like the readable one. These tests run
// the engine twice — as written, and after the minifier — and compare results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineBundle, loadEngine, loadWithField } from './load.mjs';
import { minifyJS, minifyCSS, minifyHTML, tokenize } from '../tools/minify.mjs';

const run = (src) => new Function(`"use strict";return (${src})`)();

test('minifier: the awkward corners of JS survive', () => {
  const cases = [
    ['regex vs division', '(() => { const a = 4, b = 2; const r = /a\\/b/; return (a / b) + (r.test("a/b") ? 1 : 0); })()', 3],
    ['regex after return', '(() => { const f = () => { return /x[/]y/.source.length }; return f(); })()', 5],
    ['template with nested braces', '(() => { const o = {x: 2}; return `a${ `b${ o.x + 1 }` }c`; })()', 'ab3c'],
    ['comment-looking string', '(() => "not // a comment /* either */")()', 'not // a comment /* either */'],
    ['ASI: return on its own line', '(function () {\n  const g = function () {\n    return\n    5\n  };\n  return g();\n})()', undefined],
    ['ASI: line starting with (', '(function () {\n  let a = 1\n  const b = 2\n  ;(function(){ a = b })()\n  return a\n})()', 2],
    ['division after )', '(() => { const f = () => 8; return f() / 2 / 2; })()', 2],
    ['increment spacing', '(() => { let a = 1, b = 1; return a + + b; })()', 2],
    ['keyword then regex', '(() => typeof /x/ )()', 'object'],
    // a blank line inside a template literal is content: the sample OpModes are template literals
    ['blank line in a template', '(function () {\n  const java = `a;\n\nb;`\n  return java\n})()', 'a;\n\nb;'],
    ['indentation in a template', '(() => `x\n    y`)()', 'x\n    y'],
  ];
  for (const [what, src, want] of cases) {
    const min = minifyJS(src);
    assert.deepEqual(run(min), want, `${what}: minified to ${min}`);
    // whitespace inside a template literal is content, so only check the rest
    if (!src.includes('`')) assert.ok(!/\n\s+/.test(min), `${what}: indentation left behind`);
  }
});

test('minifier: comments go, code does not', () => {
  const src = '// header\nconst a = 1; /* inline */ const b = 2;\n// trailing\nconst c = `x /* not a comment */ y`;\n';
  const min = minifyJS(src);
  assert.ok(!min.includes('header') && !min.includes('inline') && !min.includes('trailing'));
  assert.ok(min.includes('/* not a comment */'), 'a comment inside a template literal is content');
  assert.equal(tokenize(src).filter((t) => t.t === 'bc' || t.t === 'lc').length, 3);
});

/* A fingerprint of what the engine actually computes. If the minifier changed
   meaning anywhere in this path, one of these numbers moves. */
function digest(E) {
  const d = {};
  const cube = [];
  for (let i = 0; i < 8; i++) cube.push([i & 1, i & 2 ? 1 : 0, i & 4 ? 1 : 0]);
  d.hull = E.convexHull(cube).faces.length;
  d.kinds = ['5203 Series Yellow Jacket', 'M4 x 12 mm SHCS', 'goBILDA 104mm Mecanum Wheel'].map((n) => E.solidKind(n, null));
  const code = E.parseJava(E.SHOOTER_JAVA);
  d.devices = code.devices.map((x) => x.name).sort();
  d.bindings = (code.bindings || []).length;
  const cad = JSON.parse(JSON.stringify(E.SAMPLE_CAD));
  cad.solids = E.sampleSolids();          // the app boots with these; mass and drivetrain need them
  E.classifyMechs(cad.mechs);
  const map = E.autoMap(code.devices, cad.mechs);
  d.findings = E.analyze(code, cad, map, { payloadKg: 0.18, duty: 0.3, trust: 'code' }).map((f) => f.key + ':' + f.sev);
  d.pads = [E.busiestPad(code), E.padFor(code, 'left_stick_y', 2)];
  const rng = E.makeRng(7);
  d.rng = [rng(), rng(), rng()].map((x) => x.toFixed(9));
  if (E.Field && E.Field.ok) {
    // same wake-up sequence the app uses: the shot config comes from the code
    E.Shots.cfg = null;
    E.Sim.reset(code, cad, map, { payloadKg: 0.18, duty: 0.3, trust: 'code' });
    E.Shots.reset();
    E.Shots.alliance = 'red';
    E.Shots.adopt(code);
    const r = E.Field.E.evaluate(E.Shots.params({ x: -40 * E.IN, y: -30 * E.IN, h: 0 }), 'coarse');
    d.verdict = r.verdict;
    d.hitRate = +r.hitRate.toFixed(6);
  }
  if (E.massProps) { const m = E.massProps(cad, {}); d.mass = +m.kg.toFixed(6); d.izz = +m.Izz.toFixed(6); }
  if (E.driveFromCAD) { const dr = E.driveFromCAD(cad); d.drive = dr.kind + '/' + dr.wheels.length; }
  if (E.packSession) d.session = E.packSession(E.sessionFromBench({ cad, code, java: E.SHOOTER_JAVA, map, opts: {}, chassis: { x: 0.1, y: 0.2, h: 0.3 }, savedISO: '2026-01-01T00:00:00.000Z' })).length;
  if (E.mathReport) d.math = E.mathText(E.mathReport({ cad, code, map, opts: {} })).length;
  return d;
}

test('ship build: the minified engine computes exactly what the readable one does', () => {
  const src = engineBundle();
  const plain = digest(loadWithField(src));
  const min = minifyJS(src);
  assert.ok(min.length < src.length * 0.75, `only shrank to ${(min.length / src.length * 100).toFixed(0)} %`);
  assert.deepEqual(digest(loadWithField(min)), plain);
});

test('ship build: the string-table pass is still the same engine', () => {
  const src = engineBundle();
  const plain = digest(loadWithField(src));
  const hidden = minifyJS(src, { strings: true });
  assert.ok(!hidden.includes('Yellow Jacket'), 'string literals are in the table, not in the open');
  assert.deepEqual(digest(loadWithField(hidden)), plain);
});

test('minifier: CSS keeps what CSS needs', () => {
  const css = '/* c */\n.a {\n  width: calc(100% - 10px);\n  color: red;\n}\n.b::after { content: " "; }\n';
  const m = minifyCSS(css);
  assert.ok(!m.includes('/*'));
  assert.ok(m.includes('calc(100% - 10px)'), 'calc() spacing is load-bearing');
  assert.ok(m.includes('.b::after{content:" "}'));
  assert.ok(m.length < css.length * 0.8);
});

test('minifier: HTML keeps pre and textarea content', () => {
  const html = '<!-- gone -->\n<div>\n  <span>a</span>\n  <pre id="x">  keep\n   me  </pre>\n  <textarea>  spaces  </textarea>\n</div>';
  const m = minifyHTML(html);
  assert.ok(!m.includes('gone'));
  assert.ok(m.includes('<div><span>a</span>'), 'inter-tag whitespace collapses');
  assert.ok(m.includes('<pre id="x">  keep\n   me  </pre>'));
  assert.ok(m.includes('<textarea>  spaces  </textarea>'));
});
