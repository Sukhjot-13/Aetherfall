/**
 * Vaelor's pure body-language targets. The renderer damps toward these values,
 * so the tests focus on silhouette rules: wind-ups coil, strikes follow through,
 * recoveries settle back to neutral.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NEUTRAL_POSE,
  actionPose,
  idlePose,
  neutralPose,
} from '../src/gameplay/bossPose.js';

const EPS = 1e-6;

function close(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

test('neutral pose is frozen and copied', () => {
  assert.ok(Object.isFrozen(NEUTRAL_POSE));
  const a = neutralPose();
  const b = neutralPose();
  a.armRX = 99;
  assert.notEqual(a.armRX, b.armRX);
  assert.equal(b.armRX, NEUTRAL_POSE.armRX);
});

test('idle pose stays subtle and finite', () => {
  for (const t of [0, 0.5, 2.4, 10]) {
    const pose = idlePose(t);
    for (const value of Object.values(pose)) assert.ok(Number.isFinite(value));
    assert.ok(Math.abs(pose.bodyX) < 0.1);
    assert.ok(Math.abs(pose.bodyZ) < 0.1);
    assert.ok(Math.abs(pose.armLX) < 0.2);
    assert.equal(pose.charge, 0);
  }
});

test('cleave coils back, charges, then follows through', () => {
  const windup = actionPose('cleave', 1, 1, false);
  assert.ok(windup.armRX < -1.4, 'blade arm is raised behind');
  assert.ok(windup.bodyY < -0.3, 'torso twists away');
  assert.ok(windup.charge > 0.95);

  const strike = actionPose('cleave', 1, 0, true);
  assert.ok(strike.armRX > 0.8, 'blade arm snaps forward');
  assert.ok(strike.bodyY > 0.2, 'torso follows the swing');
  assert.ok(strike.bodyZOffset > 0.1, 'weight shifts backward');
  assert.ok(strike.charge < 0.2);

  const settled = actionPose('cleave', 1, 1, true);
  assert.ok(close(settled.armRX, NEUTRAL_POSE.armRX, 0.01));
});

test('slam raises both arms, then crouches over the impact', () => {
  const windup = actionPose('slam', 2, 1, false);
  assert.ok(windup.armLX > 2);
  assert.ok(windup.armRX > 2);
  assert.ok(windup.headX < 0);

  const impact = actionPose('slam', 2, 0, true);
  assert.ok(impact.bodyX > 0.25, 'body folds forward');
  assert.ok(impact.armLX < 1, 'arms drop');
  assert.ok(impact.bodyZOffset > 0.05);

  const settled = actionPose('slam', 2, 1, true);
  assert.ok(settled.bodyX < 0.05);
});

test('volley and storm share a forward channelling pose', () => {
  const volley = actionPose('volley', 1, 1, false);
  const storm = actionPose('storm', 3, 1, false);
  assert.ok(volley.armLX > 0.9);
  assert.ok(volley.armRX > 0.8);
  assert.ok(volley.charge > 0.95);
  assert.ok(storm.armLX > volley.armLX, 'phase 3 is more exaggerated');
  assert.ok(storm.charge > 0.95);
});

test('rifts and summon open the silhouette wide', () => {
  const rifts = actionPose('rifts', 2, 1, false);
  assert.ok(rifts.armLZ < -1.3);
  assert.ok(rifts.armRZ > 1.3);
  assert.ok(rifts.charge > 0.95);

  const summon = actionPose('summon', 3, 1, false);
  assert.ok(summon.armLZ < -1.4);
  assert.ok(summon.armRZ > 1.4);
  assert.ok(summon.armLX < -0.8);
  assert.ok(summon.charge > 0.95);
});

test('later phases exaggerate the same cleave wind-up', () => {
  const p1 = actionPose('cleave', 1, 1, false);
  const p3 = actionPose('cleave', 3, 1, false);
  assert.ok(Math.abs(p3.armRX) > Math.abs(p1.armRX));
  assert.ok(Math.abs(p3.bodyY) > Math.abs(p1.bodyY));
});

test('progress is clamped and unknown attacks stay neutral', () => {
  const atOne = actionPose('cleave', 1, 4, false);
  const atZero = actionPose('cleave', 1, -4, false);
  const neutral = neutralPose();
  assert.ok(close(atZero.armRX, neutral.armRX));
  assert.ok(atOne.charge > 0.99);
  const unknown = actionPose('does-not-exist', 1, 0.5, false);
  assert.deepEqual(unknown, neutral);
});

test('every recovery returns to neutral by the end', () => {
  for (const kind of ['cleave', 'slam', 'volley', 'storm', 'rifts', 'summon']) {
    const settled = actionPose(kind, 3, 1, true);
    for (const key of Object.keys(NEUTRAL_POSE)) {
      if (key === 'charge') continue;
      assert.ok(
        Math.abs(settled[key] - NEUTRAL_POSE[key]) < 0.02,
        `${kind}.${key} settles (${settled[key]} vs ${NEUTRAL_POSE[key]})`,
      );
    }
    assert.ok(settled.charge <= EPS);
  }
});
