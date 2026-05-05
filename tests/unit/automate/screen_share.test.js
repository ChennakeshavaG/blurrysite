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

let mockPorts;

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

  mockPorts = {};
  chrome.runtime.connect = jest.fn((opts) => {
    var p = makeMockPort();
    if (opts && opts.name) mockPorts[opts.name] = p;
    return p;
  });
  chrome.runtime.sendMessage = jest.fn();

  require(STATE_PATH);
  require(MODULE_PATH);
  blsi.Automate.State._reset();
}

function fireShareEvent(active, streamId) {
  var sid = streamId || 'test-stream-001';
  var listeners = window.addEventListener.mock.calls
    .filter(function (c) { return c[0] === 'message'; });
  var last = listeners[listeners.length - 1];
  if (!last) throw new Error('No message listener registered');
  last[1]({ data: { type: '__blsi_screen_share', active: active, streamId: sid } });
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

    test('ignores messages with no streamId', () => {
      chrome.runtime.sendMessage.mockReturnValue({ catch: jest.fn() });
      blsi.Automate.ScreenShare.init();
      var listeners = window.addEventListener.mock.calls
        .filter(function (c) { return c[0] === 'message'; });
      listeners[0][1]({ data: { type: '__blsi_screen_share', active: true } });
      expect(chrome.runtime.connect).not.toHaveBeenCalled();
    });
  });

  describe('share start', () => {
    test('opens port with name blsi-ss-<streamId>', () => {
      chrome.runtime.sendMessage.mockImplementation(() => ({ catch: () => {} }));
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true, 'abc-123');
      expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'blsi-ss-abc-123' });
    });

    test('sends SCREEN_SHARE_STARTED message with streamId', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true, 'stream-x');
      var startedCalls = chrome.runtime.sendMessage.mock.calls
        .filter(function (c) { return c[0] && c[0].type === blsi.command.screen_share_started; });
      expect(startedCalls.length).toBe(1);
      expect(startedCalls[0][0].streamId).toBe('stream-x');
    });
  });

  describe('share end', () => {
    test('disconnects port and sends SCREEN_SHARE_ENDED with streamId', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true, 'stream-y');
      fireShareEvent(false, 'stream-y');
      var port = mockPorts['blsi-ss-stream-y'];
      expect(port.disconnect).toHaveBeenCalled();
      var endedCalls = chrome.runtime.sendMessage.mock.calls
        .filter(function (c) { return c[0] && c[0].type === blsi.command.screen_share_ended; });
      expect(endedCalls.length).toBe(1);
      expect(endedCalls[0][0].streamId).toBe('stream-y');
    });

    test('sends ENDED even if no port was open for that stream', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(false, 'no-such-stream');
      expect(chrome.runtime.connect).not.toHaveBeenCalled();
      var endedCalls = chrome.runtime.sendMessage.mock.calls
        .filter(function (c) { return c[0] && c[0].type === blsi.command.screen_share_ended; });
      expect(endedCalls.length).toBe(1);
      expect(endedCalls[0][0].streamId).toBe('no-such-stream');
    });
  });

  describe('per-stream tracking', () => {
    test('two streams open independently — ending one does not disconnect the other', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true, 'stream-a');
      fireShareEvent(true, 'stream-b');
      expect(Object.keys(mockPorts).length).toBe(2);

      fireShareEvent(false, 'stream-a');
      var portA = mockPorts['blsi-ss-stream-a'];
      var portB = mockPorts['blsi-ss-stream-b'];
      expect(portA.disconnect).toHaveBeenCalled();
      expect(portB.disconnect).not.toHaveBeenCalled();
    });

    test('ending second stream disconnects its port', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true, 'stream-a');
      fireShareEvent(true, 'stream-b');
      fireShareEvent(false, 'stream-a');
      fireShareEvent(false, 'stream-b');
      var portB = mockPorts['blsi-ss-stream-b'];
      expect(portB.disconnect).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    test('disconnects all open ports and removes listener', () => {
      var sentPromise = { catch: jest.fn() };
      chrome.runtime.sendMessage.mockReturnValue(sentPromise);
      blsi.Automate.ScreenShare.init();
      fireShareEvent(true, 'stream-1');
      fireShareEvent(true, 'stream-2');
      blsi.Automate.ScreenShare.destroy();
      var port1 = mockPorts['blsi-ss-stream-1'];
      var port2 = mockPorts['blsi-ss-stream-2'];
      expect(port1.disconnect).toHaveBeenCalled();
      expect(port2.disconnect).toHaveBeenCalled();
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
