// node --test tests/step-speed.test.mjs
//
// A STEP file must parse in time linear in its size however many files came
// before it. splitStepRecords kept "-1, none left" for the next comment; from
// about the fourth parseSTEP in one page (or one bench worker) the optimised
// code searched for that comment again on every record, to the end of the
// file each time: a 6 MB robot after three others took 38 s, a 24 MB one
// never finished. Fresh engine here, so the call count is this test's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

// a STEP body with no comment after DATA (the usual case) and a comment in the header
function step(nrec) {
  const out = ["ISO-10303-21;\nHEADER;\n/* made by a test */\nFILE_NAME('x','2024',(''),(''),'','','');\nENDSEC;\nDATA;\n"];
  for (let k = 0, id = 1; k < nrec; k++, id++) {
    const r = (k * 7919) % 5, p = Math.max(1, id - 3);
    out.push(r === 0 ? `#${id}=CARTESIAN_POINT('',(${k % 97}.,${k % 13}.5,-${k % 7}.25));\n`
      : r === 1 ? `#${id}=DIRECTION('',(0.,0.,1.));\n`
      : r === 2 ? `#${id}=PRODUCT('part ${k}','it''s ${k}','',(#${p}));\n`
      : r === 3 ? `#${id}=AXIS2_PLACEMENT_3D('',#${p},#${p},#${p});\n`
      : `#${id}=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#1,#2,#3))REPRESENTATION_CONTEXT('',''));\n`);
  }
  out.push('ENDSEC;\nEND-ISO-10303-21;\n');
  return out.join('');
}
const timed = (text) => { const t0 = performance.now(); E.parseSTEP(text); return performance.now() - t0; };

test('step: parse time stays linear in the file size, file after file', () => {
  const small = step(10000), big = step(40000);
  const per = [timed(small), timed(small), timed(small), timed(small)];
  const tBig = timed(big);
  // 4x the records: about 4x the time when linear (it was ~90x before the fix)
  const base = Math.min(...per);
  assert.ok(tBig < 20 * base + 500, `40k records took ${Math.round(tBig)} ms, 10k took ${Math.round(base)} ms`);
  // and the records come out the same
  assert.equal(E.splitStepRecords(big.slice(big.indexOf('DATA;') + 5)).length, 40000 + 2);
});
