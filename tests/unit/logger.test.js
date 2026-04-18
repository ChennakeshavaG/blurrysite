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

/* === TEST QUALITY ANNOTATIONS ===
 * Covers: gated log/warn/flow, un-gated error, enable/disable persistence,
 *         scope() tagging + gate, flow() payload output, cross-context
 *         onChanged sync, initial state hydration from chrome.storage.
 *
 * Redundant:
 *   "error() always writes regardless of toggle" and "scope().error always writes"
 *   both verify the un-gated error path. Duplication is intentional — root vs
 *   scoped variant — but the two tests together form a single logical contract.
 *
 * Optimization opportunities:
 *   enable/disable state assertions repeat the same freshLoad + enable/disable
 *   pattern. A shared resetToDisabled() helper before each toggle test would
 *   eliminate the repeated setup boilerplate.
 *
 * Missing coverage:
 *   - scope().warn() respecting the gate (warn is gated but never tested on scope)
 *   - Explicit enabled===false check before any enable() is called in a fresh load
 *   - Two independent scopes sharing the same _enabled state (cross-scope coupling)
 *   - _ts() timestamp format: HH:MM:SS.mmm prefix present on every log output
 *
 * === END ANNOTATIONS === */

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

  // USER IMPACT: debug logging off by default — users don't see dev messages in DevTools
  test('log/warn/flow are silent by default', () => {
    blsi.Logger.log('hello');
    blsi.Logger.warn('warn');
    blsi.Logger.flow('event', { a: 1 });
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  // USER IMPACT: critical errors always logged — developers catch issues even with debug off
  test('error() always writes regardless of toggle', () => {
    blsi.Logger.error('boom');
    expect(consoleErrorSpy).toHaveBeenCalled();
    const args = consoleErrorSpy.mock.calls[0];
    expect(args[0]).toBe('[BLSI]');
    expect(args).toContain('boom');
  });

  // USER IMPACT: user toggles debug in popup — persists across reloads via chrome.storage
  // OPTIMIZE: enable/disable pair tests share the same freshLoad+enable/disable pattern — extract resetToDisabled() helper
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

  // USER IMPACT: debug tracing across contexts — [content] vs [bg] prefixes isolate errors by module
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

  // REDUNDANT: mirrors "error() always writes regardless of toggle" — intentional duplication covering scoped variant (root vs scope)
  test('scope().error always writes', () => {
    const s = blsi.Logger.scope('bg');
    s.error('fatal');
    expect(consoleErrorSpy).toHaveBeenCalled();
    const args = consoleErrorSpy.mock.calls[0];
    expect(args).toContain('[bg]');
    expect(args).toContain('fatal');
  });

  // USER IMPACT: user enables debug on popup — content script immediately reflects state without reload
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

  // MISSING: no test for initial enabled===false (explicit assertion before any enable())
  // MISSING: no test for two independent scopes sharing the same _enabled flag
  // MISSING: no test for scope().warn() respecting the gate
  // MISSING: no test for _ts() timestamp HH:MM:SS.mmm prefix present on log output
  test('initial state read from storage when blsi_debug=true', () => {
    freshLoad({ initial: true });
    expect(blsi.Logger.enabled).toBe(true);
  });
});
