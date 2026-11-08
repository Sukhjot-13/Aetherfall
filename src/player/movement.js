/**
 * Pure movement maths for the Wayfarer controller.
 *
 * Keeping acceleration curves, jump shaping, slope response, dodge vectors and
 * landing classification here means the feel of the controller can be tuned and
 * unit-tested in Node without a WebGL canvas.
 */

import { clamp, smoothstep } from '../util/math.js';

/** Tuning constants shared by the controller and its tests. */
export const MOVE = Object.freeze({
  walkSpeed: 4.9,
  runSpeed: 7.2,
  sprintSpeed: 10.7,
  /** Ground acceleration / braking, m/s². */
  groundAccel: 26,
  groundDecel: 34,
  /** Air acceleration is deliberately lower and asymmetric. */
  airAccel: 11,
  airDecel: 2.4,
  /** Extra acceleration while actively steering against current velocity. */
  turnAssist: 1.35,
  sprintRamp: 0.62,
  sprintStaminaDrain: 34,
  gravity: 25,
  apexGravity: 17.5,
  fallGravity: 31,
  apexWindow: 2.1,
  jumpSpeed: 8.9,
  doubleJumpSpeed: 9.6,
  /** Vertical velocity retained when the jump key is released early. */
  jumpCut: 0.46,
  coyote: 0.12,
  jumpBuffer: 0.16,
  dodgeSpeed: 13.6,
  dodgeDuration: 0.3,
  dodgeCooldown: 0.52,
  dodgeStamina: 16,
  dodgeIFrames: 0.34,
  dodgeRecovery: 0.18,
  landRollSpeed: 12.5,
  landRollDuration: 0.55,
  heavyLandSpeed: 17,
  maxFallSpeed: 48,
  worldEdge: 2900,
});

/** Move `current` toward `target` by at most `rate * dt`; never overshoots. */
export function approach(current, target, rate, dt) {
  const delta = target - current;
  const step = Math.max(0, rate) * Math.max(0, dt);
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

/**
 * Asymmetric acceleration: accelerate toward a faster target, brake toward a
 * slower one (or when reversing direction).
 *
 * @param {number} current current axis velocity
 * @param {number} target desired axis velocity
 * @param {number} accel acceleration rate
 * @param {number} decel braking rate
 * @param {number} dt
 */
export function approachAxis(current, target, accel, decel, dt) {
  const speedingUp = Math.abs(target) > Math.abs(current) && Math.sign(target || 1) === Math.sign(current || 1);
  return approach(current, target, speedingUp ? accel : decel, dt);
}

/** Move horizontal velocity toward its target at a bounded, frame-rate-independent rate. */
export function approachVelocity(vx, vz, targetX, targetZ, accel, decel, dt) {
  const dx = targetX - vx, dz = targetZ - vz;
  const delta = Math.hypot(dx, dz);
  if (delta < 1e-8) return { x: targetX, z: targetZ };
  const reversing = vx * targetX + vz * targetZ < -0.1;
  const accelerating = !reversing && Math.hypot(targetX, targetZ) > Math.hypot(vx, vz);
  const rate = reversing ? decel * MOVE.turnAssist : accelerating ? accel : decel;
  const blend = Math.min(1, Math.max(0, rate) * Math.max(0, dt) / delta);
  return { x: vx + dx * blend, z: vz + dz * blend };
}

/**
 * 0..1 sprint ramp. Tapping shift gives a short burst; holding it settles into
 * the full sprint speed. Returns 0 when the player cannot sprint.
 */
export function sprintBlend(holdSeconds, moving, stamina, grounded = true, inWater = false) {
  if (!moving || !grounded || inWater || stamina <= 1) return 0;
  return smoothstep(0.04, MOVE.sprintRamp, Math.max(0, holdSeconds));
}

/** Horizontal target speed before slope/terrain modifiers. */
export function targetSpeed({ moving, sprint, grounded, inWater, formMultiplier = 1 }) {
  if (!moving) return 0;
  const base = grounded ? MOVE.runSpeed : MOVE.walkSpeed;
  const speed = base + (MOVE.sprintSpeed - MOVE.runSpeed) * clamp(sprint, 0, 1);
  return speed * (inWater ? 0.55 : 1) * (formMultiplier || 1);
}

/**
 * Slope response from a surface normal and a horizontal movement direction.
 * Uphill movement is slower, downhill slightly faster. Steep faces bite harder.
 *
 * @param {{x:number,y:number,z:number}} normal surface normal
 * @param {number} dirX movement direction x
 * @param {number} dirZ movement direction z
 * @returns {number} speed multiplier 0.55 .. 1.16
 */
export function slopeSpeedFactor(normal, dirX, dirZ) {
  if (!normal) return 1;
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-5) return 1;
  const nx = dirX / len;
  const nz = dirZ / len;
  // Surface normals point uphill: n.x/n.z are the negative gradient.
  const uphill = clamp(-(normal.x * nx + normal.z * nz), -1, 1);
  const steepness = clamp(1 - (normal.y ?? 1), 0, 0.85);
  const factor = 1 - uphill * (0.24 + steepness * 0.62) + (uphill < 0 ? -uphill * 0.12 : 0);
  return clamp(factor, 0.55, 1.16);
}

