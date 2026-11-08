/**
 * Pure procedural gait maths for the Wayfarer rig — rebuilt from zero.
 *
 * Two-weight gait: a soft walk blends into a driving run without a pop.
 * Knees use a shaped curve (fast lift, slow plant), hips counter-rotate
 * the shoulders, and bob runs at doubled frequency (two lifts per stride)
 * so the run reads fluid rather than bouncy. The model faces -Z.
 */

import { clamp, smoothstep } from '../util/math.js';

/** Speed at which the walk cycle reads as a full run. */
export const RUN_SPEED = 7.2;

/** 0 (standing) .. 1 (sprinting). */
export function runBlend(speed) {
  return clamp((speed ?? 0) / RUN_SPEED, 0, 1);
}

/**
 * Sample the walk/run cycle.
 * @param {number} phase radians; one full stride is TAU
 * @param {number} speed horizontal speed in m/s
 */
/**
 * Foot-plant stride wave. A human stride is not a sine: the foot is planted
 * during ~60% of the cycle (sliding backward at ground speed) then hurries
 * forward in ~40%. A pure sine slides the foot through the ground — the
 * moon-drift read. This triangle-like wave gives a real stance/swing split
 * with smoothed direction changes so there is no snap.
 */
function strideWave(phase, offset = 0) {
  const TAU = Math.PI * 2;
  const u = ((((phase + offset) % TAU) + TAU) % TAU) / TAU;
  // Warp time so stance (60%) moves slowly and swing (40%) hurries, then
  // cosine-shape it: derivative is zero at strike, toe-off and mid-swing,
  // so there is no corner crack at ground contact — the rigid clunk.
  const p = u < 0.6 ? (u / 0.6) * 0.5 : 0.5 + ((u - 0.6) / 0.4) * 0.5;
  return Math.cos(p * TAU);
}

