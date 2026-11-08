import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionGrid } from '../src/world/CollisionGrid.js';

test('spatial queries include intersecting large, negative-coordinate and boundary props without duplicates', () => {
  const colliders = [
    { x: -0.2, z: -0.2, r: 2 }, { x: 30, z: 0, r: 12 },
    { x: 900, z: 900, r: 1 }, { x: 0, z: 0, r: 1, active: false },
  ];
  const grid = new CollisionGrid(colliders, 10);
  const found = grid.query(10, 0, 10);
  assert.ok(found.includes(colliders[0]));
  assert.ok(found.includes(colliders[1]));
  assert.ok(!found.includes(colliders[2]));
  assert.ok(!found.includes(colliders[3]));
  assert.equal(new Set(found).size, found.length);
  colliders[3].active = true;
  assert.ok(grid.query(0, 0, 1).includes(colliders[3]));
});
