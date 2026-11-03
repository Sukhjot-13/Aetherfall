/**
 * Pure pose targets for Vaelor's body language.
 *
 * The renderer applies these with damped rotations; keeping the numbers here
 * means wind-up/recovery readability can be tested without WebGL and tuned
 * separately from attack damage or timing.
 */

import { clamp, smoothstep } from '../util/math.js';

/** Default standing pose. All angles are radians. */
export const NEUTRAL_POSE = Object.freeze({
  bodyX: 0.02,
  bodyY: 0,
  bodyZ: 0,
  bodyZOffset: 0,
  headX: 0,
  headY: 0,
  headZ: 0,
  armLX: 0,
  armLZ: -0.18,
  elbowL: 0.28,
  armRX: -0.1,
  armRZ: 0.18,
  elbowR: 0.2,
  bladeX: 0,
  bladeZ: 0.12,
  charge: 0,
});

/** A fresh mutable neutral pose. */
export function neutralPose() {
  return { ...NEUTRAL_POSE };
}

/**
 * Idle breathing/sway. `time` is seconds since the encounter started.
 * @param {number} time
 */
export function idlePose(time = 0) {
  const t = Number.isFinite(time) ? time : 0;
  const pose = neutralPose();
  pose.bodyX = 0.02 + Math.sin(t * 0.7) * 0.012;
  pose.bodyY = Math.sin(t * 0.5) * 0.035;
  pose.bodyZ = Math.sin(t * 0.7) * 0.022;
  pose.headX = Math.sin(t * 1.2) * 0.045;
  pose.headY = Math.sin(t * 0.8) * 0.05;
  pose.armLX = Math.sin(t * 1.1) * 0.08;
  pose.armRX = -0.1 + Math.sin(t * 1.1 + 1) * 0.08;
  pose.bladeX = Math.sin(t * 0.9) * 0.03;
  return pose;
}

/** Later phases exaggerate the same silhouette without changing timing. */
function ferocity(phase) {
  return 1 + clamp((phase ?? 1) - 1, 0, 2) * 0.08;
}

/**
 * Pose for an in-progress attack.
 *
 * @param {'cleave'|'slam'|'volley'|'rifts'|'storm'|'summon'|string} kind
 * @param {number} phase 1..3
 * @param {number} progress 0..1 within the current wind-up or recovery
 * @param {boolean} recovering false during the telegraph, true after the hit
 * @returns {typeof NEUTRAL_POSE}
 */
