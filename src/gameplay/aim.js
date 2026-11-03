/**
 * Pure soft-aim helpers. The player still aims with the camera, but a spell
 * fired inside a narrow cone can snap toward a living enemy. Directed spells
 * lead moving targets: the shot is aimed at the point the target will occupy
 * when the projectile arrives, not at the target's current centre.
 */

import { clamp } from '../util/math.js';

const DEFAULT_RANGE = 70;
const DEFAULT_CONE = 0.32; // radians (~18°)
const DEFAULT_STRENGTH = 0.7;
const DEFAULT_MAX_LEAD = 2.2;

/** Convert player-facing aim settings (degrees, multiplier) to runtime values. */
export function aimConfig({ enabled = true, cone = 18, strength = 1 } = {}) {
  return {
    enabled: Boolean(enabled),
    cone: clamp(Number.isFinite(cone) ? cone : 18, 2, 45) * (Math.PI / 180),
    strength: clamp(Number.isFinite(strength) ? strength : 1, 0, 1.5),
  };
}

/** Chest-ish aim point above an enemy's root. */
export function aimPoint(enemy) {
  const p = enemy.position;
  return {
    x: p.x,
    y: p.y + (enemy.hitHeight ?? 1.1) * 0.7,
    z: p.z,
  };
}

/** Unit vector, with a safe forward fallback. */
function unit(direction) {
  const len = Math.hypot(direction?.x ?? 0, direction?.y ?? 0, direction?.z ?? 0);
  if (len < 1e-6) return { x: 0, y: 0, z: -1 };
  return { x: direction.x / len, y: direction.y / len, z: direction.z / len };
}

/**
 * Solve the intercept time for a projectile launched from `origin` at
 * `speed` toward a target point moving at constant `velocity`.
 *
 * Returns the target's future position, clamped to `maxLead` seconds. When no
 * intercept exists (target faster than the projectile, zero speed, or bad
 * input) the current point is returned so aim still degrades gracefully.
 *
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} point
 * @param {{x:number,y:number,z:number}|null|undefined} velocity
 * @param {number} speed
 * @param {number} [maxLead]
 * @returns {{x:number,y:number,z:number}}
 */
export function predictIntercept(origin, point, velocity, speed, maxLead = DEFAULT_MAX_LEAD) {
  if (!origin || !point) return point ?? { x: 0, y: 0, z: 0 };
  const vx = Number.isFinite(velocity?.x) ? velocity.x : 0;
  const vy = Number.isFinite(velocity?.y) ? velocity.y : 0;
  const vz = Number.isFinite(velocity?.z) ? velocity.z : 0;
  const s = Number.isFinite(speed) && speed > 0 ? speed : 0;
  if (s <= 0) return { x: point.x, y: point.y, z: point.z };

  const px = point.x - origin.x;
  const py = point.y - origin.y;
  const pz = point.z - origin.z;
  const v2 = vx * vx + vy * vy + vz * vz;
  const a = s * s - v2;
  const b = px * vx + py * vy + pz * vz;
  const c = px * px + py * py + pz * pz;

  let t = 0;
  if (a > 1e-6) {
    const disc = b * b + a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t1 = (b + root) / a;
      const t2 = (b - root) / a;
      t = Math.max(t1, t2);
    }
  }
  if (!(t > 0)) return { x: point.x, y: point.y, z: point.z };
  t = Math.min(t, Math.max(0, maxLead));
  return {
    x: point.x + vx * t,
    y: point.y + vy * t,
    z: point.z + vz * t,
  };
}

/**
 * Pick the most promising living enemy inside the aim cone.
 *
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} direction
 * @param {Array<{position:{x:number,y:number,z:number}, alive?:boolean, hitHeight?:number, isBoss?:boolean, velocity?:{x:number,y:number,z:number}}>} enemies
 * @param {{range?:number, cone?:number, bossBias?:number, filter?:Function}} [opts]
 * @returns {object|null}
 */
