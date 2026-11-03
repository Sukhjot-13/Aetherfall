/**
 * Spell catalogue and unlock table. Pure data + tiny lookup helpers.
 * Every spell is an "active magic" ability the player can cast with a hotkey.
 */

/**
 * @typedef {Object} Spell
 * @property {string} id
 * @property {string} name
 * @property {string} key Hotbar key label.
 * @property {string} school Flavour grouping.
 * @property {string} icon Glyph shown in the HUD.
 * @property {number} manaCost
 * @property {number} cooldown Seconds.
 * @property {string} kind projectile|nova|dash|beam|shield|form|cone|pierce|strike|barrage
 * @property {'lead'|'snap'|'strike'|'none'} [aim] How soft aim treats the spell.
 * @property {number} [projectileSpeed] Used to lead moving targets.
 * @property {string} color Primary FX colour.
 * @property {string} description
 */

/** @type {Record<string, Spell>} */
export const SPELLS = Object.freeze({
  emberBolt: Object.freeze({
    id: 'emberBolt',
    name: 'Ember Bolt',
    key: '1',
    school: 'Ember',
    icon: '✹',
    manaCost: 10,
    cooldown: 0.45,
    damage: 26,
    kind: 'projectile',
    aim: 'lead',
    projectileSpeed: 46,
    color: '#ff8a3d',
    description: 'Hurl a mote of living flame. Detonates on impact.',
  }),
  frostNova: Object.freeze({
    id: 'frostNova',
    name: 'Frost Nova',
    key: '2',
    school: 'Frost',
    icon: '❄',
    manaCost: 28,
    cooldown: 7,
    damage: 22,
    radius: 9.5,
    slow: 3.2,
    kind: 'nova',
    aim: 'none',
    color: '#7fdcff',
    description: 'A ring of killing cold. Damages and slows everything nearby.',
  }),
  galeDash: Object.freeze({
    id: 'galeDash',
    name: 'Gale Step',
    key: '3',
    school: 'Wind',
    icon: '➤',
    manaCost: 18,
    cooldown: 3.2,
    damage: 10,
    distance: 14,
    kind: 'dash',
    aim: 'none',
    color: '#9ef7d0',
    description: 'Become wind and surge forward, striking anything in the path.',
  }),
  stormLance: Object.freeze({
    id: 'stormLance',
    name: 'Storm Lance',
    key: '4',
    school: 'Storm',
    icon: '⚡',
    manaCost: 36,
    cooldown: 8,
    damage: 64,
    range: 40,
    chains: 2,
    kind: 'beam',
    aim: 'snap',
    color: '#b48cff',
    description: 'Call a spear of lightning that arcs between nearby foes.',
  }),
  aegis: Object.freeze({
    id: 'aegis',
    name: 'Aegis',
    key: '5',
    school: 'Aether',
    icon: '◈',
    manaCost: 30,
    cooldown: 15,
    shield: 80,
    duration: 9,
    kind: 'shield',
    aim: 'none',
    color: '#ffd27a',
    description: 'Wrap yourself in a shield that drinks incoming damage.',
  }),
  aetherForm: Object.freeze({
    id: 'aetherForm',
    name: 'Aether Form',
    key: '6',
    school: 'Aether',
    icon: '✧',
    manaCost: 85,
    cooldown: 45,
    duration: 12,
    kind: 'form',
    aim: 'none',
    color: '#ffe9a8',
    description: 'Let the Aether burn through you: faster, stronger, untethered.',
  }),
  rimeSpear: Object.freeze({
    id: 'rimeSpear',
    name: 'Rime Spear',
    key: '7',
    school: 'Frost',
    icon: '❈',
    manaCost: 26,
    cooldown: 4.5,
    damage: 34,
    range: 38,
    speed: 54,
    slow: 3,
    kind: 'pierce',
    aim: 'lead',
    projectileSpeed: 54,
    aimStrength: 0.82,
    color: '#9fe8ff',
    description: 'Hurl a spear of black ice that impales every foe in a line.',
  }),
  pyreWave: Object.freeze({
    id: 'pyreWave',
    name: 'Pyre Wave',
    key: '8',
    school: 'Ember',
    icon: '♨',
    manaCost: 24,
    cooldown: 5.5,
    damage: 30,
    range: 14,
    angle: 1.9,
    kind: 'cone',
    aim: 'snap',
    aimStrength: 0.6,
    color: '#ff6a2a',
    description: 'Unleash a rolling wall of flame that scorches a wide arc.',
  }),
  thunderfall: Object.freeze({
    id: 'thunderfall',
    name: 'Thunderfall',
    key: '9',
    school: 'Storm',
    icon: '☇',
    manaCost: 38,
    cooldown: 9,
    damage: 58,
    range: 45,
    radius: 5.5,
    delay: 0.32,
    kind: 'strike',
    aim: 'strike',
    aimStrength: 0.85,
    color: '#8fb4ff',
    description: 'Call a pillar of stormlight down on your aim. Heavy damage in a small radius.',
  }),
  aetherBarrage: Object.freeze({
    id: 'aetherBarrage',
    name: 'Aether Barrage',
    key: '0',
    school: 'Aether',
    icon: '⁂',
    manaCost: 34,
    cooldown: 7.5,
    damage: 16,
    count: 6,
    range: 46,
    speed: 38,
    kind: 'barrage',
    aim: 'lead',
    projectileSpeed: 38,
    aimStrength: 0.5,
    color: '#ffe9a8',
    description: 'Release six seeking motes of aether that hunt nearby foes.',
  }),
});

/** Hotbar display order. */
export const SPELL_ORDER = Object.freeze([
  'emberBolt',
  'frostNova',
  'galeDash',
  'stormLance',
  'aegis',
  'aetherForm',
  'rimeSpear',
  'pyreWave',
  'thunderfall',
  'aetherBarrage',
]);

/** Passive powers (movement abilities) unlocked alongside spells. */
export const PASSIVES = Object.freeze({
  skyLeap: Object.freeze({
    id: 'skyLeap',
    name: 'Sky Leap',
    icon: '⇧',
    description: 'Jump a second time while airborne.',
  }),
});

/**
 * Which powers each Aether Shard awakens.
 * @type {Record<string, ReadonlyArray<string>>}
 */
export const POWER_UNLOCKS = Object.freeze({
  grove: Object.freeze(['frostNova', 'skyLeap', 'rimeSpear']),
  ruins: Object.freeze(['galeDash', 'stormLance', 'pyreWave']),
  peak: Object.freeze(['aegis', 'aetherForm', 'thunderfall', 'aetherBarrage']),
});

/** Spells the player begins with. */
export const STARTING_SPELLS = Object.freeze(['emberBolt']);

/** Look up a spell or passive by id. */
export function getPower(id) {
  return SPELLS[id] ?? PASSIVES[id] ?? null;
}

/** True when `id` names a known spell. */
export function isSpell(id) {
  return Object.prototype.hasOwnProperty.call(SPELLS, id);
}

/** True when `id` names a known passive. */
export function isPassive(id) {
  return Object.prototype.hasOwnProperty.call(PASSIVES, id);
}

/** All power ids granted by a shard (empty for unknown shards). */
export function unlocksForShard(shardId) {
  return POWER_UNLOCKS[shardId] ?? [];
}
