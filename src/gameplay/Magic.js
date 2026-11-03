/**
 * Spell execution: projectiles, novas, dashes, chain lightning, shields and
 * the Aether Form burst. Owns its own FX objects and asks the pure power state
 * for permission to cast, so UI shortcuts can never bypass mana/cooldowns.
 */

import * as THREE from 'three';
import { SPELLS } from './spellData.js';
import { canCast, castSpell, formDamageMultiplier, isFormActive } from './powerState.js';
import { computeDamage, explosionFalloff, pickChainTargets } from './combat.js';
import {
  aimConfig,
  assistedDirection,
  hasLineOfSight,
  pickAimTarget,
  predictIntercept,
  solveAim,
} from './aim.js';
import { createFlameTexture, createGlowTexture } from '../world/textures.js';

const EMBER_SPEED = 46;
const EMBER_LIFE = 2.4;

export class Magic {
  /**
   * @param {{scene:THREE.Scene, world:any, player:any, powers:any, enemies:any, effects:any, audio:any, camera?:any, onHit?:Function}} deps
   */
  constructor({ scene, world, player, powers, enemies, effects, audio, camera, onHit }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.powers = powers;
    this.enemies = enemies;
    this.effects = effects;
    this.audio = audio;
    this.camera = camera;
    /** Optional callback fired whenever a spell connects (UI hit marker). */
    this.onHit = onHit ?? (() => {});

    /** @type {Array<any>} */
    this.projectiles = [];
    this.dash = { time: 0, hit: new Set(), radius: 2.3, damage: 10 };
    this.lastCast = null;
    this.shieldPulse = 0;
    /** Soft aim assist for directed spells (projectile / beam / strike). */
    const aimDefaults = aimConfig();
    this.aimAssist = aimDefaults.enabled;
    this.aimCone = aimDefaults.cone;
    this.aimStrength = aimDefaults.strength;
    /** Enemy the last cast snapped toward, for HUD feedback. */
    this.aimTarget = null;
    /** Seconds the target-lock indicator remains visible. */
    this.aimLockTimer = 0;
    /** Predicted impact point of the last assisted cast. */
    this.aimPoint = null;
    /** How far the last shot led its target, in metres. */
    this.aimLead = 0;
    /** Piercing ice spears, seeking aether motes and pending storm strikes. */
    this.pierce = [];
    this.barrage = [];
    this.strikes = [];

    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();

    this._buildShield();
    this._buildProjectilePool();
    this._buildPiercePool();
    this._buildBarragePool();
    this._buildPyrePool();
    this._buildAimMarker();
  }

