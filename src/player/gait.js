/**
 * Pure procedural gait maths for the Wayfarer rig.
 *
 * The model faces -Z, so a positive X rotation swings a hanging limb forward.
 * Keeping the cycle maths here (instead of inside PlayerModel) lets the
 * animation be unit-tested in Node without a WebGL canvas.
 */

import { clamp } from '../util/math.js';

/** Speed at which the walk cycle reads as a full run. */
export const RUN_SPEED = 7.2;

/** 0 (standing) .. 1 (sprinting). */
export function runBlend(speed) {
  return clamp((speed ?? 0) / RUN_SPEED, 0, 1);
}

/**
 * Sample the walk/run cycle.
 *
 * @param {number} phase  radians; one full stride is TAU
 * @param {number} speed  horizontal speed in m/s
 * @returns {{
 *   run:number, hipL:number, hipR:number, kneeL:number, kneeR:number,
 *   ankleL:number, ankleR:number, armL:number, armR:number,
 *   elbowL:number, elbowR:number, bob:number, sway:number,
 *   chestYaw:number, hipYaw:number
 * }}
 */
export function gaitPose(phase, speed) {
  const run = runBlend(speed);
  const moving = (speed ?? 0) > 0.35;
  const s = Math.sin(phase);
  const c = Math.cos(phase);

  // Hip amplitude: a relaxed walk is ~0.5 rad, a sprint ~0.78 rad.
  const stride = moving ? 0.14 + 0.62 * run : 0;
  const hipL = s * stride;
  const hipR = -s * stride;

  // Knees only bend backwards (negative X) and peak during the forward swing.
  const swingL = moving ? Math.max(0, c) : 0;
  const swingR = moving ? Math.max(0, -c) : 0;
  const kneeBase = moving ? 0.05 : 0.03;
  const kneeL = -(kneeBase + swingL * (0.28 + 0.82 * run));
  const kneeR = -(kneeBase + swingR * (0.28 + 0.82 * run));

  // Heel strike (toe up) when the leg is forward, toe-off when it is back.
  const ankleL = s * 0.4 * run;
  const ankleR = -s * 0.4 * run;

  // Arms counter-swing; the staff arm is deliberately quieter.
  const armAmpL = moving ? 0.12 + 0.52 * run : 0;
  const armAmpR = moving ? 0.1 + 0.32 * run : 0;
  const armL = -s * armAmpL;
  const armR = s * armAmpR;
  const elbowL = 0.1 + 0.42 * run * Math.max(0, -s);
  const elbowR = 0.2 + 0.26 * run * Math.max(0, s);

  // Hips rise as the legs pass under the body and drop at double support.
  const bob = moving ? (1 - Math.abs(s)) * (0.012 + 0.03 * run) : 0;
  const sway = s * 0.016 * run;

  // Shoulders counter-rotate against the pelvis.
  const hipYaw = -s * 0.1 * run;
  const chestYaw = s * 0.16 * run;

  return { run, hipL, hipR, kneeL, kneeR, ankleL, ankleR, armL, armR, elbowL, elbowR, bob, sway, chestYaw, hipYaw };
}

/**
 * Landing crouch curve. 0 at both ends, 1 at the middle of the window.
 *
 * @param {number} elapsed seconds since touchdown
 * @param {number} duration total squash window in seconds
 * @param {number} strength 0..1 impact strength
 */
export function landSquash(elapsed, duration, strength) {
  const d = Math.max(duration, 1e-4);
  const t = clamp((elapsed ?? 0) / d, 0, 1);
  if (t <= 0 || t >= 1) return 0;
  return clamp(strength ?? 0, 0, 1) * Math.sin(Math.PI * t);
}

/**
 * How far cloth (cape, scarf, ponytail) should stream behind the hero.
 * Speed lifts it; falling air pushes it up while rising air presses it down.
 *
 * @param {number} speed horizontal speed
 * @param {number} vy vertical velocity (positive = rising)
 */
export function capeLift(speed, vy) {
  const wind = clamp((speed ?? 0) / 9, 0, 1) * 0.7;
  const air = clamp(-(vy ?? 0) * 0.02, -0.25, 0.35);
  return clamp(wind + air, 0, 1);
}
