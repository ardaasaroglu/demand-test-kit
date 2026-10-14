import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createSpeedBump, SIGNUP_LIMIT, SIGNUP_WINDOW_MS } from '../src/app.js';

const WINDOW = SIGNUP_WINDOW_MS;

describe('the sign-up speed bump', () => {
  test(`allows ${SIGNUP_LIMIT} sign-ups per address in the window, then stops the next`, () => {
    const bump = createSpeedBump();
    for (let i = 0; i < SIGNUP_LIMIT; i++) assert.equal(bump.hit('a', 1000 + i), false);
    assert.equal(bump.hit('a', 2000), true);
    assert.equal(bump.hit('b', 2000), false, 'another address is not affected');
  });

  test('allows the address again once its oldest sign-up leaves the window', () => {
    const bump = createSpeedBump(2, WINDOW);
    assert.equal(bump.hit('a', 0), false);
    assert.equal(bump.hit('a', 10), false);
    assert.equal(bump.hit('a', 20), true);
    assert.equal(bump.hit('a', WINDOW - 1), true, 'still inside the window');
    assert.equal(bump.hit('a', WINDOW), false, 'the first sign-up has left the window');
  });

  test('forgets an address once its last sign-up is older than the window', () => {
    const bump = createSpeedBump();
    bump.hit('a', 0);
    bump.hit('b', 60_000);
    assert.equal(bump.size, 2);
    bump.hit('c', WINDOW + 30_000);
    assert.equal(bump.size, 2, 'a is dropped, b is still inside its window');
    bump.hit('d', 2 * WINDOW + 30_000);
    assert.equal(bump.size, 1, 'b and c are dropped');
  });

  test('a blocked attempt does not keep an address in memory longer', () => {
    const bump = createSpeedBump(1, WINDOW);
    bump.hit('a', 0);
    assert.equal(bump.hit('a', WINDOW - 1), true);
    bump.hit('b', WINDOW);
    assert.equal(bump.size, 1, 'a is dropped one window after its last accepted sign-up');
  });
});
