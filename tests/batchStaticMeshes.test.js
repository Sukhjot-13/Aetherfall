import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStaticMeshes } from '../src/world/batchStaticMeshes.js';

test('static siblings are merged in parent space without absorbing dynamic objects', () => {
  const root = new THREE.Group(), landmark = new THREE.Group();
  root.add(landmark); landmark.position.set(100, 4, -20); landmark.rotation.y = 0.4;
  const material = new THREE.MeshStandardMaterial();
  const meshes = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.userData.staticStructure = true;
    mesh.position.set(i * 2, 0, 0);
    landmark.add(mesh); meshes.push(mesh);
  }
  const dynamic = meshes[3];
  const saved = batchStaticMeshes(root, new Set([dynamic]));
  assert.equal(saved, 2);
  assert.equal(landmark.children.length, 2);
  assert.equal(dynamic.parent, landmark);
  const merged = landmark.children.find((object) => object !== dynamic);
  assert.equal(merged.material, material);
  merged.geometry.computeBoundingBox();
  assert.ok(Math.abs(merged.geometry.boundingBox.min.x + 0.5) < 1e-6);
  assert.ok(Math.abs(merged.geometry.boundingBox.max.x - 4.5) < 1e-6);
  root.updateMatrixWorld(true);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(merged.matrixWorld).distanceTo(landmark.position) < 1e-6);
});

test('batching preserves visibility, material and shadow boundaries', () => {
  const root = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    mesh.userData.staticStructure = true;
    mesh.castShadow = i === 0;
    root.add(mesh);
  }
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), material);
  hidden.userData.staticStructure = true; hidden.visible = false; root.add(hidden);
  assert.equal(batchStaticMeshes(root), 0);
  assert.equal(root.children.length, 4);
});
