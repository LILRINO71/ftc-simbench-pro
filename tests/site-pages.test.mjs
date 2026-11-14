// The support, privacy and terms pages an Onshape App Store listing links to: built into dist,
// linked from the app's menu, and each linking to the others. The privacy page has to say what
// the Onshape relay really keeps (functions/onshape): a store reviewer reads both.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['support', 'privacy', 'terms'];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('site pages: each is a whole page that links to the other two and to the app', () => {
  for (const p of PAGES) {
    const h = read('site/' + p + '.html');
    assert.match(h, /^<!doctype html>/i, p);
    assert.match(h, /<meta name="viewport"/, p);
    assert.match(h, /href="\/"/, p + ' links home');
    for (const q of PAGES) assert.ok(h.includes('href="/' + q + '"'), p + ' links to ' + q);
    assert.match(h, /Last updated \d{1,2} \w+ \d{4}/, p + ' is dated');
  }
});

test('site pages: the build copies them, and the app menu links to them', () => {
  assert.match(read('tools/build.mjs'), /copyDir\(path\.join\(ROOT, 'site'\), DIST\)/);
  const m = read('src/markup.html');
  for (const p of PAGES) assert.ok(m.includes('href="/' + p + '"'), 'menu links to ' + p);
});

test('privacy: says what the Onshape relay keeps, as the relay keeps it', () => {
  const relay = read('functions/onshape/[[path]].js'), h = read('site/privacy.html');
  // read-only scope, and a cookie of 30 days
  assert.match(relay, /60 \* 60 \* 24 \* 30\)\);/);
  assert.match(h, /up to 30 days, sent only to <code>\/onshape\/<\/code>/);
  // part shapes at a version are cached 30 days, at a microversion 7: the page says both
  assert.match(relay, /\/\\\/v\\\/\/\.test\(path\) \? 60 \* 60 \* 24 \* 30 : 60 \* 60 \* 24 \* 7/);
  assert.match(h, /up to 30 days \(7 days for an unnamed microversion\)/);
  // and a kept copy goes only to an account Onshape says can open the document
  assert.match(relay, /ask\("documents\/" \+ did\)/);
  assert.match(h, /only ever given to someone whose own Onshape account can open that document/);
});
