/**
 * Soft aim assist: cone selection, target scoring and direction blending.
 * These rules decide which enemy a near-miss shot snaps to, so they are kept
 * pure and covered here instead of being buried in the render loop.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aimConfig,
  assistedDirection,
  hasLineOfSight,
  pickAimTarget,
  predictIntercept,
  solveAim,
} from '../src/gameplay/aim.js';

const EPS = 1e-6;
const ORIGIN = { x: 0, y: 1.5, z: 0 };
const FORWARD = { x: 0, y: 0, z: -1 };

function enemy(x, y, z, overrides = {}) {
  return {
    position: { x, y, z },
    alive: true,
    hitHeight: 1.2,
    ...overrides,
  };
}

test('pickAimTarget selects a living enemy straight ahead', () => {
  const target = enemy(0, 1.5, -12);
  const picked = pickAimTarget(ORIGIN, FORWARD, [target]);
  assert.equal(picked, target);
});

test('pickAimTarget rejects dead, distant and out-of-cone enemies', () => {
  const dead = enemy(0, 1.5, -8, { alive: false });
  const far = enemy(0, 1.5, -120);
  const side = enemy(12, 1.5, -12);
  assert.equal(pickAimTarget(ORIGIN, FORWARD, [dead, far, side]), null);
});

test('pickAimTarget prefers the target closest to the aim line', () => {
  const centre = enemy(0.2, 1.5, -12);
  const edge = enemy(3.2, 1.5, -12);
  const picked = pickAimTarget(ORIGIN, FORWARD, [edge, centre]);
  assert.equal(picked, centre);
});

test('pickAimTarget gives the boss a small bias over adds', () => {
  const add = enemy(0, 1.5, -8);
  const boss = enemy(1.5, 1.5, -12, { isBoss: true, hitHeight: 3.8 });
  const picked = pickAimTarget(ORIGIN, FORWARD, [add, boss]);
  assert.equal(picked, boss);
});

test('pickAimTarget aims at centre mass using hitHeight', () => {
  const tall = enemy(0, 0, -10, { hitHeight: 4 });
  const picked = pickAimTarget({ x: 0, y: 3.1, z: 0 }, FORWARD, [tall]);
  assert.equal(picked, tall);
  assert.equal(pickAimTarget({ x: 0, y: 3.1, z: 0 }, FORWARD, [tall], { range: 4 }), null);
});

test('pickAimTarget handles empty and malformed input safely', () => {
  assert.equal(pickAimTarget(ORIGIN, FORWARD, []), null);
  assert.equal(pickAimTarget(ORIGIN, FORWARD, null), null);
  assert.equal(pickAimTarget(ORIGIN, { x: 0, y: 0, z: 0 }, [enemy(0, 1.5, -5)]), null);
  assert.equal(pickAimTarget(null, FORWARD, [enemy(0, 1.5, -5)]), null);
  assert.equal(pickAimTarget(ORIGIN, FORWARD, [null, { alive: true }]), null);
});

test('assistedDirection leaves the raw shot untouched at strength 0', () => {
  const raw = { x: 0.1, y: 0, z: -1 };
  const out = assistedDirection(raw, ORIGIN, enemy(5, 1.5, -5), 0);
  const len = Math.hypot(out.x, out.y, out.z);
  assert.ok(Math.abs(len - 1) < EPS);
  assert.ok(Math.abs(out.x - raw.x / Math.hypot(raw.x, raw.z)) < EPS);
});

test('assistedDirection points exactly at the target at strength 1', () => {
  const target = enemy(4, 2.5, -8);
  const out = assistedDirection(FORWARD, ORIGIN, target, 1);
  const point = { x: 4, y: 2.5 + 1.2 * 0.7, z: -8 };
  const dx = point.x - ORIGIN.x;
  const dy = point.y - ORIGIN.y;
  const dz = point.z - ORIGIN.z;
  const len = Math.hypot(dx, dy, dz);
  assert.ok(Math.abs(out.x - dx / len) < EPS);
  assert.ok(Math.abs(out.y - dy / len) < EPS);
  assert.ok(Math.abs(out.z - dz / len) < EPS);
});

test('assistedDirection blends and normalizes between raw aim and target', () => {
  const out = assistedDirection(FORWARD, ORIGIN, enemy(8, 1.5, -8), 0.7);
  assert.ok(out.x > 0, 'shot bends toward the enemy on the right');
  assert.ok(out.z < 0);
  assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < EPS);
});

test('assistedDirection falls back safely for missing targets and zero aim', () => {
  const fallback = assistedDirection({ x: 0, y: 0, z: 0 }, ORIGIN, null);
  assert.deepEqual(fallback, { x: 0, y: 0, z: -1 });
  const noOrigin = assistedDirection(FORWARD, null, enemy(0, 1.5, -5));
  assert.deepEqual(noOrigin, FORWARD);
  const sameSpot = assistedDirection(FORWARD, ORIGIN, enemy(0, 0.66, 0), 1);
  assert.deepEqual(sameSpot, FORWARD);
});

test('predictIntercept leads a moving target by projectile travel time', () => {
  const origin = { x: 0, y: 1.5, z: 0 };
  const point = { x: 0, y: 1.5, z: -20 };
  const velocity = { x: 10, y: 0, z: 0 };
  const lead = predictIntercept(origin, point, velocity, 40);
  // Distance is 20 m at 40 m/s; the target should have moved ~5 m in that time.
  assert.ok(lead.x > 4.5 && lead.x < 5.5, `lead x ${lead.x}`);
  assert.ok(Math.abs(lead.z - -20) < EPS);
});

test('predictIntercept clamps long leads and falls back safely', () => {
  const origin = { x: 0, y: 1.5, z: 0 };
  const point = { x: 0, y: 1.5, z: -20 };
  const far = predictIntercept(origin, point, { x: 100, y: 0, z: 0 }, 10, 0.2);
  assert.ok(far.x <= 20.001, 'lead is clamped to maxLead');
  assert.deepEqual(predictIntercept(origin, point, { x: 1, y: 0, z: 0 }, 0), point);
  assert.deepEqual(predictIntercept(origin, point, null, 40), point);
  const unreachable = predictIntercept(origin, point, { x: 60, y: 0, z: 0 }, 10);
  assert.deepEqual(unreachable, point, 'target faster than projectile keeps current point');
});

test('solveAim reports the predicted impact point and lead distance', () => {
  const origin = { x: 0, y: 1.5, z: 0 };
  const target = enemy(0, 1.5, -20, { velocity: { x: 8, y: 0, z: 0 } });
  const solution = solveAim(FORWARD, origin, target, { projectileSpeed: 40, strength: 1 });
  assert.ok(solution.point.x > 3.5, `predicted x ${solution.point.x}`);
  assert.ok(solution.lead > 3.5);
  assert.ok(solution.direction.x > 0, 'shot bends toward the lead point');
});

test('assistedDirection accepts a projectile speed for lead aim', () => {
  const target = enemy(0, 1.5, -20, { velocity: { x: 12, y: 0, z: 0 } });
  const out = assistedDirection(FORWARD, ORIGIN, target, 1, { projectileSpeed: 40 });
  assert.ok(out.x > 0, 'aim leads to the right');
  assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < EPS);
});

test('hasLineOfSight rejects targets behind a hill', () => {
  const origin = { x: 0, y: 3, z: 0 };
  const point = { x: 0, y: 2, z: -20 };
  const flat = () => 0;
  const ridge = (x, z) => (z > -12 && z < -8 ? 8 : 0);
  assert.equal(hasLineOfSight(origin, point, flat), true);
  assert.equal(hasLineOfSight(origin, point, ridge), false);
  assert.equal(hasLineOfSight(origin, point, null), true, 'missing sampler is permissive');
});


test('aimConfig converts the player cone and clamps strength', () => {
  const config = aimConfig({ enabled: false, cone: 18, strength: 1 });
  assert.equal(config.enabled, false);
  assert.ok(Math.abs(config.cone - 18 * Math.PI / 180) < 1e-9);
  assert.equal(config.strength, 1);
  const clamped = aimConfig({ cone: 90, strength: 9 });
  assert.equal(clamped.cone, 45 * Math.PI / 180);
  assert.equal(clamped.strength, 1.5);
  const low = aimConfig({ cone: 0, strength: -3 });
  assert.equal(low.cone, 2 * Math.PI / 180);
  assert.equal(low.strength, 0);
});
