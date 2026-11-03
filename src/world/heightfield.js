/**
 * Procedural island heightfield.
 *
 * The same analytic function drives both the rendered terrain mesh and
 * collision, so the player can never disagree with the ground. Pure module:
 * no three.js, no DOM, fully testable.
 */

import { clamp, lerp, smoothstep } from '../util/math.js';
import { fbm2, ridged2 } from '../util/noise.js';
import { FLATTEN_ZONES, WORLD } from './locations.js';

/**
 * @typedef {Object} Heightfield
 * @property {(x:number,z:number)=>number} height Ground height including flattening.
 * @property {(x:number,z:number)=>number} rawHeight Pre-flattening ground height.
 * @property {(x:number,z:number,eps?:number)=>{x:number,y:number,z:number}} normal Surface normal.
 * @property {(x:number,z:number)=>number} slope 0 (flat) .. 1 (vertical).
 * @property {(x:number,z:number)=>string} biome water|sand|grass|rock|snow.
 * @property {(x:number,z:number)=>boolean} isLand
 * @property {number} waterLevel
 * @property {number} islandRadius
 * @property {Array} zones Resolved flatten zones (with target heights).
 * @property {number} seed
 */

/**
 * Build a heightfield sampler.
 * @param {{seed?:number, world?:typeof WORLD, zones?:ReadonlyArray<any>}} [options]
 * @returns {Heightfield}
 */
export function createHeightfield(options = {}) {
  const seed = options.seed ?? WORLD.seed;
  const world = options.world ?? WORLD;
  const islandRadius = world.islandRadius;
  const waterLevel = world.waterLevel;

  /**
   * Raw terrain before any POI flattening. Continent-scale rolling hills, a
   * north-south mountain spine and a smooth coastal shelf.
   */
  function rawHeight(x, z) {
    const continent = fbm2(x * 0.0017 + seed * 0.00011, z * 0.0017 - seed * 0.00007, 4, seed);
    const hills = fbm2(x * 0.0042, z * 0.0042, 3, seed + 11) * 9;
    const ridge = ridged2(x * 0.0019 + 3.1, z * 0.0019 - 1.7, 4, seed + 23);
    const north = smoothstep(80, -380, z);
    const mountain = Math.pow(ridge, 1.55) * 205 * (0.14 + 0.86 * north);
    const base = 5 + continent * 30 + hills * 1.15 + mountain;

    const d = Math.hypot(x, z) / islandRadius;
    const mask = 1 - smoothstep(0.6, 1.04, d);
    const land = Math.pow(mask, 2.15);
    const sea = Math.pow(1 - mask, 1.55);

    // Two low-frequency waves keep the coastline from reading as a perfect disc.
    const coastWobble =
      (fbm2(x * 0.004 + 21.7, z * 0.004 - 8.3, 3, seed + 71) * 0.5 + 0.5) * 5.5;

    return base * land - (13 + coastWobble) * sea;
  }

  const zones = (options.zones ?? FLATTEN_ZONES).map((zone) => ({
    ...zone,
    targetHeight: zone.targetHeight ?? rawHeight(zone.x, zone.z),
  }));

  /** Final ground height: raw terrain blended toward every flatten zone. */
  function height(x, z) {
    let h = rawHeight(x, z);
    for (const zone of zones) {
      const d = Math.hypot(x - zone.x, z - zone.z);
      if (d > zone.radius) continue;
      const inner = zone.radius * (zone.inner ?? 0.55);
      const w = 1 - smoothstep(inner, zone.radius, d);
      h = lerp(h, zone.targetHeight, w);
    }
    return h;
  }

  /** Analytic-ish surface normal via central differences. */
  function normal(x, z, eps = 1.2) {
    const hL = height(x - eps, z);
    const hR = height(x + eps, z);
    const hD = height(x, z - eps);
    const hU = height(x, z + eps);
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * eps;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /** 0 = perfectly flat, 1 = vertical cliff. */
  function slope(x, z) {
    return clamp(1 - normal(x, z).y, 0, 1);
  }

  /** Biome classification used for colouring, scatter rules and footstep FX. */
  function biome(x, z) {
    const h = height(x, z);
    if (h < waterLevel - 0.1) return 'water';
    if (h < 2.7) return 'sand';
    if (slope(x, z) > 0.62) return 'rock';
    if (h > 82) return 'snow';
    return 'grass';
  }

  return {
    seed,
    waterLevel,
    islandRadius,
    zones,
    rawHeight,
    height,
    normal,
    slope,
    biome,
    isLand: (x, z) => height(x, z) > waterLevel + 0.15,
  };
}
