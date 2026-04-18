/**
 * tests/unit/blur_timer.test.js
 *
 * Unit tests for src/blur_timer.js
 * Module exposes blsi.BlurTimer with:
 *   start, stop, getRemaining, isActive
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: isActive() initial false state; start() activates timer; stop() cancels timer
 *         and prevents callback; timer fires onExpire after full duration; getRemaining()
 *         near start; getRemaining() when inactive returns 0; invalid minutes (0, negative)
 *         rejected silently; start() replaces an existing timer.
 *
 * REDUNDANT TESTS:
 *   - "start() makes isActive true" and "timer fires onExpire callback after duration" both
 *     call start() with nearly identical setup; the active check in the first test could be
 *     folded into the second as an additional assertion, removing the separate test.
 *   - "getRemaining() returns 0 when no timer active" and the inactive isActive check in
 *     "isActive() returns false initially" both probe the zero/inactive state; they overlap
 *     in what they cover about the pre-start condition.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - "start() with invalid minutes does nothing" tests start(0) and start(-5) inline;
 *     could use test.each([0, -5, -100]) to make the invalid-input set explicit and
 *     extensible without touching assertion logic.
 *
 * MISSING COVERAGE:
 *   - No test for getRemaining() during countdown: advance 1 second, verify remaining
 *     decremented by approximately 1 (i.e. getRemaining() returns ~299 after 1s of a 5m timer).
 *   - No test for getRemaining() after timer expires: should return 0 once onExpire fires.
 *   - No test for the clamped maximum input (480 minutes per source): start(481) should either
 *     be clamped to 480 or rejected; contract is unverified.
 *   - No test for float input: start(1.5) — source likely truncates, but behavior is unspecified.
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/blur_timer.js');

function freshLoad() {
  delete blsi.BlurTimer;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

// USER IMPACT: user sets timed blur — page auto-unblurs after the chosen duration, giving a hands-free reveal without user having to manually disable blur
describe('blur_timer.js', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    freshLoad();
  });

  afterEach(() => {
    blsi.BlurTimer.stop();
    jest.useRealTimers();
  });

  // USER IMPACT: timer UI shows correct initial state — no active timer on load
  test('isActive() returns false initially', () => {
    expect(blsi.BlurTimer.isActive()).toBe(false);
  });

  // USER IMPACT: user sets timed blur — timer activates and page will auto-unblur after duration
  // REDUNDANT: isActive check here is also verified as a side-effect in "timer fires onExpire callback after duration"; could fold into that test
  test('start() makes isActive true', () => {
    blsi.BlurTimer.start(5, jest.fn());
    expect(blsi.BlurTimer.isActive()).toBe(true);
  });

  // USER IMPACT: user cancels timed blur — callback never fires, no unexpected unblur
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

  // USER IMPACT: UI shows countdown — user sees accurate time-to-unblur immediately after starting
  test('getRemaining() returns approximate seconds left', () => {
    blsi.BlurTimer.start(5, jest.fn()); // 5 minutes
    // Immediately after start, should be close to 300 seconds
    const remaining = blsi.BlurTimer.getRemaining();
    expect(remaining).toBeGreaterThan(298);
    expect(remaining).toBeLessThanOrEqual(300);
  });

  // REDUNDANT: zero/inactive state partially overlaps with "isActive() returns false initially"; both probe the pre-start condition
  test('getRemaining() returns 0 when no timer active', () => {
    expect(blsi.BlurTimer.getRemaining()).toBe(0);
  });

  // USER IMPACT: invalid input (0 minutes, negative) — silently ignored, no broken timer state
  // OPTIMIZE: inline start(0) and start(-5) checks could be expressed as test.each([0, -5, -100]) to make the invalid-input boundary explicit
  test('start() with invalid minutes does nothing', () => {
    blsi.BlurTimer.start(0, jest.fn());
    expect(blsi.BlurTimer.isActive()).toBe(false);
    blsi.BlurTimer.start(-5, jest.fn());
    expect(blsi.BlurTimer.isActive()).toBe(false);
  });

  // USER IMPACT: user changes duration mid-session — new timer replaces old one cleanly, first callback never fires
  test('start() replaces existing timer', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    blsi.BlurTimer.start(5, cb1);
    blsi.BlurTimer.start(1, cb2);
    jest.advanceTimersByTime(60 * 1000);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb1).not.toHaveBeenCalled();
  });

  // MISSING: no test for getRemaining() during countdown — advance 1s, verify remaining decremented by ~1 second
  // MISSING: no test for getRemaining() after timer expires — should return 0 once onExpire has fired
  // MISSING: no test for maximum input clamping (start(481) if source caps at 480 minutes)
  // MISSING: no test for float input — start(1.5) behavior (truncation vs rejection) is unspecified
});
