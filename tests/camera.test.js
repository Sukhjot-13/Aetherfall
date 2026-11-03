import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLook,
  CAMERA_MODES,
  clampDistance,
  clampPitch,
  compassFraction,
  createCameraState,
  firstPersonPosition,
  forwardFromYaw,
  lookDirection,
  rightFromYaw,
  thirdPersonPosition,
  toggleCameraMode,
  yawFromDirection,
} from '../src/player/cameraLogic.js';

test('toggle flips first and third person', () => {
  assert.equal(toggleCameraMode(CAMERA_MODES.THIRD), CAMERA_MODES.FIRST);
  assert.equal(toggleCameraMode(CAMERA_MODES.FIRST), CAMERA_MODES.THIRD);
});

test('pitch is clamped to a human range', () => {
  assert.ok(clampPitch(-99) >= -1.22);
  assert.ok(clampPitch(99) <= 0.92);
});

test('look direction matches yaw conventions', () => {
  const forward = lookDirection(0, 0);
  assert.ok(Math.abs(forward.x) < 1e-9);
  assert.ok(Math.abs(forward.z + 1) < 1e-9);
  assert.ok(Math.abs(forward.y) < 1e-9);

  const f = forwardFromYaw(0);
  const r = rightFromYaw(0);
  assert.ok(Math.abs(f.x) < 1e-9 && Math.abs(f.z + 1) < 1e-9);
  assert.ok(Math.abs(r.x - 1) < 1e-9 && Math.abs(r.z) < 1e-9);
});

test('third person camera sits behind the target', () => {
  const target = { x: 10, y: 4, z: -6 };
  const state = createCameraState(CAMERA_MODES.THIRD);
  const pos = thirdPersonPosition(target, state);
  assert.ok(pos.z > target.z, 'camera should be on the +Z side when yaw is 0');
  assert.ok(pos.y > target.y, 'camera should sit above the target');
});

test('first person eye height is applied', () => {
  const pos = firstPersonPosition({ x: 1, y: 2, z: 3 }, 1.66);
  assert.deepEqual(pos, { x: 1, y: 3.66, z: 3 });
});

test('mouse look updates yaw and pitch with sensitivity', () => {
  const state = createCameraState();
  applyLook(state, 10, 10, 0.1, false);
  assert.notEqual(state.yaw, 0);
  assert.ok(state.pitch < 0);
});

test('invert Y flips vertical look', () => {
  const normal = applyLook(createCameraState(), 0, 10, 0.1, false);
  const inverted = applyLook(createCameraState(), 0, 10, 0.1, true);
  assert.ok(normal.pitch < 0);
  assert.ok(inverted.pitch > 0);
});

test('zoom distance is clamped', () => {
  assert.equal(clampDistance(0.01), 1.2);
  assert.equal(clampDistance(1000), 10);
});

test('yaw from direction round-trips', () => {
  for (const yaw of [0, 0.7, 2.4, -1.9]) {
    const f = forwardFromYaw(yaw);
    assert.ok(Math.abs(yawFromDirection(f.x, f.z) - yaw) < 1e-9);
  }
});

test('compass fraction stays in [0,1)', () => {
  for (const yaw of [-20, -1, 0, 1, 7, 40]) {
    const f = compassFraction(yaw);
    assert.ok(f >= 0 && f < 1);
  }
});