export function pickAimTarget(origin, direction, enemies, opts = {}) {
  if (!origin || !direction || !Array.isArray(enemies)) return null;
  const d = unit(direction);
  if (Math.hypot(direction.x, direction.y, direction.z) < 1e-6) return null;
  const range = opts.range ?? DEFAULT_RANGE;
  const minDot = Math.cos(opts.cone ?? DEFAULT_CONE);
  const bossBias = opts.bossBias ?? 8;
  const filter = typeof opts.filter === 'function' ? opts.filter : null;

  let best = null;
  let bestScore = -Infinity;
  for (const enemy of enemies) {
    if (!enemy || enemy.alive === false || !enemy.position) continue;
    const point = aimPoint(enemy);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const dz = point.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.6 || dist > range) continue;
    const dot = (dx * d.x + dy * d.y + dz * d.z) / dist;
    if (dot < minDot) continue;
    if (filter && !filter(enemy, point)) continue;
    // Centre-of-cone and proximity win; bosses get a small nudge so the big
    // target is not stolen by an add standing in front of it.
    const score = dot * 100 - dist * 0.06 + (enemy.isBoss ? bossBias : 0);
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/**
 * Blend a raw aim direction toward a target point.
 * @param {{x:number,y:number,z:number}} direction
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} point
 * @param {number} strength
 */
function blendTowards(direction, origin, point, strength) {
  const raw = unit(direction);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return raw;
  const s = clamp(strength, 0, 1);
  const x = raw.x * (1 - s) + (dx / len) * s;
  const y = raw.y * (1 - s) + (dy / len) * s;
  const z = raw.z * (1 - s) + (dz / len) * s;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

/**
 * Full aim solution for a directed spell.
 *
 * @param {{x:number,y:number,z:number}} direction Raw camera aim.
 * @param {{x:number,y:number,z:number}} origin Spell origin.
 * @param {object|null} target Selected enemy, or null for a free shot.
 * @param {{strength?:number, projectileSpeed?:number, maxLead?:number, point?:{x:number,y:number,z:number}}} [opts]
 * @returns {{direction:{x:number,y:number,z:number}, point:{x:number,y:number,z:number}|null, lead:number}}
 */
export function solveAim(direction, origin, target, opts = {}) {
  const raw = unit(direction);
  if (!origin) return { direction: raw, point: null, lead: 0 };
  if (!target || !target.position) return { direction: raw, point: null, lead: 0 };

  const base = aimPoint(target);
  const speed = opts.projectileSpeed ?? 0;
  const point = speed > 0
    ? predictIntercept(origin, base, target.velocity, speed, opts.maxLead ?? DEFAULT_MAX_LEAD)
    : base;
  const strength = opts.strength ?? DEFAULT_STRENGTH;
  return {
    direction: blendTowards(raw, origin, point, strength),
    point,
    lead: Math.max(0, Math.hypot(point.x - base.x, point.y - base.y, point.z - base.z)),
  };
}

/**
 * Blend the raw aim direction toward a target. `strength` 0 leaves the shot
 * untouched; 1 fully homes the direction at the (predicted) target point.
 *
 * @param {{x:number,y:number,z:number}} direction
 * @param {{x:number,y:number,z:number}} origin
 * @param {object|null} target
 * @param {number} [strength]
 * @param {{projectileSpeed?:number, maxLead?:number}} [opts]
 * @returns {{x:number,y:number,z:number}} unit vector
 */
export function assistedDirection(direction, origin, target, strength = DEFAULT_STRENGTH, opts = {}) {
  if (!target || !origin || !target.position) return unit(direction);
  return solveAim(direction, origin, target, {
    strength,
    projectileSpeed: opts.projectileSpeed,
    maxLead: opts.maxLead,
  }).direction;
}

/**
 * Cheap heightfield line-of-sight check for soft aim. Samples the terrain
 * between the spell origin and the target point; if the ray dips below the
 * ground (plus a small clearance) the target is behind a hill and must not
 * steal the aim assist.
 *
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} point
 * @param {(x:number,z:number)=>number} heightAt
 * @param {{samples?:number, clearance?:number}} [opts]
 * @returns {boolean}
 */
export function hasLineOfSight(origin, point, heightAt, opts = {}) {
  if (!origin || !point || typeof heightAt !== 'function') return true;
  const samples = Math.max(2, Math.round(opts.samples ?? 10));
  const clearance = opts.clearance ?? 0.35;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const x = origin.x + (point.x - origin.x) * t;
    const y = origin.y + (point.y - origin.y) * t;
    const z = origin.z + (point.z - origin.z) * t;
    const ground = heightAt(x, z);
    if (Number.isFinite(ground) && y < ground + clearance) return false;
  }
  return true;
}
