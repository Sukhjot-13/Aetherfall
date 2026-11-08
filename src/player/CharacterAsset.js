import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, damp } from '../util/math.js';

/** Retarget local rotations while preserving the target character's bone lengths. */
export function retargetLocomotion(clip, source, target) {
  const tracks = [];
  const inverseRest = new THREE.Quaternion();
  const targetRest = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion')) continue;
    const name = track.name.slice(0, -'.quaternion'.length);
    const from = source.getObjectByName(name);
    const to = target.getObjectByName(name);
    if (!from || !to?.isBone) continue;
    inverseRest.copy(from.quaternion).invert();
    targetRest.copy(to.quaternion);
    const copy = track.clone();
    for (let i = 0; i < copy.values.length; i += 4) {
      rotation.fromArray(copy.values, i);
      rotation.premultiply(inverseRest).premultiply(targetRest).normalize();
      rotation.toArray(copy.values, i);
    }
    tracks.push(copy);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Shift the skinned rig toward foot contact while the controller is grounded. */
export function footContactOffset(lowestFoot, baseline = 0.15) {
  return clamp(baseline - lowestFoot, -0.25, 0.1);
}

/** Opposite arm swing based on the difference between the two thigh directions. */
export function strideFromLegs(leftForward, rightForward, moving) {
  return clamp((leftForward - rightForward) * 0.7, -0.65, 0.65) * clamp(moving, 0, 1);
}

const ARM_TRACK = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)\.(quaternion|position|scale)$/;

