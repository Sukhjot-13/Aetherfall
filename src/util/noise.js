/**
 * Deterministic value-noise toolkit. No dependencies, no allocations in the
 * hot path. Used for terrain, texture generation and scatter placement.
 */

import { clamp, lerp, smootherstep } from './math.js';

/**
 * Integer hash producing a float in [0, 1). Stable across runs/platforms.
 * @param {number} x integer
 * @param {number} y integer
 * @param {number} seed integer
 */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Hash a single integer to [0, 1). */
export function hash1(x, seed = 0) {
  return hash2(x, 0x9e3779b9, seed);
}

/**
 * Smooth 2D value noise in [0, 1).
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 */
export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smootherstep(0, 1, xf);
  const v = smootherstep(0, 1, yf);

  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);

  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Signed value noise in [-1, 1]. */
export function signedNoise2(x, y, seed = 0) {
  return valueNoise2(x, y, seed) * 2 - 1;
}

/**
 * Fractal Brownian motion, normalised to roughly [-1, 1].
 * @param {number} x
 * @param {number} y
 * @param {number} octaves
 * @param {number} seed
 * @param {number} lacunarity
 * @param {number} gain
 */
export function fbm2(x, y, octaves = 4, seed = 0, lacunarity = 2, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += signedNoise2(x * frequency, y * frequency, seed + i * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Ridged multifractal noise in [0, 1] — good for mountain crests.
 */
export function ridged2(x, y, octaves = 4, seed = 0) {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(signedNoise2(x * frequency, y * frequency, seed + i * 733));
    sum += n * n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return clamp(norm > 0 ? sum / norm : 0, 0, 1);
}

/**
 * Domain-warped fbm — produces more organic, less grid-aligned shapes.
 */
export function warpedFbm2(x, y, octaves = 4, seed = 0) {
  const wx = fbm2(x + 5.2, y + 1.3, 2, seed + 41) * 0.8;
  const wy = fbm2(x - 3.7, y + 9.1, 2, seed + 97) * 0.8;
  return fbm2(x + wx, y + wy, octaves, seed);
}
