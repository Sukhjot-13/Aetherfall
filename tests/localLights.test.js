import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LocalLights } from '../src/world/LocalLights.js';

test('landmark lighting follows nearby enabled sources with a fixed budget', () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const lights = [0, 10, 100].map((x, i) => {
    const light = new THREE.PointLight(i === 1 ? 'red' : 'white', i + 1, 20, 2);
    light.position.x = x;
    root.add(light);
    return light;
  });
  const local = new LocalLights(scene, root, 2);
  assert.equal(local.sources.length, 3);
  assert.ok(lights.every((light) => !light.layers.test(new THREE.Layers())));
  local.update(new THREE.Vector3(0, 0, 0));
  assert.deepEqual(local.pool.map((light) => light.intensity), [1, 2]);
  lights[0].visible = false;
  lights[1].intensity = 4;
  local.update(new THREE.Vector3(0, 0, 0));
  assert.deepEqual(local.pool.map((light) => light.intensity), [4, 0]);
  local.update(new THREE.Vector3(100, 0, 0));
  assert.equal(local.pool[0].position.x, 100);
  assert.equal(local.pool[0].intensity, 3);
  assert.equal(local.pool[1].intensity, 0);
});
