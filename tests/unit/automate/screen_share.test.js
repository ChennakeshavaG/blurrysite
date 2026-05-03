/**
 * tests/unit/automate/screen_share.test.js
 *
 * Unit tests for src/automate/screen_share.js
 * Module exposes blsi.Automate.ScreenShare with:
 *   init, destroy, whoAmI, getTabId
 */

'use strict';

const path = require('path');
const STATE_PATH = path.resolve(__dirname, '../../../src/automate/state.js');
const MODULE_PATH = path.resolve(__dirname, '../../../src/automate/screen_share.js');

let mockPort;

function makeMockPort() {
  return {
    disconnect: jest.fn(),
    onDisconnect: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
  };
}

function freshLoad() {
  delete globalThis.blsi.Automate;
  jest.resetModules();

  mockPort = makeMockPort();
  chrome.runtime.connect = jest.fn(() => mockPort);
  chrome.runtime.sendMessage = jest.fn();

  require(STATE_PATH);
  require(MODULE_PATH);
  blsi.Automate.State._reset();
}

function fireShareEvent(active) {
  var listeners = window.addEventListener.mock.calls
    .filter(function (c) { return c[0] === 'message'; });
  var last = listeners[listeners.length - 1];
  if (!last) throw new Error('No message listener registered');
  last[1]({ data: { type: '__blsi_screen_share', active: active } });
}

