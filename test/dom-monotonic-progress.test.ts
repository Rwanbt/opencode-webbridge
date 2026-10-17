import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { monotonicDelta } from '../src/testing/local-browser-companion.js';

test('browser DOM changes must be strictly append-only before terminal state', () => {
  assert.equal(monotonicDelta('', 'hello'), 'hello');
  assert.equal(monotonicDelta('hello', 'hello world'), ' world');
  for (const text of ['', 'hel', 'HELLO world', 'x'.repeat(16_101)]) {
    assert.throws(() => monotonicDelta('hello', text), /non-monotonic/);
  }
  assert.throws(() => monotonicDelta('hello', 'hello'), /non-monotonic/);
});
