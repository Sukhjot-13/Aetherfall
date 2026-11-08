/**
 * Authoritative magic/character state rules: mana, health, stamina, shields,
 * cooldowns and Aether Form. Mutating but dependency-free, so it is easy to
 * unit-test and impossible to bypass from the UI.
 */

import { clamp } from '../util/math.js';
import { getPower, isPassive, PASSIVES, SPELLS, STARTING_SPELLS, unlocksForShard } from './spellData.js';

export const MAX_HEALTH = 100;
export const MAX_MANA = 100;
export const MAX_STAMINA = 100;

const MANA_REGEN = 7;
const MANA_REGEN_FORM = 15;
const HEALTH_REGEN = 2.2;
const HEALTH_REGEN_DELAY = 6.5;
const STAMINA_REGEN = 24;
const STAMINA_RECOVERY_DELAY = 0.6;
const FORM_SPEED = 1.55;
const FORM_DAMAGE = 1.6;
const FORM_JUMP = 1.25;

/**
 * Create the player's power state.
 * @param {Partial<ReturnType<typeof createPowerState>>} [overrides]
 */
export function createPowerState(overrides = {}) {
  return {
    health: MAX_HEALTH,
    maxHealth: MAX_HEALTH,
    mana: MAX_MANA,
    maxMana: MAX_MANA,
    stamina: MAX_STAMINA,
    maxStamina: MAX_STAMINA,
    /** @type {string[]} */
    unlocked: [...STARTING_SPELLS],
    /** @type {Record<string, number>} remaining cooldown seconds */
    cooldowns: {},
    formRemaining: 0,
    formDuration: 0,
    shieldHp: 0,
    shieldRemaining: 0,
    /** Seconds until health regeneration resumes. */
    regenDelay: 0,
    staminaRegenDelay: 0,
    /** Master-mode sandbox flag: spells cost no mana. Never serialized. */
    infinite: false,
    dead: false,
    ...overrides,
  };
}

/** Is a spell or passive currently unlocked? */
export function hasPower(state, id) {
  return state.unlocked.includes(id);
}

/** Is the double-jump passive unlocked? */
export function hasSkyLeap(state) {
  return hasPower(state, 'skyLeap');
}

/**
 * Unlock everything tied to a shard.
 * @returns {string[]} newly unlocked power ids (empty if already known)
 */
export function unlockPowers(state, shardId) {
  const gained = [];
  for (const id of unlocksForShard(shardId)) {
    if (!state.unlocked.includes(id)) {
      state.unlocked.push(id);
      gained.push(id);
    }
  }
  return gained;
}

/**
 * Cooldown / affordability summary for the HUD.
 * @returns {{unlocked:boolean, cooldown:number, manaCost:number, affordable:boolean, ready:boolean}}
 */
export function spellStatus(state, id) {
  const spell = SPELLS[id];
  const cooldown = Math.max(0, state.cooldowns[id] ?? 0);
  const manaCost = spell?.manaCost ?? 0;
  const unlocked = hasPower(state, id);
  const free = Boolean(state.infinite);
  return {
    unlocked,
    cooldown,
    manaCost,
    affordable: free || state.mana >= manaCost,
    ready: unlocked && cooldown <= 0 && (free || state.mana >= manaCost),
  };
}

/**
 * Check whether a spell may be cast right now.
 * @returns {{ok:boolean, reason:string}}
 */
export function canCast(state, id) {
  const spell = SPELLS[id];
  if (!spell) return { ok: false, reason: 'unknown' };
  if (state.dead) return { ok: false, reason: 'dead' };
  if (!hasPower(state, id)) return { ok: false, reason: 'locked' };
  if (spell.kind === 'form' && state.formRemaining > 0) return { ok: false, reason: 'active' };
  if ((state.cooldowns[id] ?? 0) > 0) return { ok: false, reason: 'cooldown' };
  if (!state.infinite && state.mana < spell.manaCost) return { ok: false, reason: 'mana' };
  return { ok: true, reason: 'ready' };
}

