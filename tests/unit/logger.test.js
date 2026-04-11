/**
 * tests/unit/logger.test.js
 *
 * Unit tests for src/logger.js
 * Module exposes blsi.Logger with:
 *   log, warn, error, flow, scope, enable, disable, get enabled
 *
 * Behavior under test:
 *  - log/warn/flow are gated on _enabled (toggle via enable/disable)
 *  - error always writes to console.error regardless of toggle
 *  - scope() returns a tagged variant that respects the same gate
 *  - chrome.storage.onChanged listener flips _enabled cross-context
 *  - enable()/disable() persist the toggle to chrome.storage.local.blsi_debug
 *  - initial state is read from chrome.storage.local on load
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/logger.js');

let onChangedListener = null;

function freshLoad({ initial = false } = {}) {
  onChangedListener = null;
  delete blsi.Logger;
  jest.resetModules();
  chrome.storage.onChanged.addListener.mockImplementation((fn) => {
    onChangedListener = fn;
  });
  chrome.storage.local.get.mockImplementation((key, cb) => {
    cb({ blsi_debug: initial });
  });
  jest.isolateModules(() => { require(MODULE_PATH); });
}

describe('logger.js', () => {
  let consoleLogSpy, consoleWarnSpy, consoleErrorSpy;

  beforeEach(() => {
    freshLoad();
    consoleLogSpy   = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  afterAll(() => {
    // Reset mock implementations we set on the shared chrome stub so other
    // test files (notably reveal_controller) see fresh jest.fn() defaults.
    chrome.storage.onChanged.addListener.mockReset();
    chrome.storage.local.get.mockReset();
  });

  test('log/warn/flow are silent by default', () => {
    blsi.Logger.log('hello');
    blsi.Logger.warn('warn');
    blsi.Logger.flow('event', { a: 1 });
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('error() always writes regardless of toggle', () => {
    blsi.Logger.error('boom');
    expect(consoleErrorSpy).toHaveBeenCalled();
    const args = consoleErrorSpy.mock.calls[0];
    expect(args[0]).toBe('[BLSI]');
    expect(args).toContain('boom');
  });

  test('enable() flips state and persists to storage', () => {
    blsi.Logger.enable();
    expect(blsi.Logger.enabled).toBe(true);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ blsi_debug: true });
    consoleLogSpy.mockClear();
    blsi.Logger.log('after enable');
    expect(consoleLogSpy.mock.calls.some((c) => c.includes('after enable'))).toBe(true);
  });

  test('disable() flips state off and persists', () => {
    blsi.Logger.enable();
    blsi.Logger.disable();
    expect(blsi.Logger.enabled).toBe(false);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ blsi_debug: false });
    consoleLogSpy.mockClear();
    blsi.Logger.log('quiet');
    expect(consoleLogSpy.mock.calls.some((c) => c.includes('quiet'))).toBe(false);
  });

  test('flow() emits the event tag and payload when enabled', () => {
    blsi.Logger.enable();
    consoleLogSpy.mockClear();
    blsi.Logger.flow('init.start', { hostname: 'example.com' });
    const matched = consoleLogSpy.mock.calls.find((c) => c.includes('init.start'));
    expect(matched).toBeDefined();
    expect(matched).toEqual(expect.arrayContaining([{ hostname: 'example.com' }]));
  });

  test('scope() prefixes with the scope tag and respects the gate', () => {
    const s = blsi.Logger.scope('content');
    s.log('quiet');
    expect(consoleLogSpy).not.toHaveBeenCalled();
    blsi.Logger.enable();
    consoleLogSpy.mockClear();
    s.flow('msg.in', { type: 'X' });
    const matched = consoleLogSpy.mock.calls.find((c) => c.includes('[content]'));
    expect(matched).toBeDefined();
    expect(matched).toEqual(expect.arrayContaining(['msg.in', { type: 'X' }]));
  });

  test('scope().error always writes', () => {
    const s = blsi.Logger.scope('bg');
    s.error('fatal');
    expect(consoleErrorSpy).toHaveBeenCalled();
    const args = consoleErrorSpy.mock.calls[0];
    expect(args).toContain('[bg]');
    expect(args).toContain('fatal');
  });

  test('chrome.storage.onChanged listener syncs cross-context state', () => {
    expect(typeof onChangedListener).toBe('function');
    expect(blsi.Logger.enabled).toBe(false);
    onChangedListener({ blsi_debug: { newValue: true } }, 'local');
    expect(blsi.Logger.enabled).toBe(true);
    onChangedListener({ blsi_debug: { newValue: false } }, 'local');
    expect(blsi.Logger.enabled).toBe(false);
  });

  test('onChanged listener ignores non-local areas and unrelated keys', () => {
    onChangedListener({ blsi_debug: { newValue: true } }, 'sync');
    expect(blsi.Logger.enabled).toBe(false);
    onChangedListener({ other_key: { newValue: true } }, 'local');
    expect(blsi.Logger.enabled).toBe(false);
  });

  test('initial state read from storage when blsi_debug=true', () => {
    freshLoad({ initial: true });
    expect(blsi.Logger.enabled).toBe(true);
  });
});
