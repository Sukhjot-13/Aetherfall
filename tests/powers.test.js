import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDamage,
  canCast,
  castSpell,
  consumeStamina,
  createPowerState,
  formDamageMultiplier,
  hasSkyLeap,
  isFormActive,
  revive,
  serializePowers,
  deserializePowers,
  spellStatus,
  tickPowers,
  unlockPowers,
} from '../src/gameplay/powerState.js';
import { POWER_UNLOCKS, SPELLS } from '../src/gameplay/spellData.js';

test('player starts with Ember Bolt and nothing else', () => {
  const state = createPowerState();
  assert.deepEqual(state.unlocked, ['emberBolt']);
  assert.equal(canCast(state, 'emberBolt').ok, true);
  assert.equal(canCast(state, 'frostNova').reason, 'locked');
});

test('casting spends mana and starts the cooldown', () => {
  const state = createPowerState();
  const result = castSpell(state, 'emberBolt');
  assert.equal(result.ok, true);
  assert.equal(state.mana, 90);
  assert.ok(state.cooldowns.emberBolt > 0);
  assert.equal(canCast(state, 'emberBolt').reason, 'cooldown');
});

test('cooldowns tick down and mana regenerates', () => {
  const state = createPowerState({ mana: 50 });
  castSpell(state, 'emberBolt');
  tickPowers(state, 0.2);
  assert.ok(state.cooldowns.emberBolt < SPELLS.emberBolt.cooldown);
  assert.ok(state.mana > 40);
});

test('insufficient mana blocks the cast', () => {
  const state = createPowerState({ mana: 2 });
  assert.equal(canCast(state, 'emberBolt').reason, 'mana');
});

test('infinite mana (master mode) ignores costs and never drains', () => {
  const state = createPowerState({ mana: 0, infinite: true });
  assert.equal(canCast(state, 'emberBolt').ok, true);
  const result = castSpell(state, 'emberBolt');
  assert.equal(result.ok, true);
  assert.equal(state.mana, 0, 'infinite casting must not go negative or spend');
  assert.equal(spellStatus(state, 'emberBolt').affordable, true);
  const saved = serializePowers(state);
  assert.equal('infinite' in saved, false, 'sandbox flag must never be saved');
  assert.equal(deserializePowers(saved).infinite, false);
});

test('shards unlock their spell and passive', () => {
  const state = createPowerState();
  const gained = unlockPowers(state, 'grove');
  assert.deepEqual(gained, POWER_UNLOCKS.grove);
  assert.equal(canCast(state, 'frostNova').ok, true);
  assert.equal(hasSkyLeap(state), true);
  assert.deepEqual(unlockPowers(state, 'grove'), [], 'no duplicate unlocks');
});

test('frost nova damages nothing by itself but consumes mana', () => {
  const state = createPowerState();
  unlockPowers(state, 'grove');
  const before = state.mana;
  assert.equal(castSpell(state, 'frostNova').ok, true);
  assert.equal(state.mana, before - SPELLS.frostNova.manaCost);
});

test('aegis creates a shield that absorbs damage first', () => {
  const state = createPowerState();
  unlockPowers(state, 'peak');
  castSpell(state, 'aegis');
  assert.equal(state.shieldHp, SPELLS.aegis.shield);
  const result = applyDamage(state, 30);
  assert.equal(result.absorbed, 30);
  assert.equal(result.healthLost, 0);
  assert.equal(state.health, state.maxHealth);
});

test('shield expires and stops absorbing', () => {
  const state = createPowerState();
  unlockPowers(state, 'peak');
  castSpell(state, 'aegis');
  tickPowers(state, SPELLS.aegis.duration + 0.1);
  assert.equal(state.shieldHp, 0);
  const result = applyDamage(state, 20);
  assert.equal(result.healthLost, 20);
});

test('damage reduces health and can kill', () => {
  const state = createPowerState();
  applyDamage(state, 60);
  assert.equal(state.health, 40);
  const lethal = applyDamage(state, 100);
  assert.equal(lethal.dead, true);
  assert.equal(state.dead, true);
});

test('aether form boosts damage and speed, then expires', () => {
  const state = createPowerState({ mana: 100 });
  unlockPowers(state, 'peak');
  assert.equal(castSpell(state, 'aetherForm').ok, true);
  assert.equal(isFormActive(state), true);
  assert.ok(formDamageMultiplier(state) > 1);
  assert.equal(canCast(state, 'aetherForm').reason, 'active');
  tickPowers(state, SPELLS.aetherForm.duration + 0.1);
  assert.equal(isFormActive(state), false);
});

test('aether form is unavailable until unlocked', () => {
  const state = createPowerState();
  assert.equal(canCast(state, 'aetherForm').reason, 'locked');
});

test('stamina is spent and regenerated', () => {
  const state = createPowerState();
  assert.equal(consumeStamina(state, 40), true);
  assert.equal(state.stamina, 60);
  assert.equal(consumeStamina(state, 90), false, 'cannot overspend');
  tickPowers(state, 1);
  assert.ok(state.stamina > 60);
});

test('revive clears death and restores resources', () => {
  const state = createPowerState();
  applyDamage(state, 999);
  revive(state);
  assert.equal(state.dead, false);
  assert.equal(state.health, state.maxHealth);
  assert.ok(state.mana > 0);
});

test('spellStatus reflects unlock, mana and cooldown', () => {
  const state = createPowerState();
  const locked = spellStatus(state, 'frostNova');
  assert.equal(locked.unlocked, false);
  assert.equal(locked.ready, false);
  const ember = spellStatus(state, 'emberBolt');
  assert.equal(ember.ready, true);
});
