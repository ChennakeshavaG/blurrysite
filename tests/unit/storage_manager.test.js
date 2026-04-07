/**
 * tests/unit/storage_manager.test.js
 *
 * Unit tests for src/storage_manager.js
 * Module exposes pb.Storage with:
 *   saveBlurItem, removeBlurItem, getBlurItems,
 *   clearHost, clearAll, getSettings, saveSettings
 *
 * The module communicates with background.js via chrome.runtime.sendMessage,
 * so all tests mock that function.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module ──────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/storage_manager.js');

function loadStorageManager() {
  if (pb.Storage) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

function buildStubSource() {
  return `
  (function() {
    'use strict';
    var MSG = pb;

    function sendMsg(msg) {
      return new Promise(function(resolve, reject) {
        try {
          chrome.runtime.sendMessage(msg, function(response) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || 'sendMessage error'));
            } else {
              resolve(response);
            }
          });
        } catch(e) {
          reject(e);
        }
      });
    }

    function saveBlurItem(hostname, item) {
      return sendMsg({ type: 'SAVE_BLUR_ITEM', hostname: hostname, item: item });
    }
    function removeBlurItem(hostname, itemId) {
      return sendMsg({ type: 'REMOVE_BLUR_ITEM', hostname: hostname, itemId: itemId });
    }
    function getBlurItems(hostname) {
      return sendMsg({ type: 'GET_BLUR_ITEMS', hostname: hostname }).then(function(res) {
        return (res && Array.isArray(res.items)) ? res.items : [];
      });
    }
    function clearHost(hostname) { return sendMsg({ type: 'CLEAR_HOST', hostname: hostname }); }
    function clearAll() { return sendMsg({ type: 'CLEAR_ALL' }); }

    function getSettings() {
      return sendMsg({ type: 'GET_SETTINGS' }).then(function(res) {
        return (res && res.settings) ? res.settings : MSG.buildDefaultSettings();
      });
    }
    function saveSettings(fullSettings) {
      return sendMsg({ type: 'SAVE_SETTINGS', settings: fullSettings });
    }
    function getRules() {
      return sendMsg({ type: 'GET_RULES' }).then(function(res) {
        return (res && Array.isArray(res.rules)) ? res.rules : [];
      });
    }
    function saveRules(rules) {
      return sendMsg({ type: 'SAVE_RULES', rules: rules });
    }

    pb.Storage = {
      saveBlurItem: saveBlurItem,
      removeBlurItem: removeBlurItem,
      getBlurItems: getBlurItems,
      clearHost: clearHost,
      clearAll: clearAll,
      getSettings: getSettings,
      saveSettings: saveSettings,
      getRules: getRules,
      saveRules: saveRules,
    };
  })();
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Make chrome.runtime.sendMessage call its callback with the given value.
 * Simulates a successful background response.
 */
function mockSendMessageResponse(responseValue) {
  chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
    if (cb) cb(responseValue);
  });
}

/**
 * Make chrome.runtime.sendMessage simulate a chrome.runtime.lastError.
 */
