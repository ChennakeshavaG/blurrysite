/**
 * tests/setup.js
 *
 * Global test setup — runs once per test file (via setupFilesAfterEnv).
 * Provides a realistic mock of the chrome extension APIs so unit tests can
 * import / eval source modules without a real browser environment.
 */

'use strict';

// ─── Make window === global so vm.runInThisContext can resolve window globals ──
// Jest's jsdom environment sets global properties (document, navigator, etc.)
// but vm.runInThisContext runs in Node's V8 context where `window` is not a
// default global. Aliasing it here makes extension IIFEs that assign to
// `window.blsi.*` work correctly in both vm and eval contexts.
global.window = global;

// ─── Load message type constants ─────────────────────────────────────────────
// constants.js assigns to globalThis.blsi — must be loaded before any
// source module that references blsi.*.
// Using require() so Jest's Istanbul transform instruments it for coverage.
require('../src/constants.js');

// ─── Load action registry ────────────────────────────────────────────────────
// action_registry.js is the single source of truth for shortcut-driven
// actions. constants.js buildDefaultSettings() and validateSettings() read
// it lazily; loading it here ensures every test has access to the registry
// via blsi.Actions.
require('../src/action_registry.js');

// ─── Load shortcut label (includes reserved chord list) ─────────────────────
require('../src/shortcut_label.js');

// ─── Chrome Extension API mock ────────────────────────────────────────────────

// Listener array for chrome.storage.onChanged — populated by addListener() calls
// from source modules (storage_model.js, logger.js, etc.) at IIFE load time.
// Tests trigger listeners via global._fireStorageChanged(changes, area).
const _onChangedListeners = [];
global._fireStorageChanged = function(changes, area) {
  if (area === undefined) area = 'local';
  _onChangedListeners.forEach(function(fn) { fn(changes, area); });
};

global.chrome = {
  i18n: {
    getMessage: jest.fn((key) => key),
  },
  runtime: {
    sendMessage: jest.fn(),
    getURL: jest.fn((path) => path),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    lastError: null,
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
    },
    session: {
      get: jest.fn((key, cb) => { if (cb) cb({}); }),
      set: jest.fn((_data, cb) => { if (cb) cb(); }),
      remove: jest.fn((_key, cb) => { if (cb) cb(); }),
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
    },
    onChanged: {
      // jest.fn() so logger.test.js can call .mockImplementation()/.mockReset().
      // Default implementation captures listeners for _fireStorageChanged().
      // jest.clearAllMocks() resets call counts only — implementation persists.
      addListener: jest.fn((fn) => { _onChangedListeners.push(fn); }),
      removeListener: jest.fn(),
    },
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
    get: jest.fn(),
  },
  commands: {
    onCommand: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  contextMenus: {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    removeAll: jest.fn(),
  },
  action: {
    setTitle: jest.fn(),
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
  },
  idle: {
    setDetectionInterval: jest.fn(),
    queryState: jest.fn((_threshold, cb) => { if (cb) cb('active'); }),
    onStateChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
};

// ─── BlurrySitePopupShared stub ───────────────────────────────────────────────
// Render files (keyboard.js, howtoblur.js, etc.) alias helpers from this global
// at IIFE load time. Provide the real implementation so tests exercise actual code.
require('../popup/renders/shared.js');

// ─── HTMLCanvasElement.getContext stub ────────────────────────────────────────

// jsdom does not implement canvas 2D context — provide a minimal stub so blur
// engine tests that create canvas overlays for video elements do not throw.
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
  filter: '',
  drawImage: jest.fn(),
  clearRect: jest.fn(),
  fillRect: jest.fn(),
  getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
}));

// ─── requestIdleCallback stub ─────────────────────────────────────────────────

// jsdom does not implement requestIdleCallback. Provide a synchronous stub so
// tests that call handleSite / handleDocument flush idle work immediately and
// don't need to advance fake timers. The deadline.timeRemaining() value of 50
// is enough to drain any realistic _stampQueue in one idle slice.
global.requestIdleCallback = (fn) => { fn({ timeRemaining: () => 50 }); return 0; };
global.cancelIdleCallback  = () => {};

// ─── requestAnimationFrame stub ───────────────────────────────────────────────

// jsdom does not implement rAF. Provide a stub that records calls and returns
// incrementing handles WITHOUT scheduling the callback — the video blur loop
// calls requestAnimationFrame recursively, so auto-executing would cause an
// infinite loop and OOM. Tests only need to verify that rAF was called.
let rafHandle = 0;
global.requestAnimationFrame = jest.fn(() => {
  rafHandle += 1;
  return rafHandle;
});
global.cancelAnimationFrame = jest.fn();

// ─── KeyboardEvent.getModifierState stub ─────────────────────────────────────

// jsdom may not implement getModifierState on KeyboardEvent. Provide a default
// that returns false so production code doesn't need a typeof guard.
// Individual tests can mock it per-event for AltGr testing.
if (!KeyboardEvent.prototype.getModifierState) {
  KeyboardEvent.prototype.getModifierState = function() { return false; };
}

// ─── Reset mocks between tests ────────────────────────────────────────────────

beforeEach(() => {
  // Reset chrome mock call counts but keep the shape intact.
  jest.clearAllMocks();
  // Ensure lastError is null by default.
  chrome.runtime.lastError = null;
});