export function actionPose(kind, phase = 1, progress = 0, recovering = false) {
  const p = clamp(progress, 0, 1);
  const e = smoothstep(0, 1, p);
  const f = ferocity(phase);
  const pose = neutralPose();

  if (recovering) {
    // `back` is 1 at the instant of the hit and decays to 0 as the boss
    // settles back into his stance.
    const back = 1 - e;
    switch (kind) {
      case 'cleave':
        // Follow-through: torso snaps forward and the blade sweeps across.
        pose.bodyX = 0.02 + 0.16 * back;
        pose.bodyY = 0.3 * back;
        pose.bodyZ = -0.03 * back;
        pose.bodyZOffset = 0.16 * back;
        pose.headY = -0.12 * back;
        pose.armRX = -0.1 + 1.1 * back;
        pose.armRZ = 0.18 + 0.05 * back;
        pose.elbowR = 0.2 + 0.25 * back;
        pose.armLX = 0.18 * back;
        pose.armLZ = -0.18 - 0.1 * back;
        pose.elbowL = 0.28 + 0.1 * back;
        pose.bladeX = 0.3 * back;
        pose.bladeZ = 0.12 - 0.35 * back;
        pose.charge = 0.1 * back;
        break;
      case 'slam':
        // Crouched over the impact, then a slow rise.
        pose.bodyX = 0.02 + 0.3 * back;
        pose.bodyZOffset = 0.12 * back;
        pose.headX = 0.22 * back;
        pose.armLX = 0.55 * back;
        pose.armRX = -0.1 + 0.65 * back;
        pose.armLZ = -0.18 - 0.12 * back;
        pose.armRZ = 0.18 + 0.12 * back;
        pose.elbowL = 0.28 + 0.07 * back;
        pose.elbowR = 0.2 + 0.15 * back;
        pose.bladeX = 0.15 * back;
        pose.charge = 0.08 * back;
        break;
      case 'volley':
      case 'storm':
        // Recoil away from the release, arms still extended.
        pose.bodyX = 0.02 - 0.16 * back;
        pose.bodyZOffset = 0.08 * back;
        pose.headX = 0.06 * back;
        pose.armLX = 0.45 * back;
        pose.armRX = -0.1 + 0.5 * back;
        pose.armLZ = -0.18 - 0.24 * back;
        pose.armRZ = 0.18 + 0.24 * back;
        pose.elbowL = 0.28 + 0.57 * back;
        pose.elbowR = 0.2 + 0.6 * back;
        pose.charge = 0.12 * back;
        break;
      case 'rifts':
        pose.bodyX = 0.02 + 0.08 * back;
        pose.headX = 0.06 * back;
        pose.armLX = 0.15 * back;
        pose.armRX = -0.1 + 0.25 * back;
        pose.armLZ = -0.18 - 0.47 * back;
        pose.armRZ = 0.18 + 0.47 * back;
        pose.elbowL = 0.28 + 0.12 * back;
        pose.elbowR = 0.2 + 0.2 * back;
        pose.charge = 0.1 * back;
        break;
      case 'summon':
        pose.bodyX = 0.02 + 0.06 * back;
        pose.headX = 0.1 * back;
        pose.armLX = -0.25 * back;
        pose.armRX = -0.1 - 0.15 * back;
        pose.armLZ = -0.18 - 0.67 * back;
        pose.armRZ = 0.18 + 0.67 * back;
        pose.elbowL = 0.28 + 0.17 * back;
        pose.elbowR = 0.2 + 0.25 * back;
        pose.charge = 0.1 * back;
        break;
      default:
        break;
    }
    return pose;
  }

  switch (kind) {
    case 'cleave':
      // Coil away from the swing, blade high and behind.
      pose.bodyX = 0.02 - 0.14 * f * e;
      pose.bodyY = -0.38 * f * e;
      pose.headY = 0.26 * f * e;
      pose.armRX = -0.1 - 1.45 * f * e;
      pose.armRZ = 0.18 + (0.27 + 0.2 * f) * e;
      pose.elbowR = 0.2 + (0.15 + 0.25 * f) * e;
      pose.armLX = 0.3 * f * e;
      pose.armLZ = -0.18 - 0.27 * e;
      pose.elbowL = 0.28 + 0.22 * e;
      pose.bladeX = -0.2 * e;
      pose.bladeZ = 0.12 + 0.7 * e;
      pose.charge = e;
      break;
    case 'slam':
      // Both arms overhead, chest open, then the body drops on the hit.
      pose.bodyX = 0.02 - 0.08 * e;
      pose.headX = -0.2 * e;
      pose.armLX = 2.25 * f * e;
      pose.armRX = 2.25 * f * e;
      pose.armLZ = -0.18 - 0.1 * e;
      pose.armRZ = 0.18 + 0.1 * e;
      pose.elbowL = 0.28 - 0.16 * e;
      pose.elbowR = 0.2 - 0.08 * e;
      pose.bladeX = 0.35 * e;
      pose.charge = e;
      break;
    case 'volley':
    case 'storm':
      pose.bodyX = 0.02 - 0.08 * e;
      pose.headX = -0.08 * e;
      pose.armLX = 1.0 * f * e;
      pose.armRX = -0.1 + (1.0 + (f - 1) * 0.9) * e;
      pose.armLZ = -0.18 - 0.18 * e;
      pose.armRZ = 0.18 + 0.18 * e;
      pose.elbowL = 0.28 + 0.47 * e;
      pose.elbowR = 0.2 + 0.5 * e;
      pose.charge = e;
      break;
    case 'rifts':
      // Arms spread wide to tear the Veil open.
      pose.bodyX = 0.02 - 0.12 * e;
      pose.bodyZ = Math.sin(e * Math.PI) * 0.05;
      pose.headX = -0.12 * e;
      pose.armLX = -0.2 * e;
      pose.armRX = -0.1 - 0.1 * e;
      pose.armLZ = -0.18 - (1.22 + 0.35 * (f - 1)) * e;
      pose.armRZ = 0.18 + (1.22 + 0.35 * (f - 1)) * e;
      pose.elbowL = 0.28 - 0.08 * e;
      pose.elbowR = 0.2;
      pose.charge = e;
      break;
    case 'summon':
      pose.bodyX = 0.02 - 0.16 * e;
      pose.headX = -0.2 * e;
      pose.armLX = -0.9 * f * e;
      pose.armRX = -0.1 - 0.8 * f * e;
      pose.armLZ = -0.18 - (1.07 + 0.25 * f) * e;
      pose.armRZ = 0.18 + (1.07 + 0.25 * f) * e;
      pose.elbowL = 0.28 - 0.03 * e;
      pose.elbowR = 0.2 + 0.05 * e;
      pose.charge = e;
      break;
    default:
      break;
  }
  return pose;
}
