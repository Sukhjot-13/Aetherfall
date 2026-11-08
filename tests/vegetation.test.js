import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vegetation, sampleIslandScatter } from '../src/world/Vegetation.js';
import { createRng } from '../src/util/rng.js';
import { WORLD } from '../src/world/locations.js';

test('scenery is concentrated near the journey while remaining spread across the frontier', () => {
  const rng = createRng(9173);
  let core = 0, frontier = 0;
  for (let i = 0; i < 10000; i++) {
    const { x, z } = sampleIslandScatter(rng);
    const radius = Math.hypot(x, z);
    if (radius < 1100) core++;
    if (radius > 1800) frontier++;
    assert.ok(radius <= WORLD.islandRadius * 0.94);
  }
  assert.ok(core > 7000 && core < 7700);
  assert.ok(frontier > 1700);
});

test('grass refill snapshots the centre and shares terrain samples across slices', () => {
  let samples = 0;
  const hf = { height: () => { samples++; return 5; } };
  const vegetation = new Vegetation(new THREE.Scene(), hf, {});
  vegetation.grassMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1024);
  vegetation.grassOffsets = Array.from({ length: 1024 }, () => ({
    x: 0.25, z: 0.25, r: 1, scale: 1, rot: 0, tiltX: 0, tiltZ: 0,
    color: new THREE.Color('green'),
  }));
  vegetation._grassTargetCount = 1024;
  vegetation._flowerTint = () => null;
  const center = new THREE.Vector3(10, 0, 20);
  vegetation._fillGrass(center);
  assert.ok(vegetation._grassQueue, 'refill should be sliced');
  center.set(100, 0, 200);
  vegetation._fillGrassChunk();
  assert.equal(vegetation._grassQueue, null);
  assert.equal(samples, 4, 'all tufts in the same cell reuse its four heights');
  const matrix = new THREE.Matrix4();
  vegetation.grassMesh.getMatrixAt(1023, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.ok(Math.abs(position.x - 10.25) < 1e-5);
  assert.ok(Math.abs(position.z - 20.25) < 1e-5);
  assert.equal(position.y, 5);
});

test('increasing grass quality fills new instances before showing them', () => {
  const vegetation = new Vegetation(new THREE.Scene(), { height: () => 5 }, {});
  vegetation.grassMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1024);
  vegetation.grassMesh.count = 512;
  vegetation.grassOffsets = Array.from({ length: 1024 }, () => ({
    x: 0, z: 0, r: 1, scale: 1, rot: 0, tiltX: 0, tiltZ: 0, color: new THREE.Color('green'),
  }));
  vegetation._grassTargetCount = 512;
  vegetation.grassCenter = { x: 5, z: 7 };
  vegetation._flowerTint = () => null;
  vegetation.setQuality({ id: 'high', treeCount: 0, grassCount: 1024 });
  assert.equal(vegetation.grassMesh.count, 512);
  assert.ok(vegetation._grassQueue);
  vegetation._fillGrassChunk();
  assert.equal(vegetation.grassMesh.count, 1024);
  assert.equal(vegetation._grassQueue, null);
  const matrix = new THREE.Matrix4();
  vegetation.grassMesh.getMatrixAt(1023, matrix);
  assert.equal(new THREE.Vector3().setFromMatrixPosition(matrix).x, 5);
});
