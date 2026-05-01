/**
 * tests/unit/automate/idle.test.js
 *
 * Unit tests for src/automate/idle.js
 * Module exposes blsi.Automate.Idle with:
 *   init, destroy, setThreshold, getCurrentPhase
 */

'use strict';

const path = require('path');
const STATE_PATH = path.resolve(__dirname, '../../../src/automate/state.js');
const MODULE_PATH = path.resolve(__dirname, '../../../src/automate/idle.js');

let capturedIdleListener;
let capturedStorageListener;

function freshLoad() {
  delete globalThis.blsi.Automate;
  jest.resetModules();
  capturedIdleListener = null;
  capturedStorageListener = null;
  chrome.idle.onStateChanged.addListener.mockImplementation(fn => { capturedIdleListener = fn; });
  // Idle registers a chrome.storage.onChanged listener AFTER State did at IIFE
  // load. Stack on top of the existing capture so State's cache stays in sync.
  const origAdd = chrome.storage.onChanged.addListener.getMockImplementation();
  chrome.storage.onChanged.addListener.mockImplementation(fn => {
    if (origAdd) origAdd(fn);
    capturedStorageListener = fn;
  });
  chrome.storage.local.get.mockImplementation((_key, cb) => { if (cb) cb({}); });
  require(STATE_PATH);
  require(MODULE_PATH);
}

