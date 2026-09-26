// Yellow Jacket gearmotors by goBILDA part number: 5203-2402-XXXX, where the
// last group is the ratio's code. 0014 is the 13.7:1 (435 rpm) — the drive
// motors on GearGurus 7832's robot — and it used to fall back to a generic
// 312 rpm motor with no ratio, so that robot drove 28% slow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

test('every Yellow Jacket part number gets its own ratio, speed and torque', () => {
  const want = { '0001': [1, 6000], '0003': [3.7, 1620], '0005': [5.2, 1150], '0014': [13.7, 435], '0019': [19.2, 312],
    '0027': [26.9, 223], '0051': [50.9, 117], '0071': [71.2, 84], '0100': [99.5, 60], '0139': [139, 43], '0188': [188, 30] };
  for (const [code, [ratio, rpm]] of Object.entries(want)) {
    const s = E.hwFromPart('5203-2402-' + code, '');
    assert.equal(s.ratio, ratio, code + ' ratio');
    assert.equal(s.rpm, rpm, code + ' rpm');
    assert.ok(!s.guess, code + ' is known, not a guess');
  }
});
