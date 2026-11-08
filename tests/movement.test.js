/**
 * Movement maths: acceleration, sprint ramp, slope response, jump shaping,
 * dodge vectors and landing classification. These are the tuning rules the
 * controller uses every frame, so regressions here are gameplay regressions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOVE,
  airControl,
  approach,
  approachAxis,
  approachVelocity,
  canDodge,
  dodgeDirection,
  dodgeSpeedAt,
  flightDirection,
  gravityFor,
  jumpCut,
  landingForce,
  rollProgress,
  shouldRoll,
  slopeSlide,
  slopeSpeedFactor,
  sprintBlend,
  strideLength,
  targetSpeed,
} from '../src/player/movement.js';

const EPS = 1e-6;

test('approach never overshoots and lands exactly on target', () => {
  assert.equal(approach(0, 10, 30, 0.2), 6);
  assert.equal(approach(0, 10, 100, 1), 10);
  assert.equal(approach(10, 0, 100, 1), 0);
  assert.equal(approach(4, 4, 50, 1), 4);
});

test('approachAxis accelerates faster than it brakes', () => {
  const accelerate = approachAxis(0, 7, 26, 34, 0.1);
  const brake = approachAxis(7, 0, 26, 34, 0.1);
  assert.ok(accelerate > 0);
  assert.ok(brake < 7);
  // 0.1 s at 26 m/s² is 2.6, at 34 m/s² is 3.4.
  assert.ok(Math.abs(accelerate - 2.6) < EPS);
  assert.ok(Math.abs(brake - 3.6) < EPS);
});

test('approachAxis brakes when reversing direction', () => {
  const reversed = approachAxis(5, -5, 20, 40, 0.1);
  assert.equal(reversed, 1);
});

test('vector acceleration is consistent across frame rates and diagonals', () => {
  for (const hz of [30, 60, 120]) {
    let v = { x: 0, z: 0 };
    for (let i = 0; i < hz / 5; i++) v = approachVelocity(v.x, v.z, 0, -7.2, 26, 34, 1 / hz);
    assert.ok(Math.abs(v.z + 5.2) < 1e-6);
    let diagonal = { x: 0, z: 0 };
    for (let i = 0; i < hz / 5; i++) diagonal = approachVelocity(diagonal.x, diagonal.z, 7.2 / Math.SQRT2, -7.2 / Math.SQRT2, 26, 34, 1 / hz);
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 5.2) < 1e-6);
  }
});

test('sprint ramps smoothly and refuses invalid states', () => {
  assert.equal(sprintBlend(0, true, 100), 0);
  const mid = sprintBlend(0.3, true, 100);
  assert.ok(mid > 0 && mid < 1);
  assert.equal(sprintBlend(2, true, 100), 1);
  assert.equal(sprintBlend(1, false, 100), 0);
  assert.equal(sprintBlend(1, true, 0), 0);
  assert.equal(sprintBlend(1, true, 100, false), 0);
  assert.equal(sprintBlend(1, true, 100, true, true), 0);
});

test('targetSpeed interpolates run to sprint and applies form/water', () => {
  const run = targetSpeed({ moving: true, sprint: 0, grounded: true });
  const sprint = targetSpeed({ moving: true, sprint: 1, grounded: true });
  const air = targetSpeed({ moving: true, sprint: 0, grounded: false });
  assert.equal(run, MOVE.runSpeed);
  assert.equal(sprint, MOVE.sprintSpeed);
  assert.equal(air, MOVE.walkSpeed);
  assert.equal(targetSpeed({ moving: false, sprint: 1, grounded: true }), 0);
  assert.ok(targetSpeed({ moving: true, sprint: 0, grounded: true, inWater: true }) < run);
  assert.ok(targetSpeed({ moving: true, sprint: 1, grounded: true, formMultiplier: 1.5 }) > sprint);
});

test('slopeSpeedFactor slows uphill and speeds downhill', () => {
  // Normal with +x points uphill toward +x? Heightfield normals are the negative
  // gradient, so moving along -normal is uphill.
  const normal = { x: -0.5, y: 0.86, z: 0 };
  const uphill = slopeSpeedFactor(normal, 1, 0);
  const downhill = slopeSpeedFactor(normal, -1, 0);
  const flat = slopeSpeedFactor({ x: 0, y: 1, z: 0 }, 1, 0);
  assert.ok(uphill < 1);
  assert.ok(downhill > 1);
  assert.equal(flat, 1);
  assert.ok(uphill >= 0.55 && downhill <= 1.16);
  assert.equal(slopeSpeedFactor(normal, 0, 0), 1);
});

test('slopeSlide only kicks in on steep faces and points downhill', () => {
  const flat = slopeSlide({ x: 0, y: 1, z: 0 }, 0.2);
  assert.deepEqual(flat, { x: 0, z: 0 });
  const steep = slopeSlide({ x: -0.8, y: 0.6, z: 0 }, 0.7);
  assert.ok(steep.x < 0);
  assert.equal(steep.z, 0);
});

test('air control falls off with air time', () => {
  assert.equal(airControl(0), 1);
  assert.ok(airControl(0.6) < 1);
  assert.ok(airControl(3) < airControl(0.4));
  assert.ok(airControl(10) >= 0.55);
});

test('gravity is floaty at the apex and heavy on the way down', () => {
  assert.equal(gravityFor(0), MOVE.apexGravity);
  assert.equal(gravityFor(1.5), MOVE.apexGravity);
  assert.equal(gravityFor(8), MOVE.gravity);
  assert.equal(gravityFor(-1), MOVE.fallGravity);
  assert.ok(MOVE.fallGravity > MOVE.gravity);
  assert.ok(MOVE.apexGravity < MOVE.gravity);
});

test('jump cut only applies once and only while rising', () => {
  const cut = jumpCut(8, false, false);
  assert.ok(cut.vy < 8);
  assert.equal(cut.cut, true);
  const held = jumpCut(8, true, false);
  assert.equal(held.vy, 8);
  assert.equal(held.cut, false);
  const already = jumpCut(8, false, true);
  assert.equal(already.vy, 8);
  assert.equal(already.cut, true);
  const falling = jumpCut(-4, false, false);
  assert.equal(falling.vy, -4);
});

test('landing force is bounded and monotonic', () => {
  assert.equal(landingForce(0), 0);
  assert.equal(landingForce(100), 1);
  assert.ok(landingForce(12) > landingForce(6));
});

test('heavy fast landings roll; gentle ones do not', () => {
  assert.equal(shouldRoll(MOVE.landRollSpeed + 1, 5), true);
  assert.equal(shouldRoll(MOVE.landRollSpeed + 1, 0.5), false);
  assert.equal(shouldRoll(6, 8), false);
  assert.equal(rollProgress(0), 0);
  assert.equal(rollProgress(10), 1);
});

test('dodgeDirection is camera-relative and falls back to a backstep', () => {
  const forward = dodgeDirection(0, 1, 0, 0);
  assert.ok(Math.abs(forward.x) < EPS);
  assert.ok(Math.abs(forward.z + 1) < EPS);

  const right = dodgeDirection(1, 0, 0, 0);
  assert.ok(Math.abs(right.x - 1) < EPS);

  const backstep = dodgeDirection(0, 0, 0, 0);
  assert.ok(Math.abs(backstep.x) < EPS);
  assert.ok(Math.abs(backstep.z - 1) < EPS);

  const diagonal = dodgeDirection(1, 1, Math.PI / 2, 0);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < EPS);
});

test('dodge availability and speed curve', () => {
  assert.equal(canDodge({ stamina: 100, cooldown: 0, grounded: true, dashing: false, inWater: false }), true);
  assert.equal(canDodge({ stamina: 0, cooldown: 0, grounded: true, dashing: false, inWater: false }), false);
  assert.equal(canDodge({ stamina: 100, cooldown: 1, grounded: true, dashing: false, inWater: false }), false);
  assert.equal(canDodge({ stamina: 100, cooldown: 0, grounded: false, dashing: false, inWater: false }), true);
  assert.equal(canDodge({ stamina: 100, cooldown: 0, grounded: true, dashing: true, inWater: false }), false);
  assert.equal(canDodge({ stamina: 100, cooldown: 0, grounded: true, dashing: false, inWater: true }), false);
  assert.equal(dodgeSpeedAt(0), MOVE.dodgeSpeed);
  assert.ok(dodgeSpeedAt(MOVE.dodgeDuration) < MOVE.dodgeSpeed);
  assert.ok(dodgeSpeedAt(MOVE.dodgeDuration) > MOVE.dodgeSpeed * 0.5);
});

test('stride length shortens as speed rises', () => {
  assert.ok(strideLength(10) < strideLength(4));
  assert.ok(strideLength(100) >= 1.55);
});

test('flight direction follows the full camera look, including pitch', () => {
  const level = flightDirection(0, 1, 0, 0);
  assert.ok(Math.abs(level.x) < EPS);
  assert.ok(Math.abs(level.y) < EPS);
  assert.ok(Math.abs(level.z + 1) < EPS);

  const up = flightDirection(0, 1, 0, Math.PI / 4);
  assert.ok(up.y > 0.6);
  assert.ok(up.z < 0);
  assert.ok(Math.abs(Math.hypot(up.x, up.y, up.z) - 1) < EPS);

  const down = flightDirection(0, 1, 0, -Math.PI / 4);
  assert.ok(down.y < -0.6);

  const straightUp = flightDirection(0, 1, 0, Math.PI / 2);
  assert.ok(Math.abs(straightUp.x) < EPS);
  assert.ok(Math.abs(straightUp.y - 1) < EPS);
  assert.ok(Math.abs(straightUp.z) < EPS);

  const right = flightDirection(1, 0, 0, 0);
  assert.ok(Math.abs(right.x - 1) < EPS);
  assert.ok(Math.abs(right.y) < EPS);

  const diagonal = flightDirection(1, 1, 0, 0.5);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y, diagonal.z) - 1) < EPS);
  assert.ok(diagonal.y > 0);

  const idle = flightDirection(0, 0, 1.2, 0.4);
  assert.deepEqual(idle, { x: 0, y: 0, z: 0 });
});
