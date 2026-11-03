/**
 * Combat maths: explosion falloff, mitigation, chain targeting, slow stacking,
 * knockback and damage aggregation. Pure functions, no DOM or three.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combineSlows,
  computeDamage,
  explosionFalloff,
  healthRatio,
  knockbackVector,
  mitigate,
  pickChainTargets,
  tickSlows,
} from '../src/gameplay/combat.js';

test('explosionFalloff: full damage inside the core', () => {
  assert.equal(explosionFalloff(0, 10), 1);
  assert.equal(explosionFalloff(3.4, 10), 1);
});

test('explosionFalloff: falls to zero at the rim and beyond', () => {
  assert.equal(explosionFalloff(10, 10), 0);
  assert.equal(explosionFalloff(11, 10), 0);
});

test('explosionFalloff: monotonic decay between core and rim', () => {
  const samples = [4, 5, 6, 7, 8, 9].map((d) => explosionFalloff(d, 10));
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] <= samples[i - 1], 'falloff must not increase with distance');
  }
  assert.ok(samples[0] > 0 && samples[0] < 1);
});

test('explosionFalloff: rejects degenerate input', () => {
  assert.equal(explosionFalloff(1, 0), 0);
  assert.equal(explosionFalloff(1, -5), 0);
  assert.equal(explosionFalloff(Number.NaN, 10), 0);
  assert.equal(explosionFalloff(1, Number.POSITIVE_INFINITY), 0);
});

test('mitigate: flat armour reduces damage but never below the floor', () => {
  assert.equal(mitigate(30, 10), 20);
  assert.equal(mitigate(30, 0), 30);
  assert.equal(mitigate(30, 100), 4.5);
});

test('mitigate: negative values clamp to zero', () => {
  assert.equal(mitigate(-10, 5), 0);
  assert.equal(mitigate(10, -5), 10);
});

test('pickChainTargets: nearest first within range', () => {
  const origin = { x: 0, z: 0 };
  const candidates = [
    { x: 30, z: 0, id: 'far' },
    { x: 5, z: 0, id: 'near' },
    { x: 12, z: 0, id: 'mid' },
  ];
  const picked = pickChainTargets(origin, candidates, { range: 20, maxTargets: 2 });
  assert.deepEqual(
    picked.map((c) => c.id),
    ['near', 'mid'],
  );
});

test('pickChainTargets: skips dead candidates and respects range', () => {
  const picked = pickChainTargets(
    { x: 0, z: 0 },
    [
      { x: 1, z: 0, alive: false, id: 'dead' },
      { x: 50, z: 0, id: 'out' },
      { x: 4, z: 0, id: 'ok' },
    ],
    { range: 10 },
  );
  assert.deepEqual(
    picked.map((c) => c.id),
    ['ok'],
  );
});

test('pickChainTargets: direction cone filters targets behind the caster', () => {
  const picked = pickChainTargets(
    { x: 0, z: 0 },
    [
      { x: 0, z: -8, id: 'front' },
      { x: 0, z: 8, id: 'behind' },
    ],
    { range: 20, maxTargets: 1, dir: { x: 0, z: -1 }, cone: 0.5 },
  );
  assert.deepEqual(
    picked.map((c) => c.id),
    ['front'],
  );
});

test('combineSlows: strongest factor and longest duration win', () => {
  const result = combineSlows([
    { factor: 0.7, remaining: 2 },
    { factor: 0.4, remaining: 1 },
    { factor: 0.9, remaining: 5 },
  ]);
  assert.equal(result.factor, 0.4);
  assert.equal(result.remaining, 5);
});

test('combineSlows: ignores expired and clamps extreme factors', () => {
  assert.deepEqual(combineSlows([]), { factor: 1, remaining: 0 });
  assert.deepEqual(combineSlows([{ factor: 0.2, remaining: 0 }]), { factor: 1, remaining: 0 });
  assert.equal(combineSlows([{ factor: 0.01, remaining: 1 }]).factor, 0.15);
});

test('tickSlows: advances durations and drops expired entries', () => {
  const next = tickSlows(
    [
      { factor: 0.5, remaining: 1 },
      { factor: 0.8, remaining: 0.4 },
    ],
    0.5,
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].factor, 0.5);
  assert.equal(next[0].remaining, 0.5);
});

test('tickSlows: tolerates non-array input', () => {
  assert.deepEqual(tickSlows(null, 0.1), []);
  assert.deepEqual(tickSlows(undefined, 0.1), []);
});

test('knockbackVector: points away from the impact with upward lift', () => {
  const v = knockbackVector({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 10);
  assert.ok(v.x > 0);
  assert.equal(v.z, 0);
  assert.ok(v.y >= 1.4);
});

test('knockbackVector: same position still yields safe values', () => {
  const v = knockbackVector({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, 8);
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
  assert.ok(v.y >= 1.4);
});

test('computeDamage: applies multipliers and always deals at least 1', () => {
  assert.equal(computeDamage(26), 26);
  assert.equal(computeDamage(26, { damage: 1.5 }), 39);
  assert.equal(computeDamage(26, { falloff: 0.5 }), 13);
  assert.equal(computeDamage(26, { crit: 2 }), 52);
  assert.equal(computeDamage(0), 1);
  assert.equal(computeDamage(-5), 1);
});

test('healthRatio: clamps into 0..1 and handles zero max', () => {
  assert.equal(healthRatio(50, 100), 0.5);
  assert.equal(healthRatio(150, 100), 1);
  assert.equal(healthRatio(-5, 100), 0);
  assert.equal(healthRatio(10, 0), 0);
  assert.equal(healthRatio(Number.NaN, 100), 0);
});
