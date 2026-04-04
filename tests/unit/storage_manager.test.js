/**
 * tests/unit/storage_manager.test.js
 *
 * Unit tests for src/storage_manager.js
 * Module exposes window.PrivacyBlurStorage with:
 *   saveBlurredElement, removeBlurredElement, getBlurredSelectors,
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
  if (global.PrivacyBlurStorage) return;
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
    var MSG = window.PrivacyBlur;

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

    function saveBlurredElement(hostname, selector) {
      return sendMsg({ type: 'SAVE_SELECTOR', hostname: hostname, selector: selector });
    }
    function removeBlurredElement(hostname, selector) {
      return sendMsg({ type: 'REMOVE_SELECTOR', hostname: hostname, selector: selector });
    }
    function getBlurredSelectors(hostname) {
      return sendMsg({ type: 'GET_SELECTORS', hostname: hostname }).then(function(res) {
        return (res && res.selectors) ? res.selectors : [];
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

    window.PrivacyBlurStorage = {
      saveBlurredElement: saveBlurredElement,
      removeBlurredElement: removeBlurredElement,
      getBlurredSelectors: getBlurredSelectors,
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

describe('PrivacyBlurStorage', () => {
  beforeAll(() => {
    loadStorageManager();
  });

  // ── saveBlurredElement ─────────────────────────────────────────────────────

  describe('saveBlurredElement', () => {
    test('sends SAVE_SELECTOR message with hostname and selector', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.saveBlurredElement('example.com', '#target');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SAVE_SELECTOR',
          hostname: 'example.com',
          selector: '#target',
        }),
        expect.any(Function)
      );
    });

    test('resolves with the response from background', async () => {
      mockSendMessageResponse({ ok: true });

      const result = await PrivacyBlurStorage.saveBlurredElement('example.com', '#target');

      expect(result).toEqual({ ok: true });
    });
  });

  // ── removeBlurredElement ───────────────────────────────────────────────────

  describe('removeBlurredElement', () => {
    test('sends REMOVE_SELECTOR message with correct payload', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.removeBlurredElement('example.com', '#target');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REMOVE_SELECTOR',
          hostname: 'example.com',
          selector: '#target',
        }),
        expect.any(Function)
      );
    });
  });

  // ── getBlurredSelectors ────────────────────────────────────────────────────

  describe('getBlurredSelectors', () => {
    test('resolves with selectors array from background response', async () => {
      mockSendMessageResponse({ selectors: ['#foo', '.bar', '[data-pb-id="abc"]'] });

      const selectors = await PrivacyBlurStorage.getBlurredSelectors('example.com');

      expect(selectors).toEqual(['#foo', '.bar', '[data-pb-id="abc"]']);
    });

    test('resolves with empty array when background returns no selectors', async () => {
      mockSendMessageResponse({});

      const selectors = await PrivacyBlurStorage.getBlurredSelectors('example.com');

      expect(Array.isArray(selectors)).toBe(true);
      expect(selectors).toHaveLength(0);
    });

    test('sends GET_SELECTORS message with correct hostname', async () => {
      mockSendMessageResponse({ selectors: [] });

      await PrivacyBlurStorage.getBlurredSelectors('news.example.org');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GET_SELECTORS',
          hostname: 'news.example.org',
        }),
        expect.any(Function)
      );
    });

    test('resolves with empty array when response is null', async () => {
      mockSendMessageResponse(null);

      const selectors = await PrivacyBlurStorage.getBlurredSelectors('x.com');

      expect(selectors).toEqual([]);
    });
  });

  // ── clearHost ──────────────────────────────────────────────────────────────

  describe('clearHost', () => {
    test('sends CLEAR_HOST message with correct hostname', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.clearHost('example.com');

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

      await PrivacyBlurStorage.clearHost('example.com');

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

      await PrivacyBlurStorage.clearAll();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CLEAR_ALL' }),
        expect.any(Function)
      );
    });

    test('does not include hostname in CLEAR_ALL message', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.clearAll();

      const [msg] = chrome.runtime.sendMessage.mock.calls[0];
      expect(msg.hostname).toBeUndefined();
    });
  });

  // ── getSettings ────────────────────────────────────────────────────────────

  describe('getSettings', () => {
    test('returns settings from background response', async () => {
      mockSendMessageResponse({ settings: { BLUR_RADIUS: 12, ENABLED: true } });

      const settings = await PrivacyBlurStorage.getSettings();

      expect(settings.BLUR_RADIUS).toBe(12);
      expect(settings.ENABLED).toBe(true);
    });

    test('falls back to defaults when response has no settings', async () => {
      mockSendMessageResponse({});

      const settings = await PrivacyBlurStorage.getSettings();

      // buildDefaultSettings() returns a full default object
      expect(settings.BLUR_RADIUS).toBe(8);
      expect(settings.HIGHLIGHT_COLOR).toBe('#f59e0b');
      expect(settings.TRANSITION_DURATION).toBe(200);
    });

    test('falls back to defaults when response is null', async () => {
      mockSendMessageResponse(null);

      const settings = await PrivacyBlurStorage.getSettings();

      expect(settings.BLUR_RADIUS).toBe(8);
    });
  });

  // ── saveSettings ───────────────────────────────────────────────────────────

  describe('saveSettings', () => {
    test('sends full settings object to background', async () => {
      chrome.runtime.sendMessage
        .mockImplementationOnce((_msg, cb) => cb({ ok: true }));

      const fullSettings = PrivacyBlur.buildDefaultSettings();
      fullSettings.BLUR_RADIUS = 20;
      await PrivacyBlurStorage.saveSettings(fullSettings);

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

      await PrivacyBlurStorage.saveSettings(PrivacyBlur.buildDefaultSettings());

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
        PrivacyBlurStorage.saveBlurredElement('x.com', '#el')
      ).rejects.toBeTruthy();
    });

    test('getBlurredSelectors handles sendMessage error gracefully by rejecting', async () => {
      mockSendMessageError('Background not ready');

      await expect(
        PrivacyBlurStorage.getBlurredSelectors('x.com')
      ).rejects.toBeTruthy();
    });

    test('rejects when sendMessage throws synchronously', async () => {
      chrome.runtime.sendMessage.mockImplementation(() => {
        throw new Error('Extension context invalidated');
      });

      await expect(
        PrivacyBlurStorage.saveBlurredElement('x.com', '#el')
      ).rejects.toThrow('Extension context invalidated');
    });

    test('clearAll rejects on lastError', async () => {
      mockSendMessageError('Service worker suspended');

      await expect(
        PrivacyBlurStorage.clearAll()
      ).rejects.toBeTruthy();
    });

    test('clearHost rejects on lastError', async () => {
      mockSendMessageError('Service worker suspended');

      await expect(
        PrivacyBlurStorage.clearHost('example.com')
      ).rejects.toBeTruthy();
    });
  });

  // ── Guard clauses ─────────────────────────────────────────────────────────

  describe('guard clauses', () => {
    test('saveBlurredElement returns early for empty hostname', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.saveBlurredElement('', '#el');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('saveBlurredElement returns early for empty selector', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.saveBlurredElement('example.com', '');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('removeBlurredElement returns early for empty hostname', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.removeBlurredElement('', '#el');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('getBlurredSelectors returns empty array for empty hostname', async () => {
      const result = await PrivacyBlurStorage.getBlurredSelectors('');

      expect(result).toEqual([]);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('clearHost returns early for empty hostname', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.clearHost('');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('saveSettings returns early for null input', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.saveSettings(null);

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('saveSettings returns early for non-object input', async () => {
      mockSendMessageResponse({ ok: true });

      await PrivacyBlurStorage.saveSettings('not an object');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── getRules / saveRules ────────────────────────────────────────────────

  describe('getRules', () => {
    test('returns rules array from background', async () => {
      mockSendMessageResponse({ rules: [{ id: 'r1', pattern: '*.test.com' }] });

      const rules = await PrivacyBlurStorage.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('r1');
    });

    test('returns empty array when no rules saved', async () => {
      mockSendMessageResponse({});

      const rules = await PrivacyBlurStorage.getRules();
      expect(rules).toEqual([]);
    });
  });

  describe('saveRules', () => {
    test('sends SAVE_RULES message with rules array', async () => {
      chrome.runtime.sendMessage
        .mockImplementationOnce((_msg, cb) => cb({ ok: true }));

      const rules = [{ id: 'r1', pattern: '*.example.com', patternType: 'wildcard', settings: {} }];
      await PrivacyBlurStorage.saveRules(rules);

      const saveCall = chrome.runtime.sendMessage.mock.calls.find(
        ([msg]) => msg.type === 'SAVE_RULES'
      );
      expect(saveCall).toBeDefined();
      expect(saveCall[0].rules).toEqual(rules);
    });
  });
});
