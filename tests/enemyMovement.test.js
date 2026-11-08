import test from 'node:test';
import assert from 'node:assert/strict';
import { inEnemyStrike, segmentCircleEntry, segmentSphereEntry, steerAround } from '../src/gameplay/enemyMovement.js';

test('melee sector respects facing, range and vertical separation', () => {
  const enemy = { x: 0, y: 1, z: 0 };
  assert.equal(inEnemyStrike(enemy, 0, { x: 0, y: 1, z: -3 }, 4, 2), true);
  assert.equal(inEnemyStrike(enemy, 0, { x: 0, y: 1, z: 3 }, 4, 2), false);
  assert.equal(inEnemyStrike(enemy, 0, { x: 0, y: 4, z: -2 }, 4, 2), false);
  assert.equal(inEnemyStrike(enemy, 0, { x: 0, y: 1, z: -5 }, 4, 2), false);
  assert.equal(inEnemyStrike(enemy, 0, { x: 0, y: 1, z: 3 }, 4, 2, Math.PI), true);
});

test('swept projectile tests find crossings missed by endpoint checks', () => {
  const a = { x: 0, y: 1, z: 0 }, b = { x: 10, y: 1, z: 0 };
  assert.ok(Math.abs(segmentCircleEntry(a, b, { x: 5, z: 0, r: 1 }) - 0.4) < 1e-6);
  assert.ok(Math.abs(segmentSphereEntry(a, b, { x: 7, y: 1, z: 0 }, 1) - 0.6) < 1e-6);
  assert.equal(segmentCircleEntry(a, b, { x: 0, z: 0, r: 1 }), null);
  assert.equal(segmentSphereEntry(a, b, { x: 7, y: 5, z: 0 }, 1), null);
});

test('steering goes around a blocking prop while preserving speed', () => {
  const origin = { x: 0, z: 0 }, heading = { x: 0, z: -4 };
  assert.deepEqual(steerAround(origin, heading, 0.5, []), heading);
  const steered = steerAround(origin, heading, 0.5, [{ x: 0, z: -2, r: 1 }], 1);
  assert.ok(Math.abs(steered.x) > 1);
  assert.ok(Math.abs(Math.hypot(steered.x, steered.z) - 4) < 1e-6);
  assert.deepEqual(steerAround(origin, heading, 0.5, [{ x: 0, z: -2, r: 1, active: false }]), heading);
});
