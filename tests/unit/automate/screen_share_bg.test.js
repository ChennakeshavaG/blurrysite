/**
 * tests/unit/automate/screen_share_bg.test.js
 *
 * Unit tests for src/automate/screen_share_bg.js
 * Module exposes blsi.Automate.ScreenShareBg with:
 *   init, destroy
 */

'use strict';

const path = require('path');
const STATE_PATH = path.resolve(__dirname, '../../../src/automate/state.js');
const MODULE_PATH = path.resolve(__dirname, '../../../src/automate/screen_share_bg.js');

const SS_KEY = 'blsi_screen_share';
const _SUPPRESSED_KEY = 'blsi_automate_suppressed_tabs';

let capturedConnectListener;
let capturedMessageListener;

function freshLoad() {
  delete globalThis.blsi.Automate;
  capturedConnectListener = null;
  capturedMessageListener = null;
  jest.resetModules();

  chrome.runtime.onConnect = {
    addListener: jest.fn((fn) => { capturedConnectListener = fn; }),
    removeListener: jest.fn(),
  };

  chrome.runtime.onMessage.addListener = jest.fn((fn) => {
    capturedMessageListener = fn;
  });
  chrome.runtime.onMessage.removeListener = jest.fn();

  chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb([]); });
  chrome.tabs.sendMessage.mockReturnValue({ catch: () => {} });

  require(STATE_PATH);

  globalThis.blsi.Logger = { scope: () => ({ flow: jest.fn(), warn: jest.fn() }) };

  require(MODULE_PATH);
  blsi.Automate.State._reset();
}

function makePort(tabId, name) {
  var disconnectListeners = [];
  return {
    name: name || 'blsi-screen-share',
    sender: { tab: { id: tabId } },
    onDisconnect: {
      addListener: jest.fn((fn) => { disconnectListeners.push(fn); }),
    },
    _fireDisconnect: function () {
      disconnectListeners.forEach(function (fn) { fn(); });
    },
  };
}

