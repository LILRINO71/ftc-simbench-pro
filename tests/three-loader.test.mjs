// The page's three.js loader (tools/threeloader.mjs): three.js 0.186 ships only as ES
// modules from a CDN, so one blocked CDN (a school filter) used to leave the page blank.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, ADDONS, threeLoaderScript } from '../tools/threeloader.mjs';

const V = '0.186.1';
const fakeThree = { WebGLRenderer: function () {} };
const fakeAddon = (u) => Object.fromEntries(ADDONS.map(([k]) => [k, u.includes(k) ? { k, u } : undefined]));
/* an import() that fails for every URL `down` matches */
const importer = (down) => async (u) => {
  if (down && down.test(u)) throw new TypeError('Failed to fetch dynamically imported module: ' + u);
  return u === 'three' || /esm\.sh\/three@[\d.]+$/.test(u) ? fakeThree : fakeAddon(u);
};

test('three loader: jsDelivr first, with every add-on', async () => {
  const r = await loadThree(importer(null), V, ADDONS);
  assert.equal(r.from, 'jsdelivr');
  assert.equal(r.THREE, fakeThree);
  assert.deepEqual(Object.keys(r.addons).sort(), ADDONS.map(([k]) => k).sort());
  assert.ok(r.addons.GTAOPass.u.startsWith('https://cdn.jsdelivr.net/npm/three@' + V + '/examples/jsm/'));
});

test('three loader: jsDelivr blocked, so three.js and its add-ons all come from esm.sh (one copy of three.js)', async () => {
  const r = await loadThree(importer(/^three$|jsdelivr/), V, ADDONS);
  assert.equal(r.from, 'esm.sh');
  for (const [k] of ADDONS) assert.ok(r.addons[k].u.startsWith('https://esm.sh/three@' + V + '/'), k);
});

test('three loader: an add-on that fails leaves the view without post-processing, not without three.js', async () => {
  const r = await loadThree(importer(/GTAOPass/), V, ADDONS);
  assert.equal(r.from, 'jsdelivr');
  assert.deepEqual(r.addons, {});
});

test('three loader: no CDN answers, so it throws (the page then says why)', async () => {
  await assert.rejects(loadThree(importer(/./), V, ADDONS));
  const html = threeLoaderScript(V);
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /couldn't load its 3D engine/);
  assert.match(html, /three-ready/);
});
