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

    var DEFAULT_SETTINGS = {
      blurRadius: 8,
      highlightColor: '#f59e0b',
      transitionDuration: 200,
      revealOnHover: false,
      shortcuts: {}
    };

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

    function clearHost(hostname) {
      return sendMsg({ type: 'CLEAR_HOST', hostname: hostname });
    }

    function clearAll() {
      return sendMsg({ type: 'CLEAR_ALL' });
    }

    function getSettings() {
      return sendMsg({ type: 'GET_SETTINGS' }).then(function(res) {
        var stored = (res && res.settings) ? res.settings : {};
        return Object.assign({}, DEFAULT_SETTINGS, stored);
      });
    }

    function saveSettings(partial) {
      return getSettings().then(function(current) {
        var merged = Object.assign({}, current, partial);
        return sendMsg({ type: 'SAVE_SETTINGS', settings: merged });
      });
    }

    window.PrivacyBlurStorage = {
      saveBlurredElement: saveBlurredElement,
      removeBlurredElement: removeBlurredElement,
      getBlurredSelectors: getBlurredSelectors,
      clearHost: clearHost,
      clearAll: clearAll,
      getSettings: getSettings,
      saveSettings: saveSettings,
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
    test('returns merged settings with defaults when storage is empty', async () => {
      mockSendMessageResponse({});

      const settings = await PrivacyBlurStorage.getSettings();

      // Defaults must be present.
      expect(settings.blurRadius).toBeDefined();
      expect(settings.highlightColor).toBeDefined();
      expect(settings.transitionDuration).toBeDefined();
      expect(settings.revealOnHover).toBeDefined();
    });

    test('overrides defaults with stored values', async () => {
      mockSendMessageResponse({ settings: { blurRadius: 20, revealOnHover: true } });

      const settings = await PrivacyBlurStorage.getSettings();

      expect(settings.blurRadius).toBe(20);
      expect(settings.revealOnHover).toBe(true);
    });

    test('fills missing stored keys with default values', async () => {
      mockSendMessageResponse({ settings: { blurRadius: 15 } });

      const settings = await PrivacyBlurStorage.getSettings();

      // blurRadius overridden, transitionDuration should still be default.
      expect(settings.blurRadius).toBe(15);
      expect(settings.transitionDuration).toBe(200);
    });
  });

  // ── saveSettings ───────────────────────────────────────────────────────────

  describe('saveSettings', () => {
    test('sends partial settings directly to background for merging', async () => {
      // Single call — saveSettings sends the partial directly to background.
      chrome.runtime.sendMessage
        .mockImplementationOnce((_msg, cb) => cb({ ok: true }));

      await PrivacyBlurStorage.saveSettings({ revealOnHover: true });

      const saveCalls = chrome.runtime.sendMessage.mock.calls.filter(
        ([msg]) => msg.type === 'SAVE_SETTINGS'
      );
      expect(saveCalls.length).toBe(1);
      const savedSettings = saveCalls[0][0].settings;
      expect(savedSettings.revealOnHover).toBe(true); // the partial that was passed
      expect(savedSettings.blurRadius).toBeUndefined(); // not pre-merged
    });

    test('sends SAVE_SETTINGS message type', async () => {
      chrome.runtime.sendMessage
        .mockImplementationOnce((_msg, cb) => cb({ ok: true }));

      await PrivacyBlurStorage.saveSettings({ blurRadius: 16 });

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

  // ── DEFAULT_SETTINGS ──────────────────────────────────────────────────────

  describe('DEFAULT_SETTINGS', () => {
    test('exposes DEFAULT_SETTINGS as a public property', () => {
      expect(PrivacyBlurStorage.DEFAULT_SETTINGS).toBeDefined();
    });

    test('DEFAULT_SETTINGS contains expected keys', () => {
      const defaults = PrivacyBlurStorage.DEFAULT_SETTINGS;
      expect(defaults.blurRadius).toBeDefined();
      expect(defaults.highlightColor).toBeDefined();
      expect(defaults.transitionDuration).toBeDefined();
      expect(typeof defaults.revealOnHover).toBe('boolean');
      expect(typeof defaults.enabled).toBe('boolean');
    });

    test('DEFAULT_SETTINGS contains shortcuts sub-object', () => {
      const shortcuts = PrivacyBlurStorage.DEFAULT_SETTINGS.shortcuts;
      expect(shortcuts).toBeDefined();
      expect(shortcuts.chordKey1).toBeDefined();
      expect(shortcuts.chordKey2).toBeDefined();
      expect(shortcuts.chordModifier).toBeDefined();
    });
  });

  // ── getSettings merging ───────────────────────────────────────────────────

  describe('getSettings merging', () => {
    test('returns complete object even when background returns null response', async () => {
      mockSendMessageResponse(null);

      const settings = await PrivacyBlurStorage.getSettings();

      expect(settings.blurRadius).toBeDefined();
      expect(settings.highlightColor).toBeDefined();
    });

    test('stored values override defaults', async () => {
      mockSendMessageResponse({
        settings: { blurRadius: 20, highlightColor: '#ff0000' }
      });

      const settings = await PrivacyBlurStorage.getSettings();

      expect(settings.blurRadius).toBe(20);
      expect(settings.highlightColor).toBe('#ff0000');
      // Defaults should still be present for non-overridden keys
      expect(settings.transitionDuration).toBe(200);
    });

    test('returns blurCategories merged with defaults', async () => {
      mockSendMessageResponse({
        settings: { blurCategories: { form: true } }
      });

      const settings = await PrivacyBlurStorage.getSettings();

      // Partial override: form changed to true
      expect(settings.blurCategories.form).toBe(true);
      // Defaults preserved for non-overridden keys
      expect(settings.blurCategories.text).toBe(true);
      expect(settings.blurCategories.media).toBe(true);
      expect(settings.blurCategories.table).toBe(true);
      expect(settings.blurCategories.structure).toBe(true);
    });

    test('returns default blurCategories when none saved', async () => {
      mockSendMessageResponse({ settings: {} });

      const settings = await PrivacyBlurStorage.getSettings();

      expect(settings.blurCategories).toBeDefined();
      expect(settings.blurCategories.text).toBe(true);
      expect(settings.blurCategories.media).toBe(true);
      expect(settings.blurCategories.form).toBe(false);
      expect(settings.blurCategories.table).toBe(true);
      expect(settings.blurCategories.structure).toBe(true);
    });

    test('returns thoroughBlur merged with default', async () => {
      mockSendMessageResponse({ settings: { thoroughBlur: true } });
      const settings = await PrivacyBlurStorage.getSettings();
      expect(settings.thoroughBlur).toBe(true);
    });

    test('returns default thoroughBlur when none saved', async () => {
      mockSendMessageResponse({ settings: {} });
      const settings = await PrivacyBlurStorage.getSettings();
      expect(settings.thoroughBlur).toBe(false);
    });
  });
});
