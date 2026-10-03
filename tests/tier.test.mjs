// Device tiers (src/tier.js): a school Chromebook starts light, a gaming
// laptop starts full, and a hand-picked tier wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();
const t = (i) => E.deviceTier(i).tier;

test('tiers: the machines the design names land where it says', () => {
  // 4 GB education Chromebooks (Intel N4500's UHD Graphics, MediaTek Kompanio 500's Mali-G52)
  assert.equal(t({ memoryGB: 4, cores: 2, renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics (JSL), OpenGL ES 3.2)', webgl2: true }), 0);
  assert.equal(t({ memoryGB: 4, cores: 8, renderer: 'Mali-G52 MC2', webgl2: true }), 0);
  // an 8 GB laptop on Iris Xe
  assert.equal(t({ memoryGB: 8, cores: 8, renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)', webgl2: true }), 1);
  // a discrete GPU, and Apple silicon
  assert.equal(t({ memoryGB: 8, cores: 12, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11)', webgl2: true }), 2);
  assert.equal(t({ memoryGB: 8, cores: 8, renderer: 'Apple M2', webgl2: true }), 2);
  // drawing in software is the slowest machine of all
  assert.equal(t({ memoryGB: 16, cores: 16, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', webgl2: true }), 0);
  assert.equal(t({ memoryGB: 16, cores: 8, webgl2: false }), 0);
});

test('tiers: each tier\'s budget follows the design (shadows, pixel ratio, light copy, substeps)', () => {
  const b0 = E.deviceTier({ memoryGB: 4 }).budget, b1 = E.deviceTier({ memoryGB: 8, renderer: 'Intel Iris Xe' }).budget, b2 = E.deviceTier({ override: 2 }).budget;
  assert.deepEqual([b0.shadows, b0.pixelRatio, b0.lite, b0.substeps], [0, 1, true, 2]);
  assert.deepEqual([b1.shadows, b1.pixelRatio, b1.lite, b1.substeps], [1024, 1, false, 4]);
  assert.deepEqual([b2.shadows, b2.pixelRatio, b2.lite, b2.substeps], [2048, 2, false, 4]);
  assert.equal(E.deviceTier({ memoryGB: 4, override: 2 }).tier, 2, 'chosen by hand wins');
  assert.match(E.deviceTier({ memoryGB: 4 }).why, /4 GB/);
});
