// Keyboard bindings (src/keybinds.js): two layouts, any control on any key,
// one key per control, the page's own keys kept out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = new Function(fs.readFileSync(path.join(ROOT, 'src', 'keybinds.js'), 'utf8') + '\nreturn { keyBindings, keyTables, keyLabel, KEY_CONTROLS, KEY_PRESETS };')();

test('keys: the Classic layout is the keys SimBench always had', () => {
  const T = K.keyTables(K.keyBindings('classic', {}));
  assert.deepEqual(T.axes.KeyI, ['left_stick_y', -1]);
  assert.deepEqual(T.axes.KeyL, ['left_stick_x', 1]);
  assert.deepEqual(T.axes.KeyU, ['right_stick_x', -1]);
  assert.equal(T.buttons.KeyA, 'a'); assert.equal(T.buttons.KeyQ, 'left_bumper'); assert.equal(T.buttons.ArrowUp, 'dpad_up');
  assert.deepEqual(T.axes.KeyZ, ['left_trigger', 1], 'a trigger pulls to 1');
});

test('keys: WASD drives with W A S D and turns with the arrows; every control has a key in both layouts', () => {
  const T = K.keyTables(K.keyBindings('wasd', {}));
  assert.deepEqual([T.axes.KeyW, T.axes.KeyA, T.axes.KeyS, T.axes.KeyD], [['left_stick_y', -1], ['left_stick_x', -1], ['left_stick_y', 1], ['left_stick_x', 1]]);
  assert.deepEqual(T.axes.ArrowLeft, ['right_stick_x', -1]);
  for (const p of ['classic', 'wasd']) {
    const b = K.keyBindings(p, {});
    for (const [c] of K.KEY_CONTROLS) assert.ok(b[c], `${p}: ${c} has a key`);
    const keys = Object.values(b);
    assert.equal(new Set(keys).size, keys.length, `${p}: no key twice`);
  }
});

test('keys: moving a control to a key takes it from the control that had it; Delete unbinds; the page keys stay the page\'s', () => {
  const b = K.keyBindings('classic', { a: 'KeyI' });
  assert.equal(b.a, 'KeyI');
  assert.equal(b['left_stick_y-'], null, 'I left the left stick');
  const T = K.keyTables(b);
  assert.equal(T.buttons.KeyI, 'a'); assert.equal(T.axes.KeyI, undefined);
  assert.equal(K.keyBindings('classic', { b: null }).b, null);
  assert.equal(K.keyBindings('classic', { x: 'KeyF' }).x, null, 'F fires a shot');
  assert.equal(K.keyBindings('classic', { y: '<img src=x>' }).y, null, 'only key codes');
  assert.equal(K.keyBindings('nonsense', {}).a, 'KeyA', 'an unknown layout is Classic');
});

test('keys: names as printed on the keys', () => {
  assert.equal(K.keyLabel('KeyW'), 'W'); assert.equal(K.keyLabel('Digit3'), '3'); assert.equal(K.keyLabel('ArrowLeft'), '←');
  assert.equal(K.keyLabel('ShiftLeft'), 'L Shift'); assert.equal(K.keyLabel(null), '—');
});
