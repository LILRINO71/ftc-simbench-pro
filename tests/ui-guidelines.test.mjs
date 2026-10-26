// The page markup follows the Web Interface Guidelines where a check can see it:
// a skip link and one h1, every form control labelled, Driver Station buttons
// that can never submit a form, and a theme colour for each colour scheme.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'src/markup.html'), 'utf8');
const build = fs.readFileSync(path.join(ROOT, 'tools/build.mjs'), 'utf8');

test('a skip link leads to the field, and the page has one h1', () => {
  assert.match(html, /<a class="skip-link" href="#stage">/);
  assert.match(html, /<main[^>]*id="stage"/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
});

test('every visible input, select and textarea has a label', () => {
  const labelled = new Set([...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]));
  // a control inside a <label> is labelled by it: blank out every label's contents first
  const open = html.replace(/<label\b[\s\S]*?<\/label>/g, '');
  const bad = [];
  for (const m of open.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const a = m[2];
    if (/\bhidden\b/.test(a) || /type="(hidden|file)"/.test(a)) continue;
    const id = (a.match(/\bid="([^"]+)"/) || [])[1];
    if (/aria-label=/.test(a) || (id && labelled.has(id))) continue;
    bad.push(id || m[0]);
  }
  assert.deepEqual(bad, []);
});

test('the Driver Station buttons are type="button"', () => {
  for (const id of ['btnInit', 'btnStart', 'btnStop']) assert.match(html, new RegExp(`id="${id}" type="button"`));
});

test('placeholders end with an ellipsis', () => {
  const bad = [...html.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]).filter((p) => !p.endsWith('…'));
  assert.deepEqual(bad, []);
});

test('the theme colour follows the colour scheme', () => {
  assert.match(build, /theme-color" content="#F5F5F7" media="\(prefers-color-scheme: light\)"/);
  assert.match(build, /theme-color" content="#000000" media="\(prefers-color-scheme: dark\)"/);
});
