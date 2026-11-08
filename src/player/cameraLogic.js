/**
 * Camera mode rules and orbit maths. Pure so the first/third person switch can
 * be tested without a renderer.
 */

import { clamp, TAU, wrapAngle } from '../util/math.js';

export const CAMERA_MODES = Object.freeze({
  FIRST: 'first',
  THIRD: 'third',
});

export const THIRD_PERSON = Object.freeze({
  distance: 5.6,
  height: 1.65,
  shoulder: 0.55,
  minDistance: 1.2,
  maxDistance: 10,
});

export const FIRST_PERSON = Object.freeze({
  eyeHeight: 1.68,
});

/** Create orbit state. Yaw 0 looks toward -Z. */
export function createCameraState(mode = CAMERA_MODES.THIRD) {
  return {
    mode,
    yaw: 0,
    pitch: -0.1,
    distance: THIRD_PERSON.distance,
    shake: 0,
    fovKick: 0,
  };
}

/** Flip between first and third person. */
export function toggleCameraMode(mode) {
  return mode === CAMERA_MODES.THIRD ? CAMERA_MODES.FIRST : CAMERA_MODES.THIRD;
}

/** Keep pitch inside a sane human range. */
export function clampPitch(pitch) {
  return clamp(pitch, -1.22, 0.92);
}

/** Apply mouse look deltas (radians) with sensitivity. */
export function applyLook(state, dx, dy, sensitivity = 1, invertY = false) {
  state.yaw = wrapAngle(state.yaw - dx * sensitivity);
  state.pitch = clampPitch(state.pitch - dy * sensitivity * (invertY ? -1 : 1));
  return state;
}

/** Unit forward vector for a yaw/pitch pair. */
export function lookDirection(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

/** Horizontal forward vector (movement basis). */
export function forwardFromYaw(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Horizontal right vector (movement basis). */
export function rightFromYaw(yaw) {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/**
 * Desired third-person camera position for a target point.
 * @param {{x:number,y:number,z:number}} target
 * @param {{yaw:number,pitch:number,distance:number}} state
 * @param {{height?:number,shoulder?:number}} [opts]
 */
export function thirdPersonPosition(target, state, opts = {}) {
  const height = opts.height ?? THIRD_PERSON.height;
  const shoulder = opts.shoulder ?? THIRD_PERSON.shoulder;
  const cp = Math.cos(state.pitch);
  const right = rightFromYaw(state.yaw);
  return {
    x: target.x + Math.sin(state.yaw) * state.distance * cp + right.x * shoulder,
    y: target.y + height - Math.sin(state.pitch) * state.distance,
    z: target.z + Math.cos(state.yaw) * state.distance * cp + right.z * shoulder,
  };
}

/** Eye position for first person. */
export function firstPersonPosition(target, eyeHeight = FIRST_PERSON.eyeHeight) {
  return { x: target.x, y: target.y + eyeHeight, z: target.z };
}

/** True when the mode hides the player body. */
export function isFirstPerson(mode) {
  return mode === CAMERA_MODES.FIRST;
}

/** Clamp third-person zoom distance. */
export function clampDistance(distance) {
  return clamp(distance, THIRD_PERSON.minDistance, THIRD_PERSON.maxDistance);
}

/** Convert a world yaw into a camera yaw that looks along it. */
export function yawFromDirection(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/** Shortest signed angle from a to b, in radians. */
export function angleDelta(a, b) {
  return wrapAngle(b - a);
}

/** Normalised 0..1 progress of a full turn, handy for compass ribbons. */
export function compassFraction(yaw) {
  return (((-yaw / TAU) % 1) + 1) % 1;
}
