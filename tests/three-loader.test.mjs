// The page's three.js loader (tools/threeloader.mjs): three.js 0.186 ships only as ES
// modules, so the page serves its own copy first and falls back to two CDNs. One blocked
// source (a school filter, an outage, a missing file) must not leave the page blank.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, ADDONS, threeLoaderScript, importMap, VENDOR_THREE } from '../tools/threeloader.mjs';

const V = '0.186.1';
const LOCAL = 'https://site.test/' + VENDOR_THREE(V);
const fakeThree = { WebGLRenderer: function () {} };
const fakeAddon = (u) => Object.fromEntries(ADDONS.map(([k]) => [k, u.includes(k) ? { k, u } : undefined]));
const isCore = (u) => u === 'three' || /three\.module\.js$|esm\.sh\/three@[\d.]+$/.test(u);
/* an import() that fails for every URL `down` matches; the log keeps what was asked for */
const importer = (down, log) => async (u) => {
  if (log) log.push(u);
  if (down && down.test(u)) throw new TypeError('Failed to fetch dynamically imported module: ' + u);
  return isCore(u) ? fakeThree : fakeAddon(u);
};

test('three loader: the site\'s own copy first, with every add-on, and no CDN asked', async () => {
  const log = [];
  const r = await loadThree(importer(null, log), V, ADDONS, LOCAL);
  assert.equal(r.from, 'site');
  assert.equal(r.THREE, fakeThree);
  assert.deepEqual(Object.keys(r.addons).sort(), ADDONS.map(([k]) => k).sort());
  assert.ok(r.addons.GTAOPass.u.startsWith(LOCAL + 'examples/jsm/'));
  assert.ok(!log.some((u) => /jsdelivr|esm\.sh/.test(u)), 'a working local copy must not touch a CDN');
});

test('three loader: the site\'s copy missing, so jsDelivr (core) and then esm.sh (all of it) answer', async () => {
  // jsDelivr's add-ons import "three", which the import map points at the missing local copy: they fail, esm.sh has them all
  const r = await loadThree(importer(/^three$|site\.test|jsdelivr\.net\/npm\/three@[\d.]+\/examples/), V, ADDONS, LOCAL);
  assert.equal(r.from, 'esm.sh');
  for (const [k] of ADDONS) assert.ok(r.addons[k].u.startsWith('https://esm.sh/three@' + V + '/'), k);
});

test('three loader: only jsDelivr answers, and its core is used without add-ons rather than not at all', async () => {
  const r = await loadThree(importer(/^three$|site\.test|esm\.sh|jsdelivr\.net\/npm\/three@[\d.]+\/examples/), V, ADDONS, LOCAL);
  assert.equal(r.from, 'jsdelivr');
  assert.deepEqual(r.addons, {});
});

test('three loader: with no local copy given it starts at jsDelivr, then esm.sh', async () => {
  const r = await loadThree(importer(null), V, ADDONS);
  assert.equal(r.from, 'jsdelivr');
  assert.ok(r.addons.GTAOPass.u.startsWith('https://cdn.jsdelivr.net/npm/three@' + V + '/examples/jsm/'));
  const s = await loadThree(importer(/jsdelivr/), V, ADDONS);
  assert.equal(s.from, 'esm.sh');
});

test('three loader: an add-on that fails leaves the view without post-processing, not without three.js', async () => {
  const r = await loadThree(importer(/GTAOPass/), V, ADDONS, LOCAL);
  assert.equal(r.THREE, fakeThree);
  assert.deepEqual(r.addons, {});
});

test('three loader: nothing answers, so it throws (the page then says why)', async () => {
  await assert.rejects(loadThree(importer(/./), V, ADDONS, LOCAL));
  const html = threeLoaderScript(V, '0.25.4');
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /couldn't load its 3D engine/);
  assert.match(html, /three-ready/);
});

test('three loader: the import map points three.js and Trystero\'s bare imports at relative files', () => {
  const m = importMap(V, '0.25.4').imports;
  for (const k of ['three', '@trystero-p2p/nostr', '@trystero-p2p/core', '@noble/secp256k1']) {
    // an import map address must start with ./ , ../ or / : a bare "vendor/..." is silently ignored
    assert.match(m[k], /^\.\/vendor\//, k);
  }
  assert.ok(m.three.includes(V));
});
