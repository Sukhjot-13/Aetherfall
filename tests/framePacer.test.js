import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer } from '../src/core/FramePacer.js';

function windowOf(pacer, frameTime) {
  let sample;
  while (!sample) sample = pacer.sample(frameTime);
  return sample;
}

test('frame rate uses elapsed time rather than averaging instantaneous rates', () => {
  const pacer = new FramePacer();
  let sample;
  while (!sample) {
    sample = pacer.sample(0.01);
    if (!sample) sample = pacer.sample(0.09);
  }
  // A window can end on either frame of the alternating pair.
  assert.ok(Math.abs(sample.fps - 20) < 1);
  assert.equal(sample.step, 0);
});

test('resolution adjusts only after sustained slow or fast frames', () => {
  const pacer = new FramePacer();
  assert.equal(windowOf(pacer, 1 / 30).step, 0);
  assert.equal(windowOf(pacer, 1 / 30).step, -0.12);
  for (let i = 0; i < 3; i++) assert.equal(windowOf(pacer, 1 / 60).step, 0);
  assert.equal(windowOf(pacer, 1 / 60).step, 0.06);
});

test('reset discards stale samples after pausing', () => {
  const pacer = new FramePacer();
  windowOf(pacer, 1 / 25);
  pacer.reset();
  assert.equal(windowOf(pacer, 1 / 25).step, 0);
});
