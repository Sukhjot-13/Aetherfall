import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { createPowerState, tickPowers } from '../src/gameplay/powerState.js';

function makePlayer(colliders = []) {
  const player = Object.create(Player.prototype);
  Object.assign(player, {
    position: new THREE.Vector3(0, 10, 0), velocity: new THREE.Vector3(), yaw: 0,
    grounded: true, coyote: 0, jumpBuffer: 0, jumpsUsed: 0, jumpCutUsed: false,
    dashTime: 0, dashDir: new THREE.Vector2(), sprinting: false, moving: false,
    speed: 0, inWater: false, footstepAccum: 0, turnRate: 0, airTime: 0, visualY: 10,
    sprintHold: 0, sprintBlend: 0, dodgeTime: 0, dodgeElapsed: 0, dodgeCooldown: 0,
    invulnTime: 0, dodgeDir: new THREE.Vector2(0, 1), rollTime: 0, rollElapsed: 0,
    rollDuration: 0.55, fly: false, radius: 0.42, powers: createPowerState(),
    world: { heightAt: () => 10, slopeAt: () => 0, biomeAt: () => 'grass',
      heightfield: { normal: () => ({ x: 0, y: 1, z: 0 }) }, colliders },
    model: { root: new THREE.Group(), faceYaw() {}, update() {}, jump() {}, land() {} },
    audio: { footstep() {}, jump() {} }, effects: null,
  });
  return player;
}
const forward = { forward: true, back: false, left: false, right: false, sprint: false, jumpPressed: false, jumpHeld: false, dodgePressed: false };

test('player acceleration and distance remain close across common frame rates', () => {
  const samples = [];
  for (const hz of [30, 60, 120]) {
    const player = makePlayer();
    for (let i = 0; i < hz; i++) player.update(1 / hz, forward, 0);
    samples.push({ speed: player.speed, distance: -player.position.z });
  }
  assert.ok(samples.every((sample) => Math.abs(sample.speed - 7.2) < 0.01));
  assert.ok(Math.max(...samples.map((sample) => sample.distance)) - Math.min(...samples.map((sample) => sample.distance)) < 0.12);
});

test('pushing against a solid obstacle stops the movement animation', () => {
  const player = makePlayer([{ x: 0, z: -2, r: 1 }]);
  for (let i = 0; i < 90; i++) player.update(1 / 60, forward, 0);
  assert.ok(player.position.z > -0.59);
  assert.ok(player.speed < 0.01);
});

test('a player exactly at a collider centre is pushed out', () => {
  const player = makePlayer([{ x: 0, z: 0, r: 1 }]);
  player._resolveColliders();
  assert.ok(Math.abs(Math.hypot(player.position.x, player.position.z) - 1.42) < 1e-6);
});

test('exhausted sprint waits for meaningful stamina recovery before restarting', () => {
  const player = makePlayer();
  const sprint = { ...forward, sprint: true };
  let exhausted = false, recovered = false;
  for (let i = 0; i < 900; i++) {
    player.update(1 / 60, sprint, 0);
    tickPowers(player.powers, 1 / 60);
    if (player.sprintExhausted) exhausted = true;
    if (exhausted && player.powers.stamina < 24) assert.equal(player.sprinting, false);
    if (exhausted && !player.sprintExhausted && player.powers.stamina >= 24) { recovered = true; break; }
  }
  assert.equal(exhausted, true);
  assert.equal(recovered, true);
});

test('double jump plays its own sound only once', () => {
  const player = makePlayer();
  let jump = 0, doubleJump = 0;
  player.audio = { jump() { jump++; }, doubleJump() { doubleJump++; }, footstep() {} };
  player.powers.unlocked.push('skyLeap');
  player.position.y = 13; player.grounded = false; player.jumpsUsed = 1; player.coyote = 0;
  player.update(1 / 60, { ...forward, jumpPressed: true, jumpHeld: true }, 0);
  assert.equal(doubleJump, 1);
  assert.equal(jump, 0);
});