// USER IMPACT: OS reports idle/locked → State.write_idle persists → every tab
// receives the transition through chrome.storage.onChanged.
describe('automate/idle.js', () => {
  beforeEach(() => {
    freshLoad();
  });

  afterEach(() => {
    try { blsi.Automate.Idle.destroy(); } catch (_) {}
  });

  describe('init / destroy', () => {
    test('init() registers chrome.idle.onStateChanged listener', () => {
      blsi.Automate.Idle.init();
      expect(chrome.idle.onStateChanged.addListener).toHaveBeenCalled();
      expect(typeof capturedIdleListener).toBe('function');
    });

    test('init() registers chrome.storage.onChanged listener', () => {
      blsi.Automate.Idle.init();
      expect(typeof capturedStorageListener).toBe('function');
    });

    test('init() is idempotent — second call does not double-register', () => {
      blsi.Automate.Idle.init();
      const firstCount = chrome.idle.onStateChanged.addListener.mock.calls.length;
      blsi.Automate.Idle.init();
      expect(chrome.idle.onStateChanged.addListener.mock.calls.length).toBe(firstCount);
    });

    test('init() seeds threshold via chrome.storage.local.get', () => {
      blsi.Automate.Idle.init();
      expect(chrome.storage.local.get).toHaveBeenCalledWith('blsi_model', expect.any(Function));
    });

    test('init() seeds initial phase via chrome.idle.queryState', () => {
      blsi.Automate.Idle.init();
      expect(chrome.idle.queryState).toHaveBeenCalled();
    });

    test('init() is a no-op when chrome.idle is unavailable', () => {
      const saved = chrome.idle;
      delete chrome.idle;
      // Re-require since module captured chrome.idle inside _api_available()
      delete globalThis.blsi.Automate;
      jest.resetModules();
      require(STATE_PATH);
      require(MODULE_PATH);
      expect(() => blsi.Automate.Idle.init()).not.toThrow();
      chrome.idle = saved;
    });

    test('destroy() removes both listeners', () => {
      blsi.Automate.Idle.init();
      blsi.Automate.Idle.destroy();
      expect(chrome.idle.onStateChanged.removeListener).toHaveBeenCalled();
      expect(chrome.storage.onChanged.removeListener).toHaveBeenCalled();
    });
  });

  describe('idle state relay', () => {
    test("'idle' state writes via State.write_idle('idle')", () => {
      blsi.Automate.Idle.init();
      capturedIdleListener('idle');
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        { blsi_automate_idle: 'idle' },
        expect.any(Function)
      );
      expect(blsi.Automate.Idle.getCurrentPhase()).toBe('idle');
    });

    test("'locked' state writes via State.write_idle('locked')", () => {
      blsi.Automate.Idle.init();
      capturedIdleListener('locked');
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        { blsi_automate_idle: 'locked' },
        expect.any(Function)
      );
      expect(blsi.Automate.Idle.getCurrentPhase()).toBe('locked');
    });

    test("'active' (returning from idle) writes 'active'", () => {
      blsi.Automate.Idle.init();
      capturedIdleListener('idle');
      chrome.storage.session.set.mockClear();
      capturedIdleListener('active');
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        { blsi_automate_idle: 'active' },
        expect.any(Function)
      );
    });

    test('unknown state values are ignored', () => {
      blsi.Automate.Idle.init();
      chrome.storage.session.set.mockClear();
      capturedIdleListener('foo');
      capturedIdleListener(null);
      capturedIdleListener(42);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });
  });

  describe('setThreshold', () => {
    test('passes through valid seconds', () => {
      blsi.Automate.Idle.init();
      chrome.idle.setDetectionInterval.mockClear();
      blsi.Automate.Idle.setThreshold(120);
      expect(chrome.idle.setDetectionInterval).toHaveBeenCalledWith(120);
    });

    test('clamps below 15s up to 15s', () => {
      blsi.Automate.Idle.init();
      chrome.idle.setDetectionInterval.mockClear();
      blsi.Automate.Idle.setThreshold(5);
      expect(chrome.idle.setDetectionInterval).toHaveBeenCalledWith(15);
    });

    test('clamps above 3600s down to 3600s', () => {
      blsi.Automate.Idle.init();
      chrome.idle.setDetectionInterval.mockClear();
      blsi.Automate.Idle.setThreshold(99999);
      expect(chrome.idle.setDetectionInterval).toHaveBeenCalledWith(3600);
    });

    test('non-finite / non-number is no-op', () => {
      blsi.Automate.Idle.init();
      chrome.idle.setDetectionInterval.mockClear();
      blsi.Automate.Idle.setThreshold('120');
      blsi.Automate.Idle.setThreshold(NaN);
      blsi.Automate.Idle.setThreshold(Infinity);
      expect(chrome.idle.setDetectionInterval).not.toHaveBeenCalled();
    });
  });

  describe('model-driven hot update', () => {
    test('blsi_model change updates threshold (min unit)', () => {
      blsi.Automate.Idle.init();
      chrome.idle.setDetectionInterval.mockClear();
      capturedStorageListener(
        { blsi_model: { newValue: { automate: { settings: { idle: { value: 10, unit: 'min' } } } } } },
        'local'
      );
      expect(chrome.idle.setDetectionInterval).toHaveBeenCalledWith(600);
    });

    test('blsi_model change updates threshold (sec unit)', () => {
      blsi.Automate.Idle.init();
      chrome.idle.setDetectionInterval.mockClear();
      capturedStorageListener(
        { blsi_model: { newValue: { automate: { settings: { idle: { value: 90, unit: 'sec' } } } } } },
        'local'
      );
      expect(chrome.idle.setDetectionInterval).toHaveBeenCalledWith(90);
    });

    test('non-blsi_model change is ignored', () => {
      blsi.Automate.Idle.init();
      chrome.idle.setDetectionInterval.mockClear();
      capturedStorageListener({ some_other_key: { newValue: 1 } }, 'local');
      expect(chrome.idle.setDetectionInterval).not.toHaveBeenCalled();
    });

    test('non-local area is ignored', () => {
      blsi.Automate.Idle.init();
      chrome.idle.setDetectionInterval.mockClear();
      capturedStorageListener(
        { blsi_model: { newValue: { automate: { settings: { idle: { value: 30, unit: 'sec' } } } } } },
        'session'
      );
      expect(chrome.idle.setDetectionInterval).not.toHaveBeenCalled();
    });
  });
});
