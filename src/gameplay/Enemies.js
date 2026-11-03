/**
 * The Veil: hostile creatures that guard the shards and roam the island.
 * Three archetypes (Drifter, Stalker, Warden) with procedural models, simple
 * state machines, telegraphed attacks and pooled projectiles.
 */

import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../util/math.js';
import { createRng } from '../util/rng.js';
import { LOCATIONS, SHARD_LOCATIONS } from '../world/locations.js';
import { applyDamage } from './powerState.js';
import { combineSlows, mitigate, tickSlows } from './combat.js';
import { createGlowTexture } from '../world/textures.js';

const TYPES = {
  drifter: {
    label: 'Veil Drifter',
    health: 62,
    armor: 1,
    speed: 3.3,
    aggro: 34,
    leash: 70,
    attackRange: 22,
    damage: 9,
    windup: 0.85,
    cooldown: 2.7,
    radius: 0.7,
    hitHeight: 1.3,
    hover: 1.25,
    color: '#6b4fb0',
    glow: '#b48cff',
    ranged: true,
    scale: 1,
  },
  stalker: {
    label: 'Veil Stalker',
    health: 88,
    armor: 3,
    speed: 5.5,
    aggro: 27,
    leash: 62,
    attackRange: 2.7,
    damage: 13,
    windup: 0.42,
    cooldown: 1.7,
    radius: 0.8,
    hitHeight: 0.9,
    hover: 0,
    color: '#7a2f3c',
    glow: '#ff8a7a',
    ranged: false,
    scale: 1,
  },
  warden: {
    label: 'Warden',
    health: 430,
    armor: 8,
    speed: 3.1,
    aggro: 42,
    leash: 90,
    attackRange: 4.6,
    damage: 24,
    windup: 0.75,
    cooldown: 2.5,
    radius: 1.7,
    hitHeight: 2.1,
    hover: 0.35,
    color: '#3d2c66',
    glow: '#c6a8ff',
    ranged: false,
    scale: 1.85,
  },
};

