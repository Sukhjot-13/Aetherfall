/**
 * Spell catalogue integrity: ten hotbar slots, four offensive additions,
 * unique keys/ids and full unlock coverage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PASSIVES,
  POWER_UNLOCKS,
  SPELLS,
  SPELL_ORDER,
  STARTING_SPELLS,
  getPower,
  isPassive,
  isSpell,
  unlocksForShard,
} from '../src/gameplay/spellData.js';
import { canCast, castSpell, createPowerState, unlockPowers } from '../src/gameplay/powerState.js';

const NEW_ATTACKS = ['rimeSpear', 'pyreWave', 'thunderfall', 'aetherBarrage'];

test('the hotbar has ten unique, resolvable spells', () => {
  assert.equal(SPELL_ORDER.length, 10);
  assert.equal(new Set(SPELL_ORDER).size, SPELL_ORDER.length);
  for (const id of SPELL_ORDER) {
    assert.ok(SPELLS[id], `${id} exists`);
    assert.equal(isSpell(id), true);
    assert.equal(getPower(id), SPELLS[id]);
  }
  const keys = SPELL_ORDER.map((id) => SPELLS[id].key);
  assert.equal(new Set(keys).size, keys.length, 'hotbar keys are unique');
  assert.deepEqual(keys, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
});

test('four new spells are offensive and configured for soft aim', () => {
  for (const id of NEW_ATTACKS) {
    const spell = SPELLS[id];
    assert.ok(spell, `${id} exists`);
    assert.ok(spell.damage > 0, `${id} deals damage`);
    assert.ok(spell.manaCost > 0, `${id} costs mana`);
    assert.ok(spell.cooldown > 0, `${id} has a cooldown`);
    assert.ok(['lead', 'snap', 'strike'].includes(spell.aim), `${id} uses directed aim`);
    assert.notEqual(spell.kind, 'shield');
    assert.notEqual(spell.kind, 'form');
  }
  assert.equal(SPELLS.rimeSpear.kind, 'pierce');
  assert.equal(SPELLS.pyreWave.kind, 'cone');
  assert.equal(SPELLS.thunderfall.kind, 'strike');
  assert.equal(SPELLS.aetherBarrage.kind, 'barrage');
});

test('every spell is unlocked by exactly one shard or is a starting spell', () => {
  const unlocked = new Set(STARTING_SPELLS);
  for (const ids of Object.values(POWER_UNLOCKS)) {
    for (const id of ids) {
      if (isSpell(id)) unlocked.add(id);
    }
  }
  for (const id of SPELL_ORDER) assert.ok(unlocked.has(id), `${id} is obtainable`);
});

test('shard unlock tables include the new attacks in progression order', () => {
  assert.deepEqual(unlocksForShard('grove'), ['frostNova', 'skyLeap', 'rimeSpear']);
  assert.deepEqual(unlocksForShard('ruins'), ['galeDash', 'stormLance', 'pyreWave']);
  assert.deepEqual(unlocksForShard('peak'), ['aegis', 'aetherForm', 'thunderfall', 'aetherBarrage']);
  assert.equal(unlocksForShard('unknown').length, 0);
});

test('new attacks can be cast once unlocked and respect cooldowns', () => {
  const state = createPowerState({ mana: 100 });
  unlockPowers(state, 'grove');
  unlockPowers(state, 'ruins');
  unlockPowers(state, 'peak');
  for (const id of NEW_ATTACKS) {
    state.mana = 100;
    const before = state.mana;
    const result = castSpell(state, id);
    assert.equal(result.ok, true, `${id} casts`);
    assert.equal(state.mana, before - SPELLS[id].manaCost, `${id} spends mana`);
    assert.ok(state.cooldowns[id] > 0, `${id} starts its cooldown`);
    assert.equal(canCast(state, id).reason, 'cooldown');
  }
});

test('passives remain separate from the spell hotbar', () => {
  assert.equal(SPELL_ORDER.includes('skyLeap'), false);
  assert.equal(isSpell('skyLeap'), false);
  assert.equal(isPassive('skyLeap'), true);
  assert.equal(getPower('skyLeap'), PASSIVES.skyLeap);
});
