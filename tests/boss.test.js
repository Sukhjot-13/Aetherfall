/**
 * Boss phase rules: health thresholds, pacing, telegraphs, attack patterns and
 * arena containment. The encounter is only as fair as these numbers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOSS,
  attackCooldown,
  attackPattern,
  bossArmor,
  bossPhase,
  cleaveDamage,
  clampToArena,
  enrageAmount,
  healthRatio,
  nextPhase,
  phaseColor,
  phaseStartRatio,
  riftCount,
  shouldPhaseTransition,
  slamDamage,
  summonCount,
  telegraphDuration,
  volleyCount,
  volleyDamage,
} from '../src/gameplay/bossPhases.js';

test('health ratio is clamped and rejects malformed input', () => {
  assert.equal(healthRatio(100, 100), 1);
  assert.equal(healthRatio(0, 100), 0);
  assert.equal(healthRatio(150, 100), 1);
  assert.equal(healthRatio(-10, 100), 0);
  assert.equal(healthRatio(NaN, 100), 0);
  assert.equal(healthRatio(50, 0), 0);
});

test('boss phases split at 66 % and 33 %', () => {
  assert.equal(bossPhase(2100), 1);
  assert.equal(bossPhase(1400), 1);
  assert.equal(bossPhase(1386), 2);
  assert.equal(bossPhase(700), 2);
  assert.equal(bossPhase(693), 3);
  assert.equal(bossPhase(1), 3);
  assert.equal(nextPhase(1), 2);
  assert.equal(nextPhase(2), 3);
  assert.equal(nextPhase(3), 3);
  assert.equal(phaseStartRatio(1), 1);
  assert.equal(phaseStartRatio(2), 0.66);
  assert.equal(phaseStartRatio(3), 0.33);
});

test('attack pacing accelerates each phase but stays readable', () => {
  assert.ok(attackCooldown(1) > attackCooldown(2));
  assert.ok(attackCooldown(2) > attackCooldown(3));
  assert.ok(attackCooldown(3) >= 1.2);
  assert.ok(volleyCount(1) < volleyCount(2));
  assert.ok(volleyCount(2) < volleyCount(3));
  assert.equal(riftCount(1), 0);
  assert.ok(riftCount(2) > 0);
  assert.ok(riftCount(3) > riftCount(2));
  assert.equal(summonCount(1), 0);
  assert.ok(summonCount(2) > 0);
  assert.ok(summonCount(3) >= summonCount(2));
});

test('damage scales with phase', () => {
  assert.ok(slamDamage(1) < slamDamage(2));
  assert.ok(slamDamage(2) < slamDamage(3));
  assert.ok(cleaveDamage(1) < cleaveDamage(3));
  assert.ok(volleyDamage(1) < volleyDamage(3));
  assert.ok(bossArmor(1) < bossArmor(3));
});

test('telegraphs shrink with phase and remain fair', () => {
  for (const kind of ['cleave', 'slam', 'volley', 'rifts', 'storm', 'summon']) {
    const one = telegraphDuration(kind, 1);
    const three = telegraphDuration(kind, 3);
    assert.ok(one > 0.4, `${kind} phase 1 must be readable`);
    assert.ok(three > 0.4, `${kind} phase 3 must be readable`);
    assert.ok(three <= one, `${kind} should not slow down in later phases`);
  }
});

test('phase transition only fires on a forward crossing', () => {
  assert.equal(shouldPhaseTransition(1, 2), true);
  assert.equal(shouldPhaseTransition(2, 2), false);
  assert.equal(shouldPhaseTransition(3, 1), false);
  assert.equal(shouldPhaseTransition(undefined, 2), false);
});

test('arena clamp keeps the player inside and reports the barrier', () => {
  const inside = clampToArena(0, 0, 0, 0, 20);
  assert.equal(inside.outside, false);
  const outside = clampToArena(30, 0, 0, 0, 20);
  assert.equal(outside.outside, true);
  assert.equal(Math.hypot(outside.x, outside.z), 20);
  assert.equal(outside.x, 20);
  assert.equal(outside.z, 0);
});

test('every phase has a complete attack pattern with its signature move', () => {
  const one = attackPattern(1);
  const two = attackPattern(2);
  const three = attackPattern(3);
  assert.ok(one.includes('cleave'));
  assert.ok(one.includes('slam'));
  assert.ok(two.includes('rifts'));
  assert.ok(two.includes('summon'));
  assert.ok(three.includes('storm'));
  assert.ok(three.length >= 5);
  assert.notDeepEqual(one, two);
  assert.notDeepEqual(two, three);
});

test('phase colours and enrage ramp are stable', () => {
  assert.equal(phaseColor(1), '#b48cff');
  assert.notEqual(phaseColor(1), phaseColor(2));
  assert.notEqual(phaseColor(2), phaseColor(3));
  assert.equal(enrageAmount(1), 0);
  assert.ok(enrageAmount(2) > 0 && enrageAmount(2) < 1);
  assert.equal(enrageAmount(3), 1);
});

test('boss tuning is sane for a first-draft encounter', () => {
  assert.ok(BOSS.maxHealth >= 1500 && BOSS.maxHealth <= 3000);
  assert.ok(BOSS.arenaRadius >= 20 && BOSS.arenaRadius <= 35);
  assert.equal(BOSS.phaseCount, 3);
  assert.equal(BOSS.phaseThresholds.length, 2);
});
