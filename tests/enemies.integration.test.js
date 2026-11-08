import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPowerState } from '../src/gameplay/powerState.js';

// Enemies create a small radial texture at module load; no renderer is needed.
globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
const { Enemies } = await import('../src/gameplay/Enemies.js');

function setup({ player = new THREE.Vector3(0, 0, -2), colliders = [], heightAt = () => 0 } = {}) {
  const warnings = [];
  const effects = {
    burst() {}, flash() {}, ring() {}, light() {}, damageNumber() {},
    telegraph(position, opts) {
      const entry = { position: position.clone(), ...opts, cancelled: false };
      warnings.push(entry);
      return () => { entry.cancelled = true; };
    },
  };
  const powers = createPowerState();
  const world = { heightAt, colliders, islandRadius: 500 };
  const enemies = new Enemies({ scene: new THREE.Scene(), world, player: { position: player, invulnerable: false }, powers, effects });
  return { enemies, powers, warnings, player };
}

function readyStalker(fixture) {
  const enemy = fixture.enemies.spawn('stalker', 0, 0);
  enemy.yaw = 0;
  enemy.aggro = true;
  enemy.attackCooldown = 0;
  return enemy;
}

test('distant idle enemies stay hidden and status effects expire while asleep', () => {
  const f = setup({ player: new THREE.Vector3(400, 0, 0) });
  const enemy = f.enemies.spawn('stalker', 0, 0);
  enemy.slows = [{ factor: 0.5, remaining: 0.6 }];
  enemy.attackCooldown = 2;
  for (let i = 0; i < 20; i++) {
    f.enemies.update(0.05, i * 0.05);
    assert.equal(enemy.group.visible, false);
  }
  f.player.set(20, 0, 0);
  f.enemies.update(0.05, 1.05);
  assert.equal(enemy.group.visible, true);
  assert.deepEqual(enemy.slows, []);
  assert.ok(enemy.attackCooldown < 1.1);
});

test('enemy resources are released once after death without disposing shared sprite resources', () => {
  const f = setup();
  const enemy = f.enemies.spawn('drifter', 0, 0);
  let mesh, sprite;
  enemy.body.traverse((object) => { if (!mesh && object.isMesh) mesh = object; if (!sprite && object.isSprite) sprite = object; });
  const resources = { geometry: 0, material: 0, spriteMaterial: 0, spriteGeometry: 0, texture: 0 };
  mesh.geometry.addEventListener('dispose', () => resources.geometry++);
  mesh.material.addEventListener('dispose', () => resources.material++);
  sprite.material.addEventListener('dispose', () => resources.spriteMaterial++);
  sprite.geometry.addEventListener('dispose', () => resources.spriteGeometry++);
  sprite.material.map.addEventListener('dispose', () => resources.texture++);
  enemy.alive = false; enemy.deadTimer = 0.01;
  f.enemies.update(0.05, 0.05);
  assert.deepEqual(resources, { geometry: 1, material: 1, spriteMaterial: 1, spriteGeometry: 0, texture: 0 });
  assert.equal(enemy.body.children.length, 0);
  f.enemies.reset();
  assert.equal(resources.geometry, 1);
  assert.equal(resources.material, 1);
});

test('reset releases live enemies but leaves the reusable boss proxy intact', () => {
  const f = setup();
  const enemy = f.enemies.spawn('stalker', 0, 0);
  let disposed = 0;
  enemy.body.traverse((object) => { if (object.isMesh) object.geometry.addEventListener('dispose', () => disposed++); });
  const bossBody = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  let bossDisposed = false;
  bossBody.geometry.addEventListener('dispose', () => { bossDisposed = true; });
  f.enemies.list.push({ isBoss: true, group: bossBody, body: bossBody });
  f.enemies.reset();
  assert.ok(disposed > 0);
  assert.equal(bossDisposed, false);
  assert.equal(f.enemies.list.length, 0);
});

test('melee locks its visible direction and misses a player who moves behind it', () => {
  const f = setup();
  const enemy = readyStalker(f);
  f.enemies.update(0.01, 0);
  assert.equal(enemy.windupKind, 'melee');
  assert.equal(f.warnings.length, 1);
  assert.equal(f.warnings[0].circle, false);
  assert.equal(f.warnings[0].radius, enemy.spec.attackRange + 1.4);
  f.player.z = 2;
  f.enemies.update(0.45, 0.45);
  assert.equal(f.powers.health, 100);
  assert.equal(f.warnings[0].cancelled, true);
});

