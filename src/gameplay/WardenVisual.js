import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { retargetLocomotion } from '../player/CharacterAsset.js';
import { clamp, damp } from '../util/math.js';

let assetsPromise;

/** Load once; enemies share geometry and textures but have independent skeletons. */
function loadAssets() {
  if (!assetsPromise) {
    const loader = new GLTFLoader();
    const base = import.meta.env.BASE_URL;
    assetsPromise = Promise.all([
      loader.loadAsync(`${base}assets/enemies/warden.glb`),
      loader.loadAsync(`${base}assets/hero/locomotion.glb`),
    ]).catch((error) => { assetsPromise = null; throw error; });
  }
  return assetsPromise;
}

export class WardenVisual {
  static async create() {
    const [character, motion] = await loadAssets();
    return new WardenVisual(character, motion);
  }

  constructor(character, motion) {
    this.group = new THREE.Group();
    const facing = new THREE.Group();
    facing.rotation.y = Math.PI; // glTF faces +Z; enemy rigs face -Z
    this.facing = facing;
    this.group.add(facing);
    this.model = clone(character.scene);
    facing.add(this.model);
    this.materials = [];
    this.model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      const cloneMaterial = (material) => {
        const copy = material.clone();
        if (copy.emissive) {
          copy.emissive.set('#24132d');
          copy.emissiveIntensity = 0.9;
        }
        this.materials.push(copy);
        return copy;
      };
      object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
    });
    const walk = motion.animations.find((clip) => clip.name === 'Walk');
    this.mixer = new THREE.AnimationMixer(this.model);
    if (walk) {
      const clip = retargetLocomotion(walk, motion.scene, this.model);
      if (clip.tracks.length) {
        this.walk = this.mixer.clipAction(clip);
        this.walk.play();
      }
    }
    this.arms = ['LeftArm', 'RightArm'].map((name) => this.model.getObjectByName(name));
    this.forearms = ['LeftForeArm', 'RightForeArm'].map((name) => this.model.getObjectByName(name));
    this.thighs = ['LeftUpLeg', 'RightUpLeg'].map((name) => this.model.getObjectByName(name));
    this.direction = new THREE.Vector3();
    this.current = new THREE.Vector3();
    this.axis = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.worldRotation = new THREE.Quaternion();
    this.inverseFacing = new THREE.Quaternion();
    this.facingRotation = new THREE.Quaternion();
    this.parentRotation = new THREE.Quaternion();
    this.deltaRotation = new THREE.Quaternion();
    this.swing = 0;
    this.attackBlend = 0;
    this.attackDirections = [new THREE.Vector3(), new THREE.Vector3()];
  }

  update(dt, enemy) {
    this.group.position.copy(enemy.body.position);
    this.group.rotation.copy(enemy.body.rotation);
    if (this.walk) {
      this.walk.setEffectiveWeight(Math.min(1, (enemy.moveBlend ?? 0) * 1.4));
      this.walk.timeScale = 0.7 + (enemy.moveBlend ?? 0) * 0.35;
    }
    this.mixer.update(dt);
    this.facing.getWorldQuaternion(this.facingRotation);
    this.inverseFacing.copy(this.facingRotation).invert();
    let stride = 0;
    if (this.thighs[0] && this.thighs[1]) {
      this.thighs[0].getWorldQuaternion(this.worldRotation);
      const left = this.current.set(0, 1, 0).applyQuaternion(this.worldRotation).applyQuaternion(this.inverseFacing).z;
      this.thighs[1].getWorldQuaternion(this.worldRotation);
      const right = this.current.set(0, 1, 0).applyQuaternion(this.worldRotation).applyQuaternion(this.inverseFacing).z;
      stride = clamp((left - right) * 0.65, -0.55, 0.55) * clamp(enemy.moveBlend ?? 0, 0, 1);
    }
    this.swing = damp(this.swing, stride, 12, dt);
    const winding = (enemy.windup ?? 0) > 0;
    const striking = (enemy.lunge ?? 0) > 0;
    if (winding || striking) {
      if (enemy.windupKind === 'nova') {
        this.attackDirections[0].set(0.55, 0.6, 0.75);
        this.attackDirections[1].set(-0.55, 0.6, 0.75);
      } else if (striking) {
        this.attackDirections[0].set(0.22, -0.65, 0.45);
        this.attackDirections[1].set(-0.2, -0.3, 1);
      } else {
        this.attackDirections[0].set(0.22, -0.8, 0.35);
        this.attackDirections[1].set(-0.32, 0.05, -0.9);
      }
      this.attackDirections.forEach((direction) => direction.normalize());
    }
    this.attackBlend = damp(this.attackBlend, winding || striking ? 1 : 0, winding ? 7 : 11, dt);
    this.arms.forEach((arm, i) => {
      const swing = this.swing * (i === 0 ? -1 : 1);
      this.direction.set(i === 0 ? 0.16 : -0.16, -1, swing + 0.08).normalize();
      this.direction.lerp(this.attackDirections[i], this.attackBlend).normalize();
      this._alignBone(arm, this.direction);
      this.direction.set(i === 0 ? 0.14 : -0.14, -1, swing * 0.7 + 0.32).normalize();
      this.direction.lerp(this.attackDirections[i], this.attackBlend * 0.85).normalize();
      this._alignBone(this.forearms[i], this.direction);
    });
  }

  _alignBone(bone, direction) {
    if (!bone?.parent) return;
    bone.getWorldQuaternion(this.worldRotation);
    this.current.set(0, 1, 0).applyQuaternion(this.worldRotation).normalize();
    this.aim.copy(direction).applyQuaternion(this.facingRotation).normalize();
    this.deltaRotation.setFromUnitVectors(this.current, this.aim);
    this.worldRotation.premultiply(this.deltaRotation);
    bone.parent.getWorldQuaternion(this.parentRotation).invert();
    bone.quaternion.copy(this.worldRotation.premultiply(this.parentRotation));
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
