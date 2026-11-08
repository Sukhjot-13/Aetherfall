import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain } from '../src/world/Terrain.js';

test('initial terrain build yields between sampling batches and finishes both surfaces', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  }) }) };
  try {
    const terrain = new Terrain(new THREE.Scene(), { height: () => 10, slope: () => 0 }, {});
    const advance = terrain._advanceInnerBuild.bind(terrain);
    let delayed = false;
    terrain._advanceInnerBuild = (budget) => {
      advance(budget);
      if (!delayed) {
        delayed = true;
        const until = performance.now() + 9;
        while (performance.now() < until) {} // force a budget overrun once
      }
    };
    let yields = 0;
    await terrain.build(4, async () => { yields++; });
    assert.ok(yields > 0);
    assert.ok(terrain.mesh && terrain.innerMesh);
    assert.equal(terrain._pendingInner, null);
  } finally {
    globalThis.document = oldDocument;
  }
});

test('local terrain cutout follows the rebuilt detail chunk', () => {
  const scene = new THREE.Scene();
  const hf = { height: () => 10, slope: () => 0 };
  const terrain = new Terrain(scene, hf, {});
  terrain._innerSize = 80;
  terrain._innerSegments = 4;
  terrain._buildInner(12, -7);
  assert.deepEqual(terrain._innerCenterUniform.value.toArray(), [12, -7]);
  assert.equal(terrain._innerHalfUniform.value, 28);
  const first = terrain.innerMesh;
  terrain._buildInner(-45, 32);
  assert.deepEqual(terrain._innerCenterUniform.value.toArray(), [-45, 32]);
  assert.equal(scene.children.includes(first), false);
  assert.equal(scene.children.includes(terrain.innerMesh), true);
});

test('terrain recentering keeps the old chunk and cutout until the replacement is complete', () => {
  const scene = new THREE.Scene();
  const hf = { height: (x) => x * 0.01 + 10, slope: () => 0 };
  const terrain = new Terrain(scene, hf, {});
  terrain._innerSize = 80;
  terrain._innerSegments = 4;
  terrain._buildInner(0, 0);
  const old = terrain.innerMesh;
  terrain._startInnerBuild(40, 10);
  terrain._advanceInnerBuild(3);
  assert.equal(terrain.innerMesh, old);
  assert.deepEqual(terrain._innerCenterUniform.value.toArray(), [0, 0]);
  assert.equal(terrain._pendingInner.index, 3);
  terrain._advanceInnerBuild(Infinity);
  assert.notEqual(terrain.innerMesh, old);
  assert.deepEqual(terrain._innerCenterUniform.value.toArray(), [40, 10]);
  assert.equal(terrain._pendingInner, null);
});

test('a second teleport replaces obsolete terrain work', () => {
  const terrain = new Terrain(new THREE.Scene(), { height: () => 4, slope: () => 0 }, {});
  terrain._innerSize = 80;
  terrain._innerSegments = 20;
  terrain._buildInner(0, 0);
  terrain.update(new THREE.Vector3(40, 0, 0));
  assert.equal(terrain._pendingInner.cx, 40);
  terrain.update(new THREE.Vector3(100, 0, 0));
  assert.equal(terrain._pendingInner.cx, 100);
  terrain.update(new THREE.Vector3(100, 0, 0));
  assert.deepEqual(terrain._innerCenterUniform.value.toArray(), [100, 0]);
});
