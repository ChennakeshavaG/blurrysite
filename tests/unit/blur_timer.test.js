/**
 * tests/unit/blur_timer.test.js
 *
 * Unit tests for src/blur_timer.js
 * Module exposes blsi.BlurTimer with:
 *   start, stop, getRemaining, isActive
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/blur_timer.js');

function freshLoad() {
  delete blsi.BlurTimer;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

describe('blur_timer.js', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    freshLoad();
  });

  afterEach(() => {
    blsi.BlurTimer.stop();
    jest.useRealTimers();
  });

  test('isActive() returns false initially', () => {
    expect(blsi.BlurTimer.isActive()).toBe(false);
  });

  test('start() makes isActive true', () => {
    blsi.BlurTimer.start(5, jest.fn());
    expect(blsi.BlurTimer.isActive()).toBe(true);
  });

  test('stop() cancels the timer', () => {
    const cb = jest.fn();
    blsi.BlurTimer.start(5, cb);
    blsi.BlurTimer.stop();
    expect(blsi.BlurTimer.isActive()).toBe(false);
    jest.advanceTimersByTime(6 * 60 * 1000);
    expect(cb).not.toHaveBeenCalled();
  });

  test('timer fires onExpire callback after duration', () => {
    const cb = jest.fn();
    blsi.BlurTimer.start(1, cb); // 1 minute
    expect(cb).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60 * 1000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(blsi.BlurTimer.isActive()).toBe(false);
  });

  test('getRemaining() returns approximate seconds left', () => {
    blsi.BlurTimer.start(5, jest.fn()); // 5 minutes
    // Immediately after start, should be close to 300 seconds
    const remaining = blsi.BlurTimer.getRemaining();
    expect(remaining).toBeGreaterThan(298);
    expect(remaining).toBeLessThanOrEqual(300);
  });

  test('getRemaining() returns 0 when no timer active', () => {
    expect(blsi.BlurTimer.getRemaining()).toBe(0);
  });

  test('start() with invalid minutes does nothing', () => {
    blsi.BlurTimer.start(0, jest.fn());
    expect(blsi.BlurTimer.isActive()).toBe(false);
    blsi.BlurTimer.start(-5, jest.fn());
    expect(blsi.BlurTimer.isActive()).toBe(false);
  });

  test('start() replaces existing timer', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    blsi.BlurTimer.start(5, cb1);
    blsi.BlurTimer.start(1, cb2);
    jest.advanceTimersByTime(60 * 1000);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb1).not.toHaveBeenCalled();
  });
});
