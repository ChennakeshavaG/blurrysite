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
// constants.js assigns to globalThis.pb — must be loaded before any
// source module that references blsi.*.
// Using require() so Jest's Istanbul transform instruments it for coverage.
require('../src/constants.js');

// ─── Chrome Extension API mock ────────────────────────────────────────────────

global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
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
    sync: {
      get: jest.fn(),
      set: jest.fn(),
    },
    onChanged: {
      addListener: jest.fn(),
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
};

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
