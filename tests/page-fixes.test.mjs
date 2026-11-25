// Two of PR #12's page fixes that the page's redesign lost: an unreadable
// OpMode threw (a call to a function that was gone), and on a phone the
// pop-overs and the CAD view's tree ran off the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = (f) => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('picking an OpMode that cannot be read calls only functions the page has', () => {
  const all = fs.readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js')).map(src).join('\n');
  const app = src('app.js');
  const at = app.indexOf('function selectOpMode(');
  const fn = app.slice(at, app.indexOf('\n}\n', at) + 3);
  const nothing = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : nothing()), apply: () => nothing(), set: () => true });
  const box = { entry: () => ({ id: 'x', file: 'Broken.java', source: '', error: 'unreadable' }), Online: { playing: () => false, inMatch: () => false } };
  // a stand-in for every name the page declares, and only those
  for (const m of all.matchAll(/^(?:async )?(?:function\*? |const |let |var )([A-Za-z_$][\w$]*)/gm)) if (!(m[1] in box) && m[1] !== 'selectOpMode') box[m[1]] = nothing();
  box.$ = nothing();
  box.$$ = () => [];
  vm.createContext(box);
  assert.doesNotThrow(() => vm.runInContext(fn + '\nselectOpMode("x");', box));
});

test('on a phone the status and match pop-overs and the CAD tree stay on the screen', () => {
  const css = src('styles.css');
  assert.match(css, /@media \(max-width:760px\)\{\s*#statusPanel,#matchMenu\{position:fixed; left:12px; right:12px;/);
  assert.match(css, /@media \(max-width:520px\)\{\s*\.cad-tree\{left:var\(--gap\); right:var\(--gap\); width:auto;/);
});
