import test from 'node:test';
import assert from 'node:assert/strict';

import { createHeightfield } from '../src/world/heightfield.js';
import { LOCATIONS, WORLD } from '../src/world/locations.js';

const hf = createHeightfield();

test('heightfield is deterministic', () => {
  assert.equal(hf.height(12.5, -44.25), createHeightfield().height(12.5, -44.25));
});

test('spawn clearing is a level meadow just above the shore', () => {
  const h = hf.height(LOCATIONS.spawn.x, LOCATIONS.spawn.z);
  // The spawn is deliberately a gentle grass shelf, not wet sand: the player
  // should open the game standing in grass with the sea a short walk behind.
  assert.ok(h > 4 && h < 20, `spawn height ${h}`);
  assert.ok(hf.slope(LOCATIONS.spawn.x, LOCATIONS.spawn.z) < 0.05);
  assert.equal(hf.biome(LOCATIONS.spawn.x, LOCATIONS.spawn.z), 'grass');
  // Ocean is still within sight, so "Wayfarer's Shore" remains accurate.
  assert.ok(hf.height(LOCATIONS.spawn.x, LOCATIONS.spawn.z + 60) < 1);
});

test('ocean is below the water line', () => {
  assert.ok(hf.height(0, 900) < -5);
  assert.equal(hf.biome(0, 900), 'water');
  assert.equal(hf.isLand(0, 900), false);
});

test('points of interest are level enough to build on', () => {
  for (const loc of [LOCATIONS.camp, LOCATIONS.temple, ...LOCATIONS.shards]) {
    assert.ok(hf.slope(loc.x, loc.z) < 0.05, `${loc.id} slope ${hf.slope(loc.x, loc.z)}`);
    assert.ok(hf.height(loc.x, loc.z) > 0, `${loc.id} should be on land`);
  }
});

test('the north holds the highest ground', () => {
  assert.ok(hf.height(LOCATIONS.temple.x, LOCATIONS.temple.z) > hf.height(LOCATIONS.camp.x, LOCATIONS.camp.z));
  assert.ok(hf.height(LOCATIONS.shards[2].x, LOCATIONS.shards[2].z) > 40);
});

test('normals are unit length and point up on flat ground', () => {
  const n = hf.normal(LOCATIONS.camp.x, LOCATIONS.camp.z);
  assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-6);
  assert.ok(n.y > 0.98);
});

test('biomes cover the expected range', () => {
  const seen = new Set();
  for (let x = -600; x <= 600; x += 17) {
    for (let z = -600; z <= 600; z += 17) seen.add(hf.biome(x, z));
  }
  assert.ok(seen.has('water'));
  assert.ok(seen.has('sand'));
  assert.ok(seen.has('grass'));
});

test('world constants are sane', () => {
  assert.equal(WORLD.waterLevel, 0);
  assert.ok(WORLD.size > WORLD.islandRadius * 2);
});
