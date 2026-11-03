/**
 * Unit tests for the procedural gait maths that drive the Wayfarer rig.
 * These are pure functions, so no canvas or WebGL context is required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { capeLift, gaitPose, landSquash, runBlend, RUN_SPEED } from '../src/player/gait.js';

const TAU = Math.PI * 2;

test('runBlend maps speed to a clamped 0..1 blend', () => {
  assert.equal(runBlend(0), 0);
  assert.equal(runBlend(RUN_SPEED), 1);
  assert.equal(runBlend(RUN_SPEED * 4), 1);
  assert.equal(runBlend(-5), 0);
  assert.ok(runBlend(RUN_SPEED / 2) > 0.45 && runBlend(RUN_SPEED / 2) < 0.55);
});

test('gaitPose is neutral when standing still', () => {
  const pose = gaitPose(1.234, 0);
  assert.equal(pose.run, 0);
  assert.ok(Math.abs(pose.hipL) < 1e-9);
  assert.ok(Math.abs(pose.hipR) < 1e-9);
  assert.ok(Math.abs(pose.ankleL) < 1e-9);
  assert.ok(Math.abs(pose.ankleR) < 1e-9);
  assert.ok(Math.abs(pose.armL) < 1e-9);
  assert.ok(Math.abs(pose.armR) < 1e-9);
  assert.ok(Math.abs(pose.bob) < 1e-9);
  assert.ok(Math.abs(pose.sway) < 1e-9);
  assert.ok(Math.abs(pose.chestYaw) < 1e-9);
  assert.ok(Math.abs(pose.hipYaw) < 1e-9);
  // A relaxed stance keeps a little bend in both knees.
  assert.ok(pose.kneeL < 0 && pose.kneeL > -0.1);
  assert.ok(pose.kneeR < 0 && pose.kneeR > -0.1);
});

test('gaitPose is symmetric for the two legs', () => {
  for (let i = 0; i < 40; i++) {
    const phase = (i / 40) * TAU;
    const pose = gaitPose(phase, 7.2);
    assert.ok(Math.abs(pose.hipL + pose.hipR) < 1e-9, `hips should oppose at ${phase}`);
    const shifted = gaitPose(phase + Math.PI, 7.2);
    assert.ok(Math.abs(shifted.kneeL - pose.kneeR) < 1e-9, `knees should swap at ${phase}`);
    assert.ok(Math.abs(shifted.ankleL - pose.ankleR) < 1e-9, `ankles should swap at ${phase}`);
  }
});

test('knees only bend backwards and ankles stay in a human range', () => {
  for (let i = 0; i < 120; i++) {
    const pose = gaitPose((i / 120) * TAU, 10.6);
    assert.ok(pose.kneeL <= 0, 'left knee must never hyperextend');
    assert.ok(pose.kneeR <= 0, 'right knee must never hyperextend');
    assert.ok(pose.ankleL >= -0.45 && pose.ankleL <= 0.45);
    assert.ok(pose.ankleR >= -0.45 && pose.ankleR <= 0.45);
    assert.ok(pose.bob >= 0);
    assert.ok(Math.abs(pose.chestYaw) <= 0.2);
    assert.ok(Math.abs(pose.hipYaw) <= 0.15);
  }
});

test('heel strike lifts the toe and toe-off drops it', () => {
  const forward = gaitPose(Math.PI / 2, 7.2); // left leg forward
  const back = gaitPose((3 * Math.PI) / 2, 7.2); // left leg back
  assert.ok(forward.ankleL > 0.2, 'forward foot should be toe-up for heel strike');
  assert.ok(back.ankleL < -0.2, 'trailing foot should be toe-down for toe-off');
  assert.ok(Math.abs(forward.ankleL + back.ankleL) < 1e-9);
});

test('the cycle is continuous (no pops between frames)', () => {
  let previous = gaitPose(0, 10.6);
  const keys = ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'armL', 'armR', 'bob'];
  for (let i = 1; i <= 500; i++) {
    const pose = gaitPose((i / 500) * TAU, 10.6);
    for (const key of keys) {
      assert.ok(Math.abs(pose[key] - previous[key]) < 0.08, `${key} jumped at sample ${i}`);
    }
    previous = pose;
  }
});

test('landSquash is a smooth zero-ended pulse', () => {
  assert.equal(landSquash(0, 0.3, 1), 0);
  assert.equal(landSquash(0.3, 0.3, 1), 0);
  assert.equal(landSquash(-1, 0.3, 1), 0);
  assert.ok(Math.abs(landSquash(0.15, 0.3, 1) - 1) < 1e-9);
  assert.ok(Math.abs(landSquash(0.15, 0.3, 0.4) - 0.4) < 1e-9);
  for (let i = 0; i <= 30; i++) {
    const value = landSquash((i / 30) * 0.3, 0.3, 1);
    assert.ok(value >= 0 && value <= 1);
  }
});

test('capeLift rises with speed and with falling air', () => {
  assert.equal(capeLift(0, 0), 0);
  assert.ok(capeLift(4, 0) > 0);
  assert.ok(capeLift(9, 0) > capeLift(4, 0));
  assert.ok(capeLift(4, -8) > capeLift(4, 8));
  assert.ok(capeLift(100, -100) <= 1);
  assert.ok(capeLift(100, 100) >= 0);
});
