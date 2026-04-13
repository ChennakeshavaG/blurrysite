/**
 * tests/unit/auto_blur.test.js
 *
 * Unit tests for src/auto_blur.js
 * Module exposes blsi.AutoBlur with:
 *   init, destroy, isIdle
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/auto_blur.js');

function freshLoad() {
  delete blsi.AutoBlur;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

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

  test('user activity after idle triggers onActive', () => {
    const onActive = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 5, idle: true, tabSwitch: false, onIdle: jest.fn(), onActive });

    jest.advanceTimersByTime(5 * 1000);
    expect(blsi.AutoBlur.isIdle()).toBe(true);

    document.dispatchEvent(new Event('mousemove'));
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(blsi.AutoBlur.isIdle()).toBe(false);
  });

  test('tab switch triggers onIdle when hidden', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle, onActive: jest.fn() });

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onIdle).toHaveBeenCalledTimes(1);

    // Restore
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  test('tab becoming visible triggers onActive', () => {
    const onActive = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: false, tabSwitch: true, onIdle: jest.fn(), onActive });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onActive).toHaveBeenCalledTimes(1);
  });

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

  test('idle-only mode does not respond to visibility changes', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 300, idle: true, tabSwitch: false, onIdle, onActive: jest.fn() });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onIdle).not.toHaveBeenCalled(); // tabSwitch is false

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  test('tab-switch-only mode does not set idle timer', () => {
    const onIdle = jest.fn();
    blsi.AutoBlur.init({ idleTimeout: 5, idle: false, tabSwitch: true, onIdle, onActive: jest.fn() });

    jest.advanceTimersByTime(10 * 1000);
    expect(onIdle).not.toHaveBeenCalled(); // idle is false, no timer should fire
  });
});
