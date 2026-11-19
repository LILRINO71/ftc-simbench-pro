// Save video (src/recorder.js): the file name, the type and size it picks, and the
// Recorder run against a fake MediaRecorder and canvas: it records the 3D view with
// nothing on top, stops on a click, saves a file, and says why when the browser can't.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'recorder.js'), 'utf8');
const load = (env = {}) => new Function('$', 'View', 'document', 'MediaRecorder', 'HTMLCanvasElement', 'URL', 'navigator', 'performance', 'store', 'CAD', 'getComputedStyle', 'setTimeout',
  SRC + '\nreturn { Recorder, recPickVideo, recVideoSize, recVideoFps, recVideoName, recClock, REC_VIDEO_TYPES, REC_VIDEO_BPS };')(
  env.$, env.View, env.document, env.MediaRecorder, env.HTMLCanvasElement, env.URL, env.navigator, env.performance, env.store, env.CAD, env.getComputedStyle, env.setTimeout);

test('save video: MP4 first, then WebM, nothing when the browser records neither', () => {
  const R = load();
  assert.equal(R.recPickVideo(() => true), 'video/mp4;codecs=avc1.42E01E');
  assert.equal(R.recPickVideo((t) => /webm/.test(t)), 'video/webm;codecs=vp9', 'Firefox: WebM');
  assert.equal(R.recPickVideo((t) => t === 'video/mp4'), 'video/mp4');
  assert.equal(R.recPickVideo(() => false), null);
  assert.equal(R.recPickVideo(() => { throw new Error('x'); }), null);
});

test('save video: the view\'s own size up to 1920, 1280 on a tier-0 machine, 60 fps (30 on tier 0), 8 Mbps', () => {
  const R = load();
  assert.deepEqual(R.recVideoSize(1600, 900, 2), { w: 1600, h: 900 });
  assert.deepEqual(R.recVideoSize(3840, 2160, 2), { w: 1920, h: 1080 });
  assert.deepEqual(R.recVideoSize(1601, 901, 2), { w: 1602, h: 902 }, 'both sides even');
  assert.deepEqual(R.recVideoSize(1920, 1080, 0), { w: 1280, h: 720 });
  assert.equal(R.recVideoFps(2), 60);
  assert.equal(R.recVideoFps(0), 30);
  assert.equal(R.REC_VIDEO_BPS, 8e6);
});

test('save video: simbench-<date>.mp4 or .webm, and the timer reads m:ss', () => {
  const R = load(), when = new Date(2026, 10, 19, 14, 5);
  assert.equal(R.recVideoName(when, 'video/mp4;codecs=avc1'), 'simbench-2026-11-19-1405.mp4');
  assert.equal(R.recVideoName(when, 'video/webm;codecs=vp9'), 'simbench-2026-11-19-1405.webm');
  assert.equal(R.recClock(7.9), '0:07');
  assert.equal(R.recClock(723), '12:03');
  assert.equal(R.recClock(-3), '0:00');
});

/* A page with just enough of a browser: the buttons, a canvas that remembers what was drawn on it,
   and a MediaRecorder that hands back one chunk when stopped. */
function page({ types = () => true, recorder = true } = {}) {
  const log = { drawn: [], text: [], downloads: [], streams: [], recorders: [], status: '' };
  const btn = (id) => ({ id, hidden: true, disabled: false, title: '', listeners: {}, classList: { toggle() {} }, _span: { textContent: '' },
    querySelector() { return this._span; }, addEventListener(e, f) { this.listeners[e] = f; } });
  const els = { '#recBtn': btn('recBtn'), '#vidBtn': btn('vidBtn'), '#cadStatus': { textContent: '' }, '#recAuto': null, '#replayClose': btn('replayClose'), '#replaySave': btn('replaySave') };
  const ctx = new Proxy({}, { get: (_, k) => k === 'drawImage' ? (...a) => log.drawn.push(a) : k === 'fillText' ? (...a) => log.text.push(a) : () => {}, set: () => true });
  class FakeCanvas { constructor() { this.width = 0; this.height = 0; } getContext() { return ctx; } captureStream(fps) { log.streams.push(fps); return { fps }; } }
  FakeCanvas.prototype.getContext = FakeCanvas.prototype.getContext;
  class FakeRecorder {
    constructor(stream, opts) { this.stream = stream; this.opts = opts; log.recorders.push(this); }
    start() { this.started = true; }
    stop() { this.ondataavailable({ data: { size: 5 } }); this.onstop(); }
    static isTypeSupported(t) { return types(t); }
  }
  const src = { width: 1600, height: 900 };
  const env = {
    $: (q) => els[q] || null,
    View: { ren: { domElement: src }, tier: { tier: 2 } },
    document: { createElement: (t) => t === 'canvas' ? new FakeCanvas() : { click() { log.downloads.push({ href: this.href, name: this.download }); }, remove() {} },
      body: { appendChild() {} }, documentElement: { getAttribute: () => 'dark' } },
    MediaRecorder: recorder ? FakeRecorder : undefined,
    HTMLCanvasElement: FakeCanvas,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    navigator: {}, performance: { now: () => 0 }, store: { get: () => '0', set() {} }, CAD: { name: 'Robot.step' },
    getComputedStyle: () => ({ backgroundColor: 'rgb(20,20,20)' }), setTimeout: () => 0,
  };
  return { log, els, env };
}

