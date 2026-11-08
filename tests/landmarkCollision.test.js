import test from 'node:test';
import assert from 'node:assert/strict';
import { castleWallColliders } from '../src/world/landmarkCollision.js';

const radius = 0.42;
const castle = { x: 1070, z: -810 };
const walls = castleWallColliders(castle);
const blocked = (x, z) => walls.some((c) => Math.hypot(x + castle.x - c.x, z + castle.z - c.z) < c.r + radius);

test('castle walls block the player while the south gate stays clear', () => {
  for (let z = 8; z <= 18; z += 0.25) assert.equal(blocked(0, z), false, `gate at z=${z}`);
  for (let p = -8; p <= 8; p += 0.25) {
    assert.equal(blocked(12, p), true, `east wall at ${p}`);
    assert.equal(blocked(-12, p), true, `west wall at ${p}`);
    assert.equal(blocked(p, -12), true, `north wall at ${p}`);
    if (Math.abs(p) >= 2.25) assert.equal(blocked(p, 12), true, `south wall at ${p}`);
  }
});
