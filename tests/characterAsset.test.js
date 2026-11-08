import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { retargetLocomotion, footContactOffset, preserveArmPose, strideFromLegs } from '../src/player/CharacterAsset.js';

test('locomotion retargets rotations to the new rest pose without changing bone lengths', () => {
  const source = new THREE.Group();
  const from = new THREE.Object3D();
  from.name = 'LeftLeg';
  from.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
  source.add(from);
  const target = new THREE.Group();
  const to = new THREE.Bone();
  to.name = 'LeftLeg';
  to.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.3);
  target.add(to);
  const pose = from.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5));
  const clip = new THREE.AnimationClip('Walk', 1, [
    new THREE.QuaternionKeyframeTrack('LeftLeg.quaternion', [0, 1], [...from.quaternion.toArray(), ...pose.toArray()]),
    new THREE.VectorKeyframeTrack('LeftLeg.position', [0, 1], [0, 1, 0, 0, 2, 0]),
  ]);
  const converted = retargetLocomotion(clip, source, target);
  assert.equal(converted.tracks.length, 1);
  const first = new THREE.Quaternion().fromArray(converted.tracks[0].values, 0);
  const second = new THREE.Quaternion().fromArray(converted.tracks[0].values, 4);
  const expected = to.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5));
  assert.ok(first.angleTo(to.quaternion) < 0.001);
  assert.ok(second.angleTo(expected) < 0.001);
});


test('foot contact correction is bounded and returns to neutral at rest', () => {
  assert.equal(footContactOffset(0.15), 0);
  assert.ok(footContactOffset(0.3) < 0);
  assert.equal(footContactOffset(5), -0.25);
  assert.equal(footContactOffset(-1), 0.1);
});

test('arm swing follows the blended legs and settles at idle', () => {
  const leftLegForward = strideFromLegs(0.6, -0.3, 1);
  const rightLegForward = strideFromLegs(-0.3, 0.6, 1);
  assert.ok(leftLegForward > 0);
  assert.equal(leftLegForward, -rightLegForward);
  assert.equal(strideFromLegs(0.6, -0.3, 0), 0);
  assert.equal(strideFromLegs(5, -5, 1), 0.65);
});

test('walking retains the character arm pose while preserving leg animation', () => {
  const arm = new THREE.QuaternionKeyframeTrack('RightArm.quaternion', [0, 1], [0, 0, 0, 1, 0.5, 0, 0, 0.866]);
  const leg = new THREE.QuaternionKeyframeTrack('RightLeg.quaternion', [0, 1], [0, 0, 0, 1, 0.2, 0, 0, 0.98]);
  const idleArm = new THREE.QuaternionKeyframeTrack('RightArm.quaternion', [0, 1], [0, 0.3, 0, 0.954, 0, 0.4, 0, 0.916]);
  const result = preserveArmPose(new THREE.AnimationClip('Walk', 1, [arm, leg]), new THREE.AnimationClip('Idle', 1, [idleArm]));
  assert.deepEqual(Array.from(result.tracks.find((track) => track.name === 'RightArm.quaternion').values), Array.from(idleArm.values.slice(0, 4)));
  assert.equal(result.tracks.find((track) => track.name === 'RightLeg.quaternion'), leg);
  assert.equal(arm.times.length, 2);
});

test('arm direction correction respects the rotated shoulder frame', async () => {
  const { CharacterAsset } = await import('../src/player/CharacterAsset.js');
  const root = new THREE.Group();
  const shoulder = new THREE.Group();
  shoulder.rotation.set(0.5, -0.7, 0.2);
  const arm = new THREE.Bone();
  arm.rotation.set(-0.4, 0.6, 0.8);
  root.add(shoulder); shoulder.add(arm);
  const asset = Object.create(CharacterAsset.prototype);
  asset.characterRotation = new THREE.Quaternion();
  asset.boneRotation = new THREE.Quaternion();
  asset.parentRotation = new THREE.Quaternion();
  asset.swingRotation = new THREE.Quaternion();
  asset.currentDirection = new THREE.Vector3();
  asset.swingAxis = new THREE.Vector3();
  asset._alignArmBone(arm, new THREE.Vector3(0, -1, 0), 1);
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(arm.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(direction.distanceTo(new THREE.Vector3(0, -1, 0)) < 1e-6);
});

test('skinned action poses blend in and out without corrupting the rig', async () => {
  const { CharacterAsset } = await import('../src/player/CharacterAsset.js');
  const parent = new THREE.Group();
  const target = new THREE.Group();
  const source = new THREE.Group();
  for (const name of ['RightHand', 'RightArm', 'LeftFoot', 'RightFoot']) {
    const bone = new THREE.Bone(); bone.name = name; target.add(bone);
    const rest = new THREE.Object3D(); rest.name = name; source.add(rest);
  }
  const track = new THREE.QuaternionKeyframeTrack('RightArm.quaternion', [0, 3], [0, 0, 0, 1, 0.2, 0, 0, 0.98]);
  const clip = (name) => new THREE.AnimationClip(name, 3, [track.clone()]);
  const asset = new CharacterAsset(parent, new THREE.Group(),
    { scene: target, animations: [clip('Idle_02')] },
    { scene: source, animations: [clip('Walk'), clip('Run')] },
    { scene: source, animations: [clip('jump'), clip('jabR')] });
  for (let i = 0; i < 30; i++) asset.update(1 / 60, { speed: 4, grounded: false, vy: 2 }, 0.6, 0.4);
  assert.ok(asset.actionBlend > 0.9);
  assert.ok(asset.poseAction.getEffectiveWeight() > 0.9);
  assert.ok(asset.castAction.getEffectiveWeight() > 0.5);
  asset.update(1 / 60, { speed: 4, grounded: true, dodging: true, dodgeProgress: 0.5 });
  assert.ok(Math.abs(Math.abs(asset.container.rotation.x) - Math.PI) < 1e-6);
  for (let i = 0; i < 90; i++) asset.update(1 / 60, { speed: 0, grounded: true });
  assert.ok(asset.actionBlend < 0.01);
  assert.ok(Math.abs(asset.container.rotation.x) < 0.01);
  assert.ok(Number.isFinite(asset.staff.position.y));
});

test('bundled action clips load with humanoid rotation tracks', async () => {
  const { readFile } = await import('node:fs/promises');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const bytes = await readFile(new URL('../public/assets/hero/actions.glb', import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const asset = await new GLTFLoader().parseAsync(data, '');
  for (const name of ['jump', 'jabR']) {
    const clip = asset.animations.find((entry) => entry.name === name);
    assert.ok(clip?.tracks.some((track) => track.name === 'RightArm.quaternion'));
    assert.ok(clip.tracks.some((track) => track.name === 'LeftLeg.quaternion'));
  }
});