test('save video: records the 3D view at its size with nothing on top, then a click saves simbench-<date>.mp4', async () => {
  const P = page(), R = load(P.env), rec = R.Recorder;
  rec.init();
  assert.equal(P.els['#vidBtn'].hidden, false, 'the button is there');
  assert.ok(rec.start(false, 'video'));
  assert.equal(rec.mode, 'video');
  assert.equal(rec.auto, true, 'a video stops by itself at the end of the run');
  assert.equal(P.log.streams[0], 60);
  const mr = P.log.recorders[0];
  assert.equal(mr.opts.mimeType, 'video/mp4;codecs=avc1.42E01E');
  assert.equal(mr.opts.videoBitsPerSecond, 8e6);
  assert.deepEqual([rec.cv.width, rec.cv.height], [1600, 900]);
  rec.frame({ match: true, red: 30, blue: 12, period: 'TeleOp', clock: '1:00', final: false, robot: 'x', opmode: 'y' });
  assert.equal(P.log.drawn.length, 1, 'the view was drawn');
  assert.equal(P.log.text.length, 0, 'no score, no names, no watermark');
  const blob = await rec.stop();
  assert.ok(blob && blob.size > 0, 'a file with something in it');
  assert.equal(P.log.downloads.length, 1);
  assert.match(P.log.downloads[0].name, /^simbench-\d{4}-\d{2}-\d{2}-\d{4}\.mp4$/);
  assert.equal(rec.on, false);
  assert.equal(rec.last, 'video');
  assert.equal(rec.url, null, 'the clip and its replay are untouched');
  rec.show();                                                       // the end-of-run hook must not open a replay of nothing
});

test('save video: a Clip keeps its overlay, and each button waits while the other records', async () => {
  const P = page(), R = load(P.env), rec = R.Recorder;
  rec.init();
  assert.ok(rec.start(false));
  rec.frame({ match: true, red: 1, blue: 2, period: 'TeleOp', clock: '0:10', robot: 'a', opmode: 'b' });
  assert.ok(P.log.text.length > 0, 'the clip shows the score');
  assert.equal(P.els['#vidBtn'].disabled, true, 'Save video waits while a clip records');
  await rec.toggleVideo();
  assert.match(P.els['#cadStatus'].textContent, /Stop the clip first/);
  await rec.stop(); rec.render();
  assert.equal(rec.last, 'clip');
  assert.ok(rec.url, 'the clip is kept for the replay');
  assert.equal(P.els['#vidBtn'].disabled, false);
  assert.ok(rec.start(false, 'video'));
  rec.render();
  assert.equal(P.els['#recBtn'].disabled, true, 'and Clip waits while a video records');
  rec.tick();
  assert.equal(P.els['#vidBtn']._span.textContent, 'Stop 0:00');
  await rec.toggleVideo();                                          // the click stops it and saves
  assert.equal(rec.on, false);
  assert.equal(P.log.downloads.length, 1);
});

test('save video: WebM where the browser has no MP4', async () => {
  const P = page({ types: (t) => /webm/.test(t) }), R = load(P.env);
  assert.ok(R.Recorder.start(true, 'video'));
  await R.Recorder.stop();
  assert.match(P.log.downloads[0].name, /\.webm$/);
});

test('save video: a browser without MediaRecorder gets the reason, once, and the button goes', async () => {
  const P = page({ recorder: false }), R = load(P.env), rec = R.Recorder;
  rec.init();
  assert.equal(P.els['#recBtn'].hidden, true, 'Clip stays hidden as before');
  assert.equal(P.els['#vidBtn'].hidden, false, 'Save video is shown so it can say why');
  await rec.toggleVideo();
  assert.match(P.els['#cadStatus'].textContent, /can't save video/);
  assert.equal(P.els['#vidBtn'].hidden, true);
  assert.equal(rec.on, false);
});
