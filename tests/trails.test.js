import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAIN_TRAIL, trailWeight } from '../src/world/trails.js';
import { createHeightfield } from '../src/world/heightfield.js';
import { Vegetation } from '../src/world/Vegetation.js';

test('the trail connects the shore, camp and Beacon over walkable ground', () => {
  const hf = createHeightfield();
  for (let i = 1; i < MAIN_TRAIL.length; i++) {
    const a = MAIN_TRAIL[i - 1], b = MAIN_TRAIL[i];
    for (let j = 0; j <= 20; j++) {
      const t = j / 20;
      const x = a[0] * (1 - t) + b[0] * t, z = a[1] * (1 - t) + b[1] * t;
      assert.ok(trailWeight(x, z) > 0.99);
      assert.ok(hf.height(x, z) > 2.6);
      assert.ok(hf.slope(x, z) < 0.2);
    }
  }
  assert.equal(trailWeight(500, 500), 0);
});

test('solid vegetation is kept off the route and grass shrinks on its centre', () => {
  const vegetation = new Vegetation(new THREE.Scene(), { height: () => 10 }, {});
  assert.equal(vegetation._clearOfPOIs(62, 392), false);
  vegetation.grassMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  vegetation.grassOffsets = [{ x: 0, z: 0, r: 1, scale: 1, rot: 0, tiltX: 0, tiltZ: 0, color: new THREE.Color('green') }];
  vegetation._grassTargetCount = 1;
  vegetation._fillGrass({ x: 62, z: 392 });
  const matrix = new THREE.Matrix4();
  vegetation.grassMesh.getMatrixAt(0, matrix);
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  assert.ok(scale.x < 0.001);
});
