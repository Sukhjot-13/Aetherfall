/**
 * World pickups: floating Aether motes that refill mana and Emberblooms that
 * restore health. They respawn on a timer so exploration is never dead-ended.
 */

import * as THREE from 'three';
import { createRng } from '../util/rng.js';
import { LOCATIONS } from '../world/locations.js';
import { healPlayer, restoreMana } from './powerState.js';
import { createGlowTexture } from '../world/textures.js';

const MOTE_TEX = createGlowTexture(96, 'rgba(210, 245, 255, 1)', 'rgba(120, 200, 255, 0)');
const BLOOM_TEX = createGlowTexture(96, 'rgba(255, 235, 200, 1)', 'rgba(255, 140, 90, 0)');

const KINDS = {
  mote: {
    color: '#8fd8ff',
    coreColor: '#dff4ff',
    size: 1.15,
    mana: 22,
    respawn: 62,
    label: 'Aether mote',
  },
  bloom: {
    color: '#ffb066',
    coreColor: '#ffe9a8',
    size: 1.35,
    heal: 24,
    respawn: 95,
    label: 'Emberbloom',
  },
};

export class Collectibles {
  /**
   * @param {{scene:THREE.Scene, world:any, player:any, powers:any, effects:any, audio:any, onPickup?:Function}} deps
   */
  constructor({ scene, world, player, powers, effects, audio, onPickup }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.powers = powers;
    this.effects = effects;
    this.audio = audio;
    this.onPickup = onPickup ?? (() => {});

    this.group = new THREE.Group();
    this.group.name = 'Pickups';
    scene.add(this.group);

    /** @type {Array<any>} */
    this.items = [];
    this._build();
  }

  _build() {
    const rng = createRng(3345);
    let motes = 0;
    let blooms = 0;
    let guard = 0;

    while ((motes < 46 || blooms < 14) && guard < 4000) {
      guard++;
      const angle = rng.range(0, Math.PI * 2);
      const radius = Math.sqrt(rng.next()) * (this.world.islandRadius ?? 560) * 0.88;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const h = this.world.heightAt(x, z);
      if (h < 1.4 || h > 78) continue;
      if (this.world.slopeAt && this.world.slopeAt(x, z) > 0.55) continue;
      if (Math.hypot(x - LOCATIONS.spawn.x, z - LOCATIONS.spawn.z) < 14) continue;

      const kind = motes / 46 < blooms / 14 || blooms >= 14 ? 'mote' : 'bloom';
      if (kind === 'mote' && motes >= 46) continue;
      if (kind === 'bloom' && blooms >= 14) continue;
      if (kind === 'mote') motes++;
      else blooms++;
      this.items.push(this._create(kind, x, h, z, rng));
    }

    // Guaranteed refills near each shrine and the camp.
    for (const loc of [LOCATIONS.camp, ...LOCATIONS.shards]) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.6;
        const x = loc.x + Math.cos(a) * (loc.radius * 0.55);
        const z = loc.z + Math.sin(a) * (loc.radius * 0.55);
        const h = this.world.heightAt(x, z);
        if (h > 0.5) this.items.push(this._create('mote', x, h, z, rng));
      }
    }
  }

  _create(kind, x, y, z, rng) {
    const spec = KINDS[kind];
    const group = new THREE.Group();
    group.position.set(x, y + 1.05, z);

    const core = new THREE.Mesh(
      kind === 'mote'
        ? new THREE.OctahedronGeometry(0.16, 0)
        : new THREE.IcosahedronGeometry(0.15, 0),
      new THREE.MeshBasicMaterial({ color: spec.coreColor }),
    );
    group.add(core);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: kind === 'mote' ? MOTE_TEX : BLOOM_TEX,
        color: spec.color,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.scale.setScalar(spec.size);
    group.add(halo);

    if (kind === 'bloom') {
      for (let i = 0; i < 4; i++) {
        const petal = new THREE.Mesh(
          new THREE.ConeGeometry(0.07, 0.2, 4),
          new THREE.MeshStandardMaterial({ color: '#ff8a5c', emissive: '#5c1f0e', emissiveIntensity: 0.6 }),
        );
        const a = (i / 4) * Math.PI * 2;
        petal.position.set(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
        petal.rotation.z = Math.PI / 2;
        petal.rotation.y = -a;
        group.add(petal);
      }
    }

    this.group.add(group);
    return {
      kind,
      group,
      core,
      halo,
      baseY: y + 1.05,
      phase: rng.range(0, Math.PI * 2),
      active: true,
      respawn: 0,
      x,
      z,
    };
  }

  /**
   * Per-frame pickup check.
   * @param {number} dt
   * @param {number} elapsed
   */
  update(dt, elapsed) {
    const player = this.player.position;
    const powers = this.powers;

    for (const item of this.items) {
      if (!item.active) {
        item.respawn -= dt;
        if (item.respawn <= 0) {
          item.active = true;
          item.group.visible = true;
        }
        continue;
      }

      item.phase += dt;
      item.group.position.y = item.baseY + Math.sin(elapsed * 1.5 + item.phase) * 0.16;
      item.core.rotation.y += dt * 1.5;
      item.core.rotation.x += dt * 0.7;
      const pulse = 0.9 + Math.sin(elapsed * 2.6 + item.phase) * 0.12;
      item.halo.scale.setScalar(KINDS[item.kind].size * pulse);

      const dist = Math.hypot(item.group.position.x - player.x, item.group.position.z - player.z);
      if (dist > 1.9 || Math.abs(item.group.position.y - (player.y + 1)) > 2.4) continue;

      const spec = KINDS[item.kind];
      if (item.kind === 'mote') {
        if (powers.mana >= powers.maxMana - 0.5) continue;
        restoreMana(powers, spec.mana);
      } else {
        if (powers.health >= powers.maxHealth - 0.5) continue;
        healPlayer(powers, spec.heal);
      }

      item.active = false;
      item.group.visible = false;
      item.respawn = spec.respawn;

      const point = item.group.position.clone();
      this.effects.burst(point, {
        count: 18,
        color: spec.color,
        speed: 3.4,
        size: 0.3,
        life: 0.55,
        gravity: -1.2,
        drag: 2.2,
      });
      this.effects.ring(point, { color: spec.color, radius: 2.2, life: 0.4, tilt: 0 });
      this.audio?.pickup();
      this.onPickup(item.kind, spec);
    }
  }

  /** Hide/show every pickup (cutscenes). */
  setVisible(visible) {
    this.group.visible = visible;
  }

  /** Restore all pickups (new game). */
  reset() {
    for (const item of this.items) {
      item.active = true;
      item.group.visible = true;
      item.respawn = 0;
    }
  }
}
