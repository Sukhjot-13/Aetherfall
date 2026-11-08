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
import { springDamp, secondaryLag, enemyLocomotion } from '../player/gait.js';
import { hasLineOfSight } from './aim.js';
import { inEnemyStrike, segmentCircleEntry, segmentSphereEntry, steerAround } from './enemyMovement.js';
import { WardenVisual } from './WardenVisual.js';

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
    color: '#5c2330',
    glow: '#ff8a7a',
    ranged: false,
    scale: 1,
  },
  husk: {
    // Gutted remnant: fast, frail, and comes in packs — the swarm variety
    // the island needed between patient drifters and heavy wardens.
    label: 'Veil Husk',
    health: 34,
    armor: 0,
    speed: 7.4,
    aggro: 22,
    leash: 80,
    attackRange: 2.2,
    damage: 8,
    windup: 0.3,
    cooldown: 1.1,
    radius: 0.55,
    hitHeight: 0.8,
    hover: 0,
    color: '#5a4632',
    glow: '#ffd27a',
    ranged: false,
    scale: 0.85,
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
    hitHeight: 1.3,
    hover: 0,
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

  const skin = new THREE.MeshPhysicalMaterial({
    color: spec.color,
    emissive: new THREE.Color(spec.glow).multiplyScalar(0.22),
    emissiveIntensity: 0.9,
    roughness: 0.38,
    metalness: 0.08,
    clearcoat: 0.55,
    clearcoatRoughness: 0.5,
    sheen: 0.5,
    sheenColor: new THREE.Color(spec.glow),
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
    // Tattered strips: pivot groups so they flutter with the hover.
    const tatters = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * 0.42, 0.42, Math.sin(a) * 0.42);
      pivot.rotation.y = a;
      body.add(pivot);
      const strip = part(pivot, new THREE.BoxGeometry(0.1, 0.85, 0.02), dark, [0, -0.42, 0]);
      strip.rotation.set(0.18 * Math.cos(a), 0, 0.2 * Math.sin(a));
      tatters.push({ pivot, phase: i * 1.3 });
    }
    body.userData.tatters = tatters;
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
    // Legs are pivot groups on the body so the stride can swing them.
    const legs = [];
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
    // Legs: pivot groups so each swings fore/aft with the stride.
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.42, 0.62, front * 0.42);
        body.add(pivot);
        const hip = part(pivot, new THREE.CylinderGeometry(0.07, 0.05, 0.62, 5), dark, [0, -0.22, 0]);
        hip.rotation.z = side * 0.32;
        part(pivot, new THREE.SphereGeometry(0.09, 6, 5), bone, [side * 0.12, -0.52, front * 0.06]);
        legs.push({ pivot, side, restY: pivot.position.y, phase: (side < 0 ? 0 : 0.5) + (front < 0 ? 0 : 0.5) });
      }
    }
    const tail = part(body, new THREE.ConeGeometry(0.12, 0.9, 5), skin, [0, 0.9, 0.72]);
    tail.rotation.x = -1.35;
    return { root, body, materials, hover: false, legs };
  }

  if (type === 'husk') {
    // Gutted walker: bent torso, dragging thin limbs, ember core.
    part(body, new THREE.CylinderGeometry(0.26, 0.34, 0.95, 7), skin, [0, 0.62, 0], [1, 1, 0.8]);
    part(body, new THREE.SphereGeometry(0.24, 9, 7), dark, [0, 1.18, -0.06], [1, 0.95, 0.95]);
    part(body, new THREE.ConeGeometry(0.16, 0.5, 6), bone, [0, 1.45, 0.08]);
    const legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.16, 0.42, 0);
      body.add(pivot);
      part(pivot, new THREE.CylinderGeometry(0.045, 0.03, 0.5, 5), dark, [0, -0.2, 0]);
      part(pivot, new THREE.CylinderGeometry(0.035, 0.02, 0.4, 5), dark, [0, -0.05, -0.18]).rotation.x = 0.9;
      legs.push({ pivot, side, restY: pivot.position.y, phase: side < 0 ? 0 : 0.5 });
    }
    for (const side of [-1, 1]) {
      const arm = part(body, new THREE.CylinderGeometry(0.035, 0.025, 0.55, 5), bone, [side * 0.34, 0.72, -0.12]);
      arm.rotation.set(0.7, 0, side * 0.5);
    }
    for (const side of [-1, 1]) {
      part(body, new THREE.SphereGeometry(0.035, 7, 5), eyeMat, [side * 0.09, 1.2, -0.22]);
    }
    const core = glowSprite(spec.glow, 1.1, 0.7);
    core.position.set(0, 0.62, -0.14);
    body.add(core);
    return { root, body, materials, hover: false, legs };
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
      // Mixed packs: stalkers hunt alone, husks hunt in threes, drifters
      // hang back — the island reads varied instead of one species.
      const roll = placed % 5;
      if (roll === 4) {
        for (let k = 0; k < 3 && placed < count; k++) {
          this.spawn('husk', x + (k - 1) * 3, z + ((k * 7) % 5) - 2);
          placed++;
        }
      } else {
        const type = roll === 2 ? 'stalker' : 'drifter';
        this.spawn(type, x, z);
        placed++;
      }
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
      legs: built.legs ?? [],
      velX: 0,
      velZ: 0,
      hitstop: 0,
      avoidSide: enemySerial % 2 ? 1 : -1,
      attackYaw: 0,
      cancelTelegraph: null,
    };

    this.list.push(enemy);
    if (enemy.isWarden) {
      this._activeWarden = enemy;
      this._attachWardenVisual(enemy);
    }
    return enemy;
  }

  async _attachWardenVisual(enemy) {
    try {
      const visual = await WardenVisual.create();
      if (!enemy.alive || !this.list.includes(enemy)) { visual.dispose(); return; }
      enemy.group.add(visual.group);
      enemy.body.visible = false;
      enemy.visual = visual;
      enemy.materials = visual.materials;
    } catch (error) {
      console.warn('Using procedural Warden fallback:', error);
    }
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
    enemy.hitTimer = 0.22;
    // Hitstop: the enemy freezes for a beat so impacts read as impacts.
    // Crits freeze longer; Wardens barely flinch. Chain second targets go
    // through this same path, so the "2nd number" freezes like the first.
    enemy.hitstop = enemy.isWarden ? 0.03 : opts.crit ? 0.12 : 0.06;
    enemy.knockX = 0; enemy.knockZ = 0;
    enemy.aggro = true;
    enemy.returning = false;
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
    // Hit: a tight spark snap + a soft ring so hits read as impacts, not puffs.
    this.effects.burst(point, {
      count: opts.crit ? 22 : 10,
      color: opts.color ?? '#ffb066',
      speed: opts.crit ? 5.6 : 3.6,
      size: opts.crit ? 0.34 : 0.26,
      life: 0.4,
      gravity: 2,
      drag: 2,
    });
    // Extra impact sparks for crits so big hits feel bigger.
    if (opts.crit) {
      this.effects.burst(point, {
        count: 12,
        color: '#ffffff',
        speed: 6.5,
        size: 0.2,
        life: 0.3,
        gravity: 1,
        drag: 2,
      });
    }
    this.effects.ring(enemy.position.clone(), { color: opts.color ?? '#ffb066', radius: enemy.isWarden ? 3.2 : 2.2, life: 0.28, opacity: 0.7 });
    this.effects.flash(point, { color: opts.color ?? '#ffb066', size: 1.7, life: 0.18, growth: 2.2, opacity: 0.7 });
    this.audio?.enemyHit();
    this.camera?.addShake?.(enemy.isWarden ? 0.12 : 0.05);

    if (opts.knockback && opts.from) {
      if (enemy.windup > 0) {
        enemy.cancelTelegraph?.();
        enemy.cancelTelegraph = null;
        enemy.windup = 0;
        enemy.attackCooldown = Math.max(enemy.attackCooldown, 0.6);
      }
      const dx = enemy.position.x - opts.from.x;
      const dz = enemy.position.z - opts.from.z;
      const len = Math.hypot(dx, dz) || 1;
      const push = opts.knockback * (enemy.isWarden ? 0.22 : 1);
      enemy.position.x += (dx / len) * push;
      enemy.position.z += (dz / len) * push;
      enemy.knockX = (dx / len) * push * 1.6;
      enemy.knockZ = (dz / len) * push * 1.6;
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

  /** Death: FX, reward callback, then dissolve + soul wisps. */
  _kill(enemy) {
    enemy.cancelTelegraph?.();
    enemy.cancelTelegraph = null;
    enemy.alive = false;
    enemy.deadTimer = 1.1;
    enemy.deadDuration = 1.1;
    enemy.aggro = false;
    enemy.windup = 0;
    enemy.deadSpin = 0;
    const point = new THREE.Vector3(enemy.position.x, enemy.position.y + enemy.hitHeight, enemy.position.z);
    // Soul wisps rising: gravity negative carries them up out of the body.
    this.effects.burst(point, { count: 12, color: '#f0e6ff', speed: 1.6, size: 0.34, life: 1.3, gravity: -2.4, drag: 1.4 });
    this.effects.flash(point, { color: '#b48cff', size: 3.4, life: 0.3, growth: 2.6, opacity: 0.8 });

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
      this.audio?.wardenDeath?.();
    } else {
      this.audio?.enemyDeath?.();
    }
    this.onKill(enemy);
  }

  /** Launch a straight-moving orb from a Drifter. */
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

  /** Check terrain and props before a ranged enemy commits to a shot. */
  _clearShot(enemy, target) {
    const start = { x: enemy.position.x, y: enemy.position.y + enemy.hitHeight, z: enemy.position.z };
    const end = { x: target.x, y: target.y + 1, z: target.z };
    if (!hasLineOfSight(start, end, (x, z) => this.world.heightAt(x, z), { samples: 5, clearance: 0.15 })) return false;
    return this._firstPropHit(start, end) === null;
  }

  /** Earliest hit against a nearby prop's approximate vertical cylinder. */
  _firstPropHit(start, end) {
    const mx = (start.x + end.x) * 0.5, mz = (start.z + end.z) * 0.5;
    const radius = Math.hypot(end.x - start.x, end.z - start.z) * 0.5 + 0.2;
    const colliders = this.world.queryColliders?.(mx, mz, radius) ?? this.world.colliders ?? [];
    let first = null;
    for (const collider of colliders) {
      if (collider.active === false) continue;
      const t = segmentCircleEntry(start, end, collider, 0.18);
      if (t === null || (first !== null && t >= first)) continue;
      const y = start.y + (end.y - start.y) * t;
      const base = this.world.heightAt(collider.x, collider.z);
      if (y >= base - 0.2 && y <= base + Math.max(3, collider.r * 2)) first = t;
    }
    return first;
  }

  /** Directional melee strike or radial Warden nova. */
  _hitPlayer(enemy, damage, kind = 'melee', range = null) {
    const reach = range ?? enemy.spec.attackRange + 1.4;
    const nova = kind === 'nova';
    const origin = { x: enemy.position.x, y: nova ? enemy.baseY : enemy.position.y + enemy.hitHeight, z: enemy.position.z };
    const target = { x: this.player.position.x, y: this.player.position.y + (nova ? 0 : 1), z: this.player.position.z };
    const verticalReach = nova ? 1.1 : enemy.isWarden ? 3.5 : 1.8;
    if (!inEnemyStrike(origin, enemy.attackYaw, target, reach, verticalReach, kind === 'nova' ? Math.PI : undefined)) return false;
    return this.damagePlayer(damage, {
      origin: enemy.position, kind, shake: enemy.isWarden ? 0.55 : 0.24,
    });
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
    const playerInCamp = Math.hypot(player.x - LOCATIONS.camp.x, player.z - LOCATIONS.camp.z) < 18;

    for (const enemy of this.list) {
      if (enemy.isBoss) continue; // FinalBoss drives its own AI and animation.
      if (!enemy.alive) {
        enemy.velocity?.set(0, 0, 0);
        if (enemy.deadTimer > 0) {
          enemy.deadTimer -= dt;
          const total = enemy.deadDuration ?? 1.1;
          const t = clamp(enemy.deadTimer / total, 0, 1);
          const ease = t * t;
          // Death: pop + spin + rise, with a quick squash at the end, so the
          // body reads as an explosion of light rather than shrinking away.
          const pop = 1 + (1 - t) * 0.12;
          enemy.group.scale.setScalar(Math.max(0.01, enemy.spec.scale * ease * pop));
          enemy.group.rotation.y += dt * (3 + (1 - t) * 4);
          enemy.group.position.y += dt * (1.2 + (1 - t) * 1.6);
          for (const material of enemy.materials ?? []) {
            if (material.emissive) material.emissiveIntensity = 0.9 + (1 - t) * 4;
            if (material.transparent === false) { material.transparent = true; }
            material.opacity = Math.max(0.08, t);
            material.depthWrite = t > 0.35;
          }
          if (enemy.deadTimer <= 0) {
            enemy.group.visible = false;
            for (const material of enemy.materials ?? []) { material.opacity = 1; material.transparent = false; material.depthWrite = true; }
          }
        }
        if (enemy.deadTimer <= 0) this._releaseEnemyVisuals(enemy);
        continue;
      }

      const spec = enemy.spec;
      const beforeX = enemy.position.x;
      const beforeY = enemy.position.y;
      const beforeZ = enemy.position.z;
      // Distant idle enemies sleep without flashing into view on a timer.
      // Pursuers and returning enemies stay active so their leash still works.
      {
        const fdx = player.x - enemy.position.x;
        const fdz = player.z - enemy.position.z;
        if (!enemy.aggro && !enemy.returning && fdx * fdx + fdz * fdz > 62500) {
          enemy._sleepTimer = (enemy._sleepTimer ?? 0) + dt;
          enemy.group.visible = false;
          enemy.velocity?.set(0, 0, 0);
          continue;
        }
        enemy.group.visible = true;
      }
      const slept = enemy._sleepTimer ?? 0;
      enemy._sleepTimer = 0;
      if (slept > 0) {
        enemy.hitstop = Math.max(0, (enemy.hitstop ?? 0) - slept);
        enemy.hitFlash = Math.max(0, (enemy.hitFlash ?? 0) - slept);
        enemy.attackCooldown = Math.max(0, enemy.attackCooldown - slept);
        if (enemy.hitFlash === 0) {
          for (const material of enemy.materials ?? []) material.emissiveIntensity = 0.9;
        }
      }
      enemy.slows = tickSlows(enemy.slows, dt + slept);
      const { factor: slowFactor } = combineSlows(enemy.slows);

      // Hitstop freeze: consume the timer and hold still this frame.
      // Flash still decays so the hit reads as a snap, not a stall.
      if ((enemy.hitstop ?? 0) > 0) {
        enemy.hitstop = Math.max(0, enemy.hitstop - dt);
        if (enemy.hitFlash > 0) {
          enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
          const flash = enemy.hitFlash / 0.22;
          for (const material of enemy.materials) material.emissiveIntensity = 0.9 + flash * 5;
        }
        enemy.velocity?.set(0, 0, 0);
        continue;
      }

      const dx = player.x - enemy.position.x;
      const dz = player.z - enemy.position.z;
      const dist = Math.hypot(dx, dz);
      const ground = this.world.heightAt(enemy.position.x, enemy.position.z);

      // Fluid locomotion: smoothed speed (moveBlend) drives bob/lean so
      // enemies ease in/out instead of snapping. Phase advances with speed
      // so the bob matches stride, not the clock.
      enemy.phase += dt * (1.6 + (enemy.moveBlend ?? 0) * 4.5);
      const hover = spec.hover + Math.sin(enemy.phase) * 0.12 * (spec.hover > 0 ? 1 : 0);
      enemy.baseY = ground;

      if (enemy.dormant) {
        enemy.moveBlend = damp(enemy.moveBlend ?? 0, 0, 8, dt);
        enemy.group.position.y = ground + hover;
        enemy.body.rotation.y = Math.sin(elapsed * 0.4 + enemy.phase) * 0.2;
        enemy.visual?.update(dt, enemy);
        enemy.velocity?.set(0, 0, 0);
        continue;
      }

      // Aggro / leash.
      if (enemy.returning && Math.hypot(enemy.position.x - enemy.spawnPoint.x, enemy.position.z - enemy.spawnPoint.z) < 2) {
        enemy.returning = false;
      }
      if (!enemy.aggro && !enemy.returning && !playerInCamp && dist < spec.aggro) {
        enemy.aggro = true;
        enemy.engaged = true;
        this.audio?.growl?.(enemy.type);
      }
      if (enemy.aggro) {
        const fromSpawn = Math.hypot(enemy.position.x - enemy.spawnPoint.x, enemy.position.z - enemy.spawnPoint.z);
        if (fromSpawn > spec.leash || this.powers.dead || playerInCamp) {
          enemy.aggro = false;
          enemy.engaged = false;
          enemy.returning = true;
          enemy.cancelTelegraph?.();
          enemy.cancelTelegraph = null;
          enemy.windup = 0;
          enemy.lunge = 0;
        }
      }

      if (enemy.aggro && spec.ranged && dist < spec.attackRange + 4) {
        enemy._shotTimer = (enemy._shotTimer ?? 0) - dt;
        if (enemy._shotTimer <= 0) {
          enemy._shotTimer = 0.35;
          enemy._clearShot = this._clearShot(enemy, player);
        }
      }
      let moveSpeed = 0;
      if (enemy.aggro && enemy.windup <= 0) {
        const stop = spec.attackRange * 0.82;
        if (dist > stop || (spec.ranged && enemy._clearShot === false)) moveSpeed = spec.speed * slowFactor;
      }
      // Idle life: non-aggro enemies drift on slow wander loops (pause,
      // stroll, pause) so the world feels inhabited before contact.
      let wanderX = 0;
      let wanderZ = 0;
      if (!enemy.aggro && !enemy.returning) {
        enemy._wanderTimer = (enemy._wanderTimer ?? 0) + dt;
        if (enemy._wanderTimer > (enemy._wanderPeriod ?? 3)) {
          enemy._wanderTimer = 0;
          enemy._wanderPeriod = 2.5 + Math.abs(Math.sin((enemy.position.x + enemy.position.z) * 0.7)) * 4;
          enemy._wanderAng = Math.sin((enemy.position.x * 1.7 + enemy.position.z * 0.9)) * Math.PI * 2;
          enemy._wanderGo = Math.abs(Math.sin((enemy.position.x + enemy.position.z) * 0.13)) > 0.45;
        } else if (enemy._wanderGo) {
          const a = enemy._wanderAng ?? 0;
          wanderX = Math.cos(a) * 1.1;
          wanderZ = Math.sin(a) * 1.1;
          enemy._wanderYaw = a;
        }
      }
      // Desired velocity toward the player; actual velocity chases it with
      // accel/decel so the body never snaps start/stop. moveBlend follows
      // the *actual* speed for the stride bob, not the demand.
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      const homeX = enemy.spawnPoint.x - enemy.position.x;
      const homeZ = enemy.spawnPoint.z - enemy.position.z;
      const homeDist = Math.hypot(homeX, homeZ) || 1;
      let desiredX = enemy.returning ? homeX / homeDist * spec.speed : nx * moveSpeed + wanderX;
      let desiredZ = enemy.returning ? homeZ / homeDist * spec.speed : nz * moveSpeed + wanderZ;
      const nearby = this.world.queryColliders?.(enemy.position.x, enemy.position.z, enemy.radius + 5) ?? this.world.colliders ?? [];
      if (desiredX || desiredZ) {
        const steered = steerAround(enemy.position, { x: desiredX, z: desiredZ }, enemy.radius, nearby, enemy.avoidSide);
        desiredX = steered.x;
        desiredZ = steered.z;
      }
      enemy.velX = damp(enemy.velX ?? 0, desiredX, 4.2, dt);
      enemy.velZ = damp(enemy.velZ ?? 0, desiredZ, 4.2, dt);
      const actualSpeed = Math.hypot(enemy.velX, enemy.velZ);
      enemy.moveBlend = damp(enemy.moveBlend ?? 0, actualSpeed > 0.1 ? Math.min(1, actualSpeed / Math.max(1, spec.speed)) : 0, 6, dt);

      if (actualSpeed > 0.01) {
        enemy.position.x += enemy.velX * dt;
        enemy.position.z += enemy.velZ * dt;
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
        enemy.position.x += -Math.sin(enemy.attackYaw) * 8 * dt;
        enemy.position.z += -Math.cos(enemy.attackYaw) * 8 * dt;
      }

      // Face the player (or wander direction when idling), with a soft turn.
      {
        let targetYaw = enemy.yaw;
        if (enemy.aggro && enemy.windup > 0) targetYaw = enemy.attackYaw;
        else if (enemy.aggro) targetYaw = Math.atan2(-dx, -dz);
        else if (actualSpeed > 0.1) targetYaw = Math.atan2(-enemy.velX, -enemy.velZ);
        enemy.yaw = dampAngle(enemy.yaw, targetYaw, 5.5, dt);
      }
      enemy.group.rotation.y = enemy.yaw;
      // Strafe sway while engaged: weight shifts side-to-side like a body
      // circling rather than beelining, plus breathing at rest.
      const swayEnv = enemy.aggro ? 1 : 0.35;
      enemy.body.rotation.z = Math.sin(elapsed * (enemy.aggro ? 2.1 : 1.1) + enemy.phase) * 0.05 * swayEnv + (enemy.body.rotation.z || 0) * 0.9;

      // Ground follow + hover + smoothed yaw. Yaw damps harder while
      // windup coils so the turn reads deliberate; movement blends accel.
      // Reuse the pre-move ground sample merged with the post-move height
      // via one damp: a second analytic FBM height per enemy per frame
      // was the main enemy cost.
      const targetY = ground + hover;
      enemy.position.y = damp(enemy.position.y, targetY, spec.hover > 0 ? 6 : 18, dt);

      // Knockback carry: decaying slide so hits shove instead of teleport.
      if ((enemy.knockX || 0) || (enemy.knockZ || 0)) {
        enemy.position.x += enemy.knockX * dt;
        enemy.position.z += enemy.knockZ * dt;
        enemy.knockX = damp(enemy.knockX, 0, 8, dt);
        enemy.knockZ = damp(enemy.knockZ, 0, 8, dt);
      }

      // Solid props constrain enemies as well as the player. The broad phase
      // is shared with camera and player collision to keep this inexpensive.
      for (const collider of nearby) {
        if (collider.active === false) continue;
        const ox = enemy.position.x - collider.x, oz = enemy.position.z - collider.z;
        const distance = Math.hypot(ox, oz);
        const minimum = enemy.radius + collider.r;
        if (distance >= minimum) continue;
        const ux = distance > 1e-5 ? ox / distance : enemy.avoidSide;
        const uz = distance > 1e-5 ? oz / distance : 0;
        enemy.position.x += ux * (minimum - distance);
        enemy.position.z += uz * (minimum - distance);
      }

      // Soft-body locomotion: spring-damped body/leg blend so movement
      // eases in/out like weight, never snapping. Hover types get floaty
      // bank + tatter lag; ground types get a diagonal quadruped gait.
      const move = enemy.moveBlend ?? 0;
      enemy._soft = enemy._soft ?? { tatter: 0, tatterV: 0, bodyY: 0, zRot: 0, xRot: 0 };
      const soft = enemy._soft;
      if (spec.hover > 0) {
        const loco = enemyLocomotion(move, enemy.phase, 1);
        soft.bodyY = springDamp(soft.bodyY, Math.sin(enemy.phase * 1.2) * 0.16 + loco.bob * 0.4 + move * 0.04, 5, dt);
        enemy.body.position.y = soft.bodyY;
        enemy.body.rotation.z = springDamp(enemy.body.rotation.z, Math.sin(elapsed * 0.9 + enemy.phase) * 0.06 + move * 0.06, 4.5, dt);
        enemy.body.rotation.x = springDamp(enemy.body.rotation.x, move * 0.18 + loco.lean * 0.3, 4, dt);
        // Hover banking + tatter flutter / arm sway sell flight weight.
        enemy.body.rotation.y = Math.sin(elapsed * 0.7 + enemy.phase) * 0.08;
        for (const t of enemy.body.userData?.tatters ?? []) {
          const lag = secondaryLag(t.pivot.rotation.x, Math.sin(elapsed * (2.2 + move * 1.5) + t.phase) * (0.2 + move * 0.5), (t._v ?? 0), dt, 14, 5);
          t._v = lag.vel; t.pivot.rotation.x = lag.pos;
        }
      } else {
        const stride = enemy.phase * 1.4;
        enemy.body.position.y = Math.abs(Math.sin(stride)) * (0.03 + move * 0.07);
        enemy.body.rotation.z = Math.sin(stride) * move * 0.08;
        enemy.body.rotation.x = springDamp(enemy.body.rotation.x, move * 0.14, 4.5, dt);
        // Quadruped gait: diagonal pairs (FL+HR, FR+HL) swing together.
        // Phase offset 0 = left-front/right-hind, 0.5 = the other diagonal.
        for (const leg of enemy.legs ?? []) {
          const swing = Math.sin(stride + Math.PI * 2 * leg.phase) * move * 0.8;
          const lift = Math.max(0, Math.sin(stride + Math.PI * 2 * leg.phase + 1.57)) * move * 0.35;
          leg.pivot.rotation.x = springDamp(leg.pivot.rotation.x, -swing, 6.5, dt);
          leg.pivot.position.y = springDamp(leg.pivot.position.y, leg.restY + lift, 6.5, dt);
        }
      }

      if (enemy.windup > 0) {
        const p = 1 - enemy.windup / Math.max(enemy.windupTotal, 1e-4);
        const coil = Math.sin(clamp(p, 0, 1) * Math.PI * 0.5);
        enemy.body.rotation.x = damp(enemy.body.rotation.x, -coil * 0.34, 12, dt);
        enemy.body.position.y -= coil * 0.06;
      }

      enemy.visual?.update(dt, enemy);

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
          enemy.cancelTelegraph?.();
          enemy.cancelTelegraph = null;
          enemy.attackCooldown = spec.cooldown;
          enemy.attackCount += 1;
          enemy.body.rotation.x = 0.52; // strike snap
          this.effects.flash(new THREE.Vector3(enemy.position.x, enemy.position.y + enemy.hitHeight, enemy.position.z), { color: spec.glow, size: 2.2, life: 0.18, growth: 2.2, opacity: 0.55 });
          if (spec.ranged) {
            this._fireProjectile(enemy);
            this.effects.burst(
              new THREE.Vector3(enemy.position.x, enemy.position.y + enemy.hitHeight, enemy.position.z),
              { count: 12, color: spec.glow, speed: 3, size: 0.28, life: 0.4, gravity: 0 },
            );
          } else if (enemy.windupKind === 'nova') {
            this.effects.ring(enemy.position.clone().setY(ground), { color: spec.glow, radius: 9, life: 0.55 });
            this._hitPlayer(enemy, 18, 'nova', 9);
          } else {
            enemy.lunge = 0.18;
            this._hitPlayer(enemy, spec.damage, 'melee');
          }
        }
      } else if (enemy.aggro && dist <= spec.attackRange && enemy.attackCooldown <= 0 && (!spec.ranged || enemy._clearShot !== false)) {
        enemy.windup = spec.windup;
        enemy.windupTotal = spec.windup;
        enemy.windupKind = spec.ranged ? 'ranged' : enemy.isWarden && (enemy.attackCount + 1) % 3 === 0 ? 'nova' : 'melee';
        enemy.attackYaw = enemy.yaw;
        enemy.velX = 0;
        enemy.velZ = 0;
        if (spec.ranged) {
          this.effects.ring(enemy.position.clone().setY(ground), { color: spec.glow, radius: enemy.radius + 1.4, life: spec.windup, opacity: 0.55 });
        } else {
          enemy.cancelTelegraph = this.effects.telegraph?.(enemy.position.clone().setY(ground), {
            color: enemy.windupKind === 'nova' ? '#c6a8ff' : '#f19377',
            radius: enemy.windupKind === 'nova' ? 9 : spec.attackRange + 1.4,
            life: spec.windup,
            yaw: enemy.attackYaw,
            circle: enemy.windupKind === 'nova',
          }) ?? null;
        }
      }

      if (dt > 0 && enemy.velocity) {
        enemy.velocity.set(
          (enemy.position.x - beforeX) / dt,
          (enemy.position.y - beforeY) / dt,
          (enemy.position.z - beforeZ) / dt,
        );
      }
    }

    // Swept collision prevents fast orbs tunnelling through players or props.
    for (const slot of this.projectiles) {
      if (!slot.active) continue;
      if (playerInCamp) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      slot.life -= dt;
      const start = slot.mesh.position.clone();
      const end = start.clone().addScaledVector(slot.velocity, dt);
      const target = this.player.position;
      const playerHit = segmentSphereEntry(start, end, { x: target.x, y: target.y + 1, z: target.z }, 0.9);
      let obstruction = this._firstPropHit(start, end);
      const steps = Math.max(1, Math.ceil(start.distanceTo(end)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = start.x + (end.x - start.x) * t;
        const y = start.y + (end.y - start.y) * t;
        const z = start.z + (end.z - start.z) * t;
        if (y <= this.world.heightAt(x, z) + 0.12) {
          obstruction = obstruction === null ? t : Math.min(obstruction, t);
          break;
        }
      }
      const hitPlayer = playerHit !== null && (obstruction === null || playerHit < obstruction);
      const hitTime = hitPlayer ? playerHit : obstruction;
      if (hitTime !== null) {
        slot.mesh.position.lerpVectors(start, end, hitTime);
        if (hitPlayer) {
          this.damagePlayer(slot.damage, { origin: slot.mesh.position, kind: 'projectile', shake: 0.22, color: '#c6a8ff' });
        }
        this.effects.burst(slot.mesh.position, { count: hitPlayer ? 14 : 8, color: '#c6a8ff', speed: 3.4, size: 0.28, life: 0.4, gravity: 1.6 });
        slot.active = false;
        slot.mesh.visible = false;
      } else {
        slot.mesh.position.copy(end);
        slot.mesh.rotation.y += dt * 8;
        if (slot.life <= 0) {
          slot.active = false;
          slot.mesh.visible = false;
        }
      }
    }
  }

  /** Remove a single enemy (summons, cleanup). */
  despawn(enemy) {
    if (!enemy) return;
    const index = this.list.indexOf(enemy);
    if (index >= 0) this.list.splice(index, 1);
    enemy.cancelTelegraph?.();
    this._releaseEnemyVisuals(enemy);
    enemy.group?.parent?.remove(enemy.group);
    if (enemy.isWarden && this._activeWarden === enemy) this._activeWarden = null;
  }

  /** Remove every enemy and start fresh (new game). */
  reset() {
    for (const enemy of this.list) { enemy.cancelTelegraph?.(); this._releaseEnemyVisuals(enemy); this.group.remove(enemy.group); }
    this.list.length = 0;
    for (const slot of this.projectiles) {
      slot.active = false;
      slot.mesh.visible = false;
    }
    this._activeWarden = null;
  }

  /** Release only resources owned by a procedural enemy, not shared textures or the boss. */
  _releaseEnemyVisuals(enemy) {
    if (!enemy || enemy.isBoss || enemy._visualsDisposed) return;
    enemy._visualsDisposed = true;
    enemy.visual?.dispose(); // Warden geometry and textures are shared by its asset cache.
    enemy.visual = null;
    const geometries = new Set();
    const materials = new Set();
    enemy.body?.traverse((object) => {
      // Sprite geometry is shared by Three.js across all sprites.
      if (object.isMesh && object.geometry) geometries.add(object.geometry);
      if (object.material) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    enemy.body?.clear();
    enemy.legs = [];
    enemy.materials = [];
  }
}
