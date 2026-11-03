import test from 'node:test';
import assert from 'node:assert/strict';

import { fbm2, hash2, ridged2, valueNoise2 } from '../src/util/noise.js';

test('hash2 is deterministic and inside [0,1)', () => {
  for (let i = 0; i < 100; i++) {
    const v = hash2(i, i * 7, 42);
    assert.equal(v, hash2(i, i * 7, 42));
    assert.ok(v >= 0 && v < 1, `hash out of range: ${v}`);
  }
});

test('value noise is smooth and bounded', () => {
  let prev = valueNoise2(0, 0, 3);
  for (let x = 0; x < 40; x += 0.1) {
    const v = valueNoise2(x, 0.5, 3);
    assert.ok(v >= 0 && v <= 1);
    assert.ok(Math.abs(v - prev) < 0.35, 'neighbouring samples should not jump');
    prev = v;
  }
});

test('fbm2 is deterministic and roughly bounded', () => {
  for (let i = 0; i < 50; i++) {
    const a = fbm2(i * 0.13, i * 0.71, 5, 9);
    const b = fbm2(i * 0.13, i * 0.71, 5, 9);
    assert.equal(a, b);
    assert.ok(a >= -1.05 && a <= 1.05, `fbm out of range: ${a}`);
  }
});

test('ridged2 is in [0,1] and deterministic', () => {
  for (let i = 0; i < 50; i++) {
    const a = ridged2(i * 0.21, i * 0.37, 4, 5);
    assert.equal(a, ridged2(i * 0.21, i * 0.37, 4, 5));
    assert.ok(a >= 0 && a <= 1);
  }
});

test('different seeds produce different fields', () => {
  assert.notEqual(fbm2(1.7, 2.3, 4, 1), fbm2(1.7, 2.3, 4, 2));
});
