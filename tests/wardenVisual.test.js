import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WardenVisual } from '../src/gameplay/WardenVisual.js';

test('Wardens share geometry but have independent skeletons and hit-flash materials', () => {
  const target = new THREE.Group();
  const bone = new THREE.Bone(); bone.name = 'RightArm'; target.add(bone);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); target.add(mesh);
  const source = new THREE.Group(); const rest = new THREE.Object3D(); rest.name = 'RightArm'; source.add(rest);
  const track = new THREE.QuaternionKeyframeTrack('RightArm.quaternion', [0, 1], [0, 0, 0, 1, 0.2, 0, 0, 0.98]);
  const motion = { scene: source, animations: [new THREE.AnimationClip('Walk', 1, [track])] };
  const a = new WardenVisual({ scene: target }, motion);
  const b = new WardenVisual({ scene: target }, motion);
  assert.notEqual(a.model.getObjectByName('RightArm'), b.model.getObjectByName('RightArm'));
  assert.notEqual(a.materials[0], b.materials[0]);
  assert.equal(a.model.children.find((o) => o.isMesh).geometry, b.model.children.find((o) => o.isMesh).geometry);
  a.materials[0].emissiveIntensity = 5;
  assert.notEqual(a.materials[0].emissiveIntensity, b.materials[0].emissiveIntensity);
  a.update(0.1, { body: { position: new THREE.Vector3(), rotation: new THREE.Euler() }, moveBlend: 0.8 });
  assert.ok(a.walk.getEffectiveWeight() > 0);
  a.dispose(); b.dispose();
});

test('Warden arms rest down, telegraph attacks and settle back after striking', () => {
  const target = new THREE.Group(), source = new THREE.Group();
  for (const side of ['Left', 'Right']) {
    const arm = new THREE.Bone(); arm.name = `${side}Arm`; target.add(arm);
    const forearm = new THREE.Bone(); forearm.name = `${side}ForeArm`; arm.add(forearm);
    const from = new THREE.Object3D(); from.name = `${side}Arm`; source.add(from);
  }
  const track = new THREE.QuaternionKeyframeTrack('RightArm.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
  const warden = new WardenVisual({ scene: target }, { scene: source, animations: [new THREE.AnimationClip('Walk', 1, [track])] });
  const body = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
  const direction = (name) => {
    const bone = warden.model.getObjectByName(name);
    return new THREE.Vector3(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
      .applyQuaternion(warden.facing.getWorldQuaternion(new THREE.Quaternion()).invert());
  };
  for (let i = 0; i < 60; i++) warden.update(1 / 60, { body, moveBlend: 0 });
  assert.ok(direction('RightArm').y < -0.9);
  for (let i = 0; i < 60; i++) warden.update(1 / 60, { body, moveBlend: 0, windup: 0.3, windupKind: 'nova' });
  assert.ok(direction('RightArm').y > 0.35);
  assert.ok(direction('LeftArm').y > 0.35);
  for (let i = 0; i < 60; i++) warden.update(1 / 60, { body, moveBlend: 0 });
  assert.ok(direction('RightArm').y < -0.9);
  warden.dispose();
});