const EYE_TEXTURE = createGlowTexture(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');

let enemySerial = 0;

/** Build a standard-material part with its own material instance (for flashing). */
function part(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Additive glow sprite. */
function glowSprite(color, size, opacity = 0.8) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: EYE_TEXTURE,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}

/** Create the procedural body for one archetype. */
function buildBody(type) {
  const spec = TYPES[type];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = new THREE.MeshStandardMaterial({
    color: spec.color,
    emissive: new THREE.Color(spec.glow).multiplyScalar(0.22),
    emissiveIntensity: 0.9,
    roughness: 0.72,
    metalness: 0.08,
    flatShading: true,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#1b1526',
    roughness: 0.9,
    flatShading: true,
  });
  const bone = new THREE.MeshStandardMaterial({
    color: '#cbbfae',
    roughness: 0.65,
    flatShading: true,
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: spec.glow });

  const materials = [skin, dark, bone];

  if (type === 'drifter') {
    part(body, new THREE.ConeGeometry(0.62, 1.75, 8, 1, true), skin, [0, 0.95, 0]).rotation.y = Math.PI / 8;
    part(body, new THREE.ConeGeometry(0.5, 0.9, 7, 1, true), dark, [0, 0.18, 0]);
    part(body, new THREE.SphereGeometry(0.32, 10, 8), dark, [0, 1.72, 0], [1, 0.92, 0.95]);
    // Hood point.
    part(body, new THREE.ConeGeometry(0.26, 0.6, 6), skin, [0, 2.05, -0.02]);
    // Tattered strips.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      part(body, new THREE.BoxGeometry(0.1, 0.85, 0.02), dark, [
        Math.cos(a) * 0.42,
        0.05,
        Math.sin(a) * 0.42,
      ]).rotation.set(0.18 * Math.cos(a), a, 0.2 * Math.sin(a));
    }
    for (const side of [-1, 1]) {
      part(body, new THREE.SphereGeometry(0.045, 8, 6), eyeMat, [side * 0.12, 1.76, -0.27]);
    }
    const core = glowSprite(spec.glow, 2.2, 0.55);
    core.position.set(0, 1.1, 0);
    body.add(core);
    const hand = glowSprite(spec.glow, 0.9, 0.8);
    hand.position.set(0.42, 1.0, -0.2);
    body.add(hand);
    return { root, body, materials, hover: true };
  }

  if (type === 'stalker') {
    part(body, new THREE.IcosahedronGeometry(0.62, 1), skin, [0, 0.78, 0], [1.55, 0.8, 0.95]);
    // Spines.
    for (let i = 0; i < 5; i++) {
      const spine = part(body, new THREE.ConeGeometry(0.1, 0.55, 5), bone, [0, 1.18, -0.45 + i * 0.24]);
      spine.rotation.x = -0.35;
    }
    // Neck + head.
    part(body, new THREE.CylinderGeometry(0.18, 0.26, 0.5, 6), skin, [0, 0.86, -0.72]).rotation.x = -1.15;
    part(body, new THREE.SphereGeometry(0.27, 10, 8), skin, [0, 0.78, -1.0], [1.1, 0.9, 1.25]);
    part(body, new THREE.BoxGeometry(0.34, 0.14, 0.28), dark, [0, 0.68, -1.06]);
    for (const side of [-1, 1]) {
      const horn = part(body, new THREE.ConeGeometry(0.055, 0.4, 5), bone, [side * 0.19, 0.96, -0.94]);
      horn.rotation.z = side * 0.5;
      part(body, new THREE.SphereGeometry(0.038, 7, 5), eyeMat, [side * 0.11, 0.82, -1.2]);
    }
    // Legs.
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        const hip = part(body, new THREE.CylinderGeometry(0.07, 0.05, 0.62, 5), dark, [
          side * 0.42,
          0.42,
          front * 0.42,
        ]);
        hip.rotation.z = side * 0.32;
        part(body, new THREE.SphereGeometry(0.09, 6, 5), bone, [side * 0.54, 0.1, front * 0.48]);
      }
    }
    const tail = part(body, new THREE.ConeGeometry(0.12, 0.9, 5), skin, [0, 0.9, 0.72]);
    tail.rotation.x = -1.35;
    return { root, body, materials, hover: false };
  }

  // Warden — the shard guardians.
  part(body, new THREE.ConeGeometry(1.15, 2.6, 9, 1, true), skin, [0, 1.35, 0]);
  part(body, new THREE.ConeGeometry(0.85, 1.4, 8, 1, true), dark, [0, 0.42, 0]);
  part(body, new THREE.SphereGeometry(0.5, 12, 10), dark, [0, 2.55, 0]);
  // Pauldrons.
  for (const side of [-1, 1]) {
    part(body, new THREE.SphereGeometry(0.42, 8, 6), bone, [side * 0.82, 2.2, 0], [1, 0.7, 1]);
    part(body, new THREE.ConeGeometry(0.13, 0.5, 5), bone, [side * 1.05, 2.5, 0]).rotation.z = side * -0.5;
  }
  // Crown of shards.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const shard = part(body, new THREE.OctahedronGeometry(0.16, 0), bone, [
      Math.cos(a) * 0.42,
      2.95,
      Math.sin(a) * 0.42,
    ], [1, 2.2, 1]);
    shard.rotation.y = a;
  }
  for (const side of [-1, 1]) {
    part(body, new THREE.SphereGeometry(0.07, 8, 6), eyeMat, [side * 0.19, 2.6, -0.42]);
  }
  // Chest core.
  part(body, new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: spec.glow }), [0, 1.95, -0.5], [1, 1.4, 0.7]);
  const aura = glowSprite(spec.glow, 5.2, 0.4);
  aura.position.set(0, 1.9, 0);
  body.add(aura);
  // Arms.
  for (const side of [-1, 1]) {
    const arm = part(body, new THREE.CylinderGeometry(0.13, 0.1, 1.15, 6), skin, [side * 0.95, 1.6, 0]);
    arm.rotation.z = side * 0.22;
    part(body, new THREE.SphereGeometry(0.16, 7, 6), bone, [side * 1.1, 1.02, 0]);
  }
  return { root, body, materials, hover: true };
}