describe('automate/screen_share.js', () => {
  beforeEach(() => {
    jest.spyOn(window, 'addEventListener');
    jest.spyOn(window, 'removeEventListener');
    freshLoad();
  });

  afterEach(() => {
    try { blsi.Automate.ScreenShare.destroy(); } catch (_) {}
    window.addEventListener.mockRestore();
    window.removeEventListener.mockRestore();
  });

  describe('init', () => {
    test('registers message listener on window', () => {
      blsi.Automate.ScreenShare.init();
      var calls = window.addEventListener.mock.calls
        .filter(function (c) { return c[0] === 'message'; });
      expect(calls.length).toBe(1);
      expect(typeof calls[0][1]).toBe('function');
    });

    test('fires whoAmI on init (sends WHO_AM_I message)', () => {
      blsi.Automate.ScreenShare.init();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { type: blsi.command.who_am_i },
        expect.any(Function)
      );
    });

    test('is idempotent — second init is a no-op', () => {
      blsi.Automate.ScreenShare.init();
      blsi.Automate.ScreenShare.init();
      var addCalls = window.addEventListener.mock.calls
        .filter(function (c) { return c[0] === 'message'; });
      expect(addCalls.length).toBe(1);
    });
  });

  describe('message filtering', () => {
    test('ignores messages with wrong type', () => {
      chrome.runtime.sendMessage.mockReturnValue({ catch: jest.fn() });
      blsi.Automate.ScreenShare.init();
      var listeners = window.addEventListener.mock.calls
        .filter(function (c) { return c[0] === 'message'; });
      listeners[0][1]({ data: { type: 'other_message', active: true } });
      expect(chrome.runtime.connect).not.toHaveBeenCalled();
    });

    test('ignores messages with no data', () => {
      chrome.runtime.sendMessage.mockReturnValue({ catch: jest.fn() });
      blsi.Automate.ScreenShare.init();
      var listeners = window.addEventListener.mock.calls
        .filter(function (c) { return c[0] === 'message'; });
      listeners[0][1]({});
      expect(chrome.runtime.connect).not.toHaveBeenCalled();
    });
  });

  describe('share start', () => {
    test('opens port with name blsi-screen-share', () => {
      chrome.runtime.sendMessage.mockImplementation(() => ({ catch: () => {} }));
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true);
      expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'blsi-screen-share' });
    });

    test('sends SCREEN_SHARE_STARTED message', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true);
      var startedCalls = chrome.runtime.sendMessage.mock.calls
        .filter(function (c) { return c[0] && c[0].type === blsi.command.screen_share_started; });
      expect(startedCalls.length).toBe(1);
    });
  });

  describe('share end', () => {
    test('disconnects port and sends SCREEN_SHARE_ENDED', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true);
      fireShareEvent(false);
      expect(mockPort.disconnect).toHaveBeenCalled();
      var endedCalls = chrome.runtime.sendMessage.mock.calls
        .filter(function (c) { return c[0] && c[0].type === blsi.command.screen_share_ended; });
      expect(endedCalls.length).toBe(1);
    });

    test('sends ENDED even if no port was open', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(false);
      expect(mockPort.disconnect).not.toHaveBeenCalled();
      var endedCalls = chrome.runtime.sendMessage.mock.calls
        .filter(function (c) { return c[0] && c[0].type === blsi.command.screen_share_ended; });
      expect(endedCalls.length).toBe(1);
    });
  });

  describe('destroy', () => {
    test('disconnects open port and removes listener', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true);
      blsi.Automate.ScreenShare.destroy();
      expect(mockPort.disconnect).toHaveBeenCalled();
      var removeCalls = window.removeEventListener.mock.calls
        .filter(function (c) { return c[0] === 'message'; });
      expect(removeCalls.length).toBeGreaterThanOrEqual(1);
    });

    test('is idempotent — no error when called twice', () => {
      blsi.Automate.ScreenShare.init();
      blsi.Automate.ScreenShare.destroy();
      expect(() => blsi.Automate.ScreenShare.destroy()).not.toThrow();
    });

    test('does not clear _myTabId — tab id stays cached', () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.type === blsi.command.who_am_i && cb) {
          cb({ tab_id: 42 });
        }
        return { catch: () => {} };
      });
      blsi.Automate.ScreenShare.init();
      blsi.Automate.ScreenShare.destroy();
      expect(blsi.Automate.ScreenShare.getTabId()).toBe(42);
    });
  });

  describe('whoAmI', () => {
    test('caches tab id from response', async () => {
      freshLoad();
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.type === blsi.command.who_am_i && cb) {
          cb({ tab_id: 99 });
        }
        return { catch: () => {} };
      });
      var tabId = await blsi.Automate.ScreenShare.whoAmI();
      expect(tabId).toBe(99);
      expect(blsi.Automate.ScreenShare.getTabId()).toBe(99);
    });

    test('second call reuses cached promise — no extra sendMessage', async () => {
      freshLoad();
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.type === blsi.command.who_am_i && cb) {
          cb({ tab_id: 7 });
        }
        return { catch: () => {} };
      });
      await blsi.Automate.ScreenShare.whoAmI();
      var countBefore = chrome.runtime.sendMessage.mock.calls.length;
      await blsi.Automate.ScreenShare.whoAmI();
      expect(chrome.runtime.sendMessage.mock.calls.length).toBe(countBefore);
    });

    test('resolves null on SW failure', async () => {
      freshLoad();
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.type === blsi.command.who_am_i && cb) {
          Object.defineProperty(chrome.runtime, 'lastError', {
            value: { message: 'Could not establish connection' },
            configurable: true,
          });
          cb(undefined);
          Object.defineProperty(chrome.runtime, 'lastError', {
            value: null,
            configurable: true,
          });
        }
        return { catch: () => {} };
      });
      var tabId = await blsi.Automate.ScreenShare.whoAmI();
      expect(tabId).toBeNull();
    });

    test('resolves null when sendMessage throws', async () => {
      freshLoad();
      chrome.runtime.sendMessage.mockImplementation(() => {
        throw new Error('Extension context invalidated');
      });
      var tabId = await blsi.Automate.ScreenShare.whoAmI();
      expect(tabId).toBeNull();
    });
  });

  describe('getTabId', () => {
    test('returns null before whoAmI resolves', () => {
      freshLoad();
      expect(blsi.Automate.ScreenShare.getTabId()).toBeNull();
    });
  });

  describe('module export', () => {
    test('exposed as blsi.Automate.ScreenShare', () => {
      expect(blsi.Automate.ScreenShare).toBeDefined();
      expect(typeof blsi.Automate.ScreenShare.init).toBe('function');
      expect(typeof blsi.Automate.ScreenShare.destroy).toBe('function');
      expect(typeof blsi.Automate.ScreenShare.whoAmI).toBe('function');
      expect(typeof blsi.Automate.ScreenShare.getTabId).toBe('function');
    });

    test('ScreenShare object is frozen', () => {
      expect(Object.isFrozen(blsi.Automate.ScreenShare)).toBe(true);
    });
  });
});
