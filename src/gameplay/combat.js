/**
 * Pure combat maths shared by spells and enemies: explosion falloff, chain
 * targeting, slow stacking and damage mitigation. No three.js, fully testable.
 */

import { clamp } from '../util/math.js';

/**
 * Damage multiplier for an explosion at `distance` from the centre.
 * Full damage inside 35% of the radius, then quadratic falloff to a 30% floor.
 * @param {number} distance
 * @param {number} radius
 * @returns {number} 0..1
 */
export function explosionFalloff(distance, radius) {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0) return 0;
  if (distance <= radius * 0.35) return 1;
  if (distance >= radius) return 0;
  const t = (distance - radius * 0.35) / (radius * 0.65);
  return clamp(1 - t * t, 0, 1);
}

/**
 * Final damage after a flat armour value, never below 15% of the raw hit.
 * @param {number} amount
 * @param {number} armor
 */
export function mitigate(amount, armor = 0) {
  const raw = Math.max(0, amount);
  const flat = Math.max(0, armor);
  return Math.max(raw * 0.15, raw - flat);
}

/**
 * Pick up to `maxTargets` candidates nearest to `origin`, optionally biased
 * toward a forward direction. Used by Storm Lance chaining.
 * @param {{x:number,z:number}} origin
 * @param {Array<{x:number,z:number,alive?:boolean}>} candidates
 * @param {{range?:number, maxTargets?:number, dir?:{x:number,z:number}, cone?:number}} [opts]
 */
export function pickChainTargets(origin, candidates, opts = {}) {
  const range = opts.range ?? 40;
  const maxTargets = opts.maxTargets ?? 3;
  const dir = opts.dir ?? null;
  const cone = opts.cone ?? -1;

  const scored = [];
  for (const candidate of candidates) {
    if (candidate.alive === false) continue;
    const dx = candidate.x - origin.x;
    const dz = candidate.z - origin.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range) continue;
    if (dir && cone > -1) {
      const len = Math.hypot(dir.x, dir.z) || 1;
      const dot = (dx * dir.x + dz * dir.z) / (len * dist || 1);
      if (dot < cone) continue;
    }
    scored.push({ candidate, dist });
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, maxTargets).map((s) => s.candidate);
}

/**
 * Effective slow multiplier after stacking. Each slow is {factor, remaining}.
 * The strongest slow wins; durations do not stack beyond the longest.
 * @param {Array<{factor:number, remaining:number}>} slows
 */
export function combineSlows(slows) {
  let factor = 1;
  let remaining = 0;
  for (const slow of slows ?? []) {
    if (!slow || slow.remaining <= 0) continue;
    factor = Math.min(factor, clamp(slow.factor, 0.15, 1));
    remaining = Math.max(remaining, slow.remaining);
  }
  return { factor, remaining };
}

/**
 * Advance a status list, dropping expired entries.
 * @param {Array<{factor:number, remaining:number}>} slows
 * @param {number} dt
 */
export function tickSlows(slows, dt) {
  if (!Array.isArray(slows)) return [];
  const next = [];
  for (const slow of slows) {
    const remaining = slow.remaining - dt;
    if (remaining > 0) next.push({ factor: slow.factor, remaining });
  }
  return next;
}

/**
 * Knockback impulse vector away from an impact point, with vertical lift.
 * @param {{x:number,y:number,z:number}} target
 * @param {{x:number,y:number,z:number}} source
 * @param {number} strength
 */
export function knockbackVector(target, source, strength = 6) {
  const dx = target.x - source.x;
  const dz = target.z - source.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    x: (dx / len) * strength,
    y: Math.max(1.4, strength * 0.34),
    z: (dz / len) * strength,
  };
}

/**
 * Aggregate damage for a single enemy after multipliers, rounded.
 * @param {number} base
 * @param {{damage?:number, falloff?:number, crit?:number}} [mods]
 */
export function computeDamage(base, mods = {}) {
  const amount = Math.max(0, base) * (mods.damage ?? 1) * (mods.falloff ?? 1) * (mods.crit ?? 1);
  return Math.max(1, Math.round(amount));
}

/**
 * Health ratio in 0..1, safe for zero max health.
 * @param {number} hp
 * @param {number} max
 */
export function healthRatio(hp, max) {
  if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return 0;
  return clamp(hp / max, 0, 1);
}