export class Enemies {
  /**
   * @param {{scene:THREE.Scene, world:any, player:any, powers:any, effects:any, audio:any, camera?:any, onKill?:Function, onPlayerHit?:Function}} deps
   */
  constructor({ scene, world, player, powers, effects, audio, camera, onKill, onPlayerHit }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.powers = powers;
    this.effects = effects;
    this.audio = audio;
    this.camera = camera;
    this.onKill = onKill ?? (() => {});
    this.onPlayerHit = onPlayerHit ?? (() => {});

    /** @type {Array<any>} */
    this.list = [];
    this.projectiles = [];
    this.group = new THREE.Group();
    this.group.name = 'Enemies';
    scene.add(this.group);
    this._buildProjectiles();
    this._tmp = new THREE.Vector3();
    this._activeWarden = null;
  }

  _buildProjectiles() {
    const geometry = new THREE.IcosahedronGeometry(0.18, 1);
    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: '#c6a8ff' }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.projectiles.push({ mesh, active: false, position: mesh.position, velocity: new THREE.Vector3(), life: 0, damage: 0 });
    }
    this.projCursor = 0;
  }

  /** Scatter roaming Veil creatures across the island. */
  spawnAmbient(count = 26) {
    const rng = createRng(6621);
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 60) {
      guard++;
      const angle = rng.range(0, Math.PI * 2);
      const radius = Math.sqrt(rng.next()) * (this.world.islandRadius ?? 560) * 0.82;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const h = this.world.heightAt(x, z);
      if (h < 4 || h > 72) continue;
      if (this.world.slopeAt && this.world.slopeAt(x, z) > 0.42) continue;
      if (Math.hypot(x - LOCATIONS.spawn.x, z - LOCATIONS.spawn.z) < 70) continue;
      let nearPoi = false;
      for (const loc of [LOCATIONS.camp, LOCATIONS.temple, ...LOCATIONS.shards]) {
        if (Math.hypot(x - loc.x, z - loc.z) < (loc.radius ?? 20) + 12) nearPoi = true;
      }
      if (nearPoi) continue;
      const type = placed % 3 === 2 ? 'stalker' : 'drifter';
      this.spawn(type, x, z);
      placed++;
    }
  }

  /**
   * Spawn a Warden beside a shard shrine.
   * @param {string} shardId
   */
  spawnWarden(shardId) {
    if (this.list.some((e) => e.isWarden && e.shardId === shardId)) {
      const existing = this.list.find((e) => e.isWarden && e.shardId === shardId);
      if (existing) return existing;
    }
    const loc = SHARD_LOCATIONS[shardId];
    if (!loc) return null;
    const x = loc.x + 6;
    const z = loc.z + 5;
    const enemy = this.spawn('warden', x, z, {
      shardId,
      name: `Warden of ${loc.name.replace(' Shrine', '').replace(' Grove', '').replace(' Ruins', '')}`,
    });
    return enemy;
  }

  /**
   * Create one enemy.
   * @param {'drifter'|'stalker'|'warden'} type
   * @param {number} x
   * @param {number} z
   * @param {{shardId?:string, name?:string, dormant?:boolean}} [opts]
   */
  spawn(type, x, z, opts = {}) {
    const spec = TYPES[type];
    const built = buildBody(type);
    const y = this.world.heightAt(x, z);
    built.root.position.set(x, y, z);
    built.root.scale.setScalar(spec.scale);
    built.root.visible = true;
    this.group.add(built.root);

    const enemy = {
      id: `e${++enemySerial}`,
      type,
      name: opts.name ?? spec.label,
      spec,
      group: built.root,
      body: built.body,
      materials: built.materials,
      position: built.root.position,
      spawnPoint: new THREE.Vector3(x, y, z),
      /** World-space velocity, refreshed each AI tick for predictive aim. */
      velocity: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      health: spec.health * (type === 'warden' ? 1 : 1),
      maxHealth: spec.health,
      alive: true,
      aggro: false,
      dormant: Boolean(opts.dormant),
      engaged: false,
      attackCooldown: 1 + Math.random() * 2,
      windup: 0,
      windupKind: null,
      hitFlash: 0,
      deadTimer: 0,
      baseY: y,
      phase: Math.random() * Math.PI * 2,
      slows: [],
      radius: spec.radius * spec.scale,
      hitHeight: spec.hitHeight * spec.scale,
      shardId: opts.shardId ?? null,
      isWarden: type === 'warden',
      attackCount: 0,
      lunge: 0,
    };

    this.list.push(enemy);
    if (enemy.isWarden) this._activeWarden = enemy;
    return enemy;
  }

  /** Every living enemy. */
  all() {
    return this.list;
  }

  /** Living enemies within `radius` of a point. */
  inRadius(position, radius) {
    const r2 = radius * radius;
    const out = [];
    for (const enemy of this.list) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - position.x;
      const dz = enemy.position.z - position.z;
      if (dx * dx + dz * dz <= r2) out.push(enemy);
    }
    return out;
  }

  /** Nearest living enemy to a point. */
  nearestAlive(position, maxDist = Infinity) {
    let best = null;
    let bestDist = maxDist;
    for (const enemy of this.list) {
      if (!enemy.alive) continue;
      const d = Math.hypot(enemy.position.x - position.x, enemy.position.z - position.z);
      if (d < bestDist) {
        bestDist = d;
        best = enemy;
      }
    }
    return best;
  }

  /** Warden the player is currently fighting, for the boss bar. */
  activeWarden() {
    const warden = this.list.find((e) => e.isWarden && e.alive && e.engaged && !e.dormant);
    return warden ?? null;
  }

  /** Living Warden guarding a shard. */
  wardenFor(shardId) {
    return this.list.find((e) => e.isWarden && e.shardId === shardId && e.alive) ?? null;
  }

  /** Wake dormant wardens (quest reached the shard hunt). */
  activateWardens() {
    for (const enemy of this.list) {
      if (enemy.isWarden) enemy.dormant = false;
    }
  }

  /**
   * Apply damage to one enemy.
   * @param {any} enemy
   * @param {number} amount
   * @param {{source?:string, color?:string, knockback?:number, from?:THREE.Vector3, silentNumber?:boolean, crit?:boolean}} [opts]
   */
  damage(enemy, amount, opts = {}) {
    if (!enemy || !enemy.alive) return 0;
    if (enemy.invulnerable) {
      this.effects.damageNumber(
        new THREE.Vector3(enemy.position.x, enemy.position.y + (enemy.hitHeight ?? 1), enemy.position.z),
        0,
        { color: '#9ecbff' },
      );
      return 0;
    }
    const dealt = Math.round(mitigate(amount, enemy.spec.armor));
    enemy.health = Math.max(0, enemy.health - dealt);
    enemy.hitFlash = 0.22;
    enemy.aggro = true;
    enemy.engaged = true;
    if (enemy.dormant) enemy.dormant = false;

    const point = new THREE.Vector3(
      enemy.position.x,
      enemy.position.y + enemy.hitHeight,
      enemy.position.z,
    );
    if (!opts.silentNumber) {
      this.effects.damageNumber(point, dealt, { color: opts.color ?? '#ffe9a8', crit: opts.crit });
    }
    this.effects.burst(point, {
      count: 10,
      color: opts.color ?? '#ffb066',
      speed: 3.6,
      size: 0.26,
      life: 0.4,
      gravity: 2,
      drag: 2,
    });
    this.audio?.enemyHit();
    this.camera?.addShake?.(enemy.isWarden ? 0.1 : 0.035);

    if (opts.knockback && opts.from) {
      const dx = enemy.position.x - opts.from.x;
      const dz = enemy.position.z - opts.from.z;
      const len = Math.hypot(dx, dz) || 1;
      const push = opts.knockback * (enemy.isWarden ? 0.22 : 1);
      enemy.position.x += (dx / len) * push;
      enemy.position.z += (dz / len) * push;
    }

    if (enemy.health <= 0) {
      if (typeof enemy.onDefeat === 'function') enemy.onDefeat(enemy);
      else this._kill(enemy);
    }
    return dealt;
  }

  /** Apply or refresh a slow. */
  slow(enemy, factor, duration) {
    if (!enemy?.alive) return;
    enemy.slows.push({ factor, remaining: duration });
    const combined = combineSlows(enemy.slows);
    enemy.slows = [{ factor: combined.factor, remaining: combined.remaining }];
  }

  /** Death: FX, reward callback, then shrink away. */
  _kill(enemy) {
    enemy.alive = false;
    enemy.deadTimer = 1.1;
    enemy.aggro = false;
    enemy.windup = 0;
    const point = new THREE.Vector3(enemy.position.x, enemy.position.y + enemy.hitHeight, enemy.position.z);

    this.effects.burst(point, {
      count: enemy.isWarden ? 120 : 40,
      color: '#b48cff',
      speed: enemy.isWarden ? 11 : 6,
      size: enemy.isWarden ? 0.5 : 0.34,
      life: 1.2,
      gravity: 1.6,
      drag: 1.6,
      jitter: 0.5,
    });
    this.effects.burst(point, {
      count: enemy.isWarden ? 50 : 18,
      color: '#f0e6ff',
      speed: enemy.isWarden ? 7 : 3.6,
      size: 0.3,
      life: 0.9,
      gravity: -0.8,
      drag: 2,
    });
    this.effects.ring(enemy.position.clone(), {
      color: '#c6a8ff',
      radius: enemy.isWarden ? 12 : 4,
      life: enemy.isWarden ? 0.9 : 0.5,
    });
    this.effects.light(point, {
      color: '#b48cff',
      intensity: enemy.isWarden ? 18 : 6,
      distance: enemy.isWarden ? 40 : 16,
      life: 0.6,
    });
    if (enemy.isWarden) {
      this.camera?.addShake?.(0.6);
      this.audio?.beacon?.();
    } else {
      this.audio?.enemyHit();
    }
    this.onKill(enemy);
  }

  /** Launch a homing orb from a Drifter. */
  _fireProjectile(enemy) {
    const slot = this.projectiles[this.projCursor];
    this.projCursor = (this.projCursor + 1) % this.projectiles.length;
    const origin = new THREE.Vector3(
      enemy.position.x,
      enemy.position.y + enemy.hitHeight,
      enemy.position.z,
    );
    const target = this.player.position;
    const targetPoint = new THREE.Vector3(target.x, target.y + 1.0, target.z);
    const dir = targetPoint.sub(origin).normalize();
    slot.mesh.position.copy(origin);
    slot.mesh.visible = true;
    slot.active = true;
    slot.velocity.copy(dir).multiplyScalar(17);
    slot.life = 2.2;
    slot.damage = enemy.spec.damage;
    this.effects.burst(origin, {
      count: 8,
      color: enemy.spec.glow,
      speed: 2.4,
      size: 0.24,
      life: 0.3,
      gravity: 0,
    });
  }

  /** Melee / slam hit against the player. */
  _hitPlayer(enemy, damage, kind = 'melee', range = null) {
    const reach = range ?? enemy.spec.attackRange + 1.4;
    const dist = Math.hypot(
      enemy.position.x - this.player.position.x,
      enemy.position.z - this.player.position.z,
    );
    if (dist > reach) return false;

    this.damagePlayer(damage, {
      origin: enemy.position,
      kind,
      shake: enemy.isWarden ? 0.55 : 0.24,
    });
    if (kind === 'nova') {
      this.effects.ring(enemy.position.clone(), { color: '#c6a8ff', radius: 9, life: 0.55 });
    }
    return true;
  }

  /**
   * Apply damage to the player from any source (enemy melee, boss attack,
   * projectile). Dodge i-frames are authoritative here so no attacker can
   * bypass them.
   *
   * @param {number} damage
   * @param {{origin?:THREE.Vector3, kind?:string, shake?:number, color?:string, silent?:boolean}} [opts]
   * @returns {boolean} whether the hit landed
   */
  damagePlayer(damage, opts = {}) {
    if (this.powers.dead) return false;
    if (this.player.invulnerable) {
      if (!opts.silent) {
        const at = this.player.position.clone().setY(this.player.position.y + 1.1);
        this.effects.burst(at, {
          count: 8,
          color: '#bfefff',
          speed: 2.4,
          size: 0.2,
          life: 0.3,
          gravity: -0.6,
        });
      }
      return false;
    }

    const shieldBefore = this.powers.shieldHp;
    const result = applyDamage(this.powers, damage);
    this.onPlayerHit(result, opts.origin ?? null);
    this.audio?.damage();
    this.camera?.addShake?.(opts.shake ?? 0.24);

    const point = new THREE.Vector3(this.player.position.x, this.player.position.y + 1.1, this.player.position.z);
    this.effects.burst(point, {
      count: 16,
      color: opts.color ?? '#ff6b5e',
      speed: 4,
      size: 0.3,
      life: 0.45,
      gravity: 2,
    });
    if (shieldBefore > 0 && this.powers.shieldHp <= 0) {
      this.onShieldBreak?.();
    }
    return true;
  }

  /** Per-frame AI. */
  update(dt, elapsed) {
    const player = this.player.position;

    for (const enemy of this.list) {
      if (enemy.isBoss) continue; // FinalBoss drives its own AI and animation.
      if (!enemy.alive) {
        enemy.velocity?.set(0, 0, 0);
        if (enemy.deadTimer > 0) {
          enemy.deadTimer -= dt;
          const t = clamp(enemy.deadTimer / 1.1, 0, 1);
          enemy.group.scale.setScalar(enemy.spec.scale * t);
          enemy.group.rotation.y += dt * 3;
          if (enemy.deadTimer <= 0) enemy.group.visible = false;
        }
        continue;
      }

      const spec = enemy.spec;
      const beforeX = enemy.position.x;
      const beforeY = enemy.position.y;
      const beforeZ = enemy.position.z;
      enemy.slows = tickSlows(enemy.slows, dt);
      const { factor: slowFactor } = combineSlows(enemy.slows);

      const dx = player.x - enemy.position.x;
      const dz = player.z - enemy.position.z;
      const dist = Math.hypot(dx, dz);
      const ground = this.world.heightAt(enemy.position.x, enemy.position.z);

      // Idle hover / breathing.
      enemy.phase += dt * 1.6;
      const hover = spec.hover + Math.sin(enemy.phase) * 0.12 * (spec.hover > 0 ? 1 : 0);
      enemy.baseY = ground;

      if (enemy.dormant) {
        enemy.group.position.y = ground + hover;
        enemy.body.rotation.y = Math.sin(elapsed * 0.4 + enemy.phase) * 0.2;
        enemy.velocity?.set(0, 0, 0);
        continue;
      }

      // Aggro / leash.
      if (!enemy.aggro && dist < spec.aggro) {
        enemy.aggro = true;
        enemy.engaged = true;
      }
      if (enemy.aggro) {
        const fromSpawn = Math.hypot(enemy.position.x - enemy.spawnPoint.x, enemy.position.z - enemy.spawnPoint.z);
        if (fromSpawn > spec.leash || this.powers.dead) {
          enemy.aggro = false;
          enemy.engaged = false;
        }
      }

      let moveSpeed = 0;
      if (enemy.aggro && enemy.windup <= 0) {
        const stop = spec.attackRange * 0.82;
        if (dist > stop) moveSpeed = spec.speed * slowFactor;
      }

      if (moveSpeed > 0) {
        const nx = dx / (dist || 1);
        const nz = dz / (dist || 1);
        enemy.position.x += nx * moveSpeed * dt;
        enemy.position.z += nz * moveSpeed * dt;
        // Separation from other enemies.
        for (const other of this.list) {
          if (other === enemy || !other.alive) continue;
          const ox = enemy.position.x - other.position.x;
          const oz = enemy.position.z - other.position.z;
          const d = Math.hypot(ox, oz);
          const min = enemy.radius + other.radius;
          if (d < min && d > 0.0001) {
            const push = ((min - d) / d) * 0.5;
            enemy.position.x += ox * push;
            enemy.position.z += oz * push;
          }
        }
      }

      // Keep inside the island.
      const radial = Math.hypot(enemy.position.x, enemy.position.z);
      const limit = (this.world.islandRadius ?? 560) * 0.97;
      if (radial > limit) {
        const s = limit / radial;
        enemy.position.x *= s;
        enemy.position.z *= s;
      }

      // Lunge movement.
      if (enemy.lunge > 0) {
        enemy.lunge = Math.max(0, enemy.lunge - dt);
        const nx = dx / (dist || 1);
        const nz = dz / (dist || 1);
        enemy.position.x += nx * 8 * dt;
        enemy.position.z += nz * 8 * dt;
      }

      // Face the player.
      if (enemy.aggro) {
        const targetYaw = Math.atan2(-dx, -dz);
        enemy.yaw = dampAngle(enemy.yaw, targetYaw, 7, dt);
      }
      enemy.group.rotation.y = enemy.yaw;

      // Ground follow + hover.
      const newGround = this.world.heightAt(enemy.position.x, enemy.position.z);
      const targetY = newGround + hover;
      enemy.position.y = damp(enemy.position.y, targetY, spec.hover > 0 ? 6 : 18, dt);

      // Bob / weave for flyers.
      if (spec.hover > 0) {
        enemy.body.position.y = Math.sin(elapsed * 1.4 + enemy.phase) * 0.16;
        enemy.body.rotation.z = Math.sin(elapsed * 0.9 + enemy.phase) * 0.06;
      } else {
        enemy.body.position.y = Math.abs(Math.sin(elapsed * 5 + enemy.phase)) * 0.06;
        enemy.body.rotation.z = 0;
      }

      // Hit flash.
      if (enemy.hitFlash > 0) {
        enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
        const flash = enemy.hitFlash / 0.22;
        for (const material of enemy.materials) {
          material.emissiveIntensity = 0.9 + flash * 5;
        }
      } else {
        for (const material of enemy.materials) {
          material.emissiveIntensity = damp(material.emissiveIntensity, 0.9, 8, dt);
        }
      }

      // Attack cycle.
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      if (enemy.aggro && enemy.windup > 0) {
        enemy.windup -= dt;
        if (enemy.windup <= 0) {
          enemy.windup = 0;
          enemy.attackCooldown = spec.cooldown;
          enemy.attackCount += 1;
          if (spec.ranged) {
            this._fireProjectile(enemy);
            this.effects.burst(
              new THREE.Vector3(enemy.position.x, enemy.position.y + enemy.hitHeight, enemy.position.z),
              { count: 12, color: spec.glow, speed: 3, size: 0.28, life: 0.4, gravity: 0 },
            );
          } else if (enemy.isWarden && enemy.attackCount % 3 === 0) {
            this._hitPlayer(enemy, 18, 'nova', 9);
          } else {
            enemy.lunge = 0.18;
            this._hitPlayer(enemy, spec.damage, 'melee');
          }
        }
      } else if (enemy.aggro && dist <= spec.attackRange && enemy.attackCooldown <= 0) {
        enemy.windup = spec.windup;
        enemy.windupKind = spec.ranged ? 'ranged' : 'melee';
        // Telegraph: a bright ring at the enemy's feet.
        this.effects.ring(enemy.position.clone(), {
          color: spec.glow,
          radius: enemy.radius + 1.4,
          life: spec.windup,
          opacity: 0.55,
        });
      }

      if (dt > 0 && enemy.velocity) {
        enemy.velocity.set(
          (enemy.position.x - beforeX) / dt,
          (enemy.position.y - beforeY) / dt,
          (enemy.position.z - beforeZ) / dt,
        );
      }
    }

    // Enemy projectiles.
    for (const slot of this.projectiles) {
      if (!slot.active) continue;
      slot.life -= dt;
      slot.mesh.position.addScaledVector(slot.velocity, dt);
      slot.mesh.rotation.y += dt * 8;
      const target = this.player.position;
      const dist = Math.hypot(
        slot.mesh.position.x - target.x,
        slot.mesh.position.y - (target.y + 1.0),
        slot.mesh.position.z - target.z,
      );
      if (dist < 0.9) {
        this.damagePlayer(slot.damage, {
          origin: slot.mesh.position,
          kind: 'projectile',
          shake: 0.22,
          color: '#c6a8ff',
        });
        this.effects.burst(slot.mesh.position, {
          count: 14,
          color: '#c6a8ff',
          speed: 3.4,
          size: 0.28,
          life: 0.4,
          gravity: 1.6,
        });
        slot.active = false;
        slot.mesh.visible = false;
      } else if (slot.life <= 0) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    }
  }

  /** Remove a single enemy (summons, cleanup). */
  despawn(enemy) {
    if (!enemy) return;
    const index = this.list.indexOf(enemy);
    if (index >= 0) this.list.splice(index, 1);
    enemy.group?.parent?.remove(enemy.group);
    if (enemy.isWarden && this._activeWarden === enemy) this._activeWarden = null;
  }

  /** Remove every enemy and start fresh (new game). */
  reset() {
    for (const enemy of this.list) this.group.remove(enemy.group);
    this.list.length = 0;
    for (const slot of this.projectiles) {
      slot.active = false;
      slot.mesh.visible = false;
    }
    this._activeWarden = null;
  }
}
