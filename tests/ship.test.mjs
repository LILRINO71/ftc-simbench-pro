// The ship build has to behave exactly like the readable one. These tests run
// the engine twice — as written, and after the minifier — and compare results.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineBundle, loadEngine, loadWithField } from './load.mjs';
import { minifyJS, minifyCSS, minifyHTML, tokenize } from '../tools/minify.mjs';

const run = (src) => new Function(`"use strict";return (${src})`)();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/* A ${…} in a template is code: a quote inside a regex there (/can't/, /'/g)
   is not a string. The old scanner took it for one, ran the template on past
   its end, and then lexed the next template's text as code, where '//' is a
   comment, so the rest of the line was cut off. */
test('minifier: a regex inside ${} is a regex, not the start of a string', () => {
  const cases = [
    ["quote in a regex, then a '}' string and a template with //",
      "(() => { const x = \"a'b\"; const s = `${x.replace(/'/g, \"\")}`; const t = '}'; return s + t + `://keep`; })()", "ab}://keep"],
    ["the app's /Check|can't|\"O\"/", "(() => { const t = \"can't\"; return `<p${/Check|can't|\"O\"/.test(t) ? ' w' : ''}>` + `//x`; })()", "<p w>//x"],
    ['a comment inside ${}', '(() => `a${ 1 /* } */ + 1 }b` + `//c`)()', 'a2b//c'],
  ];
  for (const [what, src, want] of cases) {
    assert.equal(run(src), want, `${what}: the case itself`);
    const min = minifyJS(src);
    assert.equal(run(min), want, `${what}: minified to ${min}`);
  }
  // src/app.js has the /Check|can't|"O"/ regex; everything after it must still be minified
  const app = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  const min = minifyJS(app);
  assert.ok(!min.includes('MAIN LOOP') && !min.includes('PRO — one status light'), 'app.js comments after the regex survive the minifier');
  const longest = Math.max(...tokenize(app).filter((t) => t.t === 'tmpl').map((t) => t.v.length));
  assert.ok(longest < 10000, `a ${longest}-character template literal in app.js: the scanner ran past one's end`);
  assert.doesNotThrow(() => new Function(min), 'minified app.js compiles');
});

/* A comment and the whitespace around it are one gap. The old pass looked at
   each whitespace run alone: the space before `// c` became a space, and the
   newline after it was then dropped because the previous kept token was that
   space, not the code before it. */
test('minifier: the newline after a same-line comment is kept where ASI needs it', () => {
  const cases = [
    ['return // c', '(function () {\n  return // c\n  5\n})()', undefined],
    ['let after a comment', '(function () {\n  let a = 1\n  let b = a // c\n  let d = 2\n  return b + d\n})()', 3],
    ['a block comment with a line break', '(function () {\n  return /* a\n b */ 5\n})()', undefined],
    ['a comment between two words', '(() => typeof/**/1)()', 'number'],
  ];
  for (const [what, src, want] of cases) {
    assert.deepEqual(run(src), want, `${what}: the case itself`);
    const min = minifyJS(src);
    let got; assert.doesNotThrow(() => { got = run(min); }, `${what}: minified to ${min}`);
    assert.deepEqual(got, want, `${what}: minified to ${min}`);
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

/* The bundle starts with "use strict";. The string pass used to hide that in
   the table and put its prelude first, so a --strings build ran sloppy. */
test('string table: a leading "use strict" stays a directive', () => {
  const src = '"use strict";\n// a comment\nreturn [(function () { return this === undefined; })(), "some string"];';
  const h = minifyJS(src, { strings: true });
  assert.ok(h.startsWith('"use strict";'), `the directive comes first: ${h.slice(0, 40)}`);
  assert.ok(!h.includes('"some string"'), 'the other strings are still in the table');
  assert.deepEqual(new Function(h)(), [true, 'some string'], 'strict mode holds');
  assert.throws(() => new Function(minifyJS('"use strict";\nundeclaredName = 1;', { strings: true }))(), ReferenceError);
  assert.ok(minifyJS(engineBundle(), { strings: true }).startsWith('"use strict";'), 'the engine bundle keeps its directive');
});

test('string table: a string before a ternary or case colon is hidden; an object key is not', () => {
  const src = 'function f(x){ const o = {\n "alpha": 1, "beta" : 2 }; switch(x){ case "gamma": return x ? "delta" : o["alpha"]; } return "epsilon"; }\nreturn f;';
  const h = minifyJS(src, { strings: true });
  for (const hidden of ['gamma', 'delta', 'epsilon']) assert.ok(!h.includes('"' + hidden + '"'), hidden + ' is in the table');
  assert.ok(h.includes('"alpha":') && h.includes('"beta":'), 'object keys stay');
  const f = new Function(h)();
  assert.equal(f('gamma'), 'delta');
  assert.equal(f(''), 'epsilon');
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