/**
 * Spend mana and start the cooldown. Immediate state effects (shield/form)
 * are applied here so the rules stay in one place.
 * @returns {{ok:boolean, reason:string, spell:object|null}}
 */
export function castSpell(state, id) {
  const verdict = canCast(state, id);
  if (!verdict.ok) return { ...verdict, spell: null };
  const spell = SPELLS[id];
  if (!state.infinite) state.mana = clamp(state.mana - spell.manaCost, 0, state.maxMana);
  state.cooldowns[id] = spell.cooldown;
  if (spell.kind === 'shield') {
    state.shieldHp = spell.shield;
    state.shieldRemaining = spell.duration;
  }
  if (spell.kind === 'form') {
    state.formRemaining = spell.duration;
    state.formDuration = spell.duration;
  }
  return { ok: true, reason: 'cast', spell };
}

/** Advance regenerations, cooldowns, shield and form timers. */
export function tickPowers(state, dt, { inCombat = false } = {}) {
  const form = state.formRemaining > 0;
  state.mana = clamp(state.mana + (form ? MANA_REGEN_FORM : MANA_REGEN) * dt, 0, state.maxMana);
  const staminaDelay = Math.max(0, state.staminaRegenDelay ?? 0);
  state.staminaRegenDelay = Math.max(0, staminaDelay - dt);
  const recoveryTime = Math.max(0, dt - staminaDelay);
  state.stamina = clamp(state.stamina + STAMINA_REGEN * recoveryTime, 0, state.maxStamina);

  for (const id of Object.keys(state.cooldowns)) {
    const next = state.cooldowns[id] - dt;
    if (next <= 0) delete state.cooldowns[id];
    else state.cooldowns[id] = next;
  }

  if (state.formRemaining > 0) state.formRemaining = Math.max(0, state.formRemaining - dt);

  if (state.shieldRemaining > 0) {
    state.shieldRemaining = Math.max(0, state.shieldRemaining - dt);
    if (state.shieldRemaining === 0) state.shieldHp = 0;
  }

  state.regenDelay = Math.max(0, state.regenDelay - dt);
  if (state.regenDelay === 0 && !inCombat && state.health > 0) {
    state.health = clamp(state.health + HEALTH_REGEN * dt, 0, state.maxHealth);
  }
  if (state.health <= 0) state.dead = true;
  return state;
}

/**
 * Apply incoming damage, routing it through the shield first.
 * @returns {{absorbed:number, healthLost:number, dead:boolean}}
 */
export function applyDamage(state, amount) {
  const incoming = Math.max(0, amount);
  let absorbed = 0;
  if (state.shieldHp > 0) {
    absorbed = Math.min(state.shieldHp, incoming);
    state.shieldHp -= absorbed;
  }
  const healthLost = Math.max(0, incoming - absorbed);
  state.health = clamp(state.health - healthLost, 0, state.maxHealth);
  state.regenDelay = HEALTH_REGEN_DELAY;
  if (healthLost > 0 && state.formRemaining > 0) {
    // Aether Form shrugs off part of the blow but is not invulnerable.
    state.health = clamp(state.health + healthLost * 0.15, 0, state.maxHealth);
  }
  if (state.health <= 0) state.dead = true;
  return { absorbed, healthLost, dead: state.dead };
}

/** Heal, clamped to max. */
export function healPlayer(state, amount) {
  state.health = clamp(state.health + Math.max(0, amount), 0, state.maxHealth);
  return state.health;
}

/** Restore mana, clamped to max. */
export function restoreMana(state, amount) {
  state.mana = clamp(state.mana + Math.max(0, amount), 0, state.maxMana);
  return state.mana;
}