  /** Translucent bubble shown while Aegis is up. */
  _buildShield() {
    const group = new THREE.Group();
    group.name = 'AegisShield';
    group.visible = false;

    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.15, 3),
      new THREE.MeshBasicMaterial({
        color: '#ffd98a',
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    const lattice = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.2, 1),
      new THREE.MeshBasicMaterial({
        color: '#ffe9a8',
        wireframe: true,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    group.add(shell, lattice);
    this.scene.add(group);
    this.shield = { group, shell, lattice };
  }

  /** Reusable ember bolt meshes. */
  _buildProjectilePool() {
    const geometry = new THREE.IcosahedronGeometry(0.22, 2);
    const glowGeo = new THREE.SphereGeometry(0.46, 12, 10);
    const haloTexture = createGlowTexture(96, 'rgba(255, 226, 170, 1)', 'rgba(255, 110, 40, 0)');
    this.projectilePool = [];
    for (let i = 0; i < 12; i++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#fff7e2' }));
      const glow = new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({
          color: '#ff8a3d',
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTexture,
          color: '#ffb066',
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      halo.scale.setScalar(2.1);
      group.add(core, glow, halo);
      group.visible = false;
      group.renderOrder = 4;
      this.scene.add(group);
      this.projectilePool.push({ group, core, glow, halo, active: false });
    }
    this.projectileCursor = 0;
  }

  /** Reusable piercing ice spears for Rime Spear. */
  _buildPiercePool() {
    const material = new THREE.MeshStandardMaterial({
      color: '#dff8ff',
      emissive: '#6fd8ff',
      emissiveIntensity: 1.35,
      roughness: 0.24,
      metalness: 0.35,
      flatShading: true,
    });
    const glowTexture = createGlowTexture(96, 'rgba(220,250,255,1)', 'rgba(80,180,255,0)');
    this.piercePool = [];
    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group();
      group.name = 'RimeSpear';
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.085, 1.5, 6), material);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.z = 0.3;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 6), material);
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.75;
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: '#9fe8ff',
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.scale.setScalar(1.8);
      group.add(shaft, tip, glow);
      group.visible = false;
      group.renderOrder = 5;
      this.scene.add(group);
      this.piercePool.push({
        group,
        glow,
        active: false,
        position: group.position,
        direction: new THREE.Vector3(),
        life: 0,
        travel: 0,
        hit: new Set(),
        damage: 0,
      });
    }
    this.pierceCursor = 0;
  }

  /** Reusable seeking motes for Aether Barrage. */
  _buildBarragePool() {
    const coreGeometry = new THREE.OctahedronGeometry(0.15, 0);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: '#fff2c4' });
    const glowTexture = createGlowTexture(96, 'rgba(255,240,180,1)', 'rgba(255,180,60,0)');
    this.barragePool = [];
    for (let i = 0; i < 14; i++) {
      const group = new THREE.Group();
      group.name = 'AetherMote';
      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: '#ffe9a8',
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.scale.setScalar(1.2);
      group.add(core, glow);
      group.visible = false;
      group.renderOrder = 5;
      this.scene.add(group);
      this.barragePool.push({
        group,
        core,
        glow,
        active: false,
        position: group.position,
        velocity: new THREE.Vector3(),
        life: 0,
        damage: 0,
        target: null,
      });
    }
    this.barrageCursor = 0;
  }

  /** Flame billboards for Pyre Wave. Normal-blended so daylight cannot wash them out. */
  _buildPyrePool() {
    const texture = createFlameTexture(128);
    this.pyrePool = [];
    for (let i = 0; i < 12; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          color: '#ffb066',
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      sprite.visible = false;
      sprite.renderOrder = 4;
      this.scene.add(sprite);
      this.pyrePool.push({ sprite, active: false, life: 0, maxLife: 0.6, baseY: 0, rise: 0, baseScale: 1 });
    }
    this.pyreCursor = 0;
  }

  /** Small billboard marker showing the predicted impact point of a cast. */
  _buildAimMarker() {
    const group = new THREE.Group();
    group.name = 'AimMarker';
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: '#ffe9a8',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.32, 24), ringMaterial);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), ringMaterial.clone());
    group.add(ring, dot);
    group.visible = false;
    group.renderOrder = 8;
    this.scene.add(group);
    this.aimMarker = { group, ring, dot, time: 0, duration: 0.42 };
  }

  /** Terrain line-of-sight test used by soft aim. */
  _clearShot(origin, point) {
    return hasLineOfSight(origin, point, (x, z) => this.world.heightAt(x, z), {
      samples: 9,
      clearance: 0.3,
    });
  }

  /** Ground point where a delayed strike should land on a moving target. */
  _strikePoint(target) {
    const delay = SPELLS.thunderfall.delay ?? 0.32;
    const v = target.velocity ?? { x: 0, y: 0, z: 0 };
    const x = target.position.x + (v.x ?? 0) * delay;
    const z = target.position.z + (v.z ?? 0) * delay;
    return { x, y: this.world.heightAt(x, z), z };
  }

  /** First terrain/water point along a ray, used when Thunderfall has no lock. */
  _groundAimPoint(origin, direction, range) {
    const dir = direction.clone().normalize();
    const steps = 48;
    let point = { x: origin.x + dir.x * range, y: 0, z: origin.z + dir.z * range };
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * range;
      const x = origin.x + dir.x * d;
      const y = origin.y + dir.y * d;
      const z = origin.z + dir.z * d;
      const ground = this.world.heightAt(x, z);
      point = { x, y: ground, z };
      if (y <= ground + 0.2) break;
      if (y <= (this.world.waterLevel ?? -Infinity)) {
        point.y = this.world.waterLevel;
        break;
      }
    }
    return point;
  }

  /** Flash the impact marker at a world point. */
  _showAimMarker(point, color) {
    const marker = this.aimMarker;
    if (!marker || !point) return;
    marker.group.position.set(point.x, point.y + 0.02, point.z);
    marker.ring.material.color.set(color ?? '#ffe9a8');
    marker.dot.material.color.set(color ?? '#ffe9a8');
    marker.ring.material.opacity = 0.9;
    marker.dot.material.opacity = 0.9;
    marker.ring.scale.setScalar(1);
    marker.time = marker.duration;
    marker.group.visible = true;
  }

  /** Fade the impact marker and keep it facing the camera. */
  _updateAimMarker(dt) {
    const marker = this.aimMarker;
    if (!marker || marker.time <= 0) return;
    marker.time = Math.max(0, marker.time - dt);
    const t = 1 - marker.time / marker.duration;
    marker.ring.material.opacity = 0.9 * (1 - t);
    marker.dot.material.opacity = 0.9 * (1 - t);
    marker.ring.scale.setScalar(1 + t * 0.6);
    const camera = this.camera?.camera ?? this.camera;
    if (camera?.quaternion) marker.group.quaternion.copy(camera.quaternion);
    if (marker.time <= 0) marker.group.visible = false;
  }

  /**
   * Attempt to cast a spell. Performs the authoritative state change.
   * @param {string} spellId
   * @param {{origin?:THREE.Vector3, direction?:THREE.Vector3}} [aim]
   * @returns {{ok:boolean, reason:string, spell:object|null}}
   */
  cast(spellId, aim = {}) {
    const spell = SPELLS[spellId];
    if (!spell) return { ok: false, reason: 'unknown', spell: null };
    const verdict = canCast(this.powers, spellId);
    if (!verdict.ok) {
      this.audio?.error();
      return { ok: false, reason: verdict.reason, spell };
    }

    const origin = aim.origin
      ? new THREE.Vector3(aim.origin.x, aim.origin.y, aim.origin.z)
      : this.player.eyePosition().clone();
    let direction = aim.direction
      ? new THREE.Vector3(aim.direction.x, aim.direction.y, aim.direction.z).normalize()
      : this._forward().normalize();

    const result = castSpell(this.powers, spellId);
    if (!result.ok) return result;

    // Soft aim: directed spells snap toward a living enemy and, for
    // projectiles, lead the target's velocity so the shot lands where the
    // enemy will actually be. Radial/self spells keep their raw input.
    this.aimTarget = null;
    this.aimLockTimer = 0;
    this.aimPoint = null;
    this.aimLead = 0;
    const directed = spell.aim === 'lead' || spell.aim === 'snap' || spell.aim === 'strike';
    if (this.aimAssist && directed) {
      const target = pickAimTarget(origin, direction, this.enemies?.list ?? [], {
        range: spell.range ?? 70,
        cone: this.aimCone,
        filter: (enemy, point) => this._clearShot(origin, point),
      });
      if (target) {
        const solution = solveAim(direction, origin, target, {
          strength: Math.min(1, (spell.aimStrength ?? 0.7) * this.aimStrength),
          projectileSpeed: spell.aim === 'lead' ? spell.projectileSpeed : 0,
        });
        direction = new THREE.Vector3(solution.direction.x, solution.direction.y, solution.direction.z);
        this.aimTarget = target;
        this.aimLockTimer = 1.2;
        this.aimLead = solution.lead;
        this.aimPoint = spell.aim === 'strike'
          ? this._strikePoint(target)
          : solution.point;
      }
    }
    if (this.aimPoint) this._showAimMarker(this.aimPoint, spell.color);

    // In first person the eye sits right where the muzzle flash is spawned, so
    // a 2 m additive sprite 0.8 m from the lens plus bloom whites out the whole
    // frame. Push directed spell origins a couple of metres forward; the shot
    // still aims from the eye because targeting already happened above.
    const firstPerson = this.camera?.state?.mode === 'first';
    if (firstPerson && ['projectile', 'beam', 'pierce', 'barrage'].includes(spell.kind)) {
      origin.addScaledVector(direction, 2.1);
    }

    this.lastCast = spellId;
    this.audio?.cast(spellId);

    switch (spell.kind) {
      case 'projectile':
        this._castEmber(origin, direction);
        break;
      case 'nova':
        this._castNova(origin);
        break;
      case 'dash':
        this._castDash(direction);
        break;
      case 'beam':
        this._castLance(origin, direction);
        break;
      case 'shield':
        this._castAegis(origin);
        break;
      case 'form':
        this._castForm(origin);
        break;
      case 'pierce':
        this._castRimeSpear(origin, direction);
        break;
      case 'cone':
        this._castPyreWave(origin, direction);
        break;
      case 'strike':
        this._castThunderfall(origin, direction);
        break;
      case 'barrage':
        this._castBarrage(origin, direction);
        break;
      default:
        break;
    }

    return { ok: true, reason: 'cast', spell };
  }

  /** Player facing as a unit vector (horizontal). */
  _forward() {
    const facing = this.player.facing?.() ?? { x: 0, z: -1 };
    return new THREE.Vector3(facing.x, 0, facing.z);
  }

  /** Apply player settings for soft aim (cone in degrees, strength multiplier). */
  setAimOptions(options = {}) {
    const config = aimConfig(options);
    this.aimAssist = config.enabled;
    this.aimCone = config.cone;
    this.aimStrength = config.strength;
  }

  /** Camera-space aim, falling back to player facing. */
  aimFromCamera(camera) {
    if (!camera) return { origin: this.player.eyePosition(), direction: this._forward() };
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    // Spawn bolts just in front of the player so they never appear inside the body.
    const eye = this.player.eyePosition();
    const start = new THREE.Vector3(
      eye.x + direction.x * 0.8,
      eye.y - 0.15 + direction.y * 0.8,
      eye.z + direction.z * 0.8,
    );
    return { origin: start, direction };
  }

  _spawnProjectile(origin, direction) {
    const entry = this.projectilePool[this.projectileCursor];
    this.projectileCursor = (this.projectileCursor + 1) % this.projectilePool.length;
    entry.group.position.copy(origin);
    entry.group.visible = true;
    entry.active = true;
    this.projectiles.push({
      entry,
      position: entry.group.position,
      velocity: direction.clone().multiplyScalar(EMBER_SPEED),
      life: EMBER_LIFE,
      trailTimer: 0,
    });
  }

  _castEmber(origin, direction) {
    this._spawnProjectile(origin, direction);
    this.effects.flash(origin, { color: '#ffcf8a', size: 1.9, life: 0.16, growth: 1.6 });
    this.effects.burst(origin, {
      count: 10,
      color: '#ffb066',
      speed: 3.4,
      size: 0.28,
      life: 0.35,
      gravity: -1,
      direction,
      spread: 0.55,
    });
    this.effects.light(origin, { color: '#ff9a4d', intensity: 5, distance: 12, life: 0.24 });
    this.camera?.addShake?.(0.05);
  }

  /** Rime Spear: a fast, piercing line projectile that slows every target. */
  _castRimeSpear(origin, direction) {
    const spell = SPELLS.rimeSpear;
    const entry = this.piercePool[this.pierceCursor];
    this.pierceCursor = (this.pierceCursor + 1) % this.piercePool.length;
    entry.group.position.copy(origin);
    entry.group.visible = true;
    entry.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    entry.active = true;
    entry.direction.copy(direction).normalize();
    entry.life = spell.range / spell.speed + 0.2;
    entry.travel = 0;
    entry.hit.clear();
    entry.damage = computeDamage(spell.damage, { damage: formDamageMultiplier(this.powers) });
    this.pierce.push(entry);

    const firstPerson = this.camera?.state?.mode === 'first';
    this.effects.flash(origin, {
      color: '#dff8ff',
      size: firstPerson ? 1.1 : 1.7,
      life: 0.16,
      growth: 1.5,
    });
    this.effects.burst(origin, {
      count: 20,
      color: '#9fe8ff',
      speed: 4.6,
      size: 0.28,
      life: 0.45,
      gravity: -0.4,
      direction,
      spread: 0.5,
    });
    // A face-on muzzle ring 2 m across reads as a screen-filling disc in first
    // person; keep it as a small shock ring there instead.
    this.effects.ring(origin, {
      color: '#9fe8ff',
      radius: firstPerson ? 0.55 : 2.2,
      life: 0.32,
      tilt: 0,
      opacity: firstPerson ? 0.4 : 0.7,
    });
    this.effects.light(origin, { color: '#9fe8ff', intensity: 7, distance: 18, life: 0.24 });
    this.camera?.addShake?.(0.12);
  }

  /** Pyre Wave: a wide, short-range cone of fire. */
  _castPyreWave(origin, direction) {
    const spell = SPELLS.pyreWave;
    const flat = new THREE.Vector3(direction.x, 0, direction.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
    flat.normalize();
    const base = new THREE.Vector3(this.player.position.x, this.player.position.y + 0.15, this.player.position.z);
    const damage = computeDamage(spell.damage, { damage: formDamageMultiplier(this.powers) });
    const half = spell.angle * 0.5;

    for (let i = 0; i < 6; i++) {
      const d = 2.2 + i * (spell.range / 7);
      const at = base.clone().addScaledVector(flat, d);
      // Hug the terrain: a flat wall of rings buries itself the moment the
      // ground rises, which is most of the island.
      at.y = this.world.heightAt(at.x, at.z) + 0.12;
      this.effects.ring(at, {
        color: i % 2 ? '#ffb066' : '#ff6a2a',
        radius: 1.7 + i * 0.55,
        life: 0.34 + i * 0.03,
        opacity: 0.85 - i * 0.09,
      });
      this.effects.flash(at.clone().setY(at.y + 0.9), {
        color: i % 2 ? '#ffd28a' : '#ff7a30',
        size: 2.6,
        life: 0.38,
        growth: 1.9,
        opacity: 0.5,
      });
      this.effects.burst(at, {
        count: 24,
        color: i % 2 ? '#ffd28a' : '#ff6a2a',
        speed: 5.6,
        size: 0.42,
        life: 0.62,
        // Fire rises: negative gravity carries embers up out of the grass.
        gravity: -2.1,
        drag: 1.5,
        direction: flat,
        spread: 1.1,
      });
      // Two flame billboards per band give the wall a real silhouette.
      for (let k = 0; k < 2; k++) {
        const entry = this.pyrePool[this.pyreCursor];
        this.pyreCursor = (this.pyreCursor + 1) % this.pyrePool.length;
        const jitter = (Math.random() - 0.5) * 2.4;
        const px = at.x - flat.z * jitter;
        const pz = at.z + flat.x * jitter;
        const ground = this.world.heightAt(px, pz);
        entry.sprite.position.set(px, ground + 0.75, pz);
        entry.sprite.material.color.set(k ? '#ffd28a' : '#ff7a30');
        entry.sprite.material.opacity = 0;
        entry.sprite.visible = true;
        entry.active = true;
        entry.life = 0.62 + Math.random() * 0.1;
        entry.maxLife = entry.life;
        entry.baseY = ground + 0.55;
        entry.rise = 1.4 + Math.random() * 0.8;
        entry.baseScale = 1.8 + Math.random() * 1.1;
      }
    }
    const front = base.clone().addScaledVector(flat, 5.5);
    front.y = this.world.heightAt(front.x, front.z) + 1.1;
    this.effects.flash(front, { color: '#ffb066', size: 5, life: 0.3, growth: 2.4, opacity: 0.6 });
    this.effects.light(front, { color: '#ff8a3d', intensity: 14, distance: 28, life: 0.5 });
    this.camera?.addShake?.(0.3);

    for (const enemy of this.enemies.all()) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - base.x;
      const dz = enemy.position.z - base.z;
      const dist = Math.hypot(dx, dz);
      if (dist > spell.range + (enemy.radius ?? 0.5)) continue;
      const dot = dist > 0.001 ? (dx * flat.x + dz * flat.z) / dist : 1;
      if (dot < Math.cos(half)) continue;
      const falloff = 1 - 0.5 * Math.max(0, (dist - spell.range * 0.45) / (spell.range * 0.55));
      this.enemies.damage(enemy, Math.max(1, Math.round(damage * Math.max(0.35, falloff))), {
        source: 'pyreWave',
        color: '#ffc48a',
        knockback: 4.2,
        from: base,
      });
      this.onHit();
    }
    void origin;
  }

  /** Thunderfall: a delayed pillar of stormlight at the predicted aim point. */
  _castThunderfall(origin, direction) {
    const spell = SPELLS.thunderfall;
    let point = this.aimPoint
      ? { x: this.aimPoint.x, y: this.aimPoint.y, z: this.aimPoint.z }
      : this._groundAimPoint(origin, direction, spell.range);
    point.y = this.world.heightAt(point.x, point.z);
    this.aimPoint = point;
    this._showAimMarker(point, spell.color);
    this.strikes.push({
      point: new THREE.Vector3(point.x, point.y, point.z),
      timer: spell.delay,
      radius: spell.radius,
      damage: computeDamage(spell.damage, { damage: formDamageMultiplier(this.powers) }),
      color: spell.color,
    });
    this.effects.ring(new THREE.Vector3(point.x, point.y, point.z), {
      color: '#8fb4ff',
      radius: spell.radius,
      life: spell.delay,
      opacity: 0.8,
    });
    this.effects.light(point, { color: '#8fb4ff', intensity: 8, distance: 20, life: 0.4 });
    this.camera?.addShake?.(0.16);
  }

  /** Resolve a pending Thunderfall strike. */
  _impactThunderfall(strike) {
    const point = strike.point;
    const from = point.clone().setY(point.y + 48);
    this._jaggedBeam(from, point, { color: '#6f9cff', width: 0.9, life: 0.42, segments: 9, jitter: 0.8 });
    this._jaggedBeam(from, point, { color: '#ffffff', width: 0.28, life: 0.24, segments: 7, jitter: 0.5 });
    this.effects.flash(point.clone().setY(point.y + 1.2), {
      color: '#cfe0ff',
      size: 6.5,
      life: 0.28,
      growth: 2.6,
      opacity: 0.8,
    });
    this.effects.ring(point, { color: '#8fb4ff', radius: strike.radius, life: 0.55, opacity: 0.95 });
    this.effects.ring(point, { color: '#ffffff', radius: strike.radius * 0.6, life: 0.4, opacity: 0.8 });
    this.effects.burst(point.clone().setY(point.y + 0.4), {
      count: 70,
      color: '#a8c4ff',
      speed: 11,
      size: 0.4,
      life: 0.8,
      gravity: 2.6,
      drag: 1.8,
      jitter: 1.1,
    });
    this.effects.burst(point.clone().setY(point.y + 0.4), {
      count: 24,
      color: '#ffffff',
      speed: 7,
      size: 0.22,
      life: 0.45,
      gravity: 0.6,
      drag: 2.4,
    });
    this.effects.light(point.clone().setY(point.y + 1), {
      color: '#8fb4ff',
      intensity: 28,
      distance: 50,
      life: 0.6,
    });
    this.audio?.hit();
    this.camera?.addShake?.(0.55);

    for (const enemy of this.enemies.inRadius(point, strike.radius)) {
      const dist = Math.hypot(enemy.position.x - point.x, enemy.position.z - point.z);
      const falloff = explosionFalloff(dist, strike.radius);
      if (falloff <= 0) continue;
      this.enemies.damage(enemy, Math.max(1, Math.round(strike.damage * falloff)), {
        source: 'thunderfall',
        color: '#cfe0ff',
        knockback: 5,
        from: point,
      });
      this.onHit();
    }
  }

  /** Aether Barrage: six seeking motes that split across nearby enemies. */
  _castBarrage(origin, direction) {
    const spell = SPELLS.aetherBarrage;
    const alive = this.enemies.all().filter((enemy) => enemy.alive);
    const targets = [];
    if (this.aimTarget) targets.push(this.aimTarget);
    for (const enemy of alive) {
      if (!targets.includes(enemy)) targets.push(enemy);
    }
    const damage = computeDamage(spell.damage, { damage: formDamageMultiplier(this.powers) });
    const count = spell.count ?? 6;
    for (let i = 0; i < count; i++) {
      const entry = this.barragePool[this.barrageCursor];
      this.barrageCursor = (this.barrageCursor + 1) % this.barragePool.length;
      const spread = 0.08;
      const dir = direction.clone();
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread * 0.6;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      entry.group.position.copy(origin);
      entry.group.visible = true;
      entry.active = true;
      entry.velocity.copy(dir).multiplyScalar(spell.speed);
      entry.life = 3.4;
      entry.damage = damage;
      entry.target = targets.length ? targets[i % targets.length] : null;
      entry.group.scale.setScalar(0.9 + Math.random() * 0.25);
      this.barrage.push(entry);
    }

    this.effects.flash(origin, { color: '#ffe9a8', size: 3.2, life: 0.22, growth: 2 });
    this.effects.burst(origin, {
      count: 28,
      color: '#ffe9a8',
      speed: 4.4,
      size: 0.26,
      life: 0.55,
      gravity: -0.8,
      direction,
      spread: 0.7,
    });
    this.effects.light(origin, { color: '#ffd98a', intensity: 9, distance: 20, life: 0.3 });
    this.camera?.addShake?.(0.16);
  }

  _castNova(origin) {
    const spell = SPELLS.frostNova;
    const center = new THREE.Vector3(this.player.position.x, this.player.position.y + 0.15, this.player.position.z);
    this.effects.ring(center, { color: '#8fe6ff', radius: spell.radius, life: 0.8, opacity: 0.95 });
    this.effects.ring(center, { color: '#d8f6ff', radius: spell.radius * 0.72, life: 0.58, opacity: 0.75 });
    this.effects.ring(center, { color: '#ffffff', radius: spell.radius * 0.4, life: 0.34, opacity: 0.6 });
    // Rising ice shards: a cone of sparks that reads as a burst of frozen spikes.
    this.effects.burst(center, {
      count: 58,
      color: '#a8ecff',
      speed: 13,
      size: 0.38,
      life: 0.85,
      gravity: 4.2,
      drag: 2.6,
      jitter: 0.9,
    });
    this.effects.burst(center, {
      count: 26,
      color: '#ffffff',
      speed: 6.5,
      size: 0.2,
      life: 0.55,
      gravity: -0.6,
      drag: 2.2,
      jitter: 1.4,
    });
    this.effects.burst(center.clone().setY(center.y + 0.8), {
      count: 20,
      color: '#cdf4ff',
      speed: 3.2,
      size: 0.5,
      life: 1.1,
      gravity: -1.4,
      drag: 1.8,
      jitter: 0.5,
    });
    this.effects.flash(center.clone().setY(center.y + 0.9), { color: '#dff8ff', size: 3.4, life: 0.24, growth: 2.2, opacity: 0.6 });
    this.effects.light(center, { color: '#7fdcff', intensity: 16, distance: 36, life: 0.6 });
    this.camera?.addShake?.(0.26);

    const damage = computeDamage(spell.damage, { damage: formDamageMultiplier(this.powers) });
    for (const enemy of this.enemies.inRadius(center, spell.radius)) {
      const dist = Math.hypot(enemy.position.x - center.x, enemy.position.z - center.z);
      const falloff = explosionFalloff(dist, spell.radius);
      if (falloff <= 0) continue;
      this.enemies.damage(enemy, Math.max(1, Math.round(damage * falloff)), {
        source: 'frostNova',
        color: '#bdefff',
        knockback: 2.2,
        from: center,
      });
      this.enemies.slow(enemy, 0.45, spell.slow);
      this.onHit();
    }
    void origin;
  }

  _castDash(direction) {
    const spell = SPELLS.galeDash;
    this.player.startDash(direction.x, direction.z, spell.distance / 0.34, 0.34);
    this.dash.time = 0.42;
    this.dash.hit = new Set();
    this.dash.damage = computeDamage(spell.damage, { damage: formDamageMultiplier(this.powers) });
    this.dash.radius = 2.4;
    const base = this.player.position.clone();
    const chest = base.clone().setY(base.y + 0.7);
    this.effects.flash(chest, { color: '#c8ffe9', size: 2.4, life: 0.2, growth: 1.9 });
    this.effects.burst(chest, {
      count: 30,
      color: '#9ef7d0',
      speed: 8.4,
      size: 0.3,
      life: 0.5,
      gravity: -1.4,
      drag: 3,
      direction: direction.clone().negate(),
      spread: 0.85,
    });
    this.effects.burst(chest, {
      count: 16,
      color: '#ffffff',
      speed: 3.6,
      size: 0.18,
      life: 0.3,
      gravity: 0,
      drag: 4,
    });
    this.effects.ring(base, { color: '#9ef7d0', radius: 3.6, life: 0.42 });
    this.effects.ring(chest, { color: '#eafff7', radius: 1.9, life: 0.3, tilt: 0, opacity: 0.7 });
    this.effects.light(chest, { color: '#9ef7d0', intensity: 7, distance: 16, life: 0.26 });
    this.camera?.addShake?.(0.14);
  }

  /**
   * A segmented, jittered lightning path.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{color?:string, width?:number, life?:number, segments?:number, jitter?:number}} [opts]
   */
  _jaggedBeam(from, to, opts = {}) {
    const segments = opts.segments ?? 6;
    const jitter = opts.jitter ?? 0.55;
    const points = [from.clone()];
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const p = from.clone().addScaledVector(dir, t);
      const amount = Math.sin(t * Math.PI) * jitter * (0.35 + Math.random() * 0.9);
      p.addScaledVector(side, (Math.random() - 0.5) * amount * 2);
      p.addScaledVector(up, (Math.random() - 0.5) * amount * 2);
      points.push(p);
    }
    points.push(to.clone());
    for (let i = 0; i < points.length - 1; i++) {
      this.effects.beam(points[i], points[i + 1], {
        color: opts.color ?? '#b48cff',
        width: (opts.width ?? 0.24) * (1 - (i / points.length) * 0.35),
        life: opts.life ?? 0.3,
      });
    }
    void len;
  }

  _castLance(origin, direction) {
    const spell = SPELLS.stormLance;
    const candidates = this.enemies
      .all()
      .filter((e) => e.alive)
      .map((e) => ({ x: e.position.x, z: e.position.z, alive: true, enemy: e }));

    const first = pickChainTargets(
      { x: origin.x, z: origin.z },
      candidates,
      { range: spell.range, maxTargets: 1, dir: { x: direction.x, z: direction.z }, cone: 0.55 },
    )[0];

    const damage = computeDamage(spell.damage, { damage: formDamageMultiplier(this.powers) });
    let from = origin.clone();
    let struck = 0;
    let target = first?.enemy ?? null;

    const hitPoints = [];
    while (target && struck < 1 + spell.chains) {
      const point = new THREE.Vector3(target.position.x, target.position.y + (target.hitHeight ?? 1.1), target.position.z);
      this._jaggedBeam(from, point, { color: '#9a6bff', width: 0.34, life: 0.34, segments: 7, jitter: 0.5 });
      this._jaggedBeam(from, point, { color: '#f2e6ff', width: 0.1, life: 0.2, segments: 5, jitter: 0.3 });
      this.effects.flash(point, { color: '#e8d8ff', size: 2.6, life: 0.2, growth: 1.8 });
      this.effects.burst(point, {
        count: 26,
        color: '#cbb0ff',
        speed: 7,
        size: 0.3,
        life: 0.55,
        gravity: 2,
        drag: 2.2,
      });
      this.effects.burst(point, {
        count: 10,
        color: '#ffffff',
        speed: 3.2,
        size: 0.16,
        life: 0.3,
        gravity: 0,
        drag: 3.2,
      });
      this.effects.light(point, { color: '#b48cff', intensity: 11, distance: 26, life: 0.32 });
      this.effects.damageNumber(point, Math.round(damage * (struck === 0 ? 1 : 0.62)), {
        color: '#d9c6ff',
        crit: struck === 0,
      });
      this.enemies.damage(target, Math.round(damage * (struck === 0 ? 1 : 0.62)), {
        source: 'stormLance',
        color: '#d9c6ff',
        knockback: 3.4,
        from,
        silentNumber: true,
      });
      this.onHit();
      hitPoints.push(point);
      struck += 1;
      from = point;

      const nextCandidates = this.enemies
        .all()
        .filter((e) => e.alive && !hitPoints.some((p) => Math.hypot(p.x - e.position.x, p.z - e.position.z) < 0.5))
        .map((e) => ({ x: e.position.x, z: e.position.z, alive: true, enemy: e }));
      target = pickChainTargets(
        { x: from.x, z: from.z },
        nextCandidates,
        { range: 16, maxTargets: 1 },
      )[0]?.enemy ?? null;
    }

    if (!first) {
      // Whiff: still show a lance of lightning into the distance.
      const end = origin.clone().addScaledVector(direction, spell.range * 0.85);
      this._jaggedBeam(origin, end, { color: '#9a6bff', width: 0.22, life: 0.28, segments: 9, jitter: 0.9 });
      this._jaggedBeam(origin, end, { color: '#f2e6ff', width: 0.07, life: 0.18, segments: 7, jitter: 0.7 });
      this.effects.flash(end, { color: '#cbb0ff', size: 1.8, life: 0.2, growth: 1.6 });
      this.effects.burst(end, {
        count: 16,
        color: '#b48cff',
        speed: 5,
        size: 0.26,
        life: 0.4,
        gravity: 1.4,
      });
    }

    this.effects.flash(origin, { color: '#e0ccff', size: 1.7, life: 0.18, growth: 1.6 });
    this.effects.burst(origin, {
      count: 16,
      color: '#e4d4ff',
      speed: 4.4,
      size: 0.3,
      life: 0.4,
      gravity: 0,
      direction,
      spread: 0.7,
    });
    this.camera?.addShake?.(0.3);
  }

  _castAegis(origin) {
    const base = this.player.position.clone();
    const core = base.clone().setY(base.y + 1);
    this.effects.ring(base, { color: '#ffd98a', radius: 3.8, life: 0.62, opacity: 0.9 });
    this.effects.ring(core, { color: '#ffe9a8', radius: 2.7, life: 0.55, tilt: 0, opacity: 0.75 });
    this.effects.ring(base, { color: '#fff6d8', radius: 2.2, life: 0.4, opacity: 0.65 });
    this.effects.flash(core, { color: '#ffe9a8', size: 3.6, life: 0.26, growth: 1.7, opacity: 0.9 });
    // Gold motes spiral upward, suggesting a dome sealing into place.
    this.effects.burst(core, {
      count: 34,
      color: '#ffe2a0',
      speed: 4.2,
      size: 0.32,
      life: 0.9,
      gravity: -1.6,
      drag: 2.4,
      jitter: 1.1,
    });
    this.effects.burst(core, {
      count: 18,
      color: '#ffffff',
      speed: 2.2,
      size: 0.16,
      life: 0.45,
      gravity: -0.4,
      drag: 3.4,
      jitter: 1.6,
    });
    this.effects.light(core, {
      color: '#ffd98a',
      intensity: 11,
      distance: 22,
      life: 0.55,
    });
    this.camera?.addShake?.(0.1);
    this.shieldPulse = 1;
    void origin;
  }

  _castForm(origin) {
    const base = this.player.position.clone();
    const center = base.clone().setY(base.y + 0.9);
    this.effects.ring(base, { color: '#ffe9a8', radius: 11, life: 1.15, opacity: 1 });
    this.effects.ring(base, { color: '#fff6d8', radius: 6.5, life: 0.85, opacity: 0.85 });
    this.effects.ring(base, { color: '#ffb066', radius: 3.2, life: 0.5, opacity: 0.8 });
    this.effects.flash(center, { color: '#fff6d8', size: 3.8, life: 0.4, growth: 2.6, opacity: 0.7 });
    this.effects.flash(center, { color: '#ffb066', size: 6.5, life: 0.7, growth: 2.2, opacity: 0.28 });
    this.effects.burst(center, {
      count: 96,
      color: '#ffe9a8',
      speed: 10,
      size: 0.42,
      life: 1.5,
      gravity: -3.2,
      drag: 1.4,
      jitter: 1,
    });
    this.effects.burst(center, {
      count: 44,
      color: '#ffb066',
      speed: 4.8,
      size: 0.55,
      life: 1.9,
      gravity: -1.6,
      drag: 1.1,
    });
    this.effects.burst(center, {
      count: 30,
      color: '#ffffff',
      speed: 14,
      size: 0.22,
      life: 0.7,
      gravity: 0.6,
      drag: 1.8,
      jitter: 0.4,
    });
    this.effects.light(center, { color: '#ffd98a', intensity: 26, distance: 64, life: 1.25 });
    this.camera?.addShake?.(0.6);
    void origin;
  }

  /** Spawn a shield-break burst (called when the shield absorbs its last hit). */
  shieldBreak() {
    const center = this.player.position.clone().setY(this.player.position.y + 1);
    this.effects.ring(this.player.position.clone(), { color: '#ffd98a', radius: 4.4, life: 0.5 });
    this.effects.burst(center, {
      count: 34,
      color: '#ffe2a0',
      speed: 7,
      size: 0.3,
      life: 0.6,
      gravity: 2,
      drag: 2.4,
    });
    this.audio?.enemyHit();
  }

  /** Per-frame projectile + dash + shield update. */
  update(dt) {
    if (this.aimLockTimer > 0) {
      this.aimLockTimer = Math.max(0, this.aimLockTimer - dt);
      if (this.aimLockTimer === 0) this.aimTarget = null;
    }

    // Projectiles.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      const prevY = p.position.y;
      p.position.addScaledVector(p.velocity, dt);
      p.entry.glow.rotation.y += dt * 6;
      p.entry.glow.scale.setScalar(1 + Math.sin(p.life * 22) * 0.14);
      p.entry.halo.scale.setScalar(1.9 + Math.sin(p.life * 30) * 0.28);

      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        p.trailTimer = 0.016;
        this.effects.burst(p.position, {
          count: 2,
          color: Math.random() < 0.5 ? '#ff9a4d' : '#ffd28a',
          speed: 0.7,
          size: 0.26,
          life: 0.32,
          gravity: -0.8,
          jitter: 0.1,
        });
      }

      let hit = false;
      for (const enemy of this.enemies.inRadius(p.position, 1.5)) {
        if (!enemy.alive) continue;
        hit = true;
        this._explodeEmber(p.position, enemy);
        break;
      }

      if (!hit) {
        const ground = this.world.heightAt(p.position.x, p.position.z);
        if (p.position.y <= ground + 0.12 || p.position.y < this.world.waterLevel - 0.2) {
          hit = true;
          p.position.y = Math.max(ground + 0.15, this.world.waterLevel + 0.05);
          this._explodeEmber(p.position, null);
        }
      }
      if (p.life <= 0 && !hit) this._explodeEmber(p.position, null);

      if (hit || p.life <= 0) {
        p.entry.active = false;
        p.entry.group.visible = false;
        this.projectiles.splice(i, 1);
      }
      void prevY;
    }

    // Rime Spear: pierce every enemy along the line, then shatter on terrain.
    for (let i = this.pierce.length - 1; i >= 0; i--) {
      const spear = this.pierce[i];
      if (!spear.active) {
        this.pierce.splice(i, 1);
        continue;
      }
      const speed = SPELLS.rimeSpear.speed;
      spear.life -= dt;
      spear.travel += speed * dt;
      spear.position.addScaledVector(spear.direction, speed * dt);
      spear.glow.material.opacity = 0.55 + Math.sin(spear.life * 30) * 0.15;
      if (Math.random() < 0.7) {
        this.effects.burst(spear.position, {
          count: 2,
          color: '#bfefff',
          speed: 0.8,
          size: 0.24,
          life: 0.3,
          gravity: 0,
          jitter: 0.1,
        });
      }

      for (const enemy of this.enemies.inRadius(spear.position, 1.35)) {
        if (!enemy.alive || spear.hit.has(enemy.id)) continue;
        spear.hit.add(enemy.id);
        this.enemies.damage(enemy, spear.damage, {
          source: 'rimeSpear',
          color: '#d8f6ff',
          knockback: 2.5,
          from: spear.position,
        });
        this.enemies.slow(enemy, 0.5, SPELLS.rimeSpear.slow);
        this.onHit();
        this.effects.burst(spear.position, {
          count: 18,
          color: '#9fe8ff',
          speed: 5,
          size: 0.28,
          life: 0.45,
          gravity: 1.4,
        });
      }

      const ground = this.world.heightAt(spear.position.x, spear.position.z);
      const done = spear.position.y <= ground + 0.2
        || spear.position.y < this.world.waterLevel - 0.1
        || spear.travel >= SPELLS.rimeSpear.range
        || spear.life <= 0;
      if (done) {
        this.effects.flash(spear.position, { color: '#dff8ff', size: 2.4, life: 0.2, growth: 2 });
        this.effects.burst(spear.position, {
          count: 22,
          color: '#bfefff',
          speed: 5.4,
          size: 0.3,
          life: 0.5,
          gravity: 2.2,
        });
        spear.active = false;
        spear.group.visible = false;
        this.pierce.splice(i, 1);
      }
    }

    // Aether Barrage: steer each mote toward its assigned enemy.
    for (let i = this.barrage.length - 1; i >= 0; i--) {
      const mote = this.barrage[i];
      if (!mote.active) {
        this.barrage.splice(i, 1);
        continue;
      }
      mote.life -= dt;
      const target = mote.target;
      if (target && target.alive) {
        this._tmp.set(
          target.position.x - mote.position.x,
          target.position.y + (target.hitHeight ?? 1.1) * 0.6 - mote.position.y,
          target.position.z - mote.position.z,
        );
        const len = this._tmp.length();
        if (len > 0.001) {
          this._tmp.multiplyScalar(1 / len);
          const speed = SPELLS.aetherBarrage.speed;
          this._dir.copy(mote.velocity).normalize();
          this._dir.lerp(this._tmp, Math.min(0.3, dt * 6.5));
          if (this._dir.lengthSq() > 1e-6) this._dir.normalize();
          mote.velocity.copy(this._dir).multiplyScalar(speed);
        }
      }
      mote.position.addScaledVector(mote.velocity, dt);
      mote.glow.material.opacity = 0.55 + Math.sin(mote.life * 24) * 0.2;
      if (Math.random() < 0.65) {
        this.effects.burst(mote.position, {
          count: 1,
          color: '#ffe9a8',
          speed: 0.4,
          size: 0.2,
          life: 0.28,
          gravity: -0.4,
          jitter: 0.08,
        });
      }

      let done = false;
      for (const enemy of this.enemies.inRadius(mote.position, 1.0)) {
        if (!enemy.alive) continue;
        this.enemies.damage(enemy, mote.damage, {
          source: 'aetherBarrage',
          color: '#ffe9a8',
          knockback: 1.8,
          from: mote.position,
        });
        this.onHit();
        this.effects.flash(mote.position, { color: '#fff6d8', size: 1.8, life: 0.16, growth: 2 });
        this.effects.burst(mote.position, {
          count: 12,
          color: '#ffe9a8',
          speed: 3.8,
          size: 0.24,
          life: 0.35,
          gravity: 0.8,
        });
        done = true;
        break;
      }
      const ground = this.world.heightAt(mote.position.x, mote.position.z);
      if (mote.position.y <= ground + 0.15 || mote.position.y < this.world.waterLevel - 0.1 || mote.life <= 0) {
        done = true;
      }
      if (done) {
        mote.active = false;
        mote.group.visible = false;
        this.barrage.splice(i, 1);
      }
    }

    // Pending Thunderfall strikes.
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const strike = this.strikes[i];
      strike.timer -= dt;
      if (strike.timer <= 0) {
        this._impactThunderfall(strike);
        this.strikes.splice(i, 1);
      }
    }

    // Pyre Wave flame billboards.
    for (const flame of this.pyrePool ?? []) {
      if (!flame.active) continue;
      flame.life -= dt;
      if (flame.life <= 0) {
        flame.active = false;
        flame.sprite.visible = false;
        continue;
      }
      const t = 1 - flame.life / flame.maxLife;
      flame.sprite.position.y = flame.baseY + t * flame.rise;
      const scale = flame.baseScale * (0.55 + t * 0.95);
      flame.sprite.scale.set(scale, scale * 1.35, 1);
      flame.sprite.material.opacity = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.92;
    }

    // Dash damage window.
    if (this.dash.time > 0) {
      this.dash.time -= dt;
      const center = this.player.position;
      for (const enemy of this.enemies.inRadius(center, this.dash.radius)) {
        if (!enemy.alive || this.dash.hit.has(enemy.id)) continue;
        this.dash.hit.add(enemy.id);
        this.enemies.damage(enemy, this.dash.damage, {
          source: 'galeDash',
          color: '#b9ffe4',
          knockback: 5,
          from: center,
        });
        this.onHit();
      }
      this.effects.burst(center.clone().setY(center.y + 0.7), {
        count: 2,
        color: '#9ef7d0',
        speed: 1.2,
        size: 0.26,
        life: 0.32,
        gravity: -0.4,
        jitter: 0.35,
      });
    }

    // Shield bubble. In first person the camera sits inside the bubble, so the
    // wireframe would smear giant lines across the view — hide it instead.
    const firstPerson = this.camera?.state?.mode === 'first';
    const active = this.powers.shieldHp > 0 && !firstPerson;
    this.shield.group.visible = active;
    if (active) {
      this.shieldPulse = Math.max(0, this.shieldPulse - dt * 2.4);
      const t = performance.now() * 0.001;
      const pulse = 1 + Math.sin(t * 3.2) * 0.03 + this.shieldPulse * 0.25;
      this.shield.group.position.set(this.player.position.x, this.player.position.y + 1.0, this.player.position.z);
      this.shield.group.scale.setScalar(pulse);
      this.shield.group.rotation.y += dt * 0.5;
      this.shield.shell.material.opacity = 0.1 + 0.06 * (this.powers.shieldHp / 80);
      this.shield.lattice.material.opacity = 0.26 + Math.sin(t * 4.1) * 0.08;
    }

    this._updateAimMarker(dt);
  }

  /** Ember bolt detonation. */
  _explodeEmber(position, directHit) {
    const spell = SPELLS.emberBolt;
    const center = position.clone();
    const damage = computeDamage(spell.damage, { damage: formDamageMultiplier(this.powers) });

    this.effects.flash(center, { color: '#ffe6b4', size: 3.4, life: 0.18, growth: 2.4 });
    this.effects.flash(center, { color: '#ff7a2a', size: 3.8, life: 0.34, growth: 2.1, opacity: 0.4 });
    this.effects.burst(center, {
      count: 36,
      color: '#ff9a4d',
      speed: 8.6,
      size: 0.34,
      life: 0.62,
      gravity: 3.4,
      drag: 2,
    });
    this.effects.burst(center, {
      count: 22,
      color: '#ffd9a0',
      speed: 10.5,
      size: 0.2,
      life: 0.5,
      gravity: -1.6,
      drag: 1.5,
      jitter: 0.2,
    });
    this.effects.burst(center, {
      count: 12,
      color: '#ffe9a8',
      speed: 4,
      size: 0.26,
      life: 0.42,
      gravity: 1.2,
      drag: 2.6,
    });
    this.effects.ring(center, { color: '#ffb066', radius: 4.4, life: 0.45, tilt: 0 });
    this.effects.light(center, { color: '#ff9a4d', intensity: 14, distance: 24, life: 0.34 });
    this.audio?.hit();
    this.camera?.addShake?.(0.14);

    const radius = 3.2;
    for (const enemy of this.enemies.inRadius(center, radius)) {
      const dist = Math.hypot(enemy.position.x - center.x, enemy.position.z - center.z);
      const falloff = explosionFalloff(dist, radius);
      if (falloff <= 0) continue;
      this.enemies.damage(enemy, Math.max(1, Math.round(damage * falloff)), {
        source: 'emberBolt',
        color: '#ffc48a',
        knockback: 3.2,
        from: center,
      });
      this.onHit();
    }

    if (directHit && !directHit.alive) {
      this.effects.burst(
        new THREE.Vector3(directHit.position.x, directHit.position.y + 1, directHit.position.z),
        { count: 24, color: '#8a7cff', speed: 5, size: 0.34, life: 0.7, gravity: 1.4 },
      );
    }
  }

  /** Is Aether Form burning right now? */
  get formActive() {
    return isFormActive(this.powers);
  }

  /** Clear live projectiles (respawn / new game). */
  clear() {
    for (const p of this.projectiles) {
      p.entry.group.visible = false;
      p.entry.active = false;
    }
    this.projectiles.length = 0;
    for (const spear of this.pierce) {
      spear.active = false;
      spear.group.visible = false;
    }
    this.pierce.length = 0;
    for (const mote of this.barrage) {
      mote.active = false;
      mote.group.visible = false;
    }
    this.barrage.length = 0;
    this.strikes.length = 0;
    for (const flame of this.pyrePool ?? []) {
      flame.active = false;
      flame.life = 0;
      flame.sprite.visible = false;
    }
    this.aimTarget = null;
    this.aimPoint = null;
    this.aimLead = 0;
    if (this.aimMarker) {
      this.aimMarker.time = 0;
      this.aimMarker.group.visible = false;
    }
    this.dash.time = 0;
    this.dash.hit.clear();
    this.shield.group.visible = false;
  }
}