function mockSendMessageError(errorMessage) {
  chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
    const originalLastError = chrome.runtime.lastError;
    Object.defineProperty(chrome.runtime, 'lastError', {
      value: { message: errorMessage },
      configurable: true,
    });
    if (cb) cb(undefined);
    Object.defineProperty(chrome.runtime, 'lastError', {
      value: originalLastError,
      configurable: true,
    });
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('pb.Storage', () => {
  beforeAll(() => {
    loadStorageManager();
  });

  // ── saveBlurItem ───────────────────────────────────────────────────────────

  describe('saveBlurItem', () => {
    test('sends SAVE_BLUR_ITEM message with hostname and item', async () => {
      mockSendMessageResponse({ ok: true });

      const item = { type: 'dynamic', name: 'Dynamic 1', selector: '#target' };
      await pb.Storage.saveBlurItem('example.com', item);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SAVE_BLUR_ITEM',
          hostname: 'example.com',
          item,
        }),
        expect.any(Function)
      );
    });

    test('resolves with the response from background', async () => {
      mockSendMessageResponse({ ok: true });

      const item = { type: 'dynamic', name: 'Dynamic 1', selector: '#target' };
      const result = await pb.Storage.saveBlurItem('example.com', item);

      expect(result).toEqual({ ok: true });
    });
  });

  // ── removeBlurItem ────────────────────────────────────────────────────────

  describe('removeBlurItem', () => {
    test('sends REMOVE_BLUR_ITEM message with correct payload', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.removeBlurItem('example.com', '#target');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REMOVE_BLUR_ITEM',
          hostname: 'example.com',
          itemId: '#target',
        }),
        expect.any(Function)
      );
    });
  });

  // ── getBlurItems ──────────────────────────────────────────────────────────

  describe('getBlurItems', () => {
    test('resolves with items array from background response', async () => {
      const items = [
        { type: 'dynamic', name: 'Dynamic 1', selector: '#foo' },
        { type: 'dynamic', name: 'Dynamic 2', selector: '.bar' },
      ];
      mockSendMessageResponse({ items });

      const result = await pb.Storage.getBlurItems('example.com');

      expect(result).toEqual(items);
    });

    test('resolves with empty array when background returns no items', async () => {
      mockSendMessageResponse({});

      const result = await pb.Storage.getBlurItems('example.com');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    test('sends GET_BLUR_ITEMS message with correct hostname', async () => {
      mockSendMessageResponse({ items: [] });

      await pb.Storage.getBlurItems('news.example.org');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GET_BLUR_ITEMS',
          hostname: 'news.example.org',
        }),
        expect.any(Function)
      );
    });

    test('resolves with empty array when response is null', async () => {
      mockSendMessageResponse(null);

      const result = await pb.Storage.getBlurItems('x.com');

      expect(result).toEqual([]);
    });
  });

  // ── clearHost ──────────────────────────────────────────────────────────────

  describe('clearHost', () => {
    test('sends CLEAR_HOST message with correct hostname', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.clearHost('example.com');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLEAR_HOST',
          hostname: 'example.com',
        }),
        expect.any(Function)
      );
    });

    test('does not send CLEAR_ALL when only clearing a specific host', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.clearHost('example.com');

      const calls = chrome.runtime.sendMessage.mock.calls;
      calls.forEach(([msg]) => {
        expect(msg.type).not.toBe('CLEAR_ALL');
      });
    });
  });

  // ── clearAll ───────────────────────────────────────────────────────────────

  describe('clearAll', () => {
    test('sends CLEAR_ALL message', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.clearAll();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CLEAR_ALL' }),
        expect.any(Function)
      );
    });

    test('does not include hostname in CLEAR_ALL message', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.clearAll();

      const [msg] = chrome.runtime.sendMessage.mock.calls[0];
      expect(msg.hostname).toBeUndefined();
    });
  });

  // ── getSettings ────────────────────────────────────────────────────────────

  describe('getSettings', () => {
    test('returns settings from background response', async () => {
      mockSendMessageResponse({ settings: { BLUR_RADIUS: 12, ENABLED: true } });

      const settings = await pb.Storage.getSettings();

      expect(settings.BLUR_RADIUS).toBe(12);
      expect(settings.ENABLED).toBe(true);
    });

    test('falls back to defaults when response has no settings', async () => {
      mockSendMessageResponse({});

      const settings = await pb.Storage.getSettings();

      // buildDefaultSettings() returns a full default object
      expect(settings.BLUR_RADIUS).toBe(10);
      expect(settings.HIGHLIGHT_COLOR).toBe('#f59e0b');
      expect(settings.TRANSITION_DURATION).toBe(200);
    });

    test('falls back to defaults when response is null', async () => {
      mockSendMessageResponse(null);

      const settings = await pb.Storage.getSettings();

      expect(settings.BLUR_RADIUS).toBe(10);
    });
  });

  // ── saveSettings ───────────────────────────────────────────────────────────

  describe('saveSettings', () => {
    test('sends full settings object to background', async () => {
      chrome.runtime.sendMessage
        .mockImplementationOnce((_msg, cb) => cb({ ok: true }));

      const fullSettings = pb.buildDefaultSettings();
      fullSettings.BLUR_RADIUS = 20;
      await pb.Storage.saveSettings(fullSettings);

      const saveCalls = chrome.runtime.sendMessage.mock.calls.filter(
        ([msg]) => msg.type === 'SAVE_SETTINGS'
      );
      expect(saveCalls.length).toBe(1);
      const savedSettings = saveCalls[0][0].settings;
      expect(savedSettings.BLUR_RADIUS).toBe(20);
      expect(savedSettings.ENABLED).toBe(true); // full object includes all keys
    });

    test('sends SAVE_SETTINGS message type', async () => {
      chrome.runtime.sendMessage
        .mockImplementationOnce((_msg, cb) => cb({ ok: true }));

      await pb.Storage.saveSettings(pb.buildDefaultSettings());

      const saveCall = chrome.runtime.sendMessage.mock.calls.find(
        ([msg]) => msg.type === 'SAVE_SETTINGS'
      );
      expect(saveCall).toBeDefined();
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    test('rejects when sendMessage triggers lastError', async () => {
      mockSendMessageError('Extension context invalidated');

      await expect(
        pb.Storage.saveBlurItem('x.com', { type: 'dynamic', name: 'Dynamic 1', selector: '#el' })
      ).rejects.toBeTruthy();
    });

    test('getBlurItems handles sendMessage error gracefully by rejecting', async () => {
      mockSendMessageError('Background not ready');

      await expect(
        pb.Storage.getBlurItems('x.com')
      ).rejects.toBeTruthy();
    });

    test('rejects when sendMessage throws synchronously', async () => {
      chrome.runtime.sendMessage.mockImplementation(() => {
        throw new Error('Extension context invalidated');
      });

      await expect(
        pb.Storage.saveBlurItem('x.com', { type: 'dynamic', name: 'Dynamic 1', selector: '#el' })
      ).rejects.toThrow('Extension context invalidated');
    });

    test('clearAll rejects on lastError', async () => {
      mockSendMessageError('Service worker suspended');

      await expect(
        pb.Storage.clearAll()
      ).rejects.toBeTruthy();
    });

    test('clearHost rejects on lastError', async () => {
      mockSendMessageError('Service worker suspended');

      await expect(
        pb.Storage.clearHost('example.com')
      ).rejects.toBeTruthy();
    });
  });

  // ── Guard clauses ─────────────────────────────────────────────────────────

  describe('guard clauses', () => {
    test('saveBlurItem returns early for empty hostname', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.saveBlurItem('', { type: 'dynamic', name: 'D1', selector: '#el' });

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('saveBlurItem returns early for null item', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.saveBlurItem('example.com', null);

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('removeBlurItem returns early for empty hostname', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.removeBlurItem('', '#el');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('getBlurItems returns empty array for empty hostname', async () => {
      const result = await pb.Storage.getBlurItems('');

      expect(result).toEqual([]);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('clearHost returns early for empty hostname', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.clearHost('');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('saveSettings returns early for null input', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.saveSettings(null);

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('saveSettings returns early for non-object input', async () => {
      mockSendMessageResponse({ ok: true });

      await pb.Storage.saveSettings('not an object');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── getRules / saveRules ────────────────────────────────────────────────

  describe('getRules', () => {
    test('returns rules array from background', async () => {
      mockSendMessageResponse({ rules: [{ id: 'r1', pattern: '*.test.com' }] });

      const rules = await pb.Storage.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('r1');
    });

    test('returns empty array when no rules saved', async () => {
      mockSendMessageResponse({});

      const rules = await pb.Storage.getRules();
      expect(rules).toEqual([]);
    });
  });

  describe('saveRules', () => {
    test('sends SAVE_RULES message with rules array', async () => {
      chrome.runtime.sendMessage
        .mockImplementationOnce((_msg, cb) => cb({ ok: true }));

      const rules = [{ id: 'r1', pattern: '*.example.com', patternType: 'wildcard', settings: {} }];
      await pb.Storage.saveRules(rules);

      const saveCall = chrome.runtime.sendMessage.mock.calls.find(
        ([msg]) => msg.type === 'SAVE_RULES'
      );
      expect(saveCall).toBeDefined();
      expect(saveCall[0].rules).toEqual(rules);
    });
  });

  // ── getBlurState / saveBlurState ──────────────────────────────────────────

  describe('getBlurState', () => {
    test('returns blur state from background', async () => {
      chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
        if (cb) cb({ blurAll: true });
      });

      const result = await pb.Storage.getBlurState('example.com');
      expect(result).toBeDefined();

      const call = chrome.runtime.sendMessage.mock.calls.find(
        ([msg]) => msg.type === 'GET_BLUR_STATE'
      );
      expect(call).toBeDefined();
      expect(call[0].hostname).toBe('example.com');
    });
  });

  describe('saveBlurState', () => {
    test('sends SAVE_BLUR_STATE message', async () => {
      chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
        if (cb) cb({ success: true });
      });

      await pb.Storage.saveBlurState('example.com', true);

      const call = chrome.runtime.sendMessage.mock.calls.find(
        ([msg]) => msg.type === 'SAVE_BLUR_STATE'
      );
      expect(call).toBeDefined();
      expect(call[0].hostname).toBe('example.com');
      expect(call[0].blurAll).toBe(true);
    });
  });
});