/** Keep the character's own relaxed arm pose instead of importing another rig's arm axes. */
export function preserveArmPose(clip, idle) {
  const tracks = clip.tracks.filter((track) => !ARM_TRACK.test(track.name));
  for (const track of idle.tracks) {
    if (!ARM_TRACK.test(track.name)) continue;
    const size = track.getValueSize();
    const copy = track.clone();
    copy.times = new Float32Array([0]);
    copy.values = track.values.slice(0, size);
    tracks.push(copy);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Textured, skinned hero; the procedural rig remains the load fallback. */
export class CharacterAsset {
  static async load(parent, staffTemplate) {
    const loader = new GLTFLoader();
    const base = import.meta.env.BASE_URL;
    const [character, motion, gestures] = await Promise.all([
      loader.loadAsync(`${base}assets/hero/wayfarer.glb`),
      loader.loadAsync(`${base}assets/hero/locomotion.glb`),
      loader.loadAsync(`${base}assets/hero/actions.glb`).catch(() => null),
    ]);
    return new CharacterAsset(parent, staffTemplate, character, motion, gestures);
  }

  constructor(parent, staffTemplate, character, motion, gestures = null) {
    this.parent = parent;
    this.container = new THREE.Group();
    // The asset faces +Z; the game uses -Z as forward.
    this.container.rotation.y = Math.PI;
    this.container.add(character.scene);
    character.scene.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false; // skinned bounds must follow animation
      }
    });
    this.hand = character.scene.getObjectByName('RightHand');
    this.feet = ['LeftFoot', 'RightFoot'].map((name) => character.scene.getObjectByName(name)).filter(Boolean);
    this.mixer = new THREE.AnimationMixer(character.scene);
    const idle = character.animations.find((clip) => clip.name === 'Idle_02');
    const walk = motion.animations.find((clip) => clip.name === 'Walk');
    const run = motion.animations.find((clip) => clip.name === 'Run');
    if (!idle || !walk || !run || !this.hand) throw new Error('Hero rig is missing required bones or clips');
    const walkClip = preserveArmPose(retargetLocomotion(walk, motion.scene, character.scene), idle);
    const runClip = preserveArmPose(retargetLocomotion(run, motion.scene, character.scene), idle);
    if (!walkClip.tracks.length || !runClip.tracks.length) throw new Error('Hero locomotion could not be retargeted');
    this.actions = [this.mixer.clipAction(idle), this.mixer.clipAction(walkClip), this.mixer.clipAction(runClip)];
    parent.add(this.container);
    for (const action of this.actions) action.play();
    this.weights = [1, 0, 0];
    this.actionBlend = 0;
    this.poseAction = null;
    this.castAction = null;
    if (gestures) {
      const jump = gestures.animations.find((clip) => clip.name === 'jump');
      const jab = gestures.animations.find((clip) => clip.name === 'jabR');
      if (jump) {
        const clip = retargetLocomotion(jump, gestures.scene, character.scene);
        if (clip.tracks.length) {
          this.poseAction = this.mixer.clipAction(clip);
          this.poseAction.play();
          this.poseAction.paused = true;
        }
      }
      if (jab) {
        const clip = retargetLocomotion(jab, gestures.scene, character.scene);
        clip.tracks = clip.tracks.filter((track) => /^(RightShoulder|RightArm|RightForeArm|RightHand)\.quaternion$/.test(track.name));
        if (clip.tracks.length) {
          THREE.AnimationUtils.makeClipAdditive(clip);
          this.castAction = this.mixer.clipAction(clip);
          this.castAction.play();
          this.castAction.paused = true;
        }
      }
    }
    this.staff = staffTemplate.clone(true);
    this.staff.scale.setScalar(0.75);
    this.staffLight = null;
    this.staff.traverse((object) => { if (object.isPointLight) this.staffLight = object; });
    // Keep the staff in character space, positioned from the animated hand.
    parent.add(this.staff);
    this.handPosition = new THREE.Vector3();
    this.footPosition = new THREE.Vector3();
    this.arms = ['LeftArm', 'RightArm'].map((name) => character.scene.getObjectByName(name));
    this.forearms = ['LeftForeArm', 'RightForeArm'].map((name) => character.scene.getObjectByName(name));
    this.thighs = ['LeftUpLeg', 'RightUpLeg'].map((name) => character.scene.getObjectByName(name));
    this.swingAxis = new THREE.Vector3();
    this.armDirection = new THREE.Vector3();
    this.currentDirection = new THREE.Vector3();
    this.swingRotation = new THREE.Quaternion();
    this.parentRotation = new THREE.Quaternion();
    this.characterRotation = new THREE.Quaternion();
    this.inverseCharacterRotation = new THREE.Quaternion();
    this.boneRotation = new THREE.Quaternion();
    this.stride = 0;
  }

  staffLightIntensity(intensity) {
    if (this.staffLight) this.staffLight.intensity = intensity;
  }

  update(dt, state, cast = 0, castProgress = 0, landing = 0) {
    const speed = Math.max(0, state.speed ?? 0);
    const moving = clamp((speed - 0.2) / 1.5, 0, 1);
    const running = clamp((speed - 3.2) / 3.2, 0, 1);
    const airborne = state.grounded === false && !state.flying;
    const crouching = Boolean(state.dodging) || (state.roll ?? 0) > 0 || landing > 0.1;
    const poseTarget = this.poseAction && (airborne || crouching) ? 1 : 0;
    this.actionBlend = damp(this.actionBlend, poseTarget, crouching ? 16 : 10, dt);
    const base = 1 - this.actionBlend;
    const targets = [(1 - moving) * base, moving * (1 - running) * base, moving * running * base];
    for (let i = 0; i < 3; i++) this.weights[i] = damp(this.weights[i], targets[i], 7, dt);
    this.actions.forEach((action, i) => action.setEffectiveWeight(this.weights[i]));
    if (this.poseAction) {
      // Samples of the jump clip: upright takeoff through a raised-knee air
      // pose, and a separate compact crouch for dodges and landings.
      this.poseAction.time = crouching ? 2.52 : clamp(2.05 - (state.vy ?? 0) * 0.025, 1.8, 2.25);
      this.poseAction.setEffectiveWeight(this.actionBlend);
    }
    if (this.castAction) {
      this.castAction.time = clamp(castProgress, 0, 1) * 0.9;
      this.castAction.setEffectiveWeight(cast);
    }
    this.actions[1].timeScale = clamp(speed / 3.2, 0.65, 1.35);
    this.actions[2].timeScale = clamp(speed / 6.5, 0.7, 1.35);
    const roll = clamp(state.dodging ? state.dodgeProgress ?? 0 : state.roll ?? 0, 0, 1);
    // Rotate around the torso rather than the feet, keeping the tumble near
    // ground level and completing the turn before returning to locomotion.
    const rollAngle = roll > 0 ? -roll * Math.PI * 2 : 0;
    this.container.rotation.x = roll > 0 ? rollAngle : damp(Math.atan2(Math.sin(this.container.rotation.x), Math.cos(this.container.rotation.x)),
      state.flying ? clamp(state.flightPitch ?? 0, -0.8, 0.8) : 0, 12, dt);
    const pivotHeight = 0.8;
    const rollLift = roll > 0 ? pivotHeight * (1 - Math.cos(rollAngle)) : 0;
    this.container.position.z = roll > 0 ? -pivotHeight * Math.sin(rollAngle) : 0;
    this.container.rotation.z = damp(this.container.rotation.z,
      state.flying ? clamp(state.flightRoll ?? 0, -0.5, 0.5) : 0, 8, dt);
    this.mixer.update(dt);
    // Follow the actual blended leg pose, rather than a separate oscillator:
    // walk and run clips can have different timing and may be crossfading.
    // Each arm counter-swings its own leg; the staff arm has a shorter arc.
    this.container.getWorldQuaternion(this.characterRotation);
    this.inverseCharacterRotation.copy(this.characterRotation).invert();
    let strideTarget = 0;
    if (this.thighs[0] && this.thighs[1]) {
      this.thighs[0].getWorldQuaternion(this.boneRotation);
      const left = this.currentDirection.set(0, 1, 0).applyQuaternion(this.boneRotation)
        .applyQuaternion(this.inverseCharacterRotation).z;
      this.thighs[1].getWorldQuaternion(this.boneRotation);
      const right = this.currentDirection.set(0, 1, 0).applyQuaternion(this.boneRotation)
        .applyQuaternion(this.inverseCharacterRotation).z;
      strideTarget = strideFromLegs(left, right, moving);
    }
    this.stride = damp(this.stride, strideTarget, 15, dt);
    this.arms.forEach((arm, i) => {
      const armWeight = (1 - this.actionBlend) * (i === 1 ? 1 - clamp(cast, 0, 1) : 1);
      const stride = this.stride * (i === 0 ? -1 : 0.65);
      this.armDirection.set(i === 0 ? 0.1 : -0.1, -1, stride).normalize();
      this._alignArmBone(arm, this.armDirection, armWeight);
      // Bent elbows lag the upper arms; the staff hand stays in front of the hip.
      this.armDirection.set(i === 0 ? 0.06 : -0.06, -1, stride * 0.65 + (i === 0 ? 0.28 : 0.45)).normalize();
      this._alignArmBone(this.forearms[i], this.armDirection, armWeight);
    });
    let groundOffset = 0;
    if (state.grounded !== false && !state.flying && this.feet.length) {
      let lowest = Infinity;
      for (const foot of this.feet) {
        foot.getWorldPosition(this.footPosition);
        this.parent.worldToLocal(this.footPosition);
        lowest = Math.min(lowest, this.footPosition.y - this.container.position.y);
      }
      if (roll === 0) groundOffset = footContactOffset(lowest);
    }
    this.container.position.y = roll > 0 ? rollLift : damp(this.container.position.y, groundOffset, 14, dt);
    this.hand.getWorldPosition(this.handPosition);
    // RightHand is the wrist joint. Move the grip into the palm instead of
    // letting the staff pivot around the wrist.
    this.hand.getWorldQuaternion(this.boneRotation);
    this.currentDirection.set(0, 1, 0).applyQuaternion(this.boneRotation).multiplyScalar(0.035);
    this.handPosition.add(this.currentDirection);
    this.parent.worldToLocal(this.handPosition);
    this.staff.position.copy(this.handPosition);
    this.staff.rotation.set(rollAngle + 0.08 - cast * 0.65, 0, -0.14);
  }

  _alignArmBone(bone, direction, weight) {
    if (!bone?.parent || weight <= 0) return;
    bone.getWorldQuaternion(this.boneRotation);
    this.currentDirection.set(0, 1, 0).applyQuaternion(this.boneRotation).normalize();
    this.swingAxis.copy(direction).applyQuaternion(this.characterRotation).normalize();
    this.swingRotation.setFromUnitVectors(this.currentDirection, this.swingAxis);
    this.boneRotation.premultiply(this.swingRotation);
    bone.parent.getWorldQuaternion(this.parentRotation).invert();
    this.boneRotation.premultiply(this.parentRotation);
    bone.quaternion.slerp(this.boneRotation, weight);
  }
}