/** Try to spend stamina; returns true when the cost was paid. */
export function consumeStamina(state, amount) {
  if (state.stamina < amount) return false;
  state.stamina = clamp(state.stamina - amount, 0, state.maxStamina);
  if (amount > 0) state.staminaRegenDelay = STAMINA_RECOVERY_DELAY;
  return true;
}

/** Is Aether Form currently burning? */
export function isFormActive(state) {
  return state.formRemaining > 0;
}

/** Movement multiplier while transformed. */
export function formSpeedMultiplier(state) {
  return isFormActive(state) ? FORM_SPEED : 1;
}

/** Spell-damage multiplier while transformed. */
export function formDamageMultiplier(state) {
  return isFormActive(state) ? FORM_DAMAGE : 1;
}

/** Jump-impulse multiplier while transformed. */
export function formJumpMultiplier(state) {
  return isFormActive(state) ? FORM_JUMP : 1;
}

/** Revive at full-ish health after death. */
export function revive(state) {
  state.dead = false;
  state.health = state.maxHealth;
  state.mana = state.maxMana * 0.6;
  state.stamina = state.maxStamina;
  state.shieldHp = 0;
  state.shieldRemaining = 0;
  state.formRemaining = 0;
  state.regenDelay = 0;
  state.staminaRegenDelay = 0;
  return state;
}

/** Serialise only the durable parts of the power state for saves. */
export function serializePowers(state) {
  // Maxes are durable: mission rewards raise them (emberTrial +12 HP,
  // veilHunt +12 mana, lanternWay +10 stamina). They used to be dropped,
  // so Continue silently reset upgraded characters to base.
  return {
    unlocked: [...state.unlocked],
    health: state.health,
    mana: state.mana,
    stamina: state.stamina,
    maxHealth: state.maxHealth,
    maxMana: state.maxMana,
    maxStamina: state.maxStamina,
  };
}

/**
 * Rebuild a power state from a save, filtering unknown power ids.
 * @param {any} data
 */
export function deserializePowers(data = {}) {
  const state = createPowerState();
  const known = [...Object.keys(SPELLS), ...Object.keys(PASSIVES)];
  if (Array.isArray(data.unlocked)) {
    state.unlocked = data.unlocked.filter((id) => known.includes(id) || isPassive(id));
    if (!state.unlocked.includes('emberBolt')) state.unlocked.unshift('emberBolt');
  }
  // Maxes first (clamped to base..base+bonus ceiling), then currents.
  // Old saves lack maxes — they fall back to base and Game replays mission
  // rewards from quest state so those characters still upgrade.
  if (Number.isFinite(data.maxHealth)) state.maxHealth = clamp(data.maxHealth, MAX_HEALTH, MAX_HEALTH + 12);
  if (Number.isFinite(data.maxMana)) state.maxMana = clamp(data.maxMana, MAX_MANA, MAX_MANA + 12);
  if (Number.isFinite(data.maxStamina)) state.maxStamina = clamp(data.maxStamina, MAX_STAMINA, MAX_STAMINA + 10);
  if (Number.isFinite(data.health)) state.health = clamp(data.health, 1, state.maxHealth);
  if (Number.isFinite(data.mana)) state.mana = clamp(data.mana, 0, state.maxMana);
  if (Number.isFinite(data.stamina)) state.stamina = clamp(data.stamina, 0, state.maxStamina);
  return state;
}

/** Human-readable reason for a failed cast, used by toasts. */
export function castFailMessage(reason) {
  switch (reason) {
    case 'locked':
      return 'That power is still sealed.';
    case 'cooldown':
      return 'Still gathering aether.';
    case 'mana':
      return 'Not enough mana.';
    case 'active':
      return 'Aether Form is already burning.';
    case 'dead':
      return 'You are down.';
    default:
      return 'Nothing happens.';
  }
}

/** Name of a power id, with a safe fallback. */
export function powerName(id) {
  return getPower(id)?.name ?? id;
}
