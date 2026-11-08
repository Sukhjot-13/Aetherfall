import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { partitionInstances, countRanksBelow } from '../src/world/instanceChunks.js';
import { Vegetation } from '../src/world/Vegetation.js';

test('spatial tiles preserve transforms, colors and sorted quality ranks', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4);
  mesh.userData.treeRanks = [7, 1, 3, 9];
  const transform = new THREE.Matrix4();
  for (let i = 0; i < 4; i++) {
    transform.makeTranslation(i === 3 ? 650 : i * 10, 2, 0);
    mesh.setMatrixAt(i, transform);
    mesh.setColorAt(i, new THREE.Color(i === 1 ? 'red' : 'white'));
  }
  const chunks = partitionInstances(mesh, 512);
  assert.equal(chunks.length, 2);
  const first = chunks.find((chunk) => chunk.max === 3);
  assert.deepEqual(first.ranks, [1, 3, 7]);
  assert.equal(countRanksBelow(first.ranks, 4), 2);
  first.mesh.getMatrixAt(0, transform);
  assert.equal(new THREE.Vector3().setFromMatrixPosition(transform).x, 10);
  const color = new THREE.Color(); first.mesh.getColorAt(0, color);
  assert.ok(color.r > 0.9 && color.g < 0.1);
  assert.ok(first.mesh.boundingSphere.radius > 0);
});

test('quality changes keep tree geometry and colliders in sync', () => {
  const vegetation = new Vegetation(new THREE.Scene(), {}, {});
  const trunk = { count: 3 };
  const crown = { count: 3 };
  vegetation.treeMeshes = [{ mesh: trunk, ranks: [0, 4, 8] }, { mesh: crown, ranks: [0, 4, 8] }];
  vegetation.colliders = [{ treeRank: 0 }, { treeRank: 4 }, { treeRank: 8 }, { r: 2 }];
  vegetation.setQuality({ id: 'low', treeCount: 5 });
  assert.equal(trunk.count, 2);
  assert.equal(crown.count, 2);
  assert.deepEqual(vegetation.colliders.map((c) => c.active), [true, true, false, undefined]);
  vegetation.setQuality({ id: 'high', treeCount: 10 });
  assert.equal(trunk.count, 3);
  assert.equal(crown.count, 3);
  assert.equal(vegetation.colliders[2].active, true);
});

test('disabled tree colliders do not create invisible obstacles', async () => {
  const { Player } = await import('../src/player/Player.js');
  const player = Object.create(Player.prototype);
  player.position = new THREE.Vector3(0.2, 0, 0);
  player.radius = 0.42;
  player.world = { colliders: [{ x: 0, z: 0, r: 1, active: false }] };
  player._resolveColliders();
  assert.equal(player.position.x, 0.2);
  player.world.colliders[0].active = true;
  player._resolveColliders();
  assert.ok(player.position.x > 1.4);
});
