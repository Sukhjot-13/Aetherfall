/**
 * Player controller: terrain-following capsule movement with asymmetric
 * acceleration, sprint ramp, slope response, variable-height jumps, coyote
 * time, Sky Leap, a stamina dodge with i-frames, swimming and procedural
 * character animation.
 */

import * as THREE from 'three';
import { clamp, damp, dampAngle, wrapAngle } from '../util/math.js';
import { forwardFromYaw, rightFromYaw } from './cameraLogic.js';
import {
  MOVE,
  airControl,
  approachVelocity,
  canDodge,
  dodgeDirection,
  dodgeSpeedAt,
  flightDirection,
  gravityFor,
  jumpCut,
  landingForce,
  rollProgress,
  shouldRoll,
  slopeSlide,
  slopeSpeedFactor,
  sprintBlend,
  strideLength,
  targetSpeed,
} from './movement.js';
import { consumeStamina, formJumpMultiplier, formSpeedMultiplier, hasSkyLeap, isFormActive } from '../gameplay/powerState.js';
import { PlayerModel } from './PlayerModel.js';
import { LOCATIONS } from '../world/locations.js';

const RADIUS = 0.42;

export class Player {
  /**
   * @param {{scene:THREE.Scene, world:any, powers:any, effects:any, audio:any, camera:THREE.Camera, cameraRig?:any}} deps
   */
  constructor({ scene, world, powers, effects, audio, camera, cameraRig = null }) {
    this.scene = scene;
    this.world = world;
    this.powers = powers;
    this.effects = effects;
    this.audio = audio;
    this.camera = camera;
    this.cameraRig = cameraRig;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpsUsed = 0;
    this.jumpCutUsed = false;
    this.dashTime = 0;
    this.dashDir = new THREE.Vector2(0, -1);
    this.sprinting = false;
    this.moving = false;
    this.speed = 0;
    this.inWater = false;
    this.footstepAccum = 0;
    /** Smoothed yaw rate (rad/s) used for banking and cloth swing. */
    this.turnRate = 0;
    /** Seconds since the last grounded frame. */
    this.airTime = 0;
    /** Visual-only Y, smoothed over small terrain steps. */
    this.visualY = 0;
    /** Sprint hold / blended sprint amount. */
    this.sprintHold = 0;
    this.sprintBlend = 0;
    this.sprintExhausted = false;
    /** Dodge state. */
    this.dodgeTime = 0;
    this.dodgeElapsed = 0;
    this.dodgeCooldown = 0;
    this.invulnTime = 0;
    this.dodgeDir = new THREE.Vector2(0, 1);
    /** Heavy landing recovery (0 when inactive). */
    this.rollTime = 0;
    this.rollElapsed = 0;
    this.rollDuration = MOVE.landRollDuration;
    /** Debug flight (master mode). */
    this.fly = false;
    this.flySpeed = 26;
    this.respawnPoint = new THREE.Vector3();
    this.radius = RADIUS;
    this.height = 1.85;

    this.model = new PlayerModel();
    scene.add(this.model.root);
    if (camera) camera.add(this.model.viewModel);

    this.spawnAt(LOCATIONS.spawn.x, LOCATIONS.spawn.z);
  }

  /** Place the player on the ground at a world XZ. */
  spawnAt(x, z) {
    const y = this.world.heightAt(x, z);
    this.position.set(x, Math.max(y, 0.1) + 0.05, z);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.jumpsUsed = 0;
    this.visualY = this.position.y;
    this._resetTransient();
    this.model.root.position.copy(this.position);
  }

