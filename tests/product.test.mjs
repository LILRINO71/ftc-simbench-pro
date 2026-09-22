// The product layer: the status light and the GitHub importer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load.mjs';

const E = loadEngine();

test('status: green only when nothing is wrong, and the worst thing wins', () => {
  assert.equal(E.statusOf([], {}).level, 'go');
  assert.equal(E.statusOf([{ key: 'a', sev: 'pass', title: 'fine' }, { key: 'b', sev: 'info', title: 'fyi' }], {}).level, 'go');
  const warn = E.statusOf([{ key: 'w', sev: 'warn', title: 'little torque margin' }], {});
  assert.equal(warn.level, 'warn');
  assert.equal(warn.counts.warn, 1);
  assert.equal(warn.label, '1 to look at');
  const both = E.statusOf([{ key: 'w', sev: 'warn', title: 'margin' }, { key: 'f', sev: 'fail', title: 'servo cannot hold the load' }], {});
  assert.equal(both.level, 'stop');
  assert.equal(both.headline, 'servo cannot hold the load', 'the light says the worst thing out loud');
  assert.ok(both.rank > warn.rank && warn.rank > E.statusOf([], {}).rank);
});

test('status: live trouble the checks cannot see still turns the light', () => {
  const s = E.statusOf([], { stalled: ['arm'], blocked: true });
  assert.equal(s.level, 'stop');
  assert.equal(s.counts.stop, 2);
  assert.ok(s.items.some((i) => /arm is stalled/.test(i.text)));
  assert.equal(E.statusOf([], { slipping: true }).level, 'warn');
  // a front across the wheels makes every turn slide: that is a red light
  const across = E.statusOf([], { frontAcross: true });
  assert.equal(across.level, 'stop');
  assert.ok(/across the wheels/.test(across.headline));
  assert.ok(!/</.test(E.statusOf([{ key: 'x', sev: 'fail', title: '<code>arm</code> is missing' }], {}).items[0].text), 'markup stripped for the chip');
});

test('tour: every step points at something the page really has', () => {
  assert.ok(E.TOUR.length >= 5);
  const ids = new Set();
  for (const s of E.TOUR) {
    assert.ok(s.id && !ids.has(s.id)); ids.add(s.id);
    assert.ok(s.title && s.body, s.id);
    assert.ok(s.target === null || /^[#.\[]/.test(s.target), s.id + ' needs a selector');
    assert.ok(s.tab === null || ['teleop', 'java', 'robot', 'tune', 'shot', 'checks', 'math', 'graph', 'compare'].includes(s.tab), s.id + ' tab');
  }
});

test('github: what a team might paste all resolves to the same repo', () => {
  const want = { owner: 'LILRINO71', repo: 'IDK-WHAT-TEAM-IM-ON' };
  for (const s of ['LILRINO71/IDK-WHAT-TEAM-IM-ON',
    'https://github.com/LILRINO71/IDK-WHAT-TEAM-IM-ON',
    'https://github.com/LILRINO71/IDK-WHAT-TEAM-IM-ON.git',
    'github.com/LILRINO71/IDK-WHAT-TEAM-IM-ON/']) {
    const r = E.parseRepoRef(s);
    assert.equal(r.owner, want.owner, s); assert.equal(r.repo, want.repo, s);
  }
  const dir = E.parseRepoRef('https://github.com/LILRINO71/IDK-WHAT-TEAM-IM-ON/tree/main/TeamCode/src/main/java');
  assert.equal(dir.kind, 'dir'); assert.equal(dir.ref, 'main'); assert.equal(dir.path, 'TeamCode/src/main/java');
  const file = E.parseRepoRef('https://raw.githubusercontent.com/LILRINO71/x/dev/TeamCode/AutoAim.java');
  assert.equal(file.kind, 'file'); assert.equal(file.ref, 'dev'); assert.equal(file.path, 'TeamCode/AutoAim.java');
});

test('github: a pasted link can never send the app somewhere else', () => {
  for (const bad of ['https://evil.example.com/LILRINO71/repo', 'https://github.com.evil.io/a/b',
    'file:///C:/Windows/System32', 'javascript:alert(1)', 'https://github.com/a/b/issues/3',
    'https://github.com/a/b/blob/main/../../etc/passwd', 'https://github.com/a/b/blob/main/setup.sh', '', 'not a url']) {
    assert.equal(E.parseRepoRef(bad), null, bad + ' should be refused');
  }
  const u = E.rawUrlsFor(E.parseRepoRef('owner/repo'));
  for (const url of [u.repo, u.contents, u.tree, u.raw('a/b.java'), u.page]) {
    assert.ok(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com|github\.com)\//.test(url), url);
  }
  assert.ok(E.rawUrlsFor(E.parseRepoRef('owner/repo')).raw('Te am/A+B.java').includes('Te%20am'), 'paths are encoded');
});

test('github: the OpMode picker puts the team code first and the SDK samples last', () => {
  const tree = [
    { path: 'README.md', type: 'blob' },
    { path: 'FtcRobotController/src/main/java/org/firstinspires/ftc/robotcontroller/external/samples/ConceptNull.java', type: 'blob' },
    { path: 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode/AutoAimTeleOp.java', type: 'blob' },
    { path: 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode/Hardware.java', type: 'blob' },
    { path: 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode', type: 'tree' },
  ];
  const picked = E.pickOpModes(tree);
  assert.equal(picked.length, 3, 'only .java blobs');
  assert.equal(picked[0].name, 'AutoAimTeleOp.java');
  assert.equal(picked[1].name, 'Hardware.java', 'support classes rank below real OpModes');
  // the shape a real team repo has: Constants and Tuning must not be offered first
  const real = E.pickOpModes(['Constants', 'Tuning', 'WORKSHOPCODE'].map((n) =>
    ({ path: 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedroPathing/' + n + '.java', type: 'blob' })));
  assert.equal(real[0].name, 'WORKSHOPCODE.java');
  assert.equal(picked[picked.length - 1].sample, true, 'SDK samples sink to the bottom');
  assert.equal(E.pickOpModes(tree, { under: 'TeamCode' }).length, 2);
  assert.equal(E.javaLooksLikeOpMode('@TeleOp(name="x")\npublic class A {}'), true);
  assert.equal(E.javaLooksLikeOpMode('public class Hardware { }'), false);
});