test('melee hits in front and Warden nova warns for its full radius', () => {
  const f = setup();
  const enemy = readyStalker(f);
  f.enemies.update(0.01, 0);
  f.enemies.update(0.45, 0.45);
  assert.equal(f.powers.health, 87);
  enemy.lunge = 0;
  enemy.attackCount = 2;
  enemy.isWarden = true;
  enemy.spec = { ...enemy.spec, attackRange: 4.6, windup: 0.75 };
  enemy.attackCooldown = 0;
  f.enemies.update(0.01, 0.46);
  assert.equal(f.warnings.at(-1).circle, true);
  assert.equal(f.warnings.at(-1).radius, 9);
  f.player.z = -8;
  f.enemies.update(0.8, 1.26);
  assert.equal(f.powers.health, 69);
});

test('enemy orbs hit props or terrain before a player behind them', () => {
  for (const kind of ['prop', 'terrain']) {
    const f = setup({ player: new THREE.Vector3(5, 0, 0),
      colliders: kind === 'prop' ? [{ x: 0, z: 0, r: 1 }] : [],
      heightAt: kind === 'terrain' ? (x) => x >= 0 ? 3 : 0 : () => 0 });
    const orb = f.enemies.projectiles[0];
    orb.active = true; orb.mesh.visible = true; orb.position.set(-5, 1, 0);
    orb.velocity.set(20, 0, 0); orb.life = 3; orb.damage = 9;
    f.enemies.update(0.5, 0.5);
    assert.equal(orb.active, false, kind);
    assert.equal(f.powers.health, 100, kind);
  }
});

test('a pursuing ground enemy steers around solid props', () => {
  const f = setup({ player: new THREE.Vector3(0, 0, -12), colliders: [{ x: 0, z: -3, r: 1 }] });
  const enemy = readyStalker(f);
  enemy.attackCooldown = 10;
  let passed = false;
  for (let i = 0; i < 100; i++) {
    f.enemies.update(0.05, i * 0.05);
    const distance = Math.hypot(enemy.position.x, enemy.position.z + 3);
    assert.ok(distance >= enemy.radius + 1 - 1e-5);
    if (enemy.position.z < -3.5) passed = true;
  }
  assert.equal(passed, true);
});

test('a jump clears the Warden ground nova and knockback cancels the warning', () => {
  const f = setup();
  const enemy = readyStalker(f);
  enemy.isWarden = true;
  enemy.attackCount = 2;
  enemy.spec = { ...enemy.spec, attackRange: 4.6, windup: 0.75 };
  f.enemies.update(0.01, 0);
  f.player.y = 1.5;
  f.enemies.update(0.8, 0.8);
  assert.equal(f.powers.health, 100);
  f.player.y = 0;
  enemy.attackCooldown = 0;
  enemy.attackCount = 2;
  f.enemies.update(0.01, 0.81);
  const warning = f.warnings.at(-1);
  f.enemies.damage(enemy, 1, { knockback: 1, from: new THREE.Vector3(0, 0, -2) });
  assert.equal(enemy.windup, 0);
  assert.equal(warning.cancelled, true);
});

test('an unobstructed swept orb hits once and respects dodge invulnerability', () => {
  for (const invulnerable of [false, true]) {
    const f = setup({ player: new THREE.Vector3(5, 0, 0) });
    f.enemies.player.invulnerable = invulnerable;
    const orb = f.enemies.projectiles[0];
    orb.active = true; orb.position.set(-5, 1, 0); orb.velocity.set(20, 0, 0); orb.life = 3; orb.damage = 9;
    f.enemies.update(0.5, 0.5);
    assert.equal(orb.active, false);
    assert.equal(f.powers.health, invulnerable ? 100 : 91);
  }
});

test('camp is a safe place to recover after death', async () => {
  const { LOCATIONS } = await import('../src/world/locations.js');
  const f = setup({ player: new THREE.Vector3(LOCATIONS.camp.x + 3, 0, LOCATIONS.camp.z + 6) });
  const enemy = f.enemies.spawn('stalker', LOCATIONS.camp.x + 8, LOCATIONS.camp.z + 6);
  enemy.aggro = true; enemy.engaged = true; enemy.windup = 0.2;
  let cancelled = false; enemy.cancelTelegraph = () => { cancelled = true; };
  f.enemies.update(0.05, 0.05);
  assert.equal(enemy.aggro, false);
  assert.equal(enemy.windup, 0);
  assert.equal(cancelled, true);
  f.enemies.update(0.05, 0.1);
  assert.equal(enemy.aggro, false);
  assert.equal(f.powers.health, 100);
});

test('enemy projectiles dissipate when the player reaches the camp', async () => {
  const { LOCATIONS } = await import('../src/world/locations.js');
  const player = new THREE.Vector3(LOCATIONS.camp.x, 0, LOCATIONS.camp.z);
  const f = setup({ player });
  const orb = f.enemies.projectiles[0];
  orb.active = true; orb.mesh.visible = true; orb.position.set(player.x - 1, 1, player.z);
  orb.velocity.set(20, 0, 0); orb.life = 3; orb.damage = 9;
  f.enemies.update(0.1, 0.1);
  assert.equal(orb.active, false);
  assert.equal(f.powers.health, 100);
});
