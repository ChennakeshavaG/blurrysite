/**
 * tests/unit/auto_blur.test.js
 *
 * Unit tests for src/auto_blur.js
 * Module exposes blsi.AutoBlur with:
 *   init, destroy, isIdle
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: idle timeout triggering onIdle; activity resetting the idle timer; onActive
 *         callback on user activity after idle; tab visibility change triggering
 *         onIdle/onActive; destroy() removing listeners; double init() replacing
 *         previous callbacks; mode isolation (idle-only vs tab-switch-only).
 *
 * REDUNDANT TESTS:
 *   - "idle detection triggers onIdle after timeout" and "user activity after idle triggers
 *     onActive" both set up the same idle timer with identical init() arguments; they could
 *     share a beforeEach or be merged with extra assertions in one test.
 *   - "tab switch triggers onIdle when hidden" and "tab becoming visible triggers onActive"
 *     are complementary visibility state tests with near-identical setup; merging into one
 *     test with sequential hide/show assertions would eliminate duplicated Object.defineProperty
 *     boilerplate.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Tests 4-5 (visibility tests) repeat the same Object.defineProperty(document,'hidden',...)
 *     pattern twice each; extract a local setHiddenState(value) helper to reduce repetition.
 *   - Activity event type coverage could use test.each(['mousemove','keydown','scroll',
 *     'touchstart']) if those are all the events the module listens to.
 *
 * MISSING COVERAGE:
 *   - No test for all activity event types: only mousemove is exercised; keydown, scroll,
 *     and touchstart are not verified to reset the idle timer.
 *   - No test for double destroy() call — should be safe and not throw.
 *   - No test for init() with missing onIdle or onActive callbacks — module should not crash
 *     if callbacks are omitted.
 *   - No test for edge-case idleTimeout values: 0 or Infinity — should either be rejected
 *     or handled gracefully without broken timer state.
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/auto_blur.js');

function freshLoad() {
  delete blsi.AutoBlur;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

// USER IMPACT: user enables auto-blur — page blurs automatically when user is idle or switches tabs, protecting data from wandering eyes during screen sharing
describe('auto_blur.js', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    freshLoad();
  });

  afterEach(() => {
    blsi.AutoBlur.destroy();
    jest.useRealTimers();
  });

  test('isIdle() returns false initially', () => {
    expect(blsi.AutoBlur.isIdle()).toBe(false);
  });

  // USER IMPACT: user leaves desk — page auto-blurs after idle timeout to protect data from wandering eyes
  // REDUNDANT: shares identical init() arguments with "user activity after idle triggers onActive"; could merge with extra assertions
  test('idle detection triggers onIdle after timeout', () => {
    const onIdle = jest.fn();
    const onActive = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 10, idle: true, tabSwitch: false, onIdle, onActive });

    jest.advanceTimersByTime(10 * 1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(blsi.AutoBlur.isIdle()).toBe(true);
  });

  test('user activity resets idle timer', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 10, idle: true, tabSwitch: false, onIdle, onActive: jest.fn() });

    jest.advanceTimersByTime(5 * 1000);
    document.dispatchEvent(new Event('mousemove'));
    jest.advanceTimersByTime(5 * 1000);
    expect(onIdle).not.toHaveBeenCalled(); // timer was reset
    jest.advanceTimersByTime(5 * 1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  // REDUNDANT: same idle timer setup as "idle detection triggers onIdle after timeout"; could be merged as additional assertions in that test
  test('user activity after idle triggers onActive', () => {
    const onActive = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 5, idle: true, tabSwitch: false, onIdle: jest.fn(), onActive });

    jest.advanceTimersByTime(5 * 1000);
    expect(blsi.AutoBlur.isIdle()).toBe(true);

    document.dispatchEvent(new Event('mousemove'));
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(blsi.AutoBlur.isIdle()).toBe(false);
  });

  // USER IMPACT: user alt-tabs during screen share — page blurs after tab is hidden for >150ms
  // REDUNDANT: complementary to "tab becoming visible triggers onActive"; both use identical Object.defineProperty setup; could merge into one test asserting both states
  // OPTIMIZE: extract setHiddenState(value) helper to avoid repeating Object.defineProperty(document,'hidden',...) in both visibility tests
  test('tab switch triggers onIdle when hidden', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle, onActive: jest.fn() });

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // onIdle fires after the 150ms debounce (not immediately)
    jest.advanceTimersByTime(150);
    expect(onIdle).toHaveBeenCalledTimes(1);

    // Restore
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  // REDUNDANT: complementary to "tab switch triggers onIdle when hidden"; both share the same Object.defineProperty visibility setup
  test('tab becoming visible triggers onActive', () => {
    const onActive = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle: jest.fn(), onActive });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // Let the 150ms debounce fire so _isIdle becomes true
    jest.advanceTimersByTime(150);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onActive).toHaveBeenCalledTimes(1);
  });

  // USER IMPACT: user drags a tab to create a new window — blur must NOT change (brief hide→show is not a tab switch)
  test('brief hide-then-show (tab drag to new window) does not trigger callbacks', () => {
    const onIdle = jest.fn();
    const onActive = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle, onActive });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // Visible fires before the 150ms debounce elapses (simulates window drag ~10ms)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(200); // flush any pending timers
    expect(onIdle).not.toHaveBeenCalled();
    expect(onActive).not.toHaveBeenCalled();
  });

  // ── window.blur / window.focus (alt-tab to other window/app) ──────────────

  function setHasFocus(value) {
    Object.defineProperty(document, 'hasFocus', { value: () => value, configurable: true });
  }

  // USER IMPACT: user alt-tabs to another browser window or external app — page blurs after 250ms even though visibilitychange did not fire
  test('window.blur triggers onIdle({reason:tab_switch}) after 250ms when focus stays away', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle, onActive: jest.fn() });

    setHasFocus(false);
    window.dispatchEvent(new Event('blur'));
    jest.advanceTimersByTime(249);
    expect(onIdle).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith({ reason: 'tab_switch' });
    expect(blsi.AutoBlur.isIdle()).toBe(true);

    setHasFocus(true);
  });

  // USER IMPACT: user clicks browser URL bar then back to page — focus returns within 250ms, page must NOT blur
  test('window.focus before 250ms cancels pending blur — no callbacks fire', () => {
    const onIdle = jest.fn();
    const onActive = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle, onActive });

    setHasFocus(false);
    window.dispatchEvent(new Event('blur'));
    jest.advanceTimersByTime(100);
    setHasFocus(true);
    window.dispatchEvent(new Event('focus'));
    jest.advanceTimersByTime(300);

    expect(onIdle).not.toHaveBeenCalled();
    expect(onActive).not.toHaveBeenCalled();
  });

  // USER IMPACT: user returns from another window after a real blur fired — page unblurs cleanly
  test('window.focus after sustained blur fires onActive', () => {
    const onIdle = jest.fn();
    const onActive = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle, onActive });

    setHasFocus(false);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    window.dispatchEvent(new Event('blur'));
    jest.advanceTimersByTime(250);
    expect(onIdle).toHaveBeenCalledTimes(1);

    setHasFocus(true);
    window.dispatchEvent(new Event('focus'));
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(blsi.AutoBlur.isIdle()).toBe(false);
  });

  // USER IMPACT: same-window tab switch — visibilitychange and window.blur both fire, but onIdle must fire only once
  test('visibilitychange + window.blur dedupe via _isIdle mutex', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle, onActive: jest.fn() });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    setHasFocus(false);
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(150);
    expect(onIdle).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('blur'));
    jest.advanceTimersByTime(250);
    expect(onIdle).toHaveBeenCalledTimes(1); // still 1 — not double-fired

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    setHasFocus(true);
  });

  // USER IMPACT: user disables tab-switch trigger — window.blur listener removed, no stale fires
  test('destroy removes window.blur and window.focus listeners', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle, onActive: jest.fn() });

    blsi.AutoBlur.destroy();
    setHasFocus(false);
    window.dispatchEvent(new Event('blur'));
    jest.advanceTimersByTime(250);
    expect(onIdle).not.toHaveBeenCalled();

    setHasFocus(true);
  });

  // USER IMPACT: user enables idle-only mode — window blur events must not trigger blur (mode isolation)
  test('idle-only mode does not respond to window.blur', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: true, tabSwitch: false, onIdle, onActive: jest.fn() });

    setHasFocus(false);
    window.dispatchEvent(new Event('blur'));
    jest.advanceTimersByTime(250);
    expect(onIdle).not.toHaveBeenCalled();

    setHasFocus(true);
  });

  // ──────────────────────────────────────────────────────────────────────────

  // USER IMPACT: user disables auto-blur in settings — timer and listeners removed cleanly, no stale callbacks fire
  test('destroy removes all listeners and resets state', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 5, idle: true, tabSwitch: true, onIdle, onActive: jest.fn() });

    blsi.AutoBlur.destroy();
    jest.advanceTimersByTime(10 * 1000);
    expect(onIdle).not.toHaveBeenCalled();
    expect(blsi.AutoBlur.isIdle()).toBe(false);
  });

  test('double init replaces previous listeners', () => {
    const onIdle1 = jest.fn();
    const onIdle2 = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 5, idle: true, tabSwitch: false, onIdle: onIdle1, onActive: jest.fn() });
    blsi.AutoBlur.init({ idleTimeout: 5, idle: true, tabSwitch: false, onIdle: onIdle2, onActive: jest.fn() });

    jest.advanceTimersByTime(5 * 1000);
    expect(onIdle1).not.toHaveBeenCalled();
    expect(onIdle2).toHaveBeenCalledTimes(1);
  });

  // USER IMPACT: user chooses idle-only mode — tab switches do not trigger blur (mode isolation)
  test('idle-only mode does not respond to visibility changes', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: true, tabSwitch: false, onIdle, onActive: jest.fn() });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onIdle).not.toHaveBeenCalled(); // tabSwitch is false

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  // USER IMPACT: user chooses tab-switch-only mode — idle timeout never fires (mode isolation)
  test('tab-switch-only mode does not set idle timer', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 5, idle: false, tabSwitch: true, onIdle, onActive: jest.fn() });

    jest.advanceTimersByTime(10 * 1000);
    expect(onIdle).not.toHaveBeenCalled(); // idle is false, no timer should fire
  });

  // MISSING: no test for all activity event types — only mousemove verified; keydown, scroll, touchstart not covered
  // MISSING: no test for double destroy() call — should be safe and not throw
  // MISSING: no test for init() with missing onIdle/onActive callbacks — should not crash on missing optional callbacks
  // MISSING: no test for edge-case idleTimeout values (0 or Infinity) — behavior on invalid input is unspecified
});