describe('automate/screen_share_bg.js', () => {
  beforeEach(() => {
    freshLoad();
  });

  afterEach(() => {
    try { blsi.Automate.ScreenShareBg.destroy(); } catch (_) {}
  });

  describe('init', () => {
    test('no-op when no active shares exist', () => {
      chrome.storage.session.set.mockClear();
      blsi.Automate.ScreenShareBg.init();
      var setCalls = chrome.storage.session.set.mock.calls;
      var wrote_ss_key = setCalls.some(function (c) {
        return c[0] && SS_KEY in c[0];
      });
      expect(wrote_ss_key).toBe(false);
    });

    test('removes stale share entries for dead tabs', () => {
      blsi.Automate.State.set_screen_share_active(999);
      chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb([]); });
      chrome.storage.session.set.mockClear();
      blsi.Automate.ScreenShareBg.init();
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(false);
    });

    test('preserves active share for live tabs', () => {
      blsi.Automate.State.set_screen_share_active(42);
      chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb([{ id: 42 }]); });
      chrome.storage.session.set.mockClear();
      blsi.Automate.ScreenShareBg.init();
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(true);
      expect(ss._sharing_tab_ids).toEqual([42]);
    });

    test('registers onConnect and onMessage listeners', () => {
      blsi.Automate.ScreenShareBg.init();
      expect(chrome.runtime.onConnect.addListener).toHaveBeenCalledWith(expect.any(Function));
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('port handler', () => {
    beforeEach(() => {
      blsi.Automate.ScreenShareBg.init();
      chrome.storage.session.set.mockClear();
    });

    test('sets screen share active on port connect', () => {
      var port = makePort(42);
      capturedConnectListener(port);
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(true);
      expect(ss.sharing_tab_id).toBe(42);
    });

    test('clears screen share on port disconnect + broadcasts notify', async () => {
      var tabs = [{ id: 1 }, { id: 2 }];
      chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb(tabs); });

      var port = makePort(42);
      capturedConnectListener(port);
      port._fireDisconnect();

      await Promise.resolve();
      await Promise.resolve();
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(false);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1, { type: blsi.command.screen_share_notify }
      );
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        2, { type: blsi.command.screen_share_notify }
      );
    });

    test('ignores ports with wrong name', () => {
      var port = makePort(42, 'some-other-port');
      capturedConnectListener(port);
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(false);
    });

    test('ignores ports with no sender tab id', () => {
      var port = { name: 'blsi-screen-share', sender: {}, onDisconnect: { addListener: jest.fn() } };
      capturedConnectListener(port);
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(false);
    });
  });

  describe('message handler', () => {
    beforeEach(() => {
      blsi.Automate.ScreenShareBg.init();
      chrome.storage.session.set.mockClear();
    });

    test('SCREEN_SHARE_STARTED sets active + broadcasts + responds', async () => {
      var tabs = [{ id: 1 }, { id: 10 }];
      chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb(tabs); });
      var sendResponse = jest.fn();

      var result = capturedMessageListener(
        { type: blsi.command.screen_share_started },
        { tab: { id: 10 } },
        sendResponse
      );
      expect(result).toBe(true);

      await Promise.resolve();
      await Promise.resolve();
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(true);
      expect(ss.sharing_tab_id).toBe(10);
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1, { type: blsi.command.screen_share_notify }
      );
    });

    test('SCREEN_SHARE_ENDED clears state + broadcasts + responds', async () => {
      // First set active so there's state to clear
      capturedMessageListener(
        { type: blsi.command.screen_share_started },
        { tab: { id: 5 } },
        jest.fn()
      );
      await Promise.resolve();
      await Promise.resolve();

      var tabs = [{ id: 1 }];
      chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb(tabs); });
      var sendResponse = jest.fn();

      var result = capturedMessageListener(
        { type: blsi.command.screen_share_ended },
        { tab: { id: 5 } },
        sendResponse
      );
      expect(result).toBe(true);

      await Promise.resolve();
      await Promise.resolve();
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    test('WHO_AM_I responds with sender tab id synchronously', () => {
      var sendResponse = jest.fn();
      var result = capturedMessageListener(
        { type: blsi.command.who_am_i },
        { tab: { id: 77 } },
        sendResponse
      );
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ tab_id: 77 });
    });

    test('WHO_AM_I responds null when sender has no tab', () => {
      var sendResponse = jest.fn();
      capturedMessageListener(
        { type: blsi.command.who_am_i },
        {},
        sendResponse
      );
      expect(sendResponse).toHaveBeenCalledWith({ tab_id: null });
    });

    test('unhandled message returns undefined', () => {
      var sendResponse = jest.fn();
      var result = capturedMessageListener(
        { type: 'SOME_OTHER_TYPE' },
        { tab: { id: 1 } },
        sendResponse
      );
      expect(result).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    });

    test('null message returns undefined', () => {
      var sendResponse = jest.fn();
      var result = capturedMessageListener(null, {}, sendResponse);
      expect(result).toBeUndefined();
    });
  });

  describe('destroy', () => {
    test('removes onConnect and onMessage listeners', () => {
      blsi.Automate.ScreenShareBg.init();
      blsi.Automate.ScreenShareBg.destroy();
      expect(chrome.runtime.onConnect.removeListener).toHaveBeenCalled();
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
    });

    test('is idempotent — no error when called without init', () => {
      expect(() => blsi.Automate.ScreenShareBg.destroy()).not.toThrow();
    });
  });

  describe('broadcast', () => {
    beforeEach(() => {
      blsi.Automate.ScreenShareBg.init();
      chrome.storage.session.set.mockClear();
    });

    test('STARTED broadcast excludes sender tab', async () => {
      var tabs = [{ id: 5 }, { id: 10 }, { id: 15 }];
      chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb(tabs); });

      capturedMessageListener(
        { type: blsi.command.screen_share_started },
        { tab: { id: 10 } },
        jest.fn()
      );
      await Promise.resolve();
      await Promise.resolve();

      var sentTabIds = chrome.tabs.sendMessage.mock.calls.map(function (c) { return c[0]; });
      expect(sentTabIds).toContain(5);
      expect(sentTabIds).toContain(15);
      expect(sentTabIds).not.toContain(10);
    });

    test('ENDED broadcast includes all tabs', async () => {
      var tabs = [{ id: 5 }, { id: 10 }];
      chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb(tabs); });

      capturedMessageListener(
        { type: blsi.command.screen_share_ended },
        { tab: { id: 10 } },
        jest.fn()
      );
      await Promise.resolve();
      await Promise.resolve();

      var sentTabIds = chrome.tabs.sendMessage.mock.calls.map(function (c) { return c[0]; });
      expect(sentTabIds).toContain(5);
      expect(sentTabIds).toContain(10);
    });
  });

  describe('per-tab isolation', () => {
    beforeEach(() => {
      blsi.Automate.ScreenShareBg.init();
      chrome.storage.session.set.mockClear();
      chrome.tabs.query.mockImplementation((_opts, cb) => { if (cb) cb([]); });
    });

    test('two tabs sharing simultaneously — both entries exist', () => {
      var port1 = makePort(42);
      var port2 = makePort(1001);
      capturedConnectListener(port1);
      capturedConnectListener(port2);
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(true);
      expect(ss._sharing_tab_ids).toContain(42);
      expect(ss._sharing_tab_ids).toContain(1001);
    });

    test('port disconnect clears only that tab — other tab persists', async () => {
      var port1 = makePort(42);
      var port2 = makePort(1001);
      capturedConnectListener(port1);
      capturedConnectListener(port2);
      port1._fireDisconnect();
      await Promise.resolve();
      await Promise.resolve();
      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(true);
      expect(ss._sharing_tab_ids).not.toContain(42);
      expect(ss._sharing_tab_ids).toContain(1001);
    });

    test('ENDED message clears only sender tab', async () => {
      capturedMessageListener(
        { type: blsi.command.screen_share_started },
        { tab: { id: 42 } },
        jest.fn()
      );
      capturedMessageListener(
        { type: blsi.command.screen_share_started },
        { tab: { id: 1001 } },
        jest.fn()
      );
      await Promise.resolve();
      await Promise.resolve();

      capturedMessageListener(
        { type: blsi.command.screen_share_ended },
        { tab: { id: 42 } },
        jest.fn()
      );
      await Promise.resolve();
      await Promise.resolve();

      var ss = blsi.Automate.State.get_screen_share_state();
      expect(ss.active).toBe(true);
      expect(ss._sharing_tab_ids).not.toContain(42);
      expect(ss._sharing_tab_ids).toContain(1001);
    });

    test('get_screen_share_state reports queried tab info when sharing', () => {
      var port = makePort(42);
      capturedConnectListener(port);
      var ss = blsi.Automate.State.get_screen_share_state(42);
      expect(ss.sharing_tab_id).toBe(42);
    });
  });

  describe('module export', () => {
    test('exposed as blsi.Automate.ScreenShareBg', () => {
      expect(blsi.Automate.ScreenShareBg).toBeDefined();
      expect(typeof blsi.Automate.ScreenShareBg.init).toBe('function');
      expect(typeof blsi.Automate.ScreenShareBg.destroy).toBe('function');
    });

    test('ScreenShareBg object is frozen', () => {
      expect(Object.isFrozen(blsi.Automate.ScreenShareBg)).toBe(true);
    });
  });
});
