/**
 * The world facade: builds and owns the terrain, sky, ocean, vegetation and
 * landmarks, and exposes the queries gameplay needs (height, biome, colliders,
 * time of day). Also sequences the loading screen steps.
 */

import * as THREE from 'three';
import { createHeightfield } from './heightfield.js';
import { WORLD } from './locations.js';
import { Terrain } from './Terrain.js';
import { Sky } from './Sky.js';
import { Water } from './Water.js';
import { Vegetation } from './Vegetation.js';
import { Structures } from './Structures.js';
import { CollisionGrid } from './CollisionGrid.js';

/** Yield to the browser so the loading screen can repaint. */
function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // Yield to the compositor when possible so the loading bar repaints...
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    // ...but never depend on it: requestAnimationFrame is throttled or suspended
    // in a background tab, which used to stall the whole world build forever.
    setTimeout(finish, 32);
  });
}

export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} quality Quality preset from settings.js
   */
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.heightfield = createHeightfield();
    this.terrain = null;
    this.sky = null;
    this.water = null;
    this.vegetation = null;
    this.structures = null;
    this.colliders = [];
    this.islandRadius = WORLD.islandRadius;
    this.waterLevel = WORLD.waterLevel;
    this.elapsed = 0;
  }

  /**
   * Build the island, reporting progress to the loading screen.
   * Everything here is procedural (no async asset fetches), so the bar is
   * honest: each step is real work, yielded between steps so it repaints.
   * @param {(progress:number, label:string)=>void} [onProgress]
   */
  /** Wall-clock ms of the last build (terrain→colliders). */
  buildMs = 0;
  /** Per-step ms of the last build, for boot-timing comparison. */
  buildSteps = [];

  async build(onProgress = () => {}) {
    const start = performance.now();
    this.buildSteps = [];
    const steps = [
      ['Raising mountains…', async () => {
        this.terrain = new Terrain(this.scene, this.heightfield, this.quality);
        await this.terrain.build(undefined, nextFrame);
      }],
      ['Lighting the sky…', () => {
        this.sky = new Sky(this.scene, this.renderer, this.quality);
      }],
      ['Filling the sea…', () => {
        this.water = new Water(this.scene, this.heightfield, this.quality);
        this.water.build();
      }],
      ['Growing the wilds…', () => {
        this.vegetation = new Vegetation(this.scene, this.heightfield, this.quality);
        this.vegetation.build();
      }],
      ['Raising the Beacon…', () => {
        this.structures = new Structures(this.scene, this.heightfield);
        this.structures.build();
      }],
      ['Gathering aether…', () => {
        this.colliders = [...this.vegetation.colliders, ...this.structures.colliders];
        this.collisionGrid = new CollisionGrid(this.colliders);
      }],
    ];

    let lastYield = performance.now();
    for (let i = 0; i < steps.length; i++) {
      const [label, run] = steps[i];
      onProgress(i / steps.length, label);
      // Let the current label paint before a heavy step, including the first.
      if (i === 0 || performance.now() - lastYield >= 12) {
        await nextFrame();
        lastYield = performance.now();
      }
      const stepStart = performance.now();
      await run();
      this.buildSteps.push({ label, ms: performance.now() - stepStart });
      onProgress((i + 1) / steps.length, label);
    }
    onProgress(1, 'The isle is ready.');
    this.buildMs = performance.now() - start;
    return this;
  }

  /** Nearby solid props, with invisible quality-tier trees excluded. */
  queryColliders(x, z, radius = 0) {
    return this.collisionGrid?.query(x, z, radius) ?? this.colliders.filter((c) => c.active !== false);
  }

  /** Ground height at a world XZ. */
  heightAt(x, z) {
    return this.heightfield.height(x, z);
  }

  /** Raw height before POI flattening. */
  rawHeightAt(x, z) {
    return this.heightfield.rawHeight(x, z);
  }

  /** 0 (flat) .. 1 (vertical). */
  slopeAt(x, z) {
    return this.heightfield.slope(x, z);
  }

  /** water | sand | grass | rock | snow */
  biomeAt(x, z) {
    return this.heightfield.biome(x, z);
  }

  /** Is a world position on dry land? */
  isLand(x, z) {
    return this.heightfield.isLand(x, z);
  }

  /** Current decimal hour. */
  get timeOfDay() {
    return this.sky?.timeOfDay ?? WORLD.startHour;
  }

  /** Jump the clock. */
  setTimeOfDay(hours) {
    this.sky?.setTimeOfDay(hours);
  }

  /** Is it night? */
  get nightFactor() {
    return this.sky?.nightFactor ?? 0;
  }

  /** Shard shrine registry (id -> visual site). */
  get shardSites() {
    return this.structures?.shardSites ?? new Map();
  }

  /** Altar interaction anchor. */
  get altar() {
    return this.structures?.altar ?? null;
  }

  /**
   * Per-frame world animation.
   * @param {number} dt
   * @param {THREE.Vector3} cameraPos
   * @param {THREE.Vector3} playerPos
   * @param {{advance?:boolean}} [opts]
   */
  update(dt, cameraPos, playerPos, opts = {}) {
    this.elapsed += dt;
    const advance = opts.advance !== false;
    this.sky?.update(dt, cameraPos, playerPos, advance);
    this.water?.update(this.elapsed, this.sky);
    this.terrain?.update?.(playerPos);
    this.vegetation?.update(dt, this.elapsed, playerPos, this.sky?.nightFactor ?? 0);
    this.structures?.update(dt, this.elapsed, playerPos);
  }

  /** Light the Beacon for good. */
  restoreBeacon() {
    this.structures?.restoreBeacon();
    this.sky?.setRestored(true);
  }

  /** Is the Beacon lit? */
  get beaconRestored() {
    return Boolean(this.structures?.restored);
  }

  /** Apply a new quality preset at runtime. */
  setQuality(preset) {
    this.quality = preset;
    this.terrain?.setQuality(preset);
    this.sky?.setQuality(preset);
    this.vegetation?.setQuality(preset);
    this.structures?.setQuality(preset);
  }
}
