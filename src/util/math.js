/**
 * Small, dependency-free math helpers used across the simulation.
 * Everything here is pure so it can be unit-tested in Node.
 */

export const TAU = Math.PI * 2;

/** Clamp `v` into the inclusive range [min, max]. */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Inverse lerp, clamped to [0, 1]. */
export function invLerp(a, b, v) {
  if (a === b) return 0;
  return clamp((v - a) / (b - a), 0, 1);
}

/** Hermite smoothstep between two edges. */
export function smoothstep(edge0, edge1, x) {
  const t = invLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

/** Quintic smootherstep between two edges. */
export function smootherstep(edge0, edge1, x) {
  const t = invLerp(edge0, edge1, x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Frame-rate independent exponential damping. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Wrap an angle into [-PI, PI]. */
export function wrapAngle(angle) {
  return (((angle + Math.PI) % TAU) + TAU) % TAU - Math.PI;
}

/** Frame-rate independent angular damping across the shortest arc. */
export function dampAngle(current, target, lambda, dt) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

/** Squared 2D distance (avoids a sqrt in hot loops). */
export function distSq2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** 2D distance. */
export function dist2D(ax, az, bx, bz) {
  return Math.sqrt(distSq2D(ax, az, bx, bz));
}

/** Random float in [min, max) from a supplied RNG function. */
export function randomRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Random integer in [min, max] from a supplied RNG function. */
export function randomInt(rng, min, max) {
  return Math.floor(min + rng() * (max - min + 1));
}

/** Pick a random element from an array. */
export function pick(rng, array) {
  return array[Math.floor(rng() * array.length) % array.length];
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** Format a decimal hour (0..24) as a 24h clock string. */
export function formatClock(hours) {
  const h = ((hours % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Convert seconds to m:ss. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
