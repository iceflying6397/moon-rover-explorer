import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pageShortcut,
  shortcutBlocked,
  frameDelta,
} from '../lib/scene-controls.ts';
import { resolveQuality } from '../lib/scene-settings.ts';

test('browser shortcuts and composed input do not become scene actions', () => {
  const state = {
    repeat: false,
    editing: false,
    modalOpen: false,
    buttonFocused: false,
  };
  for (const flag of [
    'metaKey',
    'ctrlKey',
    'altKey',
    'defaultPrevented',
    'isComposing',
  ]) {
    assert.equal(pageShortcut('KeyR', { ...state, [flag]: true }), null);
    assert.equal(shortcutBlocked({ [flag]: true }), true);
  }
  assert.equal(pageShortcut('KeyR', state), 'reset');
  assert.equal(shortcutBlocked({ shiftKey: true }), false);
});

test('10 FPS and 60 FPS accumulate the same active time and driving distance', () => {
  const run = (fps) => {
    let previous = 0,
      time = 0,
      distance = 0;
    for (let i = 1; i <= fps * 10; i++) {
      const now = (i * 1000) / fps;
      const delta = frameDelta(previous, now);
      previous = now;
      time += delta.elapsed;
      distance += delta.elapsed * 0.12;
      assert.ok(delta.smoothing <= 0.05);
    }
    return { time, distance };
  };
  for (const fps of [10, 20, 60]) {
    const result = run(fps);
    assert.ok(Math.abs(result.time - 10) < 1e-9);
    assert.ok(Math.abs(result.distance - 1.2) < 1e-9);
  }
});

test('automatic quality considers touch and CPU while respecting an explicit choice', () => {
  assert.equal(resolveQuality('auto', 1400, true, 8), 'low');
  assert.equal(resolveQuality('auto', 1400, false, 4), 'low');
  assert.equal(resolveQuality('auto', 1400, false, 8), 'standard');
  assert.equal(resolveQuality('high', 390, true, 4), 'high');
});
