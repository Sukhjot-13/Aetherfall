/**
 * Pure boss rules for the first-draft finale: health phases, attack pacing,
 * telegraph lengths, damage scaling and arena containment.
 *
 * The visual/behavioural boss lives in `FinalBoss.js`; keeping the numbers here
 * means the encounter can be tuned and tested without a renderer.
 */

import { clamp, smoothstep } from '../util/math.js';

export const BOSS = Object.freeze({
  id: 'vaelor',
  name: 'Vaelor',
  title: 'The Veil Sovereign',
  maxHealth: 2100,
  armor: 7,
  arenaRadius: 25.5,
  /** Remaining-health ratios at which the boss changes phase. */
  phaseThresholds: Object.freeze([0.66, 0.33]),
  phaseCount: 3,
  phaseNames: Object.freeze(['The Veil Gathers', 'The Mask Cracks', 'The Sovereign Unbound']),
  attackCooldowns: Object.freeze([2.35, 1.95, 1.55]),
  projectileCounts: Object.freeze([3, 5, 9]),
  summonCaps: Object.freeze([0, 2, 3]),
  slamDamage: Object.freeze([26, 30, 34]),
  cleaveDamage: Object.freeze([22, 26, 30]),
  volleyDamage: Object.freeze([13, 15, 17]),
  riftDamage: Object.freeze([22, 26]),
});

/** 0..1 health ratio. */
export function healthRatio(health, maxHealth = BOSS.maxHealth) {
  if (!Number.isFinite(health) || !Number.isFinite(maxHealth) || maxHealth <= 0) return 0;
  return clamp(health / maxHealth, 0, 1);
}

/** Phase 1, 2 or 3 from current health. */
export function bossPhase(health, maxHealth = BOSS.maxHealth) {
  const ratio = healthRatio(health, maxHealth);
  if (ratio > BOSS.phaseThresholds[0]) return 1;
  if (ratio > BOSS.phaseThresholds[1]) return 2;
  return 3;
}

/** The phase after `phase` (clamped at 3). */
export function nextPhase(phase) {
  return clamp((phase ?? 1) + 1, 1, BOSS.phaseCount);
}

/** Health ratio at which a phase begins. */
export function phaseStartRatio(phase) {
  if (phase <= 1) return 1;
  return BOSS.phaseThresholds[Math.min(phase - 2, BOSS.phaseThresholds.length - 1)];
}

/** Seconds between attacks for a phase. */
export function attackCooldown(phase) {
  return BOSS.attackCooldowns[clamp((phase ?? 1) - 1, 0, 2)];
}

/** Number of orbs in a volley. */
export function volleyCount(phase) {
  return BOSS.projectileCounts[clamp((phase ?? 1) - 1, 0, 2)];
}

/** Number of telegraphed void rifts. */
export function riftCount(phase) {
  if (phase <= 1) return 0;
  return phase === 2 ? 3 : 5;
}

/** Number of adds summoned by a summon cast. */
export function summonCount(phase) {
  return BOSS.summonCaps[clamp((phase ?? 1) - 1, 0, 2)];
}

/** Damage for a slam / cleave / volley in the given phase. */
export function slamDamage(phase) {
  return BOSS.slamDamage[clamp((phase ?? 1) - 1, 0, 2)];
}

export function cleaveDamage(phase) {
  return BOSS.cleaveDamage[clamp((phase ?? 1) - 1, 0, 2)];
}

export function volleyDamage(phase) {
  return BOSS.volleyDamage[clamp((phase ?? 1) - 1, 0, 2)];
}

/** Telegraph window in seconds. Later phases are faster but not unreadable. */
export function telegraphDuration(kind, phase) {
  const p = clamp((phase ?? 1) - 1, 0, 2);
  switch (kind) {
    case 'cleave':
      return 0.82 - p * 0.13;
    case 'slam':
      return 1.05 - p * 0.13;
    case 'volley':
      return 0.58 - p * 0.07;
    case 'rifts':
      return 1.15 - p * 0.1;
    case 'storm':
      return 0.9 - p * 0.1;
    case 'summon':
      return 1.0 - p * 0.08;
    default:
      return 0.8;
  }
}

/** Armor rises slightly each phase, but never enough to make spells feel weak. */
export function bossArmor(phase) {
  return BOSS.armor + (clamp((phase ?? 1) - 1, 0, 2)) * 2;
}

/** Has the boss crossed into a new phase? */
export function shouldPhaseTransition(previous, next) {
  return Number.isFinite(previous) && Number.isFinite(next) && next > previous;
}

/**
 * Push a point back inside the arena. Returns the corrected XZ plus whether it
 * was outside, so the caller can add barrier feedback.
 */
export function clampToArena(x, z, centerX, centerZ, radius = BOSS.arenaRadius) {
  const dx = x - centerX;
  const dz = z - centerZ;
  const dist = Math.hypot(dx, dz);
  if (dist <= radius) return { x, z, outside: false };
  const scale = radius / (dist || 1);
  return { x: centerX + dx * scale, z: centerZ + dz * scale, outside: true };
}

/**
 * Attack pattern for a phase. Returns a deterministic sequence the boss cycles
 * through; a small amount of shuffle is applied by the caller using the seed.
 */
export function attackPattern(phase) {
  switch (phase) {
    case 1:
      return ['cleave', 'volley', 'slam', 'volley', 'cleave'];
    case 2:
      return ['rifts', 'cleave', 'summon', 'volley', 'slam', 'rifts'];
    case 3:
    default:
      return ['storm', 'slam', 'rifts', 'cleave', 'volley', 'storm', 'summon'];
  }
}

/** Glow colour shift as the Sovereign loses control. */
export function phaseColor(phase) {
  if (phase <= 1) return '#b48cff';
  if (phase === 2) return '#ff7ac8';
  return '#ff5a4a';
}

/** 0..1 enrage tint for the model/light. */
export function enrageAmount(phase) {
  return smoothstep(1, 3, phase);
}