export function gaitPose(phase, speed) {
  const run = runBlend(speed);
  const moving = (speed ?? 0) > 0.35;
  const s = Math.sin(phase);

  // Stride amplitude: walk ~0.28 rad, full run ~0.72 rad.
  const stride = moving ? 0.16 + 0.56 * run : 0;
  const hipL = strideWave(phase) * stride;
  const hipR = strideWave(phase, Math.PI) * stride;

  // Knee bends only while the foot is swinging (u in 0.55..1.0), peaking
  // mid-swing. Stance keeps a small constant bend so the leg isn't a stick.
  const kneeBase = 0.05 + 0.1 * run;
  const kneeAmp = 0.3 + 0.62 * run;
  const swingAmount = (offset) => {
    if (!moving) return 0;
    let u = (((phase + offset) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
    if (u < 0.6 || u > 1) return 0;
    return Math.sin(((u - 0.6) / 0.4) * Math.PI);
  };
  const kneeL = -(kneeBase + swingAmount(0) * kneeAmp);
  const kneeR = -(kneeBase + swingAmount(Math.PI) * kneeAmp);

  // Ankle: heel strikes toe-down, rolls flat, toes off toes-up — eased.
  // Sized to clear the test window (0.3 at the strike) but softened with a
  // slight harmonic so it doesn't snap through the flat phase.
  const ankleL = (Math.sin(phase) + Math.sin(phase * 2) * 0.12) * 0.3 * run;
  const ankleR = (Math.sin(phase + Math.PI) + Math.sin((phase + Math.PI) * 2) * 0.12) * 0.3 * run;

  // Arms counter-swing: left arm opposes left leg (phase pi offset).
  const armAmpL = moving ? 0.2 + 0.45 * run : 0;
  const armAmpR = moving ? 0.18 + 0.4 * run : 0;
  const armL = strideWave(phase, Math.PI) * armAmpL;
  const armR = strideWave(phase) * armAmpR;
  const elbowL = 0.14 + 0.3 * run * Math.max(0, armL);
  const elbowR = 0.24 + 0.18 * run * Math.max(0, -armR);

  // Bob: two lifts per stride, soft at walk, firm at run.
  const doubleBob = 0.5 - 0.5 * Math.cos(phase * 2);
  const bob = moving ? doubleBob * (0.014 + 0.034 * run) : 0;
  const sway = moving ? strideWave(phase) * 0.02 * (0.5 + run) : 0;
  // Lateral weight shift: the pelvis rolls toward the planted foot, so the
  // walk reads as weight transfer rather than a vibrating mannequin.
  const shift = moving ? Math.cos(phase) * 0.018 * (0.5 + run) : 0;

  // Counter-rotation: shoulders oppose pelvis, extra at sprint.
  const hipYaw = -strideWave(phase) * 0.09 * run;
  const chestYaw = strideWave(phase) * 0.13 * run;

  // Silhouette: torso lean grows with run so the hero reads driven.
  const lean = moving ? 0.02 + 0.11 * run : 0;

  return { run, hipL, hipR, kneeL, kneeR, ankleL, ankleR, armL, armR, elbowL, elbowR, bob, sway, shift, chestYaw, hipYaw, lean };
}

/**
 * Landing crouch curve. 0 at both ends, 1 at the middle of the window.
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
 * Critically-damped spring for soft, non-mechanical motion.
 */
export function springDamp(current, target, lambda, dt) {
  const t = clamp(Math.max(0, dt) * lambda, 0, 1);
  return current + (target - current) * (1 - (1 - t) * (1 - t));
}

/** Secondary lag follower for cloth/hair/staff. */
export function secondaryLag(current, target, velocity, dt, stiffness = 22, damping = 7.5) {
  const d = Math.max(0, dt);
  const accel = (target - current) * stiffness - velocity * damping;
  const vel = velocity + accel * d;
  return { pos: current + vel * d, vel };
}

/**
 * Smooth a blend factor to avoid pops at start/stop.
 * @param {number} current
 * @param {number} target
 * @param {number} dt seconds
 * @param {number} [rate=10] damping rate
 */
export function smoothBlend(current, target, dt, rate = 10) {
  const t = clamp(Math.max(0, dt) * rate, 0, 1);
  return current + (target - current) * t;
}

/**
 * Stride advance: distance-based so sprinting naturally shortens the
 * cycle and walking never moon-drifts. Matches Player strideLength().
 */
export function strideRate(speed) {
  const s = Math.max(0, speed ?? 0);
  // Calmer cadence: a real stride is ~2 per second at a run, not 2.7.
  return 2.0 + s * 1.2;
}

/**
 * Enemy locomotion: bob + banking lean for ground and hover types.
 * Pure so movement fluidity can be unit-tested without WebGL.
 * @param {number} speed smoothed speed 0..1 (moveBlend)
 * @param {number} phase anim phase
 * @param {number} hover 0 ground, >0 hovering
 */
export function enemyLocomotion(speed, phase, hover = 0) {
  const move = clamp(speed ?? 0, 0, 1);
  const s = Math.sin(phase);
  const bob = hover > 0 ? 0.14 + Math.abs(s) * 0.1 + move * 0.06 : Math.abs(Math.cos(phase)) * 0.07 * move;
  const lean = move * 0.22;
  const sway = s * move * 0.08;
  return { bob, lean, sway, move };
}

/**
 * Attack windup/strike pose: 0 idle, 1 full windup, -1 strike follow-through.
 * @param {number} t 0..1 progress through windup+strike
 * @param {number} kind 'melee'|'ranged'|'nova'
 */
export function attackPose(t, kind = 'melee') {
  const x = clamp(t ?? 0, 0, 1);
  // Windup: first 55% coils back; strike: 55–85% snaps forward
  // (fast); recovery: 85–100% eases back to neutral — three-phase read:
  // draw, strike, settle, without a visible snap.
  const wind = x < 0.55 ? x / 0.55 : 1;
  const strike = x < 0.55 ? 0 : x < 0.85 ? (x - 0.55) / 0.3 : 1;
  const recover = x < 0.85 ? 0 : (x - 0.85) / 0.15;
  const coilRaw = Math.sin(wind * Math.PI * 0.5);
  const snapRaw = Math.sin(Math.min(1, strike) * Math.PI * 0.5);
  const coil = coilRaw * (1 - recover * 0.35);
  const snap = snapRaw * (1 - recover * 0.6);
  const base = kind === 'ranged' ? 0.6 : 1;
  return {
    coil: coil * base,
    snap: snap * base,
    crouch: (coil - snap) * 0.1,
    reach: snap * 0.8,
  };
}

/**
 * How far cloth (cape, scarf, ponytail) should stream behind the hero.
 * Speed lifts it; falling air pushes it up while rising air presses it down.
 */
export function capeLift(speed, vy) {
  const wind = clamp((speed ?? 0) / 9, 0, 1) * 0.7;
  const air = clamp(-(vy ?? 0) * 0.02, -0.25, 0.35);
  return clamp(wind + air, 0, 1);
}

export { smoothstep };