/**
 * Downhill slide acceleration on faces too steep to stand on. Returns a
 * horizontal acceleration vector; zero on gentle ground.
 *
 * @param {{x:number,y:number,z:number}} normal
 * @param {number} slope 0..1 (1 = vertical)
 */
export function slopeSlide(normal, slope) {
  if (!normal || slope < 0.56) return { x: 0, z: 0 };
  const strength = smoothstep(0.56, 0.82, slope) * 18;
  const len = Math.hypot(normal.x, normal.z) || 1;
  return { x: (normal.x / len) * strength, z: (normal.z / len) * strength };
}

/** Air control multiplier: full authority just after take-off, then reduced. */
export function airControl(airTime) {
  return 1 - smoothstep(0.28, 1.15, airTime) * 0.45;
}

/** Gravity for the current vertical velocity (apex float, heavier fall). */
export function gravityFor(vy) {
  if (vy < 0) return MOVE.fallGravity;
  if (Math.abs(vy) <= MOVE.apexWindow) return MOVE.apexGravity;
  return MOVE.gravity;
}

/**
 * Apply the variable-height jump cut. Returns the new vertical velocity and
 * whether the cut has now been consumed.
 */
export function jumpCut(vy, jumpHeld, alreadyCut) {
  if (!jumpHeld && !alreadyCut && vy > 0) return { vy: vy * MOVE.jumpCut, cut: true };
  return { vy, cut: alreadyCut };
}

/** 0..1 landing force from touchdown speed. */
export function landingForce(impactSpeed) {
  return clamp((impactSpeed - 3) / 17, 0, 1);
}

/** Should a fast, moving landing turn into a recovery roll? */
export function shouldRoll(impactSpeed, horizontalSpeed) {
  return impactSpeed >= MOVE.landRollSpeed && horizontalSpeed > 2.4;
}

/** Roll progress 0..1 over the recovery window. */
export function rollProgress(elapsed, duration = MOVE.landRollDuration) {
  return clamp(elapsed / Math.max(0.0001, duration), 0, 1);
}

/**
 * Dodge direction from raw input, camera yaw and the player's current facing.
 * With no input, dodge backwards relative to facing (a defensive backstep).
 *
 * @returns {{x:number,z:number}} unit vector
 */
export function dodgeDirection(inputX, inputZ, cameraYaw, facingYaw = 0) {
  const len = Math.hypot(inputX, inputZ);
  if (len > 0.001) {
    const ix = inputX / len;
    const iz = inputZ / len;
    // Camera forward is -Z rotated by yaw; right is +X rotated by yaw.
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const x = -sin * iz + cos * ix;
    const z = -cos * iz - sin * ix;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  }
  return { x: Math.sin(facingYaw), z: Math.cos(facingYaw) };
}

/** Can the player start a dodge right now? */
export function canDodge({ stamina, cooldown, grounded, dashing, inWater }) {
  return stamina >= MOVE.dodgeStamina && cooldown <= 0 && !dashing && !inWater;
}

/**
 * Ease-out speed curve for a dodge. Starts at full speed and bleeds to 62 % by
 * the end of the window, so the recovery has momentum instead of a hard stop.
 */
export function dodgeSpeedAt(elapsed, duration = MOVE.dodgeDuration) {
  const t = clamp(elapsed / Math.max(0.0001, duration), 0, 1);
  return MOVE.dodgeSpeed * (1 - t * 0.38);
}

/** Footstep distance accumulator threshold for the current speed. */
export function strideLength(speed) {
  return clamp(2.35 - (speed - MOVE.runSpeed) * 0.055, 1.55, 2.35);
}

/**
 * Full 3D flight direction from camera yaw/pitch and raw input.
 *
 * `inputZ` is forward/back, `inputX` is right/left. Looking up makes forward
 * climb; looking down makes it dive. Strafing stays horizontal. The result is a
 * unit vector (or zero when there is no input).
 *
 * @param {number} inputX
 * @param {number} inputZ
 * @param {number} yaw
 * @param {number} pitch
 * @returns {{x:number,y:number,z:number}}
 */
export function flightDirection(inputX, inputZ, yaw, pitch) {
  const len = Math.hypot(inputX, inputZ);
  if (len < 0.001) return { x: 0, y: 0, z: 0 };
  const ix = inputX / len;
  const iz = inputZ / len;
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp;
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cp;
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const x = fx * iz + rx * ix;
  const y = fy * iz;
  const z = fz * iz + rz * ix;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
