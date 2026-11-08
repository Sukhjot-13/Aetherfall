import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/Input.js';

test('pointer lock rejection falls back safely when an embedded browser denies both requests', async () => {
  let calls = 0;
  const input = { locked: false, canvas: { requestPointerLock() { calls++; return Promise.reject(new Error('denied')); } } };
  await assert.doesNotReject(Input.prototype.requestLock.call(input));
  assert.equal(calls, 2);
});