  /**
   * Hard-place the player (save load / cutscene). Unlike `spawnAt` this keeps
   * the supplied Y so a restored save never snaps through the ground.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [yaw]
   */
  teleport(x, y, z, yaw = this.yaw) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.grounded = false;
    this.jumpsUsed = 0;
    this.visualY = y;
    this._resetTransient();
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = yaw;
  }

  /** Clear one-shot movement timers (teleport / respawn / dodge reset). */
  _resetTransient() {
    this.dashTime = 0;
    this.dodgeTime = 0;
    this.dodgeElapsed = 0;
    this.dodgeCooldown = 0;
    this.invulnTime = 0;
    this.rollTime = 0;
    this.rollElapsed = 0;
    this.sprintHold = 0;
    this.sprintBlend = 0;
    this.sprintExhausted = false;
    this.speed = 0;
    this.jumpCutUsed = false;
  }

  /** Respawn at Emberfall Camp. */
  respawn() {
    const loc = LOCATIONS.camp;
    this.spawnAt(loc.x + 3, loc.z + 6);
    this.yaw = Math.PI;
    this.model.root.rotation.y = this.yaw;
    this.velocity.set(0, 0, 0);
  }

  /** Apply a one-off impulse (used by explosions/knockback). */
  applyImpulse(x, y, z) {
    this.velocity.x += x;
    this.velocity.y += y;
    this.velocity.z += z;
  }

  /** Begin a spell dash in a horizontal direction. */
  startDash(dirX, dirZ, speed = 30, duration = 0.28) {
    const len = Math.hypot(dirX, dirZ) || 1;
    this.dashDir.set(dirX / len, dirZ / len);
    this.dashSpeed = speed;
    this.dashTime = duration;
    this.velocity.y = Math.max(0, this.velocity.y);
  }

  /**
   * Begin a dodge roll. Grants brief invulnerability and consumes stamina.
   * @param {number} dirX
   * @param {number} dirZ
   * @returns {boolean} whether the dodge started
   */
  startDodge(dirX, dirZ) {
    if (!canDodge({
      stamina: this.powers.stamina,
      cooldown: this.dodgeCooldown,
      grounded: this.grounded,
      dashing: this.dashTime > 0,
      inWater: this.inWater,
    })) return false;

    const len = Math.hypot(dirX, dirZ) || 1;
    this.dodgeDir.set(dirX / len, dirZ / len);
    this.dodgeTime = MOVE.dodgeDuration;
    this.dodgeElapsed = 0;
    this.dodgeCooldown = MOVE.dodgeCooldown;
    this.invulnTime = MOVE.dodgeIFrames;
    this.velocity.y = Math.max(this.velocity.y, 0);
    consumeStamina(this.powers, MOVE.dodgeStamina);
    this.audio?.dodge?.();
    this.model?.dodge?.();

    const feet = this.position.clone().setY(this.position.y + 0.1);
    this.effects?.ring(feet, { color: '#c8f7ff', radius: 2.3, life: 0.34, opacity: 0.55 });
    this.effects?.burst(feet, {
      count: 14,
      color: '#bfefff',
      speed: 3.4,
      size: 0.24,
      life: 0.42,
      gravity: 0.4,
      drag: 3,
    });
    this.cameraRig?.addShake?.(0.08);
    return true;
  }

  /** Is the player dashing (spell dash or dodge)? */
  get dashing() {
    return this.dashTime > 0 || this.dodgeTime > 0;
  }

  /** True while dodge i-frames are active. */
  get invulnerable() {
    return this.invulnTime > 0;
  }

  /**
   * @param {number} dt
   * @param {{forward:boolean,back:boolean,left:boolean,right:boolean,sprint:boolean,jumpPressed:boolean,jumpHeld?:boolean,dodgePressed?:boolean}} actions
   * @param {number} cameraYaw
   * @param {number} [cameraPitch]
   */
  update(dt, actions, cameraYaw, cameraPitch = 0) {
    const powers = this.powers;
    if (powers.dead) {
      this.velocity.set(0, 0, 0);
      this.model.root.position.copy(this.position);
      this.model.update(dt, { speed: 0, grounded: true, vy: 0, dashing: false, form: false, sprinting: false, turn: 0 });
      return;
    }

    if (this.fly) {
      this._updateFly(dt, actions, cameraYaw, cameraPitch);
      return;
    }

    const wasGrounded = this.grounded;
    const jumpHeld = actions.jumpHeld ?? actions.jumpPressed;
    const forward = forwardFromYaw(cameraYaw);
    const right = rightFromYaw(cameraYaw);
    let ix = (actions.right ? 1 : 0) - (actions.left ? 1 : 0);
    let iz = (actions.forward ? 1 : 0) - (actions.back ? 1 : 0);
    const inputLen = Math.hypot(ix, iz);
    let dirX = 0;
    let dirZ = 0;
    if (inputLen > 0) {
      ix /= inputLen;
      iz /= inputLen;
      dirX = forward.x * iz + right.x * ix;
      dirZ = forward.z * iz + right.z * ix;
    }
    this.moving = inputLen > 0;

    const ground = this.world.heightAt(this.position.x, this.position.z);
    this.inWater = ground < -0.35 && this.position.y < 0.55;
    const form = isFormActive(powers);

    // Sprint ramp: a tap is a short burst, a hold settles into full speed.
    if (this.sprintExhausted && powers.stamina >= powers.maxStamina * 0.25) this.sprintExhausted = false;
    if (actions.sprint && this.moving && powers.stamina <= 1) this.sprintExhausted = true;
    const canSprint = actions.sprint && this.moving && this.grounded && !this.inWater && !this.sprintExhausted;
    if (canSprint && powers.stamina > 1) {
      this.sprintHold += dt;
    } else {
      this.sprintHold = 0;
    }
    const wantedSprint = sprintBlend(this.sprintHold, this.moving, powers.stamina, this.grounded, this.inWater);
    this.sprintBlend = damp(this.sprintBlend, wantedSprint, wantedSprint > this.sprintBlend ? 7 : 4.5, dt);
    this.sprinting = canSprint && this.sprintBlend > 0.34;
    if (this.sprinting) {
      const paid = consumeStamina(powers, MOVE.sprintStaminaDrain * this.sprintBlend * dt);
      if (!paid) {
        this.sprintBlend = 0;
        this.sprinting = false;
        this.sprintExhausted = true;
      }
    }

    // Surface response.
    const normal = this.world.heightfield?.normal?.(this.position.x, this.position.z, 0.9)
      ?? { x: 0, y: 1, z: 0 };
    const slope = this.world.slopeAt?.(this.position.x, this.position.z) ?? 0;
    const slopeFactor = this.moving ? slopeSpeedFactor(normal, dirX, dirZ) : 1;
    const speedTarget = targetSpeed({
      moving: this.moving,
      sprint: this.sprintBlend,
      grounded: this.grounded,
      inWater: this.inWater,
      formMultiplier: formSpeedMultiplier(powers),
    }) * slopeFactor;

    // Dodge start (Ctrl / right mouse). No input = defensive backstep.
    if (actions.dodgePressed && this.dodgeTime <= 0 && this.dashTime <= 0) {
      const dodge = dodgeDirection(ix, iz, cameraYaw, this.yaw);
      this.startDodge(dodge.x, dodge.z);
    }

    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.invulnTime = Math.max(0, this.invulnTime - dt);

    const accel = this.grounded ? MOVE.groundAccel : MOVE.airAccel * airControl(this.airTime);
    const decel = this.grounded ? MOVE.groundDecel : MOVE.airDecel;

    if (this.dodgeTime > 0) {
      this.dodgeTime = Math.max(0, this.dodgeTime - dt);
      this.dodgeElapsed += dt;
      const speed = dodgeSpeedAt(this.dodgeElapsed, MOVE.dodgeDuration);
      this.velocity.x = this.dodgeDir.x * speed;
      this.velocity.z = this.dodgeDir.y * speed;
    } else if (this.dashTime > 0) {
      this.dashTime = Math.max(0, this.dashTime - dt);
      this.velocity.x = this.dashDir.x * (this.dashSpeed ?? 30);
      this.velocity.z = this.dashDir.y * (this.dashSpeed ?? 30);
      this.velocity.y = 0;
    } else {
      // Bound the change of the velocity vector once. Applying another
      // dt-based smoothing step here made acceleration depend on frame rate.
      const velocity = approachVelocity(this.velocity.x, this.velocity.z, dirX * speedTarget, dirZ * speedTarget, accel, decel, dt);
      this.velocity.x = velocity.x;
      this.velocity.z = velocity.z;
      if (this.grounded && slope > 0.56) {
        const slide = slopeSlide(normal, slope);
        this.velocity.x += slide.x * dt;
        this.velocity.z += slide.z * dt;
      }
    }

    // Jump buffering and coyote time.
    // In shallow water, Space holds the player up instead of jumping, so
    // paddling back to shore always works without needing Sky Leap.
    // Paddling is resolved after the normal jump logic so it never blocks it.
    if (actions.jumpPressed) this.jumpBuffer = MOVE.jumpBuffer;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.grounded) this.coyote = MOVE.coyote;
    else this.coyote = Math.max(0, this.coyote - dt);

    if (this.jumpBuffer > 0 && this.dashTime <= 0) {
      if (this.coyote > 0) {
        this.velocity.y = MOVE.jumpSpeed * formJumpMultiplier(powers);
        this.grounded = false;
        this.coyote = 0;
        this.jumpsUsed = 1;
        this.jumpCutUsed = false;
        this.jumpBuffer = 0;
        this.audio?.jump();
        this.model.jump();
        this.effects?.burst(this.position.clone().setY(this.position.y + 0.1), {
          count: 7,
          color: '#cfc3a5',
          speed: 2.2,
          size: 0.35,
          life: 0.5,
          gravity: 2,
        });
      } else if (hasSkyLeap(powers) && this.jumpsUsed < 2) {
        this.velocity.y = MOVE.doubleJumpSpeed * formJumpMultiplier(powers);
        this.jumpsUsed += 1;
        this.jumpCutUsed = false;
        this.jumpBuffer = 0;
        if (this.audio?.doubleJump) this.audio.doubleJump();
        else this.audio?.jump();
        this.model.jump();
        this.effects?.ring(this.position.clone().setY(this.position.y + 0.2), {
          color: '#8ef2e0',
          radius: 2.2,
          life: 0.5,
        });
        this.effects?.burst(this.position.clone().setY(this.position.y + 0.3), {
          count: 12,
          color: '#8ef2e0',
          speed: 3.2,
          size: 0.28,
          life: 0.6,
          gravity: -0.5,
        });
      }
    }

    // Paddle-up once the ground systems have had their say. Only cap upward
    // velocity; the actual lift is applied by the buoyancy below, which keeps
    // a normal jump's peak intact while gently taming a paddle-up.
    const inShallowsPaddle = this.position.y < 0.35 && this.world.heightAt(this.position.x, this.position.z) < 0.35;
    if (inShallowsPaddle || this.inWater) {
      if (this.velocity.y > 1.6) this.velocity.y = 1.6;
    }

    // Variable jump height: releasing early trims the ascent once.
    if (!jumpHeld && this.velocity.y > 0 && !this.jumpCutUsed) {
      const cut = jumpCut(this.velocity.y, false, this.jumpCutUsed);
      this.velocity.y = cut.vy;
      this.jumpCutUsed = cut.cut;
    }

    // Gravity / buoyancy.
    if (this.inWater) {
      this.velocity.y = damp(this.velocity.y, 0, 4, dt);
      this.position.y = damp(this.position.y, 0.12, 6, dt);
    } else {
      this.velocity.y -= gravityFor(this.velocity.y) * dt;
      if (this.velocity.y < -MOVE.maxFallSpeed) this.velocity.y = -MOVE.maxFallSpeed;
    }

    const previousX = this.position.x;
    const previousZ = this.position.z;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Terrain collision.
    const newGround = this.world.heightAt(this.position.x, this.position.z);
    let impactSpeed = 0;
    if (this.position.y <= newGround + 0.02) {
      if (this.velocity.y <= 0) {
        impactSpeed = -this.velocity.y;
        this.velocity.y = 0;
      }
      this.position.y = newGround;
      this.grounded = true;
      this.jumpsUsed = 0;
      this.coyote = MOVE.coyote;
    } else {
      this.grounded = false;
    }

    // Walking off a ledge consumes the ground jump; Sky Leap still grants one
    // mid-air jump, but not two.
    if (wasGrounded && !this.grounded && this.jumpsUsed === 0) this.jumpsUsed = 1;

    // Water surface: never fall through the seabed.
    if (newGround < 0 && this.position.y < 0.08) {
      this.position.y = 0.08;
      this.velocity.y = Math.max(0, this.velocity.y);
    }

    this._resolveColliders();
    this._clampToWorld();

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!wasGrounded && this.grounded && impactSpeed > 3.2) {
      this._land(impactSpeed, horizontalSpeed);
      if (shouldRoll(impactSpeed, horizontalSpeed)) {
        this.rollTime = MOVE.landRollDuration;
        this.rollElapsed = 0;
        this.rollDuration = MOVE.landRollDuration;
      }
    }
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    if (this.rollTime > 0) {
      this.rollTime = Math.max(0, this.rollTime - dt);
      this.rollElapsed += dt;
    }

    // Drive gait, footsteps and camera from actual travel when a prop blocks
    // movement, while limiting collision correction from creating false speed.
    const travelSpeed = dt > 0 ? Math.hypot(this.position.x - previousX, this.position.z - previousZ) / dt : 0;
    this.speed = Math.min(horizontalSpeed, travelSpeed);

    // Facing, with a smoothed turn rate for banking and cloth swing.
    const prevYaw = this.yaw;
    let faceTarget = this.yaw;
    if (this.dodgeTime > 0) faceTarget = Math.atan2(-this.dodgeDir.x, -this.dodgeDir.y);
    else if (this.dashTime > 0) faceTarget = Math.atan2(-this.dashDir.x, -this.dashDir.y);
    else if (this.moving) faceTarget = Math.atan2(-dirX, -dirZ);
    // Soft turn: body rotates with momentum instead of snapping to the
    // input vector; slower when idle so it settles like weight.
    this.yaw = dampAngle(this.yaw, faceTarget, this.moving || this.dashing ? 8.5 : 4.5, dt);
    const yawRate = wrapAngle(this.yaw - prevYaw) / Math.max(dt, 1e-4);
    this.turnRate = damp(this.turnRate, yawRate, 12, dt);

    // Animate. Visual Y lags slightly over small terrain steps but follows
    // exactly while airborne so jumps never look detached. Uphill snaps
    // tighter so a climb can never sink the feet below the ground.
    if (this.grounded) this.visualY = damp(this.visualY, this.position.y, this.position.y > this.visualY ? 80 : 32, dt);
    else this.visualY = this.position.y;
    this.model.root.position.set(this.position.x, this.visualY, this.position.z);
    this.model.faceYaw(this.yaw, dt);
    this.model.update(dt, {
      speed: this.speed,
      grounded: this.grounded,
      vy: this.velocity.y,
      dashing: this.dashing,
      dodging: this.dodgeTime > 0,
      dodgeProgress: this.dodgeTime > 0 ? clamp(this.dodgeElapsed / MOVE.dodgeDuration, 0, 1) : 0,
      roll: this.rollTime > 0 ? rollProgress(this.rollElapsed, this.rollDuration) : 0,
      form,
      sprinting: this.sprinting,
      sprintBlend: this.sprintBlend,
      slope,
      airTime: this.airTime,
      turn: this.turnRate,
    });

    // Footsteps: cadence follows the stride length so sprinting feels faster.
    // Shallow water counts as a splash, so wading sounds different from walking.
    const inShallows = this.position.y < 0.35 && this.world.heightAt(this.position.x, this.position.z) < 0.35;
    // Wet sand and splashing water also pick up the water footstep.
    const shore = this.position.y < 0.5 && this.world.heightAt(this.position.x, this.position.z) < 0.6;
    if (this.grounded && this.speed > 1.2 && !this.inWater) {
      this.footstepAccum += this.speed * dt;
      if (this.footstepAccum > strideLength(this.speed)) {
        this.footstepAccum = 0;
        const biome = inShallows || shore ? 'water' : this.world.biomeAt(this.position.x, this.position.z);
        this.audio?.footstep(biome);
        if (this.sprinting) {
          this.effects?.burst(this.position.clone().setY(this.position.y + 0.08), {
            count: 3,
            color: biome === 'sand' ? '#d9c79b' : '#b8c9a0',
            speed: 1.2,
            size: 0.22,
            life: 0.4,
            gravity: 1.4,
          });
        }
      }
    } else {
      this.footstepAccum = 0;
    }
  }

  /**
   * Landing feedback: squash the rig, thump, kick up dust and dip the camera.
   * @param {number} impact downward speed in m/s at touchdown
   * @param {number} [horizontalSpeed] speed carried into the landing
   */
  _land(impact, horizontalSpeed = this.speed) {
    const force = landingForce(impact);
    if (force <= 0.02) return;
    const heavy = shouldRoll(impact, horizontalSpeed);
    this.model.land(force, heavy);
    this.audio?.land(force);
    this.cameraRig?.land?.(force);
    const biome = this.world.biomeAt(this.position.x, this.position.z);
    const color = this.inWater
      ? '#cfe9f2'
      : biome === 'sand'
        ? '#d9c79b'
        : biome === 'rock'
          ? '#b9b2a2'
          : biome === 'snow'
            ? '#eef4f8'
            : '#b8c9a0';
    const at = this.position.clone().setY(this.position.y + 0.06);
    this.effects?.burst(at, {
      count: Math.round(4 + force * 12),
      color,
      speed: 1.4 + force * 3.2,
      size: 0.28 + force * 0.35,
      life: 0.45 + force * 0.2,
      gravity: 1.6,
    });
    if (force > 0.45) {
      this.effects?.ring(at, { color, radius: 1.4 + force * 2.2, life: 0.45, opacity: 0.6 });
    }
    if (heavy) {
      this.cameraRig?.addShake?.(0.12 + force * 0.16);
      this.effects?.ring(at, { color: '#e8f7ff', radius: 2.6 + force * 1.8, life: 0.32, opacity: 0.4 });
    }
  }

  /**
   * Free-flight movement used by master mode to inspect the island. Forward is
   * the full camera look direction (yaw + pitch), so looking up climbs and
   * looking down dives. Space/C remain optional vertical thrusters.
   * @param {number} dt
   * @param {{forward:boolean,back:boolean,left:boolean,right:boolean,sprint:boolean,up:boolean,down:boolean}} actions
   * @param {number} cameraYaw
   * @param {number} cameraPitch
   */
  _updateFly(dt, actions, cameraYaw, cameraPitch = 0) {
    const ix = (actions.right ? 1 : 0) - (actions.left ? 1 : 0);
    const iz = (actions.forward ? 1 : 0) - (actions.back ? 1 : 0);
    const inputLen = Math.hypot(ix, iz);
    const direction = flightDirection(ix, iz, cameraYaw, cameraPitch);
    const dirX = direction.x;
    const dirY = direction.y;
    const dirZ = direction.z;
    this.moving = inputLen > 0;
    this.sprinting = Boolean(actions.sprint);
    this.grounded = false;
    this.inWater = false;
    this.jumpsUsed = 0;
    this.dodgeTime = 0;
    this.dodgeCooldown = 0;
    this.invulnTime = 0;
    this.rollTime = 0;
    this.sprintBlend = this.sprinting ? 1 : 0;

    const speed = this.sprinting ? this.flySpeed * 2.6 : this.flySpeed;
    const lift = (actions.up ? 1 : 0) - (actions.down ? 1 : 0);
    this.velocity.x = damp(this.velocity.x, dirX * speed, 7, dt);
    this.velocity.y = damp(this.velocity.y, dirY * speed + lift * speed * 0.72, 7, dt);
    this.velocity.z = damp(this.velocity.z, dirZ * speed, 7, dt);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    const ground = this.world.heightAt(this.position.x, this.position.z);
    const floor = Math.max(ground, 0.25) + 0.55;
    if (this.position.y < floor) {
      this.position.y = floor;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
    if (this.position.y > 430) {
      this.position.y = 430;
      this.velocity.y = Math.min(0, this.velocity.y);
    }
    this._clampToWorld();

    this.speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
    this.visualY = this.position.y;
    const prevYaw = this.yaw;
    const horizontal = Math.hypot(dirX, dirZ);
    const flightPitch = Math.atan2(this.velocity.y, Math.max(2, Math.hypot(this.velocity.x, this.velocity.z)));
    const flightRoll = -ix * 0.38;
    const faceTarget = this.moving
      ? horizontal > 0.05
        ? Math.atan2(-dirX, -dirZ)
        : cameraYaw
      : this.yaw;
    this.yaw = dampAngle(this.yaw, faceTarget, this.moving ? 8 : 3, dt);
    const yawRate = wrapAngle(this.yaw - prevYaw) / Math.max(dt, 1e-4);
    this.turnRate = damp(this.turnRate, yawRate, 12, dt);
    this.airTime = 0;

    this.model.root.position.copy(this.position);
    this.model.faceYaw(this.yaw, dt);
    this.model.update(dt, {
      speed: this.speed,
      grounded: false,
      flying: true,
      vy: this.velocity.y,
      dashing: false,
      form: isFormActive(this.powers),
      sprinting: this.sprinting,
      airTime: this.airTime,
      turn: this.turnRate,
      flightPitch,
      flightRoll,
    });
    this.footstepAccum = 0;
  }

  /** Push out of tree trunks, rocks and pillars. */
  _resolveColliders() {
    const colliders = this.world.queryColliders?.(this.position.x, this.position.z, this.radius + 6) ?? this.world.colliders ?? [];
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.active === false) continue;
      const dx = this.position.x - c.x;
      const dz = this.position.z - c.z;
      const min = c.r + this.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq < 1e-8) {
        const speed = Math.hypot(this.velocity.x, this.velocity.z);
        const x = speed > 1e-5 ? -this.velocity.x / speed : Math.cos(this.yaw);
        const z = speed > 1e-5 ? -this.velocity.z / speed : Math.sin(this.yaw);
        this.position.x += x * min;
        this.position.z += z * min;
      } else if (distSq < min * min) {
        const dist = Math.sqrt(distSq);
        const push = (min - dist) / dist;
        this.position.x += dx * push;
        this.position.z += dz * push;
      }
    }
  }

  /** Soft invisible wall at the edge of the playable island. */
  _clampToWorld() {
    const dist = Math.hypot(this.position.x, this.position.z);
    if (dist > MOVE.worldEdge) {
      const scale = MOVE.worldEdge / dist;
      this.position.x *= scale;
      this.position.z *= scale;
      this.velocity.x *= 0.4;
      this.velocity.z *= 0.4;
    }
  }

  /** Eye-level world position for first person / aiming. */
  eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.68, this.position.z);
  }

  /** Current horizontal facing as a unit vector. */
  facing() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }
}
